import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20260826115337_live_battles_lb4_f3_f1_realtime_delete_clock.sql');
const serviceSource = await read('services/liveBattleSpectatorService.ts');
const hookSource = await read('hooks/live/useLiveBattleSpectatorState.ts');
const stageSource = await read('components/live/LiveBattleStage.tsx');
const watchSource = await read('app/live/watch/[streamId].tsx');
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');

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

const HOST = '10000000-0000-4000-8000-000000000001';
const OPPONENT = '10000000-0000-4000-8000-000000000002';
const SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const BATTLE_A = '30000000-0000-4000-8000-000000000001';
const BATTLE_B = '30000000-0000-4000-8000-000000000002';
const SERVER_NOW = '2026-08-26T12:00:00.000Z';

const row = (overrides = {}) => ({
  session_id: SESSION,
  battle_id: BATTLE_A,
  opponent_session_id: OTHER_SESSION,
  local_battle_side: 'challenger',
  local_host_user_id: HOST,
  opponent_host_user_id: OPPONENT,
  local_host_agora_uid: 1758552870,
  opponent_host_agora_uid: 1758552871,
  status: 'countdown',
  version: 3,
  scheduled_start_at: '2026-08-26T12:00:10.000Z',
  started_at: null,
  scheduled_end_at: null,
  ended_at: null,
  updated_at: '2026-08-26T12:00:00.000Z',
  challenger_score: 0,
  opponent_score: 0,
  score_version: 0,
  outcome: 'pending',
  winner_user_id: null,
  score_updated_at: '2026-08-26T12:00:00.000Z',
  projection_version: overrides.projection_version ?? overrides.version ?? 3,
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
  power_updated_at: '2026-08-26T12:00:00.000Z',
  server_clock_at: '2026-08-26T12:00:00.000Z',
  ...overrides,
});

const envelope = state => ({ server_now: SERVER_NOW, state });

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

function clientHarness() {
  const registrations = [];
  const rpcRequests = [];
  let removeCalls = 0;
  let channelName = null;
  let subscribeCallback = null;
  const channel = {
    on(_kind, options, callback) {
      registrations.push({ options, callback });
      return channel;
    },
    subscribe(callback) { subscribeCallback = callback; return channel; },
  };
  const client = {
    rpc(name, args) {
      const pending = deferred();
      rpcRequests.push({ name, args, pending });
      return pending.promise;
    },
    channel(name) { channelName = name; return channel; },
    async removeChannel(value) {
      assert.strictEqual(value, channel);
      removeCalls += 1;
    },
  };
  return {
    client,
    emit(event, payload) {
      const registration = registrations.find(item => item.options.event === event);
      assert.ok(registration, `missing ${event} registration`);
      registration.callback(payload);
    },
    emitStatus(status) {
      assert.ok(subscribeCallback, 'missing subscribe callback');
      subscribeCallback(status);
    },
    resolveRpc(index, data, error = null) {
      assert.ok(rpcRequests[index], `missing RPC ${index}`);
      rpcRequests[index].pending.resolve({ data, error });
    },
    inspect: () => ({ registrations, rpcRequests, removeCalls, channelName }),
  };
}

function loadService(harness) {
  return loadTypeScript(serviceSource, {
    '@/template': { getSupabaseClient: () => harness.client },
  });
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('corrective migration exposes one invoker-only, read-only, RLS-respecting snapshot RPC', () => {
  assert.match(migration, /create function public\.get_live_battle_public_snapshot\(p_session_id uuid\)/);
  assert.match(migration, /returns jsonb\s+language sql\s+volatile\s+security invoker\s+set search_path = ''/);
  assert.match(migration, /'server_now', pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /from public\.live_battle_public_states as public_state/);
  assert.match(migration, /public_state\.session_id = p_session_id/);
  assert.match(migration, /alter function public\.get_live_battle_public_snapshot\(uuid\) owner to postgres/);
  assert.match(migration, /revoke all on function public\.get_live_battle_public_snapshot\(uuid\)\s+from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.get_live_battle_public_snapshot\(uuid\)\s+to authenticated/);
  assert.doesNotMatch(migration, /security definer|live_battle_events|from public\.live_battles|\b(insert|update|delete|merge|truncate)\b/i);
  assert.doesNotMatch(migration, /token|channel|jwt|wallet|gift|ledger|score|winner/i);
});

test('snapshot envelope is strict and the clock anchor uses server time plus half RTT', () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const parsed = service.parseLiveBattlePublicSnapshotEnvelope(envelope(row()));
  assert.equal(parsed.serverNow, SERVER_NOW);
  assert.equal(parsed.state.battleId, BATTLE_A);
  assert.equal(service.parseLiveBattlePublicSnapshotEnvelope(envelope(null)).state, null);
  for (const invalid of [
    null,
    {},
    { server_now: 'invalid', state: null },
    { server_now: SERVER_NOW },
    { server_now: SERVER_NOW, state: { session_id: SESSION } },
  ]) assert.throws(() => service.parseLiveBattlePublicSnapshotEnvelope(invalid));

  const anchor = service.createLiveBattleServerClockAnchor(SERVER_NOW, 1_000, 1_100);
  assert.deepEqual(anchor, {
    serverEpochMsAtAnchor: Date.parse(SERVER_NOW) + 50,
    monotonicMsAtAnchor: 1_100,
    roundTripMs: 100,
  });
  assert.equal(service.estimateLiveBattleServerNow(anchor, 2_100), Date.parse(SERVER_NOW) + 1_050);
  assert.equal(service.estimateLiveBattleServerNow(null, 2_100), null);
});

test('device clocks at zero, plus ten, and minus ten minutes produce the same Battle time', () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const anchor = service.createLiveBattleServerClockAnchor(SERVER_NOW, 10_000, 10_100);
  const deadline = Date.parse('2026-08-26T12:00:10.050Z');
  const originalDateNow = Date.now;
  const remaining = [];
  try {
    for (const skew of [0, 600_000, -600_000]) {
      Date.now = () => Date.parse(SERVER_NOW) + skew;
      const estimated = service.estimateLiveBattleServerNow(anchor, 10_100);
      remaining.push(Math.ceil((deadline - estimated) / 1_000));
    }
  } finally {
    Date.now = originalDateNow;
  }
  assert.deepEqual(remaining, [10, 10, 10]);
  const first = service.estimateLiveBattleServerNow(anchor, 10_100);
  const second = service.estimateLiveBattleServerNow(anchor, 11_100);
  assert.equal(Math.ceil((deadline - second) / 1_000), Math.ceil((deadline - first) / 1_000) - 1);
});

test('Realtime registers filtered INSERT/UPDATE and unfiltered PK-only DELETE reconciliation', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const errors = [];
  const anchors = [];
  let monotonic = 1_000;
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
    error => errors.push(error.code),
    anchor => anchors.push(anchor),
    () => (monotonic += 50),
  );
  harness.emitStatus('SUBSCRIBED');
  assert.deepEqual(harness.inspect().registrations.map(item => item.options), [
    { event: 'INSERT', schema: 'public', table: 'live_battle_public_states', filter: `session_id=eq.${SESSION}` },
    { event: 'UPDATE', schema: 'public', table: 'live_battle_public_states', filter: `session_id=eq.${SESSION}` },
    { event: 'DELETE', schema: 'public', table: 'live_battle_public_states' },
  ]);
  harness.resolveRpc(0, envelope(row()));
  await settle();
  assert.equal(values.at(-1).battleId, BATTLE_A);
  assert.equal(anchors.length, 1);

  const beforeOtherDelete = harness.inspect().rpcRequests.length;
  harness.emit('DELETE', { old: { session_id: OTHER_SESSION } });
  assert.equal(harness.inspect().rpcRequests.length, beforeOtherDelete);
  assert.equal(errors.length, 0);
  assert.equal(values.at(-1).battleId, BATTLE_A);

  harness.emit('DELETE', { old: {} });
  assert.deepEqual(errors, ['live_battle_public_invalid_delete_key']);
  assert.equal(values.at(-1).battleId, BATTLE_A);

  harness.emit('DELETE', { old: { session_id: SESSION } });
  assert.equal(harness.inspect().rpcRequests.length, beforeOtherDelete + 1);
  harness.resolveRpc(1, envelope(null));
  await settle();
  assert.equal(values.at(-1), null);

  await subscription.unsubscribe();
});

test('DELETE reconciliation cannot clear a newer Battle and a late initial snapshot cannot regress Realtime', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  let monotonic = 5_000;
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
    undefined,
    undefined,
    () => (monotonic += 10),
  );
  harness.emitStatus('SUBSCRIBED');

  const newerA = row({ version: 5, updated_at: '2026-08-26T12:00:05.000Z' });
  harness.emit('UPDATE', { new: newerA });
  harness.resolveRpc(0, envelope(row({ version: 3 })));
  harness.resolveRpc(1, envelope(newerA));
  await settle();
  assert.equal(values.at(-1).version, 5);

  harness.emit('DELETE', { old: { session_id: SESSION } });
  const battleB = row({
    battle_id: BATTLE_B,
    version: 1,
    updated_at: '2026-08-26T12:01:00.000Z',
  });
  harness.emit('INSERT', { new: battleB });
  harness.resolveRpc(2, envelope(null));
  harness.resolveRpc(3, envelope(battleB));
  await settle();
  assert.equal(values.at(-1).battleId, BATTLE_B);

  await subscription.unsubscribe();
});

test('snapshot RPC is canonical, cleanup is idempotent, and no callback survives disposal', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(SESSION, value => values.push(value));
  harness.emitStatus('SUBSCRIBED');
  assert.deepEqual(harness.inspect().rpcRequests[0].name, 'get_live_battle_public_snapshot');
  assert.deepEqual(harness.inspect().rpcRequests[0].args, { p_session_id: SESSION });
  await subscription.unsubscribe();
  await subscription.unsubscribe();
  assert.equal(harness.inspect().removeCalls, 1);
  harness.resolveRpc(0, envelope(row()));
  await settle();
  assert.deepEqual(values, []);
});

test('stage and hook use one authoritative timer, one AppState listener, and preserve the prototype layout', () => {
  assert.equal((stageSource.match(/setInterval\(/g) ?? []).length, 1);
  assert.match(stageSource, /setInterval\([\s\S]*1_000\)/);
  assert.match(stageSource, /clearInterval\(timer\)/);
  assert.doesNotMatch(stageSource, /Date\.now\(|setInterval\([\s\S]{0,100}250/);
  assert.match(stageSource, /estimateLiveBattleServerNow\(clockAnchor, monotonicNow\)/);
  assert.match(stageSource, /secondsUntil\([\s\S]*serverNow/);
  assert.match(stageSource, /flexDirection: 'row'/);
  assert.equal((hookSource.match(/AppState\.addEventListener/g) ?? []).length, 1);
  assert.match(hookSource, /appStateSubscription\.remove\(\)/);
  assert.match(hookSource, /subscription\.reconcile\(\)/);
  assert.doesNotMatch(hookSource, /setInterval|setTimeout/);
  assert.match(watchSource, /clockAnchor=\{battleProjection\.clockAnchor\}/);
  assert.match(broadcastSource, /clockAnchor=\{battleProjection\.clockAnchor\}/);
  assert.match(stageSource, /localScore|rivalScore|GANADOR/);
  assert.doesNotMatch(stageSource + hookSource, /directed.?gift|transition.*rpc/i);
});

test('stage runtime arms one one-second timer and its unmount cleanup clears it', () => {
  const cleanups = [];
  const timers = [];
  const cleared = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = timer => { cleared.push(timer); };
  try {
    const react = {
      useState(initial) {
        return [typeof initial === 'function' ? initial() : initial, () => undefined];
      },
      useEffect(effect) { cleanups.push(effect()); },
      useMemo(factory) { return factory(); },
    };
    const stage = loadTypeScript(stageSource, {
      react,
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
        Text: 'Text', View: 'View',
        StyleSheet: { absoluteFillObject: {}, create: value => value },
      },
      '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
      '@/components/live/LiveBattleViewerHUD': { LiveBattleViewerHUD: 'LiveBattleViewerHUD' },
      '@/hooks/live/useRemoteVideoPresentationGrace': { useRemoteVideoPresentationGrace: surface => surface },
      '@/constants/theme': {
        Colors: new Proxy({}, { get: () => '#fff' }),
        FontSize: new Proxy({}, { get: () => 12 }),
        FontWeight: new Proxy({}, { get: () => '700' }),
        Radius: new Proxy({}, { get: () => 12 }),
        Spacing: new Proxy({}, { get: () => 8 }),
      },
      '@/services/liveBattleSpectatorService': {
        deriveLiveBattleLocalCompetitiveState: () => ({
          localSide: 'challenger', rivalSide: 'opponent',
          localScore: 0, rivalScore: 0,
          localRoseProgressUnits: 0, rivalRoseProgressUnits: 0,
          localRoseActivationsRemaining: 1, rivalRoseActivationsRemaining: 1,
          localGloveUsesRemaining: 1, rivalGloveUsesRemaining: 1,
          localResult: 'pending',
        }),
        deriveLiveBattlePowerVisualState: () => ({
          multiplier: 1, activeBoost: null, remainingMs: 0,
        }),
        estimateLiveBattleServerNow: () => Date.parse(SERVER_NOW),
        readLiveBattleMonotonicNow: () => 5_000,
      },
    });
    stage.LiveBattleStage({
      state: {
        status: 'active', scheduledEndAt: '2026-08-26T12:05:00.000Z', scheduledStartAt: SERVER_NOW,
      },
      clockAnchor: { serverEpochMsAtAnchor: Date.parse(SERVER_NOW), monotonicMsAtAnchor: 5_000, roundTripMs: 0 },
      localHost: { username: 'a', avatarUrl: null },
      opponentHost: { username: 'b', avatarUrl: null },
      localSurface: null,
      opponentSurface: null,
    });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 1_000);
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    assert.deepEqual(cleared, [timers[0]]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
