import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

const providerModule = await import('../scripts/nelyon-private-authority-provider.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const memory = (...args) => {
  assert.equal(typeof providerModule.createInMemoryPrivateAuthorityProvider, 'function', 'memory provider exists');
  return providerModule.createInMemoryPrivateAuthorityProvider(...args);
};
const r2 = (...args) => {
  assert.equal(typeof providerModule.createR2PrivateAuthorityProvider, 'function', 'R2 provider exists');
  return providerModule.createR2PrivateAuthorityProvider(...args);
};
const r2Publisher = (...args) => {
  assert.equal(typeof providerModule.createR2PrivateAuthorityPublisher, 'function', 'R2 publisher exists');
  return providerModule.createR2PrivateAuthorityPublisher(...args);
};
const r2AccessProbe = (...args) => {
  assert.equal(typeof providerModule.createR2PrivateAuthorityAccessProbe, 'function', 'R2 access probe exists');
  return providerModule.createR2PrivateAuthorityAccessProbe(...args);
};
const publisherDiagnostic = error => {
  assert.equal(typeof providerModule.readR2PrivateAuthorityPublisherDiagnostic, 'function',
    'R2 publisher diagnostic reader exists');
  return providerModule.readR2PrivateAuthorityPublisherDiagnostic(error);
};
const MARKER = 'SYNTHETIC_PROVIDER_PRIVATE_MARKER';
const BYTES = Buffer.from(`{"synthetic":"${MARKER}"}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = digest(BYTES);
const ETAG = `"${'e'.repeat(32)}"`;
const KEY = `internal/release-authority/v1/sha256/${SHA}.json`;
const LIMIT = 2 * 1024 * 1024;
const config = fetch => ({ accountId: 'a'.repeat(32), bucket: 'synthetic-authority',
  accessKeyId: `synthetic-${MARKER}`, secretAccessKey: MARKER, fetch, timeoutMs: 200 });
function clean(error, code = 'PRIVATE_AUTHORITY_PROVIDER_INVALID') {
  assert.equal(error.code, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  for (const output of [String(error), JSON.stringify(error), inspect(error), error.stack]) {
    for (const secret of [MARKER, 'synthetic-authority', 'r2.cloudflarestorage.com', SHA]) {
      assert.equal(output.includes(secret), false);
    }
  }
  return true;
}
const rejected = (operation, code) => assert.rejects(operation, error => clean(error, code));
const response = (bytes = BYTES, length = bytes.length) => new Response(bytes, {
  headers: { 'content-length': String(length) },
});
const publisherHeaders = (etag = ETAG) => ({
  'content-length': String(BYTES.length),
  'content-type': 'application/json',
  etag,
  'x-amz-meta-nelyon-content-sha256': SHA,
  'x-amz-meta-nelyon-write-id': SHA,
});
const publisherHead = (etag = ETAG) => new Response(null, {
  headers: publisherHeaders(etag),
});
const publisherGet = (bytes = BYTES, etag = ETAG) => new Response(bytes, {
  headers: { ...publisherHeaders(etag), 'content-length': String(bytes.length) },
});
function fakeReader(overrides = {}) {
  const calls = [];
  return { calls, fetch: async request => {
    calls.push(request);
    if (request.method === 'HEAD') return overrides.head?.(request) ?? new Response(null, {
      headers: { 'content-length': String(BYTES.length) },
    });
    if (request.method === 'GET') return overrides.get?.(request) ?? response();
    assert.fail('unexpected provider method');
  } };
}

test('memory retrieves exact historical bytes and protects stored copies', async () => {
  const source = Buffer.from(BYTES);
  const older = Buffer.from('{"historical":true}');
  const provider = memory({ [SHA]: source, [digest(older)]: older });
  source.fill(0);
  const first = await provider.getBySha256(SHA);
  assert.deepEqual(first, BYTES);
  first.fill(0);
  assert.deepEqual(await provider.getBySha256(SHA), BYTES);
  assert.deepEqual(await provider.getBySha256(digest(older)), older);
  assert.equal(Object.isFrozen(provider), true);
  assert.deepEqual(Object.keys(provider), ['getBySha256']);
  assert.equal(inspect(provider).includes(MARKER), false);
  assert.equal(JSON.stringify(provider).includes(MARKER), false);
});

test('missing historical version fails without latest fallback', async () => {
  const provider = memory({ [SHA]: BYTES });
  await rejected(() => provider.getBySha256('b'.repeat(64)), 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE');
});

test('digest intake rejects aliases, locators and objects without coercion', async () => {
  let touched = 0;
  const malicious = { toString() { touched++; throw new Error(MARKER); } };
  const fake = fakeReader();
  for (const provider of [memory({ [SHA]: BYTES }), r2(config(fake.fetch))]) {
    for (const value of ['current', '../authority.json', `https://example.invalid/${MARKER}`,
      SHA.toUpperCase(), '', null, 1, malicious, new String(SHA), new Proxy({}, {
        get() { touched++; throw new Error(MARKER); },
      })]) await rejected(() => provider.getBySha256(value));
  }
  assert.equal(touched, 0);
  assert.equal(fake.calls.length, 0);
});

test('memory refuses altered, empty, oversized and unbounded stored versions', () => {
  for (const entries of [{ [SHA]: Buffer.from('altered') }, { [SHA]: Buffer.alloc(0) },
    { [SHA]: Buffer.alloc(LIMIT + 1) }, { current: BYTES },
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [i.toString(16).padStart(64, '0'), BYTES]))]) {
    assert.throws(() => memory(entries), clean);
  }
});

test('constructors reject Proxy, getters and coercion without invoking them', () => {
  let touched = 0;
  const getter = Object.defineProperty({}, SHA, { enumerable: true, get() { touched++; throw new Error(MARKER); } });
  assert.throws(() => memory(getter), clean);
  const byteGetter = Buffer.from(BYTES);
  Object.defineProperty(byteGetter, 'length', { get() { touched++; throw new Error(MARKER); } });
  assert.throws(() => memory({ [SHA]: byteGetter }), clean);
  for (const create of [memory, r2, r2AccessProbe]) assert.throws(() => create(new Proxy({}, {
    ownKeys() { touched++; throw new Error(MARKER); },
  })), clean);
  const options = config(async () => response());
  Object.defineProperty(options, 'secretAccessKey', { enumerable: true, get() { touched++; throw new Error(MARKER); } });
  assert.throws(() => r2(options), clean);
  assert.throws(() => r2({ ...config(async () => response()), accountId: { toString() { touched++; return MARKER; } } }), clean);
  assert.throws(() => r2({ ...config(async () => response()), endpoint: `https://${MARKER}.invalid` }), clean);
  assert.throws(() => r2({ ...config(async () => response()), fetch: new Proxy(() => {}, {}) }), clean);
  assert.equal(touched, 0);
});

test('R2 access probe performs one signed HeadBucket and returns only sanitized evidence', async () => {
  const calls = [];
  let cancelled = false;
  const probe = r2AccessProbe(config(async request => {
    calls.push(request);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
  }));
  const result = await probe.verify();
  assert.deepEqual(result, {
    schemaVersion: 1,
    result: 'R2_RUNTIME_ACCESS_VERIFIED',
    operation: 'HeadBucket',
    bucket: 'synthetic-authority',
    status: 200,
  });
  assert.deepEqual(Object.keys(probe), ['verify']);
  assert.equal(Object.isFrozen(probe), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls.length, 1);
  const request = calls[0];
  const url = new URL(request.url);
  assert.equal(request.method, 'HEAD');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, '/synthetic-authority');
  assert.equal(url.search, '');
  assert.equal(request.body, null);
  assert.equal(request.redirect, 'error');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.headers.has('authorization'), true);
  assert.equal(request.headers.has('x-amz-date'), true);
  assert.equal(request.headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
  assert.equal(cancelled, true);
  for (const output of [JSON.stringify(result), inspect(result), inspect(probe)]) {
    for (const secret of [MARKER, 'r2.cloudflarestorage.com', 'authorization']) {
      assert.equal(output.toLowerCase().includes(secret.toLowerCase()), false);
    }
  }
});

test('R2 access probe rejects non-200, transport failure and timeout without fallback or leakage', async () => {
  for (const status of [301, 400, 403, 404, 429, 500, 503]) {
    const calls = [];
    await rejected(() => r2AccessProbe(config(async request => {
      calls.push(request);
      return new Response(MARKER, { status });
    })).verify());
    assert.deepEqual(calls.map(request => request.method), ['HEAD']);
  }
  await rejected(() => r2AccessProbe(config(async () => { throw new Error(MARKER); })).verify());
  let signal;
  await rejected(() => r2AccessProbe({ ...config(request => {
    signal = request.signal;
    return new Promise(() => {});
  }), timeoutMs: 15 }).verify());
  assert.equal(signal.aborted, true);
});

test('R2 performs only signed HEAD then signed GET at digest-derived key', async () => {
  const fake = fakeReader();
  const provider = r2(config(fake.fetch));
  assert.deepEqual(await provider.getBySha256(SHA), BYTES);
  assert.deepEqual(fake.calls.map(request => request.method), ['HEAD', 'GET']);
  for (const request of fake.calls) {
    const url = new URL(request.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    assert.equal(url.pathname, `/synthetic-authority/internal/release-authority/v1/sha256/${SHA}.json`);
    assert.equal(url.search, '');
    assert.equal(request.headers.has('authorization'), true);
    assert.equal(request.headers.has('x-amz-date'), true);
    assert.equal(request.headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
    assert.equal(request.redirect, 'error');
    assert.equal(request.signal instanceof AbortSignal, true);
  }
  assert.deepEqual(Object.keys(provider), ['getBySha256']);
  assert.equal(inspect(provider).includes(MARKER), false);
});

test('R2 refuses unavailable historical HEAD or GET without fallback', async () => {
  for (const method of ['head', 'get']) {
    const fake = fakeReader({ [method]: () => new Response(MARKER, { status: 404 }) });
    await rejected(() => r2(config(fake.fetch)).getBySha256(SHA), 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE');
    assert.deepEqual(fake.calls.map(request => request.method), method === 'head' ? ['HEAD'] : ['HEAD', 'GET']);
  }
});

test('R2 rejects HEAD status, missing length, malformed length, empty and oversized metadata before GET', async () => {
  for (const head of [() => new Response(MARKER, { status: 403 }),
    () => new Response(null, { status: 206 }), () => new Response(null),
    ...['0', '-1', '1e2', '01', String(LIMIT + 1)].map(length => () => ({ status: 200,
      headers: new Headers({ 'content-length': length }), body: null }))]) {
    const fake = fakeReader({ head });
    await rejected(() => r2(config(fake.fetch)).getBySha256(SHA));
    assert.deepEqual(fake.calls.map(request => request.method), ['HEAD']);
  }
});

test('R2 requires GET length equality and exact digest without trusting ETag', async () => {
  for (const get of [() => new Response(MARKER, { status: 500 }),
    () => new Response(BYTES), () => response(BYTES, BYTES.length + 1),
    () => response(BYTES.subarray(1), BYTES.length), () => response(Buffer.alloc(0), BYTES.length),
    () => new Response(Buffer.alloc(BYTES.length, 65), { headers: {
      'content-length': String(BYTES.length), etag: SHA,
    } })]) {
    const fake = fakeReader({ get });
    await rejected(() => r2(config(fake.fetch)).getBySha256(SHA));
    assert.deepEqual(fake.calls.map(request => request.method), ['HEAD', 'GET']);
  }
});

test('R2 cancels oversized streamed bytes before buffering or parsing', async () => {
  let cancelled = false;
  const fake = fakeReader({ head: () => new Response(null, { headers: { 'content-length': String(LIMIT) } }),
    get: () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.alloc(LIMIT)); controller.enqueue(Buffer.from(MARKER));
    }, cancel() { cancelled = true; } }), { headers: { 'content-length': String(LIMIT) } }) });
  await rejected(() => r2(config(fake.fetch)).getBySha256(SHA));
  assert.equal(cancelled, true);
});

test('R2 accepts the exact 2 MiB limit and returns bytes without parsing JSON', async () => {
  const bytes = Buffer.alloc(LIMIT, 65);
  const fake = fakeReader({ head: () => new Response(null, { headers: { 'content-length': String(LIMIT) } }),
    get: () => response(bytes) });
  assert.deepEqual(await r2(config(fake.fetch)).getBySha256(digest(bytes)), bytes);
});

test('R2 copies stream chunks without invoking byte coercion or accessors', async () => {
  let touched = 0;
  const bytes = new Uint8Array(BYTES);
  Object.defineProperty(bytes, 'valueOf', { get() { touched++; throw new Error(MARKER); } });
  const fake = fakeReader({ get: () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes); controller.close();
  } }), { headers: { 'content-length': String(BYTES.length) } }) });
  assert.deepEqual(await r2(config(fake.fetch)).getBySha256(SHA), BYTES);
  assert.equal(touched, 0);
});

test('R2 rejects an empty-chunk flood with bounded read count and cancels its body', async () => {
  let pulls = 0;
  let cancelled = false;
  const fake = fakeReader({ get: () => new Response(new ReadableStream({ pull(controller) {
    if (++pulls <= 100_000) controller.enqueue(new Uint8Array(0));
    else { controller.enqueue(BYTES); controller.close(); }
  }, cancel() { cancelled = true; } }), { headers: { 'content-length': String(BYTES.length) } }) });
  await rejected(() => r2({ ...config(fake.fetch), timeoutMs: 5000 }).getBySha256(SHA));
  assert.ok(pulls <= 2, 'empty chunks cannot accumulate deadline reactions');
  assert.equal(cancelled, true);
});

test('R2 bounds tiny-chunk processing independently of declared byte length', async () => {
  let pulls = 0;
  let cancelled = false;
  const bytes = Buffer.alloc(100_000, 65);
  const fake = fakeReader({ head: () => new Response(null, { headers: { 'content-length': String(bytes.length) } }),
    get: () => new Response(new ReadableStream({ pull(controller) {
      if (++pulls <= bytes.length) controller.enqueue(Uint8Array.of(65));
      else controller.close();
    }, cancel() { cancelled = true; } }), { headers: { 'content-length': String(bytes.length) } }) });
  await rejected(() => r2({ ...config(fake.fetch), timeoutMs: 5000 }).getBySha256(digest(bytes)));
  assert.ok(pulls <= 20_000, 'tiny chunks have a finite resource budget');
  assert.equal(cancelled, true);
});

test('R2 enforces absolute timeout when immediate stream reads starve timers', async () => {
  let cancelled = false;
  let pulls = 0;
  const bytes = Buffer.alloc(64, 65);
  const fake = fakeReader({ head: () => new Response(null, { headers: { 'content-length': '64' } }),
    get: () => new Response(new ReadableStream({ pull(controller) {
      if (++pulls > bytes.length) { controller.close(); return; }
      const until = performance.now() + 3;
      while (performance.now() < until) { /* immediate reads keep timers from running */ }
      controller.enqueue(Uint8Array.of(65));
    }, cancel() { cancelled = true; } }), { headers: { 'content-length': '64' } }) });
  await rejected(() => r2({ ...config(fake.fetch), timeoutMs: 60 }).getBySha256(digest(bytes)));
  assert.ok(pulls < 64, 'deadline must interrupt before the finite stream ends');
  assert.equal(cancelled, true);
});

test('R2 aborts stalled fetches and streams and sanitizes provider failures', async () => {
  let signal;
  const stalled = request => { signal = request.signal; return new Promise(() => {}); };
  // Leave enough time for real SigV4 setup so this case exercises an in-flight
  // transport. Short absolute-deadline behavior is covered independently below.
  await rejected(() => r2({ ...config(stalled), timeoutMs: 1000 }).getBySha256(SHA));
  assert.equal(signal.aborted, true);
  let cancelled = false;
  const fake = fakeReader({ get: () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { 'content-length': String(BYTES.length) } }) });
  await rejected(() => r2({ ...config(fake.fetch), timeoutMs: 1000 }).getBySha256(SHA));
  assert.equal(cancelled, true);
  await rejected(() => r2(config(async () => { throw new Error(MARKER); })).getBySha256(SHA));
  const broken = fakeReader({ get: () => new Response(new ReadableStream({ start(controller) {
    controller.error(new Error(MARKER));
  } }), { headers: { 'content-length': String(BYTES.length) } }) });
  await rejected(() => r2(config(broken.fetch)).getBySha256(SHA));
});

test('late HEAD response after timeout is cancelled and cannot trigger GET', async () => {
  let finish;
  let cancelled = false;
  const calls = [];
  const provider = r2({ ...config(request => {
    calls.push(request.method);
    return new Promise(resolve => { finish = resolve; });
  }), timeoutMs: 15 });
  await rejected(() => provider.getBySha256(SHA));
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'content-length': String(BYTES.length) },
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.deepEqual(calls, ['HEAD']);
});

test('R2 publisher performs one conditional PUT and exact readback at the digest key', async () => {
  const calls = [];
  let cancelled = false;
  const fetch = async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
    if (request.method === 'HEAD') return publisherHead();
    if (request.method === 'GET') return publisherGet();
    assert.fail('unexpected publisher method');
  };
  const result = await r2Publisher(config(fetch)).publishBySha256(SHA, BYTES);
  assert.deepEqual(result, { schemaVersion: 1, result: 'CREATED', sha256: SHA, byteLength: BYTES.length,
    key: KEY, etag: ETAG, readback: 'HEAD_GET_EXACT' });
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
  assert.equal(cancelled, true);
  const put = calls[0];
  assert.equal(new URL(put.url).pathname,
    `/synthetic-authority/internal/release-authority/v1/sha256/${SHA}.json`);
  assert.equal(put.headers.get('if-none-match'), '*');
  assert.equal(put.headers.get('content-type'), 'application/json');
  assert.equal(put.headers.get('content-length'), String(BYTES.length));
  assert.equal(put.headers.get('x-amz-meta-nelyon-content-sha256'), SHA);
  assert.equal(put.headers.get('x-amz-meta-nelyon-write-id'), SHA);
  assert.deepEqual(Buffer.from(await put.arrayBuffer()), BYTES);
  assert.deepEqual(Object.keys(r2Publisher(config(fetch))), ['publishBySha256']);
});

test('R2 publisher accepts 412 only after exact existing-byte readback', async () => {
  const calls = [];
  const fetch = async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(MARKER, { status: 412 });
    if (request.method === 'HEAD') return publisherHead();
    if (request.method === 'GET') return publisherGet();
    assert.fail('unexpected publisher method');
  };
  assert.deepEqual(await r2Publisher(config(fetch)).publishBySha256(SHA, BYTES), {
    schemaVersion: 1, result: 'ALREADY_EXISTS', sha256: SHA, byteLength: BYTES.length,
    key: KEY, etag: ETAG, readback: 'HEAD_GET_EXACT',
  });
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
});

test('R2 publisher resolves uncertain PUT transport only by exact readback without retry', async () => {
  const calls = [];
  const fetch = async request => {
    calls.push(request);
    if (request.method === 'PUT') throw new Error(MARKER);
    if (request.method === 'HEAD') return publisherHead();
    if (request.method === 'GET') return publisherGet();
    assert.fail('unexpected publisher method');
  };
  assert.deepEqual(await r2Publisher(config(fetch)).publishBySha256(SHA, BYTES), {
    schemaVersion: 1, result: 'UNCERTAIN_WRITE_VERIFIED', sha256: SHA, byteLength: BYTES.length,
    key: KEY, etag: ETAG, readback: 'HEAD_GET_EXACT',
  });
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
});

test('R2 publisher resolves a timed-out PUT only by exact readback and cancels a late body', async () => {
  const calls = [];
  let finishPut;
  let cancelled = false;
  const fetch = request => {
    calls.push(request);
    if (request.method === 'PUT') {
      return new Promise(resolve => {
        finishPut = () => resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 }));
      });
    }
    if (request.method === 'HEAD') return Promise.resolve(publisherHead());
    if (request.method === 'GET') return Promise.resolve(publisherGet());
    assert.fail('unexpected publisher method');
  };
  assert.deepEqual(await r2Publisher({ ...config(fetch), timeoutMs: 15 }).publishBySha256(SHA, BYTES), {
    schemaVersion: 1, result: 'UNCERTAIN_WRITE_VERIFIED', sha256: SHA, byteLength: BYTES.length,
    key: KEY, etag: ETAG, readback: 'HEAD_GET_EXACT',
  });
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
  finishPut();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('R2 publisher reconciles ambiguous HTTP status and delayed visibility without a second PUT', async () => {
  const calls = [];
  let headAttempts = 0;
  const fetch = async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(null, { status: 503 });
    if (request.method === 'HEAD' && ++headAttempts === 1) return new Response(null, { status: 404 });
    if (request.method === 'HEAD') return publisherHead();
    if (request.method === 'GET') return publisherGet();
    assert.fail('unexpected publisher method');
  };
  assert.deepEqual(await r2Publisher({ ...config(fetch), timeoutMs: 500 }).publishBySha256(SHA, BYTES), {
    schemaVersion: 1, result: 'UNCERTAIN_WRITE_VERIFIED', sha256: SHA, byteLength: BYTES.length,
    key: KEY, etag: ETAG, readback: 'HEAD_GET_EXACT',
  });
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'HEAD', 'GET']);
  assert.equal(calls.filter(request => request.method === 'PUT').length, 1);
});

test('R2 publisher bounds failed readback retries and never repeats an ambiguous PUT', async () => {
  const calls = [];
  await rejected(() => r2Publisher({ ...config(async request => {
    calls.push(request);
    if (request.method === 'PUT') throw new Error(MARKER);
    return new Response(null, { status: 404 });
  }), timeoutMs: 500 }).publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.equal(calls.filter(request => request.method === 'PUT').length, 1);
  assert.equal(calls.filter(request => request.method === 'HEAD').length, 3);
  assert.equal(calls.filter(request => request.method === 'GET').length, 0);
});

test('R2 publisher requires exact content type and stable digest metadata on readback', async () => {
  const variants = [
    { 'content-type': 'application/octet-stream' },
    { 'x-amz-meta-nelyon-content-sha256': '0'.repeat(64) },
    { 'x-amz-meta-nelyon-write-id': '0'.repeat(64) },
  ];
  for (const override of variants) {
    const calls = [];
    await rejected(() => r2Publisher(config(async request => {
      calls.push(request);
      if (request.method === 'PUT') return new Response(null, { status: 200 });
      if (request.method === 'HEAD') return new Response(null, { headers: { ...publisherHeaders(), ...override } });
      return publisherGet();
    })).publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
    assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD']);
  }
});

test('R2 publisher fails closed on wrong digest, non-precondition status or readback mismatch', async () => {
  let calls = [];
  await rejected(() => r2Publisher(config(async request => { calls.push(request); return new Response(null, { status: 403 }); }))
    .publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.deepEqual(calls.map(request => request.method), ['PUT']);
  calls = [];
  await rejected(() => r2Publisher(config(async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(null, { status: 200 });
    if (request.method === 'HEAD') return publisherHead();
    return publisherGet(Buffer.alloc(BYTES.length, 65));
  })).publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
  calls = [];
  await rejected(() => r2Publisher(config(async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(null, { status: 200 });
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(BYTES.length) } });
    return publisherGet();
  })).publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD']);
  calls = [];
  await rejected(() => r2Publisher(config(async request => {
    calls.push(request);
    if (request.method === 'PUT') return new Response(null, { status: 200 });
    if (request.method === 'HEAD') return publisherHead();
    return publisherGet(BYTES, `"${'f'.repeat(32)}"`);
  })).publishBySha256(SHA, BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.deepEqual(calls.map(request => request.method), ['PUT', 'HEAD', 'GET']);
  calls = [];
  await rejected(() => r2Publisher(config(async request => { calls.push(request); return response(); }))
    .publishBySha256('0'.repeat(64), BYTES), 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  assert.equal(calls.length, 0);
});

test('R2 publisher exposes only non-forgeable sanitized failure subphases', async () => {
  let statusFailure;
  await assert.rejects(() => r2Publisher(config(async () => new Response(MARKER, { status: 403 })))
    .publishBySha256(SHA, BYTES), error => {
      statusFailure = error;
      return clean(error, 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
    });
  assert.deepEqual(publisherDiagnostic(statusFailure), Object.freeze({
    phase: 'PUT_STATUS',
    httpStatus: 403,
  }));

  let metadataFailure;
  await assert.rejects(() => r2Publisher(config(async request => {
    if (request.method === 'PUT') return new Response(null, { status: 200 });
    if (request.method === 'HEAD') return new Response(null, { headers: {
      ...publisherHeaders(),
      'x-amz-meta-nelyon-write-id': '0'.repeat(64),
    } });
    assert.fail('metadata failure must stop before GET');
  })).publishBySha256(SHA, BYTES), error => {
    metadataFailure = error;
    return clean(error, 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  });
  assert.deepEqual(publisherDiagnostic(metadataFailure), Object.freeze({
    phase: 'READBACK_METADATA',
  }));

  let exhaustedFailure;
  await assert.rejects(() => r2Publisher({ ...config(async request => {
    if (request.method === 'PUT') throw new Error(MARKER);
    return new Response(null, { status: 404 });
  }), timeoutMs: 500 }).publishBySha256(SHA, BYTES), error => {
    exhaustedFailure = error;
    return clean(error, 'PRIVATE_AUTHORITY_PUBLISHER_INVALID');
  });
  assert.deepEqual(publisherDiagnostic(exhaustedFailure), Object.freeze({
    phase: 'READBACK_HEAD',
    httpStatus: 404,
    exhausted: true,
  }));

  const forged = new Error('Private authority publisher rejected');
  Object.defineProperty(forged, 'diagnostic', {
    value: { phase: 'PUT_STATUS', httpStatus: 403 },
    enumerable: true,
  });
  assert.equal(publisherDiagnostic(forged), undefined);
  for (const diagnostic of [publisherDiagnostic(statusFailure), publisherDiagnostic(metadataFailure),
    publisherDiagnostic(exhaustedFailure)]) {
    assert.equal(Object.isFrozen(diagnostic), true);
    assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC|synthetic-authority|cloudflarestorage|sha256/iu);
  }
});
