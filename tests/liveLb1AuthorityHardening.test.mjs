import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260823223420_live_lb1_canonical_authority.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const proof = await read('supabase/tests/live_lb1_authority_proof.sql');
const service = await read('services/liveSessionService.ts');
const edge = await read('supabase/functions/agora-token/index.ts');
const consumers = await Promise.all([
  'app/live/broadcast/[streamId].tsx',
  'app/live/watch/[streamId].tsx',
  'components/feature/LiveCameraPreview.tsx',
  'components/feature/LiveViewerSheet.tsx',
  'components/feature/LiveStreamsList.tsx',
  'modules/gaming/MultiplayerEngine.ts',
  'modules/streaming/LiveOrchestrator.ts',
  'modules/streaming/StreamManager.ts',
  'modules/streaming/StreamSessionManager.ts',
].map(async path => [path, await read(path)]));

const functionBody = name => {
  const start = migration.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, `${name}_exists`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name}_body_ends`);
  return migration.slice(start, end + 4);
};

test('LB1 has exactly one new CLI migration and never restores the rejected file', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => /^20260823\d+_.*\.sql$/.test(name) && name > '20260823175849_marketplace_refund_reconciliation_r2b4_f3.sql');
  assert.deepEqual(names, [migrationName]);
  assert.doesNotMatch(migration, /20260823211750_harden_live_session_authority/);
});

test('every public LB1 transition authenticates, fixes search_path and derives identity', () => {
  const names = [
    'live_set_participant_presence', 'live_request_to_join',
    'live_host_invite_participant', 'live_respond_to_host_invite',
    'live_host_decide_join_request', 'live_host_control_participant',
    'live_enforce_participant_timer', 'live_emit_reaction',
    'live_send_message', 'live_update_session_title',
  ];
  for (const name of names) {
    const body = functionBody(name);
    assert.match(body, /security definer/i, `${name}_security_definer`);
    assert.match(body, /set search_path = ''/i, `${name}_fixed_search_path`);
    assert.match(body, /auth\.uid\(\)/, `${name}_auth_uid`);
  }
  assert.match(migration, /private\.live_agora_uid\(v_actor\)/);
  assert.doesNotMatch(functionBody('live_set_participant_presence'), /p_role|p_status|p_agora_uid|p_username|p_delta/);
});

test('presence serializes the session and changes viewer_count only on a real transition', () => {
  const body = functionBody('live_set_participant_presence');
  assert.match(body, /from public\.live_sessions[\s\S]*for update/);
  assert.match(body, /from public\.live_participants[\s\S]*for update/);
  assert.match(body, /v_transition := true/);
  assert.match(body, /if v_transition then[\s\S]*viewer_count = viewer_count \+ 1/);
  assert.match(body, /status = 'active'[\s\S]*viewer_count = greatest\(0, viewer_count - 1\)/);
  assert.match(migration, /drop function if exists public\.increment_live_viewer_count\(uuid, integer\)/);
  assert.doesNotMatch(service, /increment_live_viewer_count|p_delta/);
});

test('requests, invitations and decisions are atomic and invalidate stale invitations', () => {
  const request = functionBody('live_request_to_join');
  const invite = functionBody('live_host_invite_participant');
  const respond = functionBody('live_respond_to_host_invite');
  const decide = functionBody('live_host_decide_join_request');
  for (const body of [request, invite, respond, decide]) {
    assert.match(body, /from public\.live_sessions[\s\S]*for update/);
    assert.match(body, /from public\.live_participants[\s\S]*for update/);
    assert.match(body, /insert into public\.live_control_events/);
  }
  assert.match(invite, /event_type='host_invite'/);
  assert.match(respond, /id=p_invite_id[\s\S]*actor_user_id=v_session\.host_id/);
  assert.match(respond, /'presence_leave','presence_enter','reject_join','remove_cohost'/);
  assert.match(respond, /set role='cohost', status='active'/);
  assert.doesNotMatch(respond, /accepted_host_invite/);
});

test('host controls use a closed action set and only 60/120/free timers', () => {
  const body = functionBody('live_host_control_participant');
  assert.match(body, /p_action not in \('mute','unmute','lock_mic','unlock_mic','grant_floor','revoke_floor','timer_start','timer_stop','remove_cohost'\)/);
  assert.match(body, /p_duration_seconds not in \(60,120\)/);
  assert.match(body, /v_session\.host_id<>v_actor/);
  assert.match(body, /v_participant\.status<>'active' or v_participant\.role<>'cohost'/);
  assert.match(body, /message='live_mic_locked'/);
  assert.match(functionBody('live_enforce_participant_timer'), /'reason','timer_expired'/);
});

test('reaction and chat payloads are server-authored and rate-limited under an actor lock', () => {
  const reaction = functionBody('live_emit_reaction');
  const message = functionBody('live_send_message');
  assert.match(reaction, /p_emoji is distinct from chr\(10084\)\|\|chr\(65039\)/);
  assert.match(reaction, /pg_advisory_xact_lock/);
  assert.match(reaction, /jsonb_build_object\('emoji',p_emoji,'username'/);
  const authoredPayload = reaction.slice(reaction.indexOf("values(p_session_id,v_actor,v_actor,'reaction'"));
  assert.doesNotMatch(authoredPayload, /gift_real|gift_id|transaction_id|amount_bdag/);
  assert.match(message, /length\(v_message\)>200/);
  assert.match(message, /pg_advisory_xact_lock/);
  assert.match(message, /values\(p_session_id,v_actor,coalesce\(v_username,'user'\),v_message\)/);
});

test('RLS and grants leave clients read-only on exposed LIVE tables', () => {
  for (const table of ['live_sessions','live_participants','live_control_events','live_messages','live_gift_transactions','gift_catalog']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /revoke all privileges on table public\.live_sessions,[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.live_sessions to anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|truncate|trigger|references|all).*to (?:anon|authenticated)/i);
  assert.match(migration, /live_control_events_read_authorized[\s\S]*actor_user_id=\(select auth\.uid\(\)\)[\s\S]*target_user_id=\(select auth\.uid\(\)\)/);
});

test('function ACL is exact and financial function bodies remain untouched', () => {
  assert.match(migration, /revoke execute on function[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.close_stale_live_sessions\(\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.close_stale_live_sessions\(\) to authenticated/);
  assert.doesNotMatch(migration, /create or replace function public\.send_live_gift/);
  assert.doesNotMatch(migration, /create or replace function public\.atomic_ledger_transfer/);
  assert.match(migration, /alter function public\.send_live_gift\(uuid,text,text\) set search_path=''/);
  assert.match(migration, /public\.emit_live_gift_control_event\(\), public\.set_live_participants_updated_at\(\)/);
});

test('all audited client writers call canonical RPC wrappers', () => {
  const directWrite = /\.from\('(live_sessions|live_participants|live_control_events|live_messages|live_gift_transactions|gift_catalog)'\)[\s\S]{0,500}?\.(insert|update|upsert|delete)\(/;
  for (const [path, source] of consumers) assert.doesNotMatch(source, directWrite, path);
  for (const rpc of [
    'live_set_participant_presence', 'live_request_to_join',
    'live_host_invite_participant', 'live_respond_to_host_invite',
    'live_host_decide_join_request', 'live_host_control_participant',
    'live_enforce_participant_timer', 'live_emit_reaction', 'live_send_message',
  ]) assert.match(service, new RegExp(`['"]${rpc}['"]`));
});

test('Agora remains server-derived and no Battles contract is introduced', () => {
  assert.match(edge, /const numericUid = userIdToAgoraUid\(user\.id\)/);
  assert.match(edge, /authorizedChannel = liveSession\.id/);
  assert.match(edge, /participant\.role !== 'cohost'/);
  assert.match(edge, /participant\.status !== 'active'/);
  assert.doesNotMatch(migration, /live_battles|battle_id|cross.channel|winner|score/i);
});

test('disposable proof rolls back synthetic identities, authority and retry scenarios', () => {
  assert.match(proof, /^begin;/);
  assert.match(proof, /rollback;\s*$/);
  for (const marker of [
    'presence_enter_not_idempotent', 'direct_participant_insert_allowed',
    'direct_session_update_allowed', 'direct_control_insert_allowed',
    'direct_message_insert_allowed', 'anon_rpc_allowed', 'viewer_control_allowed',
    'duplicate_request', 'locked_unmute_allowed', 'invalid_timer_allowed',
    'timer_auto_mute_failed', 'accept_without_invite_allowed',
    'rejected_invite_reused', 'reaction_rate_bypassed',
    'message_rate_bypassed', 'removed_publisher_eligible',
    'presence_reentry_count_failed', 'agora_uid_mismatch',
    'unsafe_delta_function_remains', 'ended_transition_allowed',
  ]) assert.match(proof, new RegExp(marker));
  assert.match(proof, /@proof\.local/);
});
