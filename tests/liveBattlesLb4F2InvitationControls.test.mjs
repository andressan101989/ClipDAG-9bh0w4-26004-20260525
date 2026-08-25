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

function runtimeHarness(initialBattle) {
  let current = initialBattle;
  let signal = () => undefined;
  const timers = [];
  const cleared = [];
  let reconcileCalls = 0;
  const relay = {
    starts: [], stops: 0,
    async start(id) { this.starts.push(id); },
    async stop() { this.stops += 1; },
    stopImmediately() {},
    async dispose() {},
  };
  const controller = new controllerModule.LiveBattleRuntimeController({
    relay,
    now: () => Date.parse('2026-08-24T12:00:00.000Z'),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; cleared.push(timer); },
    discover: async () => current && ['pending', 'accepted', 'countdown', 'active'].includes(current.status)
      ? [current]
      : [],
    reconcile: async () => { reconcileCalls += 1; return current; },
    subscribe: (_session, onSignal) => {
      signal = onSignal;
      return { unsubscribe: async () => undefined };
    },
  });
  return {
    controller, relay, timers, cleared,
    setBattle: next => { current = next; },
    emit: value => signal(value),
    reconcileCalls: () => reconcileCalls,
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
    harness.timers[0].callback();
    await harness.settle();
    assert.ok(harness.reconcileCalls() > before);
    assert.equal(harness.controller.getSnapshot().battle?.status, value.status);
    await harness.controller.dispose();
  }
});

test('early device-clock deadline wakeups retry only within a strict bound', async () => {
  const harness = runtimeHarness(battle());
  harness.controller.updateContext(context());
  await harness.controller.waitForIdle();
  for (let index = 0; index < 3; index += 1) {
    harness.timers[index].callback();
    await harness.settle();
  }
  assert.equal(harness.timers.length, 3);
  assert.equal(harness.reconcileCalls(), 4);
  await harness.controller.dispose();
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
