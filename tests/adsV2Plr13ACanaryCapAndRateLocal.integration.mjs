// Real disposable PostgreSQL proof. Set NELYON_PLR13A_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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
const activeRefreshCorrective = migration("_ads_v2_plr_13a_c2_active_canary_billing_refresh.sql");

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
function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
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
  psql(db, activeRefreshCorrective);
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

function activeRefreshSetup(db) {
  psql(db, `
    set session_replication_role=replica;
    update private.advertising_campaigns set status='active' where id='${ids.campaign}';
    update private.advertising_campaign_finance set
      finance_status='funded',funded_bdag=0.30000000,spent_bdag=0,released_bdag=0,
      funding_source_account_id='90000000-0000-4000-8000-000000000013',
      funded_by_user_id='${ids.owner}',funded_at=clock_timestamp()-interval '1 hour'
    where campaign_id='${ids.campaign}';
    update private.advertising_finance_policy set funding_enabled=false,spend_enabled=true,settlement_enabled=false;
    update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=false;
    update private.advertising_delivery_policy set global_v2_delivery_enabled=true;
    update private.advertising_placement_catalog set v2_delivery_enabled=(code='social_feed');
    update private.advertising_canary_policy set
      launch_mode='CANARY_BILLING',canary_enabled=true,business_account_id='${ids.business}',
      ad_account_id='${ids.account}',campaign_id='${ids.campaign}',viewer_user_id='${ids.owner}',
      placement_code='social_feed',enabled_at=clock_timestamp()-interval '1 hour',
      expires_at=clock_timestamp()-interval '1 minute',max_budget_bdag=0.30000000,
      max_impressions=1,max_spend_bdag=0.30000000,max_billable_events=1;
    insert into private.advertising_billing_authorization_windows(
      id,mode,scope,campaign_id,opened_at,expires_at,max_spend_bdag,max_billable_events,status
    ) values(
      '2fc5c574-d14f-49fa-b92c-970fa817e1b2','CANARY_BILLING','canary_campaign','${ids.campaign}',
      clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 minute',0.30000000,1,'OPEN'
    );
    update private.advertising_canary_policy
    set expires_at=(select expires_at from private.advertising_billing_authorization_windows where status='OPEN')
    where singleton;
    set session_replication_role=origin;`);
}

function activeRefreshCall(overrides = {}) {
  return canaryCall({
    mode: "CANARY_BILLING",
    spend: "0.30000000",
    billable: "1",
    ...overrides,
  });
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

test("an expired exact active CANARY_BILLING envelope can refresh once without resetting evidence", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    activeRefreshSetup(db);
    const result = psql(db, activeRefreshCall(), { allowFailure: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(psql(db, "select status||'|'||(closed_at is not null)::text from private.advertising_billing_authorization_windows where id='2fc5c574-d14f-49fa-b92c-970fa817e1b2';").stdout, "CLOSED|true");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout, "1");
    assert.equal(psql(db, `select concat_ws('|',mode,scope,campaign_id,max_spend_bdag,max_billable_events,(expires_at-opened_at<=interval '30 minutes')) from private.advertising_billing_authorization_windows where status='OPEN';`).stdout, `CANARY_BILLING|canary_campaign|${ids.campaign}|0.30000000|1|t`);
    assert.equal(psql(db, `select concat_ws('|',campaign.status,finance.finance_status,finance.funded_bdag,finance.spent_bdag,finance.released_bdag) from private.advertising_campaigns campaign join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id where campaign.id='${ids.campaign}';`).stdout, "active|funded|0.30000000|0.00000000|0.00000000");
    assert.equal(psql(db, `select concat_ws('|',finance.funding_enabled,finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled) from private.advertising_finance_policy finance cross join private.advertising_campaign_lifecycle_policy lifecycle cross join private.advertising_delivery_policy delivery where finance.singleton and lifecycle.singleton and delivery.singleton;`).stdout, "f|t|f|t|f|t");
    assert.equal(psql(db, "select string_agg(code,',' order by code) from private.advertising_placement_catalog where v2_delivery_enabled;").stdout, "social_feed");
    assert.equal(psql(db, `select (select count(*) from private.advertising_events where campaign_id='${ids.campaign}')||'|'||(select count(*) from private.advertising_event_billing_materializations where campaign_id='${ids.campaign}')||'|'||(select count(*) from private.advertising_financial_events where campaign_id='${ids.campaign}' and event_type='spend');`).stdout, "0|0|0");
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where action='advertising.launch_mode.transition' and (metadata->'receipt'->>'active_canary_billing_refresh')::boolean;`).stdout, "1");
    assert.equal(psql(db, `select concat_ws('|',metadata->'receipt'->>'prior_authorization_window_id'='2fc5c574-d14f-49fa-b92c-970fa817e1b2',(metadata->'receipt'->>'new_authorization_window_id')=(metadata->'receipt'->>'authorization_window_id'),metadata->'receipt'->>'from_mode',metadata->'receipt'->>'to_mode') from private.admin_action_audit where action='advertising.launch_mode.transition' order by created_at desc limit 1;`).stdout, "t|t|CANARY_BILLING|CANARY_BILLING");
  } finally { dropDatabase(db); }
});

test("draft and paused entry remain legal while ordinary active entry remains blocked", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, canaryCall()).status, 0);
    psql(db, `select public.set_advertising_launch_mode_v2('DISARMED','${randomUUID()}');`);
    psql(db, `update private.advertising_campaigns set status='paused' where id='${ids.campaign}';`);
    assert.equal(psql(db, canaryCall()).status, 0);
    psql(db, `select public.set_advertising_launch_mode_v2('DISARMED','${randomUUID()}');`);
    psql(db, `update private.advertising_campaigns set status='active' where id='${ids.campaign}';`);
    const blocked = psql(db, canaryCall(), { allowFailure: true });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /advertising_active_canary_billing_refresh_invalid/);
  } finally { dropDatabase(db); }
});

test("active refresh rejects target, cap, live-window, evidence, schedule and coverage drift", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    activeRefreshSetup(db);
    const oldWindow = "2fc5c574-d14f-49fa-b92c-970fa817e1b2";
    const expectRejected = (setup, call = activeRefreshCall(), pattern = /advertising_/) => {
      const result = psql(db, `begin;${setup}${call}`, { allowFailure: true });
      assert.notEqual(result.status, 0, `unexpected success for ${setup}\n${result.stdout}`);
      assert.match(result.stderr, pattern);
      assert.equal(psql(db, `select status from private.advertising_billing_authorization_windows where id='${oldWindow}';`).stdout, "OPEN");
      assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout, "1");
    };

    expectRejected("", activeRefreshCall({ business: "20000000-0000-4000-8000-000000000099" }));
    expectRejected("", activeRefreshCall({ account: "30000000-0000-4000-8000-000000000099" }));
    expectRejected("", activeRefreshCall({ campaign: "40000000-0000-4000-8000-000000000099" }));
    expectRejected("", activeRefreshCall({ viewer: "10000000-0000-4000-8000-000000000099" }));
    expectRejected("", activeRefreshCall({ placement: "clips" }));
    expectRejected("", activeRefreshCall({ budget: "0.29999999" }));
    expectRejected("", activeRefreshCall({ impressions: "2" }));
    expectRejected("", activeRefreshCall({ spend: "0.29999999" }));
    expectRejected("", activeRefreshCall({ billable: "2" }));
    expectRejected("", activeRefreshCall({ expires: "clock_timestamp()+interval '31 minutes'" }));
    expectRejected(
      "set session_replication_role=replica;update private.advertising_canary_policy set launch_mode='CANARY_DELIVERY',max_spend_bdag=null,max_billable_events=null where singleton;set session_replication_role=origin;",
    );
    expectRejected("", canaryCall({ mode: "CANARY_DELIVERY", budget: "0.30000000", impressions: "1" }));
    expectRejected(
      "set session_replication_role=replica;update private.advertising_canary_policy set enabled_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '10 minutes' where singleton;update private.advertising_billing_authorization_windows set expires_at=clock_timestamp()+interval '10 minutes' where status='OPEN';set session_replication_role=origin;",
      activeRefreshCall({ expires: "clock_timestamp()+interval '20 minutes'" }),
      /advertising_active_canary_billing_refresh_invalid|advertising_active_canary_billing_window_still_valid/,
    );
    expectRejected(
      `insert into private.advertising_placement_selection_items(placement_selection_version_id,placement_code) values('${ids.placementVersion}','clips');`,
      activeRefreshCall(),
      /advertising_canary_placement_invalid/,
    );
    expectRejected(
      `set session_replication_role=replica;insert into private.advertising_events(id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,context_fingerprint,occurred_at) values(gen_random_uuid(),gen_random_uuid(),'impression','${ids.ad}','${ids.campaign}','${ids.adSet}','${ids.creativeVersion}','${ids.destination}','${ids.audience}','${ids.placementVersion}','social_feed','${ids.owner}',repeat('e',64),clock_timestamp());set session_replication_role=origin;`,
      activeRefreshCall(),
      /advertising_active_canary_billing_evidence_present/,
    );
    expectRejected(
      `set session_replication_role=replica;insert into private.advertising_event_billing_materializations(billable_event_id,campaign_id,status,amount_bdag,reason_code,finalized_at) values(gen_random_uuid(),'${ids.campaign}','not_billable_no_rate',0,'fixture',clock_timestamp());set session_replication_role=origin;`,
      activeRefreshCall(),
      /advertising_active_canary_billing_evidence_present/,
    );
    expectRejected(
      `set session_replication_role=replica;insert into private.advertising_financial_events(campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key,billable_event_id,billing_rate_version_id,unit_rate_bdag) select '${ids.campaign}','spend',0.30000000,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),id,0.30000000 from private.advertising_billing_rate_versions where scope='canary_campaign' and scope_campaign_id='${ids.campaign}';set session_replication_role=origin;`,
      activeRefreshCall(),
      /advertising_active_canary_billing_evidence_present/,
    );
    expectRejected(
      `update private.advertising_campaign_finance set released_bdag=0.01000000 where campaign_id='${ids.campaign}';`,
      activeRefreshCall(),
      /advertising_canary_finance_invalid|advertising_active_canary_billing_finance_invalid/,
    );
    expectRejected(
      `update private.advertising_ad_sets set ends_at=clock_timestamp()+interval '10 minutes' where id='${ids.adSet}';`,
      activeRefreshCall({ expires: "clock_timestamp()+interval '20 minutes'" }),
      /advertising_active_canary_billing_schedule_invalid/,
    );
    expectRejected(
      `set session_replication_role=replica;update private.advertising_billing_rate_versions set effective_from=clock_timestamp()+interval '1 day',published_at=clock_timestamp()+interval '1 day' where scope='canary_campaign' and scope_campaign_id='${ids.campaign}';set session_replication_role=origin;`,
      activeRefreshCall(),
      /advertising_canary_billing_rate_coverage_incomplete/,
    );
  } finally { dropDatabase(db); }
});

test("active refresh idempotency replays one receipt and rejects fingerprint conflict", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    activeRefreshSetup(db);
    const key = randomUUID();
    const expiry = psql(db, "select to_char(clock_timestamp()+interval '20 minutes','YYYY-MM-DD\"T\"HH24:MI:SS.USOF');").stdout;
    const call = activeRefreshCall({ key, expires: `'${expiry}'::timestamptz` });
    const first = psql(db, call);
    const replay = psql(db, call);
    assert.match(first.stdout, /"active_canary_billing_refresh": true/);
    assert.match(replay.stdout, /"idempotent": true/);
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout, "1");
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where idempotency_scope='v1|system|advertising|launch_mode.transition' and idempotency_key='${key}';`).stdout, "1");
    const conflict = psql(db, activeRefreshCall({ key, expires: `'${expiry}'::timestamptz-interval '1 second'` }), { allowFailure: true });
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /admin_idempotency_conflict/);
  } finally { dropDatabase(db); }
});

test("two concurrent active refreshes serialize to one winner and one OPEN window", { skip: !enabled }, async () => {
  const db = createDatabase();
  try {
    activeRefreshSetup(db);
    const beforeFinance = psql(db, `select concat_ws('|',funded_bdag,spent_bdag,released_bdag) from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout;
    const [left, right] = await Promise.all([
      psqlAsync(db, activeRefreshCall({ key: randomUUID() })),
      psqlAsync(db, activeRefreshCall({ key: randomUUID() })),
    ]);
    assert.equal([left.status, right.status].filter((status) => status === 0).length, 1, JSON.stringify({ left, right }));
    assert.equal([left.status, right.status].filter((status) => status !== 0).length, 1, JSON.stringify({ left, right }));
    assert.match([left, right].find((result) => result.status !== 0).stderr, /advertising_active_canary_billing_refresh_invalid|advertising_active_canary_billing_window_still_valid/);
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='OPEN';").stdout, "1");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows where status='CLOSED';").stdout, "1");
    assert.equal(psql(db, `select concat_ws('|',funded_bdag,spent_bdag,released_bdag) from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, beforeFinance);
    assert.equal(psql(db, `select count(*) from private.advertising_events where campaign_id='${ids.campaign}';`).stdout, "0");
    assert.equal(psql(db, `select count(*) from private.advertising_event_billing_materializations where campaign_id='${ids.campaign}';`).stdout, "0");
  } finally { dropDatabase(db); }
});
