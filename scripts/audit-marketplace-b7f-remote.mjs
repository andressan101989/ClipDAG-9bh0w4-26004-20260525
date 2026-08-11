import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB7f = process.argv.includes("--require-b7f");
const expectPreB7f = process.argv.includes("--expect-pre-b7f");
const npmCache = join(tmpdir(), "onspace-ads-npm-cache");
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
    ["/d", "/s", "/c", "npx.cmd supabase db dump --linked --schema public --dry-run"],
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
    throw new Error(`b7f_remote_secure_connection_failed:${diagnostic}`);
  }
}

const value = (name) =>
  process.env[name] ??
  captured.match(new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`))?.[1];
const config = {
  host: value("PGHOST"),
  port: Number(value("PGPORT")),
  user: value("PGUSER"),
  password: value("PGPASSWORD"),
  database: value("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
};
assert(
  config.host && config.port && config.user && config.password && config.database,
  "b7f_remote_config_missing",
);

const observationalKeys = new Set([
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
    for (const [key, item] of Object.entries(result)) {
      if (observationalKeys.has(key)) continue;
      assertHealthy(item, path ? `${path}.${key}` : key);
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
  const functions = (
    await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'reconcile_marketplace_%'
         and p.pronargs=0 order by p.proname`,
    )
  ).rows.map((row) => row.proname);
  const reconciliations = {};
  for (const name of functions) {
    const result = (await db.query(`select public.${name}() value`)).rows[0].value;
    assertHealthy(result, name);
    reconciliations[name] = result;
  }
  const audit = (
    await db.query(`select
      (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
      exists(select 1 from supabase_migrations.schema_migrations where version='20260811010000') b7f_applied,
      to_regclass('public.marketplace_order_item_creator_allocations') is not null allocation_table_present,
      to_regprocedure('public.reconcile_marketplace_multi_creator_allocations()') is not null reconciliation_present,
      to_regprocedure('fixture_ops.fail_b7f_after_allocation()') is not null failure_function_present,
      exists(select 1 from pg_trigger where not tgisinternal and tgname like 'fixture_b7f%') failure_trigger_present,
      (select count(*)::int from auth.users where email like 'b7f-%@proof.local') b7f_fixture_users`)
  ).rows[0];
  let authority = null;
  if (audit.allocation_table_present) {
    authority = (
      await db.query(`select
        c.relrowsecurity rls_enabled,
        not has_table_privilege('authenticated','public.marketplace_order_item_creator_allocations','INSERT,UPDATE,DELETE') client_raw_mutation_denied,
        not has_function_privilege('authenticated','public.apply_marketplace_order_item_creator_allocations(uuid,jsonb,uuid)','EXECUTE') authenticated_authority_denied,
        not has_function_privilege('service_role','public.marketplace_create_order_settlement_b7f(uuid,uuid,uuid,uuid,text)','EXECUTE') internal_helper_private
       from pg_class c where c.oid='public.marketplace_order_item_creator_allocations'::regclass`)
    ).rows[0];
    assert.equal(authority.rls_enabled, true, "b7f_remote_rls_disabled");
    assert.equal(authority.client_raw_mutation_denied, true, "b7f_remote_client_table_mutation_allowed");
    assert.equal(authority.authenticated_authority_denied, true, "b7f_remote_authenticated_authority_allowed");
    assert.equal(authority.internal_helper_private, true, "b7f_remote_internal_helper_exposed");
  }
  assert.equal(audit.b7f_fixture_users, 0, "b7f_remote_fixture_users_present");
  assert.equal(audit.failure_function_present, false, "b7f_remote_failure_function_present");
  assert.equal(audit.failure_trigger_present, false, "b7f_remote_failure_trigger_present");
  if (expectPreB7f) {
    assert.equal(audit.latest_migration, "20260810180000", "b7f_remote_predeploy_parity_mismatch");
    assert.equal(audit.b7f_applied, false, "b7f_remote_unexpectedly_applied");
  }
  if (requireB7f) {
    assert.equal(audit.latest_migration, "20260811010000", "b7f_remote_migration_parity_mismatch");
    assert.equal(audit.b7f_applied, true, "b7f_remote_migration_missing");
    assert.equal(audit.reconciliation_present, true, "b7f_remote_reconciliation_missing");
    assert(Object.hasOwn(reconciliations, "reconcile_marketplace_multi_creator_allocations"));
  }
  console.log(JSON.stringify({ ok: true, ...audit, authority, reconciliations }, null, 2));
} finally {
  await db.end().catch(() => {});
}
