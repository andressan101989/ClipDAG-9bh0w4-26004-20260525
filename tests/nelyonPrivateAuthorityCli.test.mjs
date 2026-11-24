import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createReleaseAuthorityContext, publicAuthorityReceipt } from '../scripts/nelyon-release-authority-context.mjs';
import { captureB2AuthorityObservation } from '../scripts/nelyon-production-snapshot-adapter.mjs';
import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';

const cliModule = await import('../scripts/nelyon-private-authority-cli.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const {
  adminRecoveryRequiresProtectedB2Runtime,
  assertProductionInvocationIdentity,
  createPrivateAuthorityProductionHost,
  executeAuthorityIssuance,
  executeAuthorityObservation,
  executeR2AccessProbe,
  readAuthorityIssuanceDiagnostic,
  runPrivateAuthorityCli,
  writeB2AuthorityObservationMetadata,
  writeB2AuthorityIssuanceMetadata,
} = cliModule;
const MARKER = 'PRIVATE_CLI_SYNTHETIC_MARKER';
const COMMON = [
  '--policy', 'policy.json',
  '--request', 'request.json',
  '--bundle', 'bundle',
  '--verification-output', 'verification.json',
];
const OBSERVE = [
  '--policy', 'policy.json',
  '--approved-sha', 'a'.repeat(40),
  '--approved-tree', 'b'.repeat(40),
  '--integration-base-sha', '109395035d13ba3db8d338dc3b2524191defe873',
  '--preissuance-output', 'preissuance.json',
  '--verification-output', 'observation.json',
];
const B2_INTEGRATION_BOUNDARY_SHA = '109395035d13ba3db8d338dc3b2524191defe873';
const ISSUE = [
  '--policy', 'policy.json',
  '--approved-sha', 'a'.repeat(40),
  '--approved-tree', 'b'.repeat(40),
  '--integration-base-sha', B2_INTEGRATION_BOUNDARY_SHA,
  '--observation-run', '123456789',
  '--observation-sha256', 'd'.repeat(64),
  '--release-id', `b2-authority-${'e'.repeat(64)}`,
  '--approved-descriptor-output', 'nelyon-web-control-centers-b2-release-descriptor.json',
  '--verification-output', 'receipt.json',
];
const R2_PROBE = [
  '--approved-sha', 'a'.repeat(40),
  '--approved-tree', 'b'.repeat(40),
  '--verification-output', 'r2-runtime-access.json',
];
const ACTIONS = [
  'authority-observe',
  'authority-issue',
  'r2-access-probe',
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
    '--function-deployment-proof', 'function-deployment-proof.json', '--stage-output', 'stage.json'],
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
    const args = action === 'authority-observe' ? OBSERVE
      : action === 'authority-issue' ? ISSUE
        : action === 'r2-access-probe' ? R2_PROBE : [...COMMON, ...EXTRA[action]];
    const code = await runPrivateAuthorityCli([action, ...args], host);
    assert.equal(code, 0, action);
  }
  assert.deepEqual(seen, ACTIONS);
});

test('r2-access-probe is a separate terminal flag plane with no authority, bundle or release inputs', async () => {
  let observed;
  const host = trustedHost(async invocation => {
    observed = invocation;
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  });
  assert.equal(await runPrivateAuthorityCli(['r2-access-probe', ...R2_PROBE], host), 0);
  assert.deepEqual(observed, {
    action: 'r2-access-probe',
    inputs: { approvedSha: 'a'.repeat(40), approvedTree: 'b'.repeat(40) },
    verificationOutput: 'r2-runtime-access.json',
  });
  for (const extra of [
    ['--policy', 'policy.json'], ['--request', 'request.json'], ['--bundle', 'bundle'],
    ['--observation-run', '1'], ['--release-id', `b2-authority-${'e'.repeat(64)}`],
  ]) assert.equal(await runPrivateAuthorityCli(['r2-access-probe', ...R2_PROBE, ...extra], host), 2);
});

test('authority-observe is a separate terminal flag plane with no current bundle or request', async () => {
  let observed;
  const host = trustedHost(async invocation => {
    observed = invocation;
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  });
  assert.equal(await runPrivateAuthorityCli(['authority-observe', ...OBSERVE], host), 0);
  assert.deepEqual(observed, {
    action: 'authority-observe',
    inputs: {
      policy: 'policy.json',
      approvedSha: 'a'.repeat(40),
      approvedTree: 'b'.repeat(40),
      integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
    },
    preissuanceOutput: 'preissuance.json',
    verificationOutput: 'observation.json',
  });
  for (const extra of [
    ['--request', 'request.json'], ['--bundle', 'bundle'], ['--recovery-source-run', '1'],
    ['--current-gate', 'gate.json'], ['--authority', 'private.json'],
  ]) {
    assert.equal(await runPrivateAuthorityCli(['authority-observe', ...OBSERVE, ...extra], host), 2);
  }
  const missingPreissuance = OBSERVE.filter((value, index) => value !== '--preissuance-output'
    && OBSERVE[index - 1] !== '--preissuance-output');
  assert.equal(await runPrivateAuthorityCli(['authority-observe', ...missingPreissuance], host), 2);
});

test('authority-issue is a separate terminal flag plane bound to source, observation and deterministic release id', async () => {
  let observed;
  const host = trustedHost(async invocation => {
    observed = invocation;
    return Object.freeze({ schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  });
  assert.equal(await runPrivateAuthorityCli(['authority-issue', ...ISSUE], host), 0);
  assert.deepEqual(observed, {
    action: 'authority-issue',
    inputs: {
      policy: 'policy.json', approvedSha: 'a'.repeat(40), approvedTree: 'b'.repeat(40),
      integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      observationRun: '123456789', observationSha256: 'd'.repeat(64),
      releaseId: `b2-authority-${'e'.repeat(64)}`,
    },
    approvedDescriptorOutput: 'nelyon-web-control-centers-b2-release-descriptor.json',
    verificationOutput: 'receipt.json',
  });
  for (const extra of [['--request', 'request.json'], ['--bundle', 'bundle'], ['--authority', 'private.json']]) {
    assert.equal(await runPrivateAuthorityCli(['authority-issue', ...ISSUE, ...extra], host), 2);
  }
  let executions = 0;
  const missingDescriptorOutput = ISSUE.filter((value, index) => value !== '--approved-descriptor-output'
    && ISSUE[index - 1] !== '--approved-descriptor-output');
  const rejectingHost = trustedHost(async () => { executions += 1; throw new Error(MARKER); });
  assert.equal(await runPrivateAuthorityCli(['authority-issue', ...missingDescriptorOutput], rejectingHost), 2);
  assert.equal(executions, 0);
});

test('authority-issue rejects a caller-selected ancestor before GitHub or provider access', async () => {
  let fetches = 0;
  let environmentReads = 0;
  const environment = new Proxy({}, {
    getOwnPropertyDescriptor() { environmentReads += 1; return undefined; },
  });
  await assert.rejects(() => executeAuthorityIssuance({
    invocation: {
      action: 'authority-issue',
      inputs: {
        approvedSha: 'a'.repeat(40), approvedTree: 'b'.repeat(40),
        integrationBaseSha: 'c'.repeat(40), observationRun: '123456789',
        observationSha256: 'd'.repeat(64), policy: 'policy.json',
        releaseId: `b2-authority-${'e'.repeat(64)}`,
      },
      approvedDescriptorOutput: 'nelyon-web-control-centers-b2-release-descriptor.json',
      verificationOutput: 'receipt.json',
    },
    environment,
    fetchImpl: async () => { fetches += 1; throw new Error('must not run'); },
    repositoryRoot: process.cwd(),
  }));
  assert.notEqual('c'.repeat(40), B2_INTEGRATION_BOUNDARY_SHA);
  assert.equal(environmentReads, 0);
  assert.equal(fetches, 0);
});

test('authority-observe production dispatch terminates before bundle, descriptor, or current-authority loading', () => {
  const source = readFileSync(new URL('../scripts/nelyon-private-authority-cli.mjs', import.meta.url), 'utf8');
  const hostStart = source.indexOf('const productionHost = Object.freeze({');
  const observerBranch = source.indexOf("if (invocation.action === 'authority-observe')", hostStart);
  const publicInputLoad = source.indexOf('const publicInputs = loadProductionPublicInputs', hostStart);
  assert.ok(hostStart >= 0 && observerBranch > hostStart && publicInputLoad > observerBranch);
  const terminalBranch = source.slice(observerBranch, publicInputLoad);
  assert.match(terminalBranch, /return executeAuthorityObservation/u);
  assert.doesNotMatch(terminalBranch, /bootstrapPrivateAuthorityRuntime|createPrivateAuthorityRuntime|descriptor|authorityContext/u);
});

test('authority-issue production dispatch is terminal and precedes current descriptor/authority loading', () => {
  const source = readFileSync(new URL('../scripts/nelyon-private-authority-cli.mjs', import.meta.url), 'utf8');
  const hostStart = source.indexOf('const productionHost = Object.freeze({');
  const issuerBranch = source.indexOf("if (invocation.action === 'authority-issue')", hostStart);
  const publicInputLoad = source.indexOf('const publicInputs = loadProductionPublicInputs', hostStart);
  assert.ok(hostStart >= 0 && issuerBranch > hostStart && publicInputLoad > issuerBranch);
  const terminalBranch = source.slice(issuerBranch, publicInputLoad);
  assert.match(terminalBranch, /return executeAuthorityIssuance/u);
  assert.doesNotMatch(terminalBranch, /bootstrapPrivateAuthorityRuntime|createPrivateAuthorityRuntime|authorityContext/u);
});

test('R2 access probe production dispatch is terminal and precedes bundle or closure loading', () => {
  const source = readFileSync(new URL('../scripts/nelyon-private-authority-cli.mjs', import.meta.url), 'utf8');
  const hostStart = source.indexOf('const productionHost = Object.freeze({');
  const probeBranch = source.indexOf("if (invocation.action === 'r2-access-probe')", hostStart);
  const publicInputLoad = source.indexOf('const publicInputs = loadProductionPublicInputs', hostStart);
  assert.ok(hostStart >= 0 && probeBranch > hostStart && publicInputLoad > probeBranch);
  const terminalBranch = source.slice(probeBranch, publicInputLoad);
  assert.match(terminalBranch, /return executeR2AccessProbe/u);
  assert.doesNotMatch(terminalBranch,
    /bootstrapPrivateAuthorityRuntime|createPrivateAuthorityRuntime|loadProductionPublicInputs|authorityContext/u);
});

test('R2 access probe binds main identity, performs one HeadBucket and writes a sanitized atomic receipt', async () => {
  assert.equal(typeof executeR2AccessProbe, 'function');
  const repositoryRoot = process.cwd();
  const approvedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const approvedTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'nelyon-r2-probe-'));
  const outputDirectory = path.join(runnerTemp, 'nelyon-b2-r2-access-probe');
  mkdirSync(outputDirectory);
  const output = path.join(outputDirectory, 'r2-runtime-access.json');
  const environment = Object.freeze({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/nelyon-production-release.yml@refs/heads/main',
    GITHUB_ACTOR: 'andressan101989',
    GITHUB_TRIGGERING_ACTOR: 'andressan101989',
    GITHUB_RUN_ID: '45123456789',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: approvedSha,
    NELYON_APPROVED_SHA: approvedSha,
    NELYON_APPROVED_TREE: approvedTree,
    NELYON_R2_PROBE_SCOPE: 'R2_RUNTIME_ACCESS_READ_ONLY',
    NELYON_R2_PROBE_RELEASE_ID: `b2-r2-access-probe-${approvedSha}`,
    NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2',
    NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'nelyon-b2-release-authority-prod',
    NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: MARKER,
    NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS: '10000',
    RUNNER_TEMP: runnerTemp,
  });
  const calls = [];
  try {
    const result = await executeR2AccessProbe({
      invocation: Object.freeze({ action: 'r2-access-probe',
        inputs: Object.freeze({ approvedSha, approvedTree }), verificationOutput: output }),
      environment,
      fetchImpl: async request => { calls.push(request); return new Response(null, { status: 200 }); },
      repositoryRoot,
      now: () => '2026-11-24T05:00:00.000Z',
      nodeVersion: '24.21.0',
    });
    assert.deepEqual(result, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
    assert.deepEqual(calls.map(request => request.method), ['HEAD']);
    const receiptText = readFileSync(output, 'utf8');
    const receipt = JSON.parse(receiptText);
    assert.equal(receiptText.endsWith('\n'), true);
    assert.deepEqual(receipt, {
      schemaVersion: 1,
      kind: 'nelyon-b2-r2-runtime-access-v1',
      result: 'R2_RUNTIME_ACCESS_VERIFIED',
      approvedSha,
      approvedTree,
      runId: '45123456789',
      runAttempt: 1,
      operation: 'HeadBucket',
      bucket: 'nelyon-b2-release-authority-prod',
      httpStatus: 200,
      authenticated: true,
      completedAt: '2026-11-24T05:00:00.000Z',
    });
    assert.doesNotMatch(receiptText, new RegExp(MARKER, 'u'));
    assert.equal(readdirSync(outputDirectory).some(name => name.includes('.tmp-')), false);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test('authority issuance writes a canonical approved descriptor beside its sanitized receipt', () => {
  const source = readFileSync(new URL('../scripts/nelyon-private-authority-cli.mjs', import.meta.url), 'utf8');
  assert.match(source, /readB2ApprovedDescriptorMaterialization/u);
  assert.match(source, /nelyon-web-control-centers-b2-release-descriptor\.json/u);
  assert.match(source, /receipt\.descriptor\?\.sha256 !== issuedDescriptor\.sha256/u);
  const descriptorWrite = source.indexOf('writeFileSync(descriptorFile');
  const receiptWrite = source.indexOf('writeFileSync(receiptFile');
  assert.ok(descriptorWrite >= 0 && receiptWrite > descriptorWrite);
});

test('authority issuance metadata publishes receipt last and removes every partial artifact on failure', () => {
  assert.equal(typeof writeB2AuthorityIssuanceMetadata, 'function');
  const root = mkdtempSync(path.join(tmpdir(), 'nelyon-authority-metadata-'));
  const descriptorOutput = path.join(root, 'nelyon-web-control-centers-b2-release-descriptor.json');
  const receiptOutput = path.join(root, 'receipt.json');
  const input = Object.freeze({ descriptorOutput, receiptOutput,
    descriptorJson: '{\n  "approved": true\n}\n', receiptJson: '{"verified":true}\n' });
  try {
    const operations = Object.freeze({
      openSync: fs.openSync, writeFileSync: fs.writeFileSync, fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync, renameSync(from, to) {
        if (to === receiptOutput) throw new Error(MARKER);
        return fs.renameSync(from, to);
      },
      unlinkSync: fs.unlinkSync,
    });
    assert.throws(() => writeB2AuthorityIssuanceMetadata(input, operations), new RegExp(MARKER));
    assert.deepEqual(readdirSync(root), []);
    writeB2AuthorityIssuanceMetadata(input);
    assert.equal(readFileSync(descriptorOutput, 'utf8'), input.descriptorJson);
    assert.equal(readFileSync(receiptOutput, 'utf8'), input.receiptJson);
    assert.deepEqual(readdirSync(root).sort(), [
      'nelyon-web-control-centers-b2-release-descriptor.json', 'receipt.json',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('authority observation metadata publishes observation last and removes every partial artifact on failure', () => {
  assert.equal(typeof writeB2AuthorityObservationMetadata, 'function');
  const root = mkdtempSync(path.join(tmpdir(), 'nelyon-authority-observation-metadata-'));
  const preissuanceOutput = path.join(root, 'preissuance.json');
  const observationOutput = path.join(root, 'observation.json');
  const input = Object.freeze({ preissuanceOutput, observationOutput,
    preissuanceJson: '{"kind":"preissuance"}\n', observationJson: '{"kind":"observation"}\n' });
  try {
    const operations = Object.freeze({
      openSync: fs.openSync, writeFileSync: fs.writeFileSync, fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync, renameSync(from, to) {
        if (to === observationOutput) throw new Error(MARKER);
        return fs.renameSync(from, to);
      },
      unlinkSync: fs.unlinkSync,
    });
    assert.throws(() => writeB2AuthorityObservationMetadata(input, operations), new RegExp(MARKER));
    assert.deepEqual(readdirSync(root), []);
    writeB2AuthorityObservationMetadata(input);
    assert.equal(readFileSync(preissuanceOutput, 'utf8'), input.preissuanceJson);
    assert.equal(readFileSync(observationOutput, 'utf8'), input.observationJson);
    assert.deepEqual(readdirSync(root).sort(), ['observation.json', 'preissuance.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production authority observation validates main identity and atomically writes observation plus public preissuance', async () => {
  const repositoryRoot = process.cwd();
  const approvedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const approvedTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'nelyon-observe-cli-'));
  const outputDirectory = path.join(runnerTemp, 'nelyon-b2-authority-observation');
  mkdirSync(outputDirectory, { mode: 0o700 });
  const output = path.join(outputDirectory, 'observation.json');
  const preissuanceOutput = path.join(outputDirectory, 'preissuance.json');
  const wrongOutputDirectory = path.join(runnerTemp, 'wrong-authority-observation');
  mkdirSync(wrongOutputDirectory, { mode: 0o700 });
  const environment = Object.freeze({
    GITHUB_ACTOR: 'andressan101989',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    GITHUB_RUN_ID: '123456789',
    GITHUB_SHA: approvedSha,
    GITHUB_TRIGGERING_ACTOR: 'andressan101989',
    GITHUB_WORKFLOW_REF: 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/nelyon-production-release.yml@refs/heads/main',
    NELYON_APPROVED_SHA: approvedSha,
    NELYON_APPROVED_TREE: approvedTree,
    RUNNER_TEMP: runnerTemp,
    SUPABASE_ACCESS_TOKEN: 'observer-token-canary',
  });
  const observation = Object.freeze({ schemaVersion: 1, kind: 'sanitized', observationSha256: 'c'.repeat(64) });
  const preissuanceContract = Object.freeze({ schemaVersion: 1,
    operation: 'web-control-centers-b2-authority-issue',
    repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    workflowPath: '.github/workflows/nelyon-production-release.yml', approvedSha,
    approvedTreeSha: approvedTree, publicContractSha256: '1'.repeat(64),
    manifestSha256: '2'.repeat(64), policySha256: '3'.repeat(64), baselineSha: '4'.repeat(40),
    runtimeClosureSha256: '5'.repeat(64), observationSha256: observation.observationSha256 });
  const preissuanceSha256 = sha256(`${canonicalJson(preissuanceContract)}\n`);
  const preissuance = Object.freeze({ schemaVersion: 1,
    kind: 'nelyon-b2-authority-preissuance-summary-v1',
    source: Object.freeze({ sha: approvedSha, tree: approvedTree }),
    integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
    observation: Object.freeze({ sha256: observation.observationSha256,
      completedObservedAt: '2026-11-22T10:01:00.000Z', expiresAt: '2026-11-22T12:01:00.000Z' }),
    descriptor: Object.freeze({ path: '.github/nelyon-web-control-centers-b2-release-descriptor.json',
      state: 'candidate', sha256: '6'.repeat(64) }),
    functionInventory: Object.freeze({ before: 34, after: 35 }),
    preissuance: Object.freeze({ contract: preissuanceContract, preissuanceSha256 }),
    releaseId: `b2-authority-${preissuanceSha256}` });
  let captureOptions;
  try {
    let actionReads = 0;
    const accessorInvocation = Object.freeze(Object.defineProperties({}, {
      action: { enumerable: true, get() { actionReads += 1; throw new Error(MARKER); } },
      inputs: { enumerable: true, value: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }) },
      preissuanceOutput: { enumerable: true, value: preissuanceOutput },
      verificationOutput: { enumerable: true, value: output },
    }));
    await assert.rejects(() => executeAuthorityObservation({
      invocation: accessorInvocation, environment, repositoryRoot,
      fetchImpl: async () => { throw new Error(MARKER); }, captureImpl: async () => observation,
      verifyImpl: value => value, nodeVersion: '24.21.0',
    }));
    assert.equal(actionReads, 0);

    let gitCalls = 0;
    await assert.rejects(() => executeAuthorityObservation({
      invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }), preissuanceOutput, verificationOutput: output, unexpected: true }),
      environment, repositoryRoot, fetchImpl: async () => { throw new Error(MARKER); },
      captureImpl: async () => { throw new Error(MARKER); }, verifyImpl: value => value, nodeVersion: '24.21.0',
      execFileSyncImpl(_command, args) {
        gitCalls += 1;
        return `${args.at(-1) === 'HEAD' ? approvedSha : approvedTree}\n`;
      },
    }));
    assert.equal(gitCalls, 0);

    const result = await executeAuthorityObservation({
      invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }), preissuanceOutput, verificationOutput: output }),
      environment,
      repositoryRoot,
      fetchImpl: async () => { throw new Error(MARKER); },
      captureImpl: async options => { captureOptions = options; return observation; },
      verifyImpl: value => { assert.equal(value, observation); return value; },
      prepareImpl: value => {
        assert.equal(value.observation, observation);
        assert.equal(value.approvedSha, approvedSha);
        assert.equal(value.approvedTreeSha, approvedTree);
        assert.equal(value.repositoryRoot, repositoryRoot);
        assert.equal(value.integrationBaseSha, B2_INTEGRATION_BOUNDARY_SHA);
        return preissuance;
      },
      nodeVersion: '24.21.0',
    });
    assert.deepEqual(result, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
    assert.deepEqual(Object.keys(captureOptions).sort(), [
      'approvedSha', 'approvedTreeSha', 'backupPolicy', 'fetchImpl', 'repository', 'token',
    ]);
    assert.equal(captureOptions.token, 'observer-token-canary');
    assert.equal(captureOptions.approvedSha, approvedSha);
    assert.equal(captureOptions.approvedTreeSha, approvedTree);
    const retained = readFileSync(output, 'utf8');
    assert.equal(retained.includes('observer-token-canary'), false);
    assert.equal(JSON.parse(retained).observationSha256, observation.observationSha256);
    const retainedPreissuance = JSON.parse(readFileSync(preissuanceOutput, 'utf8'));
    assert.equal(retainedPreissuance.releaseId, preissuance.releaseId);
    assert.deepEqual(retainedPreissuance.preissuance, preissuance.preissuance);
    assert.deepEqual(retainedPreissuance.observation, {
      runId: '123456789', runAttempt: 1, ...preissuance.observation,
    });
    await assert.rejects(() => executeAuthorityObservation({
      invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }), preissuanceOutput: path.join(wrongOutputDirectory, 'preissuance.json'),
      verificationOutput: path.join(wrongOutputDirectory, 'observation.json') }),
      environment, repositoryRoot, fetchImpl: async () => { throw new Error(MARKER); },
      captureImpl: async () => observation, verifyImpl: value => value, nodeVersion: '24.21.0',
    }));
    for (const [name, value] of [
      ['GITHUB_EVENT_NAME', 'push'],
      ['GITHUB_REPOSITORY', 'andressan101989/not-nelyon'],
      ['GITHUB_REF', 'refs/heads/feature'],
      ['GITHUB_WORKFLOW_REF', 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/other.yml@refs/heads/main'],
      ['GITHUB_TRIGGERING_ACTOR', 'not-owner'],
      ['GITHUB_SHA', 'd'.repeat(40)],
      ['NELYON_APPROVED_TREE', 'e'.repeat(40)],
    ]) {
      await assert.rejects(() => executeAuthorityObservation({
        invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
          policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
          integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
        }), preissuanceOutput, verificationOutput: output }),
        environment: Object.freeze({ ...environment, [name]: value }), repositoryRoot,
        fetchImpl: async () => { throw new Error(MARKER); }, captureImpl: async () => observation,
        verifyImpl: candidate => candidate, nodeVersion: '24.21.0',
      }), name);
    }
    await assert.rejects(() => executeAuthorityObservation({
      invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }), preissuanceOutput, verificationOutput: output }),
      environment, repositoryRoot, fetchImpl: async () => { throw new Error(MARKER); },
      captureImpl: async () => observation, verifyImpl: value => value, nodeVersion: '24.20.0',
    }));
    await assert.rejects(() => executeAuthorityObservation({
      invocation: Object.freeze({ action: 'authority-observe', inputs: Object.freeze({
        policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'), approvedSha, approvedTree,
        integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
      }), preissuanceOutput, verificationOutput: output }),
      environment: Object.freeze({ ...environment, GITHUB_ACTOR: 'not-owner' }), repositoryRoot,
      fetchImpl: async () => { throw new Error(MARKER); }, captureImpl: async () => observation,
      verifyImpl: value => value, nodeVersion: '24.21.0',
    }));
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test('authority-observe bridges only trusted snapshot stage diagnostics to the terminal status', async () => {
  let snapshotError;
  await assert.rejects(() => captureB2AuthorityObservation({
    approvedSha: '1'.repeat(40),
    approvedTreeSha: '2'.repeat(40),
    backupPolicy: { required_status: 'COMPLETED', require_physical: true, max_age_seconds: 86_400 },
    fetchImpl: async () => new Response('{}', {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
    now: () => '2026-11-22T09:00:00.000Z',
    repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    token: 'synthetic-token-never-retained',
  }), error => {
    snapshotError = error;
    return true;
  });
  const host = trustedHost(async () => { throw snapshotError; });
  const code = await runPrivateAuthorityCli(['authority-observe', ...OBSERVE], host);
  assert.equal(code, 2);
  assert.deepEqual(JSON.parse(host.stdout.read()), {
    schemaVersion: 1,
    result: 'BLOCKED',
    releaseReady: false,
    code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED',
    diagnostic: { phase: 'AUTHORITY_OBSERVATION', category: 'BACKUP_READ_ACCESS_DENIED' },
  });
  assert.equal(host.stderr.read(), 'DENY PRIVATE_AUTHORITY_STAGE_BLOCKED\n');
  assert.doesNotMatch(host.stdout.read() + host.stderr.read(), /synthetic-token|database\/backups|https:/u);
});

test('authority-issue exposes only a closed observation-authentication stage diagnostic', async () => {
  assert.equal(typeof readAuthorityIssuanceDiagnostic, 'function');
  assert.equal(process.versions.node, '24.21.0');
  const repositoryRoot = process.cwd();
  const approvedSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const approvedTree = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'nelyon-b2-issuance-diagnostic-'));
  const outputDirectory = path.join(runnerTemp, 'nelyon-b2-authority-issue');
  mkdirSync(outputDirectory);
  const receiptOutput = path.join(outputDirectory, 'receipt.json');
  const descriptorOutput = path.join(outputDirectory, 'nelyon-web-control-centers-b2-release-descriptor.json');
  const environment = Object.freeze({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/nelyon-production-release.yml@refs/heads/main',
    GITHUB_ACTOR: 'andressan101989',
    GITHUB_TRIGGERING_ACTOR: 'andressan101989',
    GITHUB_SHA: approvedSha,
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: '99990001',
    GITHUB_TOKEN: 'synthetic-github-token-never-retained',
    NELYON_APPROVED_SHA: approvedSha,
    NELYON_APPROVED_TREE: approvedTree,
    RUNNER_TEMP: runnerTemp,
  });
  const secretMarker = 'SYNTHETIC_PRIVATE_REMOTE_BODY_NEVER_EXPOSED';
  let stagedError;
  try {
    await assert.rejects(() => executeAuthorityIssuance({
      invocation: Object.freeze({
        action: 'authority-issue',
        inputs: Object.freeze({
          policy: path.join(repositoryRoot, '.github', 'nelyon-production-release-policy.json'),
          approvedSha,
          approvedTree,
          integrationBaseSha: B2_INTEGRATION_BOUNDARY_SHA,
          observationRun: '99990000',
          observationSha256: 'd'.repeat(64),
          releaseId: `b2-authority-${'e'.repeat(64)}`,
        }),
        approvedDescriptorOutput: descriptorOutput,
        verificationOutput: receiptOutput,
      }),
      environment,
      fetchImpl: async () => new Response(`{\"message\":\"${secretMarker}\"}`, {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
      repositoryRoot,
    }), error => {
      stagedError = error;
      assert.deepEqual(readAuthorityIssuanceDiagnostic(error), Object.freeze({
        phase: 'AUTHORITY_ISSUANCE',
        category: 'OBSERVATION_AUTHENTICATION',
      }));
      return true;
    });
    const host = trustedHost(async () => { throw stagedError; });
    assert.equal(await runPrivateAuthorityCli(['authority-issue', ...ISSUE], host), 2);
    assert.deepEqual(JSON.parse(host.stdout.read()), {
      schemaVersion: 1,
      result: 'BLOCKED',
      releaseReady: false,
      code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED',
      diagnostic: { phase: 'AUTHORITY_ISSUANCE', category: 'OBSERVATION_AUTHENTICATION' },
    });
    assert.equal(host.stderr.read(), 'DENY PRIVATE_AUTHORITY_STAGE_BLOCKED\n');
    assert.doesNotMatch(host.stdout.read() + host.stderr.read(),
      /SYNTHETIC_PRIVATE_REMOTE_BODY|github-token|api\.github|403|message/iu);
    const forged = new Error('Private authority operation blocked');
    Object.defineProperty(forged, 'diagnostic', { value: {
      phase: 'AUTHORITY_ISSUANCE', category: 'R2_WRITE_READBACK',
    }, enumerable: true });
    assert.equal(readAuthorityIssuanceDiagnostic(forged), undefined);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
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
