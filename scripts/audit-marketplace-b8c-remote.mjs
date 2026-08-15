import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg,
  pre = process.argv.includes("--expect-pre-b8c"),
  required = process.argv.includes("--require-b8c"),
  cache = join(tmpdir(), "onspace-b8b-npm-cache");
mkdirSync(cache, { recursive: true });
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
      env: { ...process.env, npm_config_cache: cache, DO_NOT_TRACK: "1" },
    },
  );
  captured = String(cli.stdout ?? "") + String(cli.stderr ?? "");
  if (cli.status !== 0)
    throw new Error(
      "b8c_remote_secure_connection_failed:" +
        captured
          .replace(/(PGPASSWORD[=\"']+)[^\"'\r\n ]+/gi, "$1[redacted]")
          .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
          .slice(-800),
    );
}
const env = (name) =>
    process.env[name] ??
    captured.match(
      new RegExp('(?:export |set \\"?)' + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"),
    )?.[1],
  db = new Client({
    host: env("PGHOST"),
    port: Number(env("PGPORT")),
    user: env("PGUSER"),
    password: env("PGPASSWORD"),
    database: env("PGDATABASE"),
    ssl: { rejectUnauthorized: false },
  });
const observational = new Set([
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "refunded_fixture",
  "escrow_expected_held_total",
  "escrow_actual_balance",
]);
function healthy(value, path = "") {
  if (Array.isArray(value)) {
    assert.equal(value.length, 0, path);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value))
      if (!observational.has(key))
        healthy(nested, path ? `${path}.${key}` : key);
    return;
  }
  if (typeof value === "number") assert.equal(value, 0, path);
}
try {
  await db.connect();
  await db.query("set role postgres");
  await db.query(
    "select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)",
    [JSON.stringify({ role: "service_role" })],
  );
  const names = (
      await db.query(
        "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like'reconcile_marketplace_%'and p.pronargs=0 order by p.proname",
      )
    ).rows.map((row) => row.proname),
    reconciliations = {};
  for (const name of names) {
    const value = (await db.query(`select public.${name}()value`)).rows[0]
      .value;
    healthy(value, name);
    reconciliations[name] = value;
  }
  const r = (
    await db.query(`select (select version from supabase_migrations.schema_migrations order by version desc limit 1)latest,
 exists(select 1 from supabase_migrations.schema_migrations where version='20260811031000')b8c_applied,
 to_regprocedure('public.get_marketplace_admin_creator_commerce_overview(text)')is not null creator_overview,
 to_regprocedure('public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer)')is not null creator_search,
 to_regprocedure('public.get_marketplace_admin_creator_detail(uuid,text)')is not null creator_detail,
 to_regprocedure('public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer)')is not null promotion_search,
 to_regprocedure('public.get_marketplace_admin_promotion_detail(uuid)')is not null promotion_detail,
 to_regprocedure('public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer)')is not null ads_search,
 to_regprocedure('public.get_marketplace_admin_ad_detail(uuid)')is not null ads_detail,
 to_regprocedure('public.get_marketplace_admin_health()')is not null health_rpc,
 to_regprocedure('public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)')is not null activity_search,
 case when to_regprocedure('public.get_marketplace_admin_health()')is null then true
   else not has_function_privilege('anon',to_regprocedure('public.get_marketplace_admin_health()'),'execute')end anon_denied,
 not has_function_privilege('authenticated','public.spend_marketplace_ad_budget(uuid,numeric,uuid)','execute')ads_spend_denied,
 not has_function_privilege('authenticated','public.release_marketplace_ad_unused_budget(uuid,uuid)','execute')ads_release_denied,
 not has_function_privilege('authenticated','public.finalize_marketplace_ad_campaign_delivery(uuid,uuid)','execute')ads_finalize_denied,
 not has_table_privilege('authenticated','public.marketplace_admin_action_audit','insert,update,delete')audit_immutable,
 (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('get_marketplace_admin_creator_commerce_overview','search_marketplace_admin_creators','get_marketplace_admin_creator_detail','search_marketplace_admin_promotions','get_marketplace_admin_promotion_detail','search_marketplace_admin_ads','get_marketplace_admin_ad_detail','get_marketplace_admin_health','search_marketplace_admin_activity')and position('marketplace_require_admin' in lower(pg_get_functiondef(p.oid)))=0)unguarded,
 (select count(*)::int from auth.users where email like'b8c-%@proof.local')fixtures,
 to_regprocedure('fixture_ops.fail_b8c_admin_intelligence()')is not null failure_hook`)
  ).rows[0];
  assert.equal(r.fixtures, 0);
  assert.equal(r.failure_hook, false);
  assert.equal(r.unguarded, 0);
  if (pre) {
    assert.equal(r.latest, "20260811030000");
    assert.equal(r.b8c_applied, false);
  }
  if (required) {
    assert.equal(r.latest, "20260811031000");
    for (const key of [
      "b8c_applied",
      "creator_overview",
      "creator_search",
      "creator_detail",
      "promotion_search",
      "promotion_detail",
      "ads_search",
      "ads_detail",
      "health_rpc",
      "activity_search",
      "anon_denied",
      "ads_spend_denied",
      "ads_release_denied",
      "ads_finalize_denied",
      "audit_immutable",
    ])
      assert.equal(r[key], true, key);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: pre ? "pre-b8c" : "require-b8c",
        ...r,
        reconciliations,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end().catch(() => {});
}
