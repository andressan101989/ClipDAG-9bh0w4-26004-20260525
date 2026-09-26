// Disposable PostgreSQL proof only. NELYON_PLR6BC2_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR6BC2_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaigns = Object.fromEntries([
  "fund", "other", "spend", "settle", "zero", "conFund", "conSpend", "diffSpend", "conSettle", "poor", "over",
].map((name, index) => [name, `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));

const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_6b_c2_canary_policy_envelope.sql"));
const c2Migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();

function rawConstant(source, name) {
  const match = source.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;"));
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

const plr2Harness = readFileSync(new URL("./adsV2Plr2FinanceRetryLocal.integration.mjs", import.meta.url), "utf8");
let bootstrap = rawConstant(plr2Harness, "bootstrap")
  .replaceAll("${business}", business)
  .replaceAll("${owner}", owner)
  .replaceAll("${account}", account)
  .replaceAll("${JSON.stringify(campaigns)}", JSON.stringify(campaigns))
  .replaceAll("${campaigns.poor}", campaigns.poor);

bootstrap += `
  create table auth.users(id uuid primary key);
  insert into auth.users values('${owner}'),('${viewer}');
  create table public.marketplace_ad_campaigns(
    id uuid primary key,total_budget_bdag numeric(20,8) not null,
    spent_bdag numeric(20,8) not null default 0,released_bdag numeric(20,8) not null default 0,
    funded_at timestamptz
  );
  create table private.advertising_campaign_lifecycle_policy(
    singleton boolean primary key,
    activation_enabled boolean not null,
    automatic_transitions_enabled boolean not null,
    policy_version text not null default 'nelyon-ads-campaign-lifecycle-v1',
    constraint advertising_campaign_lifecycle_policy_version_chk check(
      policy_version~'^nelyon-ads-campaign-lifecycle-v[0-9]+$'
    ),
    constraint advertising_campaign_lifecycle_policy_v1_safe_chk check(
      policy_version<>'nelyon-ads-campaign-lifecycle-v1'
      or (not activation_enabled and not automatic_transitions_enabled)
    )
  );
  insert into private.advertising_campaign_lifecycle_policy(
    singleton,activation_enabled,automatic_transitions_enabled
  ) values(true,false,false);

  update private.advertising_finance_policy
  set funding_enabled=false,spend_enabled=false,settlement_enabled=false;
  alter table private.advertising_finance_policy alter column policy_version set not null;
  alter table private.advertising_finance_policy
    add constraint advertising_finance_policy_version_chk check(
      policy_version~'^nelyon-ads-finance-v[0-9]+$'
    ),
    add constraint advertising_finance_policy_v1_safe_chk check(
      policy_version<>'nelyon-ads-finance-v1'
      or (
        currency='BDAG' and not funding_enabled and not spend_enabled and not settlement_enabled
        and shared_escrow_account_type='marketplace_ads_escrow'
        and shared_revenue_account_type='marketplace_ads_revenue'
        and spend_requires_billable_event
      )
    );

  alter table private.advertising_delivery_policy
    add column require_authenticated_viewer boolean not null default true,
    add column require_adult_viewer boolean not null default true,
    add column require_approved_ad boolean not null default true;
  alter table private.advertising_delivery_policy alter column policy_version set not null;
  alter table private.advertising_delivery_policy
    add constraint advertising_delivery_policy_version_chk check(
      policy_version~'^nelyon-ads-delivery-v[0-9]+$'
    ),
    add constraint advertising_delivery_policy_v2_fail_closed_chk check(
      policy_version<>'nelyon-ads-delivery-v2'
      or (
        not global_v2_delivery_enabled
        and require_authenticated_viewer and require_adult_viewer and require_approved_ad
        and not geo_matching_enabled and not language_matching_enabled
        and frequency_enforcement_enabled
      )
    );
  insert into private.advertising_placement_catalog(code,v2_delivery_enabled)
  values('clips',false),('live',false),('marketplace_home',false),
    ('marketplace_search',false),('stories',false);
`;

const hMigration = readFileSync(new URL("../supabase/migrations/20260923033100_ads_v2_h_financial_generalization.sql", import.meta.url), "utf8");
const plr2Migration = readFileSync(new URL("../supabase/migrations/20260923223950_ads_v2_plr_2_finance_retry_idempotency_hardening.sql", import.meta.url), "utf8");
const canaryMigration = readFileSync(new URL("../supabase/migrations/20260924215340_ads_v2_plr_6a_canary_safety_envelope.sql", import.meta.url), "utf8");
const c1Migration = readFileSync(new URL("../supabase/migrations/20260926012753_ads_v2_plr_6b_c1_canonical_funding_recovery.sql", import.meta.url), "utf8");
const tableStart = canaryMigration.toLowerCase().indexOf("create table private.advertising_canary_policy");
const lifecycleStart = canaryMigration.toLowerCase().indexOf("create or replace function public.activate_my_advertising_campaign_v2");
const canaryAuthority = canaryMigration.slice(tableStart, lifecycleStart);

function prepareDatabase(database) {
  assert.equal(migrationNames.length, 1);
  run(`create database ${database}`, "postgres");
  run(bootstrap, database);
  run([
    extractFunction(hMigration, "public.fund_my_advertising_campaign_budget_v2("),
    extractFunction(hMigration, "public.spend_advertising_campaign_budget_v2("),
    extractFunction(hMigration, "public.settle_advertising_campaign_budget_v2("),
    extractFunction(hMigration, "public.get_my_advertising_campaign_finance("),
    extractFunction(hMigration, "public.reconcile_advertising_finance("),
  ].join("\n"), database);
  run(plr2Migration, database);
  run(canaryAuthority, database);
  run([
    extractFunction(canaryMigration, "public.fund_my_advertising_campaign_budget_v2("),
    extractFunction(canaryMigration, "public.spend_advertising_campaign_budget_v2("),
    extractFunction(canaryMigration, "public.settle_advertising_campaign_budget_v2("),
  ].join("\n"), database);
  run(c1Migration, database);
  run(c2Migration, database);
}

function dropDatabase(database) {
  run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
}

const arm = `
  update private.advertising_finance_policy
    set funding_enabled=true,spend_enabled=false,settlement_enabled=false where singleton;
  update private.advertising_campaign_lifecycle_policy
    set activation_enabled=true,automatic_transitions_enabled=false where singleton;
  update private.advertising_delivery_policy
    set global_v2_delivery_enabled=true where singleton;
  update private.advertising_placement_catalog
    set v2_delivery_enabled=(code='social_feed');
  update private.advertising_canary_policy set
    canary_enabled=true,business_account_id='${business}',ad_account_id='${account}',
    campaign_id='${campaigns.fund}',viewer_user_id='${viewer}',placement_code='social_feed',
    enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes'
  where singleton;
`;

const disarm = `
  update private.advertising_finance_policy
    set funding_enabled=false,spend_enabled=false,settlement_enabled=false where singleton;
  update private.advertising_campaign_lifecycle_policy
    set activation_enabled=false,automatic_transitions_enabled=false where singleton;
  update private.advertising_delivery_policy
    set global_v2_delivery_enabled=false where singleton;
  update private.advertising_placement_catalog set v2_delivery_enabled=false;
  update private.advertising_canary_policy set
    canary_enabled=false,business_account_id=null,ad_account_id=null,campaign_id=null,
    viewer_user_id=null,placement_code=null,enabled_at=null,expires_at=null
  where singleton;
`;

test("C2 enforces both legal final modes and rejects every forbidden committed envelope", { skip: !enabled, timeout: 180_000 }, () => {
  const database = `plr6bc2_envelope_${process.pid}`;
  prepareDatabase(database);
  try {
    assert.equal(run("select policy_version from private.advertising_finance_policy", database), "nelyon-ads-finance-v2");
    assert.equal(run("select policy_version from private.advertising_campaign_lifecycle_policy", database), "nelyon-ads-campaign-lifecycle-v2");
    assert.equal(run("select policy_version from private.advertising_delivery_policy", database), "nelyon-ads-delivery-v3");
    assert.equal(run("select policy_version from private.advertising_canary_policy", database), "nelyon-ads-canary-v1");
    assert.equal(run("select count(*) from pg_constraint where conname in ('advertising_finance_policy_v1_safe_chk','advertising_campaign_lifecycle_policy_v1_safe_chk','advertising_delivery_policy_v2_fail_closed_chk')", database), "3");
    assert.equal(run("select count(*) from pg_constraint where conname in ('advertising_finance_policy_v2_safe_chk','advertising_campaign_lifecycle_policy_v2_safe_chk','advertising_delivery_policy_v3_safe_chk')", database), "3");
    assert.equal(run("select count(*) from pg_trigger where tgname like 'advertising_canary_launch_envelope_%_guard' and tgenabled<>'D'", database), "5");
    assert.equal(run("select count(*) from pg_trigger where tgname like 'advertising_canary_launch_envelope_%_guard' and tgdeferrable and tginitdeferred", database), "5");
    assert.equal(run("select prosecdef||':'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='private.advertising_assert_canary_launch_envelope()'::regprocedure", database), "false:search_path=\"\"");
    assert.equal(run("select has_function_privilege('public','private.advertising_assert_canary_launch_envelope()','execute')||':'||has_function_privilege('anon','private.advertising_assert_canary_launch_envelope()','execute')||':'||has_function_privilege('authenticated','private.advertising_assert_canary_launch_envelope()','execute')||':'||has_function_privilege('service_role','private.advertising_assert_canary_launch_envelope()','execute')", database), "false:false:false:false");
    assert.equal(run("select has_table_privilege('anon','private.advertising_finance_policy','update')||':'||has_table_privilege('authenticated','private.advertising_finance_policy','update')||':'||has_table_privilege('service_role','private.advertising_finance_policy','update')", database), "false:false:false");

    const atomicArm = run(`begin;${arm}set constraints all immediate;select canary_enabled and funding_enabled and activation_enabled and global_v2_delivery_enabled and (select v2_delivery_enabled from private.advertising_placement_catalog where code='social_feed') from private.advertising_canary_policy cross join private.advertising_finance_policy cross join private.advertising_campaign_lifecycle_policy cross join private.advertising_delivery_policy;rollback;`, database);
    assert.equal(atomicArm, "t");

    const atomicDisarm = run(`begin;${arm}set constraints all immediate;set constraints all deferred;${disarm}set constraints all immediate;select not canary_enabled and not funding_enabled and not activation_enabled and not global_v2_delivery_enabled and not exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled) from private.advertising_canary_policy cross join private.advertising_finance_policy cross join private.advertising_campaign_lifecycle_policy cross join private.advertising_delivery_policy;rollback;`, database);
    assert.equal(atomicDisarm, "t");

    const rejects = [
      ["canary false + Funding", "update private.advertising_finance_policy set funding_enabled=true where singleton;"],
      ["canary false + Activation", "update private.advertising_campaign_lifecycle_policy set activation_enabled=true where singleton;"],
      ["canary false + Global", "update private.advertising_delivery_policy set global_v2_delivery_enabled=true where singleton;"],
      ["canary false + social_feed", "update private.advertising_placement_catalog set v2_delivery_enabled=true where code='social_feed';"],
      ["armed missing Funding", `${arm}update private.advertising_finance_policy set funding_enabled=false where singleton;`],
      ["armed missing Activation", `${arm}update private.advertising_campaign_lifecycle_policy set activation_enabled=false where singleton;`],
      ["armed missing Global", `${arm}update private.advertising_delivery_policy set global_v2_delivery_enabled=false where singleton;`],
      ["armed missing social_feed", `${arm}update private.advertising_placement_catalog set v2_delivery_enabled=false where code='social_feed';`],
      ["armed wrong placement", `${arm}update private.advertising_placement_catalog set v2_delivery_enabled=true where code='stories';`],
      ["armed Spend TRUE", `${arm}update private.advertising_finance_policy set spend_enabled=true where singleton;`],
      ["armed Automatic TRUE", `${arm}update private.advertising_campaign_lifecycle_policy set automatic_transitions_enabled=true where singleton;`],
      ["armed Settlement TRUE", `${arm}update private.advertising_finance_policy set settlement_enabled=true where singleton;`],
      ["partial DISARM", `${arm}set constraints all immediate;set constraints all deferred;${disarm}update private.advertising_finance_policy set funding_enabled=true where singleton;`],
    ];
    for (const [name, setup] of rejects) {
      assert.throws(
        () => run(`begin;${setup}commit;`, database),
        /advertising_(?:canary_launch_envelope_violation|finance_policy_v2_safe_chk|campaign_lifecycle_policy_v2_safe_chk)/i,
        name,
      );
    }

    assert.throws(() => run("update private.advertising_finance_policy set currency='USD' where singleton", database), /advertising_finance_policy_v2_safe_chk/i);
    assert.throws(() => run("update private.advertising_delivery_policy set require_authenticated_viewer=false where singleton", database), /advertising_delivery_policy_v3_safe_chk/i);
  } finally {
    dropDatabase(database);
  }
});

test("C2 permits canonical recovery to open Settlement only transiently and rolls back every fixture", { skip: !enabled, timeout: 180_000 }, () => {
  const database = `plr6bc2_recovery_${process.pid}`;
  prepareDatabase(database);
  try {
    const settleKey = "93000000-0000-4000-8000-000000000071";
    const output = run(`
      begin;
      update private.advertising_campaign_finance set budget_bdag=0.01 where campaign_id='${campaigns.fund}';
      ${arm}
      set local request.jwt.claim.sub='${owner}';
      select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','93000000-0000-4000-8000-000000000070');
      update private.advertising_finance_policy set settlement_enabled=true where singleton;
      select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}');
      ${disarm}
      set constraints all immediate;
      select pg_catalog.jsonb_build_object(
        'finance',private.advertising_campaign_finance_result('${campaigns.fund}'),
        'source_balance',(select balance from public.ledger_accounts where owner_id='${owner}'),
        'escrow_balance',(select balance from public.ledger_accounts where account_type='marketplace_ads_escrow'),
        'release_events',(select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}' and event_type='release'),
        'settlements',(select count(*) from private.advertising_financial_settlements where campaign_id='${campaigns.fund}'),
        'settlement_enabled',(select settlement_enabled from private.advertising_finance_policy),
        'reconciliation',public.reconcile_advertising_finance()
      );
      select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}');
      select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}' and event_type='release';
      rollback;
    `, database).split("\n");
    const proof = JSON.parse(output.find((line) => line.includes('"finance"')));
    assert.equal(proof.finance.finance_status, "settled");
    assert.equal(proof.finance.funded_bdag, 0.01);
    assert.equal(proof.finance.spent_bdag, 0);
    assert.equal(proof.finance.released_bdag, 0.01);
    assert.equal(proof.source_balance, 10000);
    assert.equal(proof.escrow_balance, 0);
    assert.equal(proof.release_events, 1);
    assert.equal(proof.settlements, 1);
    assert.equal(proof.settlement_enabled, false);
    assert.ok(Object.values(proof.reconciliation).every((value) => Number(value) === 0));
    assert.equal(output.at(-1), "1");
    assert.equal(run(`select finance_status||':'||funded_bdag||':'||released_bdag from private.advertising_campaign_finance where campaign_id='${campaigns.fund}'`, database), "draft:0.00000000:0.00000000");
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}'`, database), "0");
    assert.equal(run(`select balance from public.ledger_accounts where owner_id='${owner}'`, database), "10000.00000000");
  } finally {
    dropDatabase(database);
  }
});
