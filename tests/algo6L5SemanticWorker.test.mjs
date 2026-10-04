import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL(
  '../supabase/functions/video-semantic-index/embeddingPipeline.mjs',
  import.meta.url,
);

function vector(length = 1024, value = 0.125) {
  return Array.from({ length }, () => value);
}

function request(body, token = 'real-service-secret') {
  return new Request('https://example.test/functions/v1/video-semantic-index', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const providerRequests = [];
  let providerCalls = 0;
  let clientCreations = 0;
  const jobs = overrides.jobs ?? [];
  const client = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      if (name === 'claim_video_semantic_profiles_v1') {
        return { data: jobs, error: null };
      }
      return { data: { status: name.startsWith('complete_') ? 'ready' : 'pending' }, error: null };
    },
  };
  const createAdminClient = () => {
    clientCreations += 1;
    return client;
  };
  const fetchImpl = async (url, options) => {
    providerCalls += 1;
    providerRequests.push({ url, options });
    if (overrides.fetchImpl) return overrides.fetchImpl(url, options);
    return new Response(JSON.stringify({
      success: true,
      result: { shape: [jobs.length, 1024], data: jobs.map(() => vector()) },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return {
    calls,
    providerRequests,
    createAdminClient,
    fetchImpl,
    get clientCreations() { return clientCreations; },
    get providerCalls() { return providerCalls; },
  };
}

async function loadWorker() {
  return import(moduleUrl.href);
}

test('unauthorized and forged-role requests perform zero claims and provider calls', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = fixture();
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });

  for (const [token, extra] of [
    ['anon-token', {}],
    ['forged-token', { role: 'service_role' }],
    ['', {}],
  ]) {
    const req = new Request('https://example.test/functions/v1/video-semantic-index', {
      method: 'POST',
      headers: token ? {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      } : { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'process', ...extra }),
    });
    const response = await handle(req);
    assert.equal(response.status, 401);
  }
  assert.equal(fx.clientCreations, 0);
  assert.equal(fx.providerCalls, 0);
  assert.deepEqual(fx.calls, []);
});

test('status mode is service-only readiness metadata with zero writes and provider calls', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = fixture();
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });
  const response = await handle(request({ mode: 'status' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    status: 'ready',
    provider: 'cloudflare_workers_ai',
    model: '@cf/baai/bge-m3',
    embedding_dimensions: 1024,
    default_batch_size: 8,
    max_batch_size: 25,
  });
  assert.equal(fx.clientCreations, 0);
  assert.equal(fx.providerCalls, 0);
  assert.deepEqual(fx.calls, []);
});

test('process mode claims a finite batch and completes one validated vector per input', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const jobs = [1, 2].map(index => ({
    video_id: `70000000-0000-4000-8000-00000000000${index}`,
    semantic_input_fingerprint: `${index}`.repeat(64),
    input_text: `caption:\nvideo ${index}`,
    provider: 'cloudflare_workers_ai',
    model: '@cf/baai/bge-m3',
    embedding_dimensions: 1024,
    attempt_count: 1,
  }));
  const fx = fixture({ jobs });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });
  const response = await handle(request({ mode: 'process', limit: 2 }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'processed', claimed: 2, completed: 2, failed: 0, stale: 0 });
  assert.equal(fx.providerCalls, 1);
  assert.equal(
    fx.providerRequests[0].url,
    'https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/baai/bge-m3',
  );
  assert.deepEqual(JSON.parse(fx.providerRequests[0].options.body), {
    text: ['caption:\nvideo 1', 'caption:\nvideo 2'],
  });
  assert.equal(fx.calls[0].name, 'claim_video_semantic_profiles_v1');
  assert.deepEqual(fx.calls[0].args, { p_limit: 2 });
  const completions = fx.calls.filter(call => call.name === 'complete_video_semantic_profile_v1');
  assert.equal(completions.length, 2);
  assert.equal(completions[0].args.p_embedding.length, 1024);
});

test('empty claim never calls the provider', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = fixture({ jobs: [] });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });
  const response = await handle(request({ mode: 'process' }));
  assert.deepEqual(await response.json(), {
    status: 'processed', claimed: 0, completed: 0, failed: 0, stale: 0,
  });
  assert.equal(fx.providerCalls, 0);
  assert.deepEqual(fx.calls[0], {
    name: 'claim_video_semantic_profiles_v1', args: { p_limit: 8 },
  });
});

test('batch bounds reject 0 and 26 before claim or provider work', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  for (const limit of [0, 26]) {
    const fx = fixture();
    const handle = createSemanticWorkerHandler({
      serviceRoleKey: 'real-service-secret',
      supabaseUrl: 'https://project.supabase.co',
      cloudflareAccountId: 'account',
      cloudflareApiToken: 'token',
      createAdminClient: fx.createAdminClient,
      fetchImpl: fx.fetchImpl,
    });
    const response = await handle(request({ mode: 'process', limit }));
    assert.equal(response.status, 400);
    assert.equal(fx.clientCreations, 0);
    assert.equal(fx.providerCalls, 0);
  }
});

test('hard maximum batch 25 is accepted and forwarded to the bounded claim RPC', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const fx = fixture({ jobs: [] });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });
  const response = await handle(request({ mode: 'process', limit: 25 }));
  assert.equal(response.status, 200);
  assert.deepEqual(fx.calls[0], {
    name: 'claim_video_semantic_profiles_v1', args: { p_limit: 25 },
  });
  assert.equal(fx.providerCalls, 0);
});

test('embedding validator accepts only one finite 1024 vector per input', async () => {
  const { validateEmbeddingResponse } = await loadWorker();
  assert.deepEqual(
    validateEmbeddingResponse({ result: { shape: [1, 1024], data: [vector()] } }, 1),
    [vector()],
  );
  for (const payload of [
    { result: { shape: [1, 1023], data: [vector(1023)] } },
    { result: { shape: [1, 1025], data: [vector(1025)] } },
    { result: { shape: [1, 1024], data: [[]] } },
    { result: { shape: [1, 1024], data: [[...vector(1023), Number.NaN]] } },
    { result: { shape: [1, 1024], data: [[...vector(1023), Number.POSITIVE_INFINITY]] } },
    { result: { shape: [1, 1024], data: [[...vector(1023), '0.1']] } },
    { result: { shape: [2, 1024], data: [vector(), vector()] } },
    { result: { data: vector() } },
    {},
  ]) assert.throws(() => validateEmbeddingResponse(payload, 1), /invalid_embedding_response/);
});

test('provider failures route through bounded fail RPC with accurate call accounting', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const job = {
    video_id: '70000000-0000-4000-8000-000000000001',
    semantic_input_fingerprint: 'a'.repeat(64),
    input_text: 'caption:\nprovider failure',
    provider: 'cloudflare_workers_ai', model: '@cf/baai/bge-m3',
    embedding_dimensions: 1024, attempt_count: 1,
  };
  for (const [status, retryable] of [[503, true], [400, false]]) {
    const fx = fixture({
      jobs: [job],
      fetchImpl: async () => new Response(JSON.stringify({ error: 'redacted' }), { status }),
    });
    const handle = createSemanticWorkerHandler({
      serviceRoleKey: 'real-service-secret',
      supabaseUrl: 'https://project.supabase.co',
      cloudflareAccountId: 'account',
      cloudflareApiToken: 'token',
      createAdminClient: fx.createAdminClient,
      fetchImpl: fx.fetchImpl,
    });
    const response = await handle(request({ mode: 'process', limit: 1 }));
    assert.equal(response.status, 200);
    const fail = fx.calls.find(call => call.name === 'fail_video_semantic_profile_v1');
    assert.equal(fail.args.p_retryable, retryable);
    assert.equal(fail.args.p_provider_called, true);
    assert.match(fail.args.p_error_code, /^provider_http_/);
    assert.ok(!JSON.stringify(fx.calls).includes('redacted'));
  }
});

test('malformed provider output is nonretryable and cannot reach complete', async () => {
  const { createSemanticWorkerHandler } = await loadWorker();
  const job = {
    video_id: '70000000-0000-4000-8000-000000000001',
    semantic_input_fingerprint: 'a'.repeat(64),
    input_text: 'caption:\nmalformed',
    provider: 'cloudflare_workers_ai', model: '@cf/baai/bge-m3',
    embedding_dimensions: 1024, attempt_count: 1,
  };
  const fx = fixture({
    jobs: [job],
    fetchImpl: async () => new Response(JSON.stringify({
      success: true, result: { shape: [1, 1023], data: [vector(1023)] },
    }), { status: 200 }),
  });
  const handle = createSemanticWorkerHandler({
    serviceRoleKey: 'real-service-secret',
    supabaseUrl: 'https://project.supabase.co',
    cloudflareAccountId: 'account',
    cloudflareApiToken: 'token',
    createAdminClient: fx.createAdminClient,
    fetchImpl: fx.fetchImpl,
  });
  await handle(request({ mode: 'process', limit: 1 }));
  assert.equal(fx.calls.some(call => call.name === 'complete_video_semantic_profile_v1'), false);
  const fail = fx.calls.find(call => call.name === 'fail_video_semantic_profile_v1');
  assert.equal(fail.args.p_retryable, false);
  assert.equal(fail.args.p_provider_called, true);
  assert.equal(fail.args.p_error_code, 'invalid_embedding_response');
});
