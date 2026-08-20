import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PublishedProductSyncError,
  syncPublishedSimpleProductChanges,
} from "../services/marketplaceProductEditorState.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [editor, drafts, affiliateService, legacy] = await Promise.all([
  read("app/seller/product-editor/[productId].tsx"),
  read("services/marketplaceProductDraftService.ts"),
  read("services/liveCommerceService.ts"),
  read("app/seller/product/[id]/edit.tsx"),
]);

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
};

const primaryLoad = between(
  editor,
  "const load = useCallback",
  "useEffect(() =>",
);
const affiliateLoad = between(
  editor,
  "const loadAffiliateForEditor",
  "const loadShippingForEditor",
);
const affiliateSave = between(
  editor,
  "const saveAffiliateSettings",
  "const savePublishedProductChanges",
);
const publishedSave = between(
  editor,
  "const savePublishedProductChanges",
  "const leaveEditor",
);
const publish = between(editor, "const publish = async", "if (loading)");

test("critical product load is isolated from retryable secondary sections", () => {
  assert.match(primaryLoad, /fetchSellerFoundation/);
  assert.match(primaryLoad, /fetchCategories/);
  assert.match(primaryLoad, /fetchMarketplaceProductDraft/);
  assert.match(primaryLoad, /void loadVariantsForEditor/);
  assert.match(primaryLoad, /void loadAffiliateForEditor/);
  assert.match(primaryLoad, /void loadShippingForEditor/);
  assert.match(primaryLoad, /No pudimos abrir el producto/);
  assert.doesNotMatch(editor, /No pudimos abrir el borrador/);
});

test("affiliate failure remains explicit and cannot masquerade as disabled", () => {
  assert.match(affiliateLoad, /setAffiliateLoadState\("loading"\)/);
  assert.match(affiliateLoad, /setAffiliateLoadState\("loaded"\)/);
  assert.match(affiliateLoad, /setAffiliateLoadState\("error"\)/);
  assert.match(
    affiliateLoad,
    /creatorCommissionBpsToPercent\(offer\.commissionBps\)/,
  );
  const affiliateCatch = affiliateLoad.slice(affiliateLoad.indexOf("catch"));
  assert.doesNotMatch(affiliateCatch, /setAffiliateEnabled\(false\)/);
  assert.match(editor, /No pudimos cargar la configuracion de afiliados/);
  assert.match(editor, /loadAffiliateForEditor\(productId\)/);
});

test("variant and shipping failures have independent retry state", () => {
  assert.match(editor, /variantsLoadState === "error"/);
  assert.match(editor, /refreshVariantSummary\(\)/);
  assert.match(editor, /shippingLoadState === "error"/);
  assert.match(editor, /refreshShippingProfiles\(\)/);
});

test("published state comes from the canonical published_at payload", () => {
  assert.match(drafts, /publishedAt: string \| null/);
  assert.match(drafts, /rpcNullableTimestamp\(\s*p\.published_at/);
  assert.match(editor, /setPublishedAt\(d\.publishedAt\)/);
  assert.match(editor, /const isPublished = publishedAt !== null/);
  assert.doesNotMatch(editor, /const isPublished = .*status === "active"/);
});

test("published and draft modes expose different save actions", () => {
  assert.match(
    editor,
    /isPublished \? "Guardar cambios" : "Publicar producto"/,
  );
  assert.match(
    editor,
    /isPublished \? "Producto publicado" : "Borrador privado"/,
  );
  assert.match(editor, /if \(!dirty \|\| loading \|\| isPublished\) return/);
  assert.match(editor, /dirty && !isPublished/);
});

test("published affiliate settings reuse the existing canonical authority", () => {
  assert.match(
    affiliateSave,
    /creatorCommissionPercentToBps\(affiliatePercent\)/,
  );
  assert.match(affiliateSave, /upsertMyLiveAffiliateOffer/);
  assert.match(affiliateSave, /offerScope: "public_creator"/);
  assert.match(affiliateSave, /fetchMyLiveAffiliateOffer\(productId\)/);
  assert.match(editor, /saveAffiliateSettings\("active"\)/);
  assert.match(editor, /saveAffiliateSettings\("paused"\)/);
  assert.match(affiliateService, /status: "active" \| "paused" \| "removed"/);
  assert.doesNotMatch(
    affiliateSave,
    /publish\(|setProductPublished|evaluateMarketplaceProductPublication/,
  );
});

test("published product save preserves status and simple inventory consistency", () => {
  assert.match(publishedSave, /flushDraftSave\(true, false, false\)/);
  assert.match(publishedSave, /saveQueue\.current\.wait\(\)/);
  assert.match(publishedSave, /mediaQueue\.current/);
  assert.match(publishedSave, /syncSimpleVariantAndInventory/);
  assert.match(publishedSave, /setDirty\(true\)/);
  assert.match(publishedSave, /setDirty\(false\)/);
  assert.match(publishedSave, /productFieldsSaved/);
  assert.match(publishedSave, /El producto se guardo parcialmente/);
  assert.doesNotMatch(publishedSave, /version publicada anterior/);
  assert.doesNotMatch(
    publishedSave,
    /setProductPublished|evaluateMarketplaceProductPublication/,
  );
  assert.match(editor, /updateVariant\(defaultVariant\.id/);
  assert.match(editor, /setVariantInventory\(/);
});

const simpleInventory = (price = 25, stock = 14) => ({
  variants: [
    {
      id: "variant-1",
      status: "active",
      is_default: true,
      price,
      base_price: price,
    },
  ],
  optionsCount: 0,
  inventory: [{ variant_id: "variant-1", on_hand: stock }],
});

test("published no-op save skips variant and inventory mutations", async () => {
  let priceWrites = 0;
  let inventoryWrites = 0;
  const result = await syncPublishedSimpleProductChanges({
    ...simpleInventory(),
    editorPrice: 25,
    editorStock: 14,
    updatePrice: async () => {
      priceWrites += 1;
    },
    updateInventory: async () => {
      inventoryWrites += 1;
    },
  });
  assert.deepEqual(result, {
    kind: "simple",
    priceUpdated: false,
    inventoryUpdated: false,
  });
  assert.equal(priceWrites, 0);
  assert.equal(inventoryWrites, 0);
});

test("published save compares the canonical base price, not a promoted price", async () => {
  let priceWrites = 0;
  const current = simpleInventory();
  current.variants[0].price = 20;
  await syncPublishedSimpleProductChanges({
    ...current,
    editorPrice: 25,
    editorStock: 14,
    updatePrice: async () => {
      priceWrites += 1;
    },
    updateInventory: async () => {},
  });
  assert.equal(priceWrites, 0);
});

test("published price change updates only the default variant", async () => {
  let priceWrites = 0;
  let inventoryWrites = 0;
  const result = await syncPublishedSimpleProductChanges({
    ...simpleInventory(),
    editorPrice: 27,
    editorStock: 14,
    updatePrice: async () => {
      priceWrites += 1;
    },
    updateInventory: async () => {
      inventoryWrites += 1;
    },
  });
  assert.equal(result.priceUpdated, true);
  assert.equal(result.inventoryUpdated, false);
  assert.equal(priceWrites, 1);
  assert.equal(inventoryWrites, 0);
});

test("published stock change updates only canonical inventory", async () => {
  let priceWrites = 0;
  let inventoryWrites = 0;
  const result = await syncPublishedSimpleProductChanges({
    ...simpleInventory(),
    editorPrice: 25,
    editorStock: 20,
    updatePrice: async () => {
      priceWrites += 1;
    },
    updateInventory: async () => {
      inventoryWrites += 1;
    },
  });
  assert.equal(result.priceUpdated, false);
  assert.equal(result.inventoryUpdated, true);
  assert.equal(priceWrites, 0);
  assert.equal(inventoryWrites, 1);
});

test("published partial sync failure retains an exact retry stage", async () => {
  await assert.rejects(
    syncPublishedSimpleProductChanges({
      ...simpleInventory(),
      editorPrice: 27,
      editorStock: 14,
      updatePrice: async () => {
        throw new Error("transport");
      },
      updateInventory: async () => {},
    }),
    (error) =>
      error instanceof PublishedProductSyncError &&
      error.stage === "variant_update_failed",
  );
  assert.match(publishedSave, /setDirty\(true\)/);
  assert.match(
    publishedSave,
    /Reintenta para terminar la sincronizacion de precio e inventario/,
  );
});

test("configurable products retain their dedicated variant authority", async () => {
  let writes = 0;
  const result = await syncPublishedSimpleProductChanges({
    ...simpleInventory(),
    optionsCount: 1,
    editorPrice: 27,
    editorStock: 20,
    updatePrice: async () => {
      writes += 1;
    },
    updateInventory: async () => {
      writes += 1;
    },
  });
  assert.deepEqual(result, {
    kind: "configurable",
    priceUpdated: false,
    inventoryUpdated: false,
  });
  assert.equal(writes, 0);
});

test("new products retain readiness evaluation and checked publication", () => {
  assert.match(publish, /evaluateMarketplaceProductPublication\(productId\)/);
  assert.match(publish, /setProductPublished\(productId, true\)/);
  assert.match(
    publish,
    /syncSimpleVariantAndInventory\(productId, "Publicacion V2"\)/,
  );
});

test("legacy edit route remains a bridge to the single consolidated editor", () => {
  assert.match(legacy, /router\.replace\(`\/seller\/product-editor\/\$\{id\}`/);
  assert.doesNotMatch(legacy, /fetchMyLiveAffiliateOffer|updateProduct/);
});

test("the corrective introduces no database or financial client authority", () => {
  const protectedTerms =
    /ledger|wallet|escrow|checkout|settlement|service_role/i;
  assert.doesNotMatch(publishedSave, protectedTerms);
  assert.doesNotMatch(affiliateSave, protectedTerms);
});
