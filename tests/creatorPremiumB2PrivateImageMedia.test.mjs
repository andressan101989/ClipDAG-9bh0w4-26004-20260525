import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_creator_premium_b2_private_image_media.sql'));
const migrationPath = matches.length === 1
  ? new URL(`../supabase/migrations/${matches[0]}`, import.meta.url)
  : null;
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

test('B2 uses exactly one generated forward-only migration and no parallel media table', () => {
  assert.equal(matches.length, 1, 'exactly one generated B2 migration must exist');
  assert.match(matches[0], /^\d{14}_creator_premium_b2_private_image_media\.sql$/);
  assert.doesNotMatch(migration, /create\s+table\s+(?:public\.|private\.)?(?:creator_premium_media_assets|premium_media)\b/i);
  assert.doesNotMatch(migration, /create\s+(?:schema|database)|create\s+bucket/i);
});

test('B2 preserves legacy media entities and adds only the canonical Premium entity shape', () => {
  assert.match(migration, /drop\s+constraint\s+media_asset_links_entity_type_check/i);
  for (const entity of [
    'user_profile', 'video_post', 'story', 'chat_message', 'shop_product',
    'exclusive_content', 'marketplace_store', 'marketplace_dispute',
    'marketplace_return_shipment', 'creator_premium_content',
  ]) assert.match(migration, new RegExp(`'${entity}'`));
  assert.match(migration, /media_asset_links_creator_premium_shape_check[\s\S]*slot\s+in\s*\(\s*'teaser'\s*,\s*'original'\s*\)[\s\S]*(?:"position"|position)\s*=\s*0/i);
  assert.match(migration, /unique\s+index[\s\S]*creator_premium[\s\S]*\(entity_id\s*,\s*slot\)[\s\S]*entity_type\s*=\s*'creator_premium_content'/i);
  assert.match(migration, /unique\s+index[\s\S]*creator_premium[\s\S]*\(asset_id\)[\s\S]*entity_type\s*=\s*'creator_premium_content'/i);
});

test('B2 enforces exact teaser and private-original database identities', () => {
  assert.match(migration, /creator_premium_teaser_image/);
  assert.match(migration, /creator_premium_original_image/);
  assert.match(migration, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/i);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('creator_premium_original_image'), migration.indexOf('creator_premium_original_image') + 2500),
    /image\/gif/i,
  );
  assert.match(migration, /creator_premium_teaser[\s\S]*provider\s*=\s*'r2'[\s\S]*media_kind\s*=\s*'image'[\s\S]*visibility\s*=\s*'public'[\s\S]*25(?:000000|_000_000)/i);
  assert.match(migration, /creator_premium_original[\s\S]*provider\s*=\s*'r2'[\s\S]*media_kind\s*=\s*'image'[\s\S]*visibility\s*=\s*'private'[\s\S]*public_url\s+is\s+null/i);
  assert.match(migration, /status\s*<>\s*'ready'[\s\S]*public_url\s+~\*?\s*'\^https:\/\/'/i);
});

test('B2 guards Premium links with ownership, purpose, readiness, draft, and content-kind checks', () => {
  assert.match(migration, /create\s+(?:or\s+replace\s+)?function\s+private\.guard_creator_premium_media_link_v1\(\)/i);
  assert.match(migration, /set\s+search_path\s*=\s*''/i);
  assert.match(migration, /create\s+trigger\s+media_asset_links_guard_creator_premium/i);
  for (const proof of [
    /v_content\.creator_id\s*(?:<>|is distinct from)\s*v_asset\.owner_id/i,
    /v_content\.content_kind\s*<>\s*'image'/i,
    /v_content\.lifecycle_status\s*<>\s*'draft'/i,
    /v_asset\.status\s*<>\s*'ready'/i,
    /v_asset\.provider\s*<>\s*'r2'/i,
    /v_asset\.media_kind\s*<>\s*'image'/i,
  ]) assert.match(migration, proof);
});

test('B2 exposes only narrow authenticated upload, pair binding, and owner-state RPCs', () => {
  for (const name of [
    'authorize_my_creator_premium_image_upload_v1',
    'set_my_creator_premium_image_media_v1',
    'get_my_creator_premium_image_media_v1',
  ]) {
    assert.match(migration, new RegExp(`function\\s+public\\.${name}\\b`, 'i'));
    assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
    assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?to\\s+authenticated`, 'i'));
  }
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /private\.current_user_is_creator_exclusive_age_eligible\(\)/i);
  assert.match(migration, /private\.creator_premium_actor_is_operational_v1\(/i);
  const mutationAuthority = migration.slice(
    migration.indexOf('create function public.authorize_my_creator_premium_image_upload_v1'),
    migration.indexOf('create function public.get_my_creator_premium_image_media_v1'),
  );
  assert.doesNotMatch(mutationAuthority, /p_creator_id\s+uuid/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.[^(]*(?:publish|purchase|subscribe|refund|renew|payout)/i);
});

test('B2 pair replacement serializes, replays idempotently, and schedules only unlinked old assets', () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*creator-premium-image-media/i);
  assert.match(migration, /p_teaser_asset_id\s+is\s+null[\s\S]*p_original_asset_id\s+is\s+null/i);
  assert.match(migration, /p_teaser_asset_id\s*=\s*p_original_asset_id/i);
  assert.match(migration, /replayed/i);
  assert.match(migration, /delete\s+from\s+public\.media_asset_links[\s\S]*entity_type\s*=\s*'creator_premium_content'/i);
  assert.match(migration, /public\.schedule_media_asset_deletion\(/i);
  assert.match(migration, /replacement_cleanup_scheduled/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.media_assets/i);
});

test('B2 hides Premium link/private-original metadata behind narrow RPCs', () => {
  assert.match(migration, /drop\s+policy\s+media_asset_links_owner_read/i);
  assert.match(migration, /entity_type\s+not\s+in\s*\(\s*'story'\s*,\s*'creator_premium_content'\s*\)/i);
  assert.match(migration, /drop\s+policy\s+media_asset_links_public_read/i);
  assert.match(migration, /drop\s+policy\s+media_assets_owner_read/i);
  assert.match(migration, /purpose\s*<>\s*'creator_premium_original_image'/i);
  assert.match(migration, /media_asset_has_valid_links[\s\S]*creator_premium_content[\s\S]*creator_premium_contents/i);
});

test('B2 extends existing catalog and owner projections with teaser-safe state only', () => {
  assert.match(migration, /drop\s+function\s+public\.get_creator_premium_catalog_v1\(uuid\s*,\s*integer\s*,\s*timestamptz\s*,\s*uuid\)/i);
  assert.match(migration, /get_creator_premium_catalog_v1[\s\S]*teaser_url\s+text/i);
  assert.match(migration, /get_my_creator_premium_contents_v1[\s\S]*teaser_attached\s+boolean[\s\S]*original_attached\s+boolean[\s\S]*image_media_ready\s+boolean/i);
  assert.match(migration, /creator_premium_teaser_image/i);
  for (const forbidden of [
    'original_asset_id', 'content_url', 'preview_url', 'hls_url', 'dash_url',
    'cloudflare_uid', 'financial_transaction_id',
  ]) assert.doesNotMatch(migration, new RegExp(`returns\\s+table\\s*\\([^)]*\\b${forbidden}\\b`, 'is'));
});

test('B2 migration contains no finance movement or Stream/video authority changes', () => {
  assert.doesNotMatch(migration, /atomic_ledger_transfer|ledger_debit|ledger_credit|insert\s+into\s+public\.financial_transactions|insert\s+into\s+public\.ledger_entries/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.video_assets|alter\s+table\s+public\.video_asset_links|cloudflare_stream|hls_url|dash_url/i);
});
