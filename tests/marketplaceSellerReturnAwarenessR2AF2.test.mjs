import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseSellerOrderListPayload,
  parseSellerReturnIndexPayload,
} from "../services/marketplaceFulfillmentParsers.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/20260822231419_marketplace_seller_return_awareness_r2a_f2.sql",
);
const service = read("services/marketplaceFulfillmentService.ts");
const home = read("app/seller/index.tsx");
const orders = read("app/seller/orders/index.tsx");
const inbox = read("app/seller/returns/index.tsx");
const panel = read("components/marketplace/MarketplaceReturnPanel.tsx");
const presentation = read("services/marketplaceOrderPresentation.ts");

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const sellerRow = (activeReturnRequest) => ({
  id: id("1"),
  order_number: "ORD-R2AF2",
  checkout_id: id("2"),
  checkout_reference: "CHK-R2AF2",
  status: "delivered",
  store_id: id("3"),
  store_name: "Return Store",
  total: 50,
  currency: "BDAG",
  created_at: "2026-08-22T12:00:00.000Z",
  confirmed_at: "2026-08-22T12:01:00.000Z",
  processing_at: "2026-08-22T12:02:00.000Z",
  shipped_at: "2026-08-22T12:03:00.000Z",
  delivered_at: "2026-08-22T12:04:00.000Z",
  distinct_lines: 1,
  total_quantity: 1,
  first_item_title: null,
  first_item_image: null,
  recipient_name: "Buyer",
  city: "Miami",
  region: "FL",
  country: "US",
  gross_amount: 50,
  platform_fee_amount: 5,
  seller_net_amount: 45,
  allocation_status: "released",
  released_at: "2026-08-22T12:05:00.000Z",
  carrier_name: "Carrier",
  tracking_number: "TRACK-R2AF2",
  active_dispute: null,
  active_return_request: activeReturnRequest,
});

const returnPage = (overrides = {}) => ({
  attention_count: 3,
  requested_count: 1,
  approved_count: 2,
  returns: [
    {
      return_id: id("4"),
      status: "requested",
      created_at: "2026-08-22T13:00:00.000Z",
      order_id: id("1"),
      order_number: "ORD-R2AF2",
      order_status: "delivered",
      store_id: id("3"),
      store_name: "Return Store",
    },
  ],
  next_cursor: null,
  ...overrides,
});

test("F2 extends existing seller authorities and creates no financial architecture", () => {
  assert.match(migration, /create or replace function public\.fetch_my_marketplace_sales/);
  assert.match(migration, /create or replace function public\.fetch_my_marketplace_returns/);
  assert.match(migration, /create or replace function public\.respond_to_marketplace_return/);
  assert.match(migration, /rr\.seller_id=v_actor/);
  assert.match(migration, /rr\.status='requested'/);
  assert.doesNotMatch(
    migration,
    /(?:insert into|update|delete from) public\.(?:ledger_accounts|ledger_entries|financial_transactions|marketplace_order_settlements|marketplace_settlement_legs|marketplace_settlement_reversals|marketplace_settlement_reversal_legs|marketplace_payments|marketplace_payment_allocations)/,
  );
});

test("new approvals fail closed after idempotent replay and before mutation", () => {
  const responder = migration.split(
    "create or replace function public.respond_to_marketplace_return",
  )[1];
  const replay = responder.indexOf("if found then");
  const gate = responder.indexOf("marketplace_return_approval_funding_required");
  const mutation = responder.indexOf("update public.marketplace_return_requests set");
  assert.ok(replay >= 0 && replay < gate && gate < mutation);
  assert.match(responder, /if v_decision='approve' then/);
  assert.match(responder, /if v_request\.status<>'requested' then/);
  assert.doesNotMatch(migration, /update public\.marketplace_return_requests set\s*status='requested'/);
});

test("seller order parser exposes requested and approved-unfunded attention", () => {
  const active = parseSellerOrderListPayload(
    [
      sellerRow({
        id: id("4"),
        status: "requested",
        created_at: "2026-08-22T13:00:00.000Z",
      }),
    ],
    20,
  ).items[0];
  assert.deepEqual(active.activeReturnRequest, {
    id: id("4"),
    status: "requested",
    createdAt: "2026-08-22T13:00:00.000Z",
    attentionReason: "decision_pending",
  });
  assert.equal(parseSellerOrderListPayload([sellerRow(null)], 20).items[0].activeReturnRequest, null);
  const approved = parseSellerOrderListPayload(
    [sellerRow({ id: id("4"), status: "approved", created_at: "2026-08-22T13:00:00.000Z" })],
    20,
  ).items[0];
  assert.equal(approved.activeReturnRequest?.status, "approved");
});

test("seller return inbox parser validates counts, rows, duplicates, and cursor", () => {
  const parsed = parseSellerReturnIndexPayload(returnPage(), 20);
  assert.equal(parsed.attentionCount, 3);
  assert.equal(parsed.requestedCount, 1);
  assert.equal(parsed.approvedCount, 2);
  assert.equal(parsed.returns[0].orderId, id("1"));
  assert.throws(
    () => parseSellerReturnIndexPayload(returnPage({ attention_count: 2 }), 20),
    MarketplaceFulfillmentPayloadError,
  );
  assert.throws(
    () =>
      parseSellerReturnIndexPayload(
        returnPage({ returns: [returnPage().returns[0], returnPage().returns[0]] }),
        20,
      ),
    MarketplaceFulfillmentPayloadError,
  );
  assert.equal(
    parseSellerReturnIndexPayload(
      returnPage({ returns: [{ ...returnPage().returns[0], status: "approved" }] }),
      20,
    ).returns[0].status,
    "approved",
  );
});

test("service reuses fulfillment architecture for the seller return index", () => {
  assert.match(service, /export async function fetchSellerReturns/);
  assert.match(service, /"fetch_my_marketplace_returns"/);
  assert.match(service, /parseSellerReturnIndexPayload/);
  assert.match(service, /marketplace_return_approval_funding_required/);
  assert.doesNotMatch(service, /MarketplaceReturnsService/);
});

test("seller center, orders, and inbox expose distinct return attention", () => {
  assert.match(home, /fetchSellerReturns\(\{limit:1\}\)/);
  assert.match(home, /Devoluciones que requieren atención/);
  assert.match(home, /\/seller\/returns/);
  assert.match(home, /returnRequests\.attentionCount/);
  assert.match(orders, /Solicitud de devolución · Decisión pendiente/);
  assert.match(orders, /Este pedido tiene una solicitud de devolución pendiente/);
  assert.match(inbox, /fetchSellerReturns/);
  assert.match(inbox, /`\/seller\/orders\/\$\{item\.orderId\}`/);
  assert.doesNotMatch(inbox, /MarketplaceReturnPanel|buyerNote|respondToMarketplaceReturn/);
});

test("legacy approved returns warn both parties not to ship before funding", () => {
  assert.match(
    presentation,
    /Espera a que la app confirme que los fondos del reembolso están asegurados antes de enviar el producto/,
  );
  assert.doesNotMatch(presentation, /El siguiente paso será coordinar el envío de regreso/);
  assert.match(panel, /los fondos todavía no están asegurados/);
  assert.match(panel, /Asegurar fondos del reembolso/);
  assert.match(panel, /Fondos del reembolso asegurados/);
  assert.match(panel, /Rechazar devolución/);
});

test("seller return index is authenticated, seller-owned, cursor-based, and private", () => {
  assert.match(migration, /v_actor uuid:=auth\.uid\(\)/);
  assert.match(migration, /marketplace_seller_not_approved/);
  assert.match(migration, /\(p_before_created_at is null\)<>\(p_before_id is null\)/);
  assert.match(migration, /\(created_at,id\)<\(p_before_created_at,p_before_id\)/);
  assert.match(migration, /revoke all on function public\.fetch_my_marketplace_returns[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.fetch_my_marketplace_returns[\s\S]*to authenticated,service_role/);
  const indexFunction = migration.split("create or replace function public.fetch_my_marketplace_returns")[1]
    .split("create or replace function public.respond_to_marketplace_return")[0];
  assert.doesNotMatch(indexFunction, /buyer_note|settlement_id|financial_|evidence/);
});
