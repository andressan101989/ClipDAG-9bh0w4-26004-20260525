import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const controllerSource = await read('services/liveBattleRuntimeController.ts');
const battleServiceSource = await read('services/liveBattleService.ts');
const relaySource = await read('services/liveBattleRelayService.native.ts');
const runtimeHookSource = await read('hooks/live/useLiveBattleRelayRuntime.native.ts');
const runtimeWebSource = await read('hooks/live/useLiveBattleRelayRuntime.ts');
const agoraHookSource = await read('hooks/useAgoraEngine.native.ts');
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');
const watchSource = await read('app/live/watch/[streamId].tsx');

function loadTypeScript(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const diagnostics = (compiled.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(diagnostics, []);
  const module = { exports: {} };
  const require = name => {
    if (name in imports) return imports[name];
    throw new Error(`unexpected import: ${name}`);
  };
  Function('require', 'module', 'exports', compiled.outputText)(
    require, module, module.exports,
  );
  return module.exports;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controllerModule = loadTypeScript(controllerSource, {
  './liveBattleService': {
    getLiveBattleState: async () => { throw new Error('dependency not injected'); },
    getOpenLiveBattlesForSession: async () => { throw new Error('dependency not injected'); },
    isLiveBattleUuid: value => typeof value === 'string' && UUID.test(value),
    subscribeToLiveBattlesForSession: () => { throw new Error('dependency not injected'); },
  },
});

const HOST = '10000000-0000-4000-8000-000000000001';
const OPPONENT = '10000000-0000-4000-8000-000000000002';
const SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const BATTLE_A = '30000000-0000-4000-8000-000000000001';
const BATTLE_B = '30000000-0000-4000-8000-000000000002';

const battle = (overrides = {}) => ({
  id: BATTLE_A,
  challengerUserId: HOST,
  opponentUserId: OPPONENT,
  challengerSessionId: SESSION,
  opponentSessionId: OTHER_SESSION,
  status: 'countdown',
  inviteExpiresAt: '2026-08-24T12:00:30.000Z',
  acceptedAt: '2026-08-24T12:00:00.000Z',
  countdownStartedAt: '2026-08-24T12:00:00.000Z',
  scheduledStartAt: '2026-08-24T12:00:03.000Z',
  startedAt: null,
  scheduledEndAt: '2026-08-24T12:05:03.000Z',
  endedAt: null,
  lastTransitionActorId: HOST,
  lastTransitionReason: 'challenger_started',
  version: 1,
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
  ...overrides,
});

const eligibleContext = overrides => ({
  liveSessionId: SESSION,
  hostUserId: HOST,
  isCanonicalHost: true,
  isSessionLive: true,
  engineReady: true,
  joined: true,
  isForeground: true,
  ...overrides,
});

function createHarness(initialBattles, relayOverrides = {}) {
  let battles = initialBattles;
  let signal = () => undefined;
  let subscriptionError = () => undefined;
  let unsubscribeCalls = 0;
  let discoverCalls = 0;
  let reconcileCalls = 0;
  const relay = {
    startCalls: [],
    stopCalls: 0,
    immediateStopCalls: 0,
    disposeCalls: 0,
    async start(battleId) {
      this.startCalls.push(battleId);
      if (relayOverrides.start) return relayOverrides.start(battleId);
      return {};
    },
    async stop() {
      this.stopCalls += 1;
      if (relayOverrides.stop) return relayOverrides.stop();
      return {};
    },
    stopImmediately() {
      this.immediateStopCalls += 1;
      relayOverrides.stopImmediately?.();
    },
    async dispose() { this.disposeCalls += 1; },
  };
  const controller = new controllerModule.LiveBattleRuntimeController({
    relay,
    discover: async sessionId => {
      discoverCalls += 1;
      assert.equal(sessionId, SESSION);
      return battles;
    },
    reconcile: async battleId => {
      reconcileCalls += 1;
      const found = battles.find(item => item.id === battleId);
      if (!found) throw new Error('not found');
      return found;
    },
    subscribe: (sessionId, onSignal, onError) => {
      assert.equal(sessionId, SESSION);
      signal = onSignal;
      subscriptionError = onError;
      return { unsubscribe: async () => { unsubscribeCalls += 1; } };
    },
  });
  return {
    controller,
    relay,
    activate: async context => {
      controller.updateContext(eligibleContext(context));
      await controller.waitForIdle();
    },
    settle: async () => {
      await new Promise(resolve => setImmediate(resolve));
      await controller.waitForIdle();
    },
    setBattles: value => { battles = value; },
    emit: value => signal(value),
    failSubscription: () => subscriptionError(),
    stats: () => ({ unsubscribeCalls, discoverCalls, reconcileCalls }),
  };
}

test('pending and accepted Battles never start relay', async () => {
  for (const status of ['pending', 'accepted']) {
    const harness = createHarness([battle({ status })]);
    await harness.activate();
    assert.deepEqual(harness.relay.startCalls, []);
    assert.equal(harness.relay.stopCalls, 0);
    await harness.controller.dispose();
  }
});

test('countdown starts once and an active update keeps the same relay', async () => {
  const harness = createHarness([battle()]);
  await harness.activate();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  harness.setBattles([battle({ status: 'active', version: 2, startedAt: '2026-08-24T12:00:03.000Z' })]);
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  assert.equal(harness.controller.getSnapshot().status, 'relaying');
  await harness.controller.dispose();
});

test('viewer and cohost contexts perform no discovery, token request, or relay start', async () => {
  for (const context of [
    { isCanonicalHost: false },
    { isCanonicalHost: false, hostUserId: OPPONENT },
  ]) {
    const harness = createHarness([battle()]);
    await harness.activate(context);
    assert.equal(harness.stats().discoverCalls, 0);
    assert.deepEqual(harness.relay.startCalls, []);
    await harness.controller.dispose();
  }
});

test('terminal transition and ended LIVE stop relay exactly once', async () => {
  const terminal = createHarness([battle()]);
  await terminal.activate();
  terminal.setBattles([]);
  terminal.emit({ battleId: BATTLE_A, version: 2 });
  await terminal.settle();
  terminal.emit({ battleId: BATTLE_A, version: 2 });
  await terminal.settle();
  assert.equal(terminal.relay.stopCalls, 1);

  const ended = createHarness([battle()]);
  await ended.activate();
  ended.controller.updateContext(eligibleContext({ isSessionLive: false }));
  await ended.settle();
  assert.equal(ended.relay.stopCalls, 1);

  const hostChanged = createHarness([battle()]);
  await hostChanged.activate();
  hostChanged.controller.updateContext(eligibleContext({ isCanonicalHost: false }));
  await hostChanged.settle();
  assert.equal(hostChanged.relay.stopCalls, 1);
  await terminal.controller.dispose();
  await ended.controller.dispose();
  await hostChanged.controller.dispose();
});

test('background stops relay and foreground performs a fresh authoritative reconciliation', async () => {
  const harness = createHarness([battle()]);
  await harness.activate();
  harness.controller.updateContext(eligibleContext({ isForeground: false }));
  await harness.settle();
  assert.equal(harness.relay.stopCalls, 1);
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);

  harness.controller.updateContext(eligibleContext({ isForeground: true }));
  await harness.controller.waitForIdle();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A, BATTLE_A]);
  assert.ok(harness.stats().discoverCalls >= 2);
  await harness.controller.dispose();
});

test('Battle switch stops the old relay before starting the new one', async () => {
  const order = [];
  const harness = createHarness([battle()], {
    start: async id => { order.push(`start:${id}`); },
    stop: async () => { order.push('stop'); },
  });
  await harness.activate();
  const next = battle({ id: BATTLE_B, version: 1 });
  harness.setBattles([next]);
  harness.emit({ battleId: BATTLE_B, version: 1 });
  await harness.settle();
  assert.deepEqual(order, [`start:${BATTLE_A}`, 'stop', `start:${BATTLE_B}`]);
  await harness.controller.dispose();
});

test('duplicate, stale, and out-of-order Realtime events cannot duplicate or revive relay', async () => {
  const harness = createHarness([battle({ version: 4 })]);
  await harness.activate();
  const before = harness.stats().discoverCalls;
  for (const version of [4, 3, 2]) harness.emit({ battleId: BATTLE_A, version });
  await harness.settle();
  assert.equal(harness.stats().discoverCalls, before);
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  await harness.controller.stop();
  harness.emit({ battleId: BATTLE_A, version: 5 });
  await harness.settle();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  await harness.controller.dispose();
});

test('a delayed reconciliation after stop cannot revive relay', async () => {
  let resolveDiscovery;
  const relay = {
    starts: 0,
    async start() { this.starts += 1; },
    async stop() {},
    stopImmediately() {},
    async dispose() {},
  };
  const controller = new controllerModule.LiveBattleRuntimeController({
    relay,
    discover: () => new Promise(resolve => { resolveDiscovery = resolve; }),
    reconcile: async value => value,
    subscribe: () => ({ unsubscribe: async () => undefined }),
  });
  controller.updateContext(eligibleContext());
  await new Promise(resolve => setImmediate(resolve));
  const stopped = controller.stop();
  resolveDiscovery([battle()]);
  await stopped;
  await controller.waitForIdle();
  assert.equal(relay.starts, 0);
  await controller.dispose();
});

test('a delayed relay authorization promise cannot revive a stopped runtime', async () => {
  let resolveStart;
  let starts = 0;
  let stops = 0;
  const relay = {
    start: () => {
      starts += 1;
      return new Promise(resolve => { resolveStart = resolve; });
    },
    stop: async () => { stops += 1; },
    stopImmediately() {},
    async dispose() {},
  };
  const controller = new controllerModule.LiveBattleRuntimeController({
    relay,
    discover: async () => [battle()],
    reconcile: async () => battle(),
    subscribe: () => ({ unsubscribe: async () => undefined }),
  });
  controller.updateContext(eligibleContext());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  const stopped = controller.stop();
  resolveStart({});
  await stopped;
  await controller.waitForIdle();
  assert.equal(stops, 1);
  assert.notEqual(controller.getSnapshot().status, 'relaying');
  await controller.dispose();
});

test('token or Agora failure is isolated from the LIVE lifecycle', async () => {
  for (const failure of [new Error('token unavailable'), new Error('Agora -17')]) {
    let liveLeaveCalls = 0;
    const harness = createHarness([battle()], { start: async () => { throw failure; } });
    await harness.activate();
    assert.equal(harness.controller.getSnapshot().status, 'failed');
    assert.equal(liveLeaveCalls, 0);
    assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
    await harness.controller.dispose();
  }
});

test('multiple non-terminal Battles and Realtime failure fail closed', async () => {
  const multiple = createHarness([battle(), battle({ id: BATTLE_B })]);
  await multiple.activate();
  assert.equal(multiple.controller.getSnapshot().errorCode, 'live_battle_multiple_open');
  assert.deepEqual(multiple.relay.startCalls, []);

  const realtime = createHarness([battle()]);
  await realtime.activate();
  realtime.failSubscription();
  await realtime.settle();
  assert.equal(realtime.controller.getSnapshot().errorCode, 'live_battle_realtime_unavailable');
  assert.equal(realtime.relay.stopCalls, 1);
  await multiple.controller.dispose();
  await realtime.controller.dispose();
});

test('engine release and dispose synchronously invalidate relay and clean only owned resources', async () => {
  const harness = createHarness([battle()]);
  await harness.activate();
  harness.controller.handleEngineRelease();
  assert.equal(harness.relay.immediateStopCalls, 1);
  harness.emit({ battleId: BATTLE_A, version: 2 });
  await harness.settle();
  assert.deepEqual(harness.relay.startCalls, [BATTLE_A]);
  await harness.controller.dispose();
  await harness.controller.dispose();
  assert.equal(harness.relay.disposeCalls, 1);
  assert.equal(harness.stats().unsubscribeCalls, 1);
});

test('LB4-F1 wiring is host-only, filtered, canonical, and contains no direct Battle writes', () => {
  assert.match(battleServiceSource, /\.or\(`challenger_session_id\.eq\.\$\{sessionId\},opponent_session_id\.eq\.\$\{sessionId\}`\)/);
  assert.match(battleServiceSource, /filter: `\$\{column\}=eq\.\$\{sessionId\}`/);
  assert.match(controllerSource, /await this\.reconcile\(candidates\[0\]\.id\)/);
  assert.match(controllerSource, /candidates\.length > 1/);
  assert.doesNotMatch(battleServiceSource, /\.from\('live_battles'\)[\s\S]{0,400}\.(?:insert|update|upsert|delete)\(/);
  assert.match(broadcastSource, /isCanonicalHost: sessionIsCanonicalLive/);
  assert.match(broadcastSource, /hostUserId: user\?\.id \?\? null/);
  assert.match(broadcastSource, /setIsForeground\(nextState === 'active'\)/);
  assert.doesNotMatch(broadcastSource, /sourceChannel|destinationChannel|battleRelay\.source|battleRelay\.destination/);
  assert.doesNotMatch(watchSource, /useLiveBattleRelayRuntime|requestLiveBattleRelayCredentials|liveBattleId/);
});

test('engine owner invokes the relay guard before leave/release and runtime never creates another engine', () => {
  assert.match(agoraHookSource, /for \(const listener of beforeReleaseListenersRef\.current\)[\s\S]*listener\(engine\)[\s\S]*engine\.leaveChannel\(\)[\s\S]*engine\.release\(\)/);
  assert.match(runtimeHookSource, /const engine = joined \? getEngine\(\)/);
  assert.match(runtimeHookSource, /new LiveBattleRelayService\(engine\)/);
  assert.doesNotMatch(runtimeHookSource, /createAgoraRtcEngine|leaveChannel|\.release\(/);
  assert.match(relaySource, /stopImmediately\(\): void[\s\S]*stopChannelMediaRelay\(\)/);
  assert.match(broadcastSource, /await stopBattleRuntime\(\);[\s\S]*await leave\(\)/);
});

test('web remains explicitly unsupported without token requests or retry loops', () => {
  assert.match(runtimeWebSource, /supported: false as const/);
  assert.doesNotMatch(runtimeWebSource, /LiveBattleRelayService|requestLiveBattleRelayCredentials|setInterval|setTimeout/);
});
