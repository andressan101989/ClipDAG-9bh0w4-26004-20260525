import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB8a = process.argv.includes("--require-b8a");
const expectPreB8a = process.argv.includes("--expect-pre-b8a");
const npmCache = join(tmpdir(), "onspace-b7a-npm-cache");
mkdirSync(npmCache, { recursive: true });
let captured = "";
if (!process.env.PGHOST || !process.env.PGPORT || !process.env.PGUSER || !process.env.PGPASSWORD) {
  const cli = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run"], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, npm_config_cache: npmCache, DO_NOT_TRACK: "1" },
  });
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0) {
    const diagnostic = captured.replace(/(PGPASSWORD[="']+)[^"'\r\n ]+/gi, "$1[redacted]")
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]").slice(-800);
    throw new Error("b8a_remote_secure_connection_failed:" + diagnostic);
  }
}
const envValue = (name) => process.env[name] ?? captured.match(new RegExp("(?:export |set \\\"?)" + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1];
const config = { host: envValue("PGHOST"), port: Number(envValue("PGPORT")), user: envValue("PGUSER"), password: envValue("PGPASSWORD"), database: envValue("PGDATABASE"), ssl: { rejectUnauthorized: false } };
assert(config.host && config.port && config.user && config.password && config.database, "b8a_remote_config_missing");

const observational = new Set(["confirmed", "processing", "shipped", "delivered", "refunded_fixture", "escrow_expected_held_total", "escrow_actual_balance"]);
function assertHealthy(value, path = "") {
  if (Array.isArray(value)) { assert.equal(value.length, 0, path + "_not_empty"); return; }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) if (!observational.has(key)) assertHealthy(nested, path ? path + "." + key : key);
    return;
  }
  if (typeof value === "number") assert.equal(value, 0, path + "_nonzero");
}

const db = new Client(config);
try {
  await db.connect();
  await db.query("set role postgres");
  await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)", [JSON.stringify({ role: "service_role" })]);
  const names = (await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'reconcile_marketplace_%'and p.pronargs=0 order by p.proname")).rows.map((row) => row.proname);
  const reconciliations = {};
  for (const name of names) {
    const value = (await db.query("select public." + name + "() value")).rows[0].value;
    assertHealthy(value, name);
    reconciliations[name] = value;
  }
  const audit = (await db.query(
    "select " +
    "(select version from supabase_migrations.schema_migrations order by version desc limit 1)latest_migration," +
    "exists(select 1 from supabase_migrations.schema_migrations where version='20260811027000')b8s_applied," +
    "exists(select 1 from supabase_migrations.schema_migrations where version='20260811028000')b8a_applied," +
    "to_regprocedure('public.protect_user_profile_server_fields()')is not null b8s_guard_present," +
    "exists(select 1 from pg_trigger where tgrelid='public.user_profiles'::regclass and tgname='protect_user_profile_server_fields'and not tgisinternal)b8s_trigger_present," +
    "not has_column_privilege('authenticated','public.user_profiles','is_admin','UPDATE')b8s_admin_update_denied," +
    "to_regprocedure('public.marketplace_require_admin()')is not null admin_guard_present," +
    "to_regprocedure('public.get_my_marketplace_admin_access()')is not null access_rpc_present," +
    "to_regprocedure('public.get_marketplace_admin_overview(text)')is not null overview_rpc_present," +
    "to_regprocedure('public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer)')is not null search_rpc_present," +
    "to_regprocedure('public.get_marketplace_admin_order_detail(uuid)')is not null detail_rpc_present," +
    "case when to_regprocedure('public.marketplace_require_admin()')is not null then not has_function_privilege('anon',to_regprocedure('public.marketplace_require_admin()'),'execute')else false end anon_guard_denied," +
    "case when to_regprocedure('public.marketplace_require_admin()')is not null then not has_function_privilege('authenticated',to_regprocedure('public.marketplace_require_admin()'),'execute')else false end authenticated_guard_denied," +
    "case when to_regprocedure('public.get_my_marketplace_admin_access()')is not null then not has_function_privilege('anon',to_regprocedure('public.get_my_marketplace_admin_access()'),'execute')else false end anon_access_denied," +
    "case when to_regprocedure('public.get_marketplace_admin_overview(text)')is not null then not has_function_privilege('anon',to_regprocedure('public.get_marketplace_admin_overview(text)'),'execute')else false end anon_overview_denied," +
    "case when to_regprocedure('public.get_marketplace_admin_overview(text)')is not null then has_function_privilege('authenticated',to_regprocedure('public.get_marketplace_admin_overview(text)'),'execute')else false end authenticated_overview_granted," +
    "coalesce((select array_to_string(proconfig,',')ilike'%search_path=pg_catalog, public%'from pg_proc where oid=to_regprocedure('public.marketplace_require_admin()')),false)admin_guard_fixed_search_path," +
    "case when to_regprocedure('public.marketplace_require_admin()')is not null then position('auth.uid()'in lower(pg_get_functiondef(to_regprocedure('public.marketplace_require_admin()'))))>0 else false end admin_guard_uses_auth_uid," +
    "case when to_regprocedure('public.marketplace_require_admin()')is not null then position('marketplace_actor_is_admin'in lower(pg_get_functiondef(to_regprocedure('public.marketplace_require_admin()'))))>0 else false end admin_guard_uses_b8s_authority," +
    "(select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'%marketplace_admin%'and pg_get_functiondef(p.oid)~*'(insert into|update |delete from) public[.](marketplace_|ledger_|financial_)')admin_mutation_functions," +
    "to_regprocedure('fixture_ops.fail_b8a_admin_web()')is not null failure_function_present," +
    "exists(select 1 from pg_trigger where not tgisinternal and tgname like'fixture_b8a%')failure_trigger_present," +
    "(select count(*)::int from auth.users where email like'b8a-%@proof.local')b8a_fixture_users"
  )).rows[0];
  for (const [key, value] of Object.entries({ b8s_applied: true, b8s_guard_present: true, b8s_trigger_present: true, b8s_admin_update_denied: true })) assert.equal(audit[key], value, "b8a_" + key);
  assert.equal(audit.admin_mutation_functions, 0, "b8a_admin_mutation_function_present");
  assert.equal(audit.failure_function_present, false);
  assert.equal(audit.failure_trigger_present, false);
  assert.equal(audit.b8a_fixture_users, 0);
  if (expectPreB8a) {
    assert.equal(audit.latest_migration, "20260811027000", "b8a_predeploy_parity_mismatch");
    assert.equal(audit.b8a_applied, false);
    assert.equal(audit.admin_guard_present, false);
  }
  if (requireB8a) {
    assert.equal(audit.latest_migration, "20260811028000", "b8a_migration_parity_mismatch");
    for (const key of ["b8a_applied", "admin_guard_present", "access_rpc_present", "overview_rpc_present", "search_rpc_present", "detail_rpc_present", "anon_guard_denied", "authenticated_guard_denied", "anon_access_denied", "anon_overview_denied", "authenticated_overview_granted", "admin_guard_fixed_search_path", "admin_guard_uses_auth_uid", "admin_guard_uses_b8s_authority"]) assert.equal(audit[key], true, "b8a_" + key);
  }
  for (const [name, count] of [["reconcile_marketplace_creator_commerce_analytics", 18], ["reconcile_marketplace_creator_content_tags", 28], ["reconcile_marketplace_creator_showcase", 23], ["reconcile_marketplace_creator_commerce", 36], ["reconcile_marketplace_multi_creator_allocations", 27], ["reconcile_marketplace_settlement_reversals", 32]]) if (Object.hasOwn(reconciliations, name)) assert.equal(Object.keys(reconciliations[name]).length, count, name + "_counter_count");
  console.log(JSON.stringify({ ok: true, ...audit, reconciliations }, null, 2));
} finally {
  await db.end().catch(() => {});
}
