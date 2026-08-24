import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const lb2Name = '20260824025639_live_battles_lb2_state_machine.sql';
const correctionName = '20260824034049_live_battles_lb2_f1_session_liveness.sql';
const correction = await read(`supabase/migrations/${correctionName}`);
const harness = await read('scripts/prove-live-lb2-concurrency.mjs');

test('LB2-F1 is the only forward correction and deployed migrations are byte-identical', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name > lb2Name);
  assert.deepEqual(names, [correctionName]);
  assert.equal(createHash('sha256').update(await read(`supabase/migrations/${lb2Name}`)).digest('hex'),
    '81740478f548a0866725b08c5f8853cb2f6cc3ce497bc5d2ca64bd5678898e56');
  assert.equal(createHash('sha256').update(await read(
    'supabase/migrations/20260823223420_live_lb1_canonical_authority.sql',
  )).digest('hex'), '3bf38a499b3e57f159ec3e937ea67c95ac09c7b8f99a36113ece827b0b7c8d1b');
  assert.equal(createHash('sha256').update(await read(
    'supabase/migrations/20260824014644_live_lb1_fix_agora_uid_lint.sql',
  )).digest('hex'), 'f959c6d026793fea8e3a1f671c3b89e4ad677e809de6965e9d64c99ee9cec6ea');
});

test('session pair helper validates existence ownership status ended_at and distinct sessions', () => {
  assert.match(correction, /function private\.live_battle_session_pair_is_live\([\s\S]*security invoker[\s\S]*set search_path = ''/i);
  assert.match(correction, /p_challenger_session_id <> p_opponent_session_id/);
  assert.match(correction, /s\.host_id = p_challenger_user_id[\s\S]*s\.status = 'live'[\s\S]*s\.ended_at is null/);
  assert.match(correction, /s\.host_id = p_opponent_user_id[\s\S]*s\.status = 'live'[\s\S]*s\.ended_at is null/);
  assert.equal((correction.match(/private\.live_battle_session_pair_is_live\(/g) ?? []).length, 6);
});

test('create accept and countdown start reject non-live session pairs after canonical locks', () => {
  for (const name of ['create_live_battle_invite', 'respond_live_battle_invite', 'start_live_battle']) {
    const start = correction.indexOf(`function public.${name}`);
    const end = correction.indexOf('\n$$;', start);
    const body = correction.slice(start, end + 4);
    assert.match(body, /live_battle_lock_users[\s\S]*live_battle_lock_sessions/);
    assert.match(body, /live_battle_session_pair_is_live/);
    assert.match(body, /live_battle_session_not_live/);
    assert.match(body, /security definer[\s\S]*set search_path = ''/i);
  }
  const respondStart = correction.indexOf('function public.respond_live_battle_invite');
  const respondEnd = correction.indexOf('\n$$;', respondStart);
  const respond = correction.slice(respondStart, respondEnd + 4);
  assert.ok(respond.indexOf('if not p_accept then') < respond.indexOf('live_battle_session_pair_is_live'));
});

test('elapsed countdown activates only while both authoritative sessions remain live', () => {
  assert.match(correction, /status = 'countdown'[\s\S]*scheduled_start_at <= p_now[\s\S]*live_battle_session_pair_is_live/);
  assert.match(correction, /'countdown', 'active', null, 'countdown_elapsed'/);
  assert.match(correction, /'countdown', 'cancelled', null,[\s\S]*'session_not_live_before_start'/);
  assert.match(correction, /p_expected_status = 'countdown' and p_actor_user_id is null and[\s\S]*p_reason = 'session_not_live_before_start'/);
  assert.doesNotMatch(correction, /session_not_live_before_start[\s\S]*p_expected_status = '(pending|accepted|active)'/);
});

test('correction preserves closed ACL and does not alter schema policy finance Agora or UI', () => {
  for (const signature of [
    'create_live_battle_invite(uuid, uuid, uuid)',
    'respond_live_battle_invite(uuid, boolean)',
    'start_live_battle(uuid)', 'cancel_live_battle(uuid)',
    'complete_live_battle(uuid)', 'get_live_battle_state(uuid)',
  ]) {
    assert.ok(correction.includes(`revoke all on function public.${signature}`));
    assert.ok(correction.includes(`grant execute on function public.${signature} to authenticated`));
  }
  assert.match(correction, /revoke all on function private\.live_battle_session_pair_is_live\([\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(correction, /create table|alter table|create policy|drop policy|alter publication|grant .* on table/i);
  assert.doesNotMatch(correction, /send_live_gift|atomic_ledger_transfer|ledger_|wallet|financial_transactions|marketplace|live_commerce|agora|cross.channel|score|winner/i);
});

test('multiconnection proof covers the LB2-F1 races and cleans every fixture', () => {
  for (const marker of [
    'end_then_reconcile', 'both_sessions_end_during_countdown',
    'double_reconcile_after_session_end', 'reconcile_vs_participant_cancel',
    'valid_countdown_reconciliation',
  ]) assert.match(harness, new RegExp(marker));
  assert.match(harness, /select pg_backend_pid\(\) pid/);
  assert.match(harness, /public\.end_live_session/);
  assert.match(harness, /session_not_live_before_start/);
  assert.match(harness, /actor_user_id is null/);
  assert.match(harness, /battles: 0, events: 0, sessions: 0, users: 0/);
});
