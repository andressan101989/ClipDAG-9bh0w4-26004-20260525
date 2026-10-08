import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const premiumServicePath = path.join(root, 'services/creatorPremiumStreamService.ts');
const contentId = '20000000-0000-4000-8000-000000000001';
const teaserAssetId = '30000000-0000-4000-8000-000000000001';
const videoAssetId = '40000000-0000-4000-8000-000000000001';

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadStreamService(invoke) {
  const module = { exports: {} };
  class MockFile {
    constructor(uri) {
      this.uri = uri;
      this.name = uri.split('/').pop() || 'video.mp4';
      this.size = 1000;
      this.exists = true;
    }
  }
  vm.runInNewContext(compile(read('services/streamService.ts'), 'streamService.ts'), {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    FormData,
    Blob,
    Response,
    require(specifier) {
      if (specifier === 'expo-file-system') return { File: MockFile };
      if (specifier === 'expo/fetch') return { fetch: async () => ({ ok: true, status: 200 }) };
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({
          functions: { invoke },
          rpc: async () => ({ data: null, error: null }),
          auth: {
            refreshSession: async () => ({ data: {}, error: null }),
            getSession: async () => ({ data: { session: null }, error: null }),
          },
          from: () => ({
            select() { return this; }, eq() { return this; },
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
      if (specifier === '@/services/mediaService') return {
        invokeRpcWithSingleAuthRefresh: async invokeRpc => invokeRpc(),
      };
      throw new Error(`Unexpected streamService module: ${specifier}`);
    },
  }, { filename: 'streamService.js' });
  return module.exports;
}

test('streamService creates exact Premium direct-upload context without changing Feed creation', async () => {
  const calls = [];
  const service = loadStreamService(async (name, options) => {
    calls.push({ name, body: structuredClone(options.body) });
    return { data: { success: true, data: {
      assetId: videoAssetId,
      uploadUrl: 'https://upload.example.test/direct',
      method: 'POST',
      formField: 'file',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      maxDurationSeconds: 60,
      maxSizeBytes: 200_000_000,
    } }, error: null };
  });
  await service.createCreatorPremiumStreamUpload({
    contentId, mimeType: 'video/mp4', sizeBytes: 1000, fileName: 'premium.mp4',
  });
  assert.deepEqual(calls[0], {
    name: 'create-stream-upload',
    body: {
      purpose: 'creator_premium_video', premium_content_id: contentId,
      mime_type: 'video/mp4', size_bytes: 1000, file_name: 'premium.mp4',
    },
  });
  await service.createStreamUpload({ mimeType: 'video/mp4', sizeBytes: 1000, fileName: 'feed.mp4' });
  assert.deepEqual(calls[1].body, {
    purpose: 'feed_video', mime_type: 'video/mp4', size_bytes: 1000, file_name: 'feed.mp4',
  });
});

test('Premium processing accepts ready with null URLs only under entitlement-required mode', async () => {
  const responses = [
    {
      assetId: videoAssetId, status: 'ready', progress: 100, durationSeconds: 12,
      width: 1920, height: 1080, hlsUrl: null, dashUrl: null, thumbnailUrl: null,
      errorCode: null, readyAt: new Date().toISOString(), playbackMode: 'premium_entitlement_required',
    },
    {
      assetId: videoAssetId, status: 'ready', progress: 100, durationSeconds: 12,
      width: 1920, height: 1080, hlsUrl: 'https://forbidden.example/video.m3u8',
      dashUrl: null, thumbnailUrl: null, errorCode: null, readyAt: new Date().toISOString(),
      playbackMode: 'premium_entitlement_required',
    },
  ];
  const service = loadStreamService(async () => ({
    data: { success: true, data: responses.shift() }, error: null,
  }));
  const ready = await service.getCreatorPremiumStreamProcessing(videoAssetId);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.hlsUrl, null);
  await assert.rejects(
    () => service.getCreatorPremiumStreamProcessing(videoAssetId),
    /invalid_premium_stream_processing_response/,
  );
});

function loadPremiumService({
  uploadTeaser = async () => ({
    assetId: teaserAssetId, provider: 'r2', mediaKind: 'image',
    purpose: 'creator_premium_teaser_image', visibility: 'public', status: 'ready',
    url: 'https://public.example.test/teaser.jpg',
  }),
  deleteTeaser = async () => {},
  createVideo = async () => ({
    assetId: videoAssetId, uploadUrl: 'https://upload.example.test/direct',
    method: 'POST', formField: 'file', expiresAt: new Date(Date.now() + 600_000).toISOString(),
    maxDurationSeconds: 60, maxSizeBytes: 200_000_000,
  }),
  postVideo = async () => {},
  waitVideo = async () => ({
    assetId: videoAssetId, status: 'ready', progress: 100, durationSeconds: 12,
    width: 1920, height: 1080, hlsUrl: null, dashUrl: null, thumbnailUrl: null,
    errorCode: null, readyAt: new Date().toISOString(), playbackMode: 'premium_entitlement_required',
  }),
  deleteVideo = async () => {},
  rpc = async name => name === 'set_my_creator_premium_video_media_v1'
    ? { data: [{
      content_id: contentId, teaser_url: 'https://public.example.test/teaser.jpg',
      teaser_attached: true, video_attached: true, media_ready: true, replayed: false,
    }], error: null }
    : { data: [{
      content_id: contentId, content_kind: 'video', lifecycle_status: 'draft',
      teaser_url: 'https://public.example.test/teaser.jpg', teaser_attached: true,
      video_attached: true, video_ready: true, media_ready: true,
    }], error: null },
  invoke = async () => ({ data: { success: true, data: {
    contentId,
    hlsUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.m3u8',
    dashUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.mpd',
    thumbnailUrl: 'https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  } }, error: null }),
} = {}) {
  assert.equal(existsSync(premiumServicePath), true, 'creatorPremiumStreamService.ts must exist');
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/creatorPremiumStreamService.ts'), 'creatorPremiumStreamService.ts'), {
    module,
    exports: module.exports,
    console,
    URL,
    Date,
    require(specifier) {
      if (specifier === '@/services/mediaService') return {
        uploadMediaFromUri: uploadTeaser,
        deleteMediaAsset: deleteTeaser,
        getSafeMediaError: error => ({ code: error?.code ?? error?.message ?? 'media_operation_failed' }),
      };
      if (specifier === '@/services/streamService') return {
        createCreatorPremiumStreamUpload: createVideo,
        postVideoToStreamUploadUrl: postVideo,
        waitForCreatorPremiumStreamReady: waitVideo,
        deleteStreamVideo: deleteVideo,
        getSafeStreamError: error => ({ code: error?.code ?? error?.message ?? 'stream_operation_failed' }),
      };
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({ rpc, functions: { invoke } }),
      };
      throw new Error(`Unexpected creatorPremiumStreamService module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumStreamService.js' });
  return module.exports;
}

const input = {
  contentId,
  teaser: {
    uri: 'file:///teaser.jpg', mimeType: 'image/jpeg', fileName: 'teaser.jpg', sizeBytes: 100,
  },
  video: {
    uri: 'file:///premium.mp4', mimeType: 'video/mp4', fileName: 'premium.mp4', sizeBytes: 1000,
  },
};

test('Premium video flow reuses B2 teaser, uploads privately, polls safely, and first-binds without returning IDs', async () => {
  const calls = [];
  const service = loadPremiumService({
    uploadTeaser: async value => {
      calls.push(['teaser', structuredClone(value)]);
      return {
        assetId: teaserAssetId, purpose: 'creator_premium_teaser_image', visibility: 'public',
        status: 'ready', url: 'https://public.example.test/teaser.jpg',
      };
    },
    createVideo: async value => {
      calls.push(['create', structuredClone(value)]);
      return { assetId: videoAssetId, uploadUrl: 'https://upload.example.test/direct' };
    },
    postVideo: async value => { calls.push(['post', structuredClone(value)]); },
    waitVideo: async value => {
      calls.push(['wait', value]);
      return { status: 'ready', playbackMode: 'premium_entitlement_required' };
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, structuredClone(args)]);
      return { data: [{
        content_id: contentId, teaser_url: 'https://public.example.test/teaser.jpg',
        teaser_attached: true, video_attached: true, media_ready: true, replayed: false,
      }], error: null };
    },
  });
  const result = await service.uploadCreatorPremiumVideoMedia(input);
  assert.deepEqual(calls[0][1], {
    ...input.teaser, purpose: 'creator_premium_teaser_image', visibility: 'public',
    premiumContentId: contentId,
  });
  assert.deepEqual(calls[1][1], {
    contentId, mimeType: 'video/mp4', sizeBytes: 1000, fileName: 'premium.mp4',
  });
  assert.equal(calls[2][1].uri, input.video.uri);
  assert.equal(calls[2][1].uploadUrl, 'https://upload.example.test/direct');
  assert.equal(calls[3][1], videoAssetId);
  assert.deepEqual(calls[4], ['rpc', 'set_my_creator_premium_video_media_v1', {
    p_content_id: contentId, p_teaser_asset_id: teaserAssetId, p_video_asset_id: videoAssetId,
  }]);
  assert.equal(result.contentId, contentId);
  assert.equal(result.mediaReady, true);
  assert.equal(JSON.stringify(result).includes(videoAssetId), false);
  assert.equal(Object.hasOwn(result, 'videoAssetId'), false);
});

test('Premium video flow cleans teaser when Stream creation fails', async () => {
  const deletions = [];
  const service = loadPremiumService({
    createVideo: async () => { throw new Error('stream_create_failed'); },
    deleteTeaser: async value => { deletions.push(['teaser', value]); },
    deleteVideo: async value => { deletions.push(['video', value]); },
  });
  await assert.rejects(() => service.uploadCreatorPremiumVideoMedia(input), /stream_create_failed/);
  assert.deepEqual(deletions, [['teaser', teaserAssetId]]);
});

test('Premium video flow cleans both canonical assets after processing or bind failure', async () => {
  for (const failure of ['processing', 'binding']) {
    const deletions = [];
    const service = loadPremiumService({
      waitVideo: failure === 'processing'
        ? async () => { throw new Error('processing_failed'); }
        : undefined,
      rpc: failure === 'binding'
        ? async () => ({ data: null, error: { message: 'bind_failed' } })
        : undefined,
      deleteTeaser: async value => { deletions.push(['teaser', value]); },
      deleteVideo: async value => { deletions.push(['video', value]); },
    });
    await assert.rejects(
      () => service.uploadCreatorPremiumVideoMedia(input),
      new RegExp(failure === 'processing' ? 'processing_failed' : 'bind_failed'),
    );
    assert.deepEqual(deletions.sort(), [
      ['teaser', teaserAssetId], ['video', videoAssetId],
    ].sort());
  }
});

test('cleanup failures remain observable but never disclose private asset identifiers', async () => {
  const service = loadPremiumService({
    waitVideo: async () => { throw new Error('processing_failed'); },
    deleteTeaser: async () => { throw new Error('teaser_cleanup_failed'); },
    deleteVideo: async () => { throw new Error('video_cleanup_failed'); },
  });
  await assert.rejects(async () => {
    try { await service.uploadCreatorPremiumVideoMedia(input); }
    catch (error) {
      assert.deepEqual(JSON.parse(JSON.stringify(error.cleanupFailures)), [
        { role: 'teaser', code: 'teaser_cleanup_failed' },
        { role: 'video', code: 'video_cleanup_failed' },
      ]);
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes(teaserAssetId), false);
      assert.equal(serialized.includes(videoAssetId), false);
      throw error;
    }
  }, /processing_failed/);
});

test('owner state is safe and playback grant sends only content ID with strict URL and expiry validation', async () => {
  const invokeCalls = [];
  const service = loadPremiumService({
    invoke: async (name, options) => {
      invokeCalls.push({ name, options: structuredClone(options) });
      return { data: { success: true, data: {
        contentId,
        hlsUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.m3u8',
        dashUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.mpd',
        thumbnailUrl: 'https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      } }, error: null };
    },
  });
  const state = await service.fetchMyCreatorPremiumVideoMedia(contentId);
  assert.equal(state.video_attached, true);
  assert.equal(Object.hasOwn(state, 'video_asset_id'), false);
  const grant = await service.getCreatorPremiumVideoPlaybackGrant(contentId);
  assert.deepEqual(invokeCalls, [{
    name: 'get-stream-playback', options: { body: { premium_content_id: contentId } },
  }]);
  assert.match(grant.hlsUrl, /^https:\/\//);
  assert.ok(Date.parse(grant.expiresAt) <= Date.now() + 315_000);
  assert.equal(Object.hasOwn(grant, 'token'), false);

  for (const invalid of [
    { hlsUrl: 'http://customer-test.cloudflarestream.com/token/manifest/video.m3u8' },
    { hlsUrl: 'https://customer-test.cloudflarestream.com/token/not-hls' },
    { dashUrl: 'https://customer-test.cloudflarestream.com/token/not-dash' },
    { thumbnailUrl: 'file:///private.jpg' },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { expiresAt: new Date(Date.now() + 400_000).toISOString() },
    { contentId: otherContentId },
  ]) {
    const invalidService = loadPremiumService({
      invoke: async () => ({ data: { success: true, data: {
        contentId,
        hlsUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.m3u8',
        dashUrl: 'https://customer-test.cloudflarestream.com/token/manifest/video.mpd',
        thumbnailUrl: 'https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        ...invalid,
      } }, error: null }),
    });
    await assert.rejects(
      () => invalidService.getCreatorPremiumVideoPlaybackGrant(contentId),
      /invalid_premium_video_grant/,
    );
  }
});

const otherContentId = '20000000-0000-4000-8000-000000000002';

test('B3 client stores no signed grant and does not enable viewer, finance, replacement, or profile playback', () => {
  assert.equal(existsSync(premiumServicePath), true);
  const source = read('services/creatorPremiumStreamService.ts');
  assert.doesNotMatch(source, /AsyncStorage|expo-file-system|FileSystem|MediaLibrary|expo-sharing|Share\.|prefetch|background.?download/i);
  assert.doesNotMatch(source, /setItem\(|writeAsStringAsync|copyAsync|saveToLibraryAsync/i);
  assert.doesNotMatch(source, /replaceCreatorPremium|replacement/i);
  const premium = read('services/creatorPremiumService.ts');
  assert.match(premium, /CREATOR_PREMIUM_VIDEO_MEDIA_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*true/);
  assert.match(premium, /CREATOR_PREMIUM_MEDIA_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
  assert.match(premium, /CREATOR_PREMIUM_FINANCE_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
  assert.match(premium, /video_attached:\s*boolean/);
  assert.match(premium, /video_media_ready:\s*boolean/);
  const profile = read('app/creator/[id].tsx');
  assert.doesNotMatch(profile, /getCreatorPremiumVideoPlaybackGrant|get-stream-playback|premium_content_id/);
  assert.doesNotMatch(profile, /purchaseCreatorPremium|subscribeCreatorPremium|bdag-economy/);
});
