import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.RUN_CREATOR_PREMIUM_B7_LOCAL === '1';
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
];
const chain = phases.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    suffix,
    found,
    sql: found.length === 1 ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8') : '',
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
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return docker(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, { input: sql, ...options });
}

function asRole(db, role, actor, sql, options = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function asRoleAsync(db, role, actor, sql) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return dockerAsync(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, {
    input: `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`,
  });
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'));
}

function json(result) {
  return JSON.parse(result.stdout);
}

test('B7 disposable harness targets the complete single-migration Premium chain', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix);
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_b7_full_functional_commercial_completion\.sql$/);
  assert.ok(chain.at(-1).sql.length > 20_000);
});

test('B7 disposable harness contains executable lifecycle and financial invariants, not install-only smoke checks', () => {
  const source = readFileSync(new URL('./creatorPremiumB7Local.integration.mjs', import.meta.url), 'utf8');
  for (const contract of [
    'create_my_creator_premium_draft_v1',
    'submit_my_creator_premium_content_for_review_v1',
    'admin_review_creator_premium_content_v1',
    'purchase_creator_premium_content_v1',
    'subscribe_creator_premium_plan_v1',
    'cancel_creator_premium_subscription_v1',
    'admin_refund_creator_premium_purchase_v1',
    'admin_refund_creator_premium_subscription_period_v1',
    'get_my_creator_premium_entitlement_v1',
    'report_creator_premium_content_v1',
    'ledger_entries',
    'admin_action_audit',
    'admin_idempotency_conflict',
    'money_moved',
    'replayed',
    'already_refunded',
    'rollback',
  ]) assert.match(source, new RegExp(contract, 'i'), `missing executable proof: ${contract}`);
  assert.match(source, /1000[\s\S]*1\.00000000[\s\S]*9\.00000000/i, 'exact eight-decimal fee fixture is required');
  assert.match(source, /count\s*\(\s*\*\s*\)[\s\S]*public\.ledger_entries/i);
});

test('B7 disposable database proves moderation, safe commerce, reporting, policy gates, refunds, and entitlement', {
  skip: !enabled,
  timeout: 900_000,
}, async () => {
  const db = `premium_b7_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const uid = () => randomUUID();
  const id = {
    creator: uid(), buyer: uid(), other: uid(), admin: uid(),
    purchaseRequest: uid(), subscriptionRequest: uid(), moderationRequest: uid(),
    purchaseOfferRequest: uid(), moderationOfferRequest: uid(), planRequest: uid(),
    purchaseKey: uid(), subscriptionKey: uid(), cancelKey: uid(),
    purchaseRefundKey: uid(), periodRefundKey: uid(), rollbackKey: uid(),
    purchaseTeaser: uid(), purchaseOriginal: uid(), subscriptionTeaser: uid(),
    subscriptionOriginal: uid(), moderationTeaser: uid(), moderationOriginal: uid(),
  };
  const service = (name, args, options = {}) => asRole(
    db, 'service_role', null,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
    options,
  );
  const adminCommand = (name, args, options = {}) => asRole(
    db, 'authenticated', id.admin,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
    options,
  );
  const adminCommandAsync = (name, args) => asRoleAsync(
    db, 'authenticated', id.admin,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
  );
  const createDraft = (title, access, request) => json(asRole(db, 'authenticated', id.creator, `
    select to_jsonb(result) from public.create_my_creator_premium_draft_v1(
      '${title}','B7 disposable proof','image','${access}','${request}'
    ) result;
  `));
  const imageAsset = (assetId, purpose, visibility, publicUrl = null) => `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,status,ready_at,public_url
    ) values(
      '${assetId}','${id.creator}','r2','image','${purpose}','${visibility}',
      '${visibility === 'public' ? 'public-bucket' : 'private-bucket'}',
      'premium/${assetId}.jpg','image/jpeg',1000,'ready',clock_timestamp(),
      ${publicUrl ? `'${publicUrl}'` : 'null'}
    );`;
  const balances = () => psql(db, `
    select jsonb_object_agg(coalesce(owner_id::text,account_type),balance
      order by coalesce(owner_id::text,account_type))
    from public.ledger_accounts
    where (owner_id in ('${id.creator}','${id.buyer}') and account_type='user')
       or (owner_id is null and account_type='platform' and currency='BDAG');
  `).stdout;
  const financeCounts = () => psql(db, `
    select count(*)||'|'||(select count(*) from public.ledger_entries)
    from public.financial_transactions;
  `).stdout;
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, chain.map(item => item.sql).join('\n'));

    const functions = psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('search_admin_creator_premium_content_v1','get_admin_creator_premium_content_v1','admin_review_creator_premium_content_v1','get_creator_premium_commerce_v1','get_my_creator_premium_subscriptions_v1','get_my_creator_premium_commercial_summary_v1','admin_refund_creator_premium_purchase_v1','admin_refund_creator_premium_subscription_period_v1')`).stdout;
    assert.equal(functions, '8');

    psql(db, `
      truncate table public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;
      insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
      values(null,'platform','BDAG',30,false);
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.buyer}',false),('${id.other}',false),('${id.admin}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','b7_creator'),('${id.buyer}','b7_buyer'),
        ('${id.other}','b7_other'),('${id.admin}','b7_admin');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select fixture.user_id,'eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from (values('${id.creator}'::uuid),('${id.buyer}'::uuid),('${id.other}'::uuid),('${id.admin}'::uuid)) fixture(user_id)
      cross join private.age_eligibility_policy policy where policy.singleton=true;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values('SUPER_ADMIN','creator_premium.refunds.write')
      on conflict(role_code,capability_code) do nothing;
      insert into private.admin_user_roles(
        user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason
      ) values(
        '${id.admin}','SUPER_ADMIN','trusted_operator','b7-f1-disposable-fixture',
        'Disposable B7-F1 capability proof'
      );
      set session_replication_role=origin;
      select public.ensure_ledger_account('${id.creator}');
      select public.ensure_ledger_account('${id.buyer}');
      update public.ledger_accounts set balance=100,frozen=false
      where owner_id='${id.buyer}' and account_type='user';
      update public.ledger_accounts set balance=30,frozen=false
      where owner_id='${id.creator}' and account_type='user';
    `);

    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout, 'false|false|false|0');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.admin_review_creator_premium_content_v1('${uid()}','approve','reviewed','${uid()}')`, { allowFailure: true }), 'admin_capability_forbidden');
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.refund_creator_premium_purchase_v1(uuid,uuid,text)','execute')`).stdout, 'f');

    const purchase = createDraft('B7 purchase', 'purchase', id.purchaseRequest);
    const subscription = createDraft('B7 subscription', 'subscription', id.subscriptionRequest);
    const moderation = createDraft('B7 moderation', 'purchase', id.moderationRequest);
    expectFailure(asRole(db, 'authenticated', id.other, `select * from public.update_my_creator_premium_draft_v1('${purchase.id}','stolen','stolen','image','purchase')`, { allowFailure: true }), 'creator_premium_content_not_found');

    psql(db, `
      ${imageAsset(id.purchaseTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/purchase-teaser.jpg')}
      ${imageAsset(id.purchaseOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.subscriptionTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/subscription-teaser.jpg')}
      ${imageAsset(id.subscriptionOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.moderationTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/moderation-teaser.jpg')}
      ${imageAsset(id.moderationOriginal, 'creator_premium_original_image', 'private')}
    `);
    for (const [contentId, teaserId, originalId] of [
      [purchase.id,id.purchaseTeaser,id.purchaseOriginal],
      [subscription.id,id.subscriptionTeaser,id.subscriptionOriginal],
      [moderation.id,id.moderationTeaser,id.moderationOriginal],
    ]) {
      const attached = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${contentId}','${teaserId}','${originalId}') result`));
      assert.equal(attached.media_ready, true);
    }

    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${purchase.id}',10.00000000,'${id.purchaseOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${moderation.id}',4.00000000,'${id.moderationOfferRequest}') result`));
    const plan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('B7 plan','Disposable plan',20.00000000,30,'${id.planRequest}') result`));
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1('${plan.id}',array['${subscription.id}']::uuid[]) result`)).mapped_content_count, 1);

    for (const contentId of [purchase.id,subscription.id,moderation.id]) {
      assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${contentId}') result`)).lifecycle_status, 'pending_review');
    }
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.activate_my_creator_premium_plan_v1('${plan.id}') result`)).status, 'active');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.admin_review_creator_premium_content_v1('${purchase.id}','approve','self approval','${uid()}')`, { allowFailure: true }), 'admin_capability_forbidden');

    const review = (contentId, action, reason, key = uid()) => json(adminCommand(
      'admin_review_creator_premium_content_v1',[contentId,action,reason,key],
    ));
    const purchaseApproveKey = uid();
    assert.equal(review(purchase.id,'approve','verified purchase content',purchaseApproveKey).lifecycle_status, 'published');
    assert.equal(review(purchase.id,'approve','verified purchase content',purchaseApproveKey).replayed, true);
    expectFailure(adminCommand('admin_review_creator_premium_content_v1',[purchase.id,'remove','changed payload',purchaseApproveKey], { allowFailure: true }), 'admin_idempotency_conflict');
    assert.equal(review(subscription.id,'approve','verified subscription content').lifecycle_status, 'published');
    assert.equal(review(moderation.id,'reject','needs correction').lifecycle_status, 'rejected');
    assert.equal(review(moderation.id,'restore','creator may correct').lifecycle_status, 'pending_review');
    assert.equal(review(moderation.id,'approve','correction verified').lifecycle_status, 'published');
    assert.equal(review(moderation.id,'quarantine','safety review').lifecycle_status, 'quarantined');
    assert.equal(review(moderation.id,'restore','safety cleared').lifecycle_status, 'pending_review');
    assert.equal(review(moderation.id,'approve','restored review complete').lifecycle_status, 'published');
    assert.equal(review(moderation.id,'remove','owner policy removal').lifecycle_status, 'removed');
    assert.equal(review(moderation.id,'restore','new review required').lifecycle_status, 'pending_review');
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where target_id='${moderation.id}' and action like 'creator_premium.%'`).stdout, '8');

    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 'f');
    const disabledCounts = financeCounts(), disabledBalances = balances();
    expectFailure(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey], { allowFailure: true }), 'creator_premium_purchase_disabled');
    expectFailure(service('subscribe_creator_premium_plan_v1',[id.buyer,plan.id,id.subscriptionKey], { allowFailure: true }), 'creator_premium_subscription_disabled');
    assert.equal(financeCounts(), disabledCounts);assert.equal(balances(), disabledBalances);

    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000,updated_at=clock_timestamp()`);
    const purchaseResult = json(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey]));
    assert.equal(purchaseResult.money_moved, true);
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_purchase_receipts where id='${purchaseResult.receipt_id}'`).stdout, '10.00000000|1000|1.00000000|9.00000000');
    assert.equal(psql(db, `select count(*) from public.ledger_entries where txn_id='${purchaseResult.financial_transaction_id}'`).stdout, '3');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 't');
    const purchaseReplayCounts = financeCounts(), purchaseReplayBalances = balances();
    assert.equal(json(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey])).money_moved, false);
    assert.equal(financeCounts(), purchaseReplayCounts);assert.equal(balances(), purchaseReplayBalances);

    const subscriptionResult = json(service('subscribe_creator_premium_plan_v1',[id.buyer,plan.id,id.subscriptionKey]));
    assert.equal(subscriptionResult.money_moved, true);
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_subscription_periods where id='${subscriptionResult.period_id}'`).stdout, '20.00000000|1000|2.00000000|18.00000000');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 't');
    const cancelled = json(service('cancel_creator_premium_subscription_v1',[id.buyer,subscriptionResult.subscription_id,id.cancelKey]));
    assert.equal(cancelled.status, 'cancelled');assert.equal(cancelled.money_moved, false);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 't');
    assert.equal(psql(db, `begin;alter table private.creator_premium_subscription_periods disable trigger creator_premium_period_snapshot_guard;update private.creator_premium_subscription_periods set paid_through_at=clock_timestamp()-interval '1 second' where id='${subscriptionResult.period_id}';set local request.jwt.claim.sub='${id.buyer}';set local request.jwt.claim.role='authenticated';set local role authenticated;select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}');rollback;`).stdout, 'f');

    const reportId = asRole(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','Disposable report without private URL')`).stdout;
    assert.match(reportId, /^[0-9a-f-]{36}$/i);
    assert.equal(psql(db, `select reported_content_type||'|'||reason from public.reports where id='${reportId}'`).stdout, 'creator_premium|fraud');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','duplicate')`, { allowFailure: true }), 'creator_premium_report_pending_exists');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select * from private.creator_premium_purchase_receipts`, { allowFailure: true }), 'permission denied');

    const purchaseRefundCounts = financeCounts(), purchaseRefundBalances = balances();
    const concurrentPurchaseRefund = await Promise.all([
      adminCommandAsync('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']),
      adminCommandAsync('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']),
    ]);
    for (const result of concurrentPurchaseRefund)assert.equal(result.status,0,result.stderr);
    const purchaseRefundResults = concurrentPurchaseRefund.map(result=>JSON.parse(result.stdout));
    assert.equal(purchaseRefundResults.filter(result=>result.money_moved).length,1);
    assert.equal(purchaseRefundResults.filter(result=>result.replayed).length,1);
    const purchaseRefundAfterCounts=financeCounts().split('|').map(Number),purchaseRefundBeforeCounts=purchaseRefundCounts.split('|').map(Number);
    assert.deepEqual(purchaseRefundAfterCounts,[purchaseRefundBeforeCounts[0]+1,purchaseRefundBeforeCounts[1]+3]);
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}'`).stdout, '1');
    assert.equal(psql(db, `select outcome||'|'||(metadata->>'money_moved')||'|'||(metadata->>'replayed')||'|'||(metadata->>'already_refunded') from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}'`).stdout, 'succeeded|true|false|false');
    const purchaseRefundReplay = json(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']));
    assert.deepEqual({money_moved:purchaseRefundReplay.money_moved,replayed:purchaseRefundReplay.replayed,already_refunded:purchaseRefundReplay.already_refunded},{money_moved:false,replayed:true,already_refunded:true});
    expectFailure(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'changed_reason'], { allowFailure: true }), 'admin_idempotency_conflict');
    const purchaseRefundNoOp = json(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,uid(),'admin_requested']));
    assert.deepEqual({money_moved:purchaseRefundNoOp.money_moved,replayed:purchaseRefundNoOp.replayed,already_refunded:purchaseRefundNoOp.already_refunded},{money_moved:false,replayed:false,already_refunded:true});
    assert.equal(psql(db, `select outcome||'|'||(metadata->>'money_moved')||'|'||(metadata->>'replayed')||'|'||(metadata->>'already_refunded') from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}' order by created_at desc limit 1`).stdout, 'no_op|false|false|true');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 'f');
    assert.notEqual(financeCounts(), purchaseRefundCounts);assert.notEqual(balances(), purchaseRefundBalances);

    const periodRefundCounts = financeCounts();
    const periodRefund = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,id.periodRefundKey,'admin_requested']));
    assert.equal(periodRefund.money_moved,true);
    const periodCountsAfterFirst = financeCounts();
    const periodAfter=periodCountsAfterFirst.split('|').map(Number),periodBefore=periodRefundCounts.split('|').map(Number);
    assert.deepEqual(periodAfter,[periodBefore[0]+1,periodBefore[1]+3]);
    const periodReplay = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,id.periodRefundKey,'admin_requested']));
    assert.deepEqual({money_moved:periodReplay.money_moved,replayed:periodReplay.replayed,already_refunded:periodReplay.already_refunded},{money_moved:false,replayed:true,already_refunded:true});
    assert.equal(financeCounts(),periodCountsAfterFirst);
    const periodNoOp = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,uid(),'admin_requested']));
    assert.equal(periodNoOp.money_moved,false);assert.equal(financeCounts(),periodCountsAfterFirst);
    assert.notEqual(periodCountsAfterFirst,periodRefundCounts);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 'f');

    const entriesBeforeRollback = psql(db, `select count(*) from public.ledger_entries`).stdout;
    const rollbackBalances = balances(), rollbackCounts = financeCounts();
    psql(db, `create function private.b7_test_force_receipt_failure() returns trigger language plpgsql as $$begin raise exception 'b7_test_forced_rollback';end;$$;create trigger b7_test_force_receipt_failure after insert on private.creator_premium_purchase_receipts for each row execute function private.b7_test_force_receipt_failure();`);
    expectFailure(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.rollbackKey], { allowFailure: true }), 'b7_test_forced_rollback');
    assert.equal(financeCounts(),rollbackCounts);assert.equal(balances(),rollbackBalances);
    assert.equal(psql(db, `select count(*) from public.ledger_entries`).stdout,entriesBeforeRollback);
    psql(db, `drop trigger b7_test_force_receipt_failure on private.creator_premium_purchase_receipts;drop function private.b7_test_force_receipt_failure()`);

    assert.equal(psql(db, `select round(sum(case when entry_type='credit' then amount else -amount end),8) from public.ledger_entries where txn_id in(select id from public.financial_transactions where operation_type like 'creator_premium_%')`).stdout, '0.00000000');
    const summary = json(asRole(db, 'authenticated', id.creator, `select public.get_my_creator_premium_commercial_summary_v1()`));
    assert.equal(summary.currency,'BDAG');assert.equal(summary.net_retained,'0.00000000');
    assert.doesNotMatch(JSON.stringify(summary),/estimated_revenue|conversion_rate|private.*url/i);
    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=false,subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,updated_at=clock_timestamp()`);
    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout, 'false|false|false|0');
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
