import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const policyUrl = new URL('../.github/nelyon-production-release-policy.json', import.meta.url);
const gateUrl = new URL('../scripts/nelyon-production-release.mjs', import.meta.url);

const OWNER = 'andressan101989';
const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const PROJECT_REF = 'aewwdlvbwpczqyvkwvvj';
const MAIN_SHA = 'd02dda37e34493bc73b9f3b34fcd4874ef212911';
const MANAGED_FUNCTIONS = [
  'agora-token',
  'create-media-upload',
  'finalize-media-upload',
  'get-media-url',
  'delete-media-asset',
  'cleanup-stale-media-uploads',
  'create-stream-upload',
  'get-stream-playback',
  'delete-stream-video',
  'stream-webhook',
  'stripe-bdag-checkout',
  'stripe-webhook',
  'admin-user-moderation',
  'content-safety-scan',
  'ads-v2-delivery',
  'ai-handoff',
  'ai-handoff-mcp',
];

async function loadGateAndPolicy() {
  assert.ok(existsSync(policyUrl), 'release policy must exist');
  assert.ok(existsSync(gateUrl), 'release gate helper must exist');
  const gate = await import(`${gateUrl.href}?test=${Date.now()}-${Math.random()}`);
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  return { gate, policy };
}

function request(overrides = {}) {
  return {
    actor: OWNER,
    triggeringActor: OWNER,
    repository: REPOSITORY,
    workflowRef: `${REPOSITORY}/.github/workflows/nelyon-production-release.yml@refs/heads/main`,
    ref: 'refs/heads/main',
    approvedSha: MAIN_SHA,
    mainSha: MAIN_SHA,
    releaseId: 'nelyon-20261009-001',
    mode: 'plan_only',
    scopeConfirmation: 'PLAN_ONLY',
    runId: '123456789',
    runAttempt: 1,
    ...overrides,
  };
}

function assertDenied(fn, expectedCode) {
  assert.throws(fn, error => {
    assert.equal(error?.name, 'GateDeniedError');
    assert.equal(error?.code, expectedCode);
    return true;
  });
}

test('policy accepts the exact repository owner project modes and managed functions', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validatePolicy(policy), true);
  assert.equal(policy.owner, OWNER);
  assert.equal(policy.repository, REPOSITORY);
  assert.equal(policy.supabase.project_ref, PROJECT_REF);
  assert.deepEqual(policy.modes, ['plan_only', 'gate_proof', 'release']);
  assert.deepEqual(policy.scope_confirmations, {
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    plan_only: 'PLAN_ONLY',
    release_high_risk: 'RELEASE_HIGH_RISK',
    release_standard: 'RELEASE_STANDARD',
  });
  assert.deepEqual(policy.supabase.managed_functions, MANAGED_FUNCTIONS);
  assert.deepEqual(policy.supabase.forbidden_functions, ['bdag-economy']);
});

test('candidate baseline denies release but permits plan_only and gate_proof', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validateRequest(request(), policy).mode, 'plan_only');
  assert.equal(gate.validateRequest(request({
    mode: 'gate_proof',
    scopeConfirmation: 'GATE_PROOF_NO_MUTATION',
  }), policy).mode, 'gate_proof');
  assertDenied(() => gate.validateRequest(request({
    mode: 'release',
    scopeConfirmation: 'RELEASE_STANDARD',
  }), policy), 'BASELINE_NOT_VERIFIED');
});

test('malformed stale foreign and non-main SHA requests are denied', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assertDenied(() => gate.validateRequest(request({ approvedSha: 'abc' }), policy), 'INVALID_SHA');
  assertDenied(() => gate.validateRequest(request({ approvedSha: '1'.repeat(40) }), policy), 'MAIN_SHA_MISMATCH');
  assertDenied(() => gate.validateRequest(request({ repository: 'other/repository' }), policy), 'REPOSITORY_MISMATCH');
  assertDenied(() => gate.validateRequest(request({ ref: 'refs/heads/feature' }), policy), 'REF_NOT_MAIN');
});

test('actor repository workflow ref mode and confirmation must match exactly', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assertDenied(() => gate.validateRequest(request({ actor: 'intruder' }), policy), 'ACTOR_NOT_AUTHORIZED');
  assertDenied(() => gate.validateRequest(request({ workflowRef: `${REPOSITORY}/.github/workflows/other.yml@refs/heads/main` }), policy), 'WORKFLOW_REF_MISMATCH');
  assertDenied(() => gate.validateRequest(request({ mode: 'unknown' }), policy), 'MODE_NOT_ALLOWED');
  assertDenied(() => gate.validateRequest(request({ scopeConfirmation: 'RELEASE_STANDARD' }), policy), 'SCOPE_CONFIRMATION_MISMATCH');
});

test('a rerun by a different triggering actor is denied', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assertDenied(() => gate.validateRequest(request({ triggeringActor: 'intruder', runAttempt: 2 }), policy), 'TRIGGERING_ACTOR_NOT_AUTHORIZED');
  assert.equal(gate.validateRequest(request({ runAttempt: 2 }), policy).runAttempt, 2);
});

test('canonical JSON is recursively stable and SHA-256 hashes exact UTF-8 bytes', async () => {
  const { gate } = await loadGateAndPolicy();
  const canonical = gate.canonicalJson({ b: [{ y: 2, x: 1 }], a: { d: 4, c: 3 } });
  assert.equal(canonical, '{"a":{"c":3,"d":4},"b":[{"x":1,"y":2}]}\n');
  assert.equal(gate.sha256Hex(Buffer.from(canonical, 'utf8')), '85815050204c5ecc64cd98ab2766a745d8fbf6fd8c9277d45ad752701cda3902');
  assert.throws(() => gate.canonicalJson({ invalid: undefined }), /unsupported/i);
});
