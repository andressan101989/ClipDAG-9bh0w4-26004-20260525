import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const edge = await read('supabase/functions/agora-token/index.ts');
const authorizationSource = await read(
  'supabase/functions/agora-token/battleRelayAuthorization.ts',
);
const contractSource = await read('services/liveBattleRelayContract.ts');
const nativeSource = await read('services/liveBattleRelayService.native.ts');
const webSource = await read('services/liveBattleRelayService.ts');

function loadTypeScript(source, imports = {}, runtime = {}) {
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
  Function(
    'require', 'module', 'exports', 'Deno', 'fetch', 'crypto', 'TextEncoder', 'btoa',
    compiled.outputText,
  )(
    require,
    module,
    module.exports,
    runtime.Deno,
    runtime.fetch ?? globalThis.fetch,
    runtime.crypto ?? globalThis.crypto,
    runtime.TextEncoder ?? globalThis.TextEncoder,
    runtime.btoa ?? globalThis.btoa,
  );
  return module.exports;
}

const authorization = loadTypeScript(authorizationSource);

const CHALLENGER = '10000000-0000-4000-8000-000000000001';
const OPPONENT = '10000000-0000-4000-8000-000000000002';
const THIRD = '10000000-0000-4000-8000-000000000003';
const BATTLE_A = '20000000-0000-4000-8000-000000000001';
const BATTLE_B = '20000000-0000-4000-8000-000000000002';
const SESSION_A = '30000000-0000-4000-8000-000000000001';
const SESSION_B = '30000000-0000-4000-8000-000000000002';

const battle = (overrides = {}) => ({
  id: BATTLE_A,
  challenger_user_id: CHALLENGER,
  opponent_user_id: OPPONENT,
  challenger_session_id: SESSION_A,
  opponent_session_id: SESSION_B,
  status: 'countdown',
  ended_at: null,
  ...overrides,
});
const sessions = (overrides = {}) => [
  { id: SESSION_A, host_id: CHALLENGER, status: 'live', ended_at: null, ...overrides.challenger },
  { id: SESSION_B, host_id: OPPONENT, status: 'live', ended_at: null, ...overrides.opponent },
];

test('LB3 contains no migration, schema, finance, screen, or Battle scoring change', async () => {
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260824034049_live_battles_lb2_f1_session_liveness.sql');
  assert.deepEqual(migrations, []);
  const combined = `${authorizationSource}\n${contractSource}\n${nativeSource}\n${webSource}`;
  assert.doesNotMatch(combined, /create table|alter table|create policy|grant execute|security definer/i);
  assert.doesNotMatch(combined, /send_live_gift|atomic_ledger_transfer|ledger_entries|wallet|financial_transactions|marketplace|live_commerce/i);
  assert.doesNotMatch(combined, /\b(score|winner|loser|battle_gift)\b/i);
  for (const screen of ['app/live/broadcast/[streamId].tsx', 'app/live/watch/[streamId].tsx']) {
    assert.doesNotMatch(await read(screen), /liveBattleRelayService|liveBattleId/);
  }
});

test('Edge contract is exclusive and derives authority through the user JWT', () => {
  assert.match(edge, /\| \{ kind: 'battle_relay'; liveBattleId: string \}/);
  assert.match(edge, /Number\(hasLiveBattleId\)/);
  assert.match(edge, /Object\.keys\(body\)\.every\(key => key === 'liveBattleId'\)/);
  assert.match(edge, /global: \{ headers: \{ Authorization: authHeader \?\? '' \} \}/);
  assert.match(edge, /userScoped\.rpc\([\s\S]*'get_live_battle_state'[\s\S]*p_battle_id: contract\.liveBattleId/);
  assert.match(edge, /\.from\('live_sessions'\)[\s\S]*\.select\('id, host_id, status, ended_at'\)/);
  assert.match(edge, /authorizeBattleRelay\(user\.id, battle, sessions \?\? \[\]\)/);
  assert.doesNotMatch(edge, /service_role[^\n]*(battleRelay|liveBattleId)/i);
  assert.doesNotMatch(edge, /console\.(?:log|info|error)\([^\n]*(?:sourceToken|destinationToken|liveBattleId|sessionIds|numericUid)/);
});

test('server authorization permits only participant-directed countdown or active relays', () => {
  const challenger = authorization.authorizeBattleRelay(CHALLENGER, battle(), sessions());
  assert.deepEqual(challenger, {
    battleId: BATTLE_A,
    participant: 'challenger',
    sourceSessionId: SESSION_A,
    destinationSessionId: SESSION_B,
  });
  const opponent = authorization.authorizeBattleRelay(
    OPPONENT,
    battle({ status: 'active' }),
    sessions(),
  );
  assert.deepEqual(opponent, {
    battleId: BATTLE_A,
    participant: 'opponent',
    sourceSessionId: SESSION_B,
    destinationSessionId: SESSION_A,
  });

  for (const status of ['pending', 'accepted', 'rejected', 'cancelled', 'expired', 'completed']) {
    assert.throws(
      () => authorization.authorizeBattleRelay(CHALLENGER, battle({ status }), sessions()),
      error => error.code === 'battle_relay_not_authorized' && error.status === 409,
    );
  }
  assert.throws(
    () => authorization.authorizeBattleRelay(THIRD, battle(), sessions()),
    error => error.code === 'battle_relay_not_found' && error.status === 404,
  );
});

test('server authorization rejects every session authority failure', () => {
  const denied = [
    [battle({ ended_at: '2026-08-24T00:00:00Z' }), sessions()],
    [battle({ opponent_session_id: SESSION_A }), sessions()],
    [battle(), sessions().slice(0, 1)],
    [battle(), sessions({ challenger: { host_id: THIRD } })],
    [battle(), sessions({ opponent: { host_id: THIRD } })],
    [battle(), sessions({ challenger: { status: 'ended' } })],
    [battle(), sessions({ opponent: { status: 'ended' } })],
    [battle(), sessions({ challenger: { ended_at: '2026-08-24T00:00:00Z' } })],
    [battle(), sessions({ opponent: { ended_at: '2026-08-24T00:00:00Z' } })],
  ];
  for (const [candidate, candidateSessions] of denied) {
    assert.throws(
      () => authorization.authorizeBattleRelay(CHALLENGER, candidate, candidateSessions),
      error => error.code === 'battle_relay_not_authorized',
    );
  }
});

test('Edge mints two publisher tokens bound to distinct server-derived channels and canonical UID', () => {
  assert.match(edge, /const numericUid = userIdToAgoraUid\(user\.id\)/);
  assert.match(edge, /channelName: authorization\.sourceSessionId,[\s\S]*uid: numericUid,[\s\S]*isPublisher: true/);
  assert.match(edge, /channelName: authorization\.destinationSessionId,[\s\S]*uid: numericUid,[\s\S]*isPublisher: true/);
  assert.match(edge, /source:[\s\S]*channel: authorization\.sourceSessionId[\s\S]*token: sourceToken/);
  assert.match(edge, /destination:[\s\S]*channel: authorization\.destinationSessionId[\s\S]*token: destinationToken/);
  assert.match(edge, /expiresIn: TOKEN_EXPIRE_SEC/);
  assert.doesNotMatch(edge, /channelName:\s*(?:body|contract)\.(?:sourceChannel|destinationChannel)/);
});

test('legacy call, group, LIVE, and channelName contracts remain present', () => {
  for (const marker of [
    "kind: 'new_call'", "kind: 'new_group'", "kind: 'live'", "kind: 'legacy_call'",
    ".eq('channel_name', contract.channelName)", ".eq('id', contract.groupRoomId)",
    ".eq('id', contract.liveSessionId)", "contract.requestedRole === 'viewer'",
    "participant.role !== 'cohost'", "participant.status !== 'active'",
  ]) assert.ok(edge.includes(marker), marker);
  assert.match(edge, /JSON\.stringify\(\{ token, appId: AGORA_APP_ID, channel: authorizedChannel, uid: numericUid \}\)/);
});

class MockQuery {
  filters = [];

  constructor(rows) {
    this.rows = rows;
  }

  select() { return this; }
  eq(column, value) { this.filters.push(row => row[column] === value); return this; }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this; }
  matching() { return this.filters.reduce((rows, filter) => rows.filter(filter), this.rows); }
  maybeSingle() { return Promise.resolve({ data: this.matching()[0] ?? null, error: null }); }
  returns() { return Promise.resolve({ data: this.matching(), error: null }); }
}

function loadEdgeHarness({ actor = CHALLENGER, rpcData = battle(), rpcError = null, tables = {} } = {}) {
  let handler;
  const rpcCalls = [];
  const clients = [];
  const tableRows = {
    live_sessions: sessions(),
    calls: [],
    group_call_rooms: [],
    live_participants: [],
    ...tables,
  };
  const createClient = (url, key, options = {}) => {
    const client = {
      url,
      key,
      options,
      rpc: async (name, parameters) => {
        rpcCalls.push({ name, parameters, authorization: options.global?.headers?.Authorization });
        return { data: rpcData, error: rpcError };
      },
      from: table => new MockQuery(tableRows[table] ?? []),
    };
    clients.push(client);
    return client;
  };
  loadTypeScript(edge, {
    'https://deno.land/std@0.168.0/http/server.ts': { serve: callback => { handler = callback; } },
    'https://esm.sh/@supabase/supabase-js@2': { createClient },
    '../_shared/cors.ts': { corsHeaders: {} },
    './battleRelayAuthorization.ts': authorization,
  }, {
    Deno: { env: { get: name => ({
      AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
      AGORA_APP_CERTIFICATE: 'certificate-secret',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    })[name] ?? '' } },
    fetch: async (_url, options) => {
      const valid = options?.headers?.Authorization === 'Bearer valid-jwt';
      return { ok: valid, json: async () => valid ? { id: actor } : {} };
    },
  });
  assert.equal(typeof handler, 'function');
  return { handler, rpcCalls, clients };
}

async function invokeEdge(harness, body, authorization = 'Bearer valid-jwt') {
  const response = await harness.handler(new Request('https://example.test/agora-token', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization, 'Content-Type': 'application/json' } : {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

function crc32(value) {
  const bytes = new TextEncoder().encode(value);
  let crc = 0xFFFF_FFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFF_FFFF) >>> 0;
}

function tokenChannelCrc(token) {
  const content = Buffer.from(token.slice(35), 'base64');
  return content.readUInt32LE(34);
}

test('Edge handler denies missing/invalid JWT, hidden Battles, third parties, and mixed authority', async () => {
  assert.equal((await invokeEdge(loadEdgeHarness(), { liveBattleId: BATTLE_A }, null)).status, 401);
  assert.equal((await invokeEdge(loadEdgeHarness(), { liveBattleId: BATTLE_A }, 'Bearer invalid')).status, 401);
  for (const message of ['live_battle_not_found', 'live_battle_forbidden']) {
    const result = await invokeEdge(loadEdgeHarness({ rpcError: { message } }), { liveBattleId: BATTLE_A });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'battle relay not found' });
  }
  for (const extra of [
    { uid: 7 }, { channelName: SESSION_A }, { sourceChannel: SESSION_A },
    { destinationChannel: SESSION_B }, { role: 'publisher' }, { requestedRole: 'host' },
    { callId: BATTLE_B }, { groupRoomId: BATTLE_B }, { liveSessionId: SESSION_A },
  ]) {
    const harness = loadEdgeHarness();
    const result = await invokeEdge(harness, { liveBattleId: BATTLE_A, ...extra });
    assert.equal(result.status, 400);
    assert.equal(harness.rpcCalls.length, 0);
  }
});

test('Edge handler authorizes countdown/active directions and channel-bound publisher tokens', async () => {
  for (const [actor, status, expectedSource, expectedDestination] of [
    [CHALLENGER, 'countdown', SESSION_A, SESSION_B],
    [OPPONENT, 'active', SESSION_B, SESSION_A],
  ]) {
    const harness = loadEdgeHarness({ actor, rpcData: battle({ status }) });
    const result = await invokeEdge(harness, { liveBattleId: BATTLE_A });
    assert.equal(result.status, 200);
    assert.equal(harness.rpcCalls.length, 1);
    assert.deepEqual(harness.rpcCalls[0], {
      name: 'get_live_battle_state',
      parameters: { p_battle_id: BATTLE_A },
      authorization: 'Bearer valid-jwt',
    });
    const relay = result.body.battleRelay;
    assert.equal(relay.source.channel, expectedSource);
    assert.equal(relay.destination.channel, expectedDestination);
    assert.equal(relay.source.uid, relay.destination.uid);
    assert.equal(tokenChannelCrc(relay.source.token), crc32(expectedSource));
    assert.equal(tokenChannelCrc(relay.destination.token), crc32(expectedDestination));
    assert.notEqual(tokenChannelCrc(relay.source.token), crc32('arbitrary-channel'));
    assert.notEqual(tokenChannelCrc(relay.destination.token), crc32('arbitrary-channel'));
  }
});

test('Edge handler denies every stale Battle/session state after canonical reconciliation', async () => {
  for (const status of ['pending', 'accepted', 'rejected', 'cancelled', 'expired', 'completed']) {
    const result = await invokeEdge(
      loadEdgeHarness({ rpcData: battle({ status, ended_at: status === 'completed' ? '2026-08-24T00:00:00Z' : null }) }),
      { liveBattleId: BATTLE_A },
    );
    assert.equal(result.status, 409, status);
  }
  for (const tableSessions of [
    sessions().slice(0, 1),
    sessions({ challenger: { host_id: THIRD } }),
    sessions({ opponent: { status: 'ended' } }),
    sessions({ challenger: { ended_at: '2026-08-24T00:00:00Z' } }),
  ]) {
    const result = await invokeEdge(
      loadEdgeHarness({ tables: { live_sessions: tableSessions } }),
      { liveBattleId: BATTLE_A },
    );
    assert.equal(result.status, 409);
  }
  const sameSession = await invokeEdge(loadEdgeHarness({
    rpcData: battle({ opponent_session_id: SESSION_A }),
    tables: { live_sessions: sessions().slice(0, 1) },
  }), { liveBattleId: BATTLE_A });
  assert.equal(sameSession.status, 409);
});

test('existing runtime contracts cannot obtain Battle credentials', async () => {
  const call = {
    id: BATTLE_B,
    caller_id: CHALLENGER,
    callee_id: OPPONENT,
    channel_name: 'call-channel',
    status: 'accepted',
    expires_at: null,
  };
  const hostLive = { id: SESSION_A, host_id: CHALLENGER, status: 'live', ended_at: null };
  const cases = [
    [{ callId: BATTLE_B }, { calls: [call] }],
    [{ channelName: 'call-channel' }, { calls: [call] }],
    [{ groupRoomId: BATTLE_B }, { group_call_rooms: [{ id: BATTLE_B, status: 'active' }] }],
    [{ liveSessionId: SESSION_A, requestedRole: 'host' }, { live_sessions: [hostLive] }],
    [{ liveSessionId: SESSION_A, requestedRole: 'viewer' }, { live_sessions: [hostLive] }],
    [{ liveSessionId: SESSION_A, requestedRole: 'cohost' }, {
      live_sessions: [hostLive],
      live_participants: [{ session_id: SESSION_A, user_id: CHALLENGER, role: 'cohost', status: 'active' }],
    }],
  ];
  for (const [body, tables] of cases) {
    const result = await invokeEdge(loadEdgeHarness({ tables }), body);
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(typeof result.body.token, 'string');
    assert.equal('battleRelay' in result.body, false);
  }
});

function credentialFixture(battleId, source = SESSION_A, destination = SESSION_B) {
  return {
    appId: '0123456789abcdef0123456789abcdef',
    battleRelay: {
      battleId,
      source: { liveSessionId: source, channel: source, uid: 1758552870, token: `source-${battleId}` },
      destination: { liveSessionId: destination, channel: destination, uid: 1758552870, token: `dest-${battleId}` },
      expiresIn: 3600,
    },
  };
}

function loadClientModules(invoke = async () => ({ data: null, error: null })) {
  const contract = loadTypeScript(contractSource, {
    '@/template': { getSupabaseClient: () => ({ functions: { invoke } }) },
  });
  const relayStates = {
    RelayStateIdle: 0,
    RelayStateConnecting: 1,
    RelayStateRunning: 2,
    RelayStateFailure: 3,
  };
  const native = loadTypeScript(nativeSource, {
    'react-native-agora': { ChannelMediaRelayState: relayStates },
    './liveBattleRelayContract': contract,
  });
  return { contract, native, relayStates };
}

test('client requests only liveBattleId and validates the complete credential contract', async () => {
  const bodies = [];
  const fixture = credentialFixture(BATTLE_A);
  const { contract } = loadClientModules(async (slug, options) => {
    bodies.push({ slug, body: options.body });
    return { data: fixture, error: null };
  });
  assert.deepEqual(await contract.requestLiveBattleRelayCredentials(BATTLE_A), fixture);
  assert.deepEqual(bodies, [{ slug: 'agora-token', body: { liveBattleId: BATTLE_A } }]);
  for (const invalid of [
    { ...fixture, battleRelay: { ...fixture.battleRelay, battleId: BATTLE_B } },
    { ...fixture, battleRelay: { ...fixture.battleRelay, expiresIn: 1 } },
    { ...fixture, battleRelay: { ...fixture.battleRelay, destination: fixture.battleRelay.source } },
    { ...fixture, battleRelay: { ...fixture.battleRelay, destination: { ...fixture.battleRelay.destination, uid: 7 } } },
  ]) {
    assert.throws(
      () => contract.parseLiveBattleRelayCredentials(invalid, BATTLE_A),
      error => error.code === 'battle_relay_invalid_response',
    );
  }
});

class MockEngine {
  handlers = new Set();
  registered = [];
  unregistered = [];
  configurations = [];
  stopCount = 0;
  nextStartResult = 0;
  nextStopResult = 0;

  registerEventHandler(handler) {
    this.registered.push(handler);
    this.handlers.add(handler);
    return true;
  }

  unregisterEventHandler(handler) {
    this.unregistered.push(handler);
    this.handlers.delete(handler);
    return true;
  }

  startOrUpdateChannelMediaRelay(configuration) {
    this.configurations.push(configuration);
    return this.nextStartResult;
  }

  stopChannelMediaRelay() {
    this.stopCount += 1;
    return this.nextStopResult;
  }

  emit(state, code = 0) {
    for (const handler of [...this.handlers]) handler.onChannelMediaRelayStateChanged?.(state, code);
  }
}

test('native service builds the 4.6.2 relay configuration and start is idempotent', async () => {
  let resolveCredentials;
  let requests = 0;
  const credentials = new Promise(resolve => { resolveCredentials = resolve; });
  const { native, relayStates } = loadClientModules();
  const engine = new MockEngine();
  const service = new native.LiveBattleRelayService(engine, {
    requestCredentials: async () => { requests += 1; return credentials; },
  });
  const first = service.start(BATTLE_A);
  const retry = service.start(BATTLE_A);
  assert.strictEqual(first, retry);
  resolveCredentials(credentialFixture(BATTLE_A));
  assert.equal((await first).state, 'connecting');
  assert.equal(requests, 1);
  assert.equal(engine.configurations.length, 1);
  assert.deepEqual(engine.configurations[0], {
    srcInfo: { channelName: SESSION_A, uid: 1758552870, token: `source-${BATTLE_A}` },
    destInfos: [{ channelName: SESSION_B, uid: 1758552870, token: `dest-${BATTLE_A}` }],
    destCount: 1,
  });
  assert.equal((await service.start(BATTLE_A)).state, 'connecting');
  assert.equal(engine.configurations.length, 1);
  engine.emit(relayStates.RelayStateRunning);
  assert.equal(service.getSnapshot().state, 'running');
});

test('different Battle stops first, stale callbacks cannot revive it, and stop is idempotent', async () => {
  const { native, relayStates } = loadClientModules();
  const engine = new MockEngine();
  const service = new native.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => credentialFixture(battleId),
  });
  await service.start(BATTLE_A);
  const staleHandler = engine.registered.at(-1);
  engine.emit(relayStates.RelayStateRunning);
  await service.start(BATTLE_B);
  assert.equal(engine.stopCount, 1);
  assert.equal(engine.configurations.length, 2);
  assert.equal(service.getSnapshot().battleId, BATTLE_B);
  staleHandler.onChannelMediaRelayStateChanged(relayStates.RelayStateRunning, 0);
  assert.equal(service.getSnapshot().state, 'connecting');
  await service.stop();
  await service.stop();
  assert.equal(engine.stopCount, 2);
  assert.equal(service.getSnapshot().state, 'idle');
});

test('relay callbacks and negative Agora returns map to stable failure states', async () => {
  const { native, relayStates } = loadClientModules();
  const engine = new MockEngine();
  const service = new native.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => credentialFixture(battleId),
  });
  await service.start(BATTLE_A);
  engine.emit(relayStates.RelayStateFailure, 8);
  assert.deepEqual(service.getSnapshot(), {
    state: 'failed',
    battleId: BATTLE_A,
    errorCode: 'battle_relay_agora_state_failure',
    relayCode: 8,
  });
  await service.stop();

  engine.nextStartResult = -2;
  await assert.rejects(
    service.start(BATTLE_B),
    error => error.code === 'battle_relay_agora_start_failed' && error.relayCode === -2,
  );
  assert.equal(service.getSnapshot().state, 'failed');
});

test('dispose unregisters only its own handler and never leaves or releases the LIVE engine', async () => {
  const { native } = loadClientModules();
  const engine = new MockEngine();
  const foreignHandler = { onJoinChannelSuccess() {} };
  engine.handlers.add(foreignHandler);
  const service = new native.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => credentialFixture(battleId),
  });
  await service.start(BATTLE_A);
  const ownHandler = engine.registered.at(-1);
  await service.dispose();
  await service.dispose();
  assert.equal(engine.handlers.has(foreignHandler), true);
  assert.equal(engine.handlers.has(ownHandler), false);
  assert.equal(engine.unregistered.includes(foreignHandler), false);
  assert.equal(engine.stopCount, 1);
  assert.equal('leaveChannel' in native.LiveBattleRelayService.prototype, false);
  assert.equal('release' in native.LiveBattleRelayService.prototype, false);
});

test('installed SDK API and web fallback are explicit and safe', async () => {
  const agoraPackage = JSON.parse(await read('node_modules/react-native-agora/package.json'));
  assert.equal(agoraPackage.version, '4.6.2');
  assert.match(nativeSource, /startOrUpdateChannelMediaRelay/);
  assert.match(nativeSource, /stopChannelMediaRelay/);
  assert.match(nativeSource, /onChannelMediaRelayStateChanged/);
  assert.doesNotMatch(nativeSource, /startChannelMediaRelay\(/);
  assert.doesNotMatch(nativeSource, /onChannelMediaRelayEvent/);
  assert.match(webSource, /battle_relay_native_unavailable/);
});
