#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';

import {
  bootstrapPrivateAuthorityRuntime,
  createPrivateAuthorityRuntime,
  loadProtectedB2RecoveryRuntime,
  readPrivateAuthorityDiagnostic,
  stageProtectedB2RecoverySource,
} from './nelyon-private-authority-runtime.mjs';
import {
  compileB2SourceParity,
  verifyB2DatabaseSourcePreflight,
  createTrustedB2DeployedFunctionInventory,
  createTrustedB2ReviewedTree,
} from './nelyon-b2-source-parity.mjs';
import { createHermeticMigrationWorkspace, readApprovedMigrationFiles } from './nelyon-b2-hermetic-workspace.mjs';
import { createB2Executor, createB2HttpAdapter, runB2ProtectedDryRun, runB2ProtectedFunctions, runB2ProtectedMigration } from './nelyon-b2-explicit-connection.mjs';
import { canonicalB2FunctionDeploymentProof } from './nelyon-b2-function-deployment-proof.mjs';
import {
  readTrustedB2HistoricalDescriptorBytes,
  readTrustedB2RecoveryFunctionDeploymentProof,
} from './nelyon-b2-recovery-provenance.mjs';
import {
  canonicalJson,
  b2HistoricalSnapshotBinding,
  sha256Hex,
  verifyB2IntegratedSource,
  verifyB2ProtectedAuthority,
  verifyB2HistoricalIntegratedSource,
  verifyB2VaultEdgeParity,
  parseFunctionConfig,
  verifyFunctionContractAtRepository,
  runCli as runReleaseCli,
  validatePolicy,
  verifyAdminRecoveryPostcheckChainProvenance,
  verifyAdminRecoverySourceProvenance,
  verifyPendingB2RecoveryAuthority,
} from './nelyon-production-release.mjs';
import {
  captureB2AuthorityObservation,
  captureProductionSnapshot,
  readSnapshotDiagnostic,
  verifyB2AuthorityObservation,
  verifyProductionPreSnapshot,
  verifyProductionRecoverySnapshot,
  verifyProductionSnapshotPair,
} from './nelyon-production-snapshot-adapter.mjs';
import {
  B2_AUTHORITY_INTEGRATION_BASE_SHA,
  createB2AuthorityIssuanceGithubObserver,
  issueB2PrivateAuthority,
  prepareB2AuthorityIssuance,
  readB2AuthorityPreparationSummary,
} from './nelyon-private-authority-issuer.mjs';
import { createR2PrivateAuthorityPublisher } from './nelyon-private-authority-provider.mjs';

const ACTIONS = new Set([
  'authority-observe',
  'authority-issue',
  'authority-proof',
  'preflight-release',
  'authorize-refresh',
  'dryrun-migrations',
  'apply-migrations',
  'deploy-functions',
  'stage-b2-recovery-source',
  'revalidate',
  'verify-gate',
  'pre-snapshot',
  'verify-pre-snapshot',
  'post-snapshot',
  'postcheck',
  'verify-recovery-source',
  'recovery-authority-proof',
  'revalidate-b2-recovery',
  'revalidate-b2-admin-recovery',
  'verify-b2-recovery-gate',
  'verify-b2-admin-recovery-gate',
  'admin-recovery-authority-proof',
  'recovery-snapshot',
  'postcheck-recovery',
  'verify-admin-recovery-source',
  'verify-admin-recovery-postcheck-chain',
  'postcheck-admin-recovery',
  'verify-admin-recovery-cloudflare-prestate',
]);
let functionProofCheckpointSequence = 0;
export function writeFunctionProofCheckpoint(target, proof) {
  const temporary = `${target}.tmp-${process.pid}-${++functionProofCheckpointSequence}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, canonicalB2FunctionDeploymentProof(proof), { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, target);
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(target), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}
const COMMON_FLAGS = Object.freeze({
  '--policy': 'policy',
  '--request': 'request',
  '--bundle': 'bundle',
  '--verification-output': 'verificationOutput',
});
const AUTHORITY_OBSERVE_FLAGS = Object.freeze({
  '--policy': 'policy',
  '--approved-sha': 'approvedSha',
  '--approved-tree': 'approvedTree',
  '--verification-output': 'verificationOutput',
});
const AUTHORITY_ISSUE_FLAGS = Object.freeze({
  '--policy': 'policy',
  '--approved-sha': 'approvedSha',
  '--approved-tree': 'approvedTree',
  '--integration-base-sha': 'integrationBaseSha',
  '--observation-run': 'observationRun',
  '--observation-sha256': 'observationSha256',
  '--release-id': 'releaseId',
  '--verification-output': 'verificationOutput',
});
const CHAIN_FLAGS = Object.freeze({ '--chain-run': 'chainRun', '--chain-artifacts': 'chainArtifacts',
  '--chain-release-bundle': 'chainReleaseBundle', '--chain-gate-evidence': 'chainGateEvidence',
  '--chain-recovery-evidence': 'chainRecoveryEvidence' });
const CHAIN_ACTIONS = new Set(['admin-recovery-authority-proof', 'revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate', 'verify-admin-recovery-source', 'postcheck-admin-recovery',
  'verify-admin-recovery-cloudflare-prestate']);
const ACTION_ADDITIONAL_FLAGS = Object.freeze({
  'authority-proof': {},
  'dryrun-migrations': { '--current-gate':'currentGate', '--pre-snapshot':'preSnapshot', '--binary-path':'binaryPath', '--stage-output':'stageOutput' },
  'apply-migrations': { '--current-gate':'currentGate', '--pre-snapshot':'preSnapshot', '--binary-path':'binaryPath', '--stage-output':'stageOutput' },
  'deploy-functions': { '--current-gate':'currentGate', '--pre-snapshot':'preSnapshot', '--binary-path':'binaryPath', '--stage-output':'stageOutput' },
  'stage-b2-recovery-source': { '--recovery-source-run': 'recoverySourceRun' },
  'preflight-release': { '--compiler-sha256': 'compilerSha256', '--remote-evidence': 'remoteEvidence', '--stage-output': 'stageOutput' },
  'authorize-refresh': { '--policy-sha256': 'policySha256', '--compiler-sha256': 'compilerSha256',
    '--environment': 'environmentEvidence', '--branch-policies': 'branchPolicies', '--approvals': 'approvals',
    '--runs': 'runs', '--auto-deploy-expected': 'autoDeployExpected', '--stage-output': 'stageOutput' },
  revalidate: { '--compiler-sha256': 'compilerSha256', '--remote-evidence': 'remoteEvidence',
    '--stage-output': 'stageOutput' },
  'verify-gate': { '--policy-sha256': 'policySha256', '--compiler-sha256': 'compilerSha256',
    '--environment': 'environmentEvidence', '--branch-policies': 'branchPolicies', '--approvals': 'approvals',
    '--runs': 'runs', '--auto-deploy-expected': 'autoDeployExpected', '--stage-output': 'stageOutput' },
  'pre-snapshot': { '--snapshot-output': 'snapshotOutput' },
  'verify-pre-snapshot': { '--manifest': 'manifest', '--pre-snapshot': 'preSnapshot', '--stage-output': 'stageOutput' },
  'post-snapshot': { '--pre-snapshot': 'preSnapshot', '--snapshot-output': 'snapshotOutput' },
  postcheck: { '--manifest': 'manifest', '--pre-snapshot': 'preSnapshot', '--post-snapshot': 'postSnapshot',
    '--function-deployment-proof': 'functionDeploymentProof', '--stage-output': 'stageOutput' },
  'verify-recovery-source': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--stage-output': 'stageOutput' },
  'recovery-authority-proof': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence' },
  'revalidate-b2-recovery': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--compiler-sha256': 'compilerSha256', '--remote-evidence': 'remoteEvidence', '--stage-output': 'stageOutput' },
  'revalidate-b2-admin-recovery': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--admin-evidence': 'adminEvidence', '--compiler-sha256': 'compilerSha256',
    '--remote-evidence': 'remoteEvidence', '--stage-output': 'stageOutput' },
  'verify-b2-recovery-gate': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--policy-sha256': 'policySha256', '--compiler-sha256': 'compilerSha256', '--environment': 'environmentEvidence',
    '--branch-policies': 'branchPolicies', '--approvals': 'approvals', '--runs': 'runs',
    '--auto-deploy-expected': 'autoDeployExpected', '--revalidated': 'revalidated', '--stage-output': 'stageOutput' },
  'verify-b2-admin-recovery-gate': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence', '--admin-evidence': 'adminEvidence',
    '--policy-sha256': 'policySha256', '--compiler-sha256': 'compilerSha256', '--environment': 'environmentEvidence',
    '--branch-policies': 'branchPolicies', '--approvals': 'approvals', '--runs': 'runs',
    '--auto-deploy-expected': 'autoDeployExpected', '--revalidated': 'revalidated', '--stage-output': 'stageOutput' },
  'admin-recovery-authority-proof': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--admin-evidence': 'adminEvidence' },
  'recovery-snapshot': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--current-gate': 'currentGate', '--snapshot-output': 'snapshotOutput' },
  'postcheck-recovery': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--current-gate': 'currentGate', '--verified-source': 'verifiedSource',
    '--current-snapshot': 'currentSnapshot', '--stage-output': 'stageOutput' },
  'verify-admin-recovery-source': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--admin-evidence': 'adminEvidence', '--stage-output': 'stageOutput' },
  'verify-admin-recovery-postcheck-chain': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--postcheck-recovery-evidence': 'postcheckRecoveryEvidence', '--stage-output': 'stageOutput' },
  'postcheck-admin-recovery': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--admin-evidence': 'adminEvidence',
    '--current-gate': 'currentGate', '--verified-source': 'verifiedSource', '--current-snapshot': 'currentSnapshot',
    '--admin-manifest': 'adminManifest', '--build': 'build',
    '--stage-output': 'stageOutput' },
  'verify-admin-recovery-cloudflare-prestate': { '--recovery-source-run': 'recoverySourceRun', '--run': 'run',
    '--artifacts': 'artifacts', '--release-bundle': 'releaseBundle', '--gate-evidence': 'gateEvidence',
    '--admin-evidence': 'adminEvidence',
    '--verified-source': 'verifiedSource', '--previous': 'previous', '--routes': 'routes', '--stage-output': 'stageOutput' },
});
const KNOWN_CODES = new Set([
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
const SUCCESS = Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });

function arrayData(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length !== 0) throw new Error('invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || Object.keys(descriptors).length !== length + 1) throw new Error('invalid');
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('invalid');
    result.push(descriptor.value);
  }
  return result;
}

function text(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('invalid');
  return value;
}

function parse(argv) {
  const values = arrayData(argv);
  if (values.length < 1 || !ACTIONS.has(values[0])) throw new Error('invalid');
  const requiredFlags = values[0] === 'authority-observe'
    ? AUTHORITY_OBSERVE_FLAGS
    : values[0] === 'authority-issue'
      ? AUTHORITY_ISSUE_FLAGS
    : { ...COMMON_FLAGS, ...ACTION_ADDITIONAL_FLAGS[values[0]] };
  const flags = Object.freeze({ ...requiredFlags, ...(CHAIN_ACTIONS.has(values[0]) ? CHAIN_FLAGS : {}) });
  const required = Object.keys(requiredFlags);
  const parsed = new Map();
  for (let index = 1; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (typeof flag !== 'string' || !Object.hasOwn(flags, flag) || parsed.has(flag)
      || index + 1 >= values.length) throw new Error('invalid');
    parsed.set(flag, text(value));
  }
  if (required.some(flag => !parsed.has(flag))) throw new Error('invalid');
  if (Object.keys(CHAIN_FLAGS).some(flag => parsed.has(flag))
    && Object.keys(CHAIN_FLAGS).some(flag => !parsed.has(flag))) throw new Error('invalid');
  const inputs = {};
  for (const [flag, key] of Object.entries(flags)) {
    if (key !== 'verificationOutput' && parsed.has(flag)) inputs[key] = parsed.get(flag);
  }
  return Object.freeze({
    action: values[0],
    inputs: Object.freeze(inputs),
    verificationOutput: parsed.get('--verification-output'),
  });
}

function trustedHost(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== 3 || ['execute', 'stdout', 'stderr'].some(key => !Object.hasOwn(descriptors, key))) {
    throw new Error('invalid');
  }
  for (const key of keys) if (!Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) throw new Error('invalid');
  const execute = descriptors.execute.value;
  const stdout = descriptors.stdout.value;
  const stderr = descriptors.stderr.value;
  if (typeof execute !== 'function' || types.isProxy(execute)) throw new Error('invalid');
  const sinks = [];
  for (const sink of [stdout, stderr]) {
    if (!sink || typeof sink !== 'object' || types.isProxy(sink)) throw new Error('invalid');
    let current = sink;
    let write;
    while (current && !write) {
      write = Object.getOwnPropertyDescriptor(current, 'write');
      current = Object.getPrototypeOf(current);
    }
    if (!write || !Object.hasOwn(write, 'value') || typeof write.value !== 'function' || types.isProxy(write.value)) throw new Error('invalid');
    sinks.push(Object.freeze({ write: write.value.bind(sink) }));
  }
  return { execute, stdout: sinks[0], stderr: sinks[1] };
}

function sanitizedCode(error) {
  try {
    if (types.isProxy(error) || !(error instanceof Error)) return 'PRIVATE_AUTHORITY_STAGE_BLOCKED';
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const code = descriptors.code;
    const message = descriptors.message;
    const stack = descriptors.stack;
    if (!code || !message || !stack || !Object.hasOwn(code, 'value')
      || !Object.hasOwn(message, 'value') || !Object.hasOwn(stack, 'value')
      || !KNOWN_CODES.has(code.value)
      || message.value !== 'Private authority operation blocked'
      || stack.value !== 'Error: Private authority operation blocked') {
      return 'PRIVATE_AUTHORITY_STAGE_BLOCKED';
    }
    return code.value;
  } catch {
    return 'PRIVATE_AUTHORITY_STAGE_BLOCKED';
  }
}

function writeStatus(host, code, diagnostic) {
  const stdout = code === null
    ? '{"schemaVersion":1,"result":"VERIFIED","releaseReady":false}\n'
    : `${JSON.stringify({ schemaVersion: 1, result: 'BLOCKED', releaseReady: false, code,
      ...(diagnostic ? { diagnostic } : {}) })}\n`;
  try {
    host.stdout.write(stdout);
    if (code !== null) host.stderr.write(`DENY ${code}\n`);
  } catch {
    return false;
  }
  return true;
}

function isClosedSuccess(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== 3 || !['schemaVersion', 'result', 'releaseReady'].every(key => Object.hasOwn(descriptors, key))) {
      return false;
    }
    if (keys.some(key => !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) return false;
    return descriptors.schemaVersion.value === SUCCESS.schemaVersion
      && descriptors.result.value === SUCCESS.result
      && descriptors.releaseReady.value === SUCCESS.releaseReady;
  } catch {
    return false;
  }
}

function boundedRead(file, maximum) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error('blocked');
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count < 1) throw new Error('blocked');
      offset += count;
    }
    const overflow = Buffer.allocUnsafe(1);
    if (readSync(descriptor, overflow, 0, 1, offset) !== 0) throw new Error('blocked');
    return bytes;
  } catch {
    throw new Error('blocked');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* closed fail-safe by caller */ }
    }
  }
}

function loadProductionPublicInputs(inputs, repositoryRoot) {
  const bundle = path.resolve(inputs.bundle);
  return Object.freeze({
    descriptorBytes: boundedRead(path.resolve(repositoryRoot,
      '.github/nelyon-web-control-centers-b2-release-descriptor.json'), 256 * 1024),
    manifestBytes: boundedRead(path.resolve(bundle, 'manifest.json'), 2 * 1024 * 1024),
    manifestDigestBytes: boundedRead(path.resolve(bundle, 'manifest.sha256'), 128),
    policyBytes: boundedRead(path.resolve(inputs.policy), 2 * 1024 * 1024),
    requestBytes: boundedRead(path.resolve(inputs.request), 256 * 1024),
  });
}

export function assertProductionInvocationIdentity(publicInputs, environment) {
  const request = jsonBytes(publicInputs.requestBytes);
  const expected = {
    runId: environmentText(environment, 'GITHUB_RUN_ID', /^[1-9][0-9]*$/u),
    runAttempt: Number(environmentText(environment, 'GITHUB_RUN_ATTEMPT', /^[1-9][0-9]*$/u)),
    approvedSha: environmentText(environment, 'NELYON_APPROVED_SHA', /^[0-9a-f]{40}$/u),
    repository: environmentText(environment, 'GITHUB_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    workflowRef: environmentText(environment, 'GITHUB_WORKFLOW_REF', /^.{1,1024}$/u),
  };
  if (String(request.runId) !== expected.runId || request.runAttempt !== expected.runAttempt
    || request.approvedSha !== expected.approvedSha || request.mainSha !== expected.approvedSha
    || request.repository !== expected.repository || request.workflowRef !== expected.workflowRef) throw new Error('blocked');
}

function closureEnvironment(environment) {
  const descriptor = Object.getOwnPropertyDescriptor(environment,
    'NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
    throw new Error('blocked');
  }
  return Object.freeze({ NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: descriptor.value });
}

// Node's native process.env has an exotic prototype. Adapt only that exact
// object (or plain test inputs), after bootstrap; never weaken runtime intake.
export function copyProductionEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || types.isProxy(environment)
    || (environment !== process.env && ![Object.prototype, null].includes(Object.getPrototypeOf(environment)))
    || Object.getOwnPropertySymbols(environment).length !== 0) throw new Error('blocked');
  const copy = Object.create(null);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(environment))) {
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string') {
      throw new Error('blocked');
    }
    copy[name] = descriptor.value;
  }
  return Object.freeze(copy);
}

function jsonBytes(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('blocked');
  return value;
}

function environmentText(environment, name, pattern) {
  const descriptor = Object.getOwnPropertyDescriptor(environment, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
    || typeof descriptor.value !== 'string' || !pattern.test(descriptor.value)) throw new Error('blocked');
  return descriptor.value;
}

export function adminRecoveryRequiresProtectedB2Runtime({ request, environment }) {
  if (request?.mode !== 'admin_recovery') return true;
  return environmentText(environment, 'NELYON_ADMIN_RECOVERY_B2_REQUIRED', /^(?:true|false)$/u) === 'true';
}

function safeRunnerPath(environment, value, existing) {
  const declaredRoot = path.resolve(environmentText(environment, 'RUNNER_TEMP', /^.{1,4096}$/u));
  let root;
  try { root = realpathSync(declaredRoot); } catch { throw new Error('blocked'); }
  const rootStat = lstatSync(root);
  if (root !== declaredRoot || rootStat.isSymbolicLink() || !rootStat.isDirectory()
    || typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('blocked');
  const target = path.resolve(value);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('blocked');
  }
  const parent = path.dirname(target);
  let actualParent;
  try { actualParent = realpathSync(parent); } catch { throw new Error('blocked'); }
  const parentStat = lstatSync(parent);
  if (actualParent !== parent || parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error('blocked');
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (existing) {
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || realpathSync(target) !== target) throw new Error('blocked');
  } else if (stat) throw new Error('blocked');
  return target;
}

const safeStageOutput = (environment, value) => safeRunnerPath(environment, value, false);
const safeStageInput = (environment, value) => safeRunnerPath(environment, value, true);

async function deployedFunctionRows(environment, fetchImpl) {
  const token = environmentText(environment, 'SUPABASE_ACCESS_TOKEN', /^[\x21-\x7e]{1,2048}$/u);
  const response = await fetchImpl('https://api.supabase.com/v1/projects/aewwdlvbwpczqyvkwvvj/functions', {
    method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response?.ok) throw new Error('blocked');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 2 || bytes.length > 2 * 1024 * 1024) throw new Error('blocked');
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('blocked');
  return rows;
}

function inventoryFromRows(rows, capturedAt) {
  const names = rows.map(row => row?.name ?? row?.slug);
  if (names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) throw new Error('blocked');
  return Object.freeze({ schemaVersion: 1, complete: true, capturedAt, names: [...names].sort() });
}

function readReviewedFile(repositoryRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.startsWith('/')
    || relativePath.split('/').includes('..')) throw new Error('blocked');
  return boundedRead(path.resolve(repositoryRoot, relativePath), 4 * 1024 * 1024);
}

function currentSourceParity({ authorityContext, descriptorBytes, manifest, repositoryRoot, functionRows, capturedAt, integratedSource }) {
  const contracts = manifest.resources?.function_contracts;
  const expected = authorityContext.descriptor.contract.functions;
  if (!Array.isArray(contracts) || !Array.isArray(expected)) throw new Error('blocked');
  const filePaths = new Set([authorityContext.descriptor.contract.productive_changes?.at(-1)?.path]);
  for (const contract of contracts) for (const file of contract.source_files ?? []) filePaths.add(file.path);
  if (filePaths.has(undefined)) throw new Error('blocked');
  const config = parseFunctionConfig(readReviewedFile(repositoryRoot, 'supabase/config.toml').toString('utf8'));
  const reviewedTree = createTrustedB2ReviewedTree({ approvedSha: manifest.identity.approved_sha,
    files: [...filePaths].sort().map(file => ({ path: file, bytes: readReviewedFile(repositoryRoot, file) })),
    functionConfigs: expected.map(item => ({ name: item.name, config: config[item.name] })) });
  const deployedFunctionInventory = createTrustedB2DeployedFunctionInventory({ capturedAt,
    functions: expected.map(item => {
      const row = functionRows.find(candidate => (candidate.name ?? candidate.slug) === item.name);
      const deployedSha256 = row?.ezbr_sha256 ?? row?.source_sha256;
      if (typeof deployedSha256 !== 'string') throw new Error('blocked');
      return { name: item.name, deployedSha256 };
    }) });
  return compileB2SourceParity({ authorityContext, manifest, descriptorBytes, reviewedTree,
    deployedFunctionInventory, capturedAt, ...(integratedSource ? { integratedSource } : {}) });
}

async function historicalGitFile({ environment, fetchImpl, sourceSha, relativePath }) {
  if (typeof sourceSha !== 'string' || !/^[0-9a-f]{40}$/u.test(sourceSha)
    || typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.startsWith('/')
    || relativePath.split('/').includes('..')) throw new Error('blocked');
  const token = environmentText(environment, 'GITHUB_TOKEN', /^[\x21-\x7e]{1,512}$/u);
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(`https://api.github.com/repos/andressan101989/ClipDAG-9bh0w4-26004-20260525/contents/${encoded}?ref=${sourceSha}`, {
    method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response?.ok) throw new Error('blocked');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 2 || body.length > 6 * 1024 * 1024) throw new Error('blocked');
  const value = JSON.parse(body.toString('utf8'));
  if (value?.path !== relativePath || value.type !== 'file' || value.encoding !== 'base64'
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 4 * 1024 * 1024
    || typeof value.content !== 'string' || typeof value.sha !== 'string' || !/^[0-9a-f]{40}$/u.test(value.sha)) {
    throw new Error('blocked');
  }
  const compact = value.content.replaceAll('\n', '');
  const bytes = Buffer.from(compact, 'base64');
  const blob = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
  if (bytes.length !== value.size || bytes.toString('base64') !== compact || blob !== value.sha) throw new Error('blocked');
  return bytes;
}

async function historicalSourceParity({ authorityContext, recoveryRuntime, environment, fetchImpl, capturedAt }) {
  const { manifest, edgeFunctions } = b2HistoricalSnapshotBinding({
    verifiedSource: recoveryRuntime.verifiedSource, authorityContext,
  });
  const sourceSha = manifest.identity.approved_sha;
  const contracts = manifest.resources?.function_contracts;
  const expected = authorityContext.descriptor.contract.functions;
  if (!Array.isArray(contracts) || !Array.isArray(expected)) throw new Error('blocked');
  const filePaths = new Set([authorityContext.descriptor.contract.productive_changes?.at(-1)?.path]);
  for (const contract of contracts) for (const file of contract.source_files ?? []) filePaths.add(file.path);
  if (filePaths.has(undefined)) throw new Error('blocked');
  const files = [];
  for (const file of [...filePaths].sort()) files.push({ path: file,
    bytes: await historicalGitFile({ environment, fetchImpl, sourceSha, relativePath: file }) });
  const configBytes = await historicalGitFile({ environment, fetchImpl, sourceSha, relativePath: 'supabase/config.toml' });
  const config = parseFunctionConfig(configBytes.toString('utf8'));
  const reviewedTree = createTrustedB2ReviewedTree({ approvedSha: sourceSha, files,
    functionConfigs: expected.map(item => ({ name: item.name, config: config[item.name] })) });
  const deployedFunctionInventory = createTrustedB2DeployedFunctionInventory({ capturedAt,
    functions: edgeFunctions.map(row => ({ name: row.slug, deployedSha256: row.ezbr_sha256 })) });
  return compileB2SourceParity({ authorityContext, manifest,
    integratedSource: verifyB2HistoricalIntegratedSource(recoveryRuntime),
    descriptorBytes: readTrustedB2HistoricalDescriptorBytes(recoveryRuntime.historicalRuntimeClosure,
      recoveryRuntime.recoveryProvenance),
    reviewedTree, deployedFunctionInventory, capturedAt });
}

function releaseArgs(action, inputs) {
  const common = ['--policy', inputs.policy, '--request', inputs.request];
  const manifest = path.resolve(inputs.bundle, 'manifest.json');
  switch (action) {
    case 'preflight-release':
    case 'revalidate': return [action, ...common, '--bundle', inputs.bundle,
      '--compiler-sha256', inputs.compilerSha256, '--remote-evidence', inputs.remoteEvidence,
      '--output', inputs.stageOutput];
    case 'revalidate-b2-recovery': return ['revalidate-b2-recovery', ...common, '--bundle', inputs.bundle,
      '--compiler-sha256', inputs.compilerSha256, '--remote-evidence', inputs.remoteEvidence, '--output', inputs.stageOutput];
    case 'revalidate-b2-admin-recovery': return ['revalidate-b2-admin-recovery', ...common, '--bundle', inputs.bundle,
      '--compiler-sha256', inputs.compilerSha256, '--remote-evidence', inputs.remoteEvidence, '--output', inputs.stageOutput];
    case 'verify-b2-recovery-gate': return ['verify-b2-recovery-gate', ...common, '--bundle', inputs.bundle,
      '--policy-sha256', inputs.policySha256, '--compiler-sha256', inputs.compilerSha256,
      '--environment', inputs.environmentEvidence, '--branch-policies', inputs.branchPolicies, '--approvals', inputs.approvals,
      '--runs', inputs.runs, '--auto-deploy-expected', inputs.autoDeployExpected, '--revalidated', inputs.revalidated,
      '--output', inputs.stageOutput];
    case 'verify-b2-admin-recovery-gate': return ['verify-b2-admin-recovery-gate', ...common, '--bundle', inputs.bundle,
      '--policy-sha256', inputs.policySha256, '--compiler-sha256', inputs.compilerSha256,
      '--environment', inputs.environmentEvidence, '--branch-policies', inputs.branchPolicies, '--approvals', inputs.approvals,
      '--runs', inputs.runs, '--auto-deploy-expected', inputs.autoDeployExpected, '--revalidated', inputs.revalidated,
      '--output', inputs.stageOutput];
    case 'authorize-refresh':
    case 'verify-gate': return [action, ...common, '--bundle', inputs.bundle,
      '--policy-sha256', inputs.policySha256, '--compiler-sha256', inputs.compilerSha256,
      '--environment', inputs.environmentEvidence, '--branch-policies', inputs.branchPolicies,
      '--approvals', inputs.approvals, '--runs', inputs.runs, '--auto-deploy-expected', inputs.autoDeployExpected,
      '--output', inputs.stageOutput];
    case 'verify-pre-snapshot': return ['verify-pre-snapshot', ...common, '--manifest', inputs.manifest,
      '--pre-snapshot', inputs.preSnapshot, '--output', inputs.stageOutput];
    case 'postcheck': return ['postcheck', ...common, '--manifest', inputs.manifest,
      '--pre-snapshot', inputs.preSnapshot, '--post-snapshot', inputs.postSnapshot,
      '--function-deployment-proof', inputs.functionDeploymentProof, '--output', inputs.stageOutput];
    case 'verify-recovery-source': return ['verify-recovery-source', '--policy', inputs.policy,
      '--recovery-source-run', inputs.recoverySourceRun, '--run', inputs.run, '--artifacts', inputs.artifacts,
      '--release-bundle', inputs.releaseBundle, '--gate-evidence', inputs.gateEvidence, '--output', inputs.stageOutput];
    case 'postcheck-recovery': return ['postcheck-recovery', ...common, '--recovery-manifest', manifest,
      '--verified-source', inputs.verifiedSource, '--current-snapshot', inputs.currentSnapshot,
      '--output', inputs.stageOutput];
    case 'verify-admin-recovery-postcheck-chain': return ['verify-admin-recovery-postcheck-chain',
      ...common, '--recovery-manifest', manifest, '--run', inputs.run, '--artifacts', inputs.artifacts,
      '--release-bundle', inputs.releaseBundle, '--gate-evidence', inputs.gateEvidence,
      '--postcheck-recovery-evidence', inputs.postcheckRecoveryEvidence, '--output', inputs.stageOutput];
    case 'verify-admin-recovery-source': return ['verify-admin-recovery-source', ...common,
      '--recovery-manifest', manifest, '--run', inputs.run, '--artifacts', inputs.artifacts,
      '--release-bundle', inputs.releaseBundle, '--gate-evidence', inputs.gateEvidence,
      '--admin-evidence', inputs.adminEvidence, '--output', inputs.stageOutput];
    case 'postcheck-admin-recovery': return ['postcheck-admin-recovery', ...common,
      '--recovery-manifest', manifest, '--verified-source', inputs.verifiedSource,
      '--current-snapshot', inputs.currentSnapshot, '--admin-manifest', inputs.adminManifest,
      '--build', inputs.build, '--output', inputs.stageOutput];
    case 'verify-admin-recovery-cloudflare-prestate': return ['verify-admin-recovery-cloudflare-prestate',
      '--verified-source', inputs.verifiedSource, '--previous', inputs.previous, '--routes', inputs.routes,
      '--output', inputs.stageOutput];
    default: throw new Error('blocked');
  }
}

function recoveryRuntimeWithCurrentGate(recoveryRuntime, environment, inputs) {
  if (!recoveryRuntime || !inputs.currentGate) return recoveryRuntime;
  return Object.freeze({ ...recoveryRuntime,
    currentGate: JSON.parse(boundedRead(safeStageInput(environment, inputs.currentGate), 2 * 1024 * 1024).toString('utf8')) });
}

function authenticateAdminChain({ inputs, recoveryRuntime, policy, environment, request, manifest, repositoryRoot, authorityContext }) {
  const keys = ['chainRun', 'chainArtifacts', 'chainReleaseBundle', 'chainGateEvidence', 'chainRecoveryEvidence'];
  const present = keys.filter(key => Object.hasOwn(inputs, key));
  if (!recoveryRuntime?.chainProvenance && present.length === 0) {
    return null;
  }
  if (present.length !== keys.length) throw new Error('blocked');
  return verifyAdminRecoveryPostcheckChainProvenance({ policy,
    policySha256: environmentText(environment, 'NELYON_RELEASE_POLICY_SHA256', /^[0-9a-f]{64}$/u),
    recoveryRequest: request, recoveryManifest: manifest,
    run: jsonBytes(boundedRead(inputs.chainRun, 2 * 1024 * 1024)),
    artifacts: JSON.parse(boundedRead(inputs.chainArtifacts, 2 * 1024 * 1024).toString('utf8')),
    releaseBundle: { directory: path.resolve(inputs.chainReleaseBundle) },
    gateEvidence: { directory: path.resolve(inputs.chainGateEvidence) },
    recoveryEvidence: { directory: path.resolve(inputs.chainRecoveryEvidence) },
    adapterSourceSha256: createHash('sha256').update(readFileSync(path.resolve(repositoryRoot,
      'scripts/nelyon-production-snapshot-adapter.mjs'))).digest('hex'),
    ...(recoveryRuntime ? { authorityContext, verifiedB2Source: recoveryRuntime.verifiedSource,
      chainProvenance: recoveryRuntime.chainProvenance } : {}) });
}

function authenticateAdminSource({ inputs, recoveryRuntime, policy, request, manifest, authorityContext, chain }) {
  return verifyAdminRecoverySourceProvenance({ policy, recoveryRequest: request,
    recoveryManifest: manifest, run: jsonBytes(boundedRead(inputs.run, 2 * 1024 * 1024)),
    artifacts: JSON.parse(boundedRead(inputs.artifacts, 2 * 1024 * 1024).toString('utf8')),
    releaseBundle: { directory: path.resolve(inputs.releaseBundle) },
    gateEvidence: { directory: path.resolve(inputs.gateEvidence) },
    adminEvidence: { directory: path.resolve(inputs.adminEvidence) },
    ...(recoveryRuntime ? { authorityContext, verifiedB2Source: recoveryRuntime.verifiedSource } : {}),
    postcheckRecoveryChain: chain });
}

// Trusted in-process controller factory. Its arguments are never populated by
// argv/JSON; the executable constructs them only after closure and public-bundle
// authentication. The export exists so the offline production-graph contract
// can exercise the same controller with fixed fake transports.
export function createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl, repositoryRoot, recoveryRuntime, integratedSource, migrationExecFileImpl = execFile, clock = () => new Date().toISOString() }) {
  return Object.freeze({
    async loadPublicInputs() {
      return publicInputs;
    },
    async dispatch({ action, inputs, authorityContext, receipt, manifest, now }) {
      if (manifest?.resources?.web_control_centers_b2_transition) {
        verifyB2DatabaseSourcePreflight({ authorityContext, manifest, descriptorBytes: publicInputs.descriptorBytes,
          ...(integratedSource ? { integratedSource } : {}),
          migrationBytes: readReviewedFile(repositoryRoot, authorityContext.descriptor.contract.productive_changes.at(-1).path) });
      }
      if (action === 'authority-proof') {
        verifyB2VaultEdgeParity(authorityContext, now);
        return receipt;
      }
      const policy = jsonBytes(publicInputs.policyBytes);
      const request = jsonBytes(publicInputs.requestBytes);
      const protectedB2Admin = adminRecoveryRequiresProtectedB2Runtime({ request, environment });
      const historicalAuthorityContext = protectedB2Admin ? authorityContext : undefined;
      if (action === 'recovery-authority-proof') {
        if (!recoveryRuntime || inputs.recoverySourceRun !== String(request.recoverySourceRunId)) throw new Error('blocked');
        return verifyPendingB2RecoveryAuthority({ request, policy, policyBytes: publicInputs.policyBytes, manifest,
          verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
      }
      if (action === 'admin-recovery-authority-proof') {
        if (!protectedB2Admin || !recoveryRuntime || request.mode !== 'admin_recovery'
          || inputs.recoverySourceRun !== String(request.recoverySourceRunId)
          || manifest.result !== 'NO PRODUCTIVE CHANGES' || canonicalJson(manifest.blockers) !== canonicalJson([])
          || manifest.delta?.productive_change_count !== 0) throw new Error('blocked');
        validatePolicy(policy);
        const chain = authenticateAdminChain({ inputs, recoveryRuntime, policy, environment, request, manifest,
          repositoryRoot, authorityContext: historicalAuthorityContext });
        authenticateAdminSource({ inputs, recoveryRuntime, policy, request, manifest,
          authorityContext: historicalAuthorityContext, chain });
        return receipt;
      }
      if (['dryrun-migrations', 'apply-migrations', 'deploy-functions'].includes(action)) {
        // All inputs are authenticated controller state or protected step paths.
        // No JSON flag can supply source provenance, TLS policy, a binary pin or a clock.
        if (request.mode !== 'release' || typeof clock !== 'function' || typeof migrationExecFileImpl !== 'function') throw new Error('blocked');
        const binarySha256 = environmentText(environment, 'NELYON_SUPABASE_CLI_SHA256', /^[0-9a-f]{64}$/u);
        if (!path.isAbsolute(inputs.binaryPath)) throw new Error('blocked');
        const output = safeStageOutput(environment, inputs.stageOutput);
        const currentGate = jsonBytes(boundedRead(safeStageInput(environment, inputs.currentGate), 2 * 1024 * 1024));
        const pre = jsonBytes(boundedRead(safeStageInput(environment, inputs.preSnapshot), 16 * 1024 * 1024));
        verifyProductionPreSnapshot({pre, policy, request, manifest, authorityContext,
          adapterSourceSha256:manifest.compiler.snapshot_adapter_sha256, requestedAt:clock()});
        const files = readApprovedMigrationFiles({repositoryRoot, approvedSha:manifest.identity.approved_sha});
        const parent = realpathSync(environmentText(environment, 'RUNNER_TEMP', /^.{1,4096}$/u));
        const trustedProofRoot=path.join(parent,'nelyon-private-authority-public');
        if(path.dirname(output)!==trustedProofRoot) throw new Error('blocked');
        if(action==='deploy-functions'){
          const binary=realpathSync(inputs.binaryPath),stat=lstatSync(binary);
          if(binary!==inputs.binaryPath||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1
            ||stat.size<1||stat.size>128*1024*1024||sha256Hex(readFileSync(binary))!==binarySha256)throw new Error('blocked');
          const capturedAt=clock();
          const currentRows=await deployedFunctionRows(environment,fetchImpl);
          const inventory=inventoryFromRows(currentRows,capturedAt);
          const recoveryFunctionProof=recoveryRuntime
            ? readTrustedB2RecoveryFunctionDeploymentProof(recoveryRuntime.recoveryProvenance)
            : null;
          const guardedClock=()=>{const at=clock();verifyB2ProtectedAuthority({manifest,authorityContext,inventory,requestedAt:at,
            ...(recoveryFunctionProof?{functionDeploymentProof:recoveryFunctionProof,functionRows:currentRows}:{})});
            verifyProductionPreSnapshot({pre,policy,request,manifest,authorityContext,
              adapterSourceSha256:manifest.compiler.snapshot_adapter_sha256,requestedAt:at});return at;};
          guardedClock();
          const operation={request,manifest,policy,authorityContext,currentGate,backup:pre.backup,repositoryRoot,
            trustedProofRoot,proofPath:path.join(trustedProofRoot,'protected-stage-proofs.json')};
          const functionProofPath=path.join(trustedProofRoot,'function-deployment-proof.json');
          const approvedFunctionNames=new Set(manifest.resources.web_control_centers_b2_transition.contract.functions.map(row=>row.name));
          const approvedFunctionRows=()=>deployedFunctionRows(environment,fetchImpl)
            .then(rows=>rows.filter(row=>approvedFunctionNames.has(row.slug??row.name)));
          const home=realpathSync(environmentText(environment,'RUNNER_TEMP',/^.{1,4096}$/u));
          const token=environmentText(environment,'SUPABASE_ACCESS_TOKEN',/^[\x21-\x7e]{1,2048}$/u);
          const execute=specification=>new Promise((resolve,reject)=>{
            const s=specification;
            if(s?.executable!==binary||s.cwd!==repositoryRoot||s.shell!==false||s.timeoutMs!==120000||s.maxBuffer!==1048576
              ||!Array.isArray(s.args)||s.args.length!==6||s.args[0]!=='functions'||s.args[1]!=='deploy'
              ||typeof s.args[2]!=='string'||s.args[3]!=='--project-ref'||s.args[4]!==policy.supabase.project_ref
              ||s.args[5]!=='--use-api'
              ||Object.keys(s.env??{}).join(',')!=='SUPABASE_ACCESS_TOKEN'||s.env.SUPABASE_ACCESS_TOKEN!==token)reject(new Error('blocked'));
            else migrationExecFileImpl(binary,s.args,{cwd:repositoryRoot,env:{SUPABASE_ACCESS_TOKEN:token,HOME:home,USERPROFILE:home,
              XDG_CONFIG_HOME:home,DO_NOT_TRACK:'1',SUPABASE_NO_UPDATE_NOTIFIER:'1',SUPABASE_TELEMETRY_DISABLED:'1'},shell:false,
              windowsHide:true,timeout:120000,maxBuffer:1048576,encoding:'utf8'},error=>error?reject(new Error('blocked')):resolve({exitCode:0}));
          });
          const result=await runB2ProtectedFunctions({operation,now:guardedClock,connection:{projectRef:policy.supabase.project_ref,
            binaryPath:binary,repositoryRoot,token,execute,
            initialFunctionProof:recoveryFunctionProof,
            readFunctionRows:approvedFunctionRows,
            recordFunctionAttempt:proof=>writeFunctionProofCheckpoint(functionProofPath,proof),
            verifyFunction:functionName=>verifyFunctionContractAtRepository({manifest,functionName,repositoryRoot})}});
          const proofBytes=Buffer.from(canonicalB2FunctionDeploymentProof(result.proof));
          writeFileSync(output,canonicalJson({schema_version:1,result:'FUNCTIONS_EXECUTED',manifest_sha256:sha256Hex(canonicalJson(manifest)),
            complete:result.complete,count:result.count,function_deployment_proof_sha256:sha256Hex(proofBytes)}),{encoding:'utf8',flag:'wx'});
          return receipt;
        }
        const workspace = createHermeticMigrationWorkspace({parent, binaryPath:inputs.binaryPath, binarySha256, files});
        try {
          const capturedAt = clock();
          const currentRows = await deployedFunctionRows(environment, fetchImpl);
          const inventory = inventoryFromRows(currentRows,capturedAt);
          const guardedClock = () => {
            const at=clock();
            verifyB2ProtectedAuthority({manifest,authorityContext,inventory,requestedAt:at});
            verifyProductionPreSnapshot({pre,policy,request,manifest,authorityContext,
              adapterSourceSha256:manifest.compiler.snapshot_adapter_sha256,requestedAt:at});
            return at;
          };
          guardedClock();
          const operation = {request,manifest,policy,authorityContext,currentGate,backup:pre.backup,repositoryRoot,
            trustedProofRoot,proofPath:path.join(trustedProofRoot,'protected-stage-proofs.json')};
          const connection = {phase:action === 'apply-migrations' ? 'apply' : 'dry-run',workspace,
            projectRef:policy.supabase.project_ref,host:'db.aewwdlvbwpczqyvkwvvj.supabase.co',
            token:environmentText(environment,'SUPABASE_ACCESS_TOKEN',/^[\x21-\x7e]{1,2048}$/u),
            request:createB2HttpAdapter({fetchImpl}),execute:createB2Executor({workspace,execFileImpl:migrationExecFileImpl})};
          const result = await (action === 'apply-migrations' ? runB2ProtectedMigration : runB2ProtectedDryRun)({operation,connection,now:guardedClock});
          const evidence = action === 'apply-migrations'
            ? {schema_version:1,result:'MIGRATIONS_EXECUTED',manifest_sha256:sha256Hex(canonicalJson(manifest)),complete:result.complete}
            : result;
          writeFileSync(output,canonicalJson(evidence),{encoding:'utf8',flag:'wx'});
          return receipt;
        } finally {
          // Delete only this process-created, verified immediate child of RUNNER_TEMP.
          if (realpathSync(workspace.cwd) !== workspace.cwd || path.dirname(workspace.cwd) !== parent
            || !path.basename(workspace.cwd).startsWith('b2-hermetic-')) throw new Error('blocked');
          rmSync(workspace.cwd,{recursive:true,force:false});
        }
      }
      const offlineAuthorization = ['preflight-release', 'authorize-refresh'].includes(action);
      if (offlineAuthorization && (request.mode !== 'release' || Object.hasOwn(environment, 'SUPABASE_ACCESS_TOKEN'))) throw new Error('blocked');
      const rows = ['preflight-release', 'authorize-refresh', 'revalidate-b2-recovery', 'revalidate-b2-admin-recovery',
        'verify-b2-recovery-gate', 'verify-b2-admin-recovery-gate', 'recovery-snapshot'].includes(action)
        ? [] : await deployedFunctionRows(environment, fetchImpl);
      const inventory = inventoryFromRows(rows, now);
      if (['preflight-release', 'authorize-refresh', 'revalidate', 'revalidate-b2-recovery', 'revalidate-b2-admin-recovery', 'verify-b2-recovery-gate', 'verify-b2-admin-recovery-gate', 'verify-gate', 'verify-pre-snapshot', 'postcheck', 'verify-recovery-source',
        'postcheck-recovery', 'verify-admin-recovery-source', 'verify-admin-recovery-postcheck-chain',
        'postcheck-admin-recovery', 'verify-admin-recovery-cloudflare-prestate'].includes(action)) {
        if (inputs.stageOutput) safeStageOutput(environment, inputs.stageOutput);
        if (action === 'postcheck') safeStageInput(environment, inputs.functionDeploymentProof);
        if (['verify-b2-recovery-gate', 'verify-b2-admin-recovery-gate'].includes(action)) safeStageInput(environment, inputs.revalidated);
        if (['revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate'].includes(action) && !protectedB2Admin) {
          throw new Error('blocked');
        }
        let runtimeAuthority = recoveryRuntimeWithCurrentGate(recoveryRuntime, environment, inputs);
        let authenticatedChain = null;
        if (['revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate', 'verify-admin-recovery-source', 'postcheck-admin-recovery', 'verify-admin-recovery-cloudflare-prestate'].includes(action)) {
          validatePolicy(policy);
          authenticatedChain = authenticateAdminChain({ inputs, recoveryRuntime, policy, environment, request,
            manifest, repositoryRoot, authorityContext: historicalAuthorityContext });
          if (authenticatedChain) runtimeAuthority = Object.freeze({ ...(runtimeAuthority ?? {}), postcheckRecoveryChain: authenticatedChain });
        }
        if (['revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate'].includes(action)) {
          const adminVerifiedSource = authenticateAdminSource({ inputs, recoveryRuntime, policy, request, manifest,
            authorityContext: historicalAuthorityContext, chain: authenticatedChain });
          runtimeAuthority = Object.freeze({ ...runtimeAuthority, adminVerifiedSource,
            ...(action === 'verify-b2-admin-recovery-gate' ? { operationSecrets: {
              SUPABASE_ACCESS_TOKEN: environmentText(environment, 'SUPABASE_ACCESS_TOKEN', /^[\x21-\x7e]{1,2048}$/u),
            } } : {}) });
        }
        if (['postcheck-admin-recovery', 'verify-admin-recovery-cloudflare-prestate'].includes(action)) {
          if (protectedB2Admin && !recoveryRuntime) throw new Error('blocked');
          validatePolicy(policy);
          const authenticated = authenticateAdminSource({ inputs, recoveryRuntime, policy, request, manifest,
            authorityContext: historicalAuthorityContext, chain: authenticatedChain });
          const staged = JSON.parse(boundedRead(safeStageInput(environment, inputs.verifiedSource), 2 * 1024 * 1024).toString('utf8'));
          if (canonicalJson(staged) !== canonicalJson(authenticated)) throw new Error('blocked');
          if (protectedB2Admin) runtimeAuthority = Object.freeze({ ...runtimeAuthority, verifiedSource: authenticated });
        }
        const quiet = Object.freeze({ write: () => true });
        const runtimeOptions = Object.freeze({ now: () => now, stdout: quiet, stderr: quiet });
        const status = await runReleaseCli(releaseArgs(action, inputs), offlineAuthorization ? authorityContext : historicalAuthorityContext, inventory,
          runtimeAuthority, runtimeOptions);
        if (status !== 0) throw new Error('blocked');
        return receipt;
      }
      const token = environmentText(environment, 'SUPABASE_ACCESS_TOKEN', /^[\x21-\x7e]{1,2048}$/u);
      const adapterSourceSha256 = manifest.compiler?.snapshot_adapter_sha256;
      const common = { policy, request, manifest, token, fetchImpl, observedAt: now,
        requestedAt: now, adapterSourceSha256, authorityContext };
      if (action === 'pre-snapshot') {
        const output = safeStageOutput(environment, inputs.snapshotOutput);
        const pre = await captureProductionSnapshot({ ...common, phase: 'pre' });
        const result = verifyProductionPreSnapshot({ ...common, phase: 'pre', pre });
        writeFileSync(output, `${JSON.stringify(pre)}\n`, { encoding: 'utf8', flag: 'wx' });
        return result;
      }
      if (action === 'post-snapshot') {
        const output = safeStageOutput(environment, inputs.snapshotOutput);
        const pre = JSON.parse(boundedRead(safeStageInput(environment, inputs.preSnapshot),
          16 * 1024 * 1024).toString('utf8'));
        const sourceParity = currentSourceParity({ authorityContext, descriptorBytes: publicInputs.descriptorBytes,
          manifest, repositoryRoot, functionRows: rows, capturedAt: now, integratedSource });
        const post = await captureProductionSnapshot({ ...common, phase: 'post', sourceParity });
        const proofPath=path.join(realpathSync(environmentText(environment,'RUNNER_TEMP',/^.{1,4096}$/u)),
          'nelyon-private-authority-public','function-deployment-proof.json');
        const functionDeploymentProof=jsonBytes(boundedRead(proofPath,2*1024*1024));
        verifyProductionSnapshotPair({ ...common, pre, post, functionDeploymentProof });
        writeFileSync(output, `${JSON.stringify(post)}\n`, { encoding: 'utf8', flag: 'wx' });
        return post.authority_verification;
      }
      if (action === 'recovery-snapshot') {
        if (!recoveryRuntime) throw new Error('blocked');
        const output = safeStageOutput(environment, inputs.snapshotOutput);
        const currentGate = JSON.parse(boundedRead(safeStageInput(environment, inputs.currentGate),
          2 * 1024 * 1024).toString('utf8'));
        const recoveryAuthorization = { verifiedSource: recoveryRuntime.verifiedSource, currentGate };
        const sourceParity = await historicalSourceParity({ authorityContext, recoveryRuntime, environment,
          fetchImpl, capturedAt: now });
        const recovery = await captureProductionSnapshot({ ...common, phase: 'recovery', sourceParity,
          recoveryAuthorization });
        const result = verifyProductionRecoverySnapshot({ ...common, recovery, recoveryAuthorization });
        writeFileSync(output, `${JSON.stringify(recovery)}\n`, { encoding: 'utf8', flag: 'wx' });
        return result;
      }
      throw new Error('blocked');
    },
  });
}

export async function executeAuthorityObservation({ invocation, environment, fetchImpl, repositoryRoot,
  captureImpl = captureB2AuthorityObservation, verifyImpl = verifyB2AuthorityObservation,
  nodeVersion = process.versions.node, execFileSyncImpl = execFileSync }) {
  const expectedRepository = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
  const expectedWorkflowRef = `${expectedRepository}/.github/workflows/nelyon-production-release.yml@refs/heads/main`;
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation) || types.isProxy(invocation)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(invocation))
    || Object.getOwnPropertySymbols(invocation).length !== 0 || typeof repositoryRoot !== 'string'
    || typeof fetchImpl !== 'function' || typeof captureImpl !== 'function' || typeof verifyImpl !== 'function'
    || typeof execFileSyncImpl !== 'function' || nodeVersion !== '24.21.0') throw new Error('blocked');
  const invocationDescriptors = Object.getOwnPropertyDescriptors(invocation);
  if (JSON.stringify(Object.keys(invocationDescriptors).sort())
      !== JSON.stringify(['action', 'inputs', 'verificationOutput'])
    || Object.values(invocationDescriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
    || invocationDescriptors.action.value !== 'authority-observe') throw new Error('blocked');
  const inputs = invocationDescriptors.inputs.value;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || types.isProxy(inputs)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(inputs))
    || Object.getOwnPropertySymbols(inputs).length !== 0) throw new Error('blocked');
  const descriptors = Object.getOwnPropertyDescriptors(inputs);
  if (JSON.stringify(Object.keys(descriptors).sort()) !== JSON.stringify(['approvedSha', 'approvedTree', 'policy'])
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) {
    throw new Error('blocked');
  }
  const approvedSha = descriptors.approvedSha.value;
  const approvedTreeSha = descriptors.approvedTree.value;
  if (!/^[0-9a-f]{40}$/u.test(approvedSha) || !/^[0-9a-f]{40}$/u.test(approvedTreeSha)
    || environmentText(environment, 'GITHUB_EVENT_NAME', /^workflow_dispatch$/u) !== 'workflow_dispatch'
    || environmentText(environment, 'GITHUB_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u) !== expectedRepository
    || environmentText(environment, 'GITHUB_REF', /^refs\/heads\/main$/u) !== 'refs/heads/main'
    || environmentText(environment, 'GITHUB_WORKFLOW_REF', /^.{1,1024}$/u) !== expectedWorkflowRef
    || environmentText(environment, 'GITHUB_ACTOR', /^[A-Za-z0-9-]{1,39}$/u) !== 'andressan101989'
    || environmentText(environment, 'GITHUB_TRIGGERING_ACTOR', /^[A-Za-z0-9-]{1,39}$/u) !== 'andressan101989'
    || environmentText(environment, 'GITHUB_SHA', /^[0-9a-f]{40}$/u) !== approvedSha
    || environmentText(environment, 'NELYON_APPROVED_SHA', /^[0-9a-f]{40}$/u) !== approvedSha
    || environmentText(environment, 'NELYON_APPROVED_TREE', /^[0-9a-f]{40}$/u) !== approvedTreeSha) {
    throw new Error('blocked');
  }
  const root = realpathSync(repositoryRoot);
  const head = execFileSyncImpl('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSyncImpl('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  if (head !== approvedSha || tree !== approvedTreeSha) throw new Error('blocked');
  const expectedPolicy = path.join(root, '.github', 'nelyon-production-release-policy.json');
  const declaredPolicy = path.resolve(descriptors.policy.value);
  const policyStat = lstatSync(declaredPolicy, { throwIfNoEntry: false });
  if (declaredPolicy !== expectedPolicy || !policyStat || !policyStat.isFile() || policyStat.isSymbolicLink()
    || realpathSync(declaredPolicy) !== expectedPolicy) throw new Error('blocked');
  const policy = jsonBytes(boundedRead(declaredPolicy, 2 * 1024 * 1024));
  validatePolicy(policy);
  if (policy.owner !== 'andressan101989' || policy.repository !== expectedRepository
    || policy.supabase?.project_ref !== 'aewwdlvbwpczqyvkwvvj'
    || canonicalJson(policy.supabase?.backup) !== canonicalJson({
      max_age_seconds: 86_400, require_physical: true, required_status: 'COMPLETED',
    })) throw new Error('blocked');
  const output = safeStageOutput(environment, invocationDescriptors.verificationOutput.value);
  const expectedOutput = path.join(realpathSync(environmentText(environment, 'RUNNER_TEMP', /^.{1,4096}$/u)),
    'nelyon-b2-authority-observation', 'observation.json');
  if (output !== expectedOutput) throw new Error('blocked');
  const observation = await captureImpl({
    approvedSha,
    approvedTreeSha,
    backupPolicy: policy.supabase.backup,
    fetchImpl,
    repository: expectedRepository,
    token: environmentText(environment, 'SUPABASE_ACCESS_TOKEN', /^[\x21-\x7e]{1,2048}$/u),
  });
  const verified = verifyImpl(observation);
  let descriptor;
  try {
    descriptor = openSync(output, 'wx', 0o600);
    writeFileSync(descriptor, `${canonicalJson(verified)}\n`, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(output), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return SUCCESS;
}

export async function executeAuthorityIssuance({ invocation, environment, fetchImpl, repositoryRoot,
  now = () => new Date().toISOString() }) {
  const expectedRepository = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
  const expectedWorkflow = '.github/workflows/nelyon-production-release.yml';
  const expectedWorkflowRef = `${expectedRepository}/${expectedWorkflow}@refs/heads/main`;
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation) || types.isProxy(invocation)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(invocation))
    || Object.getOwnPropertySymbols(invocation).length !== 0 || typeof repositoryRoot !== 'string'
    || typeof fetchImpl !== 'function' || typeof now !== 'function' || process.versions.node !== '24.21.0') {
    throw new Error('blocked');
  }
  const invocationDescriptors = Object.getOwnPropertyDescriptors(invocation);
  if (JSON.stringify(Object.keys(invocationDescriptors).sort())
      !== JSON.stringify(['action', 'inputs', 'verificationOutput'])
    || Object.values(invocationDescriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
    || invocationDescriptors.action.value !== 'authority-issue') throw new Error('blocked');
  const inputs = invocationDescriptors.inputs.value;
  const expectedInputs = ['approvedSha', 'approvedTree', 'integrationBaseSha', 'observationRun',
    'observationSha256', 'policy', 'releaseId'];
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || types.isProxy(inputs)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(inputs))
    || JSON.stringify(Object.keys(inputs).sort()) !== JSON.stringify(expectedInputs)) throw new Error('blocked');
  const approvedSha = inputs.approvedSha;
  const approvedTreeSha = inputs.approvedTree;
  if (!/^[0-9a-f]{40}$/u.test(approvedSha) || !/^[0-9a-f]{40}$/u.test(approvedTreeSha)
    || inputs.integrationBaseSha !== B2_AUTHORITY_INTEGRATION_BASE_SHA
    || !/^[1-9][0-9]*$/u.test(inputs.observationRun)
    || !/^[0-9a-f]{64}$/u.test(inputs.observationSha256)
    || !/^b2-authority-[0-9a-f]{64}$/u.test(inputs.releaseId)
    || environmentText(environment, 'GITHUB_EVENT_NAME', /^workflow_dispatch$/u) !== 'workflow_dispatch'
    || environmentText(environment, 'GITHUB_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u) !== expectedRepository
    || environmentText(environment, 'GITHUB_REF', /^refs\/heads\/main$/u) !== 'refs/heads/main'
    || environmentText(environment, 'GITHUB_WORKFLOW_REF', /^.{1,1024}$/u) !== expectedWorkflowRef
    || environmentText(environment, 'GITHUB_ACTOR', /^[A-Za-z0-9-]{1,39}$/u) !== 'andressan101989'
    || environmentText(environment, 'GITHUB_TRIGGERING_ACTOR', /^[A-Za-z0-9-]{1,39}$/u) !== 'andressan101989'
    || environmentText(environment, 'GITHUB_SHA', /^[0-9a-f]{40}$/u) !== approvedSha
    || environmentText(environment, 'NELYON_APPROVED_SHA', /^[0-9a-f]{40}$/u) !== approvedSha
    || environmentText(environment, 'NELYON_APPROVED_TREE', /^[0-9a-f]{40}$/u) !== approvedTreeSha
    || environmentText(environment, 'GITHUB_RUN_ATTEMPT', /^1$/u) !== '1') throw new Error('blocked');
  const runId = environmentText(environment, 'GITHUB_RUN_ID', /^[1-9][0-9]*$/u);
  const root = realpathSync(repositoryRoot);
  if (execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== approvedSha
    || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim() !== approvedTreeSha) {
    throw new Error('blocked');
  }
  const expectedPolicy = path.join(root, '.github', 'nelyon-production-release-policy.json');
  if (path.resolve(inputs.policy) !== expectedPolicy || realpathSync(path.resolve(inputs.policy)) !== expectedPolicy) {
    throw new Error('blocked');
  }
  const policy = jsonBytes(boundedRead(expectedPolicy, 2 * 1024 * 1024));
  validatePolicy(policy);
  if (policy.owner !== 'andressan101989' || policy.repository !== expectedRepository) throw new Error('blocked');
  const output = safeStageOutput(environment, invocationDescriptors.verificationOutput.value);
  const expectedOutput = path.join(realpathSync(environmentText(environment, 'RUNNER_TEMP', /^.{1,4096}$/u)),
    'nelyon-b2-authority-issue', 'receipt.json');
  if (output !== expectedOutput) throw new Error('blocked');

  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl,
    githubToken: environmentText(environment, 'GITHUB_TOKEN', /^[\x21-\x7e]{1,2048}$/u),
    repository: expectedRepository, workflowPath: expectedWorkflow, apiOrigin: 'https://api.github.com' });
  const observation = await observer.authenticateObservation({ runId: inputs.observationRun, runAttempt: 1,
    approvedSha, approvedTreeSha, expectedObservationSha256: inputs.observationSha256 });
  const preparation = prepareB2AuthorityIssuance({ repositoryRoot: root, approvedSha, approvedTreeSha,
    integrationBaseSha: B2_AUTHORITY_INTEGRATION_BASE_SHA, observation });
  const summary = readB2AuthorityPreparationSummary(preparation);
  if (summary.releaseId !== inputs.releaseId || summary.preissuanceSha256 !== inputs.releaseId.slice('b2-authority-'.length)) {
    throw new Error('blocked');
  }
  const approval = await observer.authenticateOwnerApproval({ runId, runAttempt: 1, approvedSha,
    approvedTreeSha, releaseId: inputs.releaseId, preissuanceSha256: summary.preissuanceSha256, observation });
  if (environmentText(environment, 'NELYON_PRIVATE_AUTHORITY_PROVIDER', /^r2$/u) !== 'r2') throw new Error('blocked');
  const publisher = createR2PrivateAuthorityPublisher({
    accountId: environmentText(environment, 'NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID', /^[0-9a-f]{32}$/u),
    bucket: environmentText(environment, 'NELYON_PRIVATE_AUTHORITY_R2_BUCKET', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
    accessKeyId: environmentText(environment, 'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID', /^[\x21-\x7e]{1,512}$/u),
    secretAccessKey: environmentText(environment, 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY', /^[\x21-\x7e]{1,512}$/u),
    fetch: fetchImpl,
    timeoutMs: 10_000,
  });
  const receipt = await issueB2PrivateAuthority({ preparation, observation, approval, publisher, issuedAt: now() });
  let descriptor;
  try {
    descriptor = openSync(output, 'wx', 0o600);
    writeFileSync(descriptor, `${canonicalJson(receipt)}\n`, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  return SUCCESS;
}

const productionHost = Object.freeze({
  async execute(invocation) {
    const repositoryRoot = process.cwd();
    if (invocation.action === 'authority-observe') {
      return executeAuthorityObservation({ invocation, environment: copyProductionEnvironment(process.env),
        fetchImpl: globalThis.fetch, repositoryRoot });
    }
    if (invocation.action === 'authority-issue') {
      return executeAuthorityIssuance({ invocation, environment: copyProductionEnvironment(process.env),
        fetchImpl: globalThis.fetch, repositoryRoot });
    }
    const publicInputs = loadProductionPublicInputs(invocation.inputs, repositoryRoot);
    assertProductionInvocationIdentity(publicInputs, process.env);
    let manifest;
    try { manifest = JSON.parse(publicInputs.manifestBytes.toString('utf8')); } catch { throw new Error('blocked'); }
    const bootstrapCapability = await bootstrapPrivateAuthorityRuntime({
      environment: closureEnvironment(process.env),
      manifestClosure: manifest.runtime_closure,
      repositoryRoot,
      readFile: readFileSync,
      nodeVersion: process.versions.node,
    });
    const environment = copyProductionEnvironment(process.env);
    if (invocation.action === 'stage-b2-recovery-source') {
      return stageProtectedB2RecoverySource({ bootstrapCapability, environment,
        policyBytes: publicInputs.policyBytes, runId: invocation.inputs.recoverySourceRun, fetchImpl: globalThis.fetch });
    }
    const recoveryAction = invocation.action.includes('recovery');
    const request = jsonBytes(publicInputs.requestBytes);
    const protectedB2Runtime = recoveryAction
      ? adminRecoveryRequiresProtectedB2Runtime({ request, environment })
      : false;
    let recoveryRuntime = null;
    if (recoveryAction && protectedB2Runtime) {
      recoveryRuntime = await loadProtectedB2RecoveryRuntime({ bootstrapCapability,
        environment, policyBytes: publicInputs.policyBytes,
        runId: invocation.inputs.recoverySourceRun, runAttempt: null,
        releaseBundle: { directory: path.resolve(invocation.inputs.releaseBundle) },
        gateEvidence: { directory: path.resolve(invocation.inputs.gateEvidence) }, fetchImpl: globalThis.fetch });
    }
    const integratedSource = !recoveryAction ? verifyB2IntegratedSource({ cwd: repositoryRoot,
      policy: jsonBytes(publicInputs.policyBytes), request, manifest, descriptorBytes: publicInputs.descriptorBytes }) : undefined;
    return createPrivateAuthorityRuntime({
      ...(integratedSource ? { integratedSource } : {}),
      bootstrapCapability,
      environment,
      fetchImpl: globalThis.fetch,
      now: () => new Date().toISOString(),
      host: createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl: globalThis.fetch,
        repositoryRoot, recoveryRuntime, integratedSource }),
      ...(recoveryRuntime ? { recoveryRuntime } : {}),
    }).execute(invocation);
  },
  stdout: process.stdout,
  stderr: process.stderr,
});

export async function runPrivateAuthorityCli(argv, suppliedHost = productionHost) {
  let host;
  try { host = trustedHost(suppliedHost); }
  catch { return 2; }
  let invocation;
  try { invocation = parse(argv); }
  catch {
    writeStatus(host, 'PRIVATE_AUTHORITY_STAGE_INVALID');
    return 2;
  }
  try {
    const result = await host.execute(invocation);
    if (!isClosedSuccess(result)) throw new Error('invalid');
    if (!writeStatus(host, null)) return 2;
    return 0;
  } catch (error) {
    const code = sanitizedCode(error);
    writeStatus(host, code, readPrivateAuthorityDiagnostic(error) ?? readSnapshotDiagnostic(error));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runPrivateAuthorityCli(process.argv.slice(2));
}
