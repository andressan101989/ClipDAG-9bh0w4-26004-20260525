import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804100000_marketplace_automatic_settlement_policy.sql", import.meta.url),
  "utf8",
);

test("automatic settlement policy is configuration driven and service-role only", () => {
  assert.match(migration, /marketplace_settlement_policy/);
  assert.match(migration, /maximum_confirmation_days integer not null default 14/);
  assert.match(migration, /settle_eligible_marketplace_orders/);
  assert.match(migration, /service_role_required/);
  assert.match(migration, /grant execute[\s\S]*settle_eligible_marketplace_orders\(integer\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*settle_eligible_marketplace_orders\(integer\)[\s\S]*to (anon|authenticated)/);
});

test("eligible settlement reuses the canonical ledger release and is retry safe", () => {
  assert.match(migration, /confirm_marketplace_order_delivery_and_release/);
  assert.match(migration, /marketplace-auto-settlement:/);
  assert.match(migration, /for update of o skip locked/);
  assert.match(migration, /marketplace_payment_allocations a on a\.order_id=o\.id and a\.status='held'/);
  assert.match(migration, /not exists \(select 1 from public\.marketplace_order_settlements/);
});

test("active disputes block automatic release and cannot mutate money directly", () => {
  assert.match(migration, /marketplace_order_disputes/);
  assert.match(migration, /status in \('open','under_review'\)/);
  assert.match(migration, /report_marketplace_order_problem/);
  assert.doesNotMatch(migration, /update public\.ledger_accounts|insert into public\.ledger_entries|ledger_debit|ledger_credit/);
  assert.match(migration, /revoke all on table public\.marketplace_settlement_policy,public\.marketplace_order_disputes/);
});

test("dispute creation is buyer-owned, state constrained, and idempotent", () => {
  assert.match(migration, /v_order\.buyer_id<>auth\.uid\(\)/);
  assert.match(migration, /v_order\.status not in \('shipped','delivered'\)/);
  assert.match(migration, /unique \(buyer_id,idempotency_key\)/);
  assert.match(migration, /marketplace_dispute_idempotency_conflict/);
  assert.match(migration, /marketplace_dispute_settlement_completed/);
});

