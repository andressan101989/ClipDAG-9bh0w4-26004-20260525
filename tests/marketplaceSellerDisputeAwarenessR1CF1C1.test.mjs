import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseMarketplaceOrderDetailPayload,
  parseSellerDisputeIndexPayload,
  parseSellerOrderListPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";
import { marketplaceOrderTimelineItems } from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260822154610_marketplace_seller_dispute_awareness_r1c_f1c1.sql");
const service = read("services/marketplaceFulfillmentService.ts");
const orders = read("app/seller/orders/index.tsx");
const home = read("app/seller/index.tsx");
const inbox = read("app/seller/disputes/index.tsx");
const detail = read("app/seller/orders/[id].tsx");
const timeline = read("components/marketplace/OrderStatus.tsx");
const at = "2026-08-22T13:40:06.676Z";
const ids = {
  order: "11111111-1111-4111-8111-111111111111",
  checkout: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  shipment: "55555555-5555-4555-8555-555555555555",
  disputeA: "66666666-6666-4666-8666-666666666666",
  disputeB: "77777777-7777-4777-8777-777777777777",
  eventA: "88888888-8888-4888-8888-888888888888",
  eventB: "99999999-9999-4999-8999-999999999999",
};

const rawEvent = (id, eventType, disputeOutcome, createdAt = at) => ({
  id,
  event_type: eventType,
  from_status: "shipped",
  to_status: "shipped",
  actor_role: "admin",
  dispute_outcome: disputeOutcome,
  created_at: createdAt,
});

const detailPayload = (events) => ({
  order: {
    id: ids.order,
    order_number: "ORD-F1C1",
    checkout_id: ids.checkout,
    checkout_reference: "CHK-F1C1",
    status: "shipped",
    currency: "BDAG",
    total: 50,
    created_at: at,
    confirmed_at: at,
    processing_at: at,
    shipped_at: at,
    delivered_at: null,
    fulfillment_version: 2,
  },
  store: { id: ids.store, name: "Tienda F1C1", slug: "tienda-f1c1" },
  payment: { status: "paid", paid_at: at },
  allocation: {
    gross_amount: 50,
    platform_fee_amount: 5,
    seller_net_amount: 45,
    status: "held",
    released_at: null,
  },
  settlement: null,
  shipping_address: {
    recipient_name: "Comprador",
    line1: "Dirección",
    line2: null,
    city: "Miami",
    region: "Florida",
    postal_code: "33101",
    country: "US",
    phone: null,
  },
  items: [{
    id: ids.item,
    product_title: "Producto",
    variant_title: null,
    sku: "SKU-F1C1",
    options: [],
    image_url: null,
    unit_price: 50,
    quantity: 1,
    line_total: 50,
  }],
  shipment: {
    id: ids.shipment,
    status: "shipped",
    carrier_name: "Carrier",
    service_level: null,
    tracking_number: "TRACK",
    tracking_url: null,
    seller_note: null,
    shipped_at: at,
    delivered_at: null,
  },
  events,
  escrow_protected: true,
});

const sellerRow = (activeDispute) => ({
  id: ids.order,
  order_number: "ORD-F1C1",
  checkout_id: ids.checkout,
  checkout_reference: "CHK-F1C1",
  status: "shipped",
  store_id: ids.store,
  store_name: "Tienda F1C1",
  total: 50,
  currency: "BDAG",
  created_at: at,
  confirmed_at: at,
  processing_at: at,
  shipped_at: at,
  delivered_at: null,
  distinct_lines: 1,
  total_quantity: 1,
  carrier_name: "Carrier",
  tracking_number: "TRACK",
  recipient_name: "Comprador",
  city: "Miami",
  region: "Florida",
  country: "US",
  gross_amount: 50,
  platform_fee_amount: 5,
  seller_net_amount: 45,
  allocation_status: "held",
  released_at: null,
  active_dispute: activeDispute,
});

const disputeRow = (overrides = {}) => ({
  dispute_id: ids.disputeA,
  status: "open",
  reason_code: "damaged",
  created_at: at,
  order_id: ids.order,
  order_number: "ORD-F1C1",
  order_status: "shipped",
  store_id: ids.store,
  store_name: "Tienda F1C1",
  seller_response_submitted: false,
  affected_item_count: 1,
  buyer_evidence_count: 2,
  ...overrides,
});

test("two historical dispute resolutions keep their own canonical outcomes", () => {
  const parsed = parseMarketplaceOrderDetailPayload(detailPayload([
    rawEvent(ids.eventA, "dispute_resolved", "reject_claim", "2026-08-22T13:00:00Z"),
    rawEvent(ids.eventB, "dispute_resolved", "refund_buyer", "2026-08-22T14:00:00Z"),
  ]));
  const rendered = marketplaceOrderTimelineItems(parsed.events);
  assert.deepEqual(rendered.map((item) => item.label), [
    "Reclamo rechazado por administración",
    "Reclamo resuelto: reembolso al comprador",
  ]);
  assert.equal(parsed.events[0].disputeOutcome, "reject_claim");
  assert.equal(parsed.events[1].disputeOutcome, "refund_buyer");
});

test("event outcome parser accepts canonical values, null and missing but fails closed otherwise", () => {
  for (const outcome of ["reject_claim", "release_seller", "refund_buyer"])
    assert.equal(
      parseMarketplaceOrderDetailPayload(detailPayload([rawEvent(ids.eventA, "dispute_resolved", outcome)])).events[0].disputeOutcome,
      outcome,
    );
  const missing = rawEvent(ids.eventA, "dispute_resolved", null);
  delete missing.dispute_outcome;
  assert.equal(parseMarketplaceOrderDetailPayload(detailPayload([missing])).events[0].disputeOutcome, null);
  assert.equal(parseMarketplaceOrderDetailPayload(detailPayload([rawEvent(ids.eventA, "order_shipped", null)])).events[0].disputeOutcome, null);
  for (const event of [
    rawEvent(ids.eventA, "dispute_resolved", "buyer_wins"),
    rawEvent(ids.eventA, "order_shipped", "reject_claim"),
  ]) assert.throws(
    () => parseMarketplaceOrderDetailPayload(detailPayload([event])),
    MarketplaceFulfillmentPayloadError,
  );
});

test("seller order parser exposes only a strict active dispute summary", () => {
  for (const status of ["open", "under_review"]) {
    const active = { id: ids.disputeA, status, reason_code: "damaged", created_at: at, seller_response_submitted: status === "under_review" };
    const parsed = parseSellerOrderListPayload([sellerRow(active)], 20).items[0];
    assert.equal(parsed.activeDispute?.status, status);
    assert.equal(parsed.activeDispute?.sellerResponseSubmitted, status === "under_review");
  }
  assert.equal(parseSellerOrderListPayload([sellerRow(null)], 20).items[0].activeDispute, null);
  for (const bad of [
    { id: "bad", status: "open", reason_code: "damaged", created_at: at, seller_response_submitted: false },
    { id: ids.disputeA, status: "resolved", reason_code: "damaged", created_at: at, seller_response_submitted: false },
    { id: ids.disputeA, status: "open", reason_code: "damaged", created_at: "bad", seller_response_submitted: false },
  ]) assert.throws(() => parseSellerOrderListPayload([sellerRow(bad)], 20), MarketplaceFulfillmentPayloadError);
});

test("seller dispute inbox parser validates counts, pagination and minimal rows", () => {
  const parsed = parseSellerDisputeIndexPayload({
    active_count: 2,
    open_count: 1,
    under_review_count: 1,
    disputes: [disputeRow(), disputeRow({ dispute_id: ids.disputeB, status: "under_review", seller_response_submitted: true })],
    next_cursor: { created_at: at, id: ids.disputeB },
  }, 20);
  assert.equal(parsed.activeCount, 2);
  assert.equal(parsed.disputes[1].sellerResponseSubmitted, true);
  assert.deepEqual(parsed.nextCursor, { createdAt: at, id: ids.disputeB });
  for (const payload of [
    { active_count: 3, open_count: 1, under_review_count: 1, disputes: [], next_cursor: null },
    { active_count: 1, open_count: 1, under_review_count: 0, disputes: [disputeRow({ status: "resolved" })], next_cursor: null },
    { active_count: 1, open_count: 1, under_review_count: 0, disputes: [disputeRow({ seller_response_submitted: "yes" })], next_cursor: null },
  ]) assert.throws(() => parseSellerDisputeIndexPayload(payload, 20), MarketplaceFulfillmentPayloadError);
});

test("migration extends canonical reads without exposing private case data", () => {
  assert.match(migration, /create or replace function public\.marketplace_order_detail_response\(p_order_id uuid,p_role text\)/);
  assert.match(migration, /'dispute_outcome',case[\s\S]*e\.metadata->>'outcome' in\('refund_buyer','release_seller','reject_claim'\)/);
  assert.match(migration, /create or replace function public\.fetch_my_marketplace_sales/);
  assert.match(migration, /'active_dispute'/);
  assert.match(migration, /d\.status in\('open','under_review'\)/);
  assert.match(migration, /create or replace function public\.fetch_my_marketplace_disputes/);
  assert.match(migration, /d\.seller_id=auth\.uid\(\)/);
  assert.match(migration, /seller_response_submitted/);
  assert.match(migration, /affected_item_count/);
  assert.match(migration, /buyer_evidence_count/);
  assert.doesNotMatch(migration, /'buyer_note'|'buyer_evidence_asset_ids'|'object_key'|'signed_url'/);
  assert.doesNotMatch(migration, /insert into|update public|delete from|ledger_debit|ledger_credit/i);
});

test("seller dispute RPC is hardened and cursor pagination is bounded", () => {
  assert.match(migration, /security definer set search_path=public/);
  assert.match(migration, /p_limit<1 or p_limit>50/);
  assert.match(migration, /\(p_before_created_at is null\)<>\(p_before_id is null\)/);
  assert.match(migration, /order by created_at desc,id desc limit v_limit\+1/);
  assert.match(migration, /revoke all on function public\.fetch_my_marketplace_disputes[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.fetch_my_marketplace_disputes[\s\S]*to authenticated,service_role/);
});

test("Seller Center, order cards and inbox expose one canonical awareness path", () => {
  assert.match(home, /Disputas que requieren atención/);
  assert.match(home, /fetchSellerDisputes\(\{limit:1\}\)/);
  assert.match(home, /router\.push\('\/seller\/disputes'/);
  assert.match(home, /Sin disputas abiertas/);
  assert.match(home, /Pedidos que necesitan atención/);
  assert.match(orders, /disputeDot/);
  assert.match(orders, /Disputa abierta/);
  assert.match(orders, /Disputa en revisión/);
  assert.match(orders, /Este pedido tiene una disputa abierta/);
  assert.match(inbox, /fetchSellerDisputes/);
  assert.match(inbox, /marketplaceDisputeReasonLabel\(item\.reasonCode\)/);
  assert.match(inbox, /Respuesta pendiente/);
  assert.match(inbox, /Respuesta enviada/);
  assert.match(inbox, /router\.push\(`\/seller\/orders\/\$\{item\.orderId\}`/);
  assert.doesNotMatch(inbox, /MarketplaceSellerDisputePanel|uploadMedia|evidenceAssetIds/);
  assert.match(detail, /MarketplaceSellerDisputePanel/);
});

test("service reuses fulfillment authority and F1C financial history stays intact", () => {
  assert.match(service, /fetch_my_marketplace_disputes/);
  assert.match(service, /parseSellerDisputeIndexPayload/);
  assert.match(timeline, /marketplaceOrderTimelineItems/);
  assert.match(detail, /allocationStatus=\{data\.allocation\?\.status\?\?null\}/);
  assert.match(detail, /settlement=\{data\.settlement\}/);
  assert.doesNotMatch(detail, /disputeOutcome=\{data\.dispute/);
  assert.doesNotMatch(service, /new SupabaseClient|service_role/);
});
