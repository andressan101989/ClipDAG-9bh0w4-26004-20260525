import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { TextDecoder, types } from 'node:util';

import {
  buildPrivateRuntimeClosureFromExactBytes,
  privateRuntimeClosureMemberPaths,
} from './nelyon-private-runtime-closure.mjs';
import {
  b2FunctionManifestSha256,
  canonicalB2FunctionDeploymentProof,
  resumeB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentProof,
} from './nelyon-b2-function-deployment-proof.mjs';

const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const WORKFLOW = '.github/workflows/nelyon-production-release.yml';
const API_ORIGIN = 'https://api.github.com';
const B2_DESCRIPTOR_PATH = '.github/nelyon-web-control-centers-b2-release-descriptor.json';
const ERROR_CODE = 'B2_RECOVERY_PROVENANCE_INVALID';
const ERROR_MESSAGE = 'B2 recovery provenance rejected';
const HEX64 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_PROOF_BYTES = 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_ITEMS = PAGE_SIZE * MAX_PAGES;

const approvedSources = new WeakMap();
const approvedOutputs = new WeakMap();
const provenances = new WeakMap();
const provenanceOutputs = new WeakMap();
const historicalClosures = new WeakMap();
const historicalClosureOutputs = new WeakMap();
const chainProvenances = new WeakMap();
const chainOutputs = new WeakMap();

function reject() {
  const error = new Error(ERROR_MESSAGE);
  error.code = ERROR_CODE;
  error.stack = `Error: ${ERROR_MESSAGE}`;
  throw Object.freeze(error);
}

function ownData(value, array = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) !== array
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || UNSAFE_KEYS.has(key) || !Object.hasOwn(descriptor, 'value')
      || (!descriptor.enumerable && !(array && key === 'length'))) reject();
  }
  return descriptors;
}

function exact(value, keys) {
  const descriptors = ownData(value);
  const actual = Object.keys(descriptors);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) reject();
  return Object.fromEntries(actual.map(key => [key, descriptors[key].value]));
}

function arrayValues(value, maximum = MAX_ITEMS) {
  const descriptors = ownData(value, true);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum
    || Object.keys(descriptors).length !== length + 1) reject();
  const output = [];
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(descriptors, index)) reject();
    output.push(descriptors[index].value);
  }
  return output;
}

function strictTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject();
  return Date.parse(value);
}

function githubBoundaryTime(value, boundary) {
  if (typeof value !== 'string') reject();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    strictTime(value);
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || !Number.isFinite(Date.parse(value))) reject();
  const milliseconds = Date.parse(value) + (boundary === 'end' ? 999 : 0);
  const normalized = new Date(milliseconds).toISOString();
  if (normalized.replace(/\.\d{3}Z$/u, 'Z') !== value) reject();
  return normalized;
}

function text(value, minimum = 1, maximum = 256) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < minimum
    || Buffer.byteLength(value, 'utf8') > maximum || Buffer.from(value, 'utf8').toString('utf8') !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) reject();
  return value;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}

function canonical(value) {
  return `${JSON.stringify(normalize(value))}\n`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function copyJson(value, budget = { nodes: 0, bytes: 0 }, depth = 0) {
  if (++budget.nodes > 50_000 || depth > 48) reject();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAX_JSON_BYTES || Buffer.from(value, 'utf8').toString('utf8') !== value) reject();
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(arrayValues(value, 50_000).map(item => copyJson(item, budget, depth + 1)));
  const descriptors = ownData(value);
  const output = {};
  for (const key of Object.keys(descriptors)) {
    budget.bytes += Buffer.byteLength(key, 'utf8');
    if (budget.bytes > MAX_JSON_BYTES) reject();
    output[key] = copyJson(descriptors[key].value, budget, depth + 1);
  }
  return Object.freeze(output);
}

function uniqueJsonKeys(source) {
  const stack = [];
  for (const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],]/gu)) {
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

function strictUtf8(bytes, maximum) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximum) reject();
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(); }
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) reject();
  return decoded;
}

function parseJsonBytes(bytes, maximum = MAX_JSON_BYTES) {
  const source = strictUtf8(bytes, maximum);
  uniqueJsonKeys(source);
  let value;
  try { value = JSON.parse(source); } catch { reject(); }
  return { source, value: copyJson(value) };
}

function requireHex64(value) {
  if (typeof value !== 'string' || !HEX64.test(value)) reject();
  return value;
}

function requirePositiveIntegerString(value) {
  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)
    || !Number.isSafeInteger(Number(value))) reject();
  return value;
}

function validateArtifact(value, expectedName) {
  const artifact = exact(value, ['id', 'name', 'digest']);
  requirePositiveIntegerString(artifact.id);
  if (artifact.name !== expectedName || artifact.digest !== `sha256:${artifact.digest.slice(7)}`
    || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) reject();
  return deepFreeze({ id: artifact.id, name: artifact.name, digest: artifact.digest });
}

function validateMigration(value) {
  const migration = exact(value, ['blob', 'name']);
  if (typeof migration.blob !== 'string' || !SHA40.test(migration.blob)
    || typeof migration.name !== 'string' || !/^\d{14}_[a-z0-9_]+$/.test(migration.name)) reject();
  return deepFreeze(migration);
}

function validateEdgeFunction(value) {
  const edge = exact(value, ['name', 'source_sha256', 'status', 'verify_jwt', 'version']);
  text(edge.name, 1, 128);
  requireHex64(edge.source_sha256);
  if (edge.status !== 'ACTIVE' || typeof edge.verify_jwt !== 'boolean'
    || !Number.isSafeInteger(edge.version) || edge.version < 1) reject();
  return deepFreeze(edge);
}

function validateEdgeState(value) {
  const state = exact(value, ['source_sha256', 'status', 'verify_jwt', 'version']);
  requireHex64(state.source_sha256);
  if (state.status !== 'ACTIVE' || typeof state.verify_jwt !== 'boolean'
    || !Number.isSafeInteger(state.version) || state.version < 1) reject();
  return deepFreeze(state);
}

function validateEdgeTransition(value) {
  const transition = exact(value, ['name', 'from', 'to']);
  text(transition.name, 1, 128);
  transition.from = validateEdgeState(transition.from);
  transition.to = validateEdgeState(transition.to);
  if (transition.from.version >= transition.to.version) reject();
  return deepFreeze(transition);
}

const SOURCE_KEYS = [
  'run_id', 'run_attempt', 'release_id', 'source_sha', 'repository', 'mutation_status',
  'post_snapshot_status', 'postcheck_status', 'gate_artifact', 'release_artifact',
  'manifest_sha256', 'pre_snapshot_evidence_sha256', 'post_snapshot_evidence_sha256',
  'expected_migrations', 'expected_migration_count', 'expected_latest_migration',
  'edge_functions', 'productive_resources', 'premium_relation_security_sha256',
  'premium_legacy', 'protected_stage_proof_sha256', 'runtime_closure_sha256',
];

function validateApprovedSource(value, repository) {
  const descriptors = ownData(value);
  const keys = Object.keys(descriptors);
  if (SOURCE_KEYS.some(key => !Object.hasOwn(descriptors, key))
    || keys.some(key => !SOURCE_KEYS.includes(key) && key !== 'edge_transitions')) reject();
  const source = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  requirePositiveIntegerString(source.run_id);
  if (!Number.isSafeInteger(source.run_attempt) || source.run_attempt < 1) reject();
  text(source.release_id, 1, 160);
  if (typeof source.source_sha !== 'string' || !SHA40.test(source.source_sha)
    || source.repository !== repository || source.mutation_status !== 'completed'
    || ![['success', 'success'], ['success', 'failure'], ['failure', 'skipped']].some(([post, check]) => (
      source.post_snapshot_status === post && source.postcheck_status === check))) reject();
  source.gate_artifact = validateArtifact(source.gate_artifact,
    `nelyon-gate-evidence-${source.run_id}-${source.run_attempt}`);
  source.release_artifact = validateArtifact(source.release_artifact,
    `nelyon-release-${source.run_id}-${source.run_attempt}`);
  for (const key of ['manifest_sha256', 'pre_snapshot_evidence_sha256', 'premium_relation_security_sha256',
    'protected_stage_proof_sha256', 'runtime_closure_sha256']) requireHex64(source[key]);
  if (source.post_snapshot_evidence_sha256 !== null) requireHex64(source.post_snapshot_evidence_sha256);
  source.expected_migrations = Object.freeze(arrayValues(source.expected_migrations, 100).map(validateMigration));
  if (!Number.isSafeInteger(source.expected_migration_count) || source.expected_migration_count < 1
    || typeof source.expected_latest_migration !== 'string'
    || (source.expected_migrations.length > 0
      && source.expected_latest_migration !== source.expected_migrations.at(-1).name)) reject();
  source.edge_functions = Object.freeze(arrayValues(source.edge_functions, 100).map(validateEdgeFunction));
  if (Object.hasOwn(source, 'edge_transitions')) {
    source.edge_transitions = Object.freeze(arrayValues(source.edge_transitions, 100).map(validateEdgeTransition));
  }
  source.productive_resources = Object.freeze(arrayValues(source.productive_resources, 200).map(item => text(item, 1, 512)));
  const premium = exact(source.premium_legacy, ['content_count', 'pending_review_count', 'deleted_count']);
  if (Object.values(premium).some(item => !Number.isSafeInteger(item) || item < 0)) reject();
  source.premium_legacy = deepFreeze(premium);
  return deepFreeze(source);
}

function approvedSourceState(value) {
  const state = approvedSources.get(value);
  if (!state || approvedOutputs.get(value) !== canonical(value)) reject();
  return state;
}

/** Parse independently pinned authorization bytes into the existing source brand.
 * The protected caller must also validate the supplied policy through loadPolicy. */
export function loadB2RecoveryAuthorization(options) {
  try {
    const input = exact(options, ['authorizationBytes', 'expectedAuthorizationSha256', 'policyBytes',
      'expectedPolicySha256', 'runId', 'runAttempt']);
    for (const [bytes, digest] of [[input.authorizationBytes, input.expectedAuthorizationSha256],
      [input.policyBytes, input.expectedPolicySha256]]) {
      if (!Buffer.isBuffer(bytes) || types.isProxy(bytes) || !HEX64.test(digest ?? '') || hash(bytes) !== digest) reject();
    }
    const runId = requirePositiveIntegerString(input.runId);
    if (input.runAttempt !== null && (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1)) reject();
    const parsed = parseJsonBytes(Buffer.from(input.authorizationBytes));
    if (canonical(parsed.value) !== parsed.source) reject();
    const doc = exact(parsed.value, ['schema_version', 'kind', 'repository', 'workflow_path', 'policy_sha256', 'approved_sources']);
    if (doc.schema_version !== 1 || doc.kind !== 'nelyon-b2-exact-attempt-recovery-v1'
      || doc.repository !== REPOSITORY || doc.workflow_path !== WORKFLOW
      || doc.policy_sha256 !== input.expectedPolicySha256) reject();
    const policy = parseJsonBytes(Buffer.from(input.policyBytes)).value;
    const policyRoot = ownData(policy);
    if (policyRoot.repository?.value !== REPOSITORY || policyRoot.workflow_path?.value !== WORKFLOW) reject();
    const recovery = exact(policyRoot.postcheck_recovery?.value, ['approved_sources']);
    const legacyIds = new Set(arrayValues(recovery.approved_sources, 100).map(item => ownData(item).run_id?.value));
    const ids = new Set();
    const runIds = new Set();
    let previousRun = 0n;
    let selected;
    for (const raw of arrayValues(doc.approved_sources, 64)) {
      const entry = exact(raw, ['source', 'admin_artifact', 'postcheck_chain']);
      const source = validateApprovedSource(entry.source, REPOSITORY);
      const numericRun = BigInt(source.run_id);
      if (numericRun <= previousRun || legacyIds.has(source.run_id) || runIds.has(source.run_id)) reject();
      previousRun = numericRun;
      runIds.add(source.run_id);
      const artifacts = [source.gate_artifact, source.release_artifact];
      const admin = entry.admin_artifact === null ? null : validateArtifact(entry.admin_artifact,
        `nelyon-admin-evidence-${source.run_id}-${source.run_attempt}`);
      if (admin) artifacts.push(admin);
      let chain = null;
      if (entry.postcheck_chain !== null) {
        const c = exact(entry.postcheck_chain, ['run_id', 'run_attempt', 'release_id', 'source_sha', 'manifest_sha256',
          'runtime_closure_sha256', 'release_artifact', 'gate_artifact', 'recovery_artifact']);
        requirePositiveIntegerString(c.run_id);
        if (!Number.isSafeInteger(c.run_attempt) || c.run_attempt < 1 || runIds.has(c.run_id) || legacyIds.has(c.run_id)
          || !SHA40.test(c.source_sha ?? '')) reject();
        runIds.add(c.run_id);
        text(c.release_id, 1, 160);
        requireHex64(c.manifest_sha256); requireHex64(c.runtime_closure_sha256);
        c.release_artifact = validateArtifact(c.release_artifact, `nelyon-release-${c.run_id}-${c.run_attempt}`);
        c.gate_artifact = validateArtifact(c.gate_artifact, `nelyon-gate-evidence-${c.run_id}-${c.run_attempt}`);
        c.recovery_artifact = validateArtifact(c.recovery_artifact, `nelyon-postcheck-recovery-${c.run_id}-${c.run_attempt}`);
        artifacts.push(c.release_artifact, c.gate_artifact, c.recovery_artifact);
        chain = deepFreeze(c);
      }
      for (const artifact of artifacts) { if (ids.has(artifact.id)) reject(); ids.add(artifact.id); }
      const matchingAttempt = source.run_id === runId ? source.run_attempt : chain?.run_id === runId ? chain.run_attempt : null;
      if (matchingAttempt !== null && (input.runAttempt === null || matchingAttempt === input.runAttempt)) {
        if (selected) reject();
        selected = { source, admin, chain, selectedAttempt: matchingAttempt };
      }
    }
    if (!selected) reject();
    const output = deepFreeze({ schemaVersion: 1, result: 'APPROVED_SOURCE_AUTHENTICATED', runId,
      runAttempt: selected.selectedAttempt });
    approvedSources.set(output, { policySha256: input.expectedPolicySha256,
      authorizationSha256: input.expectedAuthorizationSha256, ...selected });
    approvedOutputs.set(output, canonical(output));
    return output;
  } catch { reject(); }
}

/**
 * Authenticate one exact B2 recovery source from protected policy bytes.
 * The selector cannot supply source identity or digests.
 */
export function loadApprovedB2RecoverySource(options) {
  try {
    const input = exact(options, ['policyBytes', 'expectedPolicySha256', 'runId', 'runAttempt']);
    if (!Buffer.isBuffer(input.policyBytes) || types.isProxy(input.policyBytes)
      || !HEX64.test(input.expectedPolicySha256 ?? '')
      || hash(input.policyBytes) !== input.expectedPolicySha256) reject();
    const runId = requirePositiveIntegerString(input.runId);
    if (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) reject();
    const { value: policy } = parseJsonBytes(Buffer.from(input.policyBytes));
    const root = ownData(policy);
    if (root.schema_version?.value !== 2 || root.repository?.value !== REPOSITORY
      || root.workflow_path?.value !== WORKFLOW || !root.postcheck_recovery) reject();
    const recovery = exact(root.postcheck_recovery.value, ['approved_sources']);
    const candidates = arrayValues(recovery.approved_sources, 100).filter(source => {
      const descriptors = ownData(source);
      return descriptors.run_id?.value === runId && descriptors.run_attempt?.value === input.runAttempt;
    });
    if (candidates.length !== 1) reject();
    const selected = validateApprovedSource(candidates[0], REPOSITORY);
    const output = deepFreeze({ schemaVersion: 1, result: 'APPROVED_SOURCE_AUTHENTICATED', runId, runAttempt: input.runAttempt });
    approvedSources.set(output, { policySha256: input.expectedPolicySha256, source: selected });
    approvedOutputs.set(output, canonical(output));
    return output;
  } catch { reject(); }
}

function validateFactoryOptions(options) {
  const input = exact(options, ['fetchImpl', 'githubToken', 'repository', 'workflowPath', 'apiOrigin']);
  if (typeof input.fetchImpl !== 'function' || types.isProxy(input.fetchImpl)
    || input.repository !== REPOSITORY || input.workflowPath !== WORKFLOW) reject();
  text(input.githubToken, 1, 512);
  let origin;
  try { origin = new URL(input.apiOrigin); } catch { reject(); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash || origin.origin !== input.apiOrigin.replace(/\/$/, '')) reject();
  return { ...input, apiOrigin: origin.origin };
}

async function readResponseBytes(response, maximum) {
  if (!response || typeof response !== 'object' || response.status !== 200 || response.ok !== true) reject();
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined
    && (!/^\d+$/.test(declared) || Number(declared) > maximum)) reject();
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (!part || typeof part.done !== 'boolean') reject();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) reject();
        length += part.value.byteLength;
        if (length > maximum) reject();
        chunks.push(Buffer.from(part.value));
      }
    } finally { try { reader.releaseLock(); } catch { /* no diagnostic escape */ } }
    const bytes = Buffer.concat(chunks, length);
    if (declared != null && Number(declared) !== bytes.length) reject();
    return bytes;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximum || (declared != null && Number(declared) !== bytes.length)) reject();
  return bytes;
}

async function request(fetchImpl, token, url, maximum, accept) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'user-agent': 'nelyon-private-authority-runtime-v1',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { reject(); }
  return readResponseBytes(response, maximum);
}

async function requestJson(fetchImpl, token, url) {
  const bytes = await request(fetchImpl, token, url, MAX_JSON_BYTES, 'application/vnd.github+json');
  return parseJsonBytes(bytes).value;
}

async function paginated({ fetchImpl, token, base, field }) {
  const output = [];
  let expectedTotal = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const value = await requestJson(fetchImpl, token, `${base}?per_page=${PAGE_SIZE}&page=${page}`);
    const record = exact(value, ['total_count', field]);
    if (!Number.isSafeInteger(record.total_count) || record.total_count < 0 || record.total_count > MAX_ITEMS) reject();
    if (expectedTotal === null) expectedTotal = record.total_count;
    if (expectedTotal !== record.total_count) reject();
    const items = arrayValues(record[field], PAGE_SIZE);
    output.push(...items);
    if (output.length > expectedTotal) reject();
    if (output.length === expectedTotal) return output;
    if (items.length < PAGE_SIZE) {
      reject();
    }
  }
  reject();
}

function validateRun(value, source) {
  const data = ownData(value);
  const get = key => data[key]?.value;
  const repository = get('repository');
  const repositoryData = ownData(repository);
  if (String(get('id')) !== source.run_id || get('run_attempt') !== source.run_attempt
    || get('status') !== 'completed' || get('conclusion') !== 'failure'
    || get('event') !== 'workflow_dispatch' || get('head_sha') !== source.source_sha
    || get('path') !== WORKFLOW || repositoryData.full_name?.value !== REPOSITORY) reject();
  return deepFreeze({
    id: source.run_id,
    runAttempt: source.run_attempt,
    status: 'completed',
    conclusion: 'failure',
    event: 'workflow_dispatch',
    headSha: source.source_sha,
    path: WORKFLOW,
    repository: REPOSITORY,
  });
}

function selectArtifacts(values, source, admin = null) {
  const ids = new Set();
  for (const item of values) {
    const data = ownData(item);
    const id = data.id?.value;
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) reject();
    ids.add(id);
  }
  const selected = {};
  for (const kind of ['gate', 'release']) {
    const expected = source[`${kind}_artifact`];
    const matches = values.filter(value => ownData(value).name?.value === expected.name);
    if (matches.length !== 1) reject();
    const actual = ownData(matches[0]);
    if (String(actual.id?.value) !== expected.id || actual.name?.value !== expected.name
      || actual.digest?.value !== expected.digest || actual.expired?.value !== false) reject();
    selected[kind] = expected;
  }
  if (admin) {
    const matches = values.filter(value => ownData(value).name?.value === admin.name);
    if (matches.length !== 1) reject();
    const actual = ownData(matches[0]);
    if (String(actual.id?.value) !== admin.id || actual.digest?.value !== admin.digest
      || actual.expired?.value !== false) reject();
    selected.admin = admin;
  }
  return deepFreeze(selected);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  reject();
}

const ADMIN_ARCHIVE_FILES = Object.freeze([
  'admin-web-manifest.json', 'admin-web-manifest.sha256', 'admin-web-build.json', 'admin-web-previous.json',
  'admin-web-before-routes.json', 'admin-web-preview-before.json', 'admin-web-preview-enabled.json',
  'admin-web-preview-closed.json', 'admin-web-candidate.json', 'admin-web-preview-http.json',
  'admin-web-promoted-version.json', 'admin-web-after-routes.json', 'admin-web-production-http.json',
  'admin-web-release-result.json', 'admin-web-recovered-routes.json', 'admin-web-recovered-deployment.json',
  'admin-web-recovery.json',
]);
const RELEASE_ARCHIVE_FILES = Object.freeze(['auto-deploy-evidence.json', 'remote-evidence.json', 'request.json',
  'bundle/manifest.json', 'bundle/manifest.sha256', 'bundle/summary.md']);
const GATE_ARCHIVE_FILES = Object.freeze(['protected-stage-proofs.json', 'gate-proof.json', 'migration-dry-run.json',
  'function-deployment-proof.json',
  'postcheck-result.json', 'pre-function-revalidation.json', 'pre-migration-revalidation.json',
  'pre-snapshot-verification.json', 'revalidation.json', 'release-observation.json']);
const CHAIN_RECOVERY_FILES = Object.freeze(['postcheck-recovery-result.json', 'production-recovery.json', 'verified-source.json']);

function extractArchiveFiles(archive, allowed = null) {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) reject();
  const end = findEndOfCentralDirectory(archive);
  if (archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0
    || archive.readUInt16LE(end + 20) !== 0) reject();
  const diskEntries = archive.readUInt16LE(end + 8);
  const totalEntries = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);
  if (diskEntries !== totalEntries || totalEntries < 1 || totalEntries > 64
    || centralOffset + centralSize !== end || centralOffset > archive.length) reject();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = new Map();
  let totalBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) reject();
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const crc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || (flags & 1) !== 0 || ![0, 8].includes(method)
      || compressedSize > MAX_ARCHIVE_BYTES || uncompressedSize > MAX_PROOF_BYTES
      || ((externalAttributes >>> 16) & 0xf000) === 0xa000) reject();
    let name;
    try { name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength)); } catch { reject(); }
    if (!name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')
      || (!allowed && name.includes('/'))
      || files.has(name) || (allowed && !allowed.includes(name))) reject();
    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) reject();
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || dataOffset + compressedSize > centralOffset) reject();
    if (!archive.subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .equals(archive.subarray(offset + 46, offset + 46 + nameLength))) reject();
    let bytes;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    try { bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_PROOF_BYTES }); }
    catch { reject(); }
    totalBytes += bytes.length;
    if (bytes.length !== uncompressedSize || crc32(bytes) !== crc || totalBytes > MAX_ARCHIVE_BYTES) reject();
    files.set(name, bytes);
    offset = next;
  }
  if (offset !== end) reject();
  return files;
}

function extractProofBytes(archive) {
  const files = extractArchiveFiles(archive);
  if (!files.has('protected-stage-proofs.json')) reject();
  return files.get('protected-stage-proofs.json');
}

const RECEIPT_KEYS = ['schemaVersion', 'authorityId', 'descriptorSha256', 'publicContractSha256',
  'privateAuthoritySha256', 'bindingSha256', 'successorCatalogSha256', 'securityAdvisorSha256',
  'backupSha256', 'approvalSha256', 'verified'];

function validateReceipt(value) {
  const receipt = exact(value, RECEIPT_KEYS);
  if (receipt.schemaVersion !== 1 || receipt.verified !== true) reject();
  text(receipt.authorityId, 1, 128);
  for (const key of RECEIPT_KEYS.slice(2, -1)) requireHex64(receipt[key]);
  return deepFreeze(receipt);
}

function validateProofs(proofBytes, source) {
  if (hash(proofBytes) !== source.protected_stage_proof_sha256) reject();
  const parsed = parseJsonBytes(proofBytes, MAX_PROOF_BYTES);
  if (canonical(parsed.value) !== parsed.source) reject();
  const values = arrayValues(parsed.value, 5);
  const expectedStages = ['migrations', 'functions', 'admin_upload', 'admin_promote', 'admin_route'];
  if (values.length < 1 || values.length > expectedStages.length) reject();
  return Object.freeze(values.map((value, index) => {
    const proof = exact(value, ['runId', 'runAttempt', 'releaseId', 'approvedSha', 'manifestSha256', 'stage', 'verifiedAt', 'receipt']);
    if (proof.runId !== source.run_id || proof.runAttempt !== source.run_attempt
      || proof.releaseId !== source.release_id || proof.approvedSha !== source.source_sha
      || proof.manifestSha256 !== source.manifest_sha256 || proof.stage !== expectedStages[index]) reject();
    strictTime(proof.verifiedAt);
    proof.receipt = validateReceipt(proof.receipt);
    return deepFreeze(proof);
  }));
}

function validateProtectedSteps(jobs, source, proofs) {
  const jobIds = new Set();
  const candidates = [];
  for (const job of jobs) {
    const data = ownData(job);
    const id = data.id?.value;
    if (!Number.isSafeInteger(id) || id < 1 || jobIds.has(id)
      || String(data.run_id?.value) !== source.run_id || data.run_attempt?.value !== source.run_attempt) reject();
    jobIds.add(id);
    const steps = arrayValues(data.steps?.value, MAX_ITEMS);
    for (const step of steps) {
      const stepData = ownData(step);
      const name = stepData.name?.value;
      if (typeof name === 'string' && name.startsWith('B2 protected ')) candidates.push(stepData);
    }
  }
  const output = [];
  for (const proof of proofs) {
    const name = `B2 protected ${proof.stage}`;
    const matches = candidates.filter(step => step.name?.value === name);
    if (matches.length !== 1) reject();
    const step = matches[0];
    if (step.status?.value !== 'completed' || step.conclusion?.value !== 'success') reject();
    const startedAt = githubBoundaryTime(step.started_at?.value, 'start');
    const completedAt = githubBoundaryTime(step.completed_at?.value, 'end');
    if (strictTime(startedAt) > strictTime(proof.verifiedAt)
      || strictTime(proof.verifiedAt) > strictTime(completedAt)) reject();
    output.push(deepFreeze({ name, conclusion: 'success', startedAt, completedAt }));
  }
  if (candidates.length !== output.length) reject();
  return deepFreeze({
    runId: source.run_id,
    runAttempt: source.run_attempt,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    approvedSha: source.source_sha,
    steps: Object.freeze(output),
  });
}

function provenanceState(value) {
  const state = provenances.get(value);
  if (!state || provenanceOutputs.get(value) !== canonical(value)) reject();
  return state;
}

/** Assert module-private provenance branding without exposing its proof body. */
export function assertTrustedB2RecoveryProvenance(value) {
  provenanceState(value);
  return value;
}

/**
 * Trusted in-process accessor for the release verifier. Candidate objects cannot
 * pass the brand check. Returned proof bytes are an independent copy.
 */
export function readTrustedB2RecoveryProvenance(value) {
  const state = provenanceState(value);
  return Object.freeze({
    source: state.source,
    run: state.run,
    artifacts: state.artifacts,
    protectedSteps: state.protectedSteps,
    proofs: state.proofs,
    expectedProofSha256: state.source.protected_stage_proof_sha256,
    proofBytes: Buffer.from(state.proofBytes),
    functionDeploymentProofSha256: state.functionDeploymentProofSha256,
    sourceRuntimeClosureSha256: state.source.runtime_closure_sha256,
    authorizationSha256: state.authorizationSha256,
    policySha256: state.policySha256,
    adminArtifact: state.adminArtifact,
    adminFileDigests: state.adminFileDigests,
    releaseFileDigests: state.releaseFileDigests,
    gateFileDigests: state.gateFileDigests,
  });
}

/** Return only the already authenticated Edge deployment checkpoint. The
 * caller receives a detached copy so recovery cannot mutate provenance state. */
export function readTrustedB2RecoveryFunctionDeploymentProof(value) {
  const state = provenanceState(value);
  return state.functionDeploymentProof === null ? null : structuredClone(state.functionDeploymentProof);
}

export function readTrustedB2ChainProvenance(value, recoveryProvenance) {
  const state = chainProvenances.get(value);
  if (!state || state.recoveryProvenance !== recoveryProvenance || chainOutputs.get(value) !== canonical(value)) reject();
  provenanceState(recoveryProvenance);
  return Object.freeze({ chain: state.chain, fileDigests: state.fileDigests });
}

export function readTrustedB2RecoveryStagingFiles(recoveryProvenance, chainProvenance) {
  const state = provenanceState(recoveryProvenance);
  if (!state.authorizationSha256 || !state.releaseFiles || !state.gateFiles) reject();
  const copy = files => Object.fromEntries([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const run = { id: state.source.run_id, run_attempt: state.source.run_attempt, status: 'completed',
    conclusion: 'failure', event: 'workflow_dispatch', head_branch: 'main', head_sha: state.source.source_sha,
    path: WORKFLOW, repository: { full_name: REPOSITORY } };
  const artifacts = Object.values(state.artifacts).map(item => ({ ...item, expired: false }));
  let chain = null;
  if (state.selectedRunId !== state.source.run_id) {
    readTrustedB2ChainProvenance(chainProvenance, recoveryProvenance);
    const verified = chainProvenances.get(chainProvenance);
    chain = { run: verified.run, artifacts: verified.artifacts,
      release: copy(verified.files.release), gate: copy(verified.files.gate), recovery: copy(verified.files.recovery) };
  } else if (chainProvenance != null) reject();
  return { run, artifacts, release: copy(state.releaseFiles), gate: copy(state.gateFiles),
    admin: state.adminFiles ? copy(state.adminFiles) : null, chain };
}

function historicalClosureState(value, recoveryProvenance) {
  const state = historicalClosures.get(value);
  if (!state || state.recoveryProvenance !== recoveryProvenance
    || historicalClosureOutputs.get(value) !== canonical(value)) reject();
  provenanceState(recoveryProvenance);
  return state;
}

export function readTrustedB2HistoricalRuntimeClosure(value, recoveryProvenance) {
  const state = historicalClosureState(value, recoveryProvenance);
  return Object.freeze({ sourceSha: state.sourceSha, closure: state.closure });
}

export function readTrustedB2HistoricalDescriptorBytes(value, recoveryProvenance) {
  const state = historicalClosureState(value, recoveryProvenance);
  return Buffer.from(state.descriptorBytes);
}

function decodeGitHubContent(value, expectedPath) {
  const data = ownData(value);
  const get = key => data[key]?.value;
  if (get('path') !== expectedPath || get('type') !== 'file' || get('encoding') !== 'base64'
    || typeof get('content') !== 'string' || !Number.isSafeInteger(get('size')) || get('size') < 0
    || typeof get('sha') !== 'string' || !SHA40.test(get('sha'))) reject();
  const encoded = get('content').replaceAll('\n', '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) reject();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== get('size') || bytes.toString('base64') !== encoded) reject();
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  if (createHash('sha1').update(header).update(bytes).digest('hex') !== get('sha')) reject();
  return bytes;
}

/**
 * Construct a fixed GitHub exact-attempt loader. Repository/workflow are always
 * production constants; a non-production API origin is reachable only through
 * this trusted in-process constructor for offline tests.
 */
export function createB2RecoveryProvenanceLoader(options = {
  fetchImpl: globalThis.fetch,
  githubToken: '',
  repository: REPOSITORY,
  workflowPath: WORKFLOW,
  apiOrigin: API_ORIGIN,
}) {
  let config;
  try { config = validateFactoryOptions(options); } catch { reject(); }
  const base = `${config.apiOrigin}/repos/${REPOSITORY}`;
  return Object.freeze({
    async loadExactAttempt(input) {
      try {
        const args = exact(input, ['approvedSource']);
        const approved = approvedSourceState(args.approvedSource);
        const source = approved.source;
        const runValue = await requestJson(config.fetchImpl, config.githubToken,
          `${base}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`);
        const run = validateRun(runValue, source);
        if (approved.authorizationSha256 && ownData(runValue).head_branch?.value !== 'main') reject();
        const jobs = await paginated({
          fetchImpl: config.fetchImpl,
          token: config.githubToken,
          base: `${base}/actions/runs/${source.run_id}/attempts/${source.run_attempt}/jobs`,
          field: 'jobs',
        });
        const artifactValues = await paginated({
          fetchImpl: config.fetchImpl,
          token: config.githubToken,
          base: `${base}/actions/runs/${source.run_id}/artifacts`,
          field: 'artifacts',
        });
        const artifacts = selectArtifacts(artifactValues, source, approved.admin);
        let adminFileDigests = null; let adminFiles = null;
        if (approved.admin) {
          const adminArchive = await request(config.fetchImpl, config.githubToken,
            `${base}/actions/artifacts/${approved.admin.id}/zip`, MAX_ARCHIVE_BYTES, 'application/vnd.github+json');
          if (`sha256:${hash(adminArchive)}` !== approved.admin.digest) reject();
          const files = extractArchiveFiles(adminArchive, ADMIN_ARCHIVE_FILES);
          if (!files.has('admin-web-manifest.json') || !files.has('admin-web-manifest.sha256')) reject();
          adminFileDigests = deepFreeze(Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])));
          adminFiles = files;
        }
        const archive = await request(config.fetchImpl, config.githubToken,
          `${base}/actions/artifacts/${source.gate_artifact.id}/zip`, MAX_ARCHIVE_BYTES, 'application/vnd.github+json');
        if (`sha256:${hash(archive)}` !== source.gate_artifact.digest) reject();
        let gateFileDigests = null; let releaseFileDigests = null; let gateFiles = null; let releaseFiles = null;
        gateFiles = extractArchiveFiles(archive, GATE_ARCHIVE_FILES);
        if (!gateFiles.has('protected-stage-proofs.json') || !gateFiles.has('release-observation.json')) reject();
        gateFileDigests = deepFreeze(Object.fromEntries([...gateFiles].map(([name, bytes]) => [name, hash(bytes)])));
        const releaseArchive = await request(config.fetchImpl, config.githubToken,
          `${base}/actions/artifacts/${source.release_artifact.id}/zip`, MAX_ARCHIVE_BYTES, 'application/vnd.github+json');
        if (`sha256:${hash(releaseArchive)}` !== source.release_artifact.digest) reject();
        const files = extractArchiveFiles(releaseArchive, RELEASE_ARCHIVE_FILES); releaseFiles = files;
        if (['bundle/manifest.json', 'bundle/manifest.sha256', 'bundle/summary.md', 'remote-evidence.json', 'request.json']
          .some(name => !files.has(name))) reject();
        releaseFileDigests = deepFreeze(Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])));
        const proofBytes = extractProofBytes(archive);
        const proofs = validateProofs(proofBytes, source);
        const protectedSteps = validateProtectedSteps(jobs, source, proofs);
        const functionDeploymentProofSha256 = proofs.some(proof => proof.stage === 'functions')
          ? gateFileDigests?.['function-deployment-proof.json'] ?? null
          : null;
        let functionDeploymentProof = null;
        if (proofs.some(proof => proof.stage === 'functions')) {
          if (!functionDeploymentProofSha256 || !gateFiles?.has('function-deployment-proof.json')
            || !releaseFiles?.has('bundle/manifest.json')) reject();
          const manifestParsed = parseJsonBytes(releaseFiles.get('bundle/manifest.json'));
          if (canonical(manifestParsed.value) !== manifestParsed.source) reject();
          const resources = ownData(manifestParsed.value).resources?.value;
          const transition = ownData(ownData(resources).web_control_centers_b2_transition?.value);
          const contract = ownData(transition.contract?.value);
          const functionManifest = arrayValues(contract.functions?.value, 8).map(item => copyJson(item));
          const functionBytes = gateFiles.get('function-deployment-proof.json');
          const functionParsed = parseJsonBytes(functionBytes);
          if (canonicalB2FunctionDeploymentProof(functionParsed.value) !== functionParsed.source) reject();
          const functionManifestSha256=b2FunctionManifestSha256(functionManifest);
          const postRows=source.edge_functions.map(row => ({ name: row.name, source_sha256: row.source_sha256,
            status: row.status, verify_jwt: row.verify_jwt, version: row.version }));
          const attempt=verifyB2FunctionDeploymentAttempt({proof:functionParsed.value,manifest:functionManifest,
            manifestSha256:functionManifestSha256});
          if(attempt.result==='FUNCTIONS_EXECUTED')verifyB2FunctionDeploymentProof({proof:attempt,manifest:functionManifest,
            manifestSha256:functionManifestSha256,postRows});
          else resumeB2FunctionDeploymentAttempt({proof:attempt,manifest:functionManifest,
            manifestSha256:functionManifestSha256,beforeRows:attempt.before,currentRows:postRows,
            capturedAt:new Date(Math.max(Date.parse(attempt.captured_at),Date.parse(attempt.in_flight?.captured_at??attempt.captured_at))+1).toISOString()});
          functionDeploymentProof = structuredClone(attempt);
        }
        const output = deepFreeze({
          schemaVersion: 1,
          result: 'EXACT_ATTEMPT_VERIFIED',
          repository: REPOSITORY,
          workflowPath: WORKFLOW,
          runId: source.run_id,
          runAttempt: source.run_attempt,
          sourceSha: source.source_sha,
          artifactDigests: deepFreeze({ gate: artifacts.gate.digest, release: artifacts.release.digest }),
          protectedStageProofSha256: source.protected_stage_proof_sha256,
          protectedStepCount: protectedSteps.steps.length,
          sourceRuntimeClosureSha256: source.runtime_closure_sha256,
          functionDeploymentProofSha256,
        });
        provenances.set(output, {
          source,
          run,
          artifacts,
          protectedSteps,
          proofs,
          proofBytes: Buffer.from(proofBytes),
          functionDeploymentProofSha256,
          functionDeploymentProof,
          authorizationSha256: approved.authorizationSha256 ?? null,
          policySha256: approved.policySha256,
          adminArtifact: approved.admin ?? null,
          adminFileDigests,
          releaseFileDigests, gateFileDigests,
          chain: approved.chain ?? null, selectedRunId: args.approvedSource.runId,
          adminFiles, releaseFiles, gateFiles,
        });
        provenanceOutputs.set(output, canonical(output));
        return output;
      } catch { reject(); }
    },
    async loadExactChain(input) {
      try {
        const args = exact(input, ['recoveryProvenance']);
        const state = provenanceState(args.recoveryProvenance);
        const chain = state.chain;
        if (!chain || state.selectedRunId !== chain.run_id || !state.authorizationSha256) reject();
        const runValue = await requestJson(config.fetchImpl, config.githubToken,
          `${base}/actions/runs/${chain.run_id}/attempts/${chain.run_attempt}`);
        const run = ownData(runValue);
        if (String(run.id?.value) !== chain.run_id || run.run_attempt?.value !== chain.run_attempt
          || run.status?.value !== 'completed' || run.conclusion?.value !== 'success'
          || run.event?.value !== 'workflow_dispatch' || run.head_branch?.value !== 'main' || run.head_sha?.value !== chain.source_sha
          || run.path?.value !== WORKFLOW || ownData(run.repository?.value).full_name?.value !== REPOSITORY) reject();
        const values = await paginated({ fetchImpl: config.fetchImpl, token: config.githubToken,
          base: `${base}/actions/runs/${chain.run_id}/artifacts`, field: 'artifacts' });
        const seen = new Set();
        for (const item of values) {
          const id = ownData(item).id?.value;
          if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) reject();
          seen.add(id);
        }
        const fileDigests = {}; const archiveFiles = {}; const artifactMetadata = [];
        let manifestBytes;
        for (const [kind, allowed, required] of [
          ['release', RELEASE_ARCHIVE_FILES, ['bundle/manifest.json', 'bundle/manifest.sha256', 'bundle/summary.md', 'remote-evidence.json', 'request.json']],
          ['gate', GATE_ARCHIVE_FILES, ['gate-proof.json']],
          ['recovery', CHAIN_RECOVERY_FILES, CHAIN_RECOVERY_FILES],
        ]) {
          const expected = chain[`${kind}_artifact`];
          const matches = values.filter(item => ownData(item).name?.value === expected.name);
          if (matches.length !== 1) reject();
          const actual = ownData(matches[0]);
          if (String(actual.id?.value) !== expected.id || actual.digest?.value !== expected.digest || actual.expired?.value !== false) reject();
          artifactMetadata.push({ ...expected, expired: false });
          const archive = await request(config.fetchImpl, config.githubToken,
            `${base}/actions/artifacts/${expected.id}/zip`, MAX_ARCHIVE_BYTES, 'application/vnd.github+json');
          if (`sha256:${hash(archive)}` !== expected.digest) reject();
          const extracted = extractArchiveFiles(archive, allowed);
          archiveFiles[kind] = extracted;
          if (required.some(name => !extracted.has(name))) reject();
          if (kind === 'release') manifestBytes = extracted.get('bundle/manifest.json');
          fileDigests[kind] = deepFreeze(Object.fromEntries([...extracted].map(([name, bytes]) => [name, hash(bytes)])));
        }
        if (hash(manifestBytes) !== chain.manifest_sha256) reject();
        const parsed = parseJsonBytes(manifestBytes);
        if (canonical(parsed.value) !== parsed.source) reject();
        const identity = ownData(ownData(parsed.value).identity?.value);
        if (identity.approved_sha?.value !== chain.source_sha || identity.mode?.value !== 'postcheck_recovery'
          || identity.run_id?.value !== chain.run_id || identity.run_attempt?.value !== chain.run_attempt
          || identity.release_id?.value !== chain.release_id) reject();
        const files = [];
        for (const member of privateRuntimeClosureMemberPaths()) {
          const value = await requestJson(config.fetchImpl, config.githubToken,
            `${base}/contents/${member.split('/').map(encodeURIComponent).join('/')}?ref=${chain.source_sha}`);
          files.push({ path: member, bytes: decodeGitHubContent(value, member) });
        }
        const closure = buildPrivateRuntimeClosureFromExactBytes({ files });
        if (closure.closure_sha256 !== chain.runtime_closure_sha256
          || canonical(ownData(parsed.value).runtime_closure?.value) !== canonical(closure)) reject();
        const output = deepFreeze({ schemaVersion: 1, result: 'EXACT_CHAIN_ATTEMPT_VERIFIED',
          runId: chain.run_id, runAttempt: chain.run_attempt });
        chainProvenances.set(output, Object.freeze({ recoveryProvenance: args.recoveryProvenance, chain,
          fileDigests: deepFreeze(fileDigests), files: archiveFiles,
          run: { id: chain.run_id, run_attempt: chain.run_attempt, status: 'completed', conclusion: 'success',
            event: 'workflow_dispatch', head_branch: 'main', head_sha: chain.source_sha,
            path: WORKFLOW, repository: { full_name: REPOSITORY } }, artifacts: artifactMetadata }));
        chainOutputs.set(output, canonical(output));
        return output;
      } catch { reject(); }
    },
    async loadHistoricalRuntimeClosure(input) {
      try {
        const args = exact(input, ['recoveryProvenance']);
        const state = provenanceState(args.recoveryProvenance);
        const files = [];
        for (const member of privateRuntimeClosureMemberPaths()) {
          const encodedPath = member.split('/').map(encodeURIComponent).join('/');
          const value = await requestJson(config.fetchImpl, config.githubToken,
            `${base}/contents/${encodedPath}?ref=${state.source.source_sha}`);
          files.push({ path: member, bytes: decodeGitHubContent(value, member) });
        }
        const descriptorValue = await requestJson(config.fetchImpl, config.githubToken,
          `${base}/contents/${B2_DESCRIPTOR_PATH.split('/').map(encodeURIComponent).join('/')}?ref=${state.source.source_sha}`);
        const descriptorBytes = decodeGitHubContent(descriptorValue, B2_DESCRIPTOR_PATH);
        const closure = buildPrivateRuntimeClosureFromExactBytes({ files });
        if (closure.closure_sha256 !== state.source.runtime_closure_sha256) reject();
        const output = deepFreeze({ schemaVersion: 1, result: 'HISTORICAL_RUNTIME_CLOSURE_VERIFIED',
          sourceSha: state.source.source_sha, closureSha256: closure.closure_sha256 });
        historicalClosures.set(output, { recoveryProvenance: args.recoveryProvenance,
          sourceSha: state.source.source_sha, closure, descriptorBytes: Buffer.from(descriptorBytes) });
        historicalClosureOutputs.set(output, canonical(output));
        return output;
      } catch { reject(); }
    },
  });
}
