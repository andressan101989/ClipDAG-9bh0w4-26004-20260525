import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const store = read("app/seller/store.tsx");
const sellerHome = read("app/seller/index.tsx");
const shipping = read("app/seller/shipping-profile.tsx");
const shippingSetup = read("services/marketplaceShippingSetup.ts");
const productEditor = read("app/seller/product-editor/[productId].tsx");
const fulfillment = read("services/marketplaceFulfillmentService.ts");
const fulfillmentParsers = read("services/marketplaceFulfillmentParsers.mjs");
const runtimeValidation = read("services/marketplaceRuntimeValidation.ts");
const sellerOrders = read("app/seller/orders/index.tsx");
const sellerOrderDetail = read("app/seller/orders/[id].tsx");
const fulfillmentSql = read(
  "supabase/migrations/20260802040000_marketplace_mkt_a3d2_delivery_settlement.sql",
);

test("new stores stage logo and banner locally without attaching before creation", () => {
  assert.doesNotMatch(store, /Primero guarda la información de la tienda/);
  assert.doesNotMatch(store, /disabled=\{!store \|\| uploading !== null\}/);
  assert.match(store, /type StagedBranding = Record<BrandingSlot/);
  assert.match(store, /if \(!store \|\| stagedBranding\[slot\]\)/);
  assert.match(store, /setStagedBranding\(\(current\) => \(\{ \.\.\.current, \[slot\]: selected \}\)\)/);
  assert.match(store, /if \(slot === "logo"\) setLogoUrl\(asset\.uri\)/);
  assert.match(store, /else setBannerUrl\(asset\.uri\)/);

  const picker = store.slice(
    store.indexOf("const pickBranding"),
    store.indexOf("uploadLock.current = true", store.indexOf("const pickBranding")),
  );
  assert.doesNotMatch(picker, /uploadMediaFromUri|setStoreMedia/);
});

test("first Save creates once, recovers the canonical ID, then attaches staged branding", () => {
  const persist = store.slice(
    store.indexOf("const persistStore"),
    store.indexOf("const save ="),
  );
  assert.equal((persist.match(/createStore\(/g) ?? []).length, 1);
  assert.match(persist, /pendingCreatedStoreId\.current/);
  assert.match(persist, /recovered\.store\?\.id !== pendingCreatedStoreId\.current/);
  const createAt = persist.indexOf("createStore(");
  const canonicalAt = persist.indexOf("fetchSellerFoundation()", createAt);
  const attachAt = persist.indexOf("attachBrandingAsset(", canonicalAt);
  assert(createAt >= 0 && createAt < canonicalAt && canonicalAt < attachAt);
  assert.match(store, /setStoreMedia\(\s*currentStore\.id/);
});

test("partial branding failure preserves successes and retries without another store", () => {
  assert.match(store, /for \(const slot of \["logo", "banner"\] as const\)/);
  assert.match(store, /failedSlots\.push\(slot\)/);
  assert.match(store, /setStagedBranding\(\(current\) => \(\{ \.\.\.current, \[slot\]: null \}\)\)/);
  assert.match(store, /Tienda guardada parcialmente/);
  assert.match(store, /Puedes volver a guardar para reintentar/);
  assert.match(store, /La tienda ya fue creada[\s\S]*sin crear otra tienda/);
  assert.match(store, /if \(store\) \{\s*await updateStore\(store\.id/);
  assert.match(store, /if \(uploadedId\) await deleteMediaAsset\(uploadedId\)/);
});

test("existing-store branding and C4-C1 slug safeguards remain intact", () => {
  assert.match(store, /attachBrandingAsset\(store, slot, selected\)/);
  assert.match(store, /if \(store && slug !== store\.slug\)/);
  assert.match(store, /"Cambiar dirección pública"/);
  assert.match(store, /\{ text: "Cancelar", style: "cancel" \}/);
  assert.match(store, /const beginSlugEdit = \(\) => \{\s*setFocusedField\("slug"\)/);
  assert.match(store, /onPress=\{\(\) => edit\("slug", suggestedSlug\)\}/);
});

test("Seller Center passes the canonical store and shipping self-resolves deep links", () => {
  assert.match(
    sellerHome,
    /pathname:'\/seller\/shipping-profile',params:\{storeId:store\?\.id\?\?''\}/,
  );
  assert.equal((sellerHome.match(/onPress=\{openShipping\}/g) ?? []).length, 2);
  assert.match(shipping, /let effectiveStoreId = routeStoreId/);
  assert.match(shipping, /if \(!effectiveStoreId\)[\s\S]*fetchSellerFoundation\(\)/);
  assert.match(shipping, /effectiveStoreId = foundation\.store\?\.id \?\? ""/);
  assert.match(shipping, /fetchMyMarketplaceShippingProfiles\(effectiveStoreId\)/);
});

test("shipping handles no-store, routed edit, profile selection and validated save", () => {
  assert.match(shipping, /Configura tu tienda antes de crear métodos de envío/);
  assert.match(shipping, /router\.push\("\/seller\/store" as never\)/);
  assert.match(shipping, /typeof params\.storeId === "string"/);
  assert.match(shipping, /typeof params\.profileId === "string"/);
  assert.match(shipping, /loadedProfiles\.find/);
  assert.match(shipping, /Tus métodos de envío/);
  assert.match(shipping, /onPress=\{startNewProfile\}/);
  assert.match(shipping, /onPress=\{\(\) => applyProfile\(profile\)\}/);
  assert.match(shipping, /validateShippingSetup\(/);
  assert.match(shipping, /Envío gratis desde \(BDAG, opcional\)/);
  assert.match(shippingSetup, /freeShippingThreshold/);
  assert.match(shippingSetup, /mínimo para envío gratis no puede ser negativo/);
  assert.match(shipping, /upsertMyMarketplaceShippingProfile\(\{/);
  assert.match(shipping, /profileId,\s*storeId,/);
  assert.match(shipping, /regions: rules\.map/);
  assert.match(
    productEditor,
    /pathname: "\/seller\/shipping-profile"[\s\S]*storeId,[\s\S]*profileId: shippingProfileId \?\? ""/,
  );
});

test("seller sales accept only omitted nullable display metadata while required data stays strict", () => {
  assert.match(
    runtimeValidation,
    /rpcNullableString[\s\S]*value === null \? null : rpcNonEmptyString/,
  );
  assert.match(runtimeValidation, /const UUID =[\s\S]*export const rpcUuid/);
  assert.match(fulfillmentParsers, /row\.first_item_title \?\? null/);
  assert.match(fulfillmentParsers, /row\.first_item_image \?\? null/);
  for (const required of [
    "uuid(row.id",
    "uuid(row.store_id",
    "string(row.order_number",
    "enumeration(row.status",
    "number(row.total",
    "integer(row.total_quantity",
  ])
    assert(fulfillmentParsers.includes(required), required);
});

test("seller order RPC, pagination, UI and ownership remain canonical and fail closed", () => {
  const sellerRpc = fulfillment.slice(
    fulfillment.indexOf("export async function fetchSellerOrders"),
    fulfillment.indexOf("async function enrichLifecycle"),
  );
  for (const token of [
    "fetch_my_marketplace_sales",
    "p_status",
    "p_limit",
    "p_before_created_at",
    "p_before_id",
  ])
    assert(sellerRpc.includes(token), token);
  assert.match(fulfillmentParsers, /items\.length === effectiveLimit/);
  assert.match(fulfillmentParsers, /throw new MarketplaceFulfillmentPayloadError/);
  assert.doesNotMatch(sellerRpc, /catch[\s\S]*return\s*\[\]/);
  assert.match(sellerOrders, /fetchSellerOrders/);
  assert.match(sellerOrders, /No pudimos cargar los pedidos/);
  assert.match(sellerOrders, /router\.push\(`\/seller\/orders\/\$\{item\.id\}`/);
  assert.match(sellerOrderDetail, /fetchSellerOrder/);
  assert.match(fulfillment, /fetch_my_marketplace_sale/);

  const salesSql = fulfillmentSql.slice(
    fulfillmentSql.indexOf("create or replace function public.fetch_my_marketplace_sales"),
    fulfillmentSql.indexOf("alter table public.marketplace_order_settlements"),
  );
  assert.match(salesSql, /o\.seller_id=auth\.uid\(\)/);
  assert.match(salesSql, /o\.store_id=v_store/);
  assert.match(salesSql, /c\.status='paid'/);
  assert.doesNotMatch(salesSql, /first_item_title|first_item_image/);
  assert.match(
    fulfillmentSql,
    /grant execute on function[\s\S]*fetch_my_marketplace_sales\(text,integer,timestamptz,uuid\)[\s\S]*to authenticated,service_role/,
  );
});

test("B8D-3 manual-blocker corrective stays intact with Build 22", () => {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(
    migrations.at(-1),
    "20260821010000_marketplace_buyer_dispute_evidence_r1a.sql",
  );
  assert.ok(migrations.includes("20260820010000_fix_marketplace_checkout_order_image_snapshot.sql"));
  assert.ok(migrations.includes("20260817011718_harden_buyer_financial_exposure.sql"));
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
  const changed = store + sellerHome + shipping + fulfillment;
  assert.doesNotMatch(
    changed,
    /service_role|ledger_(credit|debit)|atomic_ledger_transfer|B8D-4/,
  );
});
