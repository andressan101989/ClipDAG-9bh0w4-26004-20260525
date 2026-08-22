import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260822030000_marketplace_admin_settlement_reconciliation_r1c_f1a.sql", "utf8");
const prior = readFileSync("supabase/migrations/20260802050000_harden_marketplace_settlement_reconciliation.sql", "utf8");
const proof = readFileSync("scripts/prove-marketplace-admin-operations-core.mjs", "utf8");
const keys = (sql) => [...sql.matchAll(/'([a-z_]+)'\s*,\s*\(select/g)].map((match) => match[1]);

test("R1C-F1A replaces only the existing read-only settlement reconciler", () => {
  assert.match(migration, /create or replace function public\.reconcile_marketplace_settlements\(\)/i);
  assert.match(migration, /returns jsonb language sql stable security definer set search_path=public/i);
  assert.match(migration, /revoke all on function public\.reconcile_marketplace_settlements\(\)[\s\S]*from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function public\.reconcile_marketplace_settlements\(\)[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /create (?:table|trigger|policy)|alter table|ledger_(?:debit|credit)|insert into|update public\.|delete from/i);
  assert.doesNotMatch(migration, /admin_resolve_marketplace_dispute|release_marketplace_order_after_dispute_resolution|resolve_marketplace_dispute|marketplace_create_order_settlement_b7f|settle_eligible_marketplace_orders/i);
});

test("all historical reconciliation counters remain exact", () => {
  assert.deepEqual(keys(migration), keys(prior));
  assert.equal(keys(migration).length, 30);
});

test("buyer delivery settlement reconciliation remains strict", () => {
  assert.match(migration, /s\.release_actor_role='buyer'and\(sh\.id is null or o\.delivered_at is null or sh\.delivered_at is null or o\.delivered_at is distinct from sh\.delivered_at or s\.confirmed_at is distinct from o\.delivered_at\)/i);
  assert.match(migration, /s\.release_actor_role='buyer'and o\.status is distinct from 'delivered'/i);
  assert.match(migration, /s\.release_actor_role='buyer'and\(sh\.id is null or sh\.status is distinct from 'delivered' or sh\.delivered_at is null\)/i);
});

test("Admin settlement reconciliation accepts shipped state without fabricating delivery", () => {
  assert.match(migration, /s\.release_actor_role='admin'and o\.status not in\('shipped','delivered'\)/i);
  assert.match(migration, /s\.release_actor_role='admin'and\(sh\.id is null or sh\.status not in\('shipped','delivered'\)\)/i);
  assert.doesNotMatch(migration, /update[\s\S]*delivered_at/i);
});

test("transaction initiator follows the canonical release actor", () => {
  assert.match(migration, /s\.release_actor_id,s\.release_actor_role/i);
  assert.match(migration, /initiated_by is distinct from case release_actor_role when'buyer'then buyer_id when'admin'then release_actor_id end/i);
  assert.match(migration, /reference_type is distinct from'marketplace_order'/i);
  assert.match(migration, /reference_id is distinct from order_id::text/i);
});

test("disposable proof covers buyer, active Admin, post-reject Admin, and negative actor/reference cases", () => {
  for (const marker of ["buyerSettlementState", "activeAdminSettlementState", "postRejectAdminSettlementState", "buyer_and_admin_releases", "bad_buyer_delivery", "bad_buyer_actor", "bad_admin_actor", "bad_admin_reference", "reconcile_marketplace_settlements"]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /postRejectSameKeyIdempotent:true/);
  assert.match(proof, /postRejectDifferentKeyNoMovement:true/);
});

test("the production dispute and release authority are absent from the corrective", () => {
  assert.doesNotMatch(migration, /3330bc61-5d08-44b2-a506-cd6244f7b9c7|ORD-3AE2C2D68C3A471F/i);
  assert.doesNotMatch(migration, /marketplace_admin_action_audit|marketplace_dispute_decisions/i);
});
