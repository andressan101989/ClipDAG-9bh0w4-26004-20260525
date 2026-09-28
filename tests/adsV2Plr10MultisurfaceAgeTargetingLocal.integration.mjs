// Real disposable PostgreSQL proof. Set NELYON_PLR10_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR10_LOCAL === "1";
const container = process.env.NELYON_PLR10_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR10_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";
const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_10_multisurface_age_targeting.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], {
    input: sql,
    ...options,
  });
}

function databaseName(label) {
  return `plr10_${label}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createDatabase(label, withFixture = false) {
  const db = databaseName(label);
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `
    insert into private.advertising_targeting_policy(singleton, policy_version)
    values(true, 'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(
      singleton, minimum_age, policy_version, creator_exclusive_minimum_age
    ) values(true, 13, 'nelyon-age-v2', 18);
  `);
  psql(db, migration);
  if (withFixture) psql(db, fixture);
  return db;
}

function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}

test("PLR-10 disposable harness targets exactly one migration", { skip: !enabled }, () => {
  assert.equal(migrationNames.length, 1);
  assert.ok(migration.length > 0);
});

test("migration preserves DISARMED and exposes six ready-but-disabled adapters", { skip: !enabled }, () => {
  const db = createDatabase("schema");
  try {
    assert.equal(psql(db, `
      select concat_ws('|',launch.launch_mode,launch.canary_enabled,finance.funding_enabled,
        finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,
        lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled,
        (select count(*) from private.advertising_placement_catalog where v2_delivery_enabled),
        (select count(*) from private.advertising_billing_rate_versions where state='published'),
        (select count(*) from private.advertising_billing_authorization_windows where status='OPEN'))
      from private.advertising_canary_policy launch
      cross join private.advertising_finance_policy finance
      cross join private.advertising_campaign_lifecycle_policy lifecycle
      cross join private.advertising_delivery_policy delivery
      where launch.singleton and finance.singleton and lifecycle.singleton and delivery.singleton;
    `).stdout, "DISARMED|f|f|f|f|f|f|f|0|0|0");
    assert.equal(psql(db, `select string_agg(code||':'||selection_enabled||':'||(adapter_version='ads-v2-plr-10')||':'||v2_delivery_enabled,',' order by code) from private.advertising_placement_catalog;`).stdout,
      "clips:true:true:false,live:true:true:false,marketplace_home:true:true:false,marketplace_search:true:true:false,social_feed:true:true:false,stories:true:true:false");
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.get_my_advertising_placement_capabilities_v2()','execute')||'|'||has_function_privilege('anon','public.get_my_advertising_placement_capabilities_v2()','execute');`).stdout, "true|false");
  } finally { dropDatabase(db); }
});

test("age definitions accept 13–17, 18–35 and 65+ while rejecting unsafe ranges", { skip: !enabled }, () => {
  const db = createDatabase("definitions");
  try {
    const normalized = (definition) => JSON.parse(psql(db, `select private.ads_normalize_audience_definition('${JSON.stringify(definition)}'::jsonb)::text;`).stdout);
    assert.deepEqual(normalized({ age_scope: "age_range", min_age: 13, max_age: 17 }).min_age, 13);
    assert.deepEqual(normalized({ age_scope: "age_range", min_age: 18, max_age: 35 }).max_age, 35);
    assert.equal(normalized({ age_scope: "age_range", min_age: 65, max_age: null }).max_age, null);
    const legacy = normalized({ age_scope: "adults_only" });
    assert.equal(legacy.min_age, 18);
    assert.equal(legacy.max_age, null);
    for (const definition of [
      { age_scope: "age_range", min_age: 12, max_age: 17 },
      { age_scope: "age_range", min_age: 35, max_age: 18 },
      { age_scope: "age_range", min_age: 18, max_age: 121 },
    ]) {
      assert.notEqual(psql(db, `select private.ads_normalize_audience_definition('${JSON.stringify(definition)}'::jsonb);`, { allowFailure: true }).status, 0);
    }
  } finally { dropDatabase(db); }
});

test("viewer age is derived privately and historical adults-only remains compatible", { skip: !enabled }, () => {
  const db = createDatabase("viewer", true);
  try {
    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id) values
        ('10000000-0000-4000-8000-000000000013'),
        ('10000000-0000-4000-8000-000000000018'),
        ('10000000-0000-4000-8000-000000000099');
      insert into public.user_profiles(id) values
        ('10000000-0000-4000-8000-000000000013'),
        ('10000000-0000-4000-8000-000000000018'),
        ('10000000-0000-4000-8000-000000000099');
      insert into private.user_age_eligibility(user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      select id,'eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation',
        case when id='10000000-0000-4000-8000-000000000013' then 'age_13_17' else 'age_18_plus' end,
        case when id='10000000-0000-4000-8000-000000000013' then date '2010-01-01'
             when id='10000000-0000-4000-8000-000000000018' then date '1990-01-01' else null end
      from auth.users where id in (
        '10000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000018','10000000-0000-4000-8000-000000000099');
      insert into private.advertising_audience_versions(
        id,audience_id,version_number,age_scope,min_age,max_age,targeting_policy_version,
        definition_fingerprint,creation_idempotency_key,created_by
      ) values(
        '82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',2,
        'age_range',13,17,'nelyon-ads-targeting-v3',repeat('e',64),
        '82000000-0000-4000-8000-000000000098','10000000-0000-4000-8000-000000000001'
      );
      set session_replication_role=origin;
    `);
    assert.equal(psql(db, `select private.ads_delivery_viewer_matches_audience_age('82000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000013',timestamptz '2026-09-28 12:00:00+00');`).stdout, "t");
    assert.equal(psql(db, `select private.ads_delivery_viewer_matches_audience_age('82000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000018',timestamptz '2026-09-28 12:00:00+00');`).stdout, "f");
    assert.equal(psql(db, `select private.ads_delivery_viewer_matches_audience_age('82000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000099',timestamptz '2026-09-28 12:00:00+00');`).stdout, "t");
    const columns = psql(db, `select string_agg(key,',' order by key) from jsonb_object_keys(public.get_my_advertising_targeting_capabilities()) key;`, { allowFailure: true });
    assert.doesNotMatch(columns.stdout, /birth|dob/i);
  } finally { dropDatabase(db); }
});
