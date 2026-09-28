// Real disposable PostgreSQL proof. Set NELYON_PLR12_LOCAL=1 to enable it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.NELYON_PLR12_LOCAL === "1";
const container = process.env.NELYON_PLR12_CONTAINER ?? "nelyon-ads-v2-d-compile";
const template = process.env.NELYON_PLR12_TEMPLATE ?? "plr9_production_clone2";
const user = "supabase_admin";
const owner = "10000000-0000-4000-8000-000000000001";
const campaign = "40000000-0000-4000-8000-000000000001";

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
];
const fixture = readFileSync(new URL("./fixtures/adsV2Plr9DisposableBillingFixture.sql", import.meta.url), "utf8");
const campaignFixture = `${fixture.split("update private.advertising_finance_policy")[0]}set session_replication_role=origin;`;

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
function psql(db, sql, options = {}) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At"], { input: sql, ...options });
}
function createDatabase() {
  const db = `plr12_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  docker(["exec", container, "createdb", "-U", user, "-T", template, db]);
  psql(db, `insert into private.advertising_targeting_policy(singleton,policy_version) values(true,'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(singleton,minimum_age,policy_version,creator_exclusive_minimum_age) values(true,13,'nelyon-age-v2',18);`);
  for (const suffix of prerequisites) psql(db, migration(suffix));
  psql(db, migration("_ads_v2_plr_12_production_pricing_v1.sql"));
  return db;
}
function dropDatabase(db) {
  docker(["exec", container, "dropdb", "-U", user, "--force", "--if-exists", db], { allowFailure: true });
}
function authSql(actor, sql) {
  return `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
}
function eventSql({ id, eventType, parentImpressionId = null }) {
  return `insert into private.advertising_events(
      id,event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
      audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
      parent_impression_event_id,context_fingerprint,occurred_at
    ) values (
      '${id}',gen_random_uuid(),'${eventType}','80000000-0000-4000-8000-000000000001',
      '${campaign}','50000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001','social_feed','${owner}',
      ${parentImpressionId ? `'${parentImpressionId}'` : "null"},repeat('e',64),clock_timestamp()
    );`;
}

test("Pricing V1 publishes the exact 54-row global matrix and one system audit", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    assert.equal(psql(db, "select count(*) from private.advertising_billing_rate_versions;").stdout, "54");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_rate_versions where state='published' and scope='global' and scope_campaign_id is null and currency='BDAG';").stdout, "54");
    assert.equal(psql(db, "select count(*) from private.advertising_billing_rate_versions where scope='canary_campaign' or objective='website_conversions';").stdout, "0");
    assert.equal(psql(db, "select count(distinct effective_from) from private.advertising_billing_rate_versions;").stdout, "1");
    assert.equal(psql(db, "select string_agg(objective||':'||billable_event_type||':'||rate_bdag,',' order by objective) from (select distinct objective,billable_event_type,rate_bdag from private.advertising_billing_rate_versions) rates;").stdout,
      "app_promotion:click:50.00000000,awareness:impression:0.30000000,engagement:click:36.00000000,marketplace_sales:click:45.00000000,messages:click:50.00000000,profile_visits:click:40.00000000,reach:impression:0.30000000,traffic:click:36.00000000,video_views:impression:0.36000000");
    assert.equal(psql(db, "select count(*)||'|'||min(actor_kind)||'|'||bool_and(actor_id is null)::text||'|'||bool_and(financial_effect)::text from private.admin_action_audit where action='advertising.pricing_v1.bootstrap';").stdout, "1|system_workflow|true|true");
  } finally { dropDatabase(db); }
});

test("every objective-placement pair resolves prospectively without ambiguity", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    psql(db, campaignFixture);
    let resolved = 0;
    for (const objective of ["awareness", "reach", "video_views", "traffic", "engagement", "profile_visits", "messages", "app_promotion", "marketplace_sales"]) {
      psql(db, `set session_replication_role=replica;update private.advertising_campaigns set objective='${objective}' where id='${campaign}';set session_replication_role=origin;`);
      resolved += Number(psql(db, `select count(*) from private.advertising_billing_rate_versions rate
        where rate.objective='${objective}' and (private.resolve_advertising_billing_rate_v2('${campaign}',rate.billable_event_type,rate.placement_code,rate.effective_from,'PRODUCTION')).id=rate.id;`).stdout);
      assert.equal(psql(db, `select count(*) from private.advertising_billing_rate_versions rate
        where rate.objective='${objective}' and private.resolve_advertising_billing_rate_v2('${campaign}',rate.billable_event_type,rate.placement_code,rate.effective_from-interval '1 microsecond','PRODUCTION') is not null;`).stdout, "0");
    }
    assert.equal(resolved, 54);
    assert.equal(psql(db, "select string_agg(code||':'||(private.advertising_rate_coverage_at('PRODUCTION',null,code,(select min(effective_from) from private.advertising_billing_rate_versions),null)->>'covered_count'),',' order by code) from private.advertising_placement_catalog;").stdout,
      "clips:9,live:9,marketplace_home:9,marketplace_search:9,social_feed:9,stories:9");
  } finally { dropDatabase(db); }
});

test("Business and Admin projections report canonical selected-placement and 54/54 coverage", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    psql(db, "set session_replication_role=replica;update private.advertising_billing_rate_versions set effective_from=clock_timestamp()-interval '1 minute';set session_replication_role=origin;");
    psql(db, campaignFixture);
    psql(db, `set session_replication_role=replica;
      insert into private.advertising_placement_selection_items(placement_selection_version_id,placement_code)
      values('84000000-0000-4000-8000-000000000001','clips');
      set session_replication_role=origin;`);
    const billing = JSON.parse(psql(db, authSql(owner, `select public.get_my_advertising_campaign_billing_v2('${campaign}')::text;`)).stdout.split(/\r?\n/).at(-1));
    assert.equal(billing.rate_status, "available");
    assert.deepEqual(billing.placement_rates.map((row) => row.placement_code), ["clips", "social_feed"]);
    assert.deepEqual(billing.placement_rates.map((row) => row.rate_bdag), [0.3, 0.3]);
    assert.equal(billing.selected_placement_count, 2);
    assert.equal(billing.covered_placement_count, 2);

    const admin = JSON.parse(psql(db, "select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',false);select public.get_admin_advertising_billing_health()::text;").stdout.split(/\r?\n/).at(-1));
    assert.equal(admin.production_rate_coverage_ready, true);
    assert.equal(admin.production_rate_coverage.required_count, 54);
    assert.equal(admin.production_rate_coverage.covered_count, 54);
    assert.equal(admin.production_rate_coverage_by_placement.length, 6);
    assert.equal(admin.production_rate_coverage_by_placement.every((row) => row.required_count === 9 && row.covered_count === 9 && row.ready), true);
  } finally { dropDatabase(db); }
});

test("canonical materialization charges exact representative Pricing V1 units and never partially charges exhaustion", { skip: !enabled }, () => {
  const db = createDatabase();
  try {
    psql(db, campaignFixture);
    psql(db, `set session_replication_role=replica;
      update private.advertising_billing_rate_versions
      set effective_from=clock_timestamp()-interval '1 minute';
      update private.advertising_campaign_finance
      set budget_bdag=200.00000000,funded_bdag=200.00000000,spent_bdag=0,released_bdag=0
      where campaign_id='${campaign}';
      update public.ledger_accounts set balance=200.00000000 where account_type='marketplace_ads_escrow';
      update public.ledger_accounts set balance=0 where account_type='marketplace_ads_revenue';
      update private.advertising_finance_policy set funding_enabled=true,spend_enabled=true,settlement_enabled=true;
      update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=true;
      update private.advertising_delivery_policy set global_v2_delivery_enabled=true;
      update private.advertising_placement_catalog set v2_delivery_enabled=(code='social_feed');
      update private.advertising_canary_policy set launch_mode='PRODUCTION',canary_enabled=false,
        business_account_id=null,ad_account_id=null,campaign_id=null,viewer_user_id=null,placement_code=null,
        enabled_at=null,expires_at=null,max_budget_bdag=null,max_impressions=null,max_spend_bdag=null,max_billable_events=null;
      insert into private.advertising_billing_authorization_windows(id,mode,scope,opened_at,status)
      values('b1200000-0000-4000-8000-000000000001','PRODUCTION','global',clock_timestamp()-interval '1 minute','OPEN');
      set session_replication_role=origin;
      grant select,update on private.advertising_billing_authorization_windows to postgres;
      grant select on private.advertising_billing_rate_versions to postgres;
      grant select,update on private.advertising_event_billing_materializations to postgres;
      grant execute on function private.advertising_canary_spend_allowed(uuid,timestamptz) to postgres;
      grant execute on function private.advertising_campaign_billing_readiness_at(uuid,text,timestamptz) to postgres;`);

    const charge = (objective, eventType, id, expectedRate, parentImpressionId = null) => {
      psql(db, `set session_replication_role=replica;update private.advertising_campaigns set objective='${objective}' where id='${campaign}';set session_replication_role=origin;`);
      if (parentImpressionId) {
        psql(db, eventSql({ id: parentImpressionId, eventType: "impression" }));
      }
      psql(db, eventSql({ id, eventType, parentImpressionId }));
      assert.equal(
        psql(db, `select status||'|'||amount_bdag from private.advertising_event_billing_materializations where billable_event_id='${id}';`).stdout,
        `pending|${expectedRate}`,
      );
      assert.equal(psql(db, "select public.reconcile_advertising_billable_events_v2(100)->>'charged';").stdout, "1");
      assert.equal(
        psql(db, `select status||'|'||amount_bdag from private.advertising_event_billing_materializations where billable_event_id='${id}';`).stdout,
        `charged|${expectedRate}`,
      );
    };

    charge("awareness", "impression", "c1200000-0000-4000-8000-000000000001", "0.30000000");
    charge("video_views", "impression", "c1200000-0000-4000-8000-000000000002", "0.36000000");
    charge("traffic", "click", "c1200000-0000-4000-8000-000000000004", "36.00000000", "c1200000-0000-4000-8000-000000000003");
    charge("messages", "click", "c1200000-0000-4000-8000-000000000006", "50.00000000", "c1200000-0000-4000-8000-000000000005");
    charge("marketplace_sales", "click", "c1200000-0000-4000-8000-000000000008", "45.00000000", "c1200000-0000-4000-8000-000000000007");

    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${campaign}';`).stdout, "131.66000000");
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "5");
    assert.equal(psql(db, "select count(*) from public.ledger_entries where txn_id in (select id from public.financial_transactions where operation_type='advertising_campaign_spend');").stdout, "10");
    assert.equal(psql(db, "select count(*) from private.advertising_financial_events where event_type='spend' and billing_rate_version_id is not null;").stdout, "5");

    psql(db, `set session_replication_role=replica;
      update private.advertising_campaigns set objective='traffic' where id='${campaign}';
      update private.advertising_campaign_finance
      set budget_bdag=spent_bdag+35.00000000,funded_bdag=spent_bdag+35.00000000
      where campaign_id='${campaign}';
      set session_replication_role=origin;`);
    psql(db, eventSql({ id: "c1200000-0000-4000-8000-000000000009", eventType: "impression" }));
    psql(db, eventSql({
      id: "c1200000-0000-4000-8000-000000000010",
      eventType: "click",
      parentImpressionId: "c1200000-0000-4000-8000-000000000009",
    }));
    assert.equal(
      psql(db, "select status||'|'||amount_bdag from private.advertising_event_billing_materializations where billable_event_id='c1200000-0000-4000-8000-000000000010';").stdout,
      "budget_exhausted|0.00000000",
    );
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='advertising_campaign_spend';").stdout, "5");
    assert.equal(psql(db, `select spent_bdag from private.advertising_campaign_finance where campaign_id='${campaign}';`).stdout, "131.66000000");
  } finally { dropDatabase(db); }
});
