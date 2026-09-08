import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260908060700_chat_v2_h_f1_legacy_video_trigger_alignment.sql',
  'utf8',
).replace(/\r\n/g, '\n');

test('F1 replaces only the canonical legacy message trigger function', () => {
  assert.equal((migration.match(/create or replace function public\./g) || []).length, 1);
  assert.match(migration, /create or replace function public\.chat_prepare_legacy_message\(\)/);
  assert.doesNotMatch(migration, /create\s+(?:constraint\s+)?trigger|drop\s+(?:function|trigger)|create\s+(?:table|index|policy)|alter\s+table/i);
});

test('legacy trigger requires private asset identity for video', () => {
  assert.match(migration, /new\.media_type = 'video' and \(new\.media_asset_id is null or new\.media_url is not null\)/);
  assert.match(migration, /chat_video_private_asset_required/);
});

test('legacy trigger enforces video media_kind', () => {
  assert.match(migration, /new\.media_type = 'video'[\s\S]*v_asset\.media_kind <> 'video'/);
});

test('legacy trigger enforces chat_video purpose', () => {
  assert.match(migration, /new\.media_type = 'video'[\s\S]*v_asset\.purpose <> 'chat_video'/);
});

test('group legacy inserts permit video and still reject one-time image', () => {
  const groupContract = migration.match(/if v_conversation\.conversation_type = 'group' then[\s\S]*?else/)?.[0] ?? '';
  assert.match(groupContract, /new\.media_type not in \('text', 'image', 'video', 'voice'\)/);
  assert.doesNotMatch(groupContract, /'one_time_image'/);
});

test('voice asset contract remains canonical', () => {
  assert.match(migration, /new\.media_type = 'voice'[\s\S]*v_asset\.media_kind <> 'audio' or v_asset\.purpose <> 'voice_note'/);
  assert.match(migration, /array_length\(new\.audio_waveform, 1\) is distinct from 48/);
});

test('image and one-time image asset contract remains canonical', () => {
  assert.match(migration, /new\.media_type in \('image', 'one_time_image'\)[\s\S]*v_asset\.media_kind <> 'image' or v_asset\.purpose <> 'chat_image'/);
});

test('already-linked assets remain rejected', () => {
  assert.match(migration, /exists \(select 1 from public\.media_asset_links l where l\.asset_id = new\.media_asset_id\)/);
  assert.match(migration, /chat_media_asset_already_linked/);
});

test('owner mismatch remains rejected', () => assert.match(migration, /v_asset\.owner_id <> new\.sender_id/));
test('public assets remain rejected', () => {
  assert.match(migration, /v_asset\.visibility <> 'private'/);
  assert.match(migration, /v_asset\.public_url is not null/);
});
test('non-ready assets remain rejected', () => assert.match(migration, /v_asset\.status <> 'ready'/));

test('security identity and ACL remain exact', () => {
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path to 'pg_catalog', 'public'/);
  assert.match(migration, /alter function public\.chat_prepare_legacy_message\(\) owner to postgres/);
  assert.match(migration, /revoke all on function public\.chat_prepare_legacy_message\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.chat_prepare_legacy_message\(\) to service_role/);
});

test('F1 is nonfinancial and introduces no parallel authority', () => {
  assert.doesNotMatch(migration, /ledger|wallet|escrow|create\s+function\s+public\.(?!chat_prepare_legacy_message)|create\s+(?:constraint\s+)?trigger/i);
});
