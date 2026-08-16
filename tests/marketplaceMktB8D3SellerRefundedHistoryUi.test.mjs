import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseMarketplaceOrderDetailPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";
import {
  buyerOrderProtectionMessage,
  formatOrderNumberForList,
  marketplaceDisputeOutcomeMessage,
  marketplaceDisputeReasonLabel,
} from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260816022000_marketplace_seller_purchase_history.sql");
const buyerList = read("app/orders/index.tsx");
const buyerDetail = read("app/orders/[id].tsx");
const sellerDetail = read("app/seller/orders/[id].tsx");
const c6 = read("supabase/migrations/20260816021000_fix_marketplace_buyer_purchase_history_paid_evidence.sql");
const remoteAudit = read("scripts/audit-marketplace-b8d3-c7-remote.mjs");
const app = JSON.parse(read("app.json"));
const at = "2026-08-16T12:00:00.000Z";

const detail = (orderStatus, paymentStatus, allocationStatus) => ({
  order: {
    id: "11111111-1111-4111-8111-111111111111",
    order_number: "ORD-1C55CD4F7E1D446D",
    checkout_id: "22222222-2222-4222-8222-222222222222",
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
  store: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Tienda real",
    slug: "tienda-real",
  },
  payment: { status: paymentStatus, paid_at: at },
  allocation: {
    gross_amount: 25,
    platform_fee_amount: 2.5,
    seller_net_amount: 22.5,
    status: allocationStatus,
    released_at: allocationStatus === "released" ? at : null,
  },
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
    id: "44444444-4444-4444-8444-444444444444",
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

test("seller detail accepts canonical fully refunded history", () => {
  const parsed = parseMarketplaceOrderDetailPayload(detail("refunded", "refunded", "refunded"));
  assert.equal(parsed.order.status, "refunded");
  assert.equal(parsed.payment.status, "refunded");
  assert.equal(parsed.allocation?.status, "refunded");
});

test("seller detail accepts canonical partially refunded history", () => {
  const parsed = parseMarketplaceOrderDetailPayload(
    detail("partially_refunded", "partially_refunded", "partially_refunded"),
  );
  assert.equal(parsed.allocation?.status, "partially_refunded");
});

test("seller parser fails closed for incompatible historical allocation states", () => {
  for (const payload of [
    detail("refunded", "refunded", "released"),
    detail("delivered", "paid", "refunded"),
    detail("processing", "paid", "released"),
    detail("partially_refunded", "partially_refunded", "held"),
  ]) {
    assert.throws(
      () => parseMarketplaceOrderDetailPayload(payload),
      MarketplaceFulfillmentPayloadError,
    );
  }
});

test("seller RPC uses historical-paid evidence and explicit payment states", () => {
  assert.match(migration, /c\.status = 'paid'/);
  assert.match(migration, /p\.paid_at is not null/);
  assert.match(migration, /p\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.doesNotMatch(migration, /c\.paid_at/);
});

test("seller RPC preserves ownership approval and active owned store security", () => {
  assert.match(migration, /o\.seller_id <> auth\.uid\(\)/);
  assert.match(migration, /user_id = auth\.uid\(\) and status = 'approved'/);
  assert.match(migration, /id = o\.store_id and seller_id = auth\.uid\(\) and status = 'active'/);
  assert.match(migration, /marketplace_order_not_owned/);
});

test("seller allocation matrix is explicit for active delivered and refund history", () => {
  assert.match(migration, /o\.status in \('confirmed', 'processing', 'shipped', 'cancelled'\)[\s\S]*p\.status = 'paid'[\s\S]*a\.status = 'held'/);
  assert.match(migration, /o\.status = 'delivered'[\s\S]*p\.status = 'paid'[\s\S]*a\.status = 'released'/);
  assert.match(migration, /o\.status = 'refunded'[\s\S]*p\.status in \('paid', 'refunded'\)[\s\S]*a\.status = 'refunded'/);
  assert.match(migration, /o\.status = 'partially_refunded'[\s\S]*p\.status in \('paid', 'partially_refunded'\)[\s\S]*a\.status = 'partially_refunded'/);
});

test("seller history migration changes read authority only", () => {
  assert.doesNotMatch(migration, /update public\.|insert into public\.|delete from public\.|ledger_|atomic_ledger_transfer|seller_start_marketplace_order_processing|seller_ship_marketplace_order/i);
  assert.match(migration, /revoke all on function public\.fetch_my_marketplace_sale\(uuid\)/);
  assert.match(migration, /grant execute[\s\S]*to authenticated, service_role/);
});

test("refunded seller UI has no fulfillment action and shows dispute context", () => {
  assert.match(sellerDetail, /data\.order\.status==='confirmed'\?<[\s\S]*Preparar pedido/);
  assert.match(sellerDetail, /data\.order\.status==='processing'\?<[\s\S]*Marcar como enviado/);
  assert.doesNotMatch(sellerDetail, /data\.order\.status==='refunded'[\s\S]{0,160}(Preparar pedido|Marcar como enviado)/);
  assert.match(sellerDetail, /marketplaceDisputeReasonLabel\(data\.dispute\.reasonCode\)/);
  assert.match(sellerDetail, /marketplaceDisputeOutcomeMessage\(data\.dispute\)/);
});

test("known dispute reasons are safe user-readable Spanish labels", () => {
  assert.equal(marketplaceDisputeReasonLabel("not_received"), "No recibí el pedido");
  assert.equal(marketplaceDisputeReasonLabel("damaged"), "Producto dañado");
  assert.equal(marketplaceDisputeReasonLabel("incorrect_item"), "Producto incorrecto");
  assert.equal(marketplaceDisputeReasonLabel("missing_items"), "Faltan artículos");
  assert.equal(marketplaceDisputeReasonLabel("other"), "Otro problema");
  assert.equal(marketplaceDisputeReasonLabel("private_unknown"), "Problema reportado");
});

test("buyer filter rail and chips have bounded non-stretching height", () => {
  assert.match(buyerList, /style=\{styles\.filterRail\}/);
  assert.match(buyerList, /filterRail: \{ flexGrow: 0, height: 52, maxHeight: 52 \}/);
  assert.match(buyerList, /filters: \{ flexDirection: 'row', alignItems: 'center'/);
  assert.match(buyerList, /chip: \{ height: 40, maxHeight: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center'/);
  assert.match(buyerList, /hitSlop=\{2\}/);
  assert.match(buyerList, /horizontal/);
  assert.doesNotMatch(buyerList, /flexWrap/);
});

test("buyer order number presentation is deterministic and canonical data is retained", () => {
  assert.equal(formatOrderNumberForList("ORD-1C55CD4F7E1D446D"), "ORD-1C55…D446D");
  assert.equal(formatOrderNumberForList("ORD-123"), "ORD-123");
  assert.match(buyerList, /formatOrderNumberForList\(item\.orderNumber\)/);
  assert.match(buyerList, /accessibilityLabel=\{`Ver pedido \$\{item\.orderNumber\}`\}/);
  assert.match(buyerList, /router\.push\(`\/orders\/\$\{item\.id\}` as never\)/);
});

test("buyer cards protect title metadata and status across compact widths", () => {
  assert.match(buyerList, /useWindowDimensions/);
  assert.match(buyerList, /COMPACT_BREAKPOINT = 390/);
  assert.match(buyerList, /ICON_ONLY_STATUS_BREAKPOINT = 350/);
  assert.match(buyerList, /cardContent: \{ flex: 1, flexShrink: 1, minWidth: 0 \}/);
  assert.match(buyerList, /statusSlot: \{ flexShrink: 0 \}/);
  assert.match(buyerList, /numberOfLines=\{2\}/);
  assert.match(buyerList, /compact=\{compact\}/);
  assert.match(buyerList, /showLabel=\{!iconOnlyStatus\}/);
});

test("resolved refund messaging is final and never claims the payment is paused", () => {
  const refund = { status: "resolved", reasonCode: "damaged", outcome: "refund_buyer" };
  assert.equal(marketplaceDisputeOutcomeMessage(refund), "El reembolso fue completado.");
  assert.equal(buyerOrderProtectionMessage("refunded", refund), "El reembolso fue completado.");
  assert.doesNotMatch(buyerDetail, /Liquidación pausada por el problema reportado/);
  assert.match(buyerDetail, /buyerOrderProtectionMessage\(data\.order\.status, data\.dispute\)/);
});

test("open release and rejected dispute messages follow canonical status and outcome", () => {
  assert.equal(
    marketplaceDisputeOutcomeMessage({ status: "under_review", reasonCode: "other", outcome: null }),
    "El pago permanece pausado mientras revisamos el problema.",
  );
  assert.equal(
    marketplaceDisputeOutcomeMessage({ status: "resolved", reasonCode: "other", outcome: "release_seller" }),
    "La revisión terminó y los fondos fueron liberados al vendedor.",
  );
  assert.equal(
    marketplaceDisputeOutcomeMessage({ status: "rejected", reasonCode: "other", outcome: "reject_claim" }),
    "El reclamo fue rechazado.",
  );
});

test("C6 buyer historical eligibility remains strict and excludes unpaid checkouts", () => {
  assert.match(c6, /c\.status = 'paid'/);
  assert.match(c6, /p\.paid_at is not null/);
  assert.match(c6, /p\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.doesNotMatch(c6, /c\.status in \([^)]*expired|c\.status in \([^)]*cancelled/i);
});

test("Build remains 22", () => {
  assert.equal(app.expo.ios.buildNumber, "22");
});

test("C7 auditor verifies seller buyer and unrelated-seller contracts read-only", () => {
  assert.match(remoteAudit, /fetch_my_marketplace_sales\('refunded',50,null,null\)/);
  assert.match(remoteAudit, /fetch_my_marketplace_sale\(\$1\)/);
  assert.match(remoteAudit, /fetch_my_marketplace_orders\('delivered',50,null,null\)/);
  assert.match(remoteAudit, /unrelated_seller_denied: true/);
  assert.match(remoteAudit, /mutated: false/);
  assert.doesNotMatch(remoteAudit, /update public\.|insert into public\.|delete from public\./i);
});
