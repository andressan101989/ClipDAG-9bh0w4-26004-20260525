import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20260811026000_marketplace_live_creator_commerce_v2.sql",
);
const service = read("services/liveCommerceService.ts");
const product = read("app/product/[id].tsx");
const cart = read("services/marketplaceCart.ts");
const viewer = read("components/live/commerce/LiveViewerCommerce.tsx");
const quickView = read("components/live/shop/LiveProductQuickView.tsx");
const host = read("components/live/shop/LiveHostShopManager.tsx");
const watch = read("app/live/watch/[streamId].tsx");
const broadcast = read("app/live/broadcast/[streamId].tsx");
const analytics = read(
  "supabase/migrations/20260811025000_marketplace_creator_commerce_analytics.sql",
);
const proof = read("scripts/prove-marketplace-live-creator-commerce-v2.mjs");

test("B7E adds only a buyer-safe B7A LIVE handoff", () => {
  assert.match(
    migration,
    /create or replace function public\.create_marketplace_creator_live_attribution\(\s*p_live_session_product_id uuid,\s*p_variant_id uuid,\s*p_idempotency_key uuid/s,
  );
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /v_pin\.status <> 'active'/);
  assert.match(migration, /v_session\.status <> 'live'/);
  assert.match(
    migration,
    /marketplace_create_creator_commerce_attribution_internal\(\s*v_pin\.affiliate_offer_id,\s*v_pin\.host_id,\s*p_variant_id,\s*'live',\s*v_pin\.id/s,
  );
  assert.match(
    migration,
    /v_pin\.commerce_mode = 'own_product'[\s\S]*'id', null[\s\S]*'creator_user_id', null/,
  );
  assert.doesNotMatch(
    migration,
    /p_(?:creator|seller|store|commission|bps|amount)/,
  );
  assert.doesNotMatch(
    migration,
    /ledger_(?:debit|credit)|marketplace_settlement_legs|commission_amount\s*:=/,
  );
});

test("B7E highlight switching clears before setting the next featured pin", () => {
  const clear = migration.indexOf("set is_featured = false");
  const set = migration.indexOf("set is_featured = true");
  assert(clear > 0 && set > clear);
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtextextended\('live-feature:' \|\| p_session_id/,
  );
  assert.match(migration, /live_commerce_commands/);
  assert.match(migration, /marketplace_evaluate_live_product_readiness/);
});

test("product detail creates LIVE attribution only on explicit Add or Buy", () => {
  assert.match(product, /liveSessionProductId\?: string/);
  assert.match(product, /createLiveCreatorAttribution/);
  const handler = product.slice(
    product.indexOf("const handleAddToCart"),
    product.indexOf("const chooseVariantValue"),
  );
  assert.match(handler, /createLiveCreatorAttribution\(\s*liveSessionProductId/);
  const passiveEffects = product.slice(0, product.indexOf("const handleAddToCart"));
  assert.doesNotMatch(passiveEffects, /createLiveCreatorAttribution\(/);
  assert.match(
    handler,
    /(?:\[\s*showcaseItemId,\s*contentProductTagId,\s*liveSessionProductId,?\s*\]\.filter\(Boolean\)\.length|creatorContextCount)/,
  );
  assert.match(handler, /receipt\.id\s*&&\s*receipt\.creatorUserId/);
});

test("LIVE attribution is an opaque exact-token cart context", () => {
  assert.match(cart, /liveSessionProductId\?: string/);
  assert.match(cart, /sourceSurface\?: "feed" \| "reel" \| "live"/);
  assert.match(
    cart,
    /current\.attributionId === input\.attributionId/,
  );
  assert.match(
    cart,
    /current\?\.attributionId && input\.attributionId && !sameAttribution[\s\S]*attribution_conflict/,
  );
  assert.match(
    cart,
    /input\.liveSessionProductId[\s\S]*input\.sourceSurface !== "live"/,
  );
  assert.doesNotMatch(cart, /commission(?:Bps|Amount)|creatorCommission/);
});

test("viewer LIVE commerce records B3 context and offers the shared cart route", () => {
  assert.match(viewer, /recordProductView/);
  assert.match(viewer, /recordCheckoutStarted/);
  assert.match(viewer, /type: "live"/);
  assert.match(viewer, /entityId: item\.id/);
  assert.match(viewer, /liveSessionProductId: pin\.id/);
  assert.match(viewer, /pathname: "\/product\/\[id\]"/);
  assert.match(quickView, /Ver detalles o agregar al carrito/);
  assert.match(service, /create_marketplace_creator_live_attribution/);
  assert.match(service, /p_live_session_product_id: uuid\(pinId\)/);
});

test("existing compact host and viewer shelf architecture remains bounded", () => {
  assert.match(host, /const PAGE_SIZE = 20/);
  assert.match(host, /\{pinnedCount\}\/20 productos activos/);
  assert.match(host, /FlatList/);
  assert.match(host, /fetchMyLiveProductCandidates/);
  assert.match(watch, /live-commerce:\$\{streamId\}/);
  assert.match(broadcast, /live-commerce-host:\$\{streamId\}/);
  assert.match(watch, /removeChannel\(channel\)/);
  assert.match(broadcast, /removeChannel\(channel\)/);
});

test("B3 and B7D reuse exact LIVE pin identity", () => {
  assert.match(
    analytics,
    /join public\.live_session_products p on\s*e\.source_type='live'/,
  );
  assert.match(analytics, /p\.id=e\.source_entity_id/);
  assert.match(analytics, /p\.product_id=e\.product_id/);
  assert.match(analytics, /p\.commerce_mode='affiliate_product'/);
});

test("runtime proof executes financial, security, and two-connection gates", () => {
  for (const marker of [
    "ownProductNoAffiliate",
    "passiveViewNonFinancial",
    "explicitAttribution",
    "revokedOfferRejected",
    "offerChangeRequiresRepin",
    "ordinaryItemExcluded",
    "b7dLiveAnalytics",
    "multiSurface",
    "liveCreatorItems",
    "pinRace",
    "singleHighlightRace",
    "inventoryFinalStockRace",
    "offerRevocationAttributionRace",
    "unpinAttributionRace",
    "endLiveMutationRace",
    "noOversell",
    "noDeadlocks",
    "noPartialState",
  ]) {
    assert.match(proof, new RegExp(marker));
  }
  assert.match(proof, /new Client\(\{ connectionString, ssl: false \}\)/);
  assert.match(proof, /Promise\.allSettled/);
  assert.match(proof, /B7E_PROOF_REQUIRES_DISPOSABLE_DATABASE/);
});

test("B7E does not introduce B8 or a parallel financial authority", () => {
  const combined = [migration, service, product, viewer, quickView].join("\n");
  assert.doesNotMatch(combined, /B8|ops_admin|admin_marketplace/i);
  assert.doesNotMatch(
    combined,
    /insert into public\.marketplace_(?:payments|settlement_legs|order_item_creator_allocations)/i,
  );
});
