import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { Readable } from 'node:stream';

function load(path, imports = {}, globals = {}) {
  const exports = {};
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require(name) { assert.ok(name in imports, `unexpected import ${name}`); return imports[name]; }, Uint8Array, AbortController, AbortSignal, Request, Response, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, ...globals }, { filename: path });
  return exports;
}
const workerPath = 'supabase/functions/process-scheduled-publications/worker.ts';
const worker = load(workerPath);
const run = (...args) => { assert.equal(typeof worker.processScheduledPublicationBatch, 'function', 'worker must export batch processor'); return worker.processScheduledPublicationBatch(...args); };
const plain = value => JSON.parse(JSON.stringify(value));
const HASH_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const claim = { schedule_id: 'schedule-one', generation: 4, claim_token: 'private-token', claim_expires_at: '2026-11-08T12:02:00Z', attempt_count: 1, revision: 2 };
const fence = { p_schedule_id: 'schedule-one', p_generation: 4, p_claim_token: 'private-token' };
const item = { position: 0, source_bucket: 'private-test', source_key: 'exact/private/key', source_etag: 'a'.repeat(32), target_asset_id: 'target-one', target_bucket: 'public-test', target_key: 'exact/public/key', mime_type: 'image/jpeg', size_bytes: 3, finalized: false };
const success = { claimed: 1, published: 1, retried: 0, terminal: 0, stale: 0 };
const error = (message, extra = {}) => Object.assign(new Error(message), extra);
function fixture(options = {}) {
  const calls = [], provider = [], stored = new Map();
  let now = Date.parse('2026-11-08T12:00:00Z'), claimed = false, publishCalls = 0, posts = 0;
  const items = options.items ?? [item];
  const db = { async rpc(name, args) {
    calls.push({ name, args: plain(args) });
    if (options.rpc) { const value = await options.rpc(name, args); if (value !== undefined) return value; }
    if (name === 'reconcile_publication_schedules_v1') return { data: { recovered: 0, released: 0 }, error: null };
    if (name === 'claim_publication_schedules_v1') { const data = claimed || options.empty ? [] : [{ ...claim, ...options.claim }]; claimed = true; return { data, error: null }; }
    if (name === 'prepare_publication_schedule_v1') return { data: { schedule_id: claim.schedule_id, generation: claim.generation, claim_expires_at: options.claim?.claim_expires_at ?? claim.claim_expires_at, items }, error: null };
    if (name === 'confirm_publication_schedule_item_v1') return { data: { schedule_id: claim.schedule_id, generation: claim.generation, position: args.p_position, target_asset_id: items[args.p_position].target_asset_id, finalized: true }, error: null };
    if (name === 'publish_publication_schedule_v1') { publishCalls++; posts = 1; if (options.lostPublish && publishCalls === 1) throw error('private db URL secret', { name: 'TypeError' }); return { data: { schedule_id: claim.schedule_id, generation: claim.generation, state: 'published', post_id: 'post-one' }, error: null }; }
    if (name === 'fail_publication_schedule_v1') return { data: { schedule_id: claim.schedule_id, state: options.terminal || !args.p_retryable ? 'terminal_failed' : 'retryable_failed', retryable: !options.terminal && args.p_retryable, last_error_code: args.p_error_code, next_attempt_at: null, attempt_count: 1 }, error: null };
    assert.fail(`unexpected RPC ${name}`);
  } };
  const objects = {
    async get(bucket, key, opts) {
      provider.push({ op: 'get', bucket, key, opts });
      if (options.onGet) return options.onGet(bucket, key, opts, { stored, setNow: value => { now = value; } });
      const source = bucket === item.source_bucket;
      if (source && options.sourceError) throw options.sourceError;
      const bytes = source ? new Uint8Array([97, 98, 99]) : stored.get(key) ?? (options.existing ? new Uint8Array(options.wrongBytes ? [120, 121, 122] : [97, 98, 99]) : undefined);
      if (!bytes) throw error('missing', { statusCode: 404 });
      if (source && options.expireOnGet) now = Date.parse(claim.claim_expires_at);
      return { bytes, etag: source ? item.source_etag : 'b'.repeat(32), contentType: item.mime_type };
    },
    async putIfAbsent(bucket, key, bytes, opts) {
      provider.push({ op: 'put', bucket, key, bytes, opts });
      if (options.existing) throw error('exists', { statusCode: 412 });
      stored.set(key, new Uint8Array(options.wrongBytes ? [120, 121, 122] : bytes));
      if (options.lostPut) throw error('provider secret response lost', { name: 'TypeError' });
    },
  };
  return { deps: { db, objects, now: () => now }, calls, provider, stored, get posts() { return posts; } };
}
const named = (f, name) => f.calls.filter(call => call.name === `${name}_publication_schedule${name === 'claim' || name === 'reconcile' ? 's' : name === 'confirm' ? '_item' : ''}_v1`);
const failures = f => named(f, 'fail');

// These tests catch missing fences, incorrect identities, incomplete hashes and false success counters.
test('empty batch reconciles before claiming, caps limit, and never touches provider', async () => {
  const f = fixture({ empty: true });
  assert.deepEqual(plain(await run(f.deps, { limit: 100 })), { ...success, claimed: 0, published: 0 });
  assert.deepEqual(f.calls.map(c => [c.name, c.args]), [['reconcile_publication_schedules_v1', { p_limit: 10 }], ['claim_publication_schedules_v1', { p_limit: 10 }]]);
  assert.equal(f.provider.length, 0);
});
test('copies only returned identities, conditions source ETag, independently hashes complete bytes and fences all mutations', async () => {
  const f = fixture(); assert.deepEqual(plain(await run(f.deps)), success);
  assert.deepEqual(f.provider.map(p => [p.op, p.bucket, p.key]), [['get', 'private-test', 'exact/private/key'], ['put', 'public-test', 'exact/public/key'], ['get', 'public-test', 'exact/public/key']]);
  assert.equal(f.provider[0].opts.ifMatch, item.source_etag);
  assert.deepEqual(named(f, 'confirm')[0].args, { ...fence, p_position: 0, p_size_bytes: 3, p_etag: 'b'.repeat(32), p_source_sha256: HASH_ABC, p_target_sha256: HASH_ABC });
  assert.deepEqual(named(f, 'publish')[0].args, fence);
});
for (const recovery of [{ lostPut: true }, { existing: true }, { existing: true, lostPut: true }]) test(`recovery independently verifies existing target: ${JSON.stringify(recovery)}`, async () => {
  const f = fixture(recovery); assert.deepEqual(plain(await run(f.deps)), success); assert.equal(f.provider.filter(p => p.op === 'get').length, 2); assert.equal(named(f, 'confirm')[0].args.p_target_sha256, HASH_ABC);
});
for (const existing of [false, true]) test(`same-length different target bytes are terminal, including existing=${existing}`, async () => {
  const f = fixture({ existing, wrongBytes: true }); assert.deepEqual(plain(await run(f.deps)), { ...success, published: 0, terminal: 1 });
  assert.equal(failures(f)[0].args.p_error_code, 'integrity_failed'); assert.equal(failures(f)[0].args.p_retryable, false); assert.equal(named(f, 'confirm').length, 0); assert.equal(named(f, 'publish').length, 0);
});
test('multipart ETag is an opaque validator rather than content digest', async () => {
  const multipart = { ...item, source_etag: 'a'.repeat(32) + '-12' };
  const f = fixture({ items: [multipart], onGet: async (bucket) => ({ bytes: new Uint8Array([97, 98, 99]), etag: bucket === item.source_bucket ? multipart.source_etag : 'b'.repeat(32), contentType: item.mime_type }) });
  assert.deepEqual(plain(await run(f.deps)), success); assert.equal(f.provider[0].opts.ifMatch, multipart.source_etag);
});
test('partial carousel skips finalized position and preserves ordered remaining confirmation', async () => {
  const f = fixture({ items: [{ ...item, finalized: true }, { ...item, position: 1, target_key: 'second-target', target_asset_id: 'second-id' }] });
  assert.deepEqual(plain(await run(f.deps)), success); assert.equal(f.provider.length, 3); assert.equal(named(f, 'confirm')[0].args.p_position, 1); assert.equal(f.provider[1].key, 'second-target');
});
test('two workers and later duplicate invocation yield one post without duplicate writes', async () => {
  const f = fixture(); const results = await Promise.all([run(f.deps), run(f.deps), run(f.deps)]);
  assert.equal(results.reduce((n, r) => n + r.published, 0), 1); assert.equal(f.posts, 1); assert.equal(f.provider.filter(p => p.op === 'put').length, 1);
});
for (const phase of ['prepare', 'confirm', 'publish']) test(`stale generation at ${phase} stops publication without failure mutation`, async () => {
  const f = fixture({ rpc: name => name === `${phase}_publication_schedule${phase === 'confirm' ? '_item' : ''}_v1` ? { data: null, error: { message: 'publication_schedule_fence_invalid', code: '40001' } } : undefined });
  assert.deepEqual(plain(await run(f.deps)), { ...success, published: 0, stale: 1 }); assert.equal(failures(f).length, 0);
  if (phase === 'prepare') assert.equal(f.provider.length, 0);
});
for (const options of [{ claim: { claim_expires_at: '2026-11-08T07:00:00-05:00' } }, { expireOnGet: true }]) test(`lease expiry prevents every later provider operation: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); assert.deepEqual(plain(await run(f.deps)), { ...success, published: 0, stale: 1 }); assert.equal(f.provider.filter(p => p.op === 'put').length, 0); assert.equal(named(f, 'confirm').length, 0); assert.equal(failures(f).length, 0);
});
for (const [sourceError, code, terminal] of [[error('changed', { statusCode: 412 }), 'integrity_failed', true], [error('gone', { statusCode: 404 }), 'source_missing', true], [error('busy', { statusCode: 503 }), 'provider_unavailable', false], [error('timeout', { name: 'AbortError' }), 'provider_timeout', false], [error('private URL token', { name: 'TypeError' }), 'network_error', false]]) test(`provider ${code} is sanitized and respects terminal policy`, async () => {
  const f = fixture({ sourceError }); const result = await run(f.deps); assert.equal(result[terminal ? 'terminal' : 'retried'], 1); assert.equal(failures(f)[0].args.p_error_code, code); assert.equal(named(f, 'confirm').length, 0); assert.doesNotMatch(JSON.stringify(result), /private|token|URL/);
});
test('DB terminal override is counted truthfully even for transient provider error', async () => { const f = fixture({ terminal: true, sourceError: error('busy', { statusCode: 503 }) }); assert.equal((await run(f.deps)).terminal, 1); });
test('provider timeout aborts and returns even when adapter ignores cancellation', async () => {
  let signal;
  const f = fixture({ onGet: async (_b, _k, opts) => { signal = opts.signal; return new Promise(() => {}); } });
  assert.equal((await run(f.deps, { providerTimeoutMs: 5 })).retried, 1); assert.equal(signal.aborted, true); assert.equal(failures(f)[0].args.p_error_code, 'provider_timeout');
});
test('lost publish response replays exact fence once and counts one publication', async () => {
  const f = fixture({ lostPublish: true }); assert.deepEqual(plain(await run(f.deps)), success); assert.equal(f.posts, 1); assert.deepEqual(named(f, 'publish').map(c => c.args), [fence, fence]);
});
test('failed persistence is not falsely reported as retried or terminal', async () => {
  const f = fixture({ sourceError: error('busy', { statusCode: 503 }), rpc: name => name === 'fail_publication_schedule_v1' ? { data: null, error: { message: 'private secret database URL' } } : undefined });
  await assert.rejects(() => run(f.deps), { message: 'scheduled_publication_unavailable' });
});

function edgeFixture(secret = 'internal-service-secret') {
  let handler, clients = 0;
  const f = fixture({ empty: true });
  const modules = {
    '../_shared/mediaAuth.ts': { admin: () => { clients++; return f.deps.db; } },
    '../_shared/messagePush.ts': { timingSafeEqual: (a, b) => a === b },
    '../_shared/r2.ts': { getObjectBytes: () => assert.fail('unexpected provider'), putObjectIfAbsent: () => assert.fail('unexpected provider') },
    './worker.ts': worker,
  };
  load('supabase/functions/process-scheduled-publications/index.ts', modules, { Deno: { env: { get: name => name === 'SUPABASE_SERVICE_ROLE_KEY' ? secret : undefined }, serve: fn => { handler = fn; } } });
  return { f, handle: req => { assert.equal(typeof handler, 'function', 'entrypoint must register handler'); return handler(req); }, get clients() { return clients; } };
}
for (const [method, auth, secret, expected] of [['GET', 'Bearer internal-service-secret', 'internal-service-secret', 405], ['POST', null, 'internal-service-secret', 401], ['POST', 'Bearer wrong', 'internal-service-secret', 401], ['POST', 'Bearer internal-service-secret', '', 401], ['POST', 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.', 'internal-service-secret', 401]]) test(`auth before client construction: ${method}/${auth}/${secret}`, async () => {
  const f = edgeFixture(secret); const response = await f.handle(new Request('https://local.test', { method, headers: auth ? { authorization: auth } : {} })); assert.equal(response.status, expected); assert.equal(f.clients, 0); assert.equal(f.f.calls.length, 0);
});
for (const body of ['{"limit":100}', '{"owner_id":"chosen"}', '[]', 'null', 'garbage']) test(`endpoint rejects caller-selected payload ${body} before clients`, async () => {
  const f = edgeFixture(); const response = await f.handle(new Request('https://local.test', { method: 'POST', headers: { authorization: 'Bearer internal-service-secret' }, body })); assert.equal(response.status, 400); assert.equal(f.clients, 0);
});
test('authorized endpoint accepts only empty object, fixed batch, no CORS or sensitive output', async () => {
  const f = edgeFixture(); const response = await f.handle(new Request('https://local.test', { method: 'POST', headers: { authorization: 'Bearer internal-service-secret' }, body: '{}' })); assert.equal(response.status, 200); assert.equal(f.clients, 1); assert.equal(response.headers.get('access-control-allow-origin'), null); assert.deepEqual(await response.json(), { ...success, claimed: 0, published: 0 });
});

function streamedRequest(chunks, { length, authorized = true } = {}) {
  let pulls = 0, cancelled = false, index = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index++]));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = { authorization: authorized ? 'Bearer internal-service-secret' : 'Bearer wrong' };
  if (length !== undefined) headers['content-length'] = String(length);
  return { request: new Request('https://local.test', { method: 'POST', headers, body, duplex: 'half' }),
    get pulls() { return pulls; }, get cancelled() { return cancelled; } };
}

test('endpoint rejects declared overflow without pulling the real request body or constructing clients', async () => {
  const f = edgeFixture(), stream = streamedRequest(['{}'], { length: 1025 });
  const response = await f.handle(stream.request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'request_too_large' });
  assert.equal(stream.pulls, 0); assert.equal(f.clients, 0); assert.equal(f.f.calls.length, 0);
});
for (const length of [undefined, 1]) test(`endpoint counts actual UTF-8 bytes and cancels immediately on overflow with length=${length}`, async () => {
  // 512 two-byte characters exceed the cap after the first blank byte; the
  // remaining chunk must never be requested, even though the overflow is whitespace.
  const f = edgeFixture(), stream = streamedRequest([' ', '\u00a0'.repeat(512), 'SECRET'], { length });
  const response = await f.handle(stream.request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'request_too_large' });
  assert.equal(stream.cancelled, true); assert.equal(stream.pulls, 2);
  assert.equal(f.clients, 0); assert.equal(f.f.calls.length, 0);
});
for (const length of [undefined, 1, 999999]) test(`endpoint authenticates before consuming oversized stream with length=${length}`, async () => {
  const f = edgeFixture(), stream = streamedRequest([' '.repeat(1025)], { length, authorized: false });
  const response = await f.handle(stream.request);
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(stream.pulls, 0); assert.equal(stream.cancelled, false); assert.equal(f.clients, 0);
});
for (const chunks of [[], ['  \n'], ['{', '}'], [' '.repeat(1022), '{', '}'], ['\u00a0'.repeat(512)]]) {
  test(`endpoint accepts bounded blank/object stream of ${chunks.join('').length} characters`, async () => {
    const f = edgeFixture(), stream = streamedRequest(chunks);
    const response = await f.handle(stream.request);
    assert.equal(response.status, 200); assert.equal(f.clients, 1); assert.equal(stream.cancelled, false);
    assert.deepEqual(await response.json(), { ...success, claimed: 0, published: 0 });
  });
}
for (const chunks of [['{"SECRET":', 'true}'], ['{'], ['[', ']']]) test(`endpoint keeps bounded invalid JSON sanitized: ${chunks.join('')}`, async () => {
  const f = edgeFixture(), stream = streamedRequest(chunks);
  const response = await f.handle(stream.request);
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_request' });
  assert.equal(f.clients, 0); assert.equal(f.f.calls.length, 0);
});

function r2Fixture(send) {
  const commands = [];
  class Command { constructor(input) { this.input = input; } }
  const api = load('supabase/functions/_shared/r2.ts', {
    'npm:@aws-sdk/client-s3@3.637.0': { S3Client: class { async send(command, options) { commands.push({ input: command.input, options }); return send(command, options); } }, GetObjectCommand: Command, PutObjectCommand: Command, HeadObjectCommand: Command, DeleteObjectCommand: Command },
    'npm:@aws-sdk/s3-request-presigner@3.637.0': { getSignedUrl: () => assert.fail('no signed URLs') },
  }, { Deno: { env: { get: () => 'test-only' } } });
  return { api, commands };
}
test('shared byte GET sends quoted frozen ETag and abort signal, returns actual response ETag, preserves old callers', async () => {
  const f = r2Fixture(() => ({ ContentLength: 3, ContentType: 'image/jpeg', ETag: '"' + 'b'.repeat(32) + '"', Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([97, 98, 99]); } } }));
  const controller = new AbortController(); const result = await f.api.getObjectBytes('bucket', 'key', 3, { ifMatch: item.source_etag, signal: controller.signal });
  assert.equal(f.commands[0].input.IfMatch, '"' + item.source_etag + '"'); assert.equal(result.etag, 'b'.repeat(32)); controller.abort(); assert.equal(f.commands[0].options.abortSignal.aborted, true);
  assert.deepEqual(Array.from((await f.api.getObjectBytes('bucket', 'key', 3)).bytes), [97, 98, 99]);
});
test('shared PUT is strictly create-if-absent and forwards bytes and signal', async () => {
  const f = r2Fixture(() => ({})); assert.equal(typeof f.api.putObjectIfAbsent, 'function'); const bytes = new Uint8Array([97]); const controller = new AbortController();
  await f.api.putObjectIfAbsent('b', 'k', bytes, { contentType: 'image/jpeg', signal: controller.signal }); assert.equal(f.commands[0].input.IfNoneMatch, '*'); assert.equal(f.commands[0].input.Body, bytes); controller.abort(); assert.equal(f.commands[0].options.abortSignal.aborted, true);
});
test('shared byte GET rejects complete oversized bodies even if provider length lies', async () => {
  const f = r2Fixture(() => ({ ContentLength: 1, Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([97, 98, 99]); } } })); await assert.rejects(() => f.api.getObjectBytes('b', 'k', 2), /r2_object_too_large/);
});

for (const source of [true, false]) test(`different ${source ? 'source' : 'target'} MIME is terminal integrity failure`, async () => {
  const f = fixture({ onGet: async bucket => ({ bytes: new Uint8Array([97, 98, 99]), etag: bucket === item.source_bucket ? item.source_etag : 'b'.repeat(32), contentType: (bucket === item.source_bucket) === source ? 'image/png' : item.mime_type }) });
  assert.equal((await run(f.deps)).terminal, 1); assert.equal(failures(f)[0].args.p_error_code, 'integrity_failed'); assert.equal(named(f, 'publish').length, 0);
});
test('missing provider configuration is terminal and never leaks environment names', async () => {
  const f = fixture({ sourceError: error('missing_r2_secret_access_key') }); const result = await run(f.deps); assert.equal(result.terminal, 1); assert.equal(failures(f)[0].args.p_error_code, 'configuration_missing'); assert.doesNotMatch(JSON.stringify(result), /secret|key/);
});
test('hard deadline cannot exceed 60 seconds even with caller option above maximum', async () => {
  const durations = [], cleared = [];
  const boundedWorker = load(workerPath, {}, { setTimeout: (_fn, ms) => { durations.push(ms); return 123; }, clearTimeout: id => cleared.push(id) });
  const f = fixture(); assert.deepEqual(plain(await boundedWorker.processScheduledPublicationBatch(f.deps, { providerTimeoutMs: 999999 })), success); assert.deepEqual(durations, [60000]); assert.deepEqual(cleared, [123]);
});
test('deadline is shortened to remaining lease and target-read expiry prevents confirmation', async () => {
  const durations = [];
  const boundedWorker = load(workerPath, {}, { setTimeout: (_fn, ms) => { durations.push(ms); return 123; }, clearTimeout: () => {} });
  const f = fixture({ claim: { claim_expires_at: '2026-11-08T12:00:01Z' } }); assert.deepEqual(plain(await boundedWorker.processScheduledPublicationBatch(f.deps)), success); assert.deepEqual(durations, [1000]);
  const expired = fixture({ onGet: async (bucket, _key, _opts, state) => { if (bucket === item.target_bucket) state.setNow(Date.parse(claim.claim_expires_at)); return { bytes: new Uint8Array([97, 98, 99]), etag: bucket === item.source_bucket ? item.source_etag : 'b'.repeat(32), contentType: item.mime_type }; } });
  assert.equal((await run(expired.deps)).stale, 1); assert.equal(named(expired, 'confirm').length, 0); assert.equal(named(expired, 'publish').length, 0);
});
test('source read ETag mismatch prevents PUT even if returned bytes match', async () => {
  const f = fixture({ onGet: async () => ({ bytes: new Uint8Array([97, 98, 99]), etag: 'c'.repeat(32), contentType: item.mime_type }) }); assert.equal((await run(f.deps)).terminal, 1); assert.equal(f.provider.filter(p => p.op === 'put').length, 0);
});
test('prepare failure produces zero provider work and persists only sanitized database error', async () => {
  const f = fixture({ rpc: name => name === 'prepare_publication_schedule_v1' ? { data: null, error: { message: 'publication_schedule_draft_changed' } } : undefined }); assert.equal((await run(f.deps)).terminal, 1); assert.equal(f.provider.length, 0); assert.deepEqual(failures(f)[0].args, { ...fence, p_error_code: 'draft_changed', p_retryable: false });
});
test('failure RPC invalidated by cancellation counts stale rather than falsely retrying', async () => {
  const f = fixture({ sourceError: error('network', { name: 'TypeError' }), rpc: name => name === 'fail_publication_schedule_v1' ? { data: null, error: { message: 'publication_schedule_fence_invalid' } } : undefined }); assert.deepEqual(plain(await run(f.deps)), { ...success, published: 0, stale: 1 });
});
test('lost publish receipt replays after lease expiry without starting new provider work', async () => {
  let now = Date.parse('2026-11-08T12:00:00Z'), attempts = 0;
  const f = fixture({ rpc: name => {
    if (name !== 'publish_publication_schedule_v1') return undefined;
    attempts++;
    if (attempts === 1) { now = Date.parse(claim.claim_expires_at); throw error('response lost', { name: 'TypeError' }); }
    return { data: { schedule_id: claim.schedule_id, generation: claim.generation, state: 'published', post_id: 'same-post' }, error: null };
  } }); f.deps.now = () => now;
  assert.deepEqual(plain(await run(f.deps)), success); assert.deepEqual(named(f, 'publish').map(c => c.args), [fence, fence]); assert.equal(f.provider.length, 3);
});

function chunkedBody(kind, { hang = false, onRead } = {}) {
  const chunks = [[1, 2], [3, 4], [5, 6], [7, 8]];
  const state = { reads: 0, cancelled: 0, transformed: 0 };
  const next = async () => {
    state.reads++; onRead?.(state.reads);
    if (hang) return new Promise(() => {});
    return state.reads <= chunks.length ? { done: false, value: new Uint8Array(chunks[state.reads - 1]) } : { done: true };
  };
  const stop = async () => { state.cancelled++; return { done: true }; };
  const body = kind === 'stream'
    ? { getReader: () => ({ read: next, cancel: stop, releaseLock() {} }) }
    : { [Symbol.asyncIterator]: () => ({ next, return: stop }) };
  // The old implementation consumes everything, making the bug behavioral rather than a missing-method error.
  body.transformToByteArray = async () => {
    state.transformed++;
    const bytes = [];
    while (true) { const result = await next(); if (result.done) break; bytes.push(...result.value); }
    return new Uint8Array(bytes);
  };
  return { body, state };
}
for (const kind of ['stream', 'iterator']) for (const declared of [undefined, 1]) test(`bounded ${kind} cancels at first overflow with ContentLength=${declared}`, async () => {
  const { body, state } = chunkedBody(kind);
  const f = r2Fixture(() => ({ ContentLength: declared, Body: body }));
  await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3), /r2_object_too_large/);
  assert.equal(state.reads, 2, 'later chunks must not be read after crossing the byte ceiling');
  assert.equal(state.cancelled, 1); assert.equal(state.transformed, 0);
});
for (const kind of ['stream', 'iterator']) test(`bounded ${kind} aborts a pending body read and cancels without waiting on it`, { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const { body, state } = chunkedBody(kind, { hang: true, onRead: () => queueMicrotask(() => controller.abort('private abort reason')) });
  const f = r2Fixture(() => ({ Body: body }));
  await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3, { signal: controller.signal }), e => e.name === 'AbortError' && !e.message.includes('private'));
  assert.equal(state.reads, 1); assert.equal(state.cancelled, 1); assert.equal(state.transformed, 0);
});
for (const declared of [undefined, 3]) test(`unknown legacy body shape fails closed without buffering, declared=${declared}`, async () => {
  let transformed = 0;
  const f = r2Fixture(() => ({ ContentLength: declared, Body: { transformToByteArray: async () => { transformed++; return new Uint8Array([1, 2, 3]); } } }));
  await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3), /r2_object_unreadable/); assert.equal(transformed, 0);
});
test('declared oversized stream cancels without consuming a chunk', async () => {
  const { body, state } = chunkedBody('stream'); const f = r2Fixture(() => ({ ContentLength: 100, Body: body }));
  await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3), /r2_object_too_large/); assert.equal(state.reads, 0); assert.equal(state.cancelled, 1);
});
for (const kind of ['stream', 'iterator']) test(`bounded ${kind} reads complete bytes at exact cap and preserves old-call API`, async () => {
  const { body, state } = chunkedBody(kind); const f = r2Fixture(() => ({ Body: body, ContentType: 'image/jpeg', ETag: '"' + 'a'.repeat(32) + '"' }));
  const result = await f.api.getObjectBytes('b', 'k', 8); assert.deepEqual(Array.from(result.bytes), [1, 2, 3, 4, 5, 6, 7, 8]); assert.equal(result.contentType, 'image/jpeg'); assert.equal(result.etag, 'a'.repeat(32)); assert.equal(state.transformed, 0);
});

test('actual Web stream stops pulling and cancels immediately on overflow', async () => {
  let pulls = 0, cancellations = 0;
  const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array([1, 2])); }, cancel() { cancellations++; } }, { highWaterMark: 0 });
  const f = r2Fixture(() => ({ Body: body })); await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3), /r2_object_too_large/);
  assert.equal(pulls, 2); assert.equal(cancellations, 1); assert.equal(body.locked, false);
});
test('actual Node body is destroyed when cancellation interrupts a pending read', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const body = new Readable({ read() { queueMicrotask(() => controller.abort()); } });
  const f = r2Fixture(() => ({ Body: body }));
  try { await assert.rejects(() => f.api.getObjectBytes('b', 'k', 3, { signal: controller.signal }), e => e.name === 'AbortError'); assert.equal(body.destroyed, true); }
  finally { body.destroy(); }
});
test('Blob body uses its incremental stream and returns exact bytes', async () => {
  const f = r2Fixture(() => ({ Body: new Blob([new Uint8Array([1, 2, 3])]) })); assert.deepEqual(Array.from((await f.api.getObjectBytes('b', 'k', 3)).bytes), [1, 2, 3]);
});
test('unsupported body failure is terminal integrity in worker with no writes', async () => {
  const f = fixture({ sourceError: error('r2_object_unreadable') }); assert.equal((await run(f.deps)).terminal, 1); assert.equal(failures(f)[0].args.p_error_code, 'integrity_failed'); assert.equal(f.provider.filter(p => p.op === 'put').length, 0);
});

test('bounded buffer growth preserves all bytes across chunk boundaries up to exact cap', async () => {
  const f = r2Fixture(() => ({ Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array(60000).fill(1); yield new Uint8Array(10000).fill(2); yield new Uint8Array(40000).fill(3); } } }));
  const { bytes } = await f.api.getObjectBytes('b', 'k', 110000);
  assert.equal(bytes.length, 110000); assert.ok(bytes.subarray(0, 60000).every(n => n === 1)); assert.ok(bytes.subarray(60000, 70000).every(n => n === 2)); assert.ok(bytes.subarray(70000).every(n => n === 3));
});
test('already aborted body is cancelled without starting consumption', async () => {
  const controller = new AbortController(); controller.abort();
  const { body, state } = chunkedBody('stream'); const f = r2Fixture(() => ({ Body: body }));
  await assert.rejects(() => f.api.getObjectBytes('b', 'k', 8, { signal: controller.signal }), e => e.name === 'AbortError'); assert.equal(state.reads, 0); assert.equal(state.cancelled, 1);
});
