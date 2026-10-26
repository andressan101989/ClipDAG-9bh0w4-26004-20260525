// Disposable PostgreSQL only. Never point this harness at a hosted database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.RUN_CREATOR_PREMIUM_F4_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2';
const wslPid = process.env.CREATOR_PREMIUM_PG_WSL_PID || '';
assert.match(template, /^[a-z0-9_]+$/);
assert.ok(!wslPid || /^\d+$/.test(wslPid));

const migrations = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(migrations);
const suffixes = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
  '_creator_premium_f2_complete_monetization.sql',
  '_creator_premium_f3_bounded_financial_activation.sql',
  '_creator_premium_f3_c2_isolated_canary_governance.sql',
  '_creator_premium_f3_final_wallet_integration.sql',
];
const chainFiles = suffixes.map(suffix => {
  const found = files.filter(name => name.endsWith(suffix));
  assert.equal(found.length, 1, suffix);
  return found[0];
});
const f4Files = files.filter(name => name.endsWith('_creator_premium_f4_general_bdag_activation.sql'));
const f4Authorization = 'f4000000-0000-4000-8000-000000000001';
const contract = 'creator-premium-f3-v2';

function dockerArgs(command) {
  return wslPid
    ? ['wsl.exe', ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslPid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]]
    : ['docker', ['exec', '-i', container, '/bin/sh', '-c', command]];
}
function docker(command, input = '', allowFailure = false) {
  const [executable, args] = dockerArgs(command);
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  });
  if (!allowFailure) assert.equal(result.status, 0,
    `${command}\n${result.stdout || ''}\n${result.stderr || ''}`);
  return { status: result.status, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' };
}
function dockerAsync(command, input = '') {
  const [executable, args] = dockerArgs(command);
  return new Promise(resolve => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({
      status,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
    child.stdin.end(input);
  });
}
function pgCommand(db) {
  assert.match(db, /^premium_f4_[a-z0-9_]+$/);
  return `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At`;
}
function sql(db, query, allowFailure = false) {
  return docker(pgCommand(db), query, allowFailure);
}
function sqlAsync(db, query) {
  return dockerAsync(pgCommand(db), query);
}
function json(db, query) { return JSON.parse(sql(db, query).stdout); }
function service(query) {
  return `begin;set local statement_timeout='15s';set local request.jwt.claim.role='service_role';set local role service_role;${query};commit;`;
}
function authenticated(db, actor, query, allowFailure = false) {
  return sql(db, `begin;set local statement_timeout='15s';
    set local request.jwt.claim.sub='${actor}';
    set local request.jwt.claim.role='authenticated';
    set local role authenticated;${query};commit;`, allowFailure);
}
function owner(query) {
  return `begin;set local statement_timeout='15s';set local role postgres;${query};commit;`;
}
function denied(result, expected = /creator_premium_|permission denied|violates/i) {
  assert.notEqual(result.status, 0, `unexpected success: ${result.stdout}`);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stderr, /does not exist|syntax error|deadlock detected|statement timeout/i);
}
function applyMigrationIfMissing(db, name) {
  const version = name.split('_', 1)[0];
  const hasHistory = sql(db,
    `select to_regclass('supabase_migrations.schema_migrations') is not null`).stdout === 't';
  const applied = hasHistory && sql(db,
    `select exists(select 1 from supabase_migrations.schema_migrations where version='${version}')`).stdout === 't';
  if (!applied) sql(db, readFileSync(new URL(name, migrations), 'utf8'));
}
function insertSyntheticUsers(db, actorIds) {
  const hasAgeTrigger = sql(db, `select exists(select 1 from pg_trigger
    where tgrelid='auth.users'::regclass and tgname='on_auth_user_age_eligibility')`).stdout === 't';
  sql(db, `begin;
    ${hasAgeTrigger ? 'alter table auth.users disable trigger on_auth_user_age_eligibility;' : ''}
    insert into auth.users(id,is_anonymous) values ${actorIds.map(id => `('${id}',false)`).join(',')};
    ${hasAgeTrigger ? 'alter table auth.users enable trigger on_auth_user_age_eligibility;' : ''}
    commit;`);
}

test('F4 integration requires the reviewed general activation migration', () => {
  assert.equal(f4Files.length, 1,
    'missing the single F4 general activation migration');
});

test('F4 general activation charges arbitrary eligible actors, preserves provenance and supports owner suspension', {
  skip: !enabled,
  timeout: 600_000,
}, async () => {
  assert.equal(f4Files.length, 1);
  const db = `premium_f4_case_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const id = Object.fromEntries([
    'admin', 'buyer', 'subscriber', 'lateBuyer', 'creator', 'content', 'offer', 'plan', 'scan',
    'buyerAccount', 'subscriberAccount', 'lateBuyerAccount', 'multiCurrencyAccount', 'platformAccount',
  ].map(name => [name, randomUUID()]));
  const purchaseKey = randomUUID();
  const subscriptionKey = randomUUID();
  const purchase = (actor = id.buyer, key = purchaseKey) =>
    `select public.purchase_creator_premium_content_v1('${actor}','${id.content}','${id.offer}','${key}','${contract}')`;
  const subscribe = (actor = id.subscriber, key = subscriptionKey) =>
    `select public.subscribe_creator_premium_plan_v1('${actor}','${id.plan}','${key}','${contract}')`;
  const monetarySnapshot = () => sql(db, `select jsonb_build_object(
    'accounts',(select jsonb_agg(jsonb_build_array(id,balance,frozen) order by id) from public.ledger_accounts),
    'transactions',(select count(*) from public.financial_transactions),
    'entries',(select count(*) from public.ledger_entries),
    'receipts',(select count(*) from private.creator_premium_purchase_receipts),
    'periods',(select count(*) from private.creator_premium_subscription_periods),
    'subscriptions',(select count(*) from private.creator_premium_subscriptions),
    'journal',(select count(*) from public.idempotency_keys),
    'velocity',(select coalesce(sum(count),0) from public.velocity_counters))`).stdout;
  const balances = () => json(db, `select jsonb_build_array(
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.buyerAccount}'),
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.subscriberAccount}'),
    (select balance::numeric(38,8)::text from public.ledger_accounts
      where owner_id='${id.creator}' and account_type='user' and currency='BDAG'),
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.platformAccount}'))`);
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    for (let index = 0; index < 6; index += 1) applyMigrationIfMissing(db, chainFiles[index]);
    sql(db, `insert into private.admin_roles(
        role_code,display_name,description,is_assignable,is_root,is_exclusive)
      values('MODERATOR','Moderator','Synthetic moderator',true,false,false)
      on conflict do nothing;
      insert into private.admin_capabilities(
        capability_code,domain,effect,description,is_sensitive)
      values('content.items.moderate','content','write','Moderate content',true),
        ('finance.ledger.read','finance','read','Read ledger',true)
      on conflict do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values('SUPER_ADMIN','content.items.moderate'),('SUPER_ADMIN','finance.ledger.read'),
        ('MODERATOR','content.items.moderate')
      on conflict do nothing;`);
    for (let index = 6; index < 8; index += 1) applyMigrationIfMissing(db, chainFiles[index]);
    sql(db, 'truncate public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;');
    sql(db, `grant usage on schema public,private to postgres;
      grant all on all tables in schema public,private to postgres;
      grant execute on all functions in schema public,private to postgres;`);
    for (let index = 8; index < chainFiles.length; index += 1) applyMigrationIfMissing(db, chainFiles[index]);

    const actors = [id.admin, id.buyer, id.subscriber, id.lateBuyer, id.creator];
    insertSyntheticUsers(db, actors);
    sql(db, `insert into public.user_profiles(id,username)
      values ${actors.map((actor, index) => `('${actor}','f4_synthetic_${index}')`).join(',')};
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      select fixture.id,'eligible',policy.minimum_age,policy.policy_version,clock_timestamp(),
        'signup_metadata','age_18_plus',current_date-interval '25 years'
      from (values ${actors.map(actor => `('${actor}'::uuid)`).join(',')}) fixture(id)
      cross join private.age_eligibility_policy policy where policy.singleton;
      insert into private.admin_user_roles(
        user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('${id.admin}','SUPER_ADMIN','trusted_operator','f4-disposable-proof','F4 local contract proof');
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,
        requested_reason,detector_version,text_status,audio_status,visual_status,reports_status,
        attempt_count,available_at,started_at,completed_at,created_at,updated_at)
      values('${id.scan}','creator_premium','${id.content}','${id.creator}',repeat('a',64),'completed',
        'content_created','f4-disposable-v1','analyzed','not_applicable','not_applicable','analyzed',1,
        current_timestamp,current_timestamp,current_timestamp,current_timestamp,current_timestamp);
      insert into private.creator_premium_contents(
        id,creator_id,title,content_kind,access_mode,lifecycle_status,submitted_at,published_at,
        verification_generation,verification_scan_id,verification_fingerprint,verification_status,
        verification_requested_at,verification_completed_at)
      values('${id.content}','${id.creator}','F4 synthetic','image','purchase_or_subscription','published',
        clock_timestamp(),clock_timestamp(),1,'${id.scan}',repeat('a',64),'passed',clock_timestamp(),clock_timestamp());
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,status,activated_at)
      values('${id.offer}','${id.content}','${id.creator}',1,10,'active',clock_timestamp());
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,price_bdag,currency,status,billing_period_days)
      values('${id.plan}','${id.creator}','f4_general',1,'F4 general',20,'BDAG','draft',30);
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.content}','${id.creator}');
      update private.creator_premium_plans set status='active',activated_at=clock_timestamp()
      where id='${id.plan}';
      insert into public.ledger_accounts(id,owner_id,account_type,currency,balance,frozen)
      values('${id.platformAccount}',null,'platform','BDAG',0,false),
        ('${id.buyerAccount}','${id.buyer}','user','BDAG',100,false),
        ('${id.subscriberAccount}','${id.subscriber}','user','BDAG',100,false),
        ('${id.lateBuyerAccount}','${id.lateBuyer}','user','BDAG',0,false),
        ('${id.multiCurrencyAccount}','${id.buyer}','treasury','USDC',0,true);`);

    // The disposable compile template is built by supabase_admin, whereas the
    // protected production migration role is postgres.  Restore the production
    // owner before applying F4 so owner-only DDL/attestation guards are tested,
    // not bypassed or weakened.
    sql(db, `grant usage,create on schema public,private to postgres;
      alter table private.creator_premium_finance_policy owner to postgres;`);

    const beforeMigration = monetarySnapshot();
    assert.equal(sql(db, `select count(*) from public.ledger_accounts
      where owner_id='${id.creator}' and account_type='user'`).stdout, '0',
    'fixture must prove canonical creator-account provisioning');
    sql(db, `set role postgres;
      ${readFileSync(new URL(f4Files[0], migrations), 'utf8')}
      reset role;`);
    assert.equal(monetarySnapshot(), beforeMigration,
      'F4 activation itself moved BDAG or created commercial facts');
    assert.equal(sql(db, `select count(*) from public.ledger_accounts
      where owner_id='${id.creator}' and account_type='user'`).stdout, '0',
    'activation migration must not provision a creator account');
    assert.deepEqual(json(db, `select jsonb_build_array(activation_mode,purchase_enabled,
      subscription_enabled,refunds_enabled,platform_fee_bps,active_authorization_id)
      from private.creator_premium_finance_policy where singleton`),
    ['general', true, true, true, 2000, f4Authorization]);
    assert.equal(sql(db, `select count(*) from private.creator_premium_finance_owner_attestations_f3_c2
      where registered_by='postgres'`).stdout, '1');
    assert.equal(sql(db, `select count(*) from private.creator_premium_finance_authorizations
      where id='${f4Authorization}' and status='OPEN' and authorization_scope='GENERAL'
        and buyer_id is null and creator_id is null and purchase_content_id is null
        and subscription_plan_id is null and purchase_amount_bdag is null
        and max_gross_bdag is null and charge_expires_at is null and refund_expires_at is null`).stdout, '1');
    assert.equal(sql(db, `select private.creator_premium_finance_authorization_integrity_f3_c2_v1('${f4Authorization}')`).stdout, 't');
    const generalAdmin = JSON.parse(authenticated(db, id.admin,
      'select public.get_admin_creator_premium_finance_activation_v1()').stdout);
    assert.equal(generalAdmin.activation.mode, 'general');
    assert.equal(generalAdmin.activation.scope, 'GENERAL');
    assert.equal(generalAdmin.activation.limits, null);
    assert.equal(generalAdmin.activation.remaining, null);

    const failedAttemptSnapshot = monetarySnapshot();
    denied(sql(db, service(`select public.purchase_creator_premium_content_v1(
      '${id.lateBuyer}','${id.content}','${id.offer}','${randomUUID()}','stale-contract-v1')`), true),
    /client_upgrade_required/);
    assert.equal(monetarySnapshot(), failedAttemptSnapshot,
      'stale client contract mutated financial state');
    denied(sql(db, service(purchase(id.lateBuyer, randomUUID())), true), /insufficient|balance/);
    assert.equal(monetarySnapshot(), failedAttemptSnapshot,
      'insufficient balance mutated financial state');

    const concurrentPurchaseResults = await Promise.all([
      sqlAsync(db, service(purchase())),
      sqlAsync(db, service(purchase())),
    ]);
    for (const result of concurrentPurchaseResults) {
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(concurrentPurchaseResults.map(result => JSON.parse(result.stdout).money_moved).sort(),
      [false, true], 'same-key concurrent purchase must debit exactly once');
    assert.equal(sql(db, `select count(*) from public.ledger_accounts
      where owner_id='${id.creator}' and account_type='user' and currency='BDAG' and not frozen`).stdout, '1',
    'canonical charge composer must provision exactly one creator BDAG account');
    const purchaseReplay = sql(db, service(purchase()));
    assert.equal(purchaseReplay.status, 0, purchaseReplay.stderr);
    assert.equal(JSON.parse(purchaseReplay.stdout).money_moved, false);
    const originalPurchase = json(db, `select jsonb_build_object('receipt_id',id,
      'financial_transaction_id',financial_transaction_id,'gross_amount_bdag',gross_amount_bdag::text)
      from private.creator_premium_purchase_receipts where buyer_id='${id.buyer}'`);
    const subscribedResult = sql(db, service(subscribe()));
    assert.equal(subscribedResult.status, 0, subscribedResult.stderr);
    const subscribed = JSON.parse(subscribedResult.stdout);
    assert.equal(subscribed.money_moved, true);
    const subscriptionReplay = sql(db, service(subscribe()));
    assert.equal(subscriptionReplay.status, 0, subscriptionReplay.stderr);
    assert.equal(JSON.parse(subscriptionReplay.stdout).money_moved, false);
    assert.equal(JSON.parse(subscriptionReplay.stdout).replayed, true);
    assert.deepEqual(balances(), ['90.00000000', '80.00000000', '24.00000000', '6.00000000']);
    assert.equal(sql(db, `select count(*) from private.creator_premium_purchase_receipts
      where finance_authorization_id='${f4Authorization}' and platform_fee_bps=2000
        and gross_amount_bdag=10 and platform_fee_bdag=2 and creator_net_bdag=8`).stdout, '1');
    assert.equal(sql(db, `select count(*) from private.creator_premium_subscription_periods
      where finance_authorization_id='${f4Authorization}' and platform_fee_bps=2000
        and gross_amount_bdag=20 and platform_fee_bdag=4 and creator_net_bdag=16`).stdout, '1');
    assert.equal(sql(db, `select count(*) from private.creator_premium_purchase_receipts receipt
      where not private.creator_premium_purchase_binding_is_valid_v1(receipt.id)`).stdout, '0');
    assert.equal(sql(db, `select count(*) from private.creator_premium_subscription_periods period
      where not private.creator_premium_subscription_period_fact_is_valid_f2_v1(period.id)`).stdout, '0');
    assert.equal(sql(db, `select not exists(select txn_id from public.ledger_entries group by txn_id
      having count(*)<>3 or sum(case when entry_type='debit' then amount else -amount end)<>0)`).stdout, 't');
    assert.deepEqual(json(db, `begin;
      set local request.jwt.claim.sub='${id.buyer}';
      set local role authenticated;
      select to_jsonb(entitlement) from public.get_my_creator_premium_entitlement_v1('${id.content}') entitlement;
      commit;`), {
      allowed: true,
      source: 'purchase',
      reason: 'active_purchase',
      expires_at: null,
    }, 'receipt-backed entitlement must be accepted by the playback authority');

    const cancelled = sql(db, service(`select public.cancel_creator_premium_subscription_v1(
      '${id.subscriber}','${subscribed.subscription_id}','${randomUUID()}')`));
    assert.equal(cancelled.status, 0, cancelled.stderr);
    denied(sql(db, `begin;set local request.jwt.claim.sub='${id.buyer}';set local role authenticated;
      select private.close_creator_premium_finance_authorization_f3_c2_v1(
        '${f4Authorization}','unauthorized');rollback;`, true), /permission denied|owner_required/);
    sql(db, owner(`select private.close_creator_premium_finance_authorization_f3_c2_v1(
      '${f4Authorization}','F4 disposable suspension')`));
    assert.deepEqual(json(db, `select jsonb_build_array(activation_mode,purchase_enabled,
      subscription_enabled,refunds_enabled,platform_fee_bps,active_authorization_id)
      from private.creator_premium_finance_policy where singleton`),
    ['general', false, false, true, 2000, f4Authorization]);
    denied(sql(db, service(purchase(id.lateBuyer, randomUUID())), true), /purchase_disabled|not_open/);

    const refundPurchaseKey = randomUUID();
    const refundPeriodKey = randomUUID();
    const refundPurchaseCommand = `select public.refund_creator_premium_purchase_v1(
      '${originalPurchase.receipt_id}','${refundPurchaseKey}','owner_approved')`;
    const refundPeriodCommand = `select public.refund_creator_premium_subscription_period_v1(
      '${subscribed.period_id}','${refundPeriodKey}','owner_approved')`;
    const refundPurchase = sql(db, service(refundPurchaseCommand));
    assert.equal(refundPurchase.status, 0, refundPurchase.stderr);
    assert.equal(JSON.parse(refundPurchase.stdout).money_moved, true);
    const refundPurchaseReplay = sql(db, service(refundPurchaseCommand));
    assert.equal(refundPurchaseReplay.status, 0, refundPurchaseReplay.stderr);
    assert.equal(JSON.parse(refundPurchaseReplay.stdout).money_moved, false);
    assert.equal(JSON.parse(refundPurchaseReplay.stdout).replayed, true);
    const refundPeriod = sql(db, service(refundPeriodCommand));
    assert.equal(refundPeriod.status, 0, refundPeriod.stderr);
    assert.equal(JSON.parse(refundPeriod.stdout).money_moved, true);
    const refundPeriodReplay = sql(db, service(refundPeriodCommand));
    assert.equal(refundPeriodReplay.status, 0, refundPeriodReplay.stderr);
    assert.equal(JSON.parse(refundPeriodReplay.stdout).money_moved, false);
    assert.equal(JSON.parse(refundPeriodReplay.stdout).replayed, true);
    assert.deepEqual(balances(), ['100.00000000', '100.00000000', '0.00000000', '0.00000000']);
    assert.equal(sql(db, `select count(*) from private.creator_premium_purchase_receipts
      where finance_authorization_id='${f4Authorization}' and access_state='refunded'`).stdout, '1');
    assert.equal(sql(db, `select count(*) from private.creator_premium_subscription_periods
      where finance_authorization_id='${f4Authorization}' and access_state='refunded'`).stdout, '1');
    assert.equal(sql(db, `select not exists(select txn_id from public.ledger_entries group by txn_id
      having count(*)<>3 or sum(case when entry_type='debit' then amount else -amount end)<>0)`).stdout, 't');
    assert.equal(sql(db, `select count(*) from private.creator_premium_purchase_receipts receipt
      where receipt.finance_authorization_id is distinct from '${f4Authorization}'`).stdout, '0');
    assert.equal(sql(db, `select count(*) from private.creator_premium_subscription_periods period
      where period.finance_authorization_id is distinct from '${f4Authorization}'`).stdout, '0');

    sql(db, owner(`select private.finalize_creator_premium_finance_authorization_f3_c2_v1('${f4Authorization}')`));
    assert.deepEqual(json(db, `select jsonb_build_array(activation_mode,purchase_enabled,
      subscription_enabled,refunds_enabled,platform_fee_bps,active_authorization_id)
      from private.creator_premium_finance_policy where singleton`),
    ['off', false, false, false, 0, null]);
    const offAdmin = JSON.parse(authenticated(db, id.admin,
      'select public.get_admin_creator_premium_finance_activation_v1()').stdout);
    assert.equal(offAdmin.activation.mode, 'off');
    assert.equal(offAdmin.activation.scope, null);
    assert.deepEqual(offAdmin.activation.limits, {
      purchase_count: 0,
      subscription_count: 0,
      refund_count: 0,
      purchase_amount_bdag: '0.00000000',
      subscription_amount_bdag: '0.00000000',
      gross_bdag: '0.00000000',
    });
    assert.deepEqual(offAdmin.activation.remaining, {
      purchase_count: 0,
      subscription_count: 0,
      refund_count: 0,
      gross_bdag: '0.00000000',
    });
    assert.equal(sql(db, `select relrowsecurity and relforcerowsecurity
      from pg_class where oid='private.creator_premium_finance_authorizations'::regclass`).stdout, 't');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(db, `select has_table_privilege('${role}',
        'private.creator_premium_finance_authorizations','select,insert,update,delete')`).stdout, 'f');
    }
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${db}`, '', true);
  }
});
