import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260907144225_chat_v2_f1_call_lifecycle_hardening.sql', import.meta.url), 'utf8');
const groupScreen = readFileSync(new URL('../app/group-call/[roomId].tsx', import.meta.url), 'utf8');
const livenessHook = readFileSync(new URL('../hooks/useCallLiveness.ts', import.meta.url), 'utf8');

function functionBody(name) {
  const match = migration.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`, 'i'));
  assert.ok(match, `${name} missing`);
  return match[0];
}

test('F1 is additive and leaves the deployed F migration immutable', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /drop table|create table|alter table/i);
});

test('accepted direct calls retain all three historical cleanup branches', () => {
  const cleanup = functionBody('expire_stale_calls');
  assert.match(cleanup, /c\.call_scope='direct'/i);
  assert.match(cleanup, /handoff_completed_at is null[\s\S]*interval '3 minutes'/i);
  assert.match(cleanup, /handoff_completed_at is not null[\s\S]*media_connected_at is null[\s\S]*interval '3 minutes'/i);
  assert.match(cleanup, /media_connected_at is not null[\s\S]*last_heartbeat_at[\s\S]*interval '10 minutes'/i);
});

test('healthy groups use joined participants and fresh canonical heartbeat', () => {
  const cleanup = functionBody('expire_stale_calls');
  assert.match(cleanup, /c\.call_scope='group'[\s\S]*call_participants[\s\S]*p\.state='joined'/i);
  assert.match(cleanup, /coalesce\(c\.last_heartbeat_at,c\.accepted_at,c\.updated_at,c\.created_at\)[\s\S]*interval '10 minutes'/i);
});

test('stale group cleanup closes durable joined participant state', () => {
  const cleanup = functionBody('expire_stale_calls');
  assert.match(cleanup, /v_call\.call_scope='group'[\s\S]*update public\.call_participants[\s\S]*state='left'/i);
});

test('membership mutations acquire the conversation advisory lock first', () => {
  for (const name of ['chat_add_group_members', 'chat_remove_group_member', 'chat_leave_group']) {
    const body = functionBody(name);
    const advisory = body.indexOf('pg_advisory_xact_lock');
    const conversation = body.indexOf('from public.chat_conversations');
    assert.ok(advisory >= 0 && advisory < conversation, `${name} lock order`);
  }
});

test('join and token authorization lock conversation before call and participant', () => {
  for (const name of ['join_group_call', 'authorize_group_call_token']) {
    const body = functionBody(name);
    const advisory = body.indexOf('pg_advisory_xact_lock');
    const conversation = body.indexOf('from public.chat_conversations', advisory);
    const membership = body.indexOf('from public.chat_conversation_members', conversation);
    const call = body.indexOf('from public.calls', membership);
    const participant = name === 'join_group_call'
      ? body.indexOf('insert into public.call_participants', call)
      : body.indexOf('from public.call_participants', call);
    assert.ok(advisory < conversation && conversation < membership && membership < call && call < participant, `${name} lock order`);
  }
});

test('group heartbeat and media-connected require active membership and joined participant', () => {
  for (const name of ['mark_call_media_connected', 'heartbeat_call']) {
    const body = functionBody(name);
    assert.match(body, /chat_conversation_members[\s\S]*cm\.is_active/i);
    assert.match(body, /call_participants[\s\S]*p\.state='joined'/i);
    assert.match(body, /c\.status='accepted'/i);
  }
});

test('direct heartbeat authorization remains caller/callee based', () => {
  for (const name of ['mark_call_media_connected', 'heartbeat_call']) {
    assert.match(functionBody(name), /v_scope='direct'[\s\S]*v_actor in\(c\.caller_id,c\.callee_id\)/i);
  }
});

test('canonical group screen reuses the existing call liveness hook', () => {
  assert.match(groupScreen, /useCallLiveness\(\{/);
  assert.match(groupScreen, /pauseInBackground:\s*true/);
  assert.match(groupScreen, /connected:\s*isCanonicalChatCall && joined/);
});

test('background stops the group heartbeat timer and foreground starts one timer', () => {
  assert.match(livenessHook, /if \(state === 'active'\) startTimer\(\);\s*else stopTimer\(\);/);
  assert.match(livenessHook, /if \(stopped \|\| timer\) return;/);
});

test('unmount and terminal cleanup stop timers and remove AppState listener', () => {
  assert.match(livenessHook, /stopped = true;\s*stopTimer\(\);\s*appStateSubscription\.remove\(\);/);
  assert.match(livenessHook, /if \(!callId \|\| terminal \|\| callStatus !== 'accepted' \|\| !connected\) return;/);
});

test('F1 introduces no parallel group liveness or token architecture', () => {
  const combined = migration + groupScreen + livenessHook;
  assert.doesNotMatch(combined, /group_call_heartbeats|group_call_liveness|group_call_cleanup|GroupCallContext|GroupAgoraContext|agora-group-token/i);
});

test('database Agora UID output is explicitly compatibility-only', () => {
  assert.match(functionBody('authorize_group_call_token'), /Compatibility-only output[\s\S]*agora-token remains the canonical UID authority/i);
});
