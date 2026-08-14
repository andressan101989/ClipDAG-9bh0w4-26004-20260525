import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB7e = process.argv.includes("--require-b7e");
const expectPreB7e = process.argv.includes("--expect-pre-b7e");
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
    throw new Error(`b7e_remote_secure_connection_failed:${diagnostic}`);
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
  "b7e_remote_config_missing",
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
    for (const [key, item] of Object.entries(result)) {
      if (!observational.has(key))
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
  const functionNames = (
    await db.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'reconcile_marketplace_%'and p.pronargs=0 order by p.proname",
    )
  ).rows.map((row) => row.proname);
  const reconciliations = {};
  for (const name of functionNames) {
    const result = (
      await db.query(`select public.${name}()value`)
    ).rows[0].value;
    assertHealthy(result, name);
    reconciliations[name] = result;
  }
  const audit = (
    await db.query(`select
      (select version from supabase_migrations.schema_migrations order by version desc limit 1)latest_migration,
      exists(select 1 from supabase_migrations.schema_migrations where version='20260811026000')b7e_applied,
      to_regprocedure('public.create_marketplace_creator_live_attribution(uuid,uuid,uuid)')is not null live_attribution_rpc_present,
      position('set is_featured = false' in lower(pg_get_functiondef('public.feature_live_session_product(uuid,uuid,uuid)'::regprocedure)))>0 feature_clear_present,
      position('set is_featured = true' in lower(pg_get_functiondef('public.feature_live_session_product(uuid,uuid,uuid)'::regprocedure)))>position('set is_featured = false' in lower(pg_get_functiondef('public.feature_live_session_product(uuid,uuid,uuid)'::regprocedure))) feature_order_safe,
      to_regprocedure('fixture_ops.fail_b7e_live_commerce()')is not null failure_function_present,
      exists(select 1 from pg_trigger where not tgisinternal and tgname like'fixture_b7e%')failure_trigger_present,
      (select count(*)::int from auth.users where email like'b7e-%@proof.local'or email like'b7e%-%@proof.local')b7e_fixture_users`)
  ).rows[0];
  let authority = null;
  if (audit.live_attribution_rpc_present) {
    authority = (
      await db.query(`select
        has_function_privilege('authenticated','public.create_marketplace_creator_live_attribution(uuid,uuid,uuid)','EXECUTE')authenticated_buyer_granted,
        not has_function_privilege('anon','public.create_marketplace_creator_live_attribution(uuid,uuid,uuid)','EXECUTE')anon_denied,
        not has_function_privilege('authenticated','public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE')b7a_helper_private,
        not has_table_privilege('authenticated','public.live_session_products','INSERT,UPDATE,DELETE')raw_pin_mutation_denied,
        not has_table_privilege('authenticated','public.marketplace_creator_commerce_attributions','INSERT,UPDATE,DELETE')raw_attribution_mutation_denied,
        has_function_privilege('authenticated','public.pin_live_session_product(uuid,uuid,uuid,uuid)','EXECUTE')host_pin_rpc_granted,
        has_function_privilege('authenticated','public.unpin_live_session_product(uuid,uuid,uuid)','EXECUTE')host_unpin_rpc_granted,
        has_function_privilege('authenticated','public.feature_live_session_product(uuid,uuid,uuid)','EXECUTE')host_feature_rpc_granted`)
    ).rows[0];
    for (const [name, healthy] of Object.entries(authority)) {
      assert.equal(healthy, true, `b7e_remote_authority_${name}`);
    }
  }
  assert.equal(audit.b7e_fixture_users, 0, "b7e_remote_fixture_users_present");
  assert.equal(
    audit.failure_function_present,
    false,
    "b7e_remote_failure_function_present",
  );
  assert.equal(
    audit.failure_trigger_present,
    false,
    "b7e_remote_failure_trigger_present",
  );
  if (expectPreB7e) {
    assert.equal(
      audit.latest_migration,
      "20260811025100",
      "b7e_remote_predeploy_parity_mismatch",
    );
    assert.equal(audit.b7e_applied, false, "b7e_remote_unexpectedly_applied");
    assert.equal(
      audit.live_attribution_rpc_present,
      false,
      "b7e_remote_rpc_unexpected",
    );
  }
  if (requireB7e) {
    assert.equal(
      audit.latest_migration,
      "20260811026000",
      "b7e_remote_migration_parity_mismatch",
    );
    assert.equal(audit.b7e_applied, true, "b7e_remote_migration_missing");
    assert.equal(
      audit.live_attribution_rpc_present,
      true,
      "b7e_remote_rpc_missing",
    );
    assert.equal(audit.feature_clear_present, true, "b7e_feature_clear_missing");
    assert.equal(audit.feature_order_safe, true, "b7e_feature_order_unsafe");
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
    JSON.stringify({ ok: true, ...audit, authority, reconciliations }, null, 2),
  );
} finally {
  await db.end().catch(() => {});
}
