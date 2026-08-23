import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnMutationReceipt,
  parseSellerOrderListPayload,
  parseSellerReturnIndexPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/20260823010220_marketplace_return_reverse_escrow_r2b1.sql",
);
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const service = read("services/marketplaceFulfillmentService.ts");
const presentation = read("services/marketplaceOrderPresentation.ts");
const home = read("app/seller/index.tsx");
const orders = read("app/seller/orders/index.tsx");
const inbox = read("app/seller/returns/index.tsx");
const at = "2026-08-23T01:00:00.000Z";
const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const detailPayload = {
  order: {
    id: id("1"), order_number: "ORD-R2B1", checkout_id: id("2"),
    checkout_reference: "CHK-R2B1", status: "delivered", currency: "BDAG", total: 50,
    created_at: at, confirmed_at: at, processing_at: at, shipped_at: at,
    delivered_at: at, fulfillment_version: 4,
  },
  store: { id: id("3"), name: "Return Store", slug: "return-store" },
  payment: { status: "paid", paid_at: at },
  allocation: { status: "released", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, released_at: at },
  settlement: { status: "completed", gross_amount: 50, seller_net_amount: 45,
    platform_fee_amount: 5, confirmed_at: at, released_at: at, seller_bdag_balance: 45 },
  shipping_address: { recipient_name: "Buyer", line1: "Street", line2: null,
    city: "Miami", region: "FL", postal_code: "33101", country: "US", phone: null },
  items: [{ id: id("4"), product_title: "Product", variant_title: null, sku: "R2B1",
    options: [], image_url: null, unit_price: 50, quantity: 1, line_total: 50 }],
  shipment: null,
  events: [],
  escrow_protected: false,
};

const returnRow = (refundHold) => ({
  id: id("5"), status: "approved", buyer_note: "Full return", seller_note: "Accepted",
  created_at: at, decided_at: at, refund_hold: refundHold,
});

test("R2B-1 creates one dedicated immutable custody layer, not another refund engine", () => {
  assert.match(migration, /'marketplace_return_escrow'/);
  assert.match(migration, /on conflict on constraint ledger_accounts_system_unique do nothing/);
  assert.match(migration, /create table public\.marketplace_return_refund_holds/);
  assert.match(migration, /create table public\.marketplace_return_refund_hold_legs/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.marketplace_return_refund_holds,[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /from public,anon,authenticated,service_role/);
  assert.match(migration, /grant select on table public\.marketplace_return_refund_holds/);
  assert.match(migration, /marketplace_return_refund_hold_immutable/);
  assert.doesNotMatch(migration, /create table public\.marketplace_settlement_reversals/);
  assert.doesNotMatch(migration, /create table public\.marketplace_order_disputes/);
});

test("hold core preflights exact immutable legs and all balances before moving funds", () => {
  const core = migration.split("create function public.marketplace_create_return_refund_hold_core")[1]
    .split("create or replace function public.respond_to_marketplace_return")[0];
  for (const marker of [
    "v_leg_total<>s.gross_amount",
    "v_seller_total<>s.seller_net_amount",
    "v_platform_total<>s.platform_fee_amount",
    "v_creator_total<>s.creator_commission_amount",
    "l.leg_type not in('seller_net','platform_fee','creator_commission')",
    "marketplace_return_refund_funding_insufficient_balance",
  ]) assert.ok(core.includes(marker), marker);
  const balanceCheck = core.indexOf("v_balance<account_need.required_debit");
  const holdInsert = core.indexOf("insert into public.marketplace_return_refund_holds");
  const transactionInsert = core.indexOf("insert into public.financial_transactions");
  assert.ok(balanceCheck >= 0 && balanceCheck < holdInsert && holdInsert < transactionInsert);
  assert.match(core, /order by la\.id for update/);
  assert.match(core, /marketplace_return_seller_hold/);
  assert.match(core, /marketplace_return_platform_hold/);
  assert.match(core, /marketplace_return_creator_hold/);
  assert.match(core, /'marketplace_return_refund_hold',h\.id::text/);
});

test("approval funds first, rejection remains non-financial, and legacy funding reuses the core", () => {
  const responder = migration.split("create or replace function public.respond_to_marketplace_return")[1]
    .split("create function public.fund_marketplace_return_refund_hold")[0];
  const coreCall = responder.indexOf("marketplace_create_return_refund_hold_core");
  const transition = responder.indexOf("update public.marketplace_return_requests set");
  assert.ok(coreCall >= 0 && coreCall < transition);
  assert.match(responder, /if v_decision='approve' then/);
  assert.match(responder, /case when v_status='approved'then'return_approved'else'return_rejected'end/);
  const legacy = migration.split("create function public.fund_marketplace_return_refund_hold")[1]
    .split("create or replace function public.fetch_my_marketplace_order_lifecycle")[0];
  assert.match(legacy, /rr\.status<>'approved'/);
  assert.match(legacy, /marketplace_create_return_refund_hold_core/);
  assert.doesNotMatch(migration, /update public\.marketplace_settlement_reversals/);
});

test("active return hold excludes B7R review and reconciliation keeps escrows separate", () => {
  const review = migration.split("create or replace function public.open_marketplace_post_settlement_review")[1]
    .split("create function public.reconcile_marketplace_return_refund_holds")[0];
  assert.match(review, /marketplace_return_refund_holds/);
  assert.match(review, /marketplace_post_settlement_review_return_hold_active/);
  const reconcile = migration.split("create function public.reconcile_marketplace_return_refund_holds")[1];
  for (const key of ["orphan_hold", "orphan_hold_leg", "duplicate_original_leg",
    "hold_amount_mismatch", "hold_leg_sum_mismatch", "settlement_identity_mismatch",
    "wrong_leg_type", "wrong_source_account", "wrong_destination_account",
    "missing_transaction", "transaction_amount_mismatch", "transaction_currency_mismatch",
    "transaction_status_mismatch", "transaction_reference_mismatch",
    "funded_return_state_mismatch", "return_escrow_expected_held_total",
    "return_escrow_actual_balance", "return_escrow_difference",
    "return_escrow_surplus", "return_escrow_shortage"])
    assert.ok(reconcile.includes(`'${key}'`), key);
  assert.doesNotMatch(reconcile, /account_type='marketplace_escrow'/);
});

test("lifecycle and receipts strictly expose funded state without ledger internals", () => {
  const detail = parseMarketplaceOrderDetailPayload(detailPayload);
  const hold = { status: "held", gross_amount: 50, held_at: at };
  const merged = mergeMarketplaceOrderLifecyclePayload(detail, {
    shipping_amount: 0, shipping: null, shipping_snapshot: null, dispute: null,
    return_eligible: false, return_request: returnRow(hold),
  });
  assert.deepEqual(merged.returnRequest?.refundHold, {
    status: "held", grossAmount: 50, heldAt: at,
  });
  const receipt = parseMarketplaceReturnMutationReceipt({
    return_request: { ...returnRow(hold), order_id: id("1") }, money_moved: true,
  });
  assert.equal(receipt.moneyMoved, true);
  for (const malformed of [
    { status: "pending", gross_amount: 50, held_at: at },
    { status: "held", gross_amount: 0, held_at: at },
    { status: "held", gross_amount: 50, held_at: "bad" },
  ]) assert.throws(
    () => mergeMarketplaceOrderLifecyclePayload(detail, {
      shipping_amount: 0, shipping: null, shipping_snapshot: null, dispute: null,
      return_eligible: false, return_request: returnRow(malformed),
    }),
    MarketplaceFulfillmentPayloadError,
  );
  assert.throws(() => parseMarketplaceReturnMutationReceipt({
    return_request: { ...returnRow(null), order_id: id("1") }, money_moved: true,
  }), MarketplaceFulfillmentPayloadError);
  const lifecycleFunction = migration.split("create or replace function public.fetch_my_marketplace_order_lifecycle")[1]
    .split("create or replace function public.fetch_my_marketplace_sales")[0];
  assert.doesNotMatch(lifecycleFunction, /source_account_id|destination_account_id|financial_transaction_id/);
});

test("seller awareness distinguishes decision and unfunded legacy attention", () => {
  const base = {
    id: id("1"), order_number: "ORD-R2B1", checkout_id: id("2"), checkout_reference: "CHK",
    status: "delivered", store_id: id("3"), store_name: "Store", total: 50, currency: "BDAG",
    created_at: at, confirmed_at: at, processing_at: at, shipped_at: at, delivered_at: at,
    distinct_lines: 1, total_quantity: 1, first_item_title: null, first_item_image: null,
    recipient_name: "Buyer", city: "Miami", region: "FL", country: "US",
    gross_amount: 50, platform_fee_amount: 5, seller_net_amount: 45,
    allocation_status: "released", released_at: at, carrier_name: null, tracking_number: null,
    active_dispute: null,
  };
  const approved = parseSellerOrderListPayload([{ ...base, active_return_request: {
    id: id("5"), status: "approved", created_at: at,
  } }], 20).items[0];
  assert.equal(approved.activeReturnRequest?.status, "approved");
  const page = parseSellerReturnIndexPayload({ attention_count: 2, requested_count: 1,
    approved_count: 1, returns: [
      { return_id: id("5"), status: "requested", created_at: at, order_id: id("1"),
        order_number: "ORD-1", order_status: "delivered", store_id: id("3"), store_name: "Store" },
      { return_id: id("6"), status: "approved", created_at: at, order_id: id("7"),
        order_number: "ORD-2", order_status: "delivered", store_id: id("3"), store_name: "Store" },
    ], next_cursor: null }, 20);
  assert.deepEqual(page.returns.map((row) => row.status), ["requested", "approved"]);
  assert.match(home, /fondos por asegurar/);
  assert.match(orders, /Devolución aceptada · Fondos por asegurar/);
  assert.match(inbox, /Fondos por asegurar/);
});

test("buyer and seller copy preserves the R2B-1 boundary", () => {
  assert.match(panel, /El comprador todavía no recibirá el dinero/);
  assert.match(panel, /No hay saldo suficiente para asegurar el reembolso completo/);
  assert.match(panel, /Asegurar fondos del reembolso/);
  assert.match(panel, /Fondos del reembolso asegurados/);
  assert.match(presentation, /Tu reembolso está protegido/);
  assert.match(service, /fund_marketplace_return_refund_hold/);
  assert.doesNotMatch(panel, /tracking|número de guía|confirmar recepción de devolución/i);
});
