import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const migrationName = '20260830162244_live_battles_lb4_f4d_b_power_projection.sql';
const migration = await read('supabase/migrations/' + migrationName);
const spectatorSource = await read('services/liveBattleSpectatorService.ts');
const battleSource = await read('services/liveBattleService.ts');
const physicalProof = await read('supabase/tests/live_battles_lb4_f4d_b_power_projection.sql');

function load(source, client = {}) {
  const compiled = ts.transpileModule(source, {
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
    if (name === '@/template') return { getSupabaseClient: () => client };
    throw new Error('unexpected import: ' + name);
  };
  Function('require', 'module', 'exports', compiled.outputText)(
    require, module, module.exports,
  );
  return module.exports;
}

const row = (overrides = {}) => ({
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
  challenger_score: 10,
  opponent_score: 5,
  score_version: 3,
  outcome: 'pending',
  winner_user_id: null,
  score_updated_at: '2026-08-30T12:00:02.000Z',
  projection_version: 7,
  boost_rule_version: 2,
  rose_target_units: 10,
  challenger_rose_progress_units: 10,
  opponent_rose_progress_units: 4,
  challenger_rose_activations_remaining: 0,
  opponent_rose_activations_remaining: 1,
  challenger_glove_uses_remaining: 0,
  opponent_glove_uses_remaining: 1,
  challenger_x2_starts_at: '2026-08-30T12:01:00.000Z',
  challenger_x2_expires_at: '2026-08-30T12:01:30.000Z',
  opponent_x2_starts_at: null,
  opponent_x2_expires_at: null,
  challenger_x3_starts_at: '2026-08-30T12:01:05.000Z',
  challenger_x3_expires_at: '2026-08-30T12:01:20.000Z',
  opponent_x3_starts_at: null,
  opponent_x3_expires_at: null,
  power_version: 12,
  power_updated_at: '2026-08-30T12:01:05.000Z',
  server_clock_at: '2026-08-30T12:01:05.000Z',
  ...overrides,
});

test('F4D-B is the only migration after F4D-A and does not add UI or internal Realtime tables', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260830053531_live_battles_lb4_f4d_a_power_engine.sql');
  assert.deepEqual(names, [
    migrationName,
    '20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql',
    '20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
    '20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql',
    '20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql',
    '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
    '20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql',
  ]);
  assert.doesNotMatch(migration, /alter publication|atomic_ledger_transfer|ledger_entries/);
  assert.doesNotMatch(migration, /create table public\./i);
});

test('projection contains the complete sanitized power contract and frozen snapshot keys', () => {
  for (const key of [
    'boost_rule_version', 'rose_target_units',
    'challenger_rose_progress_units', 'opponent_rose_progress_units',
    'challenger_rose_activations_remaining',
    'opponent_rose_activations_remaining',
    'challenger_glove_uses_remaining', 'opponent_glove_uses_remaining',
    'challenger_x2_starts_at', 'challenger_x2_expires_at',
    'opponent_x2_starts_at', 'opponent_x2_expires_at',
    'challenger_x3_starts_at', 'challenger_x3_expires_at',
    'opponent_x3_starts_at', 'opponent_x3_expires_at',
    'power_version', 'power_updated_at', 'server_clock_at',
  ]) {
    assert.match(migration, new RegExp("'?" + key + "'?"));
  }
  assert.doesNotMatch(migration, /'boost_id'|'idempotency_key'|'activated_by_user_id'/);
});

test('only indexed per-Battle boost lookups feed the single public projection', () => {
  assert.match(migration, /private\.get_live_battle_power_projection/);
  assert.equal((migration.match(/left join lateral/g) ?? []).length, 4);
  assert.match(migration, /where boost\.battle_id = battle\.id/);
  assert.match(
    migration,
    /create trigger live_battle_power_states_sync_public_projection\s+after update on public\.live_battle_power_states/,
  );
  assert.match(migration, /function private\.sync_live_battle_public_states\(\)/);
  assert.match(migration, /private\.initialize_live_battle_power_states\(new\.id\)/);
  assert.doesNotMatch(migration, /live_battles_sync_public_state_power/);
  assert.doesNotMatch(migration, /sync_live_battle_public_power_trigger/);
  assert.doesNotMatch(migration, /now\(\).*index|clock_timestamp\(\).*index/i);
});

test('idempotent synchronization changes projection version only for material state', () => {
  const sync = migration.slice(
    migration.indexOf('function private.sync_live_battle_competitive_projection_locked'),
    migration.indexOf('create or replace function private.sync_live_battle_power_state_trigger'),
  );
  assert.match(sync, /projection_version = projection\.projection_version \+ 1/);
  assert.match(sync, /where projection\.battle_id = p_battle_id[\s\S]*is distinct from/);
  assert.doesNotMatch(sync, /server_clock_at is distinct from/);
});

test('strict parser accepts v2 and rejects unsafe or inconsistent power payloads', () => {
  const service = load(spectatorSource);
  const parsed = service.parseLiveBattlePublicState(row());
  assert.equal(parsed.boostRuleVersion, 2);
  assert.equal(parsed.challengerX2Window.expiresAt, row().challenger_x2_expires_at);
  for (const invalid of [
    row({ power_version: Number.MAX_SAFE_INTEGER + 1 }),
    row({ challenger_rose_progress_units: 11 }),
    row({ challenger_x2_expires_at: null }),
    row({ challenger_x2_expires_at: row().challenger_x2_starts_at }),
    row({ server_clock_at: 'invalid' }),
    row({ boost_rule_version: 1 }),
  ]) assert.throws(() => service.parseLiveBattlePublicState(invalid));
});

test('v1 compatibility requires explicit zero power state', () => {
  const service = load(spectatorSource);
  const parsed = service.parseLiveBattlePublicState(row({
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
    challenger_x3_starts_at: null,
    challenger_x3_expires_at: null,
  }));
  assert.equal(parsed.boostRuleVersion, 1);
});

test('visual helper uses authoritative anchor, x3 precedence and exact expiration', () => {
  const service = load(spectatorSource);
  const state = service.parseLiveBattlePublicState(row());
  const anchor = {
    serverEpochMsAtAnchor: Date.parse('2026-08-30T12:01:10.000Z'),
    monotonicMsAtAnchor: 1000,
    roundTripMs: 0,
  };
  assert.equal(
    service.deriveLiveBattlePowerVisualState(state, 'challenger', anchor, 1000)
      .multiplier,
    3,
  );
  assert.equal(
    service.deriveLiveBattlePowerVisualState(state, 'challenger', anchor, 11000)
      .multiplier,
    2,
  );
  assert.equal(
    service.deriveLiveBattlePowerVisualState(state, 'challenger', anchor, 21000)
      .multiplier,
    1,
  );
  assert.doesNotMatch(spectatorSource, /Date\.now\(\)/);
});

test('glove wrapper sends only Battle id and preserved idempotency key', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [{
        boost_id: '40000000-0000-4000-8000-000000000001',
        battle_id: row().battle_id,
        side: 'challenger',
        kind: 'glove_x3',
        multiplier: 3,
        starts_at: '2026-08-30T12:01:05.000Z',
        expires_at: '2026-08-30T12:01:20.000Z',
        power_version: 8,
      }], error: null };
    },
  };
  const service = load(battleSource, client);
  const result = await service.activateLiveBattleGlove({
    battleId: row().battle_id,
    idempotencyKey: 'same-key',
  });
  assert.equal(result.multiplier, 3);
  assert.deepEqual(calls, [{
    name: 'activate_live_battle_glove',
    args: {
      p_battle_id: row().battle_id,
      p_idempotency_key: 'same-key',
    },
  }]);
  await assert.rejects(() => service.activateLiveBattleGlove({
    battleId: row().battle_id,
    idempotencyKey: '',
  }));
});

test('migration preserves RLS, ACL and the existing Realtime publication boundary', () => {
  for (const helper of [
    'get_live_battle_power_projection',
    'sync_live_battle_public_states',
    'sync_live_battle_competitive_projection_locked',
    'sync_live_battle_power_state_trigger',
  ]) {
    assert.match(migration, new RegExp(
      'revoke all on function private\\.' + helper + '[\\s\\S]*authenticated',
    ));
  }
  assert.match(migration, /grant execute on function public\.get_live_battle_public_snapshot\(uuid\)[\s\S]*to authenticated/);
});

test('physical proof is rollback-only and checks RLS, v1 backfill and Realtime isolation', () => {
  assert.match(physicalProof, /^begin;[\s\S]*rollback;\s*$/i);
  for (const marker of [
    'f4d_b_projection_columns_failed',
    'f4d_b_projection_rls_failed',
    'f4d_b_internal_realtime_exposure',
    'f4d_b_v1_backfill_failed',
  ]) assert.match(physicalProof, new RegExp(marker));
});
