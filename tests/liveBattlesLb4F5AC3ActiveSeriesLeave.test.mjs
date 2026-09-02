import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const f5a = await read(
  'supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
);
const proof = await read(
  'supabase/tests/live_battles_lb4_f5_a_c3_active_series_leave.sql',
);
const concurrency = await read(
  'scripts/prove-live-battle-series-leave-concurrency.mjs',
);
const packageText = await read('package.json');
const lockText = await read('package-lock.json');

const body = migration.match(
  /create or replace function public\.leave_live_battle_series[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

test('C3 is append-only and replaces only leave_live_battle_series', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 1);
  assert.match(migration, /create or replace function public\.leave_live_battle_series\(p_series_id uuid\)/i);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+(table|trigger|type|schema)\b/i);
});

test('leave preserves security definer identity validation and closed ACL', () => {
  assert.match(body, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(body, /v_actor uuid := auth\.uid\(\)/i);
  assert.match(body, /live_battle_series_auth_required/);
  assert.match(body, /live_battle_series_not_participant/);
  assert.match(migration, /alter function public\.leave_live_battle_series\(uuid\) owner to postgres/i);
  assert.match(migration,
    /revoke all on function public\.leave_live_battle_series\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration,
    /grant execute on function public\.leave_live_battle_series\(uuid\)[\s\S]*to authenticated/i);
});

test('the first series read is non-locking and canonical locks precede the Battle lock', () => {
  const snapshot = body.indexOf('into v_series_snapshot');
  const users = body.indexOf('private.live_battle_lock_users');
  const sessions = body.indexOf('private.live_battle_lock_sessions');
  const battle = body.indexOf('into v_latest');
  const battleLock = body.indexOf('for update nowait;', battle);
  const snapshotEnd = body.indexOf(';', snapshot);
  assert.ok(snapshot >= 0 && snapshot < users && users < sessions && sessions < battleLock);
  assert.doesNotMatch(body.slice(snapshot, snapshotEnd), /for update/i);
  assert.match(body, /for update nowait[\s\S]*when lock_not_available[\s\S]*pg_catalog\.pg_sleep\(0\.01\)/i);
});

test('clock and reconciliation happen only after the latest Battle is locked', () => {
  const battleLock = body.indexOf('for update nowait;');
  const clock = body.indexOf('v_now := pg_catalog.clock_timestamp()');
  const reconcile = body.indexOf('private.live_battle_reconcile_locked');
  assert.ok(battleLock >= 0 && battleLock < clock && clock < reconcile);
  assert.equal((body.match(/pg_catalog\.clock_timestamp\(\)/g) ?? []).length, 1);
});

test('active leave reuses transition authority before taking the explicit series lock', () => {
  assert.match(body, /v_latest\.status in \('pending', 'accepted', 'countdown', 'active'\)/i);
  assert.match(body,
    /private\.live_battle_transition\([\s\S]*v_latest\.status,[\s\S]*'cancelled',[\s\S]*v_actor,[\s\S]*v_reason/i);
  const transition = body.indexOf('private.live_battle_transition');
  const seriesLockSelect = body.indexOf('into strict v_series', transition);
  const seriesLock = body.indexOf('for update;', seriesLockSelect);
  assert.ok(transition >= 0 && transition < seriesLockSelect && seriesLockSelect < seriesLock);
  assert.doesNotMatch(body, /update public\.live_battles|update public\.live_battle_score_states/i);
});

test('challenger and opponent cancellation reasons are exact', () => {
  assert.match(body,
    /when v_actor = v_latest\.challenger_user_id then 'challenger_cancelled'[\s\S]*else 'opponent_cancelled'/i);
});

test('active cancellation closes requests and demands a complete cancelled series', () => {
  assert.match(body,
    /update public\.live_battle_rematch_requests[\s\S]*status = 'cancelled'[\s\S]*request\.status = 'pending'/i);
  assert.match(body,
    /v_series\.status <> 'cancelled'[\s\S]*champion_user_id is not null[\s\S]*completed_at is null[\s\S]*rematch_window_expires_at is not null/i);
  assert.match(body, /live_battle_series_leave_incomplete/);
  assert.match(body, /private\.sync_live_battle_series_projection_locked/);
});

test('terminal and between-round behavior remains idempotent and score-preserving', () => {
  assert.match(body, /if v_series\.status in \('completed', 'cancelled'\) then[\s\S]*return/i);
  assert.match(body,
    /v_latest\.status = 'completed' and v_series\.rounds_completed > 0/i);
  assert.match(body, /private\.live_battle_series_champion/i);
  assert.doesNotMatch(body, /delete from public\.live_battle_(score|gift)/i);
});

test('proof covers both actors across every open Battle status', () => {
  for (const [caseId, status, side] of [
    [1, 'pending', 'challenger'], [2, 'pending', 'opponent'],
    [3, 'accepted', 'challenger'], [4, 'accepted', 'opponent'],
    [5, 'countdown', 'challenger'], [6, 'countdown', 'opponent'],
    [7, 'active', 'challenger'], [8, 'active', 'opponent'],
  ]) {
    assert.match(proof, new RegExp(`c3_prepare_case\\(${caseId}, '${status}', '${side}'\\)`, 'i'));
  }
  for (const marker of [
    'c3_active_leave_battle_invalid',
    'c3_active_leave_score_invalid',
    'c3_active_leave_series_invalid',
    'c3_active_leave_terminal_event_count',
    'c3_active_leave_not_idempotent',
    'c3_active_leave_projection_stale',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /rollback;\s*$/i);
});

test('proof covers authorization, terminal routes and live-session preservation', () => {
  for (const marker of [
    'c3_unauthenticated_leave_allowed',
    'c3_nonparticipant_leave_allowed',
    'c3_missing_series_allowed',
    'c3_between_round_result_changed',
    'c3_between_round_path_invalid',
    'c3_active_leave_ended_live',
  ]) assert.match(proof, new RegExp(marker));
});

test('proof protects gifts, financial rows, balances and score provenance', () => {
  assert.match(proof, /c3-gift-before-leave/);
  assert.match(proof, /c3-gift-after-leave/);
  for (const marker of [
    'c3_confirmed_gift_missing_score_fact',
    'c3_leave_changed_financial_state',
    'c3_score_without_gift',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /live_gift_transactions/);
  assert.match(proof, /financial_transactions/);
  assert.match(proof, /ledger_entries/);
  assert.match(proof, /sum\(balance\)/);
});

test('real concurrency proof uses independent local-only connections and timeouts', () => {
  for (const name of ['admin', 'first', 'second', 'blocker', 'senderClient']) {
    assert.match(concurrency, new RegExp(`const ${name} = new Client`));
  }
  assert.match(concurrency, /C3 proof refuses non-local databases/);
  assert.match(concurrency, /set lock_timeout = '3s'/);
  assert.match(concurrency, /set statement_timeout = '8s'/);
  assert.doesNotMatch(concurrency, /supabase\.co|aewwdlvbwpczqyvkwvvj|service_role_key/i);
});

test('concurrency covers all five required races without accepting deadlocks', () => {
  for (const marker of [
    'dualLeave', 'leaveVsCancel', 'leaveVsElapsed',
    'giftFirst', 'leaveFirst', 'acceptVsLeave',
  ]) assert.match(concurrency, new RegExp(marker));
  assert.match(concurrency, /assert\.notEqual\(result\.reason\?\.code, '40P01'/);
  assert.match(concurrency, /duplicateTerminalTransitions: 0/);
  assert.match(concurrency, /scoreWithoutGift: 0/);
});

test('C3 does not define a parallel authority or touch protected domains', () => {
  assert.doesNotMatch(migration,
    /agora|media relay|wallet|ledger|financial_transactions|gift_catalog|power|marketplace|creator recovery|edge function/i);
  assert.doesNotMatch(migration, /\brealtime\.|alter publication|supabase\/functions/i);
});

test('F5-A and manifests remain byte/logically protected', () => {
  const normalizedF5A = f5a.replaceAll('\r\n', '\n');
  assert.equal(
    createHash('sha256').update(normalizedF5A, 'utf8').digest('hex'),
    '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45',
  );
  assert.equal(
    createHash('sha256').update(packageText.replaceAll('\r\n', '\n'), 'utf8').digest('hex'),
    '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0',
  );
  assert.equal(
    createHash('sha256').update(lockText.replaceAll('\r\n', '\n'), 'utf8').digest('hex'),
    '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4',
  );
});
