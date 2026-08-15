import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB8s = process.argv.includes("--require-b8s");
const expectPreB8s = process.argv.includes("--expect-pre-b8s");
const npmCache = join(tmpdir(), "onspace-b7a-npm-cache");
mkdirSync(npmCache, { recursive: true });
let captured = "";
if (
  !process.env.PGHOST ||
  !process.env.PGPORT ||
  !process.env.PGUSER ||
  !process.env.PGPASSWORD
) {
  const cli = spawnSync(
    process.env.ComSpec,
    [
      "/d",
      "/s",
      "/c",
      "npx.cmd supabase db dump --linked --schema public --dry-run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, npm_config_cache: npmCache, DO_NOT_TRACK: "1" },
    },
  );
  captured = `${cli.stdout ?? ""}${cli.stderr ?? ""}`;
  if (cli.status !== 0) {
    const diagnostic = captured
      .replace(/(PGPASSWORD[="']+)[^"'\r\n ]+/gi, "$1[redacted]")
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
      .slice(-800);
    throw new Error(`b8s_remote_secure_connection_failed:${diagnostic}`);
  }
}

const envValue = (name) =>
  process.env[name] ??
  captured.match(
    new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`),
  )?.[1];
const config = {
  host: envValue("PGHOST"),
  port: Number(envValue("PGPORT")),
  user: envValue("PGUSER"),
  password: envValue("PGPASSWORD"),
  database: envValue("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
};
assert(
  config.host &&
    config.port &&
    config.user &&
    config.password &&
    config.database,
  "b8s_remote_config_missing",
);

const observational = new Set([
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "refunded_fixture",
  "escrow_expected_held_total",
  "escrow_actual_balance",
]);
function assertHealthy(result, path = "") {
  if (Array.isArray(result)) {
    assert.equal(result.length, 0, `${path}_not_empty`);
    return;
  }
  if (result && typeof result === "object") {
    for (const [key, value] of Object.entries(result)) {
      if (!observational.has(key))
        assertHealthy(value, path ? `${path}.${key}` : key);
    }
    return;
  }
  if (typeof result === "number") assert.equal(result, 0, `${path}_nonzero`);
}

const db = new Client(config);
try {
  await db.connect();
  await db.query("set role postgres");
  await db.query(
    "select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)",
    [JSON.stringify({ role: "service_role" })],
  );

  const reconciliationNames = (
    await db.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'reconcile_marketplace_%' and p.pronargs=0 order by p.proname",
    )
  ).rows.map((row) => row.proname);
  const reconciliations = {};
  for (const name of reconciliationNames) {
    const result = (
      await db.query(`select public.${name}() value`)
    ).rows[0].value;
    assertHealthy(result, name);
    reconciliations[name] = result;
  }

  const audit = (
    await db.query(`select
      (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
      exists(select 1 from supabase_migrations.schema_migrations where version='20260811027000') b8s_applied,
      to_regprocedure('public.protect_user_profile_server_fields()') is not null guard_present,
      exists(select 1 from pg_trigger where tgrelid='public.user_profiles'::regclass
        and tgname='protect_user_profile_server_fields' and not tgisinternal) trigger_present,
      not has_table_privilege('authenticated','public.user_profiles','INSERT') authenticated_table_insert_denied,
      not has_table_privilege('authenticated','public.user_profiles','UPDATE') authenticated_table_update_denied,
      not has_column_privilege('authenticated','public.user_profiles','is_admin','INSERT') authenticated_admin_insert_denied,
      not has_column_privilege('authenticated','public.user_profiles','is_admin','UPDATE') authenticated_admin_update_denied,
      not has_column_privilege('anon','public.user_profiles','is_admin','INSERT') anon_admin_insert_denied,
      not has_column_privilege('anon','public.user_profiles','is_admin','UPDATE') anon_admin_update_denied,
      to_regprocedure('public.marketplace_actor_is_admin()') is not null admin_helper_present,
      position('auth.uid()' in lower(pg_get_functiondef('public.marketplace_actor_is_admin()'::regprocedure)))>0 helper_uses_auth_uid,
      position('is_admin=true' in replace(lower(pg_get_functiondef('public.marketplace_actor_is_admin()'::regprocedure)),' ',''))>0 helper_uses_protected_state,
      case when to_regprocedure('public.protect_user_profile_server_fields()') is not null
        then not has_function_privilege('anon',to_regprocedure('public.protect_user_profile_server_fields()'),'EXECUTE')
        else false end anon_guard_execute_denied,
      case when to_regprocedure('public.protect_user_profile_server_fields()') is not null
        then not has_function_privilege('authenticated',to_regprocedure('public.protect_user_profile_server_fields()'),'EXECUTE')
        else false end authenticated_guard_execute_denied,
      coalesce((select array_to_string(proconfig,',') ilike '%search_path=pg_catalog, public%'
        from pg_proc where oid=to_regprocedure('public.protect_user_profile_server_fields()')),false) guard_fixed_search_path,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.prokind='f' and n.nspname='public'
          and pg_get_functiondef(p.oid) ~* 'update[[:space:]]+public[.]user_profiles[^;]*is_admin'
          and (has_function_privilege('anon',p.oid,'EXECUTE')
            or has_function_privilege('authenticated',p.oid,'EXECUTE'))) exposed_admin_setters,
      to_regprocedure('fixture_ops.fail_b8s_admin_identity()') is not null failure_function_present,
      exists(select 1 from pg_trigger where not tgisinternal and tgname like 'fixture_b8s%') failure_trigger_present,
      (select count(*)::int from auth.users where email like 'b8s-%@proof.local') b8s_fixture_users`)
  ).rows[0];

  assert.equal(audit.b8s_fixture_users, 0, "b8s_remote_fixture_users_present");
  assert.equal(audit.failure_function_present, false, "b8s_failure_function_present");
  assert.equal(audit.failure_trigger_present, false, "b8s_failure_trigger_present");
  assert.equal(audit.exposed_admin_setters, 0, "b8s_exposed_admin_setter_present");
  assert.equal(audit.admin_helper_present, true, "b8s_admin_helper_missing");
  assert.equal(audit.helper_uses_auth_uid, true, "b8s_admin_helper_not_self_scoped");
  assert.equal(
    audit.helper_uses_protected_state,
    true,
    "b8s_admin_helper_not_using_protected_state",
  );

  if (expectPreB8s) {
    assert.equal(
      audit.latest_migration,
      "20260811026000",
      "b8s_predeploy_parity_mismatch",
    );
    assert.equal(audit.b8s_applied, false, "b8s_unexpectedly_applied");
    assert.equal(audit.guard_present, false, "b8s_guard_unexpected");
  }
  if (requireB8s) {
    assert.equal(
      audit.latest_migration,
      "20260811027000",
      "b8s_migration_parity_mismatch",
    );
    for (const key of [
      "b8s_applied",
      "guard_present",
      "trigger_present",
      "authenticated_table_insert_denied",
      "authenticated_table_update_denied",
      "authenticated_admin_insert_denied",
      "authenticated_admin_update_denied",
      "anon_admin_insert_denied",
      "anon_admin_update_denied",
      "anon_guard_execute_denied",
      "authenticated_guard_execute_denied",
      "guard_fixed_search_path",
    ]) {
      assert.equal(audit[key], true, `b8s_remote_${key}`);
    }
  }

  for (const [name, count] of [
    ["reconcile_marketplace_creator_commerce_analytics", 18],
    ["reconcile_marketplace_creator_content_tags", 28],
    ["reconcile_marketplace_creator_showcase", 23],
    ["reconcile_marketplace_creator_commerce", 36],
    ["reconcile_marketplace_multi_creator_allocations", 27],
    ["reconcile_marketplace_settlement_reversals", 32],
  ]) {
    if (Object.hasOwn(reconciliations, name)) {
      assert.equal(
        Object.keys(reconciliations[name]).length,
        count,
        `${name}_counter_count`,
      );
    }
  }

  console.log(
    JSON.stringify({ ok: true, ...audit, reconciliations }, null, 2),
  );
} finally {
  await db.end().catch(() => {});
}
