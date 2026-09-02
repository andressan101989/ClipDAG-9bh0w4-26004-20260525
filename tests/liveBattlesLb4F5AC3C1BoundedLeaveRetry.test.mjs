import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const f5a = await read('supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql');
const c3 = await read('supabase/migrations/20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql');
const c3Proof = await read('supabase/tests/live_battles_lb4_f5_a_c3_active_series_leave.sql');
const proof = await read('supabase/tests/live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql');
const concurrency = await read('scripts/prove-live-battle-series-leave-bounded-concurrency.mjs');
const packageText = await read('package.json');
const lockText = await read('package-lock.json');

const leave = migration.match(
  /create or replace function public\.leave_live_battle_series[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const helper = migration.match(
  /create or replace function private\.live_battle_series_try_lock_scope[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

test('C3-C1 is append-only and defines one lock helper plus the existing RPC', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+(table|trigger|type|schema)\b/i);
  assert.match(helper, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(leave, /security definer[\s\S]*set search_path = ''/i);
});

test('the retry has a 750 ms deadline and a finite secondary attempt bound', () => {
  assert.match(leave, /interval '750 milliseconds'/i);
  assert.match(leave, /v_max_attempts constant integer := 128/i);
  assert.match(leave, /while v_attempts < v_max_attempts loop/i);
  assert.doesNotMatch(leave, /(^|\n)\s*loop\s*($|\n)/i);
  assert.match(leave, /v_lock_deadline - pg_catalog\.clock_timestamp\(\)/i);
  assert.match(leave, /\bleast\([\s\S]*0\.010[\s\S]*extract\(epoch from v_remaining\)/i);
});

test('every pre-transition lock is NOWAIT and failed attempts release their subtransaction', () => {
  assert.equal((helper.match(/for update nowait/gi) ?? []).length, 7);
  assert.match(helper, /order by actor\.id[\s\S]*for update nowait/i);
  assert.match(helper, /order by session\.id[\s\S]*for update nowait/i);
  assert.match(helper, /order by battle\.round_number desc, battle\.id desc[\s\S]*for update nowait/i);
  assert.match(helper, /live_battle_score_states[\s\S]*for update nowait[\s\S]*live_battle_series[\s\S]*for update nowait/i);
  assert.match(helper, /live_battle_rematch_requests[\s\S]*for update nowait[\s\S]*live_battle_public_states[\s\S]*for update nowait/i);
  assert.match(leave,
    /begin[\s\S]*live_battle_series_try_lock_scope\([\s\S]*exception\s+when lock_not_available then\s+v_lock_acquired := false;\s+end;/i);
});

test('busy failure is exact and no transaction or session lock_timeout is changed', () => {
  assert.ok((leave.match(/errcode = '55P03', message = 'live_battle_series_leave_busy'/g) ?? []).length >= 3);
  assert.doesNotMatch(migration, /lock_timeout/i);
  assert.equal((leave.match(/when lock_not_available/g) ?? []).length, 1);
});

test('successful Battle lock precedes the authoritative clock and reconciliation', () => {
  const locked = leave.indexOf('if v_lock_acquired then');
  const clock = leave.indexOf('v_now := pg_catalog.clock_timestamp()');
  const reconcile = leave.indexOf('private.live_battle_reconcile_locked');
  assert.ok(locked >= 0 && locked < clock && clock < reconcile);
});

test('C3 lifecycle semantics and Battle to score to series authority are preserved', () => {
  assert.match(leave, /v_latest\.status in \('pending', 'accepted', 'countdown', 'active'\)/i);
  assert.match(leave, /private\.live_battle_transition\([\s\S]*'cancelled'[\s\S]*v_reason/i);
  assert.match(leave, /challenger_cancelled[\s\S]*opponent_cancelled/i);
  assert.match(leave, /private\.reconcile_live_battle_series_locked/i);
  assert.match(leave, /private\.sync_live_battle_series_projection_locked/i);
  assert.match(leave, /private\.live_battle_series_champion/i);
  assert.doesNotMatch(leave, /update public\.live_battles|update public\.live_battle_score_states/i);
});

test('helper is not a lifecycle authority and is closed to every client role', () => {
  assert.doesNotMatch(helper, /transition|reconcile|gift|financial|ledger/i);
  assert.match(migration,
    /revoke all on function private\.live_battle_series_try_lock_scope\(uuid, uuid, uuid, uuid, uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute on function private\.live_battle_series_try_lock_scope/i);
  assert.match(migration,
    /revoke all on function public\.leave_live_battle_series\(uuid\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('C3 proof now enforces exact zero or two public projections', () => {
  assert.match(c3Proof, /initial_status in \('pending', 'accepted'\)[\s\S]*count\(\*\)[\s\S]*<> 0/i);
  assert.match(c3Proof, /count\(\*\)[\s\S]*<> 2/i);
  for (const field of [
    'series_id = v_case.series_id', "status = 'cancelled'", "outcome = 'cancelled'",
    "series_status = 'cancelled'", 'winner_user_id is null',
    'series_champion_user_id is null', 'rematch_request_id is null',
  ]) assert.ok(c3Proof.includes(field), field);
  assert.match(proof, /\\ir live_battles_lb4_f5_a_c3_active_series_leave\.sql/);
  assert.match(proof, /rollback;\s*$/i);
});

test('real harness proves active blocking, elapsed budget and retry recovery', () => {
  assert.match(concurrency, /pg_stat_activity[\s\S]*state='active'/i);
  assert.match(concurrency, /performance\.now\(\)/);
  assert.match(concurrency, /elapsedMs >= 650 && elapsedMs < 1_500/);
  assert.match(concurrency, /reason\.code, '55P03'/);
  assert.match(concurrency, /reason\.message, 'live_battle_series_leave_busy'/);
  assert.match(concurrency, /tryIndependentScopeLocks/);
  assert.match(concurrency, /retryStatus/);
});

test('real harness crosses a future scheduled deadline while the Battle is locked', () => {
  assert.match(concurrency, /pg_catalog\.clock_timestamp\(\) \+ interval '500 milliseconds'/);
  assert.match(concurrency, /waitForLeaveActive/);
  assert.match(concurrency, /pg_catalog\.pg_sleep_until/);
  assert.match(concurrency, /queryStartBeforeScheduledEnd/);
  assert.match(concurrency, /scheduledEndBeforeBlockerRelease/);
  assert.match(concurrency, /blockerReleaseWithin750ms/);
  assert.match(concurrency, /winnerPreserved/);
  assert.match(concurrency, /terminalEvents/);
});

test('seven races execute at least twenty iterations and reject infrastructure failures', () => {
  assert.match(concurrency, /iterations >= 20/);
  for (const marker of [
    'dualLeave', 'leaveVsCancel', 'leaveVsCompletion', 'giftFirst',
    'leaveFirst', 'acceptVsLeave', 'betweenRoundsVsDue',
  ]) assert.match(concurrency, new RegExp(marker));
  for (const forbidden of ['40P01', '57014', 'statement timeout', 'lock timeout']) {
    assert.match(concurrency, new RegExp(forbidden, 'i'));
  }
  assert.doesNotMatch(concurrency, /transferPartial\s*:\s*false/);
});

test('economic evidence is derived from linked rows and exact balance deltas', () => {
  for (const marker of [
    'live_gift_transactions', 'live_battle_score_events', 'financial_transactions',
    'ledger_entries', 'financial_transaction_id', 'idempotency_key',
    'ownerBalance', 'accountBalance', 'platformAccountId',
  ]) assert.match(concurrency, new RegExp(marker));
  assert.match(concurrency, /assert\.equal\(createdLedger\.length, 3\)/);
  assert.match(concurrency, /entry_type === 'debit'/);
  assert.match(concurrency, /entry_type === 'credit'/);
  assert.match(concurrency, /assert\.deepEqual\(await economySnapshot\(giftFirst\), economyAfterGift\)/);
  assert.match(concurrency, /assert\.deepEqual\(await economySnapshot\(leaveFirst\), leaveBaseline\)/);
});

test('C3-C1 does not touch protected product domains', () => {
  assert.doesNotMatch(migration,
    /agora|media relay|marketplace|creator recovery|edge function|power.?up|gift_catalog|atomic_ledger_transfer/i);
  assert.doesNotMatch(migration, /alter publication|\brealtime\.|supabase\/functions/i);
});

test('F5-A, C3 and manifests remain protected', () => {
  assert.equal(createHash('sha256').update(f5a.replaceAll('\r\n', '\n')).digest('hex'),
    '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45');
  assert.equal(createHash('sha256').update(c3.replaceAll('\r\n', '\n')).digest('hex'),
    '64b94397de5a7f31449f6a025eb458a41b35f0e936b23eeb79ae379e0b7751bd');
  assert.equal(createHash('sha256').update(packageText.replaceAll('\r\n', '\n'), 'utf8').digest('hex'),
    '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0');
  assert.equal(createHash('sha256').update(lockText.replaceAll('\r\n', '\n'), 'utf8').digest('hex'),
    '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4');
});
