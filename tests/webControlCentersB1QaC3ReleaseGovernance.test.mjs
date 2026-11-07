import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(
  path.join(root, '.github', 'nelyon-production-release-policy.json'),
  'utf8',
));
const migrationPath =
  'supabase/migrations/20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery.sql';
const reviewedSourceSha = '44d2f9a8e827a83dcab2a63f7f82c386dcbd05b6';
const integratedMainSha = 'c68bed398dc263409e8e2ea9d0c0764ef6ea3b4a';
const targetIdentity =
  'public.list_my_publication_drafts_v1(integer,timestampwithtimezone,uuid)';
const predecessorDefinition =
  '4a826e0ac92c77dfe7e10f725f1278152bbd7e544763c809f34007c1d1b53ff1';
const successorDefinition =
  'adc7f6e9126e1abc7a3c1dd741ae5e13428ab6252b3a1f4243d88fc7a88720c7';

function withPreQaC3Baseline(value) {
  const historical = structuredClone(value);
  historical.baseline.sha = historical.web_control_centers_b1_qa_c3_transition.baseline_sha;
  historical.baseline.migration_count = 366;
  historical.baseline.latest_migration =
    '20261102065812_web_control_centers_b1_publication_drafts';
  historical.baseline.evidence_digests.migrations =
    '4c8b0255a013b9ccb2529e9d92738fd28241d75a5dd77a3adfd98371028d42cd';
  return historical;
}

async function load(relative) {
  return import(`${pathToFileURL(path.join(root, relative)).href}?qa-c3=${Date.now()}-${Math.random()}`);
}

function rpcState(attestation) {
  const { advisor_fingerprint: _advisorFingerprint, ...catalogAttestation } = attestation;
  return {
    schema_version: 1,
    complete: true,
    function: structuredClone(catalogAttestation),
  };
}

function installedMigrationInventory() {
  const items = [
    ['20261025011000', 'creator_premium_f3_bounded_financial_activation'],
    ['20261025160452', 'creator_premium_f3_c2_isolated_canary_governance'],
    ['20261026030000', 'creator_premium_f4_general_bdag_activation'],
    ['20261026072512', 'creator_premium_f5_autonomous_subscriptions'],
    ['20261027002243', 'stories_v2_interactive_b1'],
    ['20261027191918', 'stories_v2_safety_c2_publish_first_async_review'],
    ['20261029042807', 'stories_v2_qa_c1_question_answer_authority'],
    ['20261031020113', 'superuser_control_center_mfa_aal2'],
    ['20261031025722', 'superuser_control_center_cursor_terminal_truth'],
    ['20261031032022', 'superuser_control_center_overview'],
    ['20261101181907', 'superuser_qa_perf_c1'],
    ['20261102065812', 'web_control_centers_b1_publication_drafts'],
  ].map(([version, name]) => ({ version, name }));
  return {
    complete: true,
    count: items.length,
    items,
    latest: items.at(-1),
    sha256: '0'.repeat(64),
  };
}

test('QA-C3 policy and compiler pin one exact migration and one RPC replacement', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const transition = policy.web_control_centers_b1_qa_c3_transition;
  assert.ok(transition, 'QA-C3 transition missing');
  assert.deepEqual(compiler.WEB_CONTROL_CENTERS_B1_QA_C3_RELEASE_TRANSITION, transition);
  assert.equal(transition.from_phase, 'web_control_centers_b1');
  assert.equal(transition.to_phase, 'web_control_centers_b1_qa_c3');
  assert.equal(transition.reviewed_source_sha, reviewedSourceSha);
  assert.deepEqual(transition.productive_paths, [migrationPath]);
  assert.deepEqual(transition.functions, []);
  assert.equal(transition.config_changed, false);
  assert.equal(transition.migrations.length, 1);
  assert.deepEqual(transition.migrations[0], {
    version: '20261107053930',
    path: migrationPath,
    blob: '94344ab595e4a648211a5adeca92be80e265edc9',
    sha256: 'b43f61a88f32325f71d5d8d13ef1455834c494eb2402277f29c224c6c440b378',
    byte_length: 1271,
  });
  assert.equal(transition.rpc_replacement.predecessor.identity, targetIdentity);
  assert.equal(
    transition.rpc_replacement.predecessor.definition_sha256,
    predecessorDefinition,
  );
  assert.equal(transition.rpc_replacement.successor.identity, targetIdentity);
  assert.equal(
    transition.rpc_replacement.successor.definition_sha256,
    successorDefinition,
  );
  assert.equal(
    policy.web_control_centers_b1_transition.rpc_attestations.find(
      item => item.identity === targetIdentity,
    ).definition_sha256,
    predecessorDefinition,
    'historical B1 authority must remain immutable',
  );
});

test('QA-C3 policy rejects migration, RPC, Advisor, Edge, config and finance drift', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const mutations = [
    value => { value.migrations[0].sha256 = '1'.repeat(64); },
    value => { value.rpc_replacement.predecessor.definition_sha256 = '1'.repeat(64); },
    value => { value.rpc_replacement.successor.definition_sha256 = '1'.repeat(64); },
    value => { value.security_advisor.replacement_exception.attestation.definition_sha256 = '1'.repeat(64); },
    value => { value.functions = ['content-safety-scan']; },
    value => { value.config_changed = true; },
    value => { value.finance_policy.platform_fee_bps = 0; },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(policy);
    mutate(hostile.web_control_centers_b1_qa_c3_transition);
    assert.throws(
      () => compiler.validatePolicy(hostile),
      error => error?.code === 'INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION',
    );
  }
});

test('QA-C3 compiler binds reviewed Git-LF bytes and exact one-migration closure', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const historicalPolicy = withPreQaC3Baseline(policy);
  const transition = historicalPolicy.web_control_centers_b1_qa_c3_transition;
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const input = {
    cwd: root,
    policy: historicalPolicy,
    mode: 'plan_only',
    approvedSha: reviewedSourceSha,
    changes: [{ path: migrationPath, status: 'A' }],
    migrations: [{ version: '20261107053930', path: migrationPath }],
    affectedFunctions: [],
    runGit,
  };
  const result = compiler.attestWebControlCentersB1QaC3Transition(input);
  assert.equal(result.attestation.reviewed_source_sha, reviewedSourceSha);
  assert.equal(result.attestation.reviewed_bytes_verified, true);
  assert.equal(result.migrations[0].blob, transition.migrations[0].blob);
  assert.throws(
    () => compiler.attestWebControlCentersB1QaC3Transition({
      ...input,
      runGit: args => args[0] === 'show'
        ? Buffer.from('altered migration bytes\n')
        : runGit(args),
    }),
    error => error?.code === 'INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION',
  );
});

test('QA-C3 compiler accepts the exact protected rebase result on main', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const historicalPolicy = withPreQaC3Baseline(policy);
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const result = compiler.attestWebControlCentersB1QaC3Transition({
    cwd: root,
    policy: historicalPolicy,
    mode: 'plan_only',
    approvedSha: integratedMainSha,
    changes: [{ path: migrationPath, status: 'A' }],
    migrations: [{ version: '20261107053930', path: migrationPath }],
    affectedFunctions: [],
    runGit,
  });
  assert.equal(result.attestation.approved_sha, integratedMainSha);
  assert.equal(result.attestation.reviewed_source_descendant_verified, true);
  assert.equal(result.attestation.reviewed_bytes_verified, true);
});

test('QA-C3 manifest exposes only the exact migration and transition attestation', async () => {
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const historicalPolicy = withPreQaC3Baseline(policy);
  const transition = historicalPolicy.web_control_centers_b1_qa_c3_transition;
  const attestation = {
    ...structuredClone(transition),
    approved_sha: reviewedSourceSha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
    reviewed_bytes_verified: true,
  };
  const migration = {
    version: transition.migrations[0].version,
    path: transition.migrations[0].path,
    blob: transition.migrations[0].blob,
    sha256: transition.migrations[0].sha256,
  };
  const change = { status: 'A', path: migration.path, fileType: 'file' };
  const input = {
    request: {
      actor: 'andressan101989', triggeringActor: 'andressan101989',
      repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
      workflowRef: 'andressan101989/ClipDAG-9bh0w4-26004-20260525/.github/workflows/nelyon-production-release.yml@refs/heads/main',
      ref: 'refs/heads/main', approvedSha: reviewedSourceSha, mainSha: reviewedSourceSha,
      releaseId: 'web-control-centers-b1-qa-c3-plan-test', mode: 'plan_only',
      scopeConfirmation: 'PLAN_ONLY', runId: '1', runAttempt: 1,
    },
    policy: historicalPolicy,
    gitState: {
      baselineSha: transition.baseline_sha,
      approvedSha: reviewedSourceSha,
      originMainSha: reviewedSourceSha,
      changes: [change],
    },
    classified: {
      all: [change], config: [], functions: [], governance: [],
      migrations: [change], other: [], productive: [change], shared: [],
    },
    migrations: [migration],
    affectedFunctions: [],
    functionContracts: [],
    webControlCentersB1QaC3Transition: attestation,
    reproducibility: { allowed: true, blockedFunctions: [], findings: [] },
    risk: { level: 'HIGH', findings: [] },
    compiler: {
      path: 'scripts/nelyon-production-release.mjs', sha256: 'a'.repeat(64),
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: 'b'.repeat(64),
    },
    generatedAt: '2026-11-07T00:00:00.000Z',
  };
  const manifest = compiler.buildManifest(input);
  assert.deepEqual(manifest.resources.migrations, [migration]);
  assert.deepEqual(manifest.resources.functions, []);
  assert.equal(manifest.resources.config_changed, false);
  assert.deepEqual(manifest.resources.web_control_centers_b1_qa_c3_transition, attestation);
  assert.equal(manifest.result, 'PLAN READY');
  assert.throws(
    () => compiler.buildManifest({ ...input, affectedFunctions: ['content-safety-scan'] }),
    error => error?.code === 'FUNCTION_CONTRACT_MISMATCH',
  );
});

test('QA-C3 snapshot contract proves the exact predecessor and successor definitions', async () => {
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  const transition = policy.web_control_centers_b1_qa_c3_transition;
  assert.equal(
    adapter.assertReadOnlySql(adapter.WEB_CONTROL_CENTERS_B1_QA_C3_STATE_SQL),
    true,
  );
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_QA_C3_STATE_SQL, /pg_get_functiondef/);
  assert.match(adapter.WEB_CONTROL_CENTERS_B1_QA_C3_STATE_SQL, /definition_sha256/);
  assert.equal(
    adapter.validateWebControlCentersB1QaC3StateTransition(
      rpcState(transition.rpc_replacement.predecessor),
      rpcState(transition.rpc_replacement.successor),
      transition,
    ),
    true,
  );
  const hostile = rpcState(transition.rpc_replacement.successor);
  hostile.function.execute.anon = true;
  assert.throws(
    () => adapter.validateWebControlCentersB1QaC3StateTransition(
      rpcState(transition.rpc_replacement.predecessor),
      hostile,
      transition,
    ),
    error => error?.code === 'WEB_CONTROL_CENTERS_B1_QA_C3_POSTCHECK_FAILED',
  );
});

test('QA-C3 Advisor authority swaps only the target definition after migration', async () => {
  const adapter = await load('scripts/nelyon-production-snapshot-adapter.mjs');
  const compiler = await load('scripts/nelyon-production-release.mjs');
  const historicalPolicy = withPreQaC3Baseline(policy);
  const transition = historicalPolicy.web_control_centers_b1_qa_c3_transition;
  const manifest = {
    identity: { approved_sha: reviewedSourceSha },
    resources: {
      migrations: transition.migrations,
      web_control_centers_b1_qa_c3_transition: {
        ...structuredClone(transition),
        approved_sha: reviewedSourceSha,
        baseline_descendant_verified: true,
        integration_base_descendant_verified: true,
        reviewed_source_descendant_verified: true,
        reviewed_bytes_verified: true,
      },
    },
  };
  const preMigrations = installedMigrationInventory();
  preMigrations.sha256 = compiler.sha256Hex(compiler.canonicalJson(preMigrations.items));
  const context = { migrations: preMigrations };
  const before = adapter.advisorExceptionsForPhase(historicalPolicy, manifest, 'pre', context);
  const postMigrations = installedMigrationInventory();
  postMigrations.items.push({
    version: '20261107053930',
    name: 'web_control_centers_b1_qa_c3_draft_list_recovery',
  });
  postMigrations.count = postMigrations.items.length;
  postMigrations.latest = postMigrations.items.at(-1);
  postMigrations.sha256 = compiler.sha256Hex(compiler.canonicalJson(postMigrations.items));
  const after = adapter.advisorExceptionsForPhase(historicalPolicy, manifest, 'post', {
    migrations: postMigrations,
  });
  const fingerprint = transition.security_advisor.replacement_exception.advisor_fingerprint;
  assert.equal(
    before.find(item => item.advisor_fingerprint === fingerprint).attestation.definition_sha256,
    predecessorDefinition,
  );
  assert.equal(
    after.find(item => item.advisor_fingerprint === fingerprint).attestation.definition_sha256,
    successorDefinition,
  );
  assert.equal(before.length, after.length, 'definition replacement must not add an Advisor finding');
});
