// Disposable PostgreSQL proof only. NELYON_PLR6A_C1_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR6A_C1_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr6ac1_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const campaign = "40000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const media = "72000000-0000-4000-8000-000000000001";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const asService = (sql) => run(`begin;set local request.jwt.claim.role='service_role';${sql};commit;`);

function rawConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = String\\.raw\\\`([\\s\\S]*?)\\\`;`));
  assert.ok(match, `${name} bootstrap missing`);
  return match[1];
}

function extractFunction(source, qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`;
  const start = source.toLowerCase().indexOf(marker.toLowerCase());
  const end = source.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, `${qualifiedName} missing`);
  return source.slice(start, end + 3);
}

function substitute(source) {
  return source
    .replaceAll("${owner}", owner)
    .replaceAll("${viewer}", viewer)
    .replaceAll("${intruder}", "10000000-0000-4000-8000-000000000003")
    .replaceAll("${business}", "20000000-0000-4000-8000-000000000001")
    .replaceAll("${account}", "30000000-0000-4000-8000-000000000001")
    .replaceAll("${campaign}", campaign)
    .replaceAll("${futureCampaign}", "40000000-0000-4000-8000-000000000002")
    .replaceAll("${draftCampaign}", "40000000-0000-4000-8000-000000000003")
    .replaceAll("${adSet}", "50000000-0000-4000-8000-000000000001")
    .replaceAll("${futureAdSet}", "50000000-0000-4000-8000-000000000002")
    .replaceAll("${destination}", "60000000-0000-4000-8000-000000000001")
    .replaceAll("${futureDestination}", "60000000-0000-4000-8000-000000000002")
    .replaceAll("${creative}", "70000000-0000-4000-8000-000000000001")
    .replaceAll("${version}", "71000000-0000-4000-8000-000000000001")
    .replaceAll("${media}", media)
    .replaceAll("${ad}", ad)
    .replaceAll("${futureAd}", "80000000-0000-4000-8000-000000000002");
}

const plr3Harness = readFileSync(new URL("./adsV2Plr3CampaignLifecycleLocal.integration.mjs", import.meta.url), "utf8");
let bootstrap = substitute(rawConstant(plr3Harness, "bootstrap"));
let fixture = substitute(rawConstant(plr3Harness, "fixture"));

bootstrap = bootstrap
  .replace(
    "create table public.media_assets(id uuid primary key,status text not null,deleted_at timestamptz);",
    "create table public.media_assets(id uuid primary key,status text not null,deleted_at timestamptz,provider text,visibility text,purpose text,public_url text);",
  )
  .replace(
    "create table public.video_assets(id uuid primary key,status text not null,deleted_at timestamptz);",
    "create table public.video_assets(id uuid primary key,status text not null,deleted_at timestamptz,provider text,visibility text,purpose text,hls_url text,thumbnail_url text);",
  )
  .replace(
    "create table private.advertising_targeting_policy(singleton boolean primary key,policy_version text,minor_targeting_allowed boolean,interest_targeting_enabled boolean,behavioral_targeting_enabled boolean,custom_audiences_enabled boolean,lookalike_targeting_enabled boolean,sensitive_targeting_allowed boolean,precise_viewer_location_matching_enabled boolean);",
    () => `create table private.advertising_targeting_policy(
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
    create trigger advertising_targeting_policy_immutable before update or delete on private.advertising_targeting_policy for each row execute function private.advertising_targeting_policy_immutable();`,
  )
  .replace(
    "create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null,age_scope text,created_at timestamptz default now());",
    "create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null,age_scope text,targeting_policy_version text not null,created_at timestamptz default now());",
  )
  .replace(
    "insert into private.advertising_targeting_policy values(true,'nelyon-ads-targeting-v1',false,false,false,false,false,false,false);",
    "insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v1');",
  )
  .concat("create table public.financial_transactions(id uuid primary key);create table public.ledger_accounts(id uuid primary key,balance numeric not null);create table public.ledger_entries(id uuid primary key);insert into public.ledger_accounts values(gen_random_uuid(),100);");

fixture = fixture
  .replace(
    `insert into public.media_assets values('${media}','ready',null);`,
    `insert into public.media_assets values('${media}','ready',null,'r2','public','business_library','https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/ads/proof.jpg');`,
  )
  .replace(
    "'81000000-0000-4000-8000-000000000001',1,'adults_only',now())",
    "'81000000-0000-4000-8000-000000000001',1,'adults_only','nelyon-ads-targeting-v2',now())",
  )
  .replace(
    "'81000000-0000-4000-8000-000000000002',1,'adults_only',now())",
    "'81000000-0000-4000-8000-000000000002',1,'adults_only','nelyon-ads-targeting-v2',now())",
  );

const plr3Migration = readFileSync(new URL("../supabase/migrations/20260924003147_ads_v2_plr_3_campaign_activation_lifecycle.sql", import.meta.url), "utf8");
const plr4Migration = readFileSync(new URL("../supabase/migrations/20260924024512_ads_v2_plr_4_targeting_launch_scope.sql", import.meta.url), "utf8");
const deliveryMigration = readFileSync(new URL("../supabase/migrations/20260922203641_ads_v2_f_generic_delivery_placement_registry.sql", import.meta.url), "utf8");
const eventsMigration = readFileSync(new URL("../supabase/migrations/20260922234902_ads_v2_g_events_conversions_attribution.sql", import.meta.url), "utf8");
const candidateMigration = readFileSync(new URL("../supabase/migrations/20260924174913_ads_v2_plr_6a_c1_social_feed_runtime_wiring.sql", import.meta.url), "utf8");

test("PLR-6A-C1 proves service-only render, exact assembly and zero-spend impression in disposable PostgreSQL", { skip: !enabled, timeout: 180_000 }, () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(plr3Migration);
    run(`${extractFunction(eventsMigration, "private.advertising_current_delivery_context(")}\n${extractFunction(eventsMigration, "public.record_advertising_impression_v2(")}`);
    run(plr4Migration);
    run(extractFunction(deliveryMigration, "public.fetch_advertising_delivery_candidates_v2("));
    assert.equal(run("select concat(to_regprocedure('private.advertising_delivery_preflight_at(uuid,text,uuid,timestamp with time zone)') is not null,':',to_regprocedure('public.fetch_advertising_delivery_candidates_v2(text,uuid,integer,timestamp with time zone)') is not null,':',to_regprocedure('public.record_advertising_impression_v2(uuid,text,uuid,uuid)') is not null)"), "t:t:t");
    run(candidateMigration);

    assert.equal(run("select has_function_privilege('anon','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('service_role','public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)','EXECUTE')"), "t");

    run(fixture);
    assert.equal(asService(`select public.get_advertising_delivery_render_payload_v2('${ad}','social_feed','${viewer}') is null`), "t");
    assert.equal(asService(`select count(*) from public.fetch_advertising_delivery_candidates_v2('social_feed','${viewer}',1,now())`), "0");

    run(`update private.advertising_delivery_policy set global_v2_delivery_enabled=true;update private.advertising_placement_catalog set v2_delivery_enabled=true where code='social_feed';update private.advertising_campaigns set status='active' where id='${campaign}'`);
    const payload = JSON.parse(asService(`select public.get_advertising_delivery_render_payload_v2('${ad}','social_feed','${viewer}')`));
    assert.equal(payload.ad_id, ad);
    assert.equal(payload.advertiser.display_name, "Studio");
    assert.equal(payload.creative.headline, "Headline");
    assert.equal(payload.creative.media.url, "https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/ads/proof.jpg");
    assert.equal(payload.destination.external_url, "https://example.com");
    assert.equal(asService(`select count(*) from public.fetch_advertising_delivery_candidates_v2('social_feed','${viewer}',1,now())`), "1");

    assert.throws(() => asService(`select public.get_advertising_delivery_render_payload_v2('${ad}','stories','${viewer}')`), /advertising_delivery_render_placement_invalid/);
    run(`update private.advertising_ads set submission_fingerprint=repeat('f',64) where id='${ad}'`);
    assert.equal(asService(`select public.get_advertising_delivery_render_payload_v2('${ad}','social_feed','${viewer}') is null`), "t");
    run(`update private.advertising_ads set submission_fingerprint=private.ads_ad_submission_fingerprint(id) where id='${ad}';update public.media_assets set status='processing' where id='${media}'`);
    assert.equal(asService(`select public.get_advertising_delivery_render_payload_v2('${ad}','social_feed','${viewer}') is null`), "t");
    run(`update public.media_assets set status='ready' where id='${media}'`);

    const before = run("select (select count(*) from public.financial_transactions)||':'||(select count(*) from public.ledger_entries)||':'||(select count(*) from private.advertising_financial_events)||':'||(select balance from public.ledger_accounts limit 1)");
    const eventKey = "91000000-0000-4000-8000-000000000091";
    const impression = JSON.parse(asService(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${eventKey}')`));
    assert.equal(impression.event_type, "impression");
    assert.equal(run(`select count(*) from private.advertising_events where event_key='${eventKey}'`), "1");
    assert.equal(asService(`select (public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${eventKey}')->>'id')='${impression.id}'`), "t");
    assert.equal(run("select (select count(*) from public.financial_transactions)||':'||(select count(*) from public.ledger_entries)||':'||(select count(*) from private.advertising_financial_events)||':'||(select balance from public.ledger_accounts limit 1)"), before);
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
