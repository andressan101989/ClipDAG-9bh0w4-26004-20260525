import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMarketplaceCartItem } from "../services/marketplaceCart.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260811022000_marketplace_creator_product_showcase.sql");
const hardeningSql = read("supabase/migrations/20260811023000_harden_marketplace_creator_showcase_capacity.sql");
const service = read("services/marketplaceCreatorShowcaseService.ts");
const product = read("app/product/[id].tsx");
const checkout = read("app/checkout.tsx");
const publicProfile = read("app/creator/[id].tsx");
const ownProfile = read("app/(tabs)/profile.tsx");
const management = read("app/creator-showcase.tsx");

const base = {
  productId: "product-a",
  variantId: "variant-a",
  sellerId: "seller-a",
  storeId: "store-a",
  title: "Product A",
  sellerUsername: "seller",
  sku: "A",
  imageUrl: null,
  options: [],
  currency: "BDAG",
  unitPrice: 10,
  compareAtPrice: null,
  quantity: 1,
  availableQuantitySnapshot: 10,
  productUpdatedAt: null,
};

test("B7B schema is normalized, constrained, private-write, and extends only B7A source vocabulary", () => {
  assert.match(sql, /create table public\.marketplace_creator_showcase_items/);
  assert.match(sql, /unique index marketplace_creator_showcase_active_product_unique/);
  assert.match(sql, /check\(source_surface in\('live','direct_creator_link','creator_showcase'\)\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.marketplace_creator_showcase_items[\s\S]*from public,anon,authenticated/);
  assert.doesNotMatch(sql, /fixture_ops|test_fail|test guc|commission_amount\s+uuid/i);
  assert.match(hardeningSql, /marketplace_creator_showcase_limit_reached/);
  assert.match(hardeningSql, /active_showcase_over_limit/);
  assert.doesNotMatch(hardeningSql, /fixture_ops|test_fail|debug|mock|test guc|commission_amount|p_commission_bps/i);
});

test("showcase management and attribution derive current seller offer without client BPS", () => {
  for (const name of [
    "get_my_marketplace_creator_eligible_products",
    "add_my_marketplace_creator_showcase_product",
    "remove_my_marketplace_creator_showcase_product",
    "reorder_my_marketplace_creator_showcase",
    "get_marketplace_creator_showcase",
    "create_marketplace_creator_showcase_attribution",
    "reconcile_marketplace_creator_showcase",
  ]) assert.match(sql, new RegExp(name));
  assert.match(sql, /marketplace_resolve_live_affiliate_offer\(v_item\.product_id,v_item\.creator_user_id\)/);
  assert.match(sql, /marketplace_create_creator_commerce_attribution_internal\(v_offer\.offer_id/);
  assert.doesNotMatch(service, /p_commission_bps|p_commission_amount|seller_net|platform_fee/);
});

test("creator management and public profile reuse canonical product detail", () => {
  assert.match(ownProfile, /Creator Showcase/);
  assert.match(ownProfile, /\/creator-showcase/);
  assert.match(management, /fetchMyCreatorEligibleProducts/);
  assert.match(management, /reorderMyCreatorShowcase/);
  assert.match(publicProfile, /fetchCreatorShowcase/);
  assert.match(publicProfile, /pathname: '\/product\/\[id\]'/);
  assert.match(publicProfile, /showcaseItemId/);
  assert.match(management, /marketplace_creator_showcase_limit_reached/);
  assert.match(management, /hasta 100 productos/);
});

test("public showcase paginates explicitly, deduplicates overlaps, and clears inaccessible data", () => {
  assert.match(publicProfile, /showcaseNextCursor/);
  assert.match(publicProfile, /showcaseLoadingMore/);
  assert.match(publicProfile, /showcaseLoadMoreRef\.current/);
  assert.match(publicProfile, /fetchCreatorShowcase\(creatorId, showcaseNextCursor\)/);
  assert.match(publicProfile, /new Map\(current\.map\(item => \[item\.showcaseItemId, item\]\)\)/);
  assert.match(publicProfile, /page\.visible === false[\s\S]*setShowcase\(\[\]\)[\s\S]*setShowcaseNextCursor\(null\)/);
  assert.match(publicProfile, /showcaseNextCursor \? \([\s\S]*Ver más/);
  assert.match(publicProfile, /setShowcase\(showcasePage\.visible === false \? \[\] : showcasePage\.items\)/);
});

test("product detail creates opaque attribution only for explicit cart or buy-now action", () => {
  assert.match(product, /createCreatorShowcaseAttribution\(\s*showcaseItemId,\s*selectedVariant\.id,\s*key,?\s*\)/);
  assert.match(product, /attributionId: receipt\.id/);
  assert.match(product, /handleAddToCart\(true\)/);
  assert.match(product, /Comprar ahora/);
  assert.doesNotMatch(product, /commissionBps|commissionAmount|commission_amount/);
});

test("normal cart items merge and stay attribution free", () => {
  const first = addMarketplaceCartItem([], base, "2026-08-12T00:00:00Z");
  assert.equal(first.result.ok, true);
  const second = addMarketplaceCartItem(first.items, { ...base, quantity: 2 }, "2026-08-12T00:01:00Z");
  assert.equal(second.result.ok, true);
  assert.equal(second.items[0].quantity, 3);
  assert.equal(second.items[0].attributionId, undefined);
});

test("only the same exact opaque attribution ID merges quantities", () => {
  const attributed = { ...base, attributionId: "attr-a", showcaseItemId: "showcase-a", creatorUserId: "creator-a", creatorDisplayName: "creator" };
  const first = addMarketplaceCartItem([], attributed);
  const second = addMarketplaceCartItem(first.items, { ...attributed, quantity: 2 });
  assert.equal(second.result.ok, true);
  assert.equal(second.items[0].quantity, 3);
  assert.equal(second.items[0].attributionId, "attr-a");
});

test("different token conflicts even for the same showcase and creator", () => {
  const first = addMarketplaceCartItem([], { ...base, attributionId: "attr-a", showcaseItemId: "showcase-a", creatorUserId: "creator-a" });
  const sameCreatorConflict = addMarketplaceCartItem(first.items, { ...base, quantity: 2, attributionId: "attr-fresh", showcaseItemId: "showcase-a", creatorUserId: "creator-a" });
  assert.deepEqual(sameCreatorConflict.result, { ok: false, code: "attribution_conflict" });
  assert.equal(sameCreatorConflict.items[0].quantity, 1);
  assert.equal(sameCreatorConflict.items[0].attributionId, "attr-a");

  const conflict = addMarketplaceCartItem(first.items, { ...base, attributionId: "attr-b", showcaseItemId: "showcase-b", creatorUserId: "creator-b" });
  assert.deepEqual(conflict.result, { ok: false, code: "attribution_conflict" });
  assert.equal(conflict.items[0].attributionId, "attr-a");

  const unattributedFirst = addMarketplaceCartItem([], base);
  const claimed = addMarketplaceCartItem(unattributedFirst.items, { ...base, attributionId: "attr-a", showcaseItemId: "showcase-a", creatorUserId: "creator-a" });
  assert.deepEqual(claimed.result, { ok: false, code: "attribution_conflict" });
  assert.equal(claimed.items[0].attributionId, undefined);
});

test("normal repeat of an attributed line preserves creator credit", () => {
  const attributed = { ...base, attributionId: "attr-a", showcaseItemId: "showcase-a", creatorUserId: "creator-a" };
  const first = addMarketplaceCartItem([], attributed);
  const repeated = addMarketplaceCartItem(first.items, { ...base, quantity: 2 });
  assert.equal(repeated.result.ok, true);
  assert.equal(repeated.items[0].quantity, 3);
  assert.equal(repeated.items[0].attributionId, "attr-a");
  assert.equal(repeated.items[0].showcaseItemId, "showcase-a");
  assert.equal(repeated.items[0].creatorUserId, "creator-a");
});

test("checkout selects creator-aware RPC only when one or more items carry attribution", () => {
  assert.match(checkout, /some\(item=>Boolean\(item\.attributionId\)\)/);
  assert.match(checkout, /hasCreatorAttribution\?createCreatorCheckoutReservation:createCheckoutReservation/);
  assert.match(checkout, /attributionId:item\.attributionId/);
});
