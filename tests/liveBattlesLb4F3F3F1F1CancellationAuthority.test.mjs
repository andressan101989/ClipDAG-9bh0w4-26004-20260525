import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const previousName = '20260829142317_live_battles_lb4_f3_f3_f1_accepted_lifecycle.sql';
const migrationName = '20260829150940_live_battles_lb4_f3_f3_f1_f1_cancellation_authority.sql';
const transitionPlanMigrationName = '20260829161856_live_battles_lb4_f3_f3_f1_f2_transition_plan.sql';
const directedGiftsMigrationName = '20260829225002_live_battles_lb4_f4a_directed_gifts.sql';
const scoreOutcomeMigrationName = '20260830030845_live_battles_lb4_f4b_score_outcome.sql';
const powerEngineMigrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const powerProjectionMigrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const visualRealtimeMigrationName = '20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql';
const proofName = 'live_battles_lb4_f3_f3_f1_f1_cancellation_authority.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const sqlProof = await read(`supabase/tests/${proofName}`);

function functionBody(name) {
  const start = migration.indexOf(`function private.${name}(`);
  assert.notEqual(start, -1, `private.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `private.${name} terminates`);
  return migration.slice(start, end + 4);
}

test('LB4-F3-F3-F1-F1 is the only forward migration and preserves the deployed predecessor', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > previousName);
  assert.deepEqual(names, [
    migrationName,
    transitionPlanMigrationName,
    directedGiftsMigrationName,
    scoreOutcomeMigrationName,
    powerEngineMigrationName,
    powerProjectionMigrationName,
    visualRealtimeMigrationName,
    '20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
    '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
    '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
    '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
    '20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql',
  ]);
  const previous = (await read(`supabase/migrations/${previousName}`)).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(previous).digest('hex'),
    '024989d6a5f16be79e5725dfd3f375d334340c234ee7d536ec7ec0ad60b85f43');
});

test('manual cancellation reasons require the exact non-null participant actor', () => {
  const body = functionBody('live_battle_transition');
  assert.match(body, /p_actor_user_id is not null\s+and p_actor_user_id = v_battle\.challenger_user_id\s+and p_reason = 'challenger_cancelled'/);
  assert.match(body, /p_actor_user_id is not null\s+and p_actor_user_id = v_battle\.opponent_user_id\s+and p_reason = 'opponent_cancelled'/);
  assert.match(body, /p_next_status = 'cancelled' and not \(\s+p_reason is not null and \(/);
  assert.doesNotMatch(body, /\(p_actor_user_id = v_battle\.(?:challenger|opponent)_user_id and p_reason/);
  assert.match(body, /p_next_status = 'cancelled' and not \([\s\S]*errcode = '42501',[\s\S]*message = 'live_battle_transition_actor_invalid'/);
});

test('null actor authority is limited to the three exact state and reason combinations', () => {
  const body = functionBody('live_battle_transition');
  assert.match(body, /p_expected_status = 'accepted'\s+and p_actor_user_id is null\s+and p_reason in \('accepted_start_timeout', 'session_not_live_after_accept'\)/);
  assert.match(body, /p_expected_status = 'countdown'\s+and p_actor_user_id is null\s+and p_reason = 'session_not_live_before_start'/);
  assert.equal((body.match(/p_actor_user_id is null/g) ?? []).length, 2);
  assert.equal((body.match(/accepted_start_timeout/g) ?? []).length, 1);
  assert.equal((body.match(/session_not_live_after_accept/g) ?? []).length, 1);
  assert.equal((body.match(/session_not_live_before_start/g) ?? []).length, 1);
});

test('accepted reconciliation keeps liveness priority and uses the sargable deadline', () => {
  const body = functionBody('live_battle_reconcile_locked');
  const accepted = body.indexOf("v_battle.status = 'accepted'");
  const liveness = body.indexOf('private.live_battle_session_pair_is_live', accepted);
  const sessionReason = body.indexOf("'session_not_live_after_accept'", accepted);
  const deadline = body.indexOf("v_battle.accepted_at <= p_now - interval '30 seconds'", accepted);
  const timeoutReason = body.indexOf("'accepted_start_timeout'", accepted);
  assert.ok(accepted < liveness && liveness < sessionReason && sessionReason < deadline && deadline < timeoutReason);
  assert.doesNotMatch(body, /accepted_at \+ interval '30 seconds'/);
  assert.doesNotMatch(body, /clock_timestamp|statement_timestamp|now\(\)/i);
});

test('bounded due reconciliation uses one clock, the accepted index key, and unchanged locking', () => {
  const body = functionBody('reconcile_due_live_battles');
  assert.equal((body.match(/pg_catalog\.clock_timestamp\(\)/g) ?? []).length, 1);
  assert.match(body, /b\.accepted_at <= v_server_now - interval '30 seconds'/);
  assert.match(body, /select b\.id, b\.status, b\.accepted_at as due_at[\s\S]*b\.status = 'accepted'[\s\S]*b\.accepted_at <= v_server_now - interval '30 seconds'/);
  assert.match(body, /order by d\.due_at, b\.id/);
  assert.doesNotMatch(body, /accepted_at \+ interval '30 seconds'/);
  assert.match(body, /order by[\s\S]*b\.id[\s\S]*for update(?: of b)? skip locked[\s\S]*limit p_limit/i);
  assert.match(body, /p_limit is null or p_limit < 1 or p_limit > 500/);
  assert.doesNotMatch(body, /\b(update|insert|delete|merge|truncate)\s+(public\.)?live_battle/i);
});

test('correction replaces only three private functions and preserves cron, index, UI, Agora and economy', () => {
  assert.equal((migration.match(/create or replace function private\./g) ?? []).length, 3);
  for (const name of [
    'live_battle_transition',
    'live_battle_reconcile_locked',
    'reconcile_due_live_battles',
  ]) assert.match(migration, new RegExp(`create or replace function private\\.${name}\\(`));
  assert.doesNotMatch(migration, /create or replace function public\./i);
  assert.doesNotMatch(migration, /create\s+(?:unique\s+)?index|drop\s+index/i);
  assert.doesNotMatch(migration, /cron\.(?:schedule|unschedule)|reconcile-due-live-battles/i);
  assert.doesNotMatch(migration, /agora|media relay|send_live_gift|wallet|ledger|financial_transactions|marketplace|commerce|score|winner|loser/i);
  assert.doesNotMatch(migration, /create table|create policy|drop policy|alter publication/i);
});

test('all three private functions restore exact ownership, search path and client-denied ACL', () => {
  for (const signature of [
    'private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)',
    'private.live_battle_reconcile_locked(uuid, timestamptz)',
    'private.reconcile_due_live_battles(integer)',
  ]) {
    const escaped = signature.replace(/[().]/g, '\\$&');
    assert.match(migration, new RegExp(`alter function ${escaped}\\s+owner to postgres`, 'i'));
    assert.match(migration, new RegExp(`revoke all on function ${escaped}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
  }
  assert.equal((migration.match(/security invoker/g) ?? []).length, 2);
  assert.equal((migration.match(/security definer/g) ?? []).length, 1);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /grant execute on function private\./i);
});

test('physical proof covers the full actor matrix, exact errors, deadline plan and rollback cleanup', () => {
  for (const marker of [
    'null_challenger_manual_not_rejected',
    'null_opponent_manual_not_rejected',
    'challenger_opponent_reason_not_rejected',
    'opponent_challenger_reason_not_rejected',
    'third_user_manual_not_rejected',
    'nonnull_timeout_not_rejected',
    'nonnull_after_accept_not_rejected',
    'nonnull_before_start_not_rejected',
    'null_unknown_reason_not_rejected',
    'null_reason_not_rejected',
    'timeout_wrong_state_not_rejected',
    'after_accept_wrong_state_not_rejected',
    'before_start_wrong_state_not_rejected',
    'rejected_case_mutated_state',
    'rejected_case_wrong_sqlstate_or_message',
    'challenger_manual_positive_failed',
    'opponent_manual_positive_failed',
    'accepted_timeout_positive_failed',
    'accepted_session_positive_failed',
    'countdown_session_positive_failed',
    'accepted_29_seconds_changed',
    'accepted_30_seconds_not_cancelled',
    'accepted_deadline_index_not_used',
    'accepted_deadline_not_index_cond',
    'private_function_acl_invalid',
    'battle_cron_not_singular',
    'busy_regression',
    'lb4_f3_f3_f1_f1_fixture_cleanup_failed',
  ]) assert.match(sqlProof, new RegExp(marker));
  assert.match(sqlProof, /rollback;[\s\S]*fixture_cleanup_failed/i);
});
