import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const premiumHelperPath = path.join(
  root,
  'supabase/functions/_shared/premiumR2Security.ts',
);
const noStore = 'private, no-store';

function compileCommonJs(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function executeModule(source, filename, modules = {}, globals = {}) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    Request,
    Response,
    Headers,
    URL,
    crypto,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    ...globals,
    require(specifier) {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      throw new Error(`Unexpected module in ${filename}: ${specifier}`);
    },
  };
  vm.runInNewContext(compileCommonJs(source, filename), sandbox, { filename });
  return module.exports;
}

test('Premium presigner binds canonical object no-store metadata and all required headers', async () => {
  assert.equal(existsSync(premiumHelperPath), true, 'Premium R2 helper must exist');
  const commandInputs = [];
  const signed = [];
  const canonicalClient = { authority: 'canonical-r2-client' };
  class PutObjectCommand {
    constructor(input) {
      this.input = input;
      commandInputs.push(input);
    }
  }
  const helper = executeModule(
    read('supabase/functions/_shared/premiumR2Security.ts'),
    'premiumR2Security.ts',
    {
      'npm:@aws-sdk/client-s3@3.637.0': { PutObjectCommand },
      'npm:@aws-sdk/s3-request-presigner@3.637.0': {
        async getSignedUrl(client, command, options) {
          signed.push({ client, command, options });
          return 'https://r2.example.test/premium-original';
        },
      },
      './r2.ts': { r2Client: () => canonicalClient },
    },
  );

  assert.equal(helper.PREMIUM_ORIGINAL_CACHE_CONTROL, noStore);
  assert.equal(
    await helper.signPremiumOriginalPutIfAbsent(
      'private-bucket',
      'premium/original.jpg',
      'image/jpeg',
    ),
    'https://r2.example.test/premium-original',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(commandInputs)), [{
    Bucket: 'private-bucket',
    Key: 'premium/original.jpg',
    ContentType: 'image/jpeg',
    IfNoneMatch: '*',
    CacheControl: noStore,
  }]);
  assert.equal(signed[0].client, canonicalClient);
  assert.equal(signed[0].options.expiresIn, 300);
  assert.deepEqual(
    [...signed[0].options.signableHeaders].sort(),
    ['cache-control', 'content-type', 'if-none-match'],
  );
});

const purposeModule = executeModule(
  read('supabase/functions/_shared/mediaPurposes.ts'),
  'mediaPurposes.ts',
);

function queryResult(result) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    gte() { return chain; },
    in() { return chain; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

function loadCreateMediaUpload() {
  let handler;
  const normalPresigns = [];
  const premiumPresigns = [];
  const db = {
    from() {
      return {
        select() { return queryResult({ data: [], count: 0, error: null }); },
        insert() { return Promise.resolve({ error: null }); },
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  executeModule(read('supabase/functions/create-media-upload/index.ts'), 'create-media-upload.ts', {
    '../_shared/businessMediaAuth.ts': {
      businessActorHasAdvertiserOwnerMediaAccess: async () => false,
      businessActorHasAnyCapability: async () => false,
      isUuid: value => /^[0-9a-f-]{36}$/i.test(String(value)),
    },
    '../_shared/mediaAuth.ts': {
      authenticatedUser: async () => ({ id: '10000000-0000-4000-8000-000000000001' }),
      authenticatedClient: () => ({ rpc: async () => ({ data: true, error: null }) }),
      admin: () => db,
      corsHeaders: {},
      json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    },
    '../_shared/mediaPurposes.ts': purposeModule,
    '../_shared/r2.ts': {
      R2_PRIVATE_BUCKET: () => 'private-bucket',
      R2_PUBLIC_BUCKET: () => 'public-bucket',
      async signPutIfAbsent(...args) {
        normalPresigns.push(args);
        return 'https://upload.example.test/ordinary';
      },
    },
    '../_shared/premiumR2Security.ts': {
      PREMIUM_ORIGINAL_CACHE_CONTROL: noStore,
      async signPremiumOriginalPutIfAbsent(...args) {
        premiumPresigns.push(args);
        return 'https://upload.example.test/premium-original';
      },
    },
  }, {
    Deno: {
      env: { get: () => 'deployment' },
      serve(fn) { handler = fn; },
    },
  });
  return { handler, normalPresigns, premiumPresigns };
}

async function post(handler, body) {
  const response = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

const contentId = '20000000-0000-4000-8000-000000000001';
const baseUpload = {
  mime_type: 'image/jpeg',
  size_bytes: 1234,
  file_name: 'safe.jpg',
};

test('create-media-upload uses no-store presigner and returns exact Premium original PUT headers', async () => {
  const harness = loadCreateMediaUpload();
  const { response, json } = await post(harness.handler, {
    ...baseUpload,
    purpose: 'creator_premium_original_image',
    visibility: 'private',
    premium_content_id: contentId,
  });
  assert.equal(response.status, 200);
  assert.equal(json.data.uploadUrl, 'https://upload.example.test/premium-original');
  assert.deepEqual(json.data.headers, {
    'Content-Type': 'image/jpeg',
    'If-None-Match': '*',
    'Cache-Control': noStore,
  });
  assert.equal(harness.premiumPresigns.length, 1);
  assert.equal(harness.normalPresigns.length, 0);
});

test('teaser and ordinary uploads preserve their existing cache-neutral contract', async () => {
  for (const body of [
    {
      ...baseUpload,
      purpose: 'creator_premium_teaser_image',
      visibility: 'public',
      premium_content_id: contentId,
    },
    { ...baseUpload, purpose: 'post_image', visibility: 'public' },
  ]) {
    const harness = loadCreateMediaUpload();
    const { response, json } = await post(harness.handler, body);
    assert.equal(response.status, 200);
    assert.deepEqual(json.data.headers, {
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
    });
    assert.equal(harness.normalPresigns.length, 1);
    assert.equal(harness.premiumPresigns.length, 0);
  }
});

function loadMediaService() {
  const module = { exports: {} };
  class MockFile {
    constructor(uri) {
      this.uri = uri;
      this.name = 'photo.jpg';
      this.size = 1234;
    }
  }
  vm.runInNewContext(compileCommonJs(read('services/mediaService.ts'), 'mediaService.ts'), {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Response,
    require(specifier) {
      if (specifier === 'expo-file-system') return { File: MockFile };
      if (specifier === 'expo/fetch') return { fetch: async () => ({ ok: true, status: 200 }) };
      if (specifier === 'expo-image-manipulator') {
        return { manipulateAsync: async () => ({ uri: 'file:///converted.jpg' }), SaveFormat: { JPEG: 'jpeg' } };
      }
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({
          functions: { invoke: async () => ({ data: null, error: null }) },
          rpc: async () => ({ data: null, error: null }),
          auth: { getSession: async () => ({ data: { session: null } }) },
          from: () => ({
            select() { return this; },
            in() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
      throw new Error(`Unexpected mediaService module: ${specifier}`);
    },
  }, { filename: 'mediaService.js' });
  return module.exports;
}

test('mobile R2 PUT forwards and preserves Premium Cache-Control across retry and 412 recovery', async () => {
  assert.match(
    read('services/mediaService.ts'),
    /"Cache-Control"\?:\s*string;/,
    'R2 header contract must permit server-signed Cache-Control',
  );
  const service = loadMediaService();
  const headers = {
    'Content-Type': 'image/jpeg',
    'If-None-Match': '*',
    'Cache-Control': noStore,
  };
  const calls = [];
  const result = await service.putFileToR2WithRetry({
    file: { uri: 'file:///premium.jpg' },
    uploadUrl: 'https://signed.example.test/premium',
    headers,
    signal: new AbortController().signal,
    operationId: 'premium-c1',
    mimeType: 'image/jpeg',
    fetcher: async (_url, init) => {
      calls.push(JSON.parse(JSON.stringify(init.headers)));
      if (calls.length === 1) throw new Error('network request failed');
      return { ok: false, status: 412 };
    },
    sleep: async () => {},
  });
  assert.equal(result.status, 412);
  assert.deepEqual(calls, [headers, headers]);
});

function mutationResult(result = { error: null }) {
  const chain = {
    eq() { return chain; },
    in() { return chain; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

function loadFinalizeMediaUpload({ purpose = 'creator_premium_original_image', cacheControl } = {}) {
  let handler;
  const updates = [];
  const deletes = [];
  const asset = {
    id: '30000000-0000-4000-8000-000000000001',
    owner_id: '10000000-0000-4000-8000-000000000001',
    provider: 'r2',
    media_kind: 'image',
    purpose,
    visibility: purpose === 'creator_premium_original_image' ? 'private' : 'public',
    bucket_name: purpose === 'creator_premium_original_image' ? 'private-bucket' : 'public-bucket',
    object_key: 'development/premium/image.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    status: 'uploading',
    public_url: null,
    cleanup_attempts: 0,
  };
  const db = {
    from(table) {
      assert.equal(table, 'media_assets');
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({ data: asset, error: null }),
          };
        },
        update(row) {
          updates.push(JSON.parse(JSON.stringify(row)));
          return mutationResult();
        },
      };
    },
  };
  executeModule(read('supabase/functions/finalize-media-upload/index.ts'), 'finalize-media-upload.ts', {
    '../_shared/businessMediaAuth.ts': { businessActorHasAnyCapability: async () => false },
    '../_shared/mediaAuth.ts': {
      authenticatedUser: async () => ({ id: asset.owner_id }),
      admin: () => db,
      corsHeaders: {},
      json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    },
    '../_shared/r2.ts': {
      async headObject() {
        return {
          ContentLength: 1234,
          ContentType: 'image/jpeg',
          CacheControl: cacheControl,
          ETag: '"etag"',
        };
      },
      async deleteObject(bucket, key) { deletes.push({ bucket, key }); },
      isR2NotFound: () => false,
      isR2Transient: () => false,
      publicUrl: key => `https://public.example.test/${key}`,
    },
    '../_shared/premiumR2Security.ts': {
      PREMIUM_ORIGINAL_CACHE_CONTROL: noStore,
      premiumOriginalHasRequiredCacheControl: value =>
        typeof value === 'string' && value.trim() === noStore,
    },
  }, {
    Deno: { serve(fn) { handler = fn; } },
  });
  return { handler, updates, deletes };
}

test('finalize allows Premium original ready only after provider proves exact no-store metadata', async () => {
  for (const cacheControl of [noStore, `  ${noStore}  `]) {
    const harness = loadFinalizeMediaUpload({ cacheControl });
    const { response, json } = await post(harness.handler, {
      asset_id: '30000000-0000-4000-8000-000000000001',
    });
    assert.equal(response.status, 200);
    assert.equal(json.data.status, 'ready');
    assert.ok(harness.updates.some(update => update.status === 'ready'));
    assert.equal(harness.deletes.length, 0);
  }
});

test('finalize rejects missing, wrong, and public Premium original Cache-Control through canonical cleanup', async () => {
  for (const cacheControl of [undefined, '', 'public, max-age=31536000', 'private, max-age=0']) {
    const harness = loadFinalizeMediaUpload({ cacheControl });
    const { response, json } = await post(harness.handler, {
      asset_id: '30000000-0000-4000-8000-000000000001',
    });
    assert.equal(response.status, 409);
    assert.equal(json.error, 'object_mismatch');
    assert.equal(json.mismatch_code, 'premium_original_cache_control_mismatch');
    assert.ok(harness.updates.some(update => update.status === 'delete_pending'));
    assert.ok(harness.updates.some(update => update.status === 'deleted'));
    assert.equal(harness.updates.some(update => update.status === 'ready'), false);
    assert.equal(harness.deletes.length, 1);
  }
});

test('Premium teaser does not require private no-store metadata at finalize', async () => {
  const harness = loadFinalizeMediaUpload({
    purpose: 'creator_premium_teaser_image',
    cacheControl: 'public, max-age=86400',
  });
  const { response, json } = await post(harness.handler, {
    asset_id: '30000000-0000-4000-8000-000000000001',
  });
  assert.equal(response.status, 200);
  assert.equal(json.data.status, 'ready');
  assert.ok(harness.updates.some(update => update.status === 'ready'));
});

test('Premium grant JSON no-store remains intact without changing get-media-url', () => {
  const source = read('supabase/functions/get-media-url/index.ts');
  assert.match(source, /['"]Cache-Control['"]:\s*['"]private, no-store['"]/);
  assert.match(source, /['"]Pragma['"]:\s*['"]no-cache['"]/);
  assert.match(source, /signGet\(original\.bucket_name,original\.object_key,300\)/);
  assert.match(source, /Date\.now\(\)\+300_000/);
});
