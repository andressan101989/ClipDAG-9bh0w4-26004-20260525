import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const schema = read("supabase/migrations/20260803010000_marketplace_mkt_a4b_live_affiliate_commissions.sql");
const settlement = read("supabase/migrations/20260803013000_marketplace_mkt_a4b_creator_settlement.sql");
const hardening = read("supabase/migrations/20260803020000_harden_mkt_a4b_live_commerce.sql");
const service = read("services/liveCommerceService.ts");
const manager = read("components/live/shop/LiveHostShopManager.tsx");
const rail = read("components/live/shop/LiveProductRail.tsx")+read("components/live/commerce/LiveFeaturedProductCard.tsx");
const feed = read("components/live/commerce/LiveHostPurchaseFeed.tsx");
const broadcast = read("app/live/broadcast/[streamId].tsx");
const watch = read("app/live/watch/[streamId].tsx");

test("affiliate allocation and delivery retain authoritative three-way accounting", () => {
  assert.match(schema, /new\.seller_net_amount:=new\.gross_amount-new\.platform_fee_amount-commission/);
  assert.match(settlement, /marketplace_creator_commission_settlement/);
  assert.match(settlement, /gross_amount<>a\.seller_net_amount\+a\.creator_commission_amount\+a\.platform_fee_amount/);
});

test("sanitized realtime schema excludes every internal or personal identifier", () => {
  const safe = hardening.slice(
    hardening.indexOf("create table public.live_commerce_host_purchase_events"),
    hardening.indexOf("create index live_host_purchase_events_session_idx"),
  );
  for (const field of [
    "buyer_id", "checkout_id", "order_id", "order_item_id", "payment_id",
    "allocation_id", "financial_transaction_id", "account_id", "shipping", "phone", "email",
  ]) assert.doesNotMatch(safe, new RegExp(field));
  for (const field of ["buyer_display_name", "product_title", "quantity", "gross_amount", "creator_commission_amount"])
    assert.match(safe, new RegExp(field));
  assert.match(hardening, /alter publication supabase_realtime drop table public\.live_commerce_purchase_events/);
  assert.match(hardening, /alter publication supabase_realtime add table public\.live_commerce_host_purchase_events/);
});

test("safe events are host-only, immutable, and mirrored idempotently", () => {
  assert.match(hardening, /using \(host_id = auth\.uid\(\)\)/);
  assert.match(hardening, /revoke all on public\.live_commerce_host_purchase_events from public, anon, authenticated/);
  assert.match(hardening, /on conflict \(id\) do nothing/);
  assert.match(hardening, /live_host_purchase_event_immutable/);
});

test("affiliate offer commands bind idempotency keys to complete fingerprints", () => {
  for (const marker of ["marketplace_live_affiliate_offer_commands", "idempotency_key", "request_fingerprint", "result_json", "p_starts_at", "p_ends_at"])
    assert.match(hardening, new RegExp(marker));
  assert.match(hardening, /live_affiliate_offer_idempotency_conflict/);
  assert.match(hardening, /pg_advisory_xact_lock/);
  assert.match(service, /upsertMyLiveAffiliateOffer/);
});

test("revoked or expired affiliate offers block only new reservations", () => {
  for (const condition of ["o.status = 'active'", "o.starts_at is null or o.starts_at <= now", "o.ends_at is null or o.ends_at > now", "o.commission_bps = lp.creator_commission_bps"])
    assert.match(hardening, new RegExp(condition.replace(/[()]/g, "\\$&")));
  assert.match(hardening, /live_affiliate_offer_unavailable/);
  assert.match(service, /affiliate_offer_unavailable/);
  assert.doesNotMatch(hardening, /update public\.marketplace_checkouts[\s\S]*affiliate_offer_unavailable/);
});

test("authoritative stats are unlimited and allocation-status aware", () => {
  const rpc = hardening.slice(hardening.indexOf("create or replace function public.fetch_my_live_shop_stats"));
  assert.doesNotMatch(rpc, /limit\s+(50|100)/i);
  for (const key of ["orders_count", "gross_sales", "creator_commission_held", "creator_commission_released", "units_sold"])
    assert.match(rpc, new RegExp(key));
  assert.match(feed, /fetchMyLiveShopStats/);
  assert.doesNotMatch(feed, /events\.length|reduce\(/);
});

test("premium manager and rails preserve affiliate and role-specific behavior", () => {
  assert.match(manager, /Producto propio/);
  assert.match(manager, /Producto afiliado/);
  assert.match(manager, /creatorCommissionBps/);
  assert.match(rail, /mode === "host" \? "Gestionar" : "Comprar"/);
  assert.match(broadcast, /LiveProductRail/);
  assert.match(watch, /LiveProductRail/);
  assert.doesNotMatch(broadcast, /LiveFeaturedProductCard/);
  assert.doesNotMatch(watch, /LiveFeaturedProductCard/);
});

test("purchase feed de-duplicates realtime and polling events before queuing", () => {
  const enqueue = (seen, queue, event) => {
    if (seen.has(event.id)) return queue;
    seen.add(event.id);
    return [...queue, event].slice(-3);
  };
  const seen = new Set();
  let queue = enqueue(seen, [], { id: "purchase-1" });
  queue = enqueue(seen, queue, { id: "purchase-1" });
  assert.deepEqual(queue.map(({ id }) => id), ["purchase-1"]);
  assert.match(feed, /live_commerce_host_purchase_events/);
  assert.match(feed, /seen\.current\.has/);
  assert.match(feed, /LivePurchaseToastQueue/);
  assert.doesNotMatch(feed, /Haptics/);
});

test("integration does not introduce prohibited payment paths", () => {
  for (const text of [hardening, service, manager, rail, feed])
    assert.doesNotMatch(text, /USDT|WalletConnect|blockchain|external payout|refund|dispute/i);
});
