import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260822020000_marketplace_post_reject_release_r1c_f1.sql");
const adminApi = read("apps/admin-web/src/lib/adminApi.ts");
const detailPage = read("apps/admin-web/src/pages/MarketplaceDisputeDetailPage.tsx");
const operation = read("apps/admin-web/src/components/OperationConfirm.tsx");
const proof = read("scripts/prove-marketplace-admin-operations-core.mjs");

test("R1C-F1 reuses the existing wrapper, release helper, and B7F settlement core", () => {
  assert.match(migration, /create or replace function public\.admin_resolve_marketplace_dispute\(/i);
  assert.match(migration, /create or replace function public\.release_marketplace_order_after_dispute_resolution\(/i);
  assert.match(migration, /marketplace_create_order_settlement_b7f\(/i);
  assert.doesNotMatch(migration, /create or replace function public\.(?:resolve_marketplace_dispute|resolve_marketplace_dispute_held_v1|marketplace_create_order_settlement_b7f|settle_eligible_marketplace_orders)\(/i);
  assert.doesNotMatch(migration, /ledger_(?:debit|credit)\(|insert into public\.financial_transactions/i);
});

test("post-reject release is constrained to the immutable eligible reject_claim decision", () => {
  for (const marker of ["d.status='rejected'", "prior.outcome<>'reject_claim'", "settlement_eligible", "p.status<>'paid'", "o.status not in('shipped','delivered')", "a.status<>'held'"]) assert.match(migration, new RegExp(marker.replace(/[()']/g, "\\$&")));
  assert.match(migration, /select \* into prior from public\.marketplace_dispute_decisions where dispute_id=d\.id/i);
  assert.doesNotMatch(migration, /(?:update|delete from) public\.marketplace_dispute_decisions/i);
  assert.doesNotMatch(migration, /insert into public\.marketplace_dispute_decisions/i);
});

test("the follow-up receipt and audit identify settlement without fabricating a second decision", () => {
  for (const marker of ["post_reject_release", "prior_decision_id", "prior_outcome", "already_released"]) assert.match(migration, new RegExp(marker));
  assert.match(migration, /v_action:='dispute_'\|\|p_outcome/);
  assert.match(migration, /p_outcome='release_seller'/);
  assert.match(migration, /v_result->'settlement'->>'id'/);
  assert.match(migration, /marketplace_admin_action_audit/);
  assert.match(migration, /marketplace_admin_idempotency_conflict/);
  assert.match(migration, /reconcile_marketplace_admin_operations\(\)/);
  assert.match(migration, /result_kind'='post_reject_release'/);
  assert.match(migration, /s\.release_actor_id/);
});

test("Admin client validates post-reject receipts and offers only the eligible pending release", () => {
  assert.match(adminApi, /kind==="post_reject_release"/);
  for (const marker of ["prior_decision_id", "prior_outcome", "already_released"]) assert.match(adminApi, new RegExp(marker));
  assert.match(detailPage, /Fondos pendientes/);
  assert.match(detailPage, /Liberar fondos pendientes al vendedor/);
  assert.match(detailPage, /decision\.outcome.*reject_claim/s);
  assert.match(detailPage, /allocation\.status.*held/s);
  assert.match(detailPage, /!settlement\.id/);
});

test("the dispute-only reason minimum matches the server without changing other operations", () => {
  assert.match(operation, /minReasonLength\s*=\s*1/);
  assert.match(operation, /normalized\.length\s*<\s*minReasonLength/);
  assert.match(detailPage, /minReasonLength=\{2\}/);
});

test("disposable proof covers immutable decision, one settlement, financial legs, and replay safety", () => {
  for (const marker of ["postRejectReleaseCanonical", "postRejectDecisionUnchanged", "postRejectSettlementCount", "postRejectSellerLeg", "postRejectPlatformLeg", "postRejectCreatorLeg", "postRejectSameKeyIdempotent", "postRejectDifferentKeyNoMovement", "postRejectReconciliationCommitted"]) assert.match(proof, new RegExp(marker));
});

test("R1C-F1 does not alter automatic settlement, policy, cron, Edge, or historical production data", () => {
  assert.doesNotMatch(migration, /run_scheduled_marketplace_settlement|marketplace_settlement_policy|cron\.schedule|get-media-url|3330bc61-5d08-44b2-a506-cd6244f7b9c7/i);
});
