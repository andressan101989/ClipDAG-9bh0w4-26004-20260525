import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const premiumMediaPath = path.join(root, 'services/creatorPremiumMediaService.ts');

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

function loadMediaService(invoke) {
  const module = { exports: {} };
  class MockFile {
    constructor(uri) { this.uri = uri; this.name = uri.split('/').pop() || 'file'; this.size = 123; }
  }
  vm.runInNewContext(compile(read('services/mediaService.ts'), 'mediaService.ts'), {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Response,
    require(specifier) {
      if (specifier === 'expo-file-system') return { File: MockFile };
      if (specifier === 'expo/fetch') return { fetch: async () => new Response() };
      if (specifier === 'expo-image-manipulator') {
        return { manipulateAsync: async () => ({ uri: 'file:///converted.jpg' }), SaveFormat: { JPEG: 'jpeg' } };
      }
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({
          functions: { invoke },
          rpc: async () => ({ data: null, error: null }),
          auth: { getSession: async () => ({ data: { session: null } }) },
          from: () => ({ select() { return this; }, in() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
      throw new Error(`Unexpected mediaService module: ${specifier}`);
    },
  }, { filename: 'mediaService.js' });
  return module.exports;
}

test('mediaService sends premium_content_id only for exact Premium image purposes', async () => {
  const calls = [];
  const service = loadMediaService(async (name, options) => {
    calls.push({ name, options });
    return {
      data: { success: true, data: {
        assetId: '30000000-0000-4000-8000-000000000001',
        uploadUrl: 'https://upload.example.test/put', method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      } },
      error: null,
    };
  });
  for (const [purpose, visibility] of [
    ['creator_premium_teaser_image', 'public'],
    ['creator_premium_original_image', 'private'],
  ]) {
    await service.createMediaUpload({
      uri: 'file:///image.jpg', purpose, mimeType: 'image/jpeg', visibility,
      premiumContentId: '20000000-0000-4000-8000-000000000001',
    });
    assert.equal(calls.at(-1).options.body.premium_content_id, '20000000-0000-4000-8000-000000000001');
  }
  await service.createMediaUpload({
    uri: 'file:///image.jpg', purpose: 'post_image', mimeType: 'image/jpeg', visibility: 'public',
  });
  assert.equal(Object.hasOwn(calls.at(-1).options.body, 'premium_content_id'), false);
  await assert.rejects(() => service.createMediaUpload({
    uri: 'file:///image.jpg', purpose: 'post_image', mimeType: 'image/jpeg', visibility: 'public',
    premiumContentId: '20000000-0000-4000-8000-000000000001',
  }), /premium_context_not_allowed/);
});

function loadPremiumMediaService({
  uploadImpl,
  deleteImpl = async () => {},
  rpcImpl = async name => name === 'set_my_creator_premium_image_media_v1'
    ? { data: [{ content_id: contentId, teaser_url: 'https://public.example.test/teaser.jpg', teaser_attached: true, original_attached: true, media_ready: true, replayed: false, replacement_cleanup_scheduled: false }], error: null }
    : { data: [{ content_id: contentId, content_kind: 'image', lifecycle_status: 'draft', teaser_url: 'https://public.example.test/teaser.jpg', teaser_attached: true, original_attached: true, media_ready: true }], error: null },
  invokeImpl = async () => ({ data: { success: true, data: {
    contentId,
    url: 'https://premium-private.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/original.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=secret',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  } }, error: null }),
} = {}) {
  assert.equal(existsSync(premiumMediaPath), true, 'creatorPremiumMediaService.ts must exist');
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/creatorPremiumMediaService.ts'), 'creatorPremiumMediaService.ts'), {
    module,
    exports: module.exports,
    console,
    URL,
    require(specifier) {
      if (specifier === '@/services/mediaService') return {
        uploadMediaFromUri: uploadImpl,
        deleteMediaAsset: deleteImpl,
        getSafeMediaError: error => ({ code: error?.code ?? error?.message ?? 'media_operation_failed', message: error?.message ?? 'media_operation_failed' }),
      };
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({ rpc: rpcImpl, functions: { invoke: invokeImpl } }),
      };
      throw new Error(`Unexpected creatorPremiumMediaService module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumMediaService.js' });
  return module.exports;
}

const contentId = '20000000-0000-4000-8000-000000000001';
const teaserAsset = {
  assetId: '30000000-0000-4000-8000-000000000001', provider: 'r2', mediaKind: 'image',
  purpose: 'creator_premium_teaser_image', visibility: 'public', status: 'ready',
  url: 'https://public.example.test/teaser.jpg',
};
const originalAsset = {
  assetId: '30000000-0000-4000-8000-000000000002', provider: 'r2', mediaKind: 'image',
  purpose: 'creator_premium_original_image', visibility: 'private', status: 'ready',
};
const pairInput = {
  contentId,
  teaser: { uri: 'file:///teaser.jpg', mimeType: 'image/jpeg', fileName: 'teaser.jpg', sizeBytes: 120 },
  original: { uri: 'file:///original.jpg', mimeType: 'image/jpeg', fileName: 'original.jpg', sizeBytes: 900 },
};

test('Premium image pair uploads separate exact contracts and binds once without exposing original identity', async () => {
  const uploads = [];
  const rpcCalls = [];
  const service = loadPremiumMediaService({
    uploadImpl: async input => {
      uploads.push(input);
      return uploads.length === 1 ? teaserAsset : originalAsset;
    },
    rpcImpl: async (name, args) => {
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return { data: [{
        content_id: contentId, teaser_url: teaserAsset.url, teaser_attached: true,
        original_attached: true, media_ready: true, replayed: false,
        replacement_cleanup_scheduled: false,
      }], error: null };
    },
  });
  const result = await service.uploadCreatorPremiumImagePair(pairInput);
  assert.deepEqual(uploads.map(item => ({
    purpose: item.purpose, visibility: item.visibility, premiumContentId: item.premiumContentId,
  })), [
    { purpose: 'creator_premium_teaser_image', visibility: 'public', premiumContentId: contentId },
    { purpose: 'creator_premium_original_image', visibility: 'private', premiumContentId: contentId },
  ]);
  assert.deepEqual(rpcCalls, [{
    name: 'set_my_creator_premium_image_media_v1',
    args: { p_content_id: contentId, p_teaser_asset_id: teaserAsset.assetId, p_original_asset_id: originalAsset.assetId },
  }]);
  assert.equal(Object.hasOwn(result, 'originalAssetId'), false);
  assert.equal(JSON.stringify(result).includes(originalAsset.assetId), false);
});

test('Premium image pair cleans partial upload and reports cleanup failure safely', async () => {
  const deletes = [];
  let call = 0;
  const service = loadPremiumMediaService({
    uploadImpl: async () => {
      call += 1;
      if (call === 1) return teaserAsset;
      throw new Error('original_upload_failed');
    },
    deleteImpl: async assetId => { deletes.push(assetId); throw new Error('cleanup_unavailable'); },
  });
  await assert.rejects(async () => {
    try { await service.uploadCreatorPremiumImagePair(pairInput); }
    catch (error) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(error.cleanupFailures)),
        [{ role: 'teaser', code: 'cleanup_unavailable' }],
      );
      assert.equal(JSON.stringify(error).includes(teaserAsset.assetId), false);
      throw error;
    }
  }, /original_upload_failed/);
  assert.deepEqual(deletes, [teaserAsset.assetId]);
});

test('Premium image pair cleans both new assets after bind failure', async () => {
  const deletes = [];
  let call = 0;
  const service = loadPremiumMediaService({
    uploadImpl: async () => (++call === 1 ? teaserAsset : originalAsset),
    deleteImpl: async assetId => { deletes.push(assetId); },
    rpcImpl: async () => ({ data: null, error: { message: 'bind_failed' } }),
  });
  await assert.rejects(() => service.uploadCreatorPremiumImagePair(pairInput), /bind_failed/);
  assert.deepEqual(deletes.sort(), [teaserAsset.assetId, originalAsset.assetId].sort());
});

test('Premium original grant validates HTTPS/future expiry and is never persisted or shared', async () => {
  const service = loadPremiumMediaService({ uploadImpl: async () => teaserAsset });
  const grant = await service.getCreatorPremiumOriginalImageGrant(contentId);
  assert.match(grant.url, /^https:\/\//);
  assert.ok(Date.parse(grant.expiresAt) > Date.now());
  for (const invalid of [
    { url: 'http://signed.example.test/file', expiresAt: new Date(Date.now() + 10_000).toISOString() },
    { url: 'https://signed.example.test/file', expiresAt: new Date(Date.now() - 1).toISOString() },
  ]) {
    const invalidService = loadPremiumMediaService({
      uploadImpl: async () => teaserAsset,
      invokeImpl: async () => ({ data: { success: true, data: { contentId, ...invalid } }, error: null }),
    });
    await assert.rejects(() => invalidService.getCreatorPremiumOriginalImageGrant(contentId), /invalid_premium_image_grant/);
  }
  const source = read('services/creatorPremiumMediaService.ts');
  assert.doesNotMatch(source, /AsyncStorage|expo-file-system|FileSystem|MediaLibrary|expo-sharing|Share\.|prefetch/i);
  assert.doesNotMatch(source, /setItem\(|writeAsStringAsync|copyAsync|saveToLibraryAsync/i);
});

test('B2 keeps complete media/finance disabled and adds only the image capability', () => {
  const service = read('services/creatorPremiumService.ts');
  assert.match(service, /CREATOR_PREMIUM_IMAGE_MEDIA_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*true/);
  assert.match(service, /CREATOR_PREMIUM_MEDIA_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
  assert.match(service, /CREATOR_PREMIUM_FINANCE_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
  assert.match(service, /teaser_url:\s*string/);
  assert.match(service, /original_attached:\s*boolean/);
});

test('creator profile renders public teaser only and never requests an original or enables finance', () => {
  const profile = read('app/creator/[id].tsx');
  assert.match(profile, /item\.teaser_url/);
  assert.doesNotMatch(profile, /getCreatorPremiumOriginalImageGrant|premium_content_id|original_asset_id/);
  assert.doesNotMatch(profile, /purchaseCreatorPremium|subscribeCreatorPremium|content_purchase|bdag-economy/);
  assert.match(profile, /CREATOR_PREMIUM_FOUNDATION_MESSAGE/);
});
