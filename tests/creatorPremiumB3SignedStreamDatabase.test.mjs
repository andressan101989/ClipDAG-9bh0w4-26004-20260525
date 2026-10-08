import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_creator_premium_b3_signed_stream_playback.sql'));
const migrationPath = matches.length === 1
  ? new URL(`../supabase/migrations/${matches[0]}`, import.meta.url)
  : null;
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

test('B3 uses exactly one generated forward-only migration and no parallel video authority', () => {
  assert.equal(matches.length, 1, 'exactly one generated B3 migration must exist');
  assert.match(matches[0], /^\d{14}_creator_premium_b3_signed_stream_playback\.sql$/);
  assert.doesNotMatch(migration, /create\s+table\s+(?:public\.|private\.)?(?:creator_premium_video|premium_video|stream_assets)\b/i);
  assert.doesNotMatch(migration, /create\s+(?:schema|database)|create\s+bucket/i);
});

test('B3 preserves public Stream purposes and adds one private Premium purpose', () => {
  assert.match(migration, /video_assets_purpose_check[\s\S]*'feed_video'[\s\S]*'business_library'[\s\S]*'creator_premium_video'/i);
  assert.match(migration, /creator_premium_video[\s\S]*provider\s*=\s*'cloudflare_stream'[\s\S]*visibility\s*=\s*'private'/i);
  assert.match(migration, /reserve_stream_upload_asset[\s\S]*creator_premium_video[\s\S]*'private'/i);
  assert.match(migration, /p_purpose\s+not\s+in\s*\(\s*'feed_video'\s*,\s*'business_library'\s*,\s*'creator_premium_video'\s*\)/i);
});

test('B3 Premium ready rows require signed provider proof and forbid permanent provider URLs', () => {
  assert.match(migration, /video_assets_ready_invariants_check/i);
  assert.match(migration, /status\s*=\s*'ready'[\s\S]*cloudflare_uid\s+is\s+not\s+null[\s\S]*ready_at\s+is\s+not\s+null[\s\S]*duration_seconds\s*>\s*0/i);
  assert.match(migration, /provider_metadata\s*->\s*'require_signed_urls'\s*=\s*'true'::jsonb/i);
  assert.match(migration, /purpose\s*=\s*'creator_premium_video'[\s\S]*hls_url\s+is\s+null[\s\S]*dash_url\s+is\s+null[\s\S]*thumbnail_url\s+is\s+null/i);
  assert.match(migration, /purpose\s*<>\s*'creator_premium_video'[\s\S]*hls_url\s+is\s+not\s+null/i);
});

test('B3 preserves legacy video entities and adds the exact Premium original shape', () => {
  assert.match(migration, /drop\s+constraint\s+video_asset_links_entity_type_check/i);
  for (const entity of ['video_post', 'story', 'exclusive_content', 'ai_avatar', 'creator_premium_content']) {
    assert.match(migration, new RegExp(`'${entity}'`));
  }
  assert.match(migration, /video_asset_links_creator_premium_shape_check[\s\S]*slot\s*=\s*'original'[\s\S]*(?:"position"|position)\s*=\s*0/i);
  assert.match(migration, /unique\s+index[\s\S]*creator_premium[\s\S]*\(entity_id\)[\s\S]*entity_type\s*=\s*'creator_premium_content'/i);
  assert.match(migration, /unique\s+index[\s\S]*creator_premium[\s\S]*\(asset_id\)[\s\S]*entity_type\s*=\s*'creator_premium_content'/i);
});

test('B3 link guard enforces ownership, video kind, draft lifecycle, privacy, readiness, and signed proof', () => {
  assert.match(migration, /function\s+private\.guard_creator_premium_video_link_v1\(\)/i);
  assert.match(migration, /security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
  assert.match(migration, /create\s+trigger\s+video_asset_links_guard_creator_premium/i);
  for (const proof of [
    /v_content\.creator_id\s+is\s+distinct\s+from\s+v_asset\.owner_id/i,
    /v_content\.content_kind\s*<>\s*'video'/i,
    /v_content\.lifecycle_status\s*<>\s*'draft'/i,
    /v_asset\.purpose\s*<>\s*'creator_premium_video'/i,
    /v_asset\.visibility\s*<>\s*'private'/i,
    /v_asset\.status\s*<>\s*'ready'/i,
    /v_asset\.provider_metadata\s*->\s*'require_signed_urls'\s+is\s+distinct\s+from\s+'true'::jsonb/i,
  ]) assert.match(migration, proof);
});

test('B3 reuses the B2 teaser for video while keeping R2 originals image-only', () => {
  assert.match(migration, /authorize_my_creator_premium_image_upload_v1[\s\S]*creator_premium_teaser_image[\s\S]*content_kind\s+not\s+in\s*\(\s*'image'\s*,\s*'video'\s*\)/i);
  assert.match(migration, /p_purpose\s*=\s*'creator_premium_original_image'[\s\S]*content_kind\s*<>\s*'image'/i);
  assert.match(migration, /guard_creator_premium_media_link_v1[\s\S]*new\.slot\s*=\s*'teaser'[\s\S]*content_kind\s+not\s+in\s*\(\s*'image'\s*,\s*'video'\s*\)/i);
  assert.match(migration, /new\.slot\s*=\s*'original'[\s\S]*content_kind\s*<>\s*'image'/i);
  assert.doesNotMatch(migration, /creator_premium_video_teaser|premium_video_preview/i);
});

test('B3 exposes only narrow authenticated video upload, first-bind, and owner-state RPCs', () => {
  const functions = [
    ['authorize_my_creator_premium_video_upload_v1', 'uuid'],
    ['set_my_creator_premium_video_media_v1', 'uuid,uuid,uuid'],
    ['get_my_creator_premium_video_media_v1', 'uuid'],
  ];
  for (const [name, signature] of functions) {
    assert.match(migration, new RegExp(`function\\s+public\\.${name}\\b`, 'i'));
    assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
    assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)[\\s\\S]*?to\\s+authenticated`, 'i'));
  }
  assert.match(migration, /private\.current_user_is_creator_exclusive_age_eligible\(\)/i);
  assert.match(migration, /private\.creator_premium_actor_is_operational_v1\(/i);
  const uploadAuthority = migration.slice(
    migration.indexOf('create function public.authorize_my_creator_premium_video_upload_v1'),
    migration.indexOf('revoke all on function public.authorize_my_creator_premium_video_upload_v1'),
  );
  assert.doesNotMatch(uploadAuthority, /p_creator_id\s+uuid/i);
});

test('B3 video binding serializes, replays the same pair, and denies replacement', () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*creator-premium-video-media/i);
  assert.match(migration, /p_teaser_asset_id\s+is\s+null[\s\S]*p_video_asset_id\s+is\s+null/i);
  assert.match(migration, /replayed/i);
  assert.match(migration, /creator_premium_video_media_already_bound/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.video_assets/i);
});

test('B3 hides generic Premium rows and returns only safe projection fields', () => {
  assert.match(migration, /drop\s+policy\s+video_assets_select_own/i);
  assert.match(migration, /purpose\s*<>\s*'creator_premium_video'/i);
  assert.match(migration, /drop\s+policy\s+video_asset_links_select_own/i);
  assert.match(migration, /entity_type\s*<>\s*'creator_premium_content'/i);
  assert.match(migration, /get_my_creator_premium_contents_v1[\s\S]*video_attached\s+boolean[\s\S]*video_media_ready\s+boolean/i);
  assert.match(migration, /get_my_creator_premium_video_media_v1[\s\S]*video_attached\s+boolean[\s\S]*video_ready\s+boolean[\s\S]*media_ready\s+boolean/i);
  for (const forbidden of ['video_asset_id', 'cloudflare_uid', 'hls_url', 'dash_url', 'thumbnail_url']) {
    assert.doesNotMatch(migration, new RegExp(`returns\\s+table\\s*\\([^)]*\\b${forbidden}\\b`, 'is'));
  }
});

test('B3 catalog requires a protected ready video and exposes only the public teaser', () => {
  assert.match(migration, /get_creator_premium_catalog_v1[\s\S]*content_kind\s*=\s*'video'[\s\S]*creator_premium_video[\s\S]*require_signed_urls/i);
  assert.match(migration, /creator_premium_teaser_image/i);
  assert.doesNotMatch(migration, /returns\s+table\s*\([^)]*(?:video_asset_id|cloudflare_uid|hls_url|dash_url|thumbnail_url)/is);
});

test('B3 migration contains no finance, publishing, new provider, or Stream deletion work', () => {
  assert.doesNotMatch(migration, /atomic_ledger_transfer|ledger_debit|ledger_credit|insert\s+into\s+public\.financial_transactions|insert\s+into\s+public\.ledger_entries/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.[^(]*(?:purchase|subscribe|refund|renew|payout|publish)/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.video_assets|stream_provider|cloudflare_account/i);
});
