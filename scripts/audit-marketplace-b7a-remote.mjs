import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB7a = process.argv.includes("--require-b7a");
const expectPreB7a = process.argv.includes("--expect-pre-b7a");
const finalizeExpiredAds = process.argv.includes("--finalize-expired-ads");
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
    throw new Error(`b7a_remote_secure_connection_failed:${diagnostic}`);
  }
}

const value = (name) =>
  process.env[name] ??
  captured.match(
    new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`),
  )?.[1];
const config = {
  host: value("PGHOST"),
  port: Number(value("PGPORT")),
  user: value("PGUSER"),
  password: value("PGPASSWORD"),
  database: value("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
};
assert(
  config.host &&
    config.port &&
    config.user &&
    config.password &&
    config.database,
  "b7a_remote_config_missing",
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
  const maintenance = finalizeExpiredAds
    ? (
        await db.query(
          "select public.finalize_expired_marketplace_ad_campaigns(100) value",
        )
      ).rows[0].value
    : null;
  const functions = (
    await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'reconcile_marketplace_%'
         and p.pronargs=0 order by p.proname`,
    )
  ).rows.map((row) => row.proname);
  const reconciliations = {};
  for (const name of functions) {
    const result = (await db.query(`select public.${name}() value`)).rows[0]
      .value;
    assertHealthy(result, name);
    reconciliations[name] = result;
  }
  const audit = (
    await db.query(`select
      (select version from supabase_migrations.schema_migrations order by version desc limit 1) latest_migration,
      exists(select 1 from supabase_migrations.schema_migrations where version='20260811020000') b7a_applied,
      exists(select 1 from supabase_migrations.schema_migrations where version='20260811021000') b7a_reconciliation_scope_applied,
      to_regclass('public.marketplace_creator_commerce_attributions') is not null attribution_table_present,
      to_regclass('public.marketplace_order_item_creator_attributions') is not null snapshot_table_present,
      to_regprocedure('public.reconcile_marketplace_creator_commerce()') is not null reconciliation_present,
      to_regprocedure('fixture_ops.fail_b7a_after_attribution()') is not null failure_function_present,
      exists(select 1 from pg_trigger where not tgisinternal and tgname like 'fixture_b7a%') failure_trigger_present,
      (select count(*)::int from auth.users where email like 'b7a-%@proof.local') b7a_fixture_users,
      (select count(*)::int from public.marketplace_order_item_creator_allocations) b7f_allocation_rows,
      (select count(*)::int from public.marketplace_order_item_creator_allocations a
        join public.marketplace_live_order_sources s on s.order_id=a.order_id) live_b7f_allocation_rows`)
  ).rows[0];
  let authority = null;
  if (audit.attribution_table_present) {
    authority = (
      await db.query(`select
        a.relrowsecurity attribution_rls,
        s.relrowsecurity snapshot_rls,
        not has_table_privilege('authenticated','public.marketplace_creator_commerce_attributions','INSERT,UPDATE,DELETE') client_attribution_mutation_denied,
        not has_table_privilege('authenticated','public.marketplace_order_item_creator_attributions','INSERT,UPDATE,DELETE') client_snapshot_mutation_denied,
        not has_function_privilege('authenticated','public.create_marketplace_creator_commerce_attribution(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE') authenticated_attribution_authority_denied,
        not has_function_privilege('authenticated','public.finalize_marketplace_creator_commerce_for_order(uuid,uuid)','EXECUTE') authenticated_finalizer_denied,
        not has_function_privilege('service_role','public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE') internal_helper_private
       from pg_class a,pg_class s
       where a.oid='public.marketplace_creator_commerce_attributions'::regclass
         and s.oid='public.marketplace_order_item_creator_attributions'::regclass`)
    ).rows[0];
    for (const [name, healthy] of Object.entries(authority)) {
      assert.equal(healthy, true, `b7a_remote_authority_${name}`);
    }
  }
  assert.equal(audit.b7a_fixture_users, 0, "b7a_remote_fixture_users_present");
  assert.equal(
    audit.failure_function_present,
    false,
    "b7a_remote_failure_function_present",
  );
  assert.equal(
    audit.failure_trigger_present,
    false,
    "b7a_remote_failure_trigger_present",
  );
  if (expectPreB7a) {
    assert.equal(
      audit.latest_migration,
      "20260811010000",
      "b7a_remote_predeploy_parity_mismatch",
    );
    assert.equal(audit.b7a_applied, false, "b7a_remote_unexpectedly_applied");
  }
  if (requireB7a) {
    assert.equal(
      audit.latest_migration,
      "20260811021000",
      "b7a_remote_migration_parity_mismatch",
    );
    assert.equal(audit.b7a_applied, true, "b7a_remote_migration_missing");
    assert.equal(
      audit.b7a_reconciliation_scope_applied,
      true,
      "b7a_remote_reconciliation_scope_missing",
    );
    assert.equal(
      audit.reconciliation_present,
      true,
      "b7a_remote_reconciliation_missing",
    );
    assert(
      Object.hasOwn(reconciliations, "reconcile_marketplace_creator_commerce"),
    );
  }
  console.log(JSON.stringify({
    ok: true,
    maintenance,
    ...audit,
    authority,
    reconciliations,
  }, null, 2));
} finally {
  await db.end().catch(() => {});
}
