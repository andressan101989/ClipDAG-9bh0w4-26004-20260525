// Runs only in a disposable database inside the local compile container.
// NELYON_PLR2_LOCAL=1 enables the real money-lifecycle and concurrency proof.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const enabled = process.env.NELYON_PLR2_LOCAL === '1';
const container = 'nelyon-ads-v2-d-compile';
const database = `plr2_${process.pid}`;
const owner = '10000000-0000-4000-8000-000000000001';
const intruder = '10000000-0000-4000-8000-000000000002';
const business = '20000000-0000-4000-8000-000000000001';
const account = '30000000-0000-4000-8000-000000000001';
const campaigns = Object.fromEntries([
  'fund', 'other', 'spend', 'settle', 'zero', 'conFund', 'conSpend', 'diffSpend', 'conSettle', 'poor', 'over',
].map((name, index) => [name, `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const events = Object.fromEntries([
  'spend', 'spendOther', 'settle', 'zero', 'conSpend', 'diffSpend', 'over',
].map((name, index) => [name, `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const keys = Object.fromEntries([
  'fund', 'otherFund', 'spendFund', 'spend', 'settleFund', 'settleSpend', 'settle',
  'zeroFund', 'zeroSpend', 'zeroSettle', 'conFund', 'conSpendFund', 'conSpend',
  'diffSpendFund', 'diffSpendA', 'diffSpendB', 'conSettleFund', 'conSettle',
  'poorFund', 'overFund', 'overSpend',
].map((name, index) => [name, `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));

const psqlArgs = (db, ...extra) => ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, ...extra];
const run = (sql, db = database) => execFileSync('docker', psqlArgs(db, '-At'), { input: sql, encoding: 'utf8' }).trim();
const runAsync = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', psqlArgs(database, '-At'));
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  child.stdin.end(sql);
});
const migration = (path) => fs.readFileSync(path, 'utf8');
const extractFunction = (source, name) => {
  const start = source.toLowerCase().indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} missing from source migration`);
  const end = source.indexOf('$$;', start);
  assert.ok(end > start, `${name} terminator missing`);
  return source.slice(start, end + 3);
};
const asOwner = (sql, actor = owner) => run(`begin; set local request.jwt.claim.sub='${actor}'; ${sql}; commit;`);
const asService = (sql) => run(`begin; set local request.jwt.claim.role='service_role'; ${sql}; commit;`);
const asOwnerAsync = (sql, actor = owner) => runAsync(`begin; set local request.jwt.claim.sub='${actor}'; ${sql}; commit;`);
const asServiceAsync = (sql) => runAsync(`begin; set local request.jwt.claim.role='service_role'; ${sql}; commit;`);

const bootstrap = `
  create extension if not exists pgcrypto;
  create schema auth;
  create schema private;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role',true),'')
  $$;

  create table private.business_accounts(id uuid primary key,owner_user_id uuid not null,status text not null);
  create table private.ad_accounts(id uuid primary key,business_account_id uuid not null,status text not null);
  create table private.advertising_campaigns(id uuid primary key,ad_account_id uuid not null,status text not null);
  create table private.advertising_finance_policy(
    singleton boolean primary key,policy_version text,currency text,funding_enabled boolean,
    spend_enabled boolean,settlement_enabled boolean,shared_escrow_account_type text,
    shared_revenue_account_type text,spend_requires_billable_event boolean
  );
  create table private.advertising_campaign_finance(
    campaign_id uuid primary key,budget_bdag numeric(20,8) not null,currency text default 'BDAG',
    finance_status text not null default 'draft',funded_bdag numeric(20,8) not null default 0,
    spent_bdag numeric(20,8) not null default 0,released_bdag numeric(20,8) not null default 0,
    funding_source_account_id uuid,funded_by_user_id uuid,funded_at timestamptz,settled_at timestamptz
  );
  create table private.advertising_events(id uuid primary key,campaign_id uuid not null,event_type text not null,occurred_at timestamptz default clock_timestamp());
  create table private.advertising_financial_events(
    id uuid primary key default gen_random_uuid(),campaign_id uuid not null,event_type text not null,
    amount_bdag numeric(20,8) not null,financial_transaction_id uuid not null unique,
    idempotency_key uuid not null,billable_event_id uuid,created_at timestamptz default clock_timestamp(),
    unique(event_type,idempotency_key)
  );
  create unique index advertising_financial_events_billable_once
    on private.advertising_financial_events(billable_event_id) where event_type='spend';
  create table private.advertising_financial_settlements(
    campaign_id uuid primary key,idempotency_key uuid not null unique,budget_bdag numeric(20,8) not null,
    funded_bdag numeric(20,8) not null,spent_bdag numeric(20,8) not null,
    released_before_bdag numeric(20,8) not null,released_on_settlement_bdag numeric(20,8) not null,
    settled_at timestamptz not null
  );

  create table public.ledger_accounts(
    id uuid primary key,owner_id uuid,account_type text not null,currency text not null,
    frozen boolean not null default false,balance numeric(20,8) not null default 0
  );
  create table public.financial_transactions(
    id uuid primary key,from_account_id uuid,to_account_id uuid,operation_type text,amount numeric(20,8),
    fee_amount numeric(20,8),currency text,status text,reference_type text,reference_id text,
    idempotency_key text unique,initiated_by uuid
  );
  create table public.ledger_entries(
    id bigint generated always as identity primary key,txn_id uuid not null,account_id uuid not null,
    entry_type text not null,amount numeric(20,8) not null
  );
  create table private.test_adult_users(user_id uuid primary key);

  create function private.ads_actor_is_advertiser_age_eligible(p_actor uuid)
  returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from private.test_adult_users where user_id=p_actor)
  $$;
  create function private.advertising_campaign_finance_result(p_campaign_id uuid)
  returns jsonb language sql stable security definer set search_path='' as $$
    select jsonb_build_object('campaign_id',campaign_id,'finance_status',finance_status,
      'budget_bdag',budget_bdag,'funded_bdag',funded_bdag,'spent_bdag',spent_bdag,
      'released_bdag',released_bdag,'reserved_bdag',funded_bdag-spent_bdag-released_bdag)
    from private.advertising_campaign_finance where campaign_id=p_campaign_id
  $$;
  create function public.ensure_ledger_account(p_owner uuid)
  returns uuid language sql security definer set search_path='' as $$
    select id from public.ledger_accounts where owner_id=p_owner and account_type='user' and currency='BDAG'
  $$;
  create function public.ensure_marketplace_ads_account(p_type text)
  returns uuid language sql security definer set search_path='' as $$
    select id from public.ledger_accounts where owner_id is null and account_type=p_type and currency='BDAG'
  $$;
  create function public.ledger_debit(p_tx uuid,p_account uuid,p_amount numeric,p_description text,p_metadata jsonb)
  returns void language plpgsql security definer set search_path='' as $$
  begin
    update public.ledger_accounts set balance=balance-p_amount where id=p_account;
    insert into public.ledger_entries(txn_id,account_id,entry_type,amount) values(p_tx,p_account,'debit',p_amount);
  end $$;
  create function public.ledger_credit(p_tx uuid,p_account uuid,p_amount numeric,p_description text,p_metadata jsonb)
  returns void language plpgsql security definer set search_path='' as $$
  begin
    update public.ledger_accounts set balance=balance+p_amount where id=p_account;
    insert into public.ledger_entries(txn_id,account_id,entry_type,amount) values(p_tx,p_account,'credit',p_amount);
  end $$;

  -- Minimal canonical authorities needed to compile and exercise J health.
  create table private.advertising_targeting_policy(
    singleton boolean primary key,policy_version text,minor_targeting_allowed boolean,
    interest_targeting_enabled boolean,behavioral_targeting_enabled boolean,
    custom_audiences_enabled boolean,lookalike_targeting_enabled boolean,
    sensitive_targeting_allowed boolean,precise_viewer_location_matching_enabled boolean
  );
  create table private.advertising_delivery_policy(
    singleton boolean primary key,policy_version text,global_v2_delivery_enabled boolean,
    frequency_enforcement_enabled boolean,geo_matching_enabled boolean,language_matching_enabled boolean
  );
  create table private.advertising_event_policy(
    singleton boolean primary key,policy_version text,anonymous_events_enabled boolean,
    external_conversion_ingestion_enabled boolean
  );
  create table private.age_eligibility_policy(
    singleton boolean primary key,minimum_age smallint,creator_exclusive_minimum_age smallint,policy_version text
  );
  create table private.user_age_eligibility(
    user_id uuid primary key,status text,age_band text,minimum_age smallint,policy_version text,evaluated_at timestamptz
  );
  create table private.advertising_placement_catalog(code text primary key,v2_delivery_enabled boolean);
  create table private.advertising_conversions(id uuid primary key);
  create table private.advertising_attributions(id uuid primary key);
  create function public.admin_require_capability(p_capability text)
  returns void language plpgsql security definer set search_path='' as $$ begin return; end $$;

  insert into private.business_accounts values('${business}','${owner}','active');
  insert into private.ad_accounts values('${account}','${business}','active');
  insert into private.advertising_campaigns
    select value::uuid,'${account}','draft' from jsonb_each_text('${JSON.stringify(campaigns)}'::jsonb);
  insert into private.advertising_campaign_finance(campaign_id,budget_bdag)
    select id,case when id='${campaigns.poor}' then 20000 else 100 end from private.advertising_campaigns;
  insert into private.advertising_finance_policy values(
    true,'nelyon-ads-finance-v1','BDAG',true,true,true,
    'marketplace_ads_escrow','marketplace_ads_revenue',true
  );
  insert into private.test_adult_users values('${owner}');
  insert into public.ledger_accounts values
    ('70000000-0000-4000-8000-000000000001','${owner}','user','BDAG',false,10000),
    ('70000000-0000-4000-8000-000000000002',null,'marketplace_ads_escrow','BDAG',false,0),
    ('70000000-0000-4000-8000-000000000003',null,'marketplace_ads_revenue','BDAG',false,0);
  insert into private.advertising_targeting_policy values(true,'nelyon-ads-targeting-v1',false,false,false,false,false,false,false);
  insert into private.advertising_delivery_policy values(true,'nelyon-ads-delivery-v2',false,true,false,false);
  insert into private.advertising_event_policy values(true,'nelyon-ads-events-v1',false,false);
  insert into private.age_eligibility_policy values(true,13,18,'nelyon-age-v2');
  insert into private.advertising_placement_catalog values('social_feed',false);
`;

test('PLR-2 replays committed fund, spend and settlement after shutdown without another money movement', { skip: !enabled, timeout: 180_000 }, async () => {
  run(`create database ${database};`, 'postgres');
  try {
    run(bootstrap);
    const h = migration('supabase/migrations/20260923033100_ads_v2_h_financial_generalization.sql');
    run([
      extractFunction(h, 'fund_my_advertising_campaign_budget_v2'),
      extractFunction(h, 'spend_advertising_campaign_budget_v2'),
      extractFunction(h, 'settle_advertising_campaign_budget_v2'),
    ].join('\n'));

    // Reproduce the H defect before applying PLR-2.
    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${keys.fund}')`);
    run('update private.advertising_finance_policy set funding_enabled=false where singleton');
    assert.throws(
      () => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${keys.fund}')`),
      /advertising_finance_funding_disabled/,
    );

    run(migration('supabase/migrations/20260923223950_ads_v2_plr_2_finance_retry_idempotency_hardening.sql'));

    // Exact fund replay survives policy/lifecycle/adult changes; authorization remains mandatory.
    run(`delete from private.test_adult_users where user_id='${owner}'; update private.business_accounts set status='inactive'; update private.ad_accounts set status='suspended'; update private.advertising_campaigns set status='archived' where id='${campaigns.fund}';`);
    assert.match(asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${keys.fund}')`), /"finance_status": "funded"/);
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${keys.fund}')`, intruder), /advertising_campaign_finance_access_denied/);
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.other}','${keys.fund}')`), /advertising_finance_idempotency_conflict/);
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.fund}','${keys.otherFund}')`), /advertising_finance_funding_disabled/);
    assert.equal(run(`select count(*) from public.financial_transactions where operation_type='advertising_campaign_fund' and reference_id='${campaigns.fund}'`), '1');
    assert.equal(run(`select count(*) from public.ledger_entries e join public.financial_transactions t on t.id=e.txn_id where t.reference_id='${campaigns.fund}'`), '2');
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.fund}' and event_type='fund'`), '1');

    run(`insert into private.test_adult_users values('${owner}'); update private.business_accounts set status='active'; update private.ad_accounts set status='active'; update private.advertising_campaigns set status='draft'; update private.advertising_finance_policy set funding_enabled=true,spend_enabled=true,settlement_enabled=true where singleton;`);

    // Spend replay and strict conflicts.
    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.spend}','${keys.spendFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.spend}','${campaigns.spend}','impression'),('${events.spendOther}','${campaigns.spend}','click')`);
    asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spend}',10,'${keys.spend}')`);
    run('update private.advertising_finance_policy set spend_enabled=false where singleton');
    assert.match(asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spend}',10,'${keys.spend}')`), /"spent_bdag": 10/);
    assert.throws(() => asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spend}',11,'${keys.spend}')`), /advertising_finance_idempotency_conflict/);
    assert.throws(() => asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spendOther}',10,'${keys.spend}')`), /advertising_finance_idempotency_conflict/);
    assert.throws(() => asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spendOther}',10,'${keys.diffSpendA}')`), /advertising_finance_spend_disabled/);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.spend}' and event_type='spend'`), '1');

    // Settlement replay with a positive release.
    run('update private.advertising_finance_policy set spend_enabled=true where singleton');
    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.settle}','${keys.settleFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.settle}','${campaigns.settle}','click')`);
    asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.settle}','${events.settle}',40,'${keys.settleSpend}')`);
    asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.settle}','${keys.settle}')`);
    run('update private.advertising_finance_policy set settlement_enabled=false where singleton');
    assert.match(asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.settle}','${keys.settle}')`), /"finance_status": "settled"/);
    assert.throws(() => asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.settle}','${keys.otherFund}')`), /advertising_finance_settlement_disabled/);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.settle}' and event_type='release'`), '1');
    assert.equal(run(`select count(*) from private.advertising_financial_settlements where campaign_id='${campaigns.settle}'`), '1');

    // Zero-release settlement replays from the settlement row, not a release event.
    run('update private.advertising_finance_policy set settlement_enabled=true where singleton');
    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.zero}','${keys.zeroFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.zero}','${campaigns.zero}','impression')`);
    asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.zero}','${events.zero}',100,'${keys.zeroSpend}')`);
    asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.zero}','${keys.zeroSettle}')`);
    run('update private.advertising_finance_policy set settlement_enabled=false where singleton');
    assert.match(asService(`select public.settle_advertising_campaign_budget_v2('${campaigns.zero}','${keys.zeroSettle}')`), /"finance_status": "settled"/);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.zero}' and event_type='release'`), '0');

    // Failed new mutations are atomic.
    assert.throws(() => asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.poor}','${keys.poorFund}')`), /advertising_insufficient_bdag_balance/);
    assert.equal(run(`select count(*) from public.financial_transactions where reference_id='${campaigns.poor}'`), '0');
    run('update private.advertising_finance_policy set settlement_enabled=true where singleton');
    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.over}','${keys.overFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.over}','${campaigns.over}','click')`);
    assert.throws(() => asService(`select public.spend_advertising_campaign_budget_v2('${campaigns.over}','${events.over}',101,'${keys.overSpend}')`), /advertising_campaign_overspend/);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.over}' and event_type='spend'`), '0');

    // Concurrent exact replays serialize on the finance row.
    const concurrentFundSql = `select public.fund_my_advertising_campaign_budget_v2('${campaigns.conFund}','${keys.conFund}')`;
    await Promise.all([asOwnerAsync(concurrentFundSql), asOwnerAsync(concurrentFundSql)]);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.conFund}' and event_type='fund'`), '1');

    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.conSpend}','${keys.conSpendFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.conSpend}','${campaigns.conSpend}','impression')`);
    const concurrentSpendSql = `select public.spend_advertising_campaign_budget_v2('${campaigns.conSpend}','${events.conSpend}',10,'${keys.conSpend}')`;
    await Promise.all([asServiceAsync(concurrentSpendSql), asServiceAsync(concurrentSpendSql)]);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.conSpend}' and event_type='spend'`), '1');

    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.diffSpend}','${keys.diffSpendFund}')`);
    run(`insert into private.advertising_events(id,campaign_id,event_type) values('${events.diffSpend}','${campaigns.diffSpend}','click')`);
    const differentKeyResults = await Promise.allSettled([
      asServiceAsync(`select public.spend_advertising_campaign_budget_v2('${campaigns.diffSpend}','${events.diffSpend}',10,'${keys.diffSpendA}')`),
      asServiceAsync(`select public.spend_advertising_campaign_budget_v2('${campaigns.diffSpend}','${events.diffSpend}',10,'${keys.diffSpendB}')`),
    ]);
    assert.equal(differentKeyResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.diffSpend}' and event_type='spend'`), '1');

    asOwner(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.conSettle}','${keys.conSettleFund}')`);
    const concurrentSettleSql = `select public.settle_advertising_campaign_budget_v2('${campaigns.conSettle}','${keys.conSettle}')`;
    await Promise.all([asServiceAsync(concurrentSettleSql), asServiceAsync(concurrentSettleSql)]);
    assert.equal(run(`select count(*) from private.advertising_financial_settlements where campaign_id='${campaigns.conSettle}'`), '1');
    assert.equal(run(`select count(*) from private.advertising_financial_events where campaign_id='${campaigns.conSettle}' and event_type='release'`), '1');

    // Client/anon boundaries and J health remain fail closed.
    assert.throws(() => run(`select public.fund_my_advertising_campaign_budget_v2('${campaigns.other}','${keys.otherFund}')`), /advertising_auth_required/);
    assert.throws(() => run(`select public.spend_advertising_campaign_budget_v2('${campaigns.spend}','${events.spend}',10,'${keys.spend}')`), /advertising_finance_internal_only/);
    assert.throws(() => run(`select public.settle_advertising_campaign_budget_v2('${campaigns.settle}','${keys.settle}')`), /advertising_finance_internal_only/);
    const health = JSON.parse(run('select public.get_admin_advertising_health()'));
    assert.equal(health.production_delivery_ready, false);
    assert.equal(health.blockers.includes('finance_idempotency_preactivation_hardening_required'), false);
    for (const blocker of ['age_authority_unavailable','campaign_activation_not_implemented','global_delivery_disabled','no_v2_placement_enabled'])
      assert.equal(health.blockers.includes(blocker), true);
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid(); drop database if exists ${database};`, 'postgres');
  }
});
