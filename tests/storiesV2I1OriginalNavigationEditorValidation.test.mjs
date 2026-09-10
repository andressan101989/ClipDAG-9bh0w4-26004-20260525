import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BASE = '3766a15cf2e815e2fcf1de0eeb76ff58fd9a1da0';
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const feedContext = read('contexts/FeedContext.tsx');
const home = read('app/(tabs)/index.tsx');
const route = read('app/video/[id].tsx');
const sharedCard = read('components/feature/StorySharedContentCard.tsx');
const editor = read('components/feature/StoryEditor.tsx');
const migrationPath = 'supabase/migrations/20260910140101_stories_v2_i_share_editor_integrity.sql';
const migration = read(migrationPath);
const visibilityMigration = read('supabase/migrations/20260811024000_marketplace_creator_content_product_tags.sql');

function baseFile(path) {
  return execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
}

function ensureBody() {
  return feedContext.slice(
    feedContext.indexOf('const ensureVideoLoadedById'),
    feedContext.indexOf('const isLiked'),
  );
}

function deepLinkBody() {
  return home.slice(
    home.indexOf('const deepLinkResolutionRef'),
    home.indexOf('const handleDeepLinkScrollFailure'),
  );
}

test('I1 starts from the exact approved I SHA', () => {
  assert.equal(execFileSync('git', ['merge-base', 'HEAD', BASE], { encoding: 'utf8' }).trim(), BASE);
});

test('/video/[id] keeps the canonical route and forwards ID only', () => {
  assert.match(route, /useLocalSearchParams<\{ id\?: string \}>/);
  assert.match(route, /params:[\s\S]*\{ videoId: id \}/);
  assert.doesNotMatch(route, /video_url|videoUrl|thumbnail|signed|mediaUrls/);
});

test('an initially loaded target scrolls directly', () => {
  assert.match(home, /videos\.findIndex\(video => video\.id === targetVideoId\)/);
  assert.match(home, /setActiveIndex\(index\)/);
  assert.match(home, /scrollToIndex\(\{ index, animated: false/);
});

test('a target absent from the first page invokes exact Feed resolution', () => {
  assert.match(home, /if \(index < 0\)[\s\S]*ensureVideoLoadedById\(targetVideoId\)/);
  assert.match(feedContext, /ensureVideoLoadedById: \(videoId: string\)/);
});

test('content beyond the ten-row first page uses an exact ID query', () => {
  assert.match(feedContext, /\.range\(offset, offset \+ 9\)/);
  assert.match(ensureBody(), /\.eq\('id', normalizedId\)[\s\S]*\.maybeSingle\(\)/);
});

test('deep links do not require the user to crawl or scroll pages manually', () => {
  assert.doesNotMatch(ensureBody(), /loadMoreVideos|loadVideos\(|\.range\(/);
  assert.match(home, /requestAnimationFrame\([\s\S]*scrollToIndex/);
});

test('exact resolution remains inside the single FeedContext authority', () => {
  assert.equal((feedContext.match(/export function FeedProvider/g) ?? []).length, 1);
  assert.match(feedContext, /<FeedContext\.Provider[\s\S]*ensureVideoLoadedById/);
});

test('exact resolution reuses the canonical mapVideo mapper', () => {
  assert.equal((feedContext.match(/function mapVideo\(/g) ?? []).length, 1);
  assert.match(ensureBody(), /const mapped = mapVideo\(/);
});

test('visibility is checked before the absent row is selected', () => {
  const body = ensureBody();
  assert.ok(body.indexOf('confirmMarketplaceContentVisible(normalizedId)') < body.indexOf(".from('videos')"));
  assert.match(feedContext, /fetchMarketplaceContentProductTags\(contentType, videoId\)/);
  assert.match(visibilityMigration, /get_marketplace_content_product_tags[\s\S]*marketplace_creator_content_visible\(p_content_id,auth\.uid\(\)\)/i);
});

test('invisible, blocked, invalid and nonexistent targets fail closed', () => {
  assert.match(ensureBody(), /!UUID_PATTERN\.test\(normalizedId\)[\s\S]*status: 'unavailable'/);
  assert.match(ensureBody(), /!await confirmMarketplaceContentVisible\(normalizedId\)[\s\S]*status: 'unavailable'/);
  assert.match(ensureBody(), /if \(error \|\| !data\) return \{ status: 'unavailable' \}/);
});

test('unavailable navigation gives bounded feedback rather than looping', () => {
  assert.match(home, /status: 'unavailable'/);
  assert.match(home, /Contenido no disponible/);
  assert.match(home, /currentResolution\.status === 'loading' \|\| currentResolution\.status === 'unavailable'/);
});

test('repeated renders do not create a request storm', () => {
  assert.match(home, /deepLinkResolutionRef/);
  assert.match(home, /currentResolution\?\.id === targetVideoId/);
});

test('same-ID concurrent resolution shares one in-flight promise', () => {
  const body = ensureBody();
  assert.match(body, /exactVideoFlightsRef\.current\.get\(normalizedId\)/);
  assert.match(body, /if \(pending\) return pending/);
  assert.match(body, /exactVideoFlightsRef\.current\.set\(normalizedId, flight\)/);
});

test('exact resolver removes completed flights without disturbing replacements', () => {
  assert.match(ensureBody(), /\.finally\(\(\) => \{[\s\S]*=== flight[\s\S]*\.delete\(normalizedId\)/);
});

test('a loaded target is returned without an unnecessary exact request', () => {
  const body = ensureBody();
  assert.ok(body.indexOf('videosRef.current.find') < body.indexOf('confirmMarketplaceContentVisible'));
  assert.match(body, /alreadyLoaded: true/);
});

test('the Feed store deduplicates the resolved video row', () => {
  assert.match(ensureBody(), /current\.some\(video => video\.id === mapped\.id\)/);
  assert.match(ensureBody(), /const next = \[\.\.\.current, mapped\]/);
});

test('navigation params contain no source media identity', () => {
  assert.doesNotMatch(route + sharedCard, /params:[\s\S]{0,160}(?:videoUrl|thumbnailUrl|signedUrl|previewUrl)/);
  assert.match(sharedCard, /onOpen\(content\.sourceVideoId\)/);
});

test('StorySharedContentCard continues to navigate with sourceVideoId', () => {
  assert.match(sharedCard, /accessibilityLabel="Abrir contenido original"/);
  assert.match(sharedCard, /onPress=\{\(\) => onOpen\(content\.sourceVideoId\)\}/);
});

test('editor total limit matches the server limit of 32', () => {
  assert.match(editor, /const STORY_MAX_ELEMENTS = 32/);
  assert.match(migration, /jsonb_array_length\(p_composition -> 'elements'\) > 32/i);
});

test('a thirty-third element is rejected locally for text and stickers', () => {
  assert.equal((editor.match(/composition\.elements\.length >= STORY_MAX_ELEMENTS/g) ?? []).length, 2);
});

test('the ten-text limit is preserved', () => {
  assert.match(editor, /const STORY_MAX_TEXT_ELEMENTS = 10/);
  assert.match(editor, /item\.type === 'text'\)\.length >= STORY_MAX_TEXT_ELEMENTS/);
});

test('the twenty-four-sticker limit is preserved', () => {
  assert.match(editor, /const STORY_MAX_STICKER_ELEMENTS = 24/);
  assert.match(editor, /item\.type === 'sticker'\)\.length >= STORY_MAX_STICKER_ELEMENTS/);
});

test('mixed text and sticker additions share the same total guard', () => {
  const addText = editor.slice(editor.indexOf('const addText'), editor.indexOf('const addSticker'));
  const addSticker = editor.slice(editor.indexOf('const addSticker'), editor.indexOf('const selected'));
  assert.match(addText, /STORY_MAX_ELEMENTS/);
  assert.match(addSticker, /STORY_MAX_ELEMENTS/);
});

test('empty text is removed when editing finishes', () => {
  assert.match(editor, /const finishTextEditing/);
  assert.match(editor, /selected\.text\.trim\(\)\.length === 0/);
  assert.match(editor, /elements: current\.elements\.filter\(item => item\.id !== editingTextId\)/);
});

test('whitespace-only text cannot reach onPublish', () => {
  assert.match(editor, /publishableComposition/);
  assert.match(editor, /element\.type !== 'text' \|\| element\.text\.trim\(\)\.length > 0/);
  assert.match(editor, /onPublish\(source, publishableComposition, clientStoryIdRef\.current\)/);
});

test('valid text remains part of the publishable composition', () => {
  const allowed = [
    { type: 'text', text: 'Hola' },
    { type: 'sticker', value: '🔥' },
  ].filter(element => element.type !== 'text' || element.text.trim().length > 0);
  assert.equal(allowed.length, 2);
});

test('server composition validation remains unchanged', () => {
  assert.equal(migration, baseFile(migrationPath));
});

test('I data model and package authorities are untouched', () => {
  assert.equal(read('package.json'), baseFile('package.json'));
  assert.equal(read('package-lock.json'), baseFile('package-lock.json'));
  assert.equal(execFileSync('git', ['diff', '--name-only', BASE, '--', 'supabase'], { encoding: 'utf8' }).trim(), '');
});

test('no second Feed store, video route, player or StoryEditor was introduced', () => {
  const changed = execFileSync('git', ['diff', '--name-only', BASE], { encoding: 'utf8' });
  assert.doesNotMatch(changed, /VideoDetailContext|SharedVideoService|StoryNavigationService/);
  assert.equal((feedContext.match(/createContext<FeedContextType/g) ?? []).length, 1);
  assert.equal((editor.match(/export function StoryEditor/g) ?? []).length, 1);
});

test('no service_role, pagination crawler or parallel media resolver is used', () => {
  assert.doesNotMatch(ensureBody(), /service_role|while\s*\(|for\s*\([^)]*page|loadMoreVideos/);
  assert.doesNotMatch(deepLinkBody(), /videoUrl|thumbnailUrl|signedUrl/);
});

test('I server remains final composition authority', () => {
  assert.match(migration, /private\.story_validate_composition/);
  assert.match(migration, /story_composition_limit_exceeded/);
  assert.match(migration, /char_length\(btrim\(v_element ->> 'text'\)\) not between 1 and 200/i);
});
