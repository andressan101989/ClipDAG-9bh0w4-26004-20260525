// Real disposable PostgreSQL proof. Set NELYON_PLR10_C1_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR10_C1_LOCAL === "1";
const skipCorrective = process.env.NELYON_PLR10_C1_SKIP_MIGRATION === "1";
const container = process.env.NELYON_PLR10_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR10_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const campaign = "40000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const media = "72000000-0000-4000-8000-000000000001";
const placements = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"];

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const names = readdirSync(migrationDirectory);
const plr10Names = names.filter((name) => name.endsWith("_ads_v2_plr_10_multisurface_age_targeting.sql"));
const c1Names = names.filter((name) => name.endsWith("_ads_v2_plr_10_c1_multisurface_render_payload.sql"));
const plr10 = plr10Names.length === 1 ? readFileSync(new URL(plr10Names[0], migrationDirectory), "utf8") : "";
const c1 = c1Names.length === 1 ? readFileSync(new URL(c1Names[0], migrationDirectory), "utf8") : "";
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], {
    input: sql,
    ...options,
  });
}

function asService(db, sql, options = {}) {
  return psql(db, `begin;set local role service_role;${sql};commit;`, options);
}

function createDatabase() {
  const db = `plr10c1_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `
    insert into private.advertising_targeting_policy(singleton,policy_version)
    values(true,'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age)
    values(true,13,'nelyon-age-v2',18);
  `);
  psql(db, plr10);
  if (!skipCorrective) psql(db, c1);
  psql(db, fixture);
  psql(db, `
    set session_replication_role=replica;
    insert into auth.users(id) values('${viewer}');
    insert into public.user_profiles(id) values('${viewer}');
    insert into private.user_age_eligibility(
      user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
    ) values
      ('${owner}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus',date '1990-01-01'),
      ('${viewer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'legacy_remediation','age_18_plus',date '1992-01-01');
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,status,ready_at,public_url
    ) values(
      '${media}','${owner}','r2','image','business_library','public','business-library',
      'ads/plr10-c1-proof.jpg','image/jpeg','ready',clock_timestamp(),
      'https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/ads/plr10-c1-proof.jpg'
    );
    insert into private.advertising_audience_versions(
      id,audience_id,version_number,age_scope,min_age,max_age,targeting_policy_version,
      definition_fingerprint,creation_idempotency_key,created_by
    ) values(
      '82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',2,
      'adults_only',18,null,'nelyon-ads-targeting-v3',repeat('e',64),
      '82000000-0000-4000-8000-000000000098','${owner}'
    );
    insert into private.advertising_placement_selection_items(
      placement_selection_version_id,placement_code
    ) select '84000000-0000-4000-8000-000000000001',code
      from private.advertising_placement_catalog
      where code in ('clips','stories','live','marketplace_home','marketplace_search');
    insert into private.advertising_billing_rate_versions(
      id,objective,billable_event_type,placement_code,rate_bdag,currency,
      scope,state,effective_from,published_at
    ) values
      ('a0000000-0000-4000-8000-000000000002','awareness','impression','clips',0.001,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('a0000000-0000-4000-8000-000000000003','awareness','impression','stories',0.001,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('a0000000-0000-4000-8000-000000000004','awareness','impression','live',0.001,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('a0000000-0000-4000-8000-000000000005','awareness','impression','marketplace_home',0.001,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),
      ('a0000000-0000-4000-8000-000000000006','awareness','impression','marketplace_search',0.001,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp());
    update private.advertising_placement_catalog
      set v2_delivery_enabled=true
      where code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search');
    update private.advertising_ads
      set submission_fingerprint=private.ads_ad_submission_fingerprint(id)
      where id='${ad}';
    set session_replication_role=origin;
    grant execute on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)
      to supabase_admin,postgres;
    grant execute on function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
      to supabase_admin,postgres;
    grant execute on function private.ads_delivery_viewer_matches_audience_age(uuid,uuid,timestamptz)
      to supabase_admin,postgres;
  `);
  return db;
}

function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}

test("C1 disposable harness targets one PLR-10 migration and one forward corrective migration", { skip: !enabled }, () => {
  assert.equal(plr10Names.length, 1);
  assert.equal(c1Names.length, 1);
  assert.ok(plr10.length > 0);
  assert.ok(c1.length > 0);
});

test("all six placements reach the real candidate, preflight and render RPC chain", { skip: !enabled, timeout: 180_000 }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_advertising_delivery_render_payload_v2' and pg_get_function_identity_arguments(p.oid)='p_ad_id uuid, p_placement_code text, p_viewer_user_id uuid';`).stdout, "1");
    for (const placement of placements) {
      const preflight = JSON.parse(psql(db, `select private.advertising_delivery_preflight_at('${ad}','${placement}','${viewer}',clock_timestamp())::text;`).stdout);
      assert.equal(preflight.production_deliverable, true, `${placement}: ${JSON.stringify(preflight.reason_codes)}`);
      assert.equal(asService(db, `select count(*) from public.fetch_advertising_delivery_candidates_v2('${placement}','${viewer}',1,clock_timestamp());`).stdout, "1");
      const payload = JSON.parse(asService(db, `select public.get_advertising_delivery_render_payload_v2('${ad}','${placement}','${viewer}')::text;`).stdout);
      assert.equal(payload.ad_id, ad);
      assert.equal(payload.advertiser.display_name, "PLR9 Fixture Business");
      assert.equal(payload.creative.media.url, "https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/ads/plr10-c1-proof.jpg");
      assert.equal(payload.destination.external_url, "https://example.com/plr9");
      assert.equal("birth_date" in payload, false);
    }
  } finally { dropDatabase(db); }
});

test("unknown placements error while a known disabled placement returns null through preflight", { skip: !enabled, timeout: 180_000 }, () => {
  const db = createDatabase();
  try {
    const unknown = asService(db, `select public.get_advertising_delivery_render_payload_v2('${ad}','profile','${viewer}');`, { allowFailure: true });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /advertising_delivery_render_placement_invalid/);
    psql(db, "set session_replication_role=replica;update private.advertising_placement_catalog set v2_delivery_enabled=false where code='stories';set session_replication_role=origin;");
    assert.equal(asService(db, `select public.get_advertising_delivery_render_payload_v2('${ad}','stories','${viewer}') is null;`).stdout, "t");
  } finally { dropDatabase(db); }
});

test("render ACL and definition remain service-only, locked and free of the social-only guard", { skip: !enabled, timeout: 180_000 }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('public','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','execute'),
      has_function_privilege('anon','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','execute'),
      has_function_privilege('authenticated','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','execute'),
      has_function_privilege('service_role','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','execute'),
      (select prosecdef from pg_proc where oid='public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)'::regprocedure),
      (select proconfig=array['search_path=""'] from pg_proc where oid='public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)'::regprocedure));`).stdout, "f|f|f|t|t|t");
    const definition = psql(db, "select pg_get_functiondef('public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)'::regprocedure);").stdout;
    assert.doesNotMatch(definition, /p_placement_code\s+is\s+distinct\s+from\s+'social_feed'/i);
    for (const placement of placements) assert.match(definition, new RegExp(`'${placement}'`));
  } finally { dropDatabase(db); }
});
