import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const BASE = 'a455d4e00475540b9ff6fdf95e2e22215dbfa15e';
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migrationName = readdirSync('supabase/migrations').find(name => name.endsWith('_stories_v2_i_share_editor_integrity.sql'));
assert.ok(migrationName, 'I migration must exist');
const migration = read(`supabase/migrations/${migrationName}`);
const context = read('contexts/StoriesContext.tsx');
const editor = read('components/feature/StoryEditor.tsx');
const composition = read('components/feature/storyComposition.tsx');
const sharedCard = read('components/feature/StorySharedContentCard.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const storiesBar = read('components/feature/StoriesBar.tsx');
const feed = read('app/(tabs)/index.tsx');
const nativeVideoCard = read('components/feature/VideoCard.native.tsx');
const webVideoCard = read('components/feature/VideoCard.tsx');
const videoRoute = read('app/video/[id].tsx');
const h1 = read('tests/storiesV2H1ReplyIdempotency.test.mjs');

function baseFile(path) {
  return execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
}

test('I is based on the exact approved H1 commit and keeps package authorities unchanged', () => {
  const mergeBase = execFileSync('git', ['merge-base', 'HEAD', BASE], { encoding: 'utf8' }).trim();
  assert.equal(mergeBase, BASE);
  assert.equal(read('package.json'), baseFile('package.json'));
  assert.equal(read('package-lock.json'), baseFile('package-lock.json'));
});

test('canonical Feed, Reel and Post identity remains public.videos', () => {
  assert.match(migration, /references public\.videos\(id\) on delete set null/i);
  assert.match(migration, /from public\.videos v/i);
  assert.match(migration, /marketplace_video_content_type\(p_video_id\)/i);
  assert.doesNotMatch(migration, /create table[^;]*(?:public\.)?(?:posts|reels)\b/i);
  assert.doesNotMatch(migration, /shared_posts|shared_reels/i);
});

test('shared Story stores an ID reference rather than source URLs or copied assets', () => {
  assert.match(migration, /shared_video_id uuid/);
  assert.match(migration, /foreign key \(shared_video_id\) references public\.videos\(id\) on delete set null/i);
  const sharedCreate = migration.slice(migration.indexOf('create or replace function public.create_story_from_content'), migration.indexOf('create or replace function public.get_story_shared_content'));
  assert.doesNotMatch(sharedCreate, /insert into public\.media_assets|insert into public\.video_assets/i);
  assert.doesNotMatch(sharedCreate, /insert into public\.media_asset_links|insert into public\.video_asset_links/i);
  assert.doesNotMatch(sharedCreate, /video_url|thumbnail_url|preview_url/i);
  assert.doesNotMatch(sharedCreate, /download|upload/i);
});

test('source owner and Feed/Reel type are derived server-side', () => {
  assert.match(migration, /marketplace_creator_content_visible\(p_video_id, v_actor\)/i);
  assert.match(migration, /v_content_type := public\.marketplace_video_content_type\(p_video_id\)/i);
  assert.doesNotMatch(migration, /p_owner|p_username|p_thumbnail|p_content_type/i);
  assert.match(migration, /v_content_type not in \('feed','reel'\)/i);
});

test('shared create is authenticated, atomic, active for 24-hour Story defaults, and idempotent', () => {
  assert.match(migration, /create or replace function public\.create_story_from_content/i);
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /not_authenticated/i);
  assert.match(migration, /client_story_id = p_client_story_id/i);
  assert.match(migration, /story_idempotency_conflict/i);
  assert.match(migration, /insert into public\.stories/i);
  assert.doesNotMatch(migration, /expires_at\s*[,)]/i);
});

test('source deletion preserves the Story shell and current authorization controls the preview', () => {
  assert.match(migration, /on delete set null/i);
  assert.match(migration, /v_story\.shared_video_id is null[\s\S]*'unavailable'/i);
  assert.match(migration, /not public\.marketplace_creator_content_visible\(v_story\.shared_video_id, v_actor\)/i);
  assert.match(migration, /return query select 'unavailable'::text, null::uuid/i);
  assert.doesNotMatch(migration, /on delete cascade[^;]*shared_video/i);
});

test('shared resolver validates the Story and leaks no source fields when unavailable', () => {
  assert.match(migration, /s\.expires_at > now\(\)/i);
  assert.match(migration, /private\.story_can_view_owner\(s\.user_id\)/i);
  assert.match(migration, /story_not_visible/i);
  assert.match(migration, /'unavailable'::text, null::uuid, null::text,[\s\S]*null::text/i);
  assert.match(sharedCard, /Contenido no disponible/);
});

test('composition is versioned JSON with normalized coordinates and bounded payload', () => {
  assert.match(migration, /story_composition jsonb not null/);
  assert.match(migration, /'\{"version":1,"elements":\[\]\}'::jsonb/);
  assert.match(migration, /octet_length\(p_composition::text\) > 32768/i);
  assert.match(migration, /jsonb_array_length\(p_composition -> 'elements'\) > 32/i);
  assert.match(migration, /\(v_element ->> 'x'\)::numeric not between 0 and 1/i);
  assert.match(migration, /\(v_element ->> 'y'\)::numeric not between 0 and 1/i);
});

test('composition rejects unsafe ranges, unknown types, arbitrary keys and URL stickers', () => {
  assert.match(migration, /scale'\)::numeric not between 0\.5 and 4/i);
  assert.match(migration, /rotation'\)::numeric not between -180 and 180/i);
  assert.match(migration, /v_type not in \('text', 'sticker'\)/i);
  assert.match(migration, /jsonb_object_keys\(v_element\)/i);
  assert.match(migration, /story_composition_limit_exceeded/i);
  assert.match(migration, /count\(distinct value ->> 'id'\)[\s\S]*duplicate_story_element_id/i);
  assert.doesNotMatch(migration, /https?:\/\/[^']*'\)/i);
});

test('text elements have bounded plain text and safe visual presets', () => {
  assert.match(migration, /char_length\(btrim\(v_element ->> 'text'\)\) not between 1 and 200/i);
  assert.match(migration, /\(v_element ->> 'text'\) ~ '\[<>\]'/i);
  assert.match(migration, /v_text_count > 10/i);
  assert.match(migration, /'small','medium','large'/i);
  assert.match(migration, /'#FFFFFF','#111111','#FF2D78','#7C5CFF','#00D4FF','#FFD60A'/i);
});

test('stickers are local presets and capped', () => {
  for (const emoji of ['❤️', '😂', '😮', '😢', '🔥', '👏', '✨', '⭐', '💯', '🎉', '😍']) {
    assert.ok(composition.includes(emoji));
    assert.ok(migration.includes(`'${emoji}'`));
  }
  assert.match(migration, /v_sticker_count > 24/i);
  assert.doesNotMatch(editor, /giphy|tenor|fetch\(/i);
});

test('one editor supports own photo, own video, and shared content', () => {
  assert.match(editor, /kind: 'media'[\s\S]*mediaType: 'photo' \| 'video'/);
  assert.match(editor, /kind: 'shared'/);
  assert.match(editor, /EditorVideoPreview/);
  assert.match(editor, /sharedPreview/);
  assert.equal(readdirSync('components/feature').filter(name => name === 'StoryEditor.tsx').length, 1);
});

test('editor supports create, edit, drag, pinch-scale, color, size, select and delete', () => {
  assert.match(editor, /PanResponder\.create/);
  assert.match(editor, /gesture\.dx \/ CANVAS_W/);
  assert.match(editor, /gesture\.dy \/ CANVAS_H/);
  assert.match(editor, /start\.current\.scale \* pinch \/ start\.current\.pinch/);
  assert.match(editor, /setEditingTextId/);
  assert.match(editor, /STORY_TEXT_COLORS\.indexOf/);
  assert.match(editor, /format-size/);
  assert.match(editor, /elements\.filter\(item => item\.id !== selected\.id\)/);
});

test('editor uses normalized composition and safe text cleanup', () => {
  assert.match(composition, /x: number/);
  assert.match(composition, /y: number/);
  assert.match(editor, /Math\.max\(0, Math\.min\(1,/);
  assert.match(editor, /maxLength=\{200\}/);
  assert.match(editor, /text\.replace\(\/\[<>\]\/g, ''\)/);
  assert.match(composition, /element\.x \* width/);
  assert.match(composition, /element\.y \* height/);
});

test('cancel is local while publish is guarded and preserves the draft on failure', () => {
  assert.match(editor, /const cancel = \(\) => \{ if \(!publishing\) onCancel\(clientStoryIdRef\.current \?\? undefined\); \}/);
  assert.match(editor, /onRequestClose=\{cancel\}/);
  assert.match(editor, /if \(!source \|\| publishing\) return/);
  assert.match(editor, /setPublishing\(true\)/);
  assert.match(editor, /catch \{[\s\S]*setError\(true\)/);
  assert.match(editor, /Tu edición sigue aquí/);
  assert.doesNotMatch(editor, /story_drafts|\.from\(['"]stories['"]\)/i);
});

test('one client Story id survives retries and new editor sessions get a new id', () => {
  assert.match(editor, /clientStoryIdRef = useRef<string \| null>/);
  assert.match(editor, /clientStoryIdRef\.current = Crypto\.randomUUID\(\)/);
  assert.match(editor, /if \(!clientStoryIdRef\.current\) clientStoryIdRef\.current = Crypto\.randomUUID\(\)/);
  assert.match(editor, /onPublish\(source, publishableComposition, clientStoryIdRef\.current\)/);
  assert.doesNotMatch(context.slice(context.indexOf('const addSharedStory'), context.indexOf('const getStorySharedContent')), /randomUUID/);
  assert.match(feed, /storyUploadAttemptsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(feed, /storyUploadAttemptsRef\.current\.get\(clientStoryId\)/);
  assert.match(feed, /storyUploadAttemptsRef\.current\.set\(clientStoryId, uploaded\.assetId\)/);
  assert.match(feed, /storyUploadAttemptsRef\.current\.delete\(clientStoryId\)/);
});

test('own media keeps the canonical upload/finalize and compensating cleanup path', () => {
  assert.match(feed, /uploadMediaFromUri\(/);
  assert.match(feed, /purpose: isVideo \? 'story_video' : 'story_image'/);
  assert.match(feed, /visibility: 'private'/);
  assert.match(feed, /addStory\(uploadedAssetId, composition, clientStoryId\)/);
  assert.match(feed, /const cancelStoryEditor = useCallback/);
  assert.match(feed, /deleteMediaAsset\(uploadedAssetId\)/);
  assert.match(migration, /private\.create_story_with_media_core/);
});

test('legacy and composed own-media creation delegate to one core', () => {
  const coreCalls = migration.match(/private\.create_story_with_media_core\(/g) ?? [];
  assert.ok(coreCalls.length >= 3);
  assert.match(migration, /public\.create_story_with_media\([\s\S]*p_composition jsonb[\s\S]*p_client_story_id uuid/);
  assert.match(migration, /public\.create_story_with_media\(p_asset_id uuid\)[\s\S]*private\.create_story_with_media_core/i);
  assert.equal((context.match(/rpc\('create_story_with_media'/g) ?? []).length, 1);
  assert.doesNotMatch(feed, /\.from\(['"]stories['"]\).*insert/is);
});

test('Viewer renders shared content and overlays in both platform authorities', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /StorySharedContentCard/);
    assert.match(viewer, /currentStory\.storyKind === 'shared'/);
    assert.match(viewer, /StoryCompositionOverlay composition=\{currentStory\.composition\}/);
    assert.match(viewer, /onGetSharedContent/);
  }
  assert.match(storiesBar, /storyKind: 'media' \| 'shared'/);
  assert.match(storiesBar, /composition: StoryComposition/);
});

test('shared preview opens only the canonical original ID route', () => {
  assert.match(sharedCard, /onOpen\(content\.sourceVideoId\)/);
  assert.match(nativeViewer, /router\.push\(`\/video\/\$\{videoId\}`/);
  assert.match(webViewer, /router\.push\(`\/video\/\$\{videoId\}`/);
  assert.match(videoRoute, /useLocalSearchParams/);
  assert.match(videoRoute, /params:[\s\S]*videoId: id/);
  assert.doesNotMatch(videoRoute + nativeViewer + webViewer, /videoUrl|thumbnailUrl|signedUrl/);
});

test('Feed share UI enters the same StoryEditor for Feed and Reel content', () => {
  assert.match(nativeVideoCard, /Añadir a historia/);
  assert.match(webVideoCard, /Añadir a historia/);
  assert.match(feed, /onAddToStory=\{\(\) => setStoryEditorSource/);
  assert.match(feed, /marketplaceContentTypeForMedia\(item\.videoUrl, item\.mediaUrls\)/);
  assert.match(feed, /<StoryEditor/);
  assert.equal((feed.match(/\n\s*<StoryEditor\s/g) ?? []).length, 1);
});

test('shared creation creates no Story media link and media Stories still create exactly one', () => {
  const sharedCreate = migration.slice(migration.indexOf('create or replace function public.create_story_from_content'), migration.indexOf('create or replace function public.get_story_shared_content'));
  const mediaCore = migration.slice(migration.indexOf('create or replace function private.create_story_with_media_core'), migration.indexOf('create or replace function public.create_story_with_media'));
  assert.doesNotMatch(sharedCreate, /media_asset_links/i);
  assert.equal((mediaCore.match(/insert into public\.media_asset_links/g) ?? []).length, 1);
  assert.match(migration, /story_kind = 'media' and shared_video_id is null/i);
  assert.match(migration, /story_kind = 'shared' and media_url is null/i);
});

test('function ACLs keep Story writes server-side and anonymous callers denied', () => {
  for (const signature of [
    'create_story_with_media\\(uuid,jsonb,uuid\\)',
    'create_story_from_content\\(uuid,jsonb,uuid\\)',
    'get_story_shared_content\\(uuid\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon`, 'i'));
  }
  assert.match(migration, /grant execute on function public\.create_story_from_content\(uuid,jsonb,uuid\)[\s\S]*to authenticated/i);
  assert.match(migration, /security definer[\s\S]*set search_path to 'pg_catalog', 'public'/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*public\.stories/i);
});

test('Realtime and interaction authorities remain B through H1', () => {
  assert.equal((context.match(/\.channel\(`stories-v2:/g) ?? []).length, 1);
  assert.match(context, /table: 'stories'/);
  assert.doesNotMatch(migration, /alter publication|supabase_realtime/i);
  assert.doesNotMatch(migration, /story_views.*publication|story_reactions.*publication/is);
  assert.match(nativeViewer + webViewer, /onReplyToStory/);
  assert.match(nativeViewer + webViewer, /onSetReaction/);
  assert.match(h1, /same logical message/i);
});

test('no parallel Stories, media, draft or source architecture was introduced', () => {
  const files = readdirSync('components/feature');
  assert.equal(files.filter(name => /^StoryViewer(?:\.|$)/.test(name)).sort().join(','), 'StoryViewer.native.tsx,StoryViewer.tsx');
  assert.equal(files.filter(name => /^StoryEditor\./.test(name)).length, 1);
  assert.equal(readdirSync('contexts').filter(name => /StoriesContext/.test(name)).length, 1);
  assert.doesNotMatch(migration + feed + editor, /create table[^;]*story_drafts|StoryUploadService|SharedVideoUpload|download.*upload/is);
  assert.doesNotMatch(migration, /create table[^;]*(?:posts|reels|shared_content)/i);
});

test('source references, composition and client IDs are never navigation media identities', () => {
  assert.doesNotMatch(migration, /signed_url|r2_url|hls_url/i);
  assert.doesNotMatch(context, /shared.*(?:video_url|thumbnail_url)/i);
  assert.doesNotMatch(sharedCard, /navigation.*(?:previewUrl|mediaUrl)/i);
  assert.match(context, /p_video_id: videoId/);
  assert.match(context, /p_composition: composition/);
  assert.match(context, /p_client_story_id: clientStoryId/);
});
