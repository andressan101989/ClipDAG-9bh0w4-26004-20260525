import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260830030845_live_battles_lb4_f4b_score_outcome.sql';
const powerEngineMigrationName = '20260830053531_live_battles_lb4_f4d_a_power_engine.sql';
const powerProjectionMigrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const proof = await read('supabase/tests/live_battles_lb4_f4b_score_outcome.sql');
const concurrencyProof = await read('scripts/prove-live-battle-score-concurrency.mjs');
const serviceSource = await read('services/liveBattleSpectatorService.ts');

function functionBody(schema, name) {
  const start = migration.indexOf(`function ${schema}.${name}(`);
  assert.notEqual(start, -1, `${schema}.${name} exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${schema}.${name} terminates`);
  return migration.slice(start, end + 4);
}

function loadService() {
  const compiled = ts.transpileModule(serviceSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === 1), []);
  const module = { exports: {} };
  const require = name => {
    if (name === '@/template') return { getSupabaseClient: () => ({}) };
    throw new Error(`unexpected import: ${name}`);
  };
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

const publicRow = (overrides = {}) => ({
  session_id: '20000000-0000-4000-8000-000000000001',
  battle_id: '30000000-0000-4000-8000-000000000001',
  opponent_session_id: '20000000-0000-4000-8000-000000000002',
  local_battle_side: 'challenger',
  local_host_user_id: '10000000-0000-4000-8000-000000000001',
  opponent_host_user_id: '10000000-0000-4000-8000-000000000002',
  local_host_agora_uid: 1001,
  opponent_host_agora_uid: 1002,
  status: 'active',
  version: 4,
  scheduled_start_at: '2026-08-30T12:00:00.000Z',
  started_at: '2026-08-30T12:00:00.000Z',
  scheduled_end_at: '2026-08-30T12:05:00.000Z',
  ended_at: null,
  updated_at: '2026-08-30T12:00:01.000Z',
  challenger_score: 9,
  opponent_score: 10,
  score_version: 2,
  outcome: 'pending',
  winner_user_id: null,
  score_updated_at: '2026-08-30T12:00:02.000Z',
  projection_version: 6,
  boost_rule_version: 1,
  rose_target_units: 0,
  challenger_rose_progress_units: 0,
  opponent_rose_progress_units: 0,
  challenger_rose_activations_remaining: 0,
  opponent_rose_activations_remaining: 0,
  challenger_glove_uses_remaining: 0,
  opponent_glove_uses_remaining: 0,
  challenger_x2_starts_at: null,
  challenger_x2_expires_at: null,
  opponent_x2_starts_at: null,
  opponent_x2_expires_at: null,
  challenger_x3_starts_at: null,
  challenger_x3_expires_at: null,
  opponent_x3_starts_at: null,
  opponent_x3_expires_at: null,
  power_version: 0,
  power_updated_at: '2026-08-30T12:00:02.000Z',
  server_clock_at: '2026-08-30T12:00:02.000Z',
  ...overrides,
});

test('F4B is the only migration after F4A and adds no UI, Edge Function, wallet or ledger authority', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260829225002_live_battles_lb4_f4a_directed_gifts.sql' && name <= '20260906053652_live_battle_gift_like_scoring.sql');
  assert.deepEqual(names, [
    migrationName,
    powerEngineMigrationName,
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
  assert.doesNotMatch(migration, /edge function|agora-token|create table[^;]*(wallet|ledger|escrow)/i);
  assert.doesNotMatch(migration, /rosas?|guante|\bx2\b|\bx3\b|power.?up|probabil/i);
});

test('immutable score facts are one-to-one with confirmed Battle gifts and reserve the F4D contract', () => {
  assert.match(migration, /create table public\.live_battle_score_events/);
  assert.match(migration, /gift_transaction_id uuid not null unique[\s\S]*references public\.live_gift_transactions\(id\)/);
  assert.match(migration, /base_points bigint not null[\s\S]*multiplier integer not null default 1[\s\S]*awarded_points bigint not null[\s\S]*boost_id uuid[\s\S]*rule_version integer not null default 1/);
  assert.match(migration, /awarded_points = base_points \* multiplier/);
  assert.match(migration, /multiplier = 1 and boost_id is null and rule_version = 1/);
  assert.match(migration, /reject_live_battle_score_event_mutation[\s\S]*live_battle_score_event_immutable/);
  assert.match(migration, /before update or delete on public\.live_battle_score_events/);
});

test('server-only aggregate has independent version and closed outcome/winner constraints', () => {
  assert.match(migration, /create table public\.live_battle_score_states/);
  assert.match(migration, /score_version bigint not null default 0/);
  assert.match(migration, /outcome in \('pending', 'challenger', 'opponent', 'tie', 'cancelled'\)/);
  assert.match(migration, /outcome = 'challenger' and challenger_score > opponent_score/);
  assert.match(migration, /outcome = 'opponent' and opponent_score > challenger_score/);
  assert.match(migration, /outcome = 'tie' and challenger_score = opponent_score/);
  assert.match(migration, /outcome in \('tie', 'cancelled'\) and winner_user_id is null and finalized_at is not null/);
});

test('new score tables are RLS-isolated, client-ungranted and absent from Realtime', () => {
  for (const table of ['live_battle_score_events', 'live_battle_score_states']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]*from public, anon, authenticated, service_role`));
  }
  assert.doesNotMatch(migration, /create policy[^;]*(live_battle_score_events|live_battle_score_states)/i);
  assert.doesNotMatch(migration, /alter publication[^;]*(live_battle_score_events|live_battle_score_states)/i);
});

test('gift RPC preserves one real transfer and records exactly one score fact under the Battle lock', () => {
  const body = functionBody('public', 'send_live_battle_gift');
  assert.ok(body.indexOf('for update') < body.indexOf('pg_catalog.clock_timestamp()'));
  assert.equal((body.match(/public\.atomic_ledger_transfer\(/g) ?? []).length, 1);
  assert.match(body, /private\.record_live_battle_score_locked\([\s\S]*v_transaction_id[\s\S]*v_server_now/);
  assert.doesNotMatch(body, /multiplier\s*\*\s*(cost|amount)|atomic_ledger_transfer[\s\S]*multiplier/i);
  const score = functionBody('private', 'record_live_battle_score_locked');
  assert.match(score, /v_gift\.amount_coins::bigint, 1, v_gift\.amount_coins::bigint, null, 1/);
  assert.doesNotMatch(score, /atomic_ledger_transfer|financial_transactions|ledger_entries/);
});

test('retry verifies the original score fact without incrementing score twice', () => {
  const gift = functionBody('public', 'send_live_battle_gift');
  const existingRead = gift.indexOf('from public.live_gift_transactions as gift');
  const existing = gift.indexOf('if found then', existingRead);
  const verify = gift.indexOf('private.record_live_battle_score_locked', existing);
  const transfer = gift.indexOf('public.atomic_ledger_transfer');
  assert.ok(existing >= 0 && verify > existing && verify < transfer);
  const score = functionBody('private', 'record_live_battle_score_locked');
  assert.match(score, /if found then[\s\S]*return v_state/);
  assert.match(score, /on conflict \(battle_id\) do nothing/);
});

test('terminal lifecycle remains the sole closer and computes result from immutable facts', () => {
  const transition = functionBody('private', 'live_battle_transition');
  assert.match(transition, /if p_next_status in \('completed', 'cancelled'\) then[\s\S]*private\.reconcile_live_battle_score_locked/);
  const reconcile = functionBody('private', 'reconcile_live_battle_score_locked');
  assert.match(reconcile, /count\(\*\)::bigint into v_gift_count[\s\S]*count\(\*\)::bigint[\s\S]*v_event_count/);
  assert.match(reconcile, /live_battle_score_reconciliation_mismatch/);
  assert.match(reconcile, /if v_battle\.status = 'completed' then[\s\S]*v_outcome := 'challenger'[\s\S]*v_outcome := 'opponent'[\s\S]*v_outcome := 'tie'/);
  assert.match(reconcile, /elsif v_battle\.status = 'cancelled' then[\s\S]*v_outcome := 'cancelled'/);
  assert.doesNotMatch(reconcile, /delete from|atomic_ledger_transfer|ledger_entries/);
});

test('gift and public close RPCs share Battle-first locking', () => {
  for (const name of ['send_live_battle_gift', 'complete_live_battle', 'cancel_live_battle']) {
    const body = functionBody('public', name);
    assert.match(body, /from public\.live_battles as battle[\s\S]*where battle\.id = p_battle_id[\s\S]*for update/);
    assert.ok(body.indexOf('for update') < body.indexOf('pg_catalog.clock_timestamp()'));
  }
});

test('existing public projection and snapshot expand by exactly seven sanitized keys', () => {
  for (const key of [
    'challenger_score', 'opponent_score', 'score_version', 'outcome',
    'winner_user_id', 'score_updated_at', 'projection_version',
  ]) assert.match(migration, new RegExp(`add column ${key}|\\'${key}\\'`));
  const snapshot = functionBody('public', 'get_live_battle_public_snapshot');
  const keys = [...snapshot.matchAll(/'([a-z_]+)',\s*public_state\./g)].map(match => match[1]);
  assert.deepEqual(keys, [
    'session_id', 'battle_id', 'opponent_session_id', 'local_host_user_id',
    'opponent_host_user_id', 'local_host_agora_uid', 'opponent_host_agora_uid',
    'status', 'version', 'scheduled_start_at', 'started_at', 'scheduled_end_at',
    'ended_at', 'updated_at', 'challenger_score', 'opponent_score', 'score_version',
    'outcome', 'winner_user_id', 'score_updated_at', 'projection_version',
  ]);
  assert.equal(keys.length, 21);
});

test('strict spectator contract consumes projection_version and rejects impossible outcomes', () => {
  const service = loadService();
  const parsed = service.parseLiveBattlePublicState(publicRow());
  assert.equal(parsed.challengerScore, 9);
  assert.equal(parsed.opponentScore, 10);
  assert.equal(parsed.scoreVersion, 2);
  assert.equal(parsed.projectionVersion, 6);
  for (const invalid of [
    publicRow({ challenger_score: -1 }),
    publicRow({ score_version: -1 }),
    publicRow({ projection_version: 0 }),
    publicRow({ outcome: 'winner' }),
    publicRow({ outcome: 'pending', winner_user_id: publicRow().local_host_user_id }),
    publicRow({ status: 'active', outcome: 'tie' }),
    publicRow({ status: 'completed', ended_at: '2026-08-30T12:05:00.000Z', outcome: 'challenger', winner_user_id: publicRow().opponent_host_user_id }),
  ]) assert.throws(() => service.parseLiveBattlePublicState(invalid));
  assert.match(serviceSource, /next\.projectionVersion > current\.projectionVersion/);
});

test('backfill is deterministic and never creates gifts, money or false non-tie winners', () => {
  assert.match(migration, /left join public\.live_battle_score_events/);
  assert.match(migration, /when battle\.status = 'completed' and totals\.challenger_score > totals\.opponent_score then 'challenger'/);
  assert.match(migration, /when battle\.status = 'completed' and totals\.opponent_score > totals\.challenger_score then 'opponent'/);
  assert.match(migration, /when battle\.status = 'completed' then 'tie'/);
  assert.match(migration, /when battle\.status = 'cancelled' then 'cancelled'/);
  const beforeHelpers = migration.slice(0, migration.indexOf('create or replace function private.reject_live_battle_score_event_mutation'));
  assert.doesNotMatch(beforeHelpers, /insert into public\.(live_gift_transactions|financial_transactions|ledger_entries)/);
});

test('physical proof covers score, result, rollback, security and mandatory cleanup', () => {
  for (const marker of [
    'one_score_event_per_gift_failed', 'f4b_multiplier_contract_failed',
    'aggregate_score_failed', 'symmetric_projection_failed',
    'idempotent_retry_changed_score', 'aggregate_reconciliation_failed',
    'challenger_outcome_failed', 'opponent_outcome_failed', 'tie_outcome_failed',
    'cancelled_outcome_or_gift_retention_failed',
    'terminal_reconciliation_not_idempotent',
    'live_battle_score_reconciliation_mismatch',
    'score_failure_did_not_roll_back_money', 'past_deadline_gift_not_rejected',
    'score_rls_not_enabled', 'authenticated_score_table_privilege_present',
    'internal_score_table_published', 'lb4_f4b_fixture_residue',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /begin;[\s\S]*rollback;[\s\S]*lb4_f4b_fixture_residue/i);
});

test('real concurrency proof is disposable-only and covers retry, opposite sides, close and deadline races', () => {
  assert.match(concurrencyProof, /F4B proof refuses non-local databases/);
  assert.match(concurrencyProof, /Promise\.all\(\[[\s\S]*same-key[\s\S]*same-key/);
  assert.match(concurrencyProof, /parallel-challenger[\s\S]*parallel-opponent[\s\S]*reconcile_live_battle_score_locked/);
  assert.match(concurrencyProof, /select id from public\.live_battles where id=\$1 for update/);
  assert.match(concurrencyProof, /battle_duration_elapsed/);
  assert.match(concurrencyProof, /live_battle_gift_deadline_elapsed/);
  assert.match(concurrencyProof, /duplicateScoreFacts: 0/);
  assert.doesNotMatch(concurrencyProof, /supabase\.co|aewwdlvbwpczqyvkwvvj|service_role_key/i);
});
