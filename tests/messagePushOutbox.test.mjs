import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/20260725120000_message_push_notifications.sql',
  'utf8',
);
const privacyMigration = fs.readFileSync(
  'supabase/migrations/20260725143000_message_push_privacy_preferences.sql',
  'utf8',
);

test('messages insert into an idempotent independent outbox', () => {
  assert.match(migration, /create table if not exists public\.message_push_outbox/);
  assert.match(migration, /unique \(message_id\)/i);
  assert.match(migration, /after insert on public\.messages/i);
  assert.match(migration, /execute function public\.enqueue_message_push\(\)/);
  assert.match(migration, /new\.sender_id = new\.recipient_id/);
  assert.match(migration, /on conflict \(message_id\) do nothing/i);
});

test('blocked relationships and missing devices are auditable skips', () => {
  assert.match(privacyMigration, /public\.blocked_users/);
  assert.match(privacyMigration, /blocked_relationship/);
  assert.match(migration, /no_active_expo_device/);
});

test('recipient message privacy is enforced by the authoritative trigger', () => {
  assert.match(privacyMigration, /allow_messages_from/);
  assert.match(privacyMigration, /recipient_messages_disabled/);
  assert.match(privacyMigration, /recipient_followers_only/);
  assert.match(privacyMigration, /public\.follows/);
  assert.match(privacyMigration, /f\.follower_id = new\.sender_id/);
  assert.match(privacyMigration, /f\.following_id = new\.recipient_id/);
});

test('one delivery is created per active device and duplicate tokens are removed', () => {
  assert.match(migration, /create table if not exists public\.message_push_deliveries/);
  assert.match(migration, /unique \(message_id, device_id\)/i);
  assert.match(migration, /cd\.active = true/);
  assert.match(migration, /distinct on \(trim\(cd\.expo_push_token\)\)/i);
  assert.match(migration, /cd\.user_id = new\.recipient_id/);
});

test('message push SQL never uses PushKit or VoIP tokens', () => {
  const sql = `${migration}\n${privacyMigration}`;
  assert.doesNotMatch(sql, /voip_push_token/i);
  assert.doesNotMatch(sql, /PushKit/i);
  assert.doesNotMatch(sql, /apns_voip/i);
});

test('normal, image, video and premium messages share the authoritative trigger', () => {
  assert.match(migration, /for each row execute function public\.enqueue_message_push/);
  assert.doesNotMatch(migration, /media_type\s*=/i);
});
