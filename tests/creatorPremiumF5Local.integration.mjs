// Disposable PostgreSQL only. Never point this harness at a hosted database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.RUN_CREATOR_PREMIUM_F5_LOCAL === '1';
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
  assert.equal(db, 'contrib_regression');
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


test('F5 real PostgreSQL consent, charge, retries, concurrency and security contracts', { skip: !enabled, timeout: 600_000 }, async t => {
  // pg_cron's upstream installer explicitly supports contrib_regression for
  // extension tests outside cron.database_name. Real C functions, no stub.
  const db = 'contrib_regression';
  const id = Object.fromEntries(['admin','buyer','subscriber','lateBuyer','creator','content','offer','plan','scan',
    'buyerAccount','subscriberAccount','lateBuyerAccount','multiCurrencyAccount','platformAccount'].map(name => [name,randomUUID()]));
  const monetarySnapshot = () => sql(db, `select jsonb_build_array(
    (select count(*) from public.financial_transactions),
    (select count(*) from private.creator_premium_subscription_periods),
    (select count(*) from public.idempotency_keys where operation_type in ('creator_premium_subscription','creator_premium_subscription_command')),
    (select coalesce(sum(count),0) from public.velocity_counters),
    (select jsonb_agg(jsonb_build_array(id,balance) order by id) from public.ledger_accounts))`).stdout;
  const subscribe = (key = randomUUID()) => `select public.subscribe_creator_premium_plan_v1('${id.subscriber}','${id.plan}','${key}','${contract}')`;
  let current;
  const consent = (enabled=true, key=randomUUID(),price=20,version=1) => `select public.set_creator_premium_auto_renewal_v1('${id.subscriber}','${current.subscription_id}',${enabled},${price},${version},'${key}')`;
  const worker = () => owner('select private.process_creator_premium_auto_renewals_f5_v1(25)');
  const mandate = () => json(db, `select to_jsonb(m) from private.creator_premium_auto_renewal_mandates m where subscriber_id='${id.subscriber}'`);
  // Time travel only immutable synthetic test fixtures; financial writes still use real authorities.
  const expire = () => sql(db, `begin;set local session_replication_role=replica;
    update private.creator_premium_subscription_periods set
      starts_at=least(starts_at,current_timestamp-interval '62 days'),
      paid_through_at=least(paid_through_at,current_timestamp-interval '32 days')
      where subscriber_id='${id.subscriber}' and id<>'${current.period_id}';
    update private.creator_premium_subscriptions set started_at=least(started_at,current_timestamp-interval '62 days')
      where subscriber_id='${id.subscriber}' and id<>'${current.subscription_id}';
    update private.creator_premium_subscription_periods set
      starts_at=clock_timestamp()-interval '31 days',paid_through_at=clock_timestamp()-interval '1 day'
      where id='${current.period_id}';
    update private.creator_premium_subscriptions set started_at=clock_timestamp()-interval '31 days'
      where id='${current.subscription_id}';
    update private.creator_premium_auto_renewal_mandates set due_at=p.paid_through_at,next_attempt_at=p.paid_through_at
      from private.creator_premium_subscription_periods p where current_period_id=p.id and p.id='${current.period_id}';
    commit;`);
  let created=false;
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    created=true;
    sql(db, 'drop schema cron cascade; create extension pg_cron; grant usage on schema cron to postgres;');
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


    current = json(db,service(subscribe()));
    const beforeF5 = monetarySnapshot();
    // The compile template predates production ownership normalization.
    sql(db,'alter function public.cancel_creator_premium_subscription_v1(uuid,uuid,uuid) owner to postgres;');
    const legacyCancelKey=randomUUID();
    const legacyCancelId=current.subscription_id;
    const legacyCancelReceipt=json(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${legacyCancelId}','${legacyCancelKey}')`));
    assert.equal(legacyCancelReceipt.replayed,false);
    const f5File = files.find(name => name.endsWith('_creator_premium_f5_autonomous_subscriptions.sql'));
    if (f5File) sql(db, `set role postgres;${readFileSync(new URL(f5File,migrations),'utf8')}reset role;`);
    assert.equal(sql(db,`select to_regclass('private.creator_premium_auto_renewal_mandates') is not null`).stdout,'t','missing F5 mandate table');
    assert.equal(monetarySnapshot(),beforeF5);
    await t.test('due-slot command UUID is RFC v3, deterministic across timezone, and unique by generation/due', () => {
      const expression=`private.creator_premium_auto_renewal_command_id_f5_v1('00000000-0000-4000-8000-000000000001',1,'2026-10-26 00:00:00+00')`;
      const key=sql(db,`select ${expression}`).stdout;
      assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(sql(db,`set timezone='America/New_York';select ${expression}`).stdout,key);
      assert.notEqual(sql(db,`select ${expression.replace(',1,',',2,')}`).stdout,key);
      assert.notEqual(sql(db,`select ${expression.replace('26 00','27 00')}`).stdout,key);
    });
    await t.test('existing paid subscriptions are not enrolled and absent consent never charges', () => {
      assert.equal(sql(db,'select count(*) from private.creator_premium_auto_renewal_mandates').stdout,'0');
      assert.equal(sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout,'0');
      sql(db,worker()); assert.equal(monetarySnapshot(),beforeF5);
    });
    await t.test('consent validates exact expected values, ownership, ACL and moves no money; replay cannot re-enable revoked consent', () => {
      denied(sql(db,service(consent(true,randomUUID(),21)),true),/snapshot_changed/);
      denied(authenticated(db,id.subscriber,consent(),true),/permission denied/);
      const key=randomUUID(); const first=json(db,service(consent(true,key)));
      assert.equal(first.auto_renewal.enabled,true);
      assert.equal(mandate().generation,1);
      json(db,service(consent(true,key))); assert.equal(mandate().generation,1);
      json(db,service(consent(false)));
      json(db,service(consent(true,key))); assert.equal(mandate().state,'REVOKED');
      json(db,service(consent())); assert.equal(mandate().generation,2);
      assert.equal(monetarySnapshot(),beforeF5);
      const legacy=JSON.parse(authenticated(db,id.subscriber,'select public.get_my_creator_premium_subscriptions_v1()').stdout);
      assert.equal('auto_renewal' in legacy.items[0],false);
      const v2=JSON.parse(authenticated(db,id.subscriber,'select public.get_my_creator_premium_subscriptions_v2()').stdout);
      assert.deepEqual(Object.keys(v2.items[0].auto_renewal).sort(),['enabled','mandate_state','consented_at','revoked_at','next_charge_at','authorized_price_bdag','authorized_plan_version','retry_count','last_result','last_attempt_at'].sort());
    });
    await t.test('pre-F5 cancellation replay preserves a later explicit consent generation', () => {
      const before=mandate();
      const attempts=sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout;
      try {
        const receipt=json(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${legacyCancelId}','${legacyCancelKey}')`));
        assert.deepEqual(receipt,{...legacyCancelReceipt,replayed:true,already_cancelled:true});
        assert.deepEqual(mandate(),before,'legacy replay must not mutate a later consent generation');
        assert.equal(sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout,attempts);
        assert.equal(monetarySnapshot(),beforeF5);
      } finally {
        if(mandate().state!=='ENABLED') json(db,service(consent()));
      }
    });
    await t.test('due double cron charges once with exact 20 percent fee and balanced ledger', async () => {
      expire();
      for(const result of await Promise.all([sqlAsync(db,worker()),sqlAsync(db,worker())])) assert.equal(result.status,0,result.stderr);
      assert.equal(sql(db,`select count(*) from private.creator_premium_subscription_periods where subscriber_id='${id.subscriber}'`).stdout,'2');
      assert.deepEqual(json(db,`select jsonb_build_array(balance,(select balance from public.ledger_accounts where owner_id='${id.creator}' and currency='BDAG'),(select balance from public.ledger_accounts where id='${id.platformAccount}')) from public.ledger_accounts where id='${id.subscriberAccount}'`),[60,32,8]);
      assert.equal(sql(db,`select not exists(select txn_id from public.ledger_entries group by txn_id having sum(case when entry_type='debit' then amount else -amount end)<>0)`).stdout,'t');
      current=json(db,`select jsonb_build_object('subscription_id',subscription_id,'period_id',id) from private.creator_premium_subscription_periods where id='${mandate().current_period_id}'`);
    });
    await t.test('manual renewal racing cron adopts one paid period and replay never duplicates a charge', async () => {
      expire(); const before=Number(sql(db,'select count(*) from public.financial_transactions').stdout);
      const key=randomUUID();
      for(const result of await Promise.all([sqlAsync(db,service(subscribe(key))),sqlAsync(db,worker())])) assert.equal(result.status,0,result.stderr);
      json(db,service(subscribe(key))); sql(db,worker());
      assert.equal(Number(sql(db,'select count(*) from public.financial_transactions').stdout),before+1);
      current=json(db,`select jsonb_build_object('subscription_id',subscription_id,'period_id',id) from private.creator_premium_subscription_periods where id='${mandate().current_period_id}'`);
    });
    await t.test('insufficient funds leave no debt or period, back off, and stop after three failures', () => {
      expire(); sql(db,`update public.ledger_accounts set balance=0 where id='${id.subscriberAccount}'`);
      const before=monetarySnapshot();
      for(let i=0;i<3;i++){
        sql(db,worker());
        assert.equal(mandate().retry_count,i+1);
        if(i<2) {
          const count=sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout;
          sql(db,worker());assert.equal(sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout,count);
          sql(db,`update private.creator_premium_auto_renewal_mandates set next_attempt_at=clock_timestamp()-interval '1 second'`);
        }
      }
      assert.equal(mandate().state,'PAUSED'); assert.equal(mandate().last_result,'insufficient_balance');
      assert.equal(monetarySnapshot(),before);
    });
    await t.test('worker skips busy command and Finance locks instead of waiting while holding family locks', async () => {
      sql(db,`update public.ledger_accounts set balance=1000 where id='${id.subscriberAccount}'`);
      json(db,service(consent()));
      const hash=sql(db,`select md5('creator-premium-f5|'||id::text||'|'||generation::text||'|'||extract(epoch from due_at)::text) from private.creator_premium_auto_renewal_mandates`).stdout;
      const key=hash.slice(0,8)+'-'+hash.slice(8,12)+'-3'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20);
      for(const lock of [
        `select pg_advisory_xact_lock(hashtextextended('creator-premium-subscription-command|${id.subscriber}|${key}',0))`,
        'select 1 from private.creator_premium_finance_policy where singleton for update']) {
        const before=monetarySnapshot();
        const holder=sqlAsync(db,`begin;set local application_name='f5_lock_holder';${lock};select pg_sleep(4);rollback;`);
        for(let n=0;n<30;n++) {
          if(sql(db,"select exists(select 1 from pg_stat_activity where application_name='f5_lock_holder' and wait_event='PgSleep')").stdout==='t') break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        const result=json(db,worker());
        assert.equal((await holder).status,0);
        assert.equal(result.processed,0,'busy lock must be skipped without invoking the financial core');
        assert.equal(monetarySnapshot(),before);
      }
    });
    await t.test('private tables force RLS, reject clients, and audit outcomes are append-only', () => {
      assert.equal(sql(db,`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('creator_premium_auto_renewal_mandates','creator_premium_auto_renewal_attempts') and c.relrowsecurity and c.relforcerowsecurity and c.relowner='postgres'::regrole`).stdout,'2');
      denied(sql(db,service('select * from private.creator_premium_auto_renewal_mandates'),true),/permission denied/);
      denied(sql(db,service('select private.process_creator_premium_auto_renewals_f5_v1(25)'),true),/permission denied/);
      denied(sql(db,owner('update private.creator_premium_auto_renewal_attempts set outcome=outcome'),true),/append_only/);
      assert.equal(sql(db,`select count(*) from cron.job where jobname='creator-premium-auto-renewals-f5' and schedule='*/5 * * * *' and username='postgres' and active and command='select private.process_creator_premium_auto_renewals_f5_v1(25);'`).stdout,'1');
      assert.equal(sql(db,`select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='cron.schedule(text,text,text)'::regprocedure`).stdout,'c','scheduler must be the real extension');
      assert.equal(sql(db,`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('subscribe_creator_premium_plan_f4_v1','cancel_creator_premium_subscription_f4_v1','refund_creator_premium_subscription_period_f4_v1') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')`).stdout,'3');
    });
    const replaceFixture = statement => sql(db,`begin;set local session_replication_role=replica;${statement};commit;`);
    const renewManually = () => { current=json(db,service(subscribe()));return current; };
    await t.test('price/version changes and plan retirement pause rather than silently replace consent', () => {
      sql(db,`update public.ledger_accounts set balance=1000 where id='${id.subscriberAccount}'`);
      for(const [mutation,restoration] of [
        ['price_bdag=21','price_bdag=20'],['version=2','version=1'],["status='retired',retired_at=clock_timestamp()","status='active',retired_at=null"]]) {
        json(db,service(consent()));const before=monetarySnapshot();
        replaceFixture(`update private.creator_premium_plans set ${mutation} where id='${id.plan}'`);
        sql(db,worker());assert.equal(mandate().state,'PAUSED');assert.equal(mandate().last_result,'plan_changed');
        assert.equal(monetarySnapshot(),before);
        replaceFixture(`update private.creator_premium_plans set ${restoration} where id='${id.plan}'`);
      }
    });
    await t.test('blocked actors, restricted accounts/content, frozen wallet and Finance OFF cannot charge', () => {
      for(const [mutation,restore,outcome] of [
        [`insert into public.blocked_users(blocker_id,blocked_id) values('${id.subscriber}','${id.creator}')`,`delete from public.blocked_users where blocker_id='${id.subscriber}'`,'safety_blocked'],
        [`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${id.creator}'`,`update auth.users set banned_until=null where id='${id.creator}'`,'safety_blocked'],
        [`update private.creator_premium_contents set lifecycle_status='quarantined',quarantined_at=clock_timestamp(),verification_status='restricted',review_reason='synthetic' where id='${id.content}'`,`update private.creator_premium_contents set lifecycle_status='published',quarantined_at=null,verification_status='passed',review_reason=null where id='${id.content}'`,'safety_blocked'],
        [`update public.ledger_accounts set frozen=true where id='${id.subscriberAccount}'`,`update public.ledger_accounts set frozen=false where id='${id.subscriberAccount}'`,'account_unavailable'],
        ["update private.creator_premium_finance_policy set activation_mode='off',purchase_enabled=false,subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,active_authorization_id=null where singleton",`update private.creator_premium_finance_policy set activation_mode='general',purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=2000,active_authorization_id='${f4Authorization}' where singleton`,'finance_unavailable']]) {
        json(db,service(consent()));replaceFixture(mutation);const before=monetarySnapshot();
        sql(db,worker());assert.equal(mandate().state,'PAUSED');assert.equal(mandate().last_result,outcome);
        assert.equal(monetarySnapshot(),before);replaceFixture(restore);
      }
    });
    await t.test('manual renewal projects family consent immediately before cron adopts the new period', () => {
      json(db,service(consent()));renewManually();
      const projection=JSON.parse(authenticated(db,id.subscriber,'select public.get_my_creator_premium_subscriptions_v2()').stdout);
      assert.equal(projection.items.find(item=>item.id===current.subscription_id).auto_renewal.enabled,true);
      sql(db,worker());assert.equal(mandate().current_period_id,current.period_id);
    });
    await t.test('historical refund preserves newer period and mandate; current refund racing cron pauses', async () => {
      const historical=sql(db,`select id from private.creator_premium_subscription_periods where subscriber_id='${id.subscriber}' and id<>'${current.period_id}' and access_state='expired' order by starts_at limit 1`).stdout;
      json(db,service(`select public.refund_creator_premium_subscription_period_v1('${historical}','${randomUUID()}','owner_approved')`));
      assert.equal(mandate().state,'ENABLED');
      assert.equal(authenticated(db,id.subscriber,`select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout,'t');
      expire();
      const periodsBefore=sql(db,'select count(*) from private.creator_premium_subscription_periods').stdout;
      const refund=sqlAsync(db,service(`set local application_name='f5_refund_holder';select public.refund_creator_premium_subscription_period_v1('${current.period_id}','${randomUUID()}','owner_approved');select pg_sleep(3)`));
      for(let n=0;n<30;n++) {
        if(sql(db,"select exists(select 1 from pg_stat_activity where application_name='f5_refund_holder' and wait_event='PgSleep')").stdout==='t') break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      const dueWorker=sql(db,worker());assert.equal(dueWorker.status,0,dueWorker.stderr);
      const refunded=await refund;assert.equal(refunded.status,0,refunded.stderr);
      assert.equal(sql(db,'select count(*) from private.creator_premium_subscription_periods').stdout,periodsBefore,'due cron must not create a period behind a current refund');
      assert.equal(mandate().state,'PAUSED');assert.equal(mandate().last_result,'refunded');
      assert.equal(authenticated(db,id.subscriber,`select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout,'f');
      renewManually();json(db,service(consent()));
    });
    await t.test('historical refund preserves an expired newer period awaiting consented renewal', () => {
      expire();
      replaceFixture(`update private.creator_premium_subscription_periods set access_state='expired' where id='${current.period_id}'`);
      json(db,service(consent()));
      const before=mandate();
      const historical=sql(db,`select id from private.creator_premium_subscription_periods where subscriber_id='${id.subscriber}' and id<>'${current.period_id}' and access_state='expired' order by starts_at limit 1`).stdout;
      assert.ok(historical);
      assert.equal(sql(db,`select private.creator_premium_subscription_period_fact_is_valid_f2_v1('${current.period_id}')`).stdout,'t');
      assert.equal(sql(db,`select next_attempt_at<=clock_timestamp() from private.creator_premium_auto_renewal_mandates where subscriber_id='${id.subscriber}'`).stdout,'t');
      const attempts=sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout;
      try {
        json(db,service(`select public.refund_creator_premium_subscription_period_v1('${historical}','${randomUUID()}','owner_approved')`));
        assert.deepEqual(mandate(),before,'historical refund must not mutate an expired newer period mandate');
        assert.equal(sql(db,'select count(*) from private.creator_premium_auto_renewal_attempts').stdout,attempts);
        assert.equal(sql(db,`select access_state from private.creator_premium_subscription_periods where id='${current.period_id}'`).stdout,'expired');
      } finally {
        renewManually();json(db,service(consent()));
      }
    });
    await t.test('cancel racing due cron revokes future charges and preserves already-paid entitlement', async () => {
      const cancelledId=current.subscription_id;const key=randomUUID();expire();
      for(const result of await Promise.all([sqlAsync(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${cancelledId}','${key}')`)),sqlAsync(db,worker())])) assert.equal(result.status,0,result.stderr);
      assert.equal(mandate().state,'REVOKED');const before=monetarySnapshot();sql(db,worker());assert.equal(monetarySnapshot(),before);
      renewManually();json(db,service(consent()));
      json(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${cancelledId}','${key}')`));
      assert.equal(mandate().state,'ENABLED','old cancellation replay must not revoke a new consent');
      assert.equal(sql(db,`select status from private.creator_premium_subscriptions where id='${current.subscription_id}'`).stdout,'active');
    });
    await t.test('expiry removes entitlement and timeout after real charge rolls back all effects, then retries safely', () => {
      expire();assert.equal(authenticated(db,id.subscriber,`select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout,'f');
      const before=monetarySnapshot();
      // A real PostgreSQL exception after period INSERT verifies subtransaction rollback.
      sql(db,`create function private.f5_test_timeout() returns trigger language plpgsql as $$begin raise exception using errcode='57014',message='synthetic_timeout';end$$;
        create trigger f5_test_timeout after insert on private.creator_premium_subscription_periods for each row execute function private.f5_test_timeout();`);
      sql(db,worker());assert.equal(mandate().last_result,'retryable_failure');assert.equal(monetarySnapshot(),before);
      const failedKey=sql(db,"select command_id from private.creator_premium_auto_renewal_attempts where outcome='retryable_failure' order by created_at desc limit 1").stdout;
      sql(db,`drop trigger f5_test_timeout on private.creator_premium_subscription_periods;drop function private.f5_test_timeout();update private.creator_premium_auto_renewal_mandates set next_attempt_at=clock_timestamp()-interval '1 second'`);
      sql(db,worker());assert.equal(mandate().last_result,'renewed');
      assert.equal(sql(db,"select command_id from private.creator_premium_auto_renewal_attempts where outcome='renewed' order by created_at desc limit 1").stdout,failedKey);
      assert.equal(authenticated(db,id.subscriber,`select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout,'t');
    });
    await t.test('cron-first cancellation acknowledges exact old ID and replay cannot revoke later consent', () => {
      current=json(db,`select jsonb_build_object('subscription_id',subscription_id,'period_id',id) from private.creator_premium_subscription_periods where id='${mandate().current_period_id}'`);
      const oldId=current.subscription_id;expire();sql(db,worker());
      const key=randomUUID();const command=`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${oldId}','${key}')`;
      const response=json(db,service(command));
      assert.equal(response.subscription_id,oldId);assert.equal(response.cancellation_effect,'future_renewal_revoked_after_race');
      assert.equal(mandate().state,'REVOKED');
      current=json(db,`select jsonb_build_object('subscription_id',subscription_id,'period_id',id) from private.creator_premium_subscription_periods where id='${mandate().current_period_id}'`);
      assert.equal(sql(db,`select status from private.creator_premium_subscriptions where id='${current.subscription_id}'`).stdout,'active');
      json(db,service(consent()));json(db,service(command));assert.equal(mandate().state,'ENABLED');
      denied(sql(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${oldId}','${randomUUID()}')`),true),/not_cancellable/);
      assert.equal(mandate().state,'ENABLED','an unrelated historical ID cannot revoke fresh consent');
    });
    await t.test('explicit re-consent after cancellation can renew at expiry without cancelling new paid access', () => {
      json(db,service(`select public.cancel_creator_premium_subscription_v1('${id.subscriber}','${current.subscription_id}','${randomUUID()}')`));
      json(db,service(consent()));expire();sql(db,worker());
      assert.equal(mandate().last_result,'renewed');assert.equal(mandate().state,'ENABLED');
      current=json(db,`select jsonb_build_object('subscription_id',subscription_id,'period_id',id) from private.creator_premium_subscription_periods where id='${mandate().current_period_id}'`);
    });
    await t.test('bounded multi-mandate batches charge each subscriber once and retain independent 80/20 accounting', () => {
      const other=json(db,service(`select public.subscribe_creator_premium_plan_v1('${id.buyer}','${id.plan}','${randomUUID()}','${contract}')`));
      json(db,service(`select public.set_creator_premium_auto_renewal_v1('${id.buyer}','${other.subscription_id}',true,20,1,'${randomUUID()}')`));
      expire();
      replaceFixture(`update private.creator_premium_subscription_periods set starts_at=current_timestamp-interval '31 days',paid_through_at=current_timestamp-interval '1 day' where id='${other.period_id}';
        update private.creator_premium_subscriptions set started_at=current_timestamp-interval '31 days' where id='${other.subscription_id}';
        update private.creator_premium_auto_renewal_mandates set due_at=p.paid_through_at,next_attempt_at=p.paid_through_at from private.creator_premium_subscription_periods p where p.id=current_period_id and p.id='${other.period_id}'`);
      const balances=()=>json(db,`select jsonb_build_array((select balance from public.ledger_accounts where id='${id.subscriberAccount}'),(select balance from public.ledger_accounts where id='${id.buyerAccount}'),(select balance from public.ledger_accounts where owner_id='${id.creator}' and currency='BDAG'),(select balance from public.ledger_accounts where id='${id.platformAccount}'))`);
      const before=balances();
      denied(sql(db,owner('select private.process_creator_premium_auto_renewals_f5_v1(101)'),true),/invalid_limit/);
      assert.equal(json(db,owner('select private.process_creator_premium_auto_renewals_f5_v1(1)')).processed,1);
      assert.equal(json(db,worker()).processed,1);
      assert.deepEqual(balances().map((value,index)=>value-before[index]),[-20,-20,32,8]);
      assert.equal(json(db,worker()).processed,0);
    });
  } finally {
    if(created) docker(`dropdb -U supabase_admin --if-exists ${db}`);
  }
});
