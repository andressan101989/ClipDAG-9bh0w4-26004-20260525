import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createReleaseAuthorityContext, publicAuthorityReceipt } from '../scripts/nelyon-release-authority-context.mjs';
import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';

const cliModule = await import('../scripts/nelyon-private-authority-cli.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const {
  adminRecoveryRequiresProtectedB2Runtime,
  assertProductionInvocationIdentity,
  createPrivateAuthorityProductionHost,
  runPrivateAuthorityCli,
} = cliModule;
const MARKER = 'PRIVATE_CLI_SYNTHETIC_MARKER';
const COMMON = [
  '--policy', 'policy.json',
  '--request', 'request.json',
  '--bundle', 'bundle',
  '--verification-output', 'verification.json',
];
const ACTIONS = [
  'authority-proof',
  'preflight-release',
  'authorize-refresh',
  'dryrun-migrations',
  'apply-migrations',
  'stage-b2-recovery-source',
  'revalidate',
  'verify-gate',
  'pre-snapshot',
  'verify-pre-snapshot',
  'post-snapshot',
  'postcheck',
  'verify-recovery-source',
  'recovery-authority-proof',
  'admin-recovery-authority-proof',
  'revalidate-b2-recovery',
  'revalidate-b2-admin-recovery',
  'verify-b2-recovery-gate',
  'verify-b2-admin-recovery-gate',
  'recovery-snapshot',
  'postcheck-recovery',
  'verify-admin-recovery-source',
  'verify-admin-recovery-postcheck-chain',
  'postcheck-admin-recovery',
  'verify-admin-recovery-cloudflare-prestate',
];

test('step-scoped authority-plane brand keeps legacy Admin recovery outside the B2 runtime even when a root is installed', () => {
  const root = 'a'.repeat(64);
  const legacyEnvironment = Object.freeze({
    NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'false',
    NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: root,
  });
  const b2Environment = Object.freeze({
    NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'true',
    NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: root,
  });
  assert.equal(adminRecoveryRequiresProtectedB2Runtime({ request: { mode: 'admin_recovery' }, environment: legacyEnvironment }), false);
  assert.equal(adminRecoveryRequiresProtectedB2Runtime({ request: { mode: 'admin_recovery' }, environment: b2Environment }), true);
  assert.equal(adminRecoveryRequiresProtectedB2Runtime({ request: { mode: 'postcheck_recovery' }, environment: Object.freeze({}) }), true);
  assert.throws(() => adminRecoveryRequiresProtectedB2Runtime({
    request: { mode: 'admin_recovery' }, environment: Object.freeze({ NELYON_ADMIN_RECOVERY_B2_REQUIRED: '' }),
  }), /blocked/);
});
const EXTRA = {
  'dryrun-migrations': ['--current-gate','gate.json','--pre-snapshot','pre.json','--binary-path','supabase','--stage-output','stage.json'],
  'apply-migrations': ['--current-gate','gate.json','--pre-snapshot','pre.json','--binary-path','supabase','--stage-output','stage.json'],
  'authority-proof': [],
  'preflight-release': ['--compiler-sha256', 'a'.repeat(64), '--remote-evidence', 'remote.json', '--stage-output', 'stage.json'],
  'authorize-refresh': ['--policy-sha256', 'b'.repeat(64), '--compiler-sha256', 'a'.repeat(64),
    '--environment', 'environment.json', '--branch-policies', 'branches.json', '--approvals', 'approvals.json',
    '--runs', 'runs.json', '--auto-deploy-expected', 'OFF', '--stage-output', 'stage.json'],
  'stage-b2-recovery-source': ['--recovery-source-run', '123'],
  revalidate: ['--compiler-sha256', 'a'.repeat(64), '--remote-evidence', 'remote.json', '--stage-output', 'stage.json'],
  'verify-gate': ['--policy-sha256', 'b'.repeat(64), '--compiler-sha256', 'a'.repeat(64),
    '--environment', 'environment.json', '--branch-policies', 'branches.json', '--approvals', 'approvals.json',
    '--runs', 'runs.json', '--auto-deploy-expected', 'OFF', '--stage-output', 'stage.json'],
  'pre-snapshot': ['--snapshot-output', 'snapshot.json'],
  'verify-pre-snapshot': ['--manifest', 'manifest.json', '--pre-snapshot', 'pre.json', '--stage-output', 'stage.json'],
  'post-snapshot': ['--pre-snapshot', 'pre.json', '--snapshot-output', 'snapshot.json'],
  postcheck: ['--manifest', 'manifest.json', '--pre-snapshot', 'pre.json', '--post-snapshot', 'post.json',
    '--stage-output', 'stage.json'],
  'verify-recovery-source': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--stage-output', 'stage.json'],
  'recovery-authority-proof': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence'],
  'admin-recovery-authority-proof': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--admin-evidence', 'admin-evidence'],
  'revalidate-b2-recovery': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--compiler-sha256', 'a'.repeat(64),
    '--remote-evidence', 'remote.json', '--stage-output', 'stage.json'],
  'revalidate-b2-admin-recovery': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--admin-evidence', 'admin-evidence',
    '--compiler-sha256', 'a'.repeat(64), '--remote-evidence', 'remote.json', '--stage-output', 'stage.json'],
  'verify-b2-recovery-gate': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--policy-sha256', 'b'.repeat(64),
    '--compiler-sha256', 'a'.repeat(64), '--environment', 'environment.json', '--branch-policies', 'branches.json',
    '--approvals', 'approvals.json', '--runs', 'runs.json', '--auto-deploy-expected', 'OFF',
    '--revalidated', 'revalidated.json', '--stage-output', 'stage.json'],
  'verify-b2-admin-recovery-gate': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--admin-evidence', 'admin-evidence',
    '--policy-sha256', 'b'.repeat(64), '--compiler-sha256', 'a'.repeat(64), '--environment', 'environment.json',
    '--branch-policies', 'branches.json', '--approvals', 'approvals.json', '--runs', 'runs.json',
    '--auto-deploy-expected', 'OFF', '--revalidated', 'revalidated.json', '--stage-output', 'stage.json'],
  'recovery-snapshot': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--current-gate', 'gate.json',
    '--snapshot-output', 'snapshot.json'],
  'postcheck-recovery': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--current-gate', 'gate.json', '--current-snapshot', 'current.json',
    '--verified-source', 'verified.json', '--stage-output', 'stage.json'],
  'verify-admin-recovery-source': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--admin-evidence', 'admin-evidence',
    '--stage-output', 'stage.json'],
  'verify-admin-recovery-postcheck-chain': ['--recovery-source-run', '123', '--run', 'run.json',
    '--artifacts', 'artifacts.json', '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence',
    '--postcheck-recovery-evidence', 'recovery-evidence', '--stage-output', 'stage.json'],
  'postcheck-admin-recovery': ['--recovery-source-run', '123', '--run', 'run.json', '--artifacts', 'artifacts.json',
    '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence', '--admin-evidence', 'admin-evidence', '--current-gate', 'gate.json', '--current-snapshot', 'current.json',
    '--verified-source', 'verified.json', '--admin-manifest', 'admin.json', '--build', 'build.json', '--stage-output', 'stage.json'],
  'verify-admin-recovery-cloudflare-prestate': ['--recovery-source-run', '123', '--run', 'run.json',
    '--artifacts', 'artifacts.json', '--release-bundle', 'release-bundle', '--gate-evidence', 'gate-evidence',
    '--admin-evidence', 'admin-evidence',
    '--verified-source', 'verified.json', '--previous', 'previous.json', '--routes', 'routes.json', '--stage-output', 'stage.json'],
};

function sink() {
  let text = '';
  return Object.freeze({
    write(value) { text += value; },
    read() { return text; },
  });
}

function trustedHost(execute) {
  const stdout = sink();
  const stderr = sink();
  return { execute, stdout, stderr };
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonicalJson = value => `${JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)}\n`;

function providerOnlyAuthorityContext() {
  const contract = {
    id: 'synthetic-provider-only-authority',
    to_phase: 'web-control-centers-b2',
    baseline_sha: 'a'.repeat(40),
    reviewed_source_sha: 'b'.repeat(40),
    integration_base_sha: 'c'.repeat(40),
  };
  const publicContractSha256 = sha256(canonicalJson(contract));
  const relation = {
    identity: 'private.synthetic_provider_only',
    definitionSha256: 'd'.repeat(64),
    owner: 'postgres',
    rls: true,
    forceRls: true,
  };
  const expectedCanonicalJson = canonicalJson(relation).trimEnd();
  const authority = {
    schemaVersion: 1,
    authorityId: 'synthetic-provider-only-authority',
    publicContractSha256,
    phase: contract.to_phase,
    issuedFor: {
      baselineSha: contract.baseline_sha,
      reviewedSourceSha: contract.reviewed_source_sha,
      integrationBaseSha: contract.integration_base_sha,
    },
    successorCatalog: { schemaVersion: 1, records: [{
      kind: 'relation', identity: relation.identity, expectedCanonicalJson,
      expectedSha256: sha256(expectedCanonicalJson),
    }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: sha256('[]\n'), baselineItems: [], records: [] },
    backup: {
      schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: 'e'.repeat(64),
      evidenceSha256: 'f'.repeat(64), status: 'COMPLETED', insertedAt: '2026-11-08T10:00:00.000Z',
      completedObservedAt: '2026-11-08T10:30:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z',
    },
    vaultEdgeParity: syntheticVaultEdgeParity('2026-11-08T11:00:00.000Z'),
    approval: {
      schemaVersion: 1, decision: 'APPROVED', scope: [contract.to_phase], authorizationSha256: '1'.repeat(64),
      approvedAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-09T11:00:00.000Z',
    },
  };
  const authorityJson = JSON.stringify(authority);
  const descriptorBytes = Buffer.from(JSON.stringify({
    schema_version: 1,
    contract,
    public_contract_sha256: publicContractSha256,
    private_authority: {
      required: true,
      schema_version: 1,
      authority_id: authority.authorityId,
      sha256: sha256(authorityJson),
    },
  }));
  return createReleaseAuthorityContext({
    descriptorBytes,
    expectedDescriptorSha256: sha256(descriptorBytes),
    phase: contract.to_phase,
    transitionId: contract.id,
    baselineSha: contract.baseline_sha,
    reviewedSourceSha: contract.reviewed_source_sha,
    integrationBaseSha: contract.integration_base_sha,
    requestedAt: '2026-11-08T12:00:00.000Z',
    authorityJson,
    expectedPrivateAuthoritySha256: sha256(authorityJson),
  });
}

test('strict authority-proof CLI emits exact closed success and passes only parsed public invocation', async () => {
  assert.equal(typeof runPrivateAuthorityCli, 'function');
  let received;
  const host = trustedHost(async invocation => {
    received = invocation;
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  });
  const code = await runPrivateAuthorityCli(['authority-proof', ...COMMON], host);
  assert.equal(code, 0);
  assert.equal(host.stdout.read(), '{"schemaVersion":1,"result":"VERIFIED","releaseReady":false}\n');
  assert.equal(host.stderr.read(), '');
  assert.deepEqual(received, {
    action: 'authority-proof',
    inputs: { policy: 'policy.json', request: 'request.json', bundle: 'bundle' },
    verificationOutput: 'verification.json',
  });
  assert.ok(Object.isFrozen(received));
  assert.ok(Object.isFrozen(received.inputs));
});

test('production authority-proof is provider-only and never reads Supabase operation inventory', async () => {
  assert.equal(typeof createPrivateAuthorityProductionHost, 'function');
  const authorityContext = providerOnlyAuthorityContext();
  const receipt = publicAuthorityReceipt(authorityContext);
  let operationFetches = 0;
  const host = createPrivateAuthorityProductionHost({
    publicInputs: Object.freeze({
      policyBytes: Buffer.from('{}'),
      requestBytes: Buffer.from('{}'),
    }),
    environment: Object.freeze({}),
    fetchImpl: async () => { operationFetches += 1; throw new Error(MARKER); },
    repositoryRoot: 'D:\\synthetic-private-authority',
    recoveryRuntime: null,
  });

  const actual = await host.dispatch({
    action: 'authority-proof',
    inputs: Object.freeze({}),
    authorityContext,
    receipt,
    manifest: Object.freeze({}),
    now: '2026-11-08T12:00:00.000Z',
  });

  assert.equal(actual, receipt);
  assert.equal(operationFetches, 0);
});

test('production invocation identity binds the approved checkout rather than dispatch GITHUB_SHA', () => {
  assert.equal(typeof assertProductionInvocationIdentity, 'function');
  const approvedSha = 'a'.repeat(40);
  const request = {
    runId: '123456789',
    runAttempt: 2,
    approvedSha,
    mainSha: approvedSha,
    repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    workflowRef: 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/nelyon-production-release.yml@refs/heads/main',
  };
  const publicInputs = Object.freeze({ requestBytes: Buffer.from(JSON.stringify(request)) });
  const environment = Object.freeze({
    GITHUB_RUN_ID: request.runId,
    GITHUB_RUN_ATTEMPT: String(request.runAttempt),
    GITHUB_SHA: 'b'.repeat(40),
    GITHUB_REPOSITORY: request.repository,
    GITHUB_WORKFLOW_REF: request.workflowRef,
    NELYON_APPROVED_SHA: approvedSha,
  });

  assert.doesNotThrow(() => assertProductionInvocationIdentity(publicInputs, environment));
  assert.throws(() => assertProductionInvocationIdentity(publicInputs, {
    ...environment,
    NELYON_APPROVED_SHA: 'c'.repeat(40),
  }));
});

test('every runtime action is a closed enum and reaches only the trusted execute capability', async () => {
  const seen = [];
  const host = trustedHost(async invocation => {
    seen.push(invocation.action);
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  });
  for (const action of ACTIONS) {
    const code = await runPrivateAuthorityCli([action, ...COMMON, ...EXTRA[action]], host);
    assert.equal(code, 0, action);
  }
  assert.deepEqual(seen, ACTIONS);
});

test('unknown actions, duplicate/unknown flags, passthrough and private authority inputs fail before execute', async () => {
  let calls = 0;
  const host = trustedHost(async () => { calls += 1; throw new Error(MARKER); });
  const invalid = [
    ['release', ...COMMON],
    ['authority-proof', ...COMMON, '--policy', 'other.json'],
    ['authority-proof', ...COMMON, '--unknown', 'value'],
    ['authority-proof', ...COMMON, '--'],
    ['authority-proof', ...COMMON, '--source-parity', 'candidate.json'],
    ['authority-proof', ...COMMON, '--database-functions', 'candidate.json'],
    ['authority-proof', ...COMMON, '--protected-steps', 'candidate.json'],
    ['verify-admin-recovery-source', ...COMMON, ...EXTRA['verify-admin-recovery-source'], '--authorization', 'candidate.json'],
    ['verify-admin-recovery-source', ...COMMON, ...EXTRA['verify-admin-recovery-source'], '--authorization-sha256', 'a'.repeat(64)],
    ['verify-admin-recovery-source', ...COMMON, ...EXTRA['verify-admin-recovery-source'], '--approved-source', 'candidate.json'],
    ['verify-admin-recovery-source', ...COMMON, ...EXTRA['verify-admin-recovery-source'], '--chain-run', 'candidate.json'],
    ['authority-proof', ...COMMON, '--requested-at', '2026-11-08T12:00:00.000Z'],
    ['authority-proof', ...COMMON, '--module', MARKER],
    ['authority-proof', ...COMMON, '--command', MARKER],
  ];
  for (const argv of invalid) {
    const beforeOut = host.stdout.read().length;
    const beforeErr = host.stderr.read().length;
    const code = await runPrivateAuthorityCli(argv, host);
    assert.equal(code, 2);
    assert.equal(host.stdout.read().slice(beforeOut),
      '{"schemaVersion":1,"result":"BLOCKED","releaseReady":false,"code":"PRIVATE_AUTHORITY_STAGE_INVALID"}\n');
    assert.equal(host.stderr.read().slice(beforeErr), 'DENY PRIVATE_AUTHORITY_STAGE_INVALID\n');
  }
  assert.equal(calls, 0);
  assert.equal(host.stdout.read().includes(MARKER), false);
  assert.equal(host.stderr.read().includes(MARKER), false);
});

test('missing required common flags and non-string/proxy argv fail closed without coercion', async () => {
  let calls = 0;
  const host = trustedHost(async () => { calls += 1; });
  for (const argv of [
    ['authority-proof'],
    ['authority-proof', '--policy', 'policy.json'],
    ['authority-proof', ...COMMON.slice(0, -1)],
    ['authority-proof', ...COMMON.slice(0, -2), '--verification-output', ''],
    new Proxy(['authority-proof', ...COMMON], {}),
  ]) {
    const code = await runPrivateAuthorityCli(argv, host);
    assert.equal(code, 2);
  }
  assert.equal(calls, 0);
});

test('recognized runtime failures have exact public status and no native diagnostics', async () => {
  for (const expectedCode of [
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
  ]) {
    const host = trustedHost(async () => {
      const error = new Error('Private authority operation blocked');
      Object.defineProperty(error, 'code', { value: expectedCode, enumerable: true });
      Object.defineProperty(error, 'stack', { value: 'Error: Private authority operation blocked' });
      throw error;
    });
    const code = await runPrivateAuthorityCli(['authority-proof', ...COMMON], host);
    assert.equal(code, 2);
    assert.equal(host.stdout.read(),
      `{"schemaVersion":1,"result":"BLOCKED","releaseReady":false,"code":"${expectedCode}"}\n`);
    assert.equal(host.stderr.read(), `DENY ${expectedCode}\n`);
    assert.equal(host.stdout.read().includes(MARKER), false);
    assert.equal(host.stderr.read().includes(MARKER), false);
  }
});

test('unknown thrown values and hostile error getters collapse to stage blocked without leakage', async () => {
  for (const thrown of [
    new Error(MARKER),
    MARKER,
    { code: 'PRIVATE_AUTHORITY_PROVIDER_UNCONFIGURED', message: MARKER },
    Object.defineProperty({}, 'code', { enumerable: true, get() { throw new Error(MARKER); } }),
  ]) {
    const host = trustedHost(async () => { throw thrown; });
    const code = await runPrivateAuthorityCli(['authority-proof', ...COMMON], host);
    assert.equal(code, 2);
    assert.equal(host.stdout.read(),
      '{"schemaVersion":1,"result":"BLOCKED","releaseReady":false,"code":"PRIVATE_AUTHORITY_STAGE_BLOCKED"}\n');
    assert.equal(host.stderr.read(), 'DENY PRIVATE_AUTHORITY_STAGE_BLOCKED\n');
    assert.equal(`${host.stdout.read()}${host.stderr.read()}`.includes(MARKER), false);
  }
});

test('malformed trusted host sinks are contained and never cause an uncaught rejection', async () => {
  for (const host of [null, {}, { execute: async () => {}, stdout: {}, stderr: {} }, new Proxy({}, {})]) {
    const code = await runPrivateAuthorityCli(['authority-proof', ...COMMON], host);
    assert.equal(code, 2);
  }
});

test('CLI converts the actual Node process environment to a detached strict runtime record', async () => {
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as cli from './scripts/nelyon-private-authority-cli.mjs';
    import {readTrustedAuthorityEnvironment} from './scripts/nelyon-private-authority-runtime.mjs';
    assert.throws(() => readTrustedAuthorityEnvironment(process.env), {code:'PRIVATE_AUTHORITY_PROVIDER_INVALID'});
    const environment = cli.copyProductionEnvironment(process.env);
    assert.equal(Object.getPrototypeOf(environment), null);
    assert.equal(Object.isFrozen(environment), true);
    assert.equal(readTrustedAuthorityEnvironment(environment).provider, 'r2');
    process.env.NELYON_PRIVATE_AUTHORITY_PROVIDER = 'changed';
    assert.equal(environment.NELYON_PRIVATE_AUTHORITY_PROVIDER, 'r2');
    assert.equal(readTrustedAuthorityEnvironment(environment).provider, 'r2');
    process.stdout.write('SYNTHETIC_ENVIRONMENT_PASS');
  `], { cwd: process.cwd(), encoding: 'utf8', env: {
    NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2', NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'synthetic-bucket', NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-key',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: 'synthetic-secret', NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256: 'b'.repeat(64),
    NELYON_PRIVATE_AUTHORITY_SHA256: 'c'.repeat(64), NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: 'd'.repeat(64),
    NELYON_RELEASE_POLICY_SHA256: 'e'.repeat(64),
  } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'SYNTHETIC_ENVIRONMENT_PASS');
});

test('CLI environment copy rejects accessors, proxies, exotic records and non-string values without execution', () => {
  let reads = 0;
  const getter = Object.defineProperty({}, 'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY', { enumerable: true, get() { reads++; return MARKER; } });
  for (const value of [getter, new Proxy({}, { ownKeys() { reads++; return []; } }), Object.create({}), [],
    { VALUE: {} }, { VALUE: null }, { [Symbol('hidden')]: 'value' }, Object.defineProperty({}, 'VALUE', { value: 'hidden' })]) {
    assert.throws(() => cliModule.copyProductionEnvironment(value));
  }
  assert.equal(reads, 0);
});

test('CLI environment copy preserves unknown reserved keys for strict runtime rejection', async () => {
  const { readTrustedAuthorityEnvironment } = await import('../scripts/nelyon-private-authority-runtime.mjs');
  const environment = cliModule.copyProductionEnvironment({ NELYON_PRIVATE_AUTHORITY_UNEXPECTED: 'synthetic' });
  assert.equal(environment.NELYON_PRIVATE_AUTHORITY_UNEXPECTED, 'synthetic');
  assert.throws(() => readTrustedAuthorityEnvironment(environment), { code: 'PRIVATE_AUTHORITY_PROVIDER_INVALID' });
});
