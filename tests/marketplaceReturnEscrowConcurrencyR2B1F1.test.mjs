import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceFulfillmentPayloadError,
  parseMarketplaceReturnMutationReceipt,
} from "../services/marketplaceFulfillmentParsers.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/20260823010220_marketplace_return_reverse_escrow_r2b1.sql",
);
const at = "2026-08-23T02:00:00.000Z";
const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const returnRequest = (refundHold) => ({
  id: id("1"),
  order_id: id("2"),
  status: refundHold == null ? "rejected" : "approved",
  buyer_note: "Return",
  seller_note: null,
  created_at: at,
  decided_at: at,
  refund_hold: refundHold,
});

test("return funding and post-settlement review share one pre-row-lock order", () => {
  const core = migration
    .split("create function public.marketplace_create_return_refund_hold_core")[1]
    .split("create or replace function public.respond_to_marketplace_return")[0];
  const review = migration
    .split("create or replace function public.open_marketplace_post_settlement_review")[1]
    .split("create function public.reconcile_marketplace_return_refund_holds")[0];
  const shared = "'marketplace-return-review-order:'";
  const coreOperationLock = core.indexOf("'marketplace-return-refund-hold:'");
  const coreReturnLock = core.indexOf("from public.marketplace_return_requests");
  const coreSharedLock = core.indexOf(shared);
  const coreOrderLock = core.indexOf(
    "from public.marketplace_orders where id=rr.order_id for update",
  );
  const coreSettlementLock = core.indexOf(
    "from public.marketplace_order_settlements where id=rr.settlement_id for update",
  );
  assert.ok(
    coreOperationLock >= 0
      && coreOperationLock < coreReturnLock
      && coreReturnLock < coreSharedLock
      && coreSharedLock < coreOrderLock
      && coreOrderLock < coreSettlementLock,
    "return funding lock order must be operation, identity, shared order, order row, settlement",
  );

  const reviewOperationLock = review.indexOf(
    "':marketplace-post-settlement-review:'",
  );
  const reviewSharedLock = review.indexOf(shared);
  const reviewHistoricalLock = review.indexOf(
    "'marketplace-post-settlement-review-order:'",
  );
  const reviewOrderLock = review.indexOf(
    "from public.marketplace_orders where id=p_order_id for update",
  );
  assert.ok(
    reviewOperationLock >= 0
      && reviewOperationLock < reviewSharedLock
      && reviewSharedLock < reviewHistoricalLock
      && reviewHistoricalLock < reviewOrderLock,
    "review lock order must keep the shared order lock ahead of its historical lock and order row",
  );
  assert.match(core, /marketplace_return_refund_hold_active_review/);
  assert.match(review, /marketplace_post_settlement_review_return_hold_active/);
});

test("hold receipts report operation movement rather than cumulative funded state", () => {
  assert.match(
    migration,
    /marketplace_return_refund_hold_receipt\(\s*p_return_id uuid,\s*p_money_moved boolean\s*\)/,
  );
  assert.match(migration, /'money_moved',p_money_moved/);
  assert.match(
    migration,
    /marketplace_return_refund_hold_receipt\(rr\.id,false\)/,
  );
  assert.match(
    migration,
    /marketplace_return_refund_hold_receipt\(rr\.id,true\)/,
  );
  assert.match(
    migration,
    /marketplace_return_refund_hold_receipt\(v_prior\.id,false\)/,
  );
});

test("parser accepts replayed funded receipts and rejects moved-without-hold", () => {
  const hold = { status: "held", gross_amount: 50, held_at: at };
  const first = parseMarketplaceReturnMutationReceipt({
    return_request: returnRequest(hold),
    money_moved: true,
  });
  const replay = parseMarketplaceReturnMutationReceipt({
    return_request: returnRequest(hold),
    money_moved: false,
  });
  const rejection = parseMarketplaceReturnMutationReceipt({
    return_request: returnRequest(null),
    money_moved: false,
  });
  assert.equal(first.moneyMoved, true);
  assert.equal(replay.moneyMoved, false);
  assert.equal(replay.returnRequest.refundHold?.status, "held");
  assert.equal(rejection.returnRequest.refundHold, null);
  assert.throws(
    () => parseMarketplaceReturnMutationReceipt({
      return_request: returnRequest(null),
      money_moved: true,
    }),
    MarketplaceFulfillmentPayloadError,
  );
});
