import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20260827012913_live_battles_lb4_f3_f2_snapshot_contract.sql');
const serviceSource = await read('services/liveBattleSpectatorService.ts');

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
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

const HOST = '61000000-0000-4000-8000-000000000001';
const OPPONENT = '61000000-0000-4000-8000-000000000002';
const SESSION = '62000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '62000000-0000-4000-8000-000000000002';
const BATTLE_A = '63000000-0000-4000-8000-000000000001';
const BATTLE_B = '63000000-0000-4000-8000-000000000002';
const SERVER_NOW = '2026-08-27T01:00:00.000Z';

const row = (version, overrides = {}) => ({
  session_id: SESSION,
  battle_id: BATTLE_A,
  opponent_session_id: OTHER_SESSION,
  local_host_user_id: HOST,
  opponent_host_user_id: OPPONENT,
  local_host_agora_uid: 1758552870,
  opponent_host_agora_uid: 1758552871,
  status: 'active',
  version,
  scheduled_start_at: '2026-08-27T00:59:00.000Z',
  started_at: '2026-08-27T00:59:00.000Z',
  scheduled_end_at: '2026-08-27T01:04:00.000Z',
  ended_at: null,
  updated_at: `2026-08-27T01:00:0${Math.min(version, 9)}.000Z`,
  challenger_score: 0,
  opponent_score: 0,
  score_version: 0,
  outcome: 'pending',
  winner_user_id: null,
  score_updated_at: `2026-08-27T01:00:0${Math.min(version, 9)}.000Z`,
  projection_version: version,
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
  power_updated_at: '2026-08-27T01:00:00.000Z',
  server_clock_at: '2026-08-27T01:00:00.000Z',
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
  let subscribeCallback = null;
  let removeCalls = 0;
  const channel = {
    on(_kind, options, callback) {
      registrations.push({ options, callback });
      return channel;
    },
    subscribe(callback) {
      subscribeCallback = callback;
      return channel;
    },
  };
  const client = {
    rpc(name, args) {
      const pending = deferred();
      rpcRequests.push({ name, args, pending });
      return pending.promise;
    },
    channel() { return channel; },
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
    inspect: () => ({ registrations, rpcRequests, removeCalls }),
  };
}

function loadService(harness) {
  return loadTypeScript(serviceSource, {
    '@/template': { getSupabaseClient: () => harness.client },
  });
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('snapshot migration freezes exactly fourteen explicit public keys', () => {
  const keys = [...migration.matchAll(/^\s*'([a-z_]+)', public_state\.[a-z_]+,?$/gm)]
    .map(match => match[1]);
  assert.deepEqual(keys, [
    'session_id',
    'battle_id',
    'opponent_session_id',
    'local_host_user_id',
    'opponent_host_user_id',
    'local_host_agora_uid',
    'opponent_host_agora_uid',
    'status',
    'version',
    'scheduled_start_at',
    'started_at',
    'scheduled_end_at',
    'ended_at',
    'updated_at',
  ]);
  assert.match(migration, /create or replace function public\.get_live_battle_public_snapshot\(p_session_id uuid\)/);
  assert.match(migration, /returns jsonb\s+language sql\s+volatile\s+security invoker\s+set search_path = ''/);
  assert.doesNotMatch(migration, /to_jsonb\s*\(\s*public_state\s*\)|row_to_json|select\s+\*/i);
  assert.doesNotMatch(migration, /live_battle_events|from public\.live_battles|\b(insert|update|delete|merge|truncate)\b/i);
});

test('initial snapshot starts only after SUBSCRIBED and first visible state is current', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(SESSION, value => values.push(value));

  assert.equal(harness.inspect().rpcRequests.length, 0);
  assert.deepEqual(values, []);
  harness.emitStatus('SUBSCRIBED');
  assert.equal(harness.inspect().rpcRequests.length, 1);
  harness.resolveRpc(0, envelope(row(4)));
  await settle();
  assert.deepEqual(values.map(value => value?.version), [4]);
  await subscription.unsubscribe();
});

test('Realtime UPDATE wins over an older post-SUBSCRIBED snapshot', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(SESSION, value => values.push(value));

  harness.emitStatus('SUBSCRIBED');
  harness.emit('UPDATE', { new: row(5) });
  harness.resolveRpc(0, envelope(row(4)));
  await settle();
  assert.deepEqual(values.map(value => value?.version), [5]);
  await subscription.unsubscribe();
});

test('each re-SUBSCRIBED reconciles missed changes and channel errors preserve state', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const errors = [];
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
    error => errors.push(error.code),
  );

  harness.emitStatus('SUBSCRIBED');
  harness.resolveRpc(0, envelope(row(5)));
  await settle();
  harness.emitStatus('CHANNEL_ERROR');
  assert.equal(values.at(-1).version, 5);
  assert.deepEqual(errors, ['live_battle_public_realtime_unavailable']);

  harness.emitStatus('SUBSCRIBED');
  assert.equal(harness.inspect().rpcRequests.length, 2);
  harness.resolveRpc(1, envelope(row(6)));
  await settle();
  assert.equal(values.at(-1).version, 6);
  await subscription.unsubscribe();
});

test('null snapshots respect intervening mutations and clear only when still authoritative', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(SESSION, value => values.push(value));

  harness.emitStatus('SUBSCRIBED');
  harness.resolveRpc(0, envelope(row(5)));
  await settle();

  const staleNull = subscription.reconcile();
  harness.emit('UPDATE', { new: row(6) });
  harness.resolveRpc(1, envelope(null));
  await staleNull;
  assert.equal(values.at(-1).version, 6);

  const currentNull = subscription.reconcile();
  harness.resolveRpc(2, envelope(null));
  await currentNull;
  assert.equal(values.at(-1), null);
  await subscription.unsubscribe();
});

test('PK-only DELETE behavior and DELETE-to-new-Battle race remain closed', async () => {
  const harness = clientHarness();
  const service = loadService(harness);
  const values = [];
  const errors = [];
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
    error => errors.push(error.code),
  );
  harness.emitStatus('SUBSCRIBED');
  harness.resolveRpc(0, envelope(row(5)));
  await settle();

  const beforeForeignDelete = harness.inspect().rpcRequests.length;
  harness.emit('DELETE', { old: { session_id: OTHER_SESSION } });
  assert.equal(harness.inspect().rpcRequests.length, beforeForeignDelete);
  assert.equal(values.at(-1).version, 5);

  harness.emit('DELETE', { old: {} });
  assert.equal(values.at(-1).version, 5);
  assert.deepEqual(errors, ['live_battle_public_invalid_delete_key']);

  harness.emit('DELETE', { old: { session_id: SESSION } });
  assert.equal(harness.inspect().rpcRequests.length, beforeForeignDelete + 1);
  harness.emit('INSERT', {
    new: row(1, { battle_id: BATTLE_B, updated_at: '2026-08-27T01:01:00.000Z' }),
  });
  harness.resolveRpc(1, envelope(null));
  await settle();
  assert.equal(values.at(-1).battleId, BATTLE_B);
  await subscription.unsubscribe();
});

test('cleanup is idempotent and late subscribe or snapshot callbacks are inert', async () => {
  const neverStarted = clientHarness();
  const service = loadService(neverStarted);
  const values = [];
  const anchors = [];
  const subscription = service.subscribeToLiveBattlePublicState(
    SESSION,
    value => values.push(value),
    undefined,
    anchor => anchors.push(anchor),
  );
  await subscription.unsubscribe();
  await subscription.unsubscribe();
  neverStarted.emitStatus('SUBSCRIBED');
  await settle();
  assert.equal(neverStarted.inspect().removeCalls, 1);
  assert.equal(neverStarted.inspect().rpcRequests.length, 0);
  assert.deepEqual(values, []);
  assert.deepEqual(anchors, []);

  const pending = clientHarness();
  const pendingService = loadService(pending);
  const pendingValues = [];
  const pendingAnchors = [];
  const pendingSubscription = pendingService.subscribeToLiveBattlePublicState(
    SESSION,
    value => pendingValues.push(value),
    undefined,
    anchor => pendingAnchors.push(anchor),
  );
  pending.emitStatus('SUBSCRIBED');
  assert.equal(pending.inspect().rpcRequests.length, 1);
  await pendingSubscription.unsubscribe();
  pending.resolveRpc(0, envelope(row(4)));
  await settle();
  assert.deepEqual(pendingValues, []);
  assert.deepEqual(pendingAnchors, []);
});

test('service retains one channel and exactly three required handlers without polling', () => {
  assert.equal((serviceSource.match(/\.channel\(/g) ?? []).length, 1);
  assert.equal((serviceSource.match(/\.on\('postgres_changes'/g) ?? []).length, 3);
  assert.equal((serviceSource.match(/event: 'INSERT'/g) ?? []).length, 1);
  assert.equal((serviceSource.match(/event: 'UPDATE'/g) ?? []).length, 1);
  assert.equal((serviceSource.match(/event: 'DELETE'/g) ?? []).length, 1);
  assert.match(serviceSource, /status === 'SUBSCRIBED'[\s\S]*void reconcile\(\)/);
  assert.doesNotMatch(serviceSource, /setInterval|setTimeout|void reconcile\(\);\s*\n\s*let cleanup/);
});
