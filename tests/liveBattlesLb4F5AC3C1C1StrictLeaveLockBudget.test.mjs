import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const normalizeLf = text => text.replaceAll('\r\n', '\n');
const sha256Lf = text => createHash('sha256').update(normalizeLf(text), 'utf8').digest('hex');
const migrationName =
  '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const f5a = await read(
  'supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
);
const c3 = await read(
  'supabase/migrations/20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
);
const c3c1 = await read(
  'supabase/migrations/20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
);
const proof = await read(
  'supabase/tests/live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
);
const harness = await read(
  'scripts/prove-live-battle-series-leave-bounded-concurrency.mjs',
);
const packageText = await read('package.json');
const lockText = await read('package-lock.json');
const migrationNames = (await readdir(new URL('../supabase/migrations', import.meta.url)))
  .filter(name => name.endsWith('.sql'))
  .sort();

const helper = migration.match(
  /create or replace function private\.live_battle_series_try_lock_scope_strict[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const leave = migration.match(
  /create or replace function public\.leave_live_battle_series[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

const lockClosure = [
  ['auth.users', 'row share'],
  ['public.live_sessions', 'row share'],
  ['public.live_battles', 'row exclusive'],
  ['public.live_battle_score_states', 'row exclusive'],
  ['public.live_battle_series', 'row exclusive'],
  ['public.live_battle_rematch_requests', 'row exclusive'],
  ['public.live_battle_public_states', 'row exclusive'],
  ['public.live_battle_events', 'row exclusive'],
  ['public.live_battle_rule_sets', 'access share'],
  ['public.live_battle_power_states', 'row exclusive'],
  ['public.live_battle_boost_events', 'access share'],
  ['public.live_gift_transactions', 'access share'],
  ['public.live_battle_score_events', 'access share'],
];

test('C3-C1-C1 remains in the explicit append-only correction chain', () => {
  assert.deepEqual(migrationNames.slice(-5), [
    '20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
    '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
    '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
    migrationName,
    '20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql',
  ]);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+(table|trigger|type|schema)\b/i);
});

test('all thirteen table locks are NOWAIT, mode-specific and globally ordered', () => {
  let previous = -1;
  for (const [relation, mode] of lockClosure) {
    const statement = `lock table ${relation} in ${mode} mode nowait`;
    const position = helper.toLowerCase().indexOf(statement);
    assert.ok(position > previous, statement);
    previous = position;
  }
  assert.equal((helper.match(/lock table [^;]+ nowait/gi) ?? []).length, 13);
  const firstLookup = helper.toLowerCase().indexOf('select series.* into v_series_snapshot');
  assert.ok(firstLookup > previous, 'series lookup must follow every table lock');
});

test('row locks complete the canonical users to sessions to Battle scope', () => {
  assert.match(helper, /order by actor\.id[\s\S]*for update nowait/i);
  assert.match(helper, /order by session\.id[\s\S]*for update nowait/i);
  assert.match(helper,
    /order by battle\.round_number desc, battle\.id desc[\s\S]*limit 1[\s\S]*for update nowait/i);
  assert.match(helper,
    /live_battle_score_states[\s\S]*live_battle_series[\s\S]*live_battle_rematch_requests[\s\S]*live_battle_public_states/i);
  assert.match(helper, /live_battle_rule_sets[\s\S]*for key share nowait/i);
  assert.match(helper, /live_battle_power_states[\s\S]*for update nowait/i);
  assert.doesNotMatch(helper,
    /live_battle_transition|reconcile_live_battle|sync_live_battle|insert into|update public|delete from/i);
});

test('lock acquisition remains bounded to 750 ms, 128 attempts and 10 ms backoff', () => {
  assert.match(leave, /interval '750 milliseconds'/i);
  assert.match(leave, /v_max_attempts constant integer := 128/i);
  assert.match(leave, /while v_attempts < v_max_attempts loop/i);
  assert.match(leave, /least\([\s\S]*0\.010[\s\S]*extract\(epoch from v_remaining\)/i);
  assert.ok((leave.match(/errcode = '55P03', message = 'live_battle_series_leave_busy'/g) ?? []).length >= 3);
  assert.equal((leave.match(/when lock_not_available/gi) ?? []).length, 1);
  assert.match(leave,
    /begin[\s\S]*live_battle_series_try_lock_scope_strict[\s\S]*exception\s+when lock_not_available then[\s\S]*end;/i);
  assert.doesNotMatch(migration, /lock_timeout|statement_timeout/i);
});

test('security identity, empty search paths and closed ACL are explicit', () => {
  assert.match(helper, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(leave, /security definer[\s\S]*set search_path = ''/i);
  assert.match(leave, /v_actor uuid := auth\.uid\(\)/i);
  assert.match(leave, /live_battle_series_auth_required/);
  assert.match(leave, /live_battle_series_not_participant/);
  assert.match(migration,
    /revoke all on function private\.live_battle_series_try_lock_scope_strict\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration,
    /revoke all on function public\.leave_live_battle_series\(uuid\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('proof checks definitions and real ACL privileges then rolls back', () => {
  assert.match(proof, /\\ir live_battles_lb4_f5_a_c3_c1_bounded_leave_retry\.sql/);
  assert.match(proof, /pg_catalog\.pg_get_functiondef/);
  assert.match(proof, /pg_catalog\.has_function_privilege/g);
  assert.match(proof, /pg_catalog\.aclexplode/);
  assert.match(proof, /c3_c1_c1_table_lock_order_invalid/);
  assert.match(proof, /c3_c1_c1_lock_capture_not_narrow/);
  assert.match(proof, /rollback;\s*$/i);
});

test('table-lock matrix proves exact busy rejection, invariance and recovery', () => {
  assert.match(harness, /async function runTableLockMatrix/);
  assert.match(harness, /blockerModeByRequestedMode/);
  assert.match(harness, /lock table \$\{relation\} in \$\{blockerMode\} mode/);
  assert.match(harness, /waitForReleasedPartialLocks/);
  assert.match(harness, /reason\.code, '55P03'/);
  assert.match(harness, /reason\.message, 'live_battle_series_leave_busy'/);
  assert.match(harness, /elapsedMs >= 650 && elapsedMs < 1_500/);
  assert.match(harness, /assert\.deepEqual\(await stateSnapshot\(value\), before\)/);
  assert.match(harness, /partialLocksReleased: true/);
  assert.match(harness, /retryStatus/);
});

test('deadline crossing uses PostgreSQL timestamps and preserves terminal truth', () => {
  assert.match(harness, /pg_catalog\.clock_timestamp\(\) \+ interval '500 milliseconds'/);
  assert.match(harness, /pg_catalog\.pg_sleep_until/);
  assert.match(harness, /query_start/);
  assert.match(harness, /queryStartBeforeScheduledEnd/);
  assert.match(harness, /scheduledEndBeforeBlockerRelease/);
  assert.match(harness, /blockerReleaseWithin750ms/);
  assert.match(harness, /final\.outcome, 'challenger'/);
  assert.match(harness, /final\.winner, value\.challenger/);
  assert.match(harness, /final\.terminal_events, 1/);
});

test('seven races require twenty observable overlaps and exact rejection whitelists', () => {
  assert.match(harness, /iterations >= 20/);
  assert.match(harness, /observeOverlap/);
  assert.match(harness, /pg_stat_activity/);
  assert.match(harness, /stat\.overlapsObserved, iterations/);
  for (const scenario of [
    'dualLeave', 'leaveVsCancel', 'leaveVsCompletion', 'giftFirst',
    'leaveFirst', 'acceptVsLeave', 'betweenRoundsVsDue',
  ]) assert.match(harness, new RegExp(scenario));
  assert.match(harness, /inspectScenarioResults/);
  assert.match(harness, /unexpected rejection/);
  assert.match(harness, /P0001\|live_battle_gift_not_active/);
  assert.doesNotMatch(harness, /Promise\.allSettled\([^)]*\)\s*;\s*stats/s);
});

test('economic evidence is linked, balanced and exact in both orderings', () => {
  for (const marker of [
    'financial_transaction_id', 'gift_transaction_id', 'metadata?.fin_txn_id',
    "entry_type === 'debit'", "entry_type === 'credit'",
    'from_account_id', 'to_account_id', 'platformAccountId',
  ]) assert.ok(harness.includes(marker), marker);
  assert.match(harness, /assert\.equal\(createdLedger\.length, 3\)/);
  assert.match(harness,
    /Number\(creatorCredit\.amount\) \+ Number\(platformCredit\.amount\) - Number\(debit\.amount\)/);
  assert.match(harness, /ownerBalance\(economyAfterGift, giftFirst\.sender\)[\s\S]*-Number\(createdGift\.amount_coins\)/);
  assert.match(harness, /ownerBalance\(economyAfterGift, giftFirst\.challenger\)[\s\S]*Number\(createdGift\.creator_amount_coins\)/);
  assert.match(harness, /accountBalance\(economyAfterGift, platformAccountId\)[\s\S]*Number\(createdGift\.platform_fee_coins\)/);
  assert.match(harness, /assert\.deepEqual\(await economySnapshot\(leaveFirst\), leaveBaseline\)/);
});

test('protected migrations and manifests use canonical LF hashes', () => {
  assert.equal(sha256Lf(f5a),
    '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45');
  assert.equal(sha256Lf(c3),
    '64b94397de5a7f31449f6a025eb458a41b35f0e936b23eeb79ae379e0b7751bd');
  assert.equal(sha256Lf(c3c1),
    '1da58dbf6ab85c5953c227d6cc2b2904bc4346a58ff5ca58054b010000bb5237');
  assert.equal(sha256Lf(packageText),
    '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0');
  assert.equal(sha256Lf(lockText),
    '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4');
});

test('migration stays outside product, Realtime and financial authority', () => {
  assert.doesNotMatch(migration,
    /agora|media relay|marketplace|creator recovery|edge function|gift_catalog|atomic_ledger_transfer|financial_transactions|ledger_entries/i);
  assert.doesNotMatch(migration, /alter publication|\brealtime\.|supabase\/functions/i);
});
