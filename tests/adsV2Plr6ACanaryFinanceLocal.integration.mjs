// Disposable PostgreSQL proof only. NELYON_PLR6A_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR6A_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr6afin_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaigns = Object.fromEntries([
  "fund", "other", "spend", "settle", "zero", "conFund", "conSpend", "diffSpend", "conSettle", "poor", "over",
].map((name, index) => [name, `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const asOwner = (sql) => run(`begin;set local request.jwt.claim.sub='${owner}';${sql};commit;`);
const asService = (sql) => run(`begin;set local request.jwt.claim.role='service_role';${sql};commit;`);

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
bootstrap += `create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${viewer}');`;

const hMigration = readFileSync(new URL("../supabase/migrations/20260923033100_ads_v2_h_financial_generalization.sql", import.meta.url), "utf8");
const plr2Migration = readFileSync(new URL("../supabase/migrations/20260923223950_ads_v2_plr_2_finance_retry_idempotency_hardening.sql", import.meta.url), "utf8");
const canaryMigration = readFileSync(new URL("../supabase/migrations/20260924215340_ads_v2_plr_6a_canary_safety_envelope.sql", import.meta.url), "utf8");
const tableStart = canaryMigration.toLowerCase().indexOf("create table private.advertising_canary_policy");
const lifecycleStart = canaryMigration.toLowerCase().indexOf("create or replace function public.activate_my_advertising_campaign_v2");
const canaryAuthority = canaryMigration.slice(tableStart, lifecycleStart);

test("PLR-6A caps funding, hard-denies spend and permits release after expiry", { skip: !enabled, timeout: 180_000 }, () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run([
      extractFunction(hMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(hMigration, "public.settle_advertising_campaign_budget_v2("),
    ].join("\n"));
    run(plr2Migration);
    run(canaryAuthority);
    run([
      extractFunction(canaryMigration, "public.fund_my_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.spend_advertising_campaign_budget_v2("),
      extractFunction(canaryMigration, "public.settle_advertising_campaign_budget_v2("),
    ].join("\n"));

    run(`update private.advertising_campaign_finance set budget_bdag=0.01000000 where campaign_id='${campaigns.fund}';update private.advertising_canary_policy set canary_enabled=true,business_account_id='${business}',ad_account_id='${account}',campaign_id='${campaigns.fund}',viewer_user_id='${viewer}',placement_code='social_feed',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton`);
    const userBefore = run(`select balance from public.ledger_accounts where owner_id='${owner}'`);
    const fundKey = "93000000-0000-4000-8000-000000000001";
    assert.match(asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${fundKey}')`), /"finance_status": "funded"/);
    assert.equal(run(`select count(*) from public.financial_transactions where reference_id='${campaigns.fund}'`), "1");

    run("update private.advertising_canary_policy set enabled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where singleton");
    assert.match(asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${fundKey}')`), /"finance_status": "funded"/);
    run(`update private.advertising_campaign_finance set budget_bdag=0.01000000 where campaign_id='${campaigns.other}';update private.advertising_canary_policy set campaign_id='${campaigns.other}' where singleton`);
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.other}','93000000-0000-4000-8000-000000000002')`), /advertising_canary_funding_denied/);

    run(`update private.advertising_campaign_finance set budget_bdag=0.02000000 where campaign_id='${campaigns.over}';update private.advertising_canary_policy set campaign_id='${campaigns.over}',enabled_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where singleton`);
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.over}','93000000-0000-4000-8000-000000000003')`), /advertising_canary_funding_denied/);

    run(`update private.advertising_canary_policy set campaign_id='${campaigns.fund}' where singleton;insert into private.advertising_events(id,campaign_id,event_type) values('94000000-0000-4000-8000-000000000001','${campaigns.fund}','impression')`);
    assert.throws(() => asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.fund}','94000000-0000-4000-8000-000000000001',0.00100000,'93000000-0000-4000-8000-000000000004')`), /advertising_canary_spend_disabled/);

    run("update private.advertising_canary_policy set enabled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where singleton");
    const settleKey = "93000000-0000-4000-8000-000000000005";
    assert.match(asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}')`), /"finance_status": "settled"/);
    assert.match(asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.fund}','${settleKey}')`), /"finance_status": "settled"/);
    assert.equal(run(`select count(*) from public.financial_transactions where reference_id='${campaigns.fund}'`), "2");
    assert.equal(run(`select count(*) from public.ledger_entries entry join public.financial_transactions txn on txn.id=entry.txn_id where txn.reference_id='${campaigns.fund}'`), "4");
    assert.equal(run(`select balance from public.ledger_accounts where owner_id='${owner}'`), userBefore);
    assert.equal(run(`select funded_bdag-spent_bdag-released_bdag from private.advertising_campaign_finance where campaign_id='${campaigns.fund}'`), "0.00000000");
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
