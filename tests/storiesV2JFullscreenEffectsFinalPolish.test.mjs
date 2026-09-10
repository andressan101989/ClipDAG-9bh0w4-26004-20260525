import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const BASE = 'f045b970c133e70a8ff78dbe7a59535696cbeb31';
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const effect = read('components/feature/StoryReactionEffect.tsx');
const reactions = read('components/feature/storyReactions.ts');
const interactions = read('components/feature/StoryInteractions.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const editor = read('components/feature/StoryEditor.tsx');
const sharedCard = read('components/feature/StorySharedContentCard.tsx');
const storiesBar = read('components/feature/StoriesBar.tsx');
const viewersSheet = read('components/feature/StoryViewersSheet.tsx');
const context = read('contexts/StoriesContext.tsx');
const i1 = read('tests/storiesV2I1OriginalNavigationEditorValidation.test.mjs');

function baseFile(path) {
  return execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
}

test('J starts from the exact approved I1 base without package or database changes', () => {
  assert.equal(execFileSync('git', ['merge-base', 'HEAD', BASE], { encoding: 'utf8' }).trim(), BASE);
  assert.equal(read('package.json'), baseFile('package.json'));
  assert.equal(read('package-lock.json'), baseFile('package-lock.json'));
  assert.equal(execFileSync('git', ['diff', '--name-only', BASE, '--', 'supabase'], { encoding: 'utf8' }).trim(), '');
});

test('one shared effect renderer covers the exact six canonical reactions', () => {
  const featureFiles = readdirSync('components/feature');
  assert.deepEqual(featureFiles.filter(name => name === 'StoryReactionEffect.tsx'), ['StoryReactionEffect.tsx']);
  assert.equal((effect.match(/export function StoryReactionEffect/g) ?? []).length, 1);
  assert.deepEqual(
    [...reactions.matchAll(/key: '(heart|laugh|wow|sad|fire|clap)', emoji: '([^']+)'/g)].map(match => match[1]),
    ['heart', 'laugh', 'wow', 'sad', 'fire', 'clap'],
  );
  assert.deepEqual(
    [...reactions.matchAll(/key: '(?:heart|laugh|wow|sad|fire|clap)', emoji: '([^']+)'/g)].map(match => match[1]),
    ['❤️', '😂', '😮', '😢', '🔥', '👏'],
  );
});

test('reaction-to-visual mapping supports heart, laugh, wow, sad, fire and clap centrally', () => {
  assert.match(reactions, /key: 'heart'[\s\S]*effect: 'rise'[\s\S]*particleCount: 8/);
  assert.match(reactions, /key: 'laugh'[\s\S]*effect: 'pop'[\s\S]*particleCount: 6/);
  assert.match(reactions, /key: 'wow'[\s\S]*effect: 'pulse'[\s\S]*particleCount: 1/);
  assert.match(reactions, /key: 'sad'[\s\S]*effect: 'fall'[\s\S]*particleCount: 5/);
  assert.match(reactions, /key: 'fire'[\s\S]*effect: 'rise'[\s\S]*particleCount: 8/);
  assert.match(reactions, /key: 'clap'[\s\S]*effect: 'alternate'[\s\S]*particleCount: 6/);
  assert.match(effect, /wowRing/);
  assert.match(effect, /clapBurst/);
});

test('fullscreen feedback is presentation-only and cannot authorize persistence', () => {
  assert.doesNotMatch(effect, /supabase|\.rpc\(|\.from\(|postgres_changes|channel\(/i);
  assert.doesNotMatch(effect, /chat|message|setStoryReaction/i);
  assert.match(effect, /Ephemeral, local-only feedback/);
  assert.match(interactions, /onPressIn=\{\(\) => onReactionEffect\(item\.key\)\}/);
  assert.match(interactions, /onReaction\(selected \? null : item\.key\)/);
  assert.match(context, /rpc\('set_story_reaction'/);
});

test('effect is finite, restartable and has deterministic stale-safe cleanup', () => {
  assert.match(effect, /STORY_REACTION_EFFECT_DURATION_MS = 980/);
  assert.match(effect, /STORY_REACTION_REDUCED_MOTION_DURATION_MS = 700/);
  assert.match(effect, /effectToken/);
  assert.match(effect, /generationRef/);
  assert.match(effect, /animationRef\.current\?\.stop\(\)/);
  assert.match(effect, /progress\.stopAnimation\(\)/);
  assert.match(effect, /generationRef\.current === generation/);
  assert.doesNotMatch(effect, /setInterval|loop\s*:\s*true|Animated\.loop/);
});

test('reduced-motion preference is observed and its listener is removed', () => {
  assert.match(effect, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(effect, /addEventListener\('reduceMotionChanged'/);
  assert.match(effect, /subscription\.remove\(\)/);
  assert.match(effect, /if \(reduceMotion\)/);
  assert.match(effect, /reducedEmoji/);
});

test('the visual layer is touch-transparent and accessibility-silent', () => {
  assert.ok((effect.match(/pointerEvents="none"/g) ?? []).length >= 3);
  assert.match(effect, /accessibilityElementsHidden/);
  assert.match(effect, /importantForAccessibility="no-hide-descendants"/);
  assert.match(effect, /StyleSheet\.absoluteFillObject/);
});

test('both canonical viewers host the same local effect and clear it per Story generation', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /import \{ StoryReactionEffect \}/);
    assert.match(viewer, /<StoryReactionEffect[\s\S]*reaction=\{reactionEffect\.reaction\}[\s\S]*effectToken=\{reactionEffect\.token\}/);
    assert.match(viewer, /setReactionEffect\(current => \(\{ reaction, token: current\.token \+ 1 \}\)\)/);
    assert.match(viewer, /setReactionEffect\(current => \(\{ reaction: null, token: current\.token \+ 1 \}\)\)/);
  }
});

test('effect cannot seek, restart or become a playback authority', () => {
  assert.doesNotMatch(effect, /currentTime|seek|restartToken|player|play\(|pause\(/i);
  assert.match(nativeViewer, /const shouldPausePlayback/);
  assert.match(nativeViewer, /interactionFocused/);
  assert.match(nativeViewer, /reactionPending/);
  assert.doesNotMatch(nativeViewer.slice(nativeViewer.indexOf('triggerReactionEffect'), nativeViewer.indexOf('const sendReply')), /setRestartToken|setMediaReady|progressAnim/);
});

test('viewer navigation, close, mute and owner controls remain intact and accessible', () => {
  assert.match(nativeViewer, /handleZonePress\('prev'\)/);
  assert.match(nativeViewer, /handleZonePress\('next'\)/);
  assert.match(nativeViewer, /PanResponder\.create/);
  assert.match(nativeViewer, /name=\{isMuted \? 'volume-off' : 'volume-up'\}/);
  assert.match(nativeViewer, /accessibilityLabel="Cerrar historia"/);
  assert.match(nativeViewer, /accessibilityLabel=\{`Ver visualizaciones: \$\{viewerCount\}`\}/);
});

test('viewer polish uses thin progress, compact controls, safe area and responsive dimensions', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /height: 2\.5/);
    assert.match(viewer, /useSafeAreaInsets/);
    assert.match(viewer, /useWindowDimensions/);
    assert.match(viewer, /width=\{viewportWidth\}/);
    assert.match(viewer, /height=\{viewportHeight\}/);
    assert.match(viewer, /width: 44[\s\S]*height: 44/);
  }
});

test('reply and reaction controls remain compact, guarded and accessible', () => {
  assert.match(interactions, /accessibilityLabel=\{item\.label\}/);
  assert.match(interactions, /accessibilityHint=\{selected \?/);
  assert.match(interactions, /accessibilityLabel="Enviar respuesta"/);
  assert.match(interactions, /minHeight: 46/);
  assert.match(interactions, /width: 44[\s\S]*height: 44/);
  assert.match(interactions, /sendingRef\.current/);
});

test('owner composer stays hidden and one owner sheet retains both private tabs', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /!isOwnStory && onSetReaction && onReplyToStory/);
    assert.match(viewer, /<StoryViewersSheet/);
  }
  assert.match(viewersSheet, /accessibilityLabel=\{`Vistas, \$\{totalCount\}`\}/);
  assert.match(viewersSheet, /accessibilityLabel=\{`Reacciones, \$\{reactionCount\}`\}/);
  assert.match(viewersSheet, /onEndReached/);
  assert.match(viewersSheet, /reactionsHasMore/);
});

test('shared Story card keeps attribution, CTA, original ID navigation and safe unavailable state', () => {
  assert.match(sharedCard, /content\.contentType === 'reel' \? 'Ver reel' : 'Ver publicación'/);
  assert.match(sharedCard, /@\{content\.username\}/);
  assert.match(sharedCard, /numberOfLines=\{2\}/);
  assert.match(sharedCard, /onOpen\(content\.sourceVideoId\)/);
  assert.match(sharedCard, /Contenido no disponible/);
  assert.doesNotMatch(sharedCard, /router\.push|params:|signedUrl/);
});

test('single editor is safe-area and keyboard aware with visual selection and accessible tools', () => {
  assert.equal((editor.match(/export function StoryEditor/g) ?? []).length, 1);
  assert.match(editor, /KeyboardAvoidingView/);
  assert.match(editor, /useSafeAreaInsets/);
  assert.match(editor, /useWindowDimensions/);
  assert.match(editor, /accessibilityLabel="Añadir texto"/);
  assert.match(editor, /accessibilityLabel="Eliminar elemento"/);
  assert.match(editor, /selected.*borderColor: Colors\.primaryLight/s);
});

test('editor behavior preserves text, sticker, drag, pinch and validation contracts', () => {
  assert.match(editor, /PanResponder\.create/);
  assert.match(editor, /start\.current\.scale \* pinch \/ start\.current\.pinch/);
  assert.match(editor, /gesture\.dx \/ CANVAS_W/);
  assert.match(editor, /gesture\.dy \/ CANVAS_H/);
  assert.match(editor, /STORY_MAX_ELEMENTS = 32/);
  assert.match(editor, /STORY_MAX_TEXT_ELEMENTS = 10/);
  assert.match(editor, /STORY_MAX_STICKER_ELEMENTS = 24/);
  assert.match(editor, /element\.text\.trim\(\)\.length > 0/);
});

test('StoriesBar uses one own avatar with active-view and add-another actions', () => {
  assert.match(storiesBar, /ownStoryGroup = storyGroups\.find/);
  assert.match(storiesBar, /otherStoryGroups = storyGroups\.filter/);
  assert.match(storiesBar, /ownStoryGroup \? onViewStory\(ownStoryGroup\) : onAddStory\(\)/);
  assert.match(storiesBar, /accessibilityLabel=\{ownStoryGroup \? 'Añadir otra historia' : 'Añadir historia'\}/);
  assert.match(storiesBar, /hasUnseen=\{ownStoryGroup\.hasUnseen\}/);
  assert.match(storiesBar, /storyRingGradSeen/);
});

test('visual polish reuses the existing design system instead of introducing a new one', () => {
  for (const source of [interactions, editor, sharedCard, viewersSheet, storiesBar, nativeViewer, webViewer]) {
    assert.match(source, /Colors|Spacing|Radius|FontSize|FontWeight/);
  }
  assert.doesNotMatch(effect + interactions + editor, /from ['"](?:lottie-react-native|moti)['"]|confetti/i);
});

test('I1 original navigation and B through H authorities remain present', () => {
  assert.match(i1, /ensureVideoLoadedById/);
  assert.match(sharedCard, /sourceVideoId/);
  assert.match(context, /rpc\('create_story_with_media'/);
  assert.match(context, /rpc\('mark_story_viewed'/);
  assert.match(context, /rpc\('delete_story'/);
  assert.match(context, /sendStoryReply\(storyId, trimmed, clientMessageId\)/);
  assert.match(context, /table: 'stories'/);
});

test('Realtime scope and web video boundary remain unchanged', () => {
  assert.equal((context.match(/\.channel\(`/g) ?? []).length, 1);
  assert.match(context, /table: 'stories'/);
  assert.doesNotMatch(context, /table: 'story_views'|table: 'story_reactions'/);
  assert.match(webViewer, /Video \(solo móvil\)/);
  assert.doesNotMatch(effect, /expo-video|VideoView/);
});

test('no parallel Story architecture, native change or visual package was introduced', () => {
  const featureFiles = readdirSync('components/feature');
  assert.equal(featureFiles.filter(name => /^StoryViewer(?:\.|$)/.test(name)).sort().join(','), 'StoryViewer.native.tsx,StoryViewer.tsx');
  assert.equal(featureFiles.filter(name => name === 'StoryEditor.tsx').length, 1);
  assert.equal(featureFiles.filter(name => name === 'StoryInteractions.tsx').length, 1);
  assert.equal(readdirSync('contexts').filter(name => name === 'StoriesContext.tsx').length, 1);
  assert.equal(execFileSync('git', ['diff', '--name-only', BASE, '--', 'android', 'ios'], { encoding: 'utf8' }).trim(), '');
});
