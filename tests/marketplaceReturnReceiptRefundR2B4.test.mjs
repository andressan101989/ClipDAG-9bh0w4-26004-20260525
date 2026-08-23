import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnMutationReceipt,
  parseSellerReturnIndexPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";
import {
  marketplaceOrderTimelineItems,
  marketplaceReturnStatusCopy,
} from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260823055013_marketplace_return_received_refund_r2b4.sql");
const service = read("services/marketplaceFulfillmentService.ts");
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const parser = read("services/marketplaceFulfillmentParsers.mjs");
const sellerHome = read("app/seller/index.tsx");
const sellerOrders = read("app/seller/orders/index.tsx");
const sellerInbox = read("app/seller/returns/index.tsx");
const at = "2026-08-23T05:50:13.000Z";
const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const detailPayload = {
  order: { id: id("1"), order_number: "ORD-R2B4", checkout_id: id("2"),
    checkout_reference: "CHK-R2B4", status: "refunded", currency: "BDAG", total: 50,
    created_at: at, confirmed_at: at, processing_at: at, shipped_at: at,
    delivered_at: at, fulfillment_version: 5 },
  store: { id: id("3"), name: "Return Store", slug: "return-store" },
  payment: { status: "refunded", paid_at: at },
  allocation: { status: "refunded", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, released_at: at },
  settlement: { status: "completed", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, confirmed_at: at, released_at: at, seller_bdag_balance: 45 },
  shipping_address: { recipient_name: "Buyer", line1: "Buyer Street", line2: null,
    city: "Miami", region: "FL", postal_code: "33101", country: "US", phone: null },
  items: [{ id: id("4"), product_title: "Product", variant_title: null, sku: "R2B4",
    options: [], image_url: null, unit_price: 50, quantity: 1, line_total: 50 }],
  shipment: null, events: [], escrow_protected: false,
};

const receivedShipment = (overrides = {}) => ({
  status: "received",
  destination: null,
  seller_instructions: null,
  return_label_asset_id: id("90"), return_label_file_name: "label.pdf", label_sent_at: at,
  carrier_name: null, service_level: null, tracking_number: null,
  tracking_url: null, buyer_note: "Handed to carrier",
  instructions_provided_at: null, shipped_at: at, received_at: at, received_by: id("6"),
  seller_receipt_note: "Received intact", ...overrides,
});

const lifecycle = (shipment = receivedShipment(), refundMode = "returned_item") => ({
  shipping_amount: 0, shipping: null, shipping_snapshot: null, dispute: null,
  return_eligible: false,
  return_request: {
    id: id("5"), status: "refunded", buyer_note: "Return it", seller_note: "Accepted",
    created_at: at, decided_at: at,
    refund_hold: { status: "held", gross_amount: 50, held_at: at },
    refund: { mode: refundMode, gross_amount: 50, refunded_at: at },
    return_shipment: shipment,
  },
});

test("R2B-4 extends the canonical shipment and refund authorities without parallel tables", () => {
  assert.match(migration, /add column received_at timestamptz/);
  assert.match(migration, /status in\('awaiting_buyer_shipment','shipped','received'\)/);
  assert.match(migration, /resolution_mode in\('keep_item','returned_item'\)/);
  assert.match(migration, /create function public\.marketplace_complete_return_refund_core/);
  assert.match(migration, /create function public\.confirm_marketplace_return_received/);
  assert.doesNotMatch(migration, /create table public\.marketplace_return_refunds/);
  assert.doesNotMatch(migration, /create table public\.marketplace_return_refund_holds/);
});

test("R2B-4 makes the private PDF the only active shipping authority", () => {
  assert.match(migration, /drop function public\.prepare_marketplace_return_shipment/);
  assert.match(migration, /drop function public\.send_marketplace_return_label\(\s*uuid,uuid,text,text,text,text,uuid/);
  assert.match(migration, /create function public\.send_marketplace_return_label\(\s*p_return_id uuid,\s*p_label_asset_id uuid,\s*p_idempotency_key uuid/);
  const label = migration.split("create function public.send_marketplace_return_label")[1]
    .split("create or replace function public.confirm_marketplace_return_shipment")[0];
  for (const proof of ["ma.owner_id<>v_actor", "ma.status<>'ready'", "ma.visibility<>'private'",
    "ma.media_kind<>'document'", "ma.purpose<>'return_label'",
    "ma.mime_type<>'application/pdf'", "ma.size_bytes>10000000"])
    assert.ok(label.includes(proof), proof);
  assert.doesNotMatch(label, /p_carrier_name|p_tracking_number|ledger_(debit|credit)/);
});

test("active UI and service contain no destination or tracking data-entry authority", () => {
  assert.doesNotMatch(service, /prepareMarketplaceReturnShipment|prepare_marketplace_return_shipment/);
  assert.doesNotMatch(panel, /Nombre del destinatario|Dirección de devolución|Transportista de devolución|Número de seguimiento de devolución|URL de seguimiento de devolución/);
  assert.match(panel, /Seleccionar label PDF/);
  assert.match(panel, /Enviar label al comprador/);
  assert.match(panel, /Imprime el label, pégalo en la caja y entrega el paquete en la agencia indicada en el documento/);
});

test("seller attention has exactly the four active label-only stages", () => {
  assert.match(parser, /"decision_pending",\s*"funds_pending",\s*"label_pending",\s*"receipt_confirmation_pending"/);
  for (const source of [parser, sellerHome, sellerOrders, sellerInbox]) {
    assert.doesNotMatch(source, /destination_pending|return_in_transit|destinationPendingCount|inTransitCount/);
  }
});

test("shipment guard permits only marked shipped-to-received transition and freezes received rows", () => {
  const guard = migration.split("create or replace function public.marketplace_return_shipment_guard")[1]
    .split("alter table public.marketplace_return_refunds")[0];
  assert.match(guard, /coalesce\(current_setting\('app\.marketplace_return_receipt',true\),'off'\)<>'on'/);
  assert.match(guard, /old\.status='received'/);
  assert.match(guard, /new\.status<>'received'/);
  assert.match(guard, /marketplace_return_shipment_immutable/);
});

test("shared core atomically consumes return escrow and never re-debits beneficiaries or B7R", () => {
  const core = migration.split("create function public.marketplace_complete_return_refund_core")[1]
    .split("create or replace function public.refund_marketplace_return_without_shipment")[0];
  assert.match(core, /marketplace_return_escrow/);
  assert.match(core, /perform public\.ledger_debit\(v_tx_id,v_return_escrow,h\.gross_amount/);
  assert.match(core, /perform public\.ledger_credit\(v_tx_id,v_buyer_account,h\.gross_amount/);
  assert.match(core, /resolution_mode',p_resolution_mode/);
  assert.match(core, /status='received'/);
  assert.doesNotMatch(core, /reverse_marketplace_released_settlement|marketplace_settlement_reversal_legs/);
});

test("keep-item authority preserves its signature and delegates to the shared core", () => {
  const keep = migration.split("create or replace function public.refund_marketplace_return_without_shipment")[1]
    .split("create function public.confirm_marketplace_return_received")[0];
  assert.match(keep, /p_return_id uuid,p_seller_note text,p_idempotency_key uuid/);
  assert.match(keep, /'resolution_mode','keep_item'/);
  assert.match(keep, /marketplace_complete_return_refund_core\(\s*rr\.id,v_actor,'keep_item'/);
});

test("seller receipt RPC is exact-owner authority with hardened grants", () => {
  const receipt = migration.split("create function public.confirm_marketplace_return_received")[1]
    .split("create or replace function public.fetch_my_marketplace_order_lifecycle")[0];
  assert.match(receipt, /v_actor uuid:=auth\.uid\(\)/);
  assert.match(receipt, /rr\.seller_id<>v_actor/);
  assert.match(receipt, /marketplace_seller_not_approved/);
  assert.match(migration, /revoke all on function public\.marketplace_complete_return_refund_core[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.confirm_marketplace_return_received[\s\S]*to authenticated,service_role/);
});

test("parser accepts exact returned-item refund and exposes received shipment", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  const parsed = mergeMarketplaceOrderLifecyclePayload(base, lifecycle());
  assert.equal(parsed.returnRequest?.refund?.mode, "returned_item");
  assert.equal(parsed.returnRequest?.returnShipment?.status, "received");
  assert.equal(parsed.returnRequest?.returnShipment?.receivedBy, id("6"));
  assert.equal(parsed.returnRequest?.returnShipment?.sellerReceiptNote, "Received intact");
  const receipt = parseMarketplaceReturnMutationReceipt({
    money_moved: true,
    return_request: { ...lifecycle().return_request, order_id: id("1") },
  });
  assert.equal(receipt.moneyMoved, true);
});

test("parser fails closed for incomplete received and incompatible resolution shapes", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  for (const invalid of [
    lifecycle(receivedShipment({ received_at: null })),
    lifecycle(receivedShipment({ received_by: null })),
    lifecycle(receivedShipment(), "keep_item"),
    lifecycle({ ...receivedShipment(), status: "shipped", received_at: null,
      received_by: null, seller_receipt_note: null }),
  ]) assert.throws(
    () => mergeMarketplaceOrderLifecyclePayload(base, invalid),
    MarketplaceFulfillmentPayloadError,
  );
});

test("keep-item refunded payload still requires no shipment", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  const parsed = mergeMarketplaceOrderLifecyclePayload(base, lifecycle(null, "keep_item"));
  assert.equal(parsed.returnRequest?.refund?.mode, "keep_item");
  assert.equal(parsed.returnRequest?.returnShipment, null);
});

test("seller attention uses receipt confirmation rather than generic transit", () => {
  const parsed = parseSellerReturnIndexPayload({
    attention_count: 1, requested_count: 0, approved_count: 1,
    funding_pending_count: 0, label_pending_count: 0,
    receipt_confirmation_pending_count: 1,
    returns: [{ return_id: id("5"), status: "approved", created_at: at,
      attention_reason: "receipt_confirmation_pending", return_shipping_status: "shipped",
      order_id: id("1"), order_number: "ORD-R2B4", order_status: "delivered",
      store_id: id("3"), store_name: "Return Store" }], next_cursor: null,
  }, 20);
  assert.equal(parsed.receiptConfirmationPendingCount, 1);
  assert.equal(parsed.returns[0].attentionReason, "receipt_confirmation_pending");
});

test("client uses one receipt RPC and reconciles only exact returned-item completion", () => {
  assert.match(service, /export async function confirmMarketplaceReturnReceived/);
  assert.match(service, /"confirm_marketplace_return_received"/);
  assert.match(service, /value\.returnRequest\.refund\?\.mode === "returned_item"/);
  assert.match(service, /value\.returnRequest\.returnShipment\?\.status === "received"/);
  assert.match(service, /value\.order\.status === "refunded"/);
  assert.equal((service.match(/export async function confirmMarketplaceReturnReceived/g) ?? []).length, 1);
});

test("canonical panel provides irreversible seller confirmation and no client finance", () => {
  assert.match(panel, /Confirmar que recibí el producto/);
  assert.match(panel, /Confirmar recepción y reembolso/);
  assert.match(panel, /Esta acción no se puede deshacer/);
  assert.match(panel, /confirmMarketplaceReturnReceived/);
  assert.doesNotMatch(panel, /ledger_debit|financial_transactions|marketplace_return_escrow/);
});

test("timeline and copy distinguish physical receipt refund", () => {
  const items = marketplaceOrderTimelineItems([
    { id: id("10"), eventType: "return_received", fromStatus: "delivered",
      toStatus: "delivered", actorRole: "seller", disputeOutcome: null, createdAt: at },
    { id: id("11"), eventType: "refund_created", fromStatus: "delivered",
      toStatus: "refunded", actorRole: "seller", disputeOutcome: null, createdAt: at },
  ], null, null, "returned_item");
  assert.deepEqual(items.map((item) => item.label), [
    "Producto recibido por el vendedor", "Reembolso de devolución completado",
  ]);
  assert.equal(
    marketplaceReturnStatusCopy("refunded", true, "received", true, "returned_item").body,
    "Reembolso completado. El vendedor confirmó la recepción y el dinero fue devuelto.",
  );
});

test("reconcilers expose receipt-specific anomaly counters and preserve escrow formula", () => {
  for (const key of ["received_without_refund", "returned_item_refund_without_received_shipment",
    "receipt_identity_mismatch", "receipt_transaction_mismatch", "receipt_event_mismatch",
    "invalid_received_state"]) assert.ok(migration.includes(`'${key}'`), key);
  assert.match(migration, /sum\(h\.gross_amount\)[\s\S]*sum\(r\.gross_amount\)/);
  assert.match(migration, /legacy_shipped_without_label/);
});
