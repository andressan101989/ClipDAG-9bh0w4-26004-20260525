import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async path => (await readFile(
  new URL(`../${path}`, import.meta.url), 'utf8'
)).replaceAll('\r\n', '\n');
const migrationName = '20260824025639_live_battles_lb2_state_machine.sql';
const correctionName = '20260824034049_live_battles_lb2_f1_session_liveness.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const service = await read('services/liveBattleService.ts');
const harness = await read('scripts/prove-live-lb2-concurrency.mjs');

test('LB2 adds exactly one forward migration without changing deployed LB1 migrations', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > '20260824014644_live_lb1_fix_agora_uid_lint.sql'
      && name <= correctionName);
  assert.deepEqual(names, [migrationName, correctionName]);
  assert.equal(createHash('sha256').update(await read(
    'supabase/migrations/20260823223420_live_lb1_canonical_authority.sql',
  )).digest('hex'), '3bf38a499b3e57f159ec3e937ea67c95ac09c7b8f99a36113ece827b0b7c8d1b');
  assert.equal(createHash('sha256').update(await read(
    'supabase/migrations/20260824014644_live_lb1_fix_agora_uid_lint.sql',
  )).digest('hex'), 'f959c6d026793fea8e3a1f671c3b89e4ad677e809de6965e9d64c99ee9cec6ea');
  assert.equal(createHash('sha256').update(migration).digest('hex'),
    '81740478f548a0866725b08c5f8853cb2f6cc3ce497bc5d2ca64bd5678898e56');
});

test('schema is normalized, timestamp constrained, and contains no Battle scoring or finance', () => {
  assert.match(migration, /create table public\.live_battles/);
  assert.match(migration, /create table public\.live_battle_events/);
  for (const field of [
    'challenger_user_id', 'opponent_user_id', 'challenger_session_id', 'opponent_session_id',
    'invite_expires_at', 'accepted_at', 'countdown_started_at', 'scheduled_start_at',
    'started_at', 'scheduled_end_at', 'ended_at', 'last_transition_actor_id',
    'last_transition_reason', 'version', 'created_at', 'updated_at',
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /challenger_user_id <> opponent_user_id/);
  assert.match(migration, /challenger_session_id <> opponent_session_id/);
  assert.match(migration, /interval '3 seconds'/);
  assert.match(migration, /interval '300 seconds'/);
  assert.match(migration, /interval '30 seconds'/);
  assert.doesNotMatch(migration, /\b(score|winner|loser|reward|coins|amount_bdag)\b/i);
  assert.doesNotMatch(migration, /send_live_gift|atomic_ledger_transfer|ledger_|wallet|financial_transactions|marketplace|live_commerce/i);
  assert.doesNotMatch(migration, /alter table public\.(live_control_events|live_gift_transactions|gift_catalog|ledger|wallet)/i);
});

test('state machine contains only the authorized transitions and terminal states never reactivate', () => {
  for (const transition of [
    "p_expected_status = 'pending' and p_next_status in ('accepted', 'rejected', 'cancelled', 'expired')",
    "p_expected_status = 'accepted' and p_next_status in ('countdown', 'cancelled')",
    "p_expected_status = 'countdown' and p_next_status in ('active', 'cancelled')",
    "p_expected_status = 'active' and p_next_status in ('completed', 'cancelled')",
  ]) assert.ok(migration.includes(transition));
  assert.doesNotMatch(migration, /p_expected_status\s*=\s*'(completed|rejected|cancelled|expired)'/);
  assert.match(migration, /version = v_next_version[\s\S]*insert into public\.live_battle_events/);
  assert.match(migration, /unique \(battle_id, version\)/);
});

test('server authority derives actor, clocks, sessions and participant reservation', () => {
  for (const name of [
    'create_live_battle_invite', 'respond_live_battle_invite', 'start_live_battle',
    'cancel_live_battle', 'complete_live_battle', 'get_live_battle_state',
  ]) {
    const start = migration.indexOf(`function public.${name}`);
    assert.notEqual(start, -1, `${name}_exists`);
    const end = migration.indexOf('\n$$;', start);
    const body = migration.slice(start, end + 4);
    assert.match(body, /auth\.uid\(\)/, `${name}_auth_uid`);
    assert.match(body, /security definer[\s\S]*set search_path = ''/i, `${name}_security`);
  }
  assert.match(migration, /order by u\.id[\s\S]*for update/);
  assert.match(migration, /order by s\.id[\s\S]*for update/);
  assert.match(migration, /status in \('accepted', 'countdown', 'active'\)/);
  assert.doesNotMatch(migration, /function public\.[^(]+\([^)]*p_(status|actor|version|duration|expires|started_at)/i);
});

test('RLS grants ACL and Realtime expose participant reads only', () => {
  assert.match(migration, /alter table public\.live_battles enable row level security/);
  assert.match(migration, /alter table public\.live_battle_events enable row level security/);
  assert.match(migration, /live_battles_read_participant[\s\S]*challenger_user_id[\s\S]*opponent_user_id/);
  assert.match(migration, /revoke all on table public\.live_battles, public\.live_battle_events[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.live_battles, public\.live_battle_events to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|truncate|trigger|references|all).*to (anon|authenticated)/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.live_battles/);
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.live_battle_events/);
  assert.match(migration, /revoke all on function private\.[\s\S]*from public, anon, authenticated, service_role/);
});

test('typed service stays isolated from screens and owns idempotent Realtime cleanup', () => {
  assert.match(service, /export const LIVE_BATTLE_STATUSES/);
  assert.match(service, /export type LiveBattleStatus/);
  assert.match(service, /create_live_battle_invite/);
  assert.match(service, /respond_live_battle_invite/);
  assert.match(service, /getMyOpenLiveBattle/);
  assert.match(service, /table: 'live_battles'/);
  assert.match(service, /filter: `id=eq\.\$\{battleId\}`/);
  assert.match(service, /cleanup \?\?= client\.removeChannel\(channel\)/);
  assert.doesNotMatch(service, /agora|gift|ledger|wallet|score|winner|marketplace|router|navigation/i);
});

test('disposable proof uses independent backends, barriers, negative ACL and full cleanup', () => {
  assert.match(harness, /LB2 proof refuses non-local databases/);
  assert.match(harness, /pg_backend_pid\(\)/);
  assert.match(harness, /assert\.notEqual\(evidence\.connections\[0\]\.pid/);
  for (const marker of [
    'same_pair_invites', 'accept_vs_reject', 'double_accept', 'one_user_accepts_two_battles',
    'start_vs_cancel', 'countdown_reconciliation', 'double_completion',
    'cancel_vs_completion', 'expiry_vs_acceptance',
  ]) assert.match(harness, new RegExp(marker));
  assert.match(harness, /truncate table public\.live_battle_events,public\.live_battles/);
  assert.match(harness, /battles: 0, events: 0, sessions: 0, users: 0/);
});
