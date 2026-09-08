import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('supabase/migrations/20260908225020_stories_v2_b_canonical_contract_security_hardening.sql', root),
  'utf8',
);
const context = await readFile(new URL('contexts/StoriesContext.tsx', root), 'utf8');
const feed = await readFile(new URL('app/(tabs)/index.tsx', root), 'utf8');
const mediaClient = await readFile(new URL('services/mediaService.ts', root), 'utf8');
const mediaRegistry = await readFile(
  new URL('supabase/functions/_shared/mediaPurposes.ts', root),
  'utf8',
);
const cleanup = await readFile(
  new URL('supabase/migrations/20260726105000_media_public_urls_and_safe_links.sql', root),
  'utf8',
);

test('canonical Story RPC owns authentication, media validation, expiry, and linking', () => {
  assert.match(migration, /create or replace function public\.create_story_with_media\(p_asset_id uuid\)/i);
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /message = 'not_authenticated'/i);
  assert.match(migration, /message = 'invalid_asset_id'/i);
  assert.match(migration, /where a\.id = p_asset_id\s+for update/i);
  assert.match(migration, /a\.owner_id = v_actor/i);
  assert.match(migration, /a\.provider = 'r2'/i);
  assert.match(migration, /a\.status = 'ready'/i);
  assert.match(migration, /a\.visibility = 'public'/i);
  assert.match(migration, /a\.public_url ~\* '\^https:\/\/'/i);
  assert.match(migration, /a\.media_kind = 'image' and a\.purpose = 'post_image'/i);
  assert.match(migration, /a\.media_kind = 'video' and a\.purpose = 'story_video'/i);
  assert.match(migration, /message = 'story_asset_not_ready_or_owned'/i);
  assert.match(migration, /from public\.media_asset_links l\s+where l\.asset_id = p_asset_id/i);
  assert.match(migration, /message = 'story_asset_already_linked'/i);
  assert.match(migration, /insert into public\.stories\(user_id, media_url, media_type\)\s+values\(v_actor, v_media_url, v_media_type\)/i);
  assert.doesNotMatch(migration, /insert into public\.stories\([^)]*expires_at/i);
  assert.match(migration, /values\(p_asset_id, 'story', v_story_id, 'media', 0\)/i);
});

test('Story RPC is hardened and compatibility overloads delegate without trusting URLs', () => {
  assert.match(migration, /security definer\s+set search_path to 'pg_catalog', 'public'/i);
  assert.match(migration, /revoke all on function public\.create_story_with_media\(uuid\)\s+from public, anon/i);
  assert.match(migration, /grant execute on function public\.create_story_with_media\(uuid\)\s+to authenticated, service_role/i);
  assert.match(migration, /create or replace function public\.create_photo_story_with_media\(p_asset_id uuid\)[\s\S]*select public\.create_story_with_media\(p_asset_id\)/i);
  assert.match(migration, /create or replace function public\.create_photo_story_with_media\([\s\S]*p_media_urls text\[\][\s\S]*return public\.create_story_with_media\(p_asset_ids\[1\]\)/i);
  assert.match(migration, /revoke all on function public\.create_photo_story_with_media\(text\[\], uuid\[\]\)\s+from public, anon, authenticated/i);
});

test('Story reads are owner/follow scoped and close bidirectional blocks server-side', () => {
  assert.match(migration, /create or replace function private\.story_can_view_owner\(p_owner_id uuid\)/i);
  assert.match(migration, /function private\.story_can_view_owner\(p_owner_id uuid\)[\s\S]*security definer[\s\S]*set search_path to ''/i);
  assert.match(migration, /revoke all on function private\.story_can_view_owner\(uuid\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant usage on schema private to authenticated/i);
  assert.match(migration, /grant execute on function private\.story_can_view_owner\(uuid\)\s+to authenticated/i);
  assert.match(migration, /from public\.follows f[\s\S]*f\.follower_id = \(select auth\.uid\(\)\)[\s\S]*f\.following_id = p_owner_id/i);
  assert.match(migration, /b\.blocker_id = \(select auth\.uid\(\)\) and b\.blocked_id = p_owner_id/i);
  assert.match(migration, /b\.blocker_id = p_owner_id and b\.blocked_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /drop policy if exists stories_read_active_or_owned/i);
  assert.match(migration, /create policy stories_read_visible[\s\S]*expires_at > now\(\)[\s\S]*private\.story_can_view_owner\(user_id\)/i);
  assert.doesNotMatch(context, /\.from\('follows'\)/);
  assert.doesNotMatch(context, /\.in\('user_id'/);
});

test('raw Story creation and excessive client table grants are removed', () => {
  assert.match(migration, /drop policy if exists stories_insert_owned/i);
  assert.match(migration, /revoke all on table public\.stories from anon, authenticated/i);
  assert.match(migration, /grant select, delete on table public\.stories to authenticated/i);
  assert.match(migration, /grant select, insert on table public\.story_views to authenticated/i);
  assert.match(migration, /grant select on table public\.media_assets to anon, authenticated/i);
  assert.match(migration, /grant select on table public\.media_asset_links to anon, authenticated/i);
  assert.doesNotMatch(context, /from\('stories'\)\.insert/);
  assert.doesNotMatch(feed, /from\('stories'\)\.insert/);
});

test('photo and video callers share the canonical R2 media pipeline', () => {
  assert.match(context, /rpc\('create_story_with_media'/);
  assert.match(feed, /uploadMediaFromUri\(/);
  assert.match(feed, /purpose: isVideo \? 'story_video' : 'post_image'/);
  assert.match(feed, /visibility: 'public'/);
  assert.match(feed, /addStory\(uploaded\.assetId\)/);
  assert.match(feed, /deleteMediaAsset\(uploadedAssetId\)/);
  assert.doesNotMatch(feed, /uploadFileFromUri/);
  assert.doesNotMatch(feed, /storage\.from/);
  assert.doesNotMatch(context, /Date\.now\(\) \+ 24 \* 60 \* 60|expires_at:\s*expires/i);
});

test('story_video is registered once in the canonical media contract', () => {
  assert.match(mediaClient, /\| "story_video"/);
  assert.match(mediaRegistry, /story_video:\s*\{\s*kind: "video",\s*maxBytes: 100_000_000,\s*mimeTypes: \["video\/mp4", "video\/quicktime"\],\s*defaultVisibility: "public"/);
  assert.equal((mediaRegistry.match(/story_video:\s*\{/g) ?? []).length, 1);
});

test('existing expiry cleanup remains the single cleanup authority', () => {
  assert.match(cleanup, /delete from public\.media_asset_links l[\s\S]*l\.entity_type='story'[\s\S]*s\.expires_at<=now\(\)/i);
  assert.match(cleanup, /delete from public\.stories where expires_at<=now\(\)/i);
  assert.match(cleanup, /error_code='story_expired'/i);
  assert.doesNotMatch(migration, /create or replace function public\.cleanup_stale_media_upload_records/i);
  assert.doesNotMatch(migration, /cron\.schedule/i);
});

test('B introduces no parallel tables, buckets, contexts, viewers, or engagement UI', () => {
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /storage\.buckets|insert into storage\./i);
  assert.doesNotMatch(migration, /reaction|reply/i);
  assert.doesNotMatch(context, /StoriesV2|new StoriesContext/i);
});
