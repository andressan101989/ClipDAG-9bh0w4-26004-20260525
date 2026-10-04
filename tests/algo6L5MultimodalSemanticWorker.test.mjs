import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const visualModuleUrl = new URL(
  '../supabase/functions/video-semantic-index/visualSemanticPipeline.mjs',
  import.meta.url,
);
const embeddingModuleUrl = new URL(
  '../supabase/functions/video-semantic-index/embeddingPipeline.mjs',
  import.meta.url,
);
const indexUrl = new URL('../supabase/functions/video-semantic-index/index.ts', import.meta.url);

const SERVICE_KEY = 'real-service-secret';
const VIDEO_ID = '70000000-0000-4000-8000-000000000001';
const SOURCE_FINGERPRINT = 'a'.repeat(64);

function request(body, token = SERVICE_KEY) {
  return new Request('https://example.test/functions/v1/video-semantic-index', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function visualResult(overrides = {}) {
  return {
    schema_version: 'video-semantic-visual-v1',
    summary: 'A dog plays with a ball in a park.',
    topics: ['pets', 'outdoors'],
    objects: ['dog', 'ball'],
    activities: ['playing'],
    setting: 'park',
    ...overrides,
  };
}

function imageJob(overrides = {}) {
  return {
    video_id: VIDEO_ID,
    visual_source_kind: 'eligible_image',
    visual_source_fingerprint: SOURCE_FINGERPRINT,
    video_asset_id: null,
    cloudflare_uid: null,
    duration_seconds: null,
    mime_type: 'image/jpeg',
    media_asset_id: '71000000-0000-4000-8000-000000000001',
    bucket_name: 'public-media',
    object_key: 'videos/semantic.jpg',
    size_bytes: 4,
    visual_provider: 'cloudflare_workers_ai',
    visual_model: '@cf/google/gemma-4-26b-a4b-it',
    visual_prompt_version: 'video-semantic-visual-v1',
    visual_attempt_count: 1,
    ...overrides,
  };
}

function videoJob(overrides = {}) {
  return imageJob({
    visual_source_kind: 'eligible_stream_video',
    video_asset_id: '72000000-0000-4000-8000-000000000001',
    cloudflare_uid: 'streamUid1234',
    duration_seconds: 20,
    mime_type: 'video/mp4',
    media_asset_id: null,
    bucket_name: null,
    object_key: null,
    size_bytes: null,
    ...overrides,
  });
}

async function loadVisual() {
  return import(visualModuleUrl.href);
}

async function loadWorker() {
  return import(embeddingModuleUrl.href);
}

test('visual structured output is exact, bounded, and rejects sensitive concepts', async () => {
  const { validateVisualSemanticResult } = await loadVisual();
  assert.deepEqual(validateVisualSemanticResult(visualResult()), visualResult());

  for (const invalid of [
    visualResult({ extra: 'forbidden' }),
    visualResult({ summary: 'x'.repeat(301) }),
    visualResult({ topics: ['1', '2', '3', '4', '5', '6', '7'] }),
    visualResult({ objects: ['dog', 7] }),
    visualResult({ setting: 'x'.repeat(121) }),
    visualResult({ summary: 'The person has a specific religion.' }),
    visualResult({ topics: ['race inference'] }),
    visualResult({ setting: '123 Main Street address' }),
  ]) assert.throws(() => validateVisualSemanticResult(invalid), /visual_structured_output_invalid/);
});

test('visual prompt explicitly forbids identity, protected-trait, exact-location, PII, and instruction inference', async () => {
  const { VISUAL_SEMANTIC_SYSTEM_PROMPT } = await loadVisual();
  for (const term of [
    'identify', 'names of real people', 'face recognition', 'age', 'race', 'ethnicity',
    'nationality', 'religion', 'sexual orientation', 'gender identity', 'health',
    'disability', 'political affiliation', 'exact geolocation', 'phone', 'email',
    'address', 'untrusted', 'moderation',
  ]) assert.match(VISUAL_SEMANTIC_SYSTEM_PROMPT.toLowerCase(), new RegExp(term));
});

test('deterministic frame merge preserves order, deduplicates case-insensitively, and emits canonical text', async () => {
  const { mergeVisualSemanticResults } = await loadVisual();
  const inputs = [
    visualResult(),
    visualResult({
      summary: 'People walk beside trees.',
      topics: ['OUTDOORS', 'nature'],
      objects: ['Ball', 'trees'],
      activities: ['walking'],
      setting: 'Park',
    }),
  ];
  const first = mergeVisualSemanticResults(inputs);
  const second = mergeVisualSemanticResults(structuredClone(inputs));
  assert.deepEqual(first, second);
  assert.deepEqual(first.result.topics, ['pets', 'outdoors', 'nature']);
  assert.deepEqual(first.result.objects, ['dog', 'ball', 'trees']);
  assert.deepEqual(first.result.activities, ['playing', 'walking']);
  assert.equal(first.result.setting, 'park');
  assert.equal(first.text, [
    'summary:',
    'A dog plays with a ball in a park. · People walk beside trees.',
    'topics:',
    'pets, outdoors, nature',
    'objects:',
    'dog, ball, trees',
    'activities:',
    'playing, walking',
    'setting:',
    'park',
  ].join('\n'));
  assert.ok(first.text.length <= 2500);
});

test('eligible image reuses R2 retrieval and performs exactly one visual provider call', async () => {
  const { processVisualSemanticJob } = await loadVisual();
  let objectCalls = 0;
  let providerCalls = 0;
  const result = await processVisualSemanticJob(imageJob(), {
    token: 'token',
    accountId: 'account',
    getObjectBytes: async (bucket, key, maxBytes) => {
      objectCalls += 1;
      assert.deepEqual([bucket, key], ['public-media', 'videos/semantic.jpg']);
      assert.ok(maxBytes >= 4);
      return { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/jpeg' };
    },
    isR2Transient: () => false,
    runStructuredRequest: async ({ request: providerRequest }) => {
      providerCalls += 1;
      assert.equal(providerRequest.messages[1].content[1].type, 'image_url');
      return visualResult();
    },
  });
  assert.equal(objectCalls, 1);
  assert.equal(providerCalls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.deepEqual(result.frameTimestampsMs, []);
  assert.match(result.visualSemanticText, /^summary:\n/);
});

test('stream processing reuses percentile sampling and hardened frame fetch with at most five calls', async () => {
  const { processVisualSemanticJob } = await loadVisual();
  const fetched = [];
  let providerCalls = 0;
  const result = await processVisualSemanticJob(videoJob(), {
    token: 'token',
    accountId: 'account',
    streamCustomerCode: () => 'customer1234',
    fetchStreamFrame: async ({ uid, customerCode, timestampMs }) => {
      fetched.push({ uid, customerCode, timestampMs });
      return new Uint8Array([1, 2, 3]);
    },
    runStructuredRequest: async () => {
      providerCalls += 1;
      return visualResult({ summary: `Frame ${providerCalls}.` });
    },
  });
  assert.equal(fetched.length, 5);
  assert.equal(providerCalls, 5);
  assert.equal(result.providerCallCount, 5);
  assert.deepEqual(result.frameTimestampsMs, fetched.map(entry => entry.timestampMs));
  assert.deepEqual([...result.frameTimestampsMs].sort((a, b) => a - b), result.frameTimestampsMs);
});

test('stream hardening errors keep their safe code and perform zero provider calls', async () => {
  const { processVisualSemanticJob } = await loadVisual();
  await assert.rejects(
    processVisualSemanticJob(videoJob({ cloudflare_uid: 'invalid uid' }), {
      token: 'token',
      accountId: 'account',
      streamCustomerCode: () => 'customer1234',
      fetchImpl: async () => { throw new Error('fetch must not run for an invalid UID'); },
      runStructuredRequest: async () => { throw new Error('provider must not run'); },
    }),
    error => {
      assert.equal(error.code, 'invalid_stream_uid');
      assert.equal(error.providerCallCount, 0);
      return true;
    },
  );
});

function workerFixture({ jobs = [], processVisualJob, completion = { status: 'ready' } } = {}) {
  const calls = [];
  let clientCreations = 0;
  let processorCalls = 0;
  const client = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      if (name === 'claim_video_semantic_visual_v1') return { data: jobs, error: null };
      return { data: completion, error: null };
    },
  };
  return {
    calls,
    createAdminClient: () => { clientCreations += 1; return client; },
    processVisualJob: async (...args) => {
      processorCalls += 1;
      return processVisualJob ? processVisualJob(...args) : {
        visualSemanticText: mergeText,
        frameTimestampsMs: [],
        providerCallCount: 1,
      };
    },
    get clientCreations() { return clientCreations; },
    get processorCalls() { return processorCalls; },
  };
}

const mergeText = [
  'summary:', 'A dog plays.', 'topics:', 'pets', 'objects:', 'dog',
  'activities:', 'playing', 'setting:', 'park',
].join('\n');

test('process_visual claims a bounded batch and completes a validated image job once', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = workerFixture({ jobs: [imageJob()] });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: SERVICE_KEY,
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    processVisualJob: fx.processVisualJob,
  });
  const response = await handle(request({ mode: 'process_visual', limit: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'visual_processed', claimed: 1, completed: 1, failed: 0, stale: 0,
  });
  assert.equal(fx.processorCalls, 1);
  assert.deepEqual(fx.calls[0], {
    name: 'claim_video_semantic_visual_v1', args: { p_limit: 1 },
  });
  const completion = fx.calls.find(call => call.name === 'complete_video_semantic_visual_v1');
  assert.equal(completion.args.p_visual_semantic_text, mergeText);
  assert.equal(completion.args.p_provider_call_count, 1);
});

test('process_visual failure is sanitized and routed through the visual fail RPC', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const error = Object.assign(new Error('do not persist this provider detail'), {
    code: 'visual_workers_ai_temporarily_unavailable', retryable: true, providerCalled: true,
  });
  const fx = workerFixture({
    jobs: [videoJob()],
    processVisualJob: async () => { throw error; },
  });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: SERVICE_KEY,
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    processVisualJob: fx.processVisualJob,
  });
  const response = await handle(request({ mode: 'process_visual', limit: 1 }));
  assert.equal(response.status, 200);
  const fail = fx.calls.find(call => call.name === 'fail_video_semantic_visual_v1');
  assert.equal(fail.args.p_error_code, 'visual_workers_ai_temporarily_unavailable');
  assert.equal(fail.args.p_retryable, true);
  assert.equal(fail.args.p_provider_call_count, 1);
  assert.ok(!JSON.stringify(fx.calls).includes('do not persist'));
});

test('malformed visual provider output reaches fail exactly once and never completes', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const { processVisualSemanticJob } = await loadVisual();
  const fx = workerFixture({
    jobs: [imageJob()],
    processVisualJob: job => processVisualSemanticJob(job, {
      token: 'token',
      accountId: 'account',
      getObjectBytes: async () => ({
        bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg',
      }),
      runStructuredRequest: async () => visualResult({ unexpected: true }),
    }),
  });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: SERVICE_KEY,
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    processVisualJob: fx.processVisualJob,
  });
  const response = await handle(request({ mode: 'process_visual', limit: 1 }));
  assert.equal(response.status, 200);
  assert.equal(fx.calls.some(call => call.name === 'complete_video_semantic_visual_v1'), false);
  const failures = fx.calls.filter(call => call.name === 'fail_video_semantic_visual_v1');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].args.p_error_code, 'visual_structured_output_invalid');
  assert.equal(failures[0].args.p_retryable, false);
  assert.equal(failures[0].args.p_provider_call_count, 1);
});

test('process_visual batch bounds reject 0 and 6 before claim/provider work and accept 5', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  for (const limit of [0, 6]) {
    const fx = workerFixture();
    const handle = createSemanticWorkerHandler({
      serviceRoleKey: SERVICE_KEY,
      supabaseUrl: 'https://project.supabase.co',
      cloudflareAccountId: 'account',
      cloudflareApiToken: 'token',
      createAdminClient: fx.createAdminClient,
      processVisualJob: fx.processVisualJob,
    });
    assert.equal((await handle(request({ mode: 'process_visual', limit }))).status, 400);
    assert.equal(fx.clientCreations, 0);
    assert.equal(fx.processorCalls, 0);
  }

  const fx = workerFixture();
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: SERVICE_KEY,
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    processVisualJob: fx.processVisualJob,
  });
  assert.equal((await handle(request({ mode: 'process_visual', limit: 5 }))).status, 200);
  assert.deepEqual(fx.calls[0], {
    name: 'claim_video_semantic_visual_v1', args: { p_limit: 5 },
  });
  assert.equal(fx.processorCalls, 0);
});

test('status and unauthorized process_visual produce no claims or provider work', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = workerFixture();
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: SERVICE_KEY,
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    processVisualJob: fx.processVisualJob,
  });
  assert.equal((await handle(request({ mode: 'status' }))).status, 200);
  assert.equal((await handle(request({ mode: 'process_visual' }, 'forged-service-role'))).status, 401);
  assert.equal(fx.clientCreations, 0);
  assert.equal(fx.processorCalls, 0);
  assert.deepEqual(fx.calls, []);
});

test('embedding worker bound is exactly 18000 characters', async () => {
  const { MAX_INPUT_CHARACTERS } = await loadWorker();
  assert.equal(MAX_INPUT_CHARACTERS, 18000);
});

test('runtime imports shared hardened Stream and R2 authorities without duplicating fetch code', async () => {
  const visualSource = await readFile(visualModuleUrl, 'utf8');
  const indexSource = await readFile(indexUrl, 'utf8');
  assert.match(visualSource, /from '\.\.\/content-safety-scan\/visualPipeline\.mjs'/);
  assert.match(visualSource, /sampleVideoFrameTimestamps/);
  assert.match(visualSource, /fetchStreamFrame/);
  assert.match(visualSource, /bytesToDataUri/);
  assert.match(indexSource, /from '\.\.\/_shared\/r2\.ts'/);
  assert.match(indexSource, /getObjectBytes/);
  assert.match(indexSource, /isR2Transient/);
  assert.match(indexSource, /from '\.\.\/_shared\/stream\.ts'/);
  assert.match(indexSource, /streamCustomerCode/);
  assert.doesNotMatch(visualSource, /new S3Client|GetObjectCommand|cloudflarestream\.com\/\$\{/);
});
