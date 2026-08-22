import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseMarketplaceOrderDetailPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";

const at = "2026-08-22T13:40:06.676Z";
const fixture = ({
  orderStatus = "shipped",
  paymentStatus = "paid",
  allocationStatus = "released",
  allocation = {},
  settlement = {},
} = {}) => ({
  order: {
    id: "3ae2c2d6-8c3a-471f-892c-791c00945b45",
    order_number: "ORD-3AE2C2D68C3A471F",
    checkout_id: "11111111-1111-4111-8111-111111111111",
    checkout_reference: "CHK-F1B-PARSER",
    status: orderStatus,
    currency: "BDAG",
    total: 50,
    created_at: at,
    confirmed_at: at,
    processing_at: ["processing", "shipped", "delivered"].includes(orderStatus) ? at : null,
    shipped_at: ["shipped", "delivered"].includes(orderStatus) ? at : null,
    delivered_at: orderStatus === "delivered" ? at : null,
    fulfillment_version: 2,
  },
  store: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Tienda F1B",
    slug: "tienda-f1b",
  },
  payment: { status: paymentStatus, paid_at: at },
  allocation:
    allocation === null
      ? null
      : {
          status: allocationStatus,
          gross_amount: 50,
          seller_net_amount: 45,
          platform_fee_amount: 5,
          released_at: allocationStatus === "released" ? at : null,
          ...allocation,
        },
  settlement:
    settlement === null
      ? null
      : {
          status: "completed",
          gross_amount: 50,
          seller_net_amount: 45,
          platform_fee_amount: 5,
          confirmed_at: at,
          released_at: at,
          seller_bdag_balance: 45,
          ...settlement,
        },
  shipping_address: {
    recipient_name: "Comprador F1B",
    line1: "Dirección protegida",
    line2: null,
    city: "Miami",
    region: "Florida",
    postal_code: "33101",
    country: "US",
    phone: null,
  },
  items: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      product_title: "Producto reservado",
      variant_title: null,
      sku: "SKU-F1B",
      options: [],
      image_url: null,
      unit_price: 50,
      quantity: 1,
      line_total: 50,
    },
  ],
  shipment: {
    id: "44444444-4444-4444-8444-444444444444",
    status: orderStatus === "delivered" ? "delivered" : "shipped",
    carrier_name: "Carrier F1B",
    service_level: "Ground",
    tracking_number: "TRACK-F1B",
    tracking_url: "https://tracking.example/f1b",
    seller_note: null,
    shipped_at: at,
    delivered_at: orderStatus === "delivered" ? at : null,
    estimated_delivery_at: null,
  },
  events: [],
  escrow_protected: false,
});

const expectPayloadError = (payload, path) =>
  assert.throws(
    () => parseMarketplaceOrderDetailPayload(payload),
    (error) =>
      error instanceof MarketplaceFulfillmentPayloadError && error.path === path,
  );

test("production-like shipped Admin release parses from a matching completed settlement", () => {
  const parsed = parseMarketplaceOrderDetailPayload(fixture());
  assert.equal(parsed.order.status, "shipped");
  assert.equal(parsed.payment.status, "paid");
  assert.equal(parsed.allocation?.status, "released");
  assert.equal(parsed.settlement?.status, "completed");
  assert.equal(parsed.settlement?.grossAmount, parsed.allocation?.grossAmount);
  assert.equal(parsed.settlement?.sellerNetAmount, parsed.allocation?.sellerNetAmount);
  assert.equal(parsed.settlement?.platformFeeAmount, parsed.allocation?.platformFeeAmount);
});

test("existing shipped-held and delivered-released states remain valid", () => {
  const shipped = parseMarketplaceOrderDetailPayload(
    fixture({ allocationStatus: "held", settlement: null }),
  );
  const delivered = parseMarketplaceOrderDetailPayload(
    fixture({ orderStatus: "delivered", settlement: null }),
  );
  assert.equal(shipped.allocation?.status, "held");
  assert.equal(delivered.allocation?.status, "released");
});

test("shipped-released fails closed without a canonical completed settlement", () => {
  expectPayloadError(fixture({ settlement: null }), "order_detail.allocation.status");
  expectPayloadError(
    fixture({ settlement: { status: "pending" } }),
    "order_detail.allocation.status",
  );
  expectPayloadError(
    fixture({ settlement: { released_at: "not-a-timestamp" } }),
    "order_detail.settlement.released_at",
  );
  expectPayloadError(
    fixture({ settlement: { confirmed_at: "not-a-timestamp" } }),
    "order_detail.settlement.confirmed_at",
  );
});

test("shipped-released settlement money must match immutable allocation facts", () => {
  for (const settlement of [
    { gross_amount: 51 },
    { seller_net_amount: 44 },
    { platform_fee_amount: 6 },
    { seller_net_amount: null },
    { platform_fee_amount: null },
  ]) expectPayloadError(fixture({ settlement }), "order_detail.allocation.status");
});

test("refund histories remain valid and unrelated incompatible states remain denied", () => {
  const refunded = parseMarketplaceOrderDetailPayload(
    fixture({
      orderStatus: "refunded",
      paymentStatus: "refunded",
      allocationStatus: "refunded",
      settlement: null,
    }),
  );
  const partial = parseMarketplaceOrderDetailPayload(
    fixture({
      orderStatus: "partially_refunded",
      paymentStatus: "partially_refunded",
      allocationStatus: "partially_refunded",
      settlement: null,
    }),
  );
  assert.equal(refunded.allocation?.status, "refunded");
  assert.equal(partial.allocation?.status, "partially_refunded");
  for (const payload of [
    fixture({ orderStatus: "delivered", allocationStatus: "held", settlement: null }),
    fixture({ orderStatus: "confirmed", settlement: null }),
    fixture({ orderStatus: "processing", settlement: null }),
  ]) expectPayloadError(payload, "order_detail.allocation.status");
  expectPayloadError(
    fixture({ allocationStatus: "held", allocation: { gross_amount: "50" }, settlement: null }),
    "order_detail.allocation.gross_amount",
  );
});

test("seller shipped screen remains read-only and service keeps the canonical parser", () => {
  const screen = readFileSync("app/seller/orders/[id].tsx", "utf8");
  const service = readFileSync("services/marketplaceFulfillmentService.ts", "utf8");
  assert.match(screen, /data\.order\.status==='confirmed'[\s\S]*Preparar pedido/);
  assert.match(screen, /data\.order\.status==='processing'[\s\S]*Marcar como enviado/);
  assert.doesNotMatch(screen, /data\.order\.status==='shipped'[\s\S]{0,160}(Preparar pedido|Marcar como enviado)/);
  assert.match(service, /parseMarketplaceOrderDetailPayload\(response\)/);
});
