#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';

import {
  bootstrapPrivateAuthorityRuntime,
  createPrivateAuthorityRuntime,
  loadProtectedB2RecoveryRuntime,
  stageProtectedB2RecoverySource,
} from './nelyon-private-authority-runtime.mjs';
import {
  compileB2SourceParity,
  verifyB2DatabaseSourcePreflight,
  createTrustedB2DeployedFunctionInventory,
  createTrustedB2ReviewedTree,
} from './nelyon-b2-source-parity.mjs';
import { readTrustedB2HistoricalDescriptorBytes } from './nelyon-b2-recovery-provenance.mjs';
import {
  canonicalJson,
  parseFunctionConfig,
  runCli as runReleaseCli,
  validatePolicy,
  verifyAdminRecoveryPostcheckChainProvenance,
  verifyAdminRecoverySourceProvenance,
  verifyPendingB2RecoveryAuthority,
} from './nelyon-production-release.mjs';
import {
  captureProductionSnapshot,
  verifyProductionPreSnapshot,
  verifyProductionRecoverySnapshot,
  verifyProductionSnapshotPair,
} from './nelyon-production-snapshot-adapter.mjs';

const ACTIONS = new Set([
  'authority-proof',
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
const COMMON_FLAGS = Object.freeze({
  '--policy': 'policy',
  '--request': 'request',
  '--bundle': 'bundle',
  '--verification-output': 'verificationOutput',
});
const CHAIN_FLAGS = Object.freeze({ '--chain-run': 'chainRun', '--chain-artifacts': 'chainArtifacts',
  '--chain-release-bundle': 'chainReleaseBundle', '--chain-gate-evidence': 'chainGateEvidence',
  '--chain-recovery-evidence': 'chainRecoveryEvidence' });
const CHAIN_ACTIONS = new Set(['admin-recovery-authority-proof', 'revalidate-b2-admin-recovery', 'verify-b2-admin-recovery-gate', 'verify-admin-recovery-source', 'postcheck-admin-recovery',
  'verify-admin-recovery-cloudflare-prestate']);
const ACTION_ADDITIONAL_FLAGS = Object.freeze({
  'authority-proof': {},
  'stage-b2-recovery-source': { '--recovery-source-run': 'recoverySourceRun' },
  revalidate: { '--compiler-sha256': 'compilerSha256', '--remote-evidence': 'remoteEvidence',
    '--stage-output': 'stageOutput' },
  'verify-gate': { '--policy-sha256': 'policySha256', '--compiler-sha256': 'compilerSha256',
    '--environment': 'environmentEvidence', '--branch-policies': 'branchPolicies', '--approvals': 'approvals',
    '--runs': 'runs', '--auto-deploy-expected': 'autoDeployExpected', '--stage-output': 'stageOutput' },
  'pre-snapshot': { '--snapshot-output': 'snapshotOutput' },
  'verify-pre-snapshot': { '--manifest': 'manifest', '--pre-snapshot': 'preSnapshot', '--stage-output': 'stageOutput' },
  'post-snapshot': { '--pre-snapshot': 'preSnapshot', '--snapshot-output': 'snapshotOutput' },
  postcheck: { '--manifest': 'manifest', '--pre-snapshot': 'preSnapshot', '--post-snapshot': 'postSnapshot',
    '--stage-output': 'stageOutput' },
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
  const requiredFlags = { ...COMMON_FLAGS, ...ACTION_ADDITIONAL_FLAGS[values[0]] };
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
    if (!(error instanceof Error) || types.isProxy(error)) return 'PRIVATE_AUTHORITY_STAGE_BLOCKED';
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

function writeStatus(host, code) {
  const stdout = code === null
    ? '{"schemaVersion":1,"result":"VERIFIED","releaseReady":false}\n'
    : `{"schemaVersion":1,"result":"BLOCKED","releaseReady":false,"code":"${code}"}\n`;
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

function currentSourceParity({ authorityContext, descriptorBytes, manifest, repositoryRoot, functionRows, capturedAt }) {
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
    deployedFunctionInventory, capturedAt });
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

async function historicalSourceParity({ authorityContext, recoveryRuntime, environment, fetchImpl, functionRows, capturedAt }) {
  const manifest = recoveryRuntime.verifiedSource.source_manifest;
  const sourceSha = recoveryRuntime.verifiedSource.source_sha;
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
    functions: expected.map(item => {
      const row = functionRows.find(candidate => (candidate.name ?? candidate.slug) === item.name);
      const deployedSha256 = row?.ezbr_sha256 ?? row?.source_sha256;
      if (typeof deployedSha256 !== 'string') throw new Error('blocked');
      return { name: item.name, deployedSha256 };
    }) });
  return compileB2SourceParity({ authorityContext, manifest,
    descriptorBytes: readTrustedB2HistoricalDescriptorBytes(recoveryRuntime.historicalRuntimeClosure,
      recoveryRuntime.recoveryProvenance),
    reviewedTree, deployedFunctionInventory, capturedAt });
}

function releaseArgs(action, inputs) {
  const common = ['--policy', inputs.policy, '--request', inputs.request];
  const manifest = path.resolve(inputs.bundle, 'manifest.json');
  switch (action) {
    case 'revalidate': return ['revalidate', ...common, '--bundle', inputs.bundle,
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
    case 'verify-gate': return ['verify-gate', ...common, '--bundle', inputs.bundle,
      '--policy-sha256', inputs.policySha256, '--compiler-sha256', inputs.compilerSha256,
      '--environment', inputs.environmentEvidence, '--branch-policies', inputs.branchPolicies,
      '--approvals', inputs.approvals, '--runs', inputs.runs, '--auto-deploy-expected', inputs.autoDeployExpected,
      '--output', inputs.stageOutput];
    case 'verify-pre-snapshot': return ['verify-pre-snapshot', ...common, '--manifest', inputs.manifest,
      '--pre-snapshot', inputs.preSnapshot, '--output', inputs.stageOutput];
    case 'postcheck': return ['postcheck', ...common, '--manifest', inputs.manifest,
      '--pre-snapshot', inputs.preSnapshot, '--post-snapshot', inputs.postSnapshot, '--output', inputs.stageOutput];
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
export function createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl, repositoryRoot, recoveryRuntime }) {
  return Object.freeze({
    async loadPublicInputs() {
      return publicInputs;
    },
    async dispatch({ action, inputs, authorityContext, receipt, manifest, now }) {
      if (manifest?.resources?.web_control_centers_b2_transition) {
        verifyB2DatabaseSourcePreflight({ authorityContext, manifest, descriptorBytes: publicInputs.descriptorBytes,
          migrationBytes: readReviewedFile(repositoryRoot, authorityContext.descriptor.contract.productive_changes.at(-1).path) });
      }
      if (action === 'authority-proof') return receipt;
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
      const rows = ['revalidate-b2-recovery', 'revalidate-b2-admin-recovery', 'verify-b2-recovery-gate', 'verify-b2-admin-recovery-gate'].includes(action)
        ? [] : await deployedFunctionRows(environment, fetchImpl);
      const inventory = inventoryFromRows(rows, now);
      if (['revalidate', 'revalidate-b2-recovery', 'revalidate-b2-admin-recovery', 'verify-b2-recovery-gate', 'verify-b2-admin-recovery-gate', 'verify-gate', 'verify-pre-snapshot', 'postcheck', 'verify-recovery-source',
        'postcheck-recovery', 'verify-admin-recovery-source', 'verify-admin-recovery-postcheck-chain',
        'postcheck-admin-recovery', 'verify-admin-recovery-cloudflare-prestate'].includes(action)) {
        if (inputs.stageOutput) safeStageOutput(environment, inputs.stageOutput);
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
        const status = await runReleaseCli(releaseArgs(action, inputs), historicalAuthorityContext, inventory,
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
          manifest, repositoryRoot, functionRows: rows, capturedAt: now });
        const post = await captureProductionSnapshot({ ...common, phase: 'post', sourceParity });
        verifyProductionSnapshotPair({ ...common, pre, post });
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
          fetchImpl, functionRows: rows, capturedAt: now });
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

const productionHost = Object.freeze({
  async execute(invocation) {
    const repositoryRoot = process.cwd();
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
    return createPrivateAuthorityRuntime({
      bootstrapCapability,
      environment,
      fetchImpl: globalThis.fetch,
      now: () => new Date().toISOString(),
      host: createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl: globalThis.fetch,
        repositoryRoot, recoveryRuntime }),
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
    writeStatus(host, code);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runPrivateAuthorityCli(process.argv.slice(2));
}
