import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    name => { assert.ok(name in imports, `unexpected import: ${name}`); return imports[name]; },
    module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

const native = {
  ChannelMediaRelayState: { RelayStateIdle: 0, RelayStateConnecting: 1, RelayStateRunning: 2, RelayStateFailure: 3 },
  ChannelMediaRelayError: {
    RelayOk: 0, RelayErrorServerNoResponse: 2, RelayErrorFailedJoinSrc: 4,
    RelayErrorFailedJoinDest: 5, RelayErrorFailedPacketReceivedFromSrc: 6,
    RelayErrorFailedPacketSentToDest: 7, RelayErrorServerConnectionLost: 8,
    RelayErrorSrcTokenExpired: 10, RelayErrorDestTokenExpired: 11,
  },
};
class RelayError extends Error {
  constructor(code, status, relayCode) { super(code); this.code = code; this.status = status; this.relayCode = relayCode; }
}
const relayModule = load(read('services/liveBattleRelayService.native.ts'), {
  'react-native-agora': native,
  './liveBattleRelayContract': { LiveBattleRelayError: RelayError },
});

const HOST = '10000000-0000-4000-8000-000000000001';
const OPPONENT = '10000000-0000-4000-8000-000000000002';
const SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const BATTLE_A = '30000000-0000-4000-8000-000000000001';
const BATTLE_B = '30000000-0000-4000-8000-000000000002';
const SERIES = '40000000-0000-4000-8000-000000000001';

function credentials(battleId, sequence) {
  const issuedAt = '2026-09-06T12:00:00.000Z';
  return {
    appId: 'app', battleRelay: { battleId, issuedAt, expiresIn: 120,
      source: { liveSessionId: SESSION, channel: SESSION, uid: 0, token: `source-${sequence}`, expiresAt: '2026-09-06T12:02:00.000Z' },
      destination: { liveSessionId: OTHER_SESSION, channel: OTHER_SESSION, uid: 77, token: `destination-${sequence}`, expiresAt: '2026-09-06T12:02:00.000Z' },
    },
  };
}

function relayHarness() {
  let requests = 0;
  let timerId = 0;
  let nextResult = 0;
  const timers = new Map();
  const handlers = new Set();
  const configurations = [];
  const logs = [];
  const continuity = [];
  const engine = {
    stopCount: 0,
    registerEventHandler(handler) { handlers.add(handler); return true; },
    unregisterEventHandler(handler) { handlers.delete(handler); return true; },
    getConnectionState: () => 3,
    startOrUpdateChannelMediaRelay(config) {
      configurations.push(config);
      const value = nextResult; nextResult = 0; return value;
    },
    stopChannelMediaRelay() { this.stopCount += 1; return 0; },
  };
  const relay = new relayModule.LiveBattleRelayService(engine, {
    now: () => 0,
    wait: async () => undefined,
    requestCredentials: async battleId => credentials(battleId, ++requests),
    logger: (event, data) => logs.push([event, data]),
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  relay.setVisualContinuityHandlers({ onRecoveryStart: () => continuity.push('recovery'), onStopped: () => continuity.push('stopped') });
  const emit = (state, code = 0, handler = null) => {
    const targets = handler ? [handler] : [...handlers];
    for (const item of targets) item.onChannelMediaRelayStateChanged?.(state, code);
  };
  const settle = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
  const timeout = () => {
    const entry = [...timers.entries()].find(([, value]) => value.delay === 8_000);
    assert.ok(entry, 'native confirmation timeout');
    timers.delete(entry[0]); entry[1].callback();
  };
  return { relay, engine, handlers, configurations, logs, continuity, timers, emit, settle, timeout,
    requests: () => requests, failNext: () => { nextResult = -17; } };
}

async function runningRelay() {
  const h = relayHarness();
  await h.relay.start(BATTLE_A); h.emit(2, 0);
  return h;
}

test('refresh remains pending after sync 0 and Connecting, then resolves only on Running + Ok', async () => {
  const h = await runningRelay();
  const states = []; h.relay.subscribe(value => states.push(value.state));
  const refresh = h.relay.refreshCredentials(BATTLE_A);
  let settled = false; void refresh.then(() => { settled = true; }, () => { settled = true; });
  await h.settle();
  assert.equal(h.configurations.length, 2);
  assert.equal(settled, false);
  assert.equal(h.relay.getSnapshot().state, 'recovering');
  h.emit(1, 0); await h.settle();
  assert.equal(settled, false);
  h.emit(2, 0); await refresh;
  assert.equal(settled, true);
  assert.equal(h.relay.getSnapshot().state, 'running');
  assert.ok(states.includes('recovering'));
  assert.deepEqual(h.continuity, ['recovery']);
  assert.ok(h.logs.some(([event]) => event === 'confirmation_waiting'));
  assert.ok(h.logs.some(([event]) => event === 'confirmation_running'));
  await h.relay.dispose();
});

test('Failure rejects the update confirmation, performs one controlled restart, and waits again', async () => {
  const h = await runningRelay();
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  h.emit(3, 2); await h.settle();
  assert.equal(h.engine.stopCount, 1);
  assert.equal(h.configurations.length, 3);
  let settled = false; void refresh.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  h.emit(2, 0); await refresh;
  assert.equal(h.relay.getSnapshot().state, 'running');
  await h.relay.dispose();
});

test('eight-second timeout falls back to stop/start and the fallback also waits for Running + Ok', async () => {
  const h = await runningRelay();
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  h.timeout(); await h.settle();
  assert.equal(h.engine.stopCount, 1);
  assert.equal(h.configurations.length, 3);
  let settled = false; void refresh.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  assert.ok(h.logs.some(([event]) => event === 'confirmation_timeout'));
  h.emit(2, 0); await refresh;
  await h.relay.dispose();
});

test('three failed native confirmations publish and reject one definitive refresh failure', async () => {
  const h = await runningRelay();
  let failures = 0; h.relay.subscribe(value => { if (value.state === 'failed') failures += 1; });
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  for (let attempt = 0; attempt < 3; attempt += 1) { h.emit(3, 2); await h.settle(); }
  await assert.rejects(refresh, error => error.code === 'battle_relay_credential_refresh_failed');
  assert.equal(failures, 1);
  assert.equal(h.relay.getSnapshot().state, 'failed');
  assert.ok(h.logs.some(([event]) => event === 'confirmed_refresh_failed'));
  await h.relay.dispose();
});

test('two refresh callers share the exact Promise', async () => {
  const h = await runningRelay();
  const first = h.relay.refreshCredentials(BATTLE_A);
  const second = h.relay.refreshCredentials(BATTLE_A);
  assert.strictEqual(first, second);
  await h.settle(); h.emit(2, 0); await first;
  assert.equal(h.requests(), 2);
  await h.relay.dispose();
});

test('an obsolete handler cannot confirm the current generation', async () => {
  const h = await runningRelay();
  const obsolete = [...h.handlers][0];
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  let settled = false; void refresh.then(() => { settled = true; }, () => { settled = true; });
  h.emit(2, 0, obsolete); await Promise.resolve();
  assert.equal(settled, false);
  h.emit(2, 0); await refresh;
  await h.relay.dispose();
});

test('battle transition cancels the old confirmation and its timeout', async () => {
  const h = await runningRelay();
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  const obsolete = [...h.handlers][0];
  const transition = h.relay.transition(BATTLE_B);
  await assert.rejects(refresh, error => error.code === 'battle_relay_operation_superseded');
  await transition;
  assert.equal(h.relay.getSnapshot().battleId, BATTLE_B);
  assert.equal([...h.timers.values()].some(value => value.delay === 8_000), false);
  const currentGenerationRefresh = h.relay.refreshCredentials(BATTLE_B); await h.settle();
  let currentSettled = false;
  void currentGenerationRefresh.then(() => { currentSettled = true; }, () => { currentSettled = true; });
  h.emit(2, 0, obsolete); await Promise.resolve();
  assert.equal(currentSettled, false);
  h.emit(2, 0); await currentGenerationRefresh;
  await h.relay.dispose();
});

test('dispose cancels an outstanding confirmation and every timer', async () => {
  const h = await runningRelay();
  const refresh = h.relay.refreshCredentials(BATTLE_A); await h.settle();
  const disposal = h.relay.dispose();
  await assert.rejects(refresh, error => error.code === 'battle_relay_operation_superseded');
  await disposal;
  assert.equal(h.timers.size, 0);
  assert.equal(h.handlers.size, 0);
});

test('preventive refresh and Agora codes 10/11 continue through the same confirmed path', async () => {
  for (const code of [10, 11]) {
    const h = await runningRelay();
    const scheduled = [...h.timers.entries()].find(([, value]) => value.delay > 8_000);
    assert.ok(scheduled); h.timers.delete(scheduled[0]); scheduled[1].callback();
    await h.settle(); h.emit(2, 0); await h.settle();
    assert.equal(h.relay.getSnapshot().state, 'running');
    h.emit(3, code); await h.settle(); h.emit(2, 0); await h.settle();
    assert.equal(h.relay.getSnapshot().state, 'running');
    await h.relay.dispose();
  }
});

const policy = load(read('services/liveBattlePostRoundRelayPolicy.ts'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const Controller = load(read('services/liveBattleRuntimeController.ts'), {
  './liveBattleService': {
    cancelLiveBattle: async () => { throw new Error('not expected'); },
    getLiveBattleState: async () => { throw new Error('dependency not injected'); },
    getOpenLiveBattlesForSession: async () => [],
    isLiveBattleUuid: value => typeof value === 'string' && UUID.test(value),
    subscribeToLiveBattlesForSession: () => ({ unsubscribe: async () => undefined }),
  },
  './liveBattlePostRoundRelayPolicy': policy,
}, { __DEV__: true, console: globalThis.console }).LiveBattleRuntimeController;

const activeBattle = (overrides = {}) => ({
  id: BATTLE_A, challengerUserId: HOST, opponentUserId: OPPONENT,
  challengerSessionId: SESSION, opponentSessionId: OTHER_SESSION,
  status: 'active', version: 1, endedAt: null,
  scheduledStartAt: '2026-09-06T11:55:00.000Z', scheduledEndAt: '2026-09-06T12:00:00.000Z',
  ...overrides,
});
const seriesProjection = (overrides = {}) => ({
  id: SERIES, format: 'best_of_5', roundNumber: 1, maxRounds: 5, winsRequired: 3,
  challengerWins: 1, opponentWins: 0, ties: 0, roundsCompleted: 1,
  status: 'awaiting_rematch', championUserId: null, version: 2,
  rematchRequestId: null, rematchRequestAfterBattleId: null, rematchRequestStatus: null,
  rematchRequestedByUserId: null, rematchRequestExpiresAt: null,
  rematchWindowExpiresAt: '2026-09-06T12:00:30.000Z', ...overrides,
});
const projection = (overrides = {}) => ({
  sessionId: SESSION, battleId: BATTLE_A, opponentSessionId: OTHER_SESSION,
  localBattleSide: 'challenger', localHostUserId: HOST, opponentHostUserId: OPPONENT,
  status: 'completed', version: 2, endedAt: '2026-09-06T12:00:00.000Z',
  series: seriesProjection(), ...overrides,
});
const terminalSeries = () => ({ id: SERIES, status: 'completed', version: 3 });

function runtimeHarness(options = {}) {
  let battle = activeBattle();
  let publicState = projection({ status: 'active', version: 1, endedAt: null,
    series: seriesProjection({ status: 'active', version: 1, roundsCompleted: 0, rematchWindowExpiresAt: null }) });
  let relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null };
  const relayListeners = new Set();
  const order = [];
  const logs = [];
  const timers = [];
  let leaveCalls = 0;
  let terminalCalls = 0;
  let deferredLeaveResolve = null;
  const relay = {
    async start(id) { relaySnapshot = { state: 'running', battleId: id, errorCode: null, relayCode: 0 }; },
    async refreshCredentials() { throw new RelayError('battle_relay_credential_refresh_failed'); },
    async transition(id) { relaySnapshot = { state: 'running', battleId: id, errorCode: null, relayCode: 0 }; order.push('transition'); },
    async stop() { order.push('relay_stop'); relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null }; },
    stopImmediately() {}, async dispose() {}, getSnapshot: () => relaySnapshot,
    subscribe(fn) { relayListeners.add(fn); return () => relayListeners.delete(fn); },
  };
  const leave = async () => {
    leaveCalls += 1;
    if (options.deferLeave) return new Promise(resolve => { deferredLeaveResolve = resolve; });
    if (options.staleLeave) {
      publicState = projection({ series: seriesProjection({ status: 'completed', version: 3, rematchWindowExpiresAt: null }) });
      throw Object.assign(new Error('stale'), { code: 'stale_state' });
    }
    const failures = options.networkFailures ?? 0;
    if (leaveCalls <= failures) throw Object.assign(new Error('network'), { code: 'network' });
    publicState = projection({ series: seriesProjection({ status: 'completed', version: 3, rematchWindowExpiresAt: null }) });
    return terminalSeries();
  };
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args);
  const controller = new Controller({
    relay,
    discover: async () => [battle], reconcile: async () => battle,
    subscribe: () => ({ unsubscribe: async () => undefined }),
    readPublicAuthority: async () => ({ state: publicState, serverNow: '2026-09-06T12:00:01.000Z',
      clockAnchor: { serverEpochMsAtAnchor: Date.parse('2026-09-06T12:00:01.000Z'), monotonicMsAtAnchor: 0, roundTripMs: 0 } }),
    validateSessionPair: async () => ({ localSessionId: SESSION, opponentSessionId: OTHER_SESSION,
      localHostUserId: HOST, opponentHostUserId: OPPONENT, localSessionLive: true, opponentSessionLive: true }),
    leaveSeriesAfterRelayFailure: leave,
    onTerminalAuthority: () => { terminalCalls += 1; order.push('stage_hidden'); },
    setTimer: (callback, delayMs) => { const timer = { callback, delayMs, cancelled: false }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cancelled = true; },
  });
  const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
  return {
    controller, relay, order, logs, timers, settle,
    leaveCalls: () => leaveCalls, terminalCalls: () => terminalCalls,
    activate: async () => {
      controller.updateContext({ liveSessionId: SESSION, hostUserId: HOST, isCanonicalHost: true,
        isSessionLive: true, isOpponentSessionLive: true, engineReady: true, joined: true, isForeground: true });
      await controller.waitForIdle();
    },
    failPostRound: (seriesStatus = 'awaiting_rematch') => {
      battle = activeBattle({ status: 'completed', version: 2, endedAt: '2026-09-06T12:00:00.000Z' });
      publicState = projection({ series: seriesProjection(seriesStatus === 'rematch_pending' ? {
        status: 'rematch_pending', rematchRequestId: '50000000-0000-4000-8000-000000000001',
        rematchRequestAfterBattleId: BATTLE_A, rematchRequestStatus: 'pending',
        rematchRequestedByUserId: HOST, rematchRequestExpiresAt: '2026-09-06T12:00:20.000Z',
      } : {}) });
      controller.updatePublicAuthority(publicState, { serverEpochMsAtAnchor: Date.parse('2026-09-06T12:00:01.000Z'), monotonicMsAtAnchor: 0, roundTripMs: 0 });
      return controller.applyAuthoritativeBattle(battle);
    },
    finishSeries: () => {
      battle = activeBattle({ status: 'completed', version: 2, endedAt: '2026-09-06T12:00:00.000Z' });
      publicState = projection({ series: seriesProjection({ status: 'completed', version: 3, rematchWindowExpiresAt: null }) });
      controller.updatePublicAuthority(publicState, { serverEpochMsAtAnchor: Date.parse('2026-09-06T12:00:01.000Z'), monotonicMsAtAnchor: 0, roundTripMs: 0 });
      return controller.applyAuthoritativeBattle(battle);
    },
    runRetry: () => {
      const timer = timers.find(item => !item.cancelled && (item.delayMs === 500 || item.delayMs === 1_500));
      assert.ok(timer, 'bounded post-round retry'); timer.cancelled = true; timer.callback();
    },
    acceptRematch: () => {
      battle = activeBattle({ id: BATTLE_B, status: 'countdown', version: 1,
        scheduledStartAt: '2026-09-06T12:00:04.000Z', scheduledEndAt: '2026-09-06T12:05:04.000Z' });
      publicState = projection({ battleId: BATTLE_B, status: 'countdown', version: 1, endedAt: null,
        series: seriesProjection({ status: 'active', version: 3, roundNumber: 2, rematchWindowExpiresAt: null }) });
      controller.updatePublicAuthority(publicState, { serverEpochMsAtAnchor: Date.parse('2026-09-06T12:00:02.000Z'), monotonicMsAtAnchor: 0, roundTripMs: 0 });
    },
    resolveOldLeave: () => deferredLeaveResolve?.(terminalSeries()),
    restoreConsole: () => { console.info = originalInfo; },
  };
}

test('post-round relay failure leaves the series once, confirms terminal authority, hides Stage, then stops', async () => {
  const h = runtimeHarness();
  try {
    await h.activate(); await h.failPostRound();
    assert.equal(h.leaveCalls(), 1);
    assert.equal(h.terminalCalls(), 1);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
    assert.equal(h.controller.getSnapshot().status, 'observing');
    assert.equal(h.controller.getSnapshot().errorCode, null);
    const output = JSON.stringify(h.logs);
    for (const event of ['relay_failure_exit_started', 'series_leave_requested', 'terminal_authority_confirmed', 'exit_to_live']) assert.match(output, new RegExp(event));
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('rematch_pending uses the same single canonical leave and ordered exit', async () => {
  const h = runtimeHarness();
  try {
    await h.activate(); await h.failPostRound('rematch_pending');
    assert.equal(h.leaveCalls(), 1);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
    assert.equal(h.controller.getSnapshot().status, 'observing');
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('stale_state from leave triggers authority reconciliation instead of a second leave', async () => {
  const h = runtimeHarness({ staleLeave: true });
  try {
    await h.activate(); await h.failPostRound();
    assert.equal(h.leaveCalls(), 1);
    assert.equal(h.terminalCalls(), 1);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('network failures retry canonically three times and then converge when authority closes', async () => {
  const h = runtimeHarness({ networkFailures: 2 });
  try {
    await h.activate(); const flight = h.failPostRound(); await h.settle();
    assert.equal(h.leaveCalls(), 1);
    h.runRetry(); await h.settle(); assert.equal(h.leaveCalls(), 2);
    h.runRetry(); await flight;
    assert.equal(h.leaveCalls(), 3);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('exhausted network retries perform one local fail-closed exit without permanent Connecting', async () => {
  const h = runtimeHarness({ networkFailures: 3 });
  try {
    await h.activate(); const flight = h.failPostRound(); await h.settle();
    h.runRetry(); await h.settle(); h.runRetry(); await flight;
    assert.equal(h.leaveCalls(), 3);
    assert.equal(h.terminalCalls(), 1);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
    assert.equal(h.controller.getSnapshot().status, 'observing');
    assert.match(JSON.stringify(h.logs), /local_fail_closed/);
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('a terminal series is not left again and still suppresses Stage before relay removal', async () => {
  const h = runtimeHarness();
  try {
    await h.activate(); await h.finishSeries();
    assert.equal(h.leaveCalls(), 0);
    assert.deepEqual(h.order.slice(-2), ['stage_hidden', 'relay_stop']);
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('a late leave response from the old round cannot close or suppress an accepted rematch', async () => {
  const h = runtimeHarness({ deferLeave: true });
  try {
    await h.activate(); const oldFlight = h.failPostRound(); await h.settle();
    assert.equal(h.leaveCalls(), 1);
    h.acceptRematch(); h.resolveOldLeave();
    await oldFlight; await h.controller.waitForIdle();
    assert.equal(h.terminalCalls(), 0);
    assert.equal(h.controller.getSnapshot().battleId, BATTLE_B);
    assert.notEqual(h.order.at(-1), 'relay_stop');
  } finally { await h.controller.dispose(); h.restoreConsole(); }
});

test('series service classifies canonical leave races and lock contention for reconciliation', () => {
  const serviceSource = read('services/liveBattleSeriesService.ts');
  const calls = [];
  const service = load(serviceSource, {
    '@/template': { getSupabaseClient: () => ({ rpc: async () => {
      calls.push('rpc'); return { data: null, error: { message: 'live_battle_series_leave_state_invalid', code: '55000' } };
    } }) },
    './liveBattleSeriesContract': { isLiveBattleSeriesUuid: value => UUID.test(value), parseLiveBattleSeries: value => value },
    './liveBattleService': { parseLiveBattle: value => value },
  });
  return assert.rejects(service.leaveLiveBattleSeries(SERIES), error => error.code === 'stale_state').then(() => assert.equal(calls.length, 1));
});

test('normal and relay-recovery visual retention remain bounded at 1.5s and 20s', () => {
  const engine = read('hooks/useAgoraEngine.native.ts');
  assert.match(engine, /REMOTE_VIDEO_TRANSITION_GRACE_MS = 1_500/);
  assert.match(engine, /REMOTE_VIDEO_RELAY_RECOVERY_GRACE_MS = 20_000/);
});
