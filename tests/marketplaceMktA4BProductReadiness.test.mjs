import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260803030000_fix_mkt_a4b_live_product_readiness.sql",
  "utf8",
);
const bag = fs.readFileSync(
  "components/live/shop/LiveProductBagSheet.tsx",
  "utf8",
);
const layout = fs.readFileSync("app/_layout.tsx", "utf8");
const service = fs.readFileSync("services/liveCommerceService.ts", "utf8");
const manager = fs.readFileSync(
  "components/live/shop/LiveHostShopManager.tsx",
  "utf8",
);
const marketplace = fs.readFileSync("services/marketplaceService.ts", "utf8");

test("modal gesture detector has a flex local root and retains drag close", () => {
  const modal = bag.indexOf("<Modal");
  const root = bag.indexOf("<GestureHandlerRootView", modal);
  const detector = bag.indexOf("<GestureDetector", root);
  const closeRoot = bag.indexOf("</GestureHandlerRootView>", detector);
  assert.ok(modal >= 0 && root > modal && detector > root && closeRoot > detector);
  assert.match(bag, /gestureRoot:\s*\{\s*flex:\s*1/);
  assert.match(bag, /runOnJS\(onClose\)/);
  assert.match(bag, /reducedMotion/);
});

test("application root is gesture-enabled without changing Agora ownership", () => {
  assert.match(layout, /GestureHandlerRootView/);
  assert.doesNotMatch(bag, /Agora|leaveChannel|LiveWatchScreen/);
});

test("readiness contract classifies every required condition", () => {
  for (const reason of [
    "ready", "seller_not_approved", "store_not_active", "product_not_active",
    "product_not_approved", "product_deleted", "unsupported_product_type",
    "unsupported_currency", "no_active_variant", "inventory_not_configured",
    "out_of_stock",
  ]) assert.match(migration, new RegExp(`'${reason}'`));
  assert.match(migration, /marketplace_evaluate_live_product_readiness/);
  assert.match(migration, /readiness\.reason_code/);
});

test("legacy repair is scoped, duplicate-safe, and preserves blocked records", () => {
  assert.match(migration, /not exists\(select 1 from public\.marketplace_product_options/);
  assert.match(migration, /p\.moderation_status='approved'/);
  assert.match(migration, /p\.status='active'/);
  assert.match(migration, /p\.deleted_at is null/);
  assert.match(migration, /on conflict[^;]+do nothing/is);
  assert.doesNotMatch(migration, /update public\.marketplace_(sellers|stores)/i);
  assert.doesNotMatch(migration, /update public\.products\s+set/i);
});

test("host candidate parser and UI preserve precise readiness reasons", () => {
  assert.match(service, /LiveProductReadinessReason/);
  assert.match(service, /readiness_reason_code/);
  assert.match(manager, /Tu cuenta de vendedor todavía no está aprobada/);
  assert.match(manager, /Configura al menos una variante activa/);
  assert.match(manager, /Completa el inventario de este producto/);
});

test("public Shop uses the authoritative readiness RPC", () => {
  assert.match(marketplace, /fetch_marketplace_ready_product_ids/);
  assert.match(migration, /r\.reason_code='ready'/);
});
