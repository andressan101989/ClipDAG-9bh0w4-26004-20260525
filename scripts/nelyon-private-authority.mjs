import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 48;
const MAX_NODES = 50_000;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEX_64 = /^[0-9a-f]{64}$/;
const GIT_SHA_40 = /^[0-9a-f]{40}$/;
const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CATALOG_KINDS = new Set([
  'relation', 'relation_acl', 'function', 'function_acl', 'policy', 'trigger', 'index', 'cron_job', 'function_inventory',
]);
const ADVISOR_ACTIONS = new Set(['retain', 'add', 'replace', 'remove']);

function reject() {
  const error = new Error('Private preparation input rejected');
  error.code = 'PRIVATE_PREPARATION_INPUT_INVALID';
  // Even Error inspection must not reveal local authority/caller paths.
  error.stack = 'Error: Private preparation input rejected';
  throw Object.freeze(error);
}

function boundedJson(text, validateDecodedStrings = false) {
  if (typeof text !== 'string' || text.length === 0
    || Buffer.byteLength(text, 'utf8') > MAX_BYTES
    || Buffer.from(text, 'utf8').toString('utf8') !== text) reject();
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop();
    if (++nodes > MAX_NODES || current.depth > MAX_DEPTH) reject();
    if (validateDecodedStrings && typeof current.value === 'string') {
      boundedText(current.value, 0, MAX_BYTES);
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    const keys = Object.keys(current.value);
    if (nodes + pending.length + keys.length > MAX_NODES) reject();
    for (const key of keys) {
      if (UNSAFE_KEYS.has(key)) reject();
      if (validateDecodedStrings) boundedText(key, 0, MAX_BYTES);
      pending.push({ value: current.value[key], depth: current.depth + 1 });
    }
    Object.freeze(current.value);
  }
  // Exact compact encoding rejects duplicate/escaped keys, ambiguous numeric
  // encodings and whitespace. The digest binds these exact UTF-8 bytes, not a
  // reserialized or independently canonicalized replacement.
  if (JSON.stringify(value) !== text) reject();
  return value;
}

/** Private in-process data only. Do not log or serialize the returned value. */
export function parsePrivatePreparationJson(text) {
  try {
    return boundedJson(text);
  } catch {
    reject();
  }
}

/**
 * A data interface, not an authentication decision. The trusted caller must
 * obtain expectedSha256 independently of the payload and candidate checkout.
 * No files, environment, URLs, credentials or legacy policy fallback are read.
 * The returned context contains private data and is not a public receipt.
 */
export function parsePrivateAuthority(authorityJson, expectedSha256) {
  try {
    if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) reject();
    const envelope = boundedJson(authorityJson);
    const keys = Object.keys(envelope).sort();
    if (keys.length !== 2 || keys[0] !== 'policy' || keys[1] !== 'schemaVersion'
      || envelope.schemaVersion !== 1 || envelope.policy === null
      || typeof envelope.policy !== 'object' || Array.isArray(envelope.policy)) reject();
    const sha256 = createHash('sha256').update(authorityJson, 'utf8').digest('hex');
    if (sha256 !== expectedSha256) reject();
    return Object.freeze({ policy: envelope.policy, sha256 });
  } catch {
    reject();
  }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) reject();
}

function boundedText(value, minimum, maximum) {
  if (typeof value !== 'string' || value.normalize('NFC') !== value
    || Buffer.from(value, 'utf8').toString('utf8') !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) reject();
  const length = Buffer.byteLength(value, 'utf8');
  if (length < minimum || length > maximum) reject();
  return value;
}

function matchesString(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function timestamp(value) {
  if (typeof value !== 'string' || !RFC3339_MILLIS.test(value)) reject();
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) reject();
  return millis;
}

function normalizeCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizeCanonical(value[key])]));
}

const projectionText = value => boundedText(value, 1, 512);
const projectionExpression = value => boundedText(value, 1, 16_384);
const projectionDigest = value => { if (!matchesString(value, HEX_64)) reject(); };
const projectionBoolean = value => { if (typeof value !== 'boolean') reject(); };
const nullableExpression = value => { if (value !== null) projectionExpression(value); };
const projectionTextArray = value => {
  if (!Array.isArray(value) || value.length > 64) reject();
  value.forEach(projectionText);
};
const oneOf = choices => value => { if (!choices.includes(value)) reject(); };
const projectionAccess = value => {
  exactKeys(value, ['anon', 'authenticated', 'public', 'service_role']);
  Object.values(value).forEach(projectionBoolean);
};
const projectionAcl = privileges => value => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) reject();
  let previous = null;
  for (const entry of value) {
    exactKeys(entry, ['grantee', 'is_grantable', 'privilege_type']);
    projectionText(entry.grantee); oneOf(privileges)(entry.privilege_type); projectionBoolean(entry.is_grantable);
    const key = `${entry.grantee}\0${entry.privilege_type}`;
    if (previous !== null && key <= previous) reject();
    previous = key;
  }
};

// Closed v1 attestation projections. B2 snapshot consumers must project captured
// facts to these same shapes before comparing; raw provider responses are not
// accepted. The envelope schema version governs this registry.
const CATALOG_PROJECTIONS = Object.freeze({
  function_acl: { identity: projectionText, acl: projectionAcl(['EXECUTE']), execute: projectionAccess },
  relation_acl: { identity: projectionText,
    acl: projectionAcl(['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']),
    access: projectionAccess },
  relation: { identity: projectionText, rls: projectionBoolean, forceRls: projectionBoolean,
    owner: projectionText, definitionSha256: projectionDigest },
  function: { identity: projectionText, execute: projectionBoolean, owner: projectionText,
    securityDefiner: projectionBoolean, searchPath: projectionTextArray, definitionSha256: projectionDigest },
  policy: { identity: projectionText, relation: projectionText,
    command: oneOf(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']), roles: projectionTextArray,
    using: nullableExpression, check: nullableExpression },
  trigger: { identity: projectionText, relation: projectionText, functionIdentity: projectionText,
    enabled: oneOf(['O', 'D', 'R', 'A']), definitionSha256: projectionDigest },
  index: { identity: projectionText, relation: projectionText, valid: projectionBoolean,
    ready: projectionBoolean, unique: projectionBoolean, definitionSha256: projectionDigest },
  cron_job: { identity: projectionText, schedule: projectionText, commandSha256: projectionDigest,
    database: projectionText, username: projectionText, active: projectionBoolean },
  function_inventory: { identity: projectionText, verifyJwt: projectionBoolean,
    sourceSha256: projectionDigest, configSha256: projectionDigest },
});
const ADVISOR_PROJECTION = Object.freeze({
  fingerprint: projectionDigest, identity: projectionText, type: projectionText,
  severity: oneOf(['INFO', 'WARN', 'ERROR']), objectSha256: projectionDigest,
  attestationSha256: projectionDigest, negativeEvidenceSha256: projectionDigest,
  originSha256: projectionDigest,
});

function validateExpectedJson(text, expectedSha256, schema, identity) {
  boundedText(text, 2, 65_536);
  projectionDigest(expectedSha256);
  const parsed = boundedJson(text, true);
  if (JSON.stringify(normalizeCanonical(parsed)) !== text
    || createHash('sha256').update(text, 'utf8').digest('hex') !== expectedSha256) reject();
  if (!schema) reject();
  exactKeys(parsed, Object.keys(schema).sort());
  for (const [key, validate] of Object.entries(schema)) validate(parsed[key]);
  if (parsed.identity !== identity) reject();
}

function validateCatalogRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 512) reject();
  let previous = null;
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) reject();
    exactKeys(record, ['kind', 'identity', 'expectedCanonicalJson', 'expectedSha256']);
    if (!CATALOG_KINDS.has(record.kind)) reject();
    boundedText(record.identity, 1, 512);
    validateExpectedJson(record.expectedCanonicalJson, record.expectedSha256,
      CATALOG_PROJECTIONS[record.kind], record.identity);
    const identity = `${record.kind}\u0000${record.identity}`;
    if (previous !== null && identity <= previous) reject();
    previous = identity;
  }
}

function validateAdvisorRecords(records) {
  if (!Array.isArray(records) || records.length > 256) reject();
  let previous = null;
  const identities = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) reject();
    exactKeys(record, ['action', 'identity', 'expectedCanonicalJson', 'expectedSha256']);
    if (!ADVISOR_ACTIONS.has(record.action)) reject();
    boundedText(record.identity, 1, 512);
    validateExpectedJson(record.expectedCanonicalJson, record.expectedSha256,
      ADVISOR_PROJECTION, record.identity);
    const identity = `${record.action}\u0000${record.identity}`;
    if (identities.has(record.identity) || (previous !== null && identity <= previous)) reject();
    identities.add(record.identity);
    previous = identity;
  }
}

/**
 * Parse and validate the exact B2 private authority envelope. The caller must
 * supply both the independently trusted digest and the requested release time.
 * This function performs no I/O and the returned private value must never be
 * logged, serialized into public evidence, or passed to a child process.
 */
export function parseB2PrivateAuthority(authorityJson, expectedSha256, requestedAt) {
  try {
    if (!matchesString(expectedSha256, HEX_64)) reject();
    const requestedMillis = timestamp(requestedAt);
    const authority = boundedJson(authorityJson, true);
    exactKeys(authority, [
      'schemaVersion', 'authorityId', 'publicContractSha256', 'phase', 'issuedFor',
      'successorCatalog', 'securityAdvisor', 'backup', 'approval',
    ]);
    if (authority.schemaVersion !== 1) reject();
    boundedText(authority.authorityId, 1, 128);
    if (!matchesString(authority.publicContractSha256, HEX_64)
      || authority.phase !== 'web-control-centers-b2') reject();

    exactKeys(authority.issuedFor, ['baselineSha', 'reviewedSourceSha', 'integrationBaseSha']);
    if (![authority.issuedFor.baselineSha, authority.issuedFor.reviewedSourceSha,
      authority.issuedFor.integrationBaseSha].every(value => matchesString(value, GIT_SHA_40))) reject();

    exactKeys(authority.successorCatalog, ['schemaVersion', 'records']);
    if (authority.successorCatalog.schemaVersion !== 1) reject();
    validateCatalogRecords(authority.successorCatalog.records);

    exactKeys(authority.securityAdvisor, ['schemaVersion', 'baselineSha256', 'records']);
    if (authority.securityAdvisor.schemaVersion !== 1
      || !matchesString(authority.securityAdvisor.baselineSha256, HEX_64)) reject();
    validateAdvisorRecords(authority.securityAdvisor.records);

    exactKeys(authority.backup, [
      'schemaVersion', 'provider', 'kind', 'projectRefSha256', 'evidenceSha256',
      'status', 'completedAt', 'expiresAt',
    ]);
    if (authority.backup.schemaVersion !== 1 || authority.backup.provider !== 'supabase'
      || authority.backup.kind !== 'physical' || authority.backup.status !== 'COMPLETED'
      || !matchesString(authority.backup.projectRefSha256, HEX_64)
      || !matchesString(authority.backup.evidenceSha256, HEX_64)) reject();
    const backupCompleted = timestamp(authority.backup.completedAt);
    const backupExpires = timestamp(authority.backup.expiresAt);

    exactKeys(authority.approval, [
      'schemaVersion', 'decision', 'scope', 'authorizationSha256', 'approvedAt', 'expiresAt',
    ]);
    if (authority.approval.schemaVersion !== 1 || authority.approval.decision !== 'APPROVED'
      || !Array.isArray(authority.approval.scope) || authority.approval.scope.length !== 1
      || authority.approval.scope[0] !== 'web-control-centers-b2'
      || !matchesString(authority.approval.authorizationSha256, HEX_64)) reject();
    const approvedAt = timestamp(authority.approval.approvedAt);
    const approvalExpires = timestamp(authority.approval.expiresAt);
    if (backupCompleted > approvedAt || approvedAt > requestedMillis
      || requestedMillis >= backupExpires || requestedMillis >= approvalExpires) reject();

    const sha256 = createHash('sha256').update(authorityJson, 'utf8').digest('hex');
    if (sha256 !== expectedSha256) reject();
    return Object.freeze({ authority, sha256 });
  } catch {
    reject();
  }
}
