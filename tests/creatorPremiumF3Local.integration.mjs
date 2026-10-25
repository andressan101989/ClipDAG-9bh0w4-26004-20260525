// Disposable PostgreSQL only. Never point this harness at a hosted database.
// Baseline compatibility deliberately calls F2's three-UUID purchase signature when
// F3 is absent, so RED exposes actual unwanted debits rather than undefined-function errors.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCreatorPremiumCommerce, parseCreatorPremiumSubscriptionsPage } from '../services/creatorPremiumFinanceContracts.mjs';

const enabled = process.env.RUN_CREATOR_PREMIUM_F3_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2';
assert.match(template, /^[a-z0-9_]+$/, 'template must be a local PostgreSQL database name');
const wslPid = process.env.CREATOR_PREMIUM_PG_WSL_PID || '';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const suffixes = [
  '_creator_premium_b1_canonical_foundation.sql', '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql', '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql', '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql', '_creator_premium_f2_complete_monetization.sql',
];
const migrationFiles = readdirSync(migrationDir);
const chain = suffixes.map(suffix => {
  const found = migrationFiles.filter(name => name.endsWith(suffix));
  assert.equal(found.length, 1, suffix);
  return readFileSync(new URL(found[0], migrationDir), 'utf8');
});
const f3 = migrationFiles.filter(name => name.endsWith('_creator_premium_f3_bounded_financial_activation.sql'));
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

function dockerArgs(command) {
  return wslPid
    ? ['wsl.exe', ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslPid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]]
    : ['docker', ['exec', '-i', container, '/bin/sh', '-c', command]];
}
function docker(command, input = '', allowFailure = false) {
  const [executable, args] = dockerArgs(command);
  const result = spawnSync(executable, args, { encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024 });
  if (!allowFailure) assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' };
}
function dockerAsync(command, input) {
  const [executable, args] = dockerArgs(command);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}
function pgCommand(db) {
  assert.match(db, /^premium_f3_[a-z0-9_]+$/);
  return `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At`;
}
function sql(db, query, allowFailure = false) { return docker(pgCommand(db), query, allowFailure); }
function json(db, query) { return JSON.parse(sql(db, query).stdout); }
function serviceSql(query) {
  return `begin;set local statement_timeout='15s';set local request.jwt.claim.role='service_role';set local role service_role;${query};commit;`;
}
function authenticated(db, actor, query, allowFailure = false) {
  return sql(db, `begin;set local request.jwt.claim.sub=${literal(actor)};
    set local request.jwt.claim.role='authenticated';set local role authenticated;${query};commit;`, allowFailure);
}
function denied(result, expected = /creator_premium_(?:canary|finance|purchase_disabled|subscription_disabled|refund|offer_changed)/i) {
  assert.notEqual(result.status, 0, `Unexpected successful financial command: ${result.stdout}`);
  assert.match(result.stderr, expected);
}
async function waitForLock(db, query) {
  const deadline = Date.now() + 5_000;
  do {
    // Yield so spawned Docker stdin/output can drain while polling PostgreSQL.
    await delay(20);
    if (sql(db, query).stdout === 't') return;
  } while (Date.now() < deadline);
  assert.fail('lock handshake did not become ready');
}

test('F3 real authority rejects unbounded admission while retaining acquired rights', {
  skip: !enabled, timeout: 600_000,
}, async t => {
  const base = `premium_f3_base_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const names = ['admin', 'buyer', 'outsider', 'creator', 'otherCreator', 'content', 'otherContent',
    'foreignContent', 'offer', 'otherOffer', 'foreignOffer', 'replacementOffer', 'plan', 'otherPlan',
    'buyerAccount', 'creatorAccount', 'platformAccount', 'authorization', 'teaserAsset', 'originalAsset'];
  const id = Object.fromEntries(names.map(name => [name, randomUUID()]));
  let hasF3 = false, fourArgumentPurchase = false;
  const purchaseSql = (actor = id.buyer, content = id.content, offer = id.offer, key = randomUUID()) =>
    `select public.purchase_creator_premium_content_v1(${[actor, content,
      ...(fourArgumentPurchase ? [offer] : []), key].map(literal).join(',')})`;
  const subscribeSql = (actor = id.buyer, plan = id.plan, key = randomUUID()) =>
    `select public.subscribe_creator_premium_plan_v1(${[actor, plan, key].map(literal).join(',')})`;
  const command = (db, query) => sql(db, serviceSql(query), true);
  const success = (db, query) => {
    const result = command(db, query);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const snapshot = db => sql(db, `select jsonb_build_object(
    'balances',(select jsonb_agg(jsonb_build_array(id,balance) order by id) from public.ledger_accounts),
    'transactions',(select count(*) from public.financial_transactions),
    'entries',(select count(*) from public.ledger_entries),
    'receipts',(select count(*) from private.creator_premium_purchase_receipts),
    'periods',(select count(*) from private.creator_premium_subscription_periods),
    'subscriptions',(select count(*) from private.creator_premium_subscriptions),
    'journal',(select count(*) from public.idempotency_keys),
    'velocity',(select coalesce(sum(count),0) from public.velocity_counters)
  )`).stdout;
  const unchangedDenial = (db, query, pattern) => {
    const before = snapshot(db);
    const result = command(db, query);
    // Assert atomicity even when the denial assertion is about to expose a baseline debit.
    if (result.status !== 0) assert.equal(snapshot(db), before, 'rejection leaked financial or velocity state');
    denied(result, pattern);
    assert.equal(snapshot(db), before);
  };

  // Test-only synthetic arm. On F2 there is no envelope to install: enabling its
  // global flags exposes the real baseline gap. No test-only gate replaces SQL authority.
  function arm(db, changes = {}) {
    const settings = {
      buyer_id: id.buyer, creator_id: id.creator, buyer_account_id: id.buyerAccount,
      creator_account_id: id.creatorAccount, platform_account_id: id.platformAccount,
      purchase_content_id: id.content, purchase_offer_version_id: id.offer, subscription_plan_id: id.plan,
      purchase_amount_bdag: '10.00000000', subscription_amount_bdag: '20.00000000',
      max_purchase_count: 1, max_subscription_count: 1, max_refund_count: 1,
      max_gross_bdag: '30.00000000', platform_fee_bps: 1000,
      charge_starts_at: "clock_timestamp()-interval '1 minute'",
      charge_expires_at: "clock_timestamp()+interval '29 minutes'",
      refund_expires_at: "clock_timestamp()+interval '59 minutes'", ...changes,
    };
    const temporal = new Set(['charge_starts_at', 'charge_expires_at', 'refund_expires_at']);
    const entries = Object.entries(settings);
    if (hasF3) sql(db, `
      -- Simulate the later protected activation migration ONLY in this disposable clone.
      alter table private.creator_premium_finance_policy drop constraint creator_premium_finance_policy_f3_foundation_off_check;
      alter table private.creator_premium_finance_authorizations disable trigger creator_premium_finance_authorizations_f3_foundation_insert_guard;
      set session_replication_role=replica;
      insert into private.creator_premium_finance_authorizations(
        id,status,approval_digest,configuration_digest,${entries.map(([key]) => key).join(',')}
      ) values(${literal(id.authorization)},'OPEN',repeat('a',64),repeat('b',64),
        ${entries.map(([key, value]) => temporal.has(key) ? value : literal(value)).join(',')});
      update private.creator_premium_finance_policy set activation_mode='canary',
        active_authorization_id=${literal(id.authorization)},purchase_enabled=true,
        subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000 where singleton;
      set session_replication_role=origin;`);
    else sql(db, `update private.creator_premium_finance_policy set purchase_enabled=true,
      subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000 where singleton;`);
  }
  async function scenario(name, fn, settings = {}) {
    await t.test(name, async () => {
      const db = `premium_f3_case_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      try {
        docker(`createdb -U supabase_admin -T ${base} ${db}`);
        if (settings !== null) arm(db, settings);
        await fn(db);
      } finally {
        docker(`dropdb -U supabase_admin --force --if-exists ${db}`, '', true);
      }
    });
  }

  try {
    docker(`createdb -U supabase_admin -T ${template} ${base}`);
    sql(base, chain.slice(0, -2).join('\n'));
    sql(base, `insert into private.admin_roles(role_code,display_name,description,is_assignable,is_root,is_exclusive)
      values('MODERATOR','Moderator','Synthetic moderator',true,false,false) on conflict do nothing;
      insert into private.admin_capabilities(capability_code,domain,effect,description,is_sensitive)
      values('content.items.moderate','content','write','Moderate content',true),
        ('finance.ledger.read','finance','read','Read ledger',true) on conflict do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values('SUPER_ADMIN','content.items.moderate'),('SUPER_ADMIN','finance.ledger.read'),
        ('MODERATOR','content.items.moderate') on conflict do nothing;`);
    sql(base, chain.slice(-2).join('\n'));
    for (const migration of f3) sql(base, readFileSync(new URL(migration, migrationDir), 'utf8'));
    hasF3 = sql(base, "select to_regclass('private.creator_premium_finance_authorizations') is not null").stdout === 't';
    fourArgumentPurchase = sql(base, "select to_regprocedure('public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid)') is not null").stdout === 't';
    process.stdout.write(`# F3_BASELINE has_authorization=${hasF3} purchase_offer_precondition=${fourArgumentPurchase}\n`);
    const actors = [id.admin, id.buyer, id.outsider, id.creator, id.otherCreator];
    sql(base, `truncate public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values ${actors.map(actor => `(${literal(actor)},false)`).join(',')};
      insert into public.user_profiles(id,username) values ${actors.map((actor, i) => `(${literal(actor)},'f3_synthetic_${i}')`).join(',')};
      insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values(${literal(id.admin)},'SUPER_ADMIN','trusted_operator','f3-disposable-proof','Synthetic local proof');
      insert into private.user_age_eligibility(user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      select fixture.id,'eligible',policy.minimum_age,policy.policy_version,clock_timestamp(),
        'signup_metadata','age_18_plus',current_date-interval '25 years'
      from (values ${actors.map(actor => `(${literal(actor)}::uuid)`).join(',')}) fixture(id)
      cross join private.age_eligibility_policy policy where policy.singleton;
      ${[
        [id.content, id.creator, id.offer, 'a'],
        [id.otherContent, id.creator, id.otherOffer, 'b'],
        [id.foreignContent, id.otherCreator, id.foreignOffer, 'c'],
      ].map(([content, creator, offer, fingerprint]) => {
        const scan = randomUUID();
        return `insert into private.content_safety_scans(id,target_type,target_id,owner_user_id,content_fingerprint,
          status,requested_reason,detector_version,text_status,audio_status,visual_status,reports_status,
          attempt_count,available_at,started_at,completed_at,created_at,updated_at)
        values('${scan}','creator_premium','${content}','${creator}',repeat('${fingerprint}',64),'completed',
          'content_created','f3-disposable-v1','analyzed','not_applicable','not_applicable','analyzed',
          1,current_timestamp,current_timestamp,current_timestamp,current_timestamp,current_timestamp);
        insert into private.creator_premium_contents(id,creator_id,title,content_kind,access_mode,lifecycle_status,
          submitted_at,published_at,verification_generation,verification_scan_id,verification_fingerprint,
          verification_status,verification_requested_at,verification_completed_at)
        values('${content}','${creator}','F3 synthetic','image','purchase_or_subscription','published',
          clock_timestamp(),clock_timestamp(),1,'${scan}',repeat('${fingerprint}',64),'passed',clock_timestamp(),clock_timestamp());
        insert into private.creator_premium_offer_versions(id,content_id,creator_id,version,price_bdag,status,activated_at)
        values('${offer}','${content}','${creator}',1,10,'active',clock_timestamp());`;
      }).join('\n')}
      insert into private.creator_premium_plans(id,creator_id,plan_key,version,name,price_bdag,currency,status,activated_at,billing_period_days)
      values('${id.plan}','${id.creator}','f3_manual',1,'F3 manual',20,'BDAG','active',clock_timestamp(),30),
        ('${id.otherPlan}','${id.creator}','f3_other',1,'Outside envelope',20,'BDAG','active',clock_timestamp(),30);
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.content}','${id.creator}'),('${id.otherPlan}','${id.content}','${id.creator}');
      insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,status,public_url,ready_at)
      values('${id.teaserAsset}','${id.creator}','r2','image','creator_premium_teaser_image','public',
        'clipdag-public-media','f3/teaser.jpg','image/jpeg','ready','https://example.invalid/f3-teaser.jpg',clock_timestamp()),
        ('${id.originalAsset}','${id.creator}','r2','image','creator_premium_original_image','private',
        'clipdag-private-media','f3/original.jpg','image/jpeg','ready',null,clock_timestamp());
      insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,"position")
      values('${id.teaserAsset}','creator_premium_content','${id.content}','teaser',0),
        ('${id.originalAsset}','creator_premium_content','${id.content}','original',0);
      set session_replication_role=origin;
      insert into public.ledger_accounts(id,owner_id,account_type,currency,balance,frozen)
      values('${id.platformAccount}',null,'platform','BDAG',0,false),
        ('${id.buyerAccount}','${id.buyer}','user','BDAG',200,false),
        ('${id.creatorAccount}','${id.creator}','user','BDAG',0,false);
      select public.ensure_ledger_account('${id.outsider}');
      select public.ensure_ledger_account('${id.otherCreator}');
      update public.ledger_accounts set balance=200 where owner_id='${id.outsider}';`);

    await scenario('foundation is OFF/0, has no authorization, and cannot debit', db => {
      const state = json(db, `select to_jsonb(policy) from private.creator_premium_finance_policy policy where singleton`);
      assert.equal(state.purchase_enabled, false); assert.equal(state.subscription_enabled, false);
      assert.equal(state.refunds_enabled, false); assert.equal(state.platform_fee_bps, 0);
      unchangedDenial(db, purchaseSql(), /creator_premium_purchase_disabled/);
      unchangedDenial(db, subscribeSql(), /creator_premium_subscription_disabled/);
      assert.equal(state.activation_mode, 'off');
      assert.equal(state.active_authorization_id, null);
      assert.equal(sql(db, 'select count(*) from private.creator_premium_finance_authorizations').stdout, '0');
    }, null);

    await scenario('foundation has an OFF-only check and rejects authorization insertion', db => {
      assert.equal(sql(db, `select exists(select 1 from pg_constraint where
        conrelid='private.creator_premium_finance_policy'::regclass
        and conname='creator_premium_finance_policy_f3_foundation_off_check')`).stdout, 't');
      const flags = sql(db, 'update private.creator_premium_finance_policy set purchase_enabled=true where singleton', true);
      assert.notEqual(flags.status, 0, 'foundation can be armed by a flag update');
      assert.equal(hasF3, true);
      assert.equal(sql(db, `select exists(select 1 from pg_trigger where
        tgrelid='private.creator_premium_finance_authorizations'::regclass
        and tgname='creator_premium_finance_authorizations_f3_foundation_insert_guard'
        and tgenabled<>'D' and not tgisinternal)`).stdout, 't');
      const insert = sql(db, `insert into private.creator_premium_finance_authorizations default values`, true);
      assert.notEqual(insert.status, 0);
      assert.match(insert.stderr, /creator_premium_.*foundation/);
    }, null);

    await scenario('old three-UUID purchase authority has no callable service-role debit path', db => {
      const signature = "public.purchase_creator_premium_content_v1(uuid,uuid,uuid)";
      const exists = sql(db, `select to_regprocedure('${signature}') is not null`).stdout === 't';
      if (exists) {
        assert.equal(sql(db, `select has_function_privilege('service_role','${signature}','execute')`).stdout, 'f');
        unchangedDenial(db, `select public.purchase_creator_premium_content_v1('${id.buyer}','${id.content}','${randomUUID()}')`, /permission denied|creator_premium_.*(?:disabled|offer|required)/);
      }
      assert.equal(fourArgumentPurchase, true, 'expected-offer purchase authority is missing');
    });

    for (const [name, query] of [
      ['wrong buyer', () => purchaseSql(id.outsider)],
      ['wrong subscriber', () => subscribeSql(id.outsider)],
      ['wrong content', () => purchaseSql(id.buyer, id.otherContent, id.otherOffer)],
      ['wrong creator', () => purchaseSql(id.buyer, id.foreignContent, id.foreignOffer)],
      ['wrong immutable plan', () => subscribeSql(id.buyer, id.otherPlan)],
      ['wrong offer precondition', () => purchaseSql(id.buyer, id.content, id.otherOffer)],
    ]) await scenario(`${name} is denied atomically despite global Finance flags`, db => unchangedDenial(db, query()));

    for (const account of ['buyer_account_id', 'creator_account_id', 'platform_account_id']) {
      await scenario(`exact approved ${account} is enforced`, db => unchangedDenial(db, purchaseSql()), { [account]: randomUUID() });
    }
    await scenario('exact approved creator identity is enforced separately from content identity',
      db => unchangedDenial(db, purchaseSql()), { creator_id: id.otherCreator });
    await scenario('approved fee must match the canonical policy rather than widening the envelope',
      db => unchangedDenial(db, purchaseSql()), { platform_fee_bps: 9000 });
    for (const [name, settings] of [
      ['early charge', { charge_starts_at: "clock_timestamp()+interval '10 minutes'", charge_expires_at: "clock_timestamp()+interval '40 minutes'" }],
      ['expired charge', { charge_starts_at: "clock_timestamp()-interval '40 minutes'", charge_expires_at: "clock_timestamp()-interval '10 minutes'" }],
      ['purchase exact amount mismatch', { purchase_amount_bdag: '9.00000000', max_gross_bdag: '29.00000000' }],
      ['subscription exact amount mismatch', { subscription_amount_bdag: '19.00000000', max_gross_bdag: '29.00000000' }],
    ]) await scenario(`${name} rejects a new charge without partial state`, db => {
      unchangedDenial(db, name.startsWith('subscription') ? subscribeSql() : purchaseSql());
    }, settings);

    await scenario('stale displayed offer cannot silently charge the newly activated price', db => {
      sql(db, `set session_replication_role=replica;
        update private.creator_premium_offer_versions set status='retired',retired_at=clock_timestamp(),updated_at=clock_timestamp() where id='${id.offer}';
        insert into private.creator_premium_offer_versions(id,content_id,creator_id,version,price_bdag,status,activated_at)
        values('${id.replacementOffer}','${id.content}','${id.creator}',2,11,'active',clock_timestamp());
        set session_replication_role=origin;`);
      unchangedDenial(db, purchaseSql(), /creator_premium_offer_changed/);
    });
    await scenario('offer version participates in the idempotent purchase fingerprint', db => {
      const key = randomUUID();
      const first = success(db, purchaseSql(id.buyer, id.content, id.offer, key));
      assert.equal(first.money_moved, true);
      unchangedDenial(db, purchaseSql(id.buyer, id.content, id.otherOffer, key), /creator_premium_purchase_idempotency_conflict/);
    });

    await scenario('successful charge stamps the authorization and exact fee split on immutable facts', db => {
      const purchase = success(db, purchaseSql()); const subscription = success(db, subscribeSql());
      assert.equal(purchase.gross_amount_bdag, '10.00000000'); assert.equal(purchase.platform_fee_bdag, '1.00000000');
      assert.equal(purchase.creator_net_bdag, '9.00000000'); assert.equal(subscription.platform_fee_bdag, '2.00000000');
      assert.equal(sql(db, `select balance from public.ledger_accounts where id='${id.buyerAccount}'`).stdout, '170.00000000');
      assert.equal(sql(db, `select balance from public.ledger_accounts where id='${id.creatorAccount}'`).stdout, '27.00000000');
      assert.equal(sql(db, `select balance from public.ledger_accounts where id='${id.platformAccount}'`).stdout, '3.00000000');
      const fact = json(db, `select to_jsonb(receipt) from private.creator_premium_purchase_receipts receipt where id='${purchase.receipt_id}'`);
      const period = json(db, `select to_jsonb(period) from private.creator_premium_subscription_periods period where id='${subscription.period_id}'`);
      assert.equal(fact.finance_authorization_id, id.authorization);
      assert.equal(period.finance_authorization_id, id.authorization);
      for (const [table, factId] of [['creator_premium_purchase_receipts', purchase.receipt_id], ['creator_premium_subscription_periods', subscription.period_id]]) {
        const result = sql(db, `update private.${table} set finance_authorization_id=null where id='${factId}'`, true);
        assert.notEqual(result.status, 0, 'immutable authorization binding was editable');
      }
    });

    await scenario('exact replay and already-owned no-op work after OFF without consuming headroom', db => {
      const key = randomUUID(); const first = success(db, purchaseSql(id.buyer, id.content, id.offer, key));
      const subscriptionKey = randomUUID(); const subscription = success(db, subscribeSql(id.buyer, id.plan, subscriptionKey));
      sql(db, `set session_replication_role=replica;update private.creator_premium_finance_policy set
        purchase_enabled=false,subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0
        ${hasF3 ? ",activation_mode='off',active_authorization_id=null" : ''} where singleton;
        set session_replication_role=origin;`);
      const before = snapshot(db);
      const replay = success(db, purchaseSql(id.buyer, id.content, id.offer, key));
      assert.equal(replay.replayed, true); assert.equal(replay.receipt_id, first.receipt_id);
      const owned = success(db, purchaseSql()); assert.equal(owned.already_owned, true); assert.equal(owned.money_moved, false);
      const subscribed = success(db, subscribeSql()); assert.equal(subscribed.already_subscribed, true); assert.equal(subscribed.money_moved, false);
      assert.equal(success(db, subscribeSql(id.buyer, id.plan, subscriptionKey)).replayed, true);
      // No new receipt/period/ledger row; a successful no-op may journal its response.
      const after = JSON.parse(snapshot(db)), previous = JSON.parse(before);
      delete after.journal; delete previous.journal; assert.deepEqual(after, previous);
      assert.equal(authenticated(db, id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout, 't');
      const cancelled = success(db, `select public.cancel_creator_premium_subscription_v1('${id.buyer}','${subscription.subscription_id}','${randomUUID()}')`);
      assert.equal(cancelled.money_moved, false);
      assert.equal(authenticated(db, id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout, 't');
    });

    await scenario('refund does not restore the purchase count cap or gross headroom', db => {
      const first = success(db, purchaseSql());
      const refund = success(db, `select public.refund_creator_premium_purchase_v1('${first.receipt_id}','${randomUUID()}','owner_approved')`);
      assert.equal(refund.money_moved, true);
      assert.equal(sql(db, `select status from public.financial_transactions where id='${first.financial_transaction_id}'`).stdout, 'reversed');
      unchangedDenial(db, purchaseSql());
    });
    await scenario('subscription count cap includes cancelled expired paid periods', db => {
      const first = success(db, subscribeSql());
      success(db, `select public.cancel_creator_premium_subscription_v1('${id.buyer}','${first.subscription_id}','${randomUUID()}')`);
      sql(db, `set session_replication_role=replica;
        update private.creator_premium_subscription_periods set starts_at=clock_timestamp()-interval '31 days',
          paid_through_at=clock_timestamp()-interval '1 day',access_state='expired' where id='${first.period_id}';
        update private.creator_premium_subscriptions set started_at=clock_timestamp()-interval '31 days',
          cancelled_at=clock_timestamp()-interval '2 days',updated_at=clock_timestamp() where id='${first.subscription_id}';
        set session_replication_role=origin;`);
      unchangedDenial(db, subscribeSql());
    });
    await scenario('refund count cap survives independent purchase and subscription reversals', db => {
      const purchase = success(db, purchaseSql()); const subscription = success(db, subscribeSql());
      success(db, `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`);
      unchangedDenial(db, `select public.refund_creator_premium_subscription_period_v1('${subscription.period_id}','${randomUUID()}','owner_approved')`);
    });
    await scenario('expired refund window blocks reversal while preserving the acquired receipt', db => {
      const purchase = success(db, purchaseSql());
      if (hasF3) sql(db, `set session_replication_role=replica;
        update private.creator_premium_finance_authorizations set
          charge_starts_at=clock_timestamp()-interval '50 minutes',charge_expires_at=clock_timestamp()-interval '20 minutes',
          refund_expires_at=clock_timestamp()-interval '1 minute' where id='${id.authorization}';set session_replication_role=origin;`);
      unchangedDenial(db, `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`);
    });
    await scenario('separate refund window remains usable after the acquisition window closes', db => {
      const purchase = success(db, purchaseSql());
      if (hasF3) sql(db, `set session_replication_role=replica;
        update private.creator_premium_finance_authorizations set
          charge_starts_at=clock_timestamp()-interval '40 minutes',charge_expires_at=clock_timestamp()-interval '10 minutes'
          where id='${id.authorization}';set session_replication_role=origin;`);
      const refund = success(db, `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`);
      assert.equal(refund.money_moved, true);
      unchangedDenial(db, subscribeSql());
    });
    await scenario('refund cannot reverse a fact belonging to another authorization', db => {
      const purchase = success(db, purchaseSql());
      if (hasF3) sql(db, `set session_replication_role=replica;
        update private.creator_premium_purchase_receipts set finance_authorization_id=null where id='${purchase.receipt_id}';
        set session_replication_role=origin;`);
      unchangedDenial(db, `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`);
    });
    await scenario('aggregate gross ceiling combines purchase and subscription consumption', db => {
      success(db, purchaseSql()); unchangedDenial(db, subscribeSql());
    }, { max_gross_bdag: '20.00000000' });
    await scenario('concurrent final gross-slot attempts serialize across purchase and subscription', async db => {
      const results = await Promise.all([
        dockerAsync(pgCommand(db), serviceSql(purchaseSql())),
        dockerAsync(pgCommand(db), serviceSql(subscribeSql())),
      ]);
      assert.equal(results.filter(result => result.status === 0).length, 1,
        `Exactly one charge may commit in the remaining gross envelope: ${JSON.stringify(results)}`);
      denied(results.find(result => result.status !== 0));
      assert.ok(Number(sql(db, "select coalesce(sum(amount),0) from public.financial_transactions where operation_type in ('creator_premium_purchase','creator_premium_subscription')").stdout) <= 20);
    }, { max_gross_bdag: '20.00000000' });

    await scenario('non-cohort projection hides acquisition through installed-client safe blockers', db => {
      const projection = JSON.parse(authenticated(db, id.outsider, `select public.get_creator_premium_commerce_v1('${id.content}')`).stdout);
      assert.equal(projection.operations.purchase_available, false);
      assert.equal(projection.operations.purchase_blocker, 'creator_premium_purchase_disabled');
      assert.equal(projection.plans[0].subscription_available, false);
      assert.equal(projection.plans[0].subscription_blocker, 'creator_premium_subscription_disabled');
      assert.equal(Object.keys(projection.policy).length, 5);
      assert.equal(projection.policy.purchase_enabled, false);
      assert.equal(projection.policy.subscription_enabled, false);
      assert.equal(projection.policy.refunds_enabled, false);
      assert.equal(projection.policy.platform_fee_bps, 0);
      assert.deepEqual(parseCreatorPremiumCommerce(projection, id.content), projection);
      assert.equal(JSON.stringify(projection).includes(id.authorization), false);
      const subscriptions = JSON.parse(authenticated(db, id.outsider, 'select public.get_my_creator_premium_subscriptions_v1(null,null,50)').stdout);
      assert.deepEqual(parseCreatorPremiumSubscriptionsPage(subscriptions), subscriptions);
      assert.equal(subscriptions.policy.subscription_enabled, false);
    });
    await scenario('v1 projections report effective OFF even for the approved canary participant', db => {
      const projection = JSON.parse(authenticated(db, id.buyer, `select public.get_creator_premium_commerce_v1('${id.content}')`).stdout);
      assert.equal(projection.operations.purchase_available, false);
      assert.equal(projection.policy.purchase_enabled, false);
      assert.equal(projection.policy.platform_fee_bps, 0);
      assert.deepEqual(parseCreatorPremiumCommerce(projection, id.content), projection);
    });
    await scenario('v2 projections expose safe denied and capped blockers to upgraded clients', db => {
      assert.equal(sql(db, "select to_regprocedure('public.get_creator_premium_commerce_v2(uuid)') is not null").stdout, 't');
      assert.equal(sql(db, "select to_regprocedure('public.get_my_creator_premium_subscriptions_v2(timestamp with time zone,uuid,integer)') is not null").stdout, 't');
      const deniedProjection = JSON.parse(authenticated(db, id.outsider, `select public.get_creator_premium_commerce_v2('${id.content}')`).stdout);
      assert.equal(deniedProjection.operations.purchase_blocker, 'creator_premium_canary_denied');
      assert.equal(Object.keys(deniedProjection.policy).length, 5);
      const first = success(db, purchaseSql());
      success(db, `select public.refund_creator_premium_purchase_v1('${first.receipt_id}','${randomUUID()}','owner_approved')`);
      const capped = JSON.parse(authenticated(db, id.buyer, `select public.get_creator_premium_commerce_v2('${id.content}')`).stdout);
      assert.equal(capped.operations.purchase_blocker, 'creator_premium_canary_limit_reached');
      assert.equal(capped.operations.purchase_available, false);
    });
    await scenario('capped projections block acquisition while a paid subscription remains usable', db => {
      const purchase = success(db, purchaseSql()); const subscription = success(db, subscribeSql());
      success(db, `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`);
      const projection = JSON.parse(authenticated(db, id.buyer, `select public.get_creator_premium_commerce_v1('${id.content}')`).stdout);
      assert.equal(projection.operations.purchase_available, false);
      assert.equal(projection.operations.purchase_blocker, 'creator_premium_purchase_disabled');
      assert.equal(projection.entitlement.allowed, true);
      assert.equal(success(db, `select public.cancel_creator_premium_subscription_v1('${id.buyer}','${subscription.subscription_id}','${randomUUID()}')`).money_moved, false);
    });
    await scenario('failed ledger debit rolls back all facts, velocity and authorization consumption', db => {
      sql(db, `update public.ledger_accounts set balance=0 where id='${id.buyerAccount}'`);
      unchangedDenial(db, purchaseSql(), /(?:insufficient|balance)/i);
      sql(db, `update public.ledger_accounts set balance=200 where id='${id.buyerAccount}'`);
      assert.equal(success(db, purchaseSql()).money_moved, true);
      assert.equal(sql(db, 'select count(*) from private.creator_premium_purchase_receipts').stdout, '1');
    });

    await scenario('refund-versus-exact-replay uses a nonlocking immutable replay probe', async db => {
      const key = randomUUID();
      const purchase = success(db, purchaseSql(id.buyer, id.content, id.offer, key));
      const marker = Math.floor(Math.random() * 1_000_000_000) + 1;
      const refund = dockerAsync(pgCommand(db), `begin;set local request.jwt.claim.role='service_role';
        set local role service_role;
        select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved');
        select pg_advisory_xact_lock(${marker});select pg_sleep(4);commit;`);
      try {
        await waitForLock(db, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`);
        const replay = sql(db, `begin;set local statement_timeout='1s';
          set local request.jwt.claim.role='service_role';set local role service_role;
          ${purchaseSql(id.buyer, id.content, id.offer, key)};commit;`, true);
        assert.equal(replay.status, 0, `exact immutable replay waited for a refundable fact lock: ${replay.stderr}`);
        assert.equal(JSON.parse(replay.stdout).money_moved, false);
      } finally {
        const result = await refund; assert.equal(result.status, 0, result.stderr);
      }
      assert.equal(sql(db, 'select count(*) from private.creator_premium_purchase_receipts').stdout, '1');
      assert.equal(sql(db, "select count(*) from public.financial_transactions where operation_type='creator_premium_purchase'").stdout, '1');
    });

    await scenario('no-op versus new charge versus disarm settles without a deadlock or lost rights', async db => {
      success(db, purchaseSql());
      // Disarm first holds policy, then queue both commands. The no-op must be
      // revalidated and returned after that lock, while the new charge is denied.
      const marker = Math.floor(Math.random() * 1_000_000_000) + 1;
      const disarm = dockerAsync(pgCommand(db), `begin;set session_replication_role=replica;
        update private.creator_premium_finance_policy set purchase_enabled=false,subscription_enabled=false,
          refunds_enabled=false,platform_fee_bps=0
          ${hasF3 ? ",activation_mode='off',active_authorization_id=null" : ''} where singleton;
        select pg_advisory_xact_lock(${marker});select pg_sleep(3);commit;`);
      await waitForLock(db, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`);
      const [noOp, charge, stopped] = await Promise.all([
        dockerAsync(pgCommand(db), serviceSql(purchaseSql())),
        dockerAsync(pgCommand(db), serviceSql(subscribeSql())), disarm,
      ]);
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(noOp.status, 0, `already-owned no-op was lost during disarm: ${noOp.stderr}`);
      assert.equal(JSON.parse(noOp.stdout).money_moved, false);
      denied(charge, /creator_premium_subscription_disabled/);
      for (const result of [noOp, charge, stopped]) assert.doesNotMatch(result.stderr, /deadlock detected|statement timeout/i);
      assert.equal(sql(db, 'select count(*) from private.creator_premium_subscription_periods').stdout, '0');
      assert.equal(authenticated(db, id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`).stdout, 't');
    });

    await scenario('refund waits on policy before locking its receipt (no inverted fact lock)', async db => {
      const purchase = success(db, purchaseSql());
      const marker = Math.floor(Math.random() * 1_000_000_000) + 1;
      const holder = dockerAsync(pgCommand(db), `begin;set local statement_timeout='10s';
        select singleton from private.creator_premium_finance_policy where singleton for update;
        select pg_advisory_xact_lock(${marker});select pg_sleep(4);commit;`);
      await waitForLock(db, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`);
      const refund = dockerAsync(pgCommand(db), serviceSql(
        `select public.refund_creator_premium_purchase_v1('${purchase.receipt_id}','${randomUUID()}','owner_approved')`));
      try {
        await waitForLock(db, `select exists(select 1 from pg_stat_activity where datname=current_database()
          and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%select public.refund_creator_premium_purchase_v1%')`);
        const factLock = sql(db, `begin;select id from private.creator_premium_purchase_receipts
          where id='${purchase.receipt_id}' for update nowait;rollback;`, true);
        assert.equal(factLock.status, 0, `refund locked the receipt while waiting on policy: ${factLock.stderr}`);
      } finally {
        const settled = await Promise.all([holder, refund]);
        for (const result of settled) assert.equal(result.status, 0, result.stderr);
      }
    });

    await scenario('subscription refund waits on policy before locking its paid-period fact', async db => {
      const subscription = success(db, subscribeSql());
      const marker = Math.floor(Math.random() * 1_000_000_000) + 1;
      const holder = dockerAsync(pgCommand(db), `begin;set local statement_timeout='10s';
        select singleton from private.creator_premium_finance_policy where singleton for update;
        select pg_advisory_xact_lock(${marker});select pg_sleep(4);commit;`);
      await waitForLock(db, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`);
      const refund = dockerAsync(pgCommand(db), serviceSql(
        `select public.refund_creator_premium_subscription_period_v1('${subscription.period_id}','${randomUUID()}','owner_approved')`));
      try {
        await waitForLock(db, `select exists(select 1 from pg_stat_activity where datname=current_database()
          and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%select public.refund_creator_premium_subscription_period_v1%')`);
        const factLock = sql(db, `begin;select id from private.creator_premium_subscription_periods
          where id='${subscription.period_id}' for update nowait;rollback;`, true);
        assert.equal(factLock.status, 0, `refund locked its paid-period fact while waiting on policy: ${factLock.stderr}`);
      } finally {
        for (const result of await Promise.all([holder, refund])) assert.equal(result.status, 0, result.stderr);
      }
    });

    await scenario('Admin activation read requires capability and exposes no ledger-account identities', db => {
      const exists = sql(db, "select to_regprocedure('public.get_admin_creator_premium_finance_activation_v1()') is not null").stdout;
      assert.equal(exists, 't', 'separate Admin activation RPC is missing');
      const unauthorized = authenticated(db, id.buyer, 'select public.get_admin_creator_premium_finance_activation_v1()', true);
      denied(unauthorized, /admin_capability_forbidden/);
      const response = JSON.parse(authenticated(db, id.admin, 'select public.get_admin_creator_premium_finance_activation_v1()').stdout);
      assert.equal(response.activation.mode, 'canary');
      assert.equal(response.activation.consumed.gross_bdag, '0.00000000');
      for (const account of [id.buyerAccount, id.creatorAccount, id.platformAccount]) assert.equal(JSON.stringify(response).includes(account), false);
    });
    await scenario('authorization table is FORCE RLS private and immutable; public activation is rejected', db => {
      assert.equal(hasF3, true, 'authorization authority is absent');
      assert.equal(sql(db, `select relrowsecurity and relforcerowsecurity from pg_class where oid='private.creator_premium_finance_authorizations'::regclass`).stdout, 't');
      const clientRead = authenticated(db, id.buyer, 'select * from private.creator_premium_finance_authorizations', true);
      assert.notEqual(clientRead.status, 0);
      for (const query of [
        `update private.creator_premium_finance_authorizations set max_purchase_count=2 where id='${id.authorization}'`,
        `delete from private.creator_premium_finance_authorizations where id='${id.authorization}'`,
        "update private.creator_premium_finance_policy set activation_mode='public' where singleton",
      ]) assert.notEqual(sql(db, query, true).status, 0, query);
    });
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${base}`, '', true);
  }
});
