import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async path => (await readFile(
  new URL(`../${path}`,import.meta.url),'utf8'
)).replaceAll('\r\n', '\n');
const original = await read('supabase/migrations/20260823223420_live_lb1_canonical_authority.sql');
const correction = await read('supabase/migrations/20260824014644_live_lb1_fix_agora_uid_lint.sql');
const harness = await read('scripts/prove-live-lb1-f1-concurrency.mjs');

test('deployed LB1 migration remains byte-for-byte unchanged',()=>{
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    '3bf38a499b3e57f159ec3e937ea67c95ac09c7b8f99a36113ece827b0b7c8d1b',
  );
});

test('LB1-F1 changes only the private Agora UID function and its ACL',()=>{
  assert.equal((correction.match(/create or replace function/gi)??[]).length,1);
  assert.match(correction,/function private\.live_agora_uid\(p_user_id uuid\)/i);
  assert.match(correction,/returns integer[\s\S]*language plpgsql[\s\S]*immutable[\s\S]*strict[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(correction,/v_index integer/i);
  assert.match(correction,/for v_index in 1\.\.length\(v_text\) loop/i);
  assert.match(correction,/revoke all on function private\.live_agora_uid\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(correction,/\b(?:alter|create|drop)\s+(?:table|policy|index|trigger|schema)\b/i);
  assert.doesNotMatch(correction,/live_battles|battle_id|cross.channel|winner|score|ledger|wallet|gift|marketplace/i);
});

test('multiconnection harness is local-only, barrier synchronized, and self-cleaning',()=>{
  assert.match(harness,/refuses non-local databases/);
  assert.match(harness,/pg_backend_pid\(\)/);
  assert.match(harness,/assert\.notEqual\(evidence\.connections\[0\]\.pid,evidence\.connections\[1\]\.pid/);
  assert.match(harness,/const barrier = new Promise/);
  for(const marker of [
    'simultaneous_presence_enter','simultaneous_presence_leave','simultaneous_join_request',
    'simultaneous_host_invite','simultaneous_invite_accept','end_live_vs_transition',
    'control_vs_remove_cohost','timer_vs_mic_lock',
  ]) assert.match(harness,new RegExp(marker));
  assert.match(harness,/truncate table public\.live_control_events/);
  assert.match(harness,/assert\.deepEqual\(cleanup,\{sessions:0,participants:0,events:0,users:0\}\)/);
});
