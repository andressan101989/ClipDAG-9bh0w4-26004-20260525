import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    name => { assert.ok(name in imports, name); return imports[name]; },
    module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

const relayNative = {
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
  'react-native-agora': relayNative,
  './liveBattleRelayContract': { LiveBattleRelayError: RelayError },
});
const BATTLE = '10000000-0000-4000-8000-000000000001';
const SOURCE = '20000000-0000-4000-8000-000000000001';
const DESTINATION = '20000000-0000-4000-8000-000000000002';

function relayCredentials(sequence, sourceSeconds = 120, destinationSeconds = 180) {
  const issuedAt = '2026-09-06T12:00:00.000Z';
  return {
    appId: 'app',
    battleRelay: {
      battleId: BATTLE, issuedAt, expiresIn: Math.min(sourceSeconds, destinationSeconds),
      source: { liveSessionId: SOURCE, channel: SOURCE, uid: 0, token: `SOURCE-${sequence}`, expiresAt: new Date(Date.parse(issuedAt) + sourceSeconds * 1000).toISOString() },
      destination: { liveSessionId: DESTINATION, channel: DESTINATION, uid: 91, token: `DEST-${sequence}`, expiresAt: new Date(Date.parse(issuedAt) + destinationSeconds * 1000).toISOString() },
    },
  };
}

function relayHarness(options = {}) {
  let clock = 0;
  let requests = 0;
  let nextResult = 0;
  let timerId = 0;
  const timers = new Map();
  const handlers = new Set();
  const configurations = [];
  const logs = [];
  const continuity = { recovery: 0, stopped: 0 };
  const engine = {
    registerEventHandler: handler => (handlers.add(handler), true),
    unregisterEventHandler: handler => (handlers.delete(handler), true),
    getConnectionState: () => 3,
    startOrUpdateChannelMediaRelay: config => {
      configurations.push(config);
      const result = nextResult;
      nextResult = 0;
      return result;
    },
    stopCount: 0,
    stopChannelMediaRelay() { this.stopCount += 1; return 0; },
  };
  const relay = new relayModule.LiveBattleRelayService(engine, {
    now: () => clock,
    wait: async () => undefined,
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
    logger: (event, data) => logs.push([event, data]),
    requestCredentials: async () => {
      requests += 1;
      if (options.failCredentials) throw new Error('network');
      return relayCredentials(requests, options.sourceSeconds, options.destinationSeconds);
    },
  });
  relay.setVisualContinuityHandlers({
    onRecoveryStart: () => { continuity.recovery += 1; },
    onStopped: () => { continuity.stopped += 1; },
  });
  const emit = (state, code = 0) => {
    for (const handler of [...handlers]) handler.onChannelMediaRelayStateChanged?.(state, code);
  };
  const settle = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
  return {
    relay, engine, handlers, configurations, logs, timers, continuity, emit, settle,
    requests: () => requests,
    setClock: value => { clock = value; },
    failNextUpdate: () => { nextResult = -17; },
    fireRefresh: () => {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay > 8_000);
      assert.ok(entry, 'scheduled refresh timer');
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test('source and destination expiration metadata schedule one early refresh at the earliest token', async () => {
  const h = relayHarness({ sourceSeconds: 120, destinationSeconds: 180 });
  await h.relay.start(BATTLE);
  h.emit(2, 0);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 89_000);
  h.fireRefresh();
  await h.settle();
  assert.equal(h.requests(), 2);
  assert.equal(h.relay.getSnapshot().state, 'recovering');
  h.emit(2, 0);
  await h.settle();
  assert.equal(h.relay.getSnapshot().state, 'running');
  assert.ok(h.logs.some(([event]) => event === 'refresh_scheduled'));
  assert.ok(h.logs.some(([event]) => event === 'recovery_running'));
  await h.relay.dispose();
});

for (const [code, reason] of [[10, 'source_token_expired'], [11, 'destination_token_expired']]) {
  test(`Agora ${code} obtains fresh ${reason} credentials and waits for Running + Ok`, async () => {
    const h = relayHarness();
    await h.relay.start(BATTLE); h.emit(2, 0);
    h.emit(3, code);
    await h.settle();
    assert.equal(h.relay.getSnapshot().state, 'recovering');
    assert.equal(h.requests(), 2);
    assert.equal(h.continuity.recovery, 1);
    assert.ok(h.logs.some(([event, data]) => event === 'refresh_started' && data.reason === reason));
    h.emit(2, 0);
    await h.settle();
    assert.equal(h.relay.getSnapshot().state, 'running');
    await h.relay.dispose();
  });
}

test('nearly simultaneous source and destination expiry callbacks share one recovery flight', async () => {
  const h = relayHarness();
  await h.relay.start(BATTLE); h.emit(2, 0);
  h.emit(3, 10); h.emit(3, 11);
  await h.settle();
  assert.equal(h.requests(), 2);
  assert.equal(h.continuity.recovery, 1);
  h.emit(2, 0); await h.settle();
  assert.equal(h.relay.getSnapshot().state, 'running');
  await h.relay.dispose();
});

test('failed update performs a controlled stop/start and still requires native confirmation', async () => {
  const h = relayHarness();
  await h.relay.start(BATTLE); h.emit(2, 0);
  h.failNextUpdate();
  h.emit(3, 10);
  await h.settle();
  assert.equal(h.engine.stopCount, 1);
  assert.equal(h.configurations.length, 3);
  assert.equal(h.relay.getSnapshot().state, 'recovering');
  assert.ok(h.logs.some(([event]) => event === 'update_requested'));
  assert.ok(h.logs.some(([event]) => event === 'restart_requested'));
  h.emit(2, 0); await h.settle();
  assert.equal(h.relay.getSnapshot().state, 'running');
  await h.relay.dispose();
});

test('three failed credential attempts terminate recovery without an infinite loop', async () => {
  const h = relayHarness({ failCredentials: true });
  h.relay.requestCredentials = async () => relayCredentials(1);
  await h.relay.start(BATTLE); h.emit(2, 0);
  h.relay.requestCredentials = async () => { throw new Error('network'); };
  h.emit(3, 11);
  await h.settle();
  assert.equal(h.relay.getSnapshot().state, 'failed');
  assert.equal(h.relay.getSnapshot().errorCode, 'battle_relay_recovery_failed');
  assert.equal(h.engine.stopCount, 1);
  assert.ok(h.logs.some(([event, data]) => event === 'recovery_failed' && data.attempts === 3));
  await h.relay.dispose();
});

test('battle change and teardown cancel refresh timers and fence obsolete callbacks', async () => {
  const h = relayHarness();
  await h.relay.start(BATTLE); h.emit(2, 0);
  const obsolete = [...h.handlers][0];
  assert.equal(h.timers.size, 1);
  h.relay.stopImmediately();
  assert.equal(h.timers.size, 0);
  obsolete.onChannelMediaRelayStateChanged?.(2, 0);
  assert.equal(h.relay.getSnapshot().state, 'idle');
  assert.equal(h.handlers.size, 0);
  await h.relay.dispose();
});

const policy = load(read('services/liveBattlePostRoundRelayPolicy.ts'));
const HOST = '30000000-0000-4000-8000-000000000001';
const RIVAL = '30000000-0000-4000-8000-000000000002';
function activeBattle(overrides = {}) {
  return {
    id: BATTLE, challengerUserId: HOST, opponentUserId: RIVAL,
    challengerSessionId: SOURCE, opponentSessionId: DESTINATION,
    status: 'active', version: 3, endedAt: null,
    scheduledStartAt: '2026-09-06T11:55:00.000Z',
    scheduledEndAt: '2026-09-06T12:00:10.000Z', ...overrides,
  };
}
function runtimeHarness({ canonical = true } = {}) {
  let battle = activeBattle();
  let monotonic = 0;
  let localNow = Date.parse('2026-09-06T11:50:00.000Z');
  let reconciles = 0;
  let terminates = 0;
  let timerId = 0;
  const timers = new Map();
  const logs = [];
  let relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null };
  const relayListeners = new Set();
  const relay = {
    start: async id => { relaySnapshot = { state: 'running', battleId: id, errorCode: null, relayCode: 0 }; relayListeners.forEach(fn => fn(relaySnapshot)); },
    refreshCredentials: async () => undefined, transition: async () => undefined,
    stop: async () => { relaySnapshot = { state: 'idle', battleId: null, errorCode: null, relayCode: null }; },
    stopImmediately() {}, dispose: async () => undefined, getSnapshot: () => relaySnapshot,
    subscribe: fn => (relayListeners.add(fn), fn(relaySnapshot), () => relayListeners.delete(fn)),
    fail: () => { relaySnapshot = { state: 'failed', battleId: BATTLE, errorCode: 'battle_relay_recovery_failed', relayCode: 11 }; relayListeners.forEach(fn => fn(relaySnapshot)); },
  };
  const C = load(read('services/liveBattleRuntimeController.ts'), {
    './liveBattleService': { isLiveBattleUuid: () => true, cancelLiveBattle: async () => battle },
    './liveBattlePostRoundRelayPolicy': policy,
  }, { __DEV__: true, console: { info: (...args) => logs.push(args) } }).LiveBattleRuntimeController;
  const controller = new C({
    relay, now: () => localNow, monotonicNow: () => monotonic,
    discover: async () => [battle],
    reconcile: async () => { reconciles += 1; return battle; },
    terminateAfterRelayFailure: async () => {
      terminates += 1;
      battle = activeBattle({ status: 'cancelled', version: 4, endedAt: '2026-09-06T12:00:10.000Z' });
      return battle;
    },
    subscribe: () => ({ unsubscribe: async () => undefined }),
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  const context = { liveSessionId: SOURCE, hostUserId: HOST, isCanonicalHost: canonical,
    isSessionLive: true, isOpponentSessionLive: true, engineReady: true, joined: true, isForeground: true };
  const publicState = { battleId: BATTLE, sessionId: SOURCE, localHostUserId: HOST,
    opponentHostUserId: RIVAL, opponentSessionId: DESTINATION, status: 'active', version: 3,
    projectionVersion: 3, series: { id: BATTLE, version: 1, status: 'active' } };
  return {
    controller, relay, timers, logs, context,
    reconciles: () => reconciles, terminates: () => terminates,
    activate: async () => { controller.updateContext(context); await controller.waitForIdle(); },
    anchor: () => controller.updatePublicAuthority(publicState, { serverEpochMsAtAnchor: Date.parse('2026-09-06T12:00:00.000Z'), monotonicMsAtAnchor: 0 }),
    reach: () => { monotonic = 10_025; const timer = [...timers.values()].sort((a, b) => a.delay - b.delay)[0]; timers.clear(); timer.callback(); },
    complete: () => { battle = activeBattle({ status: 'completed', version: 4, endedAt: '2026-09-06T12:00:10.000Z' }); },
  };
}

test('server clock deadline requests one canonical reconciliation despite a clock ten minutes behind', async () => {
  const h = runtimeHarness();
  await h.activate();
  h.anchor();
  assert.equal(Math.min(...[...h.timers.values()].map(timer => timer.delay)), 10_025);
  const before = h.reconciles();
  h.complete(); h.reach();
  await h.controller.waitForIdle();
  assert.equal(h.reconciles(), before + 1);
  assert.equal(h.controller.getSnapshot().battle.status, 'completed');
  const output = JSON.stringify(h.logs);
  assert.match(output, /\[LIVE-BATTLE-DEADLINE\] reached/);
  assert.match(output, /\[LIVE-BATTLE-DEADLINE\] reconcile_requested/);
  assert.match(output, /\[LIVE-BATTLE-DEADLINE\] authority_confirmed/);
  await h.controller.dispose();
});

test('a non-controller client never schedules or writes a terminal battle', async () => {
  const h = runtimeHarness({ canonical: false });
  await h.activate(); h.anchor();
  assert.equal(h.reconciles(), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.terminates(), 0);
  await h.controller.dispose();
});

test('definitive relay recovery failure reuses canonical cancellation and exits failed active state', async () => {
  const h = runtimeHarness();
  await h.activate();
  h.relay.fail();
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  assert.equal(h.terminates(), 1);
  assert.equal(h.controller.getSnapshot().battle.status, 'cancelled');
  assert.notEqual(h.controller.getSnapshot().status, 'failed');
  await h.controller.dispose();
});

test('rematch UI authority is completed series state and never depends on relay running', () => {
  const stage = read('components/live/LiveBattleStage.tsx');
  const seriesState = load(read('services/liveBattleSeriesState.ts'));
  const state = { battleId: BATTLE, status: 'completed', localHostUserId: HOST,
    opponentHostUserId: RIVAL, series: { status: 'awaiting_rematch', rematchRequestId: null,
      rematchRequestStatus: null, rematchRequestAfterBattleId: null, rematchWindowExpiresAt: '2026-09-06T12:01:00.000Z' } };
  assert.equal(seriesState.deriveLiveBattleSeriesClientState(state, HOST, 'idle', null, false), 'available');
  assert.match(stage, /seriesClientState === 'available'/);
  assert.doesNotMatch(stage, /snapshot\.state|relay.*running/i);
});

test('main LIVE channel renews token single-flight from both official callbacks without logging credentials', () => {
  const source = read('hooks/useAgoraEngine.native.ts');
  assert.match(source, /onTokenPrivilegeWillExpire/);
  assert.match(source, /onRequestToken/);
  assert.match(source, /tokenRenewalFlight/);
  assert.match(source, /engine\.renewToken\(fresh\.token\)/);
  assert.doesNotMatch(source, /logAgora\([^\n]*fresh\.token|console\.[a-z]+\([^\n]*token:/);
});

test('relay recovery uses a distinct bounded visual window and retains the same UID without changing the normal grace', () => {
  const engine = read('hooks/useAgoraEngine.native.ts');
  const runtime = read('hooks/live/useLiveBattleRelayRuntime.native.ts');
  assert.match(engine, /REMOTE_VIDEO_TRANSITION_GRACE_MS = 1_500/);
  assert.match(engine, /REMOTE_VIDEO_RELAY_RECOVERY_GRACE_MS = 20_000/);
  assert.match(runtime, /onRecoveryStart/);
  assert.match(runtime, /beginRemoteVideoTransition\?\.\(uid, 20_000\)/);
  assert.match(engine, /transition_join_cancel/);
});

test('Edge response exposes coherent issuedAt and source/destination expiresAt without changing UIDs', () => {
  const source = read('supabase/functions/agora-token/index.ts');
  assert.match(source, /issuedAt: new Date\(issuedAtSec \* 1000\)\.toISOString\(\)/);
  assert.equal((source.match(/expiresAt: relayExpiresAt/g) ?? []).length, 2);
  assert.match(source, /const sourceRelayUid = 0/);
  assert.match(source, /const destinationRelayUid = numericUid/);
});

test('F10-D introduces no direct battle table write, economy mutation, secrets, or disabled test', () => {
  const changed = [
    'services/liveBattleRuntimeController.ts', 'services/liveBattleRelayService.native.ts',
    'services/liveBattleRelayContract.ts', 'hooks/live/useLiveBattleRelayRuntime.native.ts',
    'hooks/useAgoraEngine.native.ts', 'supabase/functions/agora-token/index.ts',
  ].map(read).join('\n');
  assert.doesNotMatch(changed, /\.from\(['"]live_battles['"]\).*\.(update|insert|delete)/s);
  assert.doesNotMatch(changed, /wallet|ledger|marketplace|commission/i);
  assert.doesNotMatch(changed, /console\.(log|info|error)\([^\n]*(sourceToken|destinationToken|fresh\.token)/);
  assert.doesNotMatch(read('tests/liveBattlesLb4F10DTerminalRematchRelayTokenRecovery.test.mjs'), /test\.(skip|todo)|describe\.skip/);
});
