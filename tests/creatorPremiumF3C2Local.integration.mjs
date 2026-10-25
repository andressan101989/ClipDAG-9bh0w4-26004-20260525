// Disposable PostgreSQL only: reuses the F3 Docker/WSL transport and template.
// No hosted URL is accepted. Keep every integrity scenario in origin mode.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';

const enabled = process.env.RUN_CREATOR_PREMIUM_F3_C2_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2';

const adminParserModule = { exports: {} };
const adminParserSource = readFileSync(new URL('../apps/admin-web/src/lib/adminObservabilityApi.ts', import.meta.url), 'utf8');
const adminParserJavaScript = ts.transpileModule(adminParserSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(adminParserJavaScript, {
  module: adminParserModule,
  exports: adminParserModule.exports,
  require(specifier) {
    if (specifier === './supabase') return { supabase: { rpc: async () => { throw new Error('RPC forbidden in parser harness'); } } };
    throw new Error(`Unexpected parser dependency: ${specifier}`);
  },
  URL,
}, { filename: 'adminObservabilityApi.compiled.cjs' });
const { parseAdminCreatorPremiumFinance } = adminParserModule.exports;
const wslPid = process.env.CREATOR_PREMIUM_PG_WSL_PID || '';
assert.match(template, /^[a-z0-9_]+$/);
assert.ok(!wslPid || /^\d+$/.test(wslPid));
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir);
const c2 = files.filter(name => name.includes('_creator_premium_f3_c2_'));
const finalWallet = files.filter(name => name.endsWith('_creator_premium_f3_final_wallet_integration.sql'));
function requireGovernance() {
  assert.equal(c2.length, 1, 'missing C2 governance: canonical attestation and monotonic close are required before canary activation');
  const source = readFileSync(new URL(c2[0], dir), 'utf8');
  assert.match(source, /create(?: or replace)? function private\.creator_premium_finance_configuration_digest_f3_c2_v1\s*\(/i,
    'C2 configuration digest authority is absent; a migration placeholder cannot authorize the canary');
  assert.match(source, /create(?: or replace)? function private\.close_creator_premium_finance_authorization_f3_c2_v1\s*\(/i,
    'C2 monotonic closure authority is absent');
}
function requireFinalWalletIntegration() {
  assert.equal(finalWallet.length, 1, 'missing F3 final Wallet integration migration');
  const source = readFileSync(new URL(finalWallet[0], dir), 'utf8');
  assert.match(source, /create or replace function public\.ensure_my_ledger_account\(\)/i);
  assert.match(source, /create or replace function private\.get_admin_platform_revenue_projection_v1\(/i);
}
const suffixes = ['_creator_premium_b1_canonical_foundation.sql', '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql', '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql', '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql', '_creator_premium_f2_complete_monetization.sql',
  '_creator_premium_f3_bounded_financial_activation.sql'];
const chainFiles = suffixes.map(suffix => {
  const found = files.filter(name => name.endsWith(suffix));
  assert.equal(found.length, 1, suffix);
  return found[0];
});
const chain = chainFiles.map(name => readFileSync(new URL(name, dir), 'utf8'));
const literal = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const jsonLiteral = value => `${literal(JSON.stringify(value))}::jsonb`;
const contract = 'creator-premium-f3-v2';

// Transport copied from creatorPremiumF3Local.integration.mjs; no authority mock.
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
function dockerHolder(command, input) {
  const [executable, args] = dockerArgs(command);
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  child.stdin.write(input + '\n');
  return { result, release() { child.stdin.end('commit;\n'); } };
}
function pgCommand(db) {
  assert.match(db, /^premium_f3_c2_[a-z0-9_]+$/);
  return `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At`;
}
function sql(db, query, allowFailure = false) { return docker(pgCommand(db), query, allowFailure); }
function json(db, query) { return JSON.parse(sql(db, query).stdout); }
function applyMigrationIfMissing(db, index) {
  const migrationsTable = sql(db,
    `select to_regclass('supabase_migrations.schema_migrations') is not null`).stdout === 't';
  const version = chainFiles[index].split('_', 1)[0];
  const alreadyApplied = migrationsTable && sql(db,
    `select exists(select 1 from supabase_migrations.schema_migrations where version='${version}')`).stdout === 't';
  if (!alreadyApplied) sql(db, chain[index]);
}
const serviceSql = query => `begin;set local statement_timeout='15s';set local request.jwt.claim.role='service_role';set local role service_role;${query};commit;`;
const ownerSql = query => `begin;set local statement_timeout='15s';set local role postgres;${query};commit;`;
const authenticatedSql = (actor, query) => `begin;set local statement_timeout='15s';set local request.jwt.claim.sub='${actor}';set local request.jwt.claim.role='authenticated';set local role authenticated;${query};commit;`;
function denied(result, expected = /creator_premium_|permission denied|violates|immutable/i) {
  assert.notEqual(result.status, 0, `unexpected successful command: ${result.stdout}`);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stderr, /does not exist|syntax error|deadlock detected|statement timeout/i,
    'negative scenario must fail on admission/integrity, not a broken fixture or missing function');
}
async function waitForLock(db, query) {
  const deadline = Date.now() + 20_000;
  do { await delay(20); if (sql(db, query).stdout === 't') return; } while (Date.now() < deadline);
  assert.fail('PostgreSQL lock handshake did not become ready');
}

test('C2 integration requires the governance extension before synthetic activation', { skip: !enabled }, () => {
  requireGovernance();
});

test('C2 origin-mode disposable canary proves 3000 BDAG lifecycle and governance', {
  skip: !enabled, timeout: 600_000,
}, async t => {
  // Assert the missing behavior explicitly, before invoking nonexistent helpers.
  requireGovernance();
  requireFinalWalletIntegration();
  const base = `premium_f3_c2_base_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const id = Object.fromEntries(['admin', 'buyer', 'outsider', 'creator', 'content', 'offer', 'plan',
    'buyerAccount', 'creatorAccount', 'platformAccount', 'outsiderAccount', 'authorization', 'scan'].map(name => [name, randomUUID()]));
  const purchase = (key = randomUUID(), actor = id.buyer, offer = id.offer) =>
    `select public.purchase_creator_premium_content_v1('${actor}','${id.content}','${offer}','${key}','${contract}')`;
  const subscribe = (key = randomUUID(), actor = id.buyer) =>
    `select public.subscribe_creator_premium_plan_v1('${actor}','${id.plan}','${key}','${contract}')`;
  const refundPurchase = (fact, key = randomUUID(), reason = 'owner_approved') =>
    `select public.refund_creator_premium_purchase_v1('${fact.receipt_id}','${key}','${reason}')`;
  const refundPeriod = (fact, key = randomUUID()) =>
    `select public.refund_creator_premium_subscription_period_v1('${fact.period_id}','${key}','owner_approved')`;
  const close = () => `select private.close_creator_premium_finance_authorization_f3_c2_v1('${id.authorization}','synthetic owner-approved close')`;
  const finalize = () => `select private.finalize_creator_premium_finance_authorization_f3_c2_v1('${id.authorization}')`;
  const command = (db, query) => sql(db, serviceSql(query), true);
  const success = (db, query) => {
    const result = command(db, query); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const owner = (db, query) => sql(db, ownerSql(query));
  const balances = db => json(db, `select jsonb_build_array(
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.buyerAccount}'),
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.creatorAccount}'),
    (select balance::numeric(38,8)::text from public.ledger_accounts where id='${id.platformAccount}'))`);
  const counts = db => json(db, `select jsonb_build_array((select count(*) from public.financial_transactions),
    (select count(*) from public.ledger_entries))`);
  const policy = db => json(db, `select jsonb_build_array(activation_mode,purchase_enabled,subscription_enabled,
    refunds_enabled,platform_fee_bps,active_authorization_id) from private.creator_premium_finance_policy where singleton`);
  const snapshot = db => sql(db, `select jsonb_build_object(
    'accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.ledger_accounts a),
    'transactions',(select jsonb_agg(to_jsonb(a) order by id) from public.financial_transactions a),
    'entries',(select jsonb_agg(to_jsonb(a) order by id) from public.ledger_entries a),
    'receipts',(select jsonb_agg(to_jsonb(a) order by id) from private.creator_premium_purchase_receipts a),
    'periods',(select jsonb_agg(to_jsonb(a) order by id) from private.creator_premium_subscription_periods a),
    'journal',(select jsonb_agg(to_jsonb(a) order by idempotency_key) from public.idempotency_keys a),
    'velocity',(select coalesce(sum(count),0) from public.velocity_counters),
    'usage',(select to_jsonb(a) from private.creator_premium_finance_consumption_f3_v1('${id.authorization}') a))`).stdout;
  const reconciliation = db => {
    const result = sql(db, `begin;set local request.jwt.claim.sub='${id.admin}';
      set local request.jwt.claim.role='authenticated';set local role authenticated;
      select public.search_admin_creator_premium_finance_v1(null,null,null,null,null,100);commit;`);
    return JSON.parse(result.stdout);
  };
  const platformRevenue = db => {
    const result = sql(db, authenticatedSql(id.admin,
      `select public.get_admin_platform_revenue('all')`));
    return JSON.parse(result.stdout);
  };
  const premiumRevenue = db => {
    const response = platformRevenue(db);
    const source = response.sources.find(item => item.source_code === 'creator_premium' && item.currency === 'BDAG');
    const reconciliationSource = response.reconciliation.sources.find(
      item => item.source_code === 'creator_premium' && item.currency === 'BDAG',
    );
    assert.ok(source, 'Creator Premium revenue source is missing');
    assert.ok(reconciliationSource, 'Creator Premium reconciliation source is missing');
    return { response, source, reconciliationSource };
  };
  function reconciled(db) {
    const response = reconciliation(db);
    assert.equal(response.counts.integrity_failures, 0, JSON.stringify(response));
    assert.deepEqual(Object.keys(response.reconciliation).sort(), [
      'duplicate_open_relationships',
      'invalid_purchase_facts',
      'invalid_subscription_period_facts',
      'multiple_periods_per_relationship',
      'orphan_creator_premium_transactions',
      'subscriptions_without_period',
    ], 'C2 changed the exact Admin Finance v1 reconciliation response contract');
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseAdminCreatorPremiumFinance(response))),
      response,
      'the real Admin Finance parser rejected or changed the disposable SQL response',
    );
    for (const [key, count] of Object.entries(response.reconciliation)) assert.equal(count, 0, key);
    assert.equal(sql(db, `select not exists(select txn_id from public.ledger_entries group by txn_id
      having count(*)<>3 or sum(case when entry_type='debit' then amount else -amount end)<>0)`).stdout, 't');
    assert.equal(sql(db, 'show session_replication_role').stdout, 'origin');
  }
  function step(db, fn) { reconciled(db); const result = fn(); reconciled(db); return result; }
  function unchangedDenial(db, query, pattern) {
    reconciled(db); const before = snapshot(db); denied(command(db, query), pattern);
    assert.equal(snapshot(db), before, 'denial leaked balance, facts, journal, velocity or consumption'); reconciled(db);
  }
  function config(changes = {}) {
    const now = Date.now();
    return { id: id.authorization, client_contract: contract, buyer_id: id.buyer, creator_id: id.creator,
      buyer_account_id: id.buyerAccount, creator_account_id: id.creatorAccount, platform_account_id: id.platformAccount,
      purchase_content_id: id.content, purchase_offer_version_id: id.offer, subscription_plan_id: id.plan,
      purchase_amount_bdag: '1500.00000000', subscription_amount_bdag: '1500.00000000',
      max_purchase_count: 1, max_subscription_count: 1, max_refund_count: 2, max_gross_bdag: '3000.00000000',
      platform_fee_bps: 2000, charge_starts_at: new Date(now - 60_000).toISOString(),
      charge_expires_at: new Date(now + 1_740_000).toISOString(), refund_expires_at: new Date(now + 3_540_000).toISOString(),
      ...changes };
  }
  const digest = (db, kind, value) => sql(db,
    `select private.creator_premium_finance_${kind}_digest_f3_c2_v1(${jsonLiteral(value)})`).stdout;
  function evidence(configurationDigest, changes = {}) {
    return { configuration_digest: configurationDigest,
      approval_reference: 'DISPOSABLE-ONLY: synthetic owner approval; never production authority',
      evidence_digest: createHash('sha256').update('F3-C2 disposable fixture evidence').digest('hex'),
      repository: 'local/disposable-creator-premium-f3-c2',
      protected_source_sha: '0dace3e84031922a35f9213957bd77d886cf3b7a',
      environment: 'disposable-postgresql', approved_at: '2026-10-25T00:00:00Z', attestation_version: 'creator-premium-f3-c2-attestation-v1',
      ...changes };
  }
  function insertAuthorization(db, configuration, configurationDigest, approvalDigest, allowFailure = false) {
    const entries = Object.entries(configuration);
    return sql(db, ownerSql(`insert into private.creator_premium_finance_authorizations(
      ${entries.map(([key]) => key).join(',')},status,configuration_digest,approval_digest)
      values(${entries.map(([, value]) => literal(value)).join(',')},'OPEN',${literal(configurationDigest)},${literal(approvalDigest)})`), allowFailure);
  }
  function attest(db, configuration, changes = {}) {
    const configurationDigest = digest(db, 'configuration', configuration);
    const commitment = evidence(configurationDigest, changes);
    const approvalDigest = digest(db, 'attestation', commitment);
    const entries = Object.entries(commitment);
    owner(db, `insert into private.creator_premium_finance_owner_attestations_f3_c2(
      ${entries.map(([key]) => key).join(',')},approval_digest)
      values(${entries.map(([, value]) => literal(value)).join(',')},'${approvalDigest}')`);
    return { configurationDigest, approvalDigest };
  }
  function unlockDisposableFoundation(db) {
    sql(db, `alter table private.creator_premium_finance_policy drop constraint creator_premium_finance_policy_f3_foundation_off_check;
      alter table private.creator_premium_finance_authorizations disable trigger creator_premium_finance_auth_f3_foundation_insert_guard;`);
    assert.equal(sql(db, `select not exists(select 1 from pg_trigger where not tgisinternal and tgenabled='D'
      and tgname<>'creator_premium_finance_auth_f3_foundation_insert_guard')`).stdout, 't', 'only named foundation INSERT guard may be disabled');
    assert.equal(sql(db, `select count(*)>0 from pg_trigger where tgrelid='private.creator_premium_finance_authorizations'::regclass
      and not tgisinternal and tgname<>'creator_premium_finance_auth_f3_foundation_insert_guard' and tgenabled in ('O','A')`).stdout, 't');
  }
  function arm(db, changes = {}) {
    unlockDisposableFoundation(db);
    const configuration = config(changes), commitment = attest(db, configuration);
    insertAuthorization(db, configuration, commitment.configurationDigest, commitment.approvalDigest);
    owner(db, `update private.creator_premium_finance_policy set activation_mode='canary',
      active_authorization_id='${id.authorization}',purchase_enabled=true,subscription_enabled=true,
      refunds_enabled=true,platform_fee_bps=2000 where singleton`);
    return configuration;
  }
  async function scenario(name, fn, settings = {}) {
    await t.test(name, async () => {
      const db = `premium_f3_c2_case_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      try {
        docker(`createdb -U supabase_admin -T ${base} ${db}`);
        const configuration = settings === null ? null : arm(db, typeof settings === 'function' ? settings() : settings);
        reconciled(db); await fn(db, configuration); reconciled(db);
      } finally { docker(`dropdb -U supabase_admin --force --if-exists ${db}`, '', true); }
    });
  }
  function insertSyntheticAuthUsers(db, actorIds) {
    const ageTriggerExists = sql(db, `select exists(select 1 from pg_trigger
      where tgrelid='auth.users'::regclass and tgname='on_auth_user_age_eligibility')`).stdout === 't';
    sql(db, `begin;set local statement_timeout='15s';
      ${ageTriggerExists ? 'alter table auth.users disable trigger on_auth_user_age_eligibility;' : ''}
      insert into auth.users(id,is_anonymous) values ${actorIds.map(actor => `('${actor}',false)`).join(',')};
      ${ageTriggerExists ? 'alter table auth.users enable trigger on_auth_user_age_eligibility;' : ''}
      commit;`);
  }
  try {
    docker(`createdb -U supabase_admin -T ${template} ${base}`);
    for (let index = 0; index < 6; index += 1) applyMigrationIfMissing(base, index);
    sql(base, `insert into private.admin_roles(role_code,display_name,description,is_assignable,is_root,is_exclusive)
      values('MODERATOR','Moderator','Synthetic moderator',true,false,false) on conflict do nothing;
      insert into private.admin_capabilities(capability_code,domain,effect,description,is_sensitive)
      values('content.items.moderate','content','write','Moderate content',true),
        ('finance.ledger.read','finance','read','Read ledger',true) on conflict do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values('SUPER_ADMIN','content.items.moderate'),('SUPER_ADMIN','finance.ledger.read'),
        ('MODERATOR','content.items.moderate') on conflict do nothing;`);
    for (let index = 6; index < 8; index += 1) applyMigrationIfMissing(base, index);
    sql(base, 'truncate public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;');
    // The legacy compile template has supabase_admin-owned dependencies. Restore
    // only the trusted postgres owner's access, as in the F3 disposable harness.
    sql(base, `grant usage on schema public,private to postgres;
      grant all on all tables in schema public,private to postgres;
      grant execute on all functions in schema public,private to postgres;`);
    applyMigrationIfMissing(base, 8);
    const beforeMigration = snapshot(base);
    sql(base, readFileSync(new URL(c2[0], dir), 'utf8'));
    assert.equal(snapshot(base), beforeMigration, 'applying C2 created economic facts or changed balances');
    sql(base, readFileSync(new URL(finalWallet[0], dir), 'utf8'));
    assert.equal(snapshot(base), beforeMigration, 'applying F3 final created economic facts or changed balances');
    assert.deepEqual(policy(base), ['off', false, false, false, 0, null]);
    assert.equal(sql(base, 'select count(*) from private.creator_premium_finance_authorizations').stdout, '0');
    assert.equal(sql(base, 'select count(*) from private.creator_premium_finance_owner_attestations_f3_c2').stdout, '0');
    for (const signature of ['creator_premium_finance_configuration_payload_f3_c2_v1(jsonb)',
      'creator_premium_finance_configuration_digest_f3_c2_v1(jsonb)',
      'creator_premium_finance_attestation_payload_f3_c2_v1(jsonb)',
      'creator_premium_finance_attestation_digest_f3_c2_v1(jsonb)',
      'close_creator_premium_finance_authorization_f3_c2_v1(uuid,text)',
      'finalize_creator_premium_finance_authorization_f3_c2_v1(uuid)']) {
      assert.equal(sql(base, `select to_regprocedure('private.${signature}') is not null`).stdout, 't', `missing owner governance contract ${signature}`);
    }
    const actors = [id.admin, id.buyer, id.outsider, id.creator];
    // The disposable template still carries a legacy auth signup trigger whose
    // default row predates the current age-eligibility constraints. Disable
    // only that named fixture trigger while inserting synthetic auth users;
    // every financial trigger and the session replication role stay active.
    insertSyntheticAuthUsers(base, actors);
    sql(base, `insert into public.user_profiles(id,username) values ${actors.map((actor, index) => `('${actor}','f3c2_synthetic_${index}')`).join(',')} on conflict(id) do nothing;
      insert into private.admin_user_roles(user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason)
      values('${id.admin}','SUPER_ADMIN','trusted_operator','f3-c2-disposable-proof','Synthetic local proof');
      insert into private.user_age_eligibility(user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      select fixture.id,'eligible',policy.minimum_age,policy.policy_version,clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '25 years'
      from (values ${actors.map(actor => `('${actor}'::uuid)`).join(',')}) fixture(id)
      cross join private.age_eligibility_policy policy where policy.singleton on conflict(user_id) do update set status='eligible';
      insert into private.content_safety_scans(id,target_type,target_id,owner_user_id,content_fingerprint,status,
        requested_reason,detector_version,text_status,audio_status,visual_status,reports_status,attempt_count,
        available_at,started_at,completed_at,created_at,updated_at)
      values('${id.scan}','creator_premium','${id.content}','${id.creator}',repeat('a',64),'completed','content_created',
        'f3-c2-disposable-v1','analyzed','not_applicable','not_applicable','analyzed',1,
        current_timestamp,current_timestamp,current_timestamp,current_timestamp,current_timestamp);
      insert into private.creator_premium_contents(id,creator_id,title,content_kind,access_mode,lifecycle_status,
        submitted_at,published_at,verification_generation,verification_scan_id,verification_fingerprint,
        verification_status,verification_requested_at,verification_completed_at)
      values('${id.content}','${id.creator}','F3-C2 synthetic','image','purchase_or_subscription','published',
        clock_timestamp(),clock_timestamp(),1,'${id.scan}',repeat('a',64),'passed',clock_timestamp(),clock_timestamp());
      insert into private.creator_premium_offer_versions(id,content_id,creator_id,version,price_bdag,status,activated_at)
      values('${id.offer}','${id.content}','${id.creator}',1,1500,'active',clock_timestamp());
      insert into private.creator_premium_plans(id,creator_id,plan_key,version,name,price_bdag,currency,status,billing_period_days)
      values('${id.plan}','${id.creator}','f3_c2_manual',1,'F3-C2 manual',1500,'BDAG','draft',30);
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.content}','${id.creator}');
      update private.creator_premium_plans
      set status='active',activated_at=clock_timestamp()
      where id='${id.plan}';
      insert into public.ledger_accounts(id,owner_id,account_type,currency,balance,frozen)
      values('${id.platformAccount}',null,'platform','BDAG',0,false),
        ('${id.buyerAccount}','${id.buyer}','user','BDAG',3000,false),
        ('${id.creatorAccount}','${id.creator}','user','BDAG',0,false),
        ('${id.outsiderAccount}','${id.outsider}','user','BDAG',0,false);`);

    await scenario('self-only provisioning creates one zero-balance account and preserves existing financial state', async db => {
      assert.equal(sql(db, `select p.prosecdef and p.proowner='postgres'::regrole
        and coalesce(p.proconfig @> array['search_path=""'],false)
        from pg_proc p where p.oid='public.ensure_my_ledger_account()'::regprocedure`).stdout, 't');
      assert.equal(sql(db, `select has_function_privilege('authenticated','public.ensure_my_ledger_account()','execute')`).stdout, 't');
      for (const role of ['anon', 'service_role']) {
        assert.equal(sql(db, `select has_function_privilege('${role}','public.ensure_my_ledger_account()','execute')`).stdout, 'f');
      }
      assert.equal(sql(db, `select not exists(select 1 from pg_proc p,
        lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid='public.ensure_my_ledger_account()'::regprocedure
          and acl.grantee=0 and acl.privilege_type='EXECUTE')`).stdout, 't');
      assert.equal(sql(db, `select has_function_privilege('authenticated','public.ensure_ledger_account(uuid)','execute')`).stdout, 'f');
      denied(sql(db, `begin;set local role authenticated;select public.ensure_my_ledger_account();rollback;`, true),
        /ledger_account_auth_required/);
      denied(sql(db, `begin;set local role service_role;select public.ensure_my_ledger_account();rollback;`, true),
        /permission denied/);

      const financialActivity = () => sql(db, `select jsonb_build_object(
        'transactions',(select count(*) from public.financial_transactions),
        'entries',(select count(*) from public.ledger_entries),
        'journal',(select count(*) from public.idempotency_keys),
        'velocity',(select coalesce(sum(count),0) from public.velocity_counters),
        'authorizations',(select count(*) from private.creator_premium_finance_authorizations))`).stdout;
      const activityBefore = financialActivity();
      sql(db, `delete from public.ledger_accounts where id='${id.creatorAccount}'`);
      assert.equal(sql(db, `select count(*) from public.ledger_accounts where owner_id='${id.creator}' and account_type='user'`).stdout, '0');

      denied(sql(db, authenticatedSql(id.creator,
        `select public.ensure_ledger_account('${id.outsider}')`), true), /permission denied/);
      denied(sql(db, `begin;set local role anon;select public.ensure_my_ledger_account();rollback;`, true), /permission denied/);

      const calls = await Promise.all([1, 2].map(() => dockerAsync(
        pgCommand(db), authenticatedSql(id.creator, 'select public.ensure_my_ledger_account()'),
      )));
      for (const result of calls) assert.equal(result.status, 0, result.stderr);
      assert.equal(calls[0].stdout, calls[1].stdout, 'concurrent provisioning returned different accounts');
      assert.equal(sql(db, `select count(*) from public.ledger_accounts where owner_id='${id.creator}' and account_type='user' and currency='BDAG'`).stdout, '1');
      assert.deepEqual(json(db, `select jsonb_build_array(balance::numeric(38,8)::text,frozen)
        from public.ledger_accounts where owner_id='${id.creator}' and account_type='user'`), ['0.00000000', false]);
      assert.deepEqual(counts(db), [0, 0]);
      assert.deepEqual(policy(db), ['off', false, false, false, 0, null]);

      sql(db, `update public.ledger_accounts set balance=7.25,frozen=true
        where owner_id='${id.creator}' and account_type='user'`);
      const existing = sql(db, authenticatedSql(id.creator, 'select public.ensure_my_ledger_account()'));
      assert.equal(existing.stdout, calls[0].stdout);
      assert.deepEqual(json(db, `select jsonb_build_array(balance::numeric(38,8)::text,frozen)
        from public.ledger_accounts where owner_id='${id.creator}' and account_type='user'`), ['7.25000000', true]);
      assert.deepEqual(counts(db), [0, 0]);

      const noProfile = randomUUID();
      insertSyntheticAuthUsers(db, [noProfile]);
      denied(sql(db, authenticatedSql(noProfile, 'select public.ensure_my_ledger_account()'), true),
        /ledger_account_profile_required/);
      assert.equal(sql(db, `select count(*) from public.ledger_accounts where owner_id='${noProfile}'`).stdout, '0');
      assert.deepEqual(counts(db), [0, 0]);
      assert.equal(financialActivity(), activityBefore, 'provisioning changed financial activity or authorization state');
    }, null);

    await scenario('migration application remains OFF and foundation rejects activation and authorization INSERT', db => {
      assert.deepEqual(policy(db), ['off', false, false, false, 0, null]);
      denied(sql(db, `update private.creator_premium_finance_policy set purchase_enabled=true where singleton`, true), /foundation_off_check/);
      denied(insertAuthorization(db, config(), 'a'.repeat(64), 'b'.repeat(64), true), /foundation_off/);
      unchangedDenial(db, purchase(), /purchase_disabled/); unchangedDenial(db, subscribe(), /subscription_disabled/);
    }, null);

    await scenario('canonical digests normalize scale and timezone and bind every immutable field', (db, configuration) => {
      const uid = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
      const golden = config({ id: uid(1), buyer_id: uid(2), creator_id: uid(3),
        buyer_account_id: uid(4), creator_account_id: uid(5), platform_account_id: uid(6),
        purchase_content_id: uid(7), purchase_offer_version_id: uid(8), subscription_plan_id: uid(9),
        charge_starts_at: '2026-10-25T00:00:00.000001Z', charge_expires_at: '2026-10-25T00:30:00.000001Z',
        refund_expires_at: '2026-10-25T01:00:00.000001Z' });
      const baseline = digest(db, 'configuration', golden);
      // Hand-checked vector: domain + fixed field order, LF separators, fixed
      // eight-decimal amounts and integer UTC microseconds; no trailing LF.
      assert.equal(baseline, '1b83b17e9b3895a377dd8a12daad5d1a59aec562acbfcf00b068e8f47dfb6f17');
      assert.equal(digest(db, 'configuration', { ...golden, purchase_amount_bdag: '1500',
        charge_starts_at: '2026-10-24T20:00:00.000001-04:00' }), baseline);
      const serialized = sql(db, `select private.creator_premium_finance_configuration_payload_f3_c2_v1(${jsonLiteral(golden)})`).stdout;
      assert.ok(serialized.startsWith('domain:38:creator-premium-f3-c2-configuration-v1\nid:36:10000000-0000-4000-8000-000000000001\n'));
      assert.ok(serialized.includes('purchase_amount_bdag:13:1500.00000000'));
      assert.ok(serialized.includes('charge_starts_at:16:1792886400000001'));
      assert.ok(!serialized.endsWith('\n'));
      assert.equal(createHash('sha256').update(serialized, 'utf8').digest('hex'), baseline);
      for (const [field, value] of Object.entries(golden)) {
        const changed = field.endsWith('_at') ? new Date(Date.parse(value) + 1).toISOString()
          : field.includes('amount') || field === 'max_gross_bdag' ? '1501.00000000'
          : typeof value === 'number' ? value + 1 : field === 'client_contract' ? 'creator-premium-f3-v3' : randomUUID();
        assert.notEqual(digest(db, 'configuration', { ...golden, [field]: changed }), baseline, field);
      }
      assert.equal(digest(db, 'configuration', { ...golden, status: 'CLOSED', closed_at: '2026-10-25T00:05:00Z' }), baseline);
      const commitment = evidence('1b83b17e9b3895a377dd8a12daad5d1a59aec562acbfcf00b068e8f47dfb6f17',
        { approval_reference: 'synthetic aprobaci\u00f3n \ud83d\udd12' });
      const text = sql(db, `select private.creator_premium_finance_attestation_payload_f3_c2_v1(${jsonLiteral(commitment)})`).stdout;
      assert.ok(text.includes(`approval_reference:${Buffer.byteLength(commitment.approval_reference, 'utf8')}:${commitment.approval_reference}`));
      assert.equal(digest(db, 'attestation', commitment), createHash('sha256').update(text, 'utf8').digest('hex'));
      assert.equal(digest(db, 'attestation', commitment), '504d68c0054e08b57679d6efd30a7fcf1209b22fdcc53cf99c7d06759f30a7b0');
      for (const [field, value] of Object.entries(commitment)) {
        const changed = field === 'approved_at' ? '2026-10-25T00:00:00.000001Z'
          : `${value}x`;
        assert.notEqual(digest(db, 'attestation', { ...commitment, [field]: changed }),
          '504d68c0054e08b57679d6efd30a7fcf1209b22fdcc53cf99c7d06759f30a7b0', field);
      }
    });

    for (const fault of ['fake configuration digest', 'absent attestation', 'mismatched attestation']) {
      await scenario(`${fault} cannot create authorization even with service JWT claims`, db => {
        unlockDisposableFoundation(db); const configuration = config();
        const commitment = attest(db, configuration);
        const configurationDigest = fault === 'fake configuration digest' ? 'a'.repeat(64) : commitment.configurationDigest;
        const approvalDigest = fault === 'absent attestation' ? 'b'.repeat(64) : commitment.approvalDigest;
        if (fault === 'mismatched attestation') configuration.max_refund_count = 1;
        const before = snapshot(db);
        denied(insertAuthorization(db, configuration, configurationDigest, approvalDigest, true));
        assert.equal(snapshot(db), before);
        denied(command(db, `insert into private.creator_premium_finance_owner_attestations_f3_c2 default values`), /permission denied/);
      }, null);
    }

    await scenario('3000 funding → 1500 purchase + 1500 subscription → cancel → refund-only close → two reversals → final OFF', db => {
      assert.deepEqual(balances(db), ['3000.00000000', '0.00000000', '0.00000000']);
      const emptyRevenue = premiumRevenue(db);
      assert.deepEqual(
        [emptyRevenue.source.gross_revenue, emptyRevenue.source.reversals,
          emptyRevenue.source.net_revenue, emptyRevenue.source.event_count],
        [0, 0, 0, 0],
      );
      const purchaseKey = randomUUID(), subscriptionKey = randomUUID();
      const bought = step(db, () => success(db, purchase(purchaseKey)));
      const subscribed = step(db, () => success(db, subscribe(subscriptionKey)));
      for (const fact of [bought, subscribed]) {
        assert.equal(fact.money_moved, true); assert.equal(fact.gross_amount_bdag, '1500.00000000');
        assert.equal(fact.platform_fee_bdag, '300.00000000'); assert.equal(fact.creator_net_bdag, '1200.00000000');
      }
      assert.deepEqual(balances(db), ['0.00000000', '2400.00000000', '600.00000000']);
      assert.deepEqual(counts(db), [2, 6]);
      const chargedRevenue = premiumRevenue(db);
      assert.deepEqual(
        [chargedRevenue.source.gross_revenue, chargedRevenue.source.reversals,
          chargedRevenue.source.net_revenue, chargedRevenue.source.event_count],
        [600, 0, 600, 2],
      );
      assert.deepEqual(
        [chargedRevenue.reconciliationSource.status,
          chargedRevenue.reconciliationSource.primary_gross,
          chargedRevenue.reconciliationSource.primary_reversals,
          chargedRevenue.reconciliationSource.crosscheck_gross,
          chargedRevenue.reconciliationSource.crosscheck_reversals,
          chargedRevenue.reconciliationSource.primary_net,
          chargedRevenue.reconciliationSource.crosscheck_net,
          chargedRevenue.reconciliationSource.ledger_net,
          chargedRevenue.reconciliationSource.difference,
          chargedRevenue.reconciliationSource.mismatch_count],
        ['pass', 600, 0, 600, 0, 600, 600, 600, 0, 0],
      );
      const cancel = step(db, () => success(db, `select public.cancel_creator_premium_subscription_v1('${id.buyer}','${subscribed.subscription_id}','${randomUUID()}')`));
      assert.equal(cancel.money_moved, false); assert.deepEqual(counts(db), [2, 6]);
      step(db, () => owner(db, close()));
      assert.deepEqual(policy(db), ['canary', false, false, true, 2000, id.authorization]);
      assert.equal(sql(db, `select status from private.creator_premium_finance_authorizations where id='${id.authorization}'`).stdout, 'CLOSED');
      for (const query of [purchase(purchaseKey), subscribe(subscriptionKey), purchase(), subscribe()]) {
        assert.equal(step(db, () => success(db, query)).money_moved, false, 'closed replay/owned no-op moved money');
      }
      const refundKey = randomUUID();
      assert.equal(step(db, () => success(db, refundPurchase(bought, refundKey))).money_moved, true);
      unchangedDenial(db, purchase(), /disabled|not_open|limit_reached/);
      assert.equal(step(db, () => success(db, refundPeriod(subscribed))).money_moved, true);
      const beforeReplay = snapshot(db);
      for (const query of [refundPurchase(bought, refundKey), refundPurchase(bought), refundPeriod(subscribed)]) {
        assert.equal(step(db, () => success(db, query)).money_moved, false);
      }
      assert.equal(snapshot(db), beforeReplay, 'double refund/replay wrote monetary or velocity state');
      assert.deepEqual(balances(db), ['3000.00000000', '0.00000000', '0.00000000']);
      assert.deepEqual(counts(db), [4, 12]);
      const refundedRevenue = premiumRevenue(db);
      assert.deepEqual(
        [refundedRevenue.source.gross_revenue, refundedRevenue.source.reversals,
          refundedRevenue.source.net_revenue, refundedRevenue.source.event_count],
        [600, 600, 0, 4],
      );
      assert.deepEqual(
        [refundedRevenue.reconciliationSource.status,
          refundedRevenue.reconciliationSource.primary_gross,
          refundedRevenue.reconciliationSource.primary_reversals,
          refundedRevenue.reconciliationSource.crosscheck_gross,
          refundedRevenue.reconciliationSource.crosscheck_reversals,
          refundedRevenue.reconciliationSource.primary_net,
          refundedRevenue.reconciliationSource.crosscheck_net,
          refundedRevenue.reconciliationSource.ledger_net,
          refundedRevenue.reconciliationSource.difference,
          refundedRevenue.reconciliationSource.mismatch_count],
        ['pass', 600, 600, 600, 600, 0, 0, 0, 0, 0],
      );
      const usage = json(db, `select jsonb_build_array(purchase_count,subscription_count,refund_count,gross_bdag::numeric(38,8)::text)
        from private.creator_premium_finance_consumption_f3_v1('${id.authorization}')`);
      assert.deepEqual(usage, [1, 1, 2, '3000.00000000']);
      step(db, () => owner(db, finalize()));
      assert.deepEqual(policy(db), ['off', false, false, false, 0, null]);
      const finalRevenue = premiumRevenue(db);
      assert.deepEqual(
        [finalRevenue.source.gross_revenue, finalRevenue.source.reversals,
          finalRevenue.source.net_revenue, finalRevenue.source.event_count,
          finalRevenue.reconciliationSource.status,
          finalRevenue.reconciliationSource.mismatch_count],
        [600, 600, 0, 4, 'pass', 0],
        'Finance OFF must preserve validated historical Premium revenue and reversals',
      );
      unchangedDenial(db, subscribe(), /disabled|not_open|limit_reached/);
      assert.equal(sql(db, `select count(*) from private.creator_premium_purchase_receipts where access_state='active'`).stdout, '0');
      assert.equal(sql(db, `select count(*) from private.creator_premium_subscription_periods where access_state='active'`).stdout, '0');
    });

    for (const [name, changes, query] of [
      ['wrong actor', {}, () => purchase(randomUUID(), id.outsider)],
      ['wrong account', { buyer_account_id: id.outsiderAccount }, () => purchase()],
      ['wrong price', { purchase_amount_bdag: '1501.00000000', max_gross_bdag: '3001.00000000' }, () => purchase()],
      ['expired charge window', { charge_starts_at: new Date(Date.now() - 2_400_000).toISOString(), charge_expires_at: new Date(Date.now() - 60_000).toISOString() }, () => purchase()],
    ]) await scenario(`${name} cannot debit outside the exact approval scope`, db => unchangedDenial(db, query()), changes);

    await scenario('aggregate gross cap survives refund and denies a second purchase/subscription debit', db => {
      const bought = step(db, () => success(db, purchase()));
      unchangedDenial(db, subscribe(), /limit_reached/);
      step(db, () => success(db, refundPurchase(bought)));
      unchangedDenial(db, purchase(), /limit_reached/);
      unchangedDenial(db, subscribe(), /limit_reached/);
    }, { max_gross_bdag: '1500.00000000' });

    await scenario('refund-only closure retains the total refund count cap', db => {
      const bought = step(db, () => success(db, purchase()));
      const subscribed = step(db, () => success(db, subscribe()));
      step(db, () => owner(db, close()));
      step(db, () => success(db, refundPurchase(bought)));
      unchangedDenial(db, refundPeriod(subscribed), /limit_reached/);
      step(db, () => owner(db, finalize()));
      assert.deepEqual(policy(db), ['off', false, false, false, 0, null]);
      assert.deepEqual(counts(db), [3, 9]);
    }, { max_refund_count: 1 });

    await scenario('expired refund deadline rejects reversal after closure without changing immutable windows', async db => {
      const bought = step(db, () => success(db, purchase())); step(db, () => owner(db, close()));
      await waitForLock(db, `select clock_timestamp()>=refund_expires_at from private.creator_premium_finance_authorizations where id='${id.authorization}'`);
      unchangedDenial(db, refundPurchase(bought), /expired|refunds_disabled/);
      step(db, () => owner(db, finalize()));
      assert.deepEqual(policy(db), ['off', false, false, false, 0, null]);
      assert.deepEqual(counts(db), [1, 3]);
    }, () => ({ charge_expires_at: new Date(Date.now() + 12_000).toISOString(),
      refund_expires_at: new Date(Date.now() + 12_000).toISOString() }));

    await scenario('refund under a different active authorization is rejected while historical facts reconcile', db => {
      const bought = step(db, () => success(db, purchase())); step(db, () => owner(db, close()));
      const configuration = config({ id: randomUUID() });
      const commitment = attest(db, configuration);
      insertAuthorization(db, configuration, commitment.configurationDigest, commitment.approvalDigest);
      owner(db, `update private.creator_premium_finance_policy set active_authorization_id='${configuration.id}',
        purchase_enabled=true,subscription_enabled=true,refunds_enabled=true where singleton`);
      unchangedDenial(db, refundPurchase(bought), /denied|authorization/);
      const mutation = sql(db, `update private.creator_premium_purchase_receipts set finance_authorization_id='${configuration.id}' where id='${bought.receipt_id}'`, true);
      denied(mutation, /snapshot_immutable/);
      const response = reconciliation(db);
      assert.equal(response.counts.integrity_failures, 0, 'historical approval remains valid after disarm');
    });

    await scenario('reconciliation reports an extra transaction copying a valid receipt reference as orphan provenance', db => {
      const bought = step(db, () => success(db, purchase())); const before = snapshot(db);
      // This is an origin-mode owner corruption probe in a rolled-back transaction.
      // Reusing the existing receipt reference defeats F2 reference-only orphan
      // detection; exact original/reversal IDs must still identify the extra row.
      const probe = sql(db, `begin;
        insert into public.financial_transactions
        select (jsonb_populate_record(null::public.financial_transactions,to_jsonb(original)||
          jsonb_build_object('id','${randomUUID()}','idempotency_key','${randomUUID()}',
            'operation_type','creator_premium_purchase_refund'))).*
        from public.financial_transactions original where original.id='${bought.financial_transaction_id}';
        set local request.jwt.claim.sub='${id.admin}';set local request.jwt.claim.role='authenticated';
        set local role authenticated;
        select jsonb_build_object(
          'finance',public.search_admin_creator_premium_finance_v1(null,null,null,null,null,100),
          'revenue',public.get_admin_platform_revenue('all'));
        rollback;`);
      const response = JSON.parse(probe.stdout);
      assert.ok(response.finance.reconciliation.orphan_creator_premium_transactions >= 1,
        'copied reference hid a transaction not named by the exact receipt original/reversal pair');
      const premiumReconciliation = response.revenue.reconciliation.sources.find(
        item => item.source_code === 'creator_premium' && item.currency === 'BDAG',
      );
      assert.ok(premiumReconciliation.mismatch_count >= 1,
        'global platform revenue ignored the orphan Premium transaction');
      assert.equal(premiumReconciliation.status, 'fail');
      assert.equal(snapshot(db), before, 'rollback left corrupted provenance behind');
    });

    await scenario('reconciliation reports balanced Premium ledger legs whose transaction is missing', db => {
      const bought = step(db, () => success(db, purchase()));
      const before = snapshot(db), orphanTransactionId = randomUUID();
      const probe = sql(db, `begin;
        insert into public.ledger_entries
        select (jsonb_populate_record(null::public.ledger_entries,to_jsonb(entry)||jsonb_build_object(
          'id',gen_random_uuid(),'txn_id','${orphanTransactionId}'::uuid,
          'metadata',entry.metadata||jsonb_build_object('fin_txn_id','${orphanTransactionId}')))).*
        from public.ledger_entries entry where entry.txn_id='${bought.financial_transaction_id}';
        set local request.jwt.claim.sub='${id.admin}';set local request.jwt.claim.role='authenticated';
        set local role authenticated;
        select public.search_admin_creator_premium_finance_v1(null,null,null,null,null,100);rollback;`);
      const response = JSON.parse(probe.stdout);
      assert.ok(response.reconciliation.orphan_creator_premium_transactions >= 1,
        'balanced ledger legs without a financial transaction escaped canonical reconciliation');
      assert.deepEqual(JSON.parse(JSON.stringify(parseAdminCreatorPremiumFinance(response))), response);
      assert.equal(snapshot(db), before, 'rollback left orphan ledger provenance behind');
    });

    await scenario('insufficient balance rolls back facts, journal, velocity and authorization consumption', db => {
      sql(db, `update public.ledger_accounts set balance=0 where id='${id.buyerAccount}'`);
      unchangedDenial(db, purchase(), /insufficient|balance/i);
    });

    await scenario('CLOSED cannot reopen, mutate economic scope, repeat close, delete or finalize before reversal', db => {
      step(db, () => success(db, purchase())); step(db, () => owner(db, close()));
      const before = snapshot(db);
      for (const query of [
        `update private.creator_premium_finance_authorizations set status='OPEN' where id='${id.authorization}'`,
        `update private.creator_premium_finance_authorizations set max_purchase_count=2 where id='${id.authorization}'`,
        `delete from private.creator_premium_finance_authorizations where id='${id.authorization}'`, close(), finalize(),
      ]) denied(sql(db, ownerSql(query), true));
      assert.equal(snapshot(db), before);
    });

    await scenario('attestation and lifecycle helpers have exact owner ACL and FORCE RLS', db => {
      for (const table of ['creator_premium_finance_owner_attestations_f3_c2', 'creator_premium_finance_authorizations',
        'creator_premium_finance_policy', 'creator_premium_purchase_receipts', 'creator_premium_subscription_periods']) {
        assert.equal(sql(db, `select relrowsecurity and relforcerowsecurity from pg_class where oid='private.${table}'::regclass`).stdout, 't');
        assert.equal(sql(db, `select not exists(select 1 from pg_class c,
          lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
          where c.oid='private.${table}'::regclass and acl.grantee=0)`).stdout, 't', `${table} grants PUBLIC privileges`);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          assert.equal(sql(db, `select has_table_privilege('${role}','private.${table}','select,insert,update,delete,truncate,references,trigger')`).stdout, 'f');
        }
      }
      assert.equal(sql(db, `select not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname like '%f3_c2_v1' and (p.proowner<>'postgres'::regrole
          or not coalesce(p.proconfig @> array['search_path=""'],false)
          or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
            where acl.grantee=0 and acl.privilege_type='EXECUTE')
          or exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(name)
            where has_function_privilege(r.name,p.oid,'execute'))))`).stdout, 't');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        denied(sql(db, `begin;set local role ${role};select * from private.creator_premium_finance_owner_attestations_f3_c2;rollback;`, true), /permission denied/);
        denied(sql(db, `begin;set local role ${role};${close()};rollback;`, true), /permission denied/);
      }
      for (const query of [
        `update private.creator_premium_finance_owner_attestations_f3_c2 set approval_reference='tampered'`,
        `delete from private.creator_premium_finance_owner_attestations_f3_c2`,
      ]) denied(sql(db, ownerSql(query), true), /immutable|attestation/);
    });

    await scenario('close holding policy serializes concurrent charge and refund without an inverted fact lock', async db => {
      const bought = step(db, () => success(db, purchase()));
      const marker = Math.floor(Math.random() * 1_000_000_000) + 1;
      const holder = dockerHolder(pgCommand(db), `begin;set local role postgres;${close()};select pg_advisory_xact_lock(${marker});`);
      let charge, refund;
      try {
        await waitForLock(db, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`);
        charge = dockerAsync(pgCommand(db), serviceSql(`set local application_name='c2_race_charge';${subscribe()}`));
        refund = dockerAsync(pgCommand(db), serviceSql(`set local application_name='c2_race_refund';${refundPurchase(bought)}`));
        await waitForLock(db, `select count(*)=2 from pg_stat_activity where datname=current_database()
          and application_name in ('c2_race_charge','c2_race_refund') and wait_event_type='Lock'`);
        const factLock = sql(db, `begin;select id from private.creator_premium_purchase_receipts where id='${bought.receipt_id}' for update nowait;rollback;`, true);
        assert.equal(factLock.status, 0, 'refund locked fact before waiting on closure policy');
      } finally { holder.release(); assert.equal((await holder.result).status, 0); }
      const [charged, refunded] = await Promise.all([charge, refund]);
      denied(charged, /disabled|not_open/); assert.equal(refunded.status, 0, refunded.stderr);
      assert.deepEqual(counts(db), [2, 6]); assert.deepEqual(balances(db), ['3000.00000000', '0.00000000', '0.00000000']);
    });

    await scenario('two simultaneous refund keys reverse once and preserve caps', async db => {
      const bought = step(db, () => success(db, purchase())); step(db, () => owner(db, close()));
      const results = await Promise.all([refundPurchase(bought), refundPurchase(bought)].map(query => dockerAsync(pgCommand(db), serviceSql(query))));
      for (const result of results) assert.equal(result.status, 0, result.stderr);
      assert.equal(results.map(result => JSON.parse(result.stdout)).filter(result => result.money_moved).length, 1);
      assert.deepEqual(counts(db), [2, 6]);
    });
  } finally { docker(`dropdb -U supabase_admin --force --if-exists ${base}`, '', true); }
});
