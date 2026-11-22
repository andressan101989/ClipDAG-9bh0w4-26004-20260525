import { createHash } from 'node:crypto';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EXPECTED_FUNCTION_COUNT = 8;
const SCHEDULER_NAME = 'process-scheduled-publications';

function reject() {
  const error = new Error('B2_FUNCTION_DEPLOYMENT_PROOF_INVALID');
  error.code = 'B2_FUNCTION_DEPLOYMENT_PROOF_INVALID';
  throw error;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) reject();
  return value;
}

function normalizeManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length !== EXPECTED_FUNCTION_COUNT) reject();
  const rows = manifest.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) reject();
    const name = item.name;
    const verifyJwt = item.verify_jwt ?? item.verifyJwt;
    const sourceSha256 = item.source_sha256;
    const configSha256 = item.config_sha256;
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof verifyJwt !== 'boolean') reject();
    if (!HASH_PATTERN.test(sourceSha256 ?? '') || !HASH_PATTERN.test(configSha256 ?? '')) reject();
    return { name, verify_jwt: verifyJwt, source_sha256: sourceSha256, config_sha256: configSha256 };
  });
  if (new Set(rows.map(row => row.name)).size !== rows.length
    || rows.filter(row => row.name === SCHEDULER_NAME).length !== 1) reject();
  return rows;
}

function functionManifestSha256(manifestRows) {
  return createHash('sha256').update(`${JSON.stringify(manifestRows)}\n`).digest('hex');
}

export function b2FunctionManifestSha256(manifest) {
  return functionManifestSha256(normalizeManifest(manifest));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalB2FunctionDeploymentProof(proof) {
  return `${JSON.stringify(canonicalValue(proof))}\n`;
}

function normalizeProviderRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) reject();
  const name = row.name ?? row.slug;
  const sourceSha256 = row.provider_package_sha256 ?? row.ezbr_sha256 ?? row.source_sha256;
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)
    || row.status !== 'ACTIVE' || typeof row.verify_jwt !== 'boolean'
    || !Number.isSafeInteger(row.version) || row.version < 1
    || typeof sourceSha256 !== 'string' || !HASH_PATTERN.test(sourceSha256)) reject();
  return Object.freeze({
    name,
    provider_package_sha256: sourceSha256,
    status: 'ACTIVE',
    verify_jwt: row.verify_jwt,
    version: row.version,
  });
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) reject();
  const normalized = rows.map(normalizeProviderRow);
  if (new Set(normalized.map(row => row.name)).size !== normalized.length) reject();
  return normalized;
}

function byName(rows) {
  return new Map(rows.map(row => [row.name, row]));
}

function sameState(left, right) {
  return left?.name === right?.name
    && left?.provider_package_sha256 === right?.provider_package_sha256
    && left?.status === right?.status
    && left?.verify_jwt === right?.verify_jwt
    && left?.version === right?.version;
}

function requireBoundManifestDigest(manifestRows, value) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)
    || functionManifestSha256(manifestRows) !== value) reject();
}

function requireTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject();
  return value;
}

function requireLater(value, previous) {
  requireTimestamp(value);
  if (Date.parse(value) <= Date.parse(previous)) reject();
}

function expectedStateForName({ beforeMap, receipts, name }) {
  return receipts.find(item => item.name === name)?.after ?? beforeMap.get(name) ?? null;
}

function transitionOperation(contract, previous, observed) {
  if (!contract || !observed || observed.name !== contract.name
    || observed.verify_jwt !== contract.verify_jwt) return null;
  if (previous === null) return contract.name === SCHEDULER_NAME ? 'ENROLLED' : null;
  if (contract.name === SCHEDULER_NAME || observed.version <= previous.version
    || observed.provider_package_sha256 === previous.provider_package_sha256) return null;
  return 'REPLACED';
}

function canonicalBeforeRows(manifestRows, rows) {
  const normalized = normalizeRows(rows);
  const map = byName(normalized);
  if (normalized.length !== manifestRows.length - 1
    || normalized.some(row => !manifestRows.some(contract => contract.name === row.name))
    || map.has(SCHEDULER_NAME)) reject();
  const ordered = manifestRows.filter(contract => contract.name !== SCHEDULER_NAME).map(contract => map.get(contract.name));
  if (ordered.some(row => !row)) reject();
  return ordered;
}

function validatePrefix({ proof, manifestRows, manifestSha256 }) {
  exactKeys(proof, [
    'schema_version', 'result', 'manifest_sha256', 'captured_at',
    'before', 'receipts', 'in_flight',
  ]);
  if (proof.schema_version !== 1 || proof.manifest_sha256 !== manifestSha256
    || !['NOT_STARTED', 'INCOMPLETE', 'FUNCTIONS_EXECUTED'].includes(proof.result)) reject();
  requireTimestamp(proof.captured_at);
  if (proof.result === 'NOT_STARTED') {
    if (!Array.isArray(proof.before) || proof.before.length !== 0
      || !Array.isArray(proof.receipts) || proof.receipts.length !== 0
      || proof.in_flight !== null) reject();
    return { beforeRows: [], receipts: [] };
  }

  const beforeRows = canonicalBeforeRows(manifestRows, proof.before);
  if (beforeRows.some((row, index) => !sameState(row, proof.before[index]))) reject();
  const beforeMap = byName(beforeRows);
  if (!Array.isArray(proof.receipts) || proof.receipts.length > manifestRows.length) reject();
  const receipts = proof.receipts.map((receipt, index) => {
    exactKeys(receipt, ['name', 'operation', 'provider_readback', 'captured_at', 'before', 'after']);
    const contract = manifestRows[index];
    if (receipt.name !== contract?.name || receipt.provider_readback !== true) reject();
    requireLater(receipt.captured_at, index === 0 ? proof.captured_at : proof.receipts[index - 1].captured_at);
    const before = receipt.before === null ? null : normalizeProviderRow(receipt.before);
    const after = normalizeProviderRow(receipt.after);
    const expectedBefore = beforeMap.get(receipt.name) ?? null;
    if ((before === null) !== (expectedBefore === null)
      || (before !== null && !sameState(before, expectedBefore))
      || receipt.operation !== transitionOperation(contract, before, after)) reject();
    return { ...receipt, before, after };
  });

  if (proof.in_flight !== null) {
    exactKeys(proof.in_flight, ['name', 'disposition', 'observed', 'captured_at']);
    const contract = manifestRows[receipts.length];
    if (proof.in_flight.name !== contract?.name
      || !['DISPATCH_INTENT', 'CHANGED_AFTER_FAILED_COMMAND', 'UNCHANGED_AFTER_FAILED_COMMAND']
        .includes(proof.in_flight.disposition)) reject();
    requireLater(proof.in_flight.captured_at,
      receipts.length === 0 ? proof.captured_at : receipts.at(-1).captured_at);
    const observed = proof.in_flight.observed === null ? null : normalizeProviderRow(proof.in_flight.observed);
    const previous = beforeMap.get(proof.in_flight.name) ?? null;
    if (proof.in_flight.disposition === 'DISPATCH_INTENT') {
      if (observed !== null) reject();
    } else if (proof.in_flight.disposition === 'CHANGED_AFTER_FAILED_COMMAND') {
      if (transitionOperation(contract, previous, observed) === null) reject();
    } else if ((observed === null) !== (previous === null)
      || (observed !== null && !sameState(observed, previous))) reject();
  }

  if (proof.result === 'FUNCTIONS_EXECUTED') {
    if (receipts.length !== manifestRows.length || proof.in_flight !== null) reject();
  } else if (receipts.length >= manifestRows.length) reject();
  return { beforeRows, receipts };
}

export function createB2FunctionDeploymentNotStarted({ manifest, manifestSha256, capturedAt }) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  requireTimestamp(capturedAt);
  return {
    schema_version: 1,
    result: 'NOT_STARTED',
    manifest_sha256: manifestSha256,
    captured_at: capturedAt,
    before: [],
    receipts: [],
    in_flight: null,
  };
}

export function createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt }) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  requireTimestamp(capturedAt);
  return {
    schema_version: 1,
    result: 'INCOMPLETE',
    manifest_sha256: manifestSha256,
    captured_at: capturedAt,
    before: canonicalBeforeRows(manifestRows, beforeRows),
    receipts: [],
    in_flight: null,
  };
}

export function beginB2FunctionDeploymentAttempt({
  proof, manifest, manifestSha256, beforeRows, capturedAt,
}) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  validatePrefix({ proof, manifestRows, manifestSha256 });
  if (proof.result !== 'NOT_STARTED') reject();
  requireLater(capturedAt, proof.captured_at);
  return createB2FunctionDeploymentAttempt({ manifest, manifestSha256, beforeRows, capturedAt });
}

export function verifyB2FunctionDeploymentAttempt({ proof, manifest, manifestSha256 }) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  validatePrefix({ proof, manifestRows, manifestSha256 });
  return structuredClone(proof);
}

export function markB2FunctionDeploymentIntent({
  proof, manifest, manifestSha256, beforeRows, functionName, capturedAt,
}) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  const validated = validatePrefix({ proof, manifestRows, manifestSha256 });
  if (proof.result !== 'INCOMPLETE' || proof.in_flight !== null
    || functionName !== manifestRows[validated.receipts.length]?.name) reject();
  const canonicalBefore = canonicalBeforeRows(manifestRows, beforeRows ?? validated.beforeRows);
  if (canonicalBefore.some((row, index) => !sameState(row, validated.beforeRows[index]))) reject();
  requireLater(capturedAt, validated.receipts.length === 0 ? proof.captured_at : validated.receipts.at(-1).captured_at);
  return {
    ...structuredClone(proof),
    in_flight: {
      name: functionName,
      disposition: 'DISPATCH_INTENT',
      observed: null,
      captured_at: capturedAt,
    },
  };
}

function assertOtherRows({ manifestRows, beforeMap, receipts, afterRows, functionName }) {
  const afterMap = byName(afterRows);
  for (const row of manifestRows) {
    if (row.name === functionName) continue;
    const expected = expectedStateForName({ beforeMap, receipts, name: row.name });
    const actual = afterMap.get(row.name) ?? null;
    if ((expected === null) !== (actual === null)
      || (expected !== null && !sameState(expected, actual))) reject();
  }
  if (afterRows.some(row => !manifestRows.some(contract => contract.name === row.name))) reject();
}

export function reconcileB2FunctionDeploymentTransition({
  proof, manifest, manifestSha256, beforeRows, afterRows, functionName, commandSucceeded, capturedAt,
}) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  requireTimestamp(capturedAt);
  if (typeof commandSucceeded !== 'boolean') reject();
  const validated = validatePrefix({ proof, manifestRows, manifestSha256 });
  if (proof.result !== 'INCOMPLETE' || proof.in_flight?.disposition !== 'DISPATCH_INTENT'
    || proof.in_flight.name !== functionName
    || functionName !== manifestRows[validated.receipts.length]?.name) reject();
  const canonicalBefore = canonicalBeforeRows(manifestRows, beforeRows ?? validated.beforeRows);
  if (canonicalBefore.some((row, index) => !sameState(row, validated.beforeRows[index]))) reject();
  requireLater(capturedAt, proof.in_flight.captured_at);
  const after = normalizeRows(afterRows);
  const beforeMap = byName(validated.beforeRows);
  const afterMap = byName(after);
  const contract = manifestRows[validated.receipts.length];
  const previous = beforeMap.get(functionName) ?? null;
  const observed = afterMap.get(functionName) ?? null;
  const operation = transitionOperation(contract, previous, observed);
  const unchanged = previous === null ? observed === null : sameState(previous, observed);
  assertOtherRows({ manifestRows, beforeMap, receipts: validated.receipts, afterRows: after, functionName });

  if (!commandSucceeded) {
    if (operation === null && !unchanged) reject();
    return {
      ...structuredClone(proof),
      in_flight: {
        name: functionName,
        disposition: operation === null ? 'UNCHANGED_AFTER_FAILED_COMMAND' : 'CHANGED_AFTER_FAILED_COMMAND',
        observed,
        captured_at: capturedAt,
      },
    };
  }
  if (operation === null) reject();
  const nextReceipts = [...validated.receipts, {
    name: functionName,
    operation,
    provider_readback: true,
    captured_at: capturedAt,
    before: previous,
    after: observed,
  }];
  return {
    ...structuredClone(proof),
    result: nextReceipts.length === manifestRows.length ? 'FUNCTIONS_EXECUTED' : 'INCOMPLETE',
    receipts: nextReceipts,
    in_flight: null,
  };
}

export function resumeB2FunctionDeploymentAttempt({
  proof, manifest, manifestSha256, beforeRows, currentRows, capturedAt,
}) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  requireTimestamp(capturedAt);
  const validated = validatePrefix({ proof, manifestRows, manifestSha256 });
  if (proof.result === 'NOT_STARTED') {
    return beginB2FunctionDeploymentAttempt({
      proof, manifest, manifestSha256, beforeRows: currentRows, capturedAt,
    });
  }
  if (proof.result !== 'INCOMPLETE') reject();
  const canonicalBefore = canonicalBeforeRows(manifestRows, beforeRows ?? validated.beforeRows);
  if (canonicalBefore.some((row, index) => !sameState(row, validated.beforeRows[index]))) reject();
  const current = normalizeRows(currentRows);
  const currentMap = byName(current);
  const beforeMap = byName(validated.beforeRows);
  if (current.some(row => !manifestRows.some(contract => contract.name === row.name))) reject();

  for (const contract of manifestRows) {
    if (proof.in_flight?.name === contract.name) continue;
    const expected = expectedStateForName({ beforeMap, receipts: validated.receipts, name: contract.name });
    const actual = currentMap.get(contract.name) ?? null;
    if ((expected === null) !== (actual === null)
      || (expected !== null && !sameState(expected, actual))) reject();
  }
  if (proof.in_flight === null) return structuredClone(proof);
  requireLater(capturedAt, proof.in_flight.captured_at);

  const name = proof.in_flight.name;
  const contract = manifestRows[validated.receipts.length];
  const previous = beforeMap.get(name) ?? null;
  const observed = currentMap.get(name) ?? null;
  const operation = transitionOperation(contract, previous, observed);
  const unchanged = previous === null ? observed === null : sameState(previous, observed);
  if (proof.in_flight.disposition === 'CHANGED_AFTER_FAILED_COMMAND') {
    if (!sameState(proof.in_flight.observed, observed) || operation === null) reject();
  } else if (proof.in_flight.disposition === 'UNCHANGED_AFTER_FAILED_COMMAND') {
    if (!unchanged) reject();
  } else if (operation === null && !unchanged) reject();

  if (operation === null) return { ...structuredClone(proof), in_flight: null };
  const nextReceipts = [...validated.receipts, {
    name,
    operation,
    provider_readback: true,
    captured_at: capturedAt,
    before: previous,
    after: observed,
  }];
  return {
    ...structuredClone(proof),
    result: nextReceipts.length === manifestRows.length ? 'FUNCTIONS_EXECUTED' : 'INCOMPLETE',
    receipts: nextReceipts,
    in_flight: null,
  };
}

export function verifyB2FunctionDeploymentProof({ proof, manifest, manifestSha256, postRows }) {
  const manifestRows = normalizeManifest(manifest);
  requireBoundManifestDigest(manifestRows, manifestSha256);
  const validated = validatePrefix({ proof, manifestRows, manifestSha256 });
  if (proof.result !== 'FUNCTIONS_EXECUTED' || validated.receipts.length !== manifestRows.length
    || proof.in_flight !== null) reject();
  const postMap = byName(normalizeRows(postRows));
  if (postMap.size !== manifestRows.length) reject();
  for (let index = 0; index < manifestRows.length; index += 1) {
    const contract = manifestRows[index];
    const receipt = validated.receipts[index];
    if (receipt.name !== contract.name || !sameState(receipt.after, postMap.get(contract.name))) reject();
  }
  return structuredClone(proof);
}
