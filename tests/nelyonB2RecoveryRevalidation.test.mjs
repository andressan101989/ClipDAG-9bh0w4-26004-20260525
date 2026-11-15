import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as release from '../scripts/nelyon-production-release.mjs';
import { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime, loadProtectedB2RecoveryRuntime,
  stageProtectedB2RecoverySource } from '../scripts/nelyon-private-authority-runtime.mjs';
import { createPrivateAuthorityProductionHost } from '../scripts/nelyon-private-authority-cli.mjs';
import { buildPrivateRuntimeClosure, privateRuntimeClosureMemberPaths } from '../scripts/nelyon-private-runtime-closure.mjs';
import { b2AdminHistoricalFixture } from './fixtures/nelyonB2HistoricalCapture.mjs';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)));
const hash = value => createHash('sha256').update(value).digest('hex');
const AT = '2026-11-08T12:00:00.000Z';

test('protected pending recovery revalidates exact committed current Git and historical authority', async t => {
  const tempRoot = realpathSync(tmpdir());
  assert.equal(tempRoot.toLowerCase(), 'd:\\codextemp\\b2-private-governance');
  const temporary = mkdtempSync(path.join(tempRoot, 'b2-revalidation-git-'));
  t.diagnostic(`Synthetic local Git fixture: ${temporary}`);
  assert.equal(realpathSync(temporary), temporary);
  t.after(() => {
    assert.equal(realpathSync(temporary), temporary);
    const relative = path.relative(tempRoot, temporary);
    assert.ok(relative.startsWith('b2-revalidation-git-') && !relative.includes(path.sep));
    rmSync(temporary, { recursive: true, force: false });
    assert.equal(existsSync(temporary), false);
    t.diagnostic('Synthetic local Git fixture cleanup: directoryRemoved=true');
  });
  const repo = path.join(temporary, 'repo'); const hooks = path.join(temporary, 'empty-hooks'); mkdirSync(hooks);
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL',
    GIT_AUTHOR_NAME: 'Synthetic Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  execFileSync('git', ['clone', '--shared', '--no-checkout', '--', ROOT, repo], { env, stdio: 'pipe' });
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe', encoding: 'utf8' }).trim();
  const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, env, encoding: 'utf8' }).trim();
  git('update-ref', 'refs/heads/b2-fixture', parent); git('symbolic-ref', 'HEAD', 'refs/heads/b2-fixture');
  git('read-tree', parent);
  for (const member of privateRuntimeClosureMemberPaths()) {
    const target = path.join(repo, ...member.split('/')); mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(ROOT, ...member.split('/')), target);
  }
  const members = privateRuntimeClosureMemberPaths();
  git('add', '--', ...members);
  git('-c', `core.hooksPath=${hooks}`, 'commit', '--no-gpg-sign', '-m', 'Synthetic offline authority fixture');
  const approvedSha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', approvedSha);
  git('config', 'remote.origin.url', 'https://github.com/andressan101989/ClipDAG-9bh0w4-26004-20260525.git');
  const policyBytes = readFileSync(path.join(ROOT, '.github', 'nelyon-production-release-policy.json'));
  const policy = JSON.parse(policyBytes);
  const runner = path.join(temporary, 'runner'); mkdirSync(runner);
  const policyPath = path.join(runner, 'policy.json'); writeFileSync(policyPath, policyBytes);
  const historical = await b2AdminHistoricalFixture({ approvedSha });
  const authorizationBytes = Buffer.from(release.canonicalJson({ schema_version: 1,
    kind: 'nelyon-b2-exact-attempt-recovery-v1', repository: policy.repository, workflow_path: policy.workflow_path,
    policy_sha256: hash(policyBytes), approved_sources: [{ source: historical.historical.source,
      admin_artifact: historical.historical.adminArtifact, postcheck_chain: null }] }));
  const runtimeClosure = buildPrivateRuntimeClosure({ repositoryRoot: repo, readFile: readFileSync });
  const environment = { NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2', NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'true',
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'nelyon-private-authority', NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-access',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: 'synthetic-secret', NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS: '10000',
    NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: runtimeClosure.closure_sha256,
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authorizationBytes),
    GITHUB_TOKEN: 'synthetic-github', RUNNER_TEMP: runner };
  const fetchImpl = async (input, init) => {
    if (input instanceof Request && new URL(input.url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      const bytes = input.url.endsWith(`${hash(authorizationBytes)}.json`)
        ? authorizationBytes : Buffer.from(historical.contextArgs.authorityJson);
      const headers = { 'content-length': String(bytes.length), 'content-encoding': 'identity' };
      return input.method === 'HEAD' ? new Response(null, { status: 200, headers }) : new Response(bytes, { status: 200, headers });
    }
    if (typeof input === 'string' && input.startsWith('https://api.supabase.com/')) return new Response('[]', { status: 200 });
    return historical.historical.fetchImpl(input, init);
  };
  const capability = await bootstrapPrivateAuthorityRuntime({ environment, manifestClosure: runtimeClosure,
    repositoryRoot: repo, readFile: readFileSync, nodeVersion: '24.21.0' });
  await stageProtectedB2RecoverySource({ bootstrapCapability: capability, environment, policyBytes,
    runId: historical.historical.request.runId, fetchImpl });
  const staged = path.join(runner, 'nelyon-b2-recovery-source');
  const recoveryRuntime = await loadProtectedB2RecoveryRuntime({ bootstrapCapability: capability, environment, policyBytes,
    runId: historical.historical.request.runId, runAttempt: null, releaseBundle: { directory: path.join(staged, 'release') },
    gateEvidence: { directory: path.join(staged, 'gate') }, fetchImpl });
  const request = { ...historical.recoveryRequest, approvedSha, mainSha: approvedSha, mode: 'postcheck_recovery',
    scopeConfirmation: policy.scope_confirmations.postcheck_recovery };
  const runGit = args => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe',
    encoding: args.includes('-z') ? 'buffer' : 'utf8' });
  const gitState = release.resolveGitState({ cwd: repo, baselineSha: policy.baseline.sha, approvedSha,
    expectedRepository: policy.repository, runGit });
  const compiler = { path: 'scripts/nelyon-production-release.mjs',
    sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-release.mjs').sha256,
    snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
    snapshot_adapter_sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-snapshot-adapter.mjs').sha256 };
  const evidence = { gitState, classified: release.classifyChangedPaths(gitState.changes), migrations: [],
    affectedFunctions: [], functionContracts: [], reproducibility: { allowed: true, blockedFunctions: [], findings: [] },
    risk: { level: 'HIGH', findings: [] }, runtimeClosure, compiler, generatedAt: AT };
  const pending = release.parsePendingB2RecoveryRequest(request, policy);
  const manifest = release.buildManifest({ ...evidence, request, policy, pendingB2Recovery: pending });
  const manifestBytes = Buffer.from(release.canonicalJson(manifest));
  const requestBytes = Buffer.from(release.canonicalJson(request));
  const bundle = path.join(runner, 'bundle'); mkdirSync(bundle);
  writeFileSync(path.join(bundle, 'manifest.json'), manifestBytes);
  writeFileSync(path.join(bundle, 'manifest.sha256'), `${hash(manifestBytes)}\n`);
  writeFileSync(path.join(bundle, 'summary.md'), 'synthetic');
  const requestPath = path.join(runner, 'request.json'); const evidencePath = path.join(runner, 'remote-evidence.json');
  writeFileSync(requestPath, requestBytes); writeFileSync(evidencePath, release.canonicalJson(evidence));
  const publicInputs = { policyBytes, requestBytes, manifestBytes,
    manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`), descriptorBytes: Buffer.from(historical.contextArgs.descriptorBytes) };
  const host = createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl, repositoryRoot: repo, recoveryRuntime });
  const controller = createPrivateAuthorityRuntime({ bootstrapCapability: capability, environment, fetchImpl,
    now: () => AT, host, recoveryRuntime });
  const priorCwd = process.cwd();
  try {
    process.chdir(repo);
    await assert.doesNotReject(controller.execute({ action: 'revalidate-b2-recovery', inputs: {
      policy: policyPath, request: requestPath, bundle, recoverySourceRun: historical.historical.request.runId,
      run: path.join(staged, 'run.json'), artifacts: path.join(staged, 'artifacts.json'),
      releaseBundle: path.join(staged, 'release'), gateEvidence: path.join(staged, 'gate'),
      compilerSha256: compiler.sha256, remoteEvidence: evidencePath, stageOutput: path.join(runner, 'revalidated.json'),
    }, verificationOutput: path.join(runner, 'revalidation-receipt.json') }));
    const environmentPath = path.join(runner, 'environment.json'); const branchesPath = path.join(runner, 'branches.json');
    const approvalsPath = path.join(runner, 'approvals.json'); const runsPath = path.join(runner, 'runs.json');
    writeFileSync(environmentPath, release.canonicalJson({ id: policy.environment.id, name: 'production',
      can_admins_bypass: false, protection_rules: [], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
    writeFileSync(branchesPath, release.canonicalJson({ complete: true, pages: [{ items: [{ name: policy.default_branch }] }] }));
    writeFileSync(approvalsPath, release.canonicalJson({ complete: true, sourceRunId: request.runId,
      sourceRunAttempt: request.runAttempt, pages: [{ items: [] }] }));
    writeFileSync(runsPath, release.canonicalJson({ complete: true, pages: [{ items: [] }] }));
    const gate = { action: 'verify-b2-recovery-gate', inputs: { policy: policyPath, request: requestPath, bundle,
      recoverySourceRun: historical.historical.request.runId, run: path.join(staged, 'run.json'),
      artifacts: path.join(staged, 'artifacts.json'), releaseBundle: path.join(staged, 'release'), gateEvidence: path.join(staged, 'gate'),
      policySha256: hash(policyBytes), compilerSha256: compiler.sha256, environmentEvidence: environmentPath,
      branchPolicies: branchesPath, approvals: approvalsPath, runs: runsPath, autoDeployExpected: 'OFF',
      revalidated: path.join(runner, 'revalidated.json'), stageOutput: path.join(runner, 'current-gate.json') },
    verificationOutput: path.join(runner, 'current-gate-receipt.json') };
    await assert.doesNotReject(controller.execute(gate));
    const currentGate = JSON.parse(readFileSync(gate.inputs.stageOutput));
    assert.equal(currentGate.result, 'GATE_VERIFIED');
    assert.deepEqual(currentGate.authorityReceipt, historical.authorityContext.receipt);
    const altered = JSON.parse(readFileSync(gate.inputs.revalidated));
    altered.authorityReceipt.approvalSha256 = '0'.repeat(64);
    const badRevalidation = path.join(runner, 'bad-revalidated.json'); writeFileSync(badRevalidation, release.canonicalJson(altered));
    await assert.rejects(controller.execute({ ...gate,
      inputs: { ...gate.inputs, revalidated: badRevalidation, stageOutput: path.join(runner, 'bad-gate.json') },
      verificationOutput: path.join(runner, 'bad-gate-receipt.json') }), { code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' });
    const adminRequest = historical.recoveryRequest;
    const adminManifest = release.buildManifest({ ...evidence, request: adminRequest, policy });
    const adminManifestBytes = Buffer.from(release.canonicalJson(adminManifest));
    const adminRequestBytes = Buffer.from(release.canonicalJson(adminRequest));
    const adminBundle = path.join(runner, 'admin-bundle'); mkdirSync(adminBundle);
    writeFileSync(path.join(adminBundle, 'manifest.json'), adminManifestBytes);
    writeFileSync(path.join(adminBundle, 'manifest.sha256'), `${hash(adminManifestBytes)}\n`);
    writeFileSync(path.join(adminBundle, 'summary.md'), 'synthetic');
    const adminRequestPath = path.join(runner, 'admin-request.json'); writeFileSync(adminRequestPath, adminRequestBytes);
    const adminPublic = { ...publicInputs, requestBytes: adminRequestBytes, manifestBytes: adminManifestBytes,
      manifestDigestBytes: Buffer.from(`${hash(adminManifestBytes)}\n`) };
    const adminHost = createPrivateAuthorityProductionHost({ publicInputs: adminPublic, environment, fetchImpl,
      repositoryRoot: repo, recoveryRuntime });
    const adminController = createPrivateAuthorityRuntime({ bootstrapCapability: capability, environment, fetchImpl,
      now: () => AT, host: adminHost, recoveryRuntime });
    await assert.doesNotReject(adminController.execute({ action: 'revalidate-b2-admin-recovery', inputs: {
      policy: policyPath, request: adminRequestPath, bundle: adminBundle, recoverySourceRun: historical.historical.request.runId,
      run: path.join(staged, 'run.json'), artifacts: path.join(staged, 'artifacts.json'),
      releaseBundle: path.join(staged, 'release'), gateEvidence: path.join(staged, 'gate'), adminEvidence: path.join(staged, 'admin'),
      compilerSha256: compiler.sha256, remoteEvidence: evidencePath, stageOutput: path.join(runner, 'admin-revalidated.json'),
    }, verificationOutput: path.join(runner, 'admin-revalidation-receipt.json') }));
    const adminEnvironment = { ...environment, SUPABASE_ACCESS_TOKEN: 'synthetic-supabase' };
    const adminGateHost = createPrivateAuthorityProductionHost({ publicInputs: adminPublic, environment: adminEnvironment,
      fetchImpl, repositoryRoot: repo, recoveryRuntime });
    const adminGateController = createPrivateAuthorityRuntime({ bootstrapCapability: capability, environment: adminEnvironment,
      fetchImpl, now: () => AT, host: adminGateHost, recoveryRuntime });
    const adminGate = { action: 'verify-b2-admin-recovery-gate', inputs: {
      policy: policyPath, request: adminRequestPath, bundle: adminBundle, recoverySourceRun: historical.historical.request.runId,
      run: path.join(staged, 'run.json'), artifacts: path.join(staged, 'artifacts.json'),
      releaseBundle: path.join(staged, 'release'), gateEvidence: path.join(staged, 'gate'), adminEvidence: path.join(staged, 'admin'),
      policySha256: hash(policyBytes), compilerSha256: compiler.sha256, environmentEvidence: environmentPath,
      branchPolicies: branchesPath, approvals: approvalsPath, runs: runsPath, autoDeployExpected: 'OFF',
      revalidated: path.join(runner, 'admin-revalidated.json'), stageOutput: path.join(runner, 'admin-current-gate.json'),
    }, verificationOutput: path.join(runner, 'admin-gate-receipt.json') };
    await assert.doesNotReject(adminGateController.execute(adminGate));
    await assert.rejects(adminController.execute({ ...adminGate, inputs: { ...adminGate.inputs,
      stageOutput: path.join(runner, 'admin-no-secret-gate.json') },
    verificationOutput: path.join(runner, 'admin-no-secret-receipt.json') }), { code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' });
    await assert.rejects(adminGateController.execute({ ...adminGate, inputs: { ...adminGate.inputs,
      revalidated: badRevalidation, stageOutput: path.join(runner, 'admin-bad-receipt-gate.json') },
    verificationOutput: path.join(runner, 'admin-bad-receipt.json') }), { code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' });
  } finally { process.chdir(priorCwd); }
});
