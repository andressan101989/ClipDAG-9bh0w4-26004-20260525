import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20260803023000_fix_mkt_a4b_affiliate_pin_lifecycle.sql",
);
const service = read("services/liveCommerceService.ts");
const manager = read("components/live/shop/LiveHostShopManager.tsx");
const viewer = read("components/live/commerce/LiveViewerCommerce.tsx");

test("host candidates unite own, current affiliate, and every active pinned product", () => {
  const universe = migration.slice(
    migration.indexOf("universe as"),
    migration.indexOf("candidate_rows as"),
  );
  assert.match(universe, /product\.seller_id = context_row\.host_id/);
  assert.match(universe, /select offer\.product_id from current_offers/);
  assert.match(universe, /select pin\.product_id from active_pins/);
  assert.match(migration, /union[\s\S]*union/);
});

test("paused removed and expired pins remain removable but cannot be featured", () => {
  for (const state of [
    "affiliate_offer_unavailable",
    "affiliate_offer_replaced",
  ])
    assert.match(migration, new RegExp(state));
  assert.match(manager, /invalidPinnedOffer/);
  assert.match(manager, /label=\{item\.isPinned \? "Quitar" : "Agregar"\}/);
  assert.match(manager, /canFeature/);
  assert.match(manager, /item\.pinOfferValid/);
  assert.match(migration, /marketplace_live_affiliate_pin_is_valid/);
});

test("replaced offers keep pinned and current commission snapshots separate", () => {
  for (const field of [
    "pinned_creator_commission_bps",
    "current_offer_commission_bps",
    "current_offer_id",
    "pinned_offer_id",
    "requires_repin",
  ]) {
    assert.match(migration, new RegExp(field));
    assert.match(service, new RegExp(field.replaceAll("_", ""), "i"));
  }
  assert.match(manager, /Comisión fijada/);
  assert.match(manager, /Oferta\s+nueva/);
  assert.match(manager, /Quita y vuelve a agregar/);
});

test("candidate cursor remains strict, limit-plus-one, unique, and final-null", () => {
  assert.match(
    migration,
    /\(product\.updated_at, product\.id\) < \(p_before_updated_at, p_before_id\)/,
  );
  assert.match(migration, /limit page_limit \+ 1/);
  assert.match(
    migration,
    /row_number\(\) over \(order by updated_at desc, id desc\)/,
  );
  assert.match(migration, /case when coalesce\(has_more, false\)/);
  const paginate = (rows, limit) => {
    const page = rows.slice(0, limit);
    return {
      items: page,
      next: rows.length > limit ? page.at(-1) : null,
    };
  };
  const rows = Array.from({ length: 53 }, (_, index) => ({ id: 53 - index }));
  const first = paginate(rows, 50);
  const last = paginate(rows.slice(50), 50);
  assert.equal(
    new Set([...first.items, ...last.items].map(({ id }) => id)).size,
    53,
  );
  assert.equal(first.next.id, 4);
  assert.equal(last.next, null);
});

test("service strictly parses lifecycle fields without own-product fallback", () => {
  for (const field of [
    "sellerName",
    "candidateAvailability",
    "pinOfferValid",
    "pinnedCreatorCommissionBps",
    "currentOfferCommissionBps",
    "currentOfferId",
    "pinnedOfferId",
    "requiresRepin",
  ])
    assert.match(service, new RegExp(field));
  assert.match(service, /typeof r\.pin_offer_valid !== "boolean"/);
  assert.match(service, /affiliate_offer_replaced/);
});

test("affiliate host and seller self-purchases are rejected before reservation", () => {
  const reservation = migration.slice(
    migration.indexOf(
      "create or replace function public.create_live_marketplace_checkout_reservation",
    ),
    migration.indexOf("insert into public.live_commerce_host_purchase_events"),
  );
  assert.match(reservation, /auth\.uid\(\) = live_row\.host_id/);
  assert.match(reservation, /live_affiliate_self_purchase_forbidden/);
  assert.match(reservation, /auth\.uid\(\) = pin\.seller_id/);
  assert.match(reservation, /marketplace_own_product_forbidden/);
  assert.ok(
    reservation.indexOf("live_affiliate_self_purchase_forbidden") <
      reservation.indexOf("create_marketplace_checkout_reservation("),
  );
});

test("viewer renders exact lifecycle business errors and refreshes the bag", () => {
  assert.match(viewer, /La oferta de este creador ya no está disponible\./);
  assert.match(
    viewer,
    /No puedes generar una comisión comprando desde tu propio LIVE\./,
  );
  assert.match(viewer, /await onRefresh\(\)/);
  assert.match(viewer, /setStage\("bag"\)/);
  assert.match(service, /live_affiliate_self_purchase_forbidden/);
});

test("safe event backfill is sanitized and idempotent without financial writes", () => {
  const backfill = migration.slice(
    migration.indexOf("insert into public.live_commerce_host_purchase_events"),
  );
  assert.match(backfill, /marketplace_safe_public_image_url/);
  assert.match(backfill, /on conflict \(id\) do nothing/);
  for (const forbidden of [
    "shipping_address",
    "phone",
    "email",
    "financial_transactions",
    "ledger_entries",
    "marketplace_payment_allocations set",
    "marketplace_inventory_levels set",
  ])
    assert.doesNotMatch(backfill, new RegExp(forbidden));
});

test("existing reservations remain payable through immutable snapshots", () => {
  const reservation = migration.slice(
    migration.indexOf(
      "create or replace function public.create_live_marketplace_checkout_reservation",
    ),
    migration.indexOf("insert into public.live_commerce_host_purchase_events"),
  );
  assert.doesNotMatch(
    migration,
    /update public\.marketplace_live_order_sources/,
  );
  assert.doesNotMatch(
    migration,
    /update public\.marketplace_payment_allocations/,
  );
  assert.doesNotMatch(reservation, /marketplace_checkout_pay/);
});
