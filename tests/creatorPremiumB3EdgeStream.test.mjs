import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

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
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    ...globals,
    require(specifier) {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      throw new Error(`Unexpected module in ${filename}: ${specifier}`);
    },
  };
  vm.runInNewContext(compileCommonJs(source, filename), sandbox, { filename });
  return module.exports;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(handler, body) {
  const response = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

function mutationResult(result = { error: null }) {
  const chain = {
    eq() { return chain; },
    select() { return chain; },
    single: async () => result,
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '10000000-0000-4000-8000-000000000002';
const contentId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const secondAssetId = '30000000-0000-4000-8000-000000000002';

function loadCreateStreamUpload({
  authorized = true,
  businessAllowed = true,
  user = { id: userId },
} = {}) {
  let handler;
  const providerCalls = [];
  const rpcCalls = [];
  const callerRpcCalls = [];
  const updates = [];
  const db = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      return { data: 'created', error: null };
    },
    from(table) {
      assert.equal(table, 'video_assets');
      return {
        update(values) {
          updates.push(structuredClone(values));
          return mutationResult({ error: null });
        },
      };
    },
  };
  const caller = {
    async rpc(name, args) {
      callerRpcCalls.push({ name, args: structuredClone(args) });
      return { data: authorized, error: null };
    },
  };
  executeModule(read('supabase/functions/create-stream-upload/index.ts'), 'create-stream-upload.ts', {
    '../_shared/businessMediaAuth.ts': {
      businessActorHasAdvertiserOwnerMediaAccess: async () => businessAllowed,
      businessActorHasAnyCapability: async () => businessAllowed,
      isUuid: value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)),
    },
    '../_shared/mediaAuth.ts': {
      authenticatedClient: () => caller,
      authenticatedUser: async () => user,
      admin: () => db,
      corsHeaders: {},
      json,
    },
    '../_shared/premiumStreamSecurity.ts': {
      CREATOR_PREMIUM_STREAM_PURPOSE: 'creator_premium_video',
    },
    '../_shared/stream.ts': {
      STREAM_MAX_DURATION_SECONDS: 60,
      STREAM_MAX_SIZE_BYTES: 200_000_000,
      safeFilename: value => String(value ?? 'video'),
      sanitizeProviderError: () => ({ code: 'provider_error', message: 'provider_error', status: 502 }),
      async streamFetch(pathname, init) {
        providerCalls.push({ pathname, body: JSON.parse(String(init.body)) });
        return { success: true, result: { uid: 'provider-uid', uploadURL: 'https://upload.example.test/direct' } };
      },
      validateStreamMime: value => ['video/mp4', 'video/quicktime', 'video/webm'].includes(String(value)) ? String(value) : null,
      validateStreamSize: value => Number(value) > 0 && Number(value) <= 200_000_000 ? Number(value) : null,
    },
  }, {
    Deno: {
      env: { get: name => name === 'DENO_DEPLOYMENT_ID' ? 'deployment' : undefined },
      serve(fn) { handler = fn; },
    },
  });
  return { handler, providerCalls, rpcCalls, callerRpcCalls, updates };
}

const upload = {
  purpose: 'creator_premium_video',
  premium_content_id: contentId,
  mime_type: 'video/mp4',
  size_bytes: 1024,
  file_name: 'premium.mp4',
};

test('create-stream-upload rejects malformed or mixed Premium context before reservation', async () => {
  for (const body of [
    { ...upload, premium_content_id: undefined },
    { ...upload, premium_content_id: 'bad' },
    { ...upload, business_owner_id: otherUserId },
    { ...upload, purpose: 'feed_video' },
    { ...upload, purpose: 'business_library', business_owner_id: otherUserId },
  ]) {
    const harness = loadCreateStreamUpload();
    const { response } = await post(harness.handler, body);
    assert.equal(response.status, 400);
    assert.equal(harness.rpcCalls.length, 0);
    assert.equal(harness.providerCalls.length, 0);
  }
});

test('Premium direct upload uses caller authorization, private reservation, signed URLs, and content metadata', async () => {
  const denied = loadCreateStreamUpload({ authorized: false });
  assert.equal((await post(denied.handler, upload)).response.status, 403);
  assert.equal(denied.rpcCalls.length, 0);

  const harness = loadCreateStreamUpload();
  const { response, json: payload } = await post(harness.handler, upload);
  assert.equal(response.status, 200);
  assert.deepEqual(harness.callerRpcCalls, [{
    name: 'authorize_my_creator_premium_video_upload_v1',
    args: { p_content_id: contentId },
  }]);
  assert.equal(harness.rpcCalls.length, 1);
  assert.equal(harness.rpcCalls[0].args.p_owner_id, userId);
  assert.equal(harness.rpcCalls[0].args.p_purpose, 'creator_premium_video');
  assert.equal(harness.providerCalls.length, 1);
  const provider = harness.providerCalls[0].body;
  assert.equal(provider.requireSignedURLs, true);
  assert.equal(provider.meta.purpose, 'creator_premium_video');
  assert.equal(provider.meta.premium_content_id, contentId);
  assert.equal(provider.meta.asset_id, payload.data.assetId);
  assert.equal(provider.meta.environment, 'production');
  assert.equal(Object.hasOwn(provider, 'apiToken'), false);
});

test('Feed and Business keep unsigned direct uploads and never receive Premium metadata', async () => {
  for (const body of [
    { ...upload, purpose: 'feed_video', premium_content_id: undefined },
    { ...upload, purpose: 'business_library', premium_content_id: undefined, business_owner_id: otherUserId },
  ]) {
    const harness = loadCreateStreamUpload();
    const { response } = await post(harness.handler, body);
    assert.equal(response.status, 200);
    const provider = harness.providerCalls[0].body;
    assert.equal(provider.requireSignedURLs, false);
    assert.equal(Object.hasOwn(provider.meta, 'premium_content_id'), false);
  }
});

function loadWebhook({ asset, premiumUpdates, publicUpdates } = {}) {
  let handler;
  const updates = [];
  const row = asset ?? {
    id: assetId,
    purpose: 'creator_premium_video',
    status: 'processing',
    cloudflare_uid: 'provider-uid',
    max_duration_seconds: 60,
    ready_at: null,
  };
  const db = {
    from(table) {
      assert.equal(table, 'video_assets');
      return {
        select() {
          const chain = {
            eq() { return chain; },
            maybeSingle: async () => ({ data: row, error: null }),
          };
          return chain;
        },
        update(values) {
          updates.push(structuredClone(values));
          return mutationResult({ error: null });
        },
      };
    },
  };
  executeModule(read('supabase/functions/stream-webhook/index.ts'), 'stream-webhook.ts', {
    '../_shared/mediaAuth.ts': { admin: () => db, json },
    '../_shared/premiumStreamSecurity.ts': {
      CREATOR_PREMIUM_STREAM_PURPOSE: 'creator_premium_video',
      reconcilePremiumStreamVideo: () => premiumUpdates ?? {
        status: 'ready', provider_status: 'ready', provider_progress: 100,
        duration_seconds: 12, width: 1920, height: 1080,
        hls_url: null, dash_url: null, thumbnail_url: null,
        provider_metadata: { require_signed_urls: true }, error_code: null,
        error_message: null, ready_at: '2026-10-08T00:00:00.000Z',
        last_provider_check_at: '2026-10-08T00:00:00.000Z',
      },
    },
    '../_shared/stream.ts': {
      isUuid: value => typeof value === 'string' && value.length === 36,
      reconcileStreamVideo: () => publicUpdates ?? {
        status: 'ready', hls_url: 'https://public.example/hls.m3u8',
        dash_url: 'https://public.example/video.mpd', thumbnail_url: 'https://public.example/thumb.jpg',
        ready_at: '2026-10-08T00:00:00.000Z', error_code: null, error_message: null,
      },
      streamCustomerCode: () => 'customer-code',
      streamWebhookSecret: () => 'secret',
      verifyWebhook: async () => true,
      webhookVideo: payload => payload,
    },
  }, {
    Deno: { serve(fn) { handler = fn; } },
  });
  return { handler, updates };
}

async function webhook(handler, video) {
  const response = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { 'Webhook-Signature': 'valid' },
    body: JSON.stringify(video),
  }));
  return { response, json: await response.json() };
}

test('webhook uses Premium reconciliation without persisting provider playback URLs', async () => {
  const harness = loadWebhook();
  const { response } = await webhook(harness.handler, {
    uid: 'provider-uid', meta: { asset_id: assetId }, status: { state: 'ready' },
    readyToStream: true, requireSignedURLs: true,
    playback: { hls: 'https://forbidden/hls', dash: 'https://forbidden/dash' },
    thumbnail: 'https://forbidden/thumb',
  });
  assert.equal(response.status, 200);
  assert.equal(harness.updates.length, 1);
  assert.equal(harness.updates[0].hls_url, null);
  assert.equal(harness.updates[0].dash_url, null);
  assert.equal(harness.updates[0].thumbnail_url, null);
  assert.deepEqual(harness.updates[0].provider_metadata, { require_signed_urls: true });
});

test('webhook preserves public reconciliation and Premium ready idempotency', async () => {
  const publicHarness = loadWebhook({ asset: {
    id: assetId, purpose: 'feed_video', status: 'processing', cloudflare_uid: 'provider-uid', max_duration_seconds: 60,
  } });
  assert.equal((await webhook(publicHarness.handler, { uid: 'provider-uid', meta: { asset_id: assetId } })).response.status, 200);
  assert.equal(publicHarness.updates[0].hls_url, 'https://public.example/hls.m3u8');

  const readyHarness = loadWebhook({ asset: {
    id: assetId, purpose: 'creator_premium_video', status: 'ready', cloudflare_uid: 'provider-uid',
    max_duration_seconds: 60, ready_at: 'original-ready-at',
  }, premiumUpdates: {
    status: 'processing', hls_url: null, dash_url: null, thumbnail_url: null,
    last_provider_check_at: 'later',
  } });
  assert.equal((await webhook(readyHarness.handler, { uid: 'provider-uid', meta: { asset_id: assetId } })).response.status, 200);
  assert.equal(readyHarness.updates.length, 0);
});

function rowsChain(rows, error = null) {
  const filters = [];
  let limitValue = null;
  const chain = {
    select() { return chain; },
    eq(column, value) { filters.push([column, value]); return chain; },
    limit(value) { limitValue = value; return chain; },
    maybeSingle: async () => {
      const selected = rows.filter(row => filters.every(([column, value]) => row[column] === value));
      return { data: selected.length === 1 ? selected[0] : null, error };
    },
    single: async () => {
      const selected = rows.filter(row => filters.every(([column, value]) => row[column] === value));
      return { data: selected.length === 1 ? selected[0] : null, error };
    },
    then(resolve, reject) {
      const selected = rows.filter(row => filters.every(([column, value]) => row[column] === value));
      const data = limitValue === null ? selected : selected.slice(0, limitValue);
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };
  return chain;
}

function loadPlayback({
  user = { id: userId },
  entitlement = { allowed: true },
  links = [{
    asset_id: assetId, entity_type: 'creator_premium_content', entity_id: contentId,
    slot: 'original', position: 0,
  }],
  assets = [{
    id: assetId, owner_id: userId, purpose: 'creator_premium_video', provider: 'cloudflare_stream',
    visibility: 'private', status: 'ready', cloudflare_uid: 'provider-uid',
    hls_url: null, dash_url: null, thumbnail_url: null,
    provider_metadata: { require_signed_urls: true }, provider_progress: 100,
    duration_seconds: 12, width: 1920, height: 1080, ready_at: '2026-10-08T00:00:00.000Z',
    last_provider_check_at: new Date().toISOString(), max_duration_seconds: 60,
  }],
} = {}) {
  let handler;
  const grantCalls = [];
  const rpcCalls = [];
  const db = {
    from(table) {
      if (table === 'video_asset_links') return rowsChain(links);
      if (table === 'video_assets') return rowsChain(assets);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const caller = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      return { data: [entitlement], error: null };
    },
  };
  executeModule(read('supabase/functions/get-stream-playback/index.ts'), 'get-stream-playback.ts', {
    '../_shared/mediaAuth.ts': {
      authenticatedClient: () => caller,
      authenticatedUser: async () => user,
      admin: () => db,
      json,
    },
    '../_shared/premiumStreamSecurity.ts': {
      CREATOR_PREMIUM_STREAM_PURPOSE: 'creator_premium_video',
      async createPremiumStreamPlaybackGrant(input) {
        grantCalls.push(structuredClone(input));
        return {
          hlsUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.m3u8',
          dashUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.mpd',
          thumbnailUrl: 'https://customer-code.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      },
      reconcilePremiumStreamVideo: () => ({}),
    },
    '../_shared/stream.ts': {
      isUuid: value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
      reconcileStreamVideo: () => ({}),
      sanitizeProviderError: () => ({ code: 'provider_error', status: 502 }),
      streamCustomerCode: () => 'code',
      streamFetch: async () => ({ result: {} }),
    },
  }, {
    Deno: { serve(fn) { handler = fn; } },
  });
  return { handler, grantCalls, rpcCalls };
}

test('Premium playback request is exclusive and entitlement precedes internal media resolution', async () => {
  for (const body of [
    {},
    { premium_content_id: 'bad' },
    { asset_id: assetId, premium_content_id: contentId },
  ]) {
    const harness = loadPlayback();
    assert.equal((await post(harness.handler, body)).response.status, 400);
    assert.equal(harness.grantCalls.length, 0);
  }
  const denied = loadPlayback({ entitlement: { allowed: false } });
  assert.equal((await post(denied.handler, { premium_content_id: contentId })).response.status, 403);
  assert.equal(denied.grantCalls.length, 0);
  assert.deepEqual(denied.rpcCalls, [{
    name: 'get_my_creator_premium_entitlement_v1', args: { p_content_id: contentId },
  }]);
});

test('Premium playback fails closed for missing, ambiguous, malformed, or unready private media', async () => {
  assert.equal((await post(loadPlayback({ links: [] }).handler, { premium_content_id: contentId })).response.status, 404);
  const duplicate = [
    { asset_id: assetId, entity_type: 'creator_premium_content', entity_id: contentId, slot: 'original', position: 0 },
    { asset_id: secondAssetId, entity_type: 'creator_premium_content', entity_id: contentId, slot: 'original', position: 0 },
  ];
  assert.equal((await post(loadPlayback({ links: duplicate }).handler, { premium_content_id: contentId })).response.status, 409);
  for (const mutation of [
    { purpose: 'feed_video' },
    { visibility: 'public' },
    { provider_metadata: {} },
  ]) {
    const base = {
      id: assetId, owner_id: userId, purpose: 'creator_premium_video', provider: 'cloudflare_stream',
      visibility: 'private', status: 'ready', cloudflare_uid: 'provider-uid', hls_url: null,
      dash_url: null, thumbnail_url: null, provider_metadata: { require_signed_urls: true },
      last_provider_check_at: new Date().toISOString(), max_duration_seconds: 60,
      ...mutation,
    };
    assert.equal((await post(loadPlayback({ assets: [base] }).handler, { premium_content_id: contentId })).response.status, 403);
  }
  const unready = {
    id: assetId, owner_id: userId, purpose: 'creator_premium_video', provider: 'cloudflare_stream',
    visibility: 'private', status: 'processing', cloudflare_uid: 'provider-uid', hls_url: null,
    dash_url: null, thumbnail_url: null, provider_metadata: { require_signed_urls: true },
    last_provider_check_at: new Date().toISOString(), max_duration_seconds: 60,
  };
  assert.ok([409, 425].includes((await post(loadPlayback({ assets: [unready] }).handler, { premium_content_id: contentId })).response.status));
});

test('valid Premium playback returns only a no-store signed grant without identifiers or token field', async () => {
  const harness = loadPlayback();
  const { response, json: payload } = await post(harness.handler, { premium_content_id: contentId });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload.data).sort(), ['contentId', 'dashUrl', 'expiresAt', 'hlsUrl', 'thumbnailUrl']);
  assert.equal(payload.data.contentId, contentId);
  assert.equal(harness.grantCalls.length, 1);
  assert.deepEqual(harness.grantCalls[0], { cloudflareUid: 'provider-uid', customerCode: 'code' });
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/i);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  for (const forbidden of ['token', 'assetId', 'videoAssetId', 'cloudflareUid', 'kid']) {
    assert.equal(Object.hasOwn(payload.data, forbidden), false);
  }
});

test('owner asset route exposes safe Premium processing state but never playback authority', async () => {
  const harness = loadPlayback();
  const { response, json: payload } = await post(harness.handler, { asset_id: assetId });
  assert.equal(response.status, 200);
  assert.equal(payload.data.assetId, assetId);
  assert.equal(payload.data.playbackMode, 'premium_entitlement_required');
  assert.equal(payload.data.hlsUrl, null);
  assert.equal(payload.data.dashUrl, null);
  assert.equal(payload.data.thumbnailUrl, null);
  assert.equal(harness.grantCalls.length, 0);
});

test('B3 Stream sources contain no secret, UID, token, or signed URL logging and preserve narrow deployment scope', () => {
  const helperPath = path.join(root, 'supabase/functions/_shared/premiumStreamSecurity.ts');
  assert.equal(existsSync(helperPath), true);
  const sources = [
    read('supabase/functions/_shared/premiumStreamSecurity.ts'),
    read('supabase/functions/create-stream-upload/index.ts'),
    read('supabase/functions/get-stream-playback/index.ts'),
    read('supabase/functions/stream-webhook/index.ts'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:token|signed|jwk|playback|cloudflare_uid|uploadUrl)/i);
    assert.doesNotMatch(source, /STREAM_SIGNING_KEY_(?:ID|JWK_B64)\s*=/);
  }
  assert.doesNotMatch(read('supabase/functions/delete-stream-video/index.ts'), /creator_premium_video/);
});
