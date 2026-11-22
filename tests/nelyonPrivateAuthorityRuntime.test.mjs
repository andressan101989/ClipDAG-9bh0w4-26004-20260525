import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';
import { publicAuthorityReceipt } from '../scripts/nelyon-release-authority-context.mjs';
import * as release from '../scripts/nelyon-production-release.mjs';
import { verifyAdminRecoverySourceProvenance } from '../scripts/nelyon-production-release.mjs';
import { createPrivateAuthorityProductionHost } from '../scripts/nelyon-private-authority-cli.mjs';
import { b2AdminHistoricalFixture, b2ChainStagedFixture } from './fixtures/nelyonB2HistoricalCapture.mjs';

const runtimeModule = await import('../scripts/nelyon-private-authority-runtime.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime, loadProtectedB2RecoveryRuntime,
  readTrustedAuthorityEnvironment, resolveProtectedB2RecoveryAuthority, stageProtectedB2RecoverySource } = runtimeModule;
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

function authorityFixture({ historical = false } = {}) {
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
  if (historical) delete authority.vaultEdgeParity;
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

function assertClosedError(operation, code) {
  return assert.rejects(operation, error => {
    assert.equal(error.code, code);
    assert.equal(String(error).includes(MARKER), false);
    assert.equal(String(error.stack).includes(MARKER), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
}

test('trusted environment is exact, frozen and missing configuration is fail-closed', () => {
  assert.equal(typeof readTrustedAuthorityEnvironment, 'function');
  assert.throws(() => readTrustedAuthorityEnvironment({}), { code: 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED' });
  assert.throws(() => readTrustedAuthorityEnvironment({ NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2' }),
    { code: 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED' });
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-env-'));
  const values = readTrustedAuthorityEnvironment(environment(fixture, closure(), runnerTemp));
  assert.ok(Object.isFrozen(values));
  assert.deepEqual(Object.keys(values).sort(), [
    'accessKeyId', 'accountId', 'authoritySha256', 'bucket', 'descriptorSha256',
    'policySha256', 'provider', 'runtimeClosureSha256', 'secretAccessKey', 'timeoutMs',
  ]);
  assert.equal(values.timeoutMs, 10000);
  assert.equal(values.secretAccessKey, 'synthetic-secret-key');
});

test('unknown reserved variables, malformed values, proxies and getters are rejected without coercion', () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-env-invalid-'));
  const good = environment(fixture, closure(), runnerTemp);
  assert.throws(() => readTrustedAuthorityEnvironment({ ...good, NELYON_PRIVATE_AUTHORITY_URL: 'https://invalid.example' }),
    { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
  assert.throws(() => readTrustedAuthorityEnvironment({ ...good, NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS: '010' }),
    { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
  assert.throws(() => readTrustedAuthorityEnvironment(new Proxy(good, {})),
    { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
  let getters = 0;
  const hostile = { ...good };
  Object.defineProperty(hostile, 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY', {
    enumerable: true,
    get() { getters += 1; throw new Error(MARKER); },
  });
  assert.throws(() => readTrustedAuthorityEnvironment(hostile), { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
  assert.equal(getters, 0);
});

test('closure bootstrap precedes provider-secret reads and blocks drift before transport', async () => {
  assert.equal(typeof createPrivateAuthorityRuntime, 'function');
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-bootstrap-'));
  const runtimeClosure = structuredClone(closure());
  let secretReads = 0;
  const env = environment(fixture, runtimeClosure, runnerTemp,
    { NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: '0'.repeat(64) });
  Object.defineProperty(env, 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY', {
    enumerable: true,
    get() { secretReads += 1; throw new Error(MARKER); },
  });
  await assertClosedError(bootstrap(env), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  assert.equal(secretReads, 0, 'provider secret getter is never evaluated before closure acceptance');
});

test('authority-proof uses real signed R2 HEAD/GET, same branded context and closed exclusive output', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-positive-'));
  const runtimeClosure = closure();
  const calls = [];
  const counters = {};
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: r2Fetch(fixture.authorityBytes, calls),
    now: () => AT,
    host: hostFor(fixture, runtimeClosure, counters),
  });
  const output = join(runnerTemp, 'verification.json');
  const result = await runtime.execute(invocation(output));
  assert.deepEqual(result, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
  assert.ok(calls.every(call => call.url === `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/`
    + `nelyon-private-authority/internal/release-authority/v1/sha256/${fixture.authoritySha256}.json`));
  assert.ok(calls.every(call => /^AWS4-HMAC-SHA256 /.test(call.authorization)));
  assert.deepEqual(counters, { publicInputs: 1, dispatch: 1 });
  const verification = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(verification), [
    'schemaVersion', 'authorityId', 'descriptorSha256', 'publicContractSha256',
    'privateAuthoritySha256', 'bindingSha256', 'successorCatalogSha256',
    'securityAdvisorSha256', 'backupSha256', 'approvalSha256', 'verified',
  ]);
  const surface = `${JSON.stringify(result)}${readFileSync(output, 'utf8')}`;
  assert.equal(surface.includes(MARKER), false);
  assert.equal(surface.includes('synthetic-secret-key'), false);
  assert.equal(surface.includes('r2.cloudflarestorage.com'), false);
});

test('candidate source parity, provider overrides, timestamps and unknown actions fail before bootstrap', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-closed-input-'));
  const runtimeClosure = closure();
  const counters = {};
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: r2Fetch(fixture.authorityBytes, []),
    now: () => AT,
    host: hostFor(fixture, runtimeClosure, counters),
  });
  for (const changed of [
    { ...invocation(join(runnerTemp, 'a.json')), sourceParity: {} },
    invocation(join(runnerTemp, 'b.json'), { sourceParity: {} }),
    invocation(join(runnerTemp, 'c.json'), { provider: 'candidate' }),
    invocation(join(runnerTemp, 'd.json'), { requestedAt: AT }),
    { ...invocation(join(runnerTemp, 'e.json')), action: 'release' },
  ]) {
    await assertClosedError(runtime.execute(changed), 'PRIVATE_AUTHORITY_STAGE_INVALID');
  }
  assert.equal(counters.publicInputs ?? 0, 0);
});

test('public descriptor and manifest binding mismatch fail before R2 transport', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-binding-'));
  const runtimeClosure = closure();
  const counters = {};
  const host = hostFor(fixture, runtimeClosure, counters);
  const changedHost = Object.freeze({ ...host, async loadPublicInputs(value) {
    const result = await host.loadPublicInputs(value);
    return { ...result, descriptorBytes: Buffer.concat([result.descriptorBytes, Buffer.from(' ')]) };
  } });
  let fetches = 0;
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: async () => { fetches += 1; throw new Error(MARKER); },
    now: () => AT,
    host: changedHost,
  });
  await assertClosedError(runtime.execute(invocation(join(runnerTemp, 'verification.json'))),
    'RELEASE_AUTHORITY_CONTEXT_INVALID');
  assert.equal(fetches, 0);
  assert.equal(counters.dispatch ?? 0, 0);
});

test('policy, request and manifest digest authentication fail before provider-secret access or R2 transport', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-public-auth-'));
  const runtimeClosure = closure();
  const baseHost = hostFor(fixture, runtimeClosure);
  for (const mutate of [
    value => { value.policyBytes = Buffer.concat([value.policyBytes, Buffer.from(' ')]); },
    value => { value.requestBytes = Buffer.from(canonicalJson({ ...fixture.request, runId: '987654321' }), 'utf8'); },
    value => { value.manifestDigestBytes = Buffer.from(`${'0'.repeat(64)}\n`, 'utf8'); },
  ]) {
    let secretReads = 0;
    let fetches = 0;
    const env = environment(fixture, runtimeClosure, runnerTemp);
    Object.defineProperty(env, 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY', {
      enumerable: true,
      get() { secretReads += 1; throw new Error(MARKER); },
    });
    const host = Object.freeze({ ...baseHost, async loadPublicInputs(value) {
      const loaded = await baseHost.loadPublicInputs(value);
      mutate(loaded);
      return loaded;
    } });
    const runtime = createPrivateAuthorityRuntime({
      bootstrapCapability: await bootstrap(env), environment: env,
      fetchImpl: async () => { fetches += 1; throw new Error(MARKER); },
      now: () => AT,
      host,
    });
    await assertClosedError(runtime.execute(invocation(join(runnerTemp, `${fetches}-${secretReads}-${Date.now()}.json`))),
      'PRIVATE_AUTHORITY_SOURCE_INVALID');
    assert.equal(secretReads, 0);
    assert.equal(fetches, 0);
  }
});

test('unavailable/marker-bearing provider failures stay generic and create no output', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-unavailable-'));
  const runtimeClosure = closure();
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: r2Fetch(fixture.authorityBytes, [], 404),
    now: () => AT,
    host: hostFor(fixture, runtimeClosure),
  });
  const output = join(runnerTemp, 'verification.json');
  await assertClosedError(runtime.execute(invocation(output)), 'PRIVATE_AUTHORITY_VERSION_UNAVAILABLE');
  assert.equal(existsSync(output), false);
});

test('an authenticated historical envelope without parity cannot dispatch a new authority proof', async () => {
  const fixture = authorityFixture({ historical: true });
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-missing-parity-'));
  const runtimeClosure = closure();
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const counters = {};
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: r2Fetch(fixture.authorityBytes, []), now: () => AT,
    host: hostFor(fixture, runtimeClosure, counters),
  });
  const output = join(runnerTemp, 'verification.json');
  await assert.rejects(runtime.execute(invocation(output)));
  assert.equal(counters.dispatch ?? 0, 0);
  assert.equal(existsSync(output), false);
});

test('trusted clock is resampled after provider wait so an expired authority cannot reach dispatch', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-expiry-'));
  const runtimeClosure = closure();
  const counters = {};
  const parityExpiresAt = JSON.parse(fixture.authorityBytes).vaultEdgeParity.expiresAt;
  let clock = AT;
  const calls = [];
  const fetchFixture = r2Fetch(fixture.authorityBytes, calls);
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: async request => {
      const response = await fetchFixture(request);
      if (request.method === 'GET') clock = parityExpiresAt;
      return response;
    },
    now: () => clock,
    host: hostFor(fixture, runtimeClosure, counters),
  });
  const output = join(runnerTemp, 'verification.json');
  await assertClosedError(runtime.execute(invocation(output)), 'RELEASE_AUTHORITY_CONTEXT_INVALID');
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
  assert.equal(counters.dispatch ?? 0, 0);
  assert.equal(existsSync(output), false);
});

test('verification output is exclusive, contained by RUNNER_TEMP and never overwrites prior proof', async () => {
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-output-'));
  const runtimeClosure = closure();
  const calls = [];
  const env = environment(fixture, runtimeClosure, runnerTemp);
  const runtime = createPrivateAuthorityRuntime({
    bootstrapCapability: await bootstrap(env), environment: env,
    fetchImpl: r2Fetch(fixture.authorityBytes, calls),
    now: () => AT,
    host: hostFor(fixture, runtimeClosure),
  });
  const output = join(runnerTemp, 'verification.json');
  writeFileSync(output, 'prior-proof');
  await assertClosedError(runtime.execute(invocation(output)), 'PRIVATE_AUTHORITY_OUTPUT_INVALID');
  assert.equal(readFileSync(output, 'utf8'), 'prior-proof');
  const outside = join(resolve(runnerTemp, '..'), 'outside-verification.json');
  await assertClosedError(runtime.execute(invocation(outside)), 'PRIVATE_AUTHORITY_OUTPUT_INVALID');
  assert.equal(existsSync(outside), false);
  assert.equal(calls.length, 0, 'invalid public output is rejected before private transport');
});

test('protected recovery requires the separate authorization root before any provider or GitHub call', async () => {
  const source = await b2AdminHistoricalFixture();
  const fixture = authorityFixture();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-recovery-root-'));
  const env = environment(fixture, closure(), runnerTemp, { GITHUB_TOKEN: 'synthetic-github-token' });
  const bootstrapCapability = await bootstrap(env);
  let calls = 0;
  await assertClosedError(loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: env,
    policyBytes: Buffer.from(source.historical.policyBytes), runId: source.historical.request.runId,
    runAttempt: source.historical.request.runAttempt,
    releaseBundle: { directory: source.historical.paths.release }, gateEvidence: { directory: source.historical.paths.gate },
    fetchImpl: async () => { calls += 1; throw new Error(MARKER); } }), 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  await assertClosedError(stageProtectedB2RecoverySource({ bootstrapCapability, environment: env,
    policyBytes: Buffer.from(source.historical.policyBytes), runId: source.historical.request.runId,
    fetchImpl: async () => { calls += 1; throw new Error(MARKER); } }), 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  assert.equal(calls, 0);
});

test('unknown B2 recovery root names are rejected as reserved configuration', () => {
  const fixture = authorityFixture();
  const env = environment(fixture, closure(), mkdtempSync(join(tmpdir(), 'nelyon-runtime-reserved-root-')),
    { NELYON_B2_RECOVERY_AUTHORIZATION_OVERRIDE: 'candidate' });
  assert.throws(() => readTrustedAuthorityEnvironment(env), { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
});

test('protected recovery loads separate authorization under the unchanged real policy', async () => {
  const source = await b2AdminHistoricalFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const authorizationBytes = Buffer.from(canonicalJson({ schema_version: 1,
    kind: 'nelyon-b2-exact-attempt-recovery-v1', repository: source.policy.repository,
    workflow_path: source.policy.workflow_path, policy_sha256: hash(policyBytes), approved_sources: [{
      source: source.historical.source, admin_artifact: { id: '13', name: source.artifacts[2].name,
        digest: source.artifacts[2].digest }, postcheck_chain: null,
    }] }));
  const fixture = authorityFixture();
  const env = environment(fixture, closure(), mkdtempSync(join(tmpdir(), 'nelyon-runtime-separate-root-')), {
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authorizationBytes),
    GITHUB_TOKEN: 'synthetic-github-token', SUPABASE_ACCESS_TOKEN: 'synthetic-supabase-token',
  });
  const bootstrapCapability = await bootstrap(env);
  const calls = [];
  let githubCalls = 0;
  const fetchImpl = async (request, init) => {
    if (request instanceof Request && new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      return r2Fetch(request.url.endsWith(`${hash(authorizationBytes)}.json`)
        ? authorizationBytes : Buffer.from(source.contextArgs.authorityJson), calls)(request);
    }
    if (typeof request === 'string' && request.startsWith('https://api.supabase.com/')) return new Response('[]', { status: 200 });
    githubCalls += 1;
    return source.historical.fetchImpl(request, init);
  };
  assert.equal(typeof stageProtectedB2RecoverySource, 'function');
  await assertClosedError(stageProtectedB2RecoverySource({ bootstrapCapability, environment: env, policyBytes,
    runId: '999999999', fetchImpl }), 'PRIVATE_AUTHORITY_SOURCE_INVALID');
  assert.equal(githubCalls, 0, 'unknown selector fails before GitHub calls');
  assert.equal(existsSync(join(env.RUNNER_TEMP, 'nelyon-b2-recovery-source')), false);
  calls.length = 0;
  const staged = await stageProtectedB2RecoverySource({ bootstrapCapability, environment: env, policyBytes,
    runId: source.historical.request.runId, fetchImpl });
  assert.deepEqual(staged, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  assert.deepEqual(readFileSync(join(env.RUNNER_TEMP, 'nelyon-b2-recovery-source', 'admin', 'admin-web-manifest.sha256')),
    readFileSync(join(source.adminEvidence.directory, 'admin-web-manifest.sha256')));
  const sentinel = join(env.RUNNER_TEMP, 'nelyon-b2-recovery-source', 'sentinel');
  writeFileSync(sentinel, 'preserve');
  await assertClosedError(stageProtectedB2RecoverySource({ bootstrapCapability, environment: env, policyBytes,
    runId: source.historical.request.runId, fetchImpl }), 'PRIVATE_AUTHORITY_SOURCE_INVALID');
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
  calls.length = 0;
  const loaded = await loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: env, policyBytes,
    runId: source.historical.request.runId, runAttempt: source.historical.request.runAttempt,
    releaseBundle: source.releaseBundle, gateEvidence: source.gateEvidence, fetchImpl });
  assert.equal(loaded.verifiedSource.source_run_id, source.historical.request.runId);
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
  let mismatchCalls = 0;
  for (const change of [{ NELYON_RELEASE_POLICY_SHA256: '0'.repeat(64) },
    { NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: '0'.repeat(64) }]) {
    await assertClosedError(resolveProtectedB2RecoveryAuthority({ bootstrapCapability, environment: { ...env, ...change },
      recoveryRuntime: loaded, fetchImpl: async () => { mismatchCalls += 1; throw new Error(MARKER); } }),
    'PRIVATE_AUTHORITY_SOURCE_INVALID');
  }
  assert.equal(mismatchCalls, 0);
  const authorityContext = await resolveProtectedB2RecoveryAuthority({ bootstrapCapability, environment: env,
    recoveryRuntime: loaded, fetchImpl: r2Fetch(Buffer.from(source.contextArgs.authorityJson), []) });
  const protectedRequest = { ...source.recoveryRequest, mode: 'postcheck_recovery',
    scopeConfirmation: source.policy.scope_confirmations.postcheck_recovery };
  assert.equal(typeof release.validateProtectedB2RecoveryRequest, 'function');
  assert.doesNotThrow(() => release.validateProtectedB2RecoveryRequest({ request: protectedRequest,
    policy: source.policy, policyBytes, verifiedSource: loaded.verifiedSource, authorityContext }));
  assert.throws(() => release.validateProtectedB2RecoveryRequest({ request: { ...protectedRequest, recoverySourceRunId: '999' },
    policy: source.policy, policyBytes, verifiedSource: loaded.verifiedSource, authorityContext }));
  assert.throws(() => release.validateProtectedB2RecoveryRequest({ request: protectedRequest, policy: source.policy, policyBytes,
    verifiedSource: structuredClone(loaded.verifiedSource), authorityContext }));
  const pendingManifest = { identity: { approved_sha: protectedRequest.approvedSha, run_id: protectedRequest.runId,
    run_attempt: protectedRequest.runAttempt, release_id: protectedRequest.releaseId, mode: protectedRequest.mode },
  runtime_closure: closure(), delta: { productive_change_count: 0 },
  resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] },
  recovery: { kind: 'postcheck_only', source_run_id: protectedRequest.recoverySourceRunId }, result: 'DENY',
  blockers: [{ severity: 'BLOCKING', code: 'PRIVATE_B2_AUTHORITY_PENDING', path: null,
    resource: 'recovery', message: 'separate protected exact-attempt authorization is required' }] };
  const proof = async (current, name, action = 'recovery-authority-proof') => {
    const manifestBytes = Buffer.from(canonicalJson(current)); const requestBytes = Buffer.from(canonicalJson(protectedRequest));
    const publicInputs = { policyBytes, requestBytes, manifestBytes, manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`),
      descriptorBytes: Buffer.from(source.contextArgs.descriptorBytes) };
    const host = createPrivateAuthorityProductionHost({ publicInputs, environment: env,
      fetchImpl, repositoryRoot: ROOT, recoveryRuntime: loaded });
    const runtime = createPrivateAuthorityRuntime({ bootstrapCapability, environment: env,
      fetchImpl, now: () => AT, host, recoveryRuntime: loaded });
    return runtime.execute({ action, inputs: { policy: join(env.RUNNER_TEMP, 'protected-policy.json'), request: 'unused-request',
      bundle: 'unused-bundle', recoverySourceRun: source.historical.request.runId,
      run: 'unused-run', artifacts: 'unused-artifacts', releaseBundle: source.releaseBundle.directory,
      gateEvidence: source.gateEvidence.directory, ...(action === 'verify-recovery-source'
        ? { stageOutput: join(env.RUNNER_TEMP, `${name}-stage.json`) } : {}) },
    verificationOutput: join(env.RUNNER_TEMP, `${name}.json`) });
  };
  writeFileSync(join(env.RUNNER_TEMP, 'protected-policy.json'), policyBytes);
  await assert.doesNotReject(proof(pendingManifest, 'historical-proof'));
  await assert.doesNotReject(proof(pendingManifest, 'historical-source', 'verify-recovery-source'));
  const postcheckRequest = join(env.RUNNER_TEMP, 'protected-postcheck-request.json');
  const postcheckManifest = join(env.RUNNER_TEMP, 'protected-postcheck-manifest.json');
  const badSnapshot = join(env.RUNNER_TEMP, 'invalid-recovery-snapshot.json');
  writeFileSync(postcheckRequest, canonicalJson(protectedRequest)); writeFileSync(postcheckManifest, canonicalJson(pendingManifest));
  writeFileSync(badSnapshot, '{}');
  const quiet = { write: () => true };
  await assert.rejects(release.runCli(['postcheck-recovery', '--policy', join(env.RUNNER_TEMP, 'protected-policy.json'),
    '--request', postcheckRequest, '--recovery-manifest', postcheckManifest, '--verified-source',
    join(env.RUNNER_TEMP, 'historical-source-stage.json'), '--current-snapshot', badSnapshot,
    '--output', join(env.RUNNER_TEMP, 'invalid-postcheck-result.json')], authorityContext, null,
  { ...loaded, currentGate: {} }, { now: () => AT, stdout: quiet, stderr: quiet }),
  { code: 'B2_RECOVERY_AUTHORITY_INVALID' }, 'a branded source reaches recovery verification, which rejects bad evidence');
  const extraBlocker = structuredClone(pendingManifest); extraBlocker.blockers.push({ code: 'OTHER' });
  await assertClosedError(proof(extraBlocker, 'historical-extra-blocker'), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  const productive = structuredClone(pendingManifest); productive.resources.functions.push('unexpected');
  await assertClosedError(proof(productive, 'historical-productive'), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  const wrongSource = structuredClone(pendingManifest); wrongSource.recovery.source_run_id = '999';
  await assertClosedError(proof(wrongSource, 'historical-wrong-source'), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  const args = { ...source, authorityContext, verifiedB2Source: loaded.verifiedSource };
  assert.doesNotThrow(() => verifyAdminRecoverySourceProvenance(args));
  const changed = source.artifacts.map(item => ({ ...item }));
  changed[2].digest = `sha256:${'4'.repeat(64)}`;
  assert.throws(() => verifyAdminRecoverySourceProvenance({ ...args, artifacts: changed }),
    { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  const root = env.RUNNER_TEMP;
  const paths = { policy: join(root, 'policy.json'), request: join(root, 'request.json'),
    bundle: join(root, 'bundle'), run: join(root, 'source-run.json'), artifacts: join(root, 'source-artifacts.json') };
  mkdirSync(paths.bundle);
  const manifest = { ...source.recoveryManifest, runtime_closure: closure(),
    compiler: source.historical.manifest.compiler };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const requestBytes = Buffer.from(canonicalJson(source.recoveryRequest));
  writeFileSync(paths.policy, policyBytes); writeFileSync(paths.request, requestBytes);
  writeFileSync(join(paths.bundle, 'manifest.json'), manifestBytes);
  writeFileSync(paths.run, canonicalJson(source.run)); writeFileSync(paths.artifacts, canonicalJson(source.artifacts));
  const publicInputs = { policyBytes, requestBytes, manifestBytes,
    manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`), descriptorBytes: Buffer.from(source.contextArgs.descriptorBytes) };
  const fetchController = async (request, init) => {
    if (request instanceof Request && new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      return r2Fetch(Buffer.from(source.contextArgs.authorityJson), [])(request);
    }
    if (typeof request === 'string' && request.startsWith('https://api.supabase.com/')) {
      return new Response('[]', { status: 200 });
    }
    throw new Error('unexpected fake transport');
  };
  const controllerEnvironment = { ...env, SUPABASE_ACCESS_TOKEN: 'synthetic-supabase-token' };
  const host = createPrivateAuthorityProductionHost({ publicInputs, environment: controllerEnvironment,
    fetchImpl: fetchController, repositoryRoot: ROOT, recoveryRuntime: loaded });
  const controller = createPrivateAuthorityRuntime({ bootstrapCapability, environment: controllerEnvironment,
    fetchImpl: fetchController, now: () => AT, host, recoveryRuntime: loaded });
  const proofManifest = { ...manifest, result: 'NO PRODUCTIVE CHANGES', blockers: [],
    delta: { productive_change_count: 0 } };
  const proofManifestBytes = Buffer.from(canonicalJson(proofManifest));
  const adminProofInputs = { ...publicInputs, manifestBytes: proofManifestBytes,
    manifestDigestBytes: Buffer.from(`${hash(proofManifestBytes)}\n`) };
  const adminProofHost = createPrivateAuthorityProductionHost({ publicInputs: adminProofInputs,
    environment: controllerEnvironment, fetchImpl: fetchController, repositoryRoot: ROOT, recoveryRuntime: loaded });
  const adminProof = createPrivateAuthorityRuntime({ bootstrapCapability, environment: controllerEnvironment,
    fetchImpl: fetchController, now: () => AT, host: adminProofHost, recoveryRuntime: loaded });
  await assert.doesNotReject(adminProof.execute({ action: 'admin-recovery-authority-proof', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle, recoverySourceRun: source.historical.request.runId,
    run: paths.run, artifacts: paths.artifacts, releaseBundle: source.releaseBundle.directory,
    gateEvidence: source.gateEvidence.directory, adminEvidence: source.adminEvidence.directory,
  }, verificationOutput: join(root, 'admin-historical-proof.json') }));
  await assert.doesNotReject(controller.execute({ action: 'verify-admin-recovery-source', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle,
    recoverySourceRun: source.historical.request.runId, run: paths.run, artifacts: paths.artifacts,
    releaseBundle: source.releaseBundle.directory, gateEvidence: source.gateEvidence.directory,
    adminEvidence: source.adminEvidence.directory, stageOutput: join(root, 'admin-source.json'),
  }, verificationOutput: join(root, 'admin-receipt.json') }));
  const prestate = { action: 'verify-admin-recovery-cloudflare-prestate', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle,
    recoverySourceRun: source.historical.request.runId, run: paths.run, artifacts: paths.artifacts,
    releaseBundle: source.releaseBundle.directory, gateEvidence: source.gateEvidence.directory,
    adminEvidence: source.adminEvidence.directory, verifiedSource: join(root, 'admin-source.json'),
    previous: join(source.adminEvidence.directory, 'admin-web-previous.json'),
    routes: join(source.adminEvidence.directory, 'admin-web-before-routes.json'),
    stageOutput: join(root, 'prestate.json'),
  }, verificationOutput: join(root, 'prestate-receipt.json') };
  await assert.doesNotReject(controller.execute(prestate),
    'each Admin action reauthenticates its exact source before Cloudflare prestate');
  const invalidCurrent = join(root, 'admin-invalid-current.json');
  writeFileSync(invalidCurrent, '{}');
  await assertClosedError(controller.execute({ action: 'postcheck-admin-recovery', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle,
    recoverySourceRun: source.historical.request.runId, run: paths.run, artifacts: paths.artifacts,
    releaseBundle: source.releaseBundle.directory, gateEvidence: source.gateEvidence.directory,
    adminEvidence: source.adminEvidence.directory, verifiedSource: join(root, 'admin-source.json'),
    currentGate: invalidCurrent, currentSnapshot: invalidCurrent,
    adminManifest: join(source.adminEvidence.directory, 'admin-web-manifest.json'), build: invalidCurrent,
    stageOutput: join(root, 'admin-invalid-postcheck.json'),
  }, verificationOutput: join(root, 'admin-invalid-postcheck-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  assert.equal(existsSync(join(root, 'admin-invalid-postcheck.json')), false);
  const substituted = join(root, 'substituted-admin-source.json');
  writeFileSync(substituted, canonicalJson({ result: 'ADMIN_RECOVERY_SOURCE_VERIFIED' }));
  await assertClosedError(controller.execute({ ...prestate,
    inputs: { ...prestate.inputs, verifiedSource: substituted, stageOutput: join(root, 'blocked-prestate.json') },
    verificationOutput: join(root, 'blocked-prestate-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  assert.equal(existsSync(join(root, 'blocked-prestate.json')), false);
  const alteredArtifacts = join(root, 'altered-artifacts.json');
  writeFileSync(alteredArtifacts, canonicalJson(changed));
  await assertClosedError(controller.execute({ ...prestate,
    inputs: { ...prestate.inputs, artifacts: alteredArtifacts, stageOutput: join(root, 'bad-artifacts-result.json') },
    verificationOutput: join(root, 'bad-artifacts-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
  const { adminEvidence: ignoredAdminEvidence, ...missingEvidence } = prestate.inputs;
  await assertClosedError(controller.execute({ ...prestate, inputs: missingEvidence,
    verificationOutput: join(root, 'missing-admin-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_INVALID');
  assert.equal(existsSync(join(root, 'bad-artifacts-result.json')), false);
  const observationPath = join(source.gateEvidence.directory, 'release-observation.json');
  const savedObservation = readFileSync(observationPath);
  try {
    writeFileSync(observationPath, `${savedObservation.toString('utf8')} `);
    await assertClosedError(controller.execute({ ...prestate,
      inputs: { ...prestate.inputs, stageOutput: join(root, 'altered-gate-result.json') },
      verificationOutput: join(root, 'altered-gate-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
    assert.equal(existsSync(join(root, 'altered-gate-result.json')), false);
  } finally { writeFileSync(observationPath, savedObservation); }
  const remotePath = join(source.releaseBundle.directory, 'remote-evidence.json');
  const savedRemote = readFileSync(remotePath);
  try {
    writeFileSync(remotePath, `${savedRemote.toString('utf8')} `);
    await assertClosedError(controller.execute({ ...prestate,
      inputs: { ...prestate.inputs, stageOutput: join(root, 'altered-release-result.json') },
      verificationOutput: join(root, 'altered-release-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
    assert.equal(existsSync(join(root, 'altered-release-result.json')), false);
  } finally { writeFileSync(remotePath, savedRemote); }
  const manifestPath = join(source.adminEvidence.directory, 'admin-web-manifest.sha256');
  const savedManifest = readFileSync(manifestPath);
  try {
    writeFileSync(manifestPath, `${savedManifest.toString('utf8')} `);
    await assertClosedError(controller.execute({ ...prestate,
      inputs: { ...prestate.inputs, stageOutput: join(root, 'altered-file-result.json') },
      verificationOutput: join(root, 'altered-file-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
    assert.equal(existsSync(join(root, 'altered-file-result.json')), false);
  } finally { writeFileSync(manifestPath, savedManifest); }
});

test('one-hop controller authenticates the original and successful recovery attempt under one real policy', async () => {
  const source = await b2AdminHistoricalFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const runtimeClosure = closure();
  const chainRequest = { ...source.recoveryRequest, runId: '123456792', releaseId: 'nelyon-20261110-002',
    mode: 'postcheck_recovery', scopeConfirmation: source.policy.scope_confirmations.postcheck_recovery };
  const chainManifest = { ...source.recoveryManifest, compiler: source.historical.manifest.compiler,
    runtime_closure: runtimeClosure, identity: { approved_sha: chainRequest.approvedSha, mode: chainRequest.mode,
      release_id: chainRequest.releaseId, run_id: chainRequest.runId, run_attempt: chainRequest.runAttempt },
    recovery: { kind: 'postcheck_only', source_run_id: source.historical.request.runId,
      authorityReceipt: source.authorityContext.receipt } };
  const chain = b2ChainStagedFixture({ historical: source.historical, policy: source.policy,
    policySha256: hash(policyBytes), chainRequest, chainManifest });
  const entry = { source: source.historical.source, admin_artifact: source.historical.adminArtifact,
    postcheck_chain: { run_id: chainRequest.runId, run_attempt: chainRequest.runAttempt,
      release_id: chainRequest.releaseId, source_sha: chainRequest.approvedSha,
      manifest_sha256: hash(canonicalJson(chainManifest)), runtime_closure_sha256: runtimeClosure.closure_sha256,
      release_artifact: chain.artifacts.release, gate_artifact: chain.artifacts.gate, recovery_artifact: chain.artifacts.recovery } };
  const authBytes = Buffer.from(canonicalJson({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: source.policy.repository, workflow_path: source.policy.workflow_path,
    policy_sha256: hash(policyBytes), approved_sources: [entry] }));
  const root = mkdtempSync(join(tmpdir(), 'nelyon-runtime-chain-'));
  const env = environment(authorityFixture(), runtimeClosure, root, {
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authBytes),
    GITHUB_TOKEN: 'synthetic-github-token', SUPABASE_ACCESS_TOKEN: 'synthetic-supabase-token' });
  const bootstrapCapability = await bootstrap(env);
  const fetchImpl = async (input, init) => {
    if (input instanceof Request && new URL(input.url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      const bytes = input.url.endsWith(`${hash(authBytes)}.json`) ? authBytes : Buffer.from(source.contextArgs.authorityJson);
      return r2Fetch(bytes, [])(input);
    }
    const parsed = new URL(String(input));
    if (parsed.hostname === 'api.supabase.com') return new Response('[]', { status: 200 });
    if (parsed.pathname.endsWith(`/actions/runs/${chainRequest.runId}/attempts/${chainRequest.runAttempt}`)) {
      return new Response(JSON.stringify(chain.run), { status: 200 });
    }
    if (parsed.pathname.endsWith(`/actions/runs/${chainRequest.runId}/artifacts`)) {
      const artifacts = Object.values(chain.artifacts).map(item => ({ ...item, id: Number(item.id), expired: false }));
      return new Response(JSON.stringify({ total_count: artifacts.length, artifacts }), { status: 200 });
    }
    const archive = Object.entries(chain.artifacts).find(([, item]) => parsed.pathname.endsWith(`/actions/artifacts/${item.id}/zip`));
    if (archive) return new Response(chain.archives[archive[0]], { status: 200,
      headers: { 'content-length': String(chain.archives[archive[0]].length) } });
    return source.historical.fetchImpl(input, init);
  };
  await assert.doesNotReject(stageProtectedB2RecoverySource({ bootstrapCapability, environment: env,
    policyBytes, runId: chainRequest.runId, fetchImpl }));
  const stagedRoot = join(root, 'nelyon-b2-recovery-source');
  const loaded = await loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: env, policyBytes,
    runId: chainRequest.runId, runAttempt: null, releaseBundle: { directory: join(stagedRoot, 'release') },
    gateEvidence: { directory: join(stagedRoot, 'gate') }, fetchImpl });
  const recoveryRequest = { ...source.recoveryRequest, recoverySourceRunId: chainRequest.runId };
  const recoveryManifest = { ...source.recoveryManifest, compiler: source.historical.manifest.compiler, runtime_closure: runtimeClosure,
    recovery: { ...source.recoveryManifest.recovery, source_run_id: chainRequest.runId } };
  const requestBytes = Buffer.from(canonicalJson(recoveryRequest));
  const manifestBytes = Buffer.from(canonicalJson(recoveryManifest));
  const paths = { policy: join(root, 'policy.json'), request: join(root, 'request.json'), bundle: join(root, 'bundle'),
    run: join(root, 'chain-run.json'), artifacts: join(root, 'chain-artifacts.json') };
  mkdirSync(paths.bundle); writeFileSync(paths.policy, policyBytes); writeFileSync(paths.request, requestBytes);
  writeFileSync(join(paths.bundle, 'manifest.json'), manifestBytes); writeFileSync(paths.run, canonicalJson(chain.run));
  writeFileSync(paths.artifacts, canonicalJson(Object.values(chain.artifacts).map(item => ({ ...item, expired: false }))));
  const publicInputs = { policyBytes, requestBytes, manifestBytes, manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`),
    descriptorBytes: Buffer.from(source.contextArgs.descriptorBytes) };
  const host = createPrivateAuthorityProductionHost({ publicInputs, environment: env, fetchImpl, repositoryRoot: ROOT, recoveryRuntime: loaded });
  const controller = createPrivateAuthorityRuntime({ bootstrapCapability, environment: env, fetchImpl,
    now: () => AT, host, recoveryRuntime: loaded });
  const invocation = { action: 'verify-admin-recovery-postcheck-chain', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle, recoverySourceRun: chainRequest.runId,
    run: paths.run, artifacts: paths.artifacts, releaseBundle: chain.paths.release, gateEvidence: chain.paths.gate,
    postcheckRecoveryEvidence: chain.paths.recovery, stageOutput: join(root, 'chain-result.json'),
  }, verificationOutput: join(root, 'chain-receipt.json') };
  await assert.doesNotReject(controller.execute(invocation));
  const evidencePath = join(chain.paths.recovery, 'verified-source.json');
  const saved = readFileSync(evidencePath);
  try {
    writeFileSync(evidencePath, `${saved.toString('utf8')} `);
    await assertClosedError(controller.execute({ ...invocation,
      inputs: { ...invocation.inputs, stageOutput: join(root, 'chain-altered-result.json') },
      verificationOutput: join(root, 'chain-altered-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
    assert.equal(existsSync(join(root, 'chain-altered-result.json')), false);
  } finally { writeFileSync(evidencePath, saved); }
  const originalRun = join(root, 'original-run.json'); const originalArtifacts = join(root, 'original-artifacts.json');
  writeFileSync(originalRun, canonicalJson(source.run)); writeFileSync(originalArtifacts, canonicalJson(source.artifacts));
  await assert.doesNotReject(controller.execute({ action: 'verify-admin-recovery-source', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle, recoverySourceRun: chainRequest.runId,
    run: originalRun, artifacts: originalArtifacts, releaseBundle: source.releaseBundle.directory,
    gateEvidence: source.gateEvidence.directory, adminEvidence: source.adminEvidence.directory,
    chainRun: paths.run, chainArtifacts: paths.artifacts, chainReleaseBundle: chain.paths.release,
    chainGateEvidence: chain.paths.gate, chainRecoveryEvidence: chain.paths.recovery,
    stageOutput: join(root, 'chain-admin-source.json'),
  }, verificationOutput: join(root, 'chain-admin-receipt.json') }),
  'the chained Admin source is freshly authenticated inside the controller');
  const chainPrestate = { action: 'verify-admin-recovery-cloudflare-prestate', inputs: {
    policy: paths.policy, request: paths.request, bundle: paths.bundle, recoverySourceRun: chainRequest.runId,
    run: originalRun, artifacts: originalArtifacts, releaseBundle: source.releaseBundle.directory,
    gateEvidence: source.gateEvidence.directory, adminEvidence: source.adminEvidence.directory,
    chainRun: paths.run, chainArtifacts: paths.artifacts, chainReleaseBundle: chain.paths.release,
    chainGateEvidence: chain.paths.gate, chainRecoveryEvidence: chain.paths.recovery,
    verifiedSource: join(root, 'chain-admin-source.json'), previous: join(source.adminEvidence.directory, 'admin-web-previous.json'),
    routes: join(source.adminEvidence.directory, 'admin-web-before-routes.json'), stageOutput: join(root, 'chain-prestate.json'),
  }, verificationOutput: join(root, 'chain-prestate-receipt.json') };
  await assert.doesNotReject(controller.execute(chainPrestate), 'chained prestate reauthenticates both attempts');
  const proofManifest = { ...recoveryManifest, result: 'NO PRODUCTIVE CHANGES', blockers: [], delta: { productive_change_count: 0 } };
  const proofBytes = Buffer.from(canonicalJson(proofManifest));
  const proofInputs = { ...publicInputs, manifestBytes: proofBytes, manifestDigestBytes: Buffer.from(`${hash(proofBytes)}\n`) };
  const proofHost = createPrivateAuthorityProductionHost({ publicInputs: proofInputs, environment: env, fetchImpl,
    repositoryRoot: ROOT, recoveryRuntime: loaded });
  const proofController = createPrivateAuthorityRuntime({ bootstrapCapability, environment: env, fetchImpl,
    now: () => AT, host: proofHost, recoveryRuntime: loaded });
  const { verifiedSource: ignoredSource, previous: ignoredPrevious, routes: ignoredRoutes, stageOutput: ignoredOutput, ...proofActionInputs } = chainPrestate.inputs;
  await assert.doesNotReject(proofController.execute({ action: 'admin-recovery-authority-proof', inputs: proofActionInputs,
    verificationOutput: join(root, 'chain-admin-proof.json') }));
  const originalChainRun = readFileSync(paths.run);
  try {
    writeFileSync(paths.run, canonicalJson({ ...chain.run, run_attempt: chain.run.run_attempt + 1 }));
    await assertClosedError(controller.execute({ ...chainPrestate,
      inputs: { ...chainPrestate.inputs, stageOutput: join(root, 'chain-bad-prestate.json') },
      verificationOutput: join(root, 'chain-bad-receipt.json') }), 'PRIVATE_AUTHORITY_STAGE_BLOCKED');
    assert.equal(existsSync(join(root, 'chain-bad-prestate.json')), false);
  } finally { writeFileSync(paths.run, originalChainRun); }
});

test('protected recovery caller binds policy root, exact attempt and historical Git closure after bootstrap', async () => {
  const source = await b2AdminHistoricalFixture();
  const fixture = authorityFixture();
  const runtimeClosure = closure();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-recovery-'));
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const authBytes = Buffer.from(canonicalJson({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: source.policy.repository, workflow_path: source.policy.workflow_path, policy_sha256: hash(policyBytes),
    approved_sources: [{ source: source.historical.source, admin_artifact: null, postcheck_chain: null }] }));
  const env = environment(fixture, runtimeClosure, runnerTemp, {
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authBytes),
    GITHUB_TOKEN: 'synthetic-github-token',
  });
  const bootstrapCapability = await bootstrap(env);
  const fetchImpl = async (request, init) => request instanceof Request && new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com')
    ? r2Fetch(authBytes, [])(request) : source.historical.fetchImpl(request, init);
  const loaded = await loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: env,
    policyBytes, runId: source.historical.request.runId,
    runAttempt: source.historical.request.runAttempt,
    releaseBundle: { directory: source.historical.paths.release }, gateEvidence: { directory: source.historical.paths.gate },
    fetchImpl });
  assert.equal(loaded.verifiedSource.source_run_id, source.historical.request.runId);
  assert.equal(loaded.historicalRuntimeClosure.closureSha256, runtimeClosure.closure_sha256);
  let fetches = 0;
  const missingRoot = { ...env };
  delete missingRoot.NELYON_RELEASE_POLICY_SHA256;
  await assertClosedError(loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: missingRoot,
    policyBytes, runId: source.historical.request.runId,
    runAttempt: source.historical.request.runAttempt,
    releaseBundle: { directory: source.historical.paths.release }, gateEvidence: { directory: source.historical.paths.gate },
    fetchImpl: async () => { fetches += 1; throw new Error(MARKER); } }), 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED');
  assert.equal(fetches, 0);
});

test('protected historical authority resolution uses the source digest through real R2 HEAD/GET, never current pins', async () => {
  const source = await b2AdminHistoricalFixture();
  const fixture = authorityFixture();
  const runtimeClosure = closure();
  const runnerTemp = mkdtempSync(join(tmpdir(), 'nelyon-runtime-recovery-r2-'));
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const authBytes = Buffer.from(canonicalJson({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: source.policy.repository, workflow_path: source.policy.workflow_path, policy_sha256: hash(policyBytes),
    approved_sources: [{ source: source.historical.source, admin_artifact: null, postcheck_chain: null }] }));
  const env = environment(fixture, runtimeClosure, runnerTemp, {
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authBytes),
    GITHUB_TOKEN: 'synthetic-github-token',
  });
  delete env.NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256;
  delete env.NELYON_PRIVATE_AUTHORITY_SHA256;
  const bootstrapCapability = await bootstrap(env);
  const fetchImpl = async (request, init) => request instanceof Request && new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com')
    ? r2Fetch(authBytes, [])(request) : source.historical.fetchImpl(request, init);
  const loaded = await loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment: env,
    policyBytes, runId: source.historical.request.runId,
    runAttempt: source.historical.request.runAttempt,
    releaseBundle: { directory: source.historical.paths.release }, gateEvidence: { directory: source.historical.paths.gate },
    fetchImpl });
  const historicalBytes = Buffer.from(source.contextArgs.authorityJson, 'utf8');
  const calls = [];
  const authorityContext = await resolveProtectedB2RecoveryAuthority({ bootstrapCapability, environment: env,
    recoveryRuntime: loaded, fetchImpl: r2Fetch(historicalBytes, calls) });
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
  assert.ok(calls.every(call => call.url.endsWith(
    `/internal/release-authority/v1/sha256/${source.contextArgs.expectedPrivateAuthoritySha256}.json`)));
  assert.deepEqual(publicAuthorityReceipt(authorityContext), publicAuthorityReceipt(source.historical.authorityContext));
});
