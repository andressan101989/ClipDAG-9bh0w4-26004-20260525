import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseBuyerOrderListPayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnShipmentMutationReceipt,
  parseSellerOrderListPayload,
  parseSellerReturnIndexPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";
import { marketplaceOrderTimelineItems } from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260823023725_marketplace_return_shipping_r2b2.sql");
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const service = read("services/marketplaceFulfillmentService.ts");
const buyerOrders = read("app/orders/index.tsx");
const sellerOrders = read("app/seller/orders/index.tsx");
const sellerInbox = read("app/seller/returns/index.tsx");
const sellerHome = read("app/seller/index.tsx");
const at = "2026-08-23T02:37:25.000Z";
const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const destination = {
  recipient_name: "Seller Returns",
  line1: "123 Return Street",
  line2: null,
  city: "Miami",
  region: "FL",
  postal_code: "33101",
  country: "US",
  phone: null,
};

const returnShipment = (status, overrides = {}) => ({
  status,
  destination,
  seller_instructions: "Use the rear entrance",
  carrier_name: status === "shipped" ? "UPS" : null,
  service_level: status === "shipped" ? "Ground" : null,
  tracking_number: status === "shipped" ? "1Z-R2B2" : null,
  tracking_url: status === "shipped" ? "https://tracking.example/1Z-R2B2" : null,
  buyer_note: status === "shipped" ? "Packed safely" : null,
  instructions_provided_at: at,
  shipped_at: status === "shipped" ? at : null,
  ...overrides,
});

const detailPayload = {
  order: { id: id("1"), order_number: "ORD-R2B2", checkout_id: id("2"),
    checkout_reference: "CHK-R2B2", status: "delivered", currency: "BDAG", total: 50,
    created_at: at, confirmed_at: at, processing_at: at, shipped_at: at,
    delivered_at: at, fulfillment_version: 4 },
  store: { id: id("3"), name: "Return Store", slug: "return-store" },
  payment: { status: "paid", paid_at: at },
  allocation: { status: "released", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, released_at: at },
  settlement: { status: "completed", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, confirmed_at: at, released_at: at, seller_bdag_balance: 45 },
  shipping_address: { recipient_name: "Buyer", line1: "Buyer Street", line2: null,
    city: "Miami", region: "FL", postal_code: "33101", country: "US", phone: null },
  items: [{ id: id("4"), product_title: "Product", variant_title: null, sku: "R2B2",
    options: [], image_url: null, unit_price: 50, quantity: 1, line_total: 50 }],
  shipment: null,
  events: [],
  escrow_protected: false,
};

const lifecycle = (shipment) => ({
  shipping_amount: 0,
  shipping: null,
  shipping_snapshot: null,
  dispute: null,
  return_eligible: false,
  return_request: {
    id: id("5"), status: "approved", buyer_note: "Return it", seller_note: "Accepted",
    created_at: at, decided_at: at,
    refund_hold: { status: "held", gross_amount: 50, held_at: at },
    return_shipment: shipment,
  },
});

test("R2B-2 creates one non-financial reverse-shipment authority", () => {
  assert.match(migration, /create table public\.marketplace_return_shipments/);
  assert.match(migration, /create function public\.prepare_marketplace_return_shipment/);
  assert.match(migration, /create function public\.ship_marketplace_return/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant select on table public\.marketplace_return_shipments to service_role/);
  assert.match(migration, /return_instructions_provided/);
  assert.match(migration, /return_shipped/);
  assert.doesNotMatch(migration, /create table public\.marketplace_order_shipments/);
  assert.doesNotMatch(migration, /create table public\.marketplace_settlement_reversals/);
});

test("shipping RPCs require a funded canonical return and contain no money mutation", () => {
  const seller = migration.split("create function public.prepare_marketplace_return_shipment")[1]
    .split("create function public.ship_marketplace_return")[0];
  const buyer = migration.split("create function public.ship_marketplace_return")[1]
    .split("create or replace function public.fetch_my_marketplace_order_lifecycle")[0];
  for (const body of [seller, buyer]) {
    assert.match(body, /marketplace_return_refund_holds/);
    assert.match(body, /h\.status<>'held'/);
    assert.match(body, /p\.status<>'paid'/);
    assert.match(body, /a\.status<>'released'/);
    assert.match(body, /marketplace_settlement_reversals/);
    assert.doesNotMatch(body, /insert into public\.financial_transactions/);
    assert.doesNotMatch(body, /insert into public\.ledger_entries/);
    assert.doesNotMatch(body, /marketplace_create_order_settlement_b7f/);
    assert.doesNotMatch(body, /reverse_marketplace_released_settlement/);
  }
  assert.match(buyer, /'money_moved',false/);
});

test("lifecycle parser accepts destination and shipped tracking states", () => {
  const detail = parseMarketplaceOrderDetailPayload(detailPayload);
  const awaiting = mergeMarketplaceOrderLifecyclePayload(
    detail,
    lifecycle(returnShipment("awaiting_buyer_shipment")),
  );
  assert.equal(awaiting.returnRequest?.returnShipment?.destination.line1, destination.line1);
  assert.equal(awaiting.returnRequest?.returnShipment?.trackingNumber, null);
  const shipped = mergeMarketplaceOrderLifecyclePayload(detail, lifecycle(returnShipment("shipped")));
  assert.equal(shipped.returnRequest?.returnShipment?.status, "shipped");
  assert.equal(shipped.returnRequest?.returnShipment?.trackingNumber, "1Z-R2B2");
});

test("parser fails closed for invalid physical shipment state", () => {
  const detail = parseMarketplaceOrderDetailPayload(detailPayload);
  for (const malformed of [
    returnShipment("awaiting_buyer_shipment", { tracking_number: "EARLY" }),
    returnShipment("shipped", { tracking_number: null }),
    returnShipment("shipped", { shipped_at: null }),
    returnShipment("shipped", { tracking_url: "javascript:alert(1)" }),
    returnShipment("shipped", { destination: { ...destination, country: "USA" } }),
  ]) assert.throws(
    () => mergeMarketplaceOrderLifecyclePayload(detail, lifecycle(malformed)),
    MarketplaceFulfillmentPayloadError,
  );
});

test("shipment receipts are always non-financial", () => {
  const receipt = parseMarketplaceReturnShipmentMutationReceipt({
    return_id: id("5"), order_id: id("1"), money_moved: false,
    return_shipment: returnShipment("shipped"),
  });
  assert.equal(receipt.moneyMoved, false);
  assert.equal(receipt.returnShipment.status, "shipped");
  assert.throws(() => parseMarketplaceReturnShipmentMutationReceipt({
    return_id: id("5"), order_id: id("1"), money_moved: true,
    return_shipment: returnShipment("shipped"),
  }), MarketplaceFulfillmentPayloadError);
});

test("seller and buyer list parsers expose only operational progress", () => {
  const common = { id: id("1"), order_number: "ORD-R2B2", checkout_id: id("2"),
    checkout_reference: "CHK", status: "delivered", store_id: id("3"), store_name: "Store",
    total: 50, currency: "BDAG", created_at: at, confirmed_at: at, processing_at: at,
    shipped_at: at, delivered_at: at, distinct_lines: 1, total_quantity: 1,
    carrier_name: null, tracking_number: null };
  const seller = parseSellerOrderListPayload([{ ...common, recipient_name: "Buyer", city: "Miami",
    region: "FL", country: "US", gross_amount: 50, platform_fee_amount: 5,
    seller_net_amount: 45, allocation_status: "released", released_at: at,
    active_dispute: null, active_return_request: { id: id("5"), status: "approved",
      created_at: at, attention_reason: "destination_pending" } }], 20).items[0];
  assert.equal(seller.activeReturnRequest?.attentionReason, "destination_pending");
  const buyer = parseBuyerOrderListPayload([{ ...common, first_item_title: "Product",
    first_item_image: null, payment_status: "paid", return_progress: { return_id: id("5"),
      status: "approved", return_shipping_status: "shipped" } }], 20).items[0];
  assert.equal(buyer.returnProgress?.shippingStatus, "shipped");
});

test("seller inbox distinguishes each R2B-2 attention stage", () => {
  const rows = [
    ["5", "requested", "decision_pending", null],
    ["6", "approved", "funds_pending", null],
    ["7", "approved", "destination_pending", null],
    ["8", "approved", "return_in_transit", "shipped"],
  ].map(([suffix, status, reason, shipping]) => ({
    return_id: id(suffix), status, created_at: at, attention_reason: reason,
    return_shipping_status: shipping, order_id: id(`${suffix}1`), order_number: `ORD-${suffix}`,
    order_status: "delivered", store_id: id("3"), store_name: "Store",
  }));
  const page = parseSellerReturnIndexPayload({ attention_count: 4, requested_count: 1,
    approved_count: 3, funding_pending_count: 1, destination_pending_count: 1,
    in_transit_count: 1, returns: rows, next_cursor: null }, 20);
  assert.deepEqual(page.returns.map((row) => row.attentionReason), [
    "decision_pending", "funds_pending", "destination_pending", "return_in_transit",
  ]);
});

test("UI reuses the canonical panel and existing inbox without R2B-3 actions", () => {
  assert.match(panel, /Indicar dirección de devolución/);
  assert.match(panel, /Marcar producto como enviado/);
  assert.match(panel, /Los fondos seguirán protegidos/);
  assert.match(panel, /Producto de devolución en camino/);
  assert.doesNotMatch(panel, /Confirmar recepción de devolución|Liberar reembolso/i);
  assert.match(service, /prepare_marketplace_return_shipment/);
  assert.match(service, /ship_marketplace_return/);
  assert.match(sellerOrders, /Dirección pendiente/);
  assert.match(sellerInbox, /Devolución en camino/);
  assert.match(sellerHome, /destinationPendingCount/);
  assert.match(buyerOrders, /Esperando instrucciones de devolución/);
});

test("return history uses the existing order timeline", () => {
  const events = [
    { id: id("10"), eventType: "return_instructions_provided", fromStatus: "delivered",
      toStatus: "delivered", actorRole: "seller", disputeOutcome: null, createdAt: at },
    { id: id("11"), eventType: "return_shipped", fromStatus: "delivered",
      toStatus: "delivered", actorRole: "buyer", disputeOutcome: null,
      createdAt: "2026-08-23T03:00:00.000Z" },
  ];
  assert.deepEqual(marketplaceOrderTimelineItems(events).map((row) => row.label), [
    "Dirección de devolución disponible", "Producto enviado de regreso",
  ]);
});

test("shipment reconciliation preserves the requested stable counter contract", () => {
  const body = migration.split("create function public.reconcile_marketplace_return_shipments")[1];
  for (const key of ["orphan_return_shipment", "return_identity_mismatch",
    "unfunded_return_shipment", "invalid_return_status", "missing_destination",
    "invalid_tracking_state", "shipped_without_tracking", "shipped_without_timestamp",
    "destination_changed_after_shipping", "duplicate_shipping_event"])
    assert.ok(body.includes(`'${key}'`), key);
  assert.doesNotMatch(body, /ledger_accounts|financial_transactions|marketplace_return_escrow/);
});
