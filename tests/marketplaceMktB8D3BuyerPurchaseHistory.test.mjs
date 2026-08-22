import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseBuyerOrderListPayload,
  parseMarketplaceOrderDetailPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260816021000_fix_marketplace_buyer_purchase_history_paid_evidence.sql");
const parser = read("services/marketplaceFulfillmentParsers.mjs");
const buyerList = read("app/orders/index.tsx");
const buyerDetail = read("app/orders/[id].tsx");
const statuses = read("components/marketplace/OrderStatus.tsx");
const orderPresentation = read("services/marketplaceOrderPresentation.ts");
const remoteAudit = read("scripts/audit-marketplace-b8d3-c6-remote.mjs");
const app = JSON.parse(read("app.json"));

const id = {
  order: "11111111-1111-4111-8111-111111111111",
  checkout: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
};
const at = "2026-08-16T12:00:00.000Z";
const listRow = (orderStatus, paymentStatus) => ({
  id: id.order,
  order_number: "ORD-HISTORY",
  checkout_id: id.checkout,
  checkout_reference: "CHK-HISTORY",
  status: orderStatus,
  store_id: id.store,
  store_name: "Tienda real",
  total: 25,
  currency: "BDAG",
  created_at: at,
  confirmed_at: at,
  processing_at: null,
  shipped_at: null,
  delivered_at: null,
  first_item_title: "Producto real",
  first_item_image: null,
  distinct_lines: 1,
  total_quantity: 1,
  carrier_name: null,
  tracking_number: null,
  payment_status: paymentStatus,
});
const detail = (orderStatus, paymentStatus) => ({
  order: {
    id: id.order,
    order_number: "ORD-HISTORY",
    checkout_id: id.checkout,
    checkout_reference: "CHK-HISTORY",
    status: orderStatus,
    currency: "BDAG",
    total: 25,
    created_at: at,
    confirmed_at: at,
    processing_at: null,
    shipped_at: null,
    delivered_at: null,
    fulfillment_version: 2,
  },
  store: { id: id.store, name: "Tienda real", slug: "tienda-real" },
  payment: { status: paymentStatus, paid_at: at },
  allocation: null,
  settlement: null,
  shipping_address: {
    recipient_name: "Comprador",
    line1: "Dirección protegida",
    line2: null,
    city: "Ciudad",
    region: "Región",
    postal_code: "00000",
    country: "US",
    phone: null,
  },
  items: [{
    id: id.item,
    product_title: "Producto real",
    variant_title: null,
    sku: "SKU-HISTORY",
    options: [],
    image_url: null,
    unit_price: 25,
    quantity: 1,
    line_total: 25,
  }],
  shipment: null,
  events: [],
  escrow_protected: false,
});

test("paid delivered purchases remain valid buyer history", () => {
  const result = parseBuyerOrderListPayload([listRow("delivered", "paid")], 20);
  assert.equal(result.items[0].status, "delivered");
});

test("refunded historical purchases parse without changing canonical status", () => {
  const result = parseBuyerOrderListPayload([listRow("refunded", "refunded")], 20);
  assert.equal(result.items[0].status, "refunded");
});

test("partially refunded historical purchases parse", () => {
  const result = parseBuyerOrderListPayload([
    listRow("partially_refunded", "partially_refunded"),
  ], 20);
  assert.equal(result.items[0].status, "partially_refunded");
});

test("refunded and partially refunded details retain canonical payment states", () => {
  assert.equal(parseMarketplaceOrderDetailPayload(detail("refunded", "refunded")).payment.status, "refunded");
  assert.equal(
    parseMarketplaceOrderDetailPayload(detail("partially_refunded", "partially_refunded")).payment.status,
    "partially_refunded",
  );
});

test("buyer parsers reject unknown payment states", () => {
  assert.throws(
    () => parseBuyerOrderListPayload([listRow("refunded", "unknown")], 20),
    MarketplaceFulfillmentPayloadError,
  );
  assert.throws(
    () => parseMarketplaceOrderDetailPayload(detail("refunded", "unknown")),
    MarketplaceFulfillmentPayloadError,
  );
  assert.match(parser, /buyerPaymentStatuses = \["paid", "partially_refunded", "refunded"\]/);
});

test("history eligibility requires canonical historical-paid evidence", () => {
  assert.match(migration, /c\.status = 'paid'/i);
  assert.doesNotMatch(migration, /c\.paid_at/i);
  assert.match(migration, /p\.paid_at is not null[\s\S]*p\.status in \('paid', 'partially_refunded', 'refunded'\)/i);
  assert.doesNotMatch(migration, /c\.status in \([^)]*expired|c\.status in \([^)]*cancelled/i);
});

test("unpaid expired and cancelled reservations are excluded from purchase history", () => {
  const definitions = migration.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.equal(definitions.length, 2);
  for (const definition of definitions) {
    assert.match(definition, /c\.status = 'paid'/i);
    assert.match(definition, /p\.paid_at is not null/i);
  }
});

test("list keeps ownership filtering cursor ordering and exact status filter", () => {
  assert.match(migration, /o\.buyer_id = auth\.uid\(\)/i);
  assert.match(migration, /p_status is null or o\.status = p_status/i);
  assert.match(migration, /\(o\.created_at, o\.id\) < \(p_before_created_at, p_before_id\)/i);
  assert.match(migration, /order by o\.created_at desc, o\.id desc[\s\S]*limit v_limit/i);
});

test("buyer detail keeps owner-only access and sanitized canonical response", () => {
  assert.match(migration, /not found or o\.buyer_id <> auth\.uid\(\)/i);
  assert.match(migration, /marketplace_order_not_found/);
  assert.match(migration, /marketplace_order_detail_response\(o\.id, 'buyer'\)/i);
  assert.match(migration, /#- '\{shipment,seller_note\}' #- '\{shipment,id\}'/i);
});

test("anon remains denied while authenticated buyer RPC grants remain", () => {
  assert.match(migration, /revoke all on function public\.fetch_my_marketplace_orders[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.fetch_my_marketplace_orders[\s\S]*to authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.fetch_my_marketplace_order\(uuid\)[\s\S]*from public, anon, authenticated/i);
});

test("buyer filters expose exact paginated refund states in one horizontal rail", () => {
  assert.match(buyerList, /ScrollView[\s\S]*horizontal/);
  assert.match(buyerList, /\['Reembolsados', 'refunded'\]/);
  assert.match(buyerList, /\['Parciales', 'partially_refunded'\]/);
  assert.match(buyerList, /fetchBuyerOrders\(\{[\s\S]*status,[\s\S]*limit: PAGE/);
  assert.doesNotMatch(buyerList, /flexWrap/);
});

test("refund status labels and timeline events are explicit", () => {
  assert.match(statuses, /refunded:'Reembolsado'/);
  assert.match(statuses, /partially_refunded:'Reembolso parcial'/);
  assert.match(orderPresentation, /dispute_opened: "Problema reportado"/);
  assert.match(orderPresentation, /refund_created: "Fondos reembolsados al comprador"/);
  assert.match(statuses, /marketplaceOrderTimelineItems/);
});

test("refunded detail cannot confirm delivery or open a second dispute", () => {
  assert.match(buyerDetail, /data\.order\.status === 'shipped' && !data\.dispute/);
  assert.doesNotMatch(buyerDetail, /data\.order\.status === 'refunded'[\s\S]{0,120}Confirmar recepción/);
  assert.match(buyerDetail, /data\.dispute \? <MarketplaceDisputePanel[\s\S]*current=\{data\.dispute\}/);
});

test("original payment receipt remains linked for historical refunded orders", () => {
  assert.match(buyerDetail, /Ver recibo de pago/);
  assert.match(buyerDetail, /\/checkout\/reservation\/\$\{data\.order\.checkoutId\}/);
});

test("corrective changes no money movement or seller fulfillment authority", () => {
  assert.doesNotMatch(migration, /update public\.|insert into public\.|delete from public\.|ledger_|atomic_ledger_transfer|seller_start_marketplace_order_processing|seller_ship_marketplace_order/i);
});

test("Build 22 and the forward-only C6 closure remain explicit", () => {
  assert.equal(app.expo.ios.buildNumber, "22");
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
});

test("remote auditor verifies the real refunded order read-only and cross-user isolation", () => {
  assert.match(remoteAudit, /1c55cd4f-7e1d-446d-86f6-9e808a85fd59/);
  assert.match(remoteAudit, /fetch_my_marketplace_orders\('refunded',50,null,null\)/);
  assert.match(remoteAudit, /fetch_my_marketplace_order\(\$1\)/);
  assert.match(remoteAudit, /fetch_my_marketplace_order_lifecycle\(\$1\)/);
  assert.match(remoteAudit, /other_user_detail_denied: true/);
  assert.match(remoteAudit, /mutated: false/);
  assert.doesNotMatch(remoteAudit, /update public\.|insert into public\.|delete from public\./i);
});
