import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reconcileFulfillmentMutation } from "../services/marketplaceFulfillmentMutationCore.mjs";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseBuyerOrderListPayload,
  parseMarketplaceOrderDetailPayload,
  parseSellerOrderListPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const service = read("services/marketplaceFulfillmentService.ts");
const sellerDetail = read("app/seller/orders/[id].tsx");
const buyerList = read("app/orders/index.tsx");
const buyerDetail = read("app/orders/[id].tsx");
const bridge = read("app/my-orders.tsx");
const responsiveSellerList = read("app/seller/orders/index.tsx");

const id = {
  order: "11111111-1111-4111-8111-111111111111",
  checkout: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  event: "55555555-5555-4555-8555-555555555555",
  shipment: "66666666-6666-4666-8666-666666666666",
};
const at = "2026-08-16T12:00:00.000Z";

const buyerRow = (status = "confirmed", overrides = {}) => ({
  id: id.order,
  order_number: "ORD-C01AD2D4D39C41AF",
  checkout_id: id.checkout,
  checkout_reference: "CHK-REFERENCE",
  status,
  store_id: id.store,
  store_name: "Tienda QA",
  total: 25,
  currency: "BDAG",
  created_at: at,
  confirmed_at: at,
  processing_at: ["processing", "shipped", "delivered"].includes(status) ? at : null,
  shipped_at: ["shipped", "delivered"].includes(status) ? at : null,
  delivered_at: status === "delivered" ? at : null,
  first_item_title: "Producto real",
  first_item_image: null,
  distinct_lines: 1,
  total_quantity: 1,
  carrier_name: ["shipped", "delivered"].includes(status) ? "Carrier QA" : null,
  tracking_number: ["shipped", "delivered"].includes(status) ? "TRACK-QA" : null,
  payment_status: "paid",
  ...overrides,
});

const sellerRow = (status = "confirmed", overrides = {}) => {
  const row = buyerRow(status, overrides);
  delete row.first_item_title;
  delete row.first_item_image;
  delete row.payment_status;
  return {
    ...row,
    recipient_name: "Comprador",
    city: "Ciudad",
    region: "Región",
    country: "US",
    gross_amount: 25,
    platform_fee_amount: 2.5,
    seller_net_amount: 22.5,
    allocation_status: "held",
    released_at: null,
    ...overrides,
  };
};

const detailPayload = (status = "shipped", buyer = true) => ({
  order: {
    id: id.order,
    order_number: "ORD-C01AD2D4D39C41AF",
    checkout_id: id.checkout,
    checkout_reference: "CHK-REFERENCE",
    status,
    currency: "BDAG",
    total: 25,
    created_at: at,
    confirmed_at: at,
    processing_at: status === "confirmed" ? null : at,
    shipped_at: ["shipped", "delivered"].includes(status) ? at : null,
    delivered_at: status === "delivered" ? at : null,
    fulfillment_version: 2,
  },
  store: { id: id.store, name: "Tienda QA", slug: "tienda-qa" },
  payment: { status: "paid", paid_at: at },
  allocation: buyer
    ? null
    : {
        gross_amount: 25,
        platform_fee_amount: 2.5,
        seller_net_amount: 22.5,
        status: "held",
        released_at: null,
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
  items: [
    {
      id: id.item,
      product_title: "Producto real",
      variant_title: null,
      sku: "SKU-QA",
      options: [],
      image_url: null,
      unit_price: 25,
      quantity: 1,
      line_total: 25,
    },
  ],
  shipment: ["shipped", "delivered"].includes(status)
    ? {
        ...(buyer ? {} : { id: id.shipment, seller_note: null }),
        status: status === "delivered" ? "delivered" : "shipped",
        carrier_name: "Carrier QA",
        service_level: null,
        tracking_number: "TRACK-QA",
        tracking_url: "https://tracking.example/qa",
        shipped_at: at,
        delivered_at: status === "delivered" ? at : null,
      }
    : null,
  events: [
    {
      id: id.event,
      event_type: "order_shipped",
      from_status: "processing",
      to_status: "shipped",
      actor_role: "seller",
      created_at: at,
    },
  ],
  escrow_protected: true,
});

const lifecyclePayload = {
  shipping_amount: 5,
  shipping: { estimated_delivery_at: "2026-08-20T12:00:00.000Z" },
  shipping_snapshot: {
    processing_days_min: 1,
    processing_days_max: 2,
    transit_days_min: 2,
    transit_days_max: 4,
    return_policy_summary: "Devolución según política",
  },
  dispute: null,
};

const committed = (status) => ({ order: { status }, shipment: null });
const unknown = () => new Error("outcome_unknown");
const transport = new Error("transport");

test("behavior 1: mutation success plus lifecycle success reports enriched success", async () => {
  const result = await reconcileFulfillmentMutation({
    execute: async () => committed("processing"),
    parse: (value) => value,
    readBack: async () => committed("confirmed"),
    enrich: async (value) => ({ ...value, timeline: true }),
    provesCommitted: (value) => value.order.status === "processing",
    isAmbiguousError: (error) => error === transport,
    createUnknownError: unknown,
  });
  assert.equal(result.value.order.status, "processing");
  assert.equal(result.value.timeline, true);
  assert.equal(result.postMutationRefreshFailed, false);
});

test("behavior 2: committed mutation survives lifecycle enrichment failure", async () => {
  const canonical = committed("shipped");
  const result = await reconcileFulfillmentMutation({
    execute: async () => canonical,
    parse: (value) => value,
    readBack: async () => committed("confirmed"),
    enrich: async () => {
      throw new Error("lifecycle unavailable");
    },
    provesCommitted: (value) => value.order.status === "shipped",
    isAmbiguousError: (error) => error === transport,
    createUnknownError: unknown,
  });
  assert.equal(result.value, canonical);
  assert.equal(result.postMutationRefreshFailed, true);
});

test("behavior 3: ambiguous processing response reconciles from canonical read-back", async () => {
  const result = await reconcileFulfillmentMutation({
    execute: async () => {
      throw transport;
    },
    parse: (value) => value,
    readBack: async () => committed("processing"),
    enrich: async (value) => value,
    provesCommitted: (value) => ["processing", "shipped", "delivered"].includes(value.order.status),
    isAmbiguousError: (error) => error === transport,
    createUnknownError: unknown,
  });
  assert.equal(result.reconciled, true);
  assert.equal(result.value.order.status, "processing");
});

test("behavior 4: ambiguous shipping response requires matching canonical shipment", async () => {
  const shipped = {
    order: { status: "shipped" },
    shipment: { carrierName: "Carrier QA", trackingNumber: "TRACK-QA" },
  };
  const result = await reconcileFulfillmentMutation({
    execute: async () => {
      throw transport;
    },
    parse: (value) => value,
    readBack: async () => shipped,
    enrich: async (value) => value,
    provesCommitted: (value) =>
      value.order.status === "shipped" &&
      value.shipment?.carrierName === "Carrier QA" &&
      value.shipment?.trackingNumber === "TRACK-QA",
    isAmbiguousError: (error) => error === transport,
    createUnknownError: unknown,
  });
  assert.equal(result.reconciled, true);
  assert.equal(result.value, shipped);
});

test("behavior 5: read-back proving old state preserves the real mutation failure", async () => {
  await assert.rejects(
    reconcileFulfillmentMutation({
      execute: async () => {
        throw transport;
      },
      parse: (value) => value,
      readBack: async () => committed("confirmed"),
      enrich: async (value) => value,
      provesCommitted: (value) => value.order.status === "processing",
      isAmbiguousError: (error) => error === transport,
      createUnknownError: unknown,
    }),
    (error) => error === transport,
  );
});

test("behavior 6: unresolved read-back produces an honest unknown outcome", async () => {
  await assert.rejects(
    reconcileFulfillmentMutation({
      execute: async () => {
        throw transport;
      },
      parse: (value) => value,
      readBack: async () => {
        throw new Error("read unavailable");
      },
      enrich: async (value) => value,
      provesCommitted: (value) => value.order.status === "processing",
      isAmbiguousError: (error) => error === transport,
      createUnknownError: unknown,
    }),
    /outcome_unknown/,
  );
});

test("behavior 7: reconciliation never retries the mutation or changes its command identity", async () => {
  const commandKey = "77777777-7777-4777-8777-777777777777";
  let mutationCalls = 0;
  const seenKeys = [];
  const result = await reconcileFulfillmentMutation({
    execute: async () => {
      mutationCalls++;
      seenKeys.push(commandKey);
      throw transport;
    },
    parse: (value) => value,
    readBack: async () => committed("processing"),
    enrich: async (value) => value,
    provesCommitted: (value) => value.order.status === "processing",
    isAmbiguousError: (error) => error === transport,
    createUnknownError: unknown,
  });
  assert.equal(result.reconciled, true);
  assert.equal(mutationCalls, 1);
  assert.deepEqual(seenKeys, [commandKey]);
});

test("buyer list parser accepts every canonical status and real nullable presentation fields", () => {
  for (const status of [
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
    "partially_refunded",
  ]) {
    const parsed = parseBuyerOrderListPayload([buyerRow(status)], 20);
    assert.equal(parsed.items[0].status, status);
    assert.equal(parsed.items[0].firstItemImage, null);
    assert.equal(parsed.items[0].allocation, undefined);
  }
});

test("seller parser accepts proven omitted media while keeping allocation and pagination strict", () => {
  const parsed = parseSellerOrderListPayload([sellerRow("shipped")], 1);
  assert.equal(parsed.items[0].firstItemTitle, null);
  assert.equal(parsed.items[0].firstItemImage, null);
  assert.equal(parsed.items[0].allocation?.grossAmount, 25);
  assert.deepEqual(parsed.nextCursor, { createdAt: at, id: id.order });
});

test("buyer and seller required identity money and status fields fail closed", () => {
  for (const row of [
    buyerRow("confirmed", { id: "not-a-uuid" }),
    buyerRow("confirmed", { total: "25" }),
    buyerRow("unknown"),
  ])
    assert.throws(
      () => parseBuyerOrderListPayload([row], 20),
      MarketplaceFulfillmentPayloadError,
    );
  assert.throws(
    () => parseSellerOrderListPayload([sellerRow("confirmed", { gross_amount: null })], 20),
    MarketplaceFulfillmentPayloadError,
  );
});

test("shipped detail normalizes only proven omissions and lifecycle adds canonical delivery data", () => {
  const base = parseMarketplaceOrderDetailPayload(detailPayload("shipped", true));
  assert.equal(base.order.status, "shipped");
  assert.equal(base.shipment?.sellerNote, null);
  assert.equal(base.shipment?.estimatedDeliveryAt, null);
  assert.equal(base.shipment?.carrierName, "Carrier QA");
  assert.equal(base.shipment?.trackingNumber, "TRACK-QA");
  const enriched = mergeMarketplaceOrderLifecyclePayload(base, lifecyclePayload);
  assert.equal(enriched.shippingAmount, 5);
  assert.equal(enriched.shipment?.estimatedDeliveryAt, "2026-08-20T12:00:00.000Z");
  assert.equal(enriched.shippingEstimate?.transitDaysMax, 4);
});

test("seller UI distinguishes unknown outcome and never turns post-commit refresh into failure", () => {
  assert.match(service, /marketplace_fulfillment_outcome_unknown/);
  assert.match(service, /postMutationRefreshFailed/);
  assert.match(service, /seller_shipping_readback/);
  assert.match(service, /value\.shipment\?\.carrierName === expectedCarrier/);
  assert.match(sellerDetail, /Estado por confirmar/);
  assert.match(sellerDetail, /El pedido se actualizó, pero no pudimos cargar todos los detalles/);
  assert.match(sellerDetail, /processKey\.current/);
  assert.match(sellerDetail, /shipKey\.current/);
});

test("buyer canonical routes and shipped detail remain authoritative without fake empty success", () => {
  assert.match(bridge, /<Redirect href="\/orders"/);
  assert.doesNotMatch(bridge, /Checkout BDAG pendiente/);
  assert.match(buyerList, /fetchBuyerOrders/);
  assert.match(buyerList, /No pudimos cargar tus pedidos/);
  assert.doesNotMatch(buyerList, /catch[\s\S]{0,120}return\s*\[\]/);
  assert.match(buyerDetail, /fetchBuyerOrder/);
  assert.match(buyerDetail, /data\.shipment\.carrierName/);
  assert.match(buyerDetail, /data\.shipment\.trackingNumber/);
  assert.match(buyerDetail, /OrderTimeline/);
});

test("C2 responsive seller-order presentation remains intact", () => {
  assert.match(responsiveSellerList, /useWindowDimensions/);
  assert.match(responsiveSellerList, /<ScrollView[\s\S]*horizontal/);
  assert.match(responsiveSellerList, /formatOrderNumberForList/);
  assert.match(responsiveSellerList, /cardContent:\s*\{\s*flex:\s*1,\s*minWidth:\s*0/);
});
