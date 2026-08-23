import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnMutationReceipt,
} from "../services/marketplaceFulfillmentParsers.mjs";
import {
  marketplaceOrderTimelineItems,
  marketplaceReturnStatusCopy,
} from "../services/marketplaceOrderPresentation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260822165852_marketplace_post_settlement_returns_r2a.sql");
const service = read("services/marketplaceFulfillmentService.ts");
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const buyer = read("app/orders/[id].tsx");
const seller = read("app/seller/orders/[id].tsx");
const proof = read("scripts/prove-marketplace-order-lifecycle.mjs");
const at = "2026-08-22T16:00:00.000Z";
const ids = {
  order: "11111111-1111-4111-8111-111111111111",
  checkout: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  returnRequest: "55555555-5555-4555-8555-555555555555",
  dispute: "66666666-6666-4666-8666-666666666666",
  event: "77777777-7777-4777-8777-777777777777",
};

const detailPayload = () => ({
  order: {
    id: ids.order,
    order_number: "ORD-R2A",
    checkout_id: ids.checkout,
    checkout_reference: "CHK-R2A",
    status: "delivered",
    currency: "BDAG",
    total: 50,
    created_at: at,
    confirmed_at: at,
    processing_at: at,
    shipped_at: at,
    delivered_at: at,
    fulfillment_version: 4,
  },
  store: { id: ids.store, name: "Tienda R2A", slug: "tienda-r2a" },
  payment: { status: "paid", paid_at: at },
  allocation: null,
  settlement: {
    status: "completed",
    gross_amount: 50,
    seller_net_amount: null,
    platform_fee_amount: null,
    confirmed_at: at,
    released_at: at,
    seller_bdag_balance: null,
  },
  shipping_address: {
    recipient_name: "Comprador",
    line1: "Calle Uno",
    line2: null,
    city: "Miami",
    region: "FL",
    postal_code: "33101",
    country: "US",
    phone: null,
  },
  items: [{
    id: ids.item,
    product_title: "Producto",
    variant_title: null,
    sku: "SKU-R2A",
    options: [],
    image_url: null,
    unit_price: 50,
    quantity: 1,
    line_total: 50,
  }],
  shipment: null,
  events: [],
  escrow_protected: false,
});

const lifecycle = (returnRequest, returnEligible = false) => ({
  shipping_amount: 0,
  shipping: null,
  shipping_snapshot: null,
  dispute: {
    id: ids.dispute,
    status: "resolved",
    reason_code: "other",
    buyer_note: "Reclamo anterior",
    created_at: at,
    outcome: "reject_claim",
    affected_item_ids: [ids.item],
    buyer_evidence_asset_ids: [],
    seller_response: null,
  },
  return_eligible: returnEligible,
  return_request: returnRequest,
});

const rawReturn = (overrides = {}) => ({
  id: ids.returnRequest,
  status: "requested",
  buyer_note: "Quiero devolver el pedido",
  seller_note: null,
  created_at: at,
  decided_at: null,
  refund_hold: null,
  ...overrides,
});

test("lifecycle preserves protected dispute and canonical return independently", () => {
  const detail = parseMarketplaceOrderDetailPayload(detailPayload());
  const merged = mergeMarketplaceOrderLifecyclePayload(detail, lifecycle(rawReturn()));
  assert.equal(merged.dispute?.outcome, "reject_claim");
  assert.equal(merged.returnRequest?.id, ids.returnRequest);
  assert.equal(merged.returnRequest?.status, "requested");
  assert.equal(merged.returnEligible, false);
  assert.equal(detail.returnRequest, null);
});

test("return lifecycle parser accepts canonical states and fails closed", () => {
  const detail = parseMarketplaceOrderDetailPayload(detailPayload());
  for (const [status, decidedAt] of [
    ["requested", null],
    ["approved", at],
    ["rejected", at],
  ]) {
    const merged = mergeMarketplaceOrderLifecyclePayload(
      detail,
      lifecycle(rawReturn({ status, decided_at: decidedAt })),
    );
    assert.equal(merged.returnRequest?.status, status);
  }
  for (const malformed of [
    rawReturn({ id: "bad" }),
    rawReturn({ status: "refunded" }),
    rawReturn({ status: "approved", decided_at: null }),
    rawReturn({ status: "requested", decided_at: at }),
  ])
    assert.throws(
      () => mergeMarketplaceOrderLifecyclePayload(detail, lifecycle(malformed)),
      MarketplaceFulfillmentPayloadError,
    );
  assert.throws(
    () => mergeMarketplaceOrderLifecyclePayload(detail, lifecycle(null, "yes")),
    MarketplaceFulfillmentPayloadError,
  );
});

test("mutation receipt proves zero money movement and validates canonical fields", () => {
  const receipt = parseMarketplaceReturnMutationReceipt({
    return_request: { ...rawReturn(), order_id: ids.order },
    money_moved: false,
  });
  assert.equal(receipt.moneyMoved, false);
  assert.equal(receipt.returnRequest.orderId, ids.order);
  assert.throws(
    () => parseMarketplaceReturnMutationReceipt({
      return_request: { ...rawReturn(), order_id: ids.order },
      money_moved: true,
    }),
    MarketplaceFulfillmentPayloadError,
  );
  const funded = parseMarketplaceReturnMutationReceipt({
    return_request: {
      ...rawReturn({
        status: "approved",
        decided_at: at,
        refund_hold: { status: "held", gross_amount: 50, held_at: at },
      }),
      order_id: ids.order,
    },
    money_moved: true,
  });
  assert.equal(funded.moneyMoved, true);
  assert.equal(funded.returnRequest.refundHold?.grossAmount, 50);
  const fundedReplay = parseMarketplaceReturnMutationReceipt({
    return_request: {
      ...rawReturn({
        status: "approved",
        decided_at: at,
        refund_hold: { status: "held", gross_amount: 50, held_at: at },
      }),
      order_id: ids.order,
    },
    money_moved: false,
  });
  assert.equal(fundedReplay.moneyMoved, false);
  assert.equal(fundedReplay.returnRequest.refundHold?.status, "held");
});

test("return status copy and timeline are explicit without financial inference", () => {
  assert.deepEqual(marketplaceReturnStatusCopy("requested"), {
    title: "Solicitud de devolución enviada",
    body: "Esperando respuesta del vendedor.",
  });
  assert.equal(marketplaceReturnStatusCopy("approved").title, "Devolución aceptada");
  assert.match(marketplaceReturnStatusCopy("approved", true).body, /reembolso está protegido/);
  assert.equal(
    marketplaceReturnStatusCopy("rejected").title,
    "Devolución rechazada por el vendedor",
  );
  const items = marketplaceOrderTimelineItems([
    { id: ids.event, eventType: "return_requested", fromStatus: "delivered", toStatus: "delivered", actorRole: "buyer", disputeOutcome: null, createdAt: at },
  ]);
  assert.equal(items[0].label, "Solicitud de devolución enviada");
});

test("migration creates one hardened non-financial return authority", () => {
  assert.match(migration, /create table public\.marketplace_return_requests/);
  assert.match(migration, /unique\(order_id\)/);
  assert.match(migration, /unique\(buyer_id,request_idempotency_key\)/);
  assert.match(migration, /status in\('requested','approved','rejected'\)/);
  assert.match(migration, /alter table public\.marketplace_return_requests enable row level security/);
  assert.match(migration, /revoke all on table public\.marketplace_return_requests from public,anon,authenticated/);
  assert.match(migration, /grant all on table public\.marketplace_return_requests to service_role/);
  assert.match(migration, /security definer[\s\S]*set search_path=pg_catalog,public/);
  assert.match(migration, /revoke all on function public\.request_marketplace_return[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.request_marketplace_return[\s\S]*to authenticated,service_role/);
  assert.doesNotMatch(migration, /create table public\.marketplace_order_returns|create table public\.marketplace_order_disputes/);
});

test("buyer eligibility is delivered plus one canonical unreversed released settlement", () => {
  for (const marker of [
    "v_order.status<>'delivered'",
    "v_payment.status<>'paid'",
    "v_allocation.status<>'released'",
    "v_settlement_count<>1",
    "v_settlement.status<>'completed'",
    "v_settlement.released_at is null",
    "marketplace_settlement_reversals",
    "d.status in('open','under_review')",
  ]) assert.ok(migration.includes(marker), marker);
  assert.match(migration, /where buyer_id=v_actor and request_idempotency_key=p_idempotency_key/);
  assert.match(migration, /marketplace_return_idempotency_conflict/);
  assert.match(migration, /marketplace_return_already_requested/);
  assert.match(migration, /'money_moved',false/);
});

test("seller decision is exact-owner, one-time, idempotent and non-financial", () => {
  assert.match(migration, /v_request\.seller_id<>v_actor/);
  assert.match(migration, /v_decision not in\('approve','reject'\)/);
  assert.match(migration, /if v_request\.status<>'requested'/);
  assert.match(migration, /marketplace_return_decision_idempotency_conflict/);
  assert.match(migration, /marketplace_return_already_decided/);
  assert.match(migration, /case v_decision when'approve'then'approved'else'rejected'end/);
  assert.doesNotMatch(migration, /insert into public\.(?:financial_transactions|marketplace_settlement_reversals|marketplace_order_disputes)/);
  assert.doesNotMatch(migration, /update public\.(?:marketplace_payments|marketplace_payment_allocations|marketplace_order_settlements|ledger_accounts|marketplace_orders)/);
  assert.doesNotMatch(migration, /ledger_debit|ledger_credit|atomic_ledger_transfer|reverse_marketplace_released_settlement\s*\(/);
  assert.match(proof, /order_lifecycle_disposable_connection_required/);
  assert.match(proof, /\["127\.0\.0\.1","localhost"\]/);
  assert.match(proof, /url\.port!=="55422"/);
  assert.match(proof, /ids\.otherSeller/);
  assert.match(proof, /jsonb_object_agg\(id,balance order by id\)/);
});

test("canonical order history is reused for request and seller decision", () => {
  assert.match(migration, /'return_requested'/);
  assert.match(migration, /'return_approved'/);
  assert.match(migration, /'return_rejected'/);
  assert.match(migration, /insert into public\.marketplace_order_events/);
  assert.doesNotMatch(migration, /create table public\.[a-z_]*return[a-z_]*events/);
});

test("service and existing detail routes expose request and decision only", () => {
  assert.match(service, /request_marketplace_return/);
  assert.match(service, /respond_to_marketplace_return/);
  assert.match(service, /parseMarketplaceReturnMutationReceipt/);
  assert.match(service, /fetchBuyerOrder\(orderId\)/);
  assert.match(service, /fetchSellerOrder\(orderId\)/);
  assert.match(panel, /La devolución queda sujeta a la aprobación del vendedor/);
  assert.match(panel, /El comprador todavía no recibirá el dinero/);
  assert.match(panel, /current\.status === "requested"/);
  assert.match(buyer, /MarketplaceReturnPanel role="buyer"/);
  assert.match(seller, /MarketplaceReturnPanel role="seller"/);
  assert.match(seller, /MarketplaceSellerDisputePanel/);
  assert.doesNotMatch(panel, /reverseMarketplace|refundMarketplace|ledger|escrow/);
});
