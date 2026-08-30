import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const previousName = '20260827012913_live_battles_lb4_f3_f2_snapshot_contract.sql';
const migrationName = '20260829054911_live_battles_lb4_f3_f3_stale_lifecycle.sql';
const acceptedLifecycleMigrationName = '20260829142317_live_battles_lb4_f3_f3_f1_accepted_lifecycle.sql';
const cancellationAuthorityMigrationName = '20260829150940_live_battles_lb4_f3_f3_f1_f1_cancellation_authority.sql';
const transitionPlanMigrationName = '20260829161856_live_battles_lb4_f3_f3_f1_f2_transition_plan.sql';
const directedGiftsMigrationName = '20260829225002_live_battles_lb4_f4a_directed_gifts.sql';
const scoreOutcomeMigrationName = '20260830030845_live_battles_lb4_f4b_score_outcome.sql';
const powerEngineMigrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const sqlProofName = 'live_battles_lb4_f3_f3_stale_lifecycle.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const sqlProof = await read(`supabase/tests/${sqlProofName}`);

function functionBody(schema, name) {
  const start = migration.indexOf(`function ${schema}.${name}(`);
  assert.notEqual(start, -1, `${schema}.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${schema}.${name} terminates`);
  return migration.slice(start, end + 4);
}

test('LB4-F3-F3 adds one migration and leaves every deployed migration byte-identical', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > previousName);
  assert.deepEqual(names, [
    migrationName,
    acceptedLifecycleMigrationName,
    cancellationAuthorityMigrationName,
    transitionPlanMigrationName,
    directedGiftsMigrationName,
    scoreOutcomeMigrationName,
    powerEngineMigrationName,
  ]);
  const previous = (await read(`supabase/migrations/${previousName}`)).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(previous).digest('hex'),
    '9cf43c3d095e5cc86a15b91bbf284327184e1ec8e136fc3718889eea248fad1b');
});

test('bounded private reconciler uses one authoritative clock and SKIP LOCKED ordering', () => {
  const body = functionBody('private', 'reconcile_due_live_battles');
  assert.match(body, /returns integer[\s\S]*language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.equal((body.match(/pg_catalog\.clock_timestamp\(\)/g) ?? []).length, 1);
  assert.match(body, /p_limit is null or p_limit < 1 or p_limit > 500/);
  assert.match(body, /status = 'pending'[\s\S]*invite_expires_at <= v_server_now/);
  assert.match(body, /status = 'countdown'[\s\S]*scheduled_start_at <= v_server_now/);
  assert.match(body, /status = 'active'[\s\S]*scheduled_end_at <= v_server_now/);
  assert.match(body, /order by[\s\S]*case b\.status[\s\S]*b\.id[\s\S]*for update skip locked[\s\S]*limit p_limit/i);
  assert.match(body, /private\.live_battle_reconcile_locked\([\s\S]*v_candidate\.id,[\s\S]*v_server_now/);
  assert.doesNotMatch(body, /\b(update|insert|delete|merge|truncate)\s+(public\.)?live_battle/i);
});

test('reconciler ACL is postgres-only and cron is singular, active, bounded, and replace-safe', () => {
  assert.match(migration, /alter function private\.reconcile_due_live_battles\(integer\)[\s\S]*owner to postgres/);
  assert.match(migration, /revoke all on function private\.reconcile_due_live_battles\(integer\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant execute on function private\.reconcile_due_live_battles/i);
  assert.equal((migration.match(/'reconcile-due-live-battles'/g) ?? []).length, 4);
  assert.match(migration, /cron\.unschedule\(v_job\.jobid\)/);
  assert.match(migration, /cron\.schedule\([\s\S]*'\* \* \* \* \*'[\s\S]*'select private\.reconcile_due_live_battles\(100\);'/);
  assert.match(migration, /j\.active[\s\S]*j\.username = 'postgres'/);
  assert.match(migration, /select private\.reconcile_due_live_battles\(100\);\s*\n\s*commit;/);
});

test('same-pair invite always reconciles an open row before deciding idempotence or pair_busy', () => {
  const body = functionBody('public', 'create_live_battle_invite');
  const selectOpen = body.indexOf("b.status in ('pending', 'accepted', 'countdown', 'active')");
  const reconcile = body.indexOf('v_existing := private.live_battle_reconcile_locked');
  const pendingDecision = body.indexOf("v_existing.status = 'pending'");
  const busyDecision = body.indexOf("v_existing.status in ('accepted', 'countdown', 'active')");
  assert.ok(selectOpen < reconcile && reconcile < pendingDecision && pendingDecision < busyDecision);
  assert.match(body, /if found then\s+v_existing := private\.live_battle_reconcile_locked/);
  assert.match(body, /challenger_session_id = p_challenger_session_id[\s\S]*opponent_session_id = p_opponent_session_id[\s\S]*return private\.live_battle_to_json\(v_existing\)/);
  assert.doesNotMatch(body, /found and v_existing\.status = 'pending' and v_existing\.invite_expires_at/);
});

test('acceptance reconciles participant conflicts under deterministic bounded locks before busy', () => {
  const body = functionBody('public', 'respond_live_battle_invite');
  const userLocks = body.indexOf('private.live_battle_lock_users');
  const conflictLoop = body.indexOf('for v_conflict in');
  const conflictReconcile = body.indexOf('private.live_battle_reconcile_locked(v_conflict.id');
  const participantBusy = body.indexOf("message = 'live_battle_participant_busy'");
  assert.ok(userLocks < conflictLoop && conflictLoop < conflictReconcile && conflictReconcile < participantBusy);
  assert.match(body, /status in \('pending', 'accepted', 'countdown', 'active'\)[\s\S]*order by b\.id[\s\S]*for update[\s\S]*limit 100/i);
  assert.match(body, /if exists \([\s\S]*status in \('accepted', 'countdown', 'active'\)[\s\S]*live_battle_participant_busy/);
  assert.doesNotMatch(body, /for update skip locked/);
});

test('migration preserves Battle machinery and excludes UI Agora gifts and finance', () => {
  assert.doesNotMatch(migration, /create table|alter table|create policy|drop policy|alter publication/i);
  assert.doesNotMatch(migration, /live_battle_events\s+(set|values)|update\s+public\.live_battles|delete\s+from\s+public\.live_battles/i);
  assert.doesNotMatch(migration, /agora|media relay|send_live_gift|wallet|ledger|financial_transactions|marketplace|commerce|score|winner|loser/i);
  assert.equal((migration.match(/create or replace function public\./g) ?? []).length, 2);
  assert.equal((migration.match(/create or replace function private\./g) ?? []).length, 1);
});

test('physical proof covers canonical completion, idempotence, busy paths, limits, ACL, cron, projection, and rollback', () => {
  for (const marker of [
    'active_due_completed',
    'active_due_ended_at_not_scheduled_end',
    'active_due_version_not_incremented_once',
    'active_due_event_not_exactly_once',
    'active_due_repeat_not_idempotent',
    'active_future_changed',
    'same_pair_due_not_replaced',
    'same_pair_live_missing_pair_busy',
    'participant_due_not_reconciled',
    'participant_live_missing_busy',
    'batch_limit_not_respected',
    'private_reconciler_acl_invalid',
    'battle_cron_not_singular',
    'projection_not_completed',
    'battle_security_or_realtime_regressed',
    'lb4_f3_f3_fixture_cleanup_failed',
  ]) assert.match(sqlProof, new RegExp(marker));
  assert.match(sqlProof, /rollback;[\s\S]*fixture_cleanup_failed/i);
  assert.doesNotMatch(sqlProof, /4cae64e0-73e2-4801-96b7-84bf7aeeff28/i);
});
