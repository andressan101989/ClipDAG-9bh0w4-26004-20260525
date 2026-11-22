import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { TextDecoder, types } from 'node:util';

import {
  buildFunctionContracts,
  buildFunctionGraph,
  canonicalJson,
  parseFunctionConfig,
} from './nelyon-production-release.mjs';
import { verifyB2AuthorityObservation } from './nelyon-production-snapshot-adapter.mjs';
import {
  B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256,
  B2_ADVISOR_CHANGED_OBJECT_IDENTITIES,
  B2_AUTHORITY_EDGE_FUNCTION_SCOPE,
  computeB2AdvisorAuthorizations,
  normalizeB2SuccessorCatalogFromDisposableEvidence,
  runB2ReviewedAuthorityEvidenceProofs,
  verifyB2AdvisorAuthorizationClaims,
} from './nelyon-b2-authority-preparation.mjs';
import { parseB2PrivateAuthority } from './nelyon-private-authority.mjs';
import {
  buildPrivateRuntimeClosureFromExactBytes,
  privateRuntimeClosureMemberPaths,
} from './nelyon-private-runtime-closure.mjs';

const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const WORKFLOW = '.github/workflows/nelyon-production-release.yml';
const OWNER = 'andressan101989';
const API_ORIGIN = 'https://api.github.com';
export const B2_AUTHORITY_INTEGRATION_BASE_SHA = '109395035d13ba3db8d338dc3b2524191defe873';
const HEX64 = /^[0-9a-f]{64}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const observationCapabilities = new WeakMap();
const approvalCapabilities = new WeakMap();
const preparationCapabilities = new WeakMap();

function reject() {
  const error = new Error('B2 authority issuance blocked');
  error.code = 'B2_AUTHORITY_ISSUANCE_BLOCKED';
  error.stack = 'Error: B2 authority issuance blocked';
  throw Object.freeze(error);
}

function plain(value, array = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) !== array
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  return value;
}

function exact(value, keys) {
  plain(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) reject();
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) reject();
  }
  return value;
}

function text(value, pattern, maximum = 512) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 1
    || Buffer.byteLength(value, 'utf8') > maximum || !pattern.test(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) reject();
  return value;
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function githubTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) reject();
  const normalized = new Date(value).toISOString();
  if (normalized.replace('.000Z', 'Z') !== value && normalized !== value) reject();
  return normalized;
}

function positiveIntegerString(value) {
  if (typeof value !== 'string' && typeof value !== 'number') reject();
  const string = typeof value === 'string' ? value : `${value}`;
  if (!POSITIVE_INTEGER.test(string) || !Number.isSafeInteger(Number(string))) reject();
  return string;
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
}

function uniqueJsonKeys(source) {
  const stack = [];
  for (const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],]/gu)) {
    const token = match[0];
    if (token === '{') stack.push({ keys: new Set(), keyNext: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (stack.at(-1)) stack.at(-1).keyNext = true; }
    else if (stack.at(-1)?.keyNext) {
      const key = JSON.parse(token);
      if (stack.at(-1).keys.has(key)) reject();
      stack.at(-1).keys.add(key);
      stack.at(-1).keyNext = false;
    }
  }
  if (stack.length !== 0) reject();
}

function parseJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_JSON_BYTES) reject();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(); }
  if (!Buffer.from(source, 'utf8').equals(bytes)) reject();
  uniqueJsonKeys(source);
  let value;
  try { value = JSON.parse(source); } catch { reject(); }
  return plain(value);
}

async function responseBytes(response, maximum) {
  if (!response || typeof response !== 'object' || response.ok !== true || response.status !== 200) reject();
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined
    && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) reject();
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); } catch { reject(); }
  if (bytes.length < 1 || bytes.length > maximum || (declared != null && Number(declared) !== bytes.length)) reject();
  return bytes;
}

async function request(fetchImpl, token, url, maximum, accept) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000),
      headers: { accept, authorization: `Bearer ${token}`, 'user-agent': 'nelyon-b2-authority-issuer-v1',
        'x-github-api-version': '2022-11-28' } });
  } catch { reject(); }
  return responseBytes(response, maximum);
}

async function jsonRequest(fetchImpl, token, url) {
  return parseJson(await request(fetchImpl, token, url, MAX_JSON_BYTES, 'application/vnd.github+json'));
}

async function paginate({ fetchImpl, token, url, field }) {
  const values = [];
  let total = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const body = await jsonRequest(fetchImpl, token, `${url}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    if (!Number.isSafeInteger(body.total_count) || body.total_count < 0
      || body.total_count > MAX_PAGES * PAGE_SIZE || !Array.isArray(body[field])) reject();
    if (total === null) total = body.total_count;
    if (body.total_count !== total || body[field].length > PAGE_SIZE) reject();
    values.push(...body[field]);
    if (values.length === total) return values;
    if (values.length > total || body[field].length !== PAGE_SIZE) reject();
  }
  reject();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function extractObservation(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) reject();
  let end = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0
    || archive.readUInt16LE(end + 8) !== 1 || archive.readUInt16LE(end + 10) !== 1
    || archive.readUInt16LE(end + 20) !== 0) reject();
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);
  if (centralOffset + centralSize !== end || centralSize < 46
    || archive.readUInt32LE(centralOffset) !== 0x02014b50) reject();
  const flags = archive.readUInt16LE(centralOffset + 8);
  const method = archive.readUInt16LE(centralOffset + 10);
  const crc = archive.readUInt32LE(centralOffset + 16);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
  const nameLength = archive.readUInt16LE(centralOffset + 28);
  const extraLength = archive.readUInt16LE(centralOffset + 30);
  const commentLength = archive.readUInt16LE(centralOffset + 32);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method) || uncompressedSize > MAX_JSON_BYTES
    || centralOffset + 46 + nameLength + extraLength + commentLength !== end || localOffset !== 0
    || localOffset + 30 > centralOffset
    || archive.readUInt32LE(localOffset) !== 0x04034b50) reject();
  const name = new TextDecoder('utf-8', { fatal: true }).decode(
    archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
  const localNameLength = archive.readUInt16LE(localOffset + 26);
  const localExtraLength = archive.readUInt16LE(localOffset + 28);
  const streamed = (flags & 0x0008) !== 0;
  if (name !== 'observation.json' || archive.readUInt16LE(localOffset + 6) !== flags
    || archive.readUInt16LE(localOffset + 8) !== method || localNameLength !== nameLength
    || (!streamed && (archive.readUInt32LE(localOffset + 14) !== crc
      || archive.readUInt32LE(localOffset + 18) !== compressedSize
      || archive.readUInt32LE(localOffset + 22) !== uncompressedSize))
    || (streamed && (archive.readUInt32LE(localOffset + 14) !== 0
      || archive.readUInt32LE(localOffset + 18) !== 0
      || archive.readUInt32LE(localOffset + 22) !== 0))) reject();
  const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength);
  if (!localName.equals(Buffer.from(name, 'utf8'))) reject();
  const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
  const payloadEnd = payloadStart + compressedSize;
  if (payloadEnd > centralOffset) reject();
  if (streamed) {
    const descriptorLength = centralOffset - payloadEnd;
    const descriptorOffset = descriptorLength === 16 ? payloadEnd + 4 : payloadEnd;
    if (![12, 16].includes(descriptorLength)
      || (descriptorLength === 16 && archive.readUInt32LE(payloadEnd) !== 0x08074b50)
      || archive.readUInt32LE(descriptorOffset) !== crc
      || archive.readUInt32LE(descriptorOffset + 4) !== compressedSize
      || archive.readUInt32LE(descriptorOffset + 8) !== uncompressedSize) reject();
  } else if (payloadEnd !== centralOffset) reject();
  let bytes;
  try {
    const compressed = archive.subarray(payloadStart, payloadEnd);
    bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_JSON_BYTES });
  } catch { reject(); }
  if (bytes.length !== uncompressedSize || crc32(bytes) !== crc) reject();
  return bytes;
}

function validateIdentityRun(run, { runId, approvedSha, completed, displayTitle = null }) {
  plain(run);
  const repository = plain(run.repository);
  const actor = plain(run.actor);
  const triggeringActor = plain(run.triggering_actor);
  if (positiveIntegerString(run.id) !== runId || run.run_attempt !== 1
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || run.head_sha !== approvedSha
    || run.path !== WORKFLOW || repository.full_name !== REPOSITORY
    || actor.login !== OWNER || triggeringActor.login !== OWNER
    || positiveIntegerString(actor.id) !== positiveIntegerString(triggeringActor.id)
    || (completed ? (run.status !== 'completed' || run.conclusion !== 'success')
      : (run.status !== 'in_progress' || run.conclusion !== null))
    || (displayTitle !== null && run.display_title !== displayTitle)) reject();
  return { actor: { login: actor.login, id: positiveIntegerString(actor.id) },
    triggeringActor: { login: triggeringActor.login, id: positiveIntegerString(triggeringActor.id) },
    createdAt: githubTime(run.created_at) };
}

function validateJob(jobs, { id, runId, name, approvedSha, completed }) {
  const matches = jobs.filter(job => job?.name === name);
  if (matches.length !== 1) reject();
  const job = plain(matches[0]);
  if (positiveIntegerString(job.id) !== positiveIntegerString(id ?? job.id)
    || positiveIntegerString(job.run_id) !== runId || job.run_attempt !== 1 || job.head_sha !== approvedSha
    || (completed ? (job.status !== 'completed' || job.conclusion !== 'success')
      : (job.status !== 'in_progress' || job.conclusion !== null))) reject();
  return positiveIntegerString(job.id);
}

function capabilityState(map, capability) {
  const state = map.get(capability);
  if (!state) reject();
  return state;
}

export function computeB2AuthorityPreissuance(value) {
  exact(value, ['repository', 'workflowPath', 'approvedSha', 'approvedTreeSha', 'publicContractSha256',
    'manifestSha256', 'policySha256', 'baselineSha', 'runtimeClosureSha256', 'observationSha256']);
  if (value.repository !== REPOSITORY || value.workflowPath !== WORKFLOW || !SHA40.test(value.approvedSha)
    || !SHA40.test(value.approvedTreeSha) || !SHA40.test(value.baselineSha)
    || [value.publicContractSha256, value.manifestSha256, value.policySha256,
      value.runtimeClosureSha256, value.observationSha256].some(item => !HEX64.test(item))) reject();
  const contract = Object.freeze({ schemaVersion: 1, operation: 'web-control-centers-b2-authority-issue', ...value });
  return Object.freeze({ contract, preissuanceSha256: digest(canonicalBytes(contract)) });
}

export function createB2AuthorityIssuanceGithubObserver(options) {
  exact(options, ['fetchImpl', 'githubToken', 'repository', 'workflowPath', 'apiOrigin']);
  if (typeof options.fetchImpl !== 'function' || types.isProxy(options.fetchImpl)
    || options.repository !== REPOSITORY || options.workflowPath !== WORKFLOW
    || options.apiOrigin !== API_ORIGIN) reject();
  text(options.githubToken, /^[\x21-\x7e]+$/u, 2048);
  const base = `${API_ORIGIN}/repos/${REPOSITORY}`;
  const fetchImpl = options.fetchImpl;
  const token = options.githubToken;
  return Object.freeze({
    async authenticateObservation(input) {
      exact(input, ['runId', 'runAttempt', 'approvedSha', 'approvedTreeSha', 'expectedObservationSha256']);
      const runId = positiveIntegerString(input.runId);
      if (input.runAttempt !== 1 || !SHA40.test(input.approvedSha) || !SHA40.test(input.approvedTreeSha)
        || !HEX64.test(input.expectedObservationSha256)) reject();
      const repository = await jsonRequest(fetchImpl, token, base);
      const owner = plain(repository.owner);
      if (owner.login !== OWNER) reject();
      const ownerId = positiveIntegerString(owner.id);
      const run = await jsonRequest(fetchImpl, token, `${base}/actions/runs/${runId}/attempts/1`);
      const runIdentity = validateIdentityRun(run, { runId, approvedSha: input.approvedSha, completed: true });
      if (runIdentity.actor.id !== ownerId || runIdentity.triggeringActor.id !== ownerId) reject();
      const commit = await jsonRequest(fetchImpl, token, `${base}/git/commits/${input.approvedSha}`);
      if (commit.sha !== input.approvedSha || commit.tree?.sha !== input.approvedTreeSha) reject();
      const jobs = await paginate({ fetchImpl, token,
        url: `${base}/actions/runs/${runId}/attempts/1/jobs`, field: 'jobs' });
      const jobId = validateJob(jobs, { runId, name: 'Observe fresh B2 backup and Vault/Edge parity',
        approvedSha: input.approvedSha, completed: true });
      const artifacts = await paginate({ fetchImpl, token, url: `${base}/actions/runs/${runId}/artifacts`,
        field: 'artifacts' });
      const expectedName = `nelyon-b2-authority-observation-${runId}`;
      const matches = artifacts.filter(artifact => artifact?.name === expectedName);
      if (matches.length !== 1) reject();
      const artifact = plain(matches[0]);
      const artifactId = positiveIntegerString(artifact.id);
      if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1
        || artifact.size_in_bytes > MAX_ARCHIVE_BYTES || artifact.expired !== false
        || typeof artifact.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(artifact.digest)
        || artifact.workflow_run?.id !== Number(runId) || artifact.workflow_run?.head_branch !== 'main'
        || artifact.workflow_run?.head_sha !== input.approvedSha) reject();
      const archive = await request(fetchImpl, token, `${base}/actions/artifacts/${artifactId}/zip`,
        MAX_ARCHIVE_BYTES, 'application/zip');
      if (archive.length !== artifact.size_in_bytes || `sha256:${digest(archive)}` !== artifact.digest) reject();
      const observationBytes = extractObservation(archive);
      const observation = parseJson(observationBytes);
      if (!canonicalBytes(observation).equals(observationBytes)) reject();
      verifyB2AuthorityObservation(observation);
      if (observation.observationSha256 !== input.expectedObservationSha256
        || observation.approvedSha !== input.approvedSha || observation.approvedTreeSha !== input.approvedTreeSha
        || observation.repository !== REPOSITORY) reject();
      const capability = Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_AUTHORITY_OBSERVATION' });
      observationCapabilities.set(capability, Object.freeze({ observation, runId, runAttempt: 1,
        jobId, runCreatedAt: runIdentity.createdAt, actor: runIdentity.actor,
        triggeringActor: runIdentity.triggeringActor, artifact: Object.freeze({ id: artifactId, name: expectedName,
          digest: artifact.digest, bytes: archive.length, observationBytes: observationBytes.length }) }));
      return capability;
    },

    async authenticateOwnerApproval(input) {
      exact(input, ['runId', 'runAttempt', 'approvedSha', 'approvedTreeSha', 'releaseId',
        'preissuanceSha256', 'observation']);
      const observation = capabilityState(observationCapabilities, input.observation);
      const runId = positiveIntegerString(input.runId);
      if (input.runAttempt !== 1 || input.approvedSha !== observation.observation.approvedSha
        || input.approvedTreeSha !== observation.observation.approvedTreeSha
        || !HEX64.test(input.preissuanceSha256)
        || input.releaseId !== `b2-authority-${input.preissuanceSha256}`) reject();
      const repository = await jsonRequest(fetchImpl, token, base);
      const owner = plain(repository.owner);
      if (owner.login !== OWNER) reject();
      const ownerId = positiveIntegerString(owner.id);
      const run = await jsonRequest(fetchImpl, token, `${base}/actions/runs/${runId}/attempts/1`);
      const runIdentity = validateIdentityRun(run, { runId, approvedSha: input.approvedSha,
        completed: false, displayTitle: input.releaseId });
      if (runIdentity.actor.login !== OWNER || runIdentity.triggeringActor.login !== OWNER
        || runIdentity.actor.id !== ownerId || runIdentity.triggeringActor.id !== ownerId
        || runIdentity.actor.login !== observation.actor.login
        || runIdentity.triggeringActor.login !== observation.triggeringActor.login
        || runIdentity.actor.id !== observation.actor.id
        || runIdentity.triggeringActor.id !== observation.triggeringActor.id) reject();
      const jobs = await paginate({ fetchImpl, token,
        url: `${base}/actions/runs/${runId}/attempts/1/jobs`, field: 'jobs' });
      const jobId = validateJob(jobs, { runId, name: 'Issue immutable B2 private authority',
        approvedSha: input.approvedSha, completed: false });
      const runs = await paginate({ fetchImpl, token,
        url: `${base}/actions/workflows/nelyon-production-release.yml/runs?branch=main&event=workflow_dispatch&exclude_pull_requests=true`,
        field: 'workflow_runs' });
      const matching = runs.filter(item => item?.display_title === input.releaseId);
      if (matching.length !== 1 || positiveIntegerString(matching[0].id) !== runId) reject();
      const approvedAt = runIdentity.createdAt;
      if (Date.parse(approvedAt) <= Date.parse(observation.observation.completedObservedAt)) reject();
      const expiresAt = new Date(Math.min(Date.parse(observation.observation.backup.expiresAt),
        Date.parse(observation.observation.vaultEdgeParity.expiresAt))).toISOString();
      if (Date.parse(approvedAt) >= Date.parse(expiresAt)) reject();
      const authorizationSha256 = digest(canonicalBytes({ schemaVersion: 1, releaseId: input.releaseId,
        preissuanceSha256: input.preissuanceSha256, observationSha256: observation.observation.observationSha256,
        observationRunId: observation.runId, observationJobId: observation.jobId,
        observationArtifactId: observation.artifact.id, observationArtifactDigest: observation.artifact.digest,
        observationActor: observation.actor, observationTriggeringActor: observation.triggeringActor,
        issueRunId: runId, issueJobId: jobId, actor: runIdentity.actor,
        triggeringActor: runIdentity.triggeringActor, approvedAt, expiresAt }));
      const approval = Object.freeze({ schemaVersion: 1, decision: 'APPROVED',
        scope: Object.freeze(['web-control-centers-b2']), authorizationSha256, approvedAt, expiresAt });
      const capability = Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_OWNER_APPROVAL' });
      approvalCapabilities.set(capability, Object.freeze({ approval, actor: runIdentity.actor,
        triggeringActor: runIdentity.triggeringActor, runId, runAttempt: 1, jobId,
        releaseId: input.releaseId, preissuanceSha256: input.preissuanceSha256,
        observationCapability: input.observation }));
      return capability;
    },
  });
}

export function readTrustedB2AuthorityObservation(capability) {
  const state = capabilityState(observationCapabilities, capability);
  return Object.freeze({ observation: state.observation, runId: state.runId, runAttempt: state.runAttempt,
    jobId: state.jobId, runCreatedAt: state.runCreatedAt, actor: state.actor,
    triggeringActor: state.triggeringActor, artifact: state.artifact });
}

export function readTrustedB2AuthorityApproval(capability, observationCapability) {
  const state = capabilityState(approvalCapabilities, capability);
  if (state.observationCapability !== observationCapability
    || !observationCapabilities.has(observationCapability)) reject();
  return Object.freeze({ approval: state.approval, actor: state.actor,
    triggeringActor: state.triggeringActor, runId: state.runId, runAttempt: state.runAttempt,
    jobId: state.jobId, releaseId: state.releaseId, preissuanceSha256: state.preissuanceSha256 });
}

function git(root, args, maximum = 64 * 1024 * 1024) {
  try {
    return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=NUL', '-C', root, ...args], {
      encoding: null,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: maximum,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    });
  } catch { reject(); }
}

function gitText(root, args) {
  const bytes = git(root, args);
  let value;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(); }
  if (!Buffer.from(value, 'utf8').equals(bytes)) reject();
  return value;
}

function gitBlob(root, sha, path) {
  if (!SHA40.test(sha) || typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/u.test(path)
    || path.startsWith('/') || path.includes('..') || path.includes('\\')) reject();
  const bytes = git(root, ['show', `${sha}:${path}`]);
  if (bytes.includes(13)) reject();
  return bytes;
}

function parseExactJsonBytes(bytes) {
  const value = parseJson(bytes);
  if (!Buffer.from(JSON.stringify(value), 'utf8').equals(bytes)
    && !Buffer.from(`${JSON.stringify(value)}\n`, 'utf8').equals(bytes)) {
    // Reviewed repository JSON may be formatted. Duplicate keys were already
    // rejected; values remain bound by the Git blob and byte digest.
    return value;
  }
  return value;
}

function reviewedFunctionFiles(root, sha) {
  const listing = git(root, ['ls-tree', '-r', '-z', '--name-only', sha, '--', 'supabase/functions']);
  const paths = listing.toString('utf8').split('\0').filter(Boolean);
  if (paths.length < 1 || new Set(paths).size !== paths.length
    || paths.some(path => !path.startsWith('supabase/functions/'))) reject();
  const files = {};
  for (const path of paths.sort()) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|json)$/u.test(path) || /\/(?:deno\.jsonc?)$/u.test(path)) continue;
    const bytes = gitBlob(root, sha, path);
    let source;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(); }
    if (!Buffer.from(source, 'utf8').equals(bytes)) reject();
    files[path] = source;
  }
  return files;
}

function exactReviewedChange(root, sha, value) {
  exact(value, ['path', 'status', 'blob', 'sha256', 'byte_length']);
  if (!['A', 'M'].includes(value.status) || !SHA40.test(value.blob) || !HEX64.test(value.sha256)
    || !Number.isSafeInteger(value.byte_length) || value.byte_length < 1) reject();
  const bytes = gitBlob(root, sha, value.path);
  const blob = gitText(root, ['rev-parse', `${sha}:${value.path}`]).trim();
  if (blob !== value.blob || digest(bytes) !== value.sha256 || bytes.length !== value.byte_length) reject();
  return { ...value };
}

function advisorOrigin(contract) {
  const migration = contract.productive_changes.find(item =>
    item.path === 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql');
  if (!migration) reject();
  return {
    repository: REPOSITORY,
    transitionId: contract.id,
    reviewedSourceSha: contract.reviewed_source_sha,
    reviewedSourceTreeSha: contract.reviewed_source_tree_sha,
    integrationBaseSha: contract.integration_base_sha,
    migration: { path: migration.path, blob: migration.blob, sha256: migration.sha256,
      byteLength: migration.byte_length },
    changedObjectIdentities: [...B2_ADVISOR_CHANGED_OBJECT_IDENTITIES],
    contractSha256: contract.advisor_authorization_contract_sha256,
    verifierSha256: contract.advisor_authorization_verifier_sha256,
    testsSha256: contract.advisor_authorization_tests_sha256,
  };
}

/** Build the complete approved public contract and private inputs from exact
 * Git blobs plus branded provider/proof capabilities. Nothing is written. */
export function prepareB2AuthorityIssuance(input) {
  exact(input, ['repositoryRoot', 'approvedSha', 'approvedTreeSha', 'integrationBaseSha', 'observation']);
  const observationState = capabilityState(observationCapabilities, input.observation);
  if (!SHA40.test(input.approvedSha) || !SHA40.test(input.approvedTreeSha)
    || input.integrationBaseSha !== B2_AUTHORITY_INTEGRATION_BASE_SHA
    || observationState.observation.approvedSha !== input.approvedSha
    || observationState.observation.approvedTreeSha !== input.approvedTreeSha) reject();
  let root;
  try { root = realpathSync(input.repositoryRoot); } catch { reject(); }
  if (gitText(root, ['rev-parse', 'HEAD']).trim() !== input.approvedSha
    || gitText(root, ['rev-parse', 'HEAD^{tree}']).trim() !== input.approvedTreeSha
    || gitText(root, ['merge-base', input.integrationBaseSha, input.approvedSha]).trim() !== input.integrationBaseSha) reject();

  const descriptorPath = '.github/nelyon-web-control-centers-b2-release-descriptor.json';
  const candidate = parseExactJsonBytes(gitBlob(root, input.approvedSha, descriptorPath));
  exact(candidate, ['schema_version', 'contract', 'public_contract_sha256', 'private_authority']);
  exact(candidate.private_authority, ['required', 'schema_version', 'authority_id', 'sha256']);
  exact(candidate.contract, [
    'advisor_authorization_contract_sha256', 'advisor_authorization_tests_sha256',
    'advisor_authorization_verifier_sha256', 'approved_sha_ancestry', 'baseline_sha',
    'cron_activation', 'finance_invariants', 'from_phase', 'function_inventory', 'functions', 'id',
    'integration_base_sha', 'managed_scope_transition', 'private_authority_max_bytes',
    'productive_changes', 'release_ready', 'requires_separate_baseline_promotion',
    'reviewed_source_sha', 'reviewed_source_tree_sha', 'state', 'to_phase',
  ]);
  const contract = structuredClone(candidate.contract);
  if (candidate.schema_version !== 1 || contract.id !== 'web-control-centers-b2-scheduled-publishing-v1'
    || contract.state !== 'candidate' || contract.release_ready !== false
    || !HEX64.test(candidate.public_contract_sha256)
    || candidate.public_contract_sha256 !== digest(Buffer.from(canonicalJson(candidate.contract), 'utf8'))
    || candidate.private_authority?.required !== true || candidate.private_authority?.schema_version !== 1
    || candidate.private_authority?.authority_id !== 'web-control-centers-b2-release-authority-v1'
    || candidate.private_authority?.sha256 !== null || !Array.isArray(contract.productive_changes)
    || contract.productive_changes.length !== 5 || !Array.isArray(contract.functions)
    || contract.functions.length !== B2_AUTHORITY_EDGE_FUNCTION_SCOPE.length) reject();
  contract.productive_changes = contract.productive_changes.map(value => exactReviewedChange(root, input.approvedSha, value));
  contract.state = 'approved';
  contract.release_ready = true;
  contract.reviewed_source_sha = input.approvedSha;
  contract.reviewed_source_tree_sha = input.approvedTreeSha;
  contract.integration_base_sha = input.integrationBaseSha;
  contract.advisor_authorization_contract_sha256 = B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256;
  contract.advisor_authorization_verifier_sha256 = digest(gitBlob(root, input.approvedSha,
    'scripts/nelyon-b2-authority-preparation.mjs'));
  contract.advisor_authorization_tests_sha256 = digest(gitBlob(root, input.approvedSha,
    'tests/nelyonB2AuthorityPreparation.test.mjs'));
  contract.function_inventory = { before: observationState.observation.functionInventory.count,
    after: observationState.observation.functionInventory.count + 1 };
  const configAfter = parseFunctionConfig(gitBlob(root, input.approvedSha, 'supabase/config.toml').toString('utf8'));
  const configBefore = parseFunctionConfig(gitBlob(root, contract.baseline_sha, 'supabase/config.toml').toString('utf8'));
  const graph = buildFunctionGraph(reviewedFunctionFiles(root, input.approvedSha));
  const affected = contract.functions.map(item => item.name);
  if (canonicalJson(affected) !== canonicalJson(B2_AUTHORITY_EDGE_FUNCTION_SCOPE.map(item => item.name))) reject();
  const functionContracts = buildFunctionContracts({ affectedFunctions: affected, graph, configBefore, configAfter,
    changes: contract.productive_changes });
  for (const row of contract.functions) {
    const reviewed = functionContracts.find(item => item.name === row.name);
    const scope = B2_AUTHORITY_EDGE_FUNCTION_SCOPE.find(item => item.name === row.name);
    if (!reviewed || !scope || row.verify_jwt !== scope.verifyJwt || configAfter[row.name]?.verify_jwt !== scope.verifyJwt) reject();
    row.source_sha256 = reviewed.source_sha256;
    row.config_sha256 = digest(Buffer.from(canonicalJson(configAfter[row.name]), 'utf8'));
  }
  const publicContractSha256 = digest(Buffer.from(canonicalJson(contract), 'utf8'));
  const functionInventory = contract.functions.map(row => ({ identity: row.name, verifyJwt: row.verify_jwt,
    sourceSha256: row.source_sha256, configSha256: row.config_sha256 }));
  const proofs = runB2ReviewedAuthorityEvidenceProofs();
  const successorCatalog = normalizeB2SuccessorCatalogFromDisposableEvidence({ ...proofs, functionInventory });
  if (successorCatalog.records.length !== 113) reject();
  const origin = advisorOrigin(contract);
  const securityAdvisor = computeB2AdvisorAuthorizations({
    baselineItems: observationState.observation.securityAdvisor.baselineItems,
    findings: observationState.observation.securityAdvisor.findings,
    successorCatalog,
    origin,
  });
  if (!verifyB2AdvisorAuthorizationClaims({ securityAdvisor, successorCatalog, origin })) reject();

  const closureFiles = privateRuntimeClosureMemberPaths().map(path => ({ path,
    bytes: gitBlob(root, input.approvedSha, path) }));
  const closure = buildPrivateRuntimeClosureFromExactBytes({ files: closureFiles });
  const policySha256 = digest(gitBlob(root, input.approvedSha, '.github/nelyon-production-release-policy.json'));
  const resourceManifest = {
    schemaVersion: 1,
    migration: contract.productive_changes.find(item => item.path.startsWith('supabase/migrations/')),
    functions: contract.functions,
    cron: { name: 'process-scheduled-publications-b2', schedule: '* * * * *',
      command: 'select public.wake_scheduled_publications_b2_v1()' },
  };
  const manifestSha256 = digest(Buffer.from(canonicalJson(resourceManifest), 'utf8'));
  const preissuance = computeB2AuthorityPreissuance({ repository: REPOSITORY, workflowPath: WORKFLOW,
    approvedSha: input.approvedSha, approvedTreeSha: input.approvedTreeSha, publicContractSha256,
    manifestSha256, policySha256, baselineSha: contract.baseline_sha,
    runtimeClosureSha256: closure.closure_sha256,
    observationSha256: observationState.observation.observationSha256 });
  const releaseId = `b2-authority-${preissuance.preissuanceSha256}`;
  const capability = Object.freeze({ schemaVersion: 1, result: 'B2_AUTHORITY_PREPARED' });
  preparationCapabilities.set(capability, Object.freeze({ observationCapability: input.observation,
    descriptor: { ...candidate, contract, public_contract_sha256: publicContractSha256 },
    contract, publicContractSha256, successorCatalog, securityAdvisor, preissuance, releaseId,
    manifestSha256, policySha256, runtimeClosureSha256: closure.closure_sha256 }));
  return capability;
}

export function readB2AuthorityPreparationSummary(capability) {
  const state = capabilityState(preparationCapabilities, capability);
  return Object.freeze({ releaseId: state.releaseId, preissuanceSha256: state.preissuance.preissuanceSha256,
    publicContractSha256: state.publicContractSha256, manifestSha256: state.manifestSha256,
    policySha256: state.policySha256, runtimeClosureSha256: state.runtimeClosureSha256,
    functionInventory: Object.freeze({ before: state.contract.function_inventory.before,
      after: state.contract.function_inventory.after }), successorCatalogCount: state.successorCatalog.records.length });
}

/** Assemble, validate and publish the exact strict private envelope. The only
 * returned value is a sanitized receipt; private bytes remain in this frame. */
export async function issueB2PrivateAuthority(input) {
  exact(input, ['preparation', 'observation', 'approval', 'publisher', 'issuedAt']);
  const prepared = capabilityState(preparationCapabilities, input.preparation);
  const observed = capabilityState(observationCapabilities, input.observation);
  const approved = capabilityState(approvalCapabilities, input.approval);
  if (prepared.observationCapability !== input.observation
    || approved.observationCapability !== input.observation
    || approved.preissuanceSha256 !== prepared.preissuance.preissuanceSha256
    || approved.releaseId !== prepared.releaseId
    || !input.publisher || typeof input.publisher.publishBySha256 !== 'function'
    || typeof input.issuedAt !== 'string' || new Date(input.issuedAt).toISOString() !== input.issuedAt
    || Date.parse(input.issuedAt) < Date.parse(approved.approval.approvedAt)
    || Date.parse(input.issuedAt) >= Date.parse(approved.approval.expiresAt)) reject();
  const authority = {
    schemaVersion: 1,
    authorityId: 'web-control-centers-b2-release-authority-v1',
    publicContractSha256: prepared.publicContractSha256,
    phase: 'web-control-centers-b2',
    issuedFor: { baselineSha: prepared.contract.baseline_sha, reviewedSourceSha: prepared.contract.reviewed_source_sha,
      integrationBaseSha: prepared.contract.integration_base_sha },
    successorCatalog: prepared.successorCatalog,
    securityAdvisor: prepared.securityAdvisor,
    backup: observed.observation.backup,
    vaultEdgeParity: observed.observation.vaultEdgeParity,
    approval: approved.approval,
  };
  const authorityBytes = Buffer.from(JSON.stringify(authority), 'utf8');
  const authoritySha256 = digest(authorityBytes);
  parseB2PrivateAuthority(authorityBytes.toString('utf8'), authoritySha256, input.issuedAt);
  let publication;
  try { publication = await input.publisher.publishBySha256(authoritySha256, authorityBytes); }
  catch { reject(); }
  exact(publication, ['schemaVersion', 'result', 'sha256', 'byteLength', 'key', 'etag', 'readback']);
  if (publication.schemaVersion !== 1 || publication.sha256 !== authoritySha256
    || publication.byteLength !== authorityBytes.length
    || !['CREATED', 'ALREADY_EXISTS', 'UNCERTAIN_WRITE_VERIFIED'].includes(publication.result)
    || publication.readback !== 'HEAD_GET_EXACT') reject();
  const key = publication.key;
  const etag = publication.etag;
  if (key !== `internal/release-authority/v1/sha256/${authoritySha256}.json`
    || typeof etag !== 'string' || !/^"[0-9a-f]{32}"$/u.test(etag)) reject();
  return Object.freeze({
    schemaVersion: 1,
    kind: 'nelyon-b2-private-authority-issuance-receipt-v1',
    repository: REPOSITORY,
    workflowPath: WORKFLOW,
    source: Object.freeze({ sha: prepared.contract.reviewed_source_sha,
      tree: prepared.contract.reviewed_source_tree_sha }),
    observation: Object.freeze({ runId: observed.runId, runAttempt: observed.runAttempt, jobId: observed.jobId,
      artifactId: observed.artifact.id, artifactDigest: observed.artifact.digest,
      artifactBytes: observed.artifact.bytes, observationSha256: observed.observation.observationSha256,
      actor: observed.actor, triggeringActor: observed.triggeringActor }),
    approval: Object.freeze({ runId: approved.runId, runAttempt: approved.runAttempt, jobId: approved.jobId,
      actor: approved.actor, triggeringActor: approved.triggeringActor,
      authorizationSha256: approved.approval.authorizationSha256 }),
    preissuanceSha256: prepared.preissuance.preissuanceSha256,
    authoritySha256,
    r2: Object.freeze({ key, etag, readback: publication.readback, disposition: publication.result }),
    issuedAt: input.issuedAt,
    expiresAt: approved.approval.expiresAt,
  });
}
