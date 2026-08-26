import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20260826043828_live_battles_lb4_f3_spectator_projection.sql');
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

const row = (overrides = {}) => ({
  session_id: SESSION,
  battle_id: BATTLE_A,
  opponent_session_id: OTHER_SESSION,
  local_host_user_id: HOST,
  opponent_host_user_id: OPPONENT,
  local_host_agora_uid: 1758552870,
  opponent_host_agora_uid: 1758552871,
  status: 'countdown',
  version: 3,
  scheduled_start_at: '2026-08-26T12:00:03.000Z',
  started_at: null,
  scheduled_end_at: null,
  ended_at: null,
  updated_at: '2026-08-26T12:00:00.000Z',
  ...overrides,
});

function clientHarness(snapshot = row()) {
  let realtimeCallback = () => undefined;
  let channelOptions = null;
  let channelName = null;
  let removeCalls = 0;
  let selectedColumns = null;
  let selectedSession = null;
  const channel = {
    on(_kind, options, callback) {
      channelOptions = options;
      realtimeCallback = callback;
      return channel;
    },
    subscribe() { return channel; },
  };
  const client = {
    from(table) {
      assert.equal(table, 'live_battle_public_states');
      return {
        select(columns) {
          selectedColumns = columns;
          return {
            eq(column, value) {
              assert.equal(column, 'session_id');
              selectedSession = value;
              return { maybeSingle: async () => ({ data: snapshot, error: null }) };
            },
          };
        },
      };
    },
    channel(name) { channelName = name; return channel; },
    async removeChannel(value) { assert.strictEqual(value, channel); removeCalls += 1; },
  };
  return {
    client,
    emit: payload => realtimeCallback(payload),
    inspect: () => ({ channelOptions, channelName, removeCalls, selectedColumns, selectedSession }),
  };
}

function loadService(harness = clientHarness()) {
  const service = loadTypeScript(serviceSource, {
    '@/template': { getSupabaseClient: () => harness.client },
  });
  return { service, harness };
}

test('migration creates one sanitized symmetric projection and one private trigger authority', () => {
  assert.match(migration, /create table public\.live_battle_public_states/);
  for (const field of [
    'session_id uuid primary key', 'battle_id uuid not null', 'opponent_session_id uuid not null',
    'local_host_user_id uuid not null', 'opponent_host_user_id uuid not null',
    'local_host_agora_uid integer not null', 'opponent_host_agora_uid integer not null',
    'status text not null', 'version bigint not null', 'updated_at timestamptz not null',
  ]) assert.ok(migration.includes(field), field);
  assert.match(migration, /new\.status in \('countdown', 'active', 'completed'\)/);
  assert.match(migration, /new\.status = 'cancelled' and new\.countdown_started_at is not null/);
  assert.match(migration, /private\.live_agora_uid\(new\.challenger_user_id\)/);
  assert.match(migration, /private\.live_agora_uid\(new\.opponent_user_id\)/);
  assert.equal((migration.match(/create or replace function private\.sync_live_battle_public_states/g) ?? []).length, 1);
  assert.equal((migration.match(/create trigger live_battles_sync_public_states/g) ?? []).length, 1);
  assert.match(migration, /on conflict \(session_id\) do update/);
  assert.match(migration, /excluded\.version >= live_battle_public_states\.version/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function private\.sync_live_battle_public_states\(\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /jwt|agora.*token|certificate|wallet|score|winner|ledger|gift/i);
});

test('RLS, grants, observable LIVE policy and exact Realtime publication are least privilege', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select\s+to authenticated/);
  assert.match(migration, /observed_session\.status = 'live'/);
  assert.match(migration, /observed_session\.ended_at is null/);
  assert.match(migration, /revoke all on table public\.live_battle_public_states\s+from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.live_battle_public_states to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)/i);
  assert.match(migration, /alter publication supabase_realtime\s+add table public\.live_battle_public_states/);
  assert.doesNotMatch(migration, /alter publication[^;]*live_battle_events/i);
});

test('strict parser accepts the canonical contract and rejects forged identities and timelines', () => {
  const { service } = loadService();
  const parsed = service.parseLiveBattlePublicState(row());
  assert.equal(parsed.sessionId, SESSION);
  assert.equal(parsed.opponentHostAgoraUid, 1758552871);
  for (const invalid of [
    row({ session_id: OTHER_SESSION, opponent_session_id: OTHER_SESSION }),
    row({ local_host_user_id: OPPONENT }),
    row({ local_host_agora_uid: 0 }),
    row({ opponent_host_agora_uid: 2_147_483_648 }),
    row({ status: 'pending' }),
    row({ version: 0 }),
    row({ scheduled_start_at: 'not-a-date' }),
    row({ status: 'active', started_at: null, scheduled_end_at: null }),
    row({ status: 'completed', ended_at: null }),
  ]) assert.throws(() => service.parseLiveBattlePublicState(invalid));
});

test('snapshot and exact-session Realtime are monotonic, replace Battles, and clean up once', async () => {
  const harness = clientHarness(row());
  const { service } = loadService(harness);
  const values = [];
  const subscription = service.subscribeToLiveBattlePublicState(SESSION, value => values.push(value));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.at(-1).battleId, BATTLE_A);
  assert.deepEqual(harness.inspect().channelOptions, {
    event: '*', schema: 'public', table: 'live_battle_public_states', filter: `session_id=eq.${SESSION}`,
  });
  assert.equal(harness.inspect().selectedSession, SESSION);
  assert.match(harness.inspect().channelName, new RegExp(`^live-battle-public:${SESSION}:`));
  assert.doesNotMatch(harness.inspect().selectedColumns, /token|score|winner|gift|wallet/i);

  const beforeDuplicate = values.length;
  harness.emit({ eventType: 'UPDATE', new: row() });
  harness.emit({ eventType: 'UPDATE', new: row({ version: 2 }) });
  assert.equal(values.length, beforeDuplicate);

  harness.emit({ eventType: 'UPDATE', new: row({ version: 4, status: 'active', started_at: '2026-08-26T12:00:03.000Z', scheduled_end_at: '2026-08-26T12:05:03.000Z', updated_at: '2026-08-26T12:00:03.000Z' }) });
  assert.equal(values.at(-1).version, 4);

  const replacement = row({ battle_id: BATTLE_B, version: 1, updated_at: '2026-08-26T12:06:00.000Z' });
  harness.emit({ eventType: 'UPDATE', new: replacement });
  assert.equal(values.at(-1).battleId, BATTLE_B);
  harness.emit({ eventType: 'DELETE', old: replacement });
  assert.equal(values.at(-1), null);

  await subscription.unsubscribe();
  await subscription.unsubscribe();
  assert.equal(harness.inspect().removeCalls, 1);
});

test('stage closes on terminal status and video identity never comes from arrival order', () => {
  const { service } = loadService();
  assert.equal(service.isLiveBattleStageStatus('countdown'), true);
  assert.equal(service.isLiveBattleStageStatus('active'), true);
  assert.equal(service.isLiveBattleStageStatus('completed'), false);
  assert.equal(service.isLiveBattleStageStatus('cancelled'), false);
  assert.match(stageSource, /flexDirection: 'row'/);
  assert.match(stageSource, /Conectando…/);
  assert.match(stageSource, /localSurface/);
  assert.match(stageSource, /opponentSurface/);
  assert.doesNotMatch(stageSource, /score|winner|gift/i);
  assert.match(watchSource, /remoteUids\.includes\(battleState\.localHostAgoraUid\)/);
  assert.match(watchSource, /remoteUids\.includes\(battleState\.opponentHostAgoraUid\)/);
  assert.match(broadcastSource, /remoteUids\.includes\(battleState\.opponentHostAgoraUid\)/);
  assert.match(watchSource, /uid !== battleHostUid && uid !== battleOpponentUid/);
  assert.match(broadcastSource, /remoteUids\.filter\(uid => uid !== battleOpponentUid\)/);
  assert.doesNotMatch(watchSource, /battle.*(?:fetchAgoraToken|relay)/i);
  assert.doesNotMatch(hookSource, /fetchAgoraToken|Relay|relay|startLiveBattle|live_battles/);
  assert.doesNotMatch(serviceSource, /functions\.invoke|\.insert\(|\.update\(|\.delete\(|relay|agora-token/);
  assert.doesNotMatch(watchSource + broadcastSource, /createAgoraRtcEngine/);
});
