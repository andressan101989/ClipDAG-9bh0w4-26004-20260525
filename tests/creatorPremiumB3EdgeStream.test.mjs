import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import {
  canonicalCloudflareTusLocation,
  cloudflareTusProvisionRetryDelayMs,
  classifyCloudflareTusFailure,
} from '../supabase/functions/create-stream-upload/premiumTusContract.mjs';

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
    AbortController,
    AbortSignal,
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

function mutationResult(result = { data: { id: assetId }, error: null }) {
  const chain = {
    eq() { return chain; },
    in() { return chain; },
    select() { return chain; },
    maybeSingle: async () => result,
    single: async () => result,
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '10000000-0000-4000-8000-000000000002';
const contentId = '20000000-0000-4000-8000-000000000001';
const storyId = '20000000-0000-4000-8000-000000000002';
const assetId = '30000000-0000-4000-8000-000000000001';
const secondAssetId = '30000000-0000-4000-8000-000000000002';
const providerUid = 'abcdef0123456789abcdef0123456789';
const providerTusUrl = `https://upload.cloudflarestream.com/tus/${providerUid}?tusv2=true`;

function loadCreateStreamUpload({
  authorized = true,
  businessAllowed = true,
  user = { id: userId },
  tusLocation = providerTusUrl,
  tusStatus = 201,
  tusProviderErrorCode = null,
  tusFetchError = null,
  allocationStale = false,
  compensationQueueError = null,
  compensationQueueStatus = 'pending',
  scheduleResult = { data: 'scheduled', error: null },
  directDeleteError = null,
  directAbsent = true,
} = {}) {
  let handler;
  const providerCalls = [];
  const rpcCalls = [];
  const callerRpcCalls = [];
  const updates = [];
  const logs = [];
  const db = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      if (name === 'schedule_video_asset_deletion_v1') return scheduleResult;
      return { data: 'created', error: null };
    },
    from(table) {
      assert.equal(table, 'video_assets');
      return {
        update(values) {
          updates.push(structuredClone(values));
          const allocation = values.status === 'uploading' && values.cloudflare_uid;
          const compensationQueue = !allocation && values.cloudflare_uid;
          return mutationResult({
            data: allocation && allocationStale
              ? null
              : compensationQueue
                ? compensationQueueStatus === null
                  ? null
                  : { id: assetId, status: compensationQueueStatus }
                : { id: assetId, status: 'pending' },
            error: compensationQueue ? compensationQueueError : null,
          });
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
      STORY_STREAM_PURPOSE: 'story_video',
      isPrivateStreamPurpose: value => ['creator_premium_video', 'story_video'].includes(value),
      privateStreamMaxDurationSeconds: value => value === 'story_video' ? 15 : 180,
    },
    './premiumTusContract.mjs': {
      canonicalCloudflareTusLocation,
      cloudflareTusProvisionRetryDelayMs,
      classifyCloudflareTusFailure,
    },
    '../_shared/stream.ts': {
      CREATOR_PREMIUM_STREAM_MAX_DURATION_SECONDS: 180,
      STREAM_MAX_DURATION_SECONDS: 60,
      STREAM_MAX_SIZE_BYTES: 200_000_000,
      StreamProviderError: class StreamProviderError extends Error {
        constructor(code, httpStatus = 502, transient = false) {
          super(code);
          this.code = code;
          this.httpStatus = httpStatus;
          this.transient = transient;
        }
      },
      async deleteStreamVideo() {
        providerCalls.push({ kind: 'compensation-delete' });
        if (directDeleteError) throw directDeleteError;
        return { accepted: true, alreadyAbsent: false, requestId: null };
      },
      async verifyStreamVideoAbsent() {
        providerCalls.push({ kind: 'compensation-verify' });
        return { absent: directAbsent, requestId: null };
      },
      safeFilename: value => String(value ?? 'video'),
      sanitizeProviderError: error => ({
        code: error?.code ?? error?.message ?? 'provider_error',
        message: error?.code ?? error?.message ?? 'provider_error',
        status: error?.httpStatus ?? 502,
      }),
      streamApiBase: () => 'https://api.cloudflare.test/accounts/account/stream',
      async streamFetch(pathname, init) {
        providerCalls.push({
          kind: 'direct',
          pathname,
          method: init.method,
          body: init.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return { success: true, result: { uid: 'provider-uid', uploadURL: 'https://upload.example.test/direct' } };
      },
      streamToken: () => 'test-token',
      validateStreamMime: value => ['video/mp4', 'video/quicktime', 'video/webm'].includes(String(value)) ? String(value) : null,
      validateStreamSize: value => Number(value) > 0 && Number(value) <= 200_000_000 ? Number(value) : null,
    },
  }, {
    crypto: { randomUUID: () => assetId },
    fetch: async (url, init) => {
      providerCalls.push({
        kind: 'tus',
        url: String(url),
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      });
      if (tusFetchError) throw tusFetchError;
      return new Response(tusProviderErrorCode === null ? null : JSON.stringify({
        success: false,
        errors: [{ code: tusProviderErrorCode, message: 'redacted test provider failure' }],
      }), {
        status: tusStatus,
        headers: {
          Location: tusLocation,
          'stream-media-id': providerUid,
          'Content-Type': 'application/json',
          'cf-ray': 'abc123-MIA',
        },
      });
    },
    console: { log() {}, warn() {}, error: (...args) => logs.push(args) },
    setTimeout: callback => { callback(); return 0; },
    Deno: {
      env: { get: name => name === 'DENO_DEPLOYMENT_ID' ? 'deployment' : undefined },
      serve(fn) { handler = fn; },
    },
  });
  return { handler, providerCalls, rpcCalls, callerRpcCalls, updates, logs };
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

function decodeTusMetadata(value) {
  return Object.fromEntries(String(value).split(',').map(entry => {
    const [key, encoded] = entry.split(' ');
    return [key, encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''];
  }));
}

test('Premium TUS upload uses caller authorization, private reservation, signed URLs, and correlation metadata', async () => {
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
  const provider = harness.providerCalls[0];
  assert.equal(provider.kind, 'tus');
  assert.equal(provider.url, 'https://api.cloudflare.test/accounts/account/stream?direct_user=true');
  assert.equal(provider.method, 'POST');
  assert.equal(provider.headers['tus-resumable'], '1.0.0');
  assert.equal(provider.headers['upload-length'], '1024');
  assert.equal(provider.headers['upload-creator'], userId);
  const metadata = decodeTusMetadata(provider.headers['upload-metadata']);
  assert.equal(metadata.requiresignedurls, '');
  assert.equal(metadata.maxDurationSeconds, '180');
  assert.equal(metadata.purpose, 'creator_premium_video');
  assert.equal(metadata.premium_content_id, contentId);
  assert.equal(metadata.asset_id, payload.data.assetId);
  assert.equal(metadata.environment, 'production');
  assert.equal(payload.data.protocol, 'tus');
  assert.equal(payload.data.method, 'PATCH');
  assert.equal(payload.data.maxDurationSeconds, 180);
  assert.equal(payload.data.uploadUrl, providerTusUrl);
});

test('Premium TUS upload rejects a provider Location outside the canonical Cloudflare upload origin', async () => {
  const harness = loadCreateStreamUpload({
    tusLocation: `https://attacker.example/tus/${providerUid}?tusv2=true`,
  });
  const { response, json: payload } = await post(harness.handler, upload);
  assert.equal(response.status, 502);
  assert.equal(payload.error, 'stream_provider_invalid_response');
  assert.equal(harness.providerCalls.some(call => call.kind === 'direct'), false);
  assert.equal(harness.rpcCalls.some(call => call.name === 'schedule_video_asset_deletion_v1'), true);
  assert.equal(harness.updates.some(update => update.cloudflare_uid === providerUid), true);
});

test('Premium TUS provisioning maps provider and timeout failures to stable safe domains', async () => {
  for (const [status, expectedStatus, expectedCode] of [
    [401, 502, 'stream_provider_credentials_rejected'],
    [403, 502, 'stream_provider_credentials_rejected'],
    [413, 400, 'stream_provider_size_rejected'],
    [429, 503, 'stream_provider_temporarily_unavailable'],
    [500, 503, 'stream_provider_temporarily_unavailable'],
    [502, 503, 'stream_provider_temporarily_unavailable'],
  ]) {
    const harness = loadCreateStreamUpload({ tusStatus: status, tusProviderErrorCode: 10000 + status });
    const result = await post(harness.handler, upload);
    assert.equal(result.response.status, expectedStatus);
    assert.equal(result.json.error, expectedCode);
    assert.equal(harness.updates.at(-1).status, 'failed');
    const expectedAttempts = status === 429 ? 4 : 1;
    assert.equal(harness.logs.length, expectedAttempts);
    assert.equal(harness.providerCalls.filter(call => call.kind === 'tus').length, expectedAttempts);
    for (const log of harness.logs) {
      assert.equal(log[1].code, expectedCode);
      assert.equal(log[1].provider_error_code, String(10000 + status));
    }
    assert.equal(JSON.stringify(harness.logs).includes('redacted test provider failure'), false);
  }

  const timeout = loadCreateStreamUpload({ tusFetchError: Object.assign(new Error('timeout'), { name: 'AbortError' }) });
  const result = await post(timeout.handler, upload);
  assert.equal(result.response.status, 503);
  assert.equal(result.json.error, 'stream_provider_temporarily_unavailable');
  assert.equal(timeout.updates.at(-1).status, 'failed');
});

test('Premium allocation losing the reservation race queues the known provider UID and fails stale', async () => {
  const harness = loadCreateStreamUpload({ allocationStale: true });
  const { response, json: payload } = await post(harness.handler, upload);
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'stream_allocation_stale');
  assert.equal(
    harness.rpcCalls.some(call => call.name === 'schedule_video_asset_deletion_v1'),
    true,
  );
  assert.equal(harness.updates.some(update => update.cloudflare_uid === providerUid), true);
});

test('Premium compensation directly deletes and verifies a new UID when queue persistence errors', async () => {
  const harness = loadCreateStreamUpload({
    tusLocation: `https://attacker.example/tus/${providerUid}?tusv2=true`,
    compensationQueueError: { message: 'simulated queue failure' },
  });
  const { response, json: payload } = await post(harness.handler, upload);
  assert.equal(response.status, 502);
  assert.equal(payload.error, 'stream_provider_invalid_response');
  assert.deepEqual(
    harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
    [{ kind: 'compensation-delete' }, { kind: 'compensation-verify' }],
  );
  assert.equal(harness.rpcCalls.some(call => call.name === 'schedule_video_asset_deletion_v1'), false);
});

test('Premium compensation never treats missing or terminal queue rows as enqueued', async () => {
  for (const compensationQueueStatus of [null, 'delete_pending', 'deleted']) {
    const harness = loadCreateStreamUpload({
      tusLocation: `https://attacker.example/tus/${providerUid}?tusv2=true`,
      compensationQueueStatus,
    });
    const { response, json: payload } = await post(harness.handler, upload);
    assert.equal(response.status, 502);
    assert.equal(payload.error, 'stream_provider_invalid_response');
    assert.deepEqual(
      harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
      [{ kind: 'compensation-delete' }, { kind: 'compensation-verify' }],
    );
    assert.equal(harness.rpcCalls.some(call => call.name === 'schedule_video_asset_deletion_v1'), false);
  }
});

test('Premium compensation directly deletes and verifies when canonical scheduling fails or reports deleted', async () => {
  for (const scheduleResult of [
    { data: null, error: { message: 'simulated scheduler failure' } },
    { data: 'deleted', error: null },
  ]) {
    const harness = loadCreateStreamUpload({
      tusLocation: `https://attacker.example/tus/${providerUid}?tusv2=true`,
      scheduleResult,
    });
    const { response, json: payload } = await post(harness.handler, upload);
    assert.equal(response.status, 502);
    assert.equal(payload.error, 'stream_provider_invalid_response');
    assert.equal(harness.rpcCalls.filter(call => call.name === 'schedule_video_asset_deletion_v1').length, 1);
    assert.deepEqual(
      harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
      [{ kind: 'compensation-delete' }, { kind: 'compensation-verify' }],
    );
  }
});

test('Premium compensation fails closed when direct provider absence cannot be proven', async () => {
  const harness = loadCreateStreamUpload({
    tusLocation: `https://attacker.example/tus/${providerUid}?tusv2=true`,
    compensationQueueError: { message: 'simulated queue failure' },
    directDeleteError: new Error('simulated provider delete failure'),
    directAbsent: false,
  });
  const { response, json: payload } = await post(harness.handler, upload);
  assert.equal(response.status, 503);
  assert.equal(payload.error, 'asset_state_failed');
  assert.deepEqual(
    harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
    [{ kind: 'compensation-delete' }, { kind: 'compensation-verify' }],
  );
});

test('generic Stream compensation accepts confirmed physical absence even when bookkeeping affects no row', async () => {
  const harness = loadCreateStreamUpload({
    allocationStale: true,
    compensationQueueStatus: null,
    directAbsent: true,
  });
  const { response, json: payload } = await post(harness.handler, {
    ...upload,
    purpose: 'feed_video',
    premium_content_id: undefined,
  });

  assert.equal(response.status, 409);
  assert.equal(payload.error, 'stream_allocation_stale');
  assert.deepEqual(
    harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
    [{ kind: 'compensation-delete' }, { kind: 'compensation-verify' }],
  );
});

test('generic Stream compensation retries direct deletion when delete_pending persistence is missing or errors', async () => {
  for (const persistenceFailure of [
    { compensationQueueStatus: null },
    { compensationQueueError: { message: 'simulated queue failure' } },
  ]) {
    const harness = loadCreateStreamUpload({
      allocationStale: true,
      directAbsent: false,
      ...persistenceFailure,
    });
    const { response, json: payload } = await post(harness.handler, {
      ...upload,
      purpose: 'feed_video',
      premium_content_id: undefined,
    });

    assert.equal(response.status, 503);
    assert.equal(payload.error, 'asset_state_failed');
    assert.deepEqual(
      harness.providerCalls.filter(call => call.kind.startsWith('compensation-')),
      [
        { kind: 'compensation-delete' },
        { kind: 'compensation-verify' },
        { kind: 'compensation-delete' },
        { kind: 'compensation-verify' },
      ],
    );
  }
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

function loadWebhook({ asset, premiumUpdates, publicUpdates, updateStale = false } = {}) {
  let handler;
  const updates = [];
  const row = asset ?? {
    id: assetId,
    purpose: 'creator_premium_video',
    status: 'processing',
    cloudflare_uid: 'provider-uid',
    max_duration_seconds: 60,
    ready_at: null,
    updated_at: '2026-10-08T00:00:00.000Z',
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
          return mutationResult({ data: updateStale ? null : { id: assetId }, error: null });
        },
      };
    },
  };
  executeModule(read('supabase/functions/stream-webhook/index.ts'), 'stream-webhook.ts', {
    '../_shared/mediaAuth.ts': { admin: () => db, json },
    '../_shared/premiumStreamSecurity.ts': {
      CREATOR_PREMIUM_STREAM_PURPOSE: 'creator_premium_video',
      STORY_STREAM_PURPOSE: 'story_video',
      isPrivateStreamPurpose: value => ['creator_premium_video', 'story_video'].includes(value),
      privateStreamSignedUrlsErrorCode: value => value === 'story_video'
        ? 'story_video_signed_urls_required'
        : 'creator_premium_stream_signed_urls_required',
      reconcilePrivateStreamVideo: () => premiumUpdates ?? {
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
      monotonicStreamUpdates: (_current, proposed) => proposed,
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

test('late webhook becomes an idempotent no-op when deletion wins the compare-and-set', async () => {
  const harness = loadWebhook({ updateStale: true });
  const { response, json: payload } = await webhook(harness.handler, {
    uid: 'provider-uid', meta: { asset_id: assetId }, status: { state: 'ready' },
    readyToStream: true, requireSignedURLs: true,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { success: true });
  assert.equal(harness.updates.length, 1);
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

test('ready Premium webhook preserves proven protection unless provider explicitly disables signed URLs', async () => {
  const readyAsset = {
    id: assetId, purpose: 'creator_premium_video', status: 'ready', cloudflare_uid: 'provider-uid',
    max_duration_seconds: 60, ready_at: 'original-ready-at',
    updated_at: '2026-10-08T00:00:00.000Z',
  };
  const signedRequiredFailure = {
    status: 'failed', hls_url: null, dash_url: null, thumbnail_url: null,
    provider_metadata: { require_signed_urls: false },
    error_code: 'creator_premium_stream_signed_urls_required',
    error_message: 'creator_premium_stream_signed_urls_required',
    last_provider_check_at: 'later',
  };

  for (const requireSignedURLs of [undefined, 'true']) {
    const harness = loadWebhook({ asset: readyAsset, premiumUpdates: signedRequiredFailure });
    const provider = {
      uid: 'provider-uid', meta: { asset_id: assetId }, status: { state: 'ready' },
      readyToStream: true,
    };
    if (requireSignedURLs !== undefined) provider.requireSignedURLs = requireSignedURLs;
    assert.equal((await webhook(harness.handler, provider)).response.status, 200);
    assert.equal(harness.updates.length, 0);
  }

  const disabled = loadWebhook({ asset: readyAsset, premiumUpdates: signedRequiredFailure });
  assert.equal((await webhook(disabled.handler, {
    uid: 'provider-uid', meta: { asset_id: assetId }, status: { state: 'ready' },
    readyToStream: true, requireSignedURLs: false,
  })).response.status, 200);
  assert.equal(disabled.updates.length, 1);
  assert.equal(disabled.updates[0].status, 'failed');
  assert.equal(disabled.updates[0].error_code, 'creator_premium_stream_signed_urls_required');
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
  stories = [],
  storyError = null,
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
  updateStale = false,
  canonicalAfterStale = null,
  premiumUpdates = null,
  publicUpdates = null,
  providerResult = {},
  monotonicUpdates = (_current, proposed) => proposed,
} = {}) {
  let handler;
  const grantCalls = [];
  const rpcCalls = [];
  const updates = [];
  let assetSelectCount = 0;
  const db = {
    from(table) {
      if (table === 'video_asset_links') return rowsChain(links);
      if (table === 'video_assets') return {
        select() {
          assetSelectCount += 1;
          const rows = assetSelectCount > 1 && canonicalAfterStale
            ? [canonicalAfterStale]
            : assets;
          return rowsChain(rows);
        },
        update(values) {
          updates.push(structuredClone(values));
          return mutationResult({
            data: updateStale ? null : { ...assets[0], ...values },
            error: null,
          });
        },
      };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const caller = {
    from(table) {
      assert.equal(table, 'stories');
      return rowsChain(stories, storyError);
    },
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
      STORY_STREAM_PURPOSE: 'story_video',
      isPrivateStreamPurpose: value => ['creator_premium_video', 'story_video'].includes(value),
      async createPrivateStreamPlaybackGrant(input) {
        grantCalls.push(structuredClone(input));
        return {
          hlsUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.m3u8',
          dashUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.mpd',
          thumbnailUrl: 'https://customer-code.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      },
      async createPremiumStreamPlaybackGrant(input) {
        grantCalls.push(structuredClone(input));
        return {
          hlsUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.m3u8',
          dashUrl: 'https://customer-code.cloudflarestream.com/signed-token/manifest/video.mpd',
          thumbnailUrl: 'https://customer-code.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      },
      reconcilePrivateStreamVideo: () => premiumUpdates ?? {},
    },
    '../_shared/stream.ts': {
      isUuid: value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
      monotonicStreamUpdates: monotonicUpdates,
      reconcileStreamVideo: () => publicUpdates ?? {},
      sanitizeProviderError: () => ({ code: 'provider_error', status: 502 }),
      streamCustomerCode: () => 'code',
      streamFetch: async () => ({ result: providerResult }),
    },
  }, {
    Deno: { serve(fn) { handler = fn; } },
  });
  return {
    handler, grantCalls, rpcCalls, updates,
    get assetSelectCount() { return assetSelectCount; },
  };
}

test('private Stream signer caps an explicit absolute expiry without changing Premium TTL', async () => {
  class StreamProviderError extends Error {
    constructor(code, httpStatus = 502, transient = false) {
      super(code);
      this.code = code;
      this.httpStatus = httpStatus;
      this.transient = transient;
    }
  }
  const security = executeModule(
    read('supabase/functions/_shared/premiumStreamSecurity.ts'),
    'premiumStreamSecurity.ts',
    {
      './stream.ts': {
        STREAM_MAX_DURATION_SECONDS: 60,
        StreamProviderError,
        durationOrNull: value => Number.isFinite(Number(value)) ? Number(value) : null,
        positiveDimensionOrNull: value => Number(value) > 0 ? Number(value) : null,
        progressOrNull: value => Number.isFinite(Number(value)) ? Number(value) : null,
      },
    },
    { Deno: { env: { get() { return null; } } } },
  );
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const credentials = {
    cloudflareUid: providerUid,
    customerCode: 'code',
    keyId: 'test-key',
    privateJwkB64: Buffer.from(JSON.stringify(jwk)).toString('base64'),
    nowSeconds: 1_000,
  };
  const claims = grant => JSON.parse(Buffer.from(
    new URL(grant.hlsUrl).pathname.split('/')[1].split('.')[1], 'base64url',
  ).toString('utf8'));

  const storyGrant = await security.createPrivateStreamPlaybackGrant({
    ...credentials, maximumExpiresAtSeconds: 1_075,
  });
  assert.equal(claims(storyGrant).exp, 1_075);
  assert.equal(storyGrant.expiresAt, '1970-01-01T00:17:55.000Z');

  const premiumGrant = await security.createPremiumStreamPlaybackGrant(credentials);
  assert.equal(claims(premiumGrant).exp, 1_300);

  await assert.rejects(
    security.createPrivateStreamPlaybackGrant({
      ...credentials, maximumExpiresAtSeconds: 1_000,
    }),
    error => error?.code === 'stream_signing_expiry_invalid',
  );
});

test('Story playback grants are capped by canonical expiry and never issued at or after expiry', async () => {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const story = { id: storyId, user_id: userId, media_type: 'video', expires_at: expiresAt };
  const links = [{
    asset_id: assetId, owner_id: userId, entity_type: 'story', entity_id: storyId,
    slot: 'media', position: 0,
  }];
  const assets = [{
    id: assetId, owner_id: userId, purpose: 'story_video', provider: 'cloudflare_stream',
    visibility: 'private', status: 'ready', cloudflare_uid: 'provider-uid',
    hls_url: null, dash_url: null, thumbnail_url: null,
    provider_metadata: { require_signed_urls: true }, duration_seconds: 15,
  }];

  for (const user of [{ id: otherUserId }, { id: userId }]) {
    const harness = loadPlayback({ user, stories: [story], links, assets });
    const result = await post(harness.handler, { story_id: storyId });
    assert.equal(result.response.status, 200);
    assert.equal(harness.grantCalls.length, 1);
    assert.equal(
      harness.grantCalls[0].maximumExpiresAtSeconds,
      Math.floor(Date.parse(expiresAt) / 1000),
    );
    assert.ok(Number.isSafeInteger(harness.grantCalls[0].nowSeconds));
    assert.ok(harness.grantCalls[0].nowSeconds < harness.grantCalls[0].maximumExpiresAtSeconds);
  }

  for (const expires_at of [
    new Date(Date.now() - 1_000).toISOString(),
    new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
  ]) {
    const harness = loadPlayback({
      user: { id: userId }, stories: [{ ...story, expires_at }], links, assets,
    });
    const result = await post(harness.handler, { story_id: storyId });
    assert.equal(result.response.status, 404);
    assert.equal(harness.grantCalls.length, 0);
  }
});

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

test('owner playback returns the canonical row when a webhook wins the provider-refresh CAS', async () => {
  const initial = {
    id: assetId, owner_id: userId, purpose: 'creator_premium_video', provider: 'cloudflare_stream',
    visibility: 'private', status: 'processing', cloudflare_uid: 'provider-uid',
    hls_url: null, dash_url: null, thumbnail_url: null, provider_progress: 35,
    duration_seconds: null, width: null, height: null, ready_at: null,
    last_provider_check_at: '2026-10-08T00:00:00.000Z', max_duration_seconds: 180,
    updated_at: '2026-10-08T00:00:00.000Z',
  };
  const canonical = {
    ...initial,
    status: 'ready', provider_progress: 100, duration_seconds: 42,
    width: 1920, height: 1080, ready_at: '2026-10-08T00:00:05.000Z',
    last_provider_check_at: '2026-10-08T00:00:05.000Z',
    updated_at: '2026-10-08T00:00:05.000Z',
  };
  const harness = loadPlayback({
    assets: [initial],
    updateStale: true,
    canonicalAfterStale: canonical,
    providerResult: { uid: 'provider-uid' },
    premiumUpdates: {
      status: 'ready', provider_progress: 100, duration_seconds: 42,
      width: 1920, height: 1080, hls_url: null, dash_url: null, thumbnail_url: null,
      ready_at: '2026-10-08T00:00:05.000Z', last_provider_check_at: '2026-10-08T00:00:05.000Z',
    },
  });

  const { response, json: payload } = await post(harness.handler, { asset_id: assetId });

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.status, 'ready');
  assert.equal(payload.data.durationSeconds, 42);
  assert.equal(payload.data.playbackMode, 'premium_entitlement_required');
  assert.equal(payload.data.hlsUrl, null);
  assert.equal(harness.updates.length, 1);
  assert.equal(harness.assetSelectCount, 2);
});

test('owner playback ignores an out-of-order provider observation and returns canonical processing state', async () => {
  const initial = {
    id: assetId, owner_id: userId, purpose: 'creator_premium_video', provider: 'cloudflare_stream',
    visibility: 'private', status: 'processing', cloudflare_uid: 'provider-uid',
    hls_url: null, dash_url: null, thumbnail_url: null, provider_progress: 85,
    duration_seconds: null, width: null, height: null, ready_at: null,
    last_provider_check_at: '2026-10-08T00:00:00.000Z', max_duration_seconds: 180,
    updated_at: '2026-10-08T00:00:00.000Z',
  };
  const harness = loadPlayback({
    assets: [initial],
    canonicalAfterStale: initial,
    providerResult: { uid: 'provider-uid' },
    premiumUpdates: {
      status: 'uploading', provider_progress: 25, duration_seconds: null,
      width: null, height: null, hls_url: null, dash_url: null, thumbnail_url: null,
      ready_at: null, last_provider_check_at: '2026-10-08T00:00:05.000Z',
    },
    monotonicUpdates: () => null,
  });

  const { response, json: payload } = await post(harness.handler, { asset_id: assetId });

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.status, 'processing');
  assert.equal(payload.data.progress, 85);
  assert.equal(payload.data.playbackMode, 'premium_entitlement_required');
  assert.equal(payload.data.hlsUrl, null);
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.assetSelectCount, 2);
});

test('Stream reconciliation rejects regressions and preserves same-state evidence', () => {
  class Command { constructor(input) { this.input = input; } }
  const shared = executeModule(read('supabase/functions/_shared/stream.ts'), 'stream.ts', {
    'npm:@aws-sdk/client-s3@3.637.0': {
      DeleteObjectCommand: Command, GetObjectCommand: Command, HeadObjectCommand: Command,
      PutObjectCommand: Command, S3Client: class { send() {} },
    },
    'npm:@aws-sdk/s3-request-presigner@3.637.0': { getSignedUrl: async () => 'signed' },
  }, {
    Deno: { env: { get() { return 'configured'; } } },
  });
  const current = {
    status: 'processing', provider_progress: 80, duration_seconds: 12,
    width: 1920, provider_metadata: { stable: true },
  };
  assert.equal(shared.monotonicStreamUpdates(current, {
    status: 'uploading', provider_progress: 90,
  }), null);
  assert.equal(shared.monotonicStreamUpdates({ status: 'failed' }, {
    status: 'ready', provider_progress: 100,
  }), null);
  assert.equal(shared.monotonicStreamUpdates({ status: 'uploading' }, {
    status: 'failed', error_code: 'stream_processing_failed',
  }).status, 'failed');
  assert.equal(shared.monotonicStreamUpdates({ status: 'processing' }, {
    status: 'failed', error_code: 'stream_processing_failed',
  }).status, 'failed');
  const same = shared.monotonicStreamUpdates(current, {
    status: 'processing', provider_progress: 25, duration_seconds: null,
    width: null, provider_metadata: null, last_provider_check_at: 'later',
  });
  assert.equal(same.provider_progress, 80);
  assert.equal(same.duration_seconds, 12);
  assert.equal(same.width, 1920);
  assert.deepEqual(same.provider_metadata, { stable: true });
  assert.equal(shared.monotonicStreamUpdates({ status: 'ready' }, {
    status: 'failed', error_code: 'creator_premium_stream_signed_urls_required',
  }), null);
  assert.equal(shared.monotonicStreamUpdates({ status: 'ready' }, {
    status: 'failed', error_code: 'creator_premium_stream_signed_urls_required',
  }, { allowReadySecurityFailure: true }).status, 'failed');
});

test('webhook and playback compare-and-set the row version as well as status', () => {
  assert.match(
    read('supabase/functions/stream-webhook/index.ts'),
    /\.eq\('status',asset\.status\)[\s\S]*?\.eq\('updated_at',asset\.updated_at\)/,
  );
  assert.match(
    read('supabase/functions/get-stream-playback/index.ts'),
    /\.eq\('status',String\(asset\.status\)\)[\s\S]*?\.eq\('updated_at',String\(asset\.updated_at\)\)/,
  );
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
  assert.doesNotMatch(
    read('supabase/functions/create-stream-upload/index.ts'),
    /console\.(?:log|warn|error)\([^)]*\{[^}]*(?:\bassetId\b|\buid\b)/i,
    'Premium upload recovery logs must not contain private provider or asset identifiers',
  );
  assert.doesNotMatch(read('supabase/functions/delete-stream-video/index.ts'), /creator_premium_video/);
});
