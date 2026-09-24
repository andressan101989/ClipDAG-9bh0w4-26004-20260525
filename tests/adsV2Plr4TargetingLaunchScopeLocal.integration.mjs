// Disposable PostgreSQL proof only. NELYON_PLR4_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR4_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr4_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaign = "40000000-0000-4000-8000-000000000001";
const adSet = "50000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const audience = "81000000-0000-4000-8000-000000000001";
const legacyVersion = "82000000-0000-4000-8000-000000000001";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const asOwner = (sql) => run(`begin;set local request.jwt.claim.sub='${owner}';${sql};commit;`);

function rawConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = String\\.raw\\\`([\\s\\S]*?)\\\`;`));
  assert.ok(match, `${name} bootstrap missing`);
  return match[1];
}

function substitute(source) {
  return source
    .replaceAll("${owner}", owner)
    .replaceAll("${viewer}", viewer)
    .replaceAll("${intruder}", "10000000-0000-4000-8000-000000000003")
    .replaceAll("${business}", business)
    .replaceAll("${account}", account)
    .replaceAll("${campaign}", campaign)
    .replaceAll("${futureCampaign}", "40000000-0000-4000-8000-000000000002")
    .replaceAll("${draftCampaign}", "40000000-0000-4000-8000-000000000003")
    .replaceAll("${adSet}", adSet)
    .replaceAll("${futureAdSet}", "50000000-0000-4000-8000-000000000002")
    .replaceAll("${destination}", "60000000-0000-4000-8000-000000000001")
    .replaceAll("${futureDestination}", "60000000-0000-4000-8000-000000000002")
    .replaceAll("${creative}", "70000000-0000-4000-8000-000000000001")
    .replaceAll("${version}", "71000000-0000-4000-8000-000000000001")
    .replaceAll("${media}", "72000000-0000-4000-8000-000000000001")
    .replaceAll("${ad}", ad)
    .replaceAll("${futureAd}", "80000000-0000-4000-8000-000000000002");
}

const plr3Harness = readFileSync(new URL("./adsV2Plr3CampaignLifecycleLocal.integration.mjs", import.meta.url), "utf8");
let bootstrap = substitute(rawConstant(plr3Harness, "bootstrap"));
let fixture = substitute(rawConstant(plr3Harness, "fixture"));

const oldPolicyTable = "create table private.advertising_targeting_policy(singleton boolean primary key,policy_version text,minor_targeting_allowed boolean,interest_targeting_enabled boolean,behavioral_targeting_enabled boolean,custom_audiences_enabled boolean,lookalike_targeting_enabled boolean,sensitive_targeting_allowed boolean,precise_viewer_location_matching_enabled boolean);";
const newPolicyTable = `create table private.advertising_targeting_policy(
 singleton boolean primary key default true check(singleton),policy_version text not null,
 advertiser_minimum_age smallint not null default 18,audience_minimum_age smallint not null default 18,
 minor_targeting_allowed boolean not null default false,interest_targeting_enabled boolean not null default false,
 behavioral_targeting_enabled boolean not null default false,custom_audiences_enabled boolean not null default false,
 lookalike_targeting_enabled boolean not null default false,sensitive_targeting_allowed boolean not null default false,
 precise_viewer_location_matching_enabled boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint advertising_targeting_policy_version_chk check(policy_version~'^nelyon-ads-targeting-v[0-9]+$'),
 constraint advertising_targeting_policy_v1_age_chk check(advertiser_minimum_age=18 and audience_minimum_age=18),
 constraint advertising_targeting_policy_v1_privacy_chk check(not minor_targeting_allowed and not interest_targeting_enabled and not behavioral_targeting_enabled and not custom_audiences_enabled and not lookalike_targeting_enabled and not sensitive_targeting_allowed and not precise_viewer_location_matching_enabled)
);
create function private.advertising_targeting_policy_immutable()returns trigger language plpgsql security definer set search_path='' as $$begin raise exception using errcode='42501',message='advertising_targeting_policy_migration_required';end;$$;
create trigger advertising_targeting_policy_immutable before update or delete on private.advertising_targeting_policy for each row execute function private.advertising_targeting_policy_immutable();`;
assert.ok(bootstrap.includes(oldPolicyTable));
bootstrap = bootstrap.replace(oldPolicyTable, () => newPolicyTable);
bootstrap = bootstrap.replace(
  "create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null,age_scope text,created_at timestamptz default now());",
  "create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null,age_scope text,targeting_policy_version text not null,created_at timestamptz default now());",
);
bootstrap = bootstrap.replace(
  "insert into private.advertising_targeting_policy values(true,'nelyon-ads-targeting-v1',false,false,false,false,false,false,false);",
  "insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v1');",
);
fixture = fixture.replace(
  "'81000000-0000-4000-8000-000000000001',1,'adults_only',now())",
  "'81000000-0000-4000-8000-000000000001',1,'adults_only','nelyon-ads-targeting-v1',now())",
).replace(
  "'81000000-0000-4000-8000-000000000002',1,'adults_only',now())",
  "'81000000-0000-4000-8000-000000000002',1,'adults_only','nelyon-ads-targeting-v1',now())",
);

const plr3Migration = readFileSync(new URL("../supabase/migrations/20260924003147_ads_v2_plr_3_campaign_activation_lifecycle.sql", import.meta.url), "utf8");
const plr4Migration = readFileSync(new URL("../supabase/migrations/20260924024512_ads_v2_plr_4_targeting_launch_scope.sql", import.meta.url), "utf8");

test("PLR-4 compiles and proves policy, stale audience, runtime and privacy gates in disposable PostgreSQL", { skip: !enabled, timeout: 180_000 }, () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(plr3Migration);
    run(plr4Migration);

    assert.equal(run("select policy_version||':'||geo_targeting_enabled||':'||language_targeting_enabled||':'||daypart_targeting_enabled||':'||frequency_targeting_enabled from private.advertising_targeting_policy"), "nelyon-ads-targeting-v2:false:false:true:true");
    const normalized = JSON.parse(run("select private.ads_normalize_audience_definition('{\"age_scope\":\"adults_only\",\"geographies\":[],\"languages\":[],\"dayparts\":[],\"frequency\":null}'::jsonb)"));
    assert.equal(normalized.targeting_policy_version, "nelyon-ads-targeting-v2");
    assert.throws(() => run("select private.ads_normalize_audience_definition('{\"age_scope\":\"adults_only\",\"geographies\":[{\"mode\":\"include\",\"type\":\"country\",\"country_code\":\"US\"}],\"languages\":[],\"dayparts\":[],\"frequency\":null}'::jsonb)"), /advertising_audience_geo_targeting_not_enabled/);
    assert.throws(() => run("select private.ads_normalize_audience_definition('{\"age_scope\":\"adults_only\",\"geographies\":[],\"languages\":[{\"mode\":\"include\",\"tag\":\"en\"}],\"dayparts\":[],\"frequency\":null}'::jsonb)"), /advertising_audience_language_targeting_not_enabled/);
    assert.throws(() => run("select private.ads_normalize_audience_definition('{\"age_scope\":\"adults_only\",\"geographies\":[],\"languages\":[],\"dayparts\":[{\"timezone\":\"Not/AZone\",\"weekday\":1,\"start\":\"09:00\",\"end\":\"17:00\"}],\"frequency\":null}'::jsonb)"), /advertising_audience_timezone_invalid/);
    assert.throws(() => run("select private.ads_normalize_audience_definition('{\"age_scope\":\"adults_only\",\"geographies\":[],\"languages\":[],\"dayparts\":[],\"frequency\":{\"max_impressions\":21,\"window_hours\":24}}'::jsonb)"), /advertising_audience_frequency_invalid/);
    assert.throws(() => run("select public.get_my_advertising_targeting_capabilities()"), /advertising_auth_required/);
    assert.match(asOwner("select public.get_my_advertising_targeting_capabilities()"), /"policy_version": "nelyon-ads-targeting-v2"/);
    assert.equal(run("select has_function_privilege('anon','public.get_my_advertising_targeting_capabilities()','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.get_my_advertising_targeting_capabilities()','EXECUTE')"), "t");
    assert.throws(() => run("alter table private.advertising_targeting_policy disable trigger advertising_targeting_policy_immutable;update private.advertising_targeting_policy set geo_targeting_enabled=true"), /advertising_targeting_policy_v2_safe_chk/);

    run(fixture);
    const stale = JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`));
    assert.ok(stale.blockers.includes("audience_targeting_policy_stale"));
    run(`insert into private.advertising_audience_versions values('82000000-0000-4000-8000-000000000011','${audience}',2,'adults_only','nelyon-ads-targeting-v2',now())`);
    const fresh = JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`));
    assert.equal(fresh.structurally_ready, true);

    run("insert into private.advertising_geo_targets values(gen_random_uuid(),'82000000-0000-4000-8000-000000000011')");
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("viewer_geo_authority_unavailable"));
    run("delete from private.advertising_geo_targets;insert into private.advertising_language_targets values(gen_random_uuid(),'82000000-0000-4000-8000-000000000011')");
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("viewer_language_authority_unavailable"));
    run("delete from private.advertising_language_targets");

    run(`update private.advertising_campaigns set status='active' where id='${campaign}'`);
    let preflight = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`));
    assert.equal(preflight.production_deliverable, true);
    run(`insert into private.advertising_audience_versions values('82000000-0000-4000-8000-000000000012','${audience}',3,'adults_only','nelyon-ads-targeting-v1',now())`);
    preflight = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`));
    assert.equal(preflight.structurally_ready, false);
    assert.ok(preflight.reason_codes.includes("audience_targeting_policy_stale"));
    run(`insert into private.advertising_audience_versions values('82000000-0000-4000-8000-000000000013','${audience}',4,'adults_only','nelyon-ads-targeting-v2',now())`);
    run("insert into private.advertising_daypart_windows values(gen_random_uuid(),'82000000-0000-4000-8000-000000000013','UTC',1,'09:00','10:00')");
    preflight = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}','2030-01-07T09:30:00Z')`));
    assert.equal(preflight.viewer_match, true);
    preflight = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}','2030-01-07T10:00:00Z')`));
    assert.equal(preflight.viewer_match, false);
    assert.ok(preflight.reason_codes.includes("outside_daypart"));
    run("delete from private.advertising_daypart_windows;insert into private.advertising_frequency_policies values('82000000-0000-4000-8000-000000000013',1,24)");
    run(`insert into private.advertising_events(id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,context_fingerprint,occurred_at) values(gen_random_uuid(),gen_random_uuid(),'impression','${ad}','${campaign}','${adSet}','71000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000013','84000000-0000-4000-8000-000000000001','social_feed','${viewer}','fp',now())`);
    preflight = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`));
    assert.equal(preflight.viewer_match, false);
    assert.ok(preflight.reason_codes.includes("frequency_cap_reached"));

    const health = JSON.parse(run("select public.get_admin_advertising_health()"));
    assert.equal(health.targeting.targeting_policy_version, "nelyon-ads-targeting-v2");
    assert.deepEqual({ geo: health.targeting.geo_targeting_enabled, language: health.targeting.language_targeting_enabled, daypart: health.targeting.daypart_targeting_enabled, frequency: health.targeting.frequency_targeting_enabled }, { geo: false, language: false, daypart: true, frequency: true });
    assert.equal(health.production_delivery_ready, false);
    assert.ok(!health.blockers.some((item) => item.startsWith("geo_") || item.startsWith("language_")));
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
