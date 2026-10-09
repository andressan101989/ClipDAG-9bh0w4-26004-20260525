// Real disposable PostgreSQL proof. Set NELYON_PREMIUM_B4_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_PREMIUM_B4_LOCAL === '1';
const container = process.env.NELYON_PREMIUM_B4_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_PREMIUM_B4_TEMPLATE ?? 'algo6_final_compile_a2';
const wslNamespacePid = process.env.NELYON_PREMIUM_B4_WSL_PID ?? '';
const migrations = new URL('../supabase/migrations/', import.meta.url);

function migration(suffix) {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    found,
    sql: found.length === 1
      ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
      : '',
  };
}

const b1 = migration('_creator_premium_b1_canonical_foundation.sql');
const b2 = migration('_creator_premium_b2_private_image_media.sql');
const b3 = migration('_creator_premium_b3_signed_stream_playback.sql');
const b4 = migration('_creator_premium_b4_atomic_finance_authority.sql');
const c1 = migration('_creator_premium_b4_c1_exact_fee_snapshot_binding.sql');

function runContainer(command, { input, allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${executable} disposable command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runContainerAsync(command, { input } = {}) {
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
    child.on('close', status => resolve({
      status,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
    child.stdin.end(input ?? '');
  });
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return runContainer(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: sql, ...options },
  );
}

function asRole(db, role, actor, sql, options = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function expectFailure(result, message) {
  assert.notEqual(result.status, 0, `expected failure matching ${message}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message, 'i'));
}

function json(result) {
  return JSON.parse(result.stdout);
}

test('B4-C1 disposable harness targets the complete Premium chain and one generated correction migration', () => {
  for (const item of [b1, b2, b3, b4, c1]) assert.equal(item.found.length, 1);
  assert.match(b4.found[0], /^\d{14}_creator_premium_b4_atomic_finance_authority\.sql$/);
  assert.match(c1.found[0], /^\d{14}_creator_premium_b4_c1_exact_fee_snapshot_binding\.sql$/);
  assert.ok(b4.sql.length > 25_000);
  assert.ok(c1.sql.length > 1_000);
});

test('B4 compiles and proves atomic charges, cancellation, exact refunds, binding and rollback', {
  skip: !enabled,
  timeout: 600_000,
}, async () => {
  const db = `premium_b4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const uid = () => randomUUID();
  const id = {
    creator: uid(),
    creator2: uid(),
    buyer: uid(),
    buyer2: uid(),
    minor: uid(),
    purchase: uid(),
    purchase2: uid(),
    zeroFee: uid(),
    subscription: uid(),
    unpublished: uid(),
    noOffer: uid(),
    rollback: uid(),
    race: uid(),
    offer1: uid(),
    offer2: uid(),
    offerZero: uid(),
    offerRollback: uid(),
    offerRace: uid(),
    plan: uid(),
    purchaseKey: uid(),
    purchaseOtherKey: uid(),
    zeroKey: uid(),
    subscriptionKey: uid(),
    subscriptionOtherKey: uid(),
    cancelKey: uid(),
    purchaseRefundKey: uid(),
    periodRefundKey: uid(),
    rollbackKey: uid(),
    raceKey: uid(),
    purchase2Key: uid(),
    purchase2RefundCreatorKey: uid(),
    purchase2RefundPlatformKey: uid(),
  };

  const service = (sql, options = {}) => asRole(db, 'service_role', null, sql, options);
  const command = (name, args, options = {}) => service(
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`, options,
  );
  const commandAsync = (name, args) => runContainerAsync(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: `begin;set local request.jwt.claim.role='service_role';set local role service_role;select public.${name}(${args.map(value => `'${value}'`).join(',')});commit;` },
  );
  const privilegedFailure = (setup, name, args) => psql(db, `
    begin;
    ${setup}
    set local request.jwt.claim.role='service_role';
    set local role service_role;
    select public.${name}(${args.map(value => `'${value}'`).join(',')});
    commit;
  `, { allowFailure: true });
  const entitlementUnderTamper = (mutation, contentId, actorId) => psql(db, `
    begin;
    ${mutation}
    set local request.jwt.claim.sub='${actorId}';
    set local request.jwt.claim.role='authenticated';
    set local role authenticated;
    select allowed from public.get_my_creator_premium_entitlement_v1('${contentId}');
    rollback;
  `).stdout;
  const bindingUnderTamper = (mutation, validator, snapshotId) => psql(db, `
    begin;
    ${mutation}
    select private.${validator}('${snapshotId}');
    rollback;
  `).stdout;
  const balances = () => psql(db, `
    select coalesce(jsonb_object_agg(coalesce(owner_id::text,account_type),balance order by coalesce(owner_id::text,account_type)),'{}'::jsonb)
    from public.ledger_accounts
    where (owner_id in ('${id.creator}','${id.creator2}','${id.buyer}','${id.buyer2}','${id.minor}') and account_type='user')
       or (owner_id is null and account_type='platform' and currency='BDAG');
  `).stdout;
  const financeCounts = () => psql(db, `
    select count(*)||'|'||(select count(*) from public.ledger_entries)
    from public.financial_transactions;
  `).stdout;

  try {
    runContainer(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, `${b1.sql}\n${b2.sql}\n${b3.sql}\n${b4.sql}\n${c1.sql}`);
    psql(db, `
      truncate table public.ledger_entries, public.financial_transactions, public.ledger_accounts cascade;
      insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
      values(null,'platform','BDAG',20,false);
    `);

    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy`).stdout, 'false|false|false|0');
    for (const signature of [
      'purchase_creator_premium_content_v1(uuid,uuid,uuid)',
      'subscribe_creator_premium_plan_v1(uuid,uuid,uuid)',
      'cancel_creator_premium_subscription_v1(uuid,uuid,uuid)',
      'refund_creator_premium_purchase_v1(uuid,uuid,text)',
      'refund_creator_premium_subscription_period_v1(uuid,uuid,text)',
    ]) {
      assert.equal(psql(db, `select concat_ws('|',has_function_privilege('public','public.${signature}','execute'),has_function_privilege('anon','public.${signature}','execute'),has_function_privilege('authenticated','public.${signature}','execute'),has_function_privilege('service_role','public.${signature}','execute'))`).stdout, 'f|f|f|t');
    }

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.creator2}',false),('${id.buyer}',false),
        ('${id.buyer2}',false),('${id.minor}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','premium_b4_creator'),('${id.creator2}','premium_b4_creator2'),
        ('${id.buyer}','premium_b4_buyer'),('${id.buyer2}','premium_b4_buyer2'),
        ('${id.minor}','premium_b4_minor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select fixture.user_id,'eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata',fixture.age_band,
             current_date - fixture.years * interval '1 year'
      from (values
        ('${id.creator}'::uuid,'age_18_plus'::text,30),
        ('${id.creator2}'::uuid,'age_18_plus'::text,31),
        ('${id.buyer}'::uuid,'age_18_plus'::text,25),
        ('${id.buyer2}'::uuid,'age_18_plus'::text,26),
        ('${id.minor}'::uuid,'age_13_17'::text,16)
      ) fixture(user_id,age_band,years)
      cross join private.age_eligibility_policy policy
      where policy.singleton=true;
      set session_replication_role=origin;

      select public.ensure_ledger_account('${id.creator}');
      select public.ensure_ledger_account('${id.creator2}');
      select public.ensure_ledger_account('${id.buyer}');
      select public.ensure_ledger_account('${id.buyer2}');
      select public.ensure_ledger_account('${id.minor}');
      update public.ledger_accounts set balance=100,frozen=false
      where owner_id in ('${id.buyer}','${id.buyer2}') and account_type='user';
      update public.ledger_accounts set balance=20,frozen=false
      where owner_id in ('${id.creator}','${id.creator2}') and account_type='user';
      update public.ledger_accounts set balance=20,frozen=false
      where owner_id is null and account_type='platform' and currency='BDAG';

      insert into private.creator_premium_contents(
        id,creator_id,title,content_kind,access_mode,lifecycle_status,published_at
      ) values
        ('${id.purchase}','${id.creator}','Purchase one','image','purchase','published',clock_timestamp()),
        ('${id.purchase2}','${id.creator}','Purchase two','image','purchase','published',clock_timestamp()),
        ('${id.zeroFee}','${id.creator2}','Zero fee','image','purchase','published',clock_timestamp()),
        ('${id.subscription}','${id.creator}','Subscription','image','subscription','published',clock_timestamp()),
        ('${id.unpublished}','${id.creator}','Unpublished','image','purchase','draft',null),
        ('${id.noOffer}','${id.creator}','No offer','image','purchase','published',clock_timestamp()),
        ('${id.rollback}','${id.creator}','Rollback','image','purchase','published',clock_timestamp()),
        ('${id.race}','${id.creator}','Race','image','purchase','published',clock_timestamp());
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,status,activated_at
      ) values
        ('${id.offer1}','${id.purchase}','${id.creator}',1,10,'active',clock_timestamp()),
        ('${id.offer2}','${id.purchase2}','${id.creator}',1,10,'active',clock_timestamp()),
        ('${id.offerZero}','${id.zeroFee}','${id.creator2}',1,10,'active',clock_timestamp()),
        ('${id.offerRollback}','${id.rollback}','${id.creator}',1,6,'active',clock_timestamp()),
        ('${id.offerRace}','${id.race}','${id.creator}',1,8,'active',clock_timestamp());
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,price_bdag,status,activated_at,billing_period_days
      ) values ('${id.plan}','${id.creator}','monthly',1,'Monthly',20,'draft',null,30);
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.subscription}','${id.creator}');
      update private.creator_premium_plans
      set status='active',activated_at=clock_timestamp()
      where id='${id.plan}';
    `);

    const disabledBalances = balances();
    const disabledCounts = financeCounts();
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase, id.purchaseKey], { allowFailure: true }), 'creator_premium_purchase_disabled');
    assert.equal(balances(), disabledBalances);
    assert.equal(financeCounts(), disabledCounts);

    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000,updated_at=clock_timestamp()`);

    const authorityFailureBalances = balances();
    const authorityFailureCounts = financeCounts();
    expectFailure(privilegedFailure(
      "update public.ledger_accounts set account_type='treasury' where owner_id is null and account_type='platform' and currency='BDAG';",
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_platform_account_ambiguous');
    expectFailure(privilegedFailure(
      `alter table public.ledger_accounts drop constraint ledger_accounts_system_unique;
       insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen) values(null,'platform','BDAG',0,false);`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_platform_account_ambiguous');
    expectFailure(privilegedFailure(
      `update public.ledger_accounts set frozen=true where owner_id='${id.buyer}' and account_type='user';`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_payer_account_invalid');
    expectFailure(privilegedFailure(
      `update public.ledger_accounts set frozen=true where owner_id='${id.creator}' and account_type='user';`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_creator_account_invalid');
    expectFailure(privilegedFailure(
      `update public.ledger_accounts set balance=0 where owner_id='${id.buyer}' and account_type='user';`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'insufficient balance');
    expectFailure(privilegedFailure(
      `update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${id.creator}';`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_creator_account_restricted');
    expectFailure(privilegedFailure(
      `alter table private.creator_premium_offer_versions drop constraint creator_premium_offer_versions_currency_check;
       alter table private.creator_premium_offer_versions disable trigger creator_premium_offer_financial_identity_guard;
       update private.creator_premium_offer_versions set currency='USD' where id='${id.offer2}';`,
      'purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()],
    ), 'creator_premium_offer_currency_invalid');
    assert.equal(balances(), authorityFailureBalances);
    assert.equal(financeCounts(), authorityFailureCounts);

    const purchaseBefore = JSON.parse(balances());
    const purchaseResult = json(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase, id.purchaseKey]));
    assert.equal(purchaseResult.money_moved, true);
    assert.equal(purchaseResult.already_owned, false);
    assert.equal(purchaseResult.gross_amount_bdag, 10);
    assert.equal(purchaseResult.creator_net_bdag, 9);
    assert.equal(purchaseResult.platform_fee_bdag, 1);
    const purchaseAfter = JSON.parse(balances());
    assert.equal(Number(purchaseAfter[id.buyer]), Number(purchaseBefore[id.buyer]) - 10);
    assert.equal(Number(purchaseAfter[id.creator]), Number(purchaseBefore[id.creator]) + 9);
    assert.equal(Number(purchaseAfter.platform), Number(purchaseBefore.platform) + 1);
    assert.equal(psql(db, `select count(*) from public.ledger_entries where txn_id='${purchaseResult.financial_transaction_id}'`).stdout, '3');
    assert.equal(psql(db, `select private.creator_premium_purchase_binding_is_valid_v1('${purchaseResult.receipt_id}')`).stdout, 't');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.purchase}')`).stdout, 't');
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_purchase_receipts where id='${purchaseResult.receipt_id}'`).stdout, '10.00000000|1000|1.00000000|9.00000000');
    expectFailure(psql(db, `
      begin;
      alter table private.creator_premium_purchase_receipts disable trigger creator_premium_purchase_snapshot_guard;
      update private.creator_premium_purchase_receipts
      set platform_fee_bdag=2,creator_net_bdag=8
      where id='${purchaseResult.receipt_id}';
      rollback;
    `, { allowFailure: true }), 'creator_premium_purchase_receipts_split_check');
    assert.equal(bindingUnderTamper(
      `alter table private.creator_premium_purchase_receipts drop constraint creator_premium_purchase_receipts_split_check;
       alter table private.creator_premium_purchase_receipts disable trigger creator_premium_purchase_snapshot_guard;
       update private.creator_premium_purchase_receipts set platform_fee_bps=2000 where id='${purchaseResult.receipt_id}';`,
      'creator_premium_purchase_binding_is_valid_v1', purchaseResult.receipt_id,
    ), 'f');

    const purchaseTx = purchaseResult.financial_transaction_id;
    const relaxPremiumTransactionConstraint = 'alter table public.financial_transactions drop constraint financial_transactions_creator_premium_integrity_check;';
    const disableLedgerImmutability = 'alter table public.ledger_entries disable trigger ledger_entries_immutable;';
    const purchaseTamperMutations = [
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set operation_type='creator_premium_subscription',reference_type='creator_premium_subscription_period' where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set reference_type='tampered_reference' where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set reference_id='${randomUUID()}' where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set from_account_id=(select id from public.ledger_accounts where owner_id='${id.buyer2}' and account_type='user') where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set to_account_id=(select id from public.ledger_accounts where owner_id='${id.creator2}' and account_type='user') where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set amount=amount+1 where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set fee_amount=fee_amount+1 where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set currency='USD' where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set initiated_by='${id.buyer2}' where id='${purchaseTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set status='failed' where id='${purchaseTx}';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${purchaseTx}' and metadata->>'financial_leg'='payer_gross_debit';`,
      `${disableLedgerImmutability} update public.ledger_entries set amount=amount+1 where txn_id='${purchaseTx}' and metadata->>'financial_leg'='payer_gross_debit';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${purchaseTx}' and metadata->>'financial_leg'='creator_net_credit';`,
      `${disableLedgerImmutability} update public.ledger_entries set amount=amount+1 where txn_id='${purchaseTx}' and metadata->>'financial_leg'='creator_net_credit';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${purchaseTx}' and metadata->>'financial_leg'='platform_fee_credit';`,
      `insert into public.ledger_entries(txn_id,account_id,entry_type,amount,balance_after,description,metadata)
       select txn_id,account_id,'credit',0.01,balance_after,'tampered extra leg','{}'::jsonb
       from public.ledger_entries where txn_id='${purchaseTx}' limit 1;`,
      `update public.ledger_accounts set account_type='treasury'
       where id=(select buyer_account_id from private.creator_premium_purchase_receipts where id='${purchaseResult.receipt_id}');`,
    ];
    for (const mutation of purchaseTamperMutations) {
      assert.equal(entitlementUnderTamper(mutation, id.purchase, id.buyer), 'f');
    }

    const replayCounts = financeCounts();
    const replayBalances = balances();
    const replay = json(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase, id.purchaseKey]));
    assert.equal(replay.receipt_id, purchaseResult.receipt_id);
    assert.equal(replay.money_moved, false);
    assert.equal(replay.replayed, true);
    assert.equal(financeCounts(), replayCounts);
    assert.equal(balances(), replayBalances);
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase2, id.purchaseKey], { allowFailure: true }), 'creator_premium_purchase_idempotency_conflict');
    const alreadyOwned = json(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase, id.purchaseOtherKey]));
    assert.equal(alreadyOwned.already_owned, true);
    assert.equal(alreadyOwned.money_moved, false);
    assert.equal(financeCounts(), replayCounts);

    const raceBeforeCounts = financeCounts().split('|').map(Number);
    const raceBeforeBalances = JSON.parse(balances());
    const raceRuns = await Promise.all([
      commandAsync('purchase_creator_premium_content_v1', [id.buyer, id.race, id.raceKey]),
      commandAsync('purchase_creator_premium_content_v1', [id.buyer, id.race, id.raceKey]),
    ]);
    for (const raceRun of raceRuns) {
      assert.equal(raceRun.status, 0, raceRun.stderr);
    }
    const raceResults = raceRuns.map(result => JSON.parse(result.stdout));
    assert.equal(raceResults.filter(result => result.money_moved).length, 1);
    assert.equal(raceResults.filter(result => !result.money_moved).length, 1);
    assert.equal(new Set(raceResults.map(result => result.receipt_id)).size, 1);
    const raceAfterCounts = financeCounts().split('|').map(Number);
    assert.deepEqual(raceAfterCounts, [raceBeforeCounts[0] + 1, raceBeforeCounts[1] + 3]);
    const raceAfterBalances = JSON.parse(balances());
    assert.equal(Number(raceAfterBalances[id.buyer]), Number(raceBeforeBalances[id.buyer]) - 8);
    assert.equal(Number(raceAfterBalances[id.creator]), Number(raceBeforeBalances[id.creator]) + 7.2);
    assert.equal(Number(raceAfterBalances.platform), Number(raceBeforeBalances.platform) + 0.8);

    psql(db, `update private.creator_premium_finance_policy set platform_fee_bps=0,updated_at=clock_timestamp()`);
    const zero = json(command('purchase_creator_premium_content_v1', [id.buyer2, id.zeroFee, id.zeroKey]));
    assert.equal(zero.platform_fee_bdag, 0);
    assert.equal(zero.gross_amount_bdag, 10);
    assert.equal(zero.creator_net_bdag, 10);
    assert.equal(psql(db, `select count(*) from public.ledger_entries where txn_id='${zero.financial_transaction_id}'`).stdout, '2');
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_purchase_receipts where id='${zero.receipt_id}'`).stdout, '10.00000000|0|0.00000000|10.00000000');
    psql(db, `update private.creator_premium_finance_policy set platform_fee_bps=1000,updated_at=clock_timestamp()`);

    const failureBalances = balances();
    const failureCounts = financeCounts();
    expectFailure(command('purchase_creator_premium_content_v1', [id.minor, id.purchase2, randomUUID()], { allowFailure: true }), 'creator_premium_age_eligibility_required');
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.unpublished, randomUUID()], { allowFailure: true }), 'creator_premium_content_not_published');
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.subscription, randomUUID()], { allowFailure: true }), 'creator_premium_purchase_access_mode_invalid');
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.noOffer, randomUUID()], { allowFailure: true }), 'creator_premium_active_offer_not_found');
    expectFailure(command('purchase_creator_premium_content_v1', [id.creator, id.purchase2, randomUUID()], { allowFailure: true }), 'creator_premium_self_purchase_forbidden');
    psql(db, `insert into public.blocked_users(blocker_id,blocked_id) values('${id.creator}','${id.buyer}')`);
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()], { allowFailure: true }), 'creator_premium_blocked_relationship');
    psql(db, `delete from public.blocked_users where blocker_id='${id.creator}' and blocked_id='${id.buyer}'`);
    psql(db, `update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${id.buyer}'`);
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.purchase2, randomUUID()], { allowFailure: true }), 'creator_premium_buyer_account_restricted');
    psql(db, `update auth.users set banned_until=null where id='${id.buyer}'`);
    assert.equal(balances(), failureBalances);
    assert.equal(financeCounts(), failureCounts);

    for (const mutation of [
      `update private.creator_premium_offer_versions set price_bdag=11 where id='${id.offer1}'`,
      `update private.creator_premium_offer_versions set creator_id='${id.creator2}' where id='${id.offer1}'`,
      `update private.creator_premium_offer_versions set content_id='${id.purchase2}' where id='${id.offer1}'`,
      `update private.creator_premium_offer_versions set version=2 where id='${id.offer1}'`,
    ]) {
      expectFailure(psql(db, mutation, { allowFailure: true }), 'creator_premium_offer_financial_identity_immutable');
    }
    for (const mutation of [
      `update private.creator_premium_plans set price_bdag=21 where id='${id.plan}'`,
      `update private.creator_premium_plans set billing_period_days=31 where id='${id.plan}'`,
      `update private.creator_premium_plans set creator_id='${id.creator2}' where id='${id.plan}'`,
      `update private.creator_premium_plans set version=2 where id='${id.plan}'`,
    ]) {
      expectFailure(psql(db, mutation, { allowFailure: true }), 'creator_premium_plan_financial_identity_immutable');
    }
    expectFailure(psql(db, `delete from private.creator_premium_plan_contents where plan_id='${id.plan}'`, { allowFailure: true }), 'creator_premium_plan_contents_immutable');
    expectFailure(psql(db, `insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id) values('${id.plan}','${id.purchase2}','${id.creator}')`, { allowFailure: true }), 'creator_premium_plan_contents_immutable');

    const subBefore = JSON.parse(balances());
    const subscription = json(command('subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.subscriptionKey]));
    assert.equal(subscription.money_moved, true);
    assert.equal(subscription.billing_period_days, 30);
    const subAfter = JSON.parse(balances());
    assert.equal(Number(subAfter[id.buyer]), Number(subBefore[id.buyer]) - 20);
    assert.equal(Number(subAfter[id.creator]), Number(subBefore[id.creator]) + 18);
    assert.equal(Number(subAfter.platform), Number(subBefore.platform) + 2);
    assert.equal(psql(db, `select paid_through_at-starts_at from private.creator_premium_subscription_periods where id='${subscription.period_id}'`).stdout, '30 days');
    assert.equal(psql(db, `select private.creator_premium_period_binding_is_valid_v1('${subscription.period_id}')`).stdout, 't');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.subscription}')`).stdout, 't');
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_subscription_periods where id='${subscription.period_id}'`).stdout, '20.00000000|1000|2.00000000|18.00000000');
    expectFailure(psql(db, `
      begin;
      alter table private.creator_premium_subscription_periods disable trigger creator_premium_period_snapshot_guard;
      update private.creator_premium_subscription_periods
      set platform_fee_bdag=3,creator_net_bdag=17
      where id='${subscription.period_id}';
      rollback;
    `, { allowFailure: true }), 'creator_premium_subscription_periods_split_check');
    assert.equal(bindingUnderTamper(
      `alter table private.creator_premium_subscription_periods drop constraint creator_premium_subscription_periods_split_check;
       alter table private.creator_premium_subscription_periods disable trigger creator_premium_period_snapshot_guard;
       update private.creator_premium_subscription_periods set platform_fee_bps=2000 where id='${subscription.period_id}';`,
      'creator_premium_period_binding_is_valid_v1', subscription.period_id,
    ), 'f');
    const subscriptionTx = subscription.financial_transaction_id;
    const subscriptionTamperMutations = [
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set operation_type='creator_premium_purchase',reference_type='creator_premium_purchase_receipt' where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set reference_type='tampered_reference' where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set reference_id='${randomUUID()}' where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set from_account_id=(select id from public.ledger_accounts where owner_id='${id.buyer2}' and account_type='user') where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set to_account_id=(select id from public.ledger_accounts where owner_id='${id.creator2}' and account_type='user') where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set amount=amount+1 where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set fee_amount=fee_amount+1 where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set currency='USD' where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set initiated_by='${id.buyer2}' where id='${subscriptionTx}';`,
      `${relaxPremiumTransactionConstraint} update public.financial_transactions set status='failed' where id='${subscriptionTx}';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${subscriptionTx}' and metadata->>'financial_leg'='payer_gross_debit';`,
      `${disableLedgerImmutability} update public.ledger_entries set amount=amount+1 where txn_id='${subscriptionTx}' and metadata->>'financial_leg'='payer_gross_debit';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${subscriptionTx}' and metadata->>'financial_leg'='creator_net_credit';`,
      `${disableLedgerImmutability} update public.ledger_entries set amount=amount+1 where txn_id='${subscriptionTx}' and metadata->>'financial_leg'='creator_net_credit';`,
      `${disableLedgerImmutability} delete from public.ledger_entries where txn_id='${subscriptionTx}' and metadata->>'financial_leg'='platform_fee_credit';`,
      `insert into public.ledger_entries(txn_id,account_id,entry_type,amount,balance_after,description,metadata)
       select txn_id,account_id,'credit',0.01,balance_after,'tampered extra leg','{}'::jsonb
       from public.ledger_entries where txn_id='${subscriptionTx}' limit 1;`,
      `update public.ledger_accounts set account_type='treasury'
       where id=(select subscriber_account_id from private.creator_premium_subscription_periods where id='${subscription.period_id}');`,
    ];
    for (const mutation of subscriptionTamperMutations) {
      assert.equal(entitlementUnderTamper(mutation, id.subscription, id.buyer), 'f');
    }
    const subReplay = json(command('subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.subscriptionKey]));
    assert.equal(subReplay.period_id, subscription.period_id);
    assert.equal(subReplay.money_moved, false);
    const subExisting = json(command('subscribe_creator_premium_plan_v1', [id.buyer, id.plan, id.subscriptionOtherKey]));
    assert.equal(subExisting.already_subscribed, true);
    assert.equal(subExisting.money_moved, false);

    const cancelCounts = financeCounts();
    const cancelBalances = balances();
    const cancelled = json(command('cancel_creator_premium_subscription_v1', [id.buyer, subscription.subscription_id, id.cancelKey]));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.money_moved, false);
    assert.equal(financeCounts(), cancelCounts);
    assert.equal(balances(), cancelBalances);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.subscription}')`).stdout, 't');
    assert.equal(entitlementUnderTamper(
      `alter table private.creator_premium_subscription_periods disable trigger creator_premium_period_snapshot_guard;
       update private.creator_premium_subscription_periods set paid_through_at=clock_timestamp()-interval '1 second' where id='${subscription.period_id}';`,
      id.subscription, id.buyer,
    ), 'f');
    const cancelReplay = json(command('cancel_creator_premium_subscription_v1', [id.buyer, subscription.subscription_id, id.cancelKey]));
    assert.equal(cancelReplay.replayed, true);

    const insufficientRefundPurchase = json(command('purchase_creator_premium_content_v1', [id.buyer2, id.purchase2, id.purchase2Key]));
    const insufficientRefundBalances = balances();
    const insufficientRefundCounts = financeCounts();
    expectFailure(privilegedFailure(
      `update public.ledger_accounts set balance=0 where owner_id='${id.creator}' and account_type='user';`,
      'refund_creator_premium_purchase_v1', [insufficientRefundPurchase.receipt_id, id.purchase2RefundCreatorKey, 'owner_approved'],
    ), 'creator_premium_refund_source_balance_insufficient');
    assert.equal(balances(), insufficientRefundBalances);
    assert.equal(financeCounts(), insufficientRefundCounts);
    assert.equal(psql(db, `select access_state||'|'||(select status from public.financial_transactions where id=receipt.financial_transaction_id) from private.creator_premium_purchase_receipts receipt where id='${insufficientRefundPurchase.receipt_id}'`).stdout, 'active|completed');
    assert.equal(psql(db, `select count(*) from public.financial_transactions where operation_type='creator_premium_purchase_refund' and reference_id='${insufficientRefundPurchase.receipt_id}'`).stdout, '0');
    expectFailure(privilegedFailure(
      "update public.ledger_accounts set balance=0 where owner_id is null and account_type='platform' and currency='BDAG';",
      'refund_creator_premium_purchase_v1', [insufficientRefundPurchase.receipt_id, id.purchase2RefundPlatformKey, 'owner_approved'],
    ), 'creator_premium_refund_source_balance_insufficient');
    assert.equal(balances(), insufficientRefundBalances);
    assert.equal(financeCounts(), insufficientRefundCounts);

    const purchaseRefundBefore = JSON.parse(balances());
    const purchaseRefund = json(command('refund_creator_premium_purchase_v1', [purchaseResult.receipt_id, id.purchaseRefundKey, 'owner_approved']));
    assert.equal(purchaseRefund.money_moved, true);
    const purchaseRefundAfter = JSON.parse(balances());
    assert.equal(Number(purchaseRefundAfter[id.creator]), Number(purchaseRefundBefore[id.creator]) - 9);
    assert.equal(Number(purchaseRefundAfter.platform), Number(purchaseRefundBefore.platform) - 1);
    assert.equal(Number(purchaseRefundAfter[id.buyer]), Number(purchaseRefundBefore[id.buyer]) + 10);
    assert.equal(psql(db, `select status from public.financial_transactions where id='${purchaseResult.financial_transaction_id}'`).stdout, 'reversed');
    assert.equal(psql(db, `select access_state from private.creator_premium_purchase_receipts where id='${purchaseResult.receipt_id}'`).stdout, 'refunded');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.purchase}')`).stdout, 'f');
    const purchaseRefundReplay = json(command('refund_creator_premium_purchase_v1', [purchaseResult.receipt_id, id.purchaseRefundKey, 'owner_approved']));
    assert.equal(purchaseRefundReplay.money_moved, false);
    const purchaseRefundOtherKey = json(command('refund_creator_premium_purchase_v1', [purchaseResult.receipt_id, randomUUID(), 'owner_approved']));
    assert.equal(purchaseRefundOtherKey.money_moved, false);
    assert.equal(purchaseRefundOtherKey.already_refunded, true);

    const periodRefundBefore = JSON.parse(balances());
    const periodRefund = json(command('refund_creator_premium_subscription_period_v1', [subscription.period_id, id.periodRefundKey, 'owner_approved']));
    assert.equal(periodRefund.money_moved, true);
    const periodRefundAfter = JSON.parse(balances());
    assert.equal(Number(periodRefundAfter[id.creator]), Number(periodRefundBefore[id.creator]) - 18);
    assert.equal(Number(periodRefundAfter.platform), Number(periodRefundBefore.platform) - 2);
    assert.equal(Number(periodRefundAfter[id.buyer]), Number(periodRefundBefore[id.buyer]) + 20);
    assert.equal(psql(db, `select access_state from private.creator_premium_subscription_periods where id='${subscription.period_id}'`).stdout, 'refunded');
    assert.equal(psql(db, `select status from private.creator_premium_subscriptions where id='${subscription.subscription_id}'`).stdout, 'revoked');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${id.subscription}')`).stdout, 'f');
    const periodRefundReplay = json(command('refund_creator_premium_subscription_period_v1', [subscription.period_id, id.periodRefundKey, 'owner_approved']));
    assert.equal(periodRefundReplay.money_moved, false);
    const renewalCounts = financeCounts();
    expectFailure(command('subscribe_creator_premium_plan_v1', [id.buyer, id.plan, randomUUID()], { allowFailure: true }), 'creator_premium_subscription_renewal_not_implemented');
    assert.equal(financeCounts(), renewalCounts);

    psql(db, `
      create function private.b4_test_force_receipt_failure() returns trigger language plpgsql as $$
      begin raise exception 'b4_test_forced_failure'; end; $$;
      create trigger b4_test_force_receipt_failure after insert on private.creator_premium_purchase_receipts
      for each row execute function private.b4_test_force_receipt_failure();
    `);
    const rollbackBalances = balances();
    const rollbackCounts = financeCounts();
    expectFailure(command('purchase_creator_premium_content_v1', [id.buyer, id.rollback, id.rollbackKey], { allowFailure: true }), 'b4_test_forced_failure');
    assert.equal(balances(), rollbackBalances);
    assert.equal(financeCounts(), rollbackCounts);
    assert.equal(psql(db, `select count(*) from private.creator_premium_purchase_receipts where content_id='${id.rollback}'`).stdout, '0');
    psql(db, `drop trigger b4_test_force_receipt_failure on private.creator_premium_purchase_receipts; drop function private.b4_test_force_receipt_failure()`);

    assert.equal(psql(db, `select round(sum(case when entry_type='credit' then amount else -amount end),8) from public.ledger_entries where txn_id in (select id from public.financial_transactions where operation_type like 'creator_premium_%')`).stdout, '0.00000000');
  } finally {
    runContainer(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
