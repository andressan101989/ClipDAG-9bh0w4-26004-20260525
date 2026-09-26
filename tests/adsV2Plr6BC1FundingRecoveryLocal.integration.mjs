// Disposable PostgreSQL proof only. NELYON_PLR6BC1_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR6BC1_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr6bc1_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaigns = Object.fromEntries([
  "fund", "other", "spend", "settle", "zero", "conFund", "conSpend", "diffSpend", "conSettle", "poor", "over",
].map((name, index) => [name, `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();

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
    singleton boolean primary key, activation_enabled boolean not null, automatic_transitions_enabled boolean not null
  );
  insert into private.advertising_campaign_lifecycle_policy values(true,false,false);
`;

const hMigration = readFileSync(new URL("../supabase/migrations/20260923033100_ads_v2_h_financial_generalization.sql", import.meta.url), "utf8");
const plr2Migration = readFileSync(new URL("../supabase/migrations/20260923223950_ads_v2_plr_2_finance_retry_idempotency_hardening.sql", import.meta.url), "utf8");
const canaryMigration = readFileSync(new URL("../supabase/migrations/20260924215340_ads_v2_plr_6a_canary_safety_envelope.sql", import.meta.url), "utf8");
const tableStart = canaryMigration.toLowerCase().indexOf("create table private.advertising_canary_policy");
const lifecycleStart = canaryMigration.toLowerCase().indexOf("create or replace function public.activate_my_advertising_campaign_v2");
const canaryAuthority = canaryMigration.slice(tableStart, lifecycleStart);
const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_6b_c1_canonical_funding_recovery.sql"));
const c1Migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";

function projection(setup, campaign = campaigns.fund) {
  return JSON.parse(run(`
    begin;
    set local request.jwt.claim.sub='${owner}';
    ${setup}
    select public.get_my_advertising_campaign_finance('${campaign}');
    rollback;
  `).split("\n")[0]);
}

test("C1 projects funding capability from authoritative policy and canary state", { skip: !enabled, timeout: 180_000 }, () => {
  assert.equal(migrationNames.length, 1);
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run([
      extractFunction(hMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.settle_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.get_my_advertising_campaign_finance("),
      extractFunction(hMigration, "public.reconcile_advertising_finance("),
    ].join("\n"));
    run(plr2Migration);
    run(canaryAuthority);
    run([
      extractFunction(canaryMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.settle_advertising_campaign_budget_v2("),
    ].join("\n"));
    run(c1Migration);

    let value = projection(`update private.advertising_campaign_finance set budget_bdag=0.01 where campaign_id='${campaigns.fund}'; update private.advertising_finance_policy set funding_enabled=false where singleton;`);
    assert.equal(value.funding_available, false);
    assert.equal(value.funding_state, "platform_disabled");

    value = projection(`update private.advertising_campaign_finance set budget_bdag=0.01 where campaign_id='${campaigns.fund}'; update private.advertising_finance_policy set funding_enabled=true where singleton;`);
    assert.equal(value.funding_available, true);
    assert.equal(value.funding_state, "available");

    const armed = `
      update private.advertising_campaign_finance set budget_bdag=0.01;
      update private.advertising_finance_policy set funding_enabled=true where singleton;
      update private.advertising_canary_policy set canary_enabled=true,business_account_id='${business}',ad_account_id='${account}',campaign_id='${campaigns.fund}',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton;
    `;
    value = projection(armed);
    assert.equal(value.funding_available, true);
    assert.equal(value.funding_state, "available");
    value = projection(armed, campaigns.other);
    assert.equal(value.funding_available, false);
    assert.equal(value.funding_state, "campaign_restricted");
    value = projection(`${armed} update private.advertising_canary_policy set enabled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where singleton;`);
    assert.equal(value.funding_state, "campaign_restricted");
    value = projection(`${armed} update private.advertising_campaign_finance set budget_bdag=0.02 where campaign_id='${campaigns.fund}';`);
    assert.equal(value.funding_state, "campaign_restricted");
    value = projection(`${armed} update private.advertising_campaign_finance set finance_status='funded',funded_bdag=budget_bdag where campaign_id='${campaigns.fund}';`);
    assert.equal(value.funding_available, false);
    assert.equal(value.funding_state, "already_funded");

    assert.equal(run("select has_function_privilege('anon','public.settle_advertising_campaign_budget_v2(uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.settle_advertising_campaign_budget_v2(uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('public','public.settle_advertising_campaign_budget_v2(uuid,uuid)','execute')"), "f");
    assert.equal(run("select has_function_privilege('service_role','public.settle_advertising_campaign_budget_v2(uuid,uuid)','execute')"), "t");
    assert.equal(run("select to_regprocedure('public.settle_advertising_campaign_budget_v2(uuid,uuid,numeric)') is null"), "t");
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});

test("C1 recovery reuses canonical settlement atomically and rolls every fixture back", { skip: !enabled, timeout: 180_000 }, () => {
  assert.equal(migrationNames.length, 1);
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run([
      extractFunction(hMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.settle_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.get_my_advertising_campaign_finance("),
      extractFunction(hMigration, "public.reconcile_advertising_finance("),
    ].join("\n"));
    run(plr2Migration);
    run(canaryAuthority);
    run([
      extractFunction(canaryMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.settle_advertising_campaign_budget_v2("),
    ].join("\n"));
    run(c1Migration);

    const settleKey = "93000000-0000-4000-8000-000000000051";
    const resultLines = run(`
      begin;
      update private.advertising_campaign_finance set budget_bdag=0.01 where campaign_id='${campaigns.fund}';
      update private.advertising_finance_policy set funding_enabled=true,spend_enabled=false,settlement_enabled=false where singleton;
      update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=false where singleton;
      update private.advertising_delivery_policy set global_v2_delivery_enabled=true where singleton;
      update private.advertising_placement_catalog set v2_delivery_enabled=(code='social_feed');
      update private.advertising_canary_policy set canary_enabled=true,business_account_id='${business}',ad_account_id='${account}',campaign_id='${campaigns.fund}',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton;
      set local request.jwt.claim.sub='${owner}';
      select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','93000000-0000-4000-8000-000000000050');
      select 1 from private.advertising_canary_policy where singleton for update;
      update private.advertising_finance_policy set settlement_enabled=true where singleton;
      select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}');
      update private.advertising_finance_policy set funding_enabled=false,spend_enabled=false,settlement_enabled=false where singleton;
      update private.advertising_campaign_lifecycle_policy set activation_enabled=false,automatic_transitions_enabled=false where singleton;
      update private.advertising_delivery_policy set global_v2_delivery_enabled=false where singleton;
      update private.advertising_placement_catalog set v2_delivery_enabled=false;
      update private.advertising_canary_policy set canary_enabled=false,business_account_id=null,ad_account_id=null,campaign_id=null,viewer_user_id=null,placement_code=null,enabled_at=null,expires_at=null where singleton;
      select pg_catalog.jsonb_build_object(
        'finance',(select private.advertising_campaign_finance_result('${campaigns.fund}')),
        'source_balance',(select balance from public.ledger_accounts where owner_id='${owner}'),
        'escrow_balance',(select balance from public.ledger_accounts where account_type='marketplace_ads_escrow'),
        'release_events',(select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}' and event_type='release'),
        'settlements',(select count(*) from private.advertising_financial_settlements where campaign_id='${campaigns.fund}'),
        'finance_policy',(select to_jsonb(p) from private.advertising_finance_policy p),
        'lifecycle_policy',(select to_jsonb(p) from private.advertising_campaign_lifecycle_policy p),
        'delivery_policy',(select to_jsonb(p) from private.advertising_delivery_policy p),
        'enabled_placements',(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled),
        'canary_enabled',(select canary_enabled from private.advertising_canary_policy),
        'reconciliation',public.reconcile_advertising_finance()
      );
      select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}');
      select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}' and event_type='release';
      rollback;
    `).split("\n");
    const proof = JSON.parse(resultLines.find((line) => line.includes('"finance"')));
    assert.equal(proof.finance.finance_status, "settled");
    assert.equal(proof.finance.funded_bdag, 0.01);
    assert.equal(proof.finance.spent_bdag, 0);
    assert.equal(proof.finance.released_bdag, 0.01);
    assert.equal(proof.source_balance, 10000);
    assert.equal(proof.escrow_balance, 0);
    assert.equal(proof.release_events, 1);
    assert.equal(proof.settlements, 1);
    assert.equal(proof.finance_policy.funding_enabled, false);
    assert.equal(proof.finance_policy.spend_enabled, false);
    assert.equal(proof.finance_policy.settlement_enabled, false);
    assert.equal(proof.lifecycle_policy.activation_enabled, false);
    assert.equal(proof.lifecycle_policy.automatic_transitions_enabled, false);
    assert.equal(proof.delivery_policy.global_v2_delivery_enabled, false);
    assert.equal(proof.enabled_placements, 0);
    assert.equal(proof.canary_enabled, false);
    assert.ok(Object.values(proof.reconciliation).every((value) => Number(value) === 0));
    assert.equal(resultLines.at(-1), "1");
    assert.equal(run(`select finance_status||':'||funded_bdag||':'||released_bdag from private.advertising_campaign_finance where campaign_id='${campaigns.fund}'`), "draft:0.00000000:0.00000000");
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}'`), "0");

    assert.throws(() => run(`begin;set local session authorization authenticated;set local request.jwt.claim.role='authenticated';select public.settle_advertising_campaign_budget_v2('${campaigns.fund}',gen_random_uuid());rollback;`), /permission denied|advertising_finance_internal_only/i);
    assert.throws(() => run(`begin;set local session authorization anon;set local request.jwt.claim.role='anon';select public.settle_advertising_campaign_budget_v2('${campaigns.fund}',gen_random_uuid());rollback;`), /permission denied|advertising_finance_internal_only/i);
    assert.throws(() => run(`begin;update private.advertising_campaign_finance set finance_status='funded',funded_bdag=0.01,budget_bdag=0.01 where campaign_id='${campaigns.fund}';update private.advertising_finance_policy set settlement_enabled=false where singleton;select public.settle_advertising_campaign_budget_v2('${campaigns.fund}',gen_random_uuid());rollback;`), /advertising_finance_settlement_disabled/);
    assert.throws(() => run(`begin;update private.advertising_campaign_finance set finance_status='funded',funded_bdag=0.01,budget_bdag=0.01 where campaign_id='${campaigns.fund}';update private.advertising_finance_policy set settlement_enabled=true where singleton;update private.advertising_canary_policy set canary_enabled=true,business_account_id='${business}',ad_account_id='${account}',campaign_id='${campaigns.other}',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton;select public.settle_advertising_campaign_budget_v2('${campaigns.fund}',gen_random_uuid());rollback;`), /advertising_canary_settlement_denied/);
    assert.throws(() => run(`begin;update private.advertising_campaign_finance set finance_status='funded',funded_bdag=0.01,spent_bdag=0.02,budget_bdag=0.01 where campaign_id='${campaigns.fund}';update private.advertising_finance_policy set settlement_enabled=true where singleton;select public.settle_advertising_campaign_budget_v2('${campaigns.fund}',gen_random_uuid());rollback;`), /advertising_campaign_finance_equation_invalid/);

    const spentProof = JSON.parse(run(`
      begin;
      update private.advertising_campaign_finance set budget_bdag=100 where campaign_id='${campaigns.spend}';
      set local request.jwt.claim.sub='${owner}';
      select public.fund_my_advertising_campaign_budget_v2('${campaigns.spend}','93000000-0000-4000-8000-000000000060');
      insert into private.advertising_events(id,campaign_id,event_type) values('94000000-0000-4000-8000-000000000060','${campaigns.spend}','impression');
      set local request.jwt.claim.role='service_role';
      select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','94000000-0000-4000-8000-000000000060',40,'93000000-0000-4000-8000-000000000061');
      reset request.jwt.claim.role;
      select public.settle_advertising_campaign_budget_v2('${campaigns.spend}','93000000-0000-4000-8000-000000000062');
      select pg_catalog.jsonb_build_object('finance',private.advertising_campaign_finance_result('${campaigns.spend}'),'source_balance',(select balance from public.ledger_accounts where owner_id='${owner}'));
      rollback;
    `).split("\n").find((line) => line.includes('"finance"')));
    assert.equal(spentProof.finance.spent_bdag, 40);
    assert.equal(spentProof.finance.released_bdag, 60);
    assert.equal(spentProof.source_balance, 9960);
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
