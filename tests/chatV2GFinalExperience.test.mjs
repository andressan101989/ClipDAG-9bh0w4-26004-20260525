import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260907164016_chat_v2_g_group_message_push.sql', 'utf8');
const dispatcher = fs.readFileSync('supabase/functions/dispatch-message-push-deliveries/index.ts', 'utf8');
const inbox = fs.readFileSync('app/(tabs)/messages.tsx', 'utf8');
const direct = fs.readFileSync('app/chat/[userId].tsx', 'utf8');
const group = fs.readFileSync('app/chat/group/[conversationId].tsx', 'utf8');
const context = fs.readFileSync('contexts/MessagesContext.tsx', 'utf8');

function fanout({ senderId, createdAt, members, devices, existing = new Set() }) {
  const output = new Set(existing);
  for (const device of devices) {
    const membership = members.find(member => member.userId === device.userId);
    if (!membership?.active || device.userId === senderId || !device.token) continue;
    if (new Date(membership.joinedAt).getTime() > new Date(createdAt).getTime()) continue;
    output.add(`message-1:${device.id}`);
  }
  return output;
}

test('group push keeps one nullable-recipient outbox row and uses the existing delivery table', () => {
  assert.match(migration, /alter column recipient_id drop not null/i);
  assert.match(migration, /insert into public\.message_push_outbox\(message_id,sender_id,recipient_id,status,next_attempt_at,last_error\)/i);
  assert.match(migration, /values\(new\.id,new\.sender_id,new\.recipient_id/);
  assert.match(migration, /insert into public\.message_push_deliveries/i);
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /group_message_push|group_push_deliveries/i);
});
test('group fanout excludes sender, removed members and memberships newer than the message', () => {
  const members = [
    { userId: 'A', active: true, joinedAt: '2026-09-01' },
    { userId: 'B', active: true, joinedAt: '2026-09-01' },
    { userId: 'C', active: false, joinedAt: '2026-09-01' },
    { userId: 'D', active: true, joinedAt: '2026-09-08' },
  ];
  const devices = [
    { id: 'a1', userId: 'A', token: 'a' },
    { id: 'b1', userId: 'B', token: 'b1' },
    { id: 'b2', userId: 'B', token: 'b2' },
    { id: 'c1', userId: 'C', token: 'c' },
    { id: 'd1', userId: 'D', token: 'd' },
  ];
  const result = fanout({ senderId: 'A', createdAt: '2026-09-07', members, devices });
  assert.deepEqual([...result].sort(), ['message-1:b1', 'message-1:b2']);
});

test('fanout retry remains idempotent per message and device', () => {
  const input = {
    senderId: 'A', createdAt: '2026-09-07',
    members: [{ userId: 'B', active: true, joinedAt: '2026-09-01' }],
    devices: [{ id: 'b1', userId: 'B', token: 'b' }],
  };
  const first = fanout(input);
  const retry = fanout({ ...input, existing: first });
  assert.equal(first.size, 1);
  assert.equal(retry.size, 1);
  assert.match(migration, /on conflict\(message_id,device_id\)do nothing/i);
});

test('dispatcher revalidates current membership, history fence and sender exclusion', () => {
  assert.match(dispatcher, /chat_conversation_members/);
  assert.match(dispatcher, /membership\?\.is_active === true/);
  assert.match(dispatcher, /membership\.joined_at/);
  assert.match(dispatcher, /message\.created_at/);
  assert.match(dispatcher, /message\.sender_id === device\.user_id/);
  assert.match(dispatcher, /group_membership_inactive/);
});

test('canonical payload navigates direct and group without leaking media URLs', () => {
  assert.match(dispatcher, /conversation_id: String\(message\.conversation_id\)/);
  assert.match(dispatcher, /conversation_type: conversationType/);
  assert.match(dispatcher, /from_user_id: String\(message\.sender_id\)/);
  assert.doesNotMatch(dispatcher, /media_url/);
});

test('unread badge authority is chat_message_receipts for direct and group', () => {
  assert.match(dispatcher, /from\('chat_message_receipts'\)/);
  assert.match(dispatcher, /\.eq\('user_id', device\.user_id\)/);
  assert.match(dispatcher, /\.is\('read_at', null\)/);
});

test('CHAT inbox has no random legacy group-call entry point', () => {
  assert.doesNotMatch(inbox, /generateUUID/);
  assert.doesNotMatch(inbox, /pathname: '\/group-call\/\[roomId\]'/);
  assert.match(inbox, /\/chat\/group\/create/);
});

test('direct and group threads share visual delivery authority', () => {
  assert.match(direct, /MessageDeliveryIndicator/);
  assert.match(group, /MessageDeliveryIndicator/);
  assert.match(group, /MessageReceiptSheet/);
  assert.doesNotMatch(group, /readCount\s*\|\||recipientCount\s*\|\|/);
});

test('group composer is keyboard safe, bounded and preserves canonical media and voice services', () => {
  assert.match(group, /KeyboardAvoidingView/);
  assert.match(group, /INPUT_MAX_HEIGHT = 112/);
  assert.match(group, /multiline maxLength=\{1000\}/);
  assert.match(group, /uploadPrivateChatImage/);
  assert.match(group, /VoiceRecorderBar/);
  assert.doesNotMatch(group, /one_time_image|premium_dm/);
});

test('pagination, stable render callback and single conversation subscription remain bounded', () => {
  assert.match(context, /MESSAGE_PAGE_SIZE = 50/);
  assert.match(group, /const renderMessage = useCallback/);
  assert.match(group, /maintainVisibleContentPosition/);
  assert.match(group, /loadOlderConversationMessages/);
  assert.equal((group.match(/chat-group-call-entry:/g) || []).length, 1);
});
