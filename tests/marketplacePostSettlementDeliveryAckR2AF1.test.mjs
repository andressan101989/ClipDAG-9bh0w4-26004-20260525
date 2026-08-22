import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260822221008_marketplace_post_settlement_delivery_ack_r2a_f1.sql");
const prior = read("supabase/migrations/20260811010000_marketplace_multi_creator_allocation_authority.sql");
const buyer = read("app/orders/[id].tsx");
const edge = read("supabase/functions/bdag-ledger/index.ts");
const proof = read("scripts/prove-marketplace-order-lifecycle.mjs");

test("root cause is the historical settlement early return", () => {
  assert.match(
    prior,
    /select \* into s from public\.marketplace_order_settlements where order_id=p_order_id;\s*if found then return public\.marketplace_order_settlement_receipt/,
  );
});

test("R2A-F1 replaces only the canonical buyer delivery authority", () => {
  assert.equal(
    (migration.match(/create or replace function public\./g) ?? []).length,
    1,
  );
  assert.match(
    migration,
    /create or replace function public\.confirm_marketplace_order_delivery_and_release\(\s*p_buyer_id uuid,p_order_id uuid,p_idempotency_key uuid/,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.(?:marketplace_create_order_settlement_b7f|marketplace_order_settlement_receipt|reverse_marketplace_released_settlement|atomic_ledger_transfer|ledger_debit|ledger_credit)/,
  );
});

test("already-settled path validates the complete canonical financial identity", () => {
  for (const marker of [
    "v_settlement_count=1",
    "p.status<>'paid'",
    "a.status<>'released'",
    "s.status<>'completed'",
    "s.released_at is null",
    "s.checkout_id<>o.checkout_id",
    "s.payment_id<>p.id",
    "s.allocation_id<>a.id",
    "s.buyer_id<>o.buyer_id",
    "s.seller_id<>o.seller_id",
    "s.store_id<>o.store_id",
    "marketplace_settlement_reversals",
  ]) assert.ok(migration.includes(marker), marker);
});

test("already-settled path records physical delivery once and moves no money", () => {
  const pathB = migration.split("if v_settlement_count=1 then")[1].split("-- Existing Path A")[0];
  assert.match(pathB, /update public\.marketplace_orders set status='delivered'/);
  assert.match(pathB, /update public\.marketplace_order_shipments set status='delivered'/);
  assert.match(pathB, /'delivery_confirmed','shipped','delivered'/);
  assert.match(pathB, /'settlement_already_completed',true,'money_moved',false/);
  assert.doesNotMatch(pathB, /escrow_released|marketplace_create_order_settlement_b7f|atomic_ledger_transfer|ledger_debit|ledger_credit|financial_transactions|marketplace_settlement_legs/);
});

test("held path keeps the existing B7F settlement and dual events", () => {
  const pathA = migration.split("-- Existing Path A")[1];
  assert.match(pathA, /marketplace_create_order_settlement_b7f/);
  assert.match(pathA, /'delivery_confirmed','shipped','delivered'/);
  assert.match(pathA, /'escrow_released','delivered','delivered'/);
});

test("settled delivery acknowledgement is retry safe", () => {
  assert.match(migration, /where buyer_id=p_buyer_id and idempotency_key=p_idempotency_key/);
  assert.match(migration, /marketplace_settlement_idempotency_conflict/);
  assert.match(
    migration,
    /if o\.status='delivered' and sh\.id is not null and sh\.status='delivered' then\s*return public\.marketplace_order_settlement_receipt/,
  );
});

test("buyer UI separates physical receipt from protected dispute creation", () => {
  assert.match(
    buyer,
    /data\.order\.status === 'shipped' && \(!data\.dispute \|\| \['resolved', 'rejected', 'cancelled'\]\.includes\(data\.dispute\.status\)\)/,
  );
  assert.match(
    buyer,
    /data\.order\.status === 'shipped' && !data\.dispute \? <MarketplaceDisputePanel/,
  );
  assert.doesNotMatch(
    buyer,
    /\['open', 'under_review'\]\.includes\(data\.dispute\.status\).*Confirmar recepción/,
  );
});

test("existing Edge and receipt parser contracts remain unchanged", () => {
  assert.match(edge, /p_buyer_id: user\.id, p_order_id: order_id, p_idempotency_key: idempotency_key/);
  assert.match(proof, /preAckRetry/);
  assert.match(proof, /preAckDifferent/);
  assert.match(proof, /admin_ack_return_eligibility_missing/);
  assert.match(proof, /JSON\.stringify\(adminAfterAck\)===JSON\.stringify\(adminBeforeAck\)/);
});
