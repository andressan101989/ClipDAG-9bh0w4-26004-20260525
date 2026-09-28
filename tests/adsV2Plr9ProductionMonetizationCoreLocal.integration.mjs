// Real disposable PostgreSQL proof. Set NELYON_PLR9_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR9_LOCAL === "1";
const container = process.env.NELYON_PLR9_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR9_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";
const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_9_production_monetization_core.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");

const ids = {
  campaign: "40000000-0000-4000-8000-000000000001",
  ad: "80000000-0000-4000-8000-000000000001",
  adSet: "50000000-0000-4000-8000-000000000001",
  creativeVersion: "71000000-0000-4000-8000-000000000001",
  destination: "60000000-0000-4000-8000-000000000001",
  audienceVersion: "82000000-0000-4000-8000-000000000001",
  placementVersion: "84000000-0000-4000-8000-000000000001",
  viewer: "10000000-0000-4000-8000-000000000001",
  superAdmin: "11000000-0000-4000-8000-000000000001",
  platformAdmin: "11000000-0000-4000-8000-000000000002",
  financeAuditor: "11000000-0000-4000-8000-000000000003",
};

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

function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"]);
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

function databaseName(label) {
  return `plr9_${label}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createDatabase(label, withFixture = false) {
  const db = databaseName(label);
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  if (withFixture) psql(db, fixture);
  return db;
}

function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}

function asAdmin(actor, statement) {
  return `begin;set local request.jwt.claim.sub='${actor}';${statement};commit;`;
}

function jsonResult(stdout) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
  assert.ok(line, `expected JSON result in:\n${stdout}`);
  return JSON.parse(line);
}

function eventSql(id, eventKey = randomUUID(), eventType = "impression", occurredAt = "clock_timestamp()") {
  return `
    insert into private.advertising_events(
      id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
      audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
      context_fingerprint,occurred_at
    ) values (
      '${id}','${eventKey}','${eventType}','${ids.ad}','${ids.campaign}','${ids.adSet}',
      '${ids.creativeVersion}','${ids.destination}','${ids.audienceVersion}','${ids.placementVersion}',
      'social_feed','${ids.viewer}',repeat('f',64),${occurredAt}
    );`;
}

function canaryDeliverySetupSql(campaignStatus = "draft") {
  return `
    set session_replication_role=replica;
    update private.advertising_billing_authorization_windows set status='CLOSED',closed_at=clock_timestamp(),updated_at=clock_timestamp() where status='OPEN';
    update private.advertising_campaigns set status='${campaignStatus}' where id='${ids.campaign}';
    update private.advertising_finance_policy set funding_enabled=true,spend_enabled=false,settlement_enabled=false;
    update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=false;
    update private.advertising_delivery_policy set global_v2_delivery_enabled=true;
    update private.advertising_placement_catalog set v2_delivery_enabled=(code='social_feed');
    update private.advertising_canary_policy set launch_mode='CANARY_DELIVERY',canary_enabled=true,
      business_account_id='20000000-0000-4000-8000-000000000001',
      ad_account_id='30000000-0000-4000-8000-000000000001',campaign_id='${ids.campaign}',
      viewer_user_id='${ids.viewer}',placement_code='social_feed',enabled_at=statement_timestamp()-interval '1 minute',
      expires_at=statement_timestamp()+interval '59 minutes',max_budget_bdag=0.01000000,max_impressions=1,
      max_spend_bdag=null,max_billable_events=null;
    set session_replication_role=origin;`;
}

function readinessStubSql() {
  return `
    set role postgres;
    create or replace function private.advertising_campaign_operational_readiness_at(p_campaign_id uuid,p_at_time timestamptz)
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('campaign_id',p_campaign_id,'structurally_ready',true,'target_status','active',
        'blockers','[]'::jsonb,'ready_ad_count',1,'current_window_ad_set_count',1,'future_window_ad_set_count',0,
        'finance_ready',true,'advertiser_age_ready',true)
    $$;
    reset role;`;
}

function lifecycleReadinessStubsSql() {
  return `
    set role postgres;
    create or replace function private.advertising_campaign_operational_readiness_at(p_campaign_id uuid,p_at_time timestamptz)
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object(
        'campaign_id',p_campaign_id,'structurally_ready',true,'target_status','active','blockers','[]'::jsonb,
        'ready_ad_count',1,
        'current_window_ad_set_count',case when coalesce(current_setting('plr9.readiness',true),'ready')='expired' then 0 else 1 end,
        'future_window_ad_set_count',0,'finance_ready',true,'advertiser_age_ready',true
      )
    $$;
    reset role;
    create or replace function private.advertising_campaign_billing_readiness_at(p_campaign_id uuid,p_placement_code text,p_at_time timestamptz default clock_timestamp())
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('ready',true,'status','ready','blocker',null,'available_to_reserve_bdag',1,'next_rate_bdag',0.0001)
    $$;
    `;
}

function ageEligibilityStubSql() {
  return `
    set role postgres;
    create or replace function private.ads_actor_is_advertiser_age_eligible(p_actor uuid)
    returns boolean language sql stable security definer set search_path='' as $$select p_actor is not null$$;
    reset role;`;
}

async function runGatedRace(db, operationSql, transitionKey) {
  const operation = psqlAsync(db, `begin;select * from private.advertising_canary_policy where singleton for update;select pg_sleep(0.30);${operationSql};commit;`);
  await new Promise((resolve) => setTimeout(resolve, 75));
  const transition = psqlAsync(db, `select public.set_advertising_launch_mode_v2('DISARMED','${transitionKey}');`);
  const [operationResult, transitionResult] = await Promise.all([operation, transition]);
  assert.equal(operationResult.status, 0, operationResult.stderr);
  assert.equal(transitionResult.status, 0, transitionResult.stderr);
  assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "DISARMED");
}

test("PLR-9 disposable harness targets exactly one migration", { skip: !enabled }, () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migration, /create table private\.advertising_objective_capabilities/i);
});

test("fresh migrated schema is DISARMED, rate-free, window-free, ACL-safe, and cron-complete", { skip: !enabled }, () => {
  const db = createDatabase("schema");
  try {
    const state = psql(db, `
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
    `).stdout;
    assert.equal(state, "DISARMED|f|f|f|f|f|f|f|0|0|0");

    const capabilities = psql(db, `select string_agg(objective||':'||setup_enabled||':'||delivery_runtime_ready||':'||billing_runtime_ready||':'||coalesce(billable_event_type,'-'),',' order by objective) from private.advertising_objective_capabilities;`).stdout;
    assert.match(capabilities, /awareness:true:true:true:impression/);
    assert.match(capabilities, /traffic:true:true:true:click/);
    assert.match(capabilities, /marketplace_sales:true:true:true:click/);
    assert.match(capabilities, /reach:false:false:false:-/);

    const acl = psql(db, `
      select concat_ws('|',
        has_function_privilege('anon','public.reconcile_advertising_billable_events_v2(integer)','execute'),
        has_function_privilege('authenticated','public.reconcile_advertising_billable_events_v2(integer)','execute'),
        has_function_privilege('service_role','public.reconcile_advertising_billable_events_v2(integer)','execute'),
        has_function_privilege('authenticated','public.get_my_advertising_campaign_billing_v2(uuid)','execute'));
    `).stdout;
    assert.equal(acl, "f|f|t|t");

    const jobs = psql(db, `select string_agg(jobname||':'||schedule,',' order by jobname) from cron.job where jobname like 'reconcile-advertising-%-v2';`).stdout;
    assert.match(jobs, /reconcile-advertising-billable-events-v2:\* \* \* \* \*/);
    assert.match(jobs, /reconcile-advertising-campaign-lifecycle-v2:\* \* \* \* \*/);
    assert.match(jobs, /reconcile-advertising-campaign-settlements-v2:\* \* \* \* \*/);

    const recon = JSON.parse(psql(db, "select public.reconcile_advertising_finance()::text;").stdout);
    assert.equal(recon.production_rate_coverage_gap, 0);
    assert.equal(recon.canary_rate_scope_mismatch, 0);
    assert.equal(recon.active_pending_reservation_overflow, 0);
  } finally {
    dropDatabase(db);
  }
});

test("classifier reserves once; canonical materializer charges once; exhaustion never partial-charges", { skip: !enabled }, async () => {
  const db = createDatabase("billing", true);
  try {
    const first = "c0000000-0000-4000-8000-000000000001";
    psql(db, eventSql(first));
    assert.equal(psql(db, `select status||'|'||amount_bdag from private.advertising_event_billing_materializations where billable_event_id='${first}';`).stdout, "pending|0.00600000");
    assert.equal(psql(db, `select private.advertising_active_pending_reserved_bdag('${ids.campaign}',clock_timestamp());`).stdout, "0.00600000");

    const [left, right] = await Promise.all([
      psqlAsync(db, "select public.reconcile_advertising_billable_events_v2(100)::text;"),
      psqlAsync(db, "select public.reconcile_advertising_billable_events_v2(100)::text;"),
    ]);
    assert.equal(left.status, 0, left.stderr);
    assert.equal(right.status, 0, right.stderr);
    assert.equal(psql(db, `select count(*)||'|'||min(status)||'|'||min(amount_bdag) from private.advertising_event_billing_materializations where billable_event_id='${first}';`).stdout, "1|charged|0.00600000");
    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "0.00600000");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "1");
    assert.equal(psql(db, "select count(*) from public.ledger_entries where txn_id in (select id from public.financial_transactions where operation_type='advertising_campaign_spend');").stdout, "2");
    assert.equal(psql(db, "select count(*) from private.advertising_financial_events where event_type='spend' and billing_rate_version_id='a0000000-0000-4000-8000-000000000001' and unit_rate_bdag=0.00600000;").stdout, "1");

    const second = "c0000000-0000-4000-8000-000000000002";
    psql(db, eventSql(second));
    assert.equal(psql(db, `select status||'|'||amount_bdag from private.advertising_event_billing_materializations where billable_event_id='${second}';`).stdout, "budget_exhausted|0.00000000");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "1");
    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "0.00600000");
  } finally {
    dropDatabase(db);
  }
});

test("O(1) window close immediately releases pending reservation and bounded housekeeping terminalizes it", { skip: !enabled }, () => {
  const db = createDatabase("window", true);
  try {
    const event = "c0000000-0000-4000-8000-000000000003";
    psql(db, eventSql(event));
    assert.equal(psql(db, `select private.advertising_active_pending_reserved_bdag('${ids.campaign}',clock_timestamp());`).stdout, "0.00600000");
    psql(db, "update private.advertising_billing_authorization_windows set status='CLOSED',closed_at=clock_timestamp(),updated_at=clock_timestamp() where status='OPEN';");
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${event}';`).stdout, "pending");
    assert.equal(psql(db, `select private.advertising_active_pending_reserved_bdag('${ids.campaign}',clock_timestamp());`).stdout, "0.00000000");
    assert.equal(psql(db, "select public.reconcile_advertising_billable_events_v2(100)->>'terminalized';").stdout, "1");
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${event}';`).stdout, "not_billable_outside_authorization");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "0");
  } finally {
    dropDatabase(db);
  }
});

test("materializer and classifier serialize legally against PRODUCTION to DISARMED", { skip: !enabled }, async () => {
  const db = createDatabase("race", true);
  try {
    const pending = "c0000000-0000-4000-8000-000000000004";
    psql(db, eventSql(pending));
    const materializer = psqlAsync(db, "begin; select * from private.advertising_canary_policy where singleton for update; select pg_sleep(0.35); select public.reconcile_advertising_billable_events_v2(100); commit;");
    await new Promise((resolve) => setTimeout(resolve, 75));
    const disarm = psqlAsync(db, "select public.set_advertising_launch_mode_v2('DISARMED','d0000000-0000-4000-8000-000000000001');");
    const [materializerResult, disarmResult] = await Promise.all([materializer, disarm]);
    assert.equal(materializerResult.status, 0, materializerResult.stderr);
    assert.equal(disarmResult.status, 0, disarmResult.stderr);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "DISARMED");
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${pending}';`).stdout, "charged");

    const after = "c0000000-0000-4000-8000-000000000005";
    psql(db, eventSql(after));
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${after}';`).stdout, "not_billable_outside_authorization");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "1");
  } finally {
    dropDatabase(db);
  }
});

test("authorization-window close can win against materialization without partial Spend", { skip: !enabled }, async () => {
  const db = createDatabase("race_close_wins", true);
  try {
    const pending = "c0000000-0000-4000-8000-000000000007";
    psql(db, eventSql(pending));
    const close = psqlAsync(db, "begin;select public.set_advertising_launch_mode_v2('DISARMED','d0000000-0000-4000-8000-000000000016');select pg_sleep(0.30);commit;");
    await new Promise((resolve) => setTimeout(resolve, 75));
    const materializer = psqlAsync(db, "select public.reconcile_advertising_billable_events_v2(100)::text;");
    const [closeResult, materializerResult] = await Promise.all([close, materializer]);
    assert.equal(closeResult.status, 0, closeResult.stderr);
    assert.equal(materializerResult.status, 0, materializerResult.stderr);
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${pending}';`).stdout, "not_billable_outside_authorization");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "0");
    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "0.00000000");
  } finally { dropDatabase(db); }
});

test("DISARM serializes with Funding, Activate, and Resume on the shared control-plane row", { skip: !enabled }, async () => {
  const fundingDb = createDatabase("race_funding", true);
  try {
    psql(fundingDb, `${canaryDeliverySetupSql("draft")}
      set session_replication_role=replica;
      update private.advertising_campaign_finance set finance_status='draft',funded_bdag=0,spent_bdag=0,released_bdag=0,
        funding_source_account_id=null,funded_by_user_id=null,funded_at=null where campaign_id='${ids.campaign}';
      update public.ledger_accounts set balance=case when account_type='user' then 1 else 0 end
        where id in ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002');
      insert into private.user_age_eligibility(user_id,status,minimum_age,policy_version,evaluated_at,source,age_band)
      select '${ids.viewer}','eligible',minimum_age,policy_version,clock_timestamp(),'plr9_disposable_fixture','age_18_plus'
      from private.age_eligibility_policy where singleton on conflict(user_id) do update set status='eligible',age_band='age_18_plus',evaluated_at=excluded.evaluated_at;
      set session_replication_role=origin;
      ${ageEligibilityStubSql()}`);
    await runGatedRace(fundingDb, `set local request.jwt.claim.sub='${ids.viewer}';set local request.jwt.claim.role='authenticated';select public.fund_my_advertising_campaign_budget_v2('${ids.campaign}','e0000000-0000-4000-8000-000000000001')`, "d0000000-0000-4000-8000-000000000011");
    assert.equal(psql(fundingDb, `select finance_status||'|'||funded_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "funded|0.01000000");
  } finally { dropDatabase(fundingDb); }

  for (const [action, initialStatus, key, transitionKey] of [
    ["activate", "draft", "e0000000-0000-4000-8000-000000000002", "d0000000-0000-4000-8000-000000000012"],
    ["resume", "paused", "e0000000-0000-4000-8000-000000000003", "d0000000-0000-4000-8000-000000000013"],
  ]) {
    const db = createDatabase(`race_${action}`, true);
    try {
      psql(db, `${canaryDeliverySetupSql(initialStatus)}${readinessStubSql()}`);
      await runGatedRace(db, `set local request.jwt.claim.sub='${ids.viewer}';set local request.jwt.claim.role='authenticated';select public.${action}_my_advertising_campaign_v2('${ids.campaign}','${key}')`, transitionKey);
      assert.equal(psql(db, `select status from private.advertising_campaigns where id='${ids.campaign}';`).stdout, "active");
    } finally { dropDatabase(db); }
  }
});

test("SETTLEMENT_ONLY to DISARMED serializes with zero-residual canonical Settlement", { skip: !enabled }, async () => {
  const db = createDatabase("race_settlement", true);
  try {
    psql(db, `
      set session_replication_role=replica;
      update private.advertising_billing_authorization_windows set status='CLOSED',closed_at=clock_timestamp(),updated_at=clock_timestamp() where status='OPEN';
      update private.advertising_campaigns set status='completed' where id='${ids.campaign}';
      update private.advertising_campaign_finance set finance_status='funded',funded_bdag=0.01000000,spent_bdag=0.01000000,released_bdag=0 where campaign_id='${ids.campaign}';
      update private.advertising_finance_policy set funding_enabled=false,spend_enabled=false,settlement_enabled=true;
      update private.advertising_campaign_lifecycle_policy set activation_enabled=false,automatic_transitions_enabled=false;
      update private.advertising_delivery_policy set global_v2_delivery_enabled=false;
      update private.advertising_placement_catalog set v2_delivery_enabled=false;
      update private.advertising_canary_policy set launch_mode='SETTLEMENT_ONLY',canary_enabled=false,
        business_account_id=null,ad_account_id=null,campaign_id=null,viewer_user_id=null,placement_code=null,
        enabled_at=null,expires_at=null,max_budget_bdag=null,max_impressions=null,max_spend_bdag=null,max_billable_events=null;
      set session_replication_role=origin;`);
    await runGatedRace(db, `select public.settle_advertising_campaign_budget_v2('${ids.campaign}','e0000000-0000-4000-8000-000000000004')`, "d0000000-0000-4000-8000-000000000014");
    assert.equal(psql(db, `select finance_status||'|'||released_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "settled|0.00000000");
    assert.equal(psql(db, `select count(*) from private.advertising_financial_settlements where campaign_id='${ids.campaign}';`).stdout, "1");
  } finally { dropDatabase(db); }
});

test("CANARY_BILLING to DISARMED serializes with canonical Spend", { skip: !enabled }, async () => {
  const db = createDatabase("race_canary_spend", true);
  try {
    psql(db, `
      set session_replication_role=replica;
      update private.advertising_billing_rate_versions set scope='canary_campaign',scope_campaign_id='${ids.campaign}' where id='a0000000-0000-4000-8000-000000000001';
      update private.advertising_billing_authorization_windows set mode='CANARY_BILLING',scope='canary_campaign',campaign_id='${ids.campaign}',
        expires_at=statement_timestamp()+interval '59 minutes',max_spend_bdag=0.01000000,max_billable_events=1,status='OPEN',closed_at=null;
      update private.advertising_finance_policy set funding_enabled=false,spend_enabled=true,settlement_enabled=false;
      update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=false;
      update private.advertising_canary_policy set launch_mode='CANARY_BILLING',canary_enabled=true,
        business_account_id='20000000-0000-4000-8000-000000000001',ad_account_id='30000000-0000-4000-8000-000000000001',campaign_id='${ids.campaign}',
        viewer_user_id='${ids.viewer}',placement_code='social_feed',enabled_at=statement_timestamp()-interval '1 minute',expires_at=statement_timestamp()+interval '59 minutes',
        max_budget_bdag=0.01000000,max_impressions=1,max_spend_bdag=0.01000000,max_billable_events=1;
      set session_replication_role=origin;`);
    const event = "c0000000-0000-4000-8000-000000000006";
    psql(db, eventSql(event));
    await runGatedRace(db, `select public.spend_advertising_campaign_budget_v2('${ids.campaign}','${event}',0.00600000,'e0000000-0000-4000-8000-000000000005')`, "d0000000-0000-4000-8000-000000000015");
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${event}';`).stdout, "charged");
    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "0.00600000");
  } finally { dropDatabase(db); }
});

test("canonical launch authority enters CANARY_DELIVERY from the real placement model", { skip: !enabled }, () => {
  const db = createDatabase("canary_delivery_mode", true);
  try {
    psql(db, `select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());
      set session_replication_role=replica;
      update private.advertising_campaigns set status='paused' where id='${ids.campaign}';
      set session_replication_role=origin;`);
    const receipt = jsonResult(psql(db, `select public.set_advertising_launch_mode_v2(
      'CANARY_DELIVERY',gen_random_uuid(),
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      '${ids.campaign}','${ids.viewer}','social_feed',clock_timestamp()+interval '1 hour',
      0.01000000,1,null,null
    )::text;`).stdout);
    assert.equal(receipt.to_mode, "CANARY_DELIVERY");
    assert.equal(psql(db, `select concat_ws('|',launch_mode,canary_enabled,campaign_id,placement_code) from private.advertising_canary_policy where singleton;`).stdout, `CANARY_DELIVERY|t|${ids.campaign}|social_feed`);
  } finally { dropDatabase(db); }
});

test("five launch modes enforce the legal envelope and complete production rate coverage", { skip: !enabled }, () => {
  const db = createDatabase("launch_modes", true);
  try {
    psql(db, `select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());
      set session_replication_role=replica;
      update private.advertising_campaigns set status='paused' where id='${ids.campaign}';
      set session_replication_role=origin;`);
    assert.equal(psql(db, "select launch_mode||'|'||canary_enabled from private.advertising_canary_policy where singleton;").stdout, "DISARMED|false");

    psql(db, `select public.set_advertising_launch_mode_v2(
      'CANARY_DELIVERY',gen_random_uuid(),'20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001','${ids.campaign}','${ids.viewer}',
      'social_feed',clock_timestamp()+interval '1 hour',0.01000000,1,null,null);`);
    assert.equal(psql(db, `select concat_ws('|',launch.launch_mode,launch.canary_enabled,finance.funding_enabled,finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled,(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled)) from private.advertising_canary_policy launch cross join private.advertising_finance_policy finance cross join private.advertising_campaign_lifecycle_policy lifecycle cross join private.advertising_delivery_policy delivery where launch.singleton and finance.singleton and lifecycle.singleton and delivery.singleton;`).stdout, "CANARY_DELIVERY|t|t|f|f|t|f|t|1");

    psql(db, `select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());
      set session_replication_role=replica;
      update private.advertising_billing_rate_versions set scope='canary_campaign',scope_campaign_id='${ids.campaign}' where id='a0000000-0000-4000-8000-000000000001';
      set session_replication_role=origin;`);
    psql(db, `select public.set_advertising_launch_mode_v2(
      'CANARY_BILLING',gen_random_uuid(),'20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001','${ids.campaign}','${ids.viewer}',
      'social_feed',clock_timestamp()+interval '1 hour',0.01000000,1,0.01000000,1);`);
    assert.equal(psql(db, `select concat_ws('|',launch.launch_mode,launch.canary_enabled,finance.funding_enabled,finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled,(select count(*) from private.advertising_billing_authorization_windows where status='OPEN')) from private.advertising_canary_policy launch cross join private.advertising_finance_policy finance cross join private.advertising_campaign_lifecycle_policy lifecycle cross join private.advertising_delivery_policy delivery where launch.singleton and finance.singleton and lifecycle.singleton and delivery.singleton;`).stdout, "CANARY_BILLING|t|f|t|f|t|f|t|1");

    psql(db, "select public.set_advertising_launch_mode_v2('SETTLEMENT_ONLY',gen_random_uuid());");
    assert.equal(psql(db, `select concat_ws('|',launch.launch_mode,launch.canary_enabled,finance.funding_enabled,finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled,(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled),(select count(*) from private.advertising_billing_authorization_windows where status='OPEN')) from private.advertising_canary_policy launch cross join private.advertising_finance_policy finance cross join private.advertising_campaign_lifecycle_policy lifecycle cross join private.advertising_delivery_policy delivery where launch.singleton and finance.singleton and lifecycle.singleton and delivery.singleton;`).stdout, "SETTLEMENT_ONLY|f|f|f|t|f|f|f|0|0");
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");

    const incomplete = psql(db, "select public.set_advertising_launch_mode_v2('PRODUCTION',gen_random_uuid());", { allowFailure: true });
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /advertising_production_rate_coverage_incomplete/);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "DISARMED");

    psql(db, `set session_replication_role=replica;
      update private.advertising_billing_rate_versions set scope='global',scope_campaign_id=null where id='a0000000-0000-4000-8000-000000000001';
      insert into private.advertising_billing_rate_versions(objective,billable_event_type,placement_code,rate_bdag,currency,scope,state,effective_from,published_at) values
        ('traffic','click','social_feed',0.00010000,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),
        ('marketplace_sales','click','social_feed',0.00010000,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp());
      set session_replication_role=origin;`);
    psql(db, "select public.set_advertising_launch_mode_v2('PRODUCTION',gen_random_uuid());");
    assert.equal(psql(db, `select concat_ws('|',launch.launch_mode,launch.canary_enabled,finance.funding_enabled,finance.spend_enabled,finance.settlement_enabled,lifecycle.activation_enabled,lifecycle.automatic_transitions_enabled,delivery.global_v2_delivery_enabled,(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled),(select count(*) from private.advertising_billing_authorization_windows where status='OPEN')) from private.advertising_canary_policy launch cross join private.advertising_finance_policy finance cross join private.advertising_campaign_lifecycle_policy lifecycle cross join private.advertising_delivery_policy delivery where launch.singleton and finance.singleton and lifecycle.singleton and delivery.singleton;`).stdout, "PRODUCTION|f|t|t|t|t|t|t|1|1");

    const illegalHybrid = psql(db, "begin;update private.advertising_finance_policy set spend_enabled=false where singleton;commit;", { allowFailure: true });
    assert.notEqual(illegalHybrid.status, 0);
    assert.match(illegalHybrid.stderr, /advertising_launch_envelope_violation/);
    assert.equal(psql(db, "select spend_enabled from private.advertising_finance_policy where singleton;").stdout, "t");

    const contradiction = psql(db, "update private.advertising_canary_policy set canary_enabled=true where singleton;", { allowFailure: true });
    assert.notEqual(contradiction.status, 0);
    assert.match(contradiction.stderr, /advertising_canary_policy_(?:mode_enabled|enabled_shape)_chk/);
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
  } finally { dropDatabase(db); }
});

test("launch transitions are durably idempotent across later transitions and concurrent replay", { skip: !enabled }, async () => {
  const db = createDatabase("launch_idempotency", true);
  try {
    const keyA = "d1000000-0000-4000-8000-000000000001";
    const keyB = "d1000000-0000-4000-8000-000000000002";
    const keyFailure = "d1000000-0000-4000-8000-000000000003";
    const keyConcurrent = "d1000000-0000-4000-8000-000000000004";

    const firstA = jsonResult(psql(db, `select public.set_advertising_launch_mode_v2('DISARMED','${keyA}')::text;`).stdout);
    assert.equal(firstA.from_mode, "PRODUCTION");
    assert.equal(firstA.to_mode, "DISARMED");
    const firstB = jsonResult(psql(db, `select public.set_advertising_launch_mode_v2('SETTLEMENT_ONLY','${keyB}')::text;`).stdout);
    assert.equal(firstB.to_mode, "SETTLEMENT_ONLY");
    const windowsBeforeReplay = psql(db, "select count(*) from private.advertising_billing_authorization_windows;").stdout;
    const replayA = jsonResult(psql(db, `select public.set_advertising_launch_mode_v2('DISARMED','${keyA}')::text;`).stdout);
    assert.equal(replayA.idempotent, true);
    assert.equal(replayA.transitioned_at, firstA.transitioned_at);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "SETTLEMENT_ONLY");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_authorization_windows;").stdout, windowsBeforeReplay);
    assert.equal(psql(db, "select count(*) from private.admin_action_audit where action='advertising.launch_mode.transition';").stdout, "2");
    assert.equal(psql(db, "select count(*) from private.admin_action_audit where action='advertising.launch_mode.transition' and target_type='advertising_control_plane';").stdout, "2");

    const conflict = psql(db, `select public.set_advertising_launch_mode_v2('PRODUCTION','${keyA}');`, { allowFailure: true });
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /admin_idempotency_conflict/);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "SETTLEMENT_ONLY");

    const failed = psql(db, `select public.set_advertising_launch_mode_v2('CANARY_DELIVERY','${keyFailure}');`, { allowFailure: true });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /advertising_canary_launch_target_invalid/);
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where idempotency_key='${keyFailure}';`).stdout, "0");
    const retry = jsonResult(psql(db, `select public.set_advertising_launch_mode_v2('DISARMED','${keyFailure}')::text;`).stdout);
    assert.equal(retry.to_mode, "DISARMED");

    const [left, right] = await Promise.all([
      psqlAsync(db, `select public.set_advertising_launch_mode_v2('SETTLEMENT_ONLY','${keyConcurrent}')::text;`),
      psqlAsync(db, `select public.set_advertising_launch_mode_v2('SETTLEMENT_ONLY','${keyConcurrent}')::text;`),
    ]);
    assert.equal(left.status, 0, left.stderr);
    assert.equal(right.status, 0, right.stderr);
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where idempotency_key='${keyConcurrent}';`).stdout, "1");
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "SETTLEMENT_ONLY");
    const replayFlags = [jsonResult(left.stdout).idempotent, jsonResult(right.stdout).idempotent].sort();
    assert.deepEqual(replayFlags, [false, true]);
  } finally { dropDatabase(db); }
});

test("Admin capabilities separate operational health, Finance detail, and rate management", { skip: !enabled }, () => {
  const db = createDatabase("admin_rates");
  try {
    const capabilityMatrix = psql(db, `
      select set_config('request.jwt.claim.sub','${ids.platformAdmin}',false);
      select concat_ws('|',public.admin_actor_has_capability('advertising.billing.read'),public.admin_actor_has_capability('finance.reconciliation.read'),public.admin_actor_has_capability('advertising.rates.manage'));
      select set_config('request.jwt.claim.sub','${ids.financeAuditor}',false);
      select concat_ws('|',public.admin_actor_has_capability('advertising.billing.read'),public.admin_actor_has_capability('finance.reconciliation.read'),public.admin_actor_has_capability('advertising.rates.manage'));
      select set_config('request.jwt.claim.sub','${ids.superAdmin}',false);
      select concat_ws('|',public.admin_actor_has_capability('advertising.billing.read'),public.admin_actor_has_capability('finance.reconciliation.read'),public.admin_actor_has_capability('advertising.rates.manage'));
    `).stdout;
    assert.match(capabilityMatrix, /t\|f\|f[\s\S]*t\|t\|f[\s\S]*t\|t\|t/);

    assert.doesNotThrow(() => psql(db, asAdmin(ids.platformAdmin, "select public.get_admin_advertising_billing_health();")));
    const platformFinance = psql(db, asAdmin(ids.platformAdmin, "select public.get_admin_advertising_finance_health();"), { allowFailure: true });
    assert.notEqual(platformFinance.status, 0);
    assert.match(platformFinance.stderr, /admin_capability_forbidden/);
    assert.doesNotThrow(() => psql(db, asAdmin(ids.financeAuditor, "select public.get_admin_advertising_billing_health();select public.get_admin_advertising_finance_health();")));

    for (const actor of [ids.platformAdmin, ids.financeAuditor]) {
      const denied = psql(db, asAdmin(actor, `select public.admin_create_advertising_billing_rate_draft_v2('awareness','impression','social_feed','global',null,0.00000123,'2100-01-01T00:00:00Z','d2000000-0000-4000-8000-000000000001');`), { allowFailure: true });
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /admin_capability_forbidden/);
    }
  } finally { dropDatabase(db); }
});

test("rate lifecycle is prospective, immutable, overlap-safe, idempotent, and canonically audited", { skip: !enabled }, () => {
  const db = createDatabase("rate_lifecycle");
  try {
    const createKey = "d3000000-0000-4000-8000-000000000001";
    const updateKey = "d3000000-0000-4000-8000-000000000002";
    const publishKey = "d3000000-0000-4000-8000-000000000003";
    const retireKey = "d3000000-0000-4000-8000-000000000004";
    const createSql = `select public.admin_create_advertising_billing_rate_draft_v2('awareness','impression','social_feed','global',null,0.00000123,'2100-01-01T00:00:00Z','${createKey}')::text;`;
    const created = jsonResult(psql(db, asAdmin(ids.superAdmin, createSql)).stdout);
    assert.equal(created.state, "draft");
    const rateId = created.rate_id;
    const replay = jsonResult(psql(db, asAdmin(ids.superAdmin, createSql)).stdout);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.rate_id, rateId);
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where action='advertising.rate.draft.create' and target_id='${rateId}';`).stdout, "1");

    const createConflict = psql(db, asAdmin(ids.superAdmin, `select public.admin_create_advertising_billing_rate_draft_v2('awareness','impression','social_feed','global',null,0.00000124,'2100-01-01T00:00:00Z','${createKey}');`), { allowFailure: true });
    assert.notEqual(createConflict.status, 0);
    assert.match(createConflict.stderr, /admin_idempotency_conflict/);

    const updated = jsonResult(psql(db, asAdmin(ids.superAdmin, `select public.admin_update_advertising_billing_rate_draft_v2('${rateId}','awareness','impression','social_feed','global',null,0.00000124,'2100-01-01T00:00:00Z',null,'${updateKey}')::text;`)).stdout);
    assert.equal(updated.state, "draft");
    const published = jsonResult(psql(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${rateId}','Approved fixture-only publication','${publishKey}')::text;`)).stdout);
    assert.equal(published.state, "published");
    const immutable = psql(db, `update private.advertising_billing_rate_versions set rate_bdag=0.00000125 where id='${rateId}';`, { allowFailure: true });
    assert.notEqual(immutable.status, 0);
    assert.match(immutable.stderr, /advertising_billing_rate_published_immutable/);

    const retired = jsonResult(psql(db, asAdmin(ids.superAdmin, `select public.admin_retire_advertising_billing_rate_v2('${rateId}','Fixture lifecycle complete','${retireKey}')::text;`)).stdout);
    assert.equal(retired.state, "retired");
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where target_id='${rateId}' and action in ('advertising.rate.draft.create','advertising.rate.draft.update','advertising.rate.publish','advertising.rate.retire');`).stdout, "4");
    const financeAudit = jsonResult(psql(db, asAdmin(ids.financeAuditor, "select public.search_admin_finance_audit()::text;")).stdout);
    assert.equal(financeAudit.items.filter((item) => item.target_id === rateId).length, 4);
    const platformAudit = psql(db, asAdmin(ids.platformAdmin, "select public.search_admin_finance_audit();"), { allowFailure: true });
    assert.notEqual(platformAudit.status, 0);
    assert.match(platformAudit.stderr, /admin_capability_forbidden/);

    const invalidPair = psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('awareness','click','social_feed','global',null,0.1,'2100-01-01T00:00:00Z',gen_random_uuid());"), { allowFailure: true });
    assert.match(invalidPair.stderr, /advertising_billing_rate_objective_event_invalid/);
    const invalidAmount = psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global',null,0.000000001,'2100-01-01T00:00:00Z',gen_random_uuid());"), { allowFailure: true });
    assert.match(invalidAmount.stderr, /advertising_billing_rate_amount_invalid/);
    const zeroAmount = psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global',null,0,'2100-01-01T00:00:00Z',gen_random_uuid());"), { allowFailure: true });
    assert.match(zeroAmount.stderr, /advertising_billing_rate_amount_invalid/);
    const wrongGlobalScope = psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global','40000000-0000-4000-8000-000000000001',0.00000100,'2100-01-01T00:00:00Z',gen_random_uuid());"), { allowFailure: true });
    assert.match(wrongGlobalScope.stderr, /advertising_billing_rate_scope_invalid/);
    const missingCanaryCampaign = psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','canary_campaign','40000000-0000-4000-8000-000000000001',0.00000100,'2100-01-01T00:00:00Z',gen_random_uuid());"), { allowFailure: true });
    assert.match(missingCanaryCampaign.stderr, /advertising_billing_rate_scope_invalid/);
    const nonBdag = psql(db, "insert into private.advertising_billing_rate_versions(objective,billable_event_type,placement_code,rate_bdag,currency,scope,state,effective_from) values('traffic','click','social_feed',0.00000100,'USD','global','draft','2100-01-01T00:00:00Z');", { allowFailure: true });
    assert.notEqual(nonBdag.status, 0);
    assert.match(nonBdag.stderr, /advertising_billing_rate_versions_currency_check/);

    const backdated = jsonResult(psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global',null,0.00000100,'2020-01-01T00:00:00Z',gen_random_uuid())::text;")).stdout);
    const backdatedPublish = psql(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${backdated.rate_id}','Must remain prospective',gen_random_uuid());`), { allowFailure: true });
    assert.match(backdatedPublish.stderr, /advertising_billing_rate_backdating_forbidden/);

    const overlapA = jsonResult(psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global',null,0.00000200,'2101-01-01T00:00:00Z',gen_random_uuid())::text;")).stdout);
    psql(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${overlapA.rate_id}','Fixture overlap A',gen_random_uuid());`));
    const overlapB = jsonResult(psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('traffic','click','social_feed','global',null,0.00000300,'2101-06-01T00:00:00Z',gen_random_uuid())::text;")).stdout);
    const overlapPublish = psql(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${overlapB.rate_id}','Fixture overlap B',gen_random_uuid());`), { allowFailure: true });
    assert.notEqual(overlapPublish.status, 0);
    assert.match(overlapPublish.stderr, /advertising_billing_rate_versions_no_overlap|conflicting key value violates exclusion constraint/);
  } finally { dropDatabase(db); }
});

test("rate publish and retire serialize legally against PRODUCTION entry", { skip: !enabled }, async () => {
  const db = createDatabase("rate_mode_races", true);
  try {
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
    psql(db, "insert into private.advertising_billing_rate_versions(objective,billable_event_type,placement_code,rate_bdag,currency,scope,state,effective_from,published_at) values('traffic','click','social_feed',0.00010000,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp());");
    const draft = jsonResult(psql(db, asAdmin(ids.superAdmin, "select public.admin_create_advertising_billing_rate_draft_v2('marketplace_sales','click','social_feed','global',null,0.00010000,clock_timestamp()+interval '1 second',gen_random_uuid())::text;")).stdout);
    const publishKey = "d4000000-0000-4000-8000-000000000001";
    const publish = psqlAsync(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${draft.rate_id}','Race-safe fixture publish','${publishKey}');select pg_sleep(1.20);`));
    // Start mode entry after the prospective rate is effective, but while the
    // publishing transaction still owns the shared control-plane lock.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const enterAfterPublish = psqlAsync(db, "select public.set_advertising_launch_mode_v2('PRODUCTION','d4000000-0000-4000-8000-000000000002');");
    const [publishResult, entryResult] = await Promise.all([publish, enterAfterPublish]);
    assert.equal(publishResult.status, 0, publishResult.stderr);
    assert.equal(entryResult.status, 0, entryResult.stderr);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "PRODUCTION");

    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
    const enterFirst = psqlAsync(db, "begin;select * from private.advertising_canary_policy where singleton for update;select pg_sleep(0.30);select public.set_advertising_launch_mode_v2('PRODUCTION','d4000000-0000-4000-8000-000000000003');commit;");
    await new Promise((resolve) => setTimeout(resolve, 75));
    const retireAfterEntry = psqlAsync(db, asAdmin(ids.superAdmin, `select public.admin_retire_advertising_billing_rate_v2('${draft.rate_id}','Race-safe fixture retirement','d4000000-0000-4000-8000-000000000004');`));
    const [entryFirstResult, retireResult] = await Promise.all([enterFirst, retireAfterEntry]);
    assert.equal(entryFirstResult.status, 0, entryFirstResult.stderr);
    assert.notEqual(retireResult.status, 0);
    assert.match(retireResult.stderr, /advertising_billing_authorization_window_open/);
    assert.equal(psql(db, "select launch_mode from private.advertising_canary_policy where singleton;").stdout, "PRODUCTION");
    assert.equal(psql(db, `select state from private.advertising_billing_rate_versions where id='${draft.rate_id}';`).stdout, "published");
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
  } finally { dropDatabase(db); }
});

test("classifier terminalizes cutover, objective, and no-rate cases without Finance mutation", { skip: !enabled }, () => {
  const db = createDatabase("classifier_terminal", true);
  try {
    const before = psql(db, "select (select count(*) from public.financial_transactions)::text||'|'||(select count(*) from public.ledger_entries)::text;").stdout;
    const beforeCutover = "c0000000-0000-4000-8000-000000000010";
    psql(db, eventSql(
      beforeCutover,
      randomUUID(),
      "impression",
      "(select billing_cutover_at-interval '1 second' from private.advertising_canary_policy where singleton)",
    ));
    // Cutover is the structural authority; no historical materialization row
    // is required for an event whose occurred_at predates billing.
    assert.equal(psql(db, `select count(*) from private.advertising_event_billing_materializations where billable_event_id='${beforeCutover}';`).stdout, "0");

    const wrongObjectiveEvent = "c0000000-0000-4000-8000-000000000011";
    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set objective='traffic' where id='${ids.campaign}';set session_replication_role=origin;`);
    psql(db, eventSql(wrongObjectiveEvent));
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${wrongObjectiveEvent}';`).stdout, "not_billable_objective");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set objective='awareness' where id='${ids.campaign}';delete from private.advertising_billing_rate_versions where objective='awareness' and scope='global';set session_replication_role=origin;`);
    const noRate = "c0000000-0000-4000-8000-000000000012";
    psql(db, eventSql(noRate));
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${noRate}';`).stdout, "not_billable_no_rate");
    assert.equal(psql(db, "select (select count(*) from public.financial_transactions)::text||'|'||(select count(*) from public.ledger_entries)::text;").stdout, before);
  } finally { dropDatabase(db); }
});

test("materializer propagates an unexpected Spend failure and retries the same pending event safely", { skip: !enabled }, () => {
  const db = createDatabase("materializer_failure", true);
  try {
    const event = "c0000000-0000-4000-8000-000000000013";
    psql(db, eventSql(event));
    psql(db, "update public.ledger_accounts set frozen=true where account_type='marketplace_ads_escrow';");
    const failed = psql(db, "select public.reconcile_advertising_billable_events_v2(100);", { allowFailure: true });
    assert.notEqual(failed.status, 0);
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${event}';`).stdout, "pending");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "0");
    psql(db, "update public.ledger_accounts set frozen=false where account_type='marketplace_ads_escrow';");
    assert.equal(psql(db, "select public.reconcile_advertising_billable_events_v2(100)->>'charged';").stdout, "1");
    assert.equal(psql(db, `select status from private.advertising_event_billing_materializations where billable_event_id='${event}';`).stdout, "charged");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "1");
  } finally { dropDatabase(db); }
});

test("active pending overflow blocks readiness and surfaces a reconciliation and Admin anomaly", { skip: !enabled }, () => {
  const db = createDatabase("pending_overflow", true);
  try {
    const event = "c0000000-0000-4000-8000-000000000014";
    psql(db, eventSql(event));
    psql(db, `set session_replication_role=replica;update private.advertising_event_billing_materializations set amount_bdag=0.02000000 where billable_event_id='${event}';set session_replication_role=origin;`);
    assert.equal(psql(db, `select private.advertising_active_pending_reserved_bdag('${ids.campaign}',clock_timestamp());`).stdout, "0.02000000");
    assert.equal(psql(db, `select private.advertising_campaign_billing_readiness_at('${ids.campaign}','social_feed',clock_timestamp())->>'blocker';`).stdout, "active_pending_reservation_exceeds_available_finance");
    const reconciliation = jsonResult(psql(db, "select public.reconcile_advertising_finance()::text;").stdout);
    assert.equal(Number(reconciliation.active_pending_reservation_overflow), 1);
    const health = jsonResult(psql(db, asAdmin(ids.financeAuditor, "select public.get_admin_advertising_finance_health()::text;")).stdout);
    assert.equal(Number(health.reconciliation.active_pending_reservation_overflow), 1);
  } finally { dropDatabase(db); }
});

test("lifecycle cron is mode-aware and handles activation, expiry, exhaustion, and paused immutability", { skip: !enabled }, () => {
  const db = createDatabase("lifecycle", true);
  try {
    psql(db, lifecycleReadinessStubsSql());
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='paused' where id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'processed';").stdout, "0");
    assert.equal(psql(db, `select status from private.advertising_campaigns where id='${ids.campaign}';`).stdout, "paused");

    psql(db, "set session_replication_role=replica;insert into private.advertising_billing_rate_versions(objective,billable_event_type,placement_code,rate_bdag,currency,scope,state,effective_from,published_at) values('traffic','click','social_feed',0.00010000,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp()),('marketplace_sales','click','social_feed',0.00010000,'BDAG','global','published',clock_timestamp()-interval '1 minute',clock_timestamp());set session_replication_role=origin;");
    psql(db, "select public.set_advertising_launch_mode_v2('PRODUCTION',gen_random_uuid());");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='scheduled' where id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "set plr9.readiness='ready';select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'activated';").stdout, "SET\n1");
    assert.equal(psql(db, `select status from private.advertising_campaigns where id='${ids.campaign}';`).stdout, "active");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='scheduled' where id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "set plr9.readiness='expired';select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'completed';").stdout, "SET\n1");
    assert.equal(psql(db, `select reason_code from private.advertising_campaign_lifecycle_events where campaign_id='${ids.campaign}' and action='complete' order by occurred_at desc limit 1;`).stdout, "campaign_schedule_expired");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='active' where id='${ids.campaign}';update private.advertising_campaign_finance set spent_bdag=funded_bdag where campaign_id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "set plr9.readiness='ready';select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'completed';").stdout, "SET\n1");
    assert.equal(psql(db, `select reason_code from private.advertising_campaign_lifecycle_events where campaign_id='${ids.campaign}' and action='complete' order by occurred_at desc limit 1;`).stdout, "campaign_budget_exhausted");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='active' where id='${ids.campaign}';update private.advertising_campaign_finance set spent_bdag=0 where campaign_id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "set plr9.readiness='expired';select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'completed';").stdout, "SET\n1");
    assert.equal(psql(db, `select reason_code from private.advertising_campaign_lifecycle_events where campaign_id='${ids.campaign}' and action='complete' order by occurred_at desc limit 1;`).stdout, "campaign_schedule_expired");

    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='paused' where id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "set plr9.readiness='expired';select public.reconcile_advertising_campaign_lifecycle(100,clock_timestamp())->>'processed';").stdout, "SET\n0");
    assert.equal(psql(db, `select status from private.advertising_campaigns where id='${ids.campaign}';`).stdout, "paused");
  } finally { dropDatabase(db); }
});

test("settlement reconciler is mode-gated, zero-residual, canonical, and idempotent", { skip: !enabled }, () => {
  const db = createDatabase("settlement", true);
  try {
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='cancelled' where id='${ids.campaign}';update private.advertising_campaign_finance set spent_bdag=funded_bdag where campaign_id='${ids.campaign}';set session_replication_role=origin;`);
    assert.equal(psql(db, "select public.reconcile_advertising_campaign_settlements_v2(100)->>'processed';").stdout, "0");
    assert.equal(psql(db, `select finance_status from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "funded");

    psql(db, "select public.set_advertising_launch_mode_v2('SETTLEMENT_ONLY',gen_random_uuid());");
    assert.equal(psql(db, "select public.reconcile_advertising_campaign_settlements_v2(100)->>'settled';").stdout, "1");
    assert.equal(psql(db, `select finance_status||'|'||released_bdag::text from private.advertising_campaign_finance where campaign_id='${ids.campaign}';`).stdout, "settled|0.00000000");
    assert.equal(psql(db, `select count(*) from private.advertising_financial_settlements where campaign_id='${ids.campaign}';`).stdout, "1");
    assert.equal(psql(db, `select count(*) from private.advertising_financial_events where campaign_id='${ids.campaign}' and event_type='release';`).stdout, "0");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_release';").stdout, "0");
    assert.equal(psql(db, "select public.reconcile_advertising_campaign_settlements_v2(100)->>'settled';").stdout, "0");
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
  } finally { dropDatabase(db); }
});

test("a canonical canary Campaign rate is the sole scope accepted by CANARY_BILLING", { skip: !enabled }, async () => {
  const db = createDatabase("canary_rate", true);
  try {
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
    psql(db, `set session_replication_role=replica;update private.advertising_campaigns set status='paused' where id='${ids.campaign}';set session_replication_role=origin;`);
    const draft = jsonResult(psql(db, asAdmin(ids.superAdmin, `select public.admin_create_advertising_billing_rate_draft_v2('awareness','impression','social_feed','canary_campaign','${ids.campaign}',0.00010000,clock_timestamp()+interval '1 second',gen_random_uuid())::text;`)).stdout);
    psql(db, asAdmin(ids.superAdmin, `select public.admin_publish_advertising_billing_rate_v2('${draft.rate_id}','Disposable exact Campaign canary rate',gen_random_uuid());`));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    psql(db, `select public.set_advertising_launch_mode_v2(
      'CANARY_BILLING',gen_random_uuid(),'20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001','${ids.campaign}','${ids.viewer}',
      'social_feed',clock_timestamp()+interval '30 minutes',0.01000000,1,0.00010000,1
    );`);
    assert.equal(psql(db, "select launch_mode||'|'||canary_enabled::text from private.advertising_canary_policy where singleton;").stdout, "CANARY_BILLING|true");
    assert.equal(psql(db, "select scope||'|'||campaign_id::text from private.advertising_billing_authorization_windows where status='OPEN';").stdout, `canary_campaign|${ids.campaign}`);
    assert.equal(psql(db, "select count(*) from private.advertising_billing_rate_versions where state='published' and scope='canary_campaign';").stdout, "1");
    psql(db, "select public.set_advertising_launch_mode_v2('DISARMED',gen_random_uuid());");
  } finally { dropDatabase(db); }
});

test("representative query plans use bounded/indexed authorities", { skip: !enabled }, () => {
  const db = createDatabase("plans", true);
  try {
    const plans = [
      "select * from private.advertising_billing_rate_versions where objective='awareness' and billable_event_type='impression' and placement_code='social_feed' and scope='global' and state in ('published','retired') and effective_from<=clock_timestamp() order by effective_from desc limit 2",
      `select * from private.advertising_event_billing_materializations where campaign_id='${ids.campaign}' and status='pending' order by created_at,id limit 100`,
      "select * from private.advertising_event_billing_materializations where status='pending' order by created_at,id limit 100",
      "select * from private.advertising_billing_authorization_windows where status='OPEN'",
      "select * from private.advertising_campaign_finance where finance_status='funded' order by updated_at limit 100",
      "select * from private.advertising_campaigns where status in ('scheduled','active') order by updated_at,id limit 100",
    ].map((query) => psql(db, `set enable_seqscan=off; explain (analyze,buffers,format json) ${query};`).stdout);
    for (const plan of plans) {
      assert.ok(plan.length > 20);
      assert.match(plan, /Index|Bitmap|Result|Limit/i);
    }
  } finally {
    dropDatabase(db);
  }
});
