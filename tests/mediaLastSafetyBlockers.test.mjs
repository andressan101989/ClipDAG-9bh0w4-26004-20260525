import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260726105000_media_public_urls_and_safe_links.sql');
const storiesV2 = read('supabase/migrations/20260908220749_stories_v2_b_canonical_contract_security_hardening.sql');
const finalize = read('supabase/functions/finalize-media-upload/index.ts');
const remove = read('supabase/functions/delete-media-asset/index.ts');
const upload = read('app/(tabs)/upload.tsx');
const profile = read('app/(tabs)/profile.tsx');
const feed = read('contexts/FeedContext.tsx');
const stories = read('contexts/StoriesContext.tsx');
const marketplace = read('services/marketplaceService.ts');

test('exclusive feed publishing is disabled and cannot report false success', () => {
  assert.match(upload, /Contenido exclusivo próximamente/);
  assert.doesNotMatch(upload, /<ExclusiveToggle/);
  assert.doesNotMatch(upload, /Contenido exclusivo publicado/);
  assert.match(upload, /result\.success !== true \|\| !result\.content_id/);
});

test('finalize persists and returns the authoritative public URL', () => {
  assert.match(migration, /add column if not exists public_url text/i);
  assert.match(finalize, /public_url:\s*resolvedPublicUrl/);
  assert.match(finalize, /url:\s*resolvedPublicUrl/);
  assert.match(finalize, /public_url_missing/);
});

test('entity RPCs resolve URLs from media assets instead of client input', () => {
  for (const name of [
    'create_carousel_post',
    'create_photo_post_with_media',
    'create_photo_story_with_media',
    'create_product_with_media',
  ]) {
    assert.match(migration, new RegExp(`function public\\.${name}`));
  }
  assert.match(migration, /array_agg\(a\.public_url order by ids\.ordinality\)/i);
  assert.doesNotMatch(migration, /p_media_urls text\[\]/i);
  assert.match(feed, /create_photo_post_with_media/);
  assert.match(feed, /create_carousel_post/);
  assert.match(stories, /create_story_with_media/);
  assert.match(storiesV2, /function public\.create_story_with_media/);
  assert.match(marketplace, /create_marketplace_product/);
  assert.doesNotMatch(marketplace, /rpc\('create_product_with_media'/);
});

test('avatar update and link replacement are atomic', () => {
  assert.match(migration, /function public\.set_profile_avatar_with_media/);
  assert.match(migration, /update public\.user_profiles set avatar_url=v_url/i);
  assert.match(migration, /status='delete_pending'[\s\S]*error_code='avatar_replaced'/i);
  assert.match(profile, /setProfileAvatarWithMedia\(uploaded\.assetId\)/);
});

test('delete rejects assets in authoritative use and finalizes link cleanup', () => {
  assert.match(remove, /schedule_media_asset_deletion/);
  assert.match(remove, /\{error:'asset_in_use'\},409/);
  assert.match(remove, /finalize_media_asset_deletion/);
  assert.match(migration, /delete from public\.media_asset_links where asset_id = p_asset_id/i);
});

test('cleanup removes invalid links before queueing only unreferenced assets', () => {
  assert.match(migration, /delete from public\.media_asset_links l[\s\S]*l\.entity_type='story'/i);
  assert.match(migration, /not public\.media_asset_has_valid_links\(a\.id\)/i);
  assert.match(migration, /delete from public\.media_asset_links l[\s\S]*a\.status='deleted'/i);
});

test('canonical video Story cleanup preserves unidentified legacy objects without starting Stream', () => {
  const lifecycle = read('docs/r2-media-lifecycle.md');
  assert.match(lifecycle, /Photo and video stories created by the current app use the R2 media lifecycle/);
  assert.match(lifecycle, /Historical legacy\s+video objects in Supabase Storage remain untouched/);
  assert.match(lifecycle, /Cloudflare Stream is intentionally not started/);
});
