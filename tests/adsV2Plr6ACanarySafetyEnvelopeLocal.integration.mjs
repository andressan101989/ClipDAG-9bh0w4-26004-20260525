// Disposable PostgreSQL proof only. NELYON_PLR6A_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR6A_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr6a_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const campaign = "40000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const media = "72000000-0000-4000-8000-000000000001";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const runAsync = (sql) => new Promise((resolve, reject) => {
  const child = spawn("docker", args(database, "-At"));
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  child.stdin.end(sql);
});
const asService = (sql) => run(`begin;set local request.jwt.claim.role='service_role';${sql};commit;`);
const asServiceAsync = (sql) => runAsync(`begin;set local request.jwt.claim.role='service_role';${sql};commit;`);
const asOwner = (sql) => run(`begin;set local request.jwt.claim.sub='${owner}';${sql};commit;`);

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
const candidateMigration = readFileSync(new URL("../supabase/migrations/20260924182247_ads_v2_plr_6a_c1_social_feed_runtime_wiring.sql", import.meta.url), "utf8");
const financeMigration = readFileSync(new URL("../supabase/migrations/20260923223950_ads_v2_plr_2_finance_retry_idempotency_hardening.sql", import.meta.url), "utf8");
const canaryMigration = readFileSync(new URL("../supabase/migrations/20260924215340_ads_v2_plr_6a_canary_safety_envelope.sql", import.meta.url), "utf8");

test("PLR-6A enforces exact delivery and serializes the one-impression cap", { skip: !enabled, timeout: 180_000 }, async () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(plr3Migration);
    run(`${extractFunction(eventsMigration, "private.advertising_current_delivery_context(")}\n${extractFunction(eventsMigration, "public.record_advertising_impression_v2(")}`);
    run(plr4Migration);
    run(extractFunction(deliveryMigration, "public.fetch_advertising_delivery_candidates_v2("));
    run([
      extractFunction(financeMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(financeMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(financeMigration, "public.settle_advertising_campaign_budget_v2("),
    ].join("\n"));
    assert.equal(run("select concat(to_regprocedure('private.advertising_delivery_preflight_at(uuid,text,uuid,timestamp with time zone)') is not null,':',to_regprocedure('public.fetch_advertising_delivery_candidates_v2(text,uuid,integer,timestamp with time zone)') is not null,':',to_regprocedure('public.record_advertising_impression_v2(uuid,text,uuid,uuid)') is not null)"), "t:t:t");
    run(candidateMigration);
    run(canaryMigration);

    assert.equal(run("select canary_enabled||':'||max_budget_bdag||':'||max_impressions from private.advertising_canary_policy"), "false:0.01000000:1");
    assert.equal(run("select relrowsecurity||':'||relforcerowsecurity from pg_class where oid='private.advertising_canary_policy'::regclass"), "true:true");
    assert.equal(run("select has_table_privilege('anon','private.advertising_canary_policy','SELECT')||':'||has_table_privilege('authenticated','private.advertising_canary_policy','SELECT')"), "false:false");
    assert.equal(run("select has_function_privilege('authenticated','private.advertising_canary_campaign_allowed(uuid,timestamptz,boolean,numeric)','EXECUTE')"), "f");
    assert.throws(() => run("update private.advertising_canary_policy set max_budget_bdag=0.01000001"), /advertising_canary_policy_budget_chk/);
    assert.throws(() => run("update private.advertising_canary_policy set max_impressions=2"), /advertising_canary_policy_impressions_chk/);
    assert.throws(() => run("update private.advertising_canary_policy set canary_enabled=true"), /advertising_canary_policy_enabled_shape_chk/);

    run(fixture);
    run("alter table private.advertising_campaign_lifecycle_policy drop constraint advertising_campaign_lifecycle_policy_v1_safe_chk;update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=false");
    run(`update private.advertising_canary_policy set canary_enabled=true,business_account_id='20000000-0000-4000-8000-000000000001',ad_account_id='30000000-0000-4000-8000-000000000001',campaign_id='40000000-0000-4000-8000-000000000002',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton`);
    assert.throws(() => asOwner(`select public.activate_my_advertising_campaign_v2('${campaign}','92000000-0000-4000-8000-000000000001')`), /advertising_canary_campaign_denied/);
    const activationKey = "92000000-0000-4000-8000-000000000002";
    assert.match(asOwner(`select public.activate_my_advertising_campaign_v2('40000000-0000-4000-8000-000000000002','${activationKey}')`), /"status": "scheduled"/);
    run("update private.advertising_canary_policy set enabled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where singleton");
    assert.match(asOwner(`select public.activate_my_advertising_campaign_v2('40000000-0000-4000-8000-000000000002','${activationKey}')`), /"status": "scheduled"/);
    assert.match(asOwner("select public.pause_my_advertising_campaign_v2('40000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003')"), /"status": "paused"/);
    assert.throws(() => asOwner("select public.resume_my_advertising_campaign_v2('40000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000004')"), /advertising_canary_campaign_denied/);
    assert.match(asOwner("select public.cancel_my_advertising_campaign_v2('40000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000005')"), /"status": "cancelled"/);

    run("update private.advertising_canary_policy set canary_enabled=false,business_account_id=null,ad_account_id=null,campaign_id=null,viewer_user_id=null,placement_code=null,enabled_at=null,expires_at=null where singleton");
    run(`update private.advertising_delivery_policy set global_v2_delivery_enabled=true;update private.advertising_placement_catalog set v2_delivery_enabled=true where code='social_feed';update private.advertising_campaigns set status='active' where id='${campaign}'`);
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`)).production_deliverable, true);

    run(`update private.advertising_canary_policy set canary_enabled=true,business_account_id='20000000-0000-4000-8000-000000000001',ad_account_id='30000000-0000-4000-8000-000000000001',campaign_id='${campaign}',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton`);
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`)).production_deliverable, true);
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','social_feed','10000000-0000-4000-8000-000000000003',now())`)).production_deliverable, false);
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','stories','${viewer}',now())`)).production_deliverable, false);

    const before = run("select (select count(*) from public.financial_transactions)||':'||(select count(*) from public.ledger_entries)||':'||(select count(*) from private.advertising_financial_events)");
    const replayKey = "91000000-0000-4000-8000-000000000090";
    const exactReplays = await Promise.all([
      asServiceAsync(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${replayKey}')`),
      asServiceAsync(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${replayKey}')`),
    ]);
    assert.equal(exactReplays.length, 2);
    assert.equal(run(`select count(*) from private.advertising_events where event_key='${replayKey}'`), "1");
    run(`delete from private.advertising_events where event_key='${replayKey}';update private.advertising_canary_policy set enabled_at=now(),expires_at=now()+interval '30 minutes' where singleton`);
    const keyA = "91000000-0000-4000-8000-000000000091";
    const keyB = "91000000-0000-4000-8000-000000000092";
    const attempts = await Promise.allSettled([
      asServiceAsync(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${keyA}')`),
      asServiceAsync(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${keyB}')`),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    assert.match(attempts.find((result) => result.status === "rejected").reason.message, /advertising_canary_(impression_limit_reached|impression_denied)|advertising_impression_not_deliverable/);
    assert.equal(run(`select count(*) from private.advertising_events where event_type='impression' and campaign_id='${campaign}' and viewer_user_id='${viewer}'`), "1");
    const successfulKey = run(`select event_key from private.advertising_events where event_type='impression' and campaign_id='${campaign}'`);
    assert.match(asService(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${successfulKey}')`), /"event_type": "impression"/);
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`)).production_deliverable, false);
    assert.equal(run("select (select count(*) from public.financial_transactions)||':'||(select count(*) from public.ledger_entries)||':'||(select count(*) from private.advertising_financial_events)"), before);

    run("update private.advertising_canary_policy set enabled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where singleton");
    assert.equal(JSON.parse(asService(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`)).production_deliverable, false);
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
