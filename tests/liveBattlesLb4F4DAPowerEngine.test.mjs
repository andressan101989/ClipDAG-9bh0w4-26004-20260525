import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const migrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const powerProjectionMigrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read(`supabase/migrations/${migrationName}`);
const proof = await read('supabase/tests/live_battles_lb4_f4d_a_power_engine.sql');
const concurrency = await read('scripts/prove-live-battle-power-concurrency.mjs');

function body(schema, name) {
  const start = migration.indexOf(`function ${schema}.${name}(`);
  assert.notEqual(start, -1, `${schema}.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${schema}.${name} terminates`);
  return migration.slice(start, end + 4);
}

test('F4D-A is the only migration after F4B and changes no UI, Edge or Realtime publication', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260830030845_live_battles_lb4_f4b_score_outcome.sql' && name <= '20260906053652_live_battle_gift_like_scoring.sql');
  assert.deepEqual(names, [
    migrationName,
    powerProjectionMigrationName,
    '20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql',
    '20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
    '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
    '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
    '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
    '20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql',
    '20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql',
    '20260905230823_live_gift_platform_commission_35.sql',
    '20260906053652_live_battle_gift_like_scoring.sql',
  ]);
  assert.doesNotMatch(migration, /alter publication|create policy/i);
  assert.doesNotMatch(migration, /atomic_ledger_transfer\s*\(|financial_transactions|ledger_entries/);
});

test('rules v1 and v2 are immutable and v2 exactly matches approved defaults', () => {
  assert.match(migration, /create table public\.live_battle_rule_sets/);
  assert.match(migration, /\(1, null, 0, 1, 0, 0, 1, 0, 0, 'disabled'\)/);
  assert.match(migration, /\(2, 'rose', 10, 2, 30, 1, 3, 15, 1, 'fixed_battle_grant'\)/);
  assert.match(migration, /before update or delete on public\.live_battle_rule_sets/);
  assert.match(migration, /live_battle_rule_set_immutable/);
  assert.match(migration, /create table public\.live_battle_current_rule_set/);
  assert.match(migration, /singleton boolean primary key/);
});

test('every Battle is pinned once and historical Battles backfill to v1', () => {
  assert.match(migration, /add column battle_rule_set_id uuid/);
  assert.match(migration, /where rules\.rule_version = 1/);
  assert.match(migration, /alter column battle_rule_set_id set not null/);
  assert.match(migration, /live_battles_rule_set_fkey/);
  assert.match(migration, /before update of battle_rule_set_id on public\.live_battles/);
  const invite = body('public', 'create_live_battle_invite');
  assert.match(invite, /from public\.live_battle_current_rule_set/);
  assert.match(invite, /battle_rule_set_id[\s\S]*v_rule_set_id/);
  assert.match(body('private', 'live_battle_to_json'), /- 'battle_rule_set_id'/);
});

test('power state is one row per side and constrained by the pinned rule', () => {
  assert.match(migration, /create table public\.live_battle_power_states/);
  assert.match(migration, /primary key \(battle_id, side\)/);
  assert.match(migration, /side in \('challenger', 'opponent'\)/);
  assert.match(migration, /rose_progress_units > v_rules\.rose_target_units/);
  assert.match(migration, /glove_uses_available \+ new\.glove_uses_consumed[\s\S]*v_rules\.glove_uses_per_side/);
  assert.match(migration, /after insert on public\.live_battles[\s\S]*initialize_live_battle_power_states_trigger/);
});

test('boost history is immutable, typed, idempotent and deadline-bound', () => {
  assert.match(migration, /create table public\.live_battle_boost_events/);
  assert.match(migration, /kind in \('rose_x2', 'glove_x3'\)/);
  assert.match(migration, /kind = 'rose_x2' and multiplier = 2/);
  assert.match(migration, /kind = 'glove_x3' and multiplier = 3/);
  assert.match(migration, /live_battle_boost_events_source_score_unique/);
  assert.match(migration, /live_battle_boost_events_idempotency_unique/);
  assert.match(migration, /new\.expires_at > v_battle\.scheduled_end_at/);
  assert.match(migration, /before update or delete on public\.live_battle_boost_events/);
});

test('effective boost uses server timestamps and highest-only deterministic precedence', () => {
  const resolve = body('private', 'resolve_live_battle_effective_boost_locked');
  assert.match(resolve, /boost\.starts_at <= p_now/);
  assert.match(resolve, /p_now < boost\.expires_at/);
  assert.match(resolve, /order by boost\.multiplier desc, boost\.starts_at, boost\.id/);
  assert.match(resolve, /limit 1/);
  assert.doesNotMatch(resolve, /multiplier\s*\*|sum\(|date\.now|random/i);
});

test('rose activator scores with prior boost and opens one x2 afterward', () => {
  const record = body('private', 'record_live_battle_score_locked');
  const resolveAt = record.indexOf('resolve_live_battle_effective_boost_locked');
  const insertAt = record.indexOf('insert into public.live_battle_score_events');
  const advanceAt = record.indexOf('advance_live_battle_rose_mission_locked');
  assert.ok(resolveAt >= 0 && resolveAt < insertAt && insertAt < advanceAt);
  const rose = body('private', 'advance_live_battle_rose_mission_locked');
  assert.match(rose, /gift\.gift_id = v_rules\.rose_gift_id/);
  assert.match(rose, /least\(v_rose_count, v_rules\.rose_target_units\)/);
  assert.match(rose, /v_state\.rose_progress_units < v_rules\.rose_target_units/);
  assert.match(rose, /source_score_event_id/);
  assert.match(rose, /least\([\s\S]*rose_duration_seconds[\s\S]*scheduled_end_at/);
});

test('score facts capture pinned rule and multiplier without changing money', () => {
  const record = body('private', 'record_live_battle_score_locked');
  assert.match(record, /v_awarded_points := v_gift\.amount_coins::bigint \* v_multiplier/);
  assert.match(record, /v_boost\.id, v_rules\.rule_version, p_now/);
  assert.doesNotMatch(record, /atomic_ledger_transfer|platform_fee|creator_amount|ledger/);
  assert.match(migration, /multiplier in \(1, 2, 3\)/);
  assert.match(record, /awarded_points[\s\S]*v_awarded_points/);
});

test('glove RPC derives side from auth and consumes one fixed use idempotently', () => {
  const glove = body('public', 'activate_live_battle_glove');
  assert.match(glove, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(glove, /when v_actor = v_battle\.challenger_user_id then 'challenger'/);
  assert.match(glove, /when v_actor = v_battle\.opponent_user_id then 'opponent'/);
  assert.match(glove, /boost\.idempotency_key = p_idempotency_key[\s\S]*return query/);
  assert.match(glove, /glove_uses_available = state\.glove_uses_available - 1/);
  assert.match(glove, /glove_uses_consumed = state\.glove_uses_consumed \+ 1/);
  assert.match(glove, /live_battle_glove_already_active/);
  assert.match(glove, /pg_catalog\.clock_timestamp\(\)/);
  assert.doesNotMatch(glove, /p_side|p_multiplier|p_duration|p_starts_at|p_expires_at/);
});

test('historical reconciliation validates stored boost facts and sums awarded points', () => {
  const contract = body('private', 'live_battle_score_event_contract_is_valid');
  assert.match(contract, /rules\.id = p_battle\.battle_rule_set_id/);
  assert.match(contract, /v_boost\.rule_version = p_event\.rule_version/);
  assert.match(contract, /v_boost\.starts_at <= p_event\.created_at/);
  assert.match(contract, /p_event\.created_at < v_boost\.expires_at/);
  const reconcile = body('private', 'reconcile_live_battle_score_locked');
  assert.match(reconcile, /sum\(event\.awarded_points\)/);
  assert.match(reconcile, /live_battle_score_event_contract_is_valid/);
  assert.doesNotMatch(reconcile, /update public\.live_battle_score_events|update public\.live_battle_boost_events/);
});

test('all internal tables and helpers are denied to clients while glove is authenticated-only', () => {
  for (const table of [
    'live_battle_rule_sets', 'live_battle_current_rule_set',
    'live_battle_power_states', 'live_battle_boost_events',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]*from public, anon, authenticated, service_role`));
  }
  assert.match(migration, /revoke all on function public\.activate_live_battle_glove\(uuid, text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.activate_live_battle_glove\(uuid, text\)[\s\S]*to authenticated/);
  assert.match(migration, /security definer set search_path = ''/);
});

test('physical rollback proof covers products, concurrency boundaries and financial invariants', () => {
  for (const marker of [
    'rose_progress_nine_failed', 'rose_tenth_activation_failed',
    'activating_rose_received_new_x2', 'post_rose_gift_not_x2',
    'glove_activation_failed', 'glove_retry_consumed_use',
    'parallel_boost_precedence_failed', 'x2_did_not_resume_after_x3',
    'historical_rule_changed', 'boost_mutation_allowed',
    'score_reconciliation_failed', 'financial_multiplier_leak',
    'internal_power_table_privilege_present', 'internal_power_table_published',
    'lb4_f4d_a_fixture_residue',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /begin;[\s\S]*rollback;[\s\S]*lb4_f4d_a_fixture_residue/i);
});

test('disposable concurrency proof serializes threshold roses and glove retry', () => {
  assert.match(concurrency, /F4D-A proof refuses non-local databases/);
  assert.match(concurrency, /Promise\.all\(\[[\s\S]*rose-9[\s\S]*rose-10/);
  assert.match(concurrency, /rose_activations_used: 1/);
  assert.match(concurrency, /Promise\.all\(\[[\s\S]*same-glove-key[\s\S]*same-glove-key/);
  assert.match(concurrency, /sameBoost: true/);
  assert.match(concurrency, /gifts: 10, scores: 10, financial: 10/);
  assert.doesNotMatch(concurrency, /supabase\.co|service_role_key|aewwdlvbwpczqyvkwvvj/i);
});
