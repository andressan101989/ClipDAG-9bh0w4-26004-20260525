import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createProtectedVideoCommandController } from '../services/creatorPremiumProtectedVideoRuntime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const CONTENT_A = '20000000-0000-4000-8000-000000000001';
const CONTENT_B = '20000000-0000-4000-8000-000000000002';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function source(contentId, uri = `https://customer-test.cloudflarestream.com/token-${contentId}/manifest/video.m3u8`) {
  return {
    contentId,
    uri,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

function makePlayer(overrides = {}) {
  const calls = [];
  const player = {
    replaceAsync: async value => { calls.push(['replace', value]); },
    play: () => { calls.push(['play']); },
    pause: () => { calls.push(['pause']); },
    ...overrides,
  };
  return { player, calls };
}

test('video command controller loads only HLS with cache disabled', async () => {
  const { player, calls } = makePlayer();
  const controller = createProtectedVideoCommandController(player);
  assert.equal(await controller.load(source(CONTENT_A), 1), true);
  assert.deepEqual(calls, [[
    'replace',
    {
      uri: source(CONTENT_A).uri,
      contentType: 'hls',
      useCaching: false,
    },
  ]]);
  assert.equal(await controller.play(1), true);
  assert.deepEqual(calls.at(-1), ['play']);
});

test('late replaceAsync cannot restore content after close invalidation', async () => {
  const replacing = deferred();
  let first = true;
  const { player, calls } = makePlayer({
    replaceAsync: async value => {
      calls.push(['replace', value]);
      if (first) {
        first = false;
        await replacing.promise;
      }
    },
  });
  const controller = createProtectedVideoCommandController(player);
  const loading = controller.load(source(CONTENT_A), 1);
  await Promise.resolve();
  const invalidating = controller.invalidate('close');
  replacing.resolve();
  assert.equal(await loading, false);
  await invalidating;
  assert.equal(await controller.play(1), false);
  assert.equal(calls.some(call => call[0] === 'play'), false);
  assert.equal(calls.at(-1)[0], 'replace');
  assert.equal(calls.at(-1)[1], null);
});

test('session invalidation prevents a pending load from becoming playable', async () => {
  const replacing = deferred();
  const { player, calls } = makePlayer({
    replaceAsync: async value => {
      calls.push(['replace', value]);
      if (value) await replacing.promise;
    },
  });
  const controller = createProtectedVideoCommandController(player);
  const loading = controller.load(source(CONTENT_A), 4);
  await Promise.resolve();
  const invalidating = controller.invalidate('logout');
  replacing.resolve();
  await Promise.all([loading, invalidating]);
  assert.equal(await controller.play(4), false);
  assert.equal(calls.at(-1)[1], null);
});

test('a late content-A load cannot overwrite a newer content-B generation', async () => {
  const replacingA = deferred();
  const { player, calls } = makePlayer({
    replaceAsync: async value => {
      calls.push(['replace', value]);
      if (value?.uri.includes(CONTENT_A)) await replacingA.promise;
    },
  });
  const controller = createProtectedVideoCommandController(player);
  const loadA = controller.load(source(CONTENT_A), 1);
  await Promise.resolve();
  const loadB = controller.load(source(CONTENT_B), 2);
  replacingA.resolve();
  assert.equal(await loadA, false);
  assert.equal(await loadB, true);
  assert.deepEqual(calls.at(-1), [
    'replace',
    { uri: source(CONTENT_B).uri, contentType: 'hls', useCaching: false },
  ]);
  assert.equal(await controller.play(1), false);
  assert.equal(await controller.play(2), true);
});

test('a delayed play completion is paused after invalidation', async () => {
  const playing = deferred();
  const { player, calls } = makePlayer({
    play: async () => { calls.push(['play']); await playing.promise; },
  });
  const controller = createProtectedVideoCommandController(player);
  await controller.load(source(CONTENT_A), 1);
  const play = controller.play(1);
  await Promise.resolve();
  const invalidating = controller.invalidate('background');
  playing.resolve();
  assert.equal(await play, false);
  await invalidating;
  assert.equal(calls.at(-1)[0], 'replace');
  assert.equal(calls.at(-1)[1], null);
  assert.ok(calls.filter(call => call[0] === 'pause').length >= 1);
});

test('dispose is idempotent, clears native source, and rejects all later commands', async () => {
  const { player, calls } = makePlayer();
  const controller = createProtectedVideoCommandController(player);
  await controller.load(source(CONTENT_A), 1);
  await controller.dispose();
  await controller.dispose();
  assert.equal(await controller.load(source(CONTENT_B), 2), false);
  assert.equal(await controller.play(2), false);
  assert.equal(calls.at(-1)[1], null);
});

test('protected image has no persistent cache, Live Text, prefetch, share, or download path', () => {
  const image = read('components/premium/ProtectedPremiumImage.tsx');
  assert.match(image, /from 'expo-image'/);
  assert.match(image, /cachePolicy="none"/);
  assert.match(image, /enableLiveTextInteraction=\{false\}/);
  assert.match(image, /recyclingKey=/);
  assert.doesNotMatch(image, /AsyncStorage|SecureStore|SQLite|FileSystem|MediaLibrary|prefetch|Share|download/i);
});

test('protected video disables caching, PiP, fullscreen, external playback, background, and frame analysis', () => {
  const video = read('components/premium/ProtectedPremiumVideo.tsx');
  assert.match(video, /useVideoPlayer\(null/);
  assert.match(video, /allowsExternalPlayback\s*=\s*false/);
  assert.match(video, /staysActiveInBackground\s*=\s*false/);
  assert.match(video, /showNowPlayingNotification\s*=\s*false/);
  assert.match(video, /nativeControls=\{false\}/);
  assert.match(video, /allowsFullscreen=\{false\}/);
  assert.match(video, /allowsPictureInPicture=\{false\}/);
  assert.match(video, /startsPictureInPictureAutomatically=\{false\}/);
  assert.match(video, /allowsVideoFrameAnalysis=\{false\}/);
  assert.doesNotMatch(video, /Share|download|VideoAirPlayButton|AsyncStorage|FileSystem|MediaLibrary/i);
});

test('protected components keep an opaque cover while hidden, loading, errored, or unprotected', () => {
  for (const file of [
    'components/premium/ProtectedPremiumImage.tsx',
    'components/premium/ProtectedPremiumVideo.tsx',
  ]) {
    const sourceText = read(file);
    assert.match(sourceText, /visible/);
    assert.match(sourceText, /styles\.cover/);
    assert.match(sourceText, /backgroundColor:\s*['"]#0[0-9A-Fa-f]{5}['"]/);
  }
});

test('late image or video frame events cannot uncover a different protected grant', () => {
  const image = read('components/premium/ProtectedPremiumImage.tsx');
  const video = read('components/premium/ProtectedPremiumVideo.tsx');
  assert.match(image, /loadedKey\s*===\s*sourceKey/);
  assert.match(image, /currentSourceKeyRef\.current\s*!==\s*sourceKey/);
  assert.match(image, /key=\{sourceKey\}/);
  assert.match(video, /loadedKey\s*===\s*sourceKey/);
  assert.match(video, /firstFrameKey\s*===\s*sourceKey/);
  assert.match(video, /currentSourceKeyRef\.current\s*!==\s*operationSourceKey/);
  assert.match(video, /key=\{sourceKey\s*\?\?/);
});

test('native screen-protection failure is fail-closed before either protected source can mount', () => {
  const image = read('components/premium/ProtectedPremiumImage.tsx');
  const video = read('components/premium/ProtectedPremiumVideo.tsx');
  for (const sourceText of [image, video]) {
    assert.match(sourceText, /mayMountSource\s*=\s*Boolean\(grant\s*&&\s*visible\s*&&\s*screenProtected\)/);
    assert.match(sourceText, /sourceKey\s*=\s*mayMountSource\s*&&\s*grant/);
    assert.match(sourceText, /styles\.cover/);
  }
  assert.match(image, /!sourceIsVisible/);
  assert.match(video, /!mediaVisible/);
});

test('watermark is visible, non-interactive, bounded, and contains no direct PII field', () => {
  const watermark = read('components/premium/PremiumWatermark.tsx');
  assert.match(watermark, /pointerEvents="none"/);
  assert.match(watermark, /userMarker/);
  assert.match(watermark, /sessionMarker/);
  assert.match(watermark, /timestamp/);
  assert.match(watermark, /slice\(0,\s*16\)/);
  assert.doesNotMatch(watermark, /email|phone|authToken|signedUrl|assetId|cloudflareUid/i);
});
