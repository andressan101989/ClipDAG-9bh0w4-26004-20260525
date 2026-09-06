import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const policySource = await read('services/liveBattlePostRoundRelayPolicy.ts');
const controllerSource = await read('services/liveBattleRuntimeController.ts');
const relaySource = await read('services/liveBattleRelayService.native.ts');
const spectatorSource = await read('services/liveBattleSpectatorService.ts');
const runtimeHookSource = await read('hooks/live/useLiveBattleRelayRuntime.native.ts');
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');
const stageSource = await read('components/live/LiveBattleStage.tsx');
const edgeSource = await read('supabase/functions/agora-token/index.ts');
const authorizationSource = await read('supabase/functions/agora-token/battleRelayAuthorization.ts');

function loadTypeScript(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  });
  const diagnostics = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(diagnostics, []);
  const module = { exports: {} };
  const require = name => {
    if (name in imports) return imports[name];
    throw new Error(`unexpected import: ${name}`);
  };
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policy = loadTypeScript(policySource);
const controllerModule = loadTypeScript(controllerSource, {
  './liveBattleService': {
    getLiveBattleState: async () => { throw new Error('dependency not injected'); },
    getOpenLiveBattlesForSession: async () => { throw new Error('dependency not injected'); },
    isLiveBattleUuid: value => typeof value === 'string' && UUID.test(value),
    subscribeToLiveBattlesForSession: () => { throw new Error('dependency not injected'); },
  },
  './liveBattlePostRoundRelayPolicy': policy,
});

const states = { RelayStateIdle: 0, RelayStateConnecting: 1, RelayStateRunning: 2, RelayStateFailure: 3 };
const errors = {
  RelayOk: 0, RelayErrorServerNoResponse: 2, RelayErrorFailedJoinSrc: 4,
  RelayErrorFailedJoinDest: 5, RelayErrorFailedPacketReceivedFromSrc: 6,
  RelayErrorFailedPacketSentToDest: 7, RelayErrorServerConnectionLost: 8,
  RelayErrorSrcTokenExpired: 10, RelayErrorDestTokenExpired: 11,
};
const relayModule = loadTypeScript(relaySource, {
  'react-native-agora': { ChannelMediaRelayState: states, ChannelMediaRelayError: errors },
  './liveBattleRelayContract': {
    LiveBattleRelayError: class LiveBattleRelayError extends Error {
      constructor(code, _message, relayCode) { super(code); this.code = code; this.relayCode = relayCode; }
    },
    requestLiveBattleRelayCredentials: async () => { throw new Error('dependency not injected'); },
  },
});
const authorization = loadTypeScript(authorizationSource);

const HOST = '10000000-0000-4000-8000-000000000001';
const OPPONENT = '10000000-0000-4000-8000-000000000002';
const VIEWER = '10000000-0000-4000-8000-000000000003';
const SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const BATTLE_A = '30000000-0000-4000-8000-000000000001';
const BATTLE_B = '30000000-0000-4000-8000-000000000002';
const SERIES = '40000000-0000-4000-8000-000000000001';
const WINDOW = '2026-09-04T12:05:33.000Z';

const rawBattle = (overrides = {}) => ({
  id: BATTLE_A, challengerUserId: HOST, opponentUserId: OPPONENT,
  challengerSessionId: SESSION, opponentSessionId: OTHER_SESSION, status: 'active',
  inviteExpiresAt: '2026-09-04T12:00:30.000Z', acceptedAt: '2026-09-04T12:00:00.000Z',
  countdownStartedAt: '2026-09-04T12:00:00.000Z', scheduledStartAt: '2026-09-04T12:00:03.000Z',
  startedAt: '2026-09-04T12:00:03.000Z', scheduledEndAt: '2026-09-04T12:05:03.000Z',
  endedAt: null, lastTransitionActorId: HOST, lastTransitionReason: 'countdown_elapsed',
  version: 1, createdAt: '2026-09-04T12:00:00.000Z', updatedAt: '2026-09-04T12:00:03.000Z',
  ...overrides,
});

const series = (overrides = {}) => ({
  id: SERIES, format: 'best_of_5', roundNumber: 1, maxRounds: 5, winsRequired: 3,
  challengerWins: 1, opponentWins: 0, ties: 0, roundsCompleted: 1,
  status: 'awaiting_rematch', championUserId: null, version: 2,
  rematchRequestId: null, rematchRequestAfterBattleId: null, rematchRequestStatus: null,
  rematchRequestedByUserId: null, rematchRequestExpiresAt: null, rematchWindowExpiresAt: WINDOW,
  ...overrides,
});

const projection = (overrides = {}) => ({
  sessionId: SESSION, battleId: BATTLE_A, opponentSessionId: OTHER_SESSION,
  localBattleSide: 'challenger', localHostUserId: HOST, opponentHostUserId: OPPONENT,
  status: 'completed', version: 2, endedAt: '2026-09-04T12:05:03.000Z', series: series(),
  ...overrides,
});

const sessionPair = (overrides = {}) => ({
  localSessionId: SESSION, opponentSessionId: OTHER_SESSION,
  localHostUserId: HOST, opponentHostUserId: OPPONENT,
  localSessionLive: true, opponentSessionLive: true, ...overrides,
});

function policyInput(overrides = {}) {
  return {
    battle: rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }),
    projection: projection(), clockAnchor: null,
    serverNowMs: Date.parse('2026-09-04T12:05:04.000Z'),
    relayBattleId: BATTLE_A, relaySeriesId: SERIES, relayRoundNumber: 1,
    sessionPair: sessionPair(), localSessionId: SESSION, localHostUserId: HOST, eligible: true,
    ...overrides,
  };
}

function createHarness() {
  let current = rawBattle();
  let currentProjection = projection({
    status: 'active', endedAt: null,
    series: series({ status: 'active', roundsCompleted: 0, challengerWins: 0, rematchWindowExpiresAt: null }),
  });
  let serverNow = '2026-09-04T12:05:04.000Z';
  let monotonicNow = 100;
  let signal = () => undefined;
  const timers = [];
  let relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null };
  const relay = {
    startCalls: [], refreshCalls: [], transitionCalls: [], stopCalls: 0, immediateStopCalls: 0,
    async start(battleId) { this.startCalls.push(battleId); relaySnapshot = { state: 'running', battleId, errorCode: null, relayCode: 0 }; return relaySnapshot; },
    async refreshCredentials(battleId) { this.refreshCalls.push(battleId); return relaySnapshot; },
    async transition(battleId) { this.transitionCalls.push(battleId); relaySnapshot = { state: 'running', battleId, errorCode: null, relayCode: 0 }; return relaySnapshot; },
    async stop() { this.stopCalls += 1; relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null }; return relaySnapshot; },
    stopImmediately() { this.immediateStopCalls += 1; }, async dispose() {},
    getSnapshot: () => ({ ...relaySnapshot }), subscribe: () => () => undefined,
  };
  const dependencies = {
    relay, now: () => Date.parse(serverNow), monotonicNow: () => monotonicNow,
    discover: async () => current.status === 'completed' || current.status === 'cancelled' ? [] : [current],
    reconcile: async () => current,
    subscribe: (_sessionId, onSignal) => { signal = onSignal; return { unsubscribe: async () => undefined }; },
    readPublicAuthority: async () => ({
      serverNow, state: currentProjection,
      clockAnchor: { serverEpochMsAtAnchor: Date.parse(serverNow), monotonicMsAtAnchor: monotonicNow, roundTripMs: 0 },
    }),
    validateSessionPair: async () => sessionPair(),
    setTimer: (callback, delayMs) => { const timer = { callback, delayMs, cancelled: false }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cancelled = true; },
  };
  const controller = new controllerModule.LiveBattleRuntimeController(dependencies);
  return {
    controller, dependencies, relay, timers,
    activate: async () => {
      controller.updateContext({ liveSessionId: SESSION, hostUserId: HOST, isCanonicalHost: true, isSessionLive: true, engineReady: true, joined: true, isForeground: true });
      await controller.waitForIdle();
      controller.updatePublicAuthority(currentProjection, { serverEpochMsAtAnchor: Date.parse(serverNow), monotonicMsAtAnchor: monotonicNow, roundTripMs: 0 });
    },
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); await controller.waitForIdle(); },
    setBattle: value => { current = value; }, setProjection: value => { currentProjection = value; },
    setNow: value => { serverNow = value; }, setMonotonic: value => { monotonicNow = value; },
    emit: value => signal(value),
    publishProjection: value => {
      currentProjection = value;
      controller.updatePublicAuthority(value, { serverEpochMsAtAnchor: Date.parse(serverNow), monotonicMsAtAnchor: monotonicNow, roundTripMs: 0 });
    },
    runLastTimer: () => {
      const timer = [...timers].reverse().find(item => !item.cancelled);
      assert.ok(timer);
      timer.cancelled = true;
      timer.callback();
    },
  };
}

test('policy holds completed rounds only for a current, live, unexpired open series', () => {
  assert.equal(policy.resolveLiveBattleRelayPolicy(policyInput()), 'holding_for_rematch');
  assert.equal(policy.resolveLiveBattleRelayPolicy(policyInput({
    projection: projection({ series: series({
      status: 'rematch_pending', rematchRequestId: '50000000-0000-4000-8000-000000000001',
      rematchRequestAfterBattleId: BATTLE_A, rematchRequestStatus: 'pending',
      rematchRequestedByUserId: HOST, rematchRequestExpiresAt: WINDOW,
    }) }),
  })), 'holding_for_rematch');
  for (const changed of [
    { serverNowMs: Date.parse(WINDOW) },
    { sessionPair: sessionPair({ opponentSessionLive: false }) },
    { eligible: false },
    { projection: projection({ battleId: BATTLE_B }) },
    { projection: projection({ series: series({ status: 'completed' }) }) },
    { projection: projection({ series: series({ challengerWins: 3, roundsCompleted: 3 }) }) },
    { projection: projection({ series: series({ roundNumber: 5, roundsCompleted: 5 }) }) },
  ]) assert.equal(policy.resolveLiveBattleRelayPolicy(policyInput(changed)), 'stop_terminal');
});

test('countdown and active relay; the next round in the same series is an atomic transition', () => {
  for (const status of ['countdown', 'active']) {
    assert.equal(policy.resolveLiveBattleRelayPolicy(policyInput({
      battle: rawBattle({ status, endedAt: null }), projection: projection({ status, endedAt: null }),
    })), 'relaying_active_round');
  }
  assert.equal(policy.resolveLiveBattleRelayPolicy(policyInput({
    battle: rawBattle({ id: BATTLE_B, status: 'countdown', endedAt: null }),
    projection: projection({ battleId: BATTLE_B, status: 'countdown', endedAt: null, series: series({ roundNumber: 2 }) }),
  })), 'transitioning_to_next_round');
});

test('completed + awaiting_rematch retains relay and schedules one authoritative deadline', async () => {
  const harness = createHarness(); await harness.activate();
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.setProjection(projection()); harness.emit({ battleId: BATTLE_A, version: 2 }); await harness.settle();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  assert.equal(harness.relay.stopCalls, 0);
  assert.equal(harness.controller.getSnapshot().status, 'relaying');
  assert.equal(harness.timers.filter(timer => !timer.cancelled).length, 1);
  await harness.controller.dispose();
});

test('rematch_pending retains relay; reject and terminal series stop exactly once', async () => {
  const harness = createHarness(); await harness.activate();
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.setProjection(projection({ series: series({
    status: 'rematch_pending', rematchRequestId: '50000000-0000-4000-8000-000000000001',
    rematchRequestAfterBattleId: BATTLE_A, rematchRequestStatus: 'pending',
    rematchRequestedByUserId: HOST, rematchRequestExpiresAt: WINDOW,
  }) }));
  harness.emit({ battleId: BATTLE_A, version: 2 }); await harness.settle();
  assert.equal(harness.relay.stopCalls, 0);
  harness.publishProjection(projection({ series: series({ status: 'completed', rematchWindowExpiresAt: null }) }));
  await harness.settle();
  harness.publishProjection(projection({ series: series({ status: 'completed', rematchWindowExpiresAt: null, version: 4 }) }));
  await harness.settle();
  assert.equal(harness.relay.stopCalls, 1);
  await harness.controller.dispose();
});

test('deadline expiry reconciles once and stops an expired retained relay', async () => {
  const harness = createHarness(); await harness.activate();
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.setProjection(projection()); harness.emit({ battleId: BATTLE_A, version: 2 }); await harness.settle();
  harness.setNow('2026-09-04T12:05:34.000Z'); harness.setMonotonic(30_100); harness.runLastTimer();
  await harness.settle();
  assert.equal(harness.relay.stopCalls, 1);
  assert.equal(harness.timers.filter(timer => !timer.cancelled).length, 0);
  await harness.controller.dispose();
});

test('accepted rematch changes battle through relay.transition without idle or stop', async () => {
  const harness = createHarness(); await harness.activate();
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.setProjection(projection()); harness.emit({ battleId: BATTLE_A, version: 2 }); await harness.settle();
  harness.setBattle(rawBattle({ id: BATTLE_B, status: 'countdown', endedAt: null, version: 1 }));
  harness.setProjection(projection({ battleId: BATTLE_B, status: 'countdown', endedAt: null, series: series({ status: 'active', roundNumber: 2, rematchWindowExpiresAt: null }) }));
  harness.emit({ battleId: BATTLE_B, version: 1 }); await harness.settle();
  assert.deepEqual(harness.relay.transitionCalls, [BATTLE_B]);
  assert.equal(harness.relay.stopCalls, 0);
  assert.equal(harness.controller.getSnapshot().status, 'relaying');
  assert.equal(harness.controller.getSnapshot().battleId, BATTLE_B);
  await harness.controller.dispose();
});

test('reconnect restores a held relay only while authority remains open', async () => {
  const harness = createHarness(); await harness.activate();
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.setProjection(projection()); harness.emit({ battleId: BATTLE_A, version: 2 }); await harness.settle();
  await harness.controller.retryRelayAfterReconnect();
  assert.equal(harness.relay.stopCalls, 1);
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A, BATTLE_A]);
  harness.setNow('2026-09-04T12:05:34.000Z');
  await harness.controller.retryRelayAfterReconnect();
  assert.equal(harness.relay.stopCalls, 2);
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A, BATTLE_A]);
  await harness.controller.dispose();
});

test('session invalidation prevents delayed authority from reviving relay', async () => {
  const harness = createHarness(); await harness.activate();
  const originalRead = harness.dependencies.readPublicAuthority;
  let resolveAuthority;
  harness.dependencies.readPublicAuthority = () => new Promise(resolve => { resolveAuthority = resolve; });
  harness.setBattle(rawBattle({ status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2 }));
  harness.emit({ battleId: BATTLE_A, version: 2 }); await new Promise(resolve => setImmediate(resolve));
  harness.controller.updateContext({ liveSessionId: SESSION, hostUserId: HOST, isCanonicalHost: true, isSessionLive: false, engineReady: true, joined: true, isForeground: true });
  resolveAuthority?.(await originalRead(SESSION)); await harness.settle();
  assert.equal(harness.relay.startCalls.length, 1);
  assert.notEqual(harness.controller.getSnapshot().status, 'relaying');
  await harness.controller.dispose();
});

test('the existing host session poll fails closed when the opponent LIVE ends', async () => {
  const harness = createHarness();
  await harness.activate();
  harness.controller.updateContext({
    liveSessionId: SESSION,
    hostUserId: HOST,
    isCanonicalHost: true,
    isSessionLive: true,
    isOpponentSessionLive: false,
    engineReady: true,
    joined: true,
    isForeground: true,
  });
  await harness.settle();
  assert.equal(harness.relay.stopCalls, 1);
  assert.equal(harness.controller.getSnapshot().status, 'idle');
  await harness.controller.dispose();
});

class MockEngine {
  handlers = new Set(); stopCount = 0; configurations = []; nextResult = 0;
  registerEventHandler(handler) { this.handlers.add(handler); return true; }
  unregisterEventHandler(handler) { this.handlers.delete(handler); return true; }
  startOrUpdateChannelMediaRelay(configuration) { this.configurations.push(configuration); return this.nextResult; }
  stopChannelMediaRelay() { this.stopCount += 1; return 0; }
  emit(state, code = 0) { for (const handler of [...this.handlers]) handler.onChannelMediaRelayStateChanged?.(state, code); }
}

const credentials = battleId => ({
  appId: '0123456789abcdef0123456789abcdef',
  battleRelay: {
    battleId,
    source: { liveSessionId: SESSION, channel: SESSION, uid: 0, token: 'redacted' },
    destination: { liveSessionId: OTHER_SESSION, channel: OTHER_SESSION, uid: 77, token: 'redacted' },
    expiresIn: 45,
  },
});

test('native relay atomically updates the route for the next round', async () => {
  const engine = new MockEngine();
  const service = new relayModule.LiveBattleRelayService(engine, { requestCredentials: async battleId => credentials(battleId), logger: () => undefined });
  await service.start(BATTLE_A); engine.emit(states.RelayStateRunning);
  const snapshots = []; const unsubscribe = service.subscribe(snapshot => snapshots.push(snapshot.state));
  await service.transition(BATTLE_B);
  assert.equal(engine.stopCount, 0);
  assert.equal(engine.configurations.length, 2);
  assert.equal(service.getSnapshot().battleId, BATTLE_B);
  assert.equal(snapshots.includes('idle'), false);
  engine.emit(states.RelayStateRunning); assert.equal(service.getSnapshot().state, 'running');
  unsubscribe(); await service.dispose();
});

test('a failed atomic update stops the retained relay once and cannot leave old media orphaned', async () => {
  const engine = new MockEngine();
  const service = new relayModule.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => credentials(battleId),
    logger: () => undefined,
  });
  await service.start(BATTLE_A);
  engine.emit(states.RelayStateRunning);
  engine.nextResult = -17;
  await assert.rejects(() => service.transition(BATTLE_B), error => (
    error.code === 'battle_relay_agora_start_failed'
  ));
  assert.equal(engine.stopCount, 1);
  assert.equal(service.getSnapshot().state, 'failed');
  assert.equal(service.getSnapshot().battleId, BATTLE_B);
  await service.dispose();
  assert.equal(engine.stopCount, 1);
});

const rawAuthorizationBattle = (overrides = {}) => ({
  id: BATTLE_A, challenger_user_id: HOST, opponent_user_id: OPPONENT,
  challenger_session_id: SESSION, opponent_session_id: OTHER_SESSION,
  status: 'completed', ended_at: '2026-09-04T12:05:03.000Z',
  scheduled_start_at: '2026-09-04T12:00:03.000Z', scheduled_end_at: '2026-09-04T12:05:03.000Z',
  series_id: SERIES, round_number: 1, ...overrides,
});

const rawProjection = (overrides = {}) => ({
  battle_id: BATTLE_A, session_id: SESSION, opponent_session_id: OTHER_SESSION,
  local_host_user_id: HOST, opponent_host_user_id: OPPONENT,
  series_id: SERIES, round_number: 1, series_format: 'best_of_5', series_max_rounds: 5,
  series_wins_required: 3, challenger_series_wins: 1, opponent_series_wins: 0,
  series_rounds_completed: 1, series_status: 'awaiting_rematch', series_champion_user_id: null,
  rematch_request_id: null, rematch_request_after_battle_id: null,
  rematch_request_status: null, rematch_request_expires_at: null,
  rematch_window_expires_at: WINDOW, ...overrides,
});

const liveSessions = [
  { id: SESSION, host_id: HOST, status: 'live', ended_at: null },
  { id: OTHER_SESSION, host_id: OPPONENT, status: 'live', ended_at: null },
];

test('Agora authorization permits only the authoritative unexpired post-round window', () => {
  const allowed = authorization.authorizeBattleRelay(HOST, rawAuthorizationBattle(), liveSessions, new Date('2026-09-04T12:05:04.000Z'), rawProjection());
  assert.equal(allowed.battleId, BATTLE_A);
  assert.ok(allowed.expiresIn > 0 && allowed.expiresIn <= 45);
  for (const [actor, candidateProjection, sessions, now] of [
    [VIEWER, rawProjection(), liveSessions, '2026-09-04T12:05:04.000Z'],
    [HOST, rawProjection({ series_status: 'completed', rematch_window_expires_at: null }), liveSessions, '2026-09-04T12:05:04.000Z'],
    [HOST, rawProjection(), liveSessions, WINDOW],
    [HOST, rawProjection(), [{ ...liveSessions[0] }, { ...liveSessions[1], status: 'ended', ended_at: WINDOW }], '2026-09-04T12:05:04.000Z'],
    [HOST, rawProjection({ battle_id: BATTLE_B }), liveSessions, '2026-09-04T12:05:04.000Z'],
  ]) {
    assert.throws(
      () => authorization.authorizeBattleRelay(actor, rawAuthorizationBattle(), sessions, new Date(now), candidateProjection),
      error => error.code === (actor === VIEWER ? 'battle_relay_not_found' : 'battle_relay_not_authorized'),
    );
  }
});

test('completed round renews the same relay because the active token cannot cover rematch', async () => {
  const roundStart = new Date('2026-09-04T12:00:03.000Z');
  const active = rawAuthorizationBattle({ status: 'active', ended_at: null });
  const initialTtl = authorization.calculateBattleRelayExpiresIn(active, roundStart);
  const initialExpiry = new Date(roundStart.getTime() + initialTtl * 1_000).toISOString();
  assert.equal(initialExpiry, '2026-09-04T12:05:18.000Z');
  assert.ok(Date.parse(initialExpiry) < Date.parse(WINDOW));

  const postRoundNow = new Date('2026-09-04T12:05:04.000Z');
  const renewed = authorization.authorizeBattleRelay(
    HOST,
    rawAuthorizationBattle(),
    liveSessions,
    postRoundNow,
    rawProjection(),
  );
  assert.ok(postRoundNow.getTime() + renewed.expiresIn * 1_000 > Date.parse(WINDOW));

  const harness = createHarness();
  await harness.activate();
  harness.setBattle(rawBattle({
    status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2,
  }));
  harness.setProjection(projection());
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  assert.deepEqual(harness.relay.refreshCalls, [BATTLE_A]);
  assert.equal(harness.relay.stopCalls, 0);
  assert.equal(harness.controller.getSnapshot().status, 'relaying');
  await harness.controller.dispose();
});

test('same completed authority refreshes once and a changed deadline refreshes once more', async () => {
  const harness = createHarness();
  await harness.activate();
  harness.setBattle(rawBattle({
    status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2,
  }));
  harness.publishProjection(projection());
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  harness.publishProjection(projection());
  await harness.settle();
  assert.deepEqual(harness.relay.refreshCalls, [BATTLE_A]);

  harness.publishProjection(projection({
    series: series({ version: 3, rematchWindowExpiresAt: '2026-09-04T12:05:40.000Z' }),
  }));
  await harness.settle();
  assert.deepEqual(harness.relay.refreshCalls, [BATTLE_A, BATTLE_A]);
  assert.equal(harness.relay.stopCalls, 0);
  await harness.controller.dispose();
});

test('one transient authority failure uses one bounded retry then fails closed', async () => {
  const harness = createHarness();
  await harness.activate();
  harness.setBattle(rawBattle({
    status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2,
  }));
  harness.setProjection(projection());
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  assert.deepEqual(harness.relay.refreshCalls, [BATTLE_A]);

  harness.dependencies.readPublicAuthority = async () => { throw new Error('temporary'); };
  harness.publishProjection(projection({ series: series({ version: 3 }) }));
  await harness.settle();
  assert.equal(harness.controller.getSnapshot().status, 'relaying');
  assert.equal(harness.relay.stopCalls, 0);
  const retry = [...harness.timers].reverse().find(timer => !timer.cancelled);
  assert.ok(retry);
  assert.ok(retry.delayMs >= 0 && retry.delayMs <= 1_000);
  retry.cancelled = true;
  retry.callback();
  await harness.settle();
  assert.equal(harness.relay.stopCalls, 1);
  assert.equal(harness.controller.getSnapshot().status, 'observing');
  assert.equal(harness.timers.filter(timer => !timer.cancelled).length, 0);
  await harness.controller.dispose();
});

test('runtime refresh failure stops once and never reports false relaying', async () => {
  const harness = createHarness();
  await harness.activate();
  harness.relay.refreshCredentials = async battleId => {
    harness.relay.refreshCalls.push(battleId);
    throw new Error('refresh rejected');
  };
  harness.setBattle(rawBattle({
    status: 'completed', endedAt: '2026-09-04T12:05:03.000Z', version: 2,
  }));
  harness.setProjection(projection());
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  assert.deepEqual(harness.relay.refreshCalls, [BATTLE_A]);
  assert.equal(harness.relay.stopCalls, 1);
  assert.equal(harness.controller.getSnapshot().status, 'observing');
  assert.equal(harness.controller.getSnapshot().errorCode, null);
  await harness.controller.dispose();
});

test('native same-battle refresh is single-flight and never publishes idle or connecting', async () => {
  let requests = 0;
  const engine = new MockEngine();
  const service = new relayModule.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => { requests += 1; return credentials(battleId); },
    logger: () => undefined,
  });
  await service.start(BATTLE_A);
  engine.emit(states.RelayStateRunning);
  const statesSeen = [];
  const unsubscribe = service.subscribe(snapshot => statesSeen.push(snapshot.state));
  const first = service.refreshCredentials(BATTLE_A);
  const duplicate = service.refreshCredentials(BATTLE_A);
  assert.strictEqual(first, duplicate);
  await new Promise(resolve => setImmediate(resolve));
  let settled = false;
  void first.finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  engine.emit(states.RelayStateConnecting);
  assert.equal(service.getSnapshot().state, 'recovering');
  engine.emit(states.RelayStateRunning);
  await first;
  assert.equal(requests, 2);
  assert.equal(engine.configurations.length, 2);
  assert.equal(engine.stopCount, 0);
  assert.equal(engine.handlers.size, 1);
  assert.equal(statesSeen.includes('idle'), false);
  assert.equal(statesSeen.includes('connecting'), false);
  unsubscribe();
  await service.dispose();
});

test('native refresh rejection fails closed once for credentials and Agora update errors', async () => {
  for (const failure of ['credentials', 'native']) {
    let requests = 0;
    const engine = new MockEngine();
    const service = new relayModule.LiveBattleRelayService(engine, {
      requestCredentials: async battleId => {
        requests += 1;
        if (failure === 'credentials' && requests >= 2) throw new Error('unavailable');
        return credentials(battleId);
      },
      wait: async () => undefined,
      logger: () => undefined,
    });
    await service.start(BATTLE_A);
    engine.emit(states.RelayStateRunning);
    if (failure === 'native') engine.nextResult = -17;
    await assert.rejects(
      () => service.refreshCredentials(BATTLE_A),
      error => error.code === 'battle_relay_credential_refresh_failed',
    );
    assert.equal(engine.stopCount, 1);
    assert.equal(service.getSnapshot().state, 'failed');
    assert.equal(service.getSnapshot().errorCode, 'battle_relay_credential_refresh_failed');
    await service.dispose();
    assert.equal(engine.stopCount, 1);
  }
});

test('late refresh is fenced by teardown and a next-round transition supersedes it', async () => {
  let resolveRefresh;
  let requestNumber = 0;
  const engine = new MockEngine();
  const service = new relayModule.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => {
      requestNumber += 1;
      if (requestNumber === 2) {
        return new Promise(resolve => { resolveRefresh = () => resolve(credentials(battleId)); });
      }
      return credentials(battleId);
    },
    logger: () => undefined,
  });
  await service.start(BATTLE_A);
  engine.emit(states.RelayStateRunning);
  const refresh = service.refreshCredentials(BATTLE_A);
  await new Promise(resolve => setImmediate(resolve));
  const transition = service.transition(BATTLE_B);
  resolveRefresh();
  await assert.rejects(refresh, error => error.code === 'battle_relay_operation_superseded');
  await transition;
  assert.equal(engine.configurations.length, 2);
  assert.equal(engine.stopCount, 0);
  assert.equal(service.getSnapshot().battleId, BATTLE_B);
  await service.dispose();

  let resolveLate;
  requestNumber = 0;
  const teardownEngine = new MockEngine();
  const teardownService = new relayModule.LiveBattleRelayService(teardownEngine, {
    requestCredentials: async battleId => {
      requestNumber += 1;
      if (requestNumber === 2) {
        return new Promise(resolve => { resolveLate = () => resolve(credentials(battleId)); });
      }
      return credentials(battleId);
    },
    logger: () => undefined,
  });
  await teardownService.start(BATTLE_A);
  teardownEngine.emit(states.RelayStateRunning);
  const late = teardownService.refreshCredentials(BATTLE_A);
  await new Promise(resolve => setImmediate(resolve));
  teardownService.stopImmediately();
  resolveLate();
  await assert.rejects(late, error => error.code === 'battle_relay_operation_superseded');
  assert.equal(teardownEngine.configurations.length, 1);
  assert.equal(teardownEngine.stopCount, 1);
  assert.equal(teardownService.getSnapshot().state, 'idle');
  await teardownService.dispose();
});

test('wiring reuses the public projection and adds no polling, schema, or economy writes', async () => {
  assert.match(runtimeHookSource, /publicBattleState/);
  assert.match(runtimeHookSource, /controllerRef\.current\?\.updatePublicAuthority/);
  assert.match(runtimeHookSource, /getLiveBattleRelaySessionPairAuthority/);
  assert.match(broadcastSource, /publicBattleState: battleProjection\.state/);
  assert.match(broadcastSource, /isOpponentSessionLive: battleOpponentSessionIsLive/);
  assert.match(broadcastSource, /\.in\('id', sessionIds\)/);
  assert.match(spectatorSource, /\.from\('live_sessions'\)[\s\S]*\.select\('id, host_id, status, ended_at'\)/);
  assert.match(edgeSource, /get_live_battle_public_snapshot/);
  assert.doesNotMatch(`${policySource}\n${controllerSource}\n${runtimeHookSource}`, /setInterval/);
  assert.doesNotMatch(`${policySource}\n${controllerSource}\n${relaySource}`, /financial_transactions|ledger_entries|wallet|send_live_(?:battle_)?gift/i);
  assert.match(broadcastSource, /remoteUids\.includes\(battleState\.opponentHostAgoraUid\)/);
  assert.match(stageSource, /state\.series/);
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(migrations.slice(-3), [
    '20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql',
    '20260905230823_live_gift_platform_commission_35.sql',
    '20260906053652_live_battle_gift_like_scoring.sql',
  ]);
});
