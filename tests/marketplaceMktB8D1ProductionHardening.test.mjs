import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migrationPath = "supabase/migrations/20260811033000_marketplace_production_hardening.sql";
const migration = read(migrationPath);
const bootstrap = read("scripts/create-marketplace-disposable-db.mjs");
const auditor = read("scripts/audit-marketplace-b8d-integral.mjs");
const proof = read("scripts/prove-marketplace-production-hardening.mjs");
const validator = read("services/marketplaceRuntimeValidation.ts");
const product = read("services/marketplaceService.ts");
const promotion = read("services/marketplacePromotionService.ts");
const shipping = read("services/marketplaceShippingService.ts");
const draft = read("services/marketplaceProductDraftService.ts");
const settlement = read("services/marketplaceSettlementService.ts");
const payment = read("services/marketplacePaymentService.ts");
const showcase = read("services/marketplaceCreatorShowcaseService.ts");
const cursorCollection = read("services/marketplaceCursorCollection.ts");
const shopContext = read("contexts/ShopContext.tsx");
const productScreen = read("app/seller/products.tsx");
const promotionScreen = read("app/seller/promotions.tsx");
const editorScreen = read("app/seller/product-editor/[productId].tsx");
const compatibilityTests = read("tests/marketplaceMobileContractCompatibility.test.mjs");
const mobile = [product, promotion, shipping, draft, settlement, read("services/marketplaceAdsService.ts"), read("services/marketplacePaymentService.ts"), read("services/marketplaceOrderService.ts"), read("services/marketplaceFulfillmentService.ts"), read("services/marketplaceCreatorAnalyticsService.ts"),read("services/marketplaceAnalyticsService.ts"),read("services/marketplaceCreatorShowcaseService.ts"),read("services/marketplaceCreatorContentTagService.ts")].join("\n");

test("B8D-1H is one forward-only migration after the frozen B8C closure", () => {
  assert.ok(existsSync(join(root, migrationPath)));
  assert.match(migration, /^-- MKT-B8D-1H/);
  assert.ok(existsSync(join(root, "supabase/migrations/20260811032000_marketplace_admin_intelligence_closure.sql")));
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
});

test("schema and postgres default privileges require explicit browser grants", () => {
  assert.match(migration, /revoke create on schema public from public, anon, authenticated, authenticator, service_role/i);
  for (const kind of ["tables", "sequences", "functions"]) assert.match(migration, new RegExp(`alter default privileges for role postgres in schema public[\\s\\S]*?${kind}`, "i"));
  assert.match(migration, /revoke references, trigger, truncate on table public\.marketplace_product_promotions/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|truncate|trigger|references)\s+on\s+(all\s+)?tables?.*\b(anon|authenticated)\b/i);
  assert.match(bootstrap, /revoke create on schema public from public,anon,authenticated,authenticator,service_role/i);
});

test("all four audited limits have explicit NULL-safe contracts", () => {
  for (const name of ["expire_marketplace_checkout_reservations", "fetch_marketplace_sponsored_products", "fetch_marketplace_sponsored_products_v2", "fetch_my_marketplace_ad_campaigns"]) assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  assert.match(migration, /if p_limit is null or p_limit<1 or p_limit>100/i);
  assert.ok((migration.match(/coalesce\(p_limit,/gi) ?? []).length >= 3);
  assert.match(proof, /default=100;1\/100 accepted;NULL\/0\/101=22023/);
});

test("seller-owned lists use bounded keyset v2 RPCs and compatibility wrappers", () => {
  for (const name of ["fetch_my_marketplace_products_v2", "list_my_marketplace_promotions_v2", "fetch_my_marketplace_shipping_profiles_v2"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  }
  assert.ok((migration.match(/p_limit is null or p_limit<1 or p_limit>100/gi) ?? []).length >= 3);
  assert.match(migration, /\(p\.updated_at,p\.id\)<\(p_cursor_updated_at,p_cursor_product_id\)/i);
  assert.match(migration, /\(p\.created_at,p\.id\)<\(p_cursor_created_at,p_cursor_promotion_id\)/i);
  assert.match(migration, /\(p\.created_at,p\.id\)>\(p_cursor_created_at,p_cursor_profile_id\)/i);
  assert.doesNotMatch(migration, /\boffset\b/i);
  assert.match(migration, /fetch_my_marketplace_products_v2\(null,null,100\)->'items'/i);
  assert.match(product, /rpc\(["']fetch_my_marketplace_products_v2["']/);
  assert.match(promotion, /rpc\(["']list_my_marketplace_promotions_v2["']/);
  assert.match(shipping, /rpc\(["']fetch_my_marketplace_shipping_profiles_v2["']/);
  assert.doesNotMatch(product, /rpc\('fetch_my_marketplace_products'\s*[,)]/);
});

test("superseded creator v1 is no longer an authenticated contract", () => {
  assert.match(migration, /revoke all on function public\.search_marketplace_admin_creators\([\s\S]*?from public,anon,authenticated,service_role/i);
  assert.match(migration, /grant execute on function public\.search_marketplace_admin_creators\([\s\S]*?to service_role/i);
  assert.match(migration, /grant execute on function public\.search_marketplace_admin_creators_v2\([\s\S]*?to authenticated,service_role/i);
  assert.match(proof, /ordinary_denied: true, protected_admin_allowed: true/);
});

test("mobile RPC payloads are validated without client financial authority", () => {
  for (const helper of ["rpcObject", "rpcArray", "rpcUuid", "rpcNonnegative", "rpcNonnegativeInteger", "rpcTimestamp", "rpcEnum", "rpcCursorPage"]) assert.match(validator, new RegExp(`export const ${helper}`));
  for (const service of ["marketplaceAdsService", "marketplacePromotionService", "marketplaceService", "marketplaceShippingService", "marketplacePaymentService", "marketplaceOrderService", "marketplaceFulfillmentService", "marketplaceCreatorAnalyticsService"]) assert.ok(mobile.includes("marketplaceRuntimeValidation"), service);
  assert.doesNotMatch(mobile, /rows<[^>]+>\(data\)/);
  assert.doesNotMatch(migration + mobile, /set_balance|adjust_wallet|repair_ledger|p_(seller_payout|creator_bps|platform_fee|ledger_account)/i);
});

test("C1 mobile contracts preserve canonical digital and empty-description payloads",()=>{
  assert.match(product,/product_type:\s*"physical"\s*\|\s*"digital"/);
  assert.match(product,/\["physical", "digital"\] as const,[\s\S]*?"product\.product_type"/);
  assert.match(product,/description:\s*rpcText\(row\.description/);
  assert.match(draft,/rpcEnum\(\s*p\.product_type,\s*\["physical", "digital"\]/);
  assert.doesNotMatch(draft,/p\.product_type === "digital" \? "digital" : "physical"/);
  assert.match(draft,/description:\s*rpcText\(p\.description/);
  assert.match(compatibilityTests,/canonical physical\/digital products and empty descriptions are accepted/);
});

test("C1 private inventory and settlement boundaries are deeply parsed",()=>{
  for(const field of["seller_inventory.detail.options","seller_inventory.inventory","seller_inventory.movements","seller_inventory.media_assets"])assert.ok(product.includes(field),field);
  for(const parser of["parseMarketplaceSettlementReceipt","parseMarketplaceProblemReceipt","parseSupportMarketplaceDispute","parseMarketplaceDisputeResolution","validateFinancialResult"])assert.ok(settlement.includes(parser),parser);
  assert.doesNotMatch(settlement,/const (amount|resolutionAmount)=.*Number\(/);
  assert.match(compatibilityTests,/valid settlement and dispute financial receipts are accepted/);
});

test("C1 official seller flows consume continuation cursors while legacy wrappers stay bounded",()=>{
  assert.match(shopContext,/fetchMoreMyProducts/);assert.match(productScreen,/onEndReached/);
  assert.match(promotionScreen,/listMyMarketplacePromotionsPage/);assert.match(promotionScreen,/loadMorePromotions/);assert.match(promotionScreen,/loadMoreProducts/);
  assert.match(editorScreen,/fetchMyMarketplaceShippingProfilesPage/);assert.match(editorScreen,/loadMoreShippingProfiles/);
  assert.match(cursorCollection,/new Map/);assert.match(cursorCollection,/reset \? \[\]/);
  assert.match(product,/fetchMyProductsPage\(null,\s*100\)/);assert.match(promotion,/listMyMarketplacePromotionsPage\(null,\s*100\)/);assert.match(shipping,/fetchMyMarketplaceShippingProfilesPage\(storeId,\s*null,\s*100\)/);
  assert.match(compatibilityTests,/reaches rows beyond 100, dedupes, resets, and stops terminally/);
});

test("C2 Edge envelopes, balance, publication and table reads fail closed",()=>{
  for(const source of[payment,settlement]){
    assert.match(source,/rpcBoolean\([^,]+\.success,/);
    assert.doesNotMatch(source,/if\s*\(!data\?\.success\)/);
  }
  assert.doesNotMatch(payment,/finite\(data\s*\?\?\s*0\)/);
  assert.match(payment,/rpcEnum\(order\.status,paymentOrderStatuses/);
  assert.match(product,/rpcBoolean\(receipt\.published,[\s\S]*?\)\s*!==\s*true/);
  assert.doesNotMatch(product,/as MarketplaceCategoryRecord\[\]/);
  assert.doesNotMatch(product,/seller:\s*seller as MarketplaceSeller/);
  assert.doesNotMatch(product,/store:\s*store as MarketplaceStore/);
  for(const parser of["parseMarketplaceCategoryRecord","parseMarketplaceSeller","parseMarketplaceStore"])
    assert.ok(product.includes(parser),parser);
  assert.match(showcase,/rpcBoundedInteger\([\s\S]*?1,[\s\S]*?3000/);
  for(const phrase of["payment Edge envelope","settlement and support Edge envelopes","publication, categories, and seller foundation"])
    assert.ok(compatibilityTests.includes(phrase),phrase);
});

test("C2 remained client-only and later authorized correctives add no client economic authority",()=>{
  const later=readdirSync(join(root,"supabase/migrations")).filter((name)=>name>"20260811033000_marketplace_production_hardening.sql");
  assert.equal(later.pop(),"20260824034049_live_battles_lb2_f1_session_liveness.sql");
  assert.equal(later.pop(),"20260824025639_live_battles_lb2_state_machine.sql");
  assert.equal(later.pop(),"20260824014644_live_lb1_fix_agora_uid_lint.sql");
  assert.equal(later.pop(),"20260823223420_live_lb1_canonical_authority.sql");
  assert.equal(later.pop(),"20260823175849_marketplace_refund_reconciliation_r2b4_f3.sql");
  assert.deepEqual(later,["20260811034000_marketplace_verified_reviews_branding.sql","20260816010000_marketplace_admin_dispute_resolution_authority.sql","20260816020000_marketplace_buyer_purchase_history.sql","20260816021000_fix_marketplace_buyer_purchase_history_paid_evidence.sql","20260816022000_marketplace_seller_purchase_history.sql","20260817011224_harden_financial_security_definer_functions.sql","20260817011718_harden_buyer_financial_exposure.sql","20260820010000_fix_marketplace_checkout_order_image_snapshot.sql","20260821010000_marketplace_buyer_dispute_evidence_r1a.sql","20260821020000_marketplace_seller_dispute_defense_r1b.sql","20260822010000_marketplace_admin_dispute_evidence_r1c.sql","20260822020000_marketplace_post_reject_release_r1c_f1.sql","20260822030000_marketplace_admin_settlement_reconciliation_r1c_f1a.sql","20260822040000_marketplace_admin_release_readback_r1c_f1b.sql","20260822154610_marketplace_seller_dispute_awareness_r1c_f1c1.sql","20260822165852_marketplace_post_settlement_returns_r2a.sql","20260822221008_marketplace_post_settlement_delivery_ack_r2a_f1.sql","20260822231419_marketplace_seller_return_awareness_r2a_f2.sql","20260823010220_marketplace_return_reverse_escrow_r2b1.sql","20260823023725_marketplace_return_shipping_r2b2.sql","20260823042737_marketplace_return_label_and_keep_item_refund_r2b3.sql","20260823043212_marketplace_return_legacy_shipment_reconciliation_r2b3_f1.sql","20260823055013_marketplace_return_received_refund_r2b4.sql","20260823161526_marketplace_return_seller_attention_r2b4_f1.sql"]);
  assert.doesNotMatch(payment+settlement+product+showcase,/set_balance|adjust_wallet|repair_ledger|p_(seller_payout|creator_bps|platform_fee|ledger_account)/i);
});

test("proof and auditor are read-only remotely and B8D-3/4 were not started", () => {
  assert.match(proof, /B8D1H_PROOF_REQUIRES_DISPOSABLE_DATABASE/);
  assert.match(proof, /rollback/);
  assert.match(auditor, /read_only: true/);
  assert.doesNotMatch(auditor, /db\.query\(["'`]\s*(insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(auditor, /supabase\s+db\s+push/i);
  assert.doesNotMatch(migration + mobile, /B8D-2|B8D-3|B8D-4|LIVE Battles/i);
});
