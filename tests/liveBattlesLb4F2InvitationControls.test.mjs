import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const controllerSource = await read('services/liveBattleRuntimeController.ts');
const serviceSource = await read('services/liveBattleService.ts');
const componentSource = await read('components/live/LiveBattleHostControls.tsx');
const nativeHookSource = await read('hooks/live/useLiveBattleRelayRuntime.native.ts');
const webHookSource = await read('hooks/live/useLiveBattleRelayRuntime.ts');
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');
const watchSource = await read('app/live/watch/[streamId].tsx');

function loadTypeScript(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
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
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controllerModule = loadTypeScript(controllerSource, {
  './liveBattleService': {
    getLiveBattleState: async () => { throw new Error('inject reconcile'); },
    getOpenLiveBattlesForSession: async () => { throw new Error('inject discover'); },
    isLiveBattleUuid: value => typeof value === 'string' && UUID.test(value),
    subscribeToLiveBattlesForSession: () => { throw new Error('inject subscription'); },
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
  status: 'pending',
  inviteExpiresAt: '2026-08-24T12:00:30.000Z',
  acceptedAt: null,
  countdownStartedAt: null,
  scheduledStartAt: null,
  startedAt: null,
  scheduledEndAt: null,
  endedAt: null,
  lastTransitionActorId: HOST,
  lastTransitionReason: 'invite_created',
  version: 1,
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
  ...overrides,
});

const context = overrides => ({
  liveSessionId: SESSION,
  hostUserId: HOST,
  isCanonicalHost: true,
  isSessionLive: true,
  engineReady: true,
  joined: true,
  isForeground: true,
  ...overrides,
});

function runtimeHarness(initialBattle, options = {}) {
  let current = initialBattle;
  let nowMs = options.nowMs ?? Date.parse('2026-08-24T12:00:00.000Z');
  let reconcileImplementation = options.reconcile ?? (async () => current);
  let signal = () => undefined;
  const timers = [];
  let reconcileCalls = 0;
  let activeReconciles = 0;
  let maxActiveReconciles = 0;
  let relaySnapshot = {
    state: 'idle', battleId: null, errorCode: null, relayCode: null,
  };
  const relayListeners = new Set();
  const publishRelay = next => {
    relaySnapshot = next;
    for (const listener of relayListeners) listener({ ...next });
  };
  const relay = {
    starts: [], stops: 0,
    async start(id) {
      this.starts.push(id);
      publishRelay({ state: 'running', battleId: id, errorCode: null, relayCode: 0 });
      return { ...relaySnapshot };
    },
    async stop() {
      this.stops += 1;
      publishRelay({ state: 'idle', battleId: null, errorCode: null, relayCode: null });
      return { ...relaySnapshot };
    },
    stopImmediately() {
      publishRelay({ state: 'idle', battleId: null, errorCode: null, relayCode: null });
    },
    getSnapshot: () => ({ ...relaySnapshot }),
    subscribe(listener) {
      relayListeners.add(listener);
      listener({ ...relaySnapshot });
      return () => relayListeners.delete(listener);
    },
    async dispose() { relayListeners.clear(); },
  };
  const controller = new controllerModule.LiveBattleRuntimeController({
    relay,
    now: () => nowMs,
    setTimer: (callback, delay) => {
      const timer = { delay, cleared: false, fired: false };
      timer.callback = () => {
        if (timer.cleared || timer.fired) return;
        timer.fired = true;
        callback();
      };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; },
    discover: async () => current && ['pending', 'accepted', 'countdown', 'active'].includes(current.status)
      ? [current]
      : [],
    reconcile: async () => {
      reconcileCalls += 1;
      activeReconciles += 1;
      maxActiveReconciles = Math.max(maxActiveReconciles, activeReconciles);
      try {
        return await reconcileImplementation({ call: reconcileCalls, current });
      } finally {
        activeReconciles -= 1;
      }
    },
    subscribe: (_session, onSignal) => {
      signal = onSignal;
      return { unsubscribe: async () => undefined };
    },
  });
  return {
    controller, relay, timers,
    setBattle: next => { current = next; },
    setNow: value => { nowMs = value; },
    setReconcile: implementation => { reconcileImplementation = implementation; },
    emit: value => signal(value),
    reconcileCalls: () => reconcileCalls,
    maxActiveReconciles: () => maxActiveReconciles,
    activeTimers: () => timers.filter(timer => !timer.cleared && !timer.fired),
    fireNextTimer: () => {
      const timer = timers.find(value => !value.cleared && !value.fired);
      assert.ok(timer, 'expected one active timer');
      nowMs += timer.delay;
      timer.callback();
      return timer;
    },
    settle: async () => {
      await new Promise(resolve => setImmediate(resolve));
      await controller.waitForIdle();
    },
  };
}

test('runtime exposes one observable authoritative snapshot without a second subscription', async () => {
  const harness = runtimeHarness(battle());
  const snapshots = [];
  const unsubscribe = harness.controller.subscribe(value => snapshots.push(value));
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  assert.equal(harness.controller.getSnapshot().battle?.id, BATTLE_A);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'pending');
  assert.ok(snapshots.some(value => value.battle?.id === BATTLE_A));
  unsubscribe();
  await harness.controller.dispose();
});

test('pending, countdown, and active deadlines only wake server reconciliation', async () => {
  for (const value of [
    battle(),
    battle({ status: 'countdown', scheduledStartAt: '2026-08-24T12:00:03.000Z', version: 2 }),
    battle({ status: 'active', scheduledEndAt: '2026-08-24T12:05:03.000Z', version: 3 }),
  ]) {
    const harness = runtimeHarness(value);
    harness.controller.updateContext(context());
    await harness.controller.waitForIdle();
    assert.equal(harness.timers.length, 1);
    const before = harness.reconcileCalls();
    const deadline = value.status === 'pending'
      ? value.inviteExpiresAt
      : value.status === 'countdown'
        ? value.scheduledStartAt
        : value.scheduledEndAt;
    harness.setNow(Date.parse(deadline) + 25);
    harness.timers[0].callback();
    await harness.settle();
    assert.ok(harness.reconcileCalls() > before);
    assert.equal(harness.controller.getSnapshot().battle?.status, value.status);
    await harness.controller.dispose();
  }
});

test('a clock ten minutes ahead keeps reconciling past three attempts until pending expires', async () => {
  const expired = battle({
    status: 'expired',
    version: 2,
    endedAt: '2026-08-24T12:00:30.000Z',
    lastTransitionActorId: null,
    lastTransitionReason: 'invite_expired',
  });
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
    reconcile: async ({ call, current }) => call >= 5 ? expired : current,
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  for (let index = 0; index < 4; index += 1) {
    harness.timers[index].callback();
    await harness.settle();
  }
  assert.deepEqual(harness.timers.map(timer => timer.delay), [1_000, 2_000, 4_000, 8_000]);
  assert.equal(harness.reconcileCalls(), 5);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'expired');
  assert.equal(harness.activeTimers().length, 0);
  await harness.controller.dispose();
});

test('deadline backoff grows to fifteen seconds and never permanently exhausts', async () => {
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  for (let index = 0; index < 6; index += 1) {
    harness.timers[index].callback();
    await harness.settle();
  }
  assert.deepEqual(
    harness.timers.slice(0, 7).map(timer => timer.delay),
    [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000],
  );
  assert.equal(harness.activeTimers().length, 1);
  assert.doesNotMatch(controllerSource, /setInterval|deadlineWakeAttempts\s*>=\s*3/);
  await harness.controller.dispose();
});

test('countdown and active clock skew reconcile after more than three unchanged responses', async () => {
  const countdown = battle({
    status: 'countdown', version: 2, scheduledStartAt: '2026-08-24T12:00:03.000Z',
  });
  const active = battle({
    status: 'active', version: 3, scheduledStartAt: '2026-08-24T12:00:03.000Z',
    startedAt: '2026-08-24T12:00:03.000Z', scheduledEndAt: '2026-08-24T12:05:03.000Z',
  });
  const completed = battle({
    ...active, status: 'completed', version: 4, endedAt: '2026-08-24T12:05:03.000Z',
    lastTransitionActorId: null, lastTransitionReason: 'duration_elapsed',
  });
  const countdownHarness = runtimeHarness(countdown, {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
    reconcile: async ({ call, current }) => call >= 5 ? active : current,
  });
  countdownHarness.controller.updateContext(context());
  await countdownHarness.controller.waitForIdle();
  for (let index = 0; index < 4; index += 1) {
    countdownHarness.timers[index].callback();
    await countdownHarness.settle();
  }
  assert.equal(countdownHarness.controller.getSnapshot().battle?.status, 'active');
  assert.deepEqual(countdownHarness.relay.starts, [BATTLE_A]);

  const activeHarness = runtimeHarness(active, {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
    reconcile: async ({ call, current }) => call >= 5 ? completed : current,
  });
  activeHarness.controller.updateContext(context());
  await activeHarness.controller.waitForIdle();
  for (let index = 0; index < 4; index += 1) {
    activeHarness.timers[index].callback();
    await activeHarness.settle();
  }
  assert.equal(activeHarness.controller.getSnapshot().battle?.status, 'completed');
  assert.equal(activeHarness.relay.stops, 1);
  assert.equal(activeHarness.activeTimers().length, 0);
  await countdownHarness.controller.dispose();
  await activeHarness.controller.dispose();
});

test('pending checkpoints reconcile a clock ten minutes behind within thirty seconds', async () => {
  const expired = battle({
    status: 'expired', version: 2, endedAt: '2026-08-24T12:00:30.000Z',
    lastTransitionActorId: null, lastTransitionReason: 'invite_expired',
  });
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T11:50:00.000Z'),
    reconcile: async ({ call, current }) => call >= 4 ? expired : current,
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  const checkpointDelays = [];
  for (let index = 0; index < 3; index += 1) {
    checkpointDelays.push(harness.fireNextTimer().delay);
    await harness.settle();
  }
  assert.deepEqual(checkpointDelays, [10_000, 10_000, 10_000]);
  assert.equal(harness.reconcileCalls(), 4);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'expired');
  assert.equal(harness.activeTimers().length, 0);
  assert.equal(harness.maxActiveReconciles(), 1);
  await harness.controller.dispose();
});

test('countdown checkpoints reconcile a clock ten minutes behind within three seconds', async () => {
  const countdown = battle({
    status: 'countdown', version: 2, scheduledStartAt: '2026-08-24T12:00:03.000Z',
  });
  const active = battle({
    status: 'active', version: 3, scheduledStartAt: '2026-08-24T12:00:03.000Z',
    startedAt: '2026-08-24T12:00:03.000Z', scheduledEndAt: '2026-08-24T12:05:03.000Z',
  });
  const harness = runtimeHarness(countdown, {
    nowMs: Date.parse('2026-08-24T11:50:00.000Z'),
    reconcile: async ({ call, current }) => call >= 4 ? active : current,
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  const checkpointDelays = [];
  for (let index = 0; index < 3; index += 1) {
    checkpointDelays.push(harness.fireNextTimer().delay);
    await harness.settle();
  }
  assert.deepEqual(checkpointDelays, [1_000, 1_000, 1_000]);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'active');
  assert.deepEqual(harness.relay.starts, [BATTLE_A]);
  assert.equal(harness.maxActiveReconciles(), 1);
  await harness.controller.dispose();
});

test('active checkpoints reconcile a clock ten minutes behind every thirty seconds', async () => {
  const active = battle({
    status: 'active', version: 3, scheduledStartAt: '2026-08-24T12:00:03.000Z',
    startedAt: '2026-08-24T12:00:03.000Z', scheduledEndAt: '2026-08-24T12:05:03.000Z',
  });
  const completed = battle({
    ...active, status: 'completed', version: 4, endedAt: '2026-08-24T12:05:03.000Z',
    lastTransitionActorId: null, lastTransitionReason: 'duration_elapsed',
  });
  const harness = runtimeHarness(active, {
    nowMs: Date.parse('2026-08-24T11:50:00.000Z'),
    reconcile: async ({ call, current }) => call >= 5 ? completed : current,
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  const checkpointDelays = [];
  for (let index = 0; index < 4; index += 1) {
    checkpointDelays.push(harness.fireNextTimer().delay);
    await harness.settle();
  }
  assert.deepEqual(checkpointDelays, [30_000, 30_000, 30_000, 30_000]);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'completed');
  assert.equal(harness.relay.stops, 1);
  assert.equal(harness.activeTimers().length, 0);
  assert.equal(harness.maxActiveReconciles(), 1);
  await harness.controller.dispose();
});

test('correct clocks use the nearer deadline or the state checkpoint budget', async () => {
  const near = runtimeHarness(battle({ inviteExpiresAt: '2026-08-24T12:00:05.000Z' }));
  near.controller.updateContext(context());
  await near.controller.waitForIdle();
  assert.equal(near.activeTimers()[0].delay, 5_025);

  const pending = runtimeHarness(battle());
  pending.controller.updateContext(context());
  await pending.controller.waitForIdle();
  const pendingDelays = [];
  for (let index = 0; index < 3; index += 1) {
    pendingDelays.push(pending.fireNextTimer().delay);
    await pending.settle();
  }
  assert.deepEqual(pendingDelays, [10_000, 10_000, 10_000]);
  assert.equal(pending.reconcileCalls(), 4);

  const countdown = runtimeHarness(battle({
    status: 'countdown', version: 2, scheduledStartAt: '2026-08-24T12:00:03.000Z',
  }));
  countdown.controller.updateContext(context());
  await countdown.controller.waitForIdle();
  const countdownDelays = [];
  for (let index = 0; index < 3; index += 1) {
    countdownDelays.push(countdown.fireNextTimer().delay);
    await countdown.settle();
  }
  assert.deepEqual(countdownDelays, [1_000, 1_000, 1_000]);
  assert.equal(countdown.reconcileCalls(), 4);

  const active = runtimeHarness(battle({
    status: 'active', version: 3, scheduledEndAt: '2026-08-24T12:05:00.000Z',
  }));
  active.controller.updateContext(context());
  await active.controller.waitForIdle();
  const activeDelays = [];
  for (let index = 0; index < 10; index += 1) {
    activeDelays.push(active.fireNextTimer().delay);
    await active.settle();
  }
  assert.deepEqual(activeDelays, Array.from({ length: 10 }, () => 30_000));
  assert.equal(active.reconcileCalls(), 11);

  await near.controller.dispose();
  await pending.controller.dispose();
  await countdown.controller.dispose();
  await active.controller.dispose();
});

test('background cancels checkpoints and foreground performs one immediate reconciliation', async () => {
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T11:50:00.000Z'),
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  assert.equal(harness.activeTimers()[0].delay, 10_000);

  harness.controller.updateContext(context({ isForeground: false }));
  assert.equal(harness.activeTimers().length, 0);
  const beforeForeground = harness.reconcileCalls();
  harness.controller.updateContext(context({ isForeground: true }));
  await harness.controller.waitForIdle();
  assert.equal(harness.reconcileCalls(), beforeForeground + 1);
  assert.equal(harness.activeTimers().length, 1);
  assert.equal(harness.activeTimers()[0].delay, 10_000);
  await harness.controller.dispose();
});

test('deadline reconciliation keeps one RPC in flight and recovers from a network error', async () => {
  let releaseSecond;
  const expired = battle({ status: 'expired', version: 2, endedAt: '2026-08-24T12:00:30.000Z' });
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
  });
  harness.setReconcile(({ call, current }) => {
    if (call === 2) return new Promise((_resolve, reject) => { releaseSecond = () => reject(new Error('network')); });
    if (call >= 3) return Promise.resolve(expired);
    return Promise.resolve(current);
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  harness.timers[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.maxActiveReconciles(), 1);
  const manual = harness.controller.reconcileNow();
  assert.equal(harness.maxActiveReconciles(), 1);
  releaseSecond();
  await manual;
  assert.equal(harness.maxActiveReconciles(), 1);
  assert.equal(harness.controller.getSnapshot().battle?.status, 'expired');
  assert.equal(harness.activeTimers().length, 0);
  await harness.controller.dispose();
});

test('network failure schedules controlled backoff and recovers without remounting', async () => {
  const expired = battle({ status: 'expired', version: 2, endedAt: '2026-08-24T12:00:30.000Z' });
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
    reconcile: async ({ call, current }) => {
      if (call === 2) throw new Error('temporary network failure');
      return call >= 3 ? expired : current;
    },
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  harness.timers[0].callback();
  await harness.settle();
  assert.equal(harness.controller.getSnapshot().errorCode, 'live_battle_reconcile_failed');
  assert.equal(harness.activeTimers().length, 1);
  assert.equal(harness.activeTimers()[0].delay, 2_000);
  harness.activeTimers()[0].callback();
  await harness.settle();
  assert.equal(harness.controller.getSnapshot().battle?.status, 'expired');
  assert.equal(harness.activeTimers().length, 0);
  await harness.controller.dispose();
});

test('network recovery before the apparent deadline returns to checkpoint mode', async () => {
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T11:50:00.000Z'),
    reconcile: async ({ call, current }) => {
      if (call === 2) throw new Error('temporary network failure');
      return current;
    },
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  assert.equal(harness.fireNextTimer().delay, 10_000);
  await harness.settle();
  assert.equal(harness.controller.getSnapshot().errorCode, 'live_battle_reconcile_failed');
  assert.equal(harness.activeTimers()[0].delay, 1_000);
  harness.fireNextTimer();
  await harness.settle();
  assert.equal(harness.controller.getSnapshot().battle?.status, 'pending');
  assert.equal(harness.controller.getSnapshot().errorCode, null);
  assert.equal(harness.activeTimers()[0].delay, 10_000);
  assert.equal(harness.maxActiveReconciles(), 1);
  await harness.controller.dispose();
});

test('a delayed deadline response cannot rearm after lifecycle invalidation', async () => {
  let releaseReconcile;
  const harness = runtimeHarness(battle(), {
    nowMs: Date.parse('2026-08-24T12:10:00.000Z'),
  });
  harness.setReconcile(({ call, current }) => {
    if (call === 2) {
      return new Promise(resolve => { releaseReconcile = () => resolve(current); });
    }
    return Promise.resolve(current);
  });
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  harness.timers[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  harness.controller.updateContext(context({ isForeground: false }));
  releaseReconcile();
  await harness.controller.waitForIdle();
  assert.equal(harness.activeTimers().length, 0);
  assert.equal(harness.controller.getSnapshot().status, 'idle');
  await harness.controller.dispose();
});

test('authority loss, ended LIVE, Battle replacement, and dispose cancel owned timers', async () => {
  for (const invalidContext of [
    { isCanonicalHost: false },
    { isSessionLive: false },
    { engineReady: false },
  ]) {
    const harness = runtimeHarness(battle());
    harness.controller.updateContext(context());
    await harness.controller.waitForIdle();
    assert.equal(harness.activeTimers().length, 1);
    harness.controller.updateContext(context(invalidContext));
    assert.equal(harness.activeTimers().length, 0);
    await harness.controller.dispose();
  }

  const replacement = runtimeHarness(battle());
  replacement.controller.updateContext(context());
  await replacement.controller.waitForIdle();
  const oldTimer = replacement.activeTimers()[0];
  replacement.setBattle(battle({ id: BATTLE_B, version: 1 }));
  replacement.emit({ battleId: BATTLE_B, version: 1 });
  await replacement.settle();
  assert.equal(oldTimer.cleared, true);
  assert.equal(replacement.activeTimers().length, 1);
  await replacement.controller.dispose();
  assert.equal(replacement.activeTimers().length, 0);
});

test('an obsolete deadline cannot affect a replacement Battle', async () => {
  const harness = runtimeHarness(battle());
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  const oldTimer = harness.timers[0];
  harness.setBattle(battle({ id: BATTLE_B, version: 1 }));
  harness.emit({ battleId: BATTLE_B, version: 1 });
  await harness.settle();
  const callsBeforeOldTimer = harness.reconcileCalls();
  oldTimer.callback();
  await harness.settle();
  assert.equal(harness.reconcileCalls(), callsBeforeOldTimer);
  assert.equal(harness.controller.getSnapshot().battleId, BATTLE_B);
  await harness.controller.dispose();
});

test('authoritative action results are monotonic and never start relay before countdown', async () => {
  const harness = runtimeHarness(battle());
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  await harness.controller.applyAuthoritativeBattle(battle({ status: 'accepted', version: 2 }));
  assert.equal(harness.controller.getSnapshot().battle?.status, 'accepted');
  assert.deepEqual(harness.relay.starts, []);
  await harness.controller.applyAuthoritativeBattle(battle({ status: 'countdown', version: 3, scheduledStartAt: '2026-08-24T12:00:03.000Z' }));
  assert.deepEqual(harness.relay.starts, [BATTLE_A]);
  await harness.controller.applyAuthoritativeBattle(battle({ status: 'accepted', version: 2 }));
  assert.equal(harness.controller.getSnapshot().version, 3);
  await harness.controller.dispose();
});

test('a terminal authoritative result remains visible and stops only the relay', async () => {
  const harness = runtimeHarness(battle({
    status: 'active',
    version: 3,
    startedAt: '2026-08-24T12:00:03.000Z',
    scheduledEndAt: '2026-08-24T12:05:03.000Z',
  }));
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  await harness.controller.applyAuthoritativeBattle(battle({
    status: 'cancelled',
    version: 4,
    endedAt: '2026-08-24T12:01:00.000Z',
    lastTransitionReason: 'challenger_cancelled',
  }));
  assert.equal(harness.controller.getSnapshot().battle?.status, 'cancelled');
  assert.equal(harness.relay.stops, 1);
  harness.controller.dismissTerminalBattle();
  assert.equal(harness.controller.getSnapshot().battle, null);
  assert.equal(harness.relay.stops, 1);
  await harness.controller.dispose();
});

test('selector uses existing LIVE/profile projection and excludes self and ended sessions', () => {
  assert.match(serviceSource, /from\('live_sessions'\)[\s\S]*user_profiles!live_sessions_host_id_fkey\(username, avatar_url\)/);
  assert.match(serviceSource, /\.eq\('status', 'live'\)[\s\S]*\.is\('ended_at', null\)/);
  assert.match(serviceSource, /\.neq\('id', input\.currentSessionId\)[\s\S]*\.neq\('host_id', input\.currentHostUserId\)/);
  assert.doesNotMatch(serviceSource, /auth\.users/);
  assert.doesNotMatch(componentSource, /channelName|sourceChannel|destinationChannel|agora_uid|Agora UID/);
});

test('UI action matrix is host-only and sends only canonical RPC arguments', () => {
  assert.match(broadcastSource, /sessionIsCanonicalLive && user\?\.id && streamId/);
  assert.match(broadcastSource, /enabled=\{live && sessionIsCanonicalLive && engineReady && joined && isForeground\}/);
  assert.match(componentSource, /battle\.status === 'pending' && isOpponent/);
  assert.match(componentSource, /battle\.status === 'accepted' && isChallenger/);
  assert.doesNotMatch(componentSource, /battle\.status === 'accepted' && isOpponent[\s\S]{0,250}start\(/);
  assert.match(serviceSource, /create_live_battle_invite[\s\S]*p_opponent_user_id[\s\S]*p_challenger_session_id[\s\S]*p_opponent_session_id/);
  assert.match(serviceSource, /respond_live_battle_invite[\s\S]*p_battle_id[\s\S]*p_accept/);
});

test('double taps, late completions, and failures are contained by the existing runtime hook', () => {
  assert.match(nativeHookSource, /if \(actionFlightRef\.current \|\| !actionsEnabledRef\.current\) return null/);
  assert.match(nativeHookSource, /generation !== actionGenerationRef\.current/);
  assert.match(nativeHookSource, /await controller\.reconcileNow\(\)\.catch/);
  assert.match(nativeHookSource, /setActionPending\(false\)/);
  assert.doesNotMatch(nativeHookSource, /startOrUpdateChannelMediaRelay|leaveChannel|\.release\(/);
  assert.doesNotMatch(componentSource, /\.from\('live_battles'\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(serviceSource, /\.from\('live_battles'\)[\s\S]{0,500}\.(insert|update|upsert|delete)\(/);
});

test('presentation uses server timestamps and contains no second transition timer or viewer wiring', () => {
  assert.match(componentSource, /battle\.inviteExpiresAt/);
  assert.match(componentSource, /battle\.scheduledStartAt/);
  assert.match(componentSource, /battle\.scheduledEndAt/);
  assert.doesNotMatch(componentSource, /setInterval|setTimeout/);
  assert.match(controllerSource, /this\.reconcile\(currentBattleId\)/);
  assert.match(controllerSource, /private scheduleDeadline/);
  assert.doesNotMatch(componentSource, /startOrUpdateChannelMediaRelay|requestLiveBattleRelayCredentials/);
  assert.doesNotMatch(watchSource, /LiveBattleHostControls|useLiveBattleRelayRuntime|liveBattleId/);
  assert.match(webHookSource, /supported: false as const/);
  assert.doesNotMatch(webHookSource, /requestLiveBattleRelayCredentials|startOrUpdateChannelMediaRelay/);
});
