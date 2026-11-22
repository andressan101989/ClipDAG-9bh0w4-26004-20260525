import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';
import { publicAuthorityReceipt } from '../scripts/nelyon-release-authority-context.mjs';


import { runPrivateAuthorityCli } from '../scripts/nelyon-private-authority-cli.mjs';


const runtimeModule = await import('../scripts/nelyon-private-authority-runtime.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime } = runtimeModule;
const ROOT = resolve(new URL('../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)));
const AT = '2026-11-08T12:00:00.000Z';
const MARKER = 'PRIVATE_RUNTIME_SYNTHETIC_MARKER';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonicalJson = value => {
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
      : item;
  return `${JSON.stringify(normalize(value))}\n`;
};

function authorityFixture() {
  const contract = {
    id: 'synthetic-b2-runtime-v1',
    to_phase: 'web-control-centers-b2',
    baseline_sha: '2'.repeat(40),
    reviewed_source_sha: '3'.repeat(40),
    integration_base_sha: '4'.repeat(40),
    function_inventory: { before: 34, after: 35 },
  };
  const relation = {
    definitionSha256: 'a'.repeat(64), forceRls: true,
    identity: 'private.synthetic_runtime', owner: MARKER, rls: true,
  };
  const relationBytes = canonicalJson(relation).trimEnd();
  const authority = {
    schemaVersion: 1,
    authorityId: 'synthetic-b2-runtime-authority',
    publicContractSha256: hash(canonicalJson(contract)),
    phase: contract.to_phase,
    issuedFor: {
      baselineSha: contract.baseline_sha,
      reviewedSourceSha: contract.reviewed_source_sha,
      integrationBaseSha: contract.integration_base_sha,
    },
    successorCatalog: { schemaVersion: 1, records: [{
      kind: 'relation', identity: relation.identity,
      expectedCanonicalJson: relationBytes, expectedSha256: hash(relationBytes),
    }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: hash('[]\n'), baselineItems: [], records: [] },
    backup: {
      schemaVersion: 2, provider: 'supabase', kind: 'physical',
      projectRefSha256: '6'.repeat(64), evidenceSha256: '7'.repeat(64), status: 'COMPLETED',
      insertedAt: '2026-11-08T10:00:00.000Z', completedObservedAt: '2026-11-08T10:30:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z',
    },
    vaultEdgeParity: syntheticVaultEdgeParity('2026-11-08T11:00:00.000Z'),
    approval: {
      schemaVersion: 1, decision: 'APPROVED', scope: [contract.to_phase],
      authorizationSha256: '8'.repeat(64), approvedAt: '2026-11-08T11:00:00.000Z',
      expiresAt: '2026-11-09T11:00:00.000Z',
    },
  };
  const authorityBytes = Buffer.from(JSON.stringify(authority), 'utf8');
  const authoritySha256 = hash(authorityBytes);
  const descriptor = {
    schema_version: 1,
    contract,
    public_contract_sha256: hash(canonicalJson(contract)),
    private_authority: {
      required: true, schema_version: 1,
      authority_id: authority.authorityId, sha256: authoritySha256,
    },
  };
  const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor)}\n`, 'utf8');
  const descriptorSha256 = hash(descriptorBytes);
  const manifest = {
    identity: {
      approved_sha: contract.reviewed_source_sha,
      run_id: '123456789',
      run_attempt: 1,
      release_id: 'nelyon-20261108-runtime',
    },
    resources: { web_control_centers_b2_transition: {
      contract,
      descriptorSha256,
      publicContractSha256: descriptor.public_contract_sha256,
      expectedPrivateAuthoritySha256: authoritySha256,
      privateAuthorityRequired: true,
    } },
  };
  const policy = {
    owner: 'andressan101989',
    repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    workflow_path: '.github/workflows/nelyon-production-release.yml',
    default_branch: 'main',
  };
  const request = {
    actor: policy.owner,
    triggeringActor: policy.owner,
    repository: policy.repository,
    workflowRef: `${policy.repository}/${policy.workflow_path}@refs/heads/main`,
    ref: 'refs/heads/main',
    approvedSha: contract.reviewed_source_sha,
    mainSha: contract.reviewed_source_sha,
    releaseId: manifest.identity.release_id,
    mode: 'plan_only',
    runId: manifest.identity.run_id,
    runAttempt: manifest.identity.run_attempt,
  };
  const policyBytes = Buffer.from(canonicalJson(policy), 'utf8');
  const requestBytes = Buffer.from(canonicalJson(request), 'utf8');
  return { authorityBytes, authoritySha256, descriptorBytes, descriptorSha256, contract, manifest,
    policy, request, policyBytes, requestBytes };
}

function closure() {
  return buildPrivateRuntimeClosure({ repositoryRoot: ROOT, readFile: readFileSync });
}

const bootstrap = (environmentValue, manifestClosure = closure()) => bootstrapPrivateAuthorityRuntime({
  environment: environmentValue,
  manifestClosure,
  repositoryRoot: ROOT,
  readFile: readFileSync,
  nodeVersion: '24.21.0',
});

function environment(fixture, runtimeClosure, runnerTemp, changes = {}) {
  return {
    NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2',
    NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'nelyon-private-authority',
    NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: 'synthetic-secret-key',
    NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256: fixture.descriptorSha256,
    NELYON_PRIVATE_AUTHORITY_SHA256: fixture.authoritySha256,
    NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: runtimeClosure.closure_sha256,
    NELYON_RELEASE_POLICY_SHA256: hash(fixture.policyBytes),
    NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'true',
    NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS: '10000',
    RUNNER_TEMP: runnerTemp,
    ORDINARY_UNRELATED_VALUE: 'allowed',
    ...changes,
  };
}

function invocation(output, inputs = {}) {
  return {
    action: 'authority-proof',
    inputs: { policy: 'policy.json', request: 'request.json', bundle: 'bundle', ...inputs },
    verificationOutput: output,
  };
}

function hostFor(fixture, runtimeClosure, counters = {}) {
  return Object.freeze({
    async loadPublicInputs(value) {
      counters.publicInputs = (counters.publicInputs ?? 0) + 1;
      assert.equal(value.now, AT);
      const manifest = { ...fixture.manifest, runtime_closure: runtimeClosure };
      const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
      return {
        descriptorBytes: fixture.descriptorBytes,
        manifestBytes,
        manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`, 'utf8'),
        policyBytes: fixture.policyBytes,
        requestBytes: fixture.requestBytes,
      };
    },
    async dispatch(value) {
      counters.dispatch = (counters.dispatch ?? 0) + 1;
      const actual = publicAuthorityReceipt(value.authorityContext);
      assert.equal(actual, value.receipt, 'same branded authority context reaches dispatch');
      assert.equal(value.now, AT);
      return actual;
    },
  });
}

function r2Fetch(authorityBytes, calls, status = 200) {
  return async request => {
    calls.push({ method: request.method, url: request.url, authorization: request.headers.get('authorization') });
    if (status !== 200) return new Response(null, { status });
    const headers = { 'content-length': String(authorityBytes.length), 'content-encoding': 'identity' };
    return request.method === 'HEAD'
      ? new Response(null, { status: 200, headers })
      : new Response(authorityBytes, { status: 200, headers });
  };
}

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const cliArguments = output => ['authority-proof', '--policy', 'policy.json', '--request', 'request.json',
  '--bundle', 'bundle', '--verification-output', output];
const blockedStatus = { schemaVersion: 1, result: 'BLOCKED', releaseReady: false, code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' };
async function cliFor(execute, output) {
  let stdout = ''; let stderr = '';
  const exit = await runPrivateAuthorityCli(cliArguments(output), { execute,
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  assert.equal(exit, 2);
  assert.doesNotMatch(stdout + stderr, new RegExp(MARKER));
  return { status: JSON.parse(stdout), stderr };
}

test('runtime output-write diagnostic retains closed code, cleans artifact, and cannot be copied or spoofed', async () => {
  assert.equal(typeof runtimeModule.readPrivateAuthorityDiagnostic, 'function');
  const fixture = authorityFixture(); const runtimeClosure = closure();
  const root = mkdtempSync(join(tmpdir(), 'diagnostic-output-'));
  const output = join(root, 'verification.json');
  const env = environment(fixture, runtimeClosure, root);
  const runtime = createPrivateAuthorityRuntime({ bootstrapCapability: await bootstrap(env, runtimeClosure), environment: env,
    now: () => AT, fetchImpl: r2Fetch(fixture.authorityBytes, []), host: hostFor(fixture, runtimeClosure) });
  const originalWrite = fs.writeFileSync;
  let captured;
  try {
    fs.writeFileSync = () => { throw new Proxy({}, { get() { assert.fail('thrown values must not be inspected'); } }); };
    syncBuiltinESMExports();
    await assert.rejects(runtime.execute(invocation(output)), error => { captured = error; return true; });
  } finally { fs.writeFileSync = originalWrite; syncBuiltinESMExports(); }
  assert.equal(existsSync(output), false);
  assert.equal(captured.code, 'PRIVATE_AUTHORITY_OUTPUT_INVALID');
  const diagnostic = runtimeModule.readPrivateAuthorityDiagnostic(captured);
  assert.deepEqual(diagnostic, { phase: 'OUTPUT_WRITE', category: 'UNAVAILABLE' });
  assert.ok(Object.isFrozen(diagnostic));
  assert.equal(Object.hasOwn(captured, 'diagnostic'), false);
  const result = await cliFor(async () => { throw captured; }, output);
  assert.deepEqual(result.status, { ...blockedStatus, code: 'PRIVATE_AUTHORITY_OUTPUT_INVALID', diagnostic });
  assert.equal(result.stderr, 'DENY PRIVATE_AUTHORITY_OUTPUT_INVALID\n');
  let inspected = 0;
  const getter = Object.defineProperty(new Error(MARKER), 'diagnostic', { get() { inspected++; throw new Error(MARKER); } });
  for (const value of [Object.assign(new Error(MARKER), { diagnostic, phase: 'OUTPUT_WRITE', category: 'UNAVAILABLE' }),
    Object.assign(new Error(MARKER), { diagnostic: { phase: MARKER, category: MARKER } }),
    { ...captured, diagnostic }, getter,
    new Proxy(captured, { get() { inspected++; throw new Error(MARKER); }, getPrototypeOf() { inspected++; throw new Error(MARKER); } })]) {
    assert.equal(runtimeModule.readPrivateAuthorityDiagnostic(value), undefined);
    const rejected = await cliFor(async () => { throw value; }, output);
    assert.equal(Object.hasOwn(rejected.status, 'diagnostic'), false);
  }
  assert.equal(inspected, 0);
});

test('runtime dispatch never trusts diagnostic properties, getters, or proxy traps', async () => {
  const fixture = authorityFixture(); const runtimeClosure = closure();
  const root = mkdtempSync(join(tmpdir(), 'diagnostic-unknown-'));
  const output = join(root, 'verification.json'); const env = environment(fixture, runtimeClosure, root);
  const bootstrapCapability = await bootstrap(env, runtimeClosure);
  let inspected = 0;
  for (const value of [Object.assign(new Error(MARKER), { diagnostic: { phase: 'TRANSPORT', category: 'TIMEOUT' } }),
    Object.defineProperty(new Error(MARKER), 'diagnostic', { get() { inspected++; throw new Error(MARKER); } }),
    new Proxy({}, { get() { inspected++; throw new Error(MARKER); } })]) {
    const runtime = createPrivateAuthorityRuntime({ bootstrapCapability, environment: env, now: () => AT,
      fetchImpl: r2Fetch(fixture.authorityBytes, []), host: { ...hostFor(fixture, runtimeClosure), async dispatch() { throw value; } } });
    const result = await cliFor(runtime.execute, output);
    assert.deepEqual(result.status, blockedStatus);
    assert.equal(existsSync(output), false);
  }
  assert.equal(inspected, 0);
});
