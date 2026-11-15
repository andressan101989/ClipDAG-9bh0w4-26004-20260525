import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { parseB2PrivateAuthority } from './nelyon-private-authority.mjs';

const PHASE = 'web-control-centers-b2';
const HEX64 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const OPTIONS = ['descriptorBytes', 'expectedDescriptorSha256', 'phase', 'transitionId',
  'baselineSha', 'reviewedSourceSha', 'integrationBaseSha', 'requestedAt',
  'authorityJson', 'expectedPrivateAuthoritySha256'];
const RECEIPT_KEYS = ['schemaVersion', 'authorityId', 'descriptorSha256', 'publicContractSha256',
  'privateAuthoritySha256', 'bindingSha256', 'successorCatalogSha256',
  'securityAdvisorSha256', 'backupSha256', 'approvalSha256', 'verified'];
const contexts = new WeakSet();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayGetter = key => Object.getOwnPropertyDescriptor(typedArrayPrototype, key).get;
const arrayBufferOf = typedArrayGetter('buffer');
const byteOffsetOf = typedArrayGetter('byteOffset');
const byteLengthOf = typedArrayGetter('byteLength');

function reject(receipt = false) {
  const message = receipt ? 'Authority receipt mismatch' : 'Release authority context rejected';
  const error = new Error(message);
  error.code = receipt ? 'AUTHORITY_RECEIPT_MISMATCH' : 'RELEASE_AUTHORITY_CONTEXT_INVALID';
  error.stack = `Error: ${message}`;
  throw Object.freeze(error);
}

const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

// Inspect descriptors only after excluding Proxies. Never invoke getters,
// toJSON, coercion or callbacks supplied by a caller, including on arrays.
function ownData(value, array = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Array.isArray(value) !== array
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || UNSAFE.has(key) || !Object.hasOwn(descriptor, 'value')
      || (!descriptor.enumerable && !(array && key === 'length'))) reject();
  }
  return descriptors;
}

function exact(value, keys) {
  const descriptors = ownData(value);
  const actual = Object.keys(descriptors);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) reject();
  return descriptors;
}

function descriptorText(value, expectedSha256) {
  if (!matches(expectedSha256, HEX64)) reject();
  let bytes;
  if (typeof value === 'string') {
    if (value.length > 2 * 1024 * 1024) reject();
    bytes = Buffer.from(value, 'utf8');
  } else {
    if (types.isProxy(value) || !types.isUint8Array(value)) reject();
    // Intrinsic accessors avoid shadowed buffer/offset/length getters, custom
    // iterators, subclasses' species constructors and caller coercion.
    const length = Reflect.apply(byteLengthOf, value, []);
    if (length > 2 * 1024 * 1024) reject();
    bytes = Buffer.from(new Uint8Array(Reflect.apply(arrayBufferOf, value, []),
      Reflect.apply(byteOffsetOf, value, []), length));
  }
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024
    || hash(bytes) !== expectedSha256) reject();
  // The independent exact-byte digest is checked before JSON or descriptor
  // semantics are parsed. Reject invalid UTF-8 rather than replacing bytes.
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || (typeof value === 'string' && text !== value)) reject();
  return text;
}

function uniqueJsonKeys(text) {
  // JSON.parse has already validated syntax. Tokenize strings atomically so
  // punctuation inside values cannot affect object boundaries. Decode keys to
  // detect both literal duplicates and equivalent escaped spellings.
  const stack = [];
  for (const match of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],]/gu)) {
    const token = match[0];
    if (token === '{') stack.push({ keys: new Set(), keyNext: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') {
      if (stack.at(-1)) stack.at(-1).keyNext = true;
    } else if (stack.at(-1)?.keyNext) {
      const object = stack.at(-1);
      const key = JSON.parse(token);
      if (object.keys.has(key)) reject();
      object.keys.add(key);
      object.keyNext = false;
    }
  }
}

function copiedJson(value, budget = { nodes: 0, bytes: 0, seen: new Set() }, depth = 0) {
  if (++budget.nodes > 50_000 || depth > 48) reject();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > 2 * 1024 * 1024 || Buffer.from(value, 'utf8').toString('utf8') !== value) reject();
    return value;
  }
  const array = Array.isArray(value);
  const descriptors = ownData(value, array);
  if (budget.seen.has(value)) reject();
  budget.seen.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      if (length > 50_000 || Object.keys(descriptors).length !== length + 1) reject();
      const result = [];
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(descriptors, i)) reject();
        result.push(copiedJson(descriptors[i].value, budget, depth + 1));
      }
      return Object.freeze(result);
    }
    const result = {};
    for (const key of Object.keys(descriptors)) {
      budget.bytes += Buffer.byteLength(key, 'utf8');
      if (budget.bytes > 2 * 1024 * 1024) reject();
      result[key] = copiedJson(descriptors[key].value, budget, depth + 1);
    }
    return Object.freeze(result);
  } finally {
    budget.seen.delete(value);
  }
}

// Same byte contract as release canonicalJson(): recursively sorted JSON,
// array order preserved, and exactly one trailing LF. Inputs are copied JSON.
function canonicalJson(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
    }
    return item;
  }
  return `${JSON.stringify(normalize(value))}\n`;
}

/**
 * Pure B2 boundary authenticating the dedicated descriptor's exact bytes before
 * parsing semantics. Both expected digests must come from independent trusted
 * control-plane inputs, never a candidate. Optional publicPolicySha256 is scalar
 * provenance only; no historical public policy object is accepted or retained.
 * No provider, environment, checkout, callback, filesystem or network is read.
 */
export function createReleaseAuthorityContext(options) {
  try {
    const data = ownData(options);
    const keys = Object.keys(data);
    if (OPTIONS.some(key => !Object.hasOwn(data, key))
      || keys.some(key => !OPTIONS.includes(key) && key !== 'publicPolicySha256')) reject();
    const input = Object.fromEntries(keys.map(key => [key, data[key].value]));
    if (input.phase !== PHASE
      || (Object.hasOwn(input, 'publicPolicySha256') && !matches(input.publicPolicySha256, HEX64))
      || !matches(input.expectedPrivateAuthoritySha256, HEX64)
      || ![input.baselineSha, input.reviewedSourceSha, input.integrationBaseSha].every(value => matches(value, SHA40))
      || typeof input.transitionId !== 'string' || input.transitionId.length === 0) reject();
    const text = descriptorText(input.descriptorBytes, input.expectedDescriptorSha256);
    const decoded = JSON.parse(text);
    uniqueJsonKeys(text);
    const descriptor = copiedJson(decoded);
    const descriptorSha256 = input.expectedDescriptorSha256;
    exact(descriptor, ['schema_version', 'contract', 'public_contract_sha256', 'private_authority']);
    const privateDescriptor = descriptor.private_authority;
    exact(privateDescriptor, ['required', 'schema_version', 'authority_id', 'sha256']);
    if (descriptor.schema_version !== 1 || privateDescriptor.required !== true
      || privateDescriptor.schema_version !== 1 || typeof privateDescriptor.authority_id !== 'string'
      || !matches(descriptor.public_contract_sha256, HEX64)
      || privateDescriptor.sha256 !== input.expectedPrivateAuthoritySha256) reject();
    const contract = descriptor.contract;
    ownData(contract);
    const publicContractSha256 = hash(canonicalJson(contract));
    if (publicContractSha256 !== descriptor.public_contract_sha256
      || contract.id !== input.transitionId || contract.to_phase !== input.phase
      || contract.baseline_sha !== input.baselineSha
      || contract.reviewed_source_sha !== input.reviewedSourceSha
      || contract.integration_base_sha !== input.integrationBaseSha) reject();
    const parsed = parseB2PrivateAuthority(input.authorityJson,
      input.expectedPrivateAuthoritySha256, input.requestedAt);
    const authority = parsed.authority;
    if (authority.authorityId !== privateDescriptor.authority_id
      || authority.publicContractSha256 !== publicContractSha256 || authority.phase !== input.phase
      || authority.issuedFor.baselineSha !== input.baselineSha
      || authority.issuedFor.reviewedSourceSha !== input.reviewedSourceSha
      || authority.issuedFor.integrationBaseSha !== input.integrationBaseSha) reject();
    const bindingSha256 = hash(canonicalJson({ schemaVersion: 1, authorityId: authority.authorityId,
      transitionId: contract.id, baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
      publicContractSha256, descriptorSha256, privateAuthoritySha256: parsed.sha256 }));
    // Construct scalars from scratch: no private object, prototype, symbol,
    // closure or back-reference can be reached through the public receipt.
    const receipt = Object.freeze({ schemaVersion: 1, authorityId: authority.authorityId, descriptorSha256,
      publicContractSha256, privateAuthoritySha256: parsed.sha256, bindingSha256,
      successorCatalogSha256: hash(canonicalJson(authority.successorCatalog)),
      securityAdvisorSha256: hash(canonicalJson(authority.securityAdvisor)),
      backupSha256: hash(canonicalJson(authority.backup)), approvalSha256: hash(canonicalJson(authority.approval)),
      verified: true });
    const context = { descriptor, descriptorSha256,
      privateAuthoritySha256: parsed.sha256, publicContractSha256, receipt };
    if (Object.hasOwn(input, 'publicPolicySha256')) context.publicPolicySha256 = input.publicPolicySha256;
    Object.defineProperty(context, 'privateAuthority', { value: authority, enumerable: false });
    Object.freeze(context);
    contexts.add(context);
    return context;
  } catch {
    reject();
  }
}

/** Only contexts minted by this boundary may supply a public projection. */
export function publicAuthorityReceipt(context) {
  if (!contexts.has(context)) reject();
  return context.receipt;
}

function receiptData(receipt) {
  const descriptors = exact(receipt, RECEIPT_KEYS);
  if (descriptors.schemaVersion.value !== 1 || descriptors.verified.value !== true) reject();
  const id = descriptors.authorityId.value;
  if (typeof id !== 'string' || Buffer.byteLength(id, 'utf8') < 1 || Buffer.byteLength(id, 'utf8') > 128
    || id.normalize('NFC') !== id || Buffer.from(id, 'utf8').toString('utf8') !== id
    || /[\u0000-\u001f\u007f-\u009f]/u.test(id)) reject();
  for (const key of RECEIPT_KEYS.slice(2, -1)) if (!matches(descriptors[key].value, HEX64)) reject();
  return descriptors;
}

/**
 * Exact closed-shape/value comparison, independent of JSON key insertion order.
 * The caller must anchor one receipt in a verified context or authenticated
 * historical evidence; comparing two receipts does not authenticate their source.
 */
export function assertAuthorityReceiptMatch(expected, actual) {
  try {
    const left = receiptData(expected);
    const right = receiptData(actual);
    if (RECEIPT_KEYS.some(key => left[key].value !== right[key].value)) reject();
    return true;
  } catch {
    reject(true);
  }
}
