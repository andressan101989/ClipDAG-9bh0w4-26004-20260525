import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const contractSource = await read('services/liveBattleSeriesContract.ts');
const stateSource = await read('services/liveBattleSeriesState.ts');
const seriesServiceSource = await read('services/liveBattleSeriesService.ts');
const spectatorServiceSource = await read('services/liveBattleSpectatorService.ts');
const hookSource = await read('hooks/live/useLiveBattleSpectatorState.ts');
const stageSource = await read('components/live/LiveBattleStage.tsx');
const hostSource = await read('app/live/broadcast/[streamId].tsx');
const viewerSource = await read('app/live/watch/[streamId].tsx');

function load(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === 1), []);
  const module = { exports: {} };
  Function('require', 'module', 'exports', compiled.outputText)(name => {
    if (name in imports) return imports[name];
    throw new Error('unexpected import: ' + name);
  }, module, module.exports);
  return module.exports;
}

const contract = load(contractSource);
const seriesState = load(stateSource);
const spectator = load(spectatorServiceSource, {
  '@/template': { getSupabaseClient: () => ({}) },
});
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const SERIES = '20000000-0000-4000-8000-000000000001';
const BATTLE_1 = '30000000-0000-4000-8000-000000000001';
const BATTLE_2 = '30000000-0000-4000-8000-000000000002';
const REQUEST = '40000000-0000-4000-8000-000000000001';

const request = (overrides = {}) => ({
  id: REQUEST,
  series_id: SERIES,
  after_battle_id: BATTLE_1,
  requested_by_user_id: A,
  status: 'pending',
  expires_at: '2026-09-01T12:00:30.000Z',
  responded_by_user_id: null,
  responded_at: null,
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-01T12:00:00.000Z',
  ...overrides,
});

const canonicalSeries = (overrides = {}) => ({
  id: SERIES,
  format: 'best_of_5',
  max_rounds: 5,
  wins_required: 3,
  status: 'awaiting_rematch',
  challenger_wins: 1,
  opponent_wins: 0,
  ties: 0,
  rounds_completed: 1,
  champion_user_id: null,
  rematch_window_expires_at: '2026-09-01T12:00:30.000Z',
  version: 2,
  completed_at: null,
  ...overrides,
});

const projection = (overrides = {}) => ({
  id: SERIES,
  format: 'best_of_5',
  roundNumber: 1,
  maxRounds: 5,
  winsRequired: 3,
  challengerWins: 1,
  opponentWins: 0,
  ties: 0,
  roundsCompleted: 1,
  status: 'awaiting_rematch',
  championUserId: null,
  version: 2,
  rematchRequestId: null,
  rematchRequestAfterBattleId: null,
  rematchRequestStatus: null,
  rematchRequestedByUserId: null,
  rematchRequestExpiresAt: null,
  rematchWindowExpiresAt: '2026-09-01T12:00:30.000Z',
  ...overrides,
});

const publicState = (overrides = {}) => ({
  battleId: BATTLE_1,
  status: 'completed',
  localHostUserId: A,
  opponentHostUserId: B,
  series: projection(),
  ...overrides,
});

test('F5-B strictly parses the exact request and best-of-five series JSON', () => {
  const parsedRequest = contract.parseLiveBattleRematchRequest(request());
  const parsedSeries = contract.parseLiveBattleSeries(canonicalSeries());
  assert.equal(parsedRequest.afterBattleId, BATTLE_1);
  assert.equal(parsedRequest.status, 'pending');
  assert.equal(parsedSeries.maxRounds, 5);
  assert.equal(parsedSeries.winsRequired, 3);
  assert.throws(() => contract.parseLiveBattleRematchRequest(request({ expires_at: null })));
  assert.throws(() => contract.parseLiveBattleSeries(canonicalSeries({ rounds_completed: 2 })));
  assert.throws(() => contract.parseLiveBattleSeries(canonicalSeries({ max_rounds: 6 })));
});

test('client states are canonical for host, counterpart, viewer, expiry and terminal series', () => {
  const derive = (state, actor = A, phase = 'idle', next = null, error = false) =>
    seriesState.deriveLiveBattleSeriesClientState(state, actor, phase, next, error);
  assert.equal(derive(publicState()), 'available');
  const pending = publicState({ series: projection({
    status: 'rematch_pending', rematchRequestStatus: 'pending', rematchRequestId: REQUEST,
    rematchRequestAfterBattleId: BATTLE_1, rematchRequestedByUserId: A,
    rematchRequestExpiresAt: '2026-09-01T12:00:30.000Z',
  }) });
  assert.equal(derive(pending, A), 'outgoing_pending');
  assert.equal(derive(pending, B), 'incoming_pending');
  assert.equal(derive(pending, null), 'round_finished');
  assert.equal(derive(publicState({ series: projection({
    status: 'completed', rematchRequestStatus: 'expired', rematchRequestId: REQUEST,
    rematchRequestAfterBattleId: BATTLE_1, rematchRequestedByUserId: A,
    rematchRequestExpiresAt: '2026-09-01T12:00:30.000Z', rematchWindowExpiresAt: null,
  }) })), 'expired');
  assert.equal(derive(publicState({ series: projection({
    status: 'completed', rematchWindowExpiresAt: null, championUserId: A,
  }) })), 'series_completed');
});

test('C2 projection keeps request and rematch-window expiration separate', () => {
  const row = {
    series_id: SERIES,
    series_format: 'best_of_5',
    round_number: 1,
    series_max_rounds: 5,
    series_wins_required: 3,
    challenger_series_wins: 1,
    opponent_series_wins: 0,
    series_ties: 0,
    series_rounds_completed: 1,
    series_status: 'rematch_pending',
    series_champion_user_id: null,
    series_version: 3,
    rematch_request_id: REQUEST,
    rematch_request_after_battle_id: BATTLE_1,
    rematch_request_status: 'pending',
    rematch_requested_by_user_id: A,
    rematch_request_expires_at: '2026-09-01T12:00:20.000Z',
    rematch_window_expires_at: '2026-09-01T12:00:30.000Z',
  };
  const parsed = spectator.parseLiveBattleSeriesProjection(row, BATTLE_1, [A, B]);
  assert.equal(parsed.rematchRequestAfterBattleId, BATTLE_1);
  assert.equal(parsed.rematchRequestExpiresAt, '2026-09-01T12:00:20.000Z');
  assert.equal(parsed.rematchWindowExpiresAt, '2026-09-01T12:00:30.000Z');
  assert.notEqual(parsed.rematchRequestExpiresAt, parsed.rematchWindowExpiresAt);
  assert.throws(() => spectator.parseLiveBattleSeriesProjection({
    ...row, rematch_request_expires_at: null,
  }, BATTLE_1, [A, B]));
});

test('a request anchored to round one is discarded when hydrating round two', () => {
  const stale = spectator.parseLiveBattleSeriesProjection({
    series_id: SERIES,
    series_format: 'best_of_5',
    round_number: 2,
    series_max_rounds: 5,
    series_wins_required: 3,
    challenger_series_wins: 1,
    opponent_series_wins: 0,
    series_ties: 0,
    series_rounds_completed: 1,
    series_status: 'active',
    series_champion_user_id: null,
    series_version: 4,
    rematch_request_id: REQUEST,
    rematch_request_after_battle_id: BATTLE_1,
    rematch_request_status: 'accepted',
    rematch_requested_by_user_id: A,
    rematch_request_expires_at: '2026-09-01T12:00:20.000Z',
    rematch_window_expires_at: null,
  }, BATTLE_2, [A, B]);
  assert.equal(stale.rematchRequestId, null);
  assert.equal(stale.rematchRequestAfterBattleId, null);
  assert.equal(stale.rematchRequestStatus, null);
  assert.equal(stale.rematchRequestExpiresAt, null);
  assert.equal(seriesState.hasCurrentLiveBattleRematchRequest({
    ...publicState({ battleId: BATTLE_2 }), series: stale,
  }), false);
});

test('single-flight blocks double touch and permits one later action', async () => {
  const gate = {};
  gate.promise = new Promise(resolve => { gate.resolve = resolve; });
  let calls = 0;
  const lock = new seriesState.LiveBattleSeriesSingleFlight();
  const first = lock.run(async () => { calls += 1; await gate.promise; return 'ok'; });
  const duplicate = lock.run(async () => { calls += 1; return 'duplicate'; });
  assert.equal(duplicate, null);
  gate.resolve();
  assert.equal(await first, 'ok');
  const later = lock.run(async () => { calls += 1; return 'later'; });
  assert.equal(await later, 'later');
  assert.equal(calls, 2);
});

test('only a new canonical round in the same series triggers transition', () => {
  const previous = publicState();
  const next = publicState({
    battleId: BATTLE_2,
    status: 'countdown',
    series: projection({ roundNumber: 2, status: 'active', rematchWindowExpiresAt: null }),
  });
  assert.equal(seriesState.isCanonicalNextLiveBattle(previous, next), true);
  assert.equal(seriesState.isCanonicalNextLiveBattle(previous, { ...next, battleId: BATTLE_1 }), false);
  assert.equal(seriesState.isCanonicalNextLiveBattle(previous, {
    ...next, series: { ...next.series, roundNumber: 3 },
  }), false);
});

test('RPC and Realtime candidates transition once and stale callbacks are ignored', () => {
  const gate = new seriesState.LiveBattleSeriesTransitionGate();
  const current = publicState();
  const candidate = {
    sourceBattleId: BATTLE_1,
    seriesId: SERIES,
    battleId: BATTLE_2,
    roundNumber: 2,
  };
  assert.equal(gate.accept(current, candidate), true);
  assert.equal(gate.accept(current, candidate), false);
  const roundTwo = publicState({
    battleId: BATTLE_2,
    status: 'countdown',
    series: projection({ roundNumber: 2, status: 'active', rematchWindowExpiresAt: null }),
  });
  assert.equal(gate.accept(roundTwo, { ...candidate, battleId: BATTLE_1 }), false);
  assert.equal(gate.accept(roundTwo, {
    sourceBattleId: BATTLE_1,
    seriesId: SERIES,
    battleId: '30000000-0000-4000-8000-000000000003',
    roundNumber: 3,
  }), false);
  assert.equal(seriesState.isCanonicalRematchTransitionCandidate(roundTwo, {
    sourceBattleId: BATTLE_1,
    seriesId: SERIES,
    battleId: '30000000-0000-4000-8000-000000000003',
    roundNumber: 3,
  }), false);
});

test('service consumes only the three authoritative RPCs and never internal tables', () => {
  assert.match(seriesServiceSource, /\.rpc\(name, args\)/);
  assert.match(seriesServiceSource, /request_live_battle_rematch/);
  assert.match(seriesServiceSource, /respond_live_battle_rematch/);
  assert.match(seriesServiceSource, /leave_live_battle_series/);
  assert.doesNotMatch(seriesServiceSource, /\.from\s*\(/);
  assert.doesNotMatch(seriesServiceSource, /['"]live_battle_(series|rematch_requests|score_states)['"]/);
});

test('RPC responses are validated, idempotent accept returns one canonical round', async () => {
  const calls = [];
  const acceptedRequest = request({
    status: 'accepted', responded_by_user_id: B,
    responded_at: '2026-09-01T12:00:05.000Z', updated_at: '2026-09-01T12:00:05.000Z',
  });
  const acceptedSeries = canonicalSeries({
    status: 'active', rematch_window_expires_at: null, version: 4,
  });
  const battle = {
    id: BATTLE_2, challenger_user_id: A, opponent_user_id: B,
    challenger_session_id: '50000000-0000-4000-8000-000000000001',
    opponent_session_id: '50000000-0000-4000-8000-000000000002',
    status: 'countdown', series_id: SERIES, round_number: 2,
  };
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { request: acceptedRequest, battle, series: acceptedSeries }, error: null };
    },
  };
  const parseLiveBattle = raw => ({
    id: raw.id, challengerUserId: raw.challenger_user_id,
    opponentUserId: raw.opponent_user_id,
    challengerSessionId: raw.challenger_session_id,
    opponentSessionId: raw.opponent_session_id,
    status: raw.status,
  });
  const service = load(seriesServiceSource, {
    '@/template': { getSupabaseClient: () => client },
    './liveBattleSeriesContract': contract,
    './liveBattleService': { parseLiveBattle },
  });
  const first = await service.respondLiveBattleRematch({ requestId: REQUEST, decision: 'accept' });
  const retry = await service.respondLiveBattleRematch({ requestId: REQUEST, decision: 'accept' });
  assert.equal(first.battle.id, BATTLE_2);
  assert.equal(retry.battle.id, BATTLE_2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    name: 'respond_live_battle_rematch',
    args: { p_request_id: REQUEST, p_decision: 'accept' },
  });
});

test('hook owns one projection subscription, reconciliation and complete cleanup', () => {
  assert.equal((hookSource.match(/subscribeToLiveBattlePublicState\s*\(/g) ?? []).length, 1);
  assert.match(hookSource, /subscription\.reconcile\(\)/);
  assert.match(hookSource, /NetInfo\.addEventListener/);
  assert.match(hookSource, /AppState\.addEventListener/);
  assert.match(hookSource, /networkSubscription\(\)/);
  assert.match(hookSource, /subscription\.unsubscribe\(\)/);
  assert.match(hookSource, /transitionGateRef\.current\.accept/);
  assert.match(hookSource, /rematchRequestAfterBattleId !== current\.battleId/);
  assert.match(hookSource, /result\.request\.afterBattleId/);
  assert.match(hookSource, /LiveBattleSeriesSingleFlight/);
  assert.doesNotMatch(hookSource, /\.from\s*\(/);
});

test('host and viewer use the same series UI while controls remain participant-gated', () => {
  for (const label of [
    'GANASTE', 'PERDISTE', 'EMPATE', 'RONDA {series.roundNumber} DE {series.maxRounds}',
    'REVANCHA', 'SOLICITUD ENVIADA', 'QUIERE REVANCHA', 'ACEPTAR', 'RECHAZAR',
    'PREPARANDO SIGUIENTE RONDA…',
  ]) assert.ok(stageSource.includes(label), label);
  assert.match(stageSource, /actorUserId === state\.localHostUserId/);
  assert.match(stageSource, /isParticipant && seriesClientState === 'available'/);
  assert.match(stageSource, /!isParticipant && !seriesTerminal/);
  for (const page of [hostSource, viewerSource]) {
    assert.match(page, /seriesClientState=\{battleProjection\.clientState\}/);
    assert.match(page, /onRequestRematch=\{battleProjection\.requestRematch\}/);
  }
  assert.match(hostSource, /battleRuntime\.reconcile\(\)/);
  assert.match(hostSource, /seriesTransitionRef\.current === nextBattleId/);
  assert.match(stageSource, /rematchRequestExpiresAt/);
  assert.match(stageSource, /rematchWindowExpiresAt/);
  assert.doesNotMatch(
    stageSource,
    /rematchRequestExpiresAt\s*\?\?\s*series\?\.rematchWindowExpiresAt|rematchWindowExpiresAt\s*\?\?\s*series\?\.rematchRequestExpiresAt/,
  );
});

test('scope, canonical F5-A blob, products, relay and economy remain protected', () => {
  const changed = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(changed.status, 0, changed.stderr);
  const allowed = new Set([
    'app/live/broadcast/[streamId].tsx', 'app/live/watch/[streamId].tsx',
    'components/live/LiveBattleStage.tsx', 'hooks/live/useLiveBattleSpectatorState.ts',
    'services/liveBattleSeriesContract.ts', 'services/liveBattleSeriesService.ts',
    'services/liveBattleSeriesState.ts', 'services/liveBattleSpectatorService.ts',
    'tests/liveBattlesLb4F5BClientSeriesFlow.test.mjs',
  ]);
  const changedPaths = changed.stdout.trim().split(/\r?\n/).filter(Boolean)
    .map(line => line.slice(3).replaceAll('\\', '/'));
  assert.equal(changedPaths.length, allowed.size);
  for (const path of changedPaths) {
    assert.ok(allowed.has(path), path);
  }
  assert.match(hostSource, /setCommerceVisible\(false\)/);
  assert.match(viewerSource, /setCommerceVisible\(false\)/);
  assert.match(spectatorServiceSource, /series: LiveBattleSeriesProjection \| null/);
  const blob = spawnSync('git', [
    'cat-file', 'blob',
    'HEAD:supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql',
  ], { encoding: null, windowsHide: true });
  assert.equal(blob.status, 0, blob.stderr?.toString());
  assert.equal(createHash('sha256').update(blob.stdout).digest('hex'),
    '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45');
});
