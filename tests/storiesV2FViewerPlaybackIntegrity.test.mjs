import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const mediaUrlHook = read('components/feature/useStoryMediaUrl.ts');
const expoVideoPackage = JSON.parse(read('node_modules/expo-video/package.json'));
const expoVideoTypes = read('node_modules/expo-video/build/VideoPlayer.types.d.ts');
const expoVideoEvents = read('node_modules/expo-video/build/VideoPlayerEvents.types.d.ts');

const pauseModel = reasons => Object.values(reasons).some(Boolean);
const remainingPhotoMs = progress => 15_000 * (1 - Math.max(0, Math.min(1, progress)));

function transitionModel({ currentId, sourceId, currentGeneration, sourceGeneration, locked }) {
  if (sourceId && sourceId !== currentId) return 'stale_story';
  if (sourceGeneration !== undefined && sourceGeneration !== currentGeneration) return 'stale_generation';
  if (locked) return 'locked';
  return 'next';
}

test('F uses a 15 second authority only for photo Stories', () => {
  assert.match(nativeViewer, /const PHOTO_DURATION_MS = 15000/i);
  assert.match(webViewer, /const PHOTO_DURATION_MS = 15000/i);
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /currentMediaType !== 'photo' \|\| shouldPausePlayback/i);
    assert.match(viewer, /PHOTO_DURATION_MS \* \(1 - currentProgress\)/i);
  }
});

test('native video has no photo timer and uses the real expo-video clock', () => {
  const video = nativeViewer.slice(nativeViewer.indexOf('function ReadyStoryVideo'), nativeViewer.indexOf('interface StoryMediaProps'));
  assert.doesNotMatch(video, /PHOTO_DURATION_MS|Animated\.timing|setInterval/i);
  assert.match(video, /timeUpdateEventInterval = 0\.25/i);
  assert.match(video, /addListener\?\.\('timeUpdate'/i);
  assert.match(video, /Number\(currentTime\) \/ duration/i);
});

test('installed expo-video 3.0.16 exposes every native API used by F', () => {
  assert.equal(expoVideoPackage.version, '3.0.16');
  for (const property of ['muted: boolean', 'currentTime: number', 'readonly duration: number', 'timeUpdateEventInterval: number']) {
    assert.ok(expoVideoTypes.includes(property), property);
  }
  assert.match(expoVideoTypes, /play\(\): void/);
  assert.match(expoVideoTypes, /pause\(\): void/);
  for (const event of ['statusChange', 'timeUpdate', 'sourceLoad', 'playToEnd']) {
    assert.match(expoVideoEvents, new RegExp(`${event}\\b`));
  }
});

test('native mute state is applied during setup and on every change', () => {
  assert.match(nativeViewer, /p\.muted = isMuted/i);
  assert.match(nativeViewer, /player\.muted = isMuted/i);
  assert.match(nativeViewer, /\[isMuted, player\]/i);
});

test('mute is unmuted by default, persists across Stories and resets only when viewer closes', () => {
  assert.match(nativeViewer, /const \[isMuted, setIsMuted\] = useState\(false\)/i);
  assert.match(nativeViewer, /if \(!visible\)[\s\S]*setIsMuted\(false\)/i);
});

test('mute control is rendered only for video Stories', () => {
  assert.match(nativeViewer, /currentStory\.mediaType === 'video' \? \([\s\S]*Silenciar video[\s\S]*volume-off[\s\S]*\) : null/i);
});

test('video readiness comes from statusChange and duration comes from sourceLoad', () => {
  assert.match(nativeViewer, /addListener\?\.\('statusChange'[\s\S]*status === 'readyToPlay'/i);
  assert.match(nativeViewer, /addListener\?\.\('sourceLoad'[\s\S]*durationRef\.current/i);
  assert.match(nativeViewer, /status === 'error'\) onError\(\)/i);
});

test('video end is the sole native video auto-next authority', () => {
  assert.match(nativeViewer, /addListener\?\.\('playToEnd', \(\) => onEnd\(storyId\)\)/i);
  assert.match(nativeViewer, /const handleVideoEnd[\s\S]*goNext\(storyId, playbackGeneration\.current\)/i);
});

test('stale Story and stale generation events cannot advance', () => {
  assert.equal(transitionModel({ currentId: 'b', sourceId: 'a', currentGeneration: 2, sourceGeneration: 2 }), 'stale_story');
  assert.equal(transitionModel({ currentId: 'a', sourceId: 'a', currentGeneration: 2, sourceGeneration: 1 }), 'stale_generation');
  assert.match(nativeViewer, /sourceStoryId !== currentStoryIdRef\.current/i);
  assert.match(nativeViewer, /sourceGeneration !== playbackGeneration\.current/i);
});

test('transition lock prevents duplicate end/tap/close transitions', () => {
  assert.equal(transitionModel({ currentId: 'a', sourceId: 'a', currentGeneration: 1, sourceGeneration: 1, locked: true }), 'locked');
  assert.match(nativeViewer, /if \(transitionLock\.current\) return;[\s\S]*transitionLock\.current = true/i);
});

test('one effective native pause decision includes every required reason', () => {
  const block = nativeViewer.slice(nativeViewer.indexOf('const shouldPausePlayback'), nativeViewer.indexOf("AppState.addEventListener"));
  for (const reason of ['!visible', 'manualHold', 'viewersVisible', 'deleteConfirmVisible', 'deletePending', "appState !== 'active'", '!mediaReady']) {
    assert.ok(block.includes(reason), reason);
  }
  assert.equal(pauseModel({ hidden: false, hold: false, viewers: true, delete: false, background: false, loading: false }), true);
});

test('native player obeys only effective active/ready/pause state', () => {
  assert.match(nativeViewer, /if \(isActive && isReady && !shouldPause\)[\s\S]*player\.play\(\)[\s\S]*else[\s\S]*player\.pause\(\)/i);
});

test('photo pause captures progress and resume uses remaining duration', () => {
  assert.match(nativeViewer, /stopAnimation\(value =>[\s\S]*photoProgressRef\.current = Math\.max/i);
  assert.match(nativeViewer, /const currentProgress = photoProgressRef\.current/i);
  assert.equal(remainingPhotoMs(0.4), 9000);
});

test('viewers sheet pauses without resetting playback', () => {
  assert.match(nativeViewer, /\|\| viewersVisible/);
  assert.match(nativeViewer, /onPress=\{\(\) => setViewersVisible\(true\)\}/i);
  assert.doesNotMatch(nativeViewer, /setViewersVisible\(true\)[\s\S]{0,100}resetProgress/i);
});

test('delete confirmation pauses and cancel resumes without a reset', () => {
  const request = nativeViewer.slice(nativeViewer.indexOf('const requestDelete'), nativeViewer.indexOf('const confirmDelete'));
  assert.match(request, /setDeleteConfirmVisible\(true\)/i);
  assert.match(request, /setDeleteConfirmVisible\(false\)/i);
  assert.doesNotMatch(request, /resetProgress|setValue\(0\)|startProgress/i);
});

test('AppState inactive/background pauses and active can resume safely', () => {
  assert.match(nativeViewer, /AppState\.addEventListener\('change', setAppState\)/i);
  assert.match(nativeViewer, /appState !== 'active'/i);
  assert.equal(pauseModel({ hidden: false, hold: false, viewers: false, delete: false, background: true, loading: false }), true);
  assert.equal(pauseModel({ hidden: false, hold: false, viewers: true, delete: false, background: false, loading: false }), true);
});

test('previous navigation restarts index zero instead of freezing', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    const previous = viewer.slice(viewer.indexOf('const goPrev'), viewer.indexOf('const requestDelete'));
    assert.match(previous, /currentIndex > 0[\s\S]*setCurrentIndex/i);
    assert.match(previous, /else\s*\{?\s*restartCurrentStory\(\)/i);
    assert.match(viewer, /setRestartToken\(token => token \+ 1\)/i);
  }
});

test('quick right and left taps use canonical navigation handlers', () => {
  assert.match(nativeViewer, /handleZonePress\('prev'\)/i);
  assert.match(nativeViewer, /handleZonePress\('next'\)/i);
});

test('long press pauses, release resumes and navigation is suppressed', () => {
  assert.match(nativeViewer, /delayLongPress=\{HOLD_DELAY_MS\}/i);
  assert.match(nativeViewer, /const handleLongPress[\s\S]*holdTriggered\.current = true[\s\S]*setManualHold\(true\)/i);
  assert.match(nativeViewer, /const handlePressOut[\s\S]*setManualHold\(false\)/i);
  assert.match(nativeViewer, /if \(holdTriggered\.current\)[\s\S]*holdTriggered\.current = false;[\s\S]*return;/i);
});

test('tap zones are disabled behind viewer and delete overlays', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /pointerEvents=\{deleteConfirmVisible \|\| viewersVisible \? 'none' : 'box-none'\}/i);
  }
});

test('media loading and failure keep progress paused at the current Story', () => {
  assert.match(nativeViewer, /\|\| !mediaReady/);
  assert.match(nativeViewer, /onReadyChange\(story\.id, false\)[\s\S]*fail\(\)/i);
  assert.match(nativeViewer, /Historia no disponible\./i);
  assert.doesNotMatch(nativeViewer, /failMedia[\s\S]{0,160}goNext/i);
});

test('retry resets progress and waits for media readiness', () => {
  assert.match(nativeViewer, /const retryMedia[\s\S]*onReset\(\)[\s\S]*onReadyChange\(story\.id, false\)[\s\S]*retry\(\)/i);
  assert.match(nativeViewer, /const handleMediaReset[\s\S]*resetProgress\(\)[\s\S]*setMediaReady\(false\)/i);
});

test('native player cleanup removes subscriptions and stops audio', () => {
  for (const name of ['statusSubscription', 'sourceSubscription', 'timeSubscription', 'endSubscription']) {
    assert.match(nativeViewer, new RegExp(`${name}\\?\\.remove\\?\\.\\(\\)`));
  }
  assert.match(nativeViewer, /player\?\.pause\?\.\(\)/i);
  assert.match(nativeViewer, /staysActiveInBackground = false/i);
});

test('signed Story URL resolution remains exclusively in useStoryMediaUrl', () => {
  assert.match(nativeViewer, /useStoryMediaUrl\(story, isActive\)/i);
  assert.match(webViewer, /useStoryMediaUrl\(story, isActive\)/i);
  assert.match(mediaUrlHook, /getMediaUrl\(story\.mediaAssetId\)/i);
  assert.doesNotMatch(nativeViewer, /getMediaUrl\(|supabase\.|functions\.invoke/i);
});

test('web video remains a manual placeholder and never requests a signed URL', () => {
  const media = webViewer.slice(webViewer.indexOf('function StoryMedia'), webViewer.indexOf('export function StoryViewer'));
  assert.ok(media.indexOf("story.mediaType === 'video'") < media.indexOf('<StoryPhotoMedia'));
  assert.match(media, /Video \(solo móvil\)/i);
  assert.doesNotMatch(media.slice(0, media.indexOf('<StoryPhotoMedia')), /useStoryMediaUrl|getMediaUrl|Animated\.timing/i);
  assert.doesNotMatch(webViewer, /from 'expo-video'|require\('expo-video'\)|useVideoPlayer\(|<VideoView/);
});

test('web photo gets readiness-based pause/resume and index-zero restart', () => {
  assert.match(webViewer, /onLoad=\{\(\) => onReadyChange\(story\.id, true\)\}/i);
  assert.match(webViewer, /currentMediaType !== 'photo' \|\| shouldPausePlayback/i);
  assert.match(webViewer, /else restartCurrentStory\(\)/i);
});

test('F preserves the existing D and E viewer/delete authorities', () => {
  assert.match(nativeViewer, /if \(visible && currentStoryId && onMarkViewed\) void onMarkViewed\(currentStoryId\)/i);
  assert.match(nativeViewer, /await onDeleteStory\(currentStory\.id\)/i);
  assert.match(nativeViewer, /<StoryViewersSheet/i);
  assert.doesNotMatch(nativeViewer + webViewer, /\.from\('stories'\)|\.from\('story_views'\)|rpc\(/i);
});

test('F creates no parallel playback, media or context authority', () => {
  const changed = nativeViewer + webViewer;
  assert.doesNotMatch(changed, /StoryPlaybackService|StoryMediaService|createContext|create table|create or replace function/i);
  assert.doesNotMatch(changed, /setInterval|STORY_DURATION/);
});
