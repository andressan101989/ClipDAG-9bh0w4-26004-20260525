import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseBuyerOrderListPayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnMutationReceipt,
  parseSellerReturnIndexPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";
import { marketplaceReturnStatusCopy } from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260823042737_marketplace_return_label_and_keep_item_refund_r2b3.sql");
const corrective = read("supabase/migrations/20260823043212_marketplace_return_legacy_shipment_reconciliation_r2b3_f1.sql");
const service = read("services/marketplaceFulfillmentService.ts");
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const media = read("supabase/functions/_shared/mediaPurposes.ts");
const mediaUrl = read("supabase/functions/get-media-url/index.ts");
const at = "2026-08-23T04:32:12.000Z";
const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const destination = {
  recipient_name: "Seller Returns", line1: "123 Return Street", line2: null,
  city: "Miami", region: "FL", postal_code: "33101", country: "US", phone: null,
};
const returnShipment = (status, label, overrides = {}) => ({
  status,
  destination: label ? null : destination,
  seller_instructions: label ? null : "Use the rear entrance",
  return_label_asset_id: label ? id("90") : null,
  return_label_file_name: label ? "return-label.pdf" : null,
  label_sent_at: label ? at : null,
  carrier_name: label ? null : "UPS",
  service_level: label ? null : "Ground",
  tracking_number: label ? null : "1Z-R2B3",
  tracking_url: label ? null : "https://tracking.example/1Z-R2B3",
  buyer_note: status === "shipped" ? "Handed to UPS" : null,
  instructions_provided_at: label ? null : at,
  shipped_at: status === "shipped" ? at : null,
  ...overrides,
});
const detailPayload = {
  order: { id: id("1"), order_number: "ORD-R2B3", checkout_id: id("2"),
    checkout_reference: "CHK-R2B3", status: "delivered", currency: "BDAG", total: 50,
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
  items: [{ id: id("4"), product_title: "Product", variant_title: null, sku: "R2B3",
    options: [], image_url: null, unit_price: 50, quantity: 1, line_total: 50 }],
  shipment: null, events: [], escrow_protected: false,
};
const lifecycle = (shipment, overrides = {}) => ({
  shipping_amount: 0, shipping: null, shipping_snapshot: null, dispute: null,
  return_eligible: false,
  return_request: {
    id: id("5"), status: "approved", buyer_note: "Return it", seller_note: "Accepted",
    created_at: at, decided_at: at,
    refund_hold: { status: "held", gross_amount: 50, held_at: at },
    refund: null, return_shipment: shipment, ...overrides,
  },
});

test("R2B-3 migration is the deployed canonical label and keep-item authority", () => {
  assert.match(migration, /add column return_label_asset_id uuid/);
  assert.match(migration, /create table public\.marketplace_return_refunds/);
  assert.match(migration, /before update or delete on public\.marketplace_return_refunds/);
  assert.match(migration, /create function public\.send_marketplace_return_label/);
  assert.match(migration, /create function public\.confirm_marketplace_return_shipment/);
  assert.match(migration, /create function public\.refund_marketplace_return_without_shipment/);
  assert.match(migration, /drop function public\.ship_marketplace_return/);
});

test("seller label authority requires an exact private ready PDF and links it canonically", () => {
  const body = migration.split("create function public.send_marketplace_return_label")[1]
    .split("drop function public.ship_marketplace_return")[0];
  for (const proof of ["ma.owner_id<>v_actor", "ma.status<>'ready'", "ma.visibility<>'private'",
    "ma.media_kind<>'document'", "ma.purpose<>'return_label'", "ma.mime_type<>'application/pdf'",
    "ma.size_bytes>10000000", "'marketplace_return_shipment'", "'return_label'"])
    assert.ok(body.includes(proof), proof);
  assert.doesNotMatch(body, /ledger_(debit|credit)|financial_transactions/);
});

test("buyer confirmation accepts only the seller-frozen label and moves no money", () => {
  const body = migration.split("create function public.confirm_marketplace_return_shipment")[1]
    .split("create function public.refund_marketplace_return_without_shipment")[0];
  assert.match(body, /rs\.return_label_asset_id is null or rs\.label_sent_at is null/);
  assert.match(body, /status='shipped'/);
  assert.match(body, /'return_shipped'/);
  assert.doesNotMatch(body, /p_carrier_name|p_tracking_number|ledger_(debit|credit)|financial_transactions/);
});

test("keep-item refund consumes return escrow once without B7R or beneficiary re-debits", () => {
  const body = migration.split("create function public.refund_marketplace_return_without_shipment")[1]
    .split("create or replace function public.fetch_my_marketplace_order_lifecycle")[0];
  assert.match(body, /account_type='marketplace_return_escrow'/);
  assert.match(body, /'marketplace_return_refund'/);
  assert.match(body, /perform public\.ledger_debit\(v_tx_id,v_return_escrow,h\.gross_amount/);
  assert.match(body, /perform public\.ledger_credit\(v_tx_id,v_buyer_account,h\.gross_amount/);
  assert.match(body, /status='refunded'/);
  assert.doesNotMatch(body, /reverse_marketplace_released_settlement|marketplace_settlement_reversal_legs/);
});

test("parser accepts label-ready and current shipped states", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  const ready = mergeMarketplaceOrderLifecyclePayload(
    base,
    lifecycle(returnShipment("awaiting_buyer_shipment", true)),
  );
  assert.equal(ready.returnRequest?.returnShipment?.returnLabelFileName, "return-label.pdf");
  assert.equal(ready.returnRequest?.returnShipment?.labelSentAt, at);
  const shipped = mergeMarketplaceOrderLifecyclePayload(base, lifecycle(returnShipment("shipped", true)));
  assert.equal(shipped.returnRequest?.returnShipment?.status, "shipped");
});

test("parser accepts the single historical shipped-without-label shape", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  const legacy = mergeMarketplaceOrderLifecyclePayload(
    base,
    lifecycle(returnShipment("shipped", false)),
  );
  assert.equal(legacy.returnRequest?.returnShipment?.returnLabelAssetId, null);
  assert.equal(legacy.returnRequest?.returnShipment?.trackingNumber, "1Z-R2B3");
});

test("parser fails closed for incomplete or malformed new label states", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload);
  for (const malformed of [
    returnShipment("awaiting_buyer_shipment", true, { label_sent_at: null }),
    returnShipment("awaiting_buyer_shipment", true, { return_label_file_name: "label.png" }),
    returnShipment("awaiting_buyer_shipment", true, { tracking_number: "CLIENT-TRACKING" }),
  ]) assert.throws(
    () => mergeMarketplaceOrderLifecyclePayload(base, lifecycle(malformed)),
    MarketplaceFulfillmentPayloadError,
  );
});

test("refunded return receipt is strict and exposes only keep-item result", () => {
  const receipt = parseMarketplaceReturnMutationReceipt({
    money_moved: true,
    return_request: {
      id: id("5"), order_id: id("1"), status: "refunded", buyer_note: "Return it",
      seller_note: "Keep it", created_at: at, decided_at: at,
      refund_hold: { status: "held", gross_amount: 50, held_at: at },
      refund: { mode: "keep_item", gross_amount: 50, refunded_at: at },
      return_shipment: null,
    },
  });
  assert.equal(receipt.returnRequest.status, "refunded");
  assert.equal(receipt.returnRequest.refund?.grossAmount, 50);
  assert.equal(marketplaceReturnStatusCopy("refunded").title, "Reembolso completado");
  assert.throws(() => parseMarketplaceReturnMutationReceipt({
    money_moved: true,
    return_request: { ...receipt.returnRequest, refund_hold: null },
  }), MarketplaceFulfillmentPayloadError);
});

test("seller and buyer awareness include label_pending and labelSent", () => {
  const page = parseSellerReturnIndexPayload({
    attention_count: 1, requested_count: 0, approved_count: 1,
    funding_pending_count: 0, label_pending_count: 1,
    receipt_confirmation_pending_count: 0,
    returns: [{ return_id: id("5"), status: "approved", created_at: at,
      attention_reason: "label_pending", return_shipping_status: "awaiting_buyer_shipment",
      order_id: id("1"), order_number: "ORD-R2B3", order_status: "delivered",
      store_id: id("3"), store_name: "Store" }], next_cursor: null,
  }, 20);
  assert.equal(page.labelPendingCount, 1);
  const buyer = parseBuyerOrderListPayload([{
    id: id("1"), order_number: "ORD-R2B3", checkout_id: id("2"), checkout_reference: "CHK",
    status: "delivered", store_id: id("3"), store_name: "Store", total: 50, currency: "BDAG",
    created_at: at, confirmed_at: at, processing_at: at, shipped_at: at, delivered_at: at,
    distinct_lines: 1, total_quantity: 1, carrier_name: null, tracking_number: null,
    first_item_title: "Product", first_item_image: null, payment_status: "paid",
    return_progress: { return_id: id("5"), status: "approved",
      return_shipping_status: "awaiting_buyer_shipment", label_sent: true },
  }], 20).items[0];
  assert.equal(buyer.returnProgress?.labelSent, true);
});

test("active client flow has no manual buyer carrier authority", () => {
  assert.match(service, /export async function sendMarketplaceReturnLabel/);
  assert.match(service, /export async function confirmMarketplaceReturnShipment/);
  assert.match(service, /export async function refundMarketplaceReturnWithoutShipment/);
  assert.doesNotMatch(service, /export async function shipMarketplaceReturn/);
  assert.match(panel, /uploadMediaFromUri/);
  assert.match(panel, /purpose: "return_label"/);
  assert.match(panel, /Abrir \/ imprimir label/);
  assert.match(panel, /Confirmar que entregué el paquete/);
  assert.match(panel, /Reembolsar y permitir que conserve el producto/);
});

test("return label cleanup preserves ambiguous attempts and cleans definitive failures", () => {
  const body = panel.split("const sendReturnLabel = async () => {")[1]
    .split("const confirmSendReturnLabel")[0];
  assert.doesNotMatch(panel, /uploadedNow/);
  assert.match(body, /if \(assetId && !ambiguous\) \{/);

  const cleanup = body.split("if (assetId && !ambiguous) {")[1]
    .split('Alert.alert("No se pudo enviar el label"')[0];
  const successfulCleanup = cleanup.split("} catch {")[0];
  const failedCleanup = cleanup.split("} catch {")[1];

  assert.match(successfulCleanup, /await deleteMediaAsset\(assetId\);/);
  assert.match(successfulCleanup, /setUploadedLabelAssetId\(null\);/);
  assert.match(successfulCleanup, /shippingAttempt\.current = null;/);
  assert.doesNotMatch(failedCleanup, /setUploadedLabelAssetId\(null\)/);
  assert.doesNotMatch(failedCleanup, /shippingAttempt\.current = null/);

  const ambiguousGuard = body.indexOf("if (assetId && !ambiguous)");
  const deleteAttempt = body.indexOf("await deleteMediaAsset(assetId)");
  assert.ok(ambiguousGuard >= 0 && ambiguousGuard < deleteAttempt);
});

test("return label media registry and private read authority are exact", () => {
  assert.match(media, /return_label:\s*\{\s*kind: "document",\s*maxBytes: 10_000_000,\s*mimeTypes: \["application\/pdf"\],\s*defaultVisibility: "private"/);
  assert.match(mediaUrl, /entity_type','marketplace_return_shipment'/);
  assert.match(mediaUrl, /slot','return_label'/);
  assert.match(mediaUrl, /eq\('return_label_asset_id',assetId\)/);
  assert.match(mediaUrl, /buyer_id\.eq\.\$\{userId\},seller_id\.eq\.\$\{userId\}/);
});

test("F1 reconciler reports legacy shipments once without invalid-state double counting", () => {
  assert.match(corrective, /'legacy_shipped_without_label'/);
  const invalid = corrective.split("'invalid_tracking_state'")[1];
  assert.match(invalid, /rs\.status='awaiting_buyer_shipment'/);
  assert.doesNotMatch(invalid, /rs\.status='shipped' and rs\.return_label_asset_id is null/);
});
