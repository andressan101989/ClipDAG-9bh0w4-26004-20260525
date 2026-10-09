import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('NUL name-status parsing preserves spaces tabs and Unicode', async () => {
  const { gate } = await loadGateAndPolicy();
  const input = Buffer.from('M\0file with spaces.txt\0A\0tab\tname.ts\0M\0unicodé.ts\0', 'utf8');
  assert.deepEqual(gate.parseNameStatusZ(input), [
    { status: 'M', path: 'file with spaces.txt' },
    { status: 'A', path: 'tab\tname.ts' },
    { status: 'M', path: 'unicodé.ts' },
  ]);
});

test('unsupported rename copy deletion symlink submodule and unknown supabase paths deny', async () => {
  const { gate } = await loadGateAndPolicy();
  for (const changes of [
    [{ status: 'R100', oldPath: 'supabase/config.toml', path: 'supabase/renamed.toml' }],
    [{ status: 'C100', oldPath: 'supabase/config.toml', path: 'supabase/copied.toml' }],
    [{ status: 'D', path: 'supabase/config.toml' }],
    [{ status: 'M', path: 'supabase/config.toml', fileType: 'symlink' }],
    [{ status: 'M', path: 'supabase/functions/stripe-webhook', fileType: 'submodule' }],
    [{ status: 'M', path: 'supabase/unknown/state.json', fileType: 'file' }],
  ]) {
    assertDenied(() => gate.classifyChangedPaths(changes), 'UNSUPPORTED_GIT_CHANGE');
  }
});

test('approved SHA must equal fetched origin main and descend from baseline', async t => {
  const { gate } = await loadGateAndPolicy();
  const directory = mkdtempSync(join(tmpdir(), 'nelyon-release-git-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory });
  git('config', 'user.email', 'release-gate@example.invalid');
  git('config', 'user.name', 'Release Gate Test');
  writeFileSync(join(directory, 'tracked.txt'), 'base\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('branch', 'side');
  writeFileSync(join(directory, 'tracked.txt'), 'main\n');
  git('commit', '-am', 'main');
  const head = git('rev-parse', 'HEAD');
  git('checkout', 'side');
  writeFileSync(join(directory, 'side.txt'), 'side\n');
  git('add', 'side.txt');
  git('commit', '-m', 'side');
  const side = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  git('remote', 'add', 'origin', 'https://github.com/andressan101989/ClipDAG-9bh0w4-26004-20260525.git');
  git('update-ref', 'refs/remotes/origin/main', head);
  const runGit = args => execFileSync('git', args, { cwd: directory });
  const state = gate.resolveGitState({
    cwd: directory,
    baselineSha: base,
    approvedSha: head,
    expectedRepository: REPOSITORY,
    runGit,
  });
  assert.equal(state.originMainSha, head);
  assert.equal(state.approvedSha, head);
  assert.ok(state.changes.some(change => change.path === 'tracked.txt'));
  assertDenied(() => gate.resolveGitState({ cwd: directory, baselineSha: base, approvedSha: base, expectedRepository: REPOSITORY, runGit }), 'MAIN_SHA_MISMATCH');
  assertDenied(() => gate.resolveGitState({ cwd: directory, baselineSha: side, approvedSha: head, expectedRepository: REPOSITORY, runGit }), 'BASELINE_NOT_ANCESTOR');
});

test('only strictly newer added timestamped migrations are releasable', async () => {
  const { gate } = await loadGateAndPolicy();
  const result = gate.validateMigrationDelta({
    changes: [{ status: 'A', path: 'supabase/migrations/20261010000000_release_gate_probe.sql', fileType: 'file' }],
    baselineLatestMigration: '20261009021414_creator_premium_b5_creator_management_ux',
    remoteMigrations: ['20261009021414'],
    dryRunPending: ['20261010000000'],
  });
  assert.deepEqual(result, [{ version: '20261010000000', path: 'supabase/migrations/20261010000000_release_gate_probe.sql' }]);
});

test('modified deleted renamed duplicate and out-of-order migrations deny', async () => {
  const { gate } = await loadGateAndPolicy();
  const baseline = '20261009021414_creator_premium_b5_creator_management_ux';
  const cases = [
    [{ status: 'M', path: 'supabase/migrations/20261010000000_modified.sql' }],
    [{ status: 'D', path: 'supabase/migrations/20261010000000_deleted.sql' }],
    [{ status: 'R100', oldPath: 'supabase/migrations/20261010000000_a.sql', path: 'supabase/migrations/20261010000001_b.sql' }],
    [
      { status: 'A', path: 'supabase/migrations/20261010000000_first.sql' },
      { status: 'A', path: 'supabase/migrations/20261010000000_duplicate.sql' },
    ],
    [{ status: 'A', path: 'supabase/migrations/20261009020000_old.sql' }],
  ];
  for (const changes of cases) {
    assertDenied(() => gate.validateMigrationDelta({
      changes,
      baselineLatestMigration: baseline,
      remoteMigrations: ['20261009021414'],
      dryRunPending: [],
    }), 'INVALID_MIGRATION_DELTA');
  }
});

test('remote pending migrations must equal the manifest set exactly', async () => {
  const { gate } = await loadGateAndPolicy();
  const input = {
    changes: [{ status: 'A', path: 'supabase/migrations/20261010000000_expected.sql' }],
    baselineLatestMigration: '20261009021414_creator_premium_b5_creator_management_ux',
    remoteMigrations: ['20261009021414'],
  };
  assertDenied(() => gate.validateMigrationDelta({ ...input, dryRunPending: [] }), 'MIGRATION_DRY_RUN_MISMATCH');
  assertDenied(() => gate.validateMigrationDelta({ ...input, dryRunPending: ['20261010000000', '20261011000000'] }), 'MIGRATION_DRY_RUN_MISMATCH');
  assertDenied(() => gate.validateMigrationDelta({ ...input, remoteMigrations: ['20261010000000'], dryRunPending: ['20261010000000'] }), 'MIGRATION_ALREADY_APPLIED');
});

test('only exact config.toml function declarations are managed', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const config = gate.parseFunctionConfig(toml);
  assert.deepEqual(Object.keys(config), MANAGED_FUNCTIONS);
  assert.equal(config['agora-token'].verify_jwt, true);
  assert.equal(config['stripe-webhook'].verify_jwt, false);
  assert.deepEqual(Object.keys(config), policy.supabase.managed_functions);
  assertDenied(() => gate.parseFunctionConfig(`${toml}\n[functions.agora-token]\nverify_jwt = true\n`), 'AMBIGUOUS_FUNCTION_CONFIG');
});

test('bdag-economy and undeclared functions are denied', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/bdag-economy/index.ts': 'export const value = 1;\n',
    'supabase/functions/not-declared/index.ts': 'export const value = 2;\n',
  });
  for (const path of [
    'supabase/functions/bdag-economy/index.ts',
    'supabase/functions/not-declared/index.ts',
  ]) {
    assertDenied(() => gate.resolveAffectedFunctions({
      changes: [{ status: 'M', path }],
      graph,
      managedFunctions: policy.supabase.managed_functions,
      forbiddenFunctions: policy.supabase.forbidden_functions,
    }), 'FUNCTION_NOT_AUTHORIZED');
  }
});

test('direct and multi-hop shared imports propagate to all consumers', async () => {
  const { gate } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': "import { a } from '../_shared/a.ts';\nexport { a };\n",
    'supabase/functions/create-media-upload/index.ts': 'export const unrelated = true;\n',
    'supabase/functions/_shared/a.ts': "export { b as a } from './b.ts';\n",
    'supabase/functions/_shared/b.ts': 'export const b = 1;\n',
  });
  assert.deepEqual(gate.resolveAffectedFunctions({
    changes: [{ status: 'M', path: 'supabase/functions/_shared/b.ts' }],
    graph,
    managedFunctions: MANAGED_FUNCTIONS,
    forbiddenFunctions: ['bdag-economy'],
  }), ['agora-token']);
});

test('literal dynamic imports resolve while nonliteral imports deny', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.deepEqual(gate.parseModuleSpecifiers("await import('./worker.ts');", 'supabase/functions/agora-token/index.ts'), [
    { kind: 'dynamic', specifier: './worker.ts' },
  ]);
  assertDenied(() => gate.parseModuleSpecifiers('await import(moduleName);', 'supabase/functions/agora-token/index.ts'), 'AMBIGUOUS_IMPORT');
  assertDenied(() => gate.parseModuleSpecifiers('await import(`./${name}.ts`);', 'supabase/functions/agora-token/index.ts'), 'AMBIGUOUS_IMPORT');
});

test('unresolved escaping and ambiguous imports deny', async () => {
  const { gate } = await loadGateAndPolicy();
  assertDenied(() => gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': "import '../../../outside.ts';\n",
  }), 'IMPORT_ESCAPES_FUNCTIONS');
  assertDenied(() => gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': "import './missing';\n",
  }), 'UNRESOLVED_IMPORT');
  assertDenied(() => gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': "import './choice';\n",
    'supabase/functions/agora-token/choice.ts': 'export const a = 1;\n',
    'supabase/functions/agora-token/choice/index.ts': 'export const a = 2;\n',
  }), 'AMBIGUOUS_IMPORT');
});

test('floating supabase-js blocks every affected function', async () => {
  const { gate } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';\nexport { createClient };\n",
    'supabase/functions/create-media-upload/index.ts': "import { createClient } from 'npm:@supabase/supabase-js@2.49.1';\nexport { createClient };\n",
  });
  const result = gate.analyzeFunctionReproducibility({
    affectedFunctions: ['agora-token', 'create-media-upload'],
    graph,
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockedFunctions, ['agora-token']);
  assert.equal(result.findings[0].code, 'FLOATING_DEPENDENCY');
  assert.equal(result.findings[0].resource, 'agora-token');
});

test('verify_jwt changes and false values are high risk', async () => {
  const { gate } = await loadGateAndPolicy();
  const before = gate.parseFunctionConfig('[functions.agora-token]\nverify_jwt = true\n');
  const after = gate.parseFunctionConfig('[functions.agora-token]\nverify_jwt = false\n');
  const result = gate.classifyRisk({
    affectedFunctions: ['agora-token'],
    changedPaths: ['supabase/config.toml'],
    configBefore: before,
    configAfter: after,
  });
  assert.equal(result.level, 'HIGH');
  assert.ok(result.findings.some(finding => finding.code === 'VERIFY_JWT_CHANGED'));
  assert.ok(result.findings.some(finding => finding.code === 'VERIFY_JWT_DISABLED'));
});

test('finance webhook BDAG media auth moderation and gate authority are high risk', async () => {
  const { gate } = await loadGateAndPolicy();
  const result = gate.classifyRisk({
    affectedFunctions: [
      'stripe-webhook',
      'stripe-bdag-checkout',
      'stream-webhook',
      'create-media-upload',
      'admin-user-moderation',
      'agora-token',
    ],
    changedPaths: ['.github/workflows/nelyon-production-release.yml'],
    configBefore: {},
    configAfter: {},
  });
  assert.equal(result.level, 'HIGH');
  for (const code of ['FINANCE_RESOURCE', 'WEBHOOK_RESOURCE', 'BDAG_RESOURCE', 'PRIVATE_MEDIA_RESOURCE', 'MODERATION_RESOURCE', 'AUTH_RESOURCE', 'GATE_AUTHORITY_CHANGE']) {
    assert.ok(result.findings.some(finding => finding.code === code), `missing ${code}`);
  }
});

function manifestInput(policy, overrides = {}) {
  return {
    request: request(),
    policy,
    gitState: {
      baselineSha: policy.baseline.sha,
      approvedSha: MAIN_SHA,
      originMainSha: MAIN_SHA,
      changes: [{ status: 'M', path: '.github/nelyon-production-release-policy.json', fileType: 'file' }],
    },
    classified: {
      all: [{ status: 'M', path: '.github/nelyon-production-release-policy.json', fileType: 'file' }],
      config: [],
      functions: [],
      governance: [{ status: 'M', path: '.github/nelyon-production-release-policy.json', fileType: 'file' }],
      migrations: [],
      other: [],
      productive: [],
      shared: [],
    },
    migrations: [],
    affectedFunctions: [],
    reproducibility: { allowed: true, blockedFunctions: [], findings: [] },
    risk: { level: 'HIGH', findings: [{ severity: 'HIGH', code: 'GATE_AUTHORITY_CHANGE', path: '.github/nelyon-production-release-policy.json', resource: 'release-gate', message: 'release authority changed' }] },
    compiler: { path: 'scripts/nelyon-production-release.mjs', sha256: 'a'.repeat(64) },
    generatedAt: '2026-10-09T12:00:00.000Z',
    ...overrides,
  };
}

test('manifest contains exact identity delta resources risks and blockers', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const input = manifestInput(policy, {
    classified: {
      all: [
        { status: 'A', path: 'supabase/migrations/20261010000000_gate.sql', fileType: 'file' },
        { status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' },
      ],
      config: [],
      functions: [{ status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' }],
      governance: [],
      migrations: [{ status: 'A', path: 'supabase/migrations/20261010000000_gate.sql', fileType: 'file' }],
      other: [],
      productive: [
        { status: 'A', path: 'supabase/migrations/20261010000000_gate.sql', fileType: 'file' },
        { status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' },
      ],
      shared: [],
    },
    migrations: [{ version: '20261010000000', path: 'supabase/migrations/20261010000000_gate.sql' }],
    affectedFunctions: ['agora-token'],
    reproducibility: {
      allowed: false,
      blockedFunctions: ['agora-token'],
      findings: [{ severity: 'BLOCKING', code: 'FLOATING_DEPENDENCY', path: 'supabase/functions/agora-token/index.ts', resource: 'agora-token', message: 'floating' }],
    },
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.identity.run_id, '123456789');
  assert.equal(manifest.identity.run_attempt, 1);
  assert.equal(manifest.identity.approved_sha, MAIN_SHA);
  assert.equal(manifest.identity.release_id, 'nelyon-20261009-001');
  assert.equal(manifest.delta.files.length, 2);
  assert.deepEqual(manifest.resources.migrations, input.migrations);
  assert.deepEqual(manifest.resources.functions, ['agora-token']);
  assert.equal(manifest.risk.level, 'HIGH');
  assert.equal(manifest.blockers[0].code, 'FLOATING_DEPENDENCY');
  assert.equal(manifest.result, 'DENY');
});

test('governance-only delta reports NO PRODUCTIVE CHANGES', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const manifest = gate.buildManifest(manifestInput(policy));
  assert.equal(manifest.result, 'NO PRODUCTIVE CHANGES');
  assert.deepEqual(manifest.resources, { functions: [], migrations: [], config_changed: false });
});

test('one-byte manifest or digest alteration denies', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const directory = mkdtempSync(join(tmpdir(), 'nelyon-release-bundle-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const manifest = gate.buildManifest(manifestInput(policy));
  const bundle = gate.writeManifestBundle({ manifest, outputDirectory: directory });
  writeFileSync(join(directory, 'manifest.json'), `${readFileSync(join(directory, 'manifest.json'), 'utf8')} `);
  assertDenied(() => gate.verifyManifestBundle({ directory, expected: bundle.provenance }), 'MANIFEST_DIGEST_MISMATCH');
  gate.writeManifestBundle({ manifest, outputDirectory: directory });
  writeFileSync(join(directory, 'manifest.sha256'), `${'0'.repeat(64)}\n`);
  assertDenied(() => gate.verifyManifestBundle({ directory, expected: bundle.provenance }), 'MANIFEST_DIGEST_MISMATCH');
});

test('artifact provenance binds run attempt release SHA and compiler digest', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const directory = mkdtempSync(join(tmpdir(), 'nelyon-release-provenance-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const manifest = gate.buildManifest(manifestInput(policy));
  const bundle = gate.writeManifestBundle({ manifest, outputDirectory: directory });
  assert.equal(gate.verifyManifestBundle({ directory, expected: bundle.provenance }).digest, bundle.digest);
  for (const patch of [
    { runId: '987654321' },
    { runAttempt: 2 },
    { releaseId: 'nelyon-20261009-002' },
    { approvedSha: '1'.repeat(40) },
    { compilerSha256: 'b'.repeat(64) },
  ]) {
    assertDenied(() => gate.verifyManifestBundle({ directory, expected: { ...bundle.provenance, ...patch } }), 'ARTIFACT_PROVENANCE_MISMATCH');
  }
});

test('duplicate traversal absolute symlink and unexpected artifact entries deny', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const directory = mkdtempSync(join(tmpdir(), 'nelyon-release-entries-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const manifest = gate.buildManifest(manifestInput(policy));
  const bundle = gate.writeManifestBundle({ manifest, outputDirectory: directory });
  const normal = [
    { path: 'manifest.json', type: 'file' },
    { path: 'manifest.sha256', type: 'file' },
    { path: 'summary.md', type: 'file' },
  ];
  for (const artifactEntries of [
    [...normal, { path: 'manifest.json', type: 'file' }],
    [...normal, { path: '../escaped.txt', type: 'file' }],
    [...normal, { path: 'C:/absolute.txt', type: 'file' }],
    normal.map(entry => entry.path === 'manifest.json' ? { ...entry, type: 'symlink' } : entry),
    [...normal, { path: 'unexpected.txt', type: 'file' }],
  ]) {
    assertDenied(() => gate.verifyManifestBundle({
      directory,
      expected: { ...bundle.provenance, artifactEntries },
    }), 'UNSAFE_ARTIFACT');
  }
});

test('release history pagination detects every retained replay', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assertDenied(() => gate.validateReleaseHistory({
    releaseId: 'nelyon-20261009-001',
    pages: { complete: false, pages: [{ items: [] }] },
    policy,
  }), 'INCOMPLETE_RELEASE_HISTORY');
  assertDenied(() => gate.validateReleaseHistory({
    releaseId: 'nelyon-20261009-001',
    pages: { complete: true, pages: [{ items: [] }, { items: [{ release_id: 'nelyon-20261009-001' }] }] },
    policy,
  }), 'RELEASE_ID_REPLAY');
  assert.equal(gate.validateReleaseHistory({
    releaseId: 'nelyon-20261009-001',
    pages: { complete: true, pages: [{ items: [{ release_id: 'different-release' }] }] },
    policy,
  }), true);
});

test('a completed release ID stored in policy denies after artifact expiry', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const persisted = { ...policy, release_history: [{ release_id: 'nelyon-20261009-001', result: 'SUCCESS' }] };
  assertDenied(() => gate.validateReleaseHistory({
    releaseId: 'nelyon-20261009-001',
    pages: { complete: true, pages: [] },
    policy: persisted,
  }), 'RELEASE_ID_REPLAY');
});

function approvalInput(overrides = {}) {
  return {
    runId: '123456789',
    runAttempt: 1,
    environmentId: 42,
    environmentName: 'production',
    releaseId: 'nelyon-20261009-001',
    approvedSha: MAIN_SHA,
    manifestDigest: 'c'.repeat(64),
    evidenceId: 'supabase-off-20261009T120000Z',
    evidenceSha256: 'd'.repeat(64),
    ...overrides,
  };
}

function environmentSnapshot(overrides = {}) {
  return {
    id: 42,
    name: 'production',
    can_admins_bypass: false,
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: OWNER } }],
    }],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
    ...overrides,
  };
}

function autoDeployEvidence(overrides = {}) {
  return {
    id: 'supabase-off-20261009T120000Z',
    sha256: 'd'.repeat(64),
    project_ref: PROJECT_REF,
    production_branch: 'main',
    state: 'off',
    observed_at: '2026-10-09T12:00:00.000Z',
    observed_by: OWNER,
    source: 'owner-dashboard',
    redacted: true,
    ...overrides,
  };
}

test('approval token binds run attempt environment release SHA and digest', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.equal(
    gate.buildApprovalToken(approvalInput()),
    `NELYON-APPROVE run=123456789 attempt=1 env=42 release=nelyon-20261009-001 sha=${MAIN_SHA} manifest=${'c'.repeat(64)} auto_deploy_evidence=supabase-off-20261009T120000Z auto_deploy_sha256=${'d'.repeat(64)}`,
  );
});

test('approval from another run attempt environment or manifest denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const expected = approvalInput();
  const token = gate.buildApprovalToken(expected);
  const base = {
    complete: true,
    sourceRunId: expected.runId,
    sourceRunAttempt: expected.runAttempt,
    pages: [{ items: [{ state: 'approved', comment: token, environments: [{ id: 42, name: 'production' }], user: { login: OWNER } }] }],
  };
  for (const patch of [
    { sourceRunId: '987654321' },
    { sourceRunAttempt: 2 },
    { pages: [{ items: [{ state: 'approved', comment: gate.buildApprovalToken(approvalInput({ environmentId: 43 })), environments: [{ id: 43, name: 'production' }], user: { login: OWNER } }] }] },
    { pages: [{ items: [{ state: 'approved', comment: gate.buildApprovalToken(approvalInput({ manifestDigest: 'e'.repeat(64) })), environments: [{ id: 42, name: 'production' }], user: { login: OWNER } }] }] },
  ]) {
    assertDenied(() => gate.verifyApprovalHistory({
      approvals: { ...base, ...patch },
      expectedToken: token,
      owner: OWNER,
      environmentId: 42,
      environmentName: 'production',
      expectedRunId: expected.runId,
      expectedRunAttempt: expected.runAttempt,
    }), 'INVALID_CURRENT_APPROVAL');
  }
});

test('historical approval cannot validate a rerun', async () => {
  const { gate } = await loadGateAndPolicy();
  const current = approvalInput({ runAttempt: 2 });
  const historicalToken = gate.buildApprovalToken(approvalInput({ runAttempt: 1 }));
  assertDenied(() => gate.verifyApprovalHistory({
    approvals: {
      complete: true,
      sourceRunId: current.runId,
      sourceRunAttempt: current.runAttempt,
      pages: [{ items: [{ state: 'approved', comment: historicalToken, environments: [{ id: 42, name: 'production' }], user: { login: OWNER } }] }],
    },
    expectedToken: gate.buildApprovalToken(current),
    owner: OWNER,
    environmentId: 42,
    environmentName: 'production',
    expectedRunId: current.runId,
    expectedRunAttempt: current.runAttempt,
  }), 'INVALID_CURRENT_APPROVAL');
});

test('missing wrong duplicate rejected or bypass approval denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const expected = approvalInput();
  const token = gate.buildApprovalToken(expected);
  const valid = { state: 'approved', comment: token, environments: [{ id: 42, name: 'production' }], user: { login: OWNER } };
  for (const items of [
    [],
    [{ ...valid, user: { login: 'someone-else' } }],
    [valid, valid],
    [{ ...valid, state: 'rejected' }],
    [{ ...valid, state: 'bypassed' }],
  ]) {
    assertDenied(() => gate.verifyApprovalHistory({
      approvals: { complete: true, sourceRunId: expected.runId, sourceRunAttempt: 1, pages: [{ items }] },
      expectedToken: token,
      owner: OWNER,
      environmentId: 42,
      environmentName: 'production',
      expectedRunId: expected.runId,
      expectedRunAttempt: 1,
    }), 'INVALID_CURRENT_APPROVAL');
  }
});

test('approval pagination must be complete', async () => {
  const { gate } = await loadGateAndPolicy();
  const expected = approvalInput();
  assertDenied(() => gate.verifyApprovalHistory({
    approvals: { complete: false, sourceRunId: expected.runId, sourceRunAttempt: 1, pages: [] },
    expectedToken: gate.buildApprovalToken(expected),
    owner: OWNER,
    environmentId: 42,
    environmentName: 'production',
    expectedRunId: expected.runId,
    expectedRunAttempt: 1,
  }), 'INCOMPLETE_APPROVAL_HISTORY');
});

test('environment requires only owner reviewer self-review off main-only and no admin bypass', async () => {
  const { gate } = await loadGateAndPolicy();
  const branchPolicies = { complete: true, pages: [{ items: [{ name: 'main' }] }] };
  assert.equal(gate.verifyEnvironmentSnapshot({
    environment: environmentSnapshot(),
    branchPolicies,
    expected: { id: 42, name: 'production', owner: OWNER, branch: 'main' },
  }), true);
  const invalidEnvironments = [
    environmentSnapshot({ can_admins_bypass: true }),
    environmentSnapshot({ protection_rules: [] }),
    environmentSnapshot({ protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { login: OWNER } }] }] }),
    environmentSnapshot({ protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'someone-else' } }] }] }),
    environmentSnapshot({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }),
  ];
  for (const environment of invalidEnvironments) {
    assertDenied(() => gate.verifyEnvironmentSnapshot({
      environment,
      branchPolicies,
      expected: { id: 42, name: 'production', owner: OWNER, branch: 'main' },
    }), 'UNSAFE_ENVIRONMENT');
  }
  assertDenied(() => gate.verifyEnvironmentSnapshot({
    environment: environmentSnapshot(),
    branchPolicies: { complete: true, pages: [{ items: [{ name: 'main' }, { name: 'dev' }] }] },
    expected: { id: 42, name: 'production', owner: OWNER, branch: 'main' },
  }), 'UNSAFE_ENVIRONMENT');
});

test('release requires owner confirmation of current auto-deploy-off evidence', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence();
  assert.equal(gate.verifyAutoDeployEvidence({
    evidence,
    approval: {
      evidenceId: evidence.id,
      evidenceSha256: evidence.sha256,
      projectRef: PROJECT_REF,
      productionBranch: 'main',
      owner: OWNER,
    },
    now: '2026-10-09T12:10:00.000Z',
  }), true);
});

test('toggle evidence older than 900 seconds denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence();
  assertDenied(() => gate.verifyAutoDeployEvidence({
    evidence,
    approval: { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER },
    now: '2026-10-09T12:15:01.000Z',
  }), 'STALE_AUTO_DEPLOY_EVIDENCE');
});

test('future evidence beyond 60 seconds clock skew denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence({ observed_at: '2026-10-09T12:01:01.000Z' });
  assertDenied(() => gate.verifyAutoDeployEvidence({
    evidence,
    approval: { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER },
    now: '2026-10-09T12:00:00.000Z',
  }), 'FUTURE_AUTO_DEPLOY_EVIDENCE');
});

test('mismatched evidence ID digest project branch or approval comment denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence();
  const approval = { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER };
  const cases = [
    [evidence, { ...approval, evidenceId: 'another-evidence' }],
    [evidence, { ...approval, evidenceSha256: 'e'.repeat(64) }],
    [{ ...evidence, project_ref: 'wrongprojectwrongpro' }, approval],
    [{ ...evidence, production_branch: 'dev' }, approval],
    [{ ...evidence, observed_by: 'someone-else' }, approval],
  ];
  for (const [candidate, binding] of cases) {
    assertDenied(() => gate.verifyAutoDeployEvidence({ evidence: candidate, approval: binding, now: '2026-10-09T12:10:00.000Z' }), 'INVALID_AUTO_DEPLOY_EVIDENCE');
  }
});

test('plan_only and gate_proof never require Supabase deployment secrets', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.deepEqual(gate.requiredSecretsForMode('plan_only', {}), []);
  assert.deepEqual(gate.requiredSecretsForMode('gate_proof', {}), []);
  assertDenied(() => gate.requiredSecretsForMode('release', {}), 'MISSING_SECRETS');
});

test('production concurrency denies another active release run', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.equal(gate.verifyConcurrency({ runs: { complete: true, pages: [{ items: [{ id: 123, status: 'in_progress' }] }] }, currentRunId: '123' }), true);
  assertDenied(() => gate.verifyConcurrency({
    runs: { complete: true, pages: [{ items: [{ id: 123, status: 'in_progress' }, { id: 456, status: 'queued' }] }] },
    currentRunId: '123',
  }), 'CONCURRENT_RELEASE');
});

function baselineSnapshot(policy, overrides = {}) {
  const unmanaged = Array.from({ length: policy.supabase.expected_remote_function_count - MANAGED_FUNCTIONS.length }, (_, index) => ({
    name: `remote-unmanaged-${String(index + 1).padStart(2, '0')}`,
    version: index + 1,
  }));
  return {
    complete: true,
    source: 'owner-control-plane',
    observed_at: '2026-10-09T12:00:00.000Z',
    project_ref: PROJECT_REF,
    candidate_sha: MAIN_SHA,
    workflow_runtime: false,
    reviewed_policy_sha256: 'f'.repeat(64),
    migrations: {
      complete: true,
      items: Array.from({ length: 336 }, (_, index) => `2026${String(index).padStart(10, '0')}`),
      latest: '20261009021414_creator_premium_b5_creator_management_ux',
    },
    functions: {
      complete: true,
      managed: MANAGED_FUNCTIONS.map((name, index) => ({ name, version: index + 1, verify_jwt: true, source_sha256: String(index + 1).padStart(64, '0'), source_parity: true })),
      unmanaged,
    },
    config: { complete: true, managed_functions: MANAGED_FUNCTIONS.map(name => ({ name, verify_jwt: true })) },
    cron_security: { complete: true, cron: [], security_findings: [] },
    finance: {
      complete: true,
      policy: { purchase_enabled: false, subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 },
      premium_transaction_count: 0,
      c2_attributed_bdag_movement: 0,
    },
    health: { complete: true, status: 'ACTIVE_HEALTHY' },
    prior_release: {
      kind: 'bootstrap',
      release_id: null,
      manifest_sha256: null,
      postcheck_evidence_sha256: 'e'.repeat(64),
    },
    ...overrides,
  };
}

test('candidate to verified requires exact migrations functions config finance cron and health evidence', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy));
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: MAIN_SHA,
      migrationCount: 336,
      latestMigration: '20261009021414_creator_premium_b5_creator_management_ux',
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
    },
  });
  assert.equal(verified.verification.state, 'verified');
  assert.deepEqual(Object.keys(evidence.digests).sort(), ['config_verify_jwt', 'cron_security', 'finance', 'function_source_parity', 'managed_functions', 'migrations', 'unmanaged_functions']);
  for (const value of Object.values(evidence.digests)) assert.match(value, /^[0-9a-f]{64}$/);
});

test('Git SHA equality alone cannot verify baseline', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assertDenied(() => gate.buildBaselineEvidence({
    complete: true,
    source: 'owner-control-plane',
    project_ref: PROJECT_REF,
    candidate_sha: MAIN_SHA,
  }), 'INCOMPLETE_BASELINE_EVIDENCE');
  assert.equal(policy.baseline.state, 'candidate');
});

test('workflow actor and workflow runtime cannot promote baseline', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  for (const patch of [
    { source: 'github-actions' },
    { workflow_runtime: true },
  ]) {
    assertDenied(() => gate.buildBaselineEvidence(baselineSnapshot(policy, patch)), 'INVALID_BASELINE_AUTHORITY');
  }
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy));
  assertDenied(() => gate.proposeVerifiedBaseline({ policy, evidence, owner: OWNER, source: 'github-actions' }), 'INVALID_BASELINE_AUTHORITY');
});

test('verified baseline requires owner reviewer and a separate policy commit', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy));
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: MAIN_SHA,
      migrationCount: 336,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
    },
  });
  const original = JSON.stringify(policy);
  assertDenied(() => gate.proposeVerifiedBaseline({ policy, evidence: verified, owner: 'someone-else' }), 'INVALID_BASELINE_AUTHORITY');
  const proposal = gate.proposeVerifiedBaseline({ policy, evidence: verified, owner: OWNER });
  assert.equal(JSON.stringify(policy), original, 'proposal must not mutate policy');
  assert.equal(proposal.policy.baseline.state, 'verified');
  assert.equal(proposal.policy.baseline.requires_separate_policy_commit, true);
  assert.match(proposal.digest, /^[0-9a-f]{64}$/);
  assert.equal(gate.sha256Hex(proposal.bytes), proposal.digest);
});

test('environment policy digest must match exact reviewed policy bytes', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const exactPolicyBytes = readFileSync(policyUrl);
  const exactDigest = gate.sha256Hex(exactPolicyBytes);
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy, { reviewed_policy_sha256: exactDigest }));
  assert.equal(gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: MAIN_SHA,
      migrationCount: 336,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicyBytes: exactPolicyBytes,
    },
  }).verification.reviewed_policy_sha256, exactDigest);
  assertDenied(() => gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: MAIN_SHA,
      migrationCount: 336,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicyBytes: Buffer.from(`${exactPolicyBytes.toString('utf8')} `),
    },
  }), 'BASELINE_EVIDENCE_MISMATCH');
});

test('baseline advancement records prior release ID manifest and evidence digests', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const priorRelease = {
    kind: 'post-release',
    release_id: 'nelyon-20261009-001',
    manifest_sha256: 'a'.repeat(64),
    postcheck_evidence_sha256: 'b'.repeat(64),
  };
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy, { prior_release: priorRelease }));
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: MAIN_SHA,
      migrationCount: 336,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
    },
  });
  const proposal = gate.proposeVerifiedBaseline({ policy, evidence: verified, owner: OWNER });
  assert.deepEqual(proposal.policy.baseline.prior_release, priorRelease);
  assert.deepEqual(proposal.policy.baseline.evidence_digests, evidence.digests);
});

test('partial paginated or source-ambiguous evidence keeps affected resources blocked', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  for (const patch of [
    { migrations: { ...baselineSnapshot(policy).migrations, complete: false } },
    { functions: { ...baselineSnapshot(policy).functions, complete: false } },
    { source: 'unknown-control-plane' },
  ]) {
    const code = patch.source ? 'INVALID_BASELINE_AUTHORITY' : 'INCOMPLETE_BASELINE_EVIDENCE';
    assertDenied(() => gate.buildBaselineEvidence(baselineSnapshot(policy, patch)), code);
  }
  const functions = baselineSnapshot(policy).functions;
  functions.managed[0] = { ...functions.managed[0], source_parity: false };
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy, { functions }));
  assert.deepEqual(evidence.blocked_resources, ['agora-token']);
});
