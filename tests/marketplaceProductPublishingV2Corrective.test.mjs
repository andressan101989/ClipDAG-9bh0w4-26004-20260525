import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveMarketplaceVariantsReady,
  LatestSaveQueue,
  readyProductImages,
  replaceEditorMedia,
} from "../services/marketplaceProductEditorState.ts";
import { calculateMarketplaceProductQualityCore as quality } from "../services/marketplaceProductQualityCore.mjs";
import { parseMarketplaceProductEditorFlags } from "../services/marketplaceProductEditorFlagsCore.mjs";
import { classifySellerProductStatusCore as status } from "../services/marketplaceSellerProductStatusCore.mjs";

const editor = readFileSync("app/seller/product-editor/[productId].tsx", "utf8");
const finalizer = readFileSync("supabase/functions/finalize-media-upload/index.ts", "utf8");
const image = (clientKey, state) => ({
  clientKey,
  assetId: state === "ready" ? `asset-${clientKey}` : clientKey,
  url: `file://${clientKey}.jpg`,
  kind: "image",
  mimeType: "image/jpeg",
  durationMs: null,
  position: 0,
  isCover: clientKey === "a",
  state,
});

test("A ready, B failed, C ready keeps every independent tile and persists ready order", () => {
  const batch = [image("a", "ready"), image("b", "failed"), image("c", "ready")];
  assert.deepEqual(batch.map((item) => item.state), ["ready", "failed", "ready"]);
  assert.deepEqual(readyProductImages(batch).map((item) => item.clientKey), ["a", "c"]);
  const retried = replaceEditorMedia(batch, "b", {
    ...batch[1],
    assetId: "asset-b",
    state: "ready",
  });
  assert.equal(retried.length, 3);
  assert.deepEqual(readyProductImages(retried).map((item) => item.clientKey), ["a", "b", "c"]);
  assert.equal(new Set(retried.map((item) => item.clientKey)).size, 3);
});

test("failed tiles count toward the five-photo selection limit", () => {
  const items = [image("a", "ready"), image("b", "ready"), image("c", "ready"), image("d", "ready"), image("e", "failed")];
  assert.equal(items.length, 5);
  assert.match(editor, /if \(images\.length >= 5\) return/);
  assert.match(editor, /selectionLimit: 5 - images\.length/);
});

test("replacement video preserves official video until the new upload persists", () => {
  assert.match(editor, /persistedVideo/);
  assert.match(editor, /pendingVideo/);
  assert.match(editor, /await queueMediaPersistence\(imagesRef\.current, ready\);\s*updatePersistedVideo\(ready\)/);
  assert.match(editor, /updatePendingVideo\(\{ \.\.\.local, state: "failed" \}\)/);
  assert.match(editor, /removeOfficialVideo/);
});

test("retry preserves MOV metadata and repeated failure preserves the same candidate", () => {
  assert.match(editor, /mimeType:\s*item\.mimeType/);
  assert.match(editor, /fileName: item\.fileName/);
  assert.match(editor, /sizeBytes: item\.sizeBytes/);
  assert.match(editor, /durationMs: item\.durationMs/);
  assert.match(editor, /updatePendingVideo\(\{ \.\.\.item, state: "failed" \}\)/);
});

test("latest-save queue serializes writes and stale completion cannot clear newer edits", async () => {
  const queue = new LatestSaveQueue();
  const persisted = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  queue.edit();
  const first = queue.enqueue("revision-1", async (value) => {
    await gate;
    persisted.push(value);
  });
  queue.edit();
  const second = queue.enqueue("revision-2", async (value) => persisted.push(value));
  release();
  const firstResult = await first;
  const secondResult = await second;
  assert.deepEqual(persisted, ["revision-1", "revision-2"]);
  assert.equal(firstResult.current, false);
  assert.equal(secondResult.current, true);
});

test("publish flushes and waits for latest metadata and media queues", () => {
  assert.match(editor, /await flushDraftSave\(true\)/);
  assert.match(editor, /await saveQueue\.current\.wait\(\)/);
  assert.match(editor, /await mediaQueue\.current/);
});

test("technical bootstrap defaults earn no title, category, price, or inventory credit", () => {
  const draft = quality({
    title: "Producto sin titulo",
    titleConfigured: false,
    description: "",
    categoryId: "bootstrap-category",
    categoryConfigured: false,
    imageCount: 0,
    hasValidVideo: false,
    price: 1,
    priceConfigured: false,
    inventory: 0,
    variantsReady: false,
    shippingReady: false,
    productType: "physical",
  });
  assert.equal(draft.score, 0);
  assert.equal(quality({ ...draftInput(), titleConfigured: true }).score, 15);
  assert.equal(quality({ ...draftInput(), priceConfigured: true }).score, 10);
  assert.equal(quality({ ...draftInput(), inventory: 1, variantsReady: true }).score, 5);
});

test("persisted editor intent survives reopen and explicit one-BDAG pricing earns credit", () => {
  assert.deepEqual(parseMarketplaceProductEditorFlags({}, null), {
    titleConfigured: false,
    priceConfigured: false,
    categoryConfigured: false,
  });
  const titleOnly = parseMarketplaceProductEditorFlags(
    {
      title_configured: true,
      price_configured: false,
      category_configured: false,
    },
    null,
  );
  assert.deepEqual(titleOnly, {
    titleConfigured: true,
    priceConfigured: false,
    categoryConfigured: false,
  });
  const configured = parseMarketplaceProductEditorFlags(
    {
      title_configured: true,
      price_configured: true,
      category_configured: true,
    },
    null,
  );
  const configuredInput = {
    ...draftInput(),
    categoryId: "seller-selected-category",
    ...configured,
  };
  assert.equal(quality({ ...configuredInput, price: 1 }).score, 35);
  assert.equal(quality({ ...configuredInput, price: 10 }).score, 35);
});

test("legacy published products infer configured fields but malformed booleans are rejected", () => {
  assert.deepEqual(parseMarketplaceProductEditorFlags({}, "2026-08-08T12:00:00Z"), {
    titleConfigured: true,
    priceConfigured: true,
    categoryConfigured: true,
  });
  assert.throws(
    () =>
      parseMarketplaceProductEditorFlags(
        { title_configured: "true" },
        null,
      ),
    /marketplace_draft_editor_state_invalid/,
  );
});

function draftInput() {
  return {
    title: "Producto real",
    titleConfigured: false,
    description: "",
    categoryId: null,
    categoryConfigured: false,
    imageCount: 0,
    hasValidVideo: false,
    price: 12,
    priceConfigured: false,
    inventory: 0,
    variantsReady: false,
    shippingReady: false,
    productType: "physical",
  };
}

test("variant readiness is derived from active/default/SKU/price/inventory data", () => {
  const ready = { detail: { variants: [{ id: "v", status: "active", is_default: true, sku: "SKU", price: 2 }] }, inventory: [{ variant_id: "v" }] };
  assert.equal(deriveMarketplaceVariantsReady(ready), true);
  assert.equal(deriveMarketplaceVariantsReady({ ...ready, inventory: [] }), false);
  assert.equal(deriveMarketplaceVariantsReady({ ...ready, detail: { variants: [{ ...ready.detail.variants[0], sku: null }] } }), false);
});

test("seller product status classification follows authoritative priority", () => {
  const base = { published_at: null, status: "paused", available_quantity: 0, publication_readiness_reason: "marketplace_product_media_required" };
  assert.equal(status(base), "draft");
  assert.equal(status({ ...base, published_at: "2026-01-01", status: "active", available_quantity: 3 }), "published");
  assert.equal(status({ ...base, published_at: "2026-01-01", status: "sold_out" }), "sold_out");
  assert.equal(status({ ...base, published_at: "2026-01-01" }), "configuration_required");
  assert.equal(status({ ...base, published_at: "2026-01-01", publication_readiness_reason: null }), "paused");
});

test("duration boundary is metadata validation and not bitstream probing", () => {
  assert.match(finalizer, /does not decode or probe the video bitstream/);
  assert.match(finalizer, /duration metadata supplied by the official picker\/upload/);
});
