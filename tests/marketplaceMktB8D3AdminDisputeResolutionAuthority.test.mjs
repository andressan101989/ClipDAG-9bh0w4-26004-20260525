import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalizedRead = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const migration = normalizedRead("supabase/migrations/20260816010000_marketplace_admin_dispute_resolution_authority.sql");
const core = normalizedRead("supabase/migrations/20260810180000_marketplace_post_settlement_reversal_authority.sql");
const api = readFileSync("apps/admin-web/src/lib/adminApi.ts", "utf8");
const proof = readFileSync("scripts/prove-marketplace-admin-operations-core.mjs", "utf8");

const functionBody = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, name);
  const spacedEnd = source.indexOf("end\n$$", start);
  const compactEnd = source.indexOf("end$$", start);
  const end = spacedEnd >= 0 && (compactEnd < 0 || spacedEnd < compactEnd) ? spacedEnd : compactEnd;
  assert.ok(end > start, `${name}_end`);
  return source.slice(start, end);
};

test("C5 is one forward migration and preserves the guarded financial resolver", () => {
  assert.match(migration, /^-- MKT-B8D-3-C5/m);
  assert.doesNotMatch(migration, /create or replace function public\.resolve_marketplace_dispute\s*\(/i);
  const resolver = functionBody(core, "resolve_marketplace_dispute");
  assert.match(resolver, /coalesce\(auth\.jwt\(\)->>'role',''\)<>'service_role'/i);
  assert.match(resolver, /marketplace_dispute_resolution_auth_required/);
  assert.match(resolver, /p_partial_amount numeric default null/i);
});

test("the trusted wrapper derives the admin actor before elevating server claims", () => {
  const wrapper = functionBody(migration, "admin_resolve_marketplace_dispute");
  const requireAdmin = wrapper.indexOf("marketplace_require_admin()");
  const elevate = wrapper.indexOf("jsonb_build_object('role','service_role')");
  assert.ok(requireAdmin >= 0 && elevate > requireAdmin);
  assert.match(wrapper, /v_claims->>'sub'.*v_actor::text/s);
  assert.match(wrapper, /marketplace_admin_actor_mismatch/);
  assert.doesNotMatch(wrapper, /p_(actor|resolver|admin)_id/i);
});

test("trusted claims and the original role are restored on success and exception", () => {
  const wrapper = functionBody(migration, "admin_resolve_marketplace_dispute");
  assert.ok((wrapper.match(/set_config\('request\.jwt\.claims',v_claims_text,true\)/g) ?? []).length >= 2);
  assert.ok((wrapper.match(/set_config\('request\.jwt\.claim\.role',v_role,true\)/g) ?? []).length >= 2);
  assert.match(wrapper, /exception when others[\s\S]*raise;/);
  assert.doesNotMatch(wrapper, /set_config\('role'/);
});

test("browser authority remains bounded to command intent and idempotency", () => {
  const resolution = api.slice(api.indexOf("export async function resolveDispute"), api.indexOf("export async function searchSellers"));
  for (const field of ["p_dispute_id", "p_outcome", "p_reason_code", "p_note", "p_idempotency_key"]) assert.match(resolution, new RegExp(field));
  assert.doesNotMatch(resolution, /p_(actor|resolver|refund_amount|partial_amount|ledger|seller_net|platform_fee|creator_commission)/);
  assert.doesNotMatch(api, /service[_-]?role[^\n]*supabase\.rpc/i);
});

test("canonical read-back is actor scoped and cannot fabricate a commit", () => {
  const lookup = functionBody(migration, "get_my_marketplace_admin_dispute_resolution_result");
  assert.match(lookup, /v_actor uuid:=public\.marketplace_require_admin\(\)/);
  assert.match(lookup, /actor_id=v_actor/);
  assert.match(lookup, /idempotency_key=p_idempotency_key/);
  assert.match(lookup, /target_type='dispute'/);
  assert.match(lookup, /if not found then return null/);
  assert.match(api, /if\(reconciled\)return reconciled/);
  assert.match(api, /No pudimos confirmar el estado de la resolución/);
});

test("anon and direct financial authority remain denied", () => {
  assert.match(migration, /revoke all on function public\.admin_resolve_marketplace_dispute[\s\S]*from public,anon/);
  assert.match(migration, /revoke all on function public\.get_my_marketplace_admin_dispute_resolution_result[\s\S]*from public,anon/);
  assert.match(core, /revoke all on function[\s\S]*public\.resolve_marketplace_dispute\(uuid,uuid,text,text,text,uuid,numeric\)[\s\S]*from public,anon,authenticated/i);
  for (const marker of ["disputeAnonDenied", "disputeNonAdminDenied", "directCoreAuthContextDenied", "serverDerivedResolver"]) assert.ok(proof.includes(marker), marker);
});

test("disposable proof keeps refunds idempotent and rollback-clean", () => {
  assert.match(proof, /refundRetry=await rpc\("admin_resolve_marketplace_dispute"/);
  assert.match(proof, /assert\.deepEqual\(refundRetry,refund\)/);
  assert.match(proof, /assert\.equal\(transfers,1\)/);
  assert.match(proof, /get_my_marketplace_admin_dispute_resolution_result/);
  assert.match(proof, /await db\.query\("rollback"\)/);
});

test("C4 dispute payment omission remains explicit without fake escrow", () => {
  assert.match(api, /validateDisputePayment/);
  assert.match(api, /item\.escrow_amount===undefined\?null/);
  assert.doesNotMatch(api, /escrowAmount\s*=\s*(order|payment|seller|shipping)/);
});
