import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import {
  canonicalJson,
  classifyAdminRecoveryAuthorityPlane,
  sha256Hex,
  writeManifestBundle,
} from '../scripts/nelyon-production-release.mjs';

const workflowUrl = new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url);
const workflowText = () => readFileSync(workflowUrl, 'utf8').replace(/\r\n?/g, '\n')
    .replace(/^      - &b2_diagnostic_step_[0-9]+\n        name:/gm, '      - name:');
const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url), 'utf8'));

function workflowJob(text, name) {
  const start = text.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const next = /^  [a-z][a-z0-9-]*:\n/gm;
  next.lastIndex = start + `  ${name}:\n`.length;
  const match = next.exec(text);
  return text.slice(start, match?.index ?? text.length);
}

function step(job, name) {
  const start = job.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const next = job.indexOf('\n      - name: ', start + 1);
  return job.slice(start, next === -1 ? job.length : next);
}

const ADMIN_CHAIN_FLAGS = Object.freeze([
  ['--chain-run', 'admin-recovery-evidence/authority-chain-run.json'],
  ['--chain-artifacts', 'admin-recovery-evidence/authority-chain-artifacts.json'],
  ['--chain-release-bundle', 'admin-recovery-evidence/authority-chain-release'],
  ['--chain-gate-evidence', 'admin-recovery-evidence/authority-chain-gate'],
  ['--chain-recovery-evidence', 'admin-recovery-evidence/authority-chain-recovery'],
]);

test('protected recovery steps carry the fixed authorization root only on the selected B2 plane and exact Admin evidence', () => {
  const text = workflowText();
  assert.doesNotMatch(workflowJob(text, 'plan'), /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256/);
  const deploy = workflowJob(text, 'deploy');
  assert.match(step(deploy, 'Resolve protected private authority for Admin recovery source'),
    /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256:\s*\$\{\{ needs\.plan\.outputs\.admin_recovery_b2_required == 'true' && vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256 \|\| '' \}\}/);
  assert.match(step(deploy, 'Resolve protected private authority and verify recovery source'),
    /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256:\s*\$\{\{ vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256 \}\}/);
  const calls = [...deploy.matchAll(/node scripts\/nelyon-private-authority-cli\.mjs (?:postcheck-admin-recovery|verify-admin-recovery-cloudflare-prestate) \\\n([\s\S]*?)(?=\n\s*\n)/g)];
  assert.ok(calls.length > 1);
  for (const call of calls) assert.match(call[1], /--admin-evidence admin-recovery-evidence\/authority-source-admin/);
});

test('B2 Admin deploy reauthenticates, gates, stages a fresh continuation and never terminally blocks', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const names = ['Stage B2 Admin source for revalidation', 'Revalidate B2 Admin recovery after authorization',
    'Clean B2 Admin staging after revalidation', 'Stage B2 Admin source for current gate',
    'Verify B2 Admin recovery gate', 'Clean B2 Admin staging after current gate',
    'Retain verified B2 Admin recovery gate', 'Stage B2 Admin source for protected continuation',
    'Normalize staged B2 Admin recovery authority source', 'Clean B2 Admin staging after protected continuation',
    'Select exact Admin recovery authority source', 'Resolve protected private authority for Admin recovery source'];
  for (let i = 0; i < names.length - 1; i += 1) assert.ok(deploy.indexOf(`- name: ${names[i]}`) < deploy.indexOf(`- name: ${names[i + 1]}`));
  for (const name of names) assert.ok(deploy.includes(`- name: ${name}`), name);
  assert.match(step(deploy, 'Verify B2 Admin recovery gate'), /verify-b2-admin-recovery-gate/);
  assert.match(step(deploy, 'Revalidate B2 Admin recovery after authorization'), /revalidate-b2-admin-recovery/);
  assert.doesNotMatch(deploy, /Block incomplete B2 Admin continuation|not yet verified/);
  const stage = step(deploy, 'Stage B2 Admin source for protected continuation');
  assert.match(stage, /stage-b2-recovery-source/);
  assert.match(stage, /b2_admin_gate\.outcome == 'success'/);
  assert.match(stage, /b2_admin_gate_cleanup\.outcome == 'success'/);
  const normalize = step(deploy, 'Normalize staged B2 Admin recovery authority source');
  for (const path of ['authority-source-run.json', 'authority-source-artifacts.json',
    'authority-source-release', 'authority-source-gate', 'authority-source-admin',
    'authority-chain-run.json', 'authority-chain-artifacts.json', 'authority-chain-release',
    'authority-chain-gate', 'authority-chain-recovery']) {
    assert.match(normalize, new RegExp(path.replaceAll('.', '\\.')));
  }
  assert.match(normalize, /chain-release/);
  assert.match(normalize, /inputs\.recovery_source_run_id/);
  assert.match(normalize, /GITHUB_OUTPUT/);
  const cleanup = step(deploy, 'Clean B2 Admin staging after protected continuation');
  assert.match(cleanup, /always\(\)/);
  assert.match(cleanup, /nelyon-private-runtime-stage-cleanup\.cjs/);
  const selector = step(deploy, 'Select exact Admin recovery authority source');
  assert.match(selector, /needs\.plan\.outputs\.admin_recovery_b2_required/);
  assert.match(selector, /b2_admin_continuation_source\.outcome/);
  assert.match(selector, /admin_recovery_legacy_authority_source\.outcome/);
});

test('installed B2 root never selects Admin recovery; exact policy membership selects legacy or protected B2', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan');
  const proof = workflowJob(text, 'private-authority-check');
  const deploy = workflowJob(text, 'deploy');

  assert.match(plan, /admin_recovery_b2_required:\s*\$\{\{ steps\.admin_recovery_selector\.outputs\.b2_required \}\}/);
  const classifier = step(plan, 'Classify exact Admin recovery authority plane');
  assert.match(classifier,
    /import \{ canonicalJson, classifyAdminRecoveryAuthorityPlane \} from '\.\/scripts\/nelyon-production-release\.mjs'/);
  assert.doesNotMatch(classifier, /const canonicalJson\s*=/);
  assert.match(classifier, /SOURCE_KIND === 'direct_release'/);
  assert.match(classifier, /SOURCE_KIND === 'postcheck_recovery'/);
  assert.match(classifier, /classifyAdminRecoveryAuthorityPlane\(\{ policy/);
  assert.match(classifier, /directSource, postcheckSource/);
  assert.match(classifier, /b2_required=\$\{classified\.b2Required\}/);
  assert.doesNotMatch(classifier, /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256/);

  const protectedStage = step(proof, 'Stage exact protected B2 recovery source');
  assert.match(protectedStage, /needs\.plan\.outputs\.admin_recovery_b2_required == 'true'/);
  assert.doesNotMatch(protectedStage, /vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256\s*[!=]=/);

  const legacyDiscovery = step(deploy, 'Fetch exact Admin recovery source metadata');
  assert.match(legacyDiscovery, /needs\.plan\.outputs\.admin_recovery_b2_required != 'true'/);
  assert.doesNotMatch(legacyDiscovery, /vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256\s*[!=]=/);

  const protectedRevalidation = step(deploy, 'Stage B2 Admin source for revalidation');
  assert.match(protectedRevalidation, /needs\.plan\.outputs\.admin_recovery_b2_required == 'true'/);
  const legacySource = step(deploy, 'Stage exact Admin recovery authority source');
  assert.match(legacySource, /needs\.plan\.outputs\.admin_recovery_b2_required != 'true'/);

  const selector = step(deploy, 'Select exact Admin recovery authority source');
  assert.match(selector, /ADMIN_RECOVERY_B2_REQUIRED:\s*\$\{\{ needs\.plan\.outputs\.admin_recovery_b2_required \}\}/);
  assert.match(selector, /if \[ "\$ADMIN_RECOVERY_B2_REQUIRED" = 'true' \]/);
  assert.doesNotMatch(selector, /B2_AUTHORIZATION_ROOT|vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256/);

  const historicalAuthority = step(deploy, 'Resolve protected private authority for Admin recovery source');
  assert.match(historicalAuthority,
    /NELYON_ADMIN_RECOVERY_B2_REQUIRED:\s*\$\{\{ needs\.plan\.outputs\.admin_recovery_b2_required \}\}/);
  assert.match(historicalAuthority,
    /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256:\s*\$\{\{ needs\.plan\.outputs\.admin_recovery_b2_required == 'true' && vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256 \|\| '' \}\}/);
  assert.doesNotMatch(historicalAuthority,
    /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256:\s*\$\{\{ vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256 \}\}/);

  for (const job of [proof, deploy]) {
    assert.doesNotMatch(job, /mode == 'admin_recovery'[^\n]*vars\.NELYON_B2_RECOVERY_AUTHORIZATION_SHA256\s*[!=]=/);
  }
});

test('Admin recovery classifier preserves direct and one-hop legacy while selecting B2 independently of root installation', () => {
  const legacyRunId = policy.postcheck_recovery.approved_sources[0].run_id;
  const legacyManifest = { resources: { superuser_control_center_transition: {} } };
  const b2Manifest = { resources: { web_control_centers_b2_transition: {} } };

  assert.deepEqual(classifyAdminRecoveryAuthorityPlane({
    policy,
    sourceKind: 'direct_release',
    declaredSourceRunId: legacyRunId,
    directSource: { request: { runId: legacyRunId }, manifest: legacyManifest },
  }), { b2Required: false, originalSourceRunId: legacyRunId });

  assert.deepEqual(classifyAdminRecoveryAuthorityPlane({
    policy,
    sourceKind: 'postcheck_recovery',
    declaredSourceRunId: '99999999991',
    postcheckSource: { result: 'RECOVERY_SOURCE_VERIFIED', source_run_id: legacyRunId, source_manifest: legacyManifest },
  }), { b2Required: false, originalSourceRunId: legacyRunId });

  assert.deepEqual(classifyAdminRecoveryAuthorityPlane({
    policy,
    sourceKind: 'postcheck_recovery',
    declaredSourceRunId: '99999999992',
    postcheckSource: { result: 'RECOVERY_SOURCE_VERIFIED', source_run_id: '99999999990', source_manifest: b2Manifest },
  }), { b2Required: true, originalSourceRunId: '99999999990' });

  assert.throws(() => classifyAdminRecoveryAuthorityPlane({
    policy,
    sourceKind: 'postcheck_recovery',
    declaredSourceRunId: '99999999993',
    postcheckSource: { result: 'RECOVERY_SOURCE_VERIFIED', source_run_id: '99999999989', source_manifest: legacyManifest },
  }), { code: 'ADMIN_RECOVERY_AUTHORITY_PLANE_INVALID' });
});

test('direct Admin recovery selector accepts the exact LF-terminated bytes written by the canonical bundle writer', t => {
  const base = realpathSync(tmpdir());
  const directory = mkdtempSync(join(base, 'nelyon-admin-selector-'));
  t.after(() => {
    const target = realpathSync(directory);
    const nested = relative(base, target);
    assert.ok(nested.startsWith('nelyon-admin-selector-') && !nested.includes('..') && resolve(base, nested) === target);
    rmSync(target, { recursive: true, force: false, maxRetries: 0 });
  });
  const manifest = {
    identity: { approved_sha: 'a'.repeat(40), release_id: 'legacy-admin-selector', run_attempt: 1, run_id: '41278629319' },
    resources: { superuser_control_center_transition: {} },
    delta: { productive_change_count: 0 },
    risk: { level: 'HIGH' },
    compiler: { sha256: 'b'.repeat(64) },
    blockers: [],
    result: 'NO PRODUCTIVE CHANGES',
  };
  const written = writeManifestBundle({ manifest, outputDirectory: directory });
  const manifestBytes = readFileSync(join(directory, 'manifest.json'), 'utf8');
  const digestBytes = readFileSync(join(directory, 'manifest.sha256'), 'utf8');
  assert.equal(manifestBytes, canonicalJson(manifest));
  assert.ok(manifestBytes.endsWith('\n'));
  assert.equal(sha256Hex(manifestBytes), written.digest);
  assert.equal(digestBytes, `${written.digest}\n`);
  assert.deepEqual(classifyAdminRecoveryAuthorityPlane({
    policy,
    sourceKind: 'direct_release',
    declaredSourceRunId: policy.postcheck_recovery.approved_sources[0].run_id,
    directSource: { request: { runId: policy.postcheck_recovery.approved_sources[0].run_id }, manifest: JSON.parse(manifestBytes) },
  }), { b2Required: false, originalSourceRunId: policy.postcheck_recovery.approved_sources[0].run_id });
});

test('pending B2 recovery compares the fresh snapshot receipt and retains the actual production snapshot', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const capture = step(deploy, 'Capture fresh read-only postcheck recovery snapshot');
  assert.match(capture, /cmp "\$RUNNER_TEMP\/nelyon-private-authority-public\/expected-receipt\.json" "\$RUNNER_TEMP\/nelyon-private-authority-public\/recovery-snapshot-authority\.json"/);
  assert.match(capture, /cp "\$RUNNER_TEMP\/nelyon-private-authority-public\/production-recovery\.json" recovery-evidence\/production-recovery\.json/);
  assert.doesNotMatch(capture, /cp "\$RUNNER_TEMP\/nelyon-private-authority-public\/recovery-snapshot-authority\.json" recovery-evidence\/production-recovery\.json/);
  for (const name of ['Resolve protected private authority and verify recovery source',
    'Resolve protected private authority and capture recovery snapshot',
    'Resolve protected private authority and require recovery postcheck']) {
    assert.match(step(deploy, name), /b2_pending_(?:source|snapshot|postcheck)_stage\.outcome == 'success'/);
  }
});

test('Admin recovery retains source snapshot postcheck and Cloudflare prestate only after exact receipt comparison', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  for (const [name, receipt] of [
    ['Stage protected Admin recovery source result', 'admin-recovery-source-authority.json'],
    ['Capture Admin recovery read-only production post-state', 'admin-recovery-snapshot-authority.json'],
    ['Require Admin recovery source and production post-state', 'admin-recovery-postcheck-authority.json'],
    ['Verify Admin recovery Cloudflare pre-state', 'admin-recovery-cloudflare-prestate-authority.json'],
  ]) {
    const retained = step(deploy, name);
    assert.match(retained, /expected-receipt\.json/);
    assert.match(retained, new RegExp(receipt.replaceAll('.', '\\.')));
    assert.ok(retained.indexOf('cmp ') < retained.lastIndexOf('cp '), `${name} compares before retaining`);
  }
});

test('pending B2 plan can reach only a protected staged historical proof before deploy', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan'); const proof = workflowJob(text, 'private-authority-check');
  const deploy = workflowJob(text, 'deploy');
  assert.match(plan, /b2_recovery_pending/);
  assert.doesNotMatch(plan, /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256/);
  const stage = step(proof, 'Stage exact protected B2 recovery source');
  assert.match(stage, /stage-b2-recovery-source/);
  assert.match(stage, /NELYON_B2_RECOVERY_AUTHORIZATION_SHA256/);
  const historical = step(proof, 'Verify pending B2 historical recovery authority');
  assert.match(historical, /recovery-authority-proof/);
  assert.ok(proof.indexOf(stage) > proof.indexOf('Verify installed private runtime signer'));
  assert.ok(proof.indexOf(historical) > proof.indexOf(stage));
  assert.match(deploy, /needs\.plan\.outputs\.b2_recovery_pending == 'true'/);
  for (const name of ['Revalidate pending B2 recovery after authorization', 'Verify pending B2 recovery gate']) {
    assert.match(step(deploy, name), /nelyon-private-authority-cli\.mjs/);
  }
  assert.match(deploy, /nelyon-private-runtime-stage-cleanup\.cjs/);
  for (const name of ['Stage B2 recovery source for source verification',
    'Stage B2 recovery source for snapshot', 'Stage B2 recovery source for postcheck']) {
    assert.match(step(deploy, name), /stage-b2-recovery-source/);
  }
  const retainedSnapshot = step(deploy, 'Capture fresh read-only postcheck recovery snapshot');
  assert.match(retainedSnapshot, /production-recovery\.json/);
  assert.match(proof, /nelyon-b2-recovery-source/);
  const adminHistorical = step(proof, 'Verify B2 Admin historical recovery authority');
  assert.match(adminHistorical, /admin-recovery-authority-proof/);
  assert.match(adminHistorical, /--chain-recovery-evidence/);
  assert.doesNotMatch(proof, /upload-artifact[\s\S]*nelyon-b2-recovery-source/);
});

test('public plan stays outside Environment and protected values while proof is a separate mandatory job', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan');
  const proof = workflowJob(text, 'private-authority-check');
  const deploy = workflowJob(text, 'deploy');

  assert.doesNotMatch(plan, /environment:\s*production|NELYON_PRIVATE_AUTHORITY_|secrets\./);
  assert.match(plan, /approved_sha:\s*\$\{\{ steps\.expose\.outputs\.approved_sha \}\}/);
  assert.match(proof, /needs:\s*plan/);
  assert.match(proof, /environment:\s*production/);
  assert.match(proof, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.doesNotMatch(proof, /SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|supabase\s+(?:db\s+push|functions\s+deploy)|versions (?:upload|deploy)|triggers deploy/);
  assert.match(deploy, /needs:\s*\[plan, private-authority-check\]/);
  assert.match(deploy, /needs\.private-authority-check\.result == 'success'/);
  assert.doesNotMatch(deploy, /needs\.plan\.outputs\.mode == 'plan_only'/);
});

test('protected proof independently bootstraps and installs without secrets before exact provider resolution', () => {
  const proof = workflowJob(workflowText(), 'private-authority-check');
  const bootstrap = proof.indexOf('- name: Verify independent private runtime closure');
  const install = proof.indexOf('- name: Install exact private runtime dependency without scripts');
  const postinstall = proof.indexOf('- name: Verify installed private runtime signer');
  const resolve = proof.indexOf('- name: Resolve protected private authority proof');
  const cleanup = proof.indexOf('- name: Clean private authority scratch after proof');
  const expose = proof.indexOf('- name: Expose closed private authority receipt');
  assert.ok(bootstrap >= 0 && install > bootstrap && postinstall > install && resolve > postinstall
    && cleanup > resolve && expose > cleanup);

  const bootstrapStep = step(proof, 'Verify independent private runtime closure');
  assert.match(bootstrapStep, /node --input-type=commonjs/);
  assert.doesNotMatch(bootstrapStep, /(?:import|require)\(['"]\.\.?\//);
  assert.match(bootstrapStep, /NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256/);
  assert.match(step(proof, 'Install exact private runtime dependency without scripts'), /npm ci --ignore-scripts/);
  const firstProviderStage = proof.indexOf('- name: Stage exact protected B2 recovery source');
  assert.ok(firstProviderStage > postinstall && firstProviderStage < resolve);
  assert.doesNotMatch(proof.slice(0, firstProviderStage), /NELYON_PRIVATE_AUTHORITY_R2_(?:ACCOUNT_ID|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);

  const runtime = step(proof, 'Resolve protected private authority proof');
  assert.match(runtime, /nelyon-private-authority-cli\.mjs authority-proof/);
  assert.match(runtime, /NELYON_APPROVED_SHA:\s*\$\{\{ needs\.plan\.outputs\.approved_sha \}\}/);
  assert.match(runtime, /--verification-output "\$RUNNER_TEMP\/nelyon-private-authority-public\/proof-receipt\.json"/);
  assert.doesNotMatch(runtime, /SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN/);
  assert.match(proof, /outputs:\s*\n\s+receipt:\s*\$\{\{ steps\.expose_private_receipt\.outputs\.receipt \}\}/);
});

test('provider configuration is step-scoped only to closed private runtime invocations', () => {
  const text = workflowText();
  const reserved = [
    'NELYON_PRIVATE_AUTHORITY_PROVIDER',
    'NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID',
    'NELYON_PRIVATE_AUTHORITY_R2_BUCKET',
    'NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID',
    'NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY',
    'NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256',
    'NELYON_PRIVATE_AUTHORITY_SHA256',
  ];
  const plan = workflowJob(text, 'plan');
  assert.doesNotMatch(plan, new RegExp(reserved.join('|')));
  assert.doesNotMatch(text, />>\s*"?\$GITHUB_ENV"?[\s\S]{0,200}NELYON_PRIVATE_AUTHORITY_|NELYON_PRIVATE_AUTHORITY_[^\n]*>>\s*"?\$GITHUB_ENV"?/);
  for (const name of reserved) {
    const matches = [...text.matchAll(new RegExp(name, 'g'))];
    assert.ok(matches.length > 0, `${name} must be wired`);
    for (const match of matches) {
      const before = text.lastIndexOf('      - name: ', match.index);
      const after = text.indexOf('\n      - name: ', before + 1);
      const owningStep = text.slice(before, after === -1 ? text.length : after);
      assert.match(owningStep, /- name: (?:Verify protected R2 runtime access|Issue exact immutable B2 private authority|Resolve protected private authority|Revalidate protected release|Preflight protected release|Stage exact protected B2 recovery source|Verify B2 Admin recovery gate)/);
      assert.match(owningStep, /nelyon-private-authority-cli\.mjs/);
      assert.doesNotMatch(owningStep, /npm ci|build:deployment|supabase\s+(?:db\s+push|functions\s+deploy)|versions (?:upload|deploy)|triggers deploy/);
    }
  }
});

test('proof cleanup is contained, always runs, and gates receipt publication', () => {
  const proof = workflowJob(workflowText(), 'private-authority-check');
  const cleanup = step(proof, 'Clean private authority scratch after proof');
  assert.match(cleanup, /always\(\)[\s\S]*mode != 'postcheck_recovery'[\s\S]*b2_recovery_pending == 'true'/);
  assert.equal(admitted(cleanup,{mode:'gate_proof',priorFailed:true}),true);
  assert.equal(admitted(cleanup,{mode:'postcheck_recovery',b2RecoveryPending:'false',priorFailed:true}),false);
  assert.match(cleanup, /nelyon-private-authority-owned/);
  assert.match(cleanup, /realpathSync|realpath/);
  assert.match(cleanup, /lstatSync|lstat/);
  assert.match(cleanup, /path\.relative|relative\(/);
  const expose = step(proof, 'Expose closed private authority receipt');
  assert.match(expose, /steps\.private_authority_proof\.outcome == 'success'/);
  assert.match(expose, /steps\.private_authority_cleanup\.outcome == 'success'/);
  assert.doesNotMatch(proof, /upload-artifact|GITHUB_STEP_SUMMARY/);
});

test('deploy installs the closure-pinned runtime before any provider-bearing stage and resolves fresh release stages', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const bootstrap = deploy.indexOf('- name: Verify independent private runtime closure for deploy');
  const install = deploy.indexOf('- name: Install exact private runtime dependency without scripts for deploy');
  const signer = deploy.indexOf('- name: Verify installed private runtime signer for deploy');
  const firstResolve = deploy.indexOf('- name: Resolve protected private authority before revalidation');
  assert.ok(bootstrap >= 0 && install > bootstrap && signer > install && firstResolve > signer);
  assert.doesNotMatch(deploy.slice(0, firstResolve), /NELYON_PRIVATE_AUTHORITY_R2_(?:ACCOUNT_ID|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);

  for (const [name, cleanupName] of [
    ['Resolve protected private authority before revalidation', 'Clean private authority scratch after revalidation'],
    ['Resolve protected private authority for release gate', 'Clean private authority scratch after release gate'],
    ['Resolve protected private authority and capture pre-snapshot', 'Clean private authority scratch after pre-snapshot'],
    ['Resolve protected private authority and verify pre-snapshot', 'Clean private authority scratch after pre-snapshot verification'],
    ['Resolve protected private authority and capture post-snapshot', 'Clean private authority scratch after post-snapshot'],
    ['Resolve protected private authority and require postcheck', 'Clean private authority scratch after postcheck'],
  ]) {
    const runtime = step(deploy, name);
    assert.match(runtime, /nelyon-private-authority-cli\.mjs/);
    const cleanup = step(deploy, cleanupName);
    assert.match(cleanup, /if:\s*always\(\)/);
    assert.match(cleanup, /node "\$RUNNER_TEMP\/nelyon-private-runtime-cleanup\.cjs"/);
    const runtimeIndex = deploy.indexOf(`- name: ${name}`);
    assert.ok(deploy.indexOf(`- name: ${cleanupName}`, runtimeIndex) > runtimeIndex);
  }
  assert.match(step(deploy, 'Stage closed protected proof receipt for comparisons'), /needs\.private-authority-check\.outputs\.receipt/);

  assert.match(step(deploy, 'Resolve protected private authority and capture pre-snapshot'), / pre-snapshot /);
  assert.match(step(deploy, 'Resolve protected private authority and verify pre-snapshot'), / verify-pre-snapshot /);
  assert.match(step(deploy, 'Resolve protected private authority and capture post-snapshot'), / post-snapshot /);
  assert.match(step(deploy, 'Resolve protected private authority and require postcheck'), / postcheck /);
});

test('every release mutation has fresh proof and successful cleanup before the fixed operation', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const migrationProof = deploy.indexOf('- name: Resolve protected private authority before migrations');
  const migration = deploy.indexOf('- name: B2 protected migrations');
  assert.ok(migrationProof > 0 && migration > migrationProof);
  assert.match(step(deploy, 'B2 protected migrations'), /steps\.b2_migration_authority\.outcome == 'success'/);

  const functions = step(deploy, 'B2 protected functions');
  assert.match(functions, /nelyon-private-authority-cli\.mjs deploy-functions/);
  assert.match(functions, /--current-gate[\s\S]*--pre-snapshot[\s\S]*--binary-path/);
  assert.ok(deploy.indexOf('- name: Clean private authority scratch after protected functions') > deploy.indexOf('- name: B2 protected functions'));
  assert.ok(deploy.indexOf('- name: Retain public B2 mutation attempt proofs even after failure') > deploy.indexOf('- name: Clean private authority scratch after protected functions'));

  for (const [proofName, mutationName] of [
    ['Resolve protected private authority before temporary Admin URLs', 'Enable exact temporary Admin workers.dev and Version URLs'],
    ['Resolve protected private authority before Admin upload', 'Upload one immutable Admin version'],
    ['Resolve protected private authority before Admin promotion', 'Promote the exact smoked Admin version'],
    ['Resolve protected private authority before Admin routes', 'Apply exact Admin production routes'],
    ['Resolve protected private authority before Admin cache purge', 'Purge exact Admin production cache prefix'],
  ]) {
    assert.ok(deploy.indexOf(`- name: ${proofName}`) > 0);
    assert.ok(deploy.indexOf(`- name: ${mutationName}`) > deploy.indexOf(`- name: ${proofName}`));
  }
});

test('historical recovery stages re-resolve the authenticated source without current authority pins', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  for (const [name, action, cleanupName] of [
    ['Resolve protected private authority and verify recovery source', 'verify-recovery-source', 'Clean private authority scratch after recovery source'],
    ['Resolve protected private authority and capture recovery snapshot', 'recovery-snapshot', 'Clean private authority scratch after recovery snapshot'],
    ['Resolve protected private authority and require recovery postcheck', 'postcheck-recovery', 'Clean private authority scratch after recovery postcheck'],
    ['Resolve protected private authority for Admin recovery source', 'verify-admin-recovery-source', 'Clean private authority scratch after Admin recovery source'],
    ['Resolve protected private authority and capture Admin recovery snapshot', 'recovery-snapshot', 'Clean private authority scratch after Admin recovery snapshot'],
    ['Resolve protected private authority and require Admin recovery postcheck', 'postcheck-admin-recovery', 'Clean private authority scratch after Admin recovery postcheck'],
    ['Resolve protected private authority for Admin recovery Cloudflare pre-state', 'verify-admin-recovery-cloudflare-prestate', 'Clean private authority scratch after Admin recovery Cloudflare pre-state'],
  ]) {
    const runtime = step(deploy, name);
    assert.match(runtime, new RegExp(`nelyon-private-authority-cli\\.mjs ${action}`));
    assert.match(runtime, /env: \*(?:admin_)?historical_private_authority_supabase_env|env: &(?:admin_)?historical_private_authority_supabase_env/);
    assert.doesNotMatch(runtime, /NELYON_PRIVATE_AUTHORITY_(?:DESCRIPTOR_)?SHA256/);
    assert.match(step(deploy, cleanupName), /if:\s*(?:>-\s*)?always\(\)/);
  }
  const normalized = step(deploy, 'Stage exact Admin recovery authority source');
  assert.match(normalized, /source_kind/);
  assert.match(normalized, /authority-source-run\.json/);
  assert.match(normalized, /authority-source-artifacts\.json/);
  assert.match(normalized, /authority-source-release/);
  assert.match(normalized, /authority-source-gate/);
  assert.match(normalized, /authority-source-admin/);
});

test('legacy Admin recovery stays on canonical direct or one-hop commands while B2 alone receives private recovery authority', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  for (const name of [
    'Fetch exact Admin recovery source metadata',
    'Download exact declared Admin recovery source release artifact',
    'Download exact declared Admin recovery source gate artifact',
    'Stage exact Admin recovery authority source',
    'Revalidate legacy Admin recovery after authorization',
    'Capture legacy Admin recovery read-only production post-state',
    'Require legacy Admin recovery source and production post-state',
    'Verify legacy Admin recovery Cloudflare pre-state',
  ]) {
    const body = step(deploy, name);
    assert.match(body, /admin_recovery_b2_required != 'true'/, name);
    assert.doesNotMatch(body, /nelyon-private-authority-cli\.mjs|NELYON_B2_RECOVERY_AUTHORIZATION_SHA256|NELYON_PRIVATE_AUTHORITY_R2_/, name);
  }
  assert.match(step(deploy, 'Verify exact direct Admin recovery source provenance'), /node "\$NELYON_HELPER" verify-admin-recovery-source/);
  assert.match(step(deploy, 'Verify exact Admin postcheck recovery chain provenance'), /node "\$NELYON_HELPER" verify-admin-recovery-postcheck-chain/);
  assert.match(step(deploy, 'Verify exact chained Admin recovery source provenance'), /node "\$NELYON_HELPER" verify-admin-recovery-source/);
  assert.match(step(deploy, 'Capture legacy Admin recovery read-only production post-state'),
    /nelyon-production-snapshot-adapter\.mjs capture[\s\S]*--phase post/);
  assert.match(step(deploy, 'Require legacy Admin recovery source and production post-state'),
    /node "\$NELYON_HELPER" postcheck-admin-recovery/);
  assert.match(step(deploy, 'Verify legacy Admin recovery Cloudflare pre-state'),
    /node "\$NELYON_HELPER" verify-admin-recovery-cloudflare-prestate/);
  assert.match(step(workflowJob(workflowText(), 'private-authority-check'), 'Resolve protected private authority proof'),
    /needs\.plan\.outputs\.mode != 'admin_recovery'/);
  assert.match(step(deploy, 'Stage closed protected proof receipt for comparisons'),
    /needs\.plan\.outputs\.mode != 'admin_recovery'/);

  for (const name of [
    'Resolve protected private authority for Admin recovery source',
    'Resolve protected private authority and capture Admin recovery snapshot',
    'Resolve protected private authority and require Admin recovery postcheck',
    'Resolve protected private authority for Admin recovery Cloudflare pre-state',
    'Resolve protected private authority before Admin recovery temporary URLs',
    'Resolve protected private authority before Admin recovery upload',
    'Resolve protected private authority before Admin recovery promotion',
    'Resolve protected private authority before Admin recovery routes',
    'Resolve protected private authority before Admin recovery cache purge',
    'Resolve protected private authority before Admin recovery rollback',
    'Resolve protected private authority before Admin recovery rollback routes',
    'Resolve protected private authority before Admin recovery rollback cache purge',
    'Resolve protected private authority before Admin recovery temporary URL closure',
  ]) {
    const body = step(deploy, name);
    assert.match(body, /admin_recovery_b2_required == 'true'/, name);
    assert.match(body, /nelyon-private-authority-cli\.mjs/, name);
  }
  for (const name of [
    'Enable exact temporary Admin workers.dev and Version URLs',
    'Upload one immutable Admin version',
    'Promote the exact smoked Admin version',
    'Apply exact Admin production routes',
    'Purge exact Admin production cache prefix',
    'Recover previous Admin production version',
    'Restore previous Admin production routes',
    'Purge recovered Admin production cache',
  ]) {
    const body = step(deploy, name);
    assert.match(body, /admin_recovery_b2_required != 'true'/, name);
    assert.match(body, /elif \[ "\$ADMIN_RECOVERY_B2_REQUIRED" = 'true' \]; then/, name);
  }
});

test('every chain-capable Admin recovery invocation receives all five one-hop inputs or none', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const names = [
    'Resolve protected private authority for Admin recovery source',
    'Resolve protected private authority and require Admin recovery postcheck',
    'Resolve protected private authority for Admin recovery Cloudflare pre-state',
    'Resolve protected private authority before Admin recovery temporary URLs',
    'Resolve protected private authority before Admin recovery upload',
    'Resolve protected private authority before Admin recovery promotion',
    'Resolve protected private authority before Admin recovery routes',
    'Resolve protected private authority before Admin recovery cache purge',
    'Resolve protected private authority before Admin recovery rollback',
    'Resolve protected private authority before Admin recovery rollback routes',
    'Resolve protected private authority before Admin recovery rollback cache purge',
    'Resolve protected private authority before Admin recovery temporary URL closure',
  ];
  for (const name of names) {
    const body = step(deploy, name);
    assert.match(body, /chain_args=\(\)/, name);
    assert.match(body, /if \[ -d admin-recovery-evidence\/authority-chain-release \]/, name);
    for (const [flag, path] of ADMIN_CHAIN_FLAGS) {
      assert.match(body, new RegExp(`${flag}[^\\n]*${path.replaceAll('.', '\\.')}`), `${name}: ${flag}`);
    }
    assert.match(body, /"\$\{chain_args\[@\]\}"/, name);
  }
});

test('Admin rollback resolves fresh authority before version, route, and recovery-cache mutations', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.doesNotMatch(deploy, /^\s+run:\s+[&*]/m);
  const boundaries = [
    {
      releaseProof: 'Resolve protected private authority before Admin rollback',
      releaseCleanup: 'Clean private authority scratch before Admin rollback',
      recoveryProof: 'Resolve protected private authority before Admin recovery rollback',
      recoveryCleanup: 'Clean private authority scratch before Admin recovery rollback',
      mutation: 'Recover previous Admin production version',
      command: /versions deploy/,
    },
    {
      releaseProof: 'Resolve protected private authority before Admin rollback routes',
      releaseCleanup: 'Clean private authority scratch before Admin rollback routes',
      recoveryProof: 'Resolve protected private authority before Admin recovery rollback routes',
      recoveryCleanup: 'Clean private authority scratch before Admin recovery rollback routes',
      mutation: 'Restore previous Admin production routes',
      command: /restore-routes/,
    },
    {
      releaseProof: 'Resolve protected private authority before Admin rollback cache purge',
      releaseCleanup: 'Clean private authority scratch before Admin rollback cache purge',
      recoveryProof: 'Resolve protected private authority before Admin recovery rollback cache purge',
      recoveryCleanup: 'Clean private authority scratch before Admin recovery rollback cache purge',
      mutation: 'Purge recovered Admin production cache',
      command: /purge-admin-cache/,
    },
  ];
  for (const boundary of boundaries) {
    const releaseProof = step(deploy, boundary.releaseProof);
    const recoveryProof = step(deploy, boundary.recoveryProof);
    const mutation = step(deploy, boundary.mutation);
    const mutationIndex = deploy.indexOf(`- name: ${boundary.mutation}`);
    assert.match(releaseProof, /nelyon-private-authority-cli\.mjs authority-proof/);
    assert.match(recoveryProof, /nelyon-private-authority-cli\.mjs verify-admin-recovery-cloudflare-prestate/);
    assert.match(step(deploy, boundary.releaseCleanup), /if:\s*>-\s*always\(\)/);
    assert.match(step(deploy, boundary.recoveryCleanup), /if:\s*>-\s*always\(\)/);
    assert.ok(deploy.indexOf(`- name: ${boundary.releaseProof}`) < mutationIndex);
    assert.ok(deploy.indexOf(`- name: ${boundary.releaseCleanup}`) < mutationIndex);
    assert.ok(deploy.indexOf(`- name: ${boundary.recoveryProof}`) < mutationIndex);
    assert.ok(deploy.indexOf(`- name: ${boundary.recoveryCleanup}`) < mutationIndex);
    assert.match(mutation, boundary.command);
    assert.match(mutation, /steps\.b2_admin_(?:recovery_)?rollback[^\n]*authority\.outcome == 'success'/);
    assert.match(mutation, /steps\.b2_admin_(?:recovery_)?rollback[^\n]*authority_cleanup\.outcome == 'success'/);
  }

  const receipts = [
    ['Resolve protected private authority before Admin rollback', 'Recover previous Admin production version'],
    ['Resolve protected private authority before Admin rollback routes', 'Restore previous Admin production routes'],
    ['Resolve protected private authority before Admin rollback cache purge', 'Purge recovered Admin production cache'],
  ].map(([proofName, mutationName]) => {
    const proof = step(deploy, proofName);
    const mutation = step(deploy, mutationName);
    const receipt = proof.match(/--verification-output "\$RUNNER_TEMP\/nelyon-private-authority-public\/([^"]+)"/)?.[1];
    assert.ok(receipt, `${proofName} must publish an exclusive receipt`);
    assert.match(mutation, new RegExp(receipt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return receipt;
  });
  assert.equal(new Set(receipts).size, receipts.length, 'each rollback proof requires a distinct exclusive output');
});

test('every Admin recovery mutation is receipt-bound after cleanup with an exclusive output', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const boundaries = [
    ['Resolve protected private authority before Admin recovery temporary URLs', 'Clean private authority scratch before Admin recovery temporary URLs', 'Enable exact temporary Admin workers.dev and Version URLs', 'admin-recovery-temp-enable-receipt.json'],
    ['Resolve protected private authority before Admin recovery upload', 'Clean private authority scratch before Admin recovery upload', 'Upload one immutable Admin version', 'admin-recovery-upload-receipt.json'],
    ['Resolve protected private authority before Admin recovery promotion', 'Clean private authority scratch before Admin recovery promotion', 'Promote the exact smoked Admin version', 'admin-recovery-promote-receipt.json'],
    ['Resolve protected private authority before Admin recovery routes', 'Clean private authority scratch before Admin recovery routes', 'Apply exact Admin production routes', 'admin-recovery-routes-receipt.json'],
    ['Resolve protected private authority before Admin recovery cache purge', 'Clean private authority scratch before Admin recovery cache purge', 'Purge exact Admin production cache prefix', 'admin-recovery-cache-purge-receipt.json'],
    ['Resolve protected private authority before Admin recovery rollback', 'Clean private authority scratch before Admin recovery rollback', 'Recover previous Admin production version', 'admin-recovery-rollback-version-receipt.json'],
    ['Resolve protected private authority before Admin recovery rollback routes', 'Clean private authority scratch before Admin recovery rollback routes', 'Restore previous Admin production routes', 'admin-recovery-rollback-routes-receipt.json'],
    ['Resolve protected private authority before Admin recovery rollback cache purge', 'Clean private authority scratch before Admin recovery rollback cache purge', 'Purge recovered Admin production cache', 'admin-recovery-rollback-cache-purge-receipt.json'],
    ['Resolve protected private authority before Admin recovery temporary URL closure', 'Clean private authority scratch before Admin recovery temporary URL closure', 'Close and verify temporary Admin URLs', 'admin-recovery-temp-urls-cleanup-receipt.json'],
  ];
  for (const [proofName, cleanupName, mutationName, receipt] of boundaries) {
    const proof = step(deploy, proofName);
    const cleanup = step(deploy, cleanupName);
    const mutation = step(deploy, mutationName);
    assert.ok(deploy.indexOf(`- name: ${proofName}`) < deploy.indexOf(`- name: ${cleanupName}`));
    assert.ok(deploy.indexOf(`- name: ${cleanupName}`) < deploy.indexOf(`- name: ${mutationName}`));
    assert.match(proof, new RegExp(`--verification-output[^\\n]*${receipt.replaceAll('.', '\\.')}`));
    assert.match(cleanup, /always\(\)/);
    assert.doesNotMatch(cleanup, new RegExp(receipt.replaceAll('.', '\\.')));
    assert.match(mutation, /expected-receipt\.json/);
    assert.match(mutation, new RegExp(receipt.replaceAll('.', '\\.')));
    if (mutationName === 'Close and verify temporary Admin URLs') {
      assert.match(mutation, /test "\$\{\{ steps\.b2_admin_recovery_[a-z_]+_authority\.outcome \}\}" = 'success'/);
      assert.match(mutation, /test "\$\{\{ steps\.b2_admin_recovery_[a-z_]+_authority_cleanup\.outcome \}\}" = 'success'/);
    } else {
      assert.match(mutation, /b2_admin_recovery_[a-z_]+_authority\.outcome == 'success'/);
      assert.match(mutation, /b2_admin_recovery_[a-z_]+_authority_cleanup\.outcome == 'success'/);
    }
  }
  assert.equal(new Set(boundaries.map(([, , , receipt]) => receipt)).size, boundaries.length);
});

test('Edge batch reaches only the closed protected runtime and never a raw shell deploy', () => {
  const functions = step(workflowJob(workflowText(), 'deploy'), 'B2 protected functions');
  assert.match(functions, /env: \*current_private_release_env/);
  assert.match(functions, /nelyon-private-authority-cli\.mjs deploy-functions/);
  assert.doesNotMatch(functions, /while IFS=|supabase functions deploy|verify-function-contract|authority-proof/);
  assert.match(functions, /function-apply-receipt\.json/);
  assert.match(step(workflowJob(workflowText(), 'deploy'), 'Clean private authority scratch after protected functions'), /if: always\(\)/);
});

test('temporary Admin URL closure attempts fresh authority but remains an unconditional safety cleanup', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const releaseProof = step(deploy, 'Resolve protected private authority before closing temporary Admin URLs');
  const releaseCleanup = step(deploy, 'Clean private authority scratch before closing temporary Admin URLs');
  const recoveryProof = step(deploy, 'Resolve protected private authority before Admin recovery temporary URL closure');
  const recoveryCleanup = step(deploy, 'Clean private authority scratch before Admin recovery temporary URL closure');
  const close = step(deploy, 'Close and verify temporary Admin URLs');
  const complete = step(deploy, 'Require complete protected release success');

  assert.match(releaseProof, /nelyon-private-authority-cli\.mjs authority-proof/);
  assert.match(recoveryProof, /nelyon-private-authority-cli\.mjs verify-admin-recovery-cloudflare-prestate/);
  assert.match(releaseCleanup, /if:\s*>-\s*always\(\)/);
  assert.match(recoveryCleanup, /if:\s*>-\s*always\(\)/);
  assert.match(close, /if:\s*>-\s*always\(\)/);
  assert.match(close, /steps\.admin_temp_urls_prestate\.outcome == 'success'/);
  assert.doesNotMatch(close.match(/if:\s*>-[\s\S]*?(?=\n        env:)/)?.[0] ?? '', /b2_admin_.*temp.*authority/);
  assert.match(close, /expected-receipt\.json/);
  assert.match(close, /admin-temp-urls-cleanup-receipt\.json/);
  assert.match(close, /preview-lifecycle[\s\S]*--enabled false[\s\S]*--previews-enabled false/);
  assert.match(complete, /b2_admin_temp_urls_cleanup_authority\.outcome == 'success'/);
  assert.match(complete, /b2_admin_temp_urls_cleanup_authority_cleanup\.outcome == 'success'/);
  assert.match(complete, /b2_admin_recovery_temp_urls_cleanup_authority\.outcome == 'success'/);
  assert.match(complete, /b2_admin_recovery_temp_urls_cleanup_authority_cleanup\.outcome == 'success'/);
});

test('retained evidence uses exact public allowlists and never uploads private runtime paths', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const uploads = [...deploy.matchAll(/      - name: Upload [^\n]+\n[\s\S]*?(?=\n      - name: |$)/g)]
    .map((match) => match[0])
    .filter((upload) => upload.includes('uses: actions/upload-artifact@'));
  assert.ok(uploads.length >= 4);
  for (const upload of uploads) {
    assert.doesNotMatch(upload, /RUNNER_TEMP|nelyon-private-authority|NELYON_PRIVATE_AUTHORITY_|nelyon-b2-recovery-source|admin-recovery-mutation-stage|authority-(?:source|chain)-(?:run|artifacts|release|gate|admin|recovery)/);
  }
  assert.match(deploy, /path:\s*\|\s*\n\s+recovery-evidence\/verified-source\.json\s*\n\s+recovery-evidence\/production-recovery\.json\s*\n\s+recovery-evidence\/postcheck-recovery-result\.json/);
  assert.doesNotMatch(deploy, /path:\s*(?:admin-recovery-evidence|recovery-evidence|gate-evidence)\/?\s*$/m);
});

// Evaluate the actual workflow admission expressions for this bounded subset.
// No run body, secret, endpoint or checkout module is executed. GitHub inserts
// success() unless a status function is present; always() explicitly bypasses it.
function admitted(body, { mode, b2 = 'true', b2RecoveryPending = 'false', outcomes = {}, priorFailed = true }) {
  const field = body.match(/^        if: ([^\n]*)(?:\n((?:          [^\n]*\n)*))?/m);
  assert.ok(field, 'step must declare its admission condition');
  const expression = field[1] === '>-' ? field[2].trim().replace(/\s+/g, ' ') : field[1];
  const status = /\b(?:always|success|failure|cancelled)\(\)/.test(expression);
  if (!status && priorFailed) return false;
  const steps = new Proxy({}, { get: (_, id) => ({ outcome: outcomes[id] ?? 'success' }) });
  const needs = { plan: { outputs: { mode, admin_enabled: 'true', admin_recovery_b2_required: b2,
    b2_recovery_pending: b2RecoveryPending } } };
  return Boolean(Function('steps', 'needs', 'always', 'success', 'failure', 'cancelled',
    `return (${expression});`)(steps, needs, () => true, () => !priorFailed, () => priorFailed, () => false));
}

const ALWAYS_CLOSURE_BOUNDARIES = [
  ['Verify independent private runtime closure before post-snapshot',
    'Resolve protected private authority and capture post-snapshot'],
  ['Verify independent private runtime closure before postcheck',
    'Resolve protected private authority and require postcheck'],
  ['Verify independent private runtime closure before Admin rollback',
    'Resolve protected private authority before Admin rollback',
    'Resolve protected private authority before Admin recovery rollback'],
  ['Verify independent private runtime closure before Admin rollback routes',
    'Resolve protected private authority before Admin rollback routes',
    'Resolve protected private authority before Admin recovery rollback routes'],
  ['Verify independent private runtime closure before Admin rollback cache purge',
    'Resolve protected private authority before Admin rollback cache purge',
    'Resolve protected private authority before Admin recovery rollback cache purge'],
  ['Verify independent private runtime closure before closing temporary Admin URLs',
    'Resolve protected private authority before closing temporary Admin URLs',
    'Resolve protected private authority before Admin recovery temporary URL closure'],
];

test('protected release revalidation stages require fresh action outputs and do not enable gate_proof credentials', () => {
  const deploy=workflowJob(workflowText(),'deploy');
  for(const name of ['Revalidate protected release manifest after authorization',
    'Resolve protected private authority before migrations','Revalidate protected release before functions']) {
    const body=step(deploy,name);
    assert.match(body,/nelyon-private-authority-cli\.mjs revalidate/);
    assert.match(body,/--stage-output/);
    assert.match(body,/--verification-output/);
    assert.equal(admitted(body,{mode:'gate_proof',priorFailed:false}),false,
      `${name} must not expand gate_proof secret access`);
    assert.equal(admitted(body,{mode:'release',priorFailed:false}),true);
  }
  for(const name of ['Clean private authority scratch after protected release revalidation',
    'Clean private authority scratch before migrations','Clean private authority scratch after protected function revalidation']) {
    assert.equal(admitted(step(deploy,name),{mode:'release',priorFailed:true}),true,
      `${name} must run even after a failed private stage`);
  }
});

test('protected gate proof keeps authority in process without deployment credentials', () => {
  const deploy=workflowJob(workflowText(),'deploy');
  for(const [name,action,modes]of [
    ['Resolve protected private authority before revalidation','revalidate',['gate_proof']],
    ['Resolve protected private authority for gate proof','verify-gate',['gate_proof']],
  ]) {
    const body=step(deploy,name);
    assert.match(body,new RegExp(`nelyon-private-authority-cli\\.mjs ${action}`));
    assert.match(body,/--stage-output/);
    assert.match(body,/--verification-output/);
    assert.doesNotMatch(body,/SUPABASE_ACCESS_TOKEN|node "\$NELYON_HELPER"/);
    for(const mode of ['gate_proof','postcheck_recovery','release']) {
      assert.equal(admitted(body,{mode,priorFailed:false}),modes.includes(mode),`${name}: ${mode}`);
    }
  }
  for(const name of ['Revalidate immutable manifest after authorization','Verify gate proof without deployment secrets']) {
    const body=step(deploy,name);
    assert.ok(body.indexOf('cmp ')>=0 && body.indexOf('cmp ')<body.indexOf('cp '));
    assert.doesNotMatch(body,/node "\$NELYON_HELPER"|SUPABASE_ACCESS_TOKEN|R2_SECRET_ACCESS_KEY/);
  }
});

test('non-pending postcheck recovery is public and tokenless while pending B2 recovery stays protected', () => {
  const text=workflowText();
  const proof=workflowJob(text,'private-authority-check');
  const deploy=workflowJob(text,'deploy');
  for(const [job,name]of [[proof,'Verify independent private runtime closure'],
    [proof,'Resolve protected private authority proof'],[deploy,'Verify independent private runtime closure for deploy'],
    [deploy,'Stage closed protected proof receipt for comparisons']]) {
    const body=step(job,name);
    assert.equal(admitted(body,{mode:'postcheck_recovery',b2RecoveryPending:'false',priorFailed:false}),false,name);
    assert.equal(admitted(body,{mode:'gate_proof',priorFailed:false}),true,name);
  }
  for(const [name,action]of [
    ['Revalidate non-pending postcheck recovery without private authority','revalidate'],
    ['Verify postcheck recovery gate without deployment commands','verify-gate'],
  ]) {
    const body=step(deploy,name);
    assert.match(body,new RegExp(`node "\\$NELYON_HELPER" ${action}`));
    assert.doesNotMatch(body,/nelyon-private-authority-cli|SUPABASE_ACCESS_TOKEN|NELYON_PRIVATE_AUTHORITY_|R2_SECRET_ACCESS_KEY|cmp /);
    assert.equal(admitted(body,{mode:'postcheck_recovery',b2RecoveryPending:'false',priorFailed:false}),true,name);
    assert.equal(admitted(body,{mode:'postcheck_recovery',b2RecoveryPending:'true',priorFailed:false}),false,name);
    assert.equal(admitted(body,{mode:'gate_proof',priorFailed:false}),false,name);
  }
  for(const name of ['Stage B2 recovery source for revalidation','Revalidate pending B2 recovery after authorization',
    'Stage B2 recovery source for current gate','Verify pending B2 recovery gate']) {
    assert.match(step(deploy,name),/b2_recovery_pending == 'true'/,name);
  }
});

test('failed authority, cleanup or receipt acceptance cannot admit a release mutation', () => {
  const deploy=workflowJob(workflowText(),'deploy');
  for(const [name,dependencies]of [
    ['Accept protected release revalidation',['b2_release_revalidation','b2_release_revalidation_cleanup']],
    ['B2 protected migrations',['migration_dry_run','b2_migration_authority','b2_migration_authority_cleanup']],
    ['Accept protected release pre-function revalidation',['b2_function_revalidation','b2_function_revalidation_cleanup']],
    ['B2 protected functions',['apply_migrations','apply_migrations_cleanup','b2_function_revalidation','b2_function_revalidation_cleanup','b2_function_revalidation_receipt']],
  ]) {
    const consumer=step(deploy,name);
    assert.equal(admitted(consumer,{mode:'release',priorFailed:false}),true,name);
    for(const id of dependencies)for(const outcome of ['failure','skipped','cancelled'])
      assert.equal(admitted(consumer,{mode:'release',priorFailed:false,outcomes:{[id]:outcome}}),false,`${name}: ${id} ${outcome}`);
  }
  const migrations=step(deploy,'B2 protected migrations');
  assert.ok(migrations.indexOf('cmp ')>=0 && migrations.indexOf('cmp ')<migrations.indexOf('cli.mjs apply-migrations'));
  assert.doesNotMatch(migrations,/node "\$NELYON_HELPER" revalidate/);
  for(const name of ['Accept protected release revalidation','Accept protected release pre-function revalidation']) {
    const consumer=step(deploy,name);
    assert.ok(consumer.indexOf('cmp ')>=0 && consumer.indexOf('cmp ')<consumer.indexOf('cp '));
    assert.doesNotMatch(consumer,/env:|SUPABASE_ACCESS_TOKEN|R2_SECRET_ACCESS_KEY/);
  }
});

for (const [bootstrapName, ...consumerNames] of ALWAYS_CLOSURE_BOUNDARIES) {
  test(`${bootstrapName}: rejected code never receives private authority environment`, () => {
    const deploy = workflowJob(workflowText(), 'deploy');
    const bootstrap = step(deploy, bootstrapName);
    // A missing id is also exercised: the old workflow has no linkage, so its
    // actual consumer condition still admits the rejected runtime.
    const bootstrapId = bootstrap.match(/^        id: (\w+)$/m)?.[1] ?? 'unlinked_bootstrap';
    for (const name of consumerNames) {
      const mode = name.includes('Admin recovery') ? 'admin_recovery' : 'release';
      const consumer = step(deploy, name);
      assert.ok(admitted(bootstrap, { mode, outcomes: { admin_finalize: 'failure' } }), bootstrapName);
      for (const outcome of ['failure', 'skipped', 'cancelled']) {
        const outcomes = { admin_finalize: 'failure', [bootstrapId]: outcome };
        assert.equal(admitted(consumer, { mode, outcomes }), false, `${name} after bootstrap ${outcome}`);
      }
      assert.equal(admitted(consumer, { mode,
        outcomes: { admin_finalize: 'failure', [bootstrapId]: 'success' } }), true,
      `${name} must remain available after unrelated earlier failure`);
    }
  });
}

test('emergency URL closure requires authentic code but not renewed operational authority', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const bootstrap = step(deploy, 'Verify independent private runtime closure before closing temporary Admin URLs');
  const id = bootstrap.match(/^        id: (\w+)$/m)?.[1] ?? 'unlinked_bootstrap';
  const close = step(deploy, 'Close and verify temporary Admin URLs');
  for (const mode of ['release', 'admin_recovery']) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      assert.equal(admitted(close, { mode, outcomes: { [id]: outcome } }), false,
        `${mode}: no Cloudflare token for rejected code`);
    }
    const outcomes = { [id]: 'success', b2_admin_temp_urls_cleanup_authority: 'failure',
      b2_admin_temp_urls_cleanup_authority_cleanup: 'failure',
      b2_admin_recovery_temp_urls_cleanup_authority: 'failure',
      b2_admin_recovery_temp_urls_cleanup_authority_cleanup: 'failure' };
    assert.equal(admitted(close, { mode, outcomes }), true,
      `${mode}: expiry/provider failure cannot prevent authentic safety cleanup`);
  }
  assert.equal(admitted(close, { mode: 'admin_recovery', b2: 'false',
    outcomes: { [id]: 'skipped' } }), true, 'legacy cleanup retains its existing authority plane');
});

test('integrity-blocked safety cleanup reports that URLs were not closed without secrets', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const report = step(deploy, 'Report integrity-blocked temporary Admin URL cleanup');
  assert.doesNotMatch(report, /secrets\.|env: \*|node scripts\//);
  for (const mode of ['release', 'admin_recovery']) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      assert.equal(admitted(report, { mode, outcomes: { b2_admin_temp_urls_closure: outcome } }), true);
    }
    assert.equal(admitted(report, { mode, outcomes: { b2_admin_temp_urls_closure: 'success' } }), false);
  }
  assert.equal(admitted(report, { mode: 'admin_recovery', b2: 'false',
    outcomes: { b2_admin_temp_urls_closure: 'skipped' } }), false);
  assert.match(report, /cleanup not executed: runtime integrity was not verified; URL closure is unconfirmed/);
});


test('read-only refresh authorization precedes PAT and cannot replace the full deployment gate', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const preflight = step(deploy, 'Preflight protected release manifest without Supabase access');
  const authorize = step(deploy, 'Authorize protected read-only inventory refresh');
  const accept = step(deploy, 'Accept protected read-only refresh authorization');
  const refresh = step(deploy, 'Revalidate protected release manifest after authorization');
  const fullGate = step(deploy, 'Resolve protected private authority for release gate');
  assert.doesNotMatch(preflight + authorize + accept, /SUPABASE_ACCESS_TOKEN/);
  assert.match(preflight, /cli\.mjs preflight-release/);
  assert.match(authorize, /cli\.mjs authorize-refresh/);
  assert.match(authorize, /steps\.b2_release_preflight_receipt\.outcome == 'success'/);
  assert.match(accept, /steps\.b2_release_refresh_authorization\.outcome == 'success'/);
  assert.match(accept, /steps\.b2_release_refresh_authorization_cleanup\.outcome == 'success'/);
  assert.match(accept, /cmp[^\n]*expected-receipt\.json[^\n]*release-refresh-authorization-verification\.json/);
  assert.match(accept, /permission\.result !== 'READ_ONLY_REFRESH_AUTHORIZED'/);
  assert.match(accept, /permission\.supabase_access !== 'read_only_inventory'/);
  assert.doesNotMatch(accept, /gate-proof\.json|GATE_VERIFIED/);
  assert.match(refresh, /steps\.b2_release_refresh_authorization_receipt\.outcome == 'success'/);
  assert.match(refresh, /cli\.mjs revalidate/);
  assert.match(refresh, /SUPABASE_ACCESS_TOKEN/);
  assert.match(fullGate, /steps\.b2_release_revalidation_receipt\.outcome == 'success'/);
  assert.match(fullGate, /cli\.mjs verify-gate/);
});


test('both migration phases use protected controller with independent binary pin and no linked CLI fallback', () => {
  const deploy=workflowJob(workflowText(),'deploy');
  assert.doesNotMatch(deploy,/supabase db push/);
  for(const action of ['dryrun-migrations','apply-migrations']) {
    const offset=deploy.indexOf('cli.mjs '+action+' ');assert.ok(offset>=0);
    const block=deploy.slice(deploy.lastIndexOf('      - name:',offset),deploy.indexOf('      - name:',offset));
    assert.match(block,/--current-gate/);assert.match(block,/--pre-snapshot/);assert.match(block,/--binary-path/);
    assert.match(block,/current_private_release_env/);
  }
  assert.match(deploy,/NELYON_SUPABASE_CLI_SHA256: \$\{\{ vars\.NELYON_SUPABASE_CLI_SHA256 \}\}/);
  assert.match(deploy,/name: B2 protected migrations/);
  assert.match(deploy,/steps\.migration_dry_run\.outcome == 'success'/);
  assert.match(deploy,/steps\.apply_migrations_cleanup\.outcome == 'success'/);
});


test('B2 mutation proof retention runs after Edge cleanup without credentials or a success requirement',()=>{
 const deploy=workflowJob(workflowText(),'deploy'),retain=step(deploy,'Retain public B2 mutation attempt proofs even after failure');
 assert.match(retain,/if: always\(\) && needs\.plan\.outputs\.mode == 'release'/);
 assert.doesNotMatch(retain,/outcome == 'success'|SUPABASE_ACCESS_TOKEN|env:|PRIVATE_AUTHORITY_R2/);
 assert.match(retain,/retainB2MigrationAttemptProof/);
 assert.ok(deploy.indexOf('name: Retain public B2 mutation attempt proofs even after failure')>deploy.indexOf('name: Clean private authority scratch after protected functions'));
 assert.match(deploy.slice(deploy.indexOf('name: Upload sanitized gate evidence')),/gate-evidence\/protected-stage-proofs\.json/);
});

test('migration and Edge stages resolve independently pinned Linux ELF instead of passing npm shim',()=>{
 const workflow=workflowText();
 assert.equal(workflow.split('process.stdout.write(resolveInstalledLinuxCliBinary').length-1,3);
 assert.equal((workflow.match(/--binary-path "\$NELYON_MIGRATION_BINARY"/g)??[]).length,2);
 assert.equal((workflow.match(/--binary-path "\$NELYON_FUNCTION_BINARY"/g)??[]).length,1);
 assert.doesNotMatch(workflow,/--binary-path "\$\(command -v supabase\)"/);
 const assignments=workflow.match(/^\s+NELYON_(?:MIGRATION|FUNCTION)_BINARY=.*$/gm)??[];
 assert.equal(assignments.length,3);
 for(const assignment of assignments) assert.ok(assignment.endsWith('"$(command -v supabase)")"'),assignment);
});
