import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20260908233853_stories_v2_c_private_media_lifecycle.sql');
const registry = read('supabase/functions/_shared/mediaPurposes.ts');
const mediaClient = read('services/mediaService.ts');
const getMediaUrl = read('supabase/functions/get-media-url/index.ts');
const r2 = read('supabase/functions/_shared/r2.ts');
const storiesContext = read('contexts/StoriesContext.tsx');
const storiesBar = read('components/feature/StoriesBar.tsx');
const storyHook = read('components/feature/useStoryMediaUrl.ts');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const feed = read('app/(tabs)/index.tsx');
const cleanup = read('supabase/migrations/20260726105000_media_public_urls_and_safe_links.sql');

function loadRegistry() {
  const module = { exports: {} };
  const output = ts.transpileModule(registry, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

const rules = loadRegistry();

test('story_image accepts safe image MIME types only as private media', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.ok(!('error' in rules.validateMediaRequest('story_image', mime, 1, 'private')));
  }
  assert.equal(rules.validateMediaRequest('story_image', 'video/mp4', 1, 'private').error, 'invalid_mime_type');
  assert.equal(rules.validateMediaRequest('story_image', 'image/jpeg', 1, 'public').error, 'visibility_not_allowed');
});

test('story_video accepts MP4 and QuickTime only as private media', () => {
  for (const mime of ['video/mp4', 'video/quicktime']) {
    assert.ok(!('error' in rules.validateMediaRequest('story_video', mime, 1, 'private')));
  }
  assert.equal(rules.validateMediaRequest('story_video', 'video/webm', 1, 'private').error, 'invalid_mime_type');
  assert.equal(rules.validateMediaRequest('story_video', 'video/mp4', 1, 'public').error, 'visibility_not_allowed');
});

test('Story purpose sizes and the shared image normalizer remain canonical', () => {
  assert.equal(rules.MEDIA_PURPOSES.story_image.maxBytes, 25_000_000);
  assert.equal(rules.MEDIA_PURPOSES.story_video.maxBytes, 100_000_000);
  assert.match(mediaClient, /const IMAGE_PURPOSES = new Set<MediaPurpose>\([\s\S]*"story_image"/);
});

test('new photo and video callers upload private Story-specific media', () => {
  assert.match(feed, /purpose: isVideo \? 'story_video' : 'story_image'/);
  assert.match(feed, /visibility: 'private'/);
  assert.match(feed, /if \(uploaded\.url\) throw new Error\('Private Story upload returned a persistent URL'\)/);
  assert.doesNotMatch(feed, /purpose: isVideo \? 'story_video' : 'post_image'/);
});

test('canonical private Story creation derives type and stores no URL', () => {
  assert.match(migration, /a\.visibility = 'private'[\s\S]*a\.public_url is null/);
  assert.match(migration, /a\.media_kind = 'image' and a\.purpose = 'story_image'/);
  assert.match(migration, /a\.media_kind = 'video' and a\.purpose = 'story_video'/);
  assert.match(migration, /insert into public\.stories\(user_id, media_url, media_type\)\s+values\(v_actor, v_media_url, v_media_type\)/i);
  assert.match(migration, /when a\.media_kind = 'image'[\s\S]*a\.purpose = 'post_image'[\s\S]*then a\.public_url[\s\S]*else null/i);
});

test('migration fails closed if a linked B-era Story still uses public Story media', () => {
  assert.match(migration, /a\.purpose in \('story_image', 'story_video'\)/);
  assert.match(migration, /a\.visibility <> 'private'/);
  assert.match(migration, /story_private_media_reconciliation_required/);
  assert.doesNotMatch(migration, /update public\.media_assets[\s\S]*visibility = 'private'/i);
});

test('canonical creation preserves owner READY R2 locking and asset reuse denial', () => {
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /where a\.id = p_asset_id\s+for update/i);
  assert.match(migration, /a\.owner_id = v_actor/);
  assert.match(migration, /a\.provider = 'r2'/);
  assert.match(migration, /a\.status = 'ready'/);
  assert.match(migration, /where l\.asset_id = p_asset_id/);
  assert.match(migration, /story_asset_already_linked/);
});

test('legacy public post_image compatibility remains inside the same creation RPC', () => {
  assert.match(migration, /a\.visibility = 'public'[\s\S]*a\.public_url ~\* '\^https:\/\/'[\s\S]*a\.purpose = 'post_image'/);
  assert.equal((migration.match(/create or replace function public\.create_story_with_media/g) ?? []).length, 1);
  assert.doesNotMatch(feed, /'post_image'/);
});

test('media_url becomes nullable legacy fallback and signed URLs are never persisted', () => {
  assert.match(migration, /alter column media_url drop not null/);
  assert.match(migration, /Legacy public HTTPS fallback only/);
  assert.doesNotMatch(migration, /signed_url|expiresAt|values\([^)]*object_key/i);
  assert.doesNotMatch(storiesContext, /mediaUrl:\s*row\.media_url\s*as string/);
});

test('Story media links have one canonical shape and unique slot position', () => {
  assert.match(migration, /media_asset_links_story_shape_check[\s\S]*entity_type <> 'story'[\s\S]*slot = 'media' and position = 0/);
  assert.match(migration, /create unique index story_media_slot_position_unique[\s\S]*\(entity_id, slot, position\)[\s\S]*where entity_type = 'story'/);
  assert.match(migration, /values\(p_asset_id, 'story', v_story_id, 'media', 0\)/);
});

test('Story link discovery is active, authenticated and delegated to Story RLS', () => {
  assert.match(migration, /create policy media_asset_links_owner_read[\s\S]*entity_type <> 'story'/);
  assert.match(migration, /create policy media_asset_links_public_read[\s\S]*entity_type <> 'story'/);
  assert.match(migration, /create policy media_asset_links_story_visible_read/);
  assert.match(migration, /to authenticated/);
  assert.match(migration, /from public\.stories s[\s\S]*s\.id = media_asset_links\.entity_id[\s\S]*s\.expires_at > now\(\)/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*media_asset_links/i);
});

test('get-media-url authorizes a linked active Story before signing', () => {
  const storyBranch = getMediaUrl.slice(getMediaUrl.indexOf("const storyKindMatches"), getMediaUrl.indexOf("if(a.purpose==='chat_image'"));
  assert.match(getMediaUrl, /authenticatedClient\(req\)[\s\S]*caller\.from\('stories'\)/);
  assert.match(getMediaUrl, /\.eq\('entity_type','story'\)[\s\S]*\.eq\('slot','media'\)[\s\S]*\.eq\('position',0\)/);
  assert.match(getMediaUrl, /\.gt\('expires_at',new Date\(\)\.toISOString\(\)\)/);
  assert.ok(storyBranch.indexOf('visibleStoryForAsset') < storyBranch.indexOf('signGet'));
  assert.match(storyBranch, /a\.visibility!=='private'/);
  assert.match(storyBranch, /signedTtlSeconds=Math\.min\(300,remainingSeconds\)/);
  assert.match(storyBranch, /signGet\(a\.bucket_name,a\.object_key,signedTtlSeconds\)/);
  assert.match(r2, /signGet=\(bucket:string,key:string,expiresIn=300\)/);
});

test('unlinked, wrong-kind and wrong-entity Story assets fail closed', () => {
  assert.match(getMediaUrl, /linksError\|\|links\?\.length!==1/);
  assert.match(getMediaUrl, /story_image'&&a\.media_kind==='image'/);
  assert.match(getMediaUrl, /story_video'&&a\.media_kind==='video'/);
  assert.match(getMediaUrl, /if\(!story\)return corsJson\(\{error:'forbidden'\},403\)/);
});

test('chat, marketplace, return-label and generic owner-private paths remain present', () => {
  assert.match(getMediaUrl, /chat_authorize_media_access/);
  assert.match(getMediaUrl, /sellerMayReadBuyerDisputeEvidence/);
  assert.match(getMediaUrl, /adminMayReadDisputeEvidence/);
  assert.match(getMediaUrl, /returnParticipantMayReadLabel/);
  assert.match(getMediaUrl, /a\.visibility==='private'&&a\.owner_id!==user\.id/);
});

test('StoriesContext discovers one opaque asset ID per visible Story', () => {
  assert.match(storiesBar, /mediaAssetId\?: string/);
  assert.match(storiesContext, /\.from\('media_asset_links'\)[\s\S]*\.eq\('entity_type', 'story'\)[\s\S]*\.eq\('slot', 'media'\)[\s\S]*\.eq\('position', 0\)/);
  assert.match(storiesContext, /mediaAssetId: storyAssetIds\.get\(row\.id\)/);
  assert.doesNotMatch(storiesContext, /bucket_name|object_key/);
});

test('canonical playback uses get-media-url and legacy playback uses HTTPS media_url only without a link', () => {
  assert.match(storyHook, /if \(!story\.mediaAssetId\)[\s\S]*\^https:\\\/\\\//);
  assert.match(storyHook, /getMediaUrl\(story\.mediaAssetId\)/);
  assert.match(storyHook, /SIGNED_URL_REFRESH_MS = 270_000/);
  assert.match(nativeViewer, /useStoryMediaUrl\(story, isActive\)/);
  assert.match(webViewer, /useStoryMediaUrl\(story, isActive\)/);
  assert.doesNotMatch(nativeViewer, /source=\{\{ uri: story\.mediaUrl \}\}/);
  assert.doesNotMatch(webViewer, /source=\{\{ uri: story\.mediaUrl \}\}/);
});

test('signed URLs remain component-local with loading, error and retry states', () => {
  assert.match(storyHook, /useState<string \| null>\(null\)/);
  assert.doesNotMatch(storyHook + storiesContext, /AsyncStorage|SecureStore|\.from\('stories'\)\.update/);
  assert.match(nativeViewer, /ActivityIndicator/);
  assert.match(nativeViewer, /Historia no disponible/);
  assert.match(nativeViewer, />Reintentar</);
});

test('existing expiry cleanup remains the only Story object cleanup authority', () => {
  assert.match(cleanup, /delete from public\.media_asset_links l[\s\S]*l\.entity_type='story'[\s\S]*s\.expires_at<=now\(\)/i);
  assert.match(cleanup, /error_code='story_expired'/);
  assert.doesNotMatch(migration, /cleanup_stale_media_upload_records|cron\.schedule|deleteObject/);
});

test('C adds no parallel tables, signer, media service, bucket or engagement system', () => {
  assert.doesNotMatch(migration, /create table|insert into storage\.buckets|reaction|reply/i);
  assert.doesNotMatch(getMediaUrl, /get-story-media-url|story-signed-url/i);
  assert.doesNotMatch(storyHook, /createClient|getSupabaseClient|signGet|bucket_name|object_key/);
});
