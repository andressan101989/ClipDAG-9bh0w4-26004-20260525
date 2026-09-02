import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const previousName = '20260829150940_live_battles_lb4_f3_f3_f1_f1_cancellation_authority.sql';
const migrationName = '20260829161856_live_battles_lb4_f3_f3_f1_f2_transition_plan.sql';
const directedGiftsMigrationName = '20260829225002_live_battles_lb4_f4a_directed_gifts.sql';
const scoreOutcomeMigrationName = '20260830030845_live_battles_lb4_f4b_score_outcome.sql';
const powerEngineMigrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const powerProjectionMigrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const visualRealtimeMigrationName = '20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql';
const proofName = 'live_battles_lb4_f3_f3_f1_f2_transition_plan.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const sqlProof = await read(`supabase/tests/${proofName}`);

function functionBody(name) {
  const start = migration.indexOf(`function private.${name}(`);
  assert.notEqual(start, -1, `private.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `private.${name} terminates`);
  return migration.slice(start, end + 4);
}

test('LB4-F3-F3-F1-F2 is the only forward migration and preserves F1-F1 byte semantics', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > previousName);
  assert.deepEqual(names, [
    migrationName, directedGiftsMigrationName,
    scoreOutcomeMigrationName, powerEngineMigrationName,
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
    'e1300f80737631582cf389ecb4feee66f8f9c94cad29f87299404f801dacdcfb');
});

test('every non-cancellation transition uses closed binary actor and reason authority', () => {
  const body = functionBody('live_battle_transition');
  for (const reason of [
    'invite_accepted',
    'invite_rejected',
    'invite_expired',
    'countdown_started',
    'countdown_elapsed',
    'battle_duration_elapsed',
  ]) assert.match(body, new RegExp(`p_reason is distinct from '${reason}'`));
  assert.doesNotMatch(body, /p_reason\s*<>/);
  assert.match(body, /v_battle\.status is distinct from p_expected_status/);
  assert.match(body, /if not coalesce\([\s\S]*false\s*\) then/);
  assert.match(body, /message = 'live_battle_transition_actor_invalid'/);
});

test('accepted to countdown explicitly rejects a null actor before membership and reason checks', () => {
  const body = functionBody('live_battle_transition');
  assert.match(body, /p_next_status = 'countdown' and \(\s*p_actor_user_id is null\s+or p_actor_user_id not in \(\s*v_battle\.challenger_user_id,\s*v_battle\.opponent_user_id\s*\)\s+or p_reason is distinct from 'countdown_started'/);
  assert.doesNotMatch(body, /p_next_status = 'countdown'[\s\S]*p_reason\s*<>/);
});

test('the five cancellation authorities from F1-F1 remain exact and closed', () => {
  const body = functionBody('live_battle_transition');
  assert.match(body, /p_actor_user_id is not null\s+and p_actor_user_id = v_battle\.challenger_user_id\s+and p_reason = 'challenger_cancelled'/);
  assert.match(body, /p_actor_user_id is not null\s+and p_actor_user_id = v_battle\.opponent_user_id\s+and p_reason = 'opponent_cancelled'/);
  assert.match(body, /p_expected_status = 'accepted'\s+and p_actor_user_id is null\s+and p_reason in \('accepted_start_timeout', 'session_not_live_after_accept'\)/);
  assert.match(body, /p_expected_status = 'countdown'\s+and p_actor_user_id is null\s+and p_reason = 'session_not_live_before_start'/);
});

test('due reconciliation has five exclusive materialized branches and only UNION ALL', () => {
  const body = functionBody('reconcile_due_live_battles');
  assert.match(body, /with due_candidates as materialized \(/);
  assert.equal((body.match(/\bunion all\b/gi) ?? []).length, 4);
  assert.doesNotMatch(body.replaceAll(/\bunion all\b/gi, ''), /\bunion\b/i);
  assert.equal((body.match(/select b\.id, b\.status,/g) ?? []).length, 5);
  assert.match(body, /status = 'pending'\s+and b\.invite_expires_at <= v_server_now/);
  assert.match(body, /status = 'accepted'\s+and b\.accepted_at <= v_server_now - interval '30 seconds'/);
  assert.match(body, /status = 'accepted'\s+and b\.accepted_at > v_server_now - interval '30 seconds'\s+and not private\.live_battle_session_pair_is_live/);
  assert.match(body, /status = 'countdown'\s+and b\.scheduled_start_at <= v_server_now/);
  assert.match(body, /status = 'active'\s+and b\.scheduled_end_at <= v_server_now/);
});

test('due reconciliation preserves one clock, global ordering, bounded SKIP LOCKED and canonical transitions', () => {
  const body = functionBody('reconcile_due_live_battles');
  assert.equal((body.match(/pg_catalog\.clock_timestamp\(\)/g) ?? []).length, 1);
  assert.match(body, /order by d\.due_at, b\.id\s+for update of b skip locked\s+limit p_limit/i);
  assert.match(body, /p_limit is null or p_limit < 1 or p_limit > 500/);
  assert.match(body, /private\.live_battle_reconcile_locked\(\s*v_candidate\.id,\s*v_server_now/);
  assert.doesNotMatch(body, /\b(update|insert|delete|merge|truncate)\s+(public\.)?live_battle/i);
});

test('correction replaces only the two private functions and preserves cron indexes public RPC UI Agora and economy', () => {
  assert.equal((migration.match(/create or replace function private\./g) ?? []).length, 2);
  assert.match(migration, /create or replace function private\.live_battle_transition\(/);
  assert.match(migration, /create or replace function private\.reconcile_due_live_battles\(/);
  assert.doesNotMatch(migration, /create or replace function private\.live_battle_reconcile_locked\(/);
  assert.doesNotMatch(migration, /create or replace function public\./i);
  assert.doesNotMatch(migration, /create\s+(?:unique\s+)?index|drop\s+index|alter\s+index/i);
  assert.doesNotMatch(migration, /cron\.(?:schedule|unschedule)|reconcile-due-live-battles/i);
  assert.doesNotMatch(migration, /agora|media relay|send_live_gift|wallet|ledger|financial_transactions|marketplace|commerce|score|winner|loser/i);
  assert.doesNotMatch(migration, /create table|create policy|drop policy|alter publication/i);
});

test('both replaced functions restore exact owner search path and client-denied ACL', () => {
  const signatures = [
    'private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)',
    'private.reconcile_due_live_battles(integer)',
  ];
  for (const signature of signatures) {
    const escaped = signature.replace(/[().]/g, '\\$&');
    assert.match(migration, new RegExp(`alter function ${escaped}\\s+owner to postgres`, 'i'));
    assert.match(migration, new RegExp(`revoke all on function ${escaped}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
  }
  assert.equal((migration.match(/security invoker/g) ?? []).length, 1);
  assert.equal((migration.match(/security definer/g) ?? []).length, 1);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /grant execute on function private\./i);
});

test('physical proof covers the complete authority matrix full plan and rollback cleanup', () => {
  for (const marker of [
    'countdown_null_actor_not_rejected',
    'transition_wrong_sqlstate_or_message',
    'transition_rejection_mutated_row',
    'transition_rejection_added_event',
    'transition_positive_failed',
    'accepted_29_seconds_changed',
    'accepted_30_seconds_not_cancelled',
    'session_liveness_priority_failed',
    'pending_expiry_failed',
    'countdown_activation_failed',
    'countdown_liveness_cancel_failed',
    'active_completion_failed',
    'reconcile_not_idempotent',
    'full_due_plan_missing_index',
    'full_due_plan_deadline_not_index_cond',
    'full_due_plan_accepted_index_not_used_twice',
    'full_due_plan_branch_pkey_scan',
    'battle_cron_changed',
    'private_function_acl_invalid',
    'lb4_f3_f3_f1_f2_fixture_cleanup_failed',
  ]) assert.match(sqlProof, new RegExp(marker));
  assert.equal((sqlProof.match(/\bunion all\b/gi) ?? []).length, 4);
  assert.doesNotMatch(sqlProof.replaceAll(/\bunion all\b/gi, ''), /\bunion\b/i);
  for (const index of [
    'live_battles_pending_expiry_idx',
    'live_battles_accepted_deadline_idx',
    'live_battles_countdown_start_idx',
    'live_battles_active_end_idx',
  ]) assert.match(sqlProof, new RegExp(index));
  assert.match(sqlProof, /rollback;[\s\S]*fixture_cleanup_failed/i);
});
