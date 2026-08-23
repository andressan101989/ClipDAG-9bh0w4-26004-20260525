import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260823175849_marketplace_refund_reconciliation_r2b4_f3.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

const functionBody = (name, nextName) => {
  const start = migration.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, name);
  const end = nextName
    ? migration.indexOf(`function public.${nextName}`, start + 1)
    : migration.indexOf("revoke all on function", start + 1);
  assert.notEqual(end, -1, `${name}:end`);
  return migration.slice(start, end);
};

const payments = functionBody(
  "reconcile_marketplace_payments()",
  "reconcile_marketplace_settlements()",
);
const settlements = functionBody(
  "reconcile_marketplace_settlements()",
  "marketplace_admin_health_failure_count(",
);
const health = functionBody("marketplace_admin_health_failure_count(");

test("normal paid fulfillment and fixture refunds preserve their existing contracts", () => {
  assert.match(payments, /order_status in\('confirmed','processing','shipped','delivered'\)/);
  assert.match(payments, /allocation_status in\('held','released'\)/);
  assert.match(payments, /fixture_ops\.is_fixture\('store',po\.store_id\)/);
  assert.match(payments, /then 'refunded_fixture'/);
});

test("held dispute refunds require immutable decision and exact financial evidence", () => {
  assert.match(payments, /dd\.outcome='refund_buyer'/);
  assert.match(payments, /dd\.financial_result->'money_moved'='true'::jsonb/);
  assert.match(payments, /marketplace_dispute_refund/);
  assert.match(payments, /reference_type='marketplace_order'/);
  assert.match(payments, /not exists\(select 1 from public\.marketplace_order_settlements/);
  assert.match(payments, /2=\(select count\(\*\) from public\.ledger_entries/);
  assert.match(payments, /event_type='refund_created'/);
});

test("post-settlement dispute refunds require a full canonical reversal", () => {
  assert.match(payments, /marketplace_settlement_reversals r/);
  assert.match(payments, /financial_result->>'reversal_id'=r\.id::text/);
  assert.match(payments, /marketplace_post_settlement_refund/);
  assert.match(payments, /marketplace_settlement_reversal_legs/);
  assert.match(payments, /reversal_amount<>sl\.amount/);
  assert.match(payments, /then 'refunded_dispute'/);
});

test("keep-item and received-item returns have mutually exclusive physical evidence", () => {
  assert.match(payments, /rf\.resolution_mode='keep_item' and not exists\(/);
  assert.match(payments, /rf\.resolution_mode='returned_item' and exists\(/);
  assert.match(payments, /rs\.status='received'/);
  assert.match(payments, /rs\.received_by=o\.seller_id/);
  assert.match(payments, /then 'refunded_return'/);
});

test("return refunds require exact identities, amounts, accounts and transaction reference", () => {
  for (const token of [
    "marketplace_return_requests",
    "marketplace_return_refunds",
    "marketplace_return_refund_holds",
    "marketplace_return_escrow",
    "marketplace_return_refund",
    "ft.reference_id=rf.id::text",
    "dst.owner_id=rr.buyer_id",
    "rf.gross_amount",
  ]) assert.ok(payments.includes(token), token);
  assert.match(payments, /rf\.payment_id,rf\.allocation_id,rf\.settlement_id/);
  assert.match(payments, /ev\.metadata->>'return_refund_id'=rf\.id::text/);
  assert.match(payments, /ev\.metadata->'gross_refund_amount'=to_jsonb\(rf\.gross_amount\)/);
});

test("arbitrary refunded states still flow to mismatch details", () => {
  assert.match(payments, /else null\s+end state_class/);
  assert.match(payments, /count\(\*\)filter\(where state_class is null\) invalid/);
  assert.match(payments, /from classified where state_class is null/);
  assert.match(payments, /'confirmed_state_mismatches'/);
  assert.match(payments, /'invalid_confirmed_state_details'/);
});

test("settlements exempt only canonical return or post-settlement dispute refunds", () => {
  assert.match(settlements, /canonical_dispute_refunds as/);
  assert.match(settlements, /canonical_return_refunds as/);
  assert.match(settlements, /a\.status is distinct from 'released'/);
  assert.match(settlements, /not coalesce\(c\.refunded_after_return or c\.refunded_after_dispute,false\)/);
  assert.match(settlements, /'refunded_after_return'/);
  assert.match(settlements, /'refunded_after_dispute'/);
});

test("observational refund breakdowns do not hide corruption counters", () => {
  assert.match(payments, /'refunded_fixture',refunded_fixture/);
  assert.match(payments, /'refunded_dispute',refunded_dispute/);
  assert.match(payments, /'refunded_return',refunded_return/);
  assert.match(health, /p_group='payments'and v_key='confirmed_state_breakdown'/);
  assert.match(health, /'refunded_settlement_breakdown'/);
  assert.doesNotMatch(health, /confirmed_state_mismatches|settlement_without_release/);
});

test("reconcilers are read-only, stable, hardened and service-role-only", () => {
  for (const body of [payments, settlements]) {
    assert.match(body, /returns jsonb\s+language sql\s+stable\s+security definer/i);
    assert.match(body, /set search_path = pg_catalog, public/i);
    assert.doesNotMatch(body, /\b(insert|update|delete|merge|truncate)\b/i);
  }
  assert.doesNotMatch(migration, /\bcreate\s+(table|view|materialized\s+view)\b/i);
  assert.match(migration, /revoke all on function public\.reconcile_marketplace_payments\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.reconcile_marketplace_settlements\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.reconcile_marketplace_payments\(\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.reconcile_marketplace_settlements\(\)[\s\S]*to service_role/);
});

test("migration is one transactional forward-only reconciliation correction", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /commit;\s*$/);
  assert.equal((migration.match(/create or replace function public\.reconcile_marketplace_payments/g) ?? []).length, 1);
  assert.equal((migration.match(/create or replace function public\.reconcile_marketplace_settlements/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /\b(insert\s+into|update\s+public\.|delete\s+from|ledger_(debit|credit)|atomic_ledger_transfer)\b/i);
});
