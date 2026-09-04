import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const contractSource = await read('services/liveBattleRelayContract.ts');
const relaySource = await read('services/liveBattleRelayService.native.ts');
const controllerSource = await read('services/liveBattleRuntimeController.ts');
const runtimeHookSource = await read('hooks/live/useLiveBattleRelayRuntime.native.ts');
const agoraHookSource = await read('hooks/useAgoraEngine.native.ts');
const edgeSource = await read('supabase/functions/agora-token/index.ts');
const authorizationSource = await read(
  'supabase/functions/agora-token/battleRelayAuthorization.ts',
);
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');
const watchSource = await read('app/live/watch/[streamId].tsx');
const stageSource = await read('components/live/LiveBattleStage.tsx');

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
    .filter(item => item.category === ts.DiagnosticCategory.Error);
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

const states = {
  RelayStateIdle: 0,
  RelayStateConnecting: 1,
  RelayStateRunning: 2,
  RelayStateFailure: 3,
};
const errors = {
  RelayOk: 0,
  RelayErrorServerErrorResponse: 1,
  RelayErrorServerNoResponse: 2,
  RelayErrorNoResourceAvailable: 3,
  RelayErrorFailedJoinSrc: 4,
  RelayErrorFailedJoinDest: 5,
  RelayErrorFailedPacketReceivedFromSrc: 6,
  RelayErrorFailedPacketSentToDest: 7,
  RelayErrorServerConnectionLost: 8,
  RelayErrorInternalError: 9,
  RelayErrorSrcTokenExpired: 10,
  RelayErrorDestTokenExpired: 11,
};

const contract = loadTypeScript(contractSource, {
  '@/template': {
    getSupabaseClient: () => ({
      functions: { invoke: async () => ({ data: null, error: null }) },
    }),
  },
});
const relayModule = loadTypeScript(relaySource, {
  'react-native-agora': {
    ChannelMediaRelayState: states,
    ChannelMediaRelayError: errors,
  },
  './liveBattleRelayContract': contract,
});

const BATTLE_A = '10000000-0000-4000-8000-000000000001';
const BATTLE_B = '10000000-0000-4000-8000-000000000002';
const SESSION_A = '20000000-0000-4000-8000-000000000001';
const SESSION_B = '20000000-0000-4000-8000-000000000002';
const HOST_A_UID = 101001;
const HOST_B_UID = 202002;

function credentials(battleId, source, destination, destinationUid) {
  return {
    appId: '0123456789abcdef0123456789abcdef',
    battleRelay: {
      battleId,
      source: {
        liveSessionId: source,
        channel: source,
        uid: 0,
        token: `source-token-${battleId}`,
      },
      destination: {
        liveSessionId: destination,
        channel: destination,
        uid: destinationUid,
        token: `destination-token-${battleId}`,
      },
      expiresIn: 180,
    },
  };
}

class MockEngine {
  handlers = new Set();
  registered = [];
  unregistered = [];
  configurations = [];
  stopCount = 0;
  nextStartResult = 0;

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
    return 0;
  }

  emit(state, code = errors.RelayOk) {
    for (const handler of [...this.handlers]) {
      handler.onChannelMediaRelayStateChanged?.(state, code);
    }
  }
}

function makeService(engine, fixture, logs = []) {
  return new relayModule.LiveBattleRelayService(engine, {
    requestCredentials: async () => fixture,
    logger: (event, data) => logs.push({ event, data }),
  });
}

test('4.6.2 configures both authoritative directions with source UID zero', async () => {
  const packageJson = JSON.parse(await read('node_modules/react-native-agora/package.json'));
  assert.equal(packageJson.version, '4.6.2');

  const engineA = new MockEngine();
  const serviceA = makeService(
    engineA,
    credentials(BATTLE_A, SESSION_A, SESSION_B, HOST_A_UID),
  );
  const engineB = new MockEngine();
  const serviceB = makeService(
    engineB,
    credentials(BATTLE_A, SESSION_B, SESSION_A, HOST_B_UID),
  );

  assert.equal((await serviceA.start(BATTLE_A)).state, 'connecting');
  assert.equal((await serviceB.start(BATTLE_A)).state, 'connecting');
  assert.deepEqual(engineA.configurations[0], {
    srcInfo: { channelName: SESSION_A, uid: 0, token: `source-token-${BATTLE_A}` },
    destInfos: [{
      channelName: SESSION_B,
      uid: HOST_A_UID,
      token: `destination-token-${BATTLE_A}`,
    }],
    destCount: 1,
  });
  assert.deepEqual(engineB.configurations[0], {
    srcInfo: { channelName: SESSION_B, uid: 0, token: `source-token-${BATTLE_A}` },
    destInfos: [{
      channelName: SESSION_A,
      uid: HOST_B_UID,
      token: `destination-token-${BATTLE_A}`,
    }],
    destCount: 1,
  });
  await serviceA.dispose();
  await serviceB.dispose();
});

test('return zero is only connecting; official Running and RelayOk make media available', async () => {
  const engine = new MockEngine();
  const service = makeService(
    engine,
    credentials(BATTLE_A, SESSION_A, SESSION_B, HOST_A_UID),
  );
  const snapshots = [];
  const unsubscribe = service.subscribe(snapshot => snapshots.push(snapshot));
  const first = await service.start(BATTLE_A);
  assert.equal(first.state, 'connecting');
  assert.notEqual(service.getSnapshot().state, 'running');
  engine.emit(states.RelayStateRunning, errors.RelayOk);
  assert.equal(service.getSnapshot().state, 'running');
  assert.equal(
    snapshots.filter(snapshot => snapshot.state === 'running').length,
    1,
  );
  unsubscribe();
  await service.dispose();
});

test('same route is idempotent; Battle replacement and cleanup are ordered and stale-safe', async () => {
  const engine = new MockEngine();
  const service = new relayModule.LiveBattleRelayService(engine, {
    requestCredentials: async battleId => credentials(
      battleId,
      SESSION_A,
      SESSION_B,
      HOST_A_UID,
    ),
    logger: () => undefined,
  });
  const first = service.start(BATTLE_A);
  const duplicate = service.start(BATTLE_A);
  assert.strictEqual(first, duplicate);
  await first;
  const oldHandler = engine.registered.at(-1);
  engine.emit(states.RelayStateRunning);
  await service.start(BATTLE_A);
  assert.equal(engine.configurations.length, 1);

  await service.start(BATTLE_B);
  assert.equal(engine.stopCount, 1);
  assert.equal(engine.configurations.length, 2);
  assert.equal(service.getSnapshot().battleId, BATTLE_B);
  oldHandler.onChannelMediaRelayStateChanged(states.RelayStateRunning, errors.RelayOk);
  assert.equal(service.getSnapshot().state, 'connecting');

  await service.stop();
  await service.stop();
  await service.dispose();
  await service.dispose();
  assert.equal(engine.stopCount, 2);
  assert.equal(engine.handlers.size, 0);
});

test('Agora failures are canonical and diagnostic logs contain no credentials', async () => {
  const logs = [];
  const engine = new MockEngine();
  const service = makeService(
    engine,
    credentials(BATTLE_A, SESSION_A, SESSION_B, HOST_A_UID),
    logs,
  );
  await service.start(BATTLE_A);
  engine.emit(states.RelayStateFailure, errors.RelayErrorServerNoResponse);
  assert.equal(service.getSnapshot().state, 'failed');
  assert.equal(
    service.getSnapshot().errorCode,
    'battle_relay_service_unavailable',
  );
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /source-token|destination-token/);
  assert.equal(serialized.includes(BATTLE_A), false);
  assert.equal(serialized.includes(SESSION_A), false);
  assert.equal(serialized.includes(SESSION_B), false);
  assert.match(serialized, /00000001/);
  await service.dispose();
});

test('an unexpected Agora idle callback cannot leave the runtime claiming relay success', async () => {
  const engine = new MockEngine();
  const service = makeService(
    engine,
    credentials(BATTLE_A, SESSION_A, SESSION_B, HOST_A_UID),
  );
  await service.start(BATTLE_A);
  engine.emit(states.RelayStateRunning);
  assert.equal(service.getSnapshot().state, 'running');
  engine.emit(states.RelayStateIdle);
  assert.equal(service.getSnapshot().state, 'failed');
  assert.equal(service.getSnapshot().errorCode, 'battle_relay_stopped');
  await service.dispose();
});

test('Edge accepts only a Battle id and derives source zero plus destination host UID', () => {
  assert.match(edgeSource, /Object\.keys\(body\)\.every\(key => key === 'liveBattleId'\)/);
  assert.match(edgeSource, /const sourceRelayUid = 0/);
  assert.match(edgeSource, /const destinationRelayUid = numericUid/);
  assert.match(edgeSource, /channelName: authorization\.sourceSessionId[\s\S]*uid: sourceRelayUid/);
  assert.match(edgeSource, /channelName: authorization\.destinationSessionId[\s\S]*uid: destinationRelayUid/);
  assert.match(edgeSource, /authorizeBattleRelay\([\s\S]*user\.id,[\s\S]*battle,[\s\S]*sessions \?\? \[\],[\s\S]*requestNow,[\s\S]*relayProjection/);
  assert.match(edgeSource, /get_live_battle_public_snapshot/);
  assert.match(
    authorizationSource,
    /sourceSessionId: isChallenger \? challengerSessionId : opponentSessionId/,
  );
  assert.match(
    authorizationSource,
    /destinationSessionId: isChallenger \? opponentSessionId : challengerSessionId/,
  );
  assert.doesNotMatch(edgeSource, /body\.(?:sourceChannel|destinationChannel|sourceUid|destinationUid)/);
  assert.doesNotMatch(edgeSource, /console\.(?:log|info|error)\([^\n]*(?:sourceToken|destinationToken)/);
});

test('runtime gates relay on joined broadcaster, retries once per reconnect, and owns cleanup', () => {
  assert.match(controllerSource, /context\.isCanonicalHost[\s\S]*context\.engineReady[\s\S]*context\.joined/);
  assert.match(controllerSource, /relay\.state === 'running'/);
  assert.match(controllerSource, /retryRelayAfterReconnect\(\)/);
  assert.match(runtimeHookSource, /new LiveBattleRelayService\(engine\)/);
  assert.match(runtimeHookSource, /reconnectEpoch <= lastReconnectEpochRef\.current/);
  assert.match(runtimeHookSource, /controllerRef\.current\?\.retryRelayAfterReconnect\(\)/);
  assert.match(runtimeHookSource, /controller\.handleEngineRelease\(\)/);
  assert.match(runtimeHookSource, /void controller\.dispose\(\)/);
  assert.equal(
    (relaySource.match(/onChannelMediaRelayStateChanged:/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(`${relaySource}\n${runtimeHookSource}`, /setInterval|setTimeout/);
  assert.doesNotMatch(runtimeHookSource, /createAgoraRtcEngine|leaveChannel|\.release\(/);
});

test('audio/video subscribe and stage identity remain canonical for hosts and viewers', () => {
  assert.match(agoraHookSource, /autoSubscribeAudio: true/);
  assert.match(agoraHookSource, /autoSubscribeVideo: true/);
  assert.doesNotMatch(
    `${agoraHookSource}\n${broadcastSource}\n${watchSource}`,
    /muteRemoteAudioStream|muteAllRemoteAudioStreams/,
  );
  assert.match(broadcastSource, /canvas=\{\{ uid: 0 \}\}/);
  assert.match(broadcastSource, /remoteUids\.includes\(battleState\.opponentHostAgoraUid\)/);
  assert.match(watchSource, /remoteUids\.includes\(battleState\.localHostAgoraUid\)/);
  assert.match(watchSource, /remoteUids\.includes\(battleState\.opponentHostAgoraUid\)/);
  assert.match(watchSource, /uid !== battleHostUid && uid !== battleOpponentUid/);
  assert.doesNotMatch(
    `${broadcastSource}\n${watchSource}`,
    /battleOpponentUid\s*=\s*remoteUids\[(?:0|remoteUids\.length - 1)\]/,
  );
  assert.match(stageSource, /Conectando…/);
  assert.match(
    broadcastSource,
    /No se pudo conectar el audio y video del rival\./,
  );
});

test('media repair adds no migration, polling, commerce, score, or lifecycle write', async () => {
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name.endsWith('.sql'))
    .sort();
  assert.equal(
    migrations.at(-1),
    '20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql',
  );
  const combined = `${relaySource}\n${controllerSource}\n${runtimeHookSource}`;
  assert.doesNotMatch(combined, /setInterval|polling|live_battle_transition|send_live_gift/);
  assert.doesNotMatch(combined, /financial_transactions|ledger_entries|wallet|marketplace/i);
  assert.doesNotMatch(combined, /\bscore\b|winner|loser/i);
});
