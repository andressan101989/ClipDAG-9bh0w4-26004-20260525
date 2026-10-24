// Real disposable PostgreSQL proof. Set RUN_CREATOR_PREMIUM_F2_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseCreatorPremiumPurchaseReceipt } from '../services/creatorPremiumFinanceContracts.mjs';

const enabled = process.env.RUN_CREATOR_PREMIUM_F2_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2';
const wslNamespacePid = process.env.CREATOR_PREMIUM_PG_WSL_PID || '';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const phases = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
  '_creator_premium_f2_complete_monetization.sql',
];
const chain = phases.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    suffix,
    found,
    sql: found.length === 1
      ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
      : '',
  };
});

function docker(command, { input = '', allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function dockerAsync(command, { input = '' } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return docker(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: sql, ...options },
  );
}

function asService(db, sql, options = {}) {
  return psql(
    db,
    `begin;set local request.jwt.claim.role='service_role';set local role service_role;${sql};commit;`,
    options,
  );
}

function asAuthenticated(db, actor, sql, options = {}) {
  return psql(
    db,
    `begin;set local request.jwt.claim.sub='${actor}';set local request.jwt.claim.role='authenticated';set local role authenticated;${sql};commit;`,
    options,
  );
}

function asServiceAsync(db, sql) {
  return dockerAsync(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: `begin;set local request.jwt.claim.role='service_role';set local role service_role;${sql};commit;` },
  );
}

function command(db, name, args, options = {}) {
  return asService(
    db,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
    options,
  );
}

function commandAsync(db, name, args) {
  return asServiceAsync(
    db,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
  );
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'));
}

function json(result) {
  return JSON.parse(result.stdout);
}

test('F2 disposable harness binds the canonical B1-B7 chain and one F2 migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix);
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_f2_complete_monetization\.sql$/);
});

test('F2 manual renewal keeps one immutable relationship per paid period and refunds only that history', {
  skip: !enabled,
  timeout: 600_000,
}, async () => {
  const db = `premium_f2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const uid = () => randomUUID();
  const id = {
    creator: uid(),
    buyer: uid(),
    buyer2: uid(),
    content: uid(),
    content2: uid(),
    content3: uid(),
    scan: uid(),
    scan2: uid(),
    scan3: uid(),
    offer: uid(),
    offer2: uid(),
    offer3: uid(),
    teaserAsset: uid(),
    originalAsset: uid(),
    plan: uid(),
    planV2: uid(),
    purchaseKey: uid(),
    firstKey: uid(),
    firstCancelKey: uid(),
    activeNoOpKey: uid(),
    cancelledNoOpKey: uid(),
    renewalKey: uid(),
    refundKey: uid(),
    raceKeyA: uid(),
    raceKeyB: uid(),
    familyOverlapKey: uid(),
    velocityRaceKeyA: uid(),
    velocityRaceKeyB: uid(),
    subscriptionVelocityKey: uid(),
  };
  const balances = () => psql(db, `
    select coalesce(pg_catalog.jsonb_object_agg(
      coalesce(owner_id::text,account_type),balance
      order by coalesce(owner_id::text,account_type)
    ),'{}'::jsonb)
    from public.ledger_accounts
    where (owner_id in ('${id.creator}','${id.buyer}') and account_type='user')
       or (owner_id is null and account_type='platform' and currency='BDAG');
  `).stdout;
  const financeCounts = () => psql(db, `
    select pg_catalog.count(*)||'|'||(select pg_catalog.count(*) from public.ledger_entries)
    from public.financial_transactions;
  `).stdout;
  const velocityCount = (actor, operation) => psql(db, `
    select coalesce(pg_catalog.sum(count),0)
    from public.velocity_counters
    where user_id='${actor}' and operation_type='${operation}'
      and window_end>pg_catalog.clock_timestamp()-interval '24 hours';
  `).stdout;

  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, chain.slice(0, -2).map(item => item.sql).join('\n'));
    psql(db, `
      insert into private.admin_roles(
        role_code,display_name,description,is_assignable,is_root,is_exclusive
      ) values(
        'MODERATOR','Moderator','Cross-domain safety and moderation authority.',
        true,false,false
      ) on conflict(role_code) do nothing;
      insert into private.admin_capabilities(
        capability_code,domain,effect,description,is_sensitive
      ) values(
        'content.items.moderate','content','write','Moderate content.',true
      ) on conflict(capability_code) do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values
        ('SUPER_ADMIN','content.items.moderate'),
        ('MODERATOR','content.items.moderate')
      on conflict(role_code,capability_code) do nothing;
    `);
    psql(db, chain.slice(-2).map(item => item.sql).join('\n'));

    assert.equal(psql(db, `
      select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps
      from private.creator_premium_finance_policy where singleton;
    `).stdout, 'false|false|false|0');
    assert.equal(psql(db, `
      select concat_ws('|',
        pg_catalog.has_function_privilege('public','public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)','execute'),
        pg_catalog.has_function_privilege('anon','public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)','execute'),
        pg_catalog.has_function_privilege('authenticated','public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)','execute'),
        pg_catalog.has_function_privilege('service_role','public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid)','execute'));
    `).stdout, 'f|f|f|t');

    psql(db, `
      truncate table public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;
      insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
      values(null,'platform','BDAG',0,false);
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous)
      values('${id.creator}',false),('${id.buyer}',false),('${id.buyer2}',false);
      insert into public.user_profiles(id,username)
      values('${id.creator}','premium_f2_creator'),('${id.buyer}','premium_f2_buyer'),
            ('${id.buyer2}','premium_f2_buyer_two');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select fixture.user_id,'eligible',policy.minimum_age,policy.policy_version,
             pg_catalog.clock_timestamp(),'signup_metadata','age_18_plus',
             current_date-fixture.years*interval '1 year'
      from (values('${id.creator}'::uuid,30),('${id.buyer}'::uuid,25),
                  ('${id.buyer2}'::uuid,28)) fixture(user_id,years)
      cross join private.age_eligibility_policy policy where policy.singleton;
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,
        requested_reason,detector_version,text_status,audio_status,visual_status,
        reports_status,attempt_count,available_at,started_at,completed_at,created_at,updated_at
      ) values(
        '${id.scan}','creator_premium','${id.content}','${id.creator}',repeat('a',64),
        'completed','content_created','f2-disposable-v1','analyzed','not_applicable',
        'not_applicable','analyzed',1,current_timestamp,current_timestamp,current_timestamp,
        current_timestamp,current_timestamp
      ),(
        '${id.scan2}','creator_premium','${id.content2}','${id.creator}',repeat('b',64),
        'completed','content_created','f2-disposable-v1','analyzed','not_applicable',
        'not_applicable','analyzed',1,current_timestamp,current_timestamp,current_timestamp,
        current_timestamp,current_timestamp
      ),(
        '${id.scan3}','creator_premium','${id.content3}','${id.creator}',repeat('c',64),
        'completed','content_created','f2-disposable-v1','analyzed','not_applicable',
        'not_applicable','analyzed',1,current_timestamp,current_timestamp,current_timestamp,
        current_timestamp,current_timestamp
      );
      insert into private.creator_premium_contents(
        id,creator_id,title,content_kind,access_mode,lifecycle_status,
        submitted_at,published_at,verification_generation,verification_scan_id,
        verification_fingerprint,verification_status,verification_requested_at,
        verification_completed_at
      ) values(
        '${id.content}','${id.creator}','F2 commerce content','image',
        'purchase_or_subscription','published',pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),1,'${id.scan}',repeat('a',64),'passed',
        pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
      ),(
        '${id.content2}','${id.creator}','F2 velocity A','image',
        'purchase','published',pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),1,'${id.scan2}',repeat('b',64),'passed',
        pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
      ),(
        '${id.content3}','${id.creator}','F2 velocity B','image',
        'purchase','published',pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),1,'${id.scan3}',repeat('c',64),'passed',
        pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
      );
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,status,activated_at
      ) values(
        '${id.offer}','${id.content}','${id.creator}',1,15.00000000,
        'active',pg_catalog.clock_timestamp()
      ),(
        '${id.offer2}','${id.content2}','${id.creator}',1,10.00000000,
        'active',pg_catalog.clock_timestamp()
      ),(
        '${id.offer3}','${id.content3}','${id.creator}',1,10.00000000,
        'active',pg_catalog.clock_timestamp()
      );
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,price_bdag,currency,status,
        activated_at,billing_period_days
      ) values(
        '${id.plan}','${id.creator}','f2_manual',1,'F2 manual',20.00000000,
        'BDAG','active',pg_catalog.clock_timestamp(),30
      ),(
        '${id.planV2}','${id.creator}','f2_manual',2,'F2 manual v2',25.00000000,
        'BDAG','draft',null,30
      );
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.content}','${id.creator}'),
            ('${id.planV2}','${id.content}','${id.creator}');
      insert into public.media_assets(
        id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
        mime_type,status,public_url,ready_at
      ) values(
        '${id.teaserAsset}','${id.creator}','r2','image','creator_premium_teaser_image',
        'public','clipdag-public-media','f2/teaser.jpg','image/jpeg','ready',
        'https://media.example.invalid/f2-teaser.jpg',pg_catalog.clock_timestamp()
      ),(
        '${id.originalAsset}','${id.creator}','r2','image','creator_premium_original_image',
        'private','clipdag-private-media','f2/original.jpg','image/jpeg','ready',
        null,pg_catalog.clock_timestamp()
      );
      insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,"position")
      values('${id.teaserAsset}','creator_premium_content','${id.content}','teaser',0),
            ('${id.originalAsset}','creator_premium_content','${id.content}','original',0);
      set session_replication_role=origin;
      select public.ensure_ledger_account('${id.creator}');
      select public.ensure_ledger_account('${id.buyer}');
      select public.ensure_ledger_account('${id.buyer2}');
      update public.ledger_accounts set balance=200,frozen=false
      where owner_id='${id.buyer}' and account_type='user';
      update public.ledger_accounts set balance=0,frozen=false
      where owner_id='${id.creator}' and account_type='user';
      update public.ledger_accounts set balance=200,frozen=false
      where owner_id='${id.buyer2}' and account_type='user';
    `);

    assert.equal(asService(
      db,
      `set local search_path='';
       select public.check_velocity_limit(
         '${id.buyer2}','creator_premium_f2_search_path_probe',0,1,0,1
       )`,
    ).stdout, 't');

    const offBalances = balances();
    const offCounts = financeCounts();
    expectFailure(
      command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.firstKey], { allowFailure: true }),
      'creator_premium_subscription_disabled',
    );
    expectFailure(
      command(db, 'purchase_creator_premium_content_v1', [id.buyer, id.content, id.purchaseKey], { allowFailure: true }),
      'creator_premium_purchase_disabled',
    );
    assert.equal(balances(), offBalances);
    assert.equal(financeCounts(), offCounts);
    assert.equal(psql(db, `select pg_catalog.count(*) from private.creator_premium_subscriptions`).stdout, '0');
    assert.equal(psql(db, `select pg_catalog.count(*) from public.idempotency_keys where operation_type='creator_premium_subscription_command'`).stdout, '0');

    psql(db, `
      update private.creator_premium_finance_policy
      set purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000,
          updated_at=pg_catalog.clock_timestamp()
      where singleton;
    `);

    psql(db, `
      insert into public.velocity_counters(
        user_id,operation_type,window_start,window_end,count,total_amount
      ) values(
        '${id.buyer2}','creator_premium_purchase',pg_catalog.date_trunc('hour',pg_catalog.clock_timestamp()),
        pg_catalog.date_trunc('hour',pg_catalog.clock_timestamp())+interval '1 hour',99,0
      ) on conflict(user_id,operation_type,window_start)
        do update set count=99,total_amount=0;
    `);
    const beforeVelocityRaceCounts = financeCounts().split('|').map(Number);
    const velocityRace = await Promise.all([
      commandAsync(db, 'purchase_creator_premium_content_v1', [id.buyer2, id.content2, id.velocityRaceKeyA]),
      commandAsync(db, 'purchase_creator_premium_content_v1', [id.buyer2, id.content3, id.velocityRaceKeyB]),
    ]);
    assert.equal(velocityRace.filter(result => result.status === 0).length, 1);
    assert.equal(velocityRace.filter(result => result.status !== 0).length, 1);
    assert.match(
      velocityRace.find(result => result.status !== 0).stderr,
      /creator_premium_rate_limited/i,
    );
    assert.equal(velocityCount(id.buyer2, 'creator_premium_purchase'), '100');
    const afterVelocityRaceCounts = financeCounts().split('|').map(Number);
    assert.deepEqual(
      afterVelocityRaceCounts,
      [beforeVelocityRaceCounts[0] + 1, beforeVelocityRaceCounts[1] + 3],
    );

    const purchase = json(command(
      db,
      'purchase_creator_premium_content_v1',
      [id.buyer, id.content, id.purchaseKey],
    ));
    assert.deepEqual(
      parseCreatorPremiumPurchaseReceipt(purchase, id.content),
      purchase,
    );
    assert.equal(purchase.gross_amount_bdag, '15.00000000');
    assert.equal(purchase.platform_fee_bdag, '1.50000000');
    assert.equal(purchase.creator_net_bdag, '13.50000000');
    assert.equal(velocityCount(id.buyer, 'creator_premium_purchase'), '1');
    const purchaseReplay = json(command(
      db,
      'purchase_creator_premium_content_v1',
      [id.buyer, id.content, id.purchaseKey],
    ));
    assert.deepEqual(parseCreatorPremiumPurchaseReceipt(purchaseReplay, id.content), purchaseReplay);
    assert.equal(purchaseReplay.money_moved, false);
    assert.equal(purchaseReplay.replayed, true);
    assert.equal(velocityCount(id.buyer, 'creator_premium_purchase'), '1');

    const first = json(command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.firstKey]));
    assert.equal(first.money_moved, true);
    assert.equal(first.replayed, false);
    assert.equal(first.already_subscribed, false);
    assert.equal(first.renewed, false);
    assert.equal(first.plan_id, id.plan);
    assert.equal(first.auto_renew, false);
    assert.equal(first.gross_amount_bdag, '20.00000000');
    assert.equal(first.platform_fee_bdag, '2.00000000');
    assert.equal(first.creator_net_bdag, '18.00000000');
    assert.equal(velocityCount(id.buyer, 'creator_premium_subscribe'), '1');
    assert.deepEqual(Object.keys(first).sort(), [
      'already_subscribed',
      'auto_renew',
      'billing_period_days',
      'creator_net_bdag',
      'financial_transaction_id',
      'gross_amount_bdag',
      'money_moved',
      'paid_through_at',
      'period_id',
      'plan_id',
      'platform_fee_bdag',
      'renewed',
      'replayed',
      'starts_at',
      'status',
      'subscription_id',
    ].sort());
    const afterFirstCounts = financeCounts();
    const firstReplay = json(command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.firstKey]));
    assert.equal(firstReplay.subscription_id, first.subscription_id);
    assert.equal(firstReplay.period_id, first.period_id);
    assert.equal(firstReplay.money_moved, false);
    assert.equal(firstReplay.replayed, true);
    assert.equal(firstReplay.plan_id, id.plan);
    assert.equal(firstReplay.gross_amount_bdag, '20.00000000');
    assert.equal(financeCounts(), afterFirstCounts);
    assert.equal(velocityCount(id.buyer, 'creator_premium_subscribe'), '1');

    const activeNoOp = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.activeNoOpKey],
    ));
    assert.equal(activeNoOp.subscription_id, first.subscription_id);
    assert.equal(activeNoOp.money_moved, false);
    assert.equal(activeNoOp.replayed, false);
    assert.equal(activeNoOp.already_subscribed, true);
    assert.equal(activeNoOp.renewed, false);
    assert.equal(activeNoOp.plan_id, id.plan);
    assert.equal(activeNoOp.auto_renew, false);
    assert.equal(activeNoOp.gross_amount_bdag, '20.00000000');
    assert.equal(financeCounts(), afterFirstCounts);
    assert.equal(velocityCount(id.buyer, 'creator_premium_subscribe'), '1');
    assert.equal(psql(db, `
      select status||'|'||(response_body->>'money_moved')||'|'||(response_body->>'replayed')
      from public.idempotency_keys
      where idempotency_key='${id.activeNoOpKey}'
        and operation_type='creator_premium_subscription_command'
        and user_id='${id.buyer}';
    `).stdout, 'completed|false|false');

    const cancelled = json(command(
      db,
      'cancel_creator_premium_subscription_v1',
      [id.buyer, first.subscription_id, id.firstCancelKey],
    ));
    assert.equal(cancelled.status, 'cancelled');
    const cancelledNoOp = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.cancelledNoOpKey],
    ));
    assert.equal(cancelledNoOp.status, 'cancelled');
    assert.equal(cancelledNoOp.money_moved, false);
    assert.equal(psql(db, `select status from private.creator_premium_subscriptions where id='${first.subscription_id}'`).stdout, 'cancelled');
    assert.equal(asAuthenticated(
      db,
      id.buyer,
      `select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`,
    ).stdout, 't');

    psql(db, `
      set session_replication_role=replica;
      update private.creator_premium_subscription_periods
      set starts_at=pg_catalog.clock_timestamp()-interval '31 days',
          paid_through_at=pg_catalog.clock_timestamp()-interval '1 day',
          updated_at=pg_catalog.clock_timestamp()
      where id='${first.period_id}';
      update private.creator_premium_subscriptions
      set started_at=pg_catalog.clock_timestamp()-interval '31 days',
          cancelled_at=pg_catalog.clock_timestamp()-interval '2 days',
          updated_at=pg_catalog.clock_timestamp()
      where id='${first.subscription_id}';
      set session_replication_role=origin;
    `);

    const expiredProjection = json(asAuthenticated(
      db,
      id.buyer,
      'select public.get_my_creator_premium_subscriptions_v1(null,null,50)',
    ));
    const expiredItem = expiredProjection.items.find(item => item.id === first.subscription_id);
    assert.ok(expiredItem);
    assert.equal(expiredItem.status, 'expired');
    assert.equal(expiredItem.plan.relationship.status, 'expired');
    assert.equal(expiredItem.period.access_state, 'expired');
    assert.equal(expiredItem.plan.relationship.access_state, 'expired');
    assert.equal(expiredItem.access_active, false);
    assert.equal(expiredItem.renewal_available, true);
    assert.equal(expiredItem.renewal_blocker, null);

    const expiredCommerce = json(asAuthenticated(
      db,
      id.buyer,
      `select public.get_creator_premium_commerce_v1('${id.content}')`,
    ));
    const expiredCommercePlan = expiredCommerce.plans.find(plan => plan.id === id.plan);
    assert.ok(expiredCommercePlan);
    assert.equal(expiredCommercePlan.relationship.status, 'expired');
    assert.equal(expiredCommercePlan.relationship.access_state, 'expired');
    assert.equal(expiredCommercePlan.renewal_available, true);
    assert.equal(expiredCommercePlan.renewal_blocker, null);

    const beforeHistoricalReplayCounts = financeCounts();
    psql(db, `
      delete from public.idempotency_keys
      where idempotency_key='${id.firstKey}'
        and operation_type='creator_premium_subscription_command'
        and user_id='${id.buyer}';
    `);
    const historicalReplay = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.firstKey],
    ));
    assert.equal(historicalReplay.subscription_id, first.subscription_id);
    assert.equal(historicalReplay.period_id, first.period_id);
    assert.equal(historicalReplay.money_moved, false);
    assert.equal(historicalReplay.replayed, true);
    assert.equal(historicalReplay.gross_amount_bdag, '20.00000000');
    assert.equal(financeCounts(), beforeHistoricalReplayCounts);
    assert.equal(psql(db, `
      select status||'|'||(response_body->>'replayed')
      from public.idempotency_keys
      where idempotency_key='${id.firstKey}'
        and operation_type='creator_premium_subscription_command'
        and user_id='${id.buyer}';
    `).stdout, 'completed|true');

    const beforeCrossPlanReplay = financeCounts();
    psql(db, `
      delete from public.idempotency_keys
      where idempotency_key='${id.firstKey}'
        and operation_type='creator_premium_subscription_command'
        and user_id='${id.buyer}';
    `);
    expectFailure(
      command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.planV2, id.firstKey], { allowFailure: true }),
      'creator_premium_subscription_idempotency_conflict',
    );
    assert.equal(financeCounts(), beforeCrossPlanReplay);
    const historicalReplayRestored = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.firstKey],
    ));
    assert.equal(historicalReplayRestored.replayed, true);
    assert.equal(historicalReplayRestored.money_moved, false);

    const staleNoOpReplay = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.cancelledNoOpKey],
    ));
    assert.equal(staleNoOpReplay.subscription_id, first.subscription_id);
    assert.equal(staleNoOpReplay.money_moved, false);
    assert.equal(staleNoOpReplay.replayed, true);
    assert.equal(financeCounts(), afterFirstCounts);
    assert.equal(asAuthenticated(
      db,
      id.buyer,
      `select allowed||'|'||source
       from public.get_my_creator_premium_entitlement_v1('${id.content}')`,
    ).stdout, 'true|purchase');

    const renewed = json(command(
      db,
      'subscribe_creator_premium_plan_v1',
      [id.buyer, id.plan, id.renewalKey],
    ));
    assert.equal(renewed.money_moved, true);
    assert.equal(renewed.replayed, false);
    assert.equal(renewed.already_subscribed, true);
    assert.equal(renewed.renewed, true);
    assert.equal(renewed.plan_id, id.plan);
    assert.equal(renewed.auto_renew, false);
    assert.equal(renewed.gross_amount_bdag, '20.00000000');
    assert.equal(renewed.platform_fee_bdag, '2.00000000');
    assert.equal(renewed.creator_net_bdag, '18.00000000');
    assert.equal(velocityCount(id.buyer, 'creator_premium_subscribe'), '2');
    assert.notEqual(renewed.subscription_id, first.subscription_id);
    assert.notEqual(renewed.period_id, first.period_id);
    assert.equal(psql(db, `
      select pg_catalog.string_agg(status,',' order by created_at,id)
      from private.creator_premium_subscriptions
      where subscriber_id='${id.buyer}' and plan_id='${id.plan}';
    `).stdout, 'expired,active');
    assert.equal(psql(db, `select access_state from private.creator_premium_subscription_periods where id='${first.period_id}'`).stdout, 'expired');
    assert.equal(psql(db, `select private.creator_premium_subscription_period_fact_is_valid_f2_v1('${first.period_id}')`).stdout, 't');
    assert.equal(psql(db, `
      select pg_catalog.count(*) from private.creator_premium_subscriptions
      where subscriber_id='${id.buyer}' and plan_id='${id.plan}'
        and status in ('pending','active','cancelled');
    `).stdout, '1');

    const refunded = json(command(
      db,
      'refund_creator_premium_subscription_period_v1',
      [first.period_id, id.refundKey, 'admin_requested'],
    ));
    assert.equal(refunded.money_moved, true);
    assert.equal(refunded.access_state, 'refunded');
    assert.equal(psql(db, `select status from private.creator_premium_subscriptions where id='${first.subscription_id}'`).stdout, 'revoked');
    assert.equal(psql(db, `select status from private.creator_premium_subscriptions where id='${renewed.subscription_id}'`).stdout, 'active');
    assert.equal(psql(db, `select access_state from private.creator_premium_subscription_periods where id='${renewed.period_id}'`).stdout, 'active');
    assert.equal(asAuthenticated(
      db,
      id.buyer,
      `select allowed from public.get_my_creator_premium_entitlement_v1('${id.content}')`,
    ).stdout, 't');

    psql(db, `
      set session_replication_role=replica;
      update public.financial_transactions
      set created_at=pg_catalog.clock_timestamp()-interval '2 days'
      where operation_type in ('creator_premium_purchase','creator_premium_subscription');
      set session_replication_role=origin;
    `);
    const refundOnlySummary = json(asAuthenticated(
      db,
      id.creator,
      `select public.get_my_creator_premium_commercial_summary_v1(
        pg_catalog.clock_timestamp()-interval '1 hour',
        pg_catalog.clock_timestamp()+interval '1 hour'
      )`,
    ));
    assert.equal(refundOnlySummary.gross, '0.00000000');
    assert.equal(refundOnlySummary.creator_net, '0.00000000');
    assert.equal(refundOnlySummary.refund, '20.00000000');
    assert.equal(refundOnlySummary.net_retained, '-18.00000000');

    psql(db, `
      set session_replication_role=replica;
      update private.creator_premium_subscription_periods
      set starts_at=pg_catalog.clock_timestamp()-interval '31 days',
          paid_through_at=pg_catalog.clock_timestamp()-interval '1 day',
          updated_at=pg_catalog.clock_timestamp()
      where id='${renewed.period_id}';
      update private.creator_premium_subscriptions
      set started_at=pg_catalog.clock_timestamp()-interval '31 days',
          updated_at=pg_catalog.clock_timestamp()
      where id='${renewed.subscription_id}';
      set session_replication_role=origin;
    `);
    const beforeRaceCounts = financeCounts().split('|').map(Number);
    const concurrent = await Promise.all([
      commandAsync(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.raceKeyA]),
      commandAsync(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.raceKeyB]),
    ]);
    for (const result of concurrent) assert.equal(result.status, 0, result.stderr);
    const raceResults = concurrent.map(result => JSON.parse(result.stdout));
    assert.equal(raceResults.filter(result => result.money_moved === true).length, 1);
    assert.equal(raceResults.filter(result => result.money_moved === false).length, 1);
    assert.equal(raceResults.filter(result => result.renewed === true).length, 1);
    const afterRaceCounts = financeCounts().split('|').map(Number);
    assert.deepEqual(afterRaceCounts, [beforeRaceCounts[0] + 1, beforeRaceCounts[1] + 3]);
    assert.equal(psql(db, `
      select pg_catalog.count(*) from private.creator_premium_subscriptions
      where subscriber_id='${id.buyer}' and plan_id='${id.plan}'
        and status in ('pending','active','cancelled');
    `).stdout, '1');
    assert.equal(psql(db, `
      select pg_catalog.count(*) from public.idempotency_keys
      where operation_type='creator_premium_subscription_command'
        and user_id='${id.buyer}' and idempotency_key in ('${id.raceKeyA}','${id.raceKeyB}')
        and status='completed';
    `).stdout, '2');
    assert.equal(psql(db, `
      select pg_catalog.round(pg_catalog.sum(
        case when entry_type='credit' then amount else -amount end
      ),8)
      from public.ledger_entries
      where txn_id in(
        select id from public.financial_transactions
        where operation_type like 'creator_premium_%'
      );
    `).stdout, '0.00000000');
    assert.equal(velocityCount(id.buyer, 'creator_premium_subscribe'), '3');

    psql(db, `
      insert into public.velocity_counters(
        user_id,operation_type,window_start,window_end,count,total_amount
      ) values(
        '${id.buyer2}','creator_premium_subscribe',pg_catalog.date_trunc('hour',pg_catalog.clock_timestamp()),
        pg_catalog.date_trunc('hour',pg_catalog.clock_timestamp())+interval '1 hour',20,0
      ) on conflict(user_id,operation_type,window_start)
        do update set count=20,total_amount=0;
    `);
    const beforeSubscriptionVelocityCounts = financeCounts();
    expectFailure(
      command(
        db,
        'subscribe_creator_premium_plan_v1',
        [id.buyer2, id.plan, id.subscriptionVelocityKey],
        { allowFailure: true },
      ),
      'creator_premium_rate_limited',
    );
    assert.equal(financeCounts(), beforeSubscriptionVelocityCounts);
    assert.equal(velocityCount(id.buyer2, 'creator_premium_subscribe'), '20');

    const beforeFamilyVersionAttempt = financeCounts();
    const beforeFamilyVersionBalances = balances();
    psql(db, `
      update private.creator_premium_plans
      set status='retired',retired_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
      where id='${id.plan}';
      update private.creator_premium_plans
      set status='active',activated_at=pg_catalog.clock_timestamp(),retired_at=null,
          updated_at=pg_catalog.clock_timestamp()
      where id='${id.planV2}';
    `);
    expectFailure(
      command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.planV2, id.familyOverlapKey], { allowFailure: true }),
      'creator_premium_plan_family_access_active',
    );
    const familyCommerce = json(asAuthenticated(
      db,
      id.buyer,
      `select public.get_creator_premium_commerce_v1('${id.content}')`,
    ));
    assert.equal(familyCommerce.plans.length, 1);
    assert.equal(familyCommerce.plans[0].id, id.planV2);
    assert.equal(familyCommerce.plans[0].subscription_available, false);
    assert.equal(
      familyCommerce.plans[0].subscription_blocker,
      'creator_premium_plan_family_access_active',
    );
    assert.equal(
      familyCommerce.plans[0].renewal_blocker,
      'creator_premium_plan_family_access_active',
    );
    assert.equal(financeCounts(), beforeFamilyVersionAttempt);
    assert.equal(balances(), beforeFamilyVersionBalances);

    const beforeRetireBalances = balances();
    const beforeRetireCounts = financeCounts();
    expectFailure(
      command(db, 'subscribe_creator_premium_plan_v1', [id.buyer, id.plan, uid()], { allowFailure: true }),
      'creator_premium_active_plan_not_found',
    );
    assert.equal(balances(), beforeRetireBalances);
    assert.equal(financeCounts(), beforeRetireCounts);

    const retiredContent = asAuthenticated(
      db,
      id.creator,
      `select lifecycle_status||'|'||replayed
       from public.retire_my_creator_premium_content_v1('${id.content}')`,
    );
    assert.equal(retiredContent.stdout, 'removed|false');
    assert.equal(asAuthenticated(
      db,
      id.buyer,
      `select allowed||'|'||source
       from public.get_my_creator_premium_entitlement_v1('${id.content}')`,
    ).stdout, 'true|purchase');
    assert.equal(asAuthenticated(
      db,
      id.buyer,
      `select pg_catalog.count(*)
       from public.get_my_creator_premium_library_v1(24,null,null)
       where id='${id.content}'`,
    ).stdout, '1');
    const beforeWithdrawnSaleCounts = financeCounts();
    expectFailure(
      command(db, 'purchase_creator_premium_content_v1', [id.buyer, id.content, uid()], { allowFailure: true }),
      'creator_premium_content_not_published',
    );
    expectFailure(
      command(db, 'subscribe_creator_premium_plan_v1', [id.buyer2, id.planV2, uid()], { allowFailure: true }),
      'creator_premium_plan_has_no_valid_content',
    );
    assert.equal(financeCounts(), beforeWithdrawnSaleCounts);
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
