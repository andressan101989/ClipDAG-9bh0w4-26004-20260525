import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const BASE = '8e77cee677aaa30047037743b5f19bf29074bac8';
const FIGMA_FILE_KEY = 'ckco6L81Y77fGFR0tgUtRi';
const FIGMA_NODES = ['2:7', '2:42', '2:82', '2:105', '2:131', '2:178'];
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const interactions = read('components/feature/StoryInteractions.tsx');
const effect = read('components/feature/StoryReactionEffect.tsx');
const shared = read('components/feature/StorySharedContentCard.tsx');
const editor = read('components/feature/StoryEditor.tsx');
const sheet = read('components/feature/StoryViewersSheet.tsx');
const bar = read('components/feature/StoriesBar.tsx');
const context = read('contexts/StoriesContext.tsx');
const i1 = read('contexts/FeedContext.tsx');

function baseFile(path) {
  return execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
}

test('J2 starts from the exact approved J base with client-only scope', () => {
  assert.equal(execFileSync('git', ['merge-base', 'HEAD', BASE], { encoding: 'utf8' }).trim(), BASE);
  assert.equal(read('package.json'), baseFile('package.json'));
  assert.equal(read('package-lock.json'), baseFile('package-lock.json'));
  assert.equal(execFileSync('git', ['diff', '--name-only', BASE, '--', 'supabase', 'android', 'ios'], { encoding: 'utf8' }).trim(), '');
});

test('all six approved Figma nodes are recorded as visual authority', () => {
  assert.equal(FIGMA_FILE_KEY, 'ckco6L81Y77fGFR0tgUtRi');
  assert.deepEqual(FIGMA_NODES, ['2:7', '2:42', '2:82', '2:105', '2:131', '2:178']);
  assert.match(nativeViewer, /node 2:7/);
  assert.match(webViewer, /node 2:7/);
  assert.match(effect, /node 2:42/);
  assert.match(shared, /node 2:82/);
  assert.match(editor, /node 2:105/);
  assert.match(sheet, /node 2:131/);
  assert.match(bar, /node 2:178/);
});

test('viewer hierarchy and geometry align with node 2:7', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /height: 150/);
    assert.match(viewer, /height: 234/);
    assert.match(viewer, /paddingHorizontal: 13/);
    assert.match(viewer, /gap: 4/);
    assert.match(viewer, /size=\{38\}/);
    assert.match(viewer, /paddingTop: Math\.max\(insets\.top \+ 26, 43\)/);
  }
  assert.match(interactions, /height: 48/);
  assert.match(interactions, /width: 44[\s\S]*height: 44/);
  assert.match(interactions, /backgroundColor: 'rgba\(24,24,32,0\.88\)'/);
});

test('viewer functional controls and gesture authorities remain intact', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /handleZonePress\('prev'\)/);
    assert.match(viewer, /handleZonePress\('next'\)/);
    assert.match(viewer, /PanResponder\.create/);
    assert.match(viewer, /accessibilityLabel="Cerrar historia"/);
    assert.match(viewer, /<StoryInteractions/);
    assert.match(viewer, /<StoryViewersSheet/);
  }
  assert.match(nativeViewer, /name=\{isMuted \? 'volume-off' : 'volume-up'\}/);
  assert.match(nativeViewer, /PHOTO_DURATION_MS = 15000/);
  assert.match(nativeViewer, /playToEnd/);
  assert.match(nativeViewer, /requestDelete/);
});

test('fullscreen fire geometry aligns with node 2:42 and remains ephemeral', () => {
  assert.match(effect, /fireHero/);
  assert.match(effect, /top: '39%'/);
  assert.match(effect, /fontSize: 88/);
  assert.match(effect, /width: 48[\s\S]*height: 48[\s\S]*borderRadius: 24/);
  assert.match(effect, /fontSize: 28/);
  assert.match(effect, /STORY_REACTION_EFFECT_DURATION_MS = 980/);
  assert.match(effect, /effectToken/);
  assert.match(effect, /generationRef/);
  assert.doesNotMatch(effect, /supabase|postgres_changes|channel\(|chat_send/i);
});

test('all six reaction effects and reduced motion remain shared', () => {
  const reactions = read('components/feature/storyReactions.ts');
  for (const key of ['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']) assert.match(reactions, new RegExp(`key: '${key}'`));
  assert.match(reactions, /key: 'fire'[\s\S]*particleCount: 8/);
  assert.match(effect, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(effect, /reduceMotionChanged/);
  assert.match(effect, /subscription\.remove\(\)/);
  assert.match(effect, /pointerEvents="none"/);
});

test('shared Story card aligns with node 2:82', () => {
  assert.match(shared, /width: '84%'/);
  assert.match(shared, /maxWidth: 328/);
  assert.match(shared, /minHeight: 468/);
  assert.match(shared, /aspectRatio: 328 \/ 286/);
  assert.match(shared, /top: 17, left: 17/);
  assert.match(shared, /size=\{34\}/);
  assert.match(shared, /minHeight: 42/);
  assert.match(shared, /Toque en la tarjeta → contenido original/);
});

test('shared source navigation and unavailable privacy remain canonical', () => {
  assert.match(shared, /onOpen\(content\.sourceVideoId\)/);
  assert.match(shared, /accessibilityLabel="Abrir contenido original"/);
  assert.match(shared, /Contenido no disponible/);
  assert.doesNotMatch(shared, /router\.push|video_url|signedUrl|params:/);
  assert.match(i1, /ensureVideoLoadedById/);
});

test('editor header, canvas and toolbar align with node 2:105', () => {
  assert.match(editor, /headerHeight = Math\.max\(92/);
  assert.match(editor, /toolbarHeight = Math\.max\(122/);
  assert.match(editor, /height: 38[\s\S]*width: 88/);
  assert.match(editor, /width: 52[\s\S]*height: 52[\s\S]*borderRadius: 26/);
  assert.match(editor, /paddingHorizontal: 19/);
  assert.match(editor, /paddingTop: 28/);
  assert.match(editor, /Arrastra · pellizca · edita/);
  assert.match(editor, /backgroundColor: 'rgba\(11,11,16,0\.94\)'/);
});

test('editor tools and selection remain one functional authority', () => {
  assert.match(editor, /accessibilityLabel="Añadir texto"/);
  assert.match(editor, /accessibilityLabel="Elegir sticker"/);
  assert.match(editor, /accessibilityLabel="Cambiar color"/);
  assert.match(editor, /name="format-size"/);
  assert.match(editor, /accessibilityLabel="Eliminar elemento"/);
  assert.match(editor, /showStickerPicker/);
  assert.match(editor, /PanResponder\.create/);
  assert.match(editor, /start\.current\.scale \* pinch \/ start\.current\.pinch/);
});

test('editor validation and idempotent publication are untouched', () => {
  assert.match(editor, /STORY_MAX_ELEMENTS = 32/);
  assert.match(editor, /STORY_MAX_TEXT_ELEMENTS = 10/);
  assert.match(editor, /STORY_MAX_STICKER_ELEMENTS = 24/);
  assert.match(editor, /element\.text\.trim\(\)\.length > 0/);
  assert.match(editor, /clientStoryIdRef/);
  assert.match(editor, /if \(!source \|\| publishing\) return/);
});

test('owner sheet aligns with node 2:131 without a second authority', () => {
  assert.match(sheet, /Math\.min\(484, Math\.max\(360, viewportHeight \* 0\.575\)\)/);
  assert.match(sheet, /borderTopLeftRadius: 28/);
  assert.match(sheet, /width: 42[\s\S]*height: 4/);
  assert.match(sheet, /fontSize: 20/);
  assert.match(sheet, /Vistas · \{totalCount\}/);
  assert.match(sheet, /Reacciones · \{reactionCount\}/);
  assert.match(sheet, /height: 42/);
  assert.match(sheet, /minHeight: 66/);
});

test('owner sheet states, privacy and pagination remain intact', () => {
  assert.match(sheet, /Cargando visualizaciones/);
  assert.match(sheet, /No pudimos cargar las visualizaciones/);
  assert.match(sheet, /Todavía no hay visualizaciones/);
  assert.match(sheet, /Cargando reacciones/);
  assert.match(sheet, /onEndReached/);
  assert.match(sheet, /reactionsHasMore/);
  assert.match(context, /rpc\('get_story_viewers'/);
  assert.match(context, /rpc\('get_story_reactions'/);
});

test('StoriesBar geometry aligns with node 2:178', () => {
  assert.match(bar, /const AVATAR_SIZE = 60/);
  assert.match(bar, /const RING_PAD = 4/);
  assert.match(bar, /const RING_SIZE = 68/);
  assert.match(bar, /paddingHorizontal: 19/);
  assert.match(bar, /gap: 24/);
  assert.match(bar, /paddingVertical: 20/);
  assert.match(bar, /fontSize: 11/);
  assert.match(bar, /borderColor: '#2A2B36'/);
});

test('own Story and Profile ring behavior remain canonical', () => {
  const ownProfile = read('app/(tabs)/profile.tsx');
  const foreignProfile = read('app/creator/[id].tsx');
  assert.match(bar, /ownStoryGroup \? onViewStory\(ownStoryGroup\) : onAddStory\(\)/);
  assert.match(bar, /accessibilityLabel=\{ownStoryGroup \? 'Añadir otra historia' : 'Añadir historia'\}/);
  assert.match(ownProfile, /ringSize=\{142\}[\s\S]*avatarSize=\{130\}/);
  assert.match(foreignProfile, /ringSize=\{142\}[\s\S]*avatarSize=\{130\}/);
  assert.match(ownProfile, /setStoryViewerVisible\(true\)/);
  assert.match(foreignProfile, /setStoryViewerVisible\(true\)/);
});

test('safe areas and responsive dimensions are preserved', () => {
  for (const source of [nativeViewer, webViewer, editor, sheet]) assert.match(source, /useSafeAreaInsets/);
  for (const source of [nativeViewer, webViewer, editor, sheet, effect]) assert.match(source, /useWindowDimensions/);
  assert.match(editor, /KeyboardAvoidingView/);
  assert.match(nativeViewer, /KeyboardAvoidingView/);
});

test('H and H1 reply and reaction contracts remain unchanged', () => {
  assert.match(interactions, /sendingRef\.current/);
  assert.match(interactions, /clientMessageId/);
  assert.match(context, /sendStoryReply\(storyId, trimmed, clientMessageId\)/);
  assert.match(context, /rpc\('set_story_reaction'/);
  assert.match(interactions, /onReaction\(selected \? null : item\.key\)/);
});

test('G realtime and F playback authorities remain unchanged', () => {
  assert.equal((context.match(/\.channel\(`/g) ?? []).length, 1);
  assert.match(context, /table: 'stories'/);
  assert.doesNotMatch(context, /table: 'story_views'|table: 'story_reactions'/);
  assert.match(nativeViewer, /timeUpdate/);
  assert.match(nativeViewer, /statusChange/);
  assert.match(nativeViewer, /shouldPausePlayback/);
});

test('one canonical component authority exists for each Story surface', () => {
  const featureFiles = readdirSync('components/feature');
  assert.equal(featureFiles.filter(name => /^StoryViewer(?:\.|$)/.test(name)).sort().join(','), 'StoryViewer.native.tsx,StoryViewer.tsx');
  assert.equal(featureFiles.filter(name => name === 'StoryEditor.tsx').length, 1);
  assert.equal(featureFiles.filter(name => name === 'StoryInteractions.tsx').length, 1);
  assert.equal(featureFiles.filter(name => name === 'StoryReactionEffect.tsx').length, 1);
  assert.equal(featureFiles.filter(name => name === 'StoryViewersSheet.tsx').length, 1);
  assert.equal(readdirSync('contexts').filter(name => name === 'StoriesContext.tsx').length, 1);
});

test('J2 introduces no persistence, service, package or native authority', () => {
  const names = execFileSync('git', ['diff', '--name-only', BASE], { encoding: 'utf8' });
  assert.doesNotMatch(names, /^supabase\//m);
  assert.doesNotMatch(names, /^services\//m);
  assert.doesNotMatch(names, /^contexts\//m);
  assert.doesNotMatch(names, /^android\/|^ios\//m);
  assert.equal(read('package.json'), baseFile('package.json'));
  assert.equal(read('package-lock.json'), baseFile('package-lock.json'));
});
