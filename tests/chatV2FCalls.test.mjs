import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260907134446_chat_v2_f_calls.sql', import.meta.url), 'utf8');
const groupScreen = readFileSync(new URL('../app/group-call/[roomId].tsx', import.meta.url), 'utf8');
const groupThread = readFileSync(new URL('../app/chat/group/[conversationId].tsx', import.meta.url), 'utf8');
const callService = readFileSync(new URL('../services/callSessionService.ts', import.meta.url), 'utf8');
const callContext = readFileSync(new URL('../contexts/AgoraCallContext.tsx', import.meta.url), 'utf8');
const tokenFunction = readFileSync(new URL('../supabase/functions/agora-token/index.ts', import.meta.url), 'utf8');
const notificationFunction = readFileSync(new URL('../supabase/functions/send-call-notification/index.ts', import.meta.url), 'utf8');

class GroupCallModel {
  constructor(memberIds) {
    this.activeMembers = new Set(memberIds);
    this.calls = [];
    this.participants = new Map();
  }
  start(actor, type, key) {
    if (!this.activeMembers.has(actor)) throw new Error('not authorized');
    const prior = this.calls.find(call => call.key === key && call.actor === actor);
    if (prior) {
      if (prior.type !== type) throw new Error('idempotency conflict');
      return prior;
    }
    const active = this.calls.find(call => call.status === 'accepted');
    if (active) return active;
    const call = { id: `call-${this.calls.length + 1}`, actor, type, key, status: 'accepted' };
    this.calls.push(call);
    this.participants.set(call.id, new Map([...this.activeMembers].map(userId =>
      [userId, userId === actor ? 'joined' : 'ringing'])));
    return call;
  }
  join(callId, actor) {
    const call = this.calls.find(item => item.id === callId);
    if (!call || call.status !== 'accepted' || !this.activeMembers.has(actor)) throw new Error('not authorized');
    this.participants.get(callId).set(actor, 'joined');
  }
  decline(callId, actor) {
    if (!this.activeMembers.has(actor) || this.participants.get(callId)?.get(actor) !== 'ringing') throw new Error('not authorized');
    this.participants.get(callId).set(actor, 'declined');
  }
  leave(callId, actor) {
    const call = this.calls.find(item => item.id === callId);
    if (this.participants.get(callId)?.get(actor) !== 'joined') throw new Error('not joined');
    this.participants.get(callId).set(actor, 'left');
    if (![...this.participants.get(callId).values()].includes('joined')) call.status = 'ended';
  }
  remove(actor) {
    this.activeMembers.delete(actor);
    for (const call of this.calls.filter(item => item.status === 'accepted')) {
      if (this.participants.get(call.id).has(actor)) this.participants.get(call.id).set(actor, 'left');
      if (![...this.participants.get(call.id).values()].includes('joined')) call.status = 'ended';
    }
  }
}

test('F evolves public.calls instead of creating group_calls', () => {
  assert.match(migration, /alter table public\.calls[\s\S]*conversation_id/);
  assert.doesNotMatch(migration, /create table public\.group_calls/i);
});
test('one durable participant authority is keyed by call and user', () => {
  assert.match(migration, /create table public\.call_participants/);
  assert.match(migration, /primary key\(call_id,user_id\)/);
});
test('only one joinable group call can exist per conversation', () => {
  assert.match(migration, /unique index calls_one_joinable_group_per_conversation[\s\S]*status in \('ringing','accepted'\)/);
});
test('simultaneous starts converge to one canonical call', () => {
  const model = new GroupCallModel(['a', 'b', 'c']);
  assert.equal(model.start('a', 'video', 'k1').id, model.start('b', 'video', 'k2').id);
  assert.equal(model.calls.length, 1);
});
test('idempotent start returns same logical call', () => {
  const model = new GroupCallModel(['a', 'b']);
  assert.equal(model.start('a', 'audio', 'same'), model.start('a', 'audio', 'same'));
});
test('idempotency conflicts reject a changed call type', () => {
  const model = new GroupCallModel(['a', 'b']);
  model.start('a', 'audio', 'same');
  assert.throws(() => model.start('a', 'video', 'same'), /conflict/);
});
test('active group member can join and rejoin', () => {
  const model = new GroupCallModel(['a', 'b']);
  const call = model.start('a', 'video', 'k');
  model.join(call.id, 'b'); model.leave(call.id, 'b'); model.join(call.id, 'b');
  assert.equal(model.participants.get(call.id).get('b'), 'joined');
});
test('removed member cannot join or rejoin', () => {
  const model = new GroupCallModel(['a', 'b']);
  const call = model.start('a', 'video', 'k');
  model.remove('b');
  assert.throws(() => model.join(call.id, 'b'), /not authorized/);
});
test('never-member cannot start or join', () => {
  const model = new GroupCallModel(['a', 'b']);
  assert.throws(() => model.start('x', 'audio', 'x'), /not authorized/);
  const call = model.start('a', 'audio', 'a');
  assert.throws(() => model.join(call.id, 'x'), /not authorized/);
});
test('decline is individual and does not terminate the group call', () => {
  const model = new GroupCallModel(['a', 'b', 'c']);
  const call = model.start('a', 'audio', 'k'); model.decline(call.id, 'b');
  assert.equal(call.status, 'accepted');
  assert.equal(model.participants.get(call.id).get('c'), 'ringing');
});
test('leaving is individual while another participant remains', () => {
  const model = new GroupCallModel(['a', 'b']);
  const call = model.start('a', 'audio', 'k'); model.join(call.id, 'b'); model.leave(call.id, 'a');
  assert.equal(call.status, 'accepted');
});
test('last joined participant ends the canonical call', () => {
  const model = new GroupCallModel(['a', 'b']);
  const call = model.start('a', 'audio', 'k'); model.leave(call.id, 'a');
  assert.equal(call.status, 'ended');
});
test('membership removal fences token and participant lifecycle transactionally', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_call\.conversation_id::text,0\)\)/);
  assert.match(migration, /remove_departed_group_call_participant/);
});
test('token authorization derives identity and requires joined active membership', () => {
  assert.match(migration, /authorize_group_call_token/);
  assert.match(migration, /cm\.user_id=v_actor and cm\.is_active/);
  assert.match(migration, /p\.state='joined'/);
});
test('Agora callId path authorizes group calls through authenticated RPC', () => {
  assert.match(tokenFunction, /authorize_group_call_token/);
  assert.match(tokenFunction, /contract\.kind !== 'new_call'/);
  assert.match(tokenFunction, /group call authorization mismatch/);
});
test('legacy arbitrary channel cannot authorize canonical CHAT group call', () => {
  assert.match(tokenFunction, /call\.call_scope === 'group'[\s\S]*contract\.kind !== 'new_call'/);
});
test('direct Agora authorization remains caller or callee based', () => {
  assert.match(tokenFunction, /const isCaller = call\.caller_id === user\.id/);
  assert.match(tokenFunction, /const isCallee = call\.callee_id === user\.id/);
});
test('group call UI uses the existing Agora engine and canonical callId', () => {
  assert.match(groupScreen, /useAgoraEngine/);
  assert.match(groupScreen, /callId: isCanonicalChatCall \? roomId : undefined/);
});
test('group audio disables video while group video retains camera controls', () => {
  assert.match(groupScreen, /enableVideo: callType !== 'audio'/);
  assert.match(groupScreen, /showCamera=\{callType !== 'audio'\}/);
});
test('group thread exposes audio, video, and active-call rejoin', () => {
  assert.match(groupThread, /startCall\('audio'\)/);
  assert.match(groupThread, /startCall\('video'\)/);
  assert.match(groupThread, /Llamada grupal en curso/);
});
test('client service has one RPC-backed group lifecycle', () => {
  for (const name of ['start_group_call','join_group_call','decline_group_call','leave_group_call','get_group_call_state','get_call_participants']) {
    assert.match(callService, new RegExp(name));
  }
});
test('foreground incoming group calls reuse AgoraCallContext', () => {
  assert.match(callContext, /calls:group-member:/);
  assert.match(callContext, /callScope: 'group'/);
  assert.match(callContext, /joinGroupCall\(call\.callId\)/);
  assert.match(callContext, /declineGroupCall\(call\.callId\)/);
});
test('group call push fans out only to eligible participant rows', () => {
  assert.match(notificationFunction, /call_participants/);
  assert.match(notificationFunction, /chat_conversation_members/);
  assert.match(notificationFunction, /activeMemberIds\.has\(member\.user_id\)/);
});
test('group push excludes sender and removed members', () => {
  assert.match(notificationFunction, /member\.user_id === call\.caller_id/);
  assert.match(notificationFunction, /\.eq\('is_active', true\)/);
});
test('group calls avoid the direct CallKit handoff', () => {
  assert.match(notificationFunction, /call\.call_scope === 'group' \|\| eventType !== 'incoming_call'/);
  assert.match(notificationFunction, /if \(call\.call_scope === 'group'\) return summary/);
});
test('RLS exposes calls and participant rows only through canonical authorization', () => {
  assert.match(migration, /calls_select_participant[\s\S]*call_actor_can_access\(id\)/);
  assert.match(migration, /call_participants_select_authorized[\s\S]*call_actor_can_access\(call_id\)/);
});
test('all group RPCs are authenticated-only with fixed search paths', () => {
  const functions = ['start_group_call','join_group_call','decline_group_call','leave_group_call','get_group_call_state','get_call_participants','authorize_group_call_token'];
  for (const name of functions) assert.match(migration, new RegExp(`function public\\.${name}[\\s\\S]*?security definer set search_path=pg_catalog,public`));
  assert.match(migration, /revoke all on function %s from public, anon/);
});
test('no parallel call context, token edge, or group call table was introduced', () => {
  assert.doesNotMatch(groupThread + groupScreen + callService, /GroupCallContext|GroupAgoraContext|GroupCallService/);
  assert.doesNotMatch(migration, /create table public\.group_calls/);
});
