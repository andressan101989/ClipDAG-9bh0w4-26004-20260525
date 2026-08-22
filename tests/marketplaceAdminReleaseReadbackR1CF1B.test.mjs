import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260822040000_marketplace_admin_release_readback_r1c_f1b.sql");
const proof = read("scripts/prove-marketplace-admin-operations-core.mjs");
const keys = (sql) => [...sql.matchAll(/'([a-z_]+)'\s*,\s*\(select/g)].map((match) => match[1]);

test("R1C-F1B evolves only the approved settlement constraint and four authorities", () => {
  assert.match(migration, /drop constraint marketplace_settlement_actor_semantics_check/i);
  assert.match(migration, /add constraint marketplace_settlement_actor_semantics_check check/i);
  for (const authority of [
    "fetch_my_marketplace_sale",
    "marketplace_settlement_capture_actor",
    "release_marketplace_order_after_dispute_resolution",
    "reconcile_marketplace_settlements",
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${authority}\\(`, "i"));
  assert.doesNotMatch(migration, /create (?:table|policy)|alter column|add column|drop column|enable row level security/i);
  assert.doesNotMatch(migration, /create or replace function public\.(?:marketplace_create_order_settlement_b7f|admin_resolve_marketplace_dispute|resolve_marketplace_dispute|ledger_debit|ledger_credit)\(/i);
});

test("actor constraint preserves buyer strictness and permits Admin identity collision", () => {
  assert.match(migration, /release_actor_role\s*=\s*'buyer'[\s\S]*confirmed_by\s+is\s+not\s+null[\s\S]*confirmed_by\s*=\s*buyer_id[\s\S]*release_actor_id\s*=\s*buyer_id/i);
  assert.match(migration, /release_actor_role\s*=\s*'admin'[\s\S]*confirmed_by\s+is\s+null[\s\S]*release_actor_id\s+is\s+not\s+null/i);
  assert.doesNotMatch(migration, /release_actor_id\s*<>\s*buyer_id/i);
  assert.doesNotMatch(migration, /drop constraint marketplace_settlement_release_actor_role_check/i);
});

test("trusted release helper marks only the canonical Admin settlement call", () => {
  assert.match(migration, /app\.marketplace_admin_dispute_release/i);
  assert.match(migration, /set_config\('app\.marketplace_admin_dispute_release','on',true\)[\s\S]*marketplace_create_order_settlement_b7f/i);
  assert.match(migration, /exception when others then[\s\S]*set_config\('app\.marketplace_admin_dispute_release',v_admin_release_marker,true\)[\s\S]*raise/i);
  assert.match(migration, /current_setting\('app\.marketplace_admin_dispute_release',true\)='on'[\s\S]*release_actor_role:='admin'/i);
  assert.match(migration, /elsif new\.confirmed_by=new\.buyer_id[\s\S]*release_actor_role:='buyer'/i);
});

test("seller shipped and released readback requires an exact canonical settlement", () => {
  for (const condition of [
    /o\.status = 'shipped'/i,
    /p\.status = 'paid'/i,
    /a\.status = 'released'/i,
    /s\.order_id = o\.id/i,
    /s\.payment_id = p\.id/i,
    /s\.allocation_id = a\.id/i,
    /s\.checkout_id = o\.checkout_id/i,
    /s\.status = 'completed'/i,
    /s\.released_at is not null/i,
  ]) assert.match(migration, condition);
  assert.match(migration, /marketplace_order_not_fulfillable/i);
});

test("legacy compatibility is narrow, immutable-audit-derived, and read only", () => {
  for (const marker of [
    "marketplace_admin_action_audit",
    "dispute_release_seller",
    "post_reject_release",
    "canonical_id",
    "money_moved",
    "aa.actor_id=s.release_actor_id",
    "d.order_id=s.order_id",
  ]) assert.match(migration, new RegExp(marker.replaceAll(".", "\\."), "i"));
  assert.match(migration, /effective_release_actor_role/i);
  assert.match(migration, /effective_release_actor_id/i);
  assert.doesNotMatch(migration, /update public\.|delete from public\.|insert into public\./i);
  assert.doesNotMatch(migration, /dc4ec4b3-8c15-4a61-a087-36c32a38fef7|3ae2c2d6-8c3a-471f-892c-791c00945b45|3330bc61-5d08-44b2-a506-cd6244f7b9c7/i);
});

test("all 30 settlement reconciliation counters remain exact", () => {
  const prior = read("supabase/migrations/20260822030000_marketplace_admin_settlement_reconciliation_r1c_f1a.sql");
  assert.deepEqual(keys(migration), keys(prior));
  assert.equal(keys(migration).length, 30);
});

test("disposable proof covers readback, actor collision, constraints, and legacy negatives", () => {
  for (const marker of [
    "adminBuyerFixture",
    "shippedReleasedSellerReadback",
    "shippedReleasedWithoutSettlementDenied",
    "adminBuyerSettlementState",
    "adminBuyerNormalBuyerSettlementState",
    "actorConstraintCases",
    "legacyAdminAuditReconciliation",
    "legacyAuditNegativeCases",
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /assert\.equal\(fixtures,0\)/);
});

test("R1C-F1B contains no production release, ledger, refund, automatic settlement, or mobile change", () => {
  assert.doesNotMatch(migration, /settle_eligible_marketplace_orders|run_scheduled_marketplace_settlement|marketplace_settlement_policy|refund_marketplace|ledger_(?:debit|credit)\(/i);
});
