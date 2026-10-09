import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const EXACT_MODES = ['plan_only', 'gate_proof', 'release'];

export class GateDeniedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GateDeniedError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new GateDeniedError(code, message, details);
}

function assertExactArray(actual, expected, code, label) {
  if (!Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    deny(code, `${label} does not match the controlled policy`);
  }
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    deny('INVALID_POLICY', 'policy must be an object');
  }
  if (policy.schema_version !== 1) deny('INVALID_POLICY_SCHEMA', 'unsupported policy schema');
  if (policy.owner !== 'andressan101989') deny('INVALID_POLICY_OWNER', 'unexpected policy owner');
  if (policy.repository !== 'andressan101989/ClipDAG-9bh0w4-26004-20260525') {
    deny('INVALID_POLICY_REPOSITORY', 'unexpected repository authority');
  }
  if (policy.default_branch !== 'main') deny('INVALID_POLICY_BRANCH', 'default branch must be main');
  if (policy.workflow_path !== '.github/workflows/nelyon-production-release.yml') {
    deny('INVALID_POLICY_WORKFLOW', 'unexpected workflow path');
  }
  assertExactArray(policy.modes, EXACT_MODES, 'INVALID_POLICY_MODES', 'modes');
  const confirmations = policy.scope_confirmations ?? {};
  const expectedConfirmations = {
    plan_only: 'PLAN_ONLY',
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    release_standard: 'RELEASE_STANDARD',
    release_high_risk: 'RELEASE_HIGH_RISK',
  };
  if (canonicalJson(confirmations) !== canonicalJson(expectedConfirmations)) {
    deny('INVALID_POLICY_CONFIRMATIONS', 'scope confirmations do not match');
  }
  if (!SHA_PATTERN.test(policy.baseline?.sha ?? '')) deny('INVALID_BASELINE_SHA', 'baseline SHA is invalid');
  if (!['candidate', 'verified'].includes(policy.baseline?.state)) {
    deny('INVALID_BASELINE_STATE', 'baseline state is invalid');
  }
  if (!['pending', 'verified'].includes(policy.cutover?.state)) {
    deny('INVALID_CUTOVER_STATE', 'cutover state is invalid');
  }
  if (policy.supabase?.project_ref !== 'aewwdlvbwpczqyvkwvvj') {
    deny('INVALID_PROJECT_REF', 'unexpected Supabase project');
  }
  if (!Array.isArray(policy.supabase?.managed_functions) || policy.supabase.managed_functions.length !== 17) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist must contain exactly 17 functions');
  }
  if (new Set(policy.supabase.managed_functions).size !== policy.supabase.managed_functions.length) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist contains duplicates');
  }
  assertExactArray(policy.supabase?.forbidden_functions, ['bdag-economy'], 'INVALID_FORBIDDEN_FUNCTIONS', 'forbidden functions');
  return true;
}

export function loadPolicy(filePath) {
  const policy = JSON.parse(readFileSync(filePath, 'utf8'));
  validatePolicy(policy);
  return policy;
}

function expectedConfirmation(request, policy) {
  if (request.mode === 'plan_only') return policy.scope_confirmations.plan_only;
  if (request.mode === 'gate_proof') return policy.scope_confirmations.gate_proof;
  if (request.mode === 'release') {
    if (request.scopeConfirmation === policy.scope_confirmations.release_high_risk) {
      return policy.scope_confirmations.release_high_risk;
    }
    return policy.scope_confirmations.release_standard;
  }
  return null;
}

export function validateRequest(request, policy) {
  validatePolicy(policy);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    deny('INVALID_REQUEST', 'release request must be an object');
  }
  if (request.actor !== policy.owner) deny('ACTOR_NOT_AUTHORIZED', 'workflow actor is not authorized');
  if (request.triggeringActor !== policy.owner) {
    deny('TRIGGERING_ACTOR_NOT_AUTHORIZED', 'triggering actor is not authorized');
  }
  if (request.repository !== policy.repository) deny('REPOSITORY_MISMATCH', 'repository identity mismatch');
  const expectedWorkflowRef = `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`;
  if (request.workflowRef !== expectedWorkflowRef) deny('WORKFLOW_REF_MISMATCH', 'workflow identity mismatch');
  if (request.ref !== `refs/heads/${policy.default_branch}`) deny('REF_NOT_MAIN', 'workflow must run from main');
  if (!SHA_PATTERN.test(request.approvedSha ?? '') || !SHA_PATTERN.test(request.mainSha ?? '')) {
    deny('INVALID_SHA', 'approved and main SHAs must be lowercase 40-character hexadecimal values');
  }
  if (request.approvedSha !== request.mainSha) deny('MAIN_SHA_MISMATCH', 'approved SHA is not current main');
  if (!policy.modes.includes(request.mode)) deny('MODE_NOT_ALLOWED', 'workflow mode is not allowed');
  const expected = expectedConfirmation(request, policy);
  if (request.scopeConfirmation !== expected) {
    deny('SCOPE_CONFIRMATION_MISMATCH', 'scope confirmation does not match mode and risk class');
  }
  if (!RELEASE_ID_PATTERN.test(request.releaseId ?? '')) deny('INVALID_RELEASE_ID', 'release ID format is invalid');
  if (!/^[1-9][0-9]*$/.test(String(request.runId ?? ''))) deny('INVALID_RUN_ID', 'run ID is invalid');
  if (!Number.isSafeInteger(request.runAttempt) || request.runAttempt < 1) {
    deny('INVALID_RUN_ATTEMPT', 'run attempt is invalid');
  }
  if (request.mode === 'release' && policy.baseline.state !== 'verified') {
    deny('BASELINE_NOT_VERIFIED', 'production baseline is not verified');
  }
  if (request.mode === 'release' && policy.cutover.state !== 'verified') {
    deny('CUTOVER_NOT_VERIFIED', 'production cutover is not verified');
  }
  return Object.freeze({ ...request });
}

function normalizeCanonical(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('unsupported non-finite number in canonical JSON');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`unsupported ${typeof value} in canonical JSON`);
  if (seen.has(value)) throw new TypeError('unsupported cyclic value in canonical JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeCanonical(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('unsupported object type in canonical JSON');
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = normalizeCanonical(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeCanonical(value, new Set()))}\n`;
}

export function sha256Hex(bytes) {
  if (!(typeof bytes === 'string' || bytes instanceof Uint8Array)) {
    throw new TypeError('sha256Hex requires UTF-8 text or bytes');
  }
  return createHash('sha256').update(bytes).digest('hex');
}
