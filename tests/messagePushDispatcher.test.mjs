import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dispatcher = fs.readFileSync(
  'supabase/functions/dispatch-message-push-deliveries/index.ts',
  'utf8',
);
const receipts = fs.readFileSync(
  'supabase/functions/check-message-push-receipts/index.ts',
  'utf8',
);
const shared = fs.readFileSync('supabase/functions/_shared/messagePush.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260725120000_message_push_notifications.sql',
  'utf8',
);

test('dispatcher accepts no client-selected recipient, content or token', () => {
  assert.match(dispatcher, /claim_message_push_deliveries/);
  assert.doesNotMatch(dispatcher, /req\.json\(\)/);
  assert.doesNotMatch(dispatcher, /to_user_id/);
  assert.match(shared, /x-message-dispatch-secret/);
  assert.match(shared, /timingSafeEqual/);
});

test('payload contains string message navigation data and safe previews', () => {
  assert.match(dispatcher, /type: 'message'/);
  assert.match(dispatcher, /from_user_id: String\(message\.sender_id\)/);
  assert.match(dispatcher, /message_id: String\(message\.id\)/);
  assert.match(dispatcher, /interruptionLevel: 'active'/);
  assert.match(dispatcher, /Te envió una imagen/);
  assert.match(dispatcher, /Te envió un video/);
  assert.match(dispatcher, /Te envió un DM Premium/);
  assert.match(shared, /compact\.length <= 120/);
  assert.doesNotMatch(dispatcher, /media_url/);
});

test('badge is calculated from authoritative unread messages', () => {
  assert.match(dispatcher, /count: 'exact', head: true/);
  assert.match(dispatcher, /\.eq\('recipient_id', message\.recipient_id\)\.eq\('read', false\)/);
  assert.match(dispatcher, /badge: Math\.max/);
});

test('attempt fencing, abandoned lock recovery and bounded retries exist', () => {
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /attempt_id = gen_random_uuid\(\)/);
  assert.match(migration, /attempt_id is distinct from p_attempt_id/);
  assert.match(migration, /attempt_count < 5/);
  assert.match(migration, /interval '30 seconds'/);
  assert.match(migration, /interval '2 minutes'/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /interval '30 minutes'/);
});

test('DeviceNotRegistered clears only the matching Expo token', () => {
  assert.match(dispatcher, /DeviceNotRegistered/);
  assert.match(receipts, /DeviceNotRegistered/);
  const clearFunction = migration.slice(
    migration.indexOf('create or replace function public.clear_invalid_message_expo_token'),
    migration.indexOf('create or replace function public.wake_message_push_dispatcher'),
  );
  assert.match(clearFunction, /set expo_push_token = null/);
  assert.match(clearFunction, /expo_push_token = p_token_snapshot/);
  assert.doesNotMatch(clearFunction, /voip_push_token/);
  assert.doesNotMatch(clearFunction, /native_push_token/);
  assert.doesNotMatch(clearFunction, /active\s*=/);
});

test('tickets are receipt-checked and missing receipts terminate after a bound', () => {
  assert.match(dispatcher, /p_result: result/);
  assert.match(receipts, /claim_message_push_receipts/);
  assert.match(receipts, /receipt_attempt_count >= 10/);
  assert.match(receipts, /receipt_not_found_after_max_checks/);
  assert.match(migration, /message-push-receipts/);
});

test('message functions contain no PushKit, VoIP or call dispatcher dependency', () => {
  const combined = `${dispatcher}\n${receipts}\n${shared}`;
  assert.doesNotMatch(combined, /PushKit/i);
  assert.doesNotMatch(combined, /voip_push_token/i);
  assert.doesNotMatch(combined, /dispatch-call-push-deliveries/);
});
