import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { types } from 'node:util';

import { createR2PrivateAuthorityProvider } from './nelyon-private-authority-provider.mjs';
import { readB2ExplicitConnectionDiagnostic } from './nelyon-b2-explicit-connection.mjs';
import { readSnapshotDiagnostic } from './nelyon-production-snapshot-adapter.mjs';
import {
  createB2RecoveryProvenanceLoader,
  loadB2RecoveryAuthorization,
  readTrustedB2HistoricalDescriptorBytes,
  readTrustedB2RecoveryStagingFiles,
} from './nelyon-b2-recovery-provenance.mjs';
import { verifyPrivateRuntimeClosure } from './nelyon-private-runtime-closure.mjs';
import {
  assertB2IntegratedSource,
  resolveB2HistoricalAuthority,
  validatePolicy,
  verifyB2VaultEdgeParity,
  verifyRecoveryArtifactProvenance,
} from './nelyon-production-release.mjs';
import {
  assertAuthorityReceiptMatch,
  createReleaseAuthorityContext,
  publicAuthorityReceipt,
} from './nelyon-release-authority-context.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RESERVED_PREFIX = 'NELYON_PRIVATE_AUTHORITY_';
const ENV_NAMES = Object.freeze([
  'NELYON_PRIVATE_AUTHORITY_PROVIDER',
  'NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID',
  'NELYON_PRIVATE_AUTHORITY_R2_BUCKET',
  'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID',
  'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY',
  'NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256',
  'NELYON_PRIVATE_AUTHORITY_SHA256',
  'NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256',
  'NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS',
  'NELYON_RELEASE_POLICY_SHA256',
  'NELYON_B2_RECOVERY_AUTHORIZATION_SHA256',
]);
const REQUIRED_ENV = Object.freeze(ENV_NAMES.filter(name => !['NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS',
  'NELYON_B2_RECOVERY_AUTHORIZATION_SHA256'].includes(name)));
const RECOVERY_REQUIRED_ENV = Object.freeze(REQUIRED_ENV.filter(name => ![
  'NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256',
  'NELYON_PRIVATE_AUTHORITY_SHA256',
].includes(name)));
const R2_ACCESS_PROBE_ENV = Object.freeze([
  'NELYON_PRIVATE_AUTHORITY_PROVIDER',
  'NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID',
  'NELYON_PRIVATE_AUTHORITY_R2_BUCKET',
  'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID',
  'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY',
  'NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS',
]);
const ACTION_STAGE = Object.freeze({
  'authority-proof': 'authority_proof',
  'dryrun-migrations': 'migrations',
  'apply-migrations': 'migrations',
  'deploy-functions': 'functions',
  revalidate: 'authority_proof',
  'preflight-release': 'authority_proof',
  'authorize-refresh': 'authority_proof',
  'verify-gate': 'authority_proof',
  'pre-snapshot': 'pre_snapshot',
  'verify-pre-snapshot': 'pre_snapshot',
  'post-snapshot': 'post_snapshot',
  postcheck: 'postcheck',
  'verify-recovery-source': 'recovery',
  'recovery-authority-proof': 'recovery',
  'revalidate-b2-recovery': 'recovery',
  'revalidate-b2-admin-recovery': 'recovery',
  'verify-b2-recovery-gate': 'recovery',
  'verify-b2-admin-recovery-gate': 'recovery',
  'admin-recovery-authority-proof': 'recovery',
  'recovery-snapshot': 'recovery',
  'postcheck-recovery': 'recovery',
  'verify-admin-recovery-source': 'recovery',
  'verify-admin-recovery-postcheck-chain': 'recovery',
  'postcheck-admin-recovery': 'recovery',
  'verify-admin-recovery-cloudflare-prestate': 'recovery',
});
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'authorityId', 'descriptorSha256', 'publicContractSha256',
  'privateAuthoritySha256', 'bindingSha256', 'successorCatalogSha256',
  'securityAdvisorSha256', 'backupSha256', 'approvalSha256', 'verified',
]);
const VERIFICATION_KEYS = Object.freeze(['schemaVersion', 'stage', 'result', 'receipt', 'checks']);
const CHECK_KEYS = Object.freeze([
  'catalog', 'securityAdvisor', 'backup', 'finance', 'manifest', 'functionInventory', 'sourceParity',
]);
const COMMON_INPUT_KEYS = Object.freeze(['policy', 'request', 'bundle']);
const CHAIN_INPUT_KEYS = Object.freeze(['chainRun', 'chainArtifacts', 'chainReleaseBundle', 'chainGateEvidence', 'chainRecoveryEvidence']);
const CHAIN_REAUTH_ACTIONS = new Set(['admin-recovery-authority-proof', 'revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate', 'verify-admin-recovery-source', 'postcheck-admin-recovery',
  'verify-admin-recovery-cloudflare-prestate']);
const ACTION_INPUT_KEYS = Object.freeze({
  'authority-proof': COMMON_INPUT_KEYS,
  'dryrun-migrations': [...COMMON_INPUT_KEYS,'currentGate','preSnapshot','binaryPath','stageOutput'],
  'apply-migrations': [...COMMON_INPUT_KEYS,'currentGate','preSnapshot','binaryPath','stageOutput'],
  'deploy-functions': [...COMMON_INPUT_KEYS,'currentGate','preSnapshot','binaryPath','stageOutput'],
  revalidate: [...COMMON_INPUT_KEYS, 'compilerSha256', 'remoteEvidence', 'stageOutput'],
  'preflight-release': [...COMMON_INPUT_KEYS, 'compilerSha256', 'remoteEvidence', 'stageOutput'],
  'authorize-refresh': [...COMMON_INPUT_KEYS, 'policySha256', 'compilerSha256', 'environmentEvidence',
    'branchPolicies', 'approvals', 'runs', 'autoDeployExpected', 'stageOutput'],
  'verify-gate': [...COMMON_INPUT_KEYS, 'policySha256', 'compilerSha256', 'environmentEvidence',
    'branchPolicies', 'approvals', 'runs', 'autoDeployExpected', 'stageOutput'],
  'pre-snapshot': [...COMMON_INPUT_KEYS, 'snapshotOutput'],
  'verify-pre-snapshot': [...COMMON_INPUT_KEYS, 'manifest', 'preSnapshot', 'stageOutput'],
  'post-snapshot': [...COMMON_INPUT_KEYS, 'preSnapshot', 'snapshotOutput'],
  postcheck: [...COMMON_INPUT_KEYS, 'manifest', 'preSnapshot', 'postSnapshot', 'functionDeploymentProof', 'stageOutput'],
  'verify-recovery-source': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'stageOutput'],
  'recovery-authority-proof': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle', 'gateEvidence'],
  'revalidate-b2-recovery': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle',
    'gateEvidence', 'compilerSha256', 'remoteEvidence', 'stageOutput'],
  'revalidate-b2-admin-recovery': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle',
    'gateEvidence', 'adminEvidence', 'compilerSha256', 'remoteEvidence', 'stageOutput'],
  'verify-b2-recovery-gate': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle',
    'gateEvidence', 'policySha256', 'compilerSha256', 'environmentEvidence', 'branchPolicies', 'approvals', 'runs',
    'autoDeployExpected', 'revalidated', 'stageOutput'],
  'verify-b2-admin-recovery-gate': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle',
    'gateEvidence', 'adminEvidence', 'policySha256', 'compilerSha256', 'environmentEvidence', 'branchPolicies',
    'approvals', 'runs', 'autoDeployExpected', 'revalidated', 'stageOutput'],
  'admin-recovery-authority-proof': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts', 'releaseBundle', 'gateEvidence', 'adminEvidence'],
  'recovery-snapshot': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'currentGate', 'snapshotOutput'],
  'postcheck-recovery': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'currentGate', 'verifiedSource', 'currentSnapshot', 'stageOutput'],
  'verify-admin-recovery-source': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'adminEvidence', 'stageOutput'],
  'verify-admin-recovery-postcheck-chain': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'postcheckRecoveryEvidence', 'stageOutput'],
  'postcheck-admin-recovery': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'adminEvidence', 'currentGate', 'verifiedSource', 'currentSnapshot', 'adminManifest', 'build', 'stageOutput'],
  'verify-admin-recovery-cloudflare-prestate': [...COMMON_INPUT_KEYS, 'recoverySourceRun', 'run', 'artifacts',
    'releaseBundle', 'gateEvidence', 'adminEvidence', 'verifiedSource', 'previous', 'routes', 'stageOutput'],
});
const ERROR_CODES = new Set([
  'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED',
  'PRIVATE_AUTHORITY_PROVIDER_INVALID',
  'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE',
  'RELEASE_AUTHORITY_CONTEXT_INVALID',
  'AUTHORITY_RECEIPT_MISMATCH',
  'PRIVATE_AUTHORITY_STAGE_INVALID',
  'PRIVATE_AUTHORITY_SOURCE_INVALID',
  'PRIVATE_AUTHORITY_STAGE_BLOCKED',
  'PRIVATE_AUTHORITY_OUTPUT_INVALID',
  'PRIVATE_AUTHORITY_CLEANUP_FAILED',
]);
const errors = new WeakSet();
const diagnostics = new WeakMap();
export function readPrivateAuthorityDiagnostic(error) { return diagnostics.get(error); }
const bootstraps = new WeakMap();
const recoveryRuntimes = new WeakMap();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

function closedError(code) {
  const selected = ERROR_CODES.has(code) ? code : 'PRIVATE_AUTHORITY_STAGE_BLOCKED';
  const error = new Error('Private authority operation blocked');
  Object.defineProperty(error, 'code', { value: selected, enumerable: true });
  Object.defineProperty(error, 'stack', {
    value: 'Error: Private authority operation blocked',
    enumerable: false,
  });
  Object.freeze(error);
  errors.add(error);
  return error;
}

function fail(code) {
  throw closedError(code);
}

function ownData(value, keys = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
      || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  }
  if (keys) {
    const actual = Object.keys(descriptors);
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
      fail('PRIVATE_AUTHORITY_STAGE_INVALID');
    }
  }
  return descriptors;
}

function ownEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) || types.isProxy(environment)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(environment))) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  if (Object.getOwnPropertySymbols(environment).length !== 0) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  const names = Object.getOwnPropertyNames(environment);
  const reserved = names.filter(key => key.startsWith(RESERVED_PREFIX) || key.startsWith('NELYON_B2_RECOVERY_AUTHORIZATION_'));
  if (reserved.some(key => !ENV_NAMES.includes(key))) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  const descriptors = {};
  for (const name of [...ENV_NAMES, 'RUNNER_TEMP']) {
    const descriptor = Object.getOwnPropertyDescriptor(environment, name);
    if (descriptor && (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
    if (descriptor) descriptors[name] = descriptor;
  }
  return descriptors;
}

function readClosurePin(environment) {
  const descriptors = ownEnvironmentForClosure(environment);
  const value = descriptors.NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256?.value;
  if (typeof value !== 'string' || !HEX64.test(value)) fail('PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  return value;
}

// Bootstrap is deliberately allowed to inspect only the closure-pin data
// descriptor. Provider-secret accessors remain uninvoked until closure success.
function ownEnvironmentForClosure(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) || types.isProxy(environment)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(environment))) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  if (Object.getOwnPropertySymbols(environment).length !== 0) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  const descriptor = Object.getOwnPropertyDescriptor(environment, 'NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
    fail('PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  }
  return { NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: descriptor };
}

function scalar(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function readTrustedProviderEnvironment(environment, requireCurrentPins) {
  const descriptors = ownEnvironment(environment);
  const present = ENV_NAMES.filter(name => Object.hasOwn(descriptors, name));
  const required = requireCurrentPins ? REQUIRED_ENV : RECOVERY_REQUIRED_ENV;
  if (required.some(name => !present.includes(name))) fail('PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  const value = name => descriptors[name].value;
  const timeoutRaw = Object.hasOwn(descriptors, 'NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS')
    ? value('NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS') : '10000';
  if (value('NELYON_PRIVATE_AUTHORITY_PROVIDER') !== 'r2'
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID'), /^[0-9a-f]{32}$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_BUCKET'), /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID'), /^[\x21-\x7e]{1,512}$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY'), /^[\x21-\x7e]{1,512}$/)
    || (requireCurrentPins && !scalar(value('NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256'), HEX64))
    || (requireCurrentPins && !scalar(value('NELYON_PRIVATE_AUTHORITY_SHA256'), HEX64))
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256'), HEX64)
    || !scalar(value('NELYON_RELEASE_POLICY_SHA256'), HEX64)
    || typeof timeoutRaw !== 'string' || !/^(?:[1-9]|[1-9][0-9]{1,3}|[1-5][0-9]{4}|60000)$/.test(timeoutRaw)) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  return Object.freeze({
    provider: 'r2',
    accountId: value('NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID'),
    bucket: value('NELYON_PRIVATE_AUTHORITY_R2_BUCKET'),
    accessKeyId: value('NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID'),
    secretAccessKey: value('NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY'),
    ...(requireCurrentPins ? {
      descriptorSha256: value('NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256'),
      authoritySha256: value('NELYON_PRIVATE_AUTHORITY_SHA256'),
    } : {}),
    runtimeClosureSha256: value('NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256'),
    policySha256: value('NELYON_RELEASE_POLICY_SHA256'),
    timeoutMs,
  });
}

export function readTrustedAuthorityEnvironment(environment) {
  return readTrustedProviderEnvironment(environment, true);
}

/** Read only the exact R2 material needed for a terminal HeadBucket probe.
 * Authority, descriptor, policy, closure and recovery pins are intentionally
 * rejected so this path cannot bootstrap or authorize a release. */
export function readTrustedR2AccessProbeEnvironment(environment) {
  const descriptors = ownEnvironment(environment);
  const presentReserved = ENV_NAMES.filter(name => Object.hasOwn(descriptors, name));
  const required = R2_ACCESS_PROBE_ENV.filter(name => name !== 'NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS');
  if (required.some(name => !presentReserved.includes(name))
    || presentReserved.some(name => !R2_ACCESS_PROBE_ENV.includes(name))) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  const value = name => descriptors[name]?.value;
  const timeoutRaw = Object.hasOwn(descriptors, 'NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS')
    ? value('NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS') : '10000';
  if (value('NELYON_PRIVATE_AUTHORITY_PROVIDER') !== 'r2'
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID'), /^[0-9a-f]{32}$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_BUCKET'), /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID'), /^[\x21-\x7e]{1,512}$/)
    || !scalar(value('NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY'), /^[\x21-\x7e]{1,512}$/)
    || typeof timeoutRaw !== 'string'
    || !/^(?:[1-9]|[1-9][0-9]{1,3}|[1-5][0-9]{4}|60000)$/.test(timeoutRaw)) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  return Object.freeze({
    provider: 'r2',
    accountId: value('NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID'),
    bucket: value('NELYON_PRIVATE_AUTHORITY_R2_BUCKET'),
    accessKeyId: value('NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID'),
    secretAccessKey: value('NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY'),
    timeoutMs,
  });
}

function readTrustedRecoveryEnvironment(environment) {
  return readTrustedProviderEnvironment(environment, false);
}

function textPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  return value;
}

function parseInvocation(invocation) {
  const data = ownData(invocation, ['action', 'inputs', 'verificationOutput']);
  const action = data.action.value;
  if (typeof action !== 'string' || !Object.hasOwn(ACTION_STAGE, action)) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  const baseKeys = ACTION_INPUT_KEYS[action];
  const inputData = ownData(data.inputs.value);
  const hasChain = CHAIN_INPUT_KEYS.some(key => Object.hasOwn(inputData, key));
  const inputKeys = hasChain && CHAIN_REAUTH_ACTIONS.has(action) ? [...baseKeys, ...CHAIN_INPUT_KEYS] : baseKeys;
  if (Object.keys(inputData).length !== inputKeys.length || inputKeys.some(key => !Object.hasOwn(inputData, key))) {
    fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  }
  const inputs = Object.freeze(Object.fromEntries(inputKeys.map(key => [key, textPath(inputData[key].value)])));
  return Object.freeze({ action, inputs, verificationOutput: textPath(data.verificationOutput.value) });
}

function strictHost(host) {
  const data = ownData(host, ['loadPublicInputs', 'dispatch']);
  for (const key of ['loadPublicInputs', 'dispatch']) {
    if (typeof data[key].value !== 'function' || types.isProxy(data[key].value)) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  }
  return Object.freeze(Object.fromEntries(Object.keys(data).map(key => [key, data[key].value])));
}

function strictNow(now) {
  if (typeof now !== 'function' || types.isProxy(now)) fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  return () => {
    let value;
    try { value = now(); } catch { fail('PRIVATE_AUTHORITY_STAGE_BLOCKED'); }
    if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    return value;
  };
}

function strictBootstrap(value) {
  const data = ownData(value, ['manifestClosure', 'repositoryRoot', 'readFile', 'nodeVersion']);
  if (typeof data.repositoryRoot.value !== 'string' || !path.isAbsolute(data.repositoryRoot.value)
    || typeof data.readFile.value !== 'function' || types.isProxy(data.readFile.value)
    || data.nodeVersion.value !== '24.21.0') fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
  return {
    manifestClosure: data.manifestClosure.value,
    repositoryRoot: data.repositoryRoot.value,
    readFile: data.readFile.value,
    nodeVersion: data.nodeVersion.value,
  };
}

export async function bootstrapPrivateAuthorityRuntime(options) {
  try {
    const values = ownData(options, ['environment', 'manifestClosure', 'repositoryRoot', 'readFile', 'nodeVersion']);
    const bootstrap = strictBootstrap({ manifestClosure: values.manifestClosure.value,
      repositoryRoot: values.repositoryRoot.value, readFile: values.readFile.value, nodeVersion: values.nodeVersion.value });
    const protectedClosureSha256 = readClosurePin(values.environment.value);
    const runtimeClosure = verifyPrivateRuntimeClosure({
      manifestClosure: bootstrap.manifestClosure,
      protectedClosureSha256,
      repositoryRoot: bootstrap.repositoryRoot,
      readFile: bootstrap.readFile,
      nodeVersion: bootstrap.nodeVersion,
    });
    const capability = Object.freeze({ schemaVersion: 1, closureSha256: runtimeClosure.closure_sha256 });
    bootstraps.set(capability, { runtimeClosure });
    return capability;
  } catch { fail('PRIVATE_AUTHORITY_STAGE_BLOCKED'); }
}

function copyBytes(value) {
  if (!Buffer.isBuffer(value) || types.isProxy(value)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key))
    || value.length < 1 || value.length > 2 * 1024 * 1024) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
  return Buffer.from(value);
}

function parsePublicJson(bytes) {
  try {
    const text = textDecoder.decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    return value;
  } catch { fail('PRIVATE_AUTHORITY_SOURCE_INVALID'); }
}

function publicInputs(value, config) {
  const data = ownData(value, ['descriptorBytes', 'manifestBytes', 'manifestDigestBytes', 'policyBytes', 'requestBytes']);
  const descriptorBytes = copyBytes(data.descriptorBytes.value);
  const manifestBytes = copyBytes(data.manifestBytes.value);
  const manifestDigestBytes = copyBytes(data.manifestDigestBytes.value);
  const policyBytes = copyBytes(data.policyBytes.value);
  const requestBytes = copyBytes(data.requestBytes.value);
  let manifestDigest;
  try {
    const text = textDecoder.decode(manifestDigestBytes);
    if (!/^[0-9a-f]{64}\n$/u.test(text)) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    manifestDigest = text.slice(0, -1);
  } catch { fail('PRIVATE_AUTHORITY_SOURCE_INVALID'); }
  if (sha256(manifestBytes) !== manifestDigest || sha256(policyBytes) !== config.policySha256) {
    fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
  const manifest = parsePublicJson(manifestBytes);
  const policy = parsePublicJson(policyBytes);
  const request = parsePublicJson(requestBytes);
  if (typeof policy.owner !== 'string' || typeof policy.repository !== 'string'
    || typeof policy.workflow_path !== 'string' || typeof policy.default_branch !== 'string'
    || request.actor !== policy.owner || request.triggeringActor !== policy.owner
    || request.repository !== policy.repository
    || request.workflowRef !== `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`
    || request.ref !== `refs/heads/${policy.default_branch}`
    || request.approvedSha !== request.mainSha
    || manifest?.identity?.approved_sha !== request.approvedSha
    || String(manifest?.identity?.run_id) !== String(request.runId)
    || manifest?.identity?.run_attempt !== request.runAttempt
    || manifest?.identity?.release_id !== request.releaseId) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  return { descriptorBytes, manifest, manifestDigest, policy, request };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
      : item;
  return `${JSON.stringify(normalize(value))}\n`;
}

function parseDescriptorBeforeFetch(descriptorBytes, config, manifest, integratedSource, request) {
  if (sha256(descriptorBytes) !== config.descriptorSha256) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
  let descriptor;
  try {
    const text = textDecoder.decode(descriptorBytes);
    if (!Buffer.from(text, 'utf8').equals(descriptorBytes)) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
    descriptor = JSON.parse(text);
  } catch { fail('RELEASE_AUTHORITY_CONTEXT_INVALID'); }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
  const contract = descriptor.contract;
  const binding = manifest?.resources?.web_control_centers_b2_transition;
  if (integratedSource !== undefined || manifest?.identity?.approved_sha !== contract?.reviewed_source_sha) {
    try { assertB2IntegratedSource(integratedSource, { manifest, descriptorBytes, request }); }
    catch { fail('RELEASE_AUTHORITY_CONTEXT_INVALID'); }
  }
  if (!contract || contract.to_phase !== 'web-control-centers-b2'
    || typeof contract.id !== 'string' || contract.id.length < 1
    || !scalar(contract.baseline_sha, SHA40) || !scalar(contract.reviewed_source_sha, SHA40)
    || !scalar(contract.integration_base_sha, SHA40)
    || descriptor.public_contract_sha256 !== sha256(Buffer.from(canonicalJson(contract), 'utf8'))
    || descriptor.private_authority?.sha256 !== config.authoritySha256
    || binding?.descriptorSha256 !== config.descriptorSha256
    || binding?.expectedPrivateAuthoritySha256 !== config.authoritySha256
    || binding?.publicContractSha256 !== descriptor.public_contract_sha256
    || binding?.privateAuthorityRequired !== true) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
  return { descriptor, contract };
}

function validateReceipt(receipt, result) {
  const data = ownData(result, RECEIPT_KEYS);
  try { assertAuthorityReceiptMatch(receipt, Object.fromEntries(RECEIPT_KEYS.map(key => [key, data[key].value]))); }
  catch { fail('AUTHORITY_RECEIPT_MISMATCH'); }
  return receipt;
}

function validateVerification(action, receipt, result) {
  try {
    const candidate = ownData(result);
    if (Object.keys(candidate).length === RECEIPT_KEYS.length
      && RECEIPT_KEYS.every(key => Object.hasOwn(candidate, key))) return validateReceipt(receipt, result);
  } catch (error) {
    if (errors.has(error)) throw error;
  }
  if (action === 'authority-proof') fail('AUTHORITY_RECEIPT_MISMATCH');
  const data = ownData(result, VERIFICATION_KEYS);
  if (data.schemaVersion.value !== 1 || data.stage.value !== ACTION_STAGE[action]
    || data.result.value !== 'VERIFIED') fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
  validateReceipt(receipt, data.receipt.value);
  const checks = ownData(data.checks.value, CHECK_KEYS);
  if (CHECK_KEYS.some(key => typeof checks[key].value !== 'boolean')) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
  return Object.freeze({
    schemaVersion: 1,
    stage: data.stage.value,
    result: 'VERIFIED',
    receipt,
    checks: Object.freeze(Object.fromEntries(CHECK_KEYS.map(key => [key, checks[key].value]))),
  });
}

function runnerTemp(environment) {
  const descriptor = Object.getOwnPropertyDescriptor(environment, 'RUNNER_TEMP');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  const value = descriptor.value;
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  }
  const resolved = path.resolve(value);
  let actual;
  try { actual = realpathSync(resolved); } catch { fail('PRIVATE_AUTHORITY_OUTPUT_INVALID'); }
  if (actual !== resolved || lstatSync(actual).isSymbolicLink() || !lstatSync(actual).isDirectory()) {
    fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  }
  return actual;
}

function verificationTarget(environment, outputValue) {
  const root = runnerTemp(environment);
  if (!path.isAbsolute(outputValue)) fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  const target = path.resolve(outputValue);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!target.startsWith(prefix)) fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  const parent = path.dirname(target);
  let actualParent;
  try { actualParent = realpathSync(parent); } catch { fail('PRIVATE_AUTHORITY_OUTPUT_INVALID'); }
  if (actualParent !== parent || lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) {
    fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  }
  try {
    lstatSync(target);
    fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  } catch (error) {
    if (errors.has(error) || error?.code !== 'ENOENT') fail('PRIVATE_AUTHORITY_OUTPUT_INVALID');
  }
  return target;
}

function publishVerification(target, verification) {
  let created = false;
  let descriptor;
  try {
    descriptor = openSync(target, 'wx', 0o600);
    created = true;
    writeFileSync(descriptor, `${JSON.stringify(verification)}\n`, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
  } catch {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* cleanup outcome handled below */ }
    }
    if (created) {
      try { unlinkSync(target); } catch { fail('PRIVATE_AUTHORITY_CLEANUP_FAILED'); }
    }
    const error = closedError('PRIVATE_AUTHORITY_OUTPUT_INVALID');
    diagnostics.set(error, Object.freeze({ phase: 'OUTPUT_WRITE', category: 'UNAVAILABLE' }));
    throw error;
  }
}

function runtimeOptions(options) {
  const data = ownData(options);
  const keys = Object.keys(data);
  if (['bootstrapCapability', 'environment', 'host'].some(key => !Object.hasOwn(data, key))
    || keys.some(key => !['bootstrapCapability', 'environment', 'fetchImpl', 'now', 'host', 'recoveryRuntime', 'integratedSource'].includes(key))) {
    fail('PRIVATE_AUTHORITY_STAGE_INVALID');
  }
  const bootstrapState = bootstraps.get(data.bootstrapCapability.value);
  if (!bootstrapState) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
  const recoveryRuntime = data.recoveryRuntime?.value ?? null;
  if (recoveryRuntime && recoveryRuntimes.get(recoveryRuntime)?.bootstrapCapability !== data.bootstrapCapability.value) {
    fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
  const fetchImpl = data.fetchImpl?.value ?? globalThis.fetch;
  const now = data.now?.value ?? (() => new Date().toISOString());
  if (typeof fetchImpl !== 'function' || types.isProxy(fetchImpl)) {
    fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  }
  return {
    bootstrapCapability: data.bootstrapCapability.value,
    environment: data.environment.value,
    bootstrapState,
    fetchImpl,
    now: strictNow(now),
    host: strictHost(data.host.value),
    recoveryRuntime,
    integratedSource: data.integratedSource?.value,
  };
}

function protectedEnvironmentValue(environment, name, pattern, missingCode = 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED') {
  const descriptor = Object.getOwnPropertyDescriptor(environment, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(missingCode);
  if (typeof descriptor.value !== 'string' || !pattern.test(descriptor.value)) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
  return descriptor.value;
}

/** Fixed, runner-local staging only; every later action reauthenticates its own inputs. */
export async function stageProtectedB2RecoverySource(options) {
  let stageDirectory; let created = false;
  try {
    const data = ownData(options, ['bootstrapCapability', 'environment', 'policyBytes', 'runId', 'fetchImpl']);
    const bootstrap = bootstraps.get(data.bootstrapCapability.value);
    const environment = data.environment.value;
    if (!bootstrap || readClosurePin(environment) !== bootstrap.runtimeClosure.closure_sha256) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    const authorizationSha256 = protectedEnvironmentValue(environment, 'NELYON_B2_RECOVERY_AUTHORIZATION_SHA256', HEX64);
    const policySha256 = protectedEnvironmentValue(environment, 'NELYON_RELEASE_POLICY_SHA256', HEX64);
    const token = protectedEnvironmentValue(environment, 'GITHUB_TOKEN', /^[\x21-\x7e]{1,512}$/u);
    const policyBytes = copyBytes(data.policyBytes.value);
    const fetchImpl = data.fetchImpl.value;
    if (sha256(policyBytes) !== policySha256 || typeof fetchImpl !== 'function' || types.isProxy(fetchImpl)
      || typeof data.runId.value !== 'string' || !/^[1-9][0-9]*$/u.test(data.runId.value)) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    validatePolicy(JSON.parse(policyBytes.toString('utf8')));
    const config = readTrustedRecoveryEnvironment(environment);
    const provider = createR2PrivateAuthorityProvider({ accountId: config.accountId, bucket: config.bucket,
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, fetch: fetchImpl, timeoutMs: config.timeoutMs });
    const bytes = await provider.getBySha256(authorizationSha256);
    let approvedSource;
    try { approvedSource = loadB2RecoveryAuthorization({ authorizationBytes: bytes, expectedAuthorizationSha256: authorizationSha256,
      policyBytes, expectedPolicySha256: policySha256, runId: data.runId.value, runAttempt: null }); }
    finally { bytes.fill(0); }
    const loader = createB2RecoveryProvenanceLoader({ fetchImpl, githubToken: token,
      repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
      workflowPath: '.github/workflows/nelyon-production-release.yml', apiOrigin: 'https://api.github.com' });
    const recoveryProvenance = await loader.loadExactAttempt({ approvedSource });
    const chainProvenance = approvedSource.runId === recoveryProvenance.runId
      ? null : await loader.loadExactChain({ recoveryProvenance });
    const historicalRuntimeClosure = await loader.loadHistoricalRuntimeClosure({ recoveryProvenance });
    const staged = readTrustedB2RecoveryStagingFiles(recoveryProvenance, chainProvenance);
    const declaredRoot = path.resolve(protectedEnvironmentValue(environment, 'RUNNER_TEMP', /^.{1,4096}$/u));
    if (realpathSync(declaredRoot) !== declaredRoot || !lstatSync(declaredRoot).isDirectory()
      || lstatSync(declaredRoot).isSymbolicLink()) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    stageDirectory = path.join(declaredRoot, 'nelyon-b2-recovery-source');
    mkdirSync(stageDirectory);
    created = true;
    const writeSet = (name, files) => {
      const directory = path.join(stageDirectory, name); mkdirSync(directory);
      for (const [relative, content] of Object.entries(files)) {
        const parts = relative.split('/');
        if (parts.length === 2 && parts[0] === 'bundle') {
          const bundle = path.join(directory, 'bundle');
          if (!lstatSync(bundle, { throwIfNoEntry: false })) mkdirSync(bundle);
        }
        writeFileSync(path.join(directory, ...parts), content, { flag: 'wx', mode: 0o600 });
      }
    };
    writeSet('release', staged.release); writeSet('gate', staged.gate);
    if (staged.admin) writeSet('admin', staged.admin);
    writeFileSync(path.join(stageDirectory, 'run.json'), canonicalJson(staged.run), { flag: 'wx', mode: 0o600 });
    writeFileSync(path.join(stageDirectory, 'artifacts.json'), canonicalJson(staged.artifacts), { flag: 'wx', mode: 0o600 });
    if (staged.chain) {
      writeSet('chain-release', staged.chain.release); writeSet('chain-gate', staged.chain.gate);
      writeSet('chain-recovery', staged.chain.recovery);
      writeFileSync(path.join(stageDirectory, 'chain-run.json'), canonicalJson(staged.chain.run), { flag: 'wx', mode: 0o600 });
      writeFileSync(path.join(stageDirectory, 'chain-artifacts.json'), canonicalJson(staged.chain.artifacts), { flag: 'wx', mode: 0o600 });
    }
    const verifiedSource = verifyRecoveryArtifactProvenance({ recoveryProvenance,
      releaseBundle: { directory: path.join(stageDirectory, 'release') }, gateEvidence: { directory: path.join(stageDirectory, 'gate') } });
    await resolveB2HistoricalAuthority({ verifiedSource, descriptorBytes: readTrustedB2HistoricalDescriptorBytes(historicalRuntimeClosure,
      recoveryProvenance), provider, historicalRuntimeClosure });
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  } catch (error) {
    if (created) {
      try {
        const removeContained = directory => {
          if (realpathSync(directory) !== directory || lstatSync(directory).isSymbolicLink()) throw new Error('blocked');
          for (const name of readdirSync(directory)) {
            const target = path.join(directory, name);
            const stat = lstatSync(target);
            if (stat.isSymbolicLink() || realpathSync(target) !== target
              || path.relative(stageDirectory, target).startsWith(`..${path.sep}`)) throw new Error('blocked');
            if (stat.isDirectory()) removeContained(target);
            else if (stat.isFile()) unlinkSync(target);
            else throw new Error('blocked');
          }
          rmdirSync(directory);
        };
        removeContained(stageDirectory);
      } catch { fail('PRIVATE_AUTHORITY_CLEANUP_FAILED'); }
    }
    if (errors.has(error)) throw error;
    fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
}

/** Recovery provenance is created only after an external/current closure
 * capability exists. Historical files are fetched as bytes and never imported. */
export async function loadProtectedB2RecoveryRuntime(options) {
  try {
    const data = ownData(options, ['bootstrapCapability', 'environment', 'policyBytes', 'runId', 'runAttempt',
      'releaseBundle', 'gateEvidence', 'fetchImpl']);
    const bootstrapState = bootstraps.get(data.bootstrapCapability.value);
    if (!bootstrapState) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    const environment = data.environment.value;
    if (readClosurePin(environment) !== bootstrapState.runtimeClosure.closure_sha256) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    const authorizationSha256 = protectedEnvironmentValue(environment, 'NELYON_B2_RECOVERY_AUTHORIZATION_SHA256', HEX64);
    const policySha256 = protectedEnvironmentValue(environment, 'NELYON_RELEASE_POLICY_SHA256', HEX64);
    const githubToken = protectedEnvironmentValue(environment, 'GITHUB_TOKEN', /^[\x21-\x7e]{1,512}$/u);
    const policyBytes = copyBytes(data.policyBytes.value);
    const fetchImpl = data.fetchImpl.value;
    if (typeof fetchImpl !== 'function' || types.isProxy(fetchImpl)
      || typeof data.runId.value !== 'string' || !/^[1-9][0-9]*$/u.test(data.runId.value)
      || (data.runAttempt.value !== null
        && (!Number.isSafeInteger(data.runAttempt.value) || data.runAttempt.value < 1))) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    const releaseBundle = ownData(data.releaseBundle.value, ['directory']);
    const gateEvidence = ownData(data.gateEvidence.value, ['directory']);
    for (const value of [releaseBundle.directory.value, gateEvidence.directory.value]) {
      if (typeof value !== 'string' || !path.isAbsolute(value)) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    }
    if (sha256(policyBytes) !== policySha256) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    validatePolicy(JSON.parse(policyBytes.toString('utf8')));
    const providerConfig = readTrustedRecoveryEnvironment(environment);
    const provider = createR2PrivateAuthorityProvider({ accountId: providerConfig.accountId, bucket: providerConfig.bucket,
      accessKeyId: providerConfig.accessKeyId, secretAccessKey: providerConfig.secretAccessKey,
      fetch: fetchImpl, timeoutMs: providerConfig.timeoutMs });
    const authorizationBytes = await provider.getBySha256(authorizationSha256);
    let approvedSource;
    try {
      approvedSource = loadB2RecoveryAuthorization({ authorizationBytes, expectedAuthorizationSha256: authorizationSha256,
        policyBytes, expectedPolicySha256: policySha256, runId: data.runId.value, runAttempt: data.runAttempt.value });
    } finally { authorizationBytes.fill(0); }
    const loader = createB2RecoveryProvenanceLoader({ fetchImpl, githubToken,
      repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
      workflowPath: '.github/workflows/nelyon-production-release.yml', apiOrigin: 'https://api.github.com' });
    const recoveryProvenance = await loader.loadExactAttempt({ approvedSource });
    const chainProvenance = approvedSource.runId === recoveryProvenance.runId
      ? null : await loader.loadExactChain({ recoveryProvenance });
    const historicalRuntimeClosure = await loader.loadHistoricalRuntimeClosure({ recoveryProvenance });
    const verifiedSource = verifyRecoveryArtifactProvenance({ recoveryProvenance,
      releaseBundle: { directory: releaseBundle.directory.value }, gateEvidence: { directory: gateEvidence.directory.value } });
    const output = Object.freeze({ recoveryProvenance, historicalRuntimeClosure, verifiedSource, chainProvenance });
    recoveryRuntimes.set(output, { bootstrapCapability: data.bootstrapCapability.value, fetchImpl,
      policySha256, authorizationSha256 });
    return output;
  } catch (error) {
    if (errors.has(error)) throw error;
    fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
}

export async function resolveProtectedB2RecoveryAuthority(options) {
  try {
    const data = ownData(options, ['bootstrapCapability', 'environment', 'recoveryRuntime', 'fetchImpl']);
    const bootstrapState = bootstraps.get(data.bootstrapCapability.value);
    const recoveryState = recoveryRuntimes.get(data.recoveryRuntime.value);
    if (!bootstrapState || !recoveryState
      || recoveryState.bootstrapCapability !== data.bootstrapCapability.value) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    if (protectedEnvironmentValue(data.environment.value, 'NELYON_RELEASE_POLICY_SHA256', HEX64) !== recoveryState.policySha256
      || protectedEnvironmentValue(data.environment.value, 'NELYON_B2_RECOVERY_AUTHORIZATION_SHA256', HEX64)
        !== recoveryState.authorizationSha256) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    const fetchImpl = data.fetchImpl.value;
    if (typeof fetchImpl !== 'function' || types.isProxy(fetchImpl)) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
    const config = readTrustedRecoveryEnvironment(data.environment.value);
    if (config.runtimeClosureSha256 !== bootstrapState.runtimeClosure.closure_sha256) {
      fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    }
    const recoveryRuntime = data.recoveryRuntime.value;
    const provider = createR2PrivateAuthorityProvider({ accountId: config.accountId, bucket: config.bucket,
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, fetch: fetchImpl,
      timeoutMs: config.timeoutMs });
    return await resolveB2HistoricalAuthority({ verifiedSource: recoveryRuntime.verifiedSource,
      descriptorBytes: readTrustedB2HistoricalDescriptorBytes(recoveryRuntime.historicalRuntimeClosure,
        recoveryRuntime.recoveryProvenance),
      provider,
      historicalRuntimeClosure: recoveryRuntime.historicalRuntimeClosure });
  } catch (error) {
    if (errors.has(error)) throw error;
    fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
}

export function createPrivateAuthorityRuntime(options) {
  const runtime = runtimeOptions(options);
  return Object.freeze({ async execute(invocation) {
    const parsedInvocation = parseInvocation(invocation);
    const state = runtime.bootstrapState;
    const outputTarget = verificationTarget(runtime.environment, parsedInvocation.verificationOutput);
    const requestedAt = runtime.now();
    let loaded;
    try {
      loaded = await runtime.host.loadPublicInputs({
        action: parsedInvocation.action,
        inputs: parsedInvocation.inputs,
        now: requestedAt,
      });
    } catch { fail('PRIVATE_AUTHORITY_STAGE_BLOCKED'); }
    const policySha256 = protectedEnvironmentValue(runtime.environment, 'NELYON_RELEASE_POLICY_SHA256', HEX64);
    const { descriptorBytes, manifest, request } = publicInputs(loaded, { policySha256 });
    if (canonicalJson(manifest.runtime_closure) !== canonicalJson(state.runtimeClosure)) fail('RELEASE_AUTHORITY_CONTEXT_INVALID');
    const recoveryAction = ACTION_STAGE[parsedInvocation.action] === 'recovery';
    const config = recoveryAction
      ? readTrustedRecoveryEnvironment(runtime.environment)
      : readTrustedAuthorityEnvironment(runtime.environment);
    if (config.runtimeClosureSha256 !== state.runtimeClosure.closure_sha256) fail('PRIVATE_AUTHORITY_STAGE_BLOCKED');
    if (recoveryAction && !runtime.recoveryRuntime) fail('PRIVATE_AUTHORITY_SOURCE_INVALID');
    const provider = recoveryAction ? null : createR2PrivateAuthorityProvider({ accountId: config.accountId,
      bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
      fetch: runtime.fetchImpl, timeoutMs: config.timeoutMs });
    const parsedDescriptor = recoveryAction ? null : parseDescriptorBeforeFetch(descriptorBytes, config, manifest, runtime.integratedSource, request);
    let authorityBytes;
    let authorityJson;
    let verification;
    try {
      let authorityContext;
      let authorizationAt;
      if (recoveryAction) {
        authorizationAt = runtime.now();
        authorityContext = await resolveProtectedB2RecoveryAuthority({ bootstrapCapability: runtime.bootstrapCapability,
          environment: runtime.environment, recoveryRuntime: runtime.recoveryRuntime, fetchImpl: runtime.fetchImpl });
      } else {
        try { authorityBytes = await provider.getBySha256(config.authoritySha256); }
        catch (error) {
          const code = error instanceof Error && Object.hasOwn(error, 'code') ? error.code : null;
          fail(code === 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE'
            ? 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE' : 'PRIVATE_AUTHORITY_PROVIDER_INVALID');
        }
        try {
          authorityJson = textDecoder.decode(authorityBytes);
          if (!Buffer.from(authorityJson, 'utf8').equals(authorityBytes)) fail('PRIVATE_AUTHORITY_PROVIDER_INVALID');
        } catch { fail('PRIVATE_AUTHORITY_PROVIDER_INVALID'); }
        authorizationAt = runtime.now();
        const contract = parsedDescriptor.contract;
        try {
          authorityContext = createReleaseAuthorityContext({ descriptorBytes,
            expectedDescriptorSha256: config.descriptorSha256, phase: 'web-control-centers-b2', transitionId: contract.id,
            baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
            integrationBaseSha: contract.integration_base_sha, requestedAt: authorizationAt,
            authorityJson, expectedPrivateAuthoritySha256: config.authoritySha256 });
          verifyB2VaultEdgeParity(authorityContext, authorizationAt);
        } catch { fail('RELEASE_AUTHORITY_CONTEXT_INVALID'); }
      }
      const receipt = publicAuthorityReceipt(authorityContext);
      let result;
      try {
        result = await runtime.host.dispatch({
          action: parsedInvocation.action,
          inputs: parsedInvocation.inputs,
          authorityContext,
          receipt,
          manifest,
          now: authorizationAt,
          recoveryRuntime: runtime.recoveryRuntime,
        });
      } catch (source) {
        const error = closedError('PRIVATE_AUTHORITY_STAGE_BLOCKED');
        const diagnostic = readSnapshotDiagnostic(source) ?? readB2ExplicitConnectionDiagnostic(source);
        if (diagnostic) diagnostics.set(error, diagnostic);
        throw error;
      }
      const completionAt = runtime.now();
      try {
        if (recoveryAction) {
          assertAuthorityReceiptMatch(receipt, publicAuthorityReceipt(authorityContext));
        } else {
        const completionContext = createReleaseAuthorityContext({ descriptorBytes,
          expectedDescriptorSha256: config.descriptorSha256, phase: 'web-control-centers-b2', transitionId: parsedDescriptor.contract.id,
          baselineSha: parsedDescriptor.contract.baseline_sha, reviewedSourceSha: parsedDescriptor.contract.reviewed_source_sha,
          integrationBaseSha: parsedDescriptor.contract.integration_base_sha, requestedAt: completionAt,
          authorityJson, expectedPrivateAuthoritySha256: config.authoritySha256 });
        assertAuthorityReceiptMatch(receipt, publicAuthorityReceipt(completionContext));
        }
      } catch { fail('RELEASE_AUTHORITY_CONTEXT_INVALID'); }
      verification = validateVerification(parsedInvocation.action, receipt, result);
    } finally {
      if (authorityBytes) {
        try { authorityBytes.fill(0); } catch { fail('PRIVATE_AUTHORITY_CLEANUP_FAILED'); }
      }
    }
    publishVerification(outputTarget, verification);
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  } });
}
