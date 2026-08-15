import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const historical = read(
  "supabase/migrations/20260703212533_migration_to_supabase.sql",
);
const migration = read(
  "supabase/migrations/20260811027000_marketplace_admin_identity_hardening.sql",
);
const proof = read("scripts/prove-marketplace-admin-identity-hardening.mjs");
const auditor = read("scripts/audit-marketplace-b8s-remote.mjs");
const packageJson = JSON.parse(read("package.json"));

test("B8S is a forward-only migration and leaves historical schema history intact", () => {
  assert.match(historical, /create policy "user_profiles_insert_self"/);
  assert.match(historical, /create policy "user_profiles_update_self"/);
  assert.match(migration, /protect_user_profile_server_fields/);
  assert.equal(existsSync("app/admin-web"), false);
  assert.equal(existsSync("app/marketplace-admin"), false);
});

test("table-wide client DML is removed before safe column grants", () => {
  assert.match(
    migration,
    /revoke insert, update, delete, truncate, references, trigger[\s\S]*from anon, authenticated/,
  );
  assert.match(migration, /grant insert \([\s\S]*\) on public\.user_profiles to authenticated/);
  assert.match(migration, /grant update \([\s\S]*\) on public\.user_profiles to authenticated/);
  const updateGrant = migration.match(
    /grant update \(([\s\S]*?)\) on public\.user_profiles to authenticated/,
  )?.[1];
  assert.ok(updateGrant);
  assert.doesNotMatch(updateGrant, /\bis_admin\b/);
  assert.doesNotMatch(updateGrant, /followers_count|following_count/);
});

test("INSERT escalation is rejected by grants, policy, and trigger", () => {
  assert.match(migration, /for insert[\s\S]*to authenticated[\s\S]*is_admin = false/);
  assert.match(migration, /if new\.is_admin then[\s\S]*user_profile_admin_privilege_forbidden/);
  const insertGrant = migration.match(
    /grant insert \(([\s\S]*?)\) on public\.user_profiles to authenticated/,
  )?.[1];
  assert.ok(insertGrant);
  assert.doesNotMatch(insertGrant, /\bis_admin\b/);
});

test("UPDATE escalation and server-managed economic cache changes are rejected", () => {
  assert.match(migration, /new\.is_admin is distinct from old\.is_admin/);
  assert.match(migration, /new\.dag_balance is distinct from old\.dag_balance/);
  assert.match(migration, /new\.followers_count is distinct from old\.followers_count/);
  assert.match(migration, /new\.following_count is distinct from old\.following_count/);
});

test("normal profile creation and intended safe edits remain supported", () => {
  assert.match(migration, /\bid,[\s\S]*\bemail,[\s\S]*\busername,/);
  assert.match(migration, /\bdisplay_name,[\s\S]*\bbio,[\s\S]*\bprofession,/);
  assert.match(migration, /\bwallet_address,[\s\S]*\bis_private,/);
  assert.match(proof, /normalProfileCreate: true/);
  assert.match(proof, /normalSafeProfileEdit: true/);
});

test("admin provisioning trusts the PostgreSQL execution role, never client metadata", () => {
  assert.match(migration, /current_user in \('postgres', 'service_role', 'supabase_admin'\)/);
  assert.doesNotMatch(migration, /user_metadata|app_metadata|p_admin_user_id/);
  assert.match(proof, /metadataForgedAdmin/);
  assert.match(proof, /serviceRoleDatabaseProvisioningOnly: true/);
});

test("guard execution is private and uses a fixed search path", () => {
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(
    migration,
    /revoke all on function public\.protect_user_profile_server_fields\(\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.protect_user_profile_server_fields\(\)[\s\S]*to service_role/,
  );
});

test("runtime proof covers every required privilege attack and effective grant state", () => {
  for (const marker of [
    "anonymousDenied",
    "anonymousAdmin",
    "ordinaryInsertSelfAdminDenied",
    "ordinaryUpdateSelfAdminDenied",
    "adminSelfDemotionDenied",
    "crossUserAdminMutationDenied",
    "metadataForgeryDenied",
    "exposedAdminSetterCount",
    "legacyBalanceMutationDenied",
    "socialCounterMutationDenied",
    "privilegedGrant",
    "privilegedRevoke",
    "persistentFixtures",
  ]) {
    assert.match(proof, new RegExp(marker));
  }
  assert.match(proof, /has_column_privilege\('authenticated'.*'is_admin'.*'INSERT'/s);
  assert.match(proof, /has_column_privilege\('authenticated'.*'is_admin'.*'UPDATE'/s);
});

test("remote auditor is read-only and verifies migration, grants, helper, and inherited health", () => {
  assert.match(auditor, /--expect-pre-b8s/);
  assert.match(auditor, /--require-b8s/);
  assert.match(auditor, /20260811026000/);
  assert.match(auditor, /20260811027000/);
  assert.match(auditor, /authenticated_admin_insert_denied/);
  assert.match(auditor, /authenticated_admin_update_denied/);
  assert.match(auditor, /reconcile_marketplace_creator_commerce_analytics/);
  assert.doesNotMatch(auditor, /\b(update|insert into|delete from) public\./i);
});

test("package scripts expose only proof and read-only audit tooling", () => {
  assert.equal(
    packageJson.scripts["prove:marketplace-admin-identity-hardening"],
    "node scripts/prove-marketplace-admin-identity-hardening.mjs",
  );
  assert.equal(
    packageJson.scripts["audit:marketplace-b8s-remote"],
    "node scripts/audit-marketplace-b8s-remote.mjs",
  );
});
