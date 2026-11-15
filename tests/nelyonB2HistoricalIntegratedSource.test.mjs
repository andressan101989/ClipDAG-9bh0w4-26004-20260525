import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertB2IntegratedSource, canonicalJson, verifyB2HistoricalIntegratedSource } from '../scripts/nelyon-production-release.mjs';
import { createPrivateAuthorityProductionHost } from '../scripts/nelyon-private-authority-cli.mjs';
import { bootstrapPrivateAuthorityRuntime, createPrivateAuthorityRuntime, loadProtectedB2RecoveryRuntime } from '../scripts/nelyon-private-authority-runtime.mjs';
import { buildPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';
import { b2AdminHistoricalFixture } from './fixtures/nelyonB2HistoricalCapture.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
function removeFixture(directory, prefix) {
  const root = realpathSync(tmpdir());
  const target = resolve(directory);
  const child = relative(root, target);
  assert.equal(realpathSync(target), target);
  assert.ok(child.startsWith(prefix) && !child.includes(sep) && !child.startsWith('..'));
  rmSync(target, { recursive: true, force: false });
  assert.equal(existsSync(target), false);
}

test('historical integration uses branded provenance and historical closure, not the current Git HEAD', async t => {
  const f = await b2AdminHistoricalFixture({ approvedSha: 'a'.repeat(40), reviewedSourceSha: 'c'.repeat(40) });
  t.after(() => removeFixture(dirname(f.historical.paths.release), 'b2-capture-source-'));
  const { verifiedSource, historicalRuntimeClosure, manifest } = f.historical;
  assert.notEqual(manifest.identity.approved_sha, manifest.resources.web_control_centers_b2_transition.contract.reviewed_source_sha);
  const capability = verifyB2HistoricalIntegratedSource({ verifiedSource, historicalRuntimeClosure });
  assert.equal(assertB2IntegratedSource(capability, { manifest, descriptorBytes: f.contextArgs.descriptorBytes }), true);
  for (const input of [{ verifiedSource: structuredClone(verifiedSource), historicalRuntimeClosure },
    { verifiedSource, historicalRuntimeClosure: structuredClone(historicalRuntimeClosure) },
    { verifiedSource: {}, historicalRuntimeClosure: {} }]) {
    assert.throws(() => verifyB2HistoricalIntegratedSource(input), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  const changed = structuredClone(manifest); changed.identity.approved_sha = 'd'.repeat(40);
  assert.throws(() => assertB2IntegratedSource(capability, { manifest: changed, descriptorBytes: f.contextArgs.descriptorBytes }),
    { code: 'B2_DESCRIPTOR_INVALID' });
});

test('production recovery host authenticates integrated historical source with a different current checkout', async t => {
  const f = await b2AdminHistoricalFixture({ approvedSha: 'a'.repeat(40), reviewedSourceSha: 'c'.repeat(40) });
  t.after(() => removeFixture(dirname(f.historical.paths.release), 'b2-capture-source-'));
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'b2-integrated-recovery-host-'));
  t.after(() => removeFixture(root, 'b2-integrated-recovery-host-'));
  const checkout = join(root, 'current-checkout'); mkdirSync(checkout);
  const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_NAME: 'Synthetic Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', args, { cwd: checkout, env: gitEnvironment, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-q'); git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Synthetic unrelated current checkout');
  const currentSha = git('rev-parse', 'HEAD');
  assert.notEqual(currentSha, f.historical.request.approvedSha);
  assert.notEqual(currentSha, 'c'.repeat(40));
  // There is deliberately no migration or config in this checkout. Recovery
  // must authenticate the historical artifacts, not try current source preflight.
  assert.equal(existsSync(join(checkout, 'supabase')), false);
  const policyBytes = Buffer.from(canonicalJson(f.policy));
  const closure = buildPrivateRuntimeClosure({ repositoryRoot: ROOT, readFile: readFileSync });
  const authorizationBytes = Buffer.from(canonicalJson({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: f.policy.repository, workflow_path: f.policy.workflow_path, policy_sha256: hash(policyBytes),
    approved_sources: [{ source: f.historical.source, admin_artifact: f.historical.adminArtifact, postcheck_chain: null }] }));
  const environment = { NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2', NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'synthetic-authority', NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-access',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: 'synthetic-secret', NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: closure.closure_sha256,
    NELYON_RELEASE_POLICY_SHA256: hash(policyBytes), NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: hash(authorizationBytes),
    NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'true', GITHUB_TOKEN: 'synthetic-github', RUNNER_TEMP: root };
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.hostname);
    if (input instanceof Request && url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      const bytes = url.pathname.endsWith(`${hash(authorizationBytes)}.json`)
        ? authorizationBytes : Buffer.from(f.contextArgs.authorityJson);
      const headers = { 'content-length': String(bytes.length), 'content-encoding': 'identity' };
      return new Response(input.method === 'HEAD' ? null : bytes, { status: 200, headers });
    }
    assert.equal(url.hostname, 'api.github.com', 'all transports stay in the fixed offline fixture');
    return f.historical.fetchImpl(input, init);
  };
  const bootstrapCapability = await bootstrapPrivateAuthorityRuntime({ environment, manifestClosure: closure,
    repositoryRoot: ROOT, readFile: readFileSync, nodeVersion: '24.21.0' });
  const recoveryRuntime = await loadProtectedB2RecoveryRuntime({ bootstrapCapability, environment, policyBytes,
    runId: f.historical.request.runId, runAttempt: f.historical.request.runAttempt,
    releaseBundle: f.releaseBundle, gateEvidence: f.gateEvidence, fetchImpl });
  // Direct Admin recovery retains its source SHA; changing that request SHA
  // requires the separately authenticated postcheck-recovery chain.
  const request = { ...f.recoveryRequest };
  assert.notEqual(currentSha, request.approvedSha);
  const manifest = { ...f.recoveryManifest,
    result: 'NO PRODUCTIVE CHANGES', blockers: [], delta: { files: [], productive_change_count: 0 }, runtime_closure: closure };
  assert.equal(Object.hasOwn(manifest.resources, 'web_control_centers_b2_transition'), false);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const publicInputs = { descriptorBytes: Buffer.from(f.contextArgs.descriptorBytes), policyBytes,
    requestBytes: Buffer.from(canonicalJson(request)), manifestBytes, manifestDigestBytes: Buffer.from(`${hash(manifestBytes)}\n`) };
  const run = join(root, 'run.json'); const artifacts = join(root, 'artifacts.json');
  writeFileSync(run, canonicalJson(f.run)); writeFileSync(artifacts, canonicalJson(f.artifacts));
  const host = createPrivateAuthorityProductionHost({ publicInputs, environment, fetchImpl,
    repositoryRoot: checkout, recoveryRuntime });
  const controller = createPrivateAuthorityRuntime({ bootstrapCapability, environment, fetchImpl,
    now: () => '2026-11-08T12:00:00.000Z', host, recoveryRuntime });
  const invocation = { action: 'admin-recovery-authority-proof', inputs: { policy: join(root, 'policy.json'),
    request: join(root, 'request.json'), bundle: join(root, 'bundle'), recoverySourceRun: f.historical.request.runId,
    run, artifacts, releaseBundle: f.releaseBundle.directory, gateEvidence: f.gateEvidence.directory,
    adminEvidence: f.adminEvidence.directory }, verificationOutput: join(root, 'recovery-proof.json') };
  const result = await controller.execute(invocation);
  assert.deepEqual(result, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  assert.deepEqual(JSON.parse(readFileSync(invocation.verificationOutput)), f.authorityContext.receipt);
  assert.equal(git('rev-parse', 'HEAD'), currentSha);
  assert.equal(existsSync(join(checkout, 'supabase')), false);
  const callsBeforeForgery = calls.length;
  for (const forged of [structuredClone(recoveryRuntime), { ...recoveryRuntime,
    verifiedSource: structuredClone(recoveryRuntime.verifiedSource) }]) {
    assert.throws(() => createPrivateAuthorityRuntime({ bootstrapCapability, environment, fetchImpl,
      now: () => '2026-11-08T12:00:00.000Z', host, recoveryRuntime: forged }), { code: 'PRIVATE_AUTHORITY_SOURCE_INVALID' });
  }
  assert.equal(calls.length, callsBeforeForgery);
});
