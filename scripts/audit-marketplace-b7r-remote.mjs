import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const requireB7r = process.argv.includes("--require-b7r");
// Reuse the repository's populated Supabase CLI cache; a fresh npx cache would
// require an unnecessary registry fetch in restricted CI environments.
const npmCache = join(tmpdir(), "onspace-ads-npm-cache");
mkdirSync(npmCache, { recursive: true });
let captured = "";
if (!process.env.PGHOST || !process.env.PGPORT || !process.env.PGUSER || !process.env.PGPASSWORD) {
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
      .replace(/(PGPASSWORD[=\"']+)[^\"'\r\n ]+/gi, "$1[redacted]")
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
      .slice(-800);
    throw new Error(`b7r_remote_secure_connection_failed:${diagnostic}`);
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
  config.host &&
    config.port &&
    config.user &&
    config.password &&
    config.database,
  "b7r_remote_config_missing",
);

const observationalPaymentKeys = new Set([
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "refunded_fixture",
  "escrow_expected_held_total",
  "escrow_actual_balance",
]);

function assertHealthy(value, path = "") {
  if (Array.isArray(value)) {
    assert.equal(value.length, 0, `${path}_not_empty`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (observationalPaymentKeys.has(key)) continue;
      assertHealthy(item, path ? `${path}.${key}` : key);
    }
    return;
  }
  if (typeof value === "number") assert.equal(value, 0, `${path}_nonzero`);
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
      `select p.proname
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
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
      exists(select 1 from supabase_migrations.schema_migrations where version='20260810180000') b7r_applied,
      (select count(*)::int from auth.users where email like 'b7r-%@proof.local') b7r_fixture_users,
      to_regprocedure('fixture_ops.fail_b7r_after_first_leg()') is not null failure_function_present,
      exists(select 1 from pg_trigger where not tgisinternal and tgname='fixture_b7r_fail_after_first_leg') failure_trigger_present`)
  ).rows[0];
  assert.equal(audit.b7r_fixture_users, 0, "b7r_remote_fixture_users_present");
  assert.equal(
    audit.failure_function_present,
    false,
    "b7r_remote_failure_function_present",
  );
  assert.equal(
    audit.failure_trigger_present,
    false,
    "b7r_remote_failure_trigger_present",
  );
  if (requireB7r) {
    assert.equal(audit.b7r_applied, true, "b7r_remote_migration_missing");
    assert.equal(
      audit.latest_migration,
      "20260810180000",
      "b7r_remote_migration_parity_mismatch",
    );
    assert(
      Object.hasOwn(
        reconciliations,
        "reconcile_marketplace_settlement_reversals",
      ),
      "b7r_remote_reconciliation_missing",
    );
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        latest_migration: audit.latest_migration,
        b7r_applied: audit.b7r_applied,
        b7r_fixture_users: audit.b7r_fixture_users,
        failure_function_present: audit.failure_function_present,
        failure_trigger_present: audit.failure_trigger_present,
        reconciliations,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end().catch(() => {});
}
