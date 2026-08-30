import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const serviceSource = await read('services/liveBattleSpectatorService.ts');
const stageSource = await read('components/live/LiveBattleStage.tsx');
const hostSource = await read('app/live/broadcast/[streamId].tsx');
const viewerSource = await read('app/live/watch/[streamId].tsx');
const migration = await read(
  'supabase/migrations/20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql',
);
const physicalProof = await read(
  'supabase/tests/live_battles_lb4_f4d_c_visual_realtime.sql',
);
const powerMigration = await read(
  'supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql',
);
const giftMigration = await read(
  'supabase/migrations/20260710150000_live_gift_economy.sql',
);
const scoreMigration = await read(
  'supabase/migrations/20260830030845_live_battles_lb4_f4b_score_outcome.sql',
);

const SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const BATTLE = '30000000-0000-4000-8000-000000000001';
const LOCAL = '10000000-0000-4000-8000-000000000001';
const RIVAL = '10000000-0000-4000-8000-000000000002';

function load(source, client) {
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
  session_id: SESSION,
  battle_id: BATTLE,
  opponent_session_id: OTHER_SESSION,
  local_battle_side: 'challenger',
  local_host_user_id: LOCAL,
  opponent_host_user_id: RIVAL,
  local_host_agora_uid: 101,
  opponent_host_agora_uid: 202,
  status: 'active',
  version: 4,
  scheduled_start_at: '2026-08-30T12:00:00.000Z',
  started_at: '2026-08-30T12:00:00.000Z',
  scheduled_end_at: '2026-08-30T12:05:00.000Z',
  ended_at: null,
  updated_at: '2026-08-30T12:01:00.000Z',
  challenger_score: 50,
  opponent_score: 25,
  score_version: 7,
  outcome: 'pending',
  winner_user_id: null,
  score_updated_at: '2026-08-30T12:01:00.000Z',
  projection_version: 5,
  boost_rule_version: 2,
  rose_target_units: 10,
  challenger_rose_progress_units: 0,
  opponent_rose_progress_units: 10,
  challenger_rose_activations_remaining: 1,
  opponent_rose_activations_remaining: 0,
  challenger_glove_uses_remaining: 1,
  opponent_glove_uses_remaining: 0,
  challenger_x2_starts_at: '2026-08-30T12:01:00.000Z',
  challenger_x2_expires_at: '2026-08-30T12:01:30.000Z',
  opponent_x2_starts_at: null,
  opponent_x2_expires_at: null,
  challenger_x3_starts_at: '2026-08-30T12:01:05.000Z',
  challenger_x3_expires_at: '2026-08-30T12:01:20.000Z',
  opponent_x3_starts_at: null,
  opponent_x3_expires_at: null,
  power_version: 9,
  power_updated_at: '2026-08-30T12:01:05.000Z',
  server_clock_at: '2026-08-30T12:01:05.000Z',
  ...overrides,
});

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function harness() {
  const registrations = [];
  const requests = [];
  let statusCallback;
  let removeCalls = 0;
  const channel = {
    on(_kind, options, callback) {
      registrations.push({ options, callback });
      return channel;
    },
    subscribe(callback) {
      statusCallback = callback;
      return channel;
    },
  };
  return {
    client: {
      channel: () => channel,
      rpc(name, args) {
        const pending = deferred();
        requests.push({ name, args, pending });
        return pending.promise;
      },
      async removeChannel() { removeCalls += 1; },
    },
    status(value) { statusCallback(value); },
    emit(event, payload) {
      const registration = registrations.find(item => item.options.event === event);
      assert.ok(registration);
      registration.callback(payload);
    },
    resolve(index, state) {
      requests[index].pending.resolve({
        data: { server_now: '2026-08-30T12:01:10.000Z', state },
        error: null,
      });
    },
    inspect: () => ({ registrations, requests, removeCalls }),
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('migration stores and snapshots a constrained server-derived side for both rows', () => {
  assert.match(migration, /add column local_battle_side text/);
  assert.match(migration, /alter column local_battle_side set not null/);
  assert.match(migration, /check \(local_battle_side in \('challenger', 'opponent'\)\)/);
  assert.match(migration, /function private\.sync_live_battle_public_local_side\(\)/);
  assert.match(migration, /new\.local_battle_side := 'challenger'/);
  assert.match(migration, /new\.local_battle_side := 'opponent'/);
  assert.match(migration, /'local_battle_side', public_state\.local_battle_side/);
  assert.doesNotMatch(migration, /atomic_ledger_transfer|send_live_battle_gift|alter publication|realtime\./i);
});

test('challenger and opponent map canonical scores and inventory to local and rival', () => {
  const service = load(serviceSource, {});
  const challenger = service.parseLiveBattlePublicState(row());
  assert.deepEqual(service.deriveLiveBattleLocalCompetitiveState(challenger), {
    localSide: 'challenger',
    rivalSide: 'opponent',
    localScore: 50,
    rivalScore: 25,
    localRoseProgressUnits: 0,
    rivalRoseProgressUnits: 10,
    localRoseActivationsRemaining: 1,
    rivalRoseActivationsRemaining: 0,
    localGloveUsesRemaining: 1,
    rivalGloveUsesRemaining: 0,
    localResult: 'pending',
  });
  const opponent = service.parseLiveBattlePublicState(row({
    local_battle_side: 'opponent',
    local_host_user_id: RIVAL,
    opponent_host_user_id: LOCAL,
  }));
  const mapped = service.deriveLiveBattleLocalCompetitiveState(opponent);
  assert.equal(mapped.localScore, 25);
  assert.equal(mapped.rivalScore, 50);
  assert.equal(mapped.localRoseProgressUnits, 10);
  assert.equal(mapped.rivalRoseProgressUnits, 0);
});

test('initial snapshot and every Realtime mutation reconcile canonically; stale repeats lose', async () => {
  const backend = harness();
  const service = load(serviceSource, backend.client);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
  );
  backend.status('SUBSCRIBED');
  backend.resolve(0, row());
  await settle();
  assert.equal(values.at(-1).projectionVersion, 5);

  backend.emit('UPDATE', { new: { projection_version: 6 } });
  backend.emit('UPDATE', { new: { projection_version: 6 } });
  assert.equal(backend.inspect().requests.length, 3);
  backend.resolve(1, row({ projection_version: 99 }));
  backend.resolve(2, row({ projection_version: 6 }));
  await settle();
  assert.deepEqual(values.map(value => value?.projectionVersion), [5, 6]);

  backend.emit('DELETE', { old: { session_id: SESSION } });
  backend.resolve(3, null);
  await settle();
  assert.equal(values.at(-1), null);
  await subscription.unsubscribe();
  await subscription.unsubscribe();
  assert.equal(backend.inspect().removeCalls, 1);
  const before = backend.inspect().requests.length;
  backend.emit('INSERT', { new: row({ projection_version: 7 }) });
  assert.equal(backend.inspect().requests.length, before);
});

test('server clock drives x2/x3 activation, expiration, and terminal suppression', () => {
  const service = load(serviceSource, {});
  const active = service.parseLiveBattlePublicState(row());
  const anchor = {
    serverEpochMsAtAnchor: Date.parse('2026-08-30T12:01:04.000Z'),
    monotonicMsAtAnchor: 1_000,
    roundTripMs: 0,
    projectionServerClockAt: active.serverClockAt,
  };
  assert.equal(service.deriveLiveBattlePowerVisualState(active, 'challenger', anchor, 1_000).multiplier, 2);
  assert.equal(service.deriveLiveBattlePowerVisualState(active, 'challenger', anchor, 2_000).multiplier, 3);
  assert.equal(service.deriveLiveBattlePowerVisualState(active, 'challenger', anchor, 17_000).multiplier, 2);
  assert.equal(service.deriveLiveBattlePowerVisualState(active, 'challenger', anchor, 27_000).multiplier, 1);
  for (const status of ['completed', 'cancelled']) {
    const terminal = service.parseLiveBattlePublicState(row({
      status,
      ended_at: '2026-08-30T12:05:00.000Z',
      outcome: status === 'completed' ? 'tie' : 'cancelled',
      challenger_score: 50,
      opponent_score: 50,
      challenger_glove_uses_remaining: 0,
      opponent_glove_uses_remaining: 0,
    }));
    assert.equal(service.deriveLiveBattlePowerVisualState(terminal, 'challenger', anchor, 2_000).multiplier, 1);
  }
});

test('progress covers 0/10 through 10/10 and completed winner/tie/cancelled outcomes', () => {
  const service = load(serviceSource, {});
  for (const progress of [0, 7, 10]) {
    const mapped = service.deriveLiveBattleLocalCompetitiveState(
      service.parseLiveBattlePublicState(row({ challenger_rose_progress_units: progress })),
    );
    assert.equal(mapped.localRoseProgressUnits, progress);
  }
  const won = service.parseLiveBattlePublicState(row({
    status: 'completed',
    ended_at: '2026-08-30T12:05:00.000Z',
    outcome: 'challenger',
    winner_user_id: LOCAL,
    challenger_glove_uses_remaining: 0,
    opponent_glove_uses_remaining: 0,
  }));
  assert.equal(service.deriveLiveBattleLocalCompetitiveState(won).localResult, 'won');
  assert.equal(service.deriveLiveBattleLocalCompetitiveState({
    ...won, localBattleSide: 'opponent', localHostUserId: RIVAL, opponentHostUserId: LOCAL,
  }).localResult, 'lost');
});

test('shared stage renders score, advantage, roses, x2/x3, gloves and terminal copy', () => {
  for (const marker of [
    'competitive.localScore', 'competitive.rivalScore', 'flexGrow: localWeight',
    'localRoseProgressUnits', 'rivalRoseProgressUnits', 'PowerBadge',
    'localGloveUsesRemaining', 'COMIENZA EN', 'BATTLE CANCELADA',
    'GANADOR:', 'EMPATE', 'Puntuación igualada',
  ]) assert.match(stageSource, new RegExp(marker.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
  assert.match(hostSource, /<LiveBattleStage[\s\S]*onActivateGlove=/);
  assert.match(viewerSource, /<LiveBattleStage/);
  assert.doesNotMatch(viewerSource, /onActivateGlove=/);
});

test('host glove guard prevents double touch and uses one stable key per in-flight attempt', () => {
  assert.match(hostSource, /gloveInFlightRef\.current[\s\S]*gloveAttemptRef\.current !== null/);
  assert.match(hostSource, /const attempt = \{ battleId: state\.battleId, key: `live-battle-glove:\$\{randomUUID\(\)\}` \}/);
  assert.match(hostSource, /await activateLiveBattleGlove\([\s\S]*await battleProjection\.reconcile\(\)/);
  assert.match(stageSource, /state\.status !== 'active'[\s\S]*localGloveUsesRemaining < 1[\s\S]*localX3Active[\s\S]*glovePending/);
  assert.match(stageSource, /minHeight: 44/);
});

test('roses remain five coins and multipliers remain Battle-points-only', () => {
  assert.match(giftMigration, /\('rose',[\s\S]*'Rosa',[\s\S]*5,/);
  assert.match(powerMigration, /\(2, 'rose', 10, 2, 30, 1, 3, 15, 1, 'fixed_battle_grant'\)/);
  assert.match(powerMigration, /v_awarded_points := v_gift\.amount_coins::bigint \* v_multiplier/);
  assert.match(scoreMigration, /v_creator_amount := v_gift\.cost_coins - v_fee/);
  assert.match(scoreMigration, /public\.atomic_ledger_transfer\([\s\S]*v_gift\.cost_coins, v_fee/);
  assert.doesNotMatch(migration + stageSource + hostSource, /atomic_ledger_transfer|ledger_entries|creator_amount|platform_fee/i);
});

test('physical proof uses real authenticated/anon roles, rolls back and checks residue', () => {
  assert.match(physicalProof, /^begin;[\s\S]*set local role authenticated;[\s\S]*set local role anon;[\s\S]*rollback;/i);
  assert.match(physicalProof, /f4d_c_local_side_mapping_failed/);
  assert.match(physicalProof, /f4d_c_economy_changed/);
  assert.match(physicalProof, /f4d_c_fixture_residue/);
});
