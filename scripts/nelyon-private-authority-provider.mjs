import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { AwsClient } from 'aws4fetch';

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VERSIONS = 64;
const MAX_MEMORY_BYTES = 16 * 1024 * 1024;
const MAX_STREAM_CHUNKS = 16_384;
const INVALID = Symbol('invalid');
const UNAVAILABLE = Symbol('unavailable');
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
  if (response.status !== 200) throw INVALID;
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') throw INVALID;
  const length = response.headers.get('content-length');
  if (typeof length !== 'string' || !/^[1-9][0-9]{0,6}$/.test(length)) throw INVALID;
  const size = Number(length);
  if (size > MAX_BYTES) throw INVALID;
  return size;
}

// Cancellation must never wait for a remote error body or a misbehaving stream.
function cancelBody(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* sanitized by caller */ }
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
    return Object.freeze({ async getBySha256(digest) {
      let timer;
      let reader;
      let body;
      const abort = new AbortController();
      const expiresAt = performance.now() + timeoutMs;
      const checkDeadline = () => {
        if (abort.signal.aborted || performance.now() >= expiresAt) {
          abort.abort();
          throw INVALID;
        }
      };
      try {
        checkDigest(digest);
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(INVALID); }, timeoutMs);
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
          const head = await request('HEAD');
          body = head.body;
          checkDeadline();
          const size = contentLength(head);
          cancelBody(body);
          body = null;
          const get = await request('GET');
          body = get.body;
          checkDeadline();
          if (contentLength(get) !== size || !body) throw INVALID;
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
          if (received !== size || sha256(bytes) !== digest) throw INVALID;
          checkDeadline();
          return bytes;
        };
        // One race for the entire operation: successful reads do not attach
        // additional reactions to a shared pending deadline promise.
        return await Promise.race([operation(), deadline]);
      } catch (reason) {
        throw failure(reason);
      } finally {
        clearTimeout(timer);
        abort.abort();
        if (reader) {
          try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* no remote diagnostics */ }
        } else cancelBody(body);
      }
    } });
  } catch (reason) { throw failure(reason); }
}
