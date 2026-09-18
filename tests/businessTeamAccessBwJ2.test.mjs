import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const migrationName = (await readdir(migrationsUrl)).find((name) => name.endsWith("_business_team_access_management_bw_j2.sql"));
assert.ok(migrationName, "BW-J2 migration is required");
const migration = await readFile(new URL(migrationName, migrationsUrl), "utf8");

test("J2 adds invitation snapshots and a business-scoped audit without another membership or role authority", () => {
  const tables = [...migration.matchAll(/create table private\.([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(tables, [
    "business_invitations",
    "business_invitation_capabilities",
    "business_team_audit_events",
  ]);
  assert.doesNotMatch(migration, /create table private\.business_(?:memberships|membership_capabilities|roles|role_capabilities)/i);
  assert.match(migration, /references private\.business_memberships\(id\)/i);
  assert.match(migration, /references private\.business_capability_catalog\(code\)/i);
});

test("J2 private tables are force-RLS and have no direct client access", () => {
  for (const table of ["business_invitations", "business_invitation_capabilities", "business_team_audit_events"]) {
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all (?:privileges )?on table private\\.${table} from public, anon, authenticated, service_role`, "i"));
  }
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all).*private\.business_(?:invitations|invitation_capabilities|team_audit_events)/i);
});

test("J2 exposes two reads and one centralized authenticated command authority", () => {
  assert.match(migration, /function public\.get_my_business_team\(\s*p_business_owner_id uuid\s*\)/i);
  assert.match(migration, /function public\.get_my_pending_business_invitations\(\s*\)/i);
  assert.match(migration, /function public\.manage_business_team\(\s*p_action text,\s*p_payload jsonb\s*\)/i);
  assert.equal((migration.match(/create or replace function public\.manage_business_team\(/gi) ?? []).length, 1);
  for (const signature of [
    "public.get_my_business_team(uuid)",
    "public.get_my_pending_business_invitations()",
    "public.manage_business_team(text, jsonb)",
  ]) {
    const escaped = signature.replace(/[().]/g, "\\$&");
    assert.match(migration, new RegExp(`revoke all on function ${escaped} from public, anon, authenticated, service_role`, "i"));
    assert.match(migration, new RegExp(`grant execute on function ${escaped} to authenticated`, "i"));
  }
  assert.match(migration, /set search_path = ''/i);
  assert.doesNotMatch(migration, /grant execute .* to anon/i);
});

test("J2 read authority keeps team.manage implication local to Team", () => {
  assert.match(migration, /business_actor_has_capability\(p_business_owner_id, 'business\.team\.read'\)/i);
  assert.match(migration, /business_actor_has_capability\(p_business_owner_id, 'business\.team\.manage'\)/i);
  assert.doesNotMatch(migration, /replace function private\.business_effective_capabilities/i);
  assert.doesNotMatch(migration, /replace function private\.business_actor_has_capability/i);
});

test("J2 command derives identity server-side and protects the exact sensitive capability set", () => {
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/i);
  assert.match(migration, /from auth\.users/i);
  assert.match(migration, /lower\(btrim\([^)]*email/i);
  assert.doesNotMatch(migration, /p_actor_user_id|p_actor_email|payload\s*->>\s*'actor/i);
  for (const capability of [
    "business.team.manage",
    "business.settings.manage",
    "business.finance.read",
    "business.payouts.read",
    "business.payouts.manage",
  ]) assert.match(migration, new RegExp(capability.replaceAll(".", "\\.")));
  assert.match(migration, /business_team_protected_capability_required/i);
  assert.match(migration, /business_team_self_management_denied/i);
  assert.match(migration, /business_team_manager_target_denied/i);
});

test("J2 invitation lifecycle is atomic, expiring, normalized, and duplicate-safe", () => {
  assert.match(migration, /status in \('pending', 'accepted', 'declined', 'revoked'\)/i);
  assert.match(migration, /expires_at[^;]*interval '7 days'/i);
  assert.match(migration, /unique index[^;]*business_invitations[^;]*where \(status = 'pending'/i);
  assert.match(migration, /business_invitation_email_invalid/i);
  assert.match(migration, /business_invitation_duplicate/i);
  assert.match(migration, /business_invitation_wrong_email/i);
  assert.match(migration, /business_invitation_expired/i);
  assert.match(migration, /on conflict \(business_owner_id, member_user_id\)/i);
  assert.match(migration, /delete from private\.business_membership_capabilities/i);
  assert.match(migration, /insert into private\.business_membership_capabilities/i);
});

test("J2 audit is append-only and records each lifecycle action without raw request dumps", () => {
  for (const action of [
    "invitation_created",
    "invitation_revoked",
    "invitation_accepted",
    "invitation_declined",
    "member_capabilities_changed",
    "member_revoked",
  ]) assert.match(migration, new RegExp(`'${action}'`));
  assert.match(migration, /business_team_audit_immutable/i);
  assert.doesNotMatch(migration, /metadata\s*[:=].*p_payload/is);
});

test("J2 does not touch financial or adjacent domain authorities", () => {
  assert.doesNotMatch(migration, /\b(?:financial_transactions|ledger_entries|ledger_accounts|app_wallets|withdrawal_requests|stripe_bdag|marketplace_ad_campaigns|get_my_business_analytics)\b/i);
});
