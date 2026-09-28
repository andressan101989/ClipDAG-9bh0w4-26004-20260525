// Real disposable PostgreSQL proof. Set NELYON_PLR13A_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR13A_LOCAL === "1";
const container = process.env.NELYON_PLR13A_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR13A_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";

const ids = {
  owner: "56990585-7655-47e1-a017-a3c272a49820",
  business: "83a9a493-c03c-4d34-b41d-3d3a70aea818",
  account: "d4ad759a-fc5f-47a0-bbc1-3036b30f1ee3",
  campaign: "b2ec6689-ece3-4f5b-bc91-ebfc4cf8970d",
  adSet: "51204809-8b40-4d93-91b3-25e13743f8d9",
  ad: "2dd92465-5237-4ff8-aba4-1aa2771d8432",
  creativeVersion: "7e940d5e-ca03-43d8-b280-5534079ba410",
  creative: "9cb8210a-8e6b-4559-8d51-72a2ebe2f8b3",
  media: "96deac30-6073-4ce1-819f-fe379ef0b2d4",
  destination: "cd5726d5-a6ac-4090-843e-148e4e856aa4",
  audience: "e0e6b5ac-f2e0-426c-8dcf-e355b5667236",
  placementVersion: "88ee8632-53c5-4a2c-a914-2e5cc98ad8d0",
  globalRate: "7013f89c-9daf-4ef4-9b50-287ae1a6b24b",
  historicalCampaign: "7a3489b6-2d5c-43bd-9a35-0bf0b37403d0",
};

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const names = readdirSync(migrationDirectory);
function migration(suffix) {
  const matching = names.filter((name) => name.endsWith(suffix));
  assert.equal(matching.length, 1, suffix);
  return readFileSync(new URL(matching[0], migrationDirectory), "utf8");
}
const prerequisites = [
  "_ads_v2_plr_10_multisurface_age_targeting.sql",
  "_ads_v2_plr_10_c1_multisurface_render_payload.sql",
  "_ads_v2_plr_11_objective_runtime_measurement.sql",
  "_ads_v2_plr_11_c1_measurement_integrity.sql",
  "_ads_v2_plr_12_production_pricing_v1.sql",
];
const corrective = migration("_ads_v2_plr_13a_canary_cap_and_rate.sql");

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], { input: sql, ...options });
}
function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}

const fixture = `
create extension if not exists pgcrypto with schema extensions;
set session_replication_role=replica;
insert into auth.users(id) values ('${ids.owner}');
insert into public.user_profiles(id) values ('${ids.owner}');
insert into private.business_accounts(id,owner_user_id,display_name,status,origin,creation_idempotency_key)
values('${ids.business}','${ids.owner}','PLR13 Business','active','advertiser_self_service',gen_random_uuid());
insert into private.ad_accounts(id,business_account_id,name,status,billing_currency,is_default,created_by)
values('${ids.account}','${ids.business}','PLR13 Ads','active','BDAG',true,'${ids.owner}');
insert into private.advertising_campaigns(id,ad_account_id,name,objective,status,created_by,creation_idempotency_key)
values('${ids.campaign}','${ids.account}','NELYON ADS BILLING CANARY PLR-13','awareness','draft','${ids.owner}',gen_random_uuid()),
      ('${ids.historicalCampaign}','${ids.account}','NELYON ADS CANARY','awareness','paused','${ids.owner}',gen_random_uuid());
insert into private.advertising_campaign_finance(
  campaign_id,budget_bdag,currency,finance_status,funded_bdag,spent_bdag,released_bdag,
  funding_source_account_id,funded_by_user_id,funded_at,created_by,creation_idempotency_key
) values
  ('${ids.campaign}',0.30000000,'BDAG','draft',0,0,0,null,null,null,'${ids.owner}',gen_random_uuid()),
  ('${ids.historicalCampaign}',0.01000000,'BDAG','funded',0.01000000,0,0,
   '90000000-0000-4000-8000-000000000001','${ids.owner}',clock_timestamp(),'${ids.owner}',gen_random_uuid());
insert into private.advertising_ad_sets(id,campaign_id,name,status,starts_at,ends_at,creation_idempotency_key,created_by)
values('${ids.adSet}','${ids.campaign}','PLR13 Set','draft',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',gen_random_uuid(),'${ids.owner}');
insert into private.advertising_destinations(id,campaign_id,destination_type,external_url,status,creation_idempotency_key,created_by)
values('${ids.destination}','${ids.campaign}','external_url','https://www.amazon.com/ref=nav_logo','draft',gen_random_uuid(),'${ids.owner}');
insert into public.media_assets(
  id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
  status,ready_at,public_url
) values('${ids.media}','${ids.owner}','r2','image','advertising_creative','public','media','plr13/image.jpg','image/jpeg','ready',clock_timestamp(),'https://media.example.test/plr13/image.jpg');
insert into private.advertising_creatives(id,ad_account_id,name,status,created_by,creation_idempotency_key)
values('${ids.creative}','${ids.account}','PLR13 Creative','draft','${ids.owner}',gen_random_uuid());
insert into private.advertising_creative_versions(
  id,creative_id,version_number,format,media_asset_id,primary_text,call_to_action,
  content_fingerprint,created_by,creation_idempotency_key
) values('${ids.creativeVersion}','${ids.creative}',1,'image','${ids.media}','PLR13','learn_more',repeat('a',64),'${ids.owner}',gen_random_uuid());
insert into private.advertising_ads(
  id,ad_set_id,creative_version_id,destination_id,name,status,review_status,
  submission_fingerprint,submitted_at,reviewed_at,created_by,creation_idempotency_key
) values('${ids.ad}','${ids.adSet}','${ids.creativeVersion}','${ids.destination}','PLR13 Ad','draft','approved',repeat('b',64),clock_timestamp(),clock_timestamp(),'${ids.owner}',gen_random_uuid());
insert into private.advertising_audiences(id,ad_set_id,status,created_by,creation_idempotency_key)
values('81000000-0000-4000-8000-000000000013','${ids.adSet}','draft','${ids.owner}',gen_random_uuid());
insert into private.advertising_audience_versions(
  id,audience_id,version_number,age_scope,min_age,max_age,targeting_policy_version,
  definition_fingerprint,creation_idempotency_key,created_by
) values('${ids.audience}','81000000-0000-4000-8000-000000000013',1,'age_range',13,null,'nelyon-ads-targeting-v3',repeat('c',64),gen_random_uuid(),'${ids.owner}');
insert into private.advertising_placement_selections(id,ad_set_id,status,created_by,creation_idempotency_key)
values('83000000-0000-4000-8000-000000000013','${ids.adSet}','draft','${ids.owner}',gen_random_uuid());
insert into private.advertising_placement_selection_versions(
  id,placement_selection_id,version_number,registry_policy_version,definition_fingerprint,creation_idempotency_key,created_by
) values('${ids.placementVersion}','83000000-0000-4000-8000-000000000013',1,'nelyon-ads-delivery-v3',repeat('d',64),gen_random_uuid(),'${ids.owner}');
insert into private.advertising_placement_selection_items(placement_selection_version_id,placement_code)
values('${ids.placementVersion}','social_feed');
update private.advertising_billing_rate_versions
set id='${ids.globalRate}',effective_from=clock_timestamp()-interval '1 minute'
where objective='awareness' and billable_event_type='impression' and placement_code='social_feed'
  and scope='global' and state='published';
set session_replication_role=origin;
`;

function createDatabase() {
  const db = `plr13a_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);`);
  for (const suffix of prerequisites) psql(db, migration(suffix));
  psql(db, fixture);
  psql(db, corrective);
  return db;
}

function canaryCall(overrides = {}) {
  const values = {
    mode: "CANARY_DELIVERY",
    key: randomUUID(),
    business: ids.business,
    account: ids.account,
    campaign: ids.campaign,
    viewer: ids.owner,
    placement: "social_feed",
    expires: "clock_timestamp()+interval '30 minutes'",
    budget: "0.30000000",
    impressions: "1",
    spend: "null",
    billable: "null",
    ...overrides,
  };
  return `select public.set_advertising_launch_mode_v2('${values.mode}','${values.key}',
    '${values.business}','${values.account}','${values.campaign}','${values.viewer}',
    '${values.placement}',${values.expires},${values.budget},${values.impressions},${values.spend},${values.billable});`;
}

test("corrective migration hard-caps 0.30, versions policy, and creates one audited rate", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, "select policy_version||'|'||launch_mode from private.advertising_canary_policy where singleton;").stdout, "nelyon-ads-canary-v2|DISARMED");
    assert.match(psql(db, "select pg_get_constraintdef(oid) from pg_constraint where conname='advertising_canary_policy_budget_chk';").stdout, /0\.30000000/);
    assert.equal(psql(db, `select count(*)||'|'||min(rate_bdag)||'|'||min(scope) from private.advertising_billing_rate_versions where scope_campaign_id='${ids.campaign}';`).stdout, "1|0.30000000|canary_campaign");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_rate_versions;").stdout, "55");
    assert.equal(psql(db, "select count(*)||'|'||min(actor_kind)||'|'||bool_and(actor_id is null)::text from private.admin_action_audit where action='advertising.plr13.canary_policy_rate.bootstrap';").stdout, "1|system_workflow|true");
    assert.equal(psql(db, `select (private.resolve_advertising_billing_rate_v2('${ids.campaign}','impression','social_feed',clock_timestamp(),'CANARY_BILLING')).id;`).stdout.length, 36);
    assert.equal(psql(db, `select (private.advertising_rate_coverage_at('CANARY_BILLING','${ids.campaign}','social_feed',clock_timestamp(),clock_timestamp()+interval '30 minutes')->>'ready');`).stdout, "true");
  } finally { dropDatabase(db); }
});

test("actual constraint accepts 0.01 and 0.30 but rejects larger values", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    for (const value of ["0.01000000", "0.30000000"]) {
      const result = psql(db, `begin;set session_replication_role=replica;update private.advertising_canary_policy set
        launch_mode='CANARY_DELIVERY',canary_enabled=true,business_account_id='${ids.business}',ad_account_id='${ids.account}',campaign_id='${ids.campaign}',viewer_user_id='${ids.owner}',placement_code='social_feed',enabled_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 minutes',max_budget_bdag=${value},max_impressions=1;
        rollback;`, { allowFailure: true });
      assert.equal(result.status, 0, result.stderr);
    }
    for (const value of ["0.30000001", "1.00000000"]) {
      const result = psql(db, `update private.advertising_canary_policy set max_budget_bdag=${value} where singleton;`, { allowFailure: true });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /advertising_canary_policy_budget_chk/);
    }
  } finally { dropDatabase(db); }
});

test("canonical launch guards remain fail-closed and CANARY_DELIVERY moves no money", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    const before = psql(db, "select (select count(*) from public.financial_transactions)||'|'||(select count(*) from public.ledger_entries);").stdout;
    for (const sql of [
      canaryCall({ impressions: "2" }),
      canaryCall({ placement: "clips" }),
      canaryCall({ viewer: "10000000-0000-4000-8000-000000000099" }),
      canaryCall({ campaign: "40000000-0000-4000-8000-000000000099" }),
      canaryCall({ expires: "clock_timestamp()-interval '1 minute'" }),
    ]) {
      assert.notEqual(psql(db, sql, { allowFailure: true }).status, 0);
      assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "DISARMED");
    }
    psql(db, canaryCall());
    assert.equal(psql(db, `select concat_ws('|',launch_mode,canary_enabled,max_budget_bdag,max_impressions,max_spend_bdag,max_billable_events) from private.advertising_canary_policy where singleton;`).stdout, "CANARY_DELIVERY|t|0.30000000|1");
    assert.equal(psql(db, "select concat_ws('|',funding_enabled,spend_enabled,settlement_enabled) from private.advertising_finance_policy where singleton;").stdout, "t|f|f");
    assert.equal(psql(db, "select string_agg(code,',' order by code) from private.advertising_placement_catalog where v2_delivery_enabled;").stdout, "social_feed");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout, "0");
    assert.equal(psql(db, "select count(*) from private.advertising_event_billing_materializations;").stdout, "0");
    assert.equal(psql(db, "select (select count(*) from public.financial_transactions)||'|'||(select count(*) from public.ledger_entries);").stdout, before);
  } finally { dropDatabase(db); }
});
