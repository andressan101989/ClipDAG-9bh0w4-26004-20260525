import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn, setTimeout as delay } from 'node:timers/promises';
import { AwsClient } from 'aws4fetch';

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VERSIONS = 64;
const MAX_MEMORY_BYTES = 16 * 1024 * 1024;
const MAX_STREAM_CHUNKS = 16_384;
const READBACK_DELAYS_MS = Object.freeze([0, 25, 100]);
const INVALID = Symbol('invalid');
const UNAVAILABLE = Symbol('unavailable');
const TRANSIENT = Symbol('transient');
const detailedR2Readers = new WeakMap();
const detailedR2Failures = new WeakMap();
const publisherDiagnostics = new WeakMap();
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const setBytes = Uint8Array.prototype.set;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function failure(reason) {
  const unavailable = reason === UNAVAILABLE;
  const message = unavailable ? 'Private authority version unavailable' : 'Private authority provider rejected';
  const error = new Error(message);
  error.code = unavailable ? 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE' : 'PRIVATE_AUTHORITY_PROVIDER_INVALID';
  error.stack = `Error: ${message}`;
  return Object.freeze(error);
}

function publisherFailure(diagnostic = null) {
  const message = 'Private authority publisher rejected';
  const error = new Error(message);
  error.code = 'PRIVATE_AUTHORITY_PUBLISHER_INVALID';
  error.stack = `Error: ${message}`;
  if (diagnostic) publisherDiagnostics.set(error, Object.freeze({ ...diagnostic }));
  return Object.freeze(error);
}

export function readR2PrivateAuthorityPublisherDiagnostic(error) {
  return publisherDiagnostics.get(error);
}

function detailedR2Failure(reason, phase, httpStatus = null) {
  const error = new Error('Private authority readback rejected');
  error.stack = 'Error: Private authority readback rejected';
  const diagnostic = { phase };
  if (['READBACK_HEAD', 'READBACK_GET'].includes(phase)
    && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
    diagnostic.httpStatus = httpStatus;
  }
  detailedR2Failures.set(error, Object.freeze({
    reason,
    retryable: reason !== INVALID,
    diagnostic: Object.freeze(diagnostic),
  }));
  return Object.freeze(error);
}

function checkDigest(value) {
  if (typeof value !== 'string' || !HEX64.test(value)) throw INVALID;
}

// Exclude Proxies before reflection and read own data descriptors only. No
// getters, inherited configuration, callbacks or string coercion are evaluated.
function ownData(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw INVALID;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
      || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) throw INVALID;
  }
  return descriptors;
}

function copyBytes(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(value))) throw INVALID;
  const size = byteLength.call(value);
  if (size < 1 || size > MAX_BYTES) throw INVALID;
  // Numeric typed-array properties cannot be accessors. Reject custom names
  // and symbols before Buffer.from can consult length/buffer/byteOffset.
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key))) throw INVALID;
  return Buffer.from(value);
}

/** Bounded synthetic/local provider. It retains independent byte copies, never
 * an alias or latest version; each returned value is another independent copy. */
export function createInMemoryPrivateAuthorityProvider(entries) {
  try {
    const data = ownData(entries);
    const keys = Object.keys(data);
    if (keys.length > MAX_VERSIONS) throw INVALID;
    const versions = new Map();
    let total = 0;
    for (const key of keys) {
      checkDigest(key);
      const bytes = copyBytes(data[key].value);
      total += bytes.length;
      if (total > MAX_MEMORY_BYTES || sha256(bytes) !== key) throw INVALID;
      versions.set(key, bytes);
    }
    return Object.freeze({ async getBySha256(digest) {
      try {
        checkDigest(digest);
        if (!versions.has(digest)) throw UNAVAILABLE;
        return Buffer.from(versions.get(digest));
      } catch (reason) { throw failure(reason); }
    } });
  } catch (reason) { throw failure(reason); }
}

function configuration(options) {
  const data = ownData(options);
  const required = ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey', 'fetch'];
  const keys = Object.keys(data);
  if (required.some(key => !Object.hasOwn(data, key))
    || keys.some(key => ![...required, 'timeoutMs'].includes(key))) throw INVALID;
  const values = Object.fromEntries(keys.map(key => [key, data[key].value]));
  if (typeof values.accountId !== 'string' || !/^[0-9a-f]{32}$/.test(values.accountId)
    || typeof values.bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(values.bucket)
    || typeof values.fetch !== 'function' || types.isProxy(values.fetch)) throw INVALID;
  for (const key of ['accessKeyId', 'secretAccessKey']) {
    if (typeof values[key] !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(values[key])) throw INVALID;
  }
  if (!Object.hasOwn(values, 'timeoutMs')) values.timeoutMs = 10_000;
  if (!Number.isInteger(values.timeoutMs) || values.timeoutMs < 1 || values.timeoutMs > 60_000) throw INVALID;
  return values;
}

function contentLength(response) {
  if (response.status === 404) throw UNAVAILABLE;
  if ([408, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
    throw TRANSIENT;
  }
  if (response.status !== 200) throw INVALID;
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') throw INVALID;
  const length = response.headers.get('content-length');
  if (typeof length !== 'string' || !/^[1-9][0-9]{0,6}$/.test(length)) throw INVALID;
  const size = Number(length);
  if (size > MAX_BYTES) throw INVALID;
  return size;
}

function contentEtag(response) {
  const etag = response.headers.get('etag');
  if (typeof etag !== 'string' || !/^"[0-9a-f]{32}"$/.test(etag)) throw INVALID;
  return etag;
}

function contentMetadata(response, digest) {
  if (response.headers.get('content-type') !== 'application/json'
    || response.headers.get('x-amz-meta-nelyon-content-sha256') !== digest
    || response.headers.get('x-amz-meta-nelyon-write-id') !== digest) throw INVALID;
  return Object.freeze({
    contentType: 'application/json',
    contentSha256: digest,
    writeId: digest,
  });
}

// Cancellation must never wait for a remote error body or a misbehaving stream.
function cancelBody(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* sanitized by caller */ }
}

/** Protected read-only credential probe. It signs exactly one S3 HeadBucket
 * request and exposes no object, list, write, delete, fallback or retry API. */
export function createR2PrivateAuthorityAccessProbe(options) {
  try {
    const { accountId, bucket, accessKeyId, secretAccessKey, fetch: read, timeoutMs } = configuration(options);
    const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 0 });
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
    return Object.freeze({ async verify() {
      let timer;
      let body;
      let timedOut = false;
      const abort = new AbortController();
      try {
        const signed = await signer.sign(endpoint, {
          method: 'HEAD', signal: abort.signal, redirect: 'error', credentials: 'omit',
          headers: { 'accept-encoding': 'identity' },
        });
        const request = (async () => await read(signed))();
        request.then(response => {
          if (timedOut) cancelBody(response?.body);
        }, () => {});
        const response = await Promise.race([request, new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            abort.abort();
            reject(INVALID);
          }, timeoutMs);
        })]);
        body = response?.body;
        cancelBody(body);
        body = null;
        if (response?.status !== 200) throw INVALID;
        return Object.freeze({
          schemaVersion: 1,
          result: 'R2_RUNTIME_ACCESS_VERIFIED',
          operation: 'HeadBucket',
          bucket,
          status: 200,
        });
      } catch {
        throw failure(INVALID);
      } finally {
        clearTimeout(timer);
        abort.abort();
        cancelBody(body);
      }
    } });
  } catch {
    throw failure(INVALID);
  }
}

/** Real S3-compatible R2 reader, deliberately unconfigured. All configuration
 * and fetch are injected by a trusted caller. No environment/credential loader,
 * candidate endpoint, list, retry, write or delete API exists. JSON parsing is
 * a separate boundary, after these exact bytes pass SHA-256 verification. */
export function createR2PrivateAuthorityProvider(options) {
  try {
    const { accountId, bucket, accessKeyId, secretAccessKey, fetch: read, timeoutMs } = configuration(options);
    const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 0 });
    const prefix = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/internal/release-authority/v1/sha256/`;
    const readBySha256 = async (digest, detailed, operationTimeoutMs = timeoutMs) => {
      let timer;
      let reader;
      let body;
      let phase = 'READBACK_HEAD';
      let observedStatus = null;
      const abort = new AbortController();
      if (!Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > timeoutMs) {
        throw failure(INVALID);
      }
      const expiresAt = performance.now() + operationTimeoutMs;
      const checkDeadline = () => {
        if (abort.signal.aborted || performance.now() >= expiresAt) {
          abort.abort();
          throw INVALID;
        }
      };
      try {
        checkDigest(digest);
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(TRANSIENT); }, operationTimeoutMs);
        });
        const request = async method => {
          checkDeadline();
          const signed = await signer.sign(`${prefix}${digest}.json`, {
            method, signal: abort.signal, redirect: 'error', credentials: 'omit',
            headers: { 'accept-encoding': 'identity' },
          });
          checkDeadline();
          const response = await read(signed);
          // A transport ignoring AbortSignal may resolve after our deadline.
          // Discard its body and never progress to another request.
          try { checkDeadline(); } catch (reason) { cancelBody(response.body); throw reason; }
          return response;
        };
        const operation = async () => {
          phase = 'READBACK_HEAD';
          const head = await request('HEAD');
          observedStatus = head.status;
          body = head.body;
          checkDeadline();
          const size = contentLength(head);
          phase = 'READBACK_METADATA';
          const etag = detailed ? contentEtag(head) : null;
          const metadata = detailed ? contentMetadata(head, digest) : null;
          cancelBody(body);
          body = null;
          phase = 'READBACK_GET';
          observedStatus = null;
          const get = await request('GET');
          observedStatus = get.status;
          body = get.body;
          checkDeadline();
          if (contentLength(get) !== size || !body) throw INVALID;
          if (detailed) {
            phase = 'READBACK_METADATA';
            if (contentEtag(get) !== etag) throw INVALID;
            const getMetadata = contentMetadata(get, digest);
            if (getMetadata.contentType !== metadata.contentType
              || getMetadata.contentSha256 !== metadata.contentSha256
              || getMetadata.writeId !== metadata.writeId) throw INVALID;
          }
          phase = 'READBACK_BYTES';
          reader = body.getReader();
          const bytes = Buffer.alloc(size);
          let received = 0;
          let chunks = 0;
          for (;;) {
            checkDeadline();
            const { done, value } = await reader.read();
            checkDeadline();
            if (done) break;
            // Enforce processing and byte bounds before copying any chunk.
            // Empty chunks cannot make unbounded progress without bytes.
            if (++chunks > MAX_STREAM_CHUNKS || !types.isUint8Array(value) || types.isProxy(value)) throw INVALID;
            const length = byteLength.call(value);
            received += length;
            if (length === 0 || received > size || received > MAX_BYTES) throw INVALID;
            // The intrinsic typed-array copy uses internal slots, without
            // consulting a chunk's length, valueOf, iterator or other getters.
            setBytes.call(bytes, value, received - length);
            if (chunks % 128 === 0) {
              await yieldTurn();
              checkDeadline();
            }
          }
          if (received !== size) throw INVALID;
          phase = 'READBACK_DIGEST';
          if (sha256(bytes) !== digest) throw INVALID;
          checkDeadline();
          return detailed ? Object.freeze({ bytes, etag, metadata }) : bytes;
        };
        // One race for the entire operation: successful reads do not attach
        // additional reactions to a shared pending deadline promise.
        return await Promise.race([operation(), deadline]);
      } catch (reason) {
        if (detailed) {
          if (detailedR2Failures.has(reason)) throw reason;
          throw detailedR2Failure(reason, phase, observedStatus);
        }
        throw failure(reason);
      } finally {
        clearTimeout(timer);
        abort.abort();
        if (reader) {
          try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* no remote diagnostics */ }
        } else cancelBody(body);
      }
    };
    const provider = Object.freeze({ getBySha256(digest) { return readBySha256(digest, false); } });
    detailedR2Readers.set(provider, (digest, operationTimeoutMs) => readBySha256(digest, true, operationTimeoutMs));
    return provider;
  } catch (reason) { throw failure(reason); }
}

/** Create-only R2 publisher for a reviewed, content-addressed authority object.
 *
 * Publication is deliberately narrower than the read provider: one signed PUT
 * with an If-None-Match precondition, followed by the existing exact HEAD+GET
 * reader. A transport error after dispatch is never retried; exact readback is
 * the only way to resolve that uncertain outcome. There is no list, overwrite,
 * delete, alternate key or endpoint API at this boundary. */
export function createR2PrivateAuthorityPublisher(options) {
  try {
    const { accountId, bucket, accessKeyId, secretAccessKey, fetch: write, timeoutMs } = configuration(options);
    const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 0 });
    const prefix = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/internal/release-authority/v1/sha256/`;
    const verifier = createR2PrivateAuthorityProvider({
      accountId, bucket, accessKeyId, secretAccessKey, fetch: write, timeoutMs,
    });
    const verifyDetailed = detailedR2Readers.get(verifier);
    if (typeof verifyDetailed !== 'function') throw INVALID;

    return Object.freeze({ async publishBySha256(digest, value) {
      let timer;
      let diagnostic = Object.freeze({ phase: 'PUT_PREPARATION' });
      const abort = new AbortController();
      try {
        checkDigest(digest);
        const bytes = copyBytes(value);
        if (sha256(bytes) !== digest) throw INVALID;

        const signed = await signer.sign(`${prefix}${digest}.json`, {
          method: 'PUT',
          body: bytes,
          signal: abort.signal,
          redirect: 'error',
          credentials: 'omit',
          headers: {
            'accept-encoding': 'identity',
            'content-length': String(bytes.length),
            'content-type': 'application/json',
            'if-none-match': '*',
            'x-amz-meta-nelyon-content-sha256': digest,
            'x-amz-meta-nelyon-write-id': digest,
          },
        });

        diagnostic = Object.freeze({ phase: 'PUT_TRANSPORT' });
        let dispatched = false;
        let timedOut = false;
        const put = (async () => {
          dispatched = true;
          return await write(signed);
        })();
        // If the transport ignores AbortSignal and completes after our timeout,
        // discard its body. Its late status is never allowed to change the
        // already-uncertain outcome or cause another PUT.
        put.then(response => {
          if (timedOut) {
            try { cancelBody(response.body); } catch { /* no remote diagnostics */ }
          }
        }, () => {});

        let disposition;
        try {
          const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              abort.abort();
              reject(UNAVAILABLE);
            }, timeoutMs);
          });
          const response = await Promise.race([put, deadline]);
          clearTimeout(timer);
          timer = undefined;
          cancelBody(response.body);
          if (response.status === 200) disposition = 'CREATED';
          else if (response.status === 412) disposition = 'ALREADY_EXISTS';
          else if ([408, 429].includes(response.status)
            || (response.status >= 500 && response.status <= 599)) disposition = 'UNCERTAIN_WRITE_VERIFIED';
          else {
            diagnostic = Object.freeze({ phase: 'PUT_STATUS', httpStatus: response.status });
            throw INVALID;
          }
        } catch (reason) {
          if (reason === INVALID || !dispatched) throw INVALID;
          diagnostic = Object.freeze({ phase: 'PUT_TRANSPORT' });
          disposition = 'UNCERTAIN_WRITE_VERIFIED';
        } finally {
          clearTimeout(timer);
          abort.abort();
        }

        const readbackDeadline = performance.now() + timeoutMs;
        let verified;
        let lastReadbackDiagnostic = null;
        for (let attempt = 0; attempt < READBACK_DELAYS_MS.length; attempt += 1) {
          const waitMs = READBACK_DELAYS_MS[attempt];
          if (waitMs > 0) {
            const remainingBeforeDelay = readbackDeadline - performance.now();
            if (remainingBeforeDelay <= waitMs) break;
            await delay(waitMs);
          }
          const remaining = Math.ceil(readbackDeadline - performance.now());
          if (remaining < 1) break;
          try {
            verified = await verifyDetailed(digest, Math.min(timeoutMs, remaining));
            break;
          } catch (reason) {
            const detail = detailedR2Failures.get(reason);
            if (!detail) {
              diagnostic = Object.freeze({ phase: 'READBACK_BYTES' });
              throw INVALID;
            }
            lastReadbackDiagnostic = detail.diagnostic;
            diagnostic = detail.diagnostic;
            if (!detail.retryable) throw INVALID;
          }
        }
        if (!verified) {
          diagnostic = Object.freeze({ ...(lastReadbackDiagnostic || { phase: 'READBACK_HEAD' }),
            exhausted: true });
          throw INVALID;
        }
        const { bytes: observed, etag } = verified;
        diagnostic = Object.freeze({ phase: 'READBACK_BYTES' });
        if (observed.length !== bytes.length || !observed.equals(bytes)) throw INVALID;
        return Object.freeze({
          schemaVersion: 1,
          result: disposition,
          sha256: digest,
          byteLength: bytes.length,
          key: `internal/release-authority/v1/sha256/${digest}.json`,
          etag,
          readback: 'HEAD_GET_EXACT',
        });
      } catch {
        throw publisherFailure(diagnostic);
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    } });
  } catch {
    throw publisherFailure();
  }
}
