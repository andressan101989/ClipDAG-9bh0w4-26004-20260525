import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

const policyUrl = new URL('../.github/nelyon-production-release-policy.json', import.meta.url);
const gateUrl = new URL('../scripts/nelyon-production-release.mjs', import.meta.url);
const adapterUrl = new URL('../scripts/nelyon-production-snapshot-adapter.mjs', import.meta.url);
const workflowUrl = new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url);
const runbookUrl = new URL('../docs/runbooks/nelyon-production-release.md', import.meta.url);

const OWNER = 'andressan101989';
const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const PROJECT_REF = 'aewwdlvbwpczqyvkwvvj';
const MAIN_SHA = '9d5afa4dd0eb48040a18b40e53e7dec22ecf2f33';
const MANAGED_FUNCTIONS = [
  'agora-token',
  'bdag-ledger',
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
  'video-semantic-index',
  'ads-v2-delivery',
  'ai-handoff',
  'ai-handoff-mcp',
];
const A2_EXCEPTION_FINGERPRINTS = [
  '053c9a441c11dc657382c6448b017d8fcf73c16fb5a3e4baf6275e24e2216129',
  '16793ac45491560ceb15eed84a53c946830aca9f3c1dad338a98e42c539aad18',
  '32e1071c786f8cd3afe8867b7dd583e26420bb55845639a6458f724779e389b0',
  '38f8cee50f0713a548ea30ea5d3d7cb5d9151bd97b4885da47cc2726b83706ca',
  '64e0ec779a8bd54824caf58605677e58ef589a62b2a53e4beb216907d3e002ee',
  '81ffb44830028e3a76316686c2bd2d8f38b4f4b26b7d4f93a3c0c94a168e4852',
  '95f426ce02f0b60b9ac06e78d26d4171ec2d74aef205a06a6bc111142d1a923d',
  'b55221bf7e4ec14f761ca29bc13589854080dccb3049e7dbcd996c37eb7223cf',
  'cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae',
  'ed55682047d682b69c66430b68fc819fb781b7289539fa398fadf09ec0c064fc',
  'f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32',
];
const P3_C2_EXCEPTION_FINGERPRINT = 'b5ca8be9cf9433a21ee7f19906d8a23340ef629d6cedd414c196b431ab5dfaf1';
const F3_FINAL_WALLET_EXCEPTION_FINGERPRINT = 'acc6db2023e39518a9407ac3dada47063023550ae9f275eb058b6f6aff32753e';
const A2_PREEXISTING_FINGERPRINTS = [
  '44c69807ea7e06dadbd8f841ec50a8911c25a76b28ed8096ec6fea66d129b55b',
  '92d3ea284e4ee4c77be88f4a3cade83460caa098dbbc3028587388cf0158933b',
];
const F1_EXCEPTION_FINGERPRINTS = [
  '1c20753b55dcdb2d0a8e6a3365fcf45453495a74a49d76b9b51af4e51d7b923f',
];
const F1_C4_EXCEPTION_FINGERPRINTS = [
  '5ceb93fa71004f64ba75a7bd251fadaf66d7ebdce81fb48904fd988ed9023fef',
];
const F2_EXCEPTION_FINGERPRINTS = [
  'b0cdd5e8a440096ebc6bbd35fee9b785180d71ae6d06209ade7feaa6c0877c4d',
  'b835139bebe4b813b730fca29d6eeec2a3e7d70a187e0c36b9169d7e84faba1d',
  'ed55682047d682b69c66430b68fc819fb781b7289539fa398fadf09ec0c064fc',
  'f6c527ed886225b79c3412747e8f8375e7552634febc03b37917123f02649109',
  'f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32',
  'cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae',
];
const F2_MANAGED_SCOPE_TRANSITION = {
  id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
  state: 'attested_one_time',
  resource: 'bdag-ledger',
  from_classification: 'unmanaged',
  to_classification: 'managed',
  baseline_sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
  attested_source_sha: '97f6638acaa5be2af336b427184c11185e3d0fe1',
  migration: '20261024173500_creator_premium_f2_complete_monetization',
  migration_blob: 'fce8789a0c79251afbe962bd39f6bd81ae248296',
  function_source_sha256: '06a7f77242df926411f7aae44eb808f8bb1ce1e88b8a342376911f1e6519e8fa',
  finance_off_required: true,
  requires_postcheck: true,
  requires_separate_baseline_promotion: true,
};
const P2_RELATION_ADVISOR_FINGERPRINT = '8088d6be7ca6bd32b041ed429091a56f26d26ac0d7148eb5bf15f9e3c5e70bd6';

const STORIES_B1_MIGRATION_PATH =
  'supabase/migrations/20261027042552_stories_v2_interactive_b1.sql';
const STORIES_B1_FUNCTIONS = [
  'cleanup-stale-media-uploads',
  'content-safety-scan',
  'create-media-upload',
  'create-stream-upload',
  'get-stream-playback',
  'stream-webhook',
];
const STORIES_SAFETY_C1_MIGRATION_PATH =
  'supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql';
const STORIES_SAFETY_C1_ARTIFACT_PATH =
  'docs/stories-v2-content-safety-policy-candidate-v1.json';
const STORIES_QA_C1_MIGRATION_PATH =
  'supabase/migrations/20261029042807_stories_v2_qa_c1_question_answer_authority.sql';
const CONTROL_CENTER_MIGRATION_PATHS = [
  'supabase/migrations/20261031020113_superuser_control_center_mfa_aal2.sql',
  'supabase/migrations/20261031025722_superuser_control_center_cursor_terminal_truth.sql',
  'supabase/migrations/20261031032022_superuser_control_center_overview.sql',
];
const SUPERUSER_QA_PERF_C1_MIGRATION_PATHS = [
  'supabase/migrations/20261101181907_superuser_qa_perf_c1.sql',
];
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('Superuser QA PERF C1 policy freezes one managed-cron-safe migration, bounded truth, RPC security, and Finance GENERAL', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_qa_perf_c1_transition;
  assert.deepEqual(transition, gate.SUPERUSER_QA_PERF_C1_RELEASE_TRANSITION);
  assert.deepEqual(transition.migrations.map(item => ({
    path: item.path, blob: item.blob, sha256: item.sha256, byte_length: item.byte_length,
  })), [
    { path: SUPERUSER_QA_PERF_C1_MIGRATION_PATHS[0], blob: '005c6cbbf1539611ecb0b8f2255bdf3be44f32a6',
      sha256: '70c7d77bb0a2cb11287b4d0f0feba3f158e3ae3f749e7fa7ec15fb071a7fff07', byte_length: 10759 },
  ]);
  assert.deepEqual(transition.productive_paths, SUPERUSER_QA_PERF_C1_MIGRATION_PATHS);
  assert.deepEqual(transition.functions, []);
  assert.equal(transition.config_changed, false);
  assert.deepEqual(transition.cron_history_attestation, {
    schema: 'cron', table: 'job_run_details', relation_kind: 'r',
    schema_owner: 'supabase_admin', table_owner: 'supabase_admin', extension: 'pg_cron',
    primary_index: { name: 'job_run_details_pkey', key_columns: ['runid'], included_columns: [],
      primary: true, unique: true, valid: true, ready: true,
      predicate: false, expressions: false },
    release_index_name: 'cron_job_run_details_start_job_cover_idx', release_index_expected: false,
    release_mutation: 'forbidden',
    metrics_contract: { probe_order: ['runid'], probe_direction: 'desc', probe_limit: 50000,
      complete_only_when_unsaturated: true, exact_only_when_complete: true,
      unavailable_reason: 'history_probe_limit_reached', unavailable_value: null },
  });
  assert.equal(transition.function_definitions.length, 2);
  assert.equal(transition.predecessor_functions.length, 2);
  assert.deepEqual(transition.pre_snapshot_recovery, {
    migration_inventory: 'baseline_without_c1',
    accepted_states: [
      { functions: 'predecessor', cron_history: 'exact_extension_owned', release_index: 'absent' },
    ],
    finance_policy_exact: true,
    mixed_function_catalog_rejected: true,
  });
  assert.deepEqual(transition.finance_policy,
    { platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true, subscription_enabled: true });
  assert.equal(gate.validatePolicy(policy), true);
  for (const mutate of [
    value => { value.migrations[0].sha256 = '0'.repeat(64); },
    value => { value.migrations.pop(); },
    value => { value.productive_paths.push('supabase/functions/admin-user-moderation/index.ts'); },
    value => { value.functions.push('admin-user-moderation'); },
    value => { value.cron_history_attestation.schema_owner = 'postgres'; },
    value => { value.cron_history_attestation.table_owner = 'postgres'; },
    value => { value.cron_history_attestation.extension = 'other'; },
    value => { value.cron_history_attestation.primary_index.name = 'other'; },
    value => { value.cron_history_attestation.primary_index.key_columns = ['start_time']; },
    value => { value.cron_history_attestation.primary_index.included_columns = ['status']; },
    value => { value.cron_history_attestation.primary_index.primary = false; },
    value => { value.cron_history_attestation.primary_index.unique = false; },
    value => { value.cron_history_attestation.primary_index.valid = false; },
    value => { value.cron_history_attestation.primary_index.ready = false; },
    value => { value.cron_history_attestation.primary_index.predicate = true; },
    value => { value.cron_history_attestation.primary_index.expressions = true; },
    value => { value.cron_history_attestation.release_index_expected = true; },
    value => { value.cron_history_attestation.release_mutation = 'allowed'; },
    value => { value.cron_history_attestation.metrics_contract.probe_limit = 100000; },
    value => { value.cron_history_attestation.metrics_contract.probe_order = ['start_time']; },
    value => { value.cron_history_attestation.metrics_contract.probe_direction = 'asc'; },
    value => { value.cron_history_attestation.metrics_contract.complete_only_when_unsaturated = false; },
    value => { value.cron_history_attestation.metrics_contract.exact_only_when_complete = false; },
    value => { value.cron_history_attestation.metrics_contract.unavailable_reason = 'other'; },
    value => { value.function_definitions[0].definition_sha256 = '0'.repeat(64); },
    value => { value.function_definitions[1].definition_sha256 = '0'.repeat(64); },
    value => { value.pre_snapshot_recovery.accepted_states.pop(); },
    value => { value.function_definitions[0].owner = 'authenticated'; },
    value => { value.function_definitions[1].security_definer = false; },
    value => { value.function_definitions[1].search_path.pop(); },
    value => { value.function_definitions[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.function_definitions[1].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.finance_policy.platform_fee_bps = 0; },
  ]) {
    const hostile = structuredClone(policy);
    mutate(hostile.superuser_qa_perf_c1_transition);
    assertDenied(() => gate.validatePolicy(hostile), 'INVALID_SUPERUSER_QA_PERF_C1_TRANSITION');
  }
});

test('Superuser QA PERF C1 Git attestation binds exact LF bytes, ancestry, and one-path Supabase closure', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_qa_perf_c1_transition;
  const approvedSha = 'c'.repeat(40);
  const changes = transition.productive_paths.map(path => ({ path, status: 'A' }));
  const root = new URL('..', import.meta.url);
  const bytesByPath = new Map(transition.migrations.map(source => [
    source.path,
    execFileSync('git', ['show', `HEAD:${source.path}`], { cwd: root }),
  ]));
  const runGit = args => {
    if (args[0] === 'cat-file' && args[1] === '-e' && args[2] === `${approvedSha}^{commit}`) return '';
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
    if (args[0] === 'rev-parse' && args[1]?.startsWith(`${approvedSha}:`)) {
      const path = args[1].slice(41);
      return `${transition.migrations.find(item => item.path === path)?.blob ?? ''}\n`;
    }
    if (args[0] === 'ls-tree' && args[2] === approvedSha) {
      const path = args[4];
      const source = transition.migrations.find(item => item.path === path);
      return source ? Buffer.from(`100644 blob ${source.blob}\t${path}\0`) : Buffer.alloc(0);
    }
    if (args[0] === 'show' && args[1]?.startsWith(`${approvedSha}:`)) {
      return bytesByPath.get(args[1].slice(41));
    }
    if (args[0] === 'diff' && args.includes(approvedSha)) {
      return Buffer.from(`${transition.productive_paths.map(path => `A\0${path}`).join('\0')}\0`);
    }
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const input = {
    cwd: root,
    policy,
    mode: 'plan_only',
    approvedSha,
    changes,
    migrations: transition.migrations.map(item => ({ path: item.path, version: item.version })),
    affectedFunctions: [],
    runGit,
  };
  const attested = gate.attestSuperuserQaPerfC1Transition(input);
  assert.equal(attested.attestation.reviewed_bytes_verified, true);
  assert.deepEqual(attested.migrations.map(item => ({
    path: item.path, blob: item.blob, sha256: item.sha256,
  })), transition.migrations.map(item => ({
    path: item.path, blob: item.blob, sha256: item.sha256,
  })));
  for (const source of transition.migrations) {
    const bytes = bytesByPath.get(source.path);
    assert.equal(bytes.includes(13), false);
    assert.equal(bytes.byteLength, source.byte_length);
    assert.equal(sha256(bytes), source.sha256);
  }
  for (const mutateGit of [
    (args, fallback) => args[0] === 'show' && args[1] === `${approvedSha}:${transition.migrations[0].path}`
      ? Buffer.from('altered\n') : fallback(args),
    (args, fallback) => args[0] === 'rev-parse' && args[1] === `${approvedSha}:${transition.migrations[0].path}`
      ? `${'0'.repeat(40)}\n` : fallback(args),
    (args, fallback) => args[0] === 'diff' && args.includes(approvedSha)
      ? Buffer.from(`${transition.productive_paths.map(path => `A\0${path}`).join('\0')}\0A\0supabase/config.toml\0`)
      : fallback(args),
  ]) {
    assertDenied(() => gate.attestSuperuserQaPerfC1Transition({
      ...input,
      runGit: args => mutateGit(args, runGit),
    }), 'INVALID_SUPERUSER_QA_PERF_C1_TRANSITION');
  }
});

test('Superuser QA PERF C1 manifest permits exactly one migration and no Edge or config expansion', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_qa_perf_c1_transition;
  const approvedSha = 'c'.repeat(40);
  const adminPaths = [
    'apps/admin-web/src/lib/adminControlCenterApi.ts',
    'apps/admin-web/src/pages/AdminOverviewPage.tsx',
    'apps/admin-web/src/tests/adminControlCenterApi.test.ts',
    'apps/admin-web/src/tests/adminExecutiveDashboard.test.tsx',
  ];
  const changes = [
    ...transition.productive_paths.map(path => ({ status: 'A', path, fileType: 'file' })),
    ...adminPaths.map(path => ({ status: 'M', path, fileType: 'file' })),
  ];
  const attestation = { ...structuredClone(transition), approved_sha: approvedSha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_bytes_verified: true };
  const input = manifestInput(policy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified: gate.classifyChangedPaths(changes),
    migrations: transition.migrations.map(item => ({ version: item.version, path: item.path,
      blob: item.blob, sha256: item.sha256 })),
    affectedFunctions: [], functionContracts: [], superuserQaPerfC1Transition: attestation,
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'PLAN READY');
  assert.equal(manifest.risk.level, 'HIGH');
  assert.deepEqual(manifest.resources.superuser_qa_perf_c1_transition, attestation);
  assert.deepEqual(manifest.resources.functions, []);
  assert.equal(manifest.resources.config_changed, false);
  const adminRelease = await import('../scripts/nelyon-admin-production-release.mjs');
  const adminManifest = adminRelease.buildAdminSourceManifest({
    approvedSha,
    releaseManifest: manifest,
    readTrackedFiles: () => [{ path: 'apps/admin-web/package.json', bytes: Buffer.from('{}\n') }],
  });
  assert.equal(adminManifest.enabled, true);
  assert.deepEqual(adminManifest.release.changed_admin_paths, adminPaths);
  for (const mutate of [
    value => { value.superuserQaPerfC1Transition = null; },
    value => { value.migrations[0].sha256 = '0'.repeat(64); },
    value => { value.migrations.pop(); },
    value => { value.classified.config.push({ path: 'supabase/config.toml' }); },
    value => { value.classified.productive.push({ path: 'supabase/functions/admin-user-moderation/index.ts' }); },
    value => { value.affectedFunctions = ['admin-user-moderation']; },
    value => { value.gitState.originMainSha = '0'.repeat(40); },
  ]) {
    const hostile = structuredClone(input); mutate(hostile);
    assertDenied(() => gate.buildManifest(hostile),
      hostile.affectedFunctions.length ? 'FUNCTION_CONTRACT_MISMATCH' : 'INVALID_SUPERUSER_QA_PERF_C1_TRANSITION');
  }
});

test('Control Center policy freezes exactly three migration-only resources and reviewed authorities', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_control_center_transition;
  assert.deepEqual(transition, gate.SUPERUSER_CONTROL_CENTER_RELEASE_TRANSITION);
  assert.deepEqual(transition.migrations.map(item => ({
    path: item.path, blob: item.blob, sha256: item.sha256, byte_length: item.byte_length,
  })), [
    { path: CONTROL_CENTER_MIGRATION_PATHS[0], blob: '5452895cfd473513e99e15e35bff948a74080f44',
      sha256: '6cc83d43fdb2a8bc22990a04fd237342c92967b83318d6fa6addba8d270ce3c2', byte_length: 6839 },
    { path: CONTROL_CENTER_MIGRATION_PATHS[1], blob: '91e75126f636ac8f83d9e73798c66dac58d72608',
      sha256: 'd26c790a5ddc9aea14b72cd3c64810d49298f67c41db12ba6418ae00b141d3f9', byte_length: 15456 },
    { path: CONTROL_CENTER_MIGRATION_PATHS[2], blob: '9a2c821a314d7c6039ec31f534712784a94089e3',
      sha256: 'dbef7f15d6caefa536fd81391154107503b01b16b93fbd69a5fb5e54d30c1bd6', byte_length: 20968 },
  ]);
  assert.deepEqual(transition.productive_paths, CONTROL_CENTER_MIGRATION_PATHS);
  assert.deepEqual(transition.functions, []);
  assert.equal(transition.config_changed, false);
  assert.equal(transition.required_aal_catalog.capability_count, 54);
  assert.equal(transition.required_aal_catalog.aal2_codes.length, 23);
  assert.deepEqual(transition.required_aal_catalog.refund_roles, ['SUPER_ADMIN']);
  assert.equal(transition.function_definitions.length, 10);
  assert.equal(transition.removed_functions[0], 'public.search_admin_advertising_ads(text,integer)');
  assert.equal(transition.index_attestation.valid, true);
  assert.equal(transition.index_attestation.ready, true);
  assert.equal(Object.hasOwn(transition.index_attestation, 'production_cardinality'), false);
  assert.equal(Object.hasOwn(transition.index_attestation, 'production_relation_bytes'), false);
  assert.deepEqual(transition.index_attestation.plan, {
    access_method: 'btree', key_columns: ['submitted_at', 'id'],
    probe_order: ['submitted_at', 'id'], probe_limit: 1001,
    create_mode: 'nonconcurrent', lock_mode: 'SHARE',
  });
  assert.deepEqual(transition.bounded_postcheck.resources,
    ['auth.mfa_factors', 'private.admin_action_audit', 'private.advertising_ads']);
  assert.equal(transition.bounded_postcheck.finance_authority,
    'canonical_finance_snapshot_and_reconciliation');
  assert.equal(transition.bounded_postcheck.advertising_ads_probe_must_not_saturate, true);
  assert.equal(Object.hasOwn(transition, 'unchanged_inventories'), false);
  assert.deepEqual(transition.security_advisor.transition, {
    before_count: 597,
    before_sha256: 'd0e52c1a329d52b48f9926d4355e2cf2247e8463e6fcf683b63150fb251c2eee',
    after_count: 598,
    after_sha256: '21e73c054d9e2ba1de93ebda2b4c423f3d1b9c7f97a857478ab175d1a5de8dae',
  });
  assert.equal(gate.validatePolicy(policy), true);
  for (const mutate of [
    value => { value.migrations[0].sha256 = '0'.repeat(64); },
    value => { value.migrations.push(structuredClone(value.migrations[0])); },
    value => { value.productive_paths.push('supabase/config.toml'); },
    value => { value.functions.push('admin-user-moderation'); },
    value => { value.required_aal_catalog.aal2_codes.pop(); },
    value => { value.required_aal_catalog.refund_roles.push('PLATFORM_ADMIN'); },
    value => { value.function_definitions[0].definition_sha256 = '0'.repeat(64); },
    value => { value.function_definitions[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.index_attestation.ready = false; },
    value => { value.security_advisor.introduced_exceptions.pop(); },
    value => { value.security_advisor.transition.after_sha256 = '0'.repeat(64); },
  ]) {
    const hostile = structuredClone(policy);
    mutate(hostile.superuser_control_center_transition);
    assertDenied(() => gate.validatePolicy(hostile), 'INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION');
  }
});

test('Control Center Git attestation binds exact LF bytes, ancestry, and three-path Supabase closure', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_control_center_transition;
  const preControlCenterPolicy = structuredClone(policy);
  preControlCenterPolicy.baseline.sha = transition.baseline_sha;
  preControlCenterPolicy.baseline.migration_count = 361;
  preControlCenterPolicy.baseline.latest_migration =
    '20261029042807_stories_v2_qa_c1_question_answer_authority';
  const root = new URL('..', import.meta.url);
  const runGit = args => execFileSync('git', args, { cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const approvedSha = transition.reviewed_source_sha;
  const changes = transition.productive_paths.map(path => ({ path, status: 'A' }));
  const result = gate.attestSuperuserControlCenterTransition({
    cwd: root, policy: preControlCenterPolicy, mode: 'plan_only', approvedSha, changes,
    migrations: transition.migrations.map(item => ({ path: item.path, version: item.version })),
    affectedFunctions: [], runGit,
  });
  assert.equal(result.attestation.reviewed_bytes_verified, true);
  assert.equal(Object.hasOwn(result.attestation, 'reviewed_source_descendant_verified'), false);
  assert.deepEqual(result.migrations.map(item => ({ path: item.path, blob: item.blob, sha256: item.sha256 })),
    transition.migrations.map(item => ({ path: item.path, blob: item.blob, sha256: item.sha256 })));
  for (const source of transition.migrations) {
    const bytes = execFileSync('git', ['show', `${approvedSha}:${source.path}`], { cwd: root });
    assert.equal(bytes.includes(13), false);
    assert.equal(bytes.byteLength, source.byte_length);
    assert.equal(sha256(bytes), source.sha256);
  }
  for (const hostile of [
    { migrations: transition.migrations.slice(0, 2).map(item => ({ path: item.path, version: item.version })) },
    { affectedFunctions: ['admin-user-moderation'] },
    { changes: [...changes, { path: 'supabase/config.toml', status: 'M' }] },
    { approvedSha: '0'.repeat(40) },
  ]) {
    assertDenied(() => gate.attestSuperuserControlCenterTransition({
      cwd: root, policy: preControlCenterPolicy, mode: 'plan_only', approvedSha, changes,
      migrations: transition.migrations.map(item => ({ path: item.path, version: item.version })),
      affectedFunctions: [], runGit, ...hostile,
    }), 'INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION');
  }
  const alteredBytes = args => args[0] === 'show'
    && args[1] === `${approvedSha}:${transition.migrations[0].path}`
    ? Buffer.from('altered\n') : runGit(args);
  assertDenied(() => gate.attestSuperuserControlCenterTransition({
    cwd: root, policy: preControlCenterPolicy, mode: 'plan_only', approvedSha, changes,
    migrations: transition.migrations.map(item => ({ path: item.path, version: item.version })),
    affectedFunctions: [], runGit: alteredBytes,
  }), 'INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION');

  const rebasedSha = 'e'.repeat(40);
  let reviewedAncestryAttempted = false;
  const rebasedRunGit = args => {
    if (['rev-parse', 'show', 'ls-tree', 'cat-file'].includes(args[0])
      && args.some(value => typeof value === 'string' && value.startsWith(transition.reviewed_source_sha))) {
      throw new Error('reviewed branch object is unavailable after protected rebase merge');
    }
    if (args[0] === 'cat-file' && args[2] === `${rebasedSha}^{commit}`) return '';
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (args[2] === transition.reviewed_source_sha && args[3] === rebasedSha) {
        reviewedAncestryAttempted = true;
        throw new Error('reviewed branch commit is intentionally not an ancestor after rebase merge');
      }
      if (args[2] === transition.integration_base_sha && args[3] === rebasedSha) return '';
    }
    if (args[0] === 'rev-parse' && args[1]?.startsWith(`${rebasedSha}:`)) {
      return runGit(['rev-parse', `${transition.reviewed_source_sha}:${args[1].slice(41)}`]);
    }
    if (args[0] === 'show' && args[1]?.startsWith(`${rebasedSha}:`)) {
      return runGit(['show', `${transition.reviewed_source_sha}:${args[1].slice(41)}`]);
    }
    if (args[0] === 'ls-tree' && args[2] === rebasedSha) {
      return runGit(['ls-tree', '-z', transition.reviewed_source_sha, '--', args[4]]);
    }
    if (args[0] === 'diff' && args.includes(rebasedSha)) {
      return Buffer.from(`${transition.productive_paths.map(path => `A\0${path}`).join('\0')}\0`);
    }
    return runGit(args);
  };
  const rebased = gate.attestSuperuserControlCenterTransition({
    cwd: root, policy: preControlCenterPolicy, mode: 'plan_only', approvedSha: rebasedSha, changes,
    migrations: transition.migrations.map(item => ({ path: item.path, version: item.version })),
    affectedFunctions: [], runGit: rebasedRunGit,
  });
  assert.equal(rebased.attestation.approved_sha, rebasedSha);
  assert.equal(rebased.attestation.reviewed_bytes_verified, true);
  assert.equal(reviewedAncestryAttempted, false);
});

test('Control Center manifest permits exactly three frozen migrations and zero Edge or config resources', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.superuser_control_center_transition;
  const preControlCenterPolicy = structuredClone(policy);
  preControlCenterPolicy.baseline.sha = transition.baseline_sha;
  preControlCenterPolicy.baseline.migration_count = 361;
  preControlCenterPolicy.baseline.latest_migration =
    '20261029042807_stories_v2_qa_c1_question_answer_authority';
  const approvedSha = 'd'.repeat(40);
  const changes = transition.productive_paths.map(path => ({ status: 'A', path, fileType: 'file' }));
  const attestation = { ...structuredClone(transition), approved_sha: approvedSha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_bytes_verified: true };
  const input = manifestInput(preControlCenterPolicy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified: gate.classifyChangedPaths(changes),
    migrations: transition.migrations.map(item => ({ version: item.path.split('/').at(-1).slice(0, 14),
      path: item.path, blob: item.blob, sha256: item.sha256 })),
    affectedFunctions: [], functionContracts: [], superuserControlCenterTransition: attestation,
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'PLAN READY');
  assert.equal(manifest.risk.level, 'HIGH');
  assert.deepEqual(manifest.resources.superuser_control_center_transition, attestation);
  assert.deepEqual(manifest.resources.functions, []);
  assert.equal(manifest.resources.config_changed, false);
  for (const mutate of [
    value => { value.superuserControlCenterTransition = null; },
    value => { value.migrations[1].sha256 = '0'.repeat(64); },
    value => { value.migrations.pop(); },
    value => { value.classified.config.push({ path: 'supabase/config.toml' }); },
    value => { value.classified.productive.push({ path: 'supabase/functions/admin-user-moderation/index.ts' }); },
    value => { value.affectedFunctions = ['admin-user-moderation']; },
    value => { value.gitState.originMainSha = '0'.repeat(40); },
  ]) {
    const hostile = structuredClone(input); mutate(hostile);
    assertDenied(() => gate.buildManifest(hostile),
      hostile.affectedFunctions.length ? 'FUNCTION_CONTRACT_MISMATCH' : 'INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION');
  }
});

test('Stories B1 policy binds one migration, six Edge contracts, and fail-closed non-activation', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.deepEqual(policy.stories_b1_transition, gate.STORIES_B1_RELEASE_TRANSITION);
  assert.deepEqual(policy.stories_b1_transition.functions.map(item => item.name), STORIES_B1_FUNCTIONS);
  assert.equal(policy.stories_b1_transition.migration_path, STORIES_B1_MIGRATION_PATH);
  assert.equal(policy.stories_b1_transition.security_advisor.introduced_exceptions.length, 15);
  assert.equal(policy.stories_b1_transition.security_advisor.removed_findings.length, 2);
  assert.equal(new Set(policy.stories_b1_transition.security_advisor.introduced_exceptions
    .map(item => item.advisor_fingerprint)).size, 15);
  assert.deepEqual(policy.stories_b1_transition.security_advisor.removed_findings.map(item => ({
    fingerprint: item.fingerprint,
    level: item.level,
    resource_kind: item.resource_kind,
    old_language: item.object.old_language,
    replacement_language: item.replacement.language,
  })), [
    {
      fingerprint: '9b4cde0225530c588b9832739ad2b8a131ef6f4b408cdd760da9301deda6c000',
      level: 'WARN',
      resource_kind: 'authenticated_security_definer_function_executable',
      old_language: 'sql',
      replacement_language: 'plpgsql',
    },
    {
      fingerprint: 'bd8275738ba7f668dc16573d7454a0f722d3507bbc196c3aa0a6f30dcaf87f01',
      level: 'WARN',
      resource_kind: 'authenticated_security_definer_function_executable',
      old_language: 'sql',
      replacement_language: 'plpgsql',
    },
  ]);
  assert.deepEqual(policy.stories_b1_transition.safety, {
    activation: false,
    complete_evidence_state: 'review',
    fabricated_pass_allowed: false,
    incomplete_evidence_state: 'pending',
    mode: 'fail_closed_review',
    owner_approved_policy: false,
    physical_readiness_claim_allowed: false,
  });
  assert.equal(gate.validatePolicy(policy), true);

  for (const mutate of [
    candidate => { candidate.safety.owner_approved_policy = true; },
    candidate => { candidate.safety.activation = true; },
    candidate => { candidate.safety.complete_evidence_state = 'passed'; },
    candidate => { candidate.functions.pop(); },
    candidate => { candidate.migration_sha256 = '0'.repeat(64); },
    candidate => { candidate.security_advisor.introduced_exceptions.pop(); },
    candidate => { candidate.security_advisor.introduced_exceptions[0].attestation.owner = 'authenticated'; },
    candidate => { candidate.security_advisor.removed_findings[0].replacement.fingerprint = '0'.repeat(64); },
  ]) {
    const candidate = structuredClone(policy);
    mutate(candidate.stories_b1_transition);
    assertDenied(() => gate.validatePolicy(candidate), 'INVALID_STORIES_B1_TRANSITION');
  }
  const missing = structuredClone(policy);
  delete missing.stories_b1_transition;
  assertDenied(() => gate.validatePolicy(missing), 'INVALID_STORIES_B1_TRANSITION');
});

test('Stories B1 manifest accepts only the exact migration and six graph-derived Edge contracts', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesB1TransitionPolicy(installedPolicy);
  const transition = policy.stories_b1_transition;
  const approvedSha = MAIN_SHA;
  const changes = transition.productive_paths.map(path => ({
    status: path === transition.migration_path ? 'A' : 'M',
    path,
    fileType: 'file',
  }));
  const classified = gate.classifyChangedPaths(changes);
  const storiesB1Transition = {
    ...structuredClone(transition),
    approved_sha: approvedSha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  };
  const functionContracts = transition.functions.map(item => ({
    name: item.name,
    entrypoint: `supabase/functions/${item.name}/index.ts`,
    import_map: null,
    verify_jwt: item.verify_jwt,
    source_changed: true,
    source_files: [{ path: `supabase/functions/${item.name}/index.ts`, sha256: 'a'.repeat(64) }],
    source_sha256: item.source_sha256,
  }));
  const input = manifestInput(policy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified,
    migrations: [{
      version: '20261027042552', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256,
    }],
    affectedFunctions: [...STORIES_B1_FUNCTIONS],
    functionContracts,
    storiesB1Transition,
  });
  const manifest = gate.buildManifest(input);
  assert.deepEqual(manifest.resources.functions, STORIES_B1_FUNCTIONS);
  assert.deepEqual(manifest.resources.stories_b1_transition, storiesB1Transition);
  assert.equal(manifest.resources.migrations.length, 1);
  assert.equal(manifest.result, 'PLAN READY');

  const wrongContract = structuredClone(functionContracts);
  wrongContract[0].source_sha256 = '0'.repeat(64);
  assertDenied(() => gate.buildManifest({ ...input, functionContracts: wrongContract }),
    'INVALID_STORIES_B1_TRANSITION');
  assertDenied(() => gate.buildManifest({ ...input, affectedFunctions: [...STORIES_B1_FUNCTIONS, 'agora-token'] }),
    'FUNCTION_CONTRACT_MISMATCH');
  assertDenied(() => gate.buildManifest({
    ...input,
    storiesB1Transition: { ...storiesB1Transition, migration_sha256: '0'.repeat(64) },
  }), 'INVALID_STORIES_B1_TRANSITION');
});

test('Stories B1 Git attestation rejects altered migration, Edge, config, or Supabase closure', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesB1TransitionPolicy(installedPolicy);
  const transition = policy.stories_b1_transition;
  const root = new URL('..', import.meta.url);
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const approvedSha = transition.reviewed_source_sha;
  const changes = transition.productive_paths.map(path => ({
    path,
    status: path === transition.migration_path ? 'A' : 'M',
  }));
  const input = {
    cwd: root,
    policy,
    mode: 'plan_only',
    approvedSha,
    changes,
    migrations: [{ path: transition.migration_path, version: '20261027042552' }],
    affectedFunctions: [...STORIES_B1_FUNCTIONS],
    runGit,
  };
  const attested = gate.attestStoriesB1Transition(input);
  assert.equal(attested.attestation.approved_sha, approvedSha);
  assert.equal(attested.migrations[0].blob, transition.migration_blob);
  assert.equal(attested.migrations[0].sha256, transition.migration_sha256);

  const alteredRunGit = args => {
    if (args[0] === 'rev-parse' && args[1] === `${approvedSha}:${transition.migration_path}`) {
      return `${'0'.repeat(40)}\n`;
    }
    return runGit(args);
  };
  assertDenied(() => gate.attestStoriesB1Transition({ ...input, runGit: alteredRunGit }),
    'INVALID_STORIES_B1_TRANSITION');
  assertDenied(() => gate.attestStoriesB1Transition({
    ...input,
    changes: [...changes, { path: 'supabase/functions/agora-token/index.ts', status: 'M' }],
  }), 'INVALID_STORIES_B1_TRANSITION');
});

test('Stories B1 phase gate does not reactivate after baseline promotion for an isolated shared Edge change', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_b1_transition;
  const futurePolicy = structuredClone(policy);
  futurePolicy.baseline.sha = 'f'.repeat(40);
  const sharedEdge = transition.functions[0];
  const result = gate.attestStoriesB1Transition({
    cwd: new URL('..', import.meta.url),
    policy: futurePolicy,
    mode: 'plan_only',
    approvedSha: MAIN_SHA,
    changes: [{ path: `supabase/functions/${sharedEdge.name}/index.ts`, status: 'M' }],
    migrations: [],
    affectedFunctions: [sharedEdge.name],
    runGit: () => { throw new Error('historical Stories B1 attestation must not run'); },
  });
  assert.deepEqual(result, { migrations: [], attestation: null });

  const fullScopeWithoutParsedMigration = transition.productive_paths.map(path => ({
    path,
    status: path === transition.migration_path ? 'A' : 'M',
  }));
  const transitionPolicy = asStoriesB1TransitionPolicy(policy);
  assertDenied(() => gate.attestStoriesB1Transition({
    cwd: new URL('..', import.meta.url),
    policy: transitionPolicy,
    mode: 'plan_only',
    approvedSha: MAIN_SHA,
    changes: fullScopeWithoutParsedMigration,
    migrations: [],
    affectedFunctions: [...STORIES_B1_FUNCTIONS],
    runGit: () => { throw new Error('scope validation must fail before Git attestation'); },
  }), 'INVALID_STORIES_B1_TRANSITION');
});

test('Stories Safety C2 policy requires its separate exact publish-first authority', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.ok(policy.stories_safety_c2_transition, 'C2 authority must be present');
  assert.deepEqual(policy.stories_safety_c2_transition, gate.STORIES_SAFETY_C2_RELEASE_TRANSITION);
  assert.equal(policy.stories_safety_c2_transition.from_phase, 'stories_v2_safety_c1_technical_prep_fail_closed');
  assert.equal(policy.stories_safety_c2_transition.to_phase, 'stories_v2_safety_c2_publish_first_async_review');
  assert.equal(policy.stories_safety_c2_transition.baseline_sha, 'e4c7199da157446f455822ea96e812784354b1db');
  assert.deepEqual(policy.stories_safety_c2_transition.functions.map(item => [item.name, item.verify_jwt]),
    [['get-stream-playback', true]]);
  assert.equal(policy.stories_safety_c2_transition.productive_paths.length, 2);
  assert.equal(gate.validatePolicy(policy), true);
  for (const mutate of [
    value => { value.safety.automatic_allow_authorized = true; },
    value => { value.safety.automatic_block_authorized = true; },
    value => { value.safety.mode = 'fail_closed_review'; },
    value => { value.functions.push('content-safety-scan'); },
    value => { value.migration_sha256 = '0'.repeat(64); },
    value => { value.policy_artifact.sha256 = '0'.repeat(64); },
    value => { value.helper_attestations[0].owner = 'authenticated'; },
  ]) {
    const hostile = structuredClone(policy);
    mutate(hostile.stories_safety_c2_transition);
    assertDenied(() => gate.validatePolicy(hostile), 'INVALID_STORIES_SAFETY_C2_TRANSITION');
  }
});

test('Stories Safety C2 manifest binds one migration and the sole admin Stream Edge closure', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesSafetyC2TransitionPolicy(installedPolicy);
  const transition = policy.stories_safety_c2_transition;
  assert.ok(transition, 'C2 authority must be present');
  const approvedSha = 'b'.repeat(40);
  const changes = [
    { status: 'M', path: 'supabase/functions/get-stream-playback/index.ts', fileType: 'file' },
    { status: 'A', path: transition.migration_path, fileType: 'file' },
  ];
  const attestation = { ...structuredClone(transition), approved_sha: approvedSha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true };
  const input = manifestInput(policy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified: gate.classifyChangedPaths(changes),
    migrations: [{ version: '20261027191918', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256 }],
    affectedFunctions: ['get-stream-playback'],
    functionContracts: [{ name: 'get-stream-playback',
      entrypoint: 'supabase/functions/get-stream-playback/index.ts', import_map: null,
      verify_jwt: true, source_changed: true, source_files: [{
        path: 'supabase/functions/get-stream-playback/index.ts', sha256: 'a'.repeat(64),
      }], source_sha256: transition.functions[0].source_sha256 }],
    storiesSafetyC2Transition: attestation,
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'PLAN READY');
  assert.deepEqual(manifest.resources.stories_safety_c2_transition, attestation);
  assert.deepEqual(manifest.resources.functions, ['get-stream-playback']);
  assert.equal(manifest.risk.level, 'HIGH');
  for (const mutate of [
    value => { value.storiesSafetyC2Transition = null; },
    value => { value.migrations[0].sha256 = '0'.repeat(64); },
    value => { value.migrations[0].version = '20261027191919'; },
    value => { value.affectedFunctions = []; value.functionContracts = []; },
    value => { value.functionContracts[0].source_sha256 = '0'.repeat(64); },
    value => { value.functionContracts[0].verify_jwt = false; },
    value => { value.migrations.push({ version: '20261027191919', path: 'supabase/migrations/20261027191919_extra.sql' }); },
    value => { value.classified.config.push({ path: 'supabase/config.toml' }); },
    value => { value.classified.productive.push({ path: 'supabase/functions/content-safety-scan/index.ts' }); },
  ]) {
    const hostile = structuredClone(input);
    mutate(hostile);
    assertDenied(() => gate.buildManifest(hostile), 'INVALID_STORIES_SAFETY_C2_TRANSITION');
  }
});

test('Stories Safety C2 Git attestation binds reviewed policy migration and unchanged scanner bytes', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesSafetyC2TransitionPolicy(installedPolicy);
  const transition = policy.stories_safety_c2_transition;
  assert.ok(transition, 'C2 authority must be present');
  const root = new URL('..', import.meta.url);
  const runGit = args => execFileSync('git', args, { cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const input = { cwd: root, policy, mode: 'plan_only', approvedSha: transition.reviewed_source_sha,
    changes: [{ path: transition.migration_path, status: 'A' },
      { path: 'supabase/functions/get-stream-playback/index.ts', status: 'M' }],
    migrations: [{ path: transition.migration_path, version: '20261027191918' }], affectedFunctions: ['get-stream-playback'], runGit };
  const result = gate.attestStoriesSafetyC2Transition(input);
  assert.equal(result.attestation.reviewed_source_descendant_verified, true);
  assert.equal(result.migrations[0].sha256, transition.migration_sha256);
  for (const path of [...transition.path_attestations.map(item => item.path), transition.policy_artifact.path,
    ...transition.preserved_paths.map(item => item.path)]) {
    const altered = args => args[0] === 'rev-parse' && args[1] === `${input.approvedSha}:${path}`
      ? `${'0'.repeat(40)}\n` : runGit(args);
    assertDenied(() => gate.attestStoriesSafetyC2Transition({ ...input, runGit: altered }), 'INVALID_STORIES_SAFETY_C2_TRANSITION');
  }
  const promoted = structuredClone(policy);
  promoted.baseline.sha = 'c'.repeat(40);
  promoted.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  assert.deepEqual(gate.attestStoriesSafetyC2Transition({ ...input, policy: promoted, migrations: [] }),
    { migrations: [], attestation: null });
  assertDenied(() => gate.attestStoriesSafetyC2Transition({ ...input, policy: promoted }), 'INVALID_STORIES_SAFETY_C2_TRANSITION');
});

test('Stories QA C1 policy adds one exact migration-only successor without weakening C2', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_qa_c1_transition;
  assert.deepEqual(transition, gate.STORIES_QA_C1_RELEASE_TRANSITION);
  assert.deepEqual({
    id: transition.id,
    from_phase: transition.from_phase,
    to_phase: transition.to_phase,
    baseline_sha: transition.baseline_sha,
    reviewed_source_sha: transition.reviewed_source_sha,
    integration_base_sha: transition.integration_base_sha,
    migration_path: transition.migration_path,
    migration_blob: transition.migration_blob,
    migration_sha256: transition.migration_sha256,
    productive_paths: transition.productive_paths,
    functions: transition.functions,
    config_changed: transition.config_changed,
    helper_count: transition.helper_attestations.length,
    c2_overlay_count: transition.c2_helper_replacements.length,
    rpc_replacement_count: transition.rpc_replacements.length,
    rpc_predecessor_fingerprint: transition.rpc_predecessor_exception.advisor_fingerprint,
    finance_policy: transition.finance_policy,
  }, {
    id: 'stories-v2-qa-c1-question-answer-v1',
    from_phase: 'stories_v2_safety_c2_publish_first_async_review',
    to_phase: 'stories_v2_qa_c1_question_answer',
    baseline_sha: 'c1c3043b24abe898a4400f858d646a2f788ee201',
    reviewed_source_sha: '3b7652e9ae7d9c66ce3f06286f738a724f3a9cd5',
    integration_base_sha: '10c549ac0dd84d28ccd832264184619ec56ba97f',
    migration_path: STORIES_QA_C1_MIGRATION_PATH,
    migration_blob: 'b1f025b12f6d4e9fadf178630ee0e46c283bbd1c',
    migration_sha256: '7bd4afded4f6e0b36fa702c1eb83eedfed42f7b502ee9e2f97ada7121a1cf73c',
    productive_paths: [STORIES_QA_C1_MIGRATION_PATH],
    functions: [],
    config_changed: false,
    helper_count: 10,
    c2_overlay_count: 5,
    rpc_replacement_count: 4,
    rpc_predecessor_fingerprint: '010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14',
    finance_policy: {
      platform_fee_bps: 2000,
      purchase_enabled: true,
      refunds_enabled: true,
      subscription_enabled: true,
    },
  });
  assert.deepEqual(policy.stories_safety_c2_transition, gate.STORIES_SAFETY_C2_RELEASE_TRANSITION,
    'historical C2 authority must remain byte-for-byte immutable');
  assert.equal(sha256(gate.canonicalJson(policy.stories_safety_c2_transition).trimEnd()),
    '8c041ddcc845689fa4b4371f699eecd22a914971913340f1c9e103ed808186d5',
    'QA successor must not rewrite the historical C2 transition');
  assert.equal(gate.validatePolicy(policy), true);
  for (const mutate of [
    value => { value.migration_sha256 = '0'.repeat(64); },
    value => { value.functions.push('content-safety-scan'); },
    value => { value.helper_attestations.pop(); },
    value => { value.c2_helper_replacements.pop(); },
    value => { value.rpc_replacements[0] = 'public.create_story_with_media(uuid)'; },
    value => { value.rpc_predecessor_exception.advisor_fingerprint = '0'.repeat(64); },
    value => { value.relation_attestation.force_rls = false; },
    value => { value.trigger_attestation.definition_sha256 = '0'.repeat(64); },
    value => { value.safety.activation = false; },
    value => { value.finance_policy.platform_fee_bps = 0; },
  ]) {
    const hostile = structuredClone(policy);
    mutate(hostile.stories_qa_c1_transition);
    assertDenied(() => gate.validatePolicy(hostile), 'INVALID_STORIES_QA_C1_TRANSITION');
  }
});

test('Stories QA C1 Git attestation binds exact LF migration bytes, ancestry, and one-path Supabase closure', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_qa_c1_transition;
  const preQaPolicy = structuredClone(policy);
  preQaPolicy.baseline.sha = transition.baseline_sha;
  preQaPolicy.baseline.migration_count = 360;
  preQaPolicy.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  const root = new URL('..', import.meta.url);
  const runGit = args => execFileSync('git', args, { cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  // Historical one-path attestations must execute against their immutable
  // reviewed source, not whatever later migration happens to be at HEAD.
  const approvedSha = transition.reviewed_source_sha;
  const input = { cwd: root, policy: preQaPolicy, mode: 'plan_only', approvedSha,
    changes: [{ path: transition.migration_path, status: 'A' }],
    migrations: [{ path: transition.migration_path, version: '20261029042807' }],
    affectedFunctions: [], runGit };
  const result = gate.attestStoriesQaC1Transition(input);
  assert.equal(result.attestation.reviewed_source_descendant_verified, true);
  assert.equal(result.migrations[0].blob, transition.migration_blob);
  assert.equal(result.migrations[0].sha256, transition.migration_sha256);
  for (const ref of [transition.reviewed_source_sha, input.approvedSha]) {
    assert.equal(execFileSync('git', ['rev-parse', `${ref}:${transition.migration_path}`],
      { cwd: root, encoding: 'utf8' }).trim(), transition.migration_blob);
  }
  for (const ancestry of [
    [transition.baseline_sha, transition.integration_base_sha],
    [transition.integration_base_sha, input.approvedSha],
    [transition.reviewed_source_sha, input.approvedSha],
  ]) {
    const altered = args => {
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor'
        && args[2] === ancestry[0] && args[3] === ancestry[1]) throw new Error('not an ancestor');
      return runGit(args);
    };
    assertDenied(() => gate.attestStoriesQaC1Transition({ ...input, runGit: altered }),
      'INVALID_STORIES_QA_C1_TRANSITION');
  }
  for (const altered of [
    args => args[0] === 'rev-parse' && args[1] === `${input.approvedSha}:${transition.migration_path}`
      ? `${'0'.repeat(40)}\n` : runGit(args),
    args => args[0] === 'show' && args[1] === `${input.approvedSha}:${transition.migration_path}`
      ? Buffer.from('altered migration\n') : runGit(args),
  ]) assertDenied(() => gate.attestStoriesQaC1Transition({ ...input, runGit: altered }),
    'INVALID_STORIES_QA_C1_TRANSITION');
  for (const hostile of [
    { migrations: [] },
    { migrations: [{ path: transition.migration_path, version: '20261029042808' }] },
    { migrations: [{ path: 'supabase/migrations/20261029042807_wrong.sql', version: '20261029042807' }] },
    { changes: [{ path: transition.migration_path, status: 'M' }] },
    { changes: [{ path: transition.migration_path, status: 'A' },
      { path: 'supabase/migrations/20261029042808_extra.sql', status: 'A' }] },
    { approvedSha: '0'.repeat(40) },
  ]) assertDenied(() => gate.attestStoriesQaC1Transition({ ...input, ...hostile }),
    'INVALID_STORIES_QA_C1_TRANSITION');
  for (const mutate of [
    value => { value.baseline_sha = '0'.repeat(40); },
    value => { value.reviewed_source_sha = '0'.repeat(40); },
    value => { value.migration_blob = '0'.repeat(40); },
    value => { value.migration_path = 'supabase/migrations/20261029042807_wrong.sql'; },
  ]) {
    const hostile = structuredClone(preQaPolicy);
    mutate(hostile.stories_qa_c1_transition);
    assertDenied(() => gate.attestStoriesQaC1Transition({ ...input, policy: hostile }),
      'INVALID_STORIES_QA_C1_TRANSITION');
  }
  assertDenied(() => gate.attestStoriesQaC1Transition({ ...input,
    changes: [...input.changes, { path: 'supabase/functions/content-safety-scan/index.ts', status: 'M' }] }),
  'INVALID_STORIES_QA_C1_TRANSITION');
});

test('Stories QA C1 manifest accepts exactly one migration and zero Edge/config/function contracts', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_qa_c1_transition;
  const preQaPolicy = structuredClone(policy);
  preQaPolicy.baseline.sha = transition.baseline_sha;
  preQaPolicy.baseline.migration_count = 360;
  preQaPolicy.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  const approvedSha = 'd'.repeat(40);
  const changes = [{ status: 'A', path: transition.migration_path, fileType: 'file' }];
  const attestation = { ...structuredClone(transition), approved_sha: approvedSha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true };
  const input = manifestInput(preQaPolicy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified: gate.classifyChangedPaths(changes),
    migrations: [{ version: '20261029042807', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256 }],
    affectedFunctions: [], functionContracts: [], storiesQaC1Transition: attestation,
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'PLAN READY');
  assert.deepEqual(manifest.resources.stories_qa_c1_transition, attestation);
  assert.deepEqual(manifest.resources.functions, []);
  assert.deepEqual(manifest.resources.function_contracts, []);
  assert.equal(manifest.resources.config_changed, false);
  assert.equal(manifest.risk.level, 'HIGH');
  for (const [mutate, code] of [
    [value => { value.storiesQaC1Transition = null; }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.migrations[0].sha256 = '0'.repeat(64); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.migrations.push({ version: '20261029042808', path: 'supabase/migrations/20261029042808_extra.sql' }); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.affectedFunctions = ['content-safety-scan']; }, 'FUNCTION_CONTRACT_MISMATCH'],
    [value => { value.classified.config.push({ path: 'supabase/config.toml' }); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.classified.productive.push({ path: 'supabase/functions/content-safety-scan/index.ts' }); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.gitState.baselineSha = '0'.repeat(40); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.gitState.originMainSha = '0'.repeat(40); }, 'INVALID_STORIES_QA_C1_TRANSITION'],
    [value => { value.request.mainSha = '0'.repeat(40); }, 'MAIN_SHA_MISMATCH'],
    [value => { value.risk = { level: 'STANDARD', findings: [] }; }, 'INVALID_STORIES_QA_C1_TRANSITION'],
  ]) {
    const hostile = structuredClone(input);
    mutate(hostile);
    assertDenied(() => gate.buildManifest(hostile), code);
  }
  const unrelatedPath = 'supabase/functions/content-safety-scan/index.ts';
  const unrelated = structuredClone(input);
  unrelated.gitState.changes.push({ status: 'M', path: unrelatedPath, fileType: 'file' });
  unrelated.classified = gate.classifyChangedPaths(unrelated.gitState.changes);
  unrelated.affectedFunctions = ['content-safety-scan'];
  unrelated.functionContracts = [{
    name: 'content-safety-scan', entrypoint: unrelatedPath, import_map: null, verify_jwt: true,
    source_changed: true, source_files: [{ path: unrelatedPath, sha256: '1'.repeat(64) }],
    source_sha256: '1'.repeat(64),
  }];
  assertDenied(() => gate.buildManifest(unrelated), 'INVALID_STORIES_QA_C1_TRANSITION');

  const dangling = structuredClone(input);
  dangling.migrations = [];
  dangling.gitState.changes = [];
  dangling.classified = gate.classifyChangedPaths([]);
  assertDenied(() => gate.buildManifest(dangling), 'INVALID_STORIES_QA_C1_TRANSITION');
});

test('Stories QA C1 transition retires after baseline promotion and rejects replay before Git', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_qa_c1_transition;
  const promoted = structuredClone(policy);
  promoted.baseline.sha = 'e'.repeat(40);
  promoted.baseline.migration_count = 361;
  promoted.baseline.latest_migration = '20261029042807_stories_v2_qa_c1_question_answer_authority';
  const base = { cwd: new URL('..', import.meta.url), policy: promoted, mode: 'plan_only',
    approvedSha: 'e'.repeat(40), changes: [], affectedFunctions: [],
    runGit: () => { throw new Error('retired QA attestation must reject before Git'); } };
  assert.deepEqual(gate.attestStoriesQaC1Transition({ ...base, migrations: [] }),
    { migrations: [], attestation: null });
  assertDenied(() => gate.attestStoriesQaC1Transition({ ...base,
    migrations: [{ path: transition.migration_path, version: '20261029042807' }] }),
  'INVALID_STORIES_QA_C1_TRANSITION');
});

test('Stories Safety C1 policy adds an exact inactive one-migration zero-Edge transition', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_safety_c1_transition;
  assert.deepEqual(transition, gate.STORIES_SAFETY_C1_RELEASE_TRANSITION);
  assert.deepEqual(transition && {
    from_phase: transition.from_phase,
    to_phase: transition.to_phase,
    baseline_sha: transition.baseline_sha,
    reviewed_source_sha: transition.reviewed_source_sha,
    integration_base_sha: transition.integration_base_sha,
    migration_path: transition.migration_path,
    migration_blob: transition.migration_blob,
    migration_sha256: transition.migration_sha256,
    productive_paths: transition.productive_paths,
    functions: transition.functions,
    config_changed: transition.config_changed,
    policy_artifact: transition.policy_artifact,
    safety: transition.safety,
    finance_policy: transition.finance_policy,
  }, {
    from_phase: 'stories_v2_interactive_b1_fail_closed',
    to_phase: 'stories_v2_safety_c1_technical_prep_fail_closed',
    baseline_sha: '01dd6467484d11ad11aeb611374437e212fb7401',
    reviewed_source_sha: '5ba49a3b118d6fde4eea6d97ec4c193f6f48a64a',
    integration_base_sha: '69ba61b04a1329231dcc9f22363f1c273e5b524c',
    migration_path: STORIES_SAFETY_C1_MIGRATION_PATH,
    migration_blob: 'c6c10913db7bb71411436835c923c14c129f51b7',
    migration_sha256: '92c956af294888d5011eda07d14c84ccb0c1ba8acac4e5c8e7887d947f3d92a0',
    productive_paths: [STORIES_SAFETY_C1_MIGRATION_PATH],
    functions: [],
    config_changed: false,
    policy_artifact: {
      path: STORIES_SAFETY_C1_ARTIFACT_PATH,
      blob: '2c419b551ee344107657a3a8da1fe05d44244e1f',
      sha256: 'c294071c22de46ad66fb73b578b190912b3f21a1e1dfa5e0b15387896a34e9f1',
      policy_id: 'nelyon.stories.general.safety.candidate.v1',
    },
    safety: {
      activation: false,
      automatic_allow_authorized: false,
      automatic_block_authorized: false,
      auto_publish_enabled: false,
      decisions: ['pending', 'review'],
      mode: 'fail_closed_review',
      owner_approved_policy: false,
    },
    finance_policy: {
      platform_fee_bps: 2000,
      purchase_enabled: true,
      refunds_enabled: true,
      subscription_enabled: true,
    },
  });
  assert.equal(gate.validatePolicy(policy), true);

  for (const mutate of [
    value => { value.safety.activation = true; },
    value => { value.safety.owner_approved_policy = true; },
    value => { value.safety.decisions.push('passed'); },
    value => { value.functions.push('content-safety-scan'); },
    value => { value.productive_paths.push('supabase/config.toml'); },
    value => { value.policy_artifact.sha256 = '0'.repeat(64); },
    value => { value.migration_sha256 = '0'.repeat(64); },
    value => { value.finance_policy.platform_fee_bps = 0; },
  ]) {
    const hostile = structuredClone(policy);
    mutate(hostile.stories_safety_c1_transition);
    assertDenied(() => gate.validatePolicy(hostile), 'INVALID_STORIES_SAFETY_C1_TRANSITION');
  }
});

test('Stories Safety C1 Git attestation binds reviewed migration and policy artifact bytes', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesSafetyC1TransitionPolicy(installedPolicy);
  const transition = policy.stories_safety_c1_transition;
  const root = new URL('..', import.meta.url);
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const approvedSha = transition.reviewed_source_sha;
  const input = {
    cwd: root,
    policy,
    mode: 'plan_only',
    approvedSha,
    changes: [{ path: transition.migration_path, status: 'A' }],
    migrations: [{ path: transition.migration_path, version: '20261027120000' }],
    affectedFunctions: [],
    runGit,
  };
  const attested = gate.attestStoriesSafetyC1Transition(input);
  assert.equal(attested.attestation.approved_sha, approvedSha);
  assert.equal(attested.migrations[0].blob, transition.migration_blob);
  assert.equal(attested.migrations[0].sha256, transition.migration_sha256);

  const alteredRunGit = args => {
    if (args[0] === 'rev-parse' && args[1] === `${approvedSha}:${transition.policy_artifact.path}`) {
      return `${'0'.repeat(40)}\n`;
    }
    return runGit(args);
  };
  assertDenied(() => gate.attestStoriesSafetyC1Transition({ ...input, runGit: alteredRunGit }),
    'INVALID_STORIES_SAFETY_C1_TRANSITION');
});

test('Stories Safety C1 manifest accepts only the attested migration and no Edge or config changes', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asStoriesSafetyC1TransitionPolicy(installedPolicy);
  const transition = policy.stories_safety_c1_transition;
  const approvedSha = 'b'.repeat(40);
  const changes = [{ status: 'A', path: transition.migration_path, fileType: 'file' }];
  const classified = gate.classifyChangedPaths(changes);
  const attestation = {
    ...structuredClone(transition),
    approved_sha: approvedSha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  };
  const input = manifestInput(policy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { baselineSha: transition.baseline_sha, approvedSha, originMainSha: approvedSha, changes },
    classified,
    migrations: [{
      version: '20261027120000', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256,
    }],
    affectedFunctions: [],
    functionContracts: [],
    storiesSafetyC1Transition: attestation,
  });
  const manifest = gate.buildManifest(input);
  assert.deepEqual(manifest.resources.stories_safety_c1_transition, attestation);
  assert.deepEqual(manifest.resources.functions, []);
  assert.deepEqual(manifest.resources.migrations, input.migrations);
  assert.equal(manifest.resources.config_changed, false);
  assert.equal(manifest.result, 'PLAN READY');

  assertDenied(() => gate.buildManifest({ ...input, affectedFunctions: ['content-safety-scan'] }),
    'FUNCTION_CONTRACT_MISMATCH');
  assertDenied(() => gate.buildManifest({
    ...input,
    storiesSafetyC1Transition: { ...attestation, migration_sha256: '0'.repeat(64) },
  }), 'INVALID_STORIES_SAFETY_C1_TRANSITION');
});

test('Stories Safety C1 transition retires after baseline promotion and cannot reactivate', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.stories_safety_c1_transition;
  const result = gate.attestStoriesSafetyC1Transition({
    cwd: new URL('..', import.meta.url),
    policy,
    mode: 'plan_only',
    approvedSha: MAIN_SHA,
    changes: [{ path: transition.migration_path, status: 'A' }],
    migrations: [],
    affectedFunctions: [],
    runGit: () => { throw new Error('promoted Stories Safety C1 attestation must not run'); },
  });
  assert.deepEqual(result, { migrations: [], attestation: null });

  assertDenied(() => gate.attestStoriesSafetyC1Transition({
    cwd: new URL('..', import.meta.url),
    policy,
    mode: 'plan_only',
    approvedSha: MAIN_SHA,
    changes: [{ path: transition.migration_path, status: 'A' }],
    migrations: [{ path: transition.migration_path, version: '20261027120000' }],
    affectedFunctions: [],
    runGit: () => { throw new Error('retired Stories Safety C1 transition must reject replay before Git'); },
  }), 'INVALID_STORIES_SAFETY_C1_TRANSITION');
});

function asStoriesSafetyC2TransitionPolicy(policy) {
  const result = structuredClone(policy);
  result.baseline.sha = 'e4c7199da157446f455822ea96e812784354b1db';
  result.baseline.migration_count = 359;
  result.baseline.latest_migration = '20261027120000_stories_v2_safety_c1_technical_policy_prep';
  return result;
}

async function loadGateAndPolicy() {
  assert.ok(existsSync(policyUrl), 'release policy must exist');
  assert.ok(existsSync(gateUrl), 'release gate helper must exist');
  const gate = await import(`${gateUrl.href}?test=${Date.now()}-${Math.random()}`);
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  return { gate, policy };
}

const FINANCE_OFF_POLICY = Object.freeze({
  platform_fee_bps: 0,
  purchase_enabled: false,
  refunds_enabled: false,
  subscription_enabled: false,
});

const STORIES_B1_PRE_RELEASE_BASELINE = Object.freeze({
  authority_source: 'owner-control-plane',
  blocked_resources: [],
  evidence: '726b9619cd7a10c6e489b3ddfd98724d78f1bd253f6bfdf88c7e476ed4cc6292',
  evidence_digests: {
    migrations: '0f7f653511093bf9a17e4beb5f0d4b94462691870ddc0df1c9f2beb89a0e9fd6',
    managed_functions: '9851a1d192f523bd326213e77de5f7c2e691fb5cd2928a569fdf1086b187a131',
    unmanaged_functions: '26f9c59179198817e55c7940177bf72cf7024f77b4b3c707d205ab7d5c3eaafc',
    function_source_parity: '6fdd9e7abfe3e7695508908129f91762546aac8cea7e2eb00555d794d2b7dd58',
    config_verify_jwt: '703749fce46f724c7c4e791f7a222915b166af0ded38f00f34f983798355ba15',
    cron_security: '7abbb7c306dc044e6228a9fdc1e00fa2dbcec6936e433ea3c5b6123611cc2ae1',
    finance: 'f94d54264c5d7658dc04aba34b028c815e99d7eb8ccf2490410817d47566754f',
  },
  latest_migration: '20261026120000_live_battles_final_c1',
  migration_count: 357,
  prior_release: {
    kind: 'post-release',
    release_id: 'nelyon-live-battles-c1-release-20261027T001044Z',
    manifest_sha256: '6bec1582371ca87fe45b2cc7f15f0964811f1c298b676a0725b051405dec157f',
    postcheck_evidence_sha256: '26b6b5e1a589e900f50d3e02c515de7092a509784a7e084dcebdfdbd5799292b',
  },
  requires_separate_policy_commit: true,
  reviewed_policy_sha256: '424f9d76b34f5fcff1d6055f618ec01ce8d716ae2c017534f35eddfd033f9154',
  sha: 'd8c3847b14486f249d9d8fa83aa74c8cff37bf6b',
  state: 'verified',
  verified_at: '2026-10-27T00:47:20.875Z',
  verified_by: OWNER,
});

const STORIES_SAFETY_C1_PRE_RELEASE_BASELINE = Object.freeze({
  authority_source: 'owner-control-plane',
  blocked_resources: [],
  evidence: 'cf02b715a2b828002ca8ab8e796e1b9c273f5b8563b6b99440f777d9d15a0c59',
  evidence_digests: {
    migrations: '785aa20ab32cddd324546facf872e08278ef1b3dd51f3a7f7dcbd406ede7ca24',
    managed_functions: '9f2d00de4c48cedc96edb09ee654a1c43679e1168dbb17273207d4273de8320b',
    unmanaged_functions: '26f9c59179198817e55c7940177bf72cf7024f77b4b3c707d205ab7d5c3eaafc',
    function_source_parity: 'f9b9e191f6d70e2e0c33ac54cb1af5592afe4eaff6c7eb85dc20d07b50c273c1',
    config_verify_jwt: '703749fce46f724c7c4e791f7a222915b166af0ded38f00f34f983798355ba15',
    cron_security: '7abbb7c306dc044e6228a9fdc1e00fa2dbcec6936e433ea3c5b6123611cc2ae1',
    finance: 'f94d54264c5d7658dc04aba34b028c815e99d7eb8ccf2490410817d47566754f',
  },
  latest_migration: '20261027042552_stories_v2_interactive_b1',
  migration_count: 358,
  prior_release: {
    kind: 'post-release',
    release_id: 'nelyon-stories-b1-recovery-release-20261027T082425Z',
    manifest_sha256: '4c3435b1cd87ffd416c02b9f720cf4d3e3dd193fa8982e613dafa48fd036bcdf',
    postcheck_evidence_sha256: '91539f307047110f8c2b1c9a6abe9aaa6b8c7b83ae3751ba06a03f928d828b2e',
  },
  requires_separate_policy_commit: true,
  reviewed_policy_sha256: '65ea15b0f6b681e88c62965f2e79fb2e502e3dfd3d190f77899c76f8f31e0eec',
  sha: '01dd6467484d11ad11aeb611374437e212fb7401',
  state: 'verified',
  verified_at: '2026-10-27T12:53:56.726Z',
  verified_by: OWNER,
});

function asStoriesB1TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline = structuredClone(STORIES_B1_PRE_RELEASE_BASELINE);
  return transitionPolicy;
}

function asStoriesSafetyC1TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline = structuredClone(STORIES_SAFETY_C1_PRE_RELEASE_BASELINE);
  return transitionPolicy;
}

function asF3TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = policy.finance_authority_transition.baseline_sha;
  transitionPolicy.baseline.migration_count = 351;
  transitionPolicy.baseline.latest_migration = '20261024173500_creator_premium_f2_complete_monetization';
  transitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
  return transitionPolicy;
}

function asF3C2TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = policy.finance_authority_c2_transition.baseline_sha;
  transitionPolicy.baseline.migration_count = 352;
  transitionPolicy.baseline.latest_migration = '20261025011000_creator_premium_f3_bounded_financial_activation';
  transitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
  return transitionPolicy;
}

function asF4TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = policy.finance_authority_f4_transition.baseline_sha;
  transitionPolicy.baseline.migration_count = 354;
  transitionPolicy.baseline.latest_migration = '20261025231500_creator_premium_f3_final_wallet_integration';
  transitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
  return transitionPolicy;
}

function asF5TransitionPolicy(policy) {
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = policy.finance_authority_f5_transition.baseline_sha;
  transitionPolicy.baseline.migration_count = 355;
  transitionPolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
  transitionPolicy.supabase.finance_policy = {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  };
  return transitionPolicy;
}

const F4_GENERAL_MIGRATION = '20261026030000_creator_premium_f4_general_bdag_activation';
const F5_AUTONOMOUS_MIGRATION = '20261026072512_creator_premium_f5_autonomous_subscriptions';

test('F5 autonomous transition attests one exact migration, bdag-ledger, strict client and cron contracts', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.finance_authority_f5_transition;
  assert.deepEqual(transition && {
    from_phase: transition.from_phase,
    to_phase: transition.to_phase,
    migration_path: transition.migration_path,
    productive_paths: transition.productive_paths,
    function: transition.function,
    function_source_sha256: transition.function_source_sha256,
    config_blob: transition.config_blob,
    client_contract: transition.client_contract,
    cron_job: transition.cron_job,
  }, {
    from_phase: 'f4_general',
    to_phase: 'f5_autonomous',
    migration_path: `supabase/migrations/${F5_AUTONOMOUS_MIGRATION}.sql`,
    productive_paths: [
      'supabase/functions/bdag-ledger/index.ts',
      `supabase/migrations/${F5_AUTONOMOUS_MIGRATION}.sql`,
    ],
    function: 'bdag-ledger',
    function_source_sha256: 'de3d258f3b4db069a848418bd0b4921d32520cb56d133f918747699af48c53ed',
    config_blob: '7c3ff52db72f9983aa4128f5c2e7e686bba31d5d',
    client_contract: 'creator-premium-f3-v2',
    cron_job: {
      jobname: 'creator-premium-auto-renewals-f5',
      schedule: '*/5 * * * *',
      database: 'postgres',
      username: 'postgres',
      active: true,
      command: 'select private.process_creator_premium_auto_renewals_f5_v1(25);',
      normalized_command_sha256: '31518881633261ec69720f0604f35d81c2b784db4a24a87c32d9d696304173f1',
    },
  });
  assert.deepEqual(gate.F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION, transition);
  assert.equal(transition.baseline_sha, '02c238618b05cd01c7388cc592ba7ac426973ce5');
  assert.equal(transition.reviewed_source_sha, '94de72a46558aab408c0f4d062f80462fd17f116');
  assert.equal(transition.migration_blob, 'ca08f3a5224cea2ef6b4390bc625d55f378b2ca6');
  assert.equal(transition.migration_sha256, '5975e535f4818981e076f4f8617caa8e357852a4926a3f1c8c5e8879712299f3');
  assert.equal(transition.function_blob, 'e50f8109c6ec479483cb64f3da68812c446b0dda');
  assert.deepEqual(transition.client_sources, [
    {
      path: 'services/creatorPremiumFinanceContracts.mjs',
      blob: '116068dcb37812721b5960af158fc249a225b6ee',
      sha256: '03774e0de62200f3734dc63a2995afdac02e19d4d8f6589995acca33c9a060b9',
    },
    {
      path: 'services/financial/ledgerClient.ts',
      blob: '01a8f7f622c78f637d15a8e3eadf4af71017a47b',
      sha256: '1f718c565a305366e614dc8905e87a5b1017832bcbdc416ad0d4e97d484e9c6f',
    },
    { path: 'services/creatorPremiumFinanceContracts.d.mts', blob: 'b89adf820f389147e9f1fdaa8fdc1c003bfd3bd0',
      sha256: '250d37537cc746e3eef726e72753c930dd1fe7d5f96a1afbdacfdd89e53aa107' },
    { path: 'services/creatorPremiumService.ts', blob: '5899c8d9564b8d7691f7a3266f8050ec13e18bb7',
      sha256: '979baec6879a6f8ce9fb579205e36cdd6a1f63da8eb17ee741b90739665ca7d7' },
  ]);
  assert.equal(policy.finance_authority.f5_autonomous.base_phase, 'f4_general');
  assert.deepEqual(policy.finance_authority.f5_autonomous.relations.map(row => row.identity), [
    'private.creator_premium_auto_renewal_attempts',
    'private.creator_premium_auto_renewal_mandates',
    'private.creator_premium_finance_authorizations',
    'private.creator_premium_finance_owner_attestations_f3_c2',
    'private.creator_premium_finance_policy',
    'private.creator_premium_purchase_receipts',
    'private.creator_premium_subscription_periods',
    'private.creator_premium_subscriptions',
  ]);
  assert.equal(policy.finance_authority.f5_autonomous.function_overrides.some(row => row.identity.includes('get_my_creator_premium_subscriptions')), false);
  assert.ok(policy.finance_authority.f5_autonomous.function_additions.some(row => (
    row.identity === 'public.get_my_creator_premium_subscriptions_v3(timestamp with time zone, uuid, integer)'
      && row.sha256 === 'f330b19ccbea0b419c451cf944feafcd040a27197e0b61fb639f2cdd267d154f'
  )));
  assert.ok(policy.finance_authority.f5_autonomous.function_additions.some(row => (
    row.identity === 'private.process_creator_premium_auto_renewals_f5_v1(integer)'
      && row.sha256 === 'c5e448e421ba77d64cd4bf8c69f424f9a6682c8f5d039918ab0fa419daf81f9e'
  )));
  const f5Projection = policy.finance_security_advisor.f5_rpc_additions[0];
  assert.equal(f5Projection.object.name, 'get_my_creator_premium_subscriptions_v3');
  assert.equal(f5Projection.attestation.definition_sha256,
    '246ab182de52bedd431e12a54ddf48923ecbd85e296ad6e138e54017f5ed7489');
  assert.deepEqual(policy.finance_security_advisor.f5_relation_additions, [
    {
      advisor_fingerprint: '70d2706125a8861824f9c876848c472a28bde6db0813543ba97ec3409516967f',
      advisor_type: 'table',
      advisor_severity: 'INFO',
      object: { schema: 'private', name: 'creator_premium_auto_renewal_attempts' },
    },
    {
      advisor_fingerprint: 'd37d10aa8c56fc907ce6ce86f44aafcb36f8bd6c7d719cc33032fe1561eee56d',
      advisor_type: 'table',
      advisor_severity: 'INFO',
      object: { schema: 'private', name: 'creator_premium_auto_renewal_mandates' },
    },
  ]);

  for (const mutate of [
    candidate => { candidate.finance_authority_f5_transition.migration_sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_authority_f5_transition.function_source_sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_authority_f5_transition.config_blob = 'a'.repeat(40); },
    candidate => { candidate.finance_authority_f5_transition.client_sources[0].sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_authority_f5_transition.cron_job.schedule = '*/10 * * * *'; },
    candidate => { candidate.finance_authority.f5_autonomous.relations[0].sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_authority.f5_autonomous.function_additions[0].sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_security_advisor.f5_rpc_additions[0].attestation.definition_sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_security_advisor.f5_relation_additions[0].advisor_fingerprint = 'a'.repeat(64); },
    candidate => { candidate.finance_security_advisor.f5_relation_additions[1].object.name = 'unexpected_relation'; },
  ]) {
    const candidate = structuredClone(policy);
    mutate(candidate);
    assertDenied(() => gate.validatePolicy(candidate), 'INVALID_FINANCE_AUTHORITY_TRANSITION');
  }
});

test('baseline promotion migrates cron identity from legacy normalization to raw F5 bytes', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const rawDigest = 'a'.repeat(64);
  const legacyDigest = 'b'.repeat(64);
  const cronItem = {
    jobid: '3', jobname: 'existing-job', schedule: '0 3 * * *', database: 'postgres',
    username: 'postgres', active: true, nodename: 'localhost', nodeport: 5432,
    command_sha256: rawDigest,
    legacy_normalized_command_sha256: legacyDigest,
  };
  const legacySnapshot = baselineSnapshot(policy, {
    migrations: {
      complete: true,
      items: Array.from({ length: 355 }, (_, index) => `2026${String(index).padStart(10, '0')}`),
      latest: F4_GENERAL_MIGRATION,
    },
    cron_security: { complete: true, cron: [cronItem], security_findings: [] },
  });
  const legacyEvidence = gate.buildBaselineEvidence(legacySnapshot);
  assert.equal(legacyEvidence.cron_security.cron[0].command_sha256, legacyDigest);
  assert.equal('legacy_normalized_command_sha256' in legacyEvidence.cron_security.cron[0], false);

  const rawSnapshot = baselineSnapshot(policy, {
    migrations: {
      ...legacySnapshot.migrations,
      latest: '20261026072512_creator_premium_f5_autonomous_subscriptions',
    },
    cron_security: { complete: true, cron: [cronItem], security_findings: [] },
  });
  const rawEvidence = gate.buildBaselineEvidence(rawSnapshot);
  assert.equal(rawEvidence.cron_security.cron[0].command_sha256, rawDigest);
  assert.equal('legacy_normalized_command_sha256' in rawEvidence.cron_security.cron[0], false);
});

test('F5 Git attestation and manifest reject every migration Edge config client and closure mutation', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.finance_authority_f5_transition;
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = transition.baseline_sha;
  const root = new URL('..', import.meta.url);
  const rootPath = decodeURIComponent(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const approvedSha = transition.reviewed_source_sha;
  const changes = [
    { status: 'M', path: 'supabase/functions/bdag-ledger/index.ts' },
    { status: 'A', path: transition.migration_path },
  ];
  const runGit = args => execFileSync('git', args, {
    cwd: root, encoding: args.includes('-z') ? 'buffer' : 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const input = {
    policy: transitionPolicy, approvedSha, changes, affectedFunctions: ['bdag-ledger'],
    migrations: [{ path: transition.migration_path, version: '20261026072512' }], runGit,
  };
  const currentHead = runGit(['rev-parse', 'HEAD']).trim();
  assert.throws(() => gate.attestFinanceAuthorityTransition({ ...input, approvedSha: currentHead }), {
    code: 'INVALID_FINANCE_AUTHORITY_TRANSITION',
    message: 'F5 Git productive closure differs from supplied evidence',
  });
  const result = gate.attestFinanceAuthorityTransition(input);
  assert.equal(result.attestation.to_phase, 'f5_autonomous');
  assert.equal(result.attestation.function_source_sha256, transition.function_source_sha256);
  assert.deepEqual(result.attestation.cron_job, transition.cron_job);
  assert.equal(result.migrations[0].sha256, transition.migration_sha256);

  const sources = Object.fromEntries(Object.entries(collectFunctionSources(join(rootPath, 'supabase', 'functions'), rootPath))
    .map(([path, source]) => [path, source.replace(/\r\n/g, '\n')]));
  const graph = gate.buildFunctionGraph(sources);
  const config = gate.parseFunctionConfig(readFileSync(join(rootPath, 'supabase', 'config.toml'), 'utf8'));
  const contracts = gate.buildFunctionContracts({
    affectedFunctions: ['bdag-ledger'], graph, configBefore: config, configAfter: config, changes,
  });
  assert.equal(contracts[0].source_sha256, transition.function_source_sha256);
  const manifestInput = {
    request: request({ approvedSha, mainSha: approvedSha }), policy: transitionPolicy,
    gitState: { approvedSha, baselineSha: transition.baseline_sha, originMainSha: approvedSha },
    classified: gate.classifyChangedPaths(changes), migrations: result.migrations,
    financeAuthorityTransition: result.attestation, affectedFunctions: ['bdag-ledger'], functionContracts: contracts,
    reproducibility: gate.analyzeFunctionReproducibility({ affectedFunctions: ['bdag-ledger'], graph }),
    risk: { level: 'HIGH', findings: [] },
    compiler: { path: 'scripts/nelyon-production-release.mjs', sha256: 'a'.repeat(64),
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs', snapshot_adapter_sha256: 'b'.repeat(64) },
    generatedAt: '2026-10-26T12:00:00.000Z',
  };
  const plan = gate.buildManifest(manifestInput);
  assert.equal(plan.risk.level, 'HIGH');
  assert.deepEqual(plan.resources.functions, ['bdag-ledger']);
  assert.deepEqual(plan.resources.migrations.map(item => item.version), ['20261026072512']);
  assert.equal(plan.resources.config_changed, false);

  for (const patch of [
    { financeAuthorityTransition: null },
    { financeAuthorityTransition: { ...result.attestation, cron_job: { ...result.attestation.cron_job, active: false } } },
    { migrations: result.migrations.map(item => ({ ...item, sha256: 'f'.repeat(64) })) },
    { functionContracts: contracts.map(item => ({ ...item, source_sha256: 'f'.repeat(64) })) },
    { affectedFunctions: [] },
  ]) assertDenied(() => gate.buildManifest({ ...manifestInput, ...patch }), 'INVALID_FINANCE_AUTHORITY_TRANSITION');

  for (const patch of [
    { affectedFunctions: [] },
    { changes: [...changes, { status: 'M', path: 'supabase/config.toml' }] },
    { changes: [...changes, { status: 'A', path: 'supabase/migrations/20261026073000_extra.sql' }] },
    { runGit: args => args[0] === 'show' ? Buffer.from('tampered') : runGit(args) },
    { runGit: args => args[0] === 'rev-parse' ? 'f'.repeat(40) : runGit(args) },
  ]) assertDenied(() => gate.attestFinanceAuthorityTransition({ ...input, ...patch }),
    'INVALID_FINANCE_AUTHORITY_TRANSITION');
});

test('F4 general transition is one exact migration from F3-C2 with Finance enabled at 2000 bps', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.finance_authority_f4_transition;
  assert.deepEqual(transition && {
    from_phase: transition.from_phase,
    to_phase: transition.to_phase,
    migration_path: transition.migration_path,
    productive_paths: transition.productive_paths,
    from_policy: transition.from_policy,
    to_policy: transition.to_policy,
  }, {
    from_phase: 'f3_c2',
    to_phase: 'f4_general',
    migration_path: `supabase/migrations/${F4_GENERAL_MIGRATION}.sql`,
    productive_paths: [`supabase/migrations/${F4_GENERAL_MIGRATION}.sql`],
    from_policy: {
      activation_mode: 'off', active_authorization_id: null,
      platform_fee_bps: 0, purchase_enabled: false, refunds_enabled: false,
      subscription_enabled: false,
    },
    to_policy: {
      activation_mode: 'general', active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
      platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true,
      subscription_enabled: true,
    },
  });
  assert.deepEqual(gate.F4_GENERAL_FINANCE_AUTHORITY_TRANSITION, transition);
  assert.equal(policy.finance_authority.f4_general.base_phase, 'f3_c2');
  assert.equal(policy.finance_authority.f4_general.relations.length, 6);
  assert.deepEqual(policy.finance_authority.f4_general.function_overrides.map(row => row.identity), [
    'private.admit_creator_premium_refund_f3_v1(uuid)',
    'private.assert_creator_premium_finance_deadline_f3_v1(uuid, text)',
    'private.close_creator_premium_finance_authorization_f3_c2_v1(uuid, text)',
    'private.creator_premium_authorization_binding_f3_v1(uuid, text, uuid, uuid, uuid, uuid, numeric, integer, uuid, uuid, uuid)',
    'private.creator_premium_charge_blocker_f3_v1(text, uuid, uuid, uuid, uuid, numeric, text)',
    'private.creator_premium_finance_authorization_integrity_f3_c2_v1(uuid)',
    'private.finalize_creator_premium_finance_authorization_f3_c2_v1(uuid)',
    'private.guard_creator_premium_authorization_insert_f3_c2_v1()',
    'private.guard_creator_premium_finance_authorization_f3_v1()',
    'public.get_admin_creator_premium_finance_activation_v1()',
  ]);
  assert.equal(policy.finance_authority.f4_general.function_additions.length, 2);
  assert.ok(policy.finance_authority.f4_general.function_overrides.some(row => (
    row.identity === 'private.creator_premium_authorization_binding_f3_v1(uuid, text, uuid, uuid, uuid, uuid, numeric, integer, uuid, uuid, uuid)'
      && row.sha256 === '6bdc07ee66247d453454b05cc0d7e713f2d96f3e60f6c31855dafb20c9d239f3'
  )));
  const f4Admin = policy.finance_security_advisor.f4_rpc_replacements[0];
  assert.deepEqual(f4Admin.origin, {
    migration: F4_GENERAL_MIGRATION,
    migration_blob: transition.migration_blob,
    source_sha: transition.reviewed_source_sha,
  });
  assert.equal(f4Admin.attestation.definition_sha256,
    '8b5ab66edb413295e289df69f25f6ede7c128ee5cad2aaefade28ff4c235adee');

  for (const mutate of [
    candidate => { candidate.finance_authority_f4_transition.migration_sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_authority.f4_general.relations[0].sha256 = 'a'.repeat(64); },
    candidate => { candidate.finance_security_advisor.f4_rpc_replacements[0]
      .attestation.definition_sha256 = 'a'.repeat(64); },
  ]) {
    const candidate = structuredClone(policy);
    mutate(candidate);
    assertDenied(() => gate.validatePolicy(candidate), 'INVALID_FINANCE_AUTHORITY_TRANSITION');
  }

  const promoted = structuredClone(policy);
  promoted.baseline.latest_migration = F4_GENERAL_MIGRATION;
  promoted.baseline.migration_count = 355;
  promoted.supabase.finance_policy = {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  };
  assert.equal(gate.validatePolicy(promoted), true);

  for (const unsafe of [
    { ...promoted.supabase.finance_policy, platform_fee_bps: 1999 },
    { ...promoted.supabase.finance_policy, refunds_enabled: false },
    { ...promoted.supabase.finance_policy, purchase_enabled: false },
  ]) {
    const candidate = structuredClone(promoted);
    candidate.supabase.finance_policy = unsafe;
    assertDenied(() => gate.validatePolicy(candidate), 'INVALID_MANAGED_SCOPE_TRANSITION');
  }
});

test('F3 foundation transition attests exact committed migration and sole existing Edge closure', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asF3TransitionPolicy(installedPolicy);
  const root = new URL('..', import.meta.url);
  const transition = policy.finance_authority_transition;
  assert.equal(transition?.phase, 'foundation_only');
  const approvedSha = 'aea1a8772ea0ca9c0ede94a9b1f103eaa200dccc';
  const changes = [
    { status: 'A', path: 'supabase/migrations/20261025011000_creator_premium_f3_bounded_financial_activation.sql' },
    { status: 'M', path: 'supabase/functions/bdag-ledger/index.ts' },
  ];
  const runGit = args => execFileSync('git', args, { cwd: root, encoding: args.includes('-z') ? 'buffer' : 'utf8', stdio: ['pipe','pipe','pipe'] });
  const input = { policy, approvedSha, changes, affectedFunctions: ['bdag-ledger'],
    migrations: [{ path: changes[0].path, version: '20261025011000' }], runGit };
  const result = gate.attestFinanceAuthorityTransition(input);
  assert.equal(result.attestation.approved_sha, approvedSha);
  assert.equal(result.attestation.migration_blob, '8d3e57ccf78de470c951fa4f43d2aeb6fd2233da');
  assert.equal(result.migrations[0].sha256, 'b72c9d74368b4bcf54d120d76273154367922aaa4ff1876f828715b7cda54dc6');
  assert.equal(result.attestation.client_contract, 'creator-premium-f3-v2');
  assert.deepEqual(result.attestation.client_sources, [
    {
      path: 'services/creatorPremiumFinanceContracts.mjs',
      blob: '591a7d91de580c473af8812954ab806e1d4e01c7',
      sha256: '422d20fdfde1d525d6fd34585257355f129cca9ac3a88ad6f351d2d8a2c38f7a',
    },
    {
      path: 'services/financial/ledgerClient.ts',
      blob: '7c169e05d5d23bcb5e3834abfd559cd098602db1',
      sha256: 'bb3978856789dae33677592b4cd5c0b7f60030b9113cb3bc32032f1501f0f328',
    },
  ]);
  assert.deepEqual(result.attestation.frozen_f2_parser, {
    ref: '2d8bf717a011f3afe54af1df5cd0f991f94811f3',
    path: 'services/creatorPremiumFinanceContracts.mjs',
    blob: '40e7fd7809ca61570b9c8c00d438f5e83021be45',
    sha256: 'e55a1c494a8055af1f0990bc096e043aa3c70de693fa85945c161bc6a61fdcc2',
  });
  const sources = collectFunctionSourcesAtCommit(runGit, root, approvedSha);
  const graph = gate.buildFunctionGraph(sources);
  const config = gate.parseFunctionConfig(runGit(['show', `${approvedSha}:supabase/config.toml`], { cwd: root }).toString('utf8'));
  const contracts = gate.buildFunctionContracts({affectedFunctions:['bdag-ledger'],graph,configBefore:config,configAfter:config,changes});
  assert.equal(contracts[0].source_sha256,'79e79bd31a62920401b8d55d48e1754ce58149294c8960c7995a070078b796f9');
  const manifestInput = {request:request({approvedSha,mainSha:approvedSha}),policy,
    gitState:{approvedSha,baselineSha:transition.baseline_sha,originMainSha:approvedSha},
    classified:gate.classifyChangedPaths(changes),migrations:result.migrations,
    financeAuthorityTransition:result.attestation,affectedFunctions:['bdag-ledger'],functionContracts:contracts,
    reproducibility:gate.analyzeFunctionReproducibility({affectedFunctions:['bdag-ledger'],graph}),
    risk:{level:'HIGH',findings:[]},compiler:{path:'scripts/nelyon-production-release.mjs',sha256:'a'.repeat(64),
      snapshot_adapter_path:'scripts/nelyon-production-snapshot-adapter.mjs',snapshot_adapter_sha256:'b'.repeat(64)},
    generatedAt:'2026-10-25T01:00:00.000Z'};
  const plan = gate.buildManifest(manifestInput);
  assert.equal(plan.result,'PLAN READY');
  assert.equal(plan.risk.level,'HIGH');
  assert.equal(plan.resources.config_changed,false);
  assert.deepEqual(plan.resources.functions,['bdag-ledger']);
  for (const patch of [{financeAuthorityTransition:null},
    {financeAuthorityTransition:{...result.attestation,extraneous:true}},
    {financeAuthorityTransition:{...result.attestation,approved_sha:'f'.repeat(40)}},
    {gitState:{...manifestInput.gitState,approvedSha:'f'.repeat(40)}},
    {migrations:result.migrations.map(item=>({...item,sha256:'f'.repeat(64)}))},
    {functionContracts:contracts.map(item=>({...item,source_sha256:'f'.repeat(64)}))},
  ]) assertDenied(()=>gate.buildManifest({...manifestInput,...patch}),'INVALID_FINANCE_AUTHORITY_TRANSITION');
  for (const patch of [
    { approvedSha: '7ffe036f00d6e14b5ff1e2791867a6fcf3be921b' },
    { approvedSha: 'f'.repeat(40) }, { affectedFunctions: ['bdag-ledger', 'agora-token'] },
    { changes: [...changes, { status: 'M', path: 'supabase/config.toml' }] },
    { changes: [...changes, { status: 'A', path: 'supabase/migrations/20261025012000_extra.sql' }] },
    { migrations: [{ path: 'supabase/migrations/20261025011000_wrong.sql', version: '20261025011000' }] },
    { migrations: [] },
    { policy: { ...policy, baseline: { ...policy.baseline, sha: approvedSha } } },
    { runGit: args => args[0] === 'show' ? 'altered bytes' : runGit(args) },
    { runGit: args => args[0] === 'rev-parse' ? 'f'.repeat(40) : runGit(args) },
  ]) assert.throws(() => gate.attestFinanceAuthorityTransition({ ...input, ...patch }), error => error.code === 'INVALID_FINANCE_AUTHORITY_TRANSITION');
});

test('F3 accepts rebase-merged commit identities only with baseline ancestry and exact reviewed Git blobs', async t => {
  const {gate,policy:installedPolicy}=await loadGateAndPolicy();
  const policy=asF3TransitionPolicy(installedPolicy);
  const root=new URL('..',import.meta.url);
  const rootPath=decodeURIComponent(root.pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  const temporary=mkdtempSync(join(tmpdir(),'nelyon-release-rebase-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const repository=join(temporary,'rebased.git');
  execFileSync('git',['clone','--shared','--bare',rootPath,repository],{stdio:['pipe','pipe','pipe']});
  const environment={...process.env,GIT_AUTHOR_NAME:'F3 Governance Test',GIT_AUTHOR_EMAIL:'f3-test@example.invalid',
    GIT_COMMITTER_NAME:'F3 Governance Test',GIT_COMMITTER_EMAIL:'f3-test@example.invalid',GIT_INDEX_FILE:join(temporary,'test-index')};
  const git=(args,input)=>execFileSync('git',args,{cwd:repository,env:environment,input,
    encoding:args.includes('-z')?'buffer':'utf8',stdio:['pipe','pipe','pipe']});
  const value=(args,input)=>String(git(args,input)).trim();
  const transition=policy.finance_authority_transition;
  const integrationBase='2d8bf717a011f3afe54af1df5cd0f991f94811f3';
  assert.equal(transition.integration_base_sha,integrationBase);
  // Keep this historical F3 proof anchored to its reviewed source. A later
  // finance-authority successor must not expand the historical productive set.
  const originalHead=value(['rev-parse',transition.reviewed_source_sha]);
  let parent=value(['commit-tree',value(['rev-parse',`${integrationBase}^{tree}`]),'-p',integrationBase,'-m','New upstream main commit']);
  // Preserve already-main history and replay only feature commits over advanced main.
  // This is the identical-tree
  // case of GitHub Rebase and merge: every commit gets a different parent/identity.
  for(const commit of value(['rev-list','--reverse','--first-parent',`${integrationBase}..${originalHead}`]).split('\n')) {
    parent=value(['commit-tree',value(['rev-parse',`${commit}^{tree}`]),'-p',parent,'-m',`Rebase merged ${commit}`]);
  }
  const approvedSha=parent;
  assert.notEqual(approvedSha,originalHead);
  git(['merge-base','--is-ancestor',transition.baseline_sha,integrationBase]);
  git(['merge-base','--is-ancestor',integrationBase,approvedSha]);
  assert.throws(()=>git(['merge-base','--is-ancestor','27ff8b3861f901c548ee4c6abc054bc805d63f09',approvedSha]));
  assert.throws(()=>git(['merge-base','--is-ancestor','a581c2dcfbabdfeed3a80e866b9d69a75b3f1d4e',approvedSha]));
  assert.throws(()=>git(['merge-base','--is-ancestor','aea1a8772ea0ca9c0ede94a9b1f103eaa200dccc',approvedSha]));
  git(['remote','set-url','origin',`https://github.com/${REPOSITORY}.git`]);
  git(['update-ref','refs/remotes/origin/main',approvedSha]);
  const state=gate.resolveGitState({cwd:repository,baselineSha:transition.baseline_sha,approvedSha,
    expectedRepository:REPOSITORY,runGit:args=>git(args)});
  const input={cwd:repository,policy,approvedSha,changes:state.changes,affectedFunctions:['bdag-ledger'],
    migrations:[{version:'20261025011000',path:transition.migration_path}],runGit:args=>git(args)};
  const result=gate.attestFinanceAuthorityTransition(input);
  assert.equal(result.attestation.approved_sha,approvedSha);
  assert.equal(result.attestation.integration_base_descendant_verified,true);
  assert.equal(result.attestation.baseline_descendant_verified,true);
  assert.equal(result.migrations[0].blob,'8d3e57ccf78de470c951fa4f43d2aeb6fd2233da');
  assert.equal(result.migrations[0].sha256,'b72c9d74368b4bcf54d120d76273154367922aaa4ff1876f828715b7cda54dc6');
  assert.equal(result.attestation.client_contract,'creator-premium-f3-v2');
  const noReviewedBranchObjects=args=>{
    if(args.some(argument=>['27ff8b3861f901c548ee4c6abc054bc805d63f09','a581c2dcfbabdfeed3a80e866b9d69a75b3f1d4e',
      'aea1a8772ea0ca9c0ede94a9b1f103eaa200dccc']
      .some(source=>argument.includes(source)))) throw new Error('Original PR object unavailable after rebase merge');
    return git(args);
  };
  assert.equal(gate.attestFinanceAuthorityTransition({...input,runGit:noReviewedBranchObjects}).attestation.approved_sha,approvedSha);
  assertDenied(()=>gate.resolveGitState({cwd:repository,baselineSha:transition.baseline_sha,
    approvedSha:originalHead,expectedRepository:REPOSITORY,runGit:args=>git(args)}),'MAIN_SHA_MISMATCH');
  const approvedTree=value(['rev-parse',`${approvedSha}^{tree}`]);
  const orphan=value(['commit-tree',approvedTree,'-m','Foreign history with identical productive blobs']);
  assertDenied(()=>gate.attestFinanceAuthorityTransition({...input,approvedSha:orphan}),'INVALID_FINANCE_AUTHORITY_TRANSITION');
  const sideBranch=value(['commit-tree',approvedTree,'-p',transition.baseline_sha,'-m','Side branch omits reviewed main integration base']);
  git(['merge-base','--is-ancestor',transition.baseline_sha,sideBranch]);
  assert.throws(()=>git(['merge-base','--is-ancestor',integrationBase,sideBranch]));
  assertDenied(()=>gate.attestFinanceAuthorityTransition({...input,approvedSha:sideBranch}),'INVALID_FINANCE_AUTHORITY_TRANSITION');
  const changedCommit=(path,bytes,mode='100644')=>{
    git(['read-tree',approvedTree]);
    const blob=value(['hash-object','-w','--stdin'],bytes);
    git(['update-index','--add','--cacheinfo',mode,blob,path]);
    return value(['commit-tree',value(['write-tree']),'-p',approvedSha,'-m',`Hostile change ${path}`]);
  };
  const sql=String(git(['show',`${approvedSha}:${transition.migration_path}`]));
  for(const hostile of [
    changedCommit(transition.migration_path,`${sql}\n`),
    changedCommit(transition.migration_path,sql.replace(/\n/g,'\r\n')),
    changedCommit(transition.migration_path,sql,'120000'),
    changedCommit(transition.function_path,'unreviewed Edge source\n'),
    changedCommit('services/creatorPremiumFinanceContracts.mjs','unreviewed parser source\n'),
    changedCommit('services/financial/ledgerClient.ts','unreviewed finance client\n'),
    changedCommit('supabase/config.toml','unreviewed config\n'),
    changedCommit('supabase/functions/agora-token/unreviewed.ts','extra productive file\n'),
    changedCommit('supabase/functions/_shared/unreviewed.ts','extra shared dependency\n'),
    changedCommit('supabase/migrations/20261025012000_unreviewed.sql','select 1;\n'),
  ]) assertDenied(()=>gate.attestFinanceAuthorityTransition({...input,approvedSha:hostile}),'INVALID_FINANCE_AUTHORITY_TRANSITION');
});

test('F3-C2 attests the exact migration-only successor and rejects arbitrary finance transitions', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asF3C2TransitionPolicy(installedPolicy);
  const transition = policy.finance_authority_c2_transition;
  assert.deepEqual(transition && {
    from_phase: transition.from_phase,
    to_phase: transition.to_phase,
    migration_path: transition.migration_path,
    productive_paths: transition.productive_paths,
  }, {
    from_phase: 'f3_foundation',
    to_phase: 'f3_c2',
    migration_path: 'supabase/migrations/20261025160452_creator_premium_f3_c2_isolated_canary_governance.sql',
    productive_paths: ['supabase/migrations/20261025160452_creator_premium_f3_c2_isolated_canary_governance.sql'],
  });
  assert.deepEqual(gate.F3_C2_FINANCE_AUTHORITY_TRANSITION, transition);
  assert.deepEqual(gate.F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE.cases, [
    { actor: 'anon', expected: 'acl_denied' },
    { actor: 'service_role', expected: 'acl_denied' },
    { actor: 'authenticated_without_admin_role', expected: 'admin_capability_forbidden' },
    { actor: 'authenticated_moderator_without_finance_ledger_read', expected: 'admin_capability_forbidden' },
    { actor: 'authenticated_super_admin_with_finance_ledger_read', expected: 'allowed' },
  ]);
  const negativeAuthorizationEvidenceSha256 = gate.sha256Hex(gate.canonicalJson(
    gate.F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE,
  ));
  assert.equal(gate.F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256,
    negativeAuthorizationEvidenceSha256);
  assert.equal(policy.finance_security_advisor.c2_rpc_replacements[0]
    .authorization.negative_test_evidence_sha256, negativeAuthorizationEvidenceSha256);

  const root = new URL('..', import.meta.url);
  const approvedSha = transition.reviewed_source_sha;
  const runGit = args => execFileSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const changes = [{ status: 'A', path: transition.migration_path }];
  const input = {
    mode: 'plan_only', policy, approvedSha, changes, affectedFunctions: [], runGit,
    migrations: [{ path: transition.migration_path, version: '20261025160452' }],
  };
  const result = gate.attestFinanceAuthorityTransition(input);
  assert.equal(result.attestation.approved_sha, approvedSha);
  assert.equal(result.attestation.from_phase, 'f3_foundation');
  assert.equal(result.attestation.to_phase, 'f3_c2');
  assert.equal(result.migrations[0].blob, transition.migration_blob);
  assert.equal(result.migrations[0].sha256, transition.migration_sha256);

  const classified = gate.classifyChangedPaths(changes);
  const manifest = gate.buildManifest(manifestInput(policy, {
    request: request({ approvedSha, mainSha: approvedSha }),
    gitState: { approvedSha, baselineSha: transition.baseline_sha, originMainSha: approvedSha },
    classified,
    migrations: result.migrations,
    financeAuthorityTransition: result.attestation,
    affectedFunctions: [],
    functionContracts: [],
    risk: { level: 'HIGH', findings: [] },
  }));
  assert.equal(manifest.result, 'PLAN READY');
  assert.equal(manifest.risk.level, 'HIGH');
  assert.deepEqual(manifest.resources.functions, []);
  assert.deepEqual(manifest.resources.function_contracts, []);
  assert.equal(manifest.resources.config_changed, false);
  assert.deepEqual(manifest.resources.migrations, result.migrations);

  for (const patch of [
    { affectedFunctions: ['bdag-ledger'] },
    { migrations: [] },
    { changes: [...changes, { status: 'A', path: 'supabase/migrations/20261025160453_unreviewed.sql' }] },
    { policy: { ...policy, finance_authority_c2_transition: { ...transition, to_phase: 'arbitrary' } } },
    { runGit: args => args[0] === 'show' ? 'altered migration bytes' : runGit(args) },
  ]) {
    assert.throws(() => gate.attestFinanceAuthorityTransition({ ...input, ...patch }), error => (
      error.code === 'INVALID_FINANCE_AUTHORITY_TRANSITION'
    ));
  }
});

function asCandidatePolicy(policy) {
  const candidate = structuredClone(policy);
  candidate.baseline = {
    state: 'candidate',
    sha: policy.baseline.sha,
    migration_count: policy.baseline.migration_count,
    latest_migration: policy.baseline.latest_migration,
    evidence: null,
    verified_by: null,
    verified_at: null,
  };
  return candidate;
}

function asVerifiedCutoverPolicy(policy) {
  const verified = structuredClone(policy);
  verified.baseline = {
    ...verified.baseline,
    state: 'verified',
    evidence: 'b'.repeat(64),
    evidence_digests: {
      config_verify_jwt: '1'.repeat(64),
      cron_security: '2'.repeat(64),
      finance: '3'.repeat(64),
      function_source_parity: '4'.repeat(64),
      managed_functions: '5'.repeat(64),
      migrations: '6'.repeat(64),
      unmanaged_functions: '7'.repeat(64),
    },
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    prior_release: {
      kind: 'bootstrap',
      release_id: null,
      manifest_sha256: null,
      postcheck_evidence_sha256: '9'.repeat(64),
    },
    verified_by: OWNER,
    verified_at: '2026-10-09T12:00:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  verified.cutover = {
    state: 'verified',
    control: 'supabase-github-integration-off',
    initial_evidence: {
      id: 'supabase-off-20261009T120000Z',
      sha256: 'd'.repeat(64),
    },
    verified_at: '2026-10-09T12:00:00.000Z',
    verified_by: OWNER,
  };
  return verified;
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

function recoveryArtifactFixture(t, gate, policy, sourceIndex = 0) {
  const root = mkdtempSync(join(tmpdir(), 'nelyon-recovery-source-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const releaseDirectory = join(root, 'release');
  const gateDirectory = join(root, 'gate');
  const bundleDirectory = join(releaseDirectory, 'bundle');
  mkdirSync(bundleDirectory, { recursive: true });
  mkdirSync(gateDirectory, { recursive: true });
  const source = structuredClone(policy.postcheck_recovery.approved_sources[sourceIndex]);
  const sourceManifest = {
    schema_version: 1,
    identity: {
      approved_sha: source.source_sha,
      mode: 'release',
      release_id: source.release_id,
      run_attempt: source.run_attempt,
      run_id: source.run_id,
    },
    resources: {
      functions: source.edge_functions.map(item => item.name),
      migrations: source.expected_migrations.map(item => ({
        path: `supabase/migrations/${item.name}.sql`,
        version: item.name.slice(0, 14),
      })),
    },
  };
  const manifestBytes = gate.canonicalJson(sourceManifest);
  source.manifest_sha256 = gate.sha256Hex(manifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.json'), manifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.sha256'), `${source.manifest_sha256}\n`);
  writeFileSync(join(bundleDirectory, 'summary.md'), '# controlled source\n');
  const sourceRequest = {
    actor: policy.owner,
    triggeringActor: policy.owner,
    repository: policy.repository,
    ref: 'refs/heads/main',
    workflowRef: `${policy.repository}/${policy.workflow_path}@refs/heads/main`,
    approvedSha: source.source_sha,
    mainSha: source.source_sha,
    releaseId: source.release_id,
    mode: 'release',
    scopeConfirmation: 'RELEASE_HIGH_RISK',
    runId: source.run_id,
    runAttempt: source.run_attempt,
  };
  writeFileSync(join(releaseDirectory, 'request.json'), gate.canonicalJson(sourceRequest));
  writeFileSync(join(releaseDirectory, 'remote-evidence.json'), '{}\n');
  const observation = {
    schema_version: 1,
    result: 'INCOMPLETE_OR_FAILED',
    steps: {
      pre_snapshot: 'success',
      pre_verification: 'success',
      migration_dry_run: 'success',
      migrations: 'success',
      functions: 'success',
      post_snapshot: source.post_snapshot_status,
      postcheck: source.postcheck_status,
    },
    pre_evidence_sha256: source.pre_snapshot_evidence_sha256,
    post_evidence_sha256: source.post_snapshot_evidence_sha256,
    postcheck_file_sha256: null,
  };
  writeFileSync(join(gateDirectory, 'release-observation.json'), gate.canonicalJson(observation));
  const run = {
    id: Number(source.run_id),
    run_attempt: source.run_attempt,
    status: 'completed',
    conclusion: 'failure',
    event: 'workflow_dispatch',
    head_sha: source.source_sha,
    path: policy.workflow_path,
    repository: { full_name: policy.repository },
  };
  return {
    source,
    sourceManifest,
    observation,
    run,
    artifacts: [source.gate_artifact, source.release_artifact],
    releaseBundle: { directory: releaseDirectory },
    gateEvidence: { directory: gateDirectory },
  };
}

function adminRecoverySourceFixture(t, gate, policy) {
  const root = mkdtempSync(join(tmpdir(), 'nelyon-admin-recovery-source-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const releaseDirectory = join(root, 'release');
  const gateDirectory = join(root, 'gate');
  const adminDirectory = join(root, 'admin');
  const bundleDirectory = join(releaseDirectory, 'bundle');
  mkdirSync(bundleDirectory, { recursive: true });
  mkdirSync(gateDirectory, { recursive: true });
  mkdirSync(adminDirectory, { recursive: true });
  const sourceRunId = '987654321';
  const sourceRunAttempt = 2;
  const sourceReleaseId = 'nelyon-admin-source-release-20261031';
  const migrationItems = policy.superuser_control_center_transition.migrations.map(item => ({
    path: item.path, version: item.version, blob: item.blob, sha256: item.sha256,
  }));
  const sourceManifest = {
    schema_version: 1,
    identity: {
      approved_sha: MAIN_SHA, mode: 'release', release_id: sourceReleaseId,
      run_id: sourceRunId, run_attempt: sourceRunAttempt, scope_confirmation: 'RELEASE_HIGH_RISK',
    },
    delta: { productive_change_count: migrationItems.length },
    resources: {
      config_changed: false, function_contracts: [], functions: [], migrations: migrationItems,
      superuser_control_center_transition: {
        ...structuredClone(policy.superuser_control_center_transition), approved_sha: MAIN_SHA,
        baseline_descendant_verified: true, integration_base_descendant_verified: true,
        reviewed_bytes_verified: true,
      },
    },
    risk: { level: 'HIGH', findings: [] },
    result: 'PLAN READY',
  };
  const manifestBytes = gate.canonicalJson(sourceManifest);
  const manifestDigest = gate.sha256Hex(manifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.json'), manifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.sha256'), `${manifestDigest}\n`);
  writeFileSync(join(bundleDirectory, 'summary.md'), '# admin source\n');
  const sourceRequest = request({
    approvedSha: MAIN_SHA, mainSha: MAIN_SHA, mode: 'release', scopeConfirmation: 'RELEASE_HIGH_RISK',
    releaseId: sourceReleaseId, runId: sourceRunId, runAttempt: sourceRunAttempt,
  });
  writeFileSync(join(releaseDirectory, 'request.json'), gate.canonicalJson(sourceRequest));
  writeFileSync(join(releaseDirectory, 'remote-evidence.json'), '{}\n');

  const postSnapshot = { schema_version: 1, evidence_sha256: '4'.repeat(64) };
  const postcheck = {
    result: 'REMOTE_POSTCHECK_VERIFIED',
    changed_functions: [],
    function_attestations: [],
    applied_migrations: migrationItems.map(item => item.version),
    pre_evidence_sha256: '3'.repeat(64),
    post_evidence_sha256: postSnapshot.evidence_sha256,
  };
  writeFileSync(join(gateDirectory, 'postcheck-result.json'), gate.canonicalJson(postcheck));
  const adminManifest = {
    schema_version: 1, enabled: true,
    release: { approved_sha: MAIN_SHA, mode: 'release', release_id: sourceReleaseId,
      run_id: sourceRunId, run_attempt: sourceRunAttempt,
      manifest_sha256: gate.sha256Hex(gate.canonicalJson(sourceManifest).trimEnd()) },
    source: { sha256: gate.sha256Hex(gate.canonicalJson([]).trimEnd()), files: [] },
  };
  const adminManifestBytes = `${gate.canonicalJson(adminManifest).trimEnd()}\n`;
  writeFileSync(join(adminDirectory, 'admin-web-manifest.json'), adminManifestBytes);
  writeFileSync(join(adminDirectory, 'admin-web-manifest.sha256'), `${gate.sha256Hex(gate.canonicalJson(adminManifest).trimEnd())}\n`);
  const build = { approved_sha: MAIN_SHA, source_manifest_sha256: gate.sha256Hex(gate.canonicalJson(adminManifest).trimEnd()), dist_sha256: '6'.repeat(64), files: [] };
  const previous = { version_id: '11111111-1111-4111-8111-111111111111' };
  const beforeRoutes = { zone_id: 'zone-1', routes: [{ id: 'before', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }] };
  const candidate = { version_id: '22222222-2222-4222-8222-222222222222' };
  const promoted = { version_id: candidate.version_id };
  const recoveredRoutes = { zone_id: 'zone-1', routes: [{ id: 'after', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }] };
  const recoveredDeployment = { versions: [{ version_id: previous.version_id, percentage: 100 }] };
  for (const [name, value] of Object.entries({
    'admin-web-build.json': build,
    'admin-web-previous.json': previous,
    'admin-web-before-routes.json': beforeRoutes,
    'admin-web-candidate.json': candidate,
    'admin-web-promoted-version.json': promoted,
    'admin-web-recovered-routes.json': recoveredRoutes,
    'admin-web-recovered-deployment.json': recoveredDeployment,
  })) writeFileSync(join(adminDirectory, name), gate.canonicalJson(value));
  const recovery = {
    schema_version: 1, result: 'ADMIN_RECOVERY_VERIFIED', version_id: previous.version_id,
    routes_restored: true,
  };
  writeFileSync(join(adminDirectory, 'admin-web-recovery.json'), gate.canonicalJson(recovery));
  const observation = {
    schema_version: 1, result: 'INCOMPLETE_OR_FAILED',
    steps: { pre_snapshot: 'success', pre_verification: 'success', migration_dry_run: 'success', migrations: 'success', functions: 'success', post_snapshot: 'success', postcheck: 'success' },
    admin_web: { required: true, build: 'success', upload: 'success', candidate: 'success', promote: 'success', routes: 'success', finalize: 'failure', recovery: 'success', result_sha256: null,
      recovery_sha256: gate.sha256Hex(readFileSync(join(adminDirectory, 'admin-web-recovery.json'))) },
    pre_evidence_sha256: '3'.repeat(64), post_evidence_sha256: postSnapshot.evidence_sha256,
    postcheck_file_sha256: gate.sha256Hex(readFileSync(join(gateDirectory, 'postcheck-result.json'))),
  };
  writeFileSync(join(gateDirectory, 'release-observation.json'), gate.canonicalJson(observation));
  const names = {
    release: `nelyon-release-${sourceRunId}-${sourceRunAttempt}`,
    gate: `nelyon-gate-evidence-${sourceRunId}-${sourceRunAttempt}`,
    admin: `nelyon-admin-evidence-${sourceRunId}-${sourceRunAttempt}`,
  };
  const artifacts = Object.values(names).map((name, index) => ({
    id: index + 100, name, expired: false, digest: `sha256:${String(index + 7).repeat(64).slice(0, 64)}`,
  }));
  const run = {
    id: Number(sourceRunId), run_attempt: sourceRunAttempt, status: 'completed', conclusion: 'failure',
    event: 'workflow_dispatch', head_sha: MAIN_SHA, head_branch: 'main', path: policy.workflow_path,
    repository: { full_name: policy.repository },
  };
  const recoveryRequest = request({ mode: 'admin_recovery', scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: sourceRunId, productiveResources: [] });
  const recoveryManifest = {
    identity: { approved_sha: MAIN_SHA, mode: 'admin_recovery', release_id: recoveryRequest.releaseId,
      run_id: recoveryRequest.runId, run_attempt: recoveryRequest.runAttempt },
    recovery: { kind: 'admin_cloudflare_forward_completion', source_run_id: sourceRunId },
    resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] },
  };
  return { policy, recoveryRequest, recoveryManifest, run, artifacts,
    releaseBundle: { directory: releaseDirectory }, gateEvidence: { directory: gateDirectory },
    adminEvidence: { directory: adminDirectory }, sourceManifest, observation, names };
}

function bindAdminSourceFixtureToPostcheckChain(fixture, gate) {
  const originalSourceSha = 'e'.repeat(40);
  const recoveryRunId = '777777777';
  fixture.recoveryRequest.recoverySourceRunId = recoveryRunId;
  fixture.recoveryManifest.recovery.source_run_id = recoveryRunId;
  fixture.run.head_sha = originalSourceSha;

  fixture.sourceManifest.identity.approved_sha = originalSourceSha;
  fixture.sourceManifest.resources.superuser_control_center_transition.approved_sha = originalSourceSha;
  const sourceManifestBytes = gate.canonicalJson(fixture.sourceManifest);
  const sourceManifestSha256 = gate.sha256Hex(sourceManifestBytes);
  const bundleDirectory = join(fixture.releaseBundle.directory, 'bundle');
  writeFileSync(join(bundleDirectory, 'manifest.json'), sourceManifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.sha256'), `${sourceManifestSha256}\n`);

  const sourceRequestPath = join(fixture.releaseBundle.directory, 'request.json');
  const sourceRequest = JSON.parse(readFileSync(sourceRequestPath, 'utf8'));
  sourceRequest.approvedSha = originalSourceSha;
  sourceRequest.mainSha = originalSourceSha;
  writeFileSync(sourceRequestPath, gate.canonicalJson(sourceRequest));

  const adminManifestPath = join(fixture.adminEvidence.directory, 'admin-web-manifest.json');
  const adminManifest = JSON.parse(readFileSync(adminManifestPath, 'utf8'));
  adminManifest.release.approved_sha = originalSourceSha;
  adminManifest.release.manifest_sha256 = gate.sha256Hex(gate.canonicalJson(fixture.sourceManifest).trimEnd());
  const adminManifestCanonical = gate.canonicalJson(adminManifest).trimEnd();
  writeFileSync(adminManifestPath, `${adminManifestCanonical}\n`);
  writeFileSync(join(fixture.adminEvidence.directory, 'admin-web-manifest.sha256'),
    `${gate.sha256Hex(adminManifestCanonical)}\n`);
  const buildPath = join(fixture.adminEvidence.directory, 'admin-web-build.json');
  const build = JSON.parse(readFileSync(buildPath, 'utf8'));
  build.approved_sha = originalSourceSha;
  build.source_manifest_sha256 = gate.sha256Hex(adminManifestCanonical);
  writeFileSync(buildPath, gate.canonicalJson(build));

  fixture.observation.steps.postcheck = 'failure';
  fixture.observation.postcheck_file_sha256 = null;
  writeFileSync(join(fixture.gateEvidence.directory, 'release-observation.json'),
    gate.canonicalJson(fixture.observation));
  rmSync(join(fixture.gateEvidence.directory, 'postcheck-result.json'));

  const artifactsByName = new Map(fixture.artifacts.map(item => [item.name, item]));
  const chain = {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_POSTCHECK_CHAIN_VERIFIED',
    recovery_run_id: recoveryRunId,
    recovery_run_attempt: 1,
    recovery_release_id: 'nelyon-postcheck-recovery-20261031',
    current_sha: fixture.recoveryRequest.approvedSha,
    source_run_id: String(fixture.run.id),
    source_run_attempt: fixture.run.run_attempt,
    source_release_id: sourceRequest.releaseId,
    source_sha: originalSourceSha,
    source_manifest_sha256: sourceManifestSha256,
    source_observation_sha256: gate.sha256Hex(gate.canonicalJson(fixture.observation)),
    source_artifact_digests: {
      release: artifactsByName.get(fixture.names.release).digest,
      gate: artifactsByName.get(fixture.names.gate).digest,
    },
    recovery_artifacts: {
      release: { id: '701', name: `nelyon-release-${recoveryRunId}-1`, digest: `sha256:${'3'.repeat(64)}` },
      gate: { id: '702', name: `nelyon-gate-evidence-${recoveryRunId}-1`, digest: `sha256:${'4'.repeat(64)}` },
      recovery: { id: '703', name: `nelyon-postcheck-recovery-${recoveryRunId}-1`, digest: `sha256:${'5'.repeat(64)}` },
    },
    recovered_evidence_sha256: '9'.repeat(64),
    recovered_result_sha256: '8'.repeat(64),
  };
  return { fixture, chain, originalSourceSha, recoveryRunId };
}

async function recoveryStateFixture(t, gate, policy, sourceIndex = 0) {
  const adapter = await import(`${adapterUrl.href}?recovery=${Date.now()}-${Math.random()}`);
  const requestedSource = policy.postcheck_recovery.approved_sources[sourceIndex];
  const isF4Recovery = requestedSource.run_id === '40268500711';
  const isF5Recovery = requestedSource.run_id === '40324910390';
  const isStoriesRecovery = requestedSource.run_id === '40473092474';
  const isControlCenterRecovery = requestedSource.run_id === '41243646356';
  const isPostF5Recovery = isF5Recovery || isStoriesRecovery || isControlCenterRecovery;
  const controlledPolicy = isControlCenterRecovery
    ? asF5TransitionPolicy(policy)
    : isStoriesRecovery
    ? asStoriesB1TransitionPolicy(policy)
    : isF5Recovery
    ? asF5TransitionPolicy(policy)
    : isF4Recovery
      ? asF4TransitionPolicy(policy)
      : asF3TransitionPolicy(policy);
  if (isControlCenterRecovery) {
    controlledPolicy.baseline.sha = policy.superuser_control_center_transition.baseline_sha;
    controlledPolicy.baseline.migration_count = 361;
    controlledPolicy.baseline.latest_migration = F5_AUTONOMOUS_MIGRATION;
  }
  const recoveryRequest = request({
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: policy.postcheck_recovery.approved_sources[sourceIndex].run_id,
    productiveResources: [],
  });
  const adapterSourceSha256 = '6'.repeat(64);
  const recoveryManifest = {
    identity: {
      approved_sha: recoveryRequest.approvedSha,
      release_id: recoveryRequest.releaseId,
      run_id: recoveryRequest.runId,
      run_attempt: recoveryRequest.runAttempt,
      mode: 'postcheck_recovery',
    },
    compiler: {
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: adapterSourceSha256,
    },
    resources: { functions: [], function_contracts: [], migrations: [], config_changed: false },
  };
  const source = controlledPolicy.postcheck_recovery.approved_sources[sourceIndex];
  const latestMigration = source.expected_latest_migration;
  const migrationRows = [
    ...Array.from({ length: source.expected_migration_count - 1 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    { version: latestMigration.slice(0, 14), name: latestMigration.slice(15) },
  ];
  if (isF4Recovery || isPostF5Recovery) {
    const phaseOffset = isControlCenterRecovery ? 8 : isStoriesRecovery ? 7 : isF5Recovery ? 5 : 4;
    migrationRows[migrationRows.length - phaseOffset] = {
      version: '20261025011000',
      name: 'creator_premium_f3_bounded_financial_activation',
    };
    migrationRows[migrationRows.length - phaseOffset + 1] = {
      version: '20261025160452',
      name: 'creator_premium_f3_c2_isolated_canary_governance',
    };
    migrationRows[migrationRows.length - phaseOffset + 2] = {
      version: '20261025231500',
      name: 'creator_premium_f3_final_wallet_integration',
    };
    if (isPostF5Recovery) {
      migrationRows[migrationRows.length - phaseOffset + 3] = {
        version: '20261026030000',
        name: 'creator_premium_f4_general_bdag_activation',
      };
      if (isStoriesRecovery || isControlCenterRecovery) {
        migrationRows[migrationRows.length - phaseOffset + 4] = {
          version: '20261026072512',
          name: 'creator_premium_f5_autonomous_subscriptions',
        };
      }
      if (isStoriesRecovery) {
        migrationRows[migrationRows.length - phaseOffset + 5] = {
          version: '20261026120000',
          name: 'live_battles_final_c1',
        };
      }
    }
  }
  if (isControlCenterRecovery) {
    source.expected_migrations.forEach((migration, index) => {
      migrationRows[migrationRows.length - source.expected_migrations.length + index] = {
        version: migration.name.slice(0, 14),
        name: migration.name.slice(15),
      };
    });
  }
  const sourceFunctionNames = new Set(source.edge_functions.map(item => item.name));
  const stableManagedFunctions = controlledPolicy.supabase.managed_functions
    .filter(name => !sourceFunctionNames.has(name))
    .map((name, index) => ({
      slug: name,
      status: 'ACTIVE',
      version: index + 100,
      verify_jwt: true,
      ezbr_sha256: String(index + 100).padStart(64, '0'),
    }));
  const functionRows = [
    ...source.edge_functions.map(item => ({
      slug: item.name,
      status: item.status,
      version: item.version,
      verify_jwt: item.verify_jwt,
      ezbr_sha256: item.source_sha256,
    })),
    ...stableManagedFunctions,
    ...Array.from({ length: 34 - source.edge_functions.length - stableManagedFunctions.length }, (_, index) => ({
      slug: `unmanaged-${String(index + 1).padStart(2, '0')}`,
      status: 'ACTIVE',
      version: index + 1,
      verify_jwt: true,
      ezbr_sha256: String(index + 1).padStart(64, '0'),
    })),
  ];
  if (['40166468648', '40268500711', '40324910390', '40473092474'].includes(source.run_id)) {
    const baselineRunId = source.run_id === '40166468648'
      ? '40139736749'
      : source.run_id === '40324910390'
        ? '40166468648'
        : null;
    const baselineFunction = baselineRunId
      ? controlledPolicy.postcheck_recovery.approved_sources
        .find(item => item.run_id === baselineRunId)
        .edge_functions.find(item => item.name === 'bdag-ledger')
      : null;
    const storiesBaselineByName = new Map((source.edge_transitions ?? []).map(item => [item.name, item.from]));
    const baselineFunctionRows = isStoriesRecovery
      ? functionRows.map(item => {
        const baseline = storiesBaselineByName.get(item.slug);
        return baseline ? {
          slug: item.slug,
          status: baseline.status,
          version: baseline.version,
          verify_jwt: baseline.verify_jwt,
          ezbr_sha256: baseline.source_sha256,
        } : item;
      })
      : baselineFunction
      ? functionRows.map(item => item.slug === baselineFunction.name ? {
        slug: baselineFunction.name,
        status: baselineFunction.status,
        version: baselineFunction.version,
        verify_jwt: baselineFunction.verify_jwt,
        ezbr_sha256: baselineFunction.source_sha256,
      } : item)
      : functionRows;
    const managedNames = [...controlledPolicy.supabase.managed_functions].sort();
    const managedSet = new Set(managedNames);
    const blocked = new Set(controlledPolicy.baseline.blocked_resources);
    const managed = baselineFunctionRows.filter(item => managedSet.has(item.slug)).map(item => ({
      name: item.slug,
      source_sha256: item.ezbr_sha256,
      source_parity: !blocked.has(item.slug),
      verify_jwt: item.verify_jwt,
      version: item.version,
    })).sort((left, right) => left.name.localeCompare(right.name));
    const unmanaged = baselineFunctionRows.filter(item => !managedSet.has(item.slug))
      .map(item => ({ name: item.slug, version: item.version }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const digest = value => gate.sha256Hex(gate.canonicalJson(value));
    controlledPolicy.baseline.evidence_digests = {
      ...controlledPolicy.baseline.evidence_digests,
      migrations: digest(migrationRows.slice(0, -1).map(item => `${item.version}_${item.name}`)),
      managed_functions: digest(managed.map(item => ({
        name: item.name, version: item.version, verify_jwt: item.verify_jwt,
      }))),
      unmanaged_functions: digest(unmanaged),
      function_source_parity: digest(managed.map(item => ({
        name: item.name, source_sha256: item.source_sha256, source_parity: item.source_parity,
      }))),
      config_verify_jwt: digest({
        complete: true,
        managed_functions: managed.map(item => ({ name: item.name, verify_jwt: item.verify_jwt })),
      }),
    };
  }
  const zeroReconciliations = {
    account_balance_ledger_mismatch: 0,
    completed_credit_account_mismatch: 0,
    completed_credit_total_mismatch: 0,
    completed_debit_account_mismatch: 0,
    completed_debit_total_mismatch: 0,
    completed_without_credit: 0,
    completed_without_debit: 0,
    noncanonical_entry_type: 0,
    orphan_ledger_entries: 0,
    premium_finance_policy_row_count_mismatch: 0,
  };
  const financeTransactions = Array.from({ length: isPostF5Recovery ? 929 : 928 }, (_, index) => ({
    id: `transaction-${String(index).padStart(4, '0')}`,
    status: 'pending',
    currency: 'BDAG',
    created_at: '2026-10-17T20:00:00.000Z',
    blockchain_txid_sha256: null,
  }));
  const finance = {
    schema_version: 1,
    complete: true,
    query_id: 'nelyon-finance-snapshot-v1',
    database_time: '2026-10-17T22:00:00.000000Z',
    schema_sha256: '1'.repeat(64),
    watermark: { created_at: financeTransactions.at(-1).created_at, id: financeTransactions.at(-1).id },
    policy: (isF4Recovery || isPostF5Recovery)
      ? { purchase_enabled: true, subscription_enabled: true, refunds_enabled: true,
        platform_fee_bps: 2000, policy_version: 'creator-premium-f4-general-v1' }
      : { purchase_enabled: false, subscription_enabled: false, refunds_enabled: false,
        platform_fee_bps: 0, policy_version: 'creator-premium-b4-v1' },
    transactions: { complete: true, count: financeTransactions.length, items: financeTransactions },
    ledger_entries: { complete: true, count: isPostF5Recovery ? 1921 : 1918,
      items: Array.from({ length: isPostF5Recovery ? 1921 : 1918 }, (_, index) => ({ id: `entry-${index}` })) },
    ledger_accounts: {
      complete: true,
      count: isPostF5Recovery ? 132 : 131,
      items: Array.from({ length: isPostF5Recovery ? 132 : 131 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
        owner_id_sha256: '2'.repeat(64),
        account_type: 'user',
        currency: 'BDAG',
        created_at: '2026-10-01T12:00:00.000000Z',
      })),
    },
    premium_transaction_count: isPostF5Recovery ? 1 : 0,
    premium_bindings: {
      purchase_receipts: { count: 0, sha256: '3'.repeat(64) },
      subscription_periods: { count: isPostF5Recovery ? 1 : 0, sha256: '4'.repeat(64) },
    },
    reconciliation: zeroReconciliations,
  };
  const relationNames = [
    'creator_premium_contents', 'creator_premium_finance_policy', 'creator_premium_offer_versions',
    'creator_premium_plan_contents', 'creator_premium_plans', 'creator_premium_purchase_receipts',
    'creator_premium_subscription_periods', 'creator_premium_subscriptions',
  ];
  if (['39157300357', '39195966131', '40139736749', '40166468648', '40268500711',
    '40324910390', '40473092474', '41243646356'].includes(source.run_id)) {
    relationNames.unshift('creator_premium_content_safety_context_evaluations');
  }
  if (['40166468648', '40268500711', '40324910390', '40473092474', '41243646356']
    .includes(source.run_id)) {
    relationNames.push('creator_premium_finance_authorizations');
  }
  if (isF4Recovery || isPostF5Recovery) relationNames.push('creator_premium_finance_owner_attestations_f3_c2');
  if (isPostF5Recovery) relationNames.push(
    'creator_premium_auto_renewal_attempts',
    'creator_premium_auto_renewal_mandates',
  );
  const captureMigrationRows = isControlCenterRecovery
    ? migrationRows.filter(item => ![
      '20261025011000',
      '20261025160452',
      '20261025231500',
      '20261026030000',
      '20261026072512',
    ].includes(item.version))
    : isStoriesRecovery
    ? migrationRows.filter(item => ![
      '20261025011000',
      '20261025160452',
      '20261026030000',
      '20261026072512',
    ].includes(item.version))
    : isF5Recovery
    ? migrationRows.slice(0, -5)
    : isF4Recovery
      ? migrationRows.slice(0, -4)
    : source.run_id === '40166468648'
      ? migrationRows.slice(0, -1)
      : migrationRows;
  const capturePolicy = isStoriesRecovery ? structuredClone(controlledPolicy) : controlledPolicy;
  if (isStoriesRecovery) {
    capturePolicy.baseline.latest_migration = source.expected_latest_migration;
    capturePolicy.baseline.migration_count = source.expected_migration_count;
  }
  const captureExceptionMigrations = isControlCenterRecovery ? {
    complete: true,
    count: captureMigrationRows.length,
    items: captureMigrationRows,
    latest: captureMigrationRows.at(-1),
    sha256: gate.sha256Hex(gate.canonicalJson(captureMigrationRows)),
  } : { items: captureMigrationRows };
  const captureRecoveryExceptions = adapter.advisorExceptionsForPhase(
    capturePolicy,
    recoveryManifest,
    'recovery',
    { request: recoveryRequest, migrations: captureExceptionMigrations },
  );
  const storyB1RelationNames = isStoriesRecovery
    ? controlledPolicy.stories_b1_transition.security_advisor.introduced_exceptions
      .filter(exception => exception.advisor_type === 'table')
      .map(exception => exception.object.name)
      .sort()
    : [];
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/health')) {
      return json(['auth', 'db', 'pooler', 'realtime', 'rest', 'storage'].map(name => ({ name, healthy: true, status: 'ACTIVE_HEALTHY' })));
    }
    if (pathname.endsWith('/database/migrations')) return json(captureMigrationRows);
    if (pathname.endsWith('/functions')) return json(functionRows);
    if (pathname.endsWith('/advisors/security')) return json({ lints: [] });
    if (pathname.endsWith('/database/backups')) {
      return json({ backups: [{ id: '1988056631', inserted_at: '2026-10-17T05:15:56.590Z', is_physical_backup: true, status: 'COMPLETED' }] });
    }
    if (pathname.endsWith('/database/query/read-only')) {
      const body = JSON.parse(options.body);
      if (body.query.includes('nelyon-finance-snapshot-v1')) return json([{ snapshot: finance }], 201);
      if (body.query.includes('nelyon-cron-snapshot-v1')) {
        const cronItems = isPostF5Recovery ? [{
          active: true,
          command_sha256: gate.sha256Hex(controlledPolicy.finance_authority_f5_transition.cron_job.command),
          database: 'postgres',
          jobid: '1',
          jobname: 'creator-premium-auto-renewals-f5',
          legacy_normalized_command_sha256:
            controlledPolicy.finance_authority_f5_transition.cron_job.normalized_command_sha256,
          nodename: 'localhost',
          nodeport: 5432,
          schedule: '*/5 * * * *',
          username: 'postgres',
        }] : [];
        return json([{ snapshot: { schema_version: 1, complete: true,
          query_id: 'nelyon-cron-snapshot-v1', count: cronItems.length, items: cronItems } }], 201);
      }
      if (body.query.includes('pg_get_function_identity_arguments')) {
        return json(captureRecoveryExceptions
          .filter(exception => Array.isArray(exception.object.argument_types))
          .map(exception => ({
          schema: exception.object.schema,
          name: exception.object.name,
          identity_arguments: exception.object.identity_arguments,
          argument_types: exception.object.argument_types,
          security_definer: exception.attestation.security_definer,
          owner: exception.attestation.owner,
          search_path: exception.attestation.search_path,
          acl: exception.attestation.acl,
          execute: exception.attestation.execute,
          definition: `CREATE FUNCTION public.${exception.object.name}() RETURNS jsonb SECURITY DEFINER`,
          })), 201);
      }
      if (body.query.includes('nelyon-premium-postcheck-state-v1')) {
        return json([{ snapshot: {
          schema_version: 1,
          complete: true,
          query_id: 'nelyon-premium-postcheck-state-v1',
          approved_rule_count: 0,
          active_rule_count: 0,
          fabricated_pass_count: 0,
          content_count: source.premium_legacy.content_count,
          pending_review_count: source.premium_legacy.pending_review_count,
          deleted_count: source.premium_legacy.deleted_count,
          relations: relationNames.map(name => ({
            schema: 'private', name, owner: 'postgres', rls_enabled: true, force_rls: true,
            acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
              .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
          })),
        } }], 201);
      }
      if (body.query.includes("'story_b1_worker_lane_state'")) {
        return json([{ snapshot: {
          schema_version: 1,
          complete: true,
          infrastructure_installed: true,
          owner_approved_policy: false,
          activation: false,
          mode: 'fail_closed_review',
          story_count: 0,
          direct_story_count: 0,
          safety_state_counts: { blocked: 0, passed: 0, pending: 0, review: 0 },
          complete_evidence_count: 0,
          complete_evidence_non_review_count: 0,
          incomplete_evidence_non_pending_count: 0,
          complete_evidence_pass_count: 0,
          fabricated_pass_count: 0,
          relations: storyB1RelationNames.map(name => ({
            schema: 'private', name, owner: 'postgres', rls_enabled: true, force_rls: true,
            acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
              .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
          })),
        } }], 201);
      }
      if (body.query === adapter.SUPERUSER_CONTROL_CENTER_STATE_SQL) {
        const transition = controlledPolicy.superuser_control_center_transition;
        return json([{ snapshot: {
          schema_version: 1,
          complete: true,
          installed: true,
          capability_count: transition.required_aal_catalog.capability_count,
          aal2_codes: transition.required_aal_catalog.aal2_codes,
          refund_roles: transition.required_aal_catalog.refund_roles,
          root_role: transition.required_aal_catalog.root_role,
          root_grant_rule_count: transition.required_aal_catalog.root_grant_rule_count,
          functions: transition.function_definitions,
          predecessor_function: null,
          index: {
            schema: transition.index_attestation.schema,
            table: transition.index_attestation.table,
            name: transition.index_attestation.name,
            owner: transition.index_attestation.owner,
            definition: transition.index_attestation.definition,
            valid: transition.index_attestation.valid,
            ready: transition.index_attestation.ready,
            unique: transition.index_attestation.unique,
            primary: transition.index_attestation.primary,
          },
          bounded_observations: {
            probe_limit: transition.bounded_postcheck.probe_limit,
            mfa_factors: { observed_rows: 1, saturated: false },
            admin_action_audit: { observed_rows: 112, saturated: false },
            advertising_ads: { observed_rows: 5, saturated: false },
            admin_audit_release_attributed: false,
          },
        } }], 201);
      }
    }
    throw new Error(`unexpected recovery fixture request ${url}`);
  };
  const currentEvidence = await adapter.captureProductionSnapshot({
    phase: 'recovery',
    policy: capturePolicy,
    request: recoveryRequest,
    manifest: recoveryManifest,
    token: 'fixture-token',
    fetchImpl,
    observedAt: '2026-10-17T22:00:01.000Z',
    adapterSourceSha256,
  });
  if (['40166468648', '40268500711', '40324910390', '40473092474', '41243646356']
    .includes(source.run_id)) {
    currentEvidence.migrations = {
      complete: true,
      count: migrationRows.length,
      items: migrationRows,
      latest: migrationRows.at(-1),
      sha256: gate.sha256Hex(gate.canonicalJson(migrationRows)),
    };
    const financeQueries = adapter.selectFinanceSnapshotQueries(currentEvidence.migrations);
    const authorityPhase = isPostF5Recovery ? 'f5_autonomous' : isF4Recovery ? 'f4_general' : 'f3_foundation';
    const expectedAuthority = controlledPolicy.finance_authority[authorityPhase];
    const effectiveFunctions = new Map(controlledPolicy.finance_authority.f3_foundation.functions
      .map(item => [item.identity, item]));
    if (isF4Recovery || isPostF5Recovery) {
      const phases = isPostF5Recovery ? ['f3_c2', 'f4_general', 'f5_autonomous'] : ['f3_c2', 'f4_general'];
      for (const phase of phases) {
        for (const item of controlledPolicy.finance_authority[phase].function_overrides) {
          effectiveFunctions.set(item.identity, item);
        }
        for (const item of controlledPolicy.finance_authority[phase].function_additions) {
          effectiveFunctions.set(item.identity, item);
        }
      }
    }
    const unsignedAuthority = {
      schema_version: 1,
      complete: true,
      phase: authorityPhase,
      relations: [...expectedAuthority.relations]
        .sort((left, right) => left.identity.localeCompare(right.identity)),
      functions: (isF4Recovery || isPostF5Recovery)
        ? [...effectiveFunctions.values()].sort((left, right) => left.identity.localeCompare(right.identity))
        : expectedAuthority.functions,
      legacy_relations: ['public.financial_transactions', 'public.ledger_accounts', 'public.ledger_entries']
        .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
      legacy_functions: controlledPolicy.finance_authority.f3_foundation.legacy_function_identities
        .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
    };
    currentEvidence.finance_authority = {
      ...unsignedAuthority,
      sha256: gate.sha256Hex(gate.canonicalJson(unsignedAuthority)),
    };
    const configurationDigest = gate.sha256Hex('f4-general-configuration');
    const approvalDigest = gate.sha256Hex('f4-general-owner-approval');
    currentEvidence.finance_facts = {
      schema_version: 1,
      complete: true,
      phase: authorityPhase,
      policy: (isF4Recovery || isPostF5Recovery) ? {
        activation_mode: 'general',
        active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
        purchase_enabled: true,
        subscription_enabled: true,
        refunds_enabled: true,
        platform_fee_bps: 2000,
      } : {
        activation_mode: 'off', active_authorization_id: null,
        purchase_enabled: false, subscription_enabled: false,
        refunds_enabled: false, platform_fee_bps: 0,
      },
      ...((isF4Recovery || isPostF5Recovery) ? { attestations: [{
        id: gate.sha256Hex('f4-general-attestation'),
        configuration_digest: configurationDigest,
        approval_digest: approvalDigest,
        fact_sha256: gate.sha256Hex('f4-general-attestation-fact'),
      }] } : {}),
      authorizations: (isF4Recovery || isPostF5Recovery) ? [{
        id: gate.sha256Hex('f4000000-0000-4000-8000-000000000001'),
        authorization_scope: 'GENERAL',
        client_contract: 'creator-premium-f3-v2',
        status: 'OPEN',
        platform_fee_bps: 2000,
        configuration_digest: configurationDigest,
        approval_digest: approvalDigest,
        buyer_id: null,
        creator_id: null,
        buyer_account_id: null,
        creator_account_id: null,
        purchase_content_id: null,
        purchase_offer_version_id: null,
        subscription_plan_id: null,
        purchase_amount_bdag: null,
        subscription_amount_bdag: null,
        max_purchase_count: null,
        max_subscription_count: null,
        max_refund_count: null,
        max_gross_bdag: null,
        charge_expires_at: null,
        refund_expires_at: null,
        fact_sha256: gate.sha256Hex('f4-general-authorization-fact'),
      }] : [],
      ...(isPostF5Recovery ? { mandates: [], attempts: [] } : {}),
      receipts: [],
      periods: isPostF5Recovery ? [{
        id: gate.sha256Hex('historical-period'),
        fact_sha256: gate.sha256Hex('historical-period-fact'),
      }] : [],
      subscriptions: isPostF5Recovery ? [{
        id: gate.sha256Hex('historical-subscription'),
        fact_sha256: gate.sha256Hex('historical-subscription-fact'),
      }] : [],
      transactions: isPostF5Recovery ? [{
        id: gate.sha256Hex('historical-premium-transaction'),
        fact_sha256: gate.sha256Hex('historical-premium-transaction-fact'),
      }] : [],
      acquisition_exposure_bdag: isPostF5Recovery ? '100.00000000' : '0.00000000',
      release_movement_bdag: '0.00000000',
      reconciliation: (isF4Recovery || isPostF5Recovery) ? {
        purchase_binding_mismatches: 0,
        period_binding_mismatches: 0,
        orphan_premium_transactions: 0,
        orphan_premium_ledger_entries: 0,
        subscriptions_without_period: 0,
        multiple_periods_per_relationship: 0,
        duplicate_open_relationships: 0,
      } : { purchase_binding_mismatches: 0, period_binding_mismatches: 0 },
    };
    currentEvidence.finance.schema_sha256 = expectedAuthority.schema_sha256;
    const financeQueryReceipts = [
      { id: 'nelyon-finance-authority-v1', sha256: gate.sha256Hex(financeQueries.authority) },
      { id: `nelyon-finance-facts-${authorityPhase}-v1`, sha256: gate.sha256Hex(financeQueries.facts) },
    ];
    const financeRequestReceipts = [
      { method: 'POST', path: `/v1/projects/${PROJECT_REF}/database/query/read-only`, status: 201, response_sha256: 'a'.repeat(64) },
      { method: 'POST', path: `/v1/projects/${PROJECT_REF}/database/query/read-only`, status: 201, response_sha256: 'b'.repeat(64) },
    ];
    if (isStoriesRecovery || isControlCenterRecovery) {
      const domainQueryIndex = currentEvidence.adapter.queries.findIndex(item => (
        item.id.startsWith('nelyon-stories-b1-')
          || item.id === 'nelyon-superuser-control-center-state-v1'
      ));
      currentEvidence.adapter.queries.splice(domainQueryIndex, 0, ...financeQueryReceipts);
      currentEvidence.requests.splice(currentEvidence.requests.length - 1, 0, ...financeRequestReceipts);
    } else {
      currentEvidence.adapter.queries.push(...financeQueryReceipts);
      currentEvidence.requests.push(...financeRequestReceipts);
    }
  }
  const recoveryExceptions = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    recoveryManifest,
    'recovery',
    { request: recoveryRequest, migrations: currentEvidence.migrations },
  );
  const rpcItems = recoveryExceptions
    .filter(exception => Array.isArray(exception.object.argument_types))
    .map(exception => ({
    schema: exception.object.schema,
    name: exception.object.name,
    identity_arguments: exception.object.identity_arguments,
    argument_types: exception.object.argument_types,
    security_definer: exception.attestation.security_definer,
    owner: exception.attestation.owner,
    search_path: exception.attestation.search_path,
    acl: exception.attestation.acl,
    execute: exception.attestation.execute,
    definition_sha256: exception.attestation.definition_sha256,
    })).sort((left, right) => `${left.schema}.${left.name}(${left.argument_types.join(',')})`.localeCompare(`${right.schema}.${right.name}(${right.argument_types.join(',')})`));
  currentEvidence.rpc_security = { complete: true, count: rpcItems.length, items: rpcItems, sha256: gate.sha256Hex(gate.canonicalJson(rpcItems)) };
  const baselineAdvisorItems = Array.from({ length: isStoriesRecovery ? 552 : 554 }, (_, index) => ({
    fingerprint: String(index + 1).padStart(64, '0'),
    level: 'WARN',
    resource_kind: 'table',
  }));
  const replacedHistoricalAdvisorFindings = isControlCenterRecovery ? [
    {
      fingerprint: controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_fingerprint,
      level: controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_severity,
      resource_kind: controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_type,
    },
  ] : [];
  if (replacedHistoricalAdvisorFindings.length > 0) {
    baselineAdvisorItems.splice(0, replacedHistoricalAdvisorFindings.length,
      ...replacedHistoricalAdvisorFindings);
  }
  const expectedF5RelationFindings = isPostF5Recovery ? [
    {
      fingerprint: '70d2706125a8861824f9c876848c472a28bde6db0813543ba97ec3409516967f',
      level: 'INFO',
      resource_kind: 'table',
    },
    {
      fingerprint: 'd37d10aa8c56fc907ce6ce86f44aafcb36f8bd6c7d719cc33032fe1561eee56d',
      level: 'INFO',
      resource_kind: 'table',
    },
  ] : [];
  const selectedFingerprints = new Set(recoveryExceptions.map(exception => exception.advisor_fingerprint));
  const replacedHistoricalFingerprints = new Set(
    replacedHistoricalAdvisorFindings.map(item => item.fingerprint),
  );
  const advisorItems = [
    ...baselineAdvisorItems.filter(item => !replacedHistoricalFingerprints.has(item.fingerprint)),
    ...recoveryExceptions.map(exception => ({
    fingerprint: exception.advisor_fingerprint,
    level: exception.advisor_severity,
    resource_kind: exception.advisor_type,
    })),
    ...expectedF5RelationFindings.filter(item => !selectedFingerprints.has(item.fingerprint)),
  ]
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  currentEvidence.cron_security.advisors = {
    complete: true,
    count: advisorItems.length,
    items: advisorItems,
    sha256: gate.sha256Hex(gate.canonicalJson(advisorItems)),
  };
  if (isControlCenterRecovery) {
    const transition = controlledPolicy.superuser_control_center_transition;
    transition.security_advisor.transition.after_count = advisorItems.length;
    transition.security_advisor.transition.after_sha256 =
      currentEvidence.cron_security.advisors.sha256;
    const additions = new Set(transition.security_advisor.introduced_exceptions
      .map(item => item.advisor_fingerprint));
    const predecessor = transition.security_advisor.predecessor_exception;
    const baselineControlCenterAdvisorItems = [
      ...advisorItems.filter(item => !additions.has(item.fingerprint)),
      {
        fingerprint: predecessor.advisor_fingerprint,
        level: predecessor.advisor_severity,
        resource_kind: predecessor.advisor_type,
      },
    ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    const baselineMigrationItems = migrationRows.slice(0, controlledPolicy.baseline.migration_count);
    const baselineEvidence = {
      ...currentEvidence,
      migrations: {
        complete: true,
        count: baselineMigrationItems.length,
        items: baselineMigrationItems,
        latest: baselineMigrationItems.at(-1),
        sha256: gate.sha256Hex(gate.canonicalJson(baselineMigrationItems)),
      },
      cron_security: {
        ...currentEvidence.cron_security,
        advisors: {
          complete: true,
          count: baselineControlCenterAdvisorItems.length,
          items: baselineControlCenterAdvisorItems,
          sha256: gate.sha256Hex(gate.canonicalJson(baselineControlCenterAdvisorItems)),
        },
      },
    };
    controlledPolicy.baseline.evidence_digests = adapter.buildProductionBaselineDigests({
      evidence: baselineEvidence,
      policy: controlledPolicy,
    });
  }
  const reviewedCronItems = isPostF5Recovery
    ? currentEvidence.cron_security.cron.items.filter(item => item.jobname !== 'creator-premium-auto-renewals-f5')
    : currentEvidence.cron_security.cron.items;
  const reconstructedAdvisorItems = isStoriesRecovery
    ? [...baselineAdvisorItems, ...controlledPolicy.stories_b1_transition.security_advisor.removed_findings.map(item => ({
      fingerprint: item.fingerprint,
      level: item.level,
      resource_kind: item.resource_kind,
    }))].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
    : [...baselineAdvisorItems].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  controlledPolicy.security_advisor.baseline.cron_security_sha256 = gate.sha256Hex(gate.canonicalJson({
    complete: true,
    cron: adapter.projectCronBaselineItems(reviewedCronItems, true),
    security_findings: reconstructedAdvisorItems,
  }));
  const { evidence_sha256: ignored, ...unsignedEvidence } = currentEvidence;
  currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsignedEvidence));
  const sourceManifest = {
    identity: { approved_sha: source.source_sha, release_id: source.release_id, run_id: source.run_id, run_attempt: source.run_attempt, mode: 'release' },
    resources: {
      functions: source.edge_functions.map(item => item.name),
      migrations: source.expected_migrations.map(item => ({
        path: `supabase/migrations/${item.name}.sql`,
        version: item.name.slice(0, 14),
      })),
    },
  };
  const sourceObservation = {
    result: 'INCOMPLETE_OR_FAILED',
    steps: {
      pre_snapshot: 'success',
      pre_verification: 'success',
      migration_dry_run: 'success',
      migrations: 'success',
      functions: 'success',
      post_snapshot: source.post_snapshot_status,
      postcheck: source.postcheck_status,
    },
    pre_evidence_sha256: source.pre_snapshot_evidence_sha256,
    post_evidence_sha256: source.post_snapshot_evidence_sha256,
  };
  return { adapterSourceSha256, controlledPolicy, recoveryRequest, recoveryManifest, sourceManifest, sourceObservation, currentEvidence };
}

async function adminPostcheckRecoveryChainFixture(t, gate, policy) {
  const state = await recoveryStateFixture(t, gate, policy, 0);
  const root = mkdtempSync(join(tmpdir(), 'nelyon-admin-postcheck-chain-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const releaseDirectory = join(root, 'release');
  const gateDirectory = join(root, 'gate');
  const recoveryDirectory = join(root, 'recovery');
  const bundleDirectory = join(releaseDirectory, 'bundle');
  mkdirSync(bundleDirectory, { recursive: true });
  mkdirSync(gateDirectory, { recursive: true });
  mkdirSync(recoveryDirectory, { recursive: true });

  const chainRequest = structuredClone(state.recoveryRequest);
  const chainManifest = structuredClone(state.recoveryManifest);
  const chainManifestBytes = gate.canonicalJson(chainManifest);
  const chainManifestSha256 = gate.sha256Hex(chainManifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.json'), chainManifestBytes);
  writeFileSync(join(bundleDirectory, 'manifest.sha256'), `${chainManifestSha256}\n`);
  writeFileSync(join(bundleDirectory, 'summary.md'), '# postcheck recovery source\n');
  writeFileSync(join(releaseDirectory, 'request.json'), gate.canonicalJson(chainRequest));
  writeFileSync(join(releaseDirectory, 'remote-evidence.json'), '{}\n');

  const policySha256 = '7'.repeat(64);
  const gateProof = {
    schema_version: 1,
    result: 'GATE_VERIFIED',
    run_id: chainRequest.runId,
    run_attempt: chainRequest.runAttempt,
    environment: { id: state.controlledPolicy.environment.id, name: state.controlledPolicy.environment.name },
    release_id: chainRequest.releaseId,
    approved_sha: chainRequest.approvedSha,
    policy_sha256: policySha256,
    manifest_sha256: chainManifestSha256,
    authorization_mode: state.controlledPolicy.environment.authorization_mode,
    auto_deploy_expectation: { declared_state: 'OFF' },
    approval_token_sha256: null,
  };
  writeFileSync(join(gateDirectory, 'gate-proof.json'), gate.canonicalJson(gateProof));

  const source = state.controlledPolicy.postcheck_recovery.approved_sources[0];
  const sourceManifestSha256 = gate.sha256Hex(gate.canonicalJson(state.sourceManifest));
  source.manifest_sha256 = sourceManifestSha256;
  const verifiedSource = {
    schema_version: 1,
    result: 'RECOVERY_SOURCE_VERIFIED',
    source_run_id: source.run_id,
    source_release_id: source.release_id,
    source_sha: source.source_sha,
    manifest_sha256: source.manifest_sha256,
    source_artifact_digests: {
      gate: source.gate_artifact.digest,
      release: source.release_artifact.digest,
    },
    source_manifest: state.sourceManifest,
    source_request: {
      actor: state.controlledPolicy.owner,
      triggeringActor: state.controlledPolicy.owner,
      repository: state.controlledPolicy.repository,
      ref: 'refs/heads/main',
      workflowRef: `${state.controlledPolicy.repository}/${state.controlledPolicy.workflow_path}@refs/heads/main`,
      approvedSha: source.source_sha,
      mainSha: source.source_sha,
      releaseId: source.release_id,
      mode: 'release',
      scopeConfirmation: 'RELEASE_HIGH_RISK',
      runId: source.run_id,
      runAttempt: source.run_attempt,
    },
    source_observation: state.sourceObservation,
  };
  const recoveryResult = gate.verifyPostcheckRecovery({
    policy: state.controlledPolicy,
    recoveryRequest: chainRequest,
    recoveryManifest: chainManifest,
    sourceManifest: state.sourceManifest,
    sourceObservation: state.sourceObservation,
    currentEvidence: state.currentEvidence,
    adapterSourceSha256: state.adapterSourceSha256,
  });
  writeFileSync(join(recoveryDirectory, 'verified-source.json'), gate.canonicalJson(verifiedSource));
  writeFileSync(join(recoveryDirectory, 'production-recovery.json'), gate.canonicalJson(state.currentEvidence));
  writeFileSync(join(recoveryDirectory, 'postcheck-recovery-result.json'), gate.canonicalJson(recoveryResult));

  const chainRunId = String(chainRequest.runId);
  const chainRunAttempt = chainRequest.runAttempt;
  const names = {
    release: `nelyon-release-${chainRunId}-${chainRunAttempt}`,
    gate: `nelyon-gate-evidence-${chainRunId}-${chainRunAttempt}`,
    recovery: `nelyon-postcheck-recovery-${chainRunId}-${chainRunAttempt}`,
  };
  const artifacts = Object.values(names).map((name, index) => ({
    id: index + 700,
    name,
    expired: false,
    digest: `sha256:${String(index + 3).repeat(64).slice(0, 64)}`,
  }));
  const run = {
    id: Number(chainRunId),
    run_attempt: chainRunAttempt,
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
    head_sha: chainRequest.approvedSha,
    head_branch: 'main',
    path: state.controlledPolicy.workflow_path,
    repository: { full_name: state.controlledPolicy.repository },
  };
  const recoveryRequest = request({
    runId: '223456789',
    releaseId: 'nelyon-admin-chain-recovery-20261031',
    mode: 'admin_recovery',
    scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: chainRunId,
    productiveResources: [],
  });
  const recoveryManifest = {
    identity: {
      approved_sha: recoveryRequest.approvedSha,
      mode: 'admin_recovery',
      release_id: recoveryRequest.releaseId,
      run_id: recoveryRequest.runId,
      run_attempt: recoveryRequest.runAttempt,
    },
    recovery: { kind: 'admin_cloudflare_forward_completion', source_run_id: chainRunId },
    resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] },
  };
  return {
    policy: state.controlledPolicy,
    policySha256,
    recoveryRequest,
    recoveryManifest,
    run,
    artifacts,
    releaseBundle: { directory: releaseDirectory },
    gateEvidence: { directory: gateDirectory },
    recoveryEvidence: { directory: recoveryDirectory },
    adapterSourceSha256: state.adapterSourceSha256,
    names,
    source,
    verifiedSource,
    recoveryResult,
  };
}

test('policy accepts the exact repository owner project modes and managed functions', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validatePolicy(policy), true);
  assert.equal(policy.owner, OWNER);
  assert.equal(policy.repository, REPOSITORY);
  assert.equal(policy.supabase.project_ref, PROJECT_REF);
  assert.equal(policy.schema_version, 2);
  assert.deepEqual(policy.modes, ['plan_only', 'gate_proof', 'release', 'admin_recovery', 'postcheck_recovery']);
  assert.deepEqual(policy.scope_confirmations, {
    admin_recovery: 'ADMIN_RECOVERY_EXACT_SOURCE',
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    plan_only: 'PLAN_ONLY',
    release_high_risk: 'RELEASE_HIGH_RISK',
    release_standard: 'RELEASE_STANDARD',
    postcheck_recovery: 'POSTCHECK_RECOVERY_READ_ONLY',
  });
  assert.deepEqual(policy.supabase.managed_functions, MANAGED_FUNCTIONS);
  assert.deepEqual(policy.supabase.forbidden_functions, ['bdag-economy']);
  assert.deepEqual(policy.secrets, ['SUPABASE_ACCESS_TOKEN']);
  assert.deepEqual(policy.supabase.backup, {
    max_age_seconds: 86400,
    require_physical: true,
    required_status: 'COMPLETED',
  });
  assert.equal(policy.environment.authorization_mode, 'automatic');
  assert.equal(policy.environment.id, 23906772073);
  assert.equal(policy.environment.required_reviewer, null);
});

test('policy binds the sole F2 managed-scope transition to immutable evidence and Finance OFF', async () => {
  const { gate, policy: installedPolicy } = await loadGateAndPolicy();
  const policy = asF3TransitionPolicy(installedPolicy);
  assert.deepEqual(policy.managed_scope_transitions, [F2_MANAGED_SCOPE_TRANSITION]);
  for (const mutate of [
    candidate => { candidate.managed_scope_transitions = []; },
    candidate => { candidate.managed_scope_transitions[0].resource = 'another-function'; },
    candidate => { candidate.managed_scope_transitions[0].baseline_sha = '0'.repeat(40); },
    candidate => { candidate.managed_scope_transitions[0].migration_blob = '0'.repeat(40); },
    candidate => { candidate.managed_scope_transitions[0].function_source_sha256 = '0'.repeat(64); },
    candidate => { candidate.managed_scope_transitions[0].finance_off_required = false; },
    candidate => { candidate.managed_scope_transitions[0].requires_postcheck = false; },
    candidate => { candidate.managed_scope_transitions[0].requires_separate_baseline_promotion = false; },
    candidate => { candidate.supabase.finance_policy.purchase_enabled = true; },
  ]) {
    const changed = structuredClone(policy);
    mutate(changed);
    assertDenied(() => gate.validatePolicy(changed), 'INVALID_MANAGED_SCOPE_TRANSITION');
  }
});

test('F2 managed-scope transition binds Git ancestry and the exact committed migration blob', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transitionPolicy = structuredClone(policy);
  transitionPolicy.baseline.sha = F2_MANAGED_SCOPE_TRANSITION.baseline_sha;
  const migrations = [{
    path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql',
    version: '20261024173500',
  }];
  const runGit = args => {
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args[0] === 'rev-parse') return `${F2_MANAGED_SCOPE_TRANSITION.migration_blob}\n`;
    throw new Error(`unexpected git command ${args.join(' ')}`);
  };
  const attested = gate.attestManagedScopeTransition({
    cwd: 'C:/repo',
    policy: transitionPolicy,
    approvedSha: 'a'.repeat(40),
    migrations,
    affectedFunctions: ['bdag-ledger'],
    runGit,
  });
  assert.equal(attested.migrations[0].blob, F2_MANAGED_SCOPE_TRANSITION.migration_blob);
  assert.deepEqual(attested.attestation, {
    id: F2_MANAGED_SCOPE_TRANSITION.id,
    attested_source_sha: F2_MANAGED_SCOPE_TRANSITION.attested_source_sha,
    approved_sha: 'a'.repeat(40),
    descendant_verified: true,
    migration_blob: F2_MANAGED_SCOPE_TRANSITION.migration_blob,
  });

  const recovery = gate.attestManagedScopeTransition({
    cwd: 'C:/repo',
    policy: transitionPolicy,
    mode: 'postcheck_recovery',
    approvedSha: 'a'.repeat(40),
    migrations,
    affectedFunctions: ['bdag-ledger'],
    runGit: () => { throw new Error('recovery must not inspect transition Git evidence'); },
  });
  assert.deepEqual(recovery, { migrations, attestation: null });

  assertDenied(() => gate.attestManagedScopeTransition({
    cwd: 'C:/repo',
    policy: transitionPolicy,
    approvedSha: 'a'.repeat(40),
    migrations,
    affectedFunctions: ['bdag-ledger'],
    runGit: args => args[0] === 'rev-parse' ? `${'0'.repeat(40)}\n` : '',
  }), 'INVALID_MANAGED_SCOPE_TRANSITION');

  assertDenied(() => gate.attestManagedScopeTransition({
    cwd: 'C:/repo',
    policy: transitionPolicy,
    approvedSha: 'a'.repeat(40),
    migrations,
    affectedFunctions: ['bdag-ledger'],
    runGit: args => {
      if (args[0] === 'merge-base') throw new Error('not ancestor');
      return '';
    },
  }), 'INVALID_MANAGED_SCOPE_TRANSITION');

  assert.notEqual(policy.baseline.sha, F2_MANAGED_SCOPE_TRANSITION.baseline_sha);
  const retired = gate.attestManagedScopeTransition({
    cwd: 'C:/repo',
    policy,
    approvedSha: 'a'.repeat(40),
    migrations,
    affectedFunctions: ['bdag-ledger'],
    runGit: () => { throw new Error('promoted baseline must not inspect retired transition evidence'); },
  });
  assert.deepEqual(retired, { migrations, attestation: null });
});

test('Security Advisor exceptions are exact object-bound verified attestations', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validateSecurityAdvisorPolicy(policy.security_advisor), true);
  assert.equal(policy.security_advisor.baseline.count, 554);
  assert.equal(policy.security_advisor.baseline.cron_security_sha256, '2dd76dccc8b348eb932fee5c8ada572f57243287f3ca96bf851a75a2e9244846');
  const exceptions = policy.security_advisor.exceptions;
  assert.equal(
    gate.F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256,
    gate.sha256Hex(gate.canonicalJson(
      gate.F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE,
    )),
  );
  assert.deepEqual(gate.F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE.cases, [
    { actor: 'anon', expected: 'acl_denied' },
    { actor: 'service_role', expected: 'acl_denied' },
    { actor: 'authenticated_without_jwt_sub', expected: 'ledger_account_auth_required' },
    { actor: 'authenticated_without_profile', expected: 'ledger_account_profile_required' },
    { actor: 'authenticated_attempting_other_owner', expected: 'parameterized_authority_acl_denied' },
    { actor: 'authenticated_profile_owner', expected: 'own_zero_balance_account_only' },
    { actor: 'authenticated_profile_owner_concurrent_replay', expected: 'single_account_same_id' },
    { actor: 'authenticated_existing_account', expected: 'identity_balance_and_frozen_state_preserved' },
    { actor: 'authenticated_profile_owner_no_finance_side_effects', expected: 'transactions_entries_journal_velocity_authorizations_policy_unchanged' },
  ]);
  assert.equal(exceptions.length, 19);
  assert.deepEqual(exceptions.map(item => item.advisor_fingerprint).sort(), [...new Set([...A2_EXCEPTION_FINGERPRINTS, ...F2_EXCEPTION_FINGERPRINTS]), P3_C2_EXCEPTION_FINGERPRINT, F3_FINAL_WALLET_EXCEPTION_FINGERPRINT, ...F1_EXCEPTION_FINGERPRINTS, ...F1_C4_EXCEPTION_FINGERPRINTS, P2_RELATION_ADVISOR_FINGERPRINT].sort());
  assert.equal(exceptions.some(item => A2_PREEXISTING_FINGERPRINTS.includes(item.advisor_fingerprint)), false);
  const rpcExceptions = exceptions.filter(item => item.advisor_type === 'authenticated_security_definer_function_executable');
  assert.equal(rpcExceptions.length, 18);
  for (const exception of rpcExceptions) {
    assert.equal(exception.advisor_type, 'authenticated_security_definer_function_executable');
    assert.equal(exception.advisor_severity, 'WARN');
    assert.equal(exception.object.schema, 'public');
    assert.ok(exception.object.name.length > 0);
    assert.equal(
      exception.object.argument_types.length === 0,
      exception.object.identity_arguments === '',
      'zero-argument identities must use an empty identity-argument string',
    );
    assert.equal(exception.attestation.security_definer, true);
    assert.equal(exception.attestation.owner, 'postgres');
    assert.deepEqual(exception.attestation.search_path, ['search_path=""']);
    assert.deepEqual(exception.attestation.execute, {
      anon: false,
      authenticated: true,
      public: false,
      service_role: false,
    });
    assert.match(exception.attestation.definition_sha256, /^[0-9a-f]{64}$/);
    assert.ok(exception.authorization.functional_reason.length > 0);
    assert.deepEqual([...exception.authorization.controls].sort(), exception.authorization.controls);
    assert.match(exception.authorization.negative_test_evidence_sha256, /^[0-9a-f]{64}$/);
    if (exception.advisor_fingerprint === F3_FINAL_WALLET_EXCEPTION_FINGERPRINT) {
      assert.equal(exception.object.name, 'ensure_my_ledger_account');
      assert.deepEqual(exception.object.argument_types, []);
      assert.equal(exception.object.identity_arguments, '');
      assert.equal(exception.attestation.definition_sha256, '6c0980c34a5e058b1ebda227fb64c87ff74fc69f874c9144742c9197fd6a9190');
      assert.equal(exception.origin.migration, '20261025231500_creator_premium_f3_final_wallet_integration');
      assert.equal(exception.origin.migration_blob, 'cdcb1e2bd4db2e2e61c7e5815d62daf27cf15fba');
      assert.equal(exception.origin.source_sha, '584c29978bd903e44b436db4417d458946bc2119');
      assert.equal(exception.authorization.negative_test_evidence_sha256, '41b939a1513d04567c1d0d7acf5371c5e74d8807b7fa0d0058cd15b7fd0fdd03');
      assert.deepEqual(exception.authorization.controls, [
        'authenticated_session',
        'canonical_account_authority',
        'concurrent_idempotency',
        'finance_off_preservation',
        'negative_authorization_tests',
        'profile_fk_precondition',
        'self_only_identity',
        'zero_balance_only',
      ]);
    } else if (exception.advisor_fingerprint === P3_C2_EXCEPTION_FINGERPRINT) {
      assert.equal(exception.object.name, 'get_admin_creator_premium_content_v1');
      assert.equal(exception.attestation.definition_sha256, 'da4ae0e4416fc032f0b0cb3dfad00b6e1c5b95592bfa6b7ae926964b696f79bc');
      assert.equal(exception.origin.migration, '20261020030515_creator_premium_p3_c2_admin_restriction_recovery');
      assert.equal(exception.origin.migration_blob, '3cb930ae07e72e8a49c862556057822128a1087a');
      assert.equal(exception.origin.source_sha, 'd8fc23a8d823494df68af7aaf93314c30631b5aa');
      assert.equal(exception.authorization.negative_test_evidence_sha256, 'ae0206b79e90c6af6cacb6f11444437211467c7323c7667078c05c9d6b9446cb');
      assert.deepEqual(exception.authorization.controls, [
        'authenticated_session',
        'bounded_private_projection',
        'current_scan_binding',
        'exact_admin_capability',
        'negative_authorization_tests',
        'read_only_reverification_readiness',
      ]);
    } else if (F2_EXCEPTION_FINGERPRINTS.includes(exception.advisor_fingerprint)) {
      assert.equal(exception.origin.migration, '20261024173500_creator_premium_f2_complete_monetization');
      assert.equal(exception.origin.migration_blob, 'fce8789a0c79251afbe962bd39f6bd81ae248296');
      assert.equal(exception.origin.source_sha, '97f6638acaa5be2af336b427184c11185e3d0fe1');
      assert.equal(exception.authorization.negative_test_evidence_sha256, '222539db2b37c976322690504e9d7574d59343adf7aef9ab83262a88c665c2d8');
    } else if (exception.object.name === 'submit_my_creator_premium_content_with_plans_v1') {
      assert.equal(exception.origin.migration, '20261019170853_creator_premium_f1_c6_submit_unavailable_mapping_recovery');
      assert.equal(exception.origin.migration_blob, 'af810d8dc1940f08907408305e2373a838d4db60');
      assert.equal(exception.origin.source_sha, '01bd67f914b151129d9d3659e1ec79581ea76227');
      assert.equal(exception.authorization.negative_test_evidence_sha256, '805d91901ca2a82715fa9e647705fef78a00b30e505aa624fdb3ac568f4c29df');
    } else if (F1_C4_EXCEPTION_FINGERPRINTS.includes(exception.advisor_fingerprint)) {
      assert.equal(exception.origin.migration, '20261019023431_creator_premium_f1_c4_final_recovery');
      assert.equal(exception.origin.migration_blob, '185fdfb7c0216776fa540fe5009afdee4f2b57bb');
      assert.equal(exception.origin.source_sha, '506f7b669d6d1dce42b273ae51e456b90ca2e6a5');
      assert.equal(exception.authorization.negative_test_evidence_sha256, '88f4dd9874b57cc9235b2f86b391fa6b9a5884ebe722297d81fbffa289bdaf0f');
    } else if (F1_EXCEPTION_FINGERPRINTS.includes(exception.advisor_fingerprint)) {
      assert.equal(exception.origin.migration, '20261018211327_creator_premium_qa_final_f1');
      assert.equal(exception.origin.migration_blob, '9052d0abd6df3fec7d49eed80285bce19f21051b');
      assert.equal(exception.origin.source_sha, 'ed51307f9fc02ec04ca84478d905f608120e2b0e');
      assert.equal(exception.authorization.negative_test_evidence_sha256, '59a8ca88804abd43416d157b7580d180884b905d0596e6b63a7441e06e999f46');
    } else if (exception.object.name === 'cancel_my_creator_premium_submission_v1') {
      assert.equal(exception.origin.migration, '20261017193000_creator_premium_c1_submission_cancellation');
      assert.equal(exception.origin.migration_blob, '4605ac94221a52d47190b1575ab1a71e23c82fac');
      assert.equal(exception.origin.source_sha, 'aa722ea6f1bb9aef6fc49da64c4c6dc8303b4e95');
    } else {
      assert.equal(exception.origin.migration, '20261010053524_creator_premium_b7_full_functional_commercial_completion');
      assert.equal(exception.origin.migration_blob, '43f014260e0ecfa6f0634e61e1646594bcf13e1d');
      assert.equal(exception.origin.source_sha, '0560b9e1fdc0869dfcd4d04f081de03ba31b66cb');
    }
    assert.equal(exception.technical_approval, 'verified');
  }
  const relationException = exceptions.find(item => item.advisor_fingerprint === P2_RELATION_ADVISOR_FINGERPRINT);
  assert.deepEqual(relationException, {
    advisor_fingerprint: P2_RELATION_ADVISOR_FINGERPRINT,
    advisor_type: 'table',
    advisor_severity: 'INFO',
    object: { schema: 'private', name: 'creator_premium_content_safety_context_evaluations' },
    attestation: {
      owner: 'postgres',
      rls_enabled: true,
      force_rls: true,
      acl: [
        { grantee: 'postgres', privilege_type: 'DELETE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'INSERT', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'MAINTAIN', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'REFERENCES', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'TRIGGER', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'TRUNCATE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'UPDATE', is_grantable: false },
      ],
    },
    authorization: {
      functional_reason: 'Stores private service-only P2 contextual evidence; the absence of permissive RLS policies is intentional fail-closed isolation.',
      controls: ['force_rls', 'negative_authorization_tests', 'owner_only_acl', 'private_schema', 'service_rpc_only'],
      negative_test_evidence_sha256: '3d84738f44200f1198ab7e61aff788e4fc847f7ced6139f5fa73632e993a1d0e',
    },
    origin: {
      migration: '20261018170000_creator_premium_content_safety_p2_evidence_runtime',
      migration_blob: '8cb2e43095a733c60c5753f7a80f4e1ed2e1c4cd',
      source_sha: 'b2e20b64fad627fc732db66e6b3c3088f5371fbc',
    },
    technical_approval: 'verified',
  });
  for (const mutate of [
    candidate => { candidate.exceptions[0].advisor_fingerprint = `${candidate.exceptions[0].advisor_fingerprint.slice(0, 63)}*`; },
    candidate => { candidate.exceptions.push(structuredClone(candidate.exceptions[0])); },
    candidate => { candidate.exceptions[0].technical_approval = 'pending'; },
    candidate => { candidate.exceptions[0].authorization.negative_test_evidence_sha256 = null; },
    candidate => { candidate.exceptions[0].attestation.acl = []; },
  ]) {
    const candidate = structuredClone(policy.security_advisor);
    mutate(candidate);
    assertDenied(() => gate.validateSecurityAdvisorPolicy(candidate), 'INVALID_SECURITY_ADVISOR_POLICY');
  }
  for (const mutate of [
    candidate => { candidate.object.argument_types = ['uuid']; },
    candidate => { candidate.object.identity_arguments = 'p_user_id uuid'; },
    candidate => { candidate.attestation.acl = []; },
    candidate => { candidate.attestation.definition_sha256 = '0'.repeat(64); },
    candidate => { candidate.authorization.negative_test_evidence_sha256 = '0'.repeat(64); },
    candidate => { candidate.origin.migration_blob = '0'.repeat(40); },
    candidate => { candidate.origin.source_sha = '0'.repeat(40); },
  ]) {
    const candidate = structuredClone(policy.security_advisor);
    const walletException = candidate.exceptions.find(item => (
      item.advisor_fingerprint === F3_FINAL_WALLET_EXCEPTION_FINGERPRINT
    ));
    mutate(walletException);
    assertDenied(() => gate.validateSecurityAdvisorPolicy(candidate), 'INVALID_SECURITY_ADVISOR_POLICY');
  }
});

test('phase-bound migration omission is bound to the exact reviewed blob and source', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const migration = {
    path: 'supabase/migrations/20261025231500_creator_premium_f3_final_wallet_integration.sql',
    version: '20261025231500',
  };
  const exactBlob = 'cdcb1e2bd4db2e2e61c7e5815d62daf27cf15fba';
  const exactSource = '584c29978bd903e44b436db4417d458946bc2119';
  const observedCommands = [];
  const runGit = args => {
    observedCommands.push(args);
    if (args[0] === 'cat-file') {
      assert.deepEqual(args, ['cat-file', '-e', `${exactSource}^{commit}`]);
      return '';
    }
    if (args[0] === 'merge-base') {
      assert.deepEqual(args, ['merge-base', '--is-ancestor', exactSource, '6636b50e43bedf08b62ba7d929976d73a692b9b9']);
      return '';
    }
    assert.deepEqual(args.slice(0, 1), ['rev-parse']);
    assert.ok([
      ['rev-parse', `${exactSource}:${migration.path}`],
      ['rev-parse', `6636b50e43bedf08b62ba7d929976d73a692b9b9:${migration.path}`],
    ].some(expected => JSON.stringify(expected) === JSON.stringify(args)));
    return `${exactBlob}\n`;
  };
  assert.deepEqual(
    gate.attestPhaseBoundMigrationOrigins({
      approvedSha: '6636b50e43bedf08b62ba7d929976d73a692b9b9',
      cwd: '.',
      migrations: [migration],
      policy,
      runGit,
    }),
    [{ ...migration, blob: exactBlob, source_sha: exactSource }],
  );
  assert.deepEqual(observedCommands, [
    ['cat-file', '-e', `${exactSource}^{commit}`],
    ['merge-base', '--is-ancestor', exactSource, '6636b50e43bedf08b62ba7d929976d73a692b9b9'],
    ['rev-parse', `${exactSource}:${migration.path}`],
    ['rev-parse', `6636b50e43bedf08b62ba7d929976d73a692b9b9:${migration.path}`],
  ]);
  assertDenied(
    () => gate.attestPhaseBoundMigrationOrigins({
      approvedSha: '6636b50e43bedf08b62ba7d929976d73a692b9b9',
      cwd: '.',
      migrations: [migration],
      policy,
      runGit: () => `${'0'.repeat(40)}\n`,
    }),
    'INVALID_RPC_PHASE_ATTESTATION',
  );
  for (const hostileRunGit of [
    args => args[0] === 'cat-file' ? (() => { throw new Error('missing source'); })() : runGit(args),
    args => args[0] === 'merge-base' ? (() => { throw new Error('unrelated source'); })() : runGit(args),
    args => args[0] === 'rev-parse' && args[1].startsWith(`${exactSource}:`)
      ? `${'1'.repeat(40)}\n` : runGit(args),
  ]) {
    assertDenied(
      () => gate.attestPhaseBoundMigrationOrigins({
        approvedSha: '6636b50e43bedf08b62ba7d929976d73a692b9b9',
        cwd: '.',
        migrations: [migration],
        policy,
        runGit: hostileRunGit,
      }),
      'INVALID_RPC_PHASE_ATTESTATION',
    );
  }
});

test('recovery source is exact immutable failed-postcheck authority', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(policy.postcheck_recovery.approved_sources.length, 9);
  for (const source of policy.postcheck_recovery.approved_sources) {
    assert.equal(gate.validateRecoverySource(source), true);
    assert.ok(source.expected_migrations.length >= 1);
    assert.match(source.premium_relation_security_sha256, /^[0-9a-f]{64}$/);
  }
  const source = policy.postcheck_recovery.approved_sources[0];
  assert.equal(source.run_id, '39066492485');
  assert.equal(source.run_attempt, 1);
  assert.equal(source.release_id, 'nelyon-b7-autonomous-20261017T202315Z');
  assert.equal(source.source_sha, '0560b9e1fdc0869dfcd4d04f081de03ba31b66cb');
  assert.equal(source.mutation_status, 'completed');
  assert.equal(source.post_snapshot_status, 'success');
  assert.equal(source.postcheck_status, 'failure');
  assert.equal(source.edge_functions.length, 12);
  assert.equal(new Set(source.edge_functions.map(item => item.name)).size, 12);
  const c4Source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '39195966131');
  assert.ok(c4Source);
  assert.equal(c4Source.release_id, 'nelyon-f1-c4-release-20261019T034232Z');
  assert.equal(c4Source.source_sha, '6cde9b5566c0753b10a1588e8f58568030d37a61');
  assert.equal(c4Source.expected_migration_count, 344);
  assert.equal(c4Source.edge_functions.length, 3);
  assert.deepEqual(c4Source.edge_functions.map(item => item.name), [
    'content-safety-scan',
    'create-stream-upload',
    'video-semantic-index',
  ]);
  const f2Source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40139736749');
  assert.ok(f2Source);
  assert.equal(f2Source.release_id, 'nelyon-creator-premium-f2-r1-release-20261024T224205Z');
  assert.equal(f2Source.source_sha, '238e987933c7198400534121e61fb3d2750ba5ba');
  assert.equal(f2Source.manifest_sha256, '4e798ee48a8d83d26c8608803b26099a6d22521d43a585d7735754969fe45a12');
  assert.equal(f2Source.expected_migration_count, 351);
  assert.equal(f2Source.expected_latest_migration, '20261024173500_creator_premium_f2_complete_monetization');
  assert.deepEqual(f2Source.edge_functions.map(item => item.name), ['bdag-ledger']);
  assert.equal(f2Source.edge_functions[0].source_sha256, '0b0db8c46041127dac341dfaa9673a7da4b15747ac71639bdeed00e8097be002');
  const f3Source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40166468648');
  assert.ok(f3Source);
  assert.equal(f3Source.release_id, 'nelyon-creator-premium-f3-release-20261025T054152Z');
  assert.equal(f3Source.source_sha, '8908c4f9e6b5d48614301e51b16793ed7ae6f895');
  assert.equal(f3Source.manifest_sha256, '7f329703901fbe8d6d3a38803b710e68780cb05c17c229ea091f01b5cff67a21');
  assert.equal(f3Source.post_snapshot_status, 'failure');
  assert.equal(f3Source.postcheck_status, 'skipped');
  assert.equal(f3Source.post_snapshot_evidence_sha256, null);
  assert.equal(f3Source.expected_migration_count, 352);
  assert.equal(f3Source.expected_latest_migration, '20261025011000_creator_premium_f3_bounded_financial_activation');
  assert.deepEqual(f3Source.edge_functions.map(item => [item.name, item.version, item.source_sha256]), [[
    'bdag-ledger',
    46,
    'd039819170e2c347ac8a6c88f77fa4461dfae4091a9e937ed47897b2c115e56c',
  ]]);
  const f4Source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40268500711');
  assert.ok(f4Source);
  assert.equal(f4Source.release_id, 'nelyon-f4-general-activation-release-20261026T041943Z');
  assert.equal(f4Source.source_sha, '02c238618b05cd01c7388cc592ba7ac426973ce5');
  assert.equal(f4Source.manifest_sha256, '96d731beeef25b2de5077f525e406727e249a073008653def91b923d4e2e6c17');
  assert.equal(f4Source.pre_snapshot_evidence_sha256, '3053119dc99ee41e4019222468dd9ec43a393c49b94c4eff1c6e1dc80568f302');
  assert.equal(f4Source.post_snapshot_status, 'failure');
  assert.equal(f4Source.postcheck_status, 'skipped');
  assert.equal(f4Source.post_snapshot_evidence_sha256, null);
  assert.equal(f4Source.expected_migration_count, 355);
  assert.equal(f4Source.expected_latest_migration, F4_GENERAL_MIGRATION);
  assert.deepEqual(f4Source.edge_functions, []);
  assert.deepEqual(f4Source.productive_resources, [`migration:${F4_GENERAL_MIGRATION}`]);
  const f5Source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40324910390');
  assert.ok(f5Source);
  assert.equal(f5Source.release_id, 'nelyon-f5-autonomous-releasefix-20261026T124453Z');
  assert.equal(f5Source.source_sha, 'ec9e08227801c3ce59f7c01f8db3ed846831160e');
  assert.equal(f5Source.expected_migration_count, 356);
  assert.equal(f5Source.expected_latest_migration, F5_AUTONOMOUS_MIGRATION);
  assert.deepEqual(f5Source.edge_functions.map(item => [item.name, item.version]), [['bdag-ledger', 47]]);
  const storiesSource = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40473092474');
  assert.ok(storiesSource);
  assert.equal(storiesSource.release_id, 'nelyon-stories-b1-recovery-release-20261027T082425Z');
  assert.equal(storiesSource.source_sha, '8e2fc6b896e3f409e11087d4f9f423581126b617');
  assert.equal(storiesSource.manifest_sha256, '4c3435b1cd87ffd416c02b9f720cf4d3e3dd193fa8982e613dafa48fd036bcdf');
  assert.equal(storiesSource.pre_snapshot_evidence_sha256,
    'e4afa5e63dd90a12f0a36705c2cb95d5bf4bb1d9301803e47f5647aa932e9dfb');
  assert.equal(storiesSource.post_snapshot_evidence_sha256,
    '02b5cac2604b282293367a6d2f224c2e4316b0f6d371a9bd92bb9c89e62025ee');
  assert.equal(storiesSource.expected_migration_count, 358);
  assert.equal(storiesSource.expected_latest_migration, '20261027042552_stories_v2_interactive_b1');
  assert.deepEqual(storiesSource.edge_functions.map(item => [item.name, item.version]), [
    ['cleanup-stale-media-uploads', 53],
    ['content-safety-scan', 48],
    ['create-media-upload', 71],
    ['create-stream-upload', 40],
    ['get-stream-playback', 34],
    ['stream-webhook', 35],
  ]);
  assert.deepEqual(storiesSource.edge_transitions.map(item => [
    item.name,
    item.from.version,
    item.to.version,
    item.from.verify_jwt,
    item.to.verify_jwt,
  ]), [
    ['cleanup-stale-media-uploads', 52, 53, false, false],
    ['content-safety-scan', 47, 48, true, true],
    ['create-media-upload', 70, 71, true, true],
    ['create-stream-upload', 39, 40, true, true],
    ['get-stream-playback', 33, 34, true, true],
    ['stream-webhook', 34, 35, false, false],
  ]);
  assert.deepEqual(storiesSource.edge_transitions.map(item => item.to.source_sha256),
    storiesSource.edge_functions.map(item => item.source_sha256));
  const controlCenterSource = policy.postcheck_recovery.approved_sources
    .find(item => item.run_id === '41243646356');
  assert.ok(controlCenterSource);
  assert.equal(controlCenterSource.release_id, 'SUPERUSER-CC-R1-RELEASE-20261031T212706Z');
  assert.equal(controlCenterSource.source_sha, '58a71b66f07899d16b780f6f967279677dcc2ed4');
  assert.equal(controlCenterSource.post_snapshot_status, 'success');
  assert.equal(controlCenterSource.postcheck_status, 'success');
  assert.equal(controlCenterSource.expected_migration_count, 364);
  assert.equal(controlCenterSource.expected_latest_migration,
    '20261031032022_superuser_control_center_overview');
  assert.deepEqual(controlCenterSource.expected_migrations.map(item => [item.name, item.blob]), [
    ['20261031020113_superuser_control_center_mfa_aal2',
      '5452895cfd473513e99e15e35bff948a74080f44'],
    ['20261031025722_superuser_control_center_cursor_terminal_truth',
      '91e75126f636ac8f83d9e73798c66dac58d72608'],
    ['20261031032022_superuser_control_center_overview',
      '9a2c821a314d7c6039ec31f534712784a94089e3'],
  ]);
  assert.deepEqual(controlCenterSource.edge_functions, []);
  assert.deepEqual(controlCenterSource.productive_resources,
    controlCenterSource.expected_migrations.map(item => `migration:${item.name}`));
  for (const mutate of [
    candidate => { candidate.run_id = '39066492486'; },
    candidate => { candidate.postcheck_status = 'success'; },
    candidate => { candidate.release_artifact.digest = candidate.release_artifact.digest.slice(0, 20); },
    candidate => { candidate.edge_functions.push(structuredClone(candidate.edge_functions[0])); },
    candidate => { candidate.productive_resources.push('another-migration'); },
  ]) {
    const candidate = structuredClone(source);
    mutate(candidate);
    assertDenied(() => gate.validateRecoverySource(candidate), 'INVALID_RECOVERY_SOURCE');
  }
});

test('postcheck recovery request requires its exact read-only confirmation', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validateRequest(request({
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: '39066492485',
  }), policy).mode, 'postcheck_recovery');
  assertDenied(() => gate.validateRequest(request({
    mode: 'postcheck_recovery',
    scopeConfirmation: 'RELEASE_STANDARD',
    recoverySourceRunId: '39066492485',
  }), policy), 'SCOPE_CONFIRMATION_MISMATCH');
});

test('policy pins the automatic main-only Environment contract', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  for (const environment of [
    { ...policy.environment, authorization_mode: 'manual' },
    { ...policy.environment, required_reviewer: OWNER },
    { ...policy.environment, allow_admin_bypass: true },
    { ...policy.environment, id: 42 },
    { ...policy.environment, protected_branch: 'dev' },
  ]) {
    assertDenied(() => gate.validatePolicy({ ...policy, environment }), 'INVALID_ENVIRONMENT_POLICY');
  }
});

test('candidate baseline denies release but permits plan_only and gate_proof', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
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

test('expanded managed scope has a verified static cutover control', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validatePolicy(policy), true);
  assert.equal(policy.baseline.state, 'verified');
  assert.match(policy.baseline.evidence, /^[0-9a-f]{64}$/);
  assert.equal(policy.baseline.verified_by, OWNER);
  assert.ok(Number.isFinite(Date.parse(policy.baseline.verified_at)));
  assert.deepEqual(policy.baseline.blocked_resources, []);
  assert.match(policy.baseline.evidence_digests.function_source_parity, /^[0-9a-f]{64}$/);
  assert.equal(policy.cutover.state, 'verified');
  assert.equal(policy.cutover.control, 'supabase-github-integration-off');
  assert.equal(policy.cutover.verified_by, OWNER);
  assert.ok(Number.isFinite(Date.parse(policy.cutover.verified_at)));
  assert.match(policy.cutover.initial_evidence.id, /^supabase-off-/);
  assert.match(policy.cutover.initial_evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(gate.validateRequest(request({
    mode: 'release',
    scopeConfirmation: 'RELEASE_STANDARD',
  }), policy).mode, 'release');
});

test('Superuser Control Center production baseline is promoted from independently verified owner evidence', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validatePolicy(policy), true);
  assert.deepEqual(policy.baseline, {
    authority_source: 'owner-control-plane',
    blocked_resources: [],
    evidence: '026a503453300aa177d7bc9a33369d4a2bbf9009c0f87796f0978e71f8bc8893',
    evidence_digests: {
      migrations: 'd829535d795f32b196554880124ba8b5c8740f9fb5f4546a9b05e17fab7f368e',
      managed_functions: '93eddb2a83d06900a78277827a5f00eec185bc75a06202653969b2a539fb2d6c',
      unmanaged_functions: '26f9c59179198817e55c7940177bf72cf7024f77b4b3c707d205ab7d5c3eaafc',
      function_source_parity: '031993a08f4e7178169e26468e746c13178cd752e30d1694e9904781cde8c9c4',
      config_verify_jwt: '703749fce46f724c7c4e791f7a222915b166af0ded38f00f34f983798355ba15',
      cron_security: '14e2f511010a0bd1dddb859223d730c24fc99ac3ca6fa5ddafd19184e55583ba',
      finance: 'f94d54264c5d7658dc04aba34b028c815e99d7eb8ccf2490410817d47566754f',
    },
    latest_migration: '20261031032022_superuser_control_center_overview',
    migration_count: 364,
    prior_release: {
      kind: 'post-release',
      release_id: 'SUPERUSER-CC-R1-RELEASE-20261031T212706Z',
      manifest_sha256: 'f0cedb82c8b756eb847d4175ae6378a8fc6f7a13c21a0fc8b0992b2826069030',
      postcheck_evidence_sha256: '465a51991e3494cd9280129ca59cc736b3c7a5e2b627f5d2ae7d2f8bc48bb420',
    },
    requires_separate_policy_commit: true,
    reviewed_policy_sha256: 'b818272a536a60f839bbc1cc8ca4a54a8279f42c6a220ede11a31f3e118e1e56',
    sha: '94ac244197e5c0ab0753747532f4e0969ece1901',
    state: 'verified',
    verified_at: '2026-11-01T06:09:26.488Z',
    verified_by: OWNER,
  });

  const retired = gate.attestFinanceAuthorityTransition({
    mode: 'plan_only',
    policy,
    approvedSha: MAIN_SHA,
    changes: [{ status: 'M', path: policy.finance_authority_transition.function_path }],
    migrations: [],
    affectedFunctions: [policy.finance_authority_transition.function],
    runGit: () => { throw new Error('promoted F3 baseline must not reuse transition attestation'); },
  });
  assert.deepEqual(retired, { migrations: [], attestation: null });

  assertDenied(() => gate.attestFinanceAuthorityTransition({
    mode: 'plan_only',
    policy,
    approvedSha: MAIN_SHA,
    changes: [{ status: 'M', path: policy.finance_authority_c2_transition.migration_path }],
    migrations: [{
      path: policy.finance_authority_c2_transition.migration_path,
      version: '20261025160452',
    }],
    affectedFunctions: [],
    runGit: () => { throw new Error('promoted F3-C2 baseline must not reuse transition attestation'); },
  }), 'INVALID_FINANCE_AUTHORITY_TRANSITION');
});

test('verified cutover requires a historical owner-bound control record', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const verified = asVerifiedCutoverPolicy(policy);
  assert.equal(gate.validatePolicy(verified), true);
  for (const mutate of [
    candidate => { candidate.cutover.verified_by = 'someone-else'; },
    candidate => { candidate.cutover.verified_at = 'not-a-time'; },
    candidate => { candidate.cutover.control = 'another-control'; },
    candidate => { candidate.cutover.initial_evidence.id = ''; },
    candidate => { candidate.cutover.initial_evidence.sha256 = '0'.repeat(63); },
  ]) {
    const candidate = asVerifiedCutoverPolicy(policy);
    mutate(candidate);
    assertDenied(() => gate.validatePolicy(candidate), 'INVALID_VERIFIED_CUTOVER');
  }
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

test('protected Environment policy digest must match exact policy bytes', async () => {
  const { gate } = await loadGateAndPolicy();
  const bytes = readFileSync(policyUrl);
  const digest = gate.sha256Hex(bytes);
  assert.equal(gate.verifyPolicyDigest({ policyBytes: bytes, expectedSha256: digest }), digest);
  assertDenied(() => gate.verifyPolicyDigest({
    policyBytes: bytes,
    expectedSha256: '0'.repeat(64),
  }), 'POLICY_DIGEST_MISMATCH');
  assertDenied(() => gate.verifyPolicyDigest({
    policyBytes: Buffer.from(`${bytes.toString('utf8')} `),
    expectedSha256: digest,
  }), 'POLICY_DIGEST_MISMATCH');
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

test('snapshot adapter and its tests are governed and adapter changes are high risk', async () => {
  const { gate } = await loadGateAndPolicy();
  const paths = [
    'scripts/nelyon-production-snapshot-adapter.mjs',
    'tests/nelyonProductionSnapshotAdapter.test.mjs',
  ];
  const classified = gate.classifyChangedPaths(paths.map(path => ({ status: 'M', path, fileType: 'file' })));
  assert.deepEqual(classified.governance.map(item => item.path), paths);
  assert.deepEqual(classified.other, []);
  const risk = gate.classifyRisk({ affectedFunctions: [], changedPaths: paths, configBefore: {}, configAfter: {} });
  assert.ok(risk.findings.some(finding => finding.code === 'GATE_AUTHORITY_CHANGE'
    && finding.path === 'scripts/nelyon-production-snapshot-adapter.mjs'));
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

test('static plan records migration delta before protected remote dry-run evidence exists', async () => {
  const { gate } = await loadGateAndPolicy();
  const result = gate.validateMigrationDelta({
    changes: [{ status: 'A', path: 'supabase/migrations/20261010000000_release_gate_probe.sql', fileType: 'file' }],
    baselineLatestMigration: '20261009021414_creator_premium_b5_creator_management_ux',
  });
  assert.deepEqual(result, [{ version: '20261010000000', path: 'supabase/migrations/20261010000000_release_gate_probe.sql' }]);
  assertDenied(() => gate.validateMigrationDelta({
    changes: [],
    baselineLatestMigration: '20261009021414_creator_premium_b5_creator_management_ux',
    remoteMigrations: [],
  }), 'INVALID_MIGRATION_DELTA');
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

test('Supabase dry-run text is reduced to the exact manifest migration set', async () => {
  const { gate } = await loadGateAndPolicy();
  const manifest = {
    resources: {
      migrations: [
        { version: '20261010053524', path: 'supabase/migrations/20261010053524_creator_premium_b7_full_functional_commercial_completion.sql' },
      ],
    },
  };
  assert.deepEqual(gate.verifyMigrationDryRun({
    text: 'DRY RUN: migrations will not be pushed\n • 20261010053524_creator_premium_b7_full_functional_commercial_completion.sql\n',
    manifest,
  }), {
    complete: true,
    pending_versions: ['20261010053524'],
  });
  assert.deepEqual(gate.verifyMigrationDryRun({
    text: JSON.stringify({
      upToDate: false,
      dryRun: true,
      migrations: ['20261010053524_creator_premium_b7_full_functional_commercial_completion.sql'],
      seeds: [],
      roles: [],
      message: 'Finished supabase db push.',
    }),
    manifest,
  }), {
    complete: true,
    pending_versions: ['20261010053524'],
  });
  assertDenied(() => gate.verifyMigrationDryRun({
    text: JSON.stringify({
      upToDate: false,
      dryRun: false,
      migrations: ['20261010053524_creator_premium_b7_full_functional_commercial_completion.sql'],
      seeds: [],
      roles: [],
      message: 'Finished supabase db push.',
    }),
    manifest,
  }), 'MIGRATION_DRY_RUN_MISMATCH');
  assertDenied(() => gate.verifyMigrationDryRun({
    text: '20261010053524_creator_premium_b7_full_functional_commercial_completion.sql\n20261011000000_unexpected.sql\n',
    manifest,
  }), 'MIGRATION_DRY_RUN_MISMATCH');
  assertDenied(() => gate.verifyMigrationDryRun({
    text: '20261010053524_wrong_migration_name.sql\n',
    manifest,
  }), 'MIGRATION_DRY_RUN_MISMATCH');
});

test('only exact config.toml function declarations are managed', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const config = gate.parseFunctionConfig(toml);
  assert.deepEqual(Object.keys(config), MANAGED_FUNCTIONS);
  assert.equal(config['agora-token'].verify_jwt, true);
  assert.equal(config['stripe-webhook'].verify_jwt, false);
  assert.equal(config['video-semantic-index'].verify_jwt, true);
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

test('changed function modules propagate across function boundaries and deny unmanaged consumers', async () => {
  const { gate } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/content-safety-scan/index.ts': "import { visual } from './visualPipeline.mjs';\nexport { visual };\n",
    'supabase/functions/content-safety-scan/visualPipeline.mjs': 'export const visual = true;\n',
    'supabase/functions/video-semantic-index/index.ts': "import { semantic } from './visualSemanticPipeline.mjs';\nexport { semantic };\n",
    'supabase/functions/video-semantic-index/visualSemanticPipeline.mjs': "export { visual as semantic } from '../content-safety-scan/visualPipeline.mjs';\n",
  });
  const input = {
    changes: [{ status: 'M', path: 'supabase/functions/content-safety-scan/visualPipeline.mjs' }],
    graph,
    forbiddenFunctions: ['bdag-economy'],
  };

  assertDenied(() => gate.resolveAffectedFunctions({
    ...input,
    managedFunctions: ['content-safety-scan'],
  }), 'FUNCTION_NOT_AUTHORIZED');
  assert.deepEqual(gate.resolveAffectedFunctions({
    ...input,
    managedFunctions: ['content-safety-scan', 'video-semantic-index'],
  }), ['content-safety-scan', 'video-semantic-index']);
});

test('a config-only function declaration change affects only the exact changed managed function', async () => {
  const { gate } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/content-safety-scan/index.ts': 'export const safety = true;\n',
    'supabase/functions/video-semantic-index/index.ts': 'export const semantic = true;\n',
  });
  assert.deepEqual(gate.resolveAffectedFunctions({
    changes: [{ status: 'M', path: 'supabase/config.toml' }],
    graph,
    managedFunctions: ['content-safety-scan', 'video-semantic-index'],
    forbiddenFunctions: ['bdag-economy'],
    configBefore: { 'content-safety-scan': { verify_jwt: true } },
    configAfter: {
      'content-safety-scan': { verify_jwt: true },
      'video-semantic-index': { verify_jwt: true },
    },
  }), ['video-semantic-index']);
});

test('per-function contracts bind entrypoint transitive bytes config and source-change state', async () => {
  const { gate } = await loadGateAndPolicy();
  const graph = gate.buildFunctionGraph({
    'supabase/functions/content-safety-scan/index.ts': "import { visual } from './visualPipeline.mjs';\nexport { visual };\n",
    'supabase/functions/content-safety-scan/visualPipeline.mjs': "import { auth } from '../_shared/mediaAuth.ts';\nexport const visual = auth;\n",
    'supabase/functions/content-safety-scan/unused.ts': 'export const unused = true;\n',
    'supabase/functions/_shared/mediaAuth.ts': 'export const auth = true;\n',
  });
  const input = {
    affectedFunctions: ['content-safety-scan'],
    graph,
    configBefore: { 'content-safety-scan': { verify_jwt: true } },
    configAfter: { 'content-safety-scan': { verify_jwt: true } },
    changes: [{ status: 'M', path: 'supabase/functions/_shared/mediaAuth.ts' }],
  };
  const contracts = gate.buildFunctionContracts(input);
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].entrypoint, 'supabase/functions/content-safety-scan/index.ts');
  assert.equal(contracts[0].verify_jwt, true);
  assert.equal(contracts[0].source_changed, true);
  assert.deepEqual(contracts[0].source_files.map(item => item.path), [
    'supabase/functions/_shared/mediaAuth.ts',
    'supabase/functions/content-safety-scan/index.ts',
    'supabase/functions/content-safety-scan/visualPipeline.mjs',
  ]);
  assert.match(contracts[0].source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(gate.verifyFunctionContracts({
    manifest: { delta: { files: input.changes }, resources: { functions: ['content-safety-scan'], function_contracts: contracts } },
    graph,
    configBefore: input.configBefore,
    configAfter: input.configAfter,
    functionName: 'content-safety-scan',
  }).result, 'FUNCTION_CONTRACT_VERIFIED');
  const tampered = structuredClone(contracts);
  tampered[0].source_sha256 = '0'.repeat(64);
  assertDenied(() => gate.verifyFunctionContracts({
    manifest: { delta: { files: input.changes }, resources: { functions: ['content-safety-scan'], function_contracts: tampered } },
    graph,
    configBefore: input.configBefore,
    configAfter: input.configAfter,
    functionName: 'content-safety-scan',
  }), 'FUNCTION_CONTRACT_MISMATCH');

  const configGraph = gate.buildFunctionGraph({
    'supabase/functions/content-safety-scan/old.ts': 'export const version = "old";\n',
    'supabase/functions/content-safety-scan/new.ts': 'export const version = "new";\n',
    'supabase/functions/content-safety-scan/old-import-map.json': '{"imports":{}}',
    'supabase/functions/content-safety-scan/new-import-map.json': '{"imports":{}}',
  });
  const entrypointChanged = gate.buildFunctionContracts({
    affectedFunctions: ['content-safety-scan'],
    graph: configGraph,
    configBefore: { 'content-safety-scan': { entrypoint: 'old.ts', verify_jwt: true } },
    configAfter: { 'content-safety-scan': { entrypoint: 'new.ts', verify_jwt: true } },
    changes: [{ status: 'M', path: 'supabase/config.toml' }],
  });
  assert.equal(entrypointChanged[0].source_changed, true);
  const importMapChanged = gate.buildFunctionContracts({
    affectedFunctions: ['content-safety-scan'],
    graph: configGraph,
    configBefore: { 'content-safety-scan': { entrypoint: 'new.ts', import_map: 'old-import-map.json', verify_jwt: true } },
    configAfter: { 'content-safety-scan': { entrypoint: 'new.ts', import_map: 'new-import-map.json', verify_jwt: true } },
    changes: [{ status: 'M', path: 'supabase/config.toml' }],
  });
  assert.equal(importMapChanged[0].source_changed, true);
  const verifyJwtOnly = gate.buildFunctionContracts({
    affectedFunctions: ['content-safety-scan'],
    graph: configGraph,
    configBefore: { 'content-safety-scan': { entrypoint: 'new.ts', verify_jwt: true } },
    configAfter: { 'content-safety-scan': { entrypoint: 'new.ts', verify_jwt: false } },
    changes: [{ status: 'M', path: 'supabase/config.toml' }],
  });
  assert.equal(verifyJwtOnly[0].source_changed, false);
});

function collectFunctionSources(directory, root, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) collectFunctionSources(absolute, root, files);
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files[relative(root, absolute).replaceAll('\\', '/')] = readFileSync(absolute, 'utf8');
    }
  }
  return files;
}

function collectFunctionSourcesAtCommit(runGit, cwd, sha) {
  const paths = runGit(['ls-tree', '-r', '--name-only', '-z', sha, '--', 'supabase/functions'], { cwd })
    .toString('utf8').split('\0').filter(path => /\.(?:ts|tsx|js|mjs)$/.test(path));
  return Object.fromEntries(paths.map(path => [
    path,
    runGit(['show', `${sha}:${path}`], { cwd }).toString('utf8').replace(/\r\n/g, '\n'),
  ]));
}

test('C2 shared visual probe delta resolves to only its two canonical Edge consumers', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const repositoryRoot = new URL('..', import.meta.url);
  const rootPath = repositoryRoot.pathname.startsWith('/') && /^[A-Za-z]:/.test(repositoryRoot.pathname.slice(1))
    ? decodeURIComponent(repositoryRoot.pathname.slice(1))
    : decodeURIComponent(repositoryRoot.pathname);
  const graph = gate.buildFunctionGraph(collectFunctionSources(join(rootPath, 'supabase', 'functions'), rootPath));
  const changes = [{ status: 'M', path: 'supabase/functions/content-safety-scan/visualProbe.mjs' }];
  const configBefore = gate.parseFunctionConfig(readFileSync(join(rootPath, 'supabase', 'config.toml'), 'utf8'));
  const configAfter = structuredClone(configBefore);
  const affected = gate.resolveAffectedFunctions({
    changes,
    graph,
    managedFunctions: policy.supabase.managed_functions,
    forbiddenFunctions: policy.supabase.forbidden_functions,
    configBefore,
    configAfter,
  });
  assert.deepEqual(affected, ['content-safety-scan', 'video-semantic-index']);
  assert.deepEqual(gate.analyzeFunctionReproducibility({ affectedFunctions: affected, graph }), {
    allowed: true,
    blockedFunctions: [],
    findings: [],
  });
});

test('F2 release delta is one migration and only the canonical bdag-ledger Edge function', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const repositoryRoot = new URL('..', import.meta.url);
  const rootPath = repositoryRoot.pathname.startsWith('/') && /^[A-Za-z]:/.test(repositoryRoot.pathname.slice(1))
    ? decodeURIComponent(repositoryRoot.pathname.slice(1))
    : decodeURIComponent(repositoryRoot.pathname);
  const graph = gate.buildFunctionGraph(collectFunctionSources(join(rootPath, 'supabase', 'functions'), rootPath));
  const changes = [
    { status: 'A', path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql' },
    { status: 'M', path: 'supabase/config.toml' },
    { status: 'M', path: 'supabase/functions/bdag-ledger/index.ts' },
    { status: 'M', path: 'app/creator-premium-offer/[contentId].tsx' },
    { status: 'M', path: 'apps/admin-web/src/pages/AdminFinanceAuditSystemPages.tsx' },
  ];
  const classified = gate.classifyChangedPaths(changes);
  assert.deepEqual(classified.migrations.map(item => item.path), [changes[0].path]);
  assert.deepEqual(classified.functions.map(item => item.path), [changes[2].path]);
  assert.deepEqual(classified.other.map(item => item.path), [changes[3].path, changes[4].path]);
  const configBefore = gate.parseFunctionConfig(execFileSync(
    'git', ['show', 'f786f0d627f5a5dd330e503c531b05ba84c45daa:supabase/config.toml'],
    { cwd: rootPath, encoding: 'utf8' },
  ));
  const configAfter = gate.parseFunctionConfig(readFileSync(join(rootPath, 'supabase', 'config.toml'), 'utf8'));
  const affected = gate.resolveAffectedFunctions({
    changes,
    graph,
    managedFunctions: policy.supabase.managed_functions,
    forbiddenFunctions: policy.supabase.forbidden_functions,
    configBefore,
    configAfter,
  });
  assert.deepEqual(affected, ['bdag-ledger']);
  const contracts = gate.buildFunctionContracts({ affectedFunctions: affected, graph, configBefore, configAfter, changes });
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].name, 'bdag-ledger');
  assert.equal(contracts[0].verify_jwt, true);
  assert.equal(contracts[0].source_changed, true);
  assert.equal(gate.classifyRisk({ affectedFunctions: affected, changedPaths: changes.map(item => item.path), configBefore, configAfter }).level, 'HIGH');
});

test('F2 managed transition attests the canonical pinned bdag-ledger bundle', async () => {
  const { gate } = await loadGateAndPolicy();
  const repositoryRoot = new URL('..', import.meta.url);
  const rootPath = repositoryRoot.pathname.startsWith('/') && /^[A-Za-z]:/.test(repositoryRoot.pathname.slice(1))
    ? decodeURIComponent(repositoryRoot.pathname.slice(1))
    : decodeURIComponent(repositoryRoot.pathname);
  const sources = Object.fromEntries(Object.entries(
    collectFunctionSources(join(rootPath, 'supabase', 'functions'), rootPath),
  ).map(([path, source]) => [path, source.replace(/\r\n/g, '\n')]));
  // Keep the historical F2 proof bound to its immutable source, independently of later releases.
  sources['supabase/functions/bdag-ledger/index.ts'] = execFileSync('git', [
    'show', '97f6638acaa5be2af336b427184c11185e3d0fe1:supabase/functions/bdag-ledger/index.ts',
  ], { cwd: rootPath, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  const graph = gate.buildFunctionGraph(sources);
  const configBefore = gate.parseFunctionConfig(execFileSync(
    'git', ['show', 'f786f0d627f5a5dd330e503c531b05ba84c45daa:supabase/config.toml'],
    { cwd: rootPath, encoding: 'utf8' },
  ));
  const configAfter = gate.parseFunctionConfig(readFileSync(join(rootPath, 'supabase', 'config.toml'), 'utf8'));
  const contracts = gate.buildFunctionContracts({
    affectedFunctions: ['bdag-ledger'],
    graph,
    configBefore,
    configAfter,
    changes: [{ status: 'M', path: 'supabase/functions/bdag-ledger/index.ts' }],
  });
  assert.equal(contracts[0].source_sha256, F2_MANAGED_SCOPE_TRANSITION.function_source_sha256);
  assert.deepEqual(gate.analyzeFunctionReproducibility({ affectedFunctions: ['bdag-ledger'], graph }), {
    allowed: true,
    blockedFunctions: [],
    findings: [],
  });
});

test('literal dynamic imports resolve while nonliteral imports deny', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.deepEqual(gate.parseModuleSpecifiers("await import('./worker.ts');", 'supabase/functions/agora-token/index.ts'), [
    { kind: 'dynamic', specifier: './worker.ts' },
  ]);
  assertDenied(() => gate.parseModuleSpecifiers('await import(moduleName);', 'supabase/functions/agora-token/index.ts'), 'AMBIGUOUS_IMPORT');
  assertDenied(() => gate.parseModuleSpecifiers('await import(`./${name}.ts`);', 'supabase/functions/agora-token/index.ts'), 'AMBIGUOUS_IMPORT');
});

test('implicit Deno config and module syntaxes outside the approved graph fail closed', async () => {
  const { gate } = await loadGateAndPolicy();
  for (const [path, source] of [
    ['supabase/functions/agora-token/deno.json', '{"imports":{"alias":"./other.ts"}}'],
    ['supabase/functions/agora-token/deno.jsonc', '{"imports":{}}'],
    ['supabase/functions/agora-token/native.wasm', 'not-a-text-module'],
  ]) {
    assertDenied(() => gate.buildFunctionGraph({
      'supabase/functions/agora-token/index.ts': 'export const value = true;\n',
      [path]: source,
    }), 'UNSUPPORTED_FUNCTION_SOURCE');
  }
  for (const source of [
    "const value = require('./worker.ts');\n",
    "import value = require('./worker.ts');\n",
    '/// <reference path="./worker.ts" />\nexport const value = true;\n',
    '/// <reference types="npm:@types/node" />\nexport const value = true;\n',
  ]) {
    assertDenied(() => gate.buildFunctionGraph({
      'supabase/functions/agora-token/index.ts': source,
      'supabase/functions/agora-token/worker.ts': 'export const value = true;\n',
    }), 'AMBIGUOUS_IMPORT');
  }
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

test('HTTP imports require an approved content-addressed host and path', async () => {
  const { gate } = await loadGateAndPolicy();
  const sha = 'a'.repeat(40);
  const graph = gate.buildFunctionGraph({
    'supabase/functions/agora-token/index.ts': `import 'https://example.com/cache/${sha}/module.ts';\n`,
    'supabase/functions/create-media-upload/index.ts': `import 'https://raw.githubusercontent.com/example/project/${sha}/module.ts';\n`,
  });
  const result = gate.analyzeFunctionReproducibility({
    affectedFunctions: ['agora-token', 'create-media-upload'],
    graph,
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockedFunctions, ['agora-token']);
  assert.equal(result.findings[0].specifier, `https://example.com/cache/${sha}/module.ts`);
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

test('every database migration is high risk before any release authorization', async () => {
  const { gate } = await loadGateAndPolicy();
  const path = 'supabase/migrations/20261010000000_wallet_adjustment.sql';
  const result = gate.classifyRisk({
    affectedFunctions: [],
    changedPaths: [path],
    configBefore: {},
    configAfter: {},
  });
  assert.equal(result.level, 'HIGH');
  assert.ok(result.findings.some(finding => finding.code === 'DATABASE_MIGRATION' && finding.path === path));
});

test('Admin Web production inputs share the exact external catalog and remain high risk', async () => {
  const { gate } = await loadGateAndPolicy();
  const paths = [
    'apps/admin-web/src/main.tsx',
    'shared/web-deployment/cloudflare-pages.json',
    'shared/web-media/src/BrowserVideoPreview.tsx',
    'shared/adsOperationalTruth.ts',
    'shared/adsErrorPresentation.ts',
    'assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png',
  ];
  const result = gate.classifyRisk({
    affectedFunctions: [], changedPaths: paths, configBefore: {}, configAfter: {},
  });
  assert.equal(result.level, 'HIGH');
  assert.deepEqual(result.findings.filter(item => item.code === 'ADMIN_WEB_PRODUCTION_RESOURCE')
    .map(item => item.path).sort(), [...paths].sort());
  assert.deepEqual(gate.classifyChangedPaths(paths.map(path => ({ status: 'M', path, fileType: 'file' }))).productive, []);
});

test('Admin production release authority is HIGH risk without triggering an Admin deployment by itself', async () => {
  const { gate } = await loadGateAndPolicy();
  const path = 'scripts/nelyon-admin-production-release.mjs';
  const changes = [{ status: 'M', path, fileType: 'file' }];
  const risk = gate.classifyRisk({ affectedFunctions: [], changedPaths: [path], configBefore: {}, configAfter: {} });
  assert.equal(risk.level, 'HIGH');
  assert.ok(risk.findings.some(finding => finding.code === 'GATE_AUTHORITY_CHANGE' && finding.path === path));
  assert.deepEqual(gate.classifyChangedPaths(changes).productive, []);
});

test('Admin recovery request and manifest are source-bound and carry no Supabase resources', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(policy.scope_confirmations.admin_recovery, 'ADMIN_RECOVERY_EXACT_SOURCE');
  assert.deepEqual(policy.admin_recovery, {
    source_event: 'workflow_dispatch', source_ref: 'refs/heads/main', source_mode: 'release',
    source_conclusion: 'failure', same_approved_sha_required: true,
    supabase_post_snapshot_status: 'success', supabase_postcheck_status: 'success',
    admin_enabled_required: true, admin_finalize_status: 'not_success',
    rollback_required_after_candidate_or_promote: true, productive_resources: [],
    supabase_mutation_allowed: false,
  });
  const recoveryRequest = request({
    mode: 'admin_recovery', scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: '987654321', productiveResources: [],
  });
  assert.equal(gate.validateRequest(recoveryRequest, policy).recoverySourceRunId, '987654321');
  for (const patch of [
    { recoverySourceRunId: null }, { recoverySourceRunId: '0' }, { scopeConfirmation: 'RELEASE_HIGH_RISK' },
    { productiveResources: ['supabase/migrations/rogue.sql'] },
  ]) assertDenied(() => gate.validateRequest({ ...recoveryRequest, ...patch }, policy),
    patch.productiveResources ? 'ADMIN_RECOVERY_MUTATION_FORBIDDEN' : patch.scopeConfirmation ? 'SCOPE_CONFIRMATION_MISMATCH' : 'INVALID_RECOVERY_SOURCE');
  assertDenied(() => gate.validateRequest(request({ recoverySourceRunId: '987654321' }), policy), 'INVALID_RECOVERY_SOURCE');

  const manifest = gate.buildManifest(manifestInput(policy, { request: recoveryRequest }));
  assert.equal(manifest.result, 'NO PRODUCTIVE CHANGES');
  assert.equal(manifest.delta.productive_change_count, 0);
  assert.deepEqual(manifest.resources, { config_changed: false, function_contracts: [], functions: [], migrations: [] });
  assert.deepEqual(manifest.recovery, { kind: 'admin_cloudflare_forward_completion', source_run_id: '987654321' });
  assertDenied(() => gate.buildManifest(manifestInput(policy, {
    request: recoveryRequest, risk: { level: 'STANDARD', findings: [] },
  })), 'INVALID_RISK_CLASSIFICATION');
});

test('Admin recovery source provenance fails closed on SHA, artifacts, postcheck, finalize, and rollback drift', async (t) => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = adminRecoverySourceFixture(t, gate, policy);
  const verified = gate.verifyAdminRecoverySourceProvenance(fixture);
  assert.equal(verified.result, 'ADMIN_RECOVERY_SOURCE_VERIFIED');
  assert.equal(verified.source_run_id, fixture.recoveryRequest.recoverySourceRunId);
  assert.equal(verified.source_build_sha256, '6'.repeat(64));
  assert.deepEqual(verified.source_cloudflare_prestate, {
    active_version_id: '11111111-1111-4111-8111-111111111111',
    zone_id: 'zone-1',
    routes_sha256: gate.sha256Hex(gate.canonicalJson([
      { pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' },
    ]).trimEnd()),
  });
  for (const [label, mutate] of [
    ['sha', value => { value.run.head_sha = 'f'.repeat(40); }],
    ['run', value => { value.run.event = 'push'; }],
    ['artifacts', value => { value.artifacts = value.artifacts.filter(item => item.name !== value.names.admin); }],
    ['postcheck', value => { value.observation.steps.postcheck = 'failure'; }],
    ['finalize', value => { value.observation.admin_web.finalize = 'success'; }],
    ['rollback', value => { value.observation.admin_web.recovery = 'failure'; }],
  ]) {
    const hostile = { ...fixture, run: structuredClone(fixture.run), artifacts: structuredClone(fixture.artifacts),
      observation: structuredClone(fixture.observation) };
    mutate(hostile);
    if (label === 'postcheck' || label === 'finalize' || label === 'rollback') {
      writeFileSync(join(hostile.gateEvidence.directory, 'release-observation.json'), gate.canonicalJson(hostile.observation));
    }
    assertDenied(() => gate.verifyAdminRecoverySourceProvenance(hostile), 'ADMIN_RECOVERY_SOURCE_MISMATCH');
    writeFileSync(join(hostile.gateEvidence.directory, 'release-observation.json'), gate.canonicalJson(fixture.observation));
  }

  const postcheckPath = join(fixture.gateEvidence.directory, 'postcheck-result.json');
  const observationPath = join(fixture.gateEvidence.directory, 'release-observation.json');
  const originalPostcheck = JSON.parse(readFileSync(postcheckPath, 'utf8'));
  for (const mutate of [
    value => { value.result = 'POSTCHECK_VERIFIED'; },
    value => { value.post_evidence_sha256 = '9'.repeat(64); },
    value => { value.applied_migrations.push('20261031999999'); },
    value => {
      value.changed_functions.push('rogue-edge');
      value.function_attestations.push({ name: 'rogue-edge' });
    },
  ]) {
    const hostilePostcheck = structuredClone(originalPostcheck);
    mutate(hostilePostcheck);
    writeFileSync(postcheckPath, gate.canonicalJson(hostilePostcheck));
    const hostileObservation = structuredClone(fixture.observation);
    hostileObservation.postcheck_file_sha256 = gate.sha256Hex(readFileSync(postcheckPath));
    writeFileSync(observationPath, gate.canonicalJson(hostileObservation));
    assertDenied(() => gate.verifyAdminRecoverySourceProvenance(fixture), 'ADMIN_RECOVERY_SOURCE_MISMATCH');
  }
  writeFileSync(postcheckPath, gate.canonicalJson(originalPostcheck));
  writeFileSync(observationPath, gate.canonicalJson(fixture.observation));
});

test('Admin recovery accepts only an exact successful postcheck recovery chain and recomputes its evidence', async (t) => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await adminPostcheckRecoveryChainFixture(t, gate, policy);
  const verified = gate.verifyAdminRecoveryPostcheckChainProvenance(fixture);
  assert.equal(verified.result, 'ADMIN_RECOVERY_POSTCHECK_CHAIN_VERIFIED');
  assert.equal(verified.recovery_run_id, fixture.recoveryRequest.recoverySourceRunId);
  assert.equal(verified.source_run_id, fixture.source.run_id);
  assert.equal(verified.source_sha, fixture.source.source_sha);
  assert.equal(verified.recovered_evidence_sha256, fixture.recoveryResult.current_evidence_sha256);
  assert.deepEqual(verified.source_artifact_digests, fixture.verifiedSource.source_artifact_digests);

  for (const [label, mutate, expectedCode = 'ADMIN_RECOVERY_POSTCHECK_CHAIN_MISMATCH'] of [
    ['run conclusion', value => { value.run.conclusion = 'failure'; }],
    ['run sha', value => { value.run.head_sha = 'f'.repeat(40); }],
    ['artifact digest format', value => { value.artifacts[0].digest = 'sha256:invalid'; }],
    ['request source', value => {
      const path = join(value.releaseBundle.directory, 'request.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      body.recoverySourceRunId = '1';
      writeFileSync(path, gate.canonicalJson(body));
    }],
    ['nested source', value => {
      const path = join(value.recoveryEvidence.directory, 'verified-source.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      body.source_request.mode = 'postcheck_recovery';
      body.source_request.recoverySourceRunId = '1';
      writeFileSync(path, gate.canonicalJson(body));
    }],
    ['missing source manifest', value => {
      const path = join(value.recoveryEvidence.directory, 'verified-source.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      delete body.source_manifest;
      writeFileSync(path, gate.canonicalJson(body));
    }],
    ['snapshot', value => {
      const path = join(value.recoveryEvidence.directory, 'production-recovery.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      body.evidence_sha256 = '0'.repeat(64);
      writeFileSync(path, gate.canonicalJson(body));
    }],
    ['stored result', value => {
      const path = join(value.recoveryEvidence.directory, 'postcheck-recovery-result.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      body.current_evidence_sha256 = '0'.repeat(64);
      writeFileSync(path, gate.canonicalJson(body));
    }],
  ]) {
    const hostile = await adminPostcheckRecoveryChainFixture(t, gate, policy);
    mutate(hostile);
    try {
      assertDenied(() => gate.verifyAdminRecoveryPostcheckChainProvenance(hostile), expectedCode);
    } catch (error) {
      error.message = `${label}: ${error.message}`;
      throw error;
    }
  }
});

test('Admin recovery uses a verified postcheck recovery chain for DB proof without weakening direct recovery', async (t) => {
  const { gate, policy } = await loadGateAndPolicy();
  const direct = adminRecoverySourceFixture(t, gate, policy);
  const { fixture, chain, originalSourceSha, recoveryRunId } = bindAdminSourceFixtureToPostcheckChain(direct, gate);

  assertDenied(() => gate.verifyAdminRecoverySourceProvenance(fixture), 'ADMIN_RECOVERY_SOURCE_MISMATCH');
  const verified = gate.verifyAdminRecoverySourceProvenance({
    ...fixture,
    postcheckRecoveryChain: chain,
  });
  assert.equal(verified.result, 'ADMIN_RECOVERY_SOURCE_VERIFIED');
  assert.equal(verified.source_run_id, recoveryRunId);
  assert.equal(verified.source_sha, fixture.recoveryRequest.approvedSha);
  assert.equal(verified.original_source_run_id, String(fixture.run.id));
  assert.equal(verified.original_source_sha, originalSourceSha);
  assert.equal(verified.source_cloudflare_prestate.active_version_id,
    '11111111-1111-4111-8111-111111111111');

  for (const mutate of [
    value => { value.recovery_run_id = '1'; },
    value => { value.current_sha = 'f'.repeat(40); },
    value => { value.source_run_id = '1'; },
    value => { value.source_manifest_sha256 = '0'.repeat(64); },
    value => { value.source_observation_sha256 = '0'.repeat(64); },
    value => { value.source_artifact_digests.release = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const hostile = structuredClone(chain);
    mutate(hostile);
    assertDenied(() => gate.verifyAdminRecoverySourceProvenance({
      ...fixture,
      postcheckRecoveryChain: hostile,
    }), 'ADMIN_RECOVERY_SOURCE_MISMATCH');
  }
});

test('Admin recovery Cloudflare pre-state is source-bound and rejects version, zone, or route drift', async (t) => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = adminRecoverySourceFixture(t, gate, policy);
  const verifiedSource = gate.verifyAdminRecoverySourceProvenance(fixture);
  const currentPrevious = { version_id: '11111111-1111-4111-8111-111111111111' };
  const currentRoutes = {
    zone_id: 'zone-1',
    routes: [{ id: 'current', pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }],
  };
  const result = gate.verifyAdminRecoveryCloudflarePrestate({ verifiedSource, currentPrevious, currentRoutes });
  assert.deepEqual(result, {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_CLOUDFLARE_PRESTATE_VERIFIED',
    active_version_id: currentPrevious.version_id,
    zone_id: currentRoutes.zone_id,
    routes_sha256: verifiedSource.source_cloudflare_prestate.routes_sha256,
  });
  for (const hostile of [
    { currentPrevious: { version_id: '22222222-2222-4222-8222-222222222222' }, currentRoutes },
    { currentPrevious, currentRoutes: { ...currentRoutes, zone_id: 'zone-2' } },
    { currentPrevious, currentRoutes: { ...currentRoutes,
      routes: [{ pattern: 'nelyon.app/admin', script: 'rogue-worker' }] } },
  ]) {
    assertDenied(() => gate.verifyAdminRecoveryCloudflarePrestate({ verifiedSource, ...hostile }),
      'ADMIN_RECOVERY_CLOUDFLARE_PRESTATE_MISMATCH');
  }
});

test('Admin recovery build binding rejects source, manifest, and rebuilt byte drift', async () => {
  const { gate } = await loadGateAndPolicy();
  const recoveryRequest = request({ mode: 'admin_recovery', scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: '987654321', productiveResources: [] });
  const recoveryManifest = {
    identity: { mode: 'admin_recovery', approved_sha: MAIN_SHA },
    recovery: { source_run_id: '987654321' },
  };
  const currentAdminManifest = {
    enabled: true,
    release: { mode: 'admin_recovery', recovery_source_run_id: '987654321', approved_sha: MAIN_SHA },
    source: { sha256: 'a'.repeat(64) },
  };
  const currentBuild = { approved_sha: MAIN_SHA,
    source_manifest_sha256: gate.sha256Hex(gate.canonicalJson(currentAdminManifest).trimEnd()),
    dist_sha256: 'b'.repeat(64) };
  const verifiedSource = { result: 'ADMIN_RECOVERY_SOURCE_VERIFIED', source_run_id: '987654321',
    source_sha: MAIN_SHA, source_admin_source_sha256: 'a'.repeat(64), source_build_sha256: 'b'.repeat(64) };
  assert.equal(gate.verifyAdminRecoveryBuildBinding({ recoveryRequest, recoveryManifest, verifiedSource,
    currentAdminManifest, currentBuild }), true);
  for (const mutate of [
    value => { value.verifiedSource.source_run_id = '1'; },
    value => { value.currentAdminManifest.source.sha256 = 'c'.repeat(64); },
    value => { value.currentBuild.dist_sha256 = 'd'.repeat(64); },
  ]) {
    const hostile = { recoveryRequest: structuredClone(recoveryRequest), recoveryManifest: structuredClone(recoveryManifest),
      verifiedSource: structuredClone(verifiedSource), currentAdminManifest: structuredClone(currentAdminManifest),
      currentBuild: structuredClone(currentBuild) };
    mutate(hostile);
    assertDenied(() => gate.verifyAdminRecoveryBuildBinding(hostile), 'ADMIN_RECOVERY_POSTCHECK_FAILED');
  }
});

test('Admin recovery permits only protected recovery authority evolution when rebuilt bytes stay exact', async () => {
  const { gate } = await loadGateAndPolicy();
  const recoveryRequest = request({ mode: 'admin_recovery', scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: '987654321', productiveResources: [] });
  const recoveryManifest = {
    identity: { mode: 'admin_recovery', approved_sha: MAIN_SHA },
    recovery: { source_run_id: '987654321' },
  };
  const sourceFiles = [
    { path: '.github/workflows/nelyon-production-release.yml', bytes: 100, sha256: '1'.repeat(64) },
    { path: 'scripts/nelyon-admin-production-release.mjs', bytes: 150, sha256: '2'.repeat(64) },
    { path: 'apps/admin-web/src/main.tsx', bytes: 200, sha256: '3'.repeat(64) },
  ];
  const currentFiles = structuredClone(sourceFiles);
  currentFiles[0] = { ...currentFiles[0], bytes: 120, sha256: '4'.repeat(64) };
  currentFiles[1] = { ...currentFiles[1], bytes: 175, sha256: '5'.repeat(64) };
  const sourceDigest = gate.sha256Hex(gate.canonicalJson(sourceFiles).trimEnd());
  const currentDigest = gate.sha256Hex(gate.canonicalJson(currentFiles).trimEnd());
  const currentAdminManifest = {
    enabled: true,
    release: { mode: 'admin_recovery', recovery_source_run_id: '987654321', approved_sha: MAIN_SHA },
    source: { files: currentFiles, sha256: currentDigest },
  };
  const currentBuild = {
    approved_sha: MAIN_SHA,
    source_manifest_sha256: gate.sha256Hex(gate.canonicalJson(currentAdminManifest).trimEnd()),
    dist_sha256: 'b'.repeat(64),
  };
  const verifiedSource = {
    result: 'ADMIN_RECOVERY_SOURCE_VERIFIED',
    source_run_id: '987654321',
    source_sha: MAIN_SHA,
    source_admin_source_sha256: sourceDigest,
    source_admin_files: sourceFiles,
    source_build_sha256: 'b'.repeat(64),
  };
  assert.equal(gate.verifyAdminRecoveryBuildBinding({ recoveryRequest, recoveryManifest, verifiedSource,
    currentAdminManifest, currentBuild }), true);

  for (const mutate of [
    value => { value.currentAdminManifest.source.files[2].sha256 = '6'.repeat(64); },
    value => { value.currentAdminManifest.source.files.push({
      path: 'apps/admin-web/src/rogue.ts', bytes: 1, sha256: '7'.repeat(64),
    }); },
    value => { delete value.verifiedSource.source_admin_files; },
  ]) {
    const hostile = { recoveryRequest: structuredClone(recoveryRequest), recoveryManifest: structuredClone(recoveryManifest),
      verifiedSource: structuredClone(verifiedSource), currentAdminManifest: structuredClone(currentAdminManifest),
      currentBuild: structuredClone(currentBuild) };
    mutate(hostile);
    hostile.currentAdminManifest.source.sha256 = gate.sha256Hex(
      gate.canonicalJson(hostile.currentAdminManifest.source.files).trimEnd(),
    );
    hostile.currentBuild.source_manifest_sha256 = gate.sha256Hex(
      gate.canonicalJson(hostile.currentAdminManifest).trimEnd(),
    );
    assertDenied(() => gate.verifyAdminRecoveryBuildBinding(hostile), 'ADMIN_RECOVERY_POSTCHECK_FAILED');
  }
});

test('Admin recovery permits only the exact no-transform Worker transition alongside protected authority evolution', async () => {
  const { gate } = await loadGateAndPolicy();
  const recoveryRequest = request({ mode: 'admin_recovery', scopeConfirmation: 'ADMIN_RECOVERY_EXACT_SOURCE',
    recoverySourceRunId: '987654321', productiveResources: [] });
  const recoveryManifest = {
    identity: { mode: 'admin_recovery', approved_sha: MAIN_SHA },
    recovery: { source_run_id: '987654321' },
  };
  const sourceFiles = [
    { path: '.github/workflows/nelyon-production-release.yml', bytes: 65184,
      sha256: 'a8f8c0154e9b21f4b401bb591efe48dfdfb69e589c78ccecd07118d4b5a4229d' },
    { path: 'apps/admin-web/deployment/tests/worker.test.mjs', bytes: 4201,
      sha256: 'c8c35cc79f24525d4c97b24e28bb7e8b63637d47fab2b5b64a579c633be144a6' },
    { path: 'apps/admin-web/deployment/worker.mjs', bytes: 1019,
      sha256: '8f6e5a9e09340f2085c651130d718387678293512ee6da44de94e97f728191b8' },
    { path: 'scripts/nelyon-admin-production-release.mjs', bytes: 32319,
      sha256: 'd70d6f5c769de7f625f726a0cd65e1469340aceeaab2995ec504849cfeb332b0' },
    { path: 'apps/admin-web/src/main.tsx', bytes: 200, sha256: '3'.repeat(64) },
  ];
  const currentFiles = structuredClone(sourceFiles);
  currentFiles[0] = { ...currentFiles[0], bytes: 69611,
    sha256: '94f5c712a7093c38b4de369f4fdbd237ee475649d25b47ac0b416570e05bd984' };
  currentFiles[1] = { ...currentFiles[1], bytes: 4298,
    sha256: 'a2f86e889c200343248ffa539160dd89f66c0c318ec3e1a3465739376e327cf1' };
  currentFiles[2] = { ...currentFiles[2], bytes: 1033,
    sha256: 'a11a8ddb4341cbe15fe32691c0ee9efe2ecaebd2c192c5fbde2b56648fffee62' };
  currentFiles[3] = { ...currentFiles[3], bytes: 37752,
    sha256: '8a58f00db3426e78d6f42ea87c1c276d48363ad520f59a6f5fda916ad1474e61' };
  const sourceDigest = gate.sha256Hex(gate.canonicalJson(sourceFiles).trimEnd());
  const currentDigest = gate.sha256Hex(gate.canonicalJson(currentFiles).trimEnd());
  const currentAdminManifest = {
    enabled: true,
    release: { mode: 'admin_recovery', recovery_source_run_id: '987654321', approved_sha: MAIN_SHA },
    source: { files: currentFiles, sha256: currentDigest },
  };
  const currentBuild = {
    approved_sha: MAIN_SHA,
    source_manifest_sha256: gate.sha256Hex(gate.canonicalJson(currentAdminManifest).trimEnd()),
    dist_sha256: 'b'.repeat(64),
  };
  const verifiedSource = {
    result: 'ADMIN_RECOVERY_SOURCE_VERIFIED',
    source_run_id: '987654321',
    source_sha: MAIN_SHA,
    source_admin_source_sha256: sourceDigest,
    source_admin_files: sourceFiles,
    source_build_sha256: 'b'.repeat(64),
  };
  assert.equal(gate.verifyAdminRecoveryBuildBinding({ recoveryRequest, recoveryManifest, verifiedSource,
    currentAdminManifest, currentBuild }), true);

  for (const mutate of [
    value => { value.currentAdminManifest.source.files[1].sha256 = '6'.repeat(64); },
    value => { value.currentAdminManifest.source.files[2].bytes += 1; },
    value => { value.verifiedSource.source_admin_files[2].sha256 = '7'.repeat(64); },
    value => { value.currentAdminManifest.source.files[4].sha256 = '8'.repeat(64); },
  ]) {
    const hostile = { recoveryRequest: structuredClone(recoveryRequest), recoveryManifest: structuredClone(recoveryManifest),
      verifiedSource: structuredClone(verifiedSource), currentAdminManifest: structuredClone(currentAdminManifest),
      currentBuild: structuredClone(currentBuild) };
    mutate(hostile);
    hostile.verifiedSource.source_admin_source_sha256 = gate.sha256Hex(
      gate.canonicalJson(hostile.verifiedSource.source_admin_files).trimEnd(),
    );
    hostile.currentAdminManifest.source.sha256 = gate.sha256Hex(
      gate.canonicalJson(hostile.currentAdminManifest.source.files).trimEnd(),
    );
    hostile.currentBuild.source_manifest_sha256 = gate.sha256Hex(
      gate.canonicalJson(hostile.currentAdminManifest).trimEnd(),
    );
    assertDenied(() => gate.verifyAdminRecoveryBuildBinding(hostile), 'ADMIN_RECOVERY_POSTCHECK_FAILED');
  }
});

function manifestInput(policy, overrides = {}) {
  const result = {
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
    compiler: {
      path: 'scripts/nelyon-production-release.mjs',
      sha256: 'a'.repeat(64),
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: 'b'.repeat(64),
    },
    generatedAt: '2026-10-09T12:00:00.000Z',
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'functionContracts')) {
    result.functionContracts = result.affectedFunctions.map((name, index) => ({
      name,
      entrypoint: `supabase/functions/${name}/index.ts`,
      import_map: null,
      verify_jwt: true,
      source_changed: true,
      source_files: [{ path: `supabase/functions/${name}/index.ts`, sha256: String(index + 1).padStart(64, '0') }],
      source_sha256: String(index + 1).padStart(64, '0'),
    }));
  }
  return result;
}

test('release confirmation class must match the computed manifest risk', async () => {
  const { gate, policy: loadedPolicy } = await loadGateAndPolicy();
  const policy = asVerifiedCutoverPolicy(loadedPolicy);
  assertDenied(() => gate.buildManifest(manifestInput(policy, {
    request: request({ mode: 'release', scopeConfirmation: 'RELEASE_STANDARD' }),
  })), 'HIGH_RISK_CONFIRMATION_REQUIRED');
  const high = gate.buildManifest(manifestInput(policy, {
    request: request({ mode: 'release', scopeConfirmation: 'RELEASE_HIGH_RISK' }),
  }));
  assert.equal(high.risk.level, 'HIGH');
  assert.equal(high.identity.scope_confirmation, 'RELEASE_HIGH_RISK');
  assertDenied(() => gate.buildManifest(manifestInput(policy, {
    request: request({ mode: 'release', scopeConfirmation: 'RELEASE_HIGH_RISK' }),
    risk: { level: 'STANDARD', findings: [] },
  })), 'SCOPE_CONFIRMATION_MISMATCH');
});

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
  assert.equal(manifest.resources.function_contracts[0].name, 'agora-token');
  assert.equal(manifest.compiler.snapshot_adapter_sha256, 'b'.repeat(64));
  assert.equal(manifest.risk.level, 'HIGH');
  assert.equal(manifest.blockers[0].code, 'FLOATING_DEPENDENCY');
  assert.equal(manifest.result, 'DENY');
});

test('baseline blocked resources remain unreleasable even when current imports look clean', async () => {
  const { gate, policy: loadedPolicy } = await loadGateAndPolicy();
  const policy = structuredClone(loadedPolicy);
  policy.baseline.blocked_resources = ['agora-token'];
  const input = manifestInput(policy, {
    affectedFunctions: ['agora-token'],
    classified: {
      all: [{ status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' }],
      config: [],
      functions: [{ status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' }],
      governance: [],
      migrations: [],
      other: [],
      productive: [{ status: 'M', path: 'supabase/functions/agora-token/index.ts', fileType: 'file' }],
      shared: [],
    },
    reproducibility: { allowed: true, blockedFunctions: [], findings: [] },
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'DENY');
  assert.ok(manifest.blockers.some(finding => finding.code === 'BASELINE_RESOURCE_UNREPRODUCIBLE' && finding.resource === 'agora-token'));
});

test('governance-only delta reports NO PRODUCTIVE CHANGES', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const manifest = gate.buildManifest(manifestInput(policy));
  assert.equal(manifest.result, 'NO PRODUCTIVE CHANGES');
  assert.deepEqual(manifest.resources, { functions: [], function_contracts: [], migrations: [], config_changed: false });
});

test('postcheck recovery manifest strips every productive resource from the read-only route', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const input = manifestInput(policy, {
    request: request({
      mode: 'postcheck_recovery',
      scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
      recoverySourceRunId: '39066492485',
    }),
    classified: {
      all: [{ status: 'A', path: 'supabase/migrations/20261010000000_forbidden.sql', fileType: 'file' }],
      config: [{ status: 'M', path: 'supabase/config.toml', fileType: 'file' }],
      functions: [{ status: 'M', path: 'supabase/functions/ads-v2-delivery/index.ts', fileType: 'file' }],
      governance: [], migrations: [], other: [],
      productive: [{ status: 'A', path: 'supabase/migrations/20261010000000_forbidden.sql', fileType: 'file' }],
      shared: [],
    },
    migrations: [{ version: '20261010000000', path: 'supabase/migrations/20261010000000_forbidden.sql' }],
    affectedFunctions: ['ads-v2-delivery'],
    functionContracts: [],
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'NO PRODUCTIVE CHANGES');
  assert.equal(manifest.delta.productive_change_count, 0);
  assert.deepEqual(manifest.resources, { functions: [], function_contracts: [], migrations: [], config_changed: false });
  assertDenied(() => gate.buildManifest({
    ...input,
    managedScopeTransition: {
      id: F2_MANAGED_SCOPE_TRANSITION.id,
      attested_source_sha: F2_MANAGED_SCOPE_TRANSITION.attested_source_sha,
      approved_sha: MAIN_SHA,
      descendant_verified: true,
      migration_blob: F2_MANAGED_SCOPE_TRANSITION.migration_blob,
    },
  }), 'INVALID_MANAGED_SCOPE_TRANSITION');
});

test('F3 postcheck recovery skips productive finance attestation before manifest construction', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const migration = {
    path: policy.finance_authority_transition.migration_path,
    version: '20261025011000',
  };
  const result = gate.attestFinanceAuthorityTransition({
    mode: 'postcheck_recovery',
    policy,
    approvedSha: MAIN_SHA,
    changes: [
      { status: 'A', path: migration.path },
      { status: 'M', path: policy.finance_authority_transition.function_path },
    ],
    migrations: [migration],
    affectedFunctions: [policy.finance_authority_transition.function],
  });
  assert.deepEqual(result, { migrations: [migration], attestation: null });
});

test('F3 postcheck recovery emits a zero-resource manifest for the exact failed release source', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const transition = policy.finance_authority_transition;
  const input = manifestInput(policy, {
    request: request({
      mode: 'postcheck_recovery',
      scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
      recoverySourceRunId: '40166468648',
    }),
    migrations: [{
      path: transition.migration_path,
      version: '20261025011000',
    }],
    affectedFunctions: [transition.function],
    functionContracts: [],
    financeAuthorityTransition: null,
  });
  const manifest = gate.buildManifest(input);
  assert.equal(manifest.result, 'NO PRODUCTIVE CHANGES');
  assert.equal(manifest.delta.productive_change_count, 0);
  assert.deepEqual(manifest.resources, {
    functions: [],
    function_contracts: [],
    migrations: [],
    config_changed: false,
  });
  assertDenied(() => gate.buildManifest({
    ...input,
    financeAuthorityTransition: {
      id: transition.id,
      phase: transition.phase,
    },
  }), 'INVALID_FINANCE_AUTHORITY_TRANSITION');
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

test('source artifact recovery provenance binds the exact failed release and immutable files', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = recoveryArtifactFixture(t, gate, policy);
  const verified = gate.verifyRecoveryArtifactProvenance(fixture);
  assert.equal(verified.source_run_id, fixture.source.run_id);
  assert.equal(verified.manifest_sha256, fixture.source.manifest_sha256);
  assert.equal(verified.source_manifest.identity.release_id, fixture.source.release_id);
  assert.equal(verified.source_observation.steps.postcheck, 'failure');

  for (const mutate of [
    candidate => { candidate.run.head_sha = '1'.repeat(40); },
    candidate => { candidate.run.run_attempt = 2; },
    candidate => { candidate.run.repository.full_name = 'other/repository'; },
    candidate => { candidate.artifacts[0].digest = candidate.artifacts[0].digest.slice(0, 24); },
    candidate => { candidate.source.release_id = 'different-release'; },
  ]) {
    const candidate = structuredClone(fixture);
    candidate.releaseBundle = fixture.releaseBundle;
    candidate.gateEvidence = fixture.gateEvidence;
    mutate(candidate);
    assertDenied(() => gate.verifyRecoveryArtifactProvenance(candidate), 'RECOVERY_SOURCE_PROVENANCE_MISMATCH');
  }

  writeFileSync(join(fixture.releaseBundle.directory, 'bundle', 'manifest.json'), `${readFileSync(join(fixture.releaseBundle.directory, 'bundle', 'manifest.json'), 'utf8')} `);
  assertDenied(() => gate.verifyRecoveryArtifactProvenance(fixture), 'RECOVERY_SOURCE_PROVENANCE_MISMATCH');
});

test('F3 post-snapshot failure is an exact recoverable read-only source', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = recoveryArtifactFixture(t, gate, policy, 4);
  const verified = gate.verifyRecoveryArtifactProvenance(fixture);
  assert.equal(verified.source_run_id, '40166468648');
  assert.equal(verified.source_observation.steps.post_snapshot, 'failure');
  assert.equal(verified.source_observation.steps.postcheck, 'skipped');
  assert.equal(verified.source_observation.post_evidence_sha256, null);
});

test('Stories B1 failed postcheck is bound to exact immutable artifacts and six productive Edge transitions', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = recoveryArtifactFixture(t, gate, policy, 7);
  const verified = gate.verifyRecoveryArtifactProvenance(fixture);
  assert.equal(verified.source_run_id, '40473092474');
  assert.equal(verified.source_sha, '8e2fc6b896e3f409e11087d4f9f423581126b617');
  assert.equal(verified.source_observation.steps.migrations, 'success');
  assert.equal(verified.source_observation.steps.functions, 'success');
  assert.equal(verified.source_observation.steps.post_snapshot, 'success');
  assert.equal(verified.source_observation.steps.postcheck, 'failure');
  assert.equal(fixture.source.edge_transitions.length, 6);

  for (const mutate of [
    candidate => { candidate.source.edge_transitions[0].from.version += 1; },
    candidate => { candidate.source.edge_transitions[0].to.source_sha256 = 'f'.repeat(64); },
    candidate => { candidate.source.edge_transitions[0].to.verify_jwt = true; },
  ]) {
    const hostile = structuredClone(fixture);
    hostile.releaseBundle = fixture.releaseBundle;
    hostile.gateEvidence = fixture.gateEvidence;
    mutate(hostile);
    assertDenied(() => gate.validateRecoverySource(hostile.source), 'INVALID_RECOVERY_SOURCE');
  }
});

test('Control Center Admin failure is bound to exact immutable artifacts after successful Supabase postcheck', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = recoveryArtifactFixture(t, gate, policy, 8);
  const verified = gate.verifyRecoveryArtifactProvenance(fixture);
  assert.equal(verified.source_run_id, '41243646356');
  assert.equal(verified.source_sha, '58a71b66f07899d16b780f6f967279677dcc2ed4');
  assert.equal(verified.source_observation.steps.migrations, 'success');
  assert.equal(verified.source_observation.steps.functions, 'success');
  assert.equal(verified.source_observation.steps.post_snapshot, 'success');
  assert.equal(verified.source_observation.steps.postcheck, 'success');
  assert.deepEqual(verified.source_manifest.resources.functions, []);
  assert.deepEqual(verified.source_manifest.resources.migrations.map(item => item.version), [
    '20261031020113',
    '20261031025722',
    '20261031032022',
  ]);

  for (const mutate of [
    candidate => { candidate.source.gate_artifact.digest = `sha256:${'0'.repeat(64)}`; },
    candidate => { candidate.source.postcheck_status = 'failure'; },
    candidate => { candidate.source.expected_migrations[1].blob = '0'.repeat(40); },
    candidate => { candidate.source.productive_resources.push('function:bdag-ledger'); },
  ]) {
    const hostile = structuredClone(fixture);
    hostile.releaseBundle = fixture.releaseBundle;
    hostile.gateEvidence = fixture.gateEvidence;
    mutate(hostile);
    assertDenied(() => gate.validateRecoverySource(hostile.source), 'INVALID_RECOVERY_SOURCE');
  }
});

test('source artifact recovery rejects unsafe entries missing files and non-postcheck failures', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const unsafe = recoveryArtifactFixture(t, gate, policy);
  writeFileSync(join(unsafe.releaseBundle.directory, 'unexpected.txt'), 'x');
  assertDenied(() => gate.verifyRecoveryArtifactProvenance(unsafe), 'UNSAFE_RECOVERY_ARTIFACT');

  const missing = recoveryArtifactFixture(t, gate, policy);
  rmSync(join(missing.gateEvidence.directory, 'release-observation.json'));
  assertDenied(() => gate.verifyRecoveryArtifactProvenance(missing), 'UNSAFE_RECOVERY_ARTIFACT');

  const wrongStep = recoveryArtifactFixture(t, gate, policy);
  wrongStep.observation.steps.functions = 'failure';
  writeFileSync(join(wrongStep.gateEvidence.directory, 'release-observation.json'), gate.canonicalJson(wrongStep.observation));
  assertDenied(() => gate.verifyRecoveryArtifactProvenance(wrongStep), 'RECOVERY_SOURCE_PROVENANCE_MISMATCH');
});

test('postcheck recovery verifies B7 current state without productive resources', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '39066492485');
  assert.equal(result.current_sha, MAIN_SHA);
  assert.equal(result.migrations.count, 337);
  assert.equal(result.functions.items.length, 12);
  assert.equal(result.security_advisor.baseline_count, 554);
  assert.equal(result.security_advisor.exception_count, 18);
  assert.deepEqual(result.finance.policy, fixture.controlledPolicy.supabase.finance_policy);
  assert.equal(result.premium_state.legacy.content_count, 2);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token|authorization/i);
});

test('postcheck recovery verifies the exact P2 migration Edge version and Premium relation authority', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 1);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '39157300357');
  assert.equal(result.migrations.count, 341);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`, '20261018170000_creator_premium_content_safety_p2_evidence_runtime');
  assert.deepEqual(result.functions.items.map(item => item.name), ['content-safety-scan']);
  assert.equal(result.functions.items[0].version, 42);
  assert.deepEqual(result.premium_state.legacy, { content_count: 4, pending_review_count: 2, deleted_count: 2 });
  assert.equal(result.premium_state.relation_security.sha256, '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6');
});

test('postcheck recovery verifies the exact C4 migration and three deployed Edge versions', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 2);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '39195966131');
  assert.equal(result.migrations.count, 344);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`, '20261019023431_creator_premium_f1_c4_final_recovery');
  assert.deepEqual(result.functions.items.map(item => [item.name, item.version]), [
    ['content-safety-scan', 44],
    ['create-stream-upload', 38],
    ['video-semantic-index', 15],
  ]);
  assert.deepEqual(result.premium_state.legacy, { content_count: 7, pending_review_count: 1, deleted_count: 2 });
  assert.equal(result.premium_state.relation_security.sha256, '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6');
});

test('postcheck recovery verifies the exact F2 migration and deployed bdag-ledger authority', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 3);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '40139736749');
  assert.equal(result.migrations.count, 351);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`, '20261024173500_creator_premium_f2_complete_monetization');
  assert.deepEqual(result.functions.items.map(item => [item.name, item.version, item.source_sha256]), [[
    'bdag-ledger',
    45,
    '0b0db8c46041127dac341dfaa9673a7da4b15747ac71639bdeed00e8097be002',
  ]]);
  assert.deepEqual(result.premium_state.legacy, { content_count: 9, pending_review_count: 0, deleted_count: 5 });
  assert.equal(result.premium_state.relation_security.sha256, '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6');
  assert.deepEqual(result.finance.policy, fixture.controlledPolicy.supabase.finance_policy);
});

test('postcheck recovery verifies the exact F3 applied state after a snapshot-only failure', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 4);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '40166468648');
  assert.equal(result.migrations.count, 352);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`,
    '20261025011000_creator_premium_f3_bounded_financial_activation');
  assert.deepEqual(result.functions.items.map(item => [item.name, item.version, item.source_sha256]), [[
    'bdag-ledger',
    46,
    'd039819170e2c347ac8a6c88f77fa4461dfae4091a9e937ed47897b2c115e56c',
  ]]);
  assert.equal(result.premium_state.relation_security.sha256,
    '34e13339d4627b7684699288f789780267d7340afbd1c3de33029624e60a2f6a');
  assert.deepEqual(result.premium_state.legacy,
    { content_count: 9, pending_review_count: 0, deleted_count: 5 });
  assert.deepEqual(result.finance.policy, fixture.controlledPolicy.supabase.finance_policy);
});

test('postcheck recovery verifies the exact F4 general state after a snapshot-only failure', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 5);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const result = verify(fixture);
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '40268500711');
  assert.equal(result.migrations.count, 355);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`,
    F4_GENERAL_MIGRATION);
  assert.deepEqual(result.functions.items, []);
  assert.equal(result.functions.count, 34);
  assert.deepEqual(result.finance.policy, {
    purchase_enabled: true,
    subscription_enabled: true,
    refunds_enabled: true,
    platform_fee_bps: 2000,
  });
  assert.equal(result.finance.premium_transaction_count, 0);
  assert.equal(result.premium_state.relation_security.sha256,
    'ce78623224db34251b55ae8500eaea982d80912378cb3347ad9bf99ee24193a8');
  assert.deepEqual(result.premium_state.legacy,
    { content_count: 9, pending_review_count: 0, deleted_count: 5 });

  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };
  for (const mutate of [
    item => { item.version += 1; },
    item => { item.ezbr_sha256 = 'f'.repeat(64); },
    item => { item.verify_jwt = !item.verify_jwt; },
  ]) {
    const drift = structuredClone(fixture);
    const edge = drift.currentEvidence.functions.items[0];
    mutate(edge);
    drift.currentEvidence.functions.sha256 = gate.sha256Hex(
      gate.canonicalJson(drift.currentEvidence.functions.items),
    );
    resign(drift);
    assertDenied(() => verify(drift), 'RECOVERY_POSTCHECK_FAILED');
  }
  const policyDrift = structuredClone(fixture);
  policyDrift.currentEvidence.finance.policy.purchase_enabled = false;
  resign(policyDrift);
  assert.throws(() => verify(policyDrift), /FINANCE_POLICY_CHANGED|INVALID_FINANCE_SNAPSHOT/);
});

test('postcheck recovery verifies exact F5 authority, Edge, cron and zero release-attributed movement', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 6);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };
  const result = verify(fixture);
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '40324910390');
  assert.equal(result.migrations.count, 356);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`,
    F5_AUTONOMOUS_MIGRATION);
  assert.deepEqual(result.functions.items.map(item => [item.name, item.version, item.source_sha256]), [[
    'bdag-ledger',
    47,
    '0255ad56d7b56792dea46c333cb207dc0680bcdf25a1784d2925b7f85bf0bd8e',
  ]]);
  assert.deepEqual(result.finance.policy, {
    purchase_enabled: true,
    subscription_enabled: true,
    refunds_enabled: true,
    platform_fee_bps: 2000,
  });
  assert.equal(result.finance.premium_transaction_count, 1);
  assert.equal(fixture.currentEvidence.finance_facts.phase, 'f5_autonomous');
  assert.deepEqual(fixture.currentEvidence.finance_facts.mandates, []);
  assert.deepEqual(fixture.currentEvidence.finance_facts.attempts, []);
  assert.equal(fixture.currentEvidence.finance_facts.release_movement_bdag, '0.00000000');
  assert.deepEqual(fixture.currentEvidence.cron_security.cron.items.map(item => ({
    jobname: item.jobname,
    schedule: item.schedule,
    command_sha256: item.command_sha256,
  })), [{
    jobname: 'creator-premium-auto-renewals-f5',
    schedule: '*/5 * * * *',
    command_sha256: gate.sha256Hex('select private.process_creator_premium_auto_renewals_f5_v1(25);'),
  }]);

  for (const mutate of [
    candidate => { candidate.currentEvidence.cron_security.cron.items = []; candidate.currentEvidence.cron_security.cron.count = 0; },
    candidate => { candidate.currentEvidence.cron_security.cron.items[0].schedule = '*/10 * * * *'; },
    candidate => { candidate.currentEvidence.cron_security.cron.items.push(structuredClone(
      candidate.currentEvidence.cron_security.cron.items[0])); candidate.currentEvidence.cron_security.cron.items[1].jobid = '2';
    candidate.currentEvidence.cron_security.cron.count = 2; },
  ]) {
    const drift = structuredClone(fixture);
    mutate(drift);
    resign(drift);
    assertDenied(() => verify(drift), 'RECOVERY_POSTCHECK_FAILED');
  }

  const attributed = structuredClone(fixture);
  attributed.currentEvidence.finance.transactions.items.at(-1).metadata = {
    release_id: attributed.controlledPolicy.postcheck_recovery.approved_sources[6].release_id,
  };
  resign(attributed);
  assertDenied(() => verify(attributed), 'RELEASE_ATTRIBUTED_FINANCE');
});

test('Stories B1 recovery verifies exact deployed state, 552 plus two Advisor reconstruction, and post-F5 finance', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 7);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };
  const resignAdvisors = candidate => {
    const advisors = candidate.currentEvidence.cron_security.advisors;
    advisors.items.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    advisors.count = advisors.items.length;
    advisors.sha256 = gate.sha256Hex(gate.canonicalJson(advisors.items));
    resign(candidate);
  };
  const result = verify(fixture);
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '40473092474');
  assert.equal(result.migrations.count, 358);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`,
    '20261027042552_stories_v2_interactive_b1');
  assert.deepEqual(result.functions.items.map(item => [item.name, item.version, item.source_sha256]), [
    ['cleanup-stale-media-uploads', 53, '62558bb99e36094e33a431d84ee1edb48ea8d22d07dce0c00f9c8cb6ad4eee80'],
    ['content-safety-scan', 48, '3c8a861fbfa37b2d9ee0f8452938a072498645929ae22175ac5f319bbc54ef43'],
    ['create-media-upload', 71, '189b25cfc8172ea1561a3e5ac1e3b03c654943cd7ee4147a7017ed17d966e297'],
    ['create-stream-upload', 40, '67c78125ad77c07d942cc91e5dc757f0461aee6ab7e68f3f9af87ce6623794b3'],
    ['get-stream-playback', 34, 'a47954442c6c90effb3d1e0bb53f18687bfdb8e1c7557d63a2fddc379034ca65'],
    ['stream-webhook', 35, '2b16c3e5a7fff1795fa324d6dcbf0648ca5432b9e53b65597cd8d53ec154ee58'],
  ]);
  assert.deepEqual(result.security_advisor, {
    baseline_count: 554,
    baseline_sha256: fixture.controlledPolicy.security_advisor.baseline.cron_security_sha256,
    exception_count: 42,
    exception_fingerprints: result.security_advisor.exception_fingerprints,
    current_count: 594,
  });
  assert.equal(result.security_advisor.exception_fingerprints.length, 42);
  assert.equal(result.stories_b1_state.infrastructure_installed, true);
  assert.equal(result.stories_b1_state.activation, false);
  assert.equal(result.stories_b1_state.owner_approved_policy, false);
  assert.equal(result.stories_b1_state.relations.length, 6);
  assert.ok(result.stories_b1_state.relations.every(item => (
    item.owner === 'postgres' && item.rls_enabled === true && item.force_rls === true
  )));
  assert.deepEqual(result.finance.policy, {
    purchase_enabled: true,
    subscription_enabled: true,
    refunds_enabled: true,
    platform_fee_bps: 2000,
  });
  assert.equal(result.finance.premium_transaction_count, 1);
  assert.equal(fixture.currentEvidence.finance_facts.phase, 'f5_autonomous');
  assert.equal(fixture.currentEvidence.finance_facts.release_movement_bdag, '0.00000000');
  assert.equal(result.premium_state.relation_security.sha256,
    'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0');

  const missingException = structuredClone(fixture);
  const introduced = missingException.controlledPolicy.stories_b1_transition.security_advisor
    .introduced_exceptions[0].advisor_fingerprint;
  missingException.currentEvidence.cron_security.advisors.items =
    missingException.currentEvidence.cron_security.advisors.items
      .filter(item => item.fingerprint !== introduced);
  resignAdvisors(missingException);
  assertDenied(() => verify(missingException), 'RECOVERY_POSTCHECK_FAILED');

  const extraFinding = structuredClone(fixture);
  extraFinding.currentEvidence.cron_security.advisors.items.push({
    fingerprint: 'f'.repeat(64), level: 'WARN', resource_kind: 'unexpected',
  });
  resignAdvisors(extraFinding);
  assertDenied(() => verify(extraFinding), 'RECOVERY_POSTCHECK_FAILED');

  const changedType = structuredClone(fixture);
  const changedAdvisor = changedType.currentEvidence.cron_security.advisors.items
    .find(item => item.fingerprint === introduced);
  changedAdvisor.level = changedAdvisor.level === 'INFO' ? 'WARN' : 'INFO';
  resignAdvisors(changedType);
  assertDenied(() => verify(changedType), 'RECOVERY_POSTCHECK_FAILED');

  const replacedFindingReturned = structuredClone(fixture);
  const oldFinding = replacedFindingReturned.controlledPolicy.stories_b1_transition.security_advisor
    .removed_findings[0];
  replacedFindingReturned.currentEvidence.cron_security.advisors.items.push({
    fingerprint: oldFinding.fingerprint,
    level: oldFinding.level,
    resource_kind: oldFinding.resource_kind,
  });
  resignAdvisors(replacedFindingReturned);
  assertDenied(() => verify(replacedFindingReturned), 'RECOVERY_POSTCHECK_FAILED');

  const unsafeRelation = structuredClone(fixture);
  unsafeRelation.currentEvidence.stories_b1_state.relations[0].force_rls = false;
  const { sha256: ignoredStoriesSha, ...unsignedStories } = unsafeRelation.currentEvidence.stories_b1_state;
  unsafeRelation.currentEvidence.stories_b1_state.sha256 = gate.sha256Hex(gate.canonicalJson(unsignedStories));
  resign(unsafeRelation);
  assert.throws(() => verify(unsafeRelation), /STORIES_B1_POSTCHECK_FAILED/);

  const rpcDrift = structuredClone(fixture);
  rpcDrift.currentEvidence.rpc_security.items
    .find(item => item.name === 'respond_to_story_element').definition_sha256 = 'f'.repeat(64);
  rpcDrift.currentEvidence.rpc_security.sha256 = gate.sha256Hex(
    gate.canonicalJson(rpcDrift.currentEvidence.rpc_security.items),
  );
  resign(rpcDrift);
  assert.throws(() => verify(rpcDrift), /RPC_SECURITY_ATTESTATION_FAILED/);

  const edgeDrift = structuredClone(fixture);
  edgeDrift.currentEvidence.functions.items
    .find(item => item.slug === 'content-safety-scan').version += 1;
  edgeDrift.currentEvidence.functions.sha256 = gate.sha256Hex(
    gate.canonicalJson(edgeDrift.currentEvidence.functions.items),
  );
  resign(edgeDrift);
  assertDenied(() => verify(edgeDrift), 'RECOVERY_POSTCHECK_FAILED');

  const attributed = structuredClone(fixture);
  attributed.currentEvidence.finance.transactions.items.at(-1).metadata = {
    release_id: attributed.controlledPolicy.postcheck_recovery.approved_sources[7].release_id,
  };
  resign(attributed);
  assertDenied(() => verify(attributed), 'RELEASE_ATTRIBUTED_FINANCE');
});

test('recovery reconstructs all installed Advisor predecessors while retaining the approved QA exception', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const project = finding => ({
    fingerprint: finding.fingerprint ?? finding.advisor_fingerprint,
    level: finding.level ?? finding.advisor_severity,
    resource_kind: finding.resource_kind ?? finding.advisor_type,
  });
  const restored = [
    ...policy.stories_b1_transition.security_advisor.removed_findings.map(project),
    project(policy.stories_qa_c1_transition.rpc_predecessor_exception),
    project(policy.superuser_control_center_transition.security_advisor.predecessor_exception),
  ];
  const filler = Array.from({ length: policy.security_advisor.baseline.count - restored.length },
    (_, index) => ({
      fingerprint: gate.sha256Hex(`historical-advisor-${index}`),
      level: 'WARN',
      resource_kind: 'table',
    }));
  const historicalBaseline = [...filler, ...restored]
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const qaPredecessor = policy.stories_qa_c1_transition.rpc_predecessor_exception;
  const absentCurrentFingerprints = new Set([
    ...policy.stories_b1_transition.security_advisor.removed_findings
      .map(item => item.fingerprint),
    policy.superuser_control_center_transition.security_advisor.predecessor_exception
      .advisor_fingerprint,
  ]);
  const currentAdvisorItems = historicalBaseline
    .filter(item => !absentCurrentFingerprints.has(item.fingerprint));
  assert.ok(currentAdvisorItems.some(item => item.fingerprint === qaPredecessor.advisor_fingerprint),
    'QA predecessor remains an exact approved current exception');
  const transitionPaths = [
    policy.stories_b1_transition.migration_path,
    policy.stories_qa_c1_transition.migration_path,
    ...policy.superuser_control_center_transition.migrations.map(item => item.path),
  ];
  const migrations = {
    items: transitionPaths.map(path => {
      const identity = path.split('/').at(-1).replace(/\.sql$/, '');
      return { version: identity.slice(0, 14), name: identity.slice(15) };
    }),
  };
  assert.deepEqual(gate.reconstructHistoricalAdvisorBaselineForRecovery({
    policy,
    migrations,
    advisorItems: currentAdvisorItems,
    recoveryExceptions: [qaPredecessor],
  }), historicalBaseline);

  const stalePredecessor = [
    ...currentAdvisorItems,
    project(policy.stories_b1_transition.security_advisor.removed_findings[0]),
  ];
  assert.throws(() => gate.reconstructHistoricalAdvisorBaselineForRecovery({
    policy,
    migrations,
    advisorItems: stalePredecessor,
    recoveryExceptions: [qaPredecessor],
  }), /replaced historical Advisor finding remains active without exact approval/);

  assert.throws(() => gate.reconstructHistoricalAdvisorBaselineForRecovery({
    policy,
    migrations: { items: migrations.items.slice(0, -1) },
    advisorItems: currentAdvisorItems,
    recoveryExceptions: [qaPredecessor],
  }), /Superuser Control Center migration authority is only partially installed/);
});

test('Control Center recovery verifies exact installed authority, three-migration append, and post-F5 finance', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const adapter = await import(`${adapterUrl.href}?control-center-recovery=${Date.now()}-${Math.random()}`);
  const fixture = await recoveryStateFixture(t, gate, policy, 8);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };
  const recoveryExceptions = adapter.advisorExceptionsForPhase(
    fixture.controlledPolicy,
    fixture.recoveryManifest,
    'recovery',
    { request: fixture.recoveryRequest, migrations: fixture.currentEvidence.migrations },
  );
  const recoveryFingerprints = new Set(recoveryExceptions.map(item => item.advisor_fingerprint));
  const reconstructedAdvisorItems = [
    ...fixture.currentEvidence.cron_security.advisors.items
      .filter(item => !recoveryFingerprints.has(item.fingerprint)),
    {
      fingerprint: fixture.controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_fingerprint,
      level: fixture.controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_severity,
      resource_kind: fixture.controlledPolicy.superuser_control_center_transition.security_advisor
        .predecessor_exception.advisor_type,
    },
  ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  assert.equal(reconstructedAdvisorItems.length,
    fixture.controlledPolicy.security_advisor.baseline.count);
  assert.equal(gate.sha256Hex(gate.canonicalJson({
    complete: true,
    cron: adapter.projectCronBaselineItems(fixture.currentEvidence.cron_security.cron.items
      .filter(item => item.jobname !== 'creator-premium-auto-renewals-f5'), true),
    security_findings: reconstructedAdvisorItems,
  })), fixture.controlledPolicy.security_advisor.baseline.cron_security_sha256);
  const result = verify(fixture);
  assert.equal(result.result, 'POSTCHECK_RECOVERY_SUCCESS');
  assert.equal(result.source_run_id, '41243646356');
  assert.equal(result.migrations.count, 364);
  assert.equal(`${result.migrations.latest.version}_${result.migrations.latest.name}`,
    '20261031032022_superuser_control_center_overview');
  assert.deepEqual(result.functions.items, []);
  assert.equal(result.superuser_control_center_state.installed, true);
  assert.equal(result.superuser_control_center_state.functions.length, 10);
  assert.equal(result.superuser_control_center_state.bounded_observations
    .admin_audit_release_attributed, false);
  assert.deepEqual(result.finance.policy, {
    purchase_enabled: true,
    subscription_enabled: true,
    refunds_enabled: true,
    platform_fee_bps: 2000,
  });
  assert.equal(result.finance.premium_transaction_count, 1);

  const authorityDrift = structuredClone(fixture);
  authorityDrift.currentEvidence.superuser_control_center_state.functions[0].definition_sha256 =
    'f'.repeat(64);
  const { sha256: ignoredStateSha, ...unsignedState } =
    authorityDrift.currentEvidence.superuser_control_center_state;
  authorityDrift.currentEvidence.superuser_control_center_state.sha256 =
    gate.sha256Hex(gate.canonicalJson(unsignedState));
  resign(authorityDrift);
  assert.throws(() => verify(authorityDrift),
    /ADMIN_RECOVERY_POSTCHECK_FAILED|SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED|RECOVERY_POSTCHECK_FAILED/);

  const releaseAttributed = structuredClone(fixture);
  releaseAttributed.currentEvidence.superuser_control_center_state.bounded_observations
    .admin_audit_release_attributed = true;
  const { sha256: ignoredAttributedSha, ...unsignedAttributed } =
    releaseAttributed.currentEvidence.superuser_control_center_state;
  releaseAttributed.currentEvidence.superuser_control_center_state.sha256 =
    gate.sha256Hex(gate.canonicalJson(unsignedAttributed));
  resign(releaseAttributed);
  assert.throws(() => verify(releaseAttributed),
    /ADMIN_RECOVERY_POSTCHECK_FAILED|SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED|RECOVERY_POSTCHECK_FAILED/);
});

test('F3 recovery keeps the remote EZBR attestation distinct from the Git source contract', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === '40166468648');
  const expectedRemoteDigest = 'd039819170e2c347ac8a6c88f77fa4461dfae4091a9e937ed47897b2c115e56c';
  assert.equal(source.edge_functions[0].source_sha256, expectedRemoteDigest);
  assert.notEqual(source.edge_functions[0].source_sha256,
    gate.F3_FINANCE_AUTHORITY_TRANSITION.function_source_sha256);

  const fixture = await recoveryStateFixture(t, gate, policy, 4);
  const result = gate.verifyPostcheckRecovery({
    policy: fixture.controlledPolicy,
    recoveryRequest: fixture.recoveryRequest,
    recoveryManifest: fixture.recoveryManifest,
    sourceManifest: fixture.sourceManifest,
    sourceObservation: fixture.sourceObservation,
    currentEvidence: fixture.currentEvidence,
    adapterSourceSha256: fixture.adapterSourceSha256,
  });
  assert.equal(result.functions.items[0].source_sha256, expectedRemoteDigest);

  const drift = structuredClone(fixture);
  drift.currentEvidence.functions.items.find(item => item.slug === 'bdag-ledger').ezbr_sha256 =
    gate.F3_FINANCE_AUTHORITY_TRANSITION.function_source_sha256;
  drift.currentEvidence.functions.sha256 = gate.sha256Hex(
    gate.canonicalJson(drift.currentEvidence.functions.items),
  );
  const { evidence_sha256: ignored, ...unsigned } = drift.currentEvidence;
  drift.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  assertDenied(() => gate.verifyPostcheckRecovery({
    policy: drift.controlledPolicy,
    recoveryRequest: drift.recoveryRequest,
    recoveryManifest: drift.recoveryManifest,
    sourceManifest: drift.sourceManifest,
    sourceObservation: drift.sourceObservation,
    currentEvidence: drift.currentEvidence,
    adapterSourceSha256: drift.adapterSourceSha256,
  }), 'RECOVERY_POSTCHECK_FAILED');
});

test('F3 postcheck recovery rejects historical migration and unchanged Edge drift', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy, 4);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };

  const migrationDrift = structuredClone(fixture);
  migrationDrift.currentEvidence.migrations.items[0].name = 'historical_identity_swapped';
  migrationDrift.currentEvidence.migrations.sha256 = gate.sha256Hex(
    gate.canonicalJson(migrationDrift.currentEvidence.migrations.items),
  );
  resign(migrationDrift);
  assert.throws(() => verify(migrationDrift),
    /FINANCE_AUTHORITY_MISMATCH|RPC_SECURITY_ATTESTATION_FAILED|RECOVERY_POSTCHECK_FAILED/);

  for (const mutate of [
    item => { item.version += 1; },
    item => { item.ezbr_sha256 = 'f'.repeat(64); },
    item => { item.verify_jwt = !item.verify_jwt; },
  ]) {
    const edgeDrift = structuredClone(fixture);
    const unchangedEdge = edgeDrift.currentEvidence.functions.items.find(item => (
      item.slug !== 'bdag-ledger' && edgeDrift.controlledPolicy.supabase.managed_functions.includes(item.slug)
    ));
    assert.ok(unchangedEdge);
    mutate(unchangedEdge);
    edgeDrift.currentEvidence.functions.sha256 = gate.sha256Hex(
      gate.canonicalJson(edgeDrift.currentEvidence.functions.items),
    );
    resign(edgeDrift);
    assertDenied(() => verify(edgeDrift), 'RECOVERY_POSTCHECK_FAILED');
  }

  const unmanagedDrift = structuredClone(fixture);
  const unmanagedEdge = unmanagedDrift.currentEvidence.functions.items.find(item => (
    !unmanagedDrift.controlledPolicy.supabase.managed_functions.includes(item.slug)
  ));
  assert.ok(unmanagedEdge);
  unmanagedEdge.version += 1;
  unmanagedDrift.currentEvidence.functions.sha256 = gate.sha256Hex(
    gate.canonicalJson(unmanagedDrift.currentEvidence.functions.items),
  );
  resign(unmanagedDrift);
  assertDenied(() => verify(unmanagedDrift), 'RECOVERY_POSTCHECK_FAILED');
});

test('postcheck recovery fails closed on mutation requests and every protected-state drift', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const base = await recoveryStateFixture(t, gate, policy);
  const verify = candidate => gate.verifyPostcheckRecovery({
    policy: candidate.controlledPolicy,
    recoveryRequest: candidate.recoveryRequest,
    recoveryManifest: candidate.recoveryManifest,
    sourceManifest: candidate.sourceManifest,
    sourceObservation: candidate.sourceObservation,
    currentEvidence: candidate.currentEvidence,
    adapterSourceSha256: candidate.adapterSourceSha256,
  });
  const resign = candidate => {
    const { evidence_sha256: ignored, ...unsigned } = candidate.currentEvidence;
    candidate.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  };

  const productive = structuredClone(base);
  productive.recoveryRequest.productiveResources = ['migration:unexpected'];
  assertDenied(() => verify(productive), 'RECOVERY_MUTATION_FORBIDDEN');

  const duplicateMigration = structuredClone(base);
  duplicateMigration.currentEvidence.migrations.items.push(structuredClone(duplicateMigration.currentEvidence.migrations.items.at(-1)));
  duplicateMigration.currentEvidence.migrations.count += 1;
  duplicateMigration.currentEvidence.migrations.sha256 = gate.sha256Hex(gate.canonicalJson(duplicateMigration.currentEvidence.migrations.items));
  resign(duplicateMigration);
  assert.throws(() => verify(duplicateMigration), /INVALID_REMOTE_INVENTORY|RECOVERY_POSTCHECK_FAILED/);

  const edgeDrift = structuredClone(base);
  const edge = edgeDrift.currentEvidence.functions.items.find(item => item.slug === 'stream-webhook');
  edge.version += 1;
  edgeDrift.currentEvidence.functions.sha256 = gate.sha256Hex(gate.canonicalJson(edgeDrift.currentEvidence.functions.items));
  resign(edgeDrift);
  assertDenied(() => verify(edgeDrift), 'RECOVERY_POSTCHECK_FAILED');

  const unknownAdvisor = structuredClone(base);
  unknownAdvisor.currentEvidence.cron_security.advisors.items.push({ fingerprint: 'f'.repeat(64), level: 'WARN', resource_kind: 'unknown' });
  unknownAdvisor.currentEvidence.cron_security.advisors.items.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  unknownAdvisor.currentEvidence.cron_security.advisors.count += 1;
  unknownAdvisor.currentEvidence.cron_security.advisors.sha256 = gate.sha256Hex(gate.canonicalJson(unknownAdvisor.currentEvidence.cron_security.advisors.items));
  resign(unknownAdvisor);
  assertDenied(() => verify(unknownAdvisor), 'RECOVERY_POSTCHECK_FAILED');

  const rpcDrift = structuredClone(base);
  rpcDrift.currentEvidence.rpc_security.items[0].owner = 'other_owner';
  rpcDrift.currentEvidence.rpc_security.sha256 = gate.sha256Hex(gate.canonicalJson(rpcDrift.currentEvidence.rpc_security.items));
  resign(rpcDrift);
  assert.throws(() => verify(rpcDrift), /RPC_SECURITY_ATTESTATION_FAILED/);

  const financeDrift = structuredClone(base);
  financeDrift.currentEvidence.finance.policy.purchase_enabled = true;
  resign(financeDrift);
  assert.throws(() => verify(financeDrift), /FINANCE_POLICY_CHANGED/);

  const contentSafetyDrift = structuredClone(base);
  contentSafetyDrift.currentEvidence.premium_state.content_safety.active_rule_count = 1;
  const { sha256: ignored, ...premiumUnsigned } = contentSafetyDrift.currentEvidence.premium_state;
  contentSafetyDrift.currentEvidence.premium_state.sha256 = gate.sha256Hex(gate.canonicalJson(premiumUnsigned));
  resign(contentSafetyDrift);
  assert.throws(() => verify(contentSafetyDrift), /PREMIUM_POSTCHECK_FAILED/);
});

test('postcheck recovery permits reconciled concurrent finance rows but rejects source-attributed movement', async t => {
  const { gate, policy } = await loadGateAndPolicy();
  const fixture = await recoveryStateFixture(t, gate, policy);
  const concurrent = structuredClone(fixture);
  concurrent.currentEvidence.finance.transactions.items.push({
    id: 'transaction-9999', status: 'pending', currency: 'BDAG',
    created_at: '2026-10-17T21:00:00.000Z', blockchain_txid_sha256: null,
    metadata: { source: 'legitimate-concurrent-operation' },
  });
  concurrent.currentEvidence.finance.transactions.count += 1;
  concurrent.currentEvidence.finance.watermark = { created_at: '2026-10-17T21:00:00.000Z', id: 'transaction-9999' };
  const { evidence_sha256: ignored, ...unsigned } = concurrent.currentEvidence;
  concurrent.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(unsigned));
  const verified = gate.verifyPostcheckRecovery({
    policy: concurrent.controlledPolicy,
    recoveryRequest: concurrent.recoveryRequest,
    recoveryManifest: concurrent.recoveryManifest,
    sourceManifest: concurrent.sourceManifest,
    sourceObservation: concurrent.sourceObservation,
    currentEvidence: concurrent.currentEvidence,
    adapterSourceSha256: concurrent.adapterSourceSha256,
  });
  assert.equal(verified.finance.counts.transactions, 929);

  concurrent.currentEvidence.finance.transactions.items.at(-1).metadata.release_id = policy.postcheck_recovery.approved_sources[0].release_id;
  const { evidence_sha256: omitted, ...attributedUnsigned } = concurrent.currentEvidence;
  concurrent.currentEvidence.evidence_sha256 = gate.sha256Hex(gate.canonicalJson(attributedUnsigned));
  assertDenied(() => gate.verifyPostcheckRecovery({
    policy: concurrent.controlledPolicy,
    recoveryRequest: concurrent.recoveryRequest,
    recoveryManifest: concurrent.recoveryManifest,
    sourceManifest: concurrent.sourceManifest,
    sourceObservation: concurrent.sourceObservation,
    currentEvidence: concurrent.currentEvidence,
    adapterSourceSha256: concurrent.adapterSourceSha256,
  }), 'RELEASE_ATTRIBUTED_FINANCE');
});

test('recovery CLI dispatchers expose only fixed read-only verification inputs', () => {
  const source = readFileSync(gateUrl, 'utf8');
  const adminChainStart = source.indexOf("if (command === 'verify-admin-recovery-postcheck-chain')");
  const adminVerifyStart = source.indexOf("if (command === 'verify-admin-recovery-source')");
  const adminPostcheckStart = source.indexOf("if (command === 'postcheck-admin-recovery')");
  const verifyStart = source.indexOf("if (command === 'verify-recovery-source')");
  const postcheckStart = source.indexOf("if (command === 'postcheck-recovery')");
  const nextCommand = source.indexOf("if (command === 'verify-function-contract')", postcheckStart);
  assert.ok(adminChainStart > 0 && adminVerifyStart > adminChainStart
    && adminPostcheckStart > adminVerifyStart && verifyStart > adminPostcheckStart
    && postcheckStart > verifyStart && nextCommand > postcheckStart);
  const adminChainDispatcher = source.slice(adminChainStart, adminVerifyStart);
  assert.match(adminChainDispatcher, /verifyAdminRecoveryPostcheckChainProvenance/);
  assert.doesNotMatch(adminChainDispatcher, /execFileSync|spawn|supabase\s+(?:db|migration|functions)|--command|child_process/);
  const adminRecoveryDispatcher = source.slice(adminVerifyStart, verifyStart);
  assert.match(adminRecoveryDispatcher, /verifyAdminRecoverySourceProvenance/);
  assert.match(adminRecoveryDispatcher, /verifyAdminRecoveryPostcheck/);
  assert.doesNotMatch(adminRecoveryDispatcher, /execFileSync|spawn|supabase\s+(?:db|migration|functions)|--command|child_process/);
  const recoveryDispatcher = source.slice(verifyStart, nextCommand);
  assert.match(recoveryDispatcher, /verifyRecoveryArtifactProvenance/);
  assert.match(recoveryDispatcher, /verifyPostcheckRecovery/);
  assert.doesNotMatch(recoveryDispatcher, /execFileSync|spawn|supabase\s+(?:db|migration|functions)|--command|child_process/);
  assert.match(source, /verify-recovery-source\|postcheck-recovery/);
  assert.match(source, /verify-admin-recovery-postcheck-chain\|verify-admin-recovery-source/);
  assert.match(source, /verify-admin-recovery-source\|postcheck-admin-recovery/);
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
    mode: 'release',
    runId: '123456789',
    runAttempt: 1,
    environmentId: 42,
    environmentName: 'production',
    releaseId: 'nelyon-20261009-001',
    approvedSha: MAIN_SHA,
    manifestDigest: 'c'.repeat(64),
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

test('release approval token binds run attempt environment release SHA and manifest', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.equal(
    gate.buildApprovalToken(approvalInput()),
    `NELYON-APPROVE run=123456789 attempt=1 env=42 release=nelyon-20261009-001 sha=${MAIN_SHA} manifest=${'c'.repeat(64)}`,
  );
});

test('gate proof approval token uses the same immutable run binding', async () => {
  const { gate } = await loadGateAndPolicy();
  const input = approvalInput({ mode: 'gate_proof' });
  assert.equal(
    gate.buildApprovalToken(input),
    `NELYON-APPROVE run=123456789 attempt=1 env=42 release=nelyon-20261009-001 sha=${MAIN_SHA} manifest=${'c'.repeat(64)}`,
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

test('automatic authorization requires current empty deployment approval history', async () => {
  const { gate } = await loadGateAndPolicy();
  const current = {
    complete: true,
    sourceRunId: '123456789',
    sourceRunAttempt: 1,
    pages: [{ items: [] }],
  };
  assert.equal(gate.verifyAutomaticAuthorizationHistory({
    approvals: current,
    expectedRunId: '123456789',
    expectedRunAttempt: 1,
  }), true);
  for (const approvals of [
    { ...current, sourceRunId: '987654321' },
    { ...current, sourceRunAttempt: 2 },
    { ...current, pages: [{ items: [{ state: 'approved' }] }] },
  ]) {
    assertDenied(() => gate.verifyAutomaticAuthorizationHistory({
      approvals,
      expectedRunId: '123456789',
      expectedRunAttempt: 1,
    }), 'INVALID_AUTOMATIC_AUTHORIZATION');
  }
  assertDenied(() => gate.verifyAutomaticAuthorizationHistory({
    approvals: { complete: false, sourceRunId: '123456789', sourceRunAttempt: 1, pages: [] },
    expectedRunId: '123456789',
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

test('automatic Environment authorization permits no human gate and preserves main-only restrictions', async () => {
  const { gate } = await loadGateAndPolicy();
  const branchPolicies = { complete: true, pages: [{ items: [{ name: 'main' }] }] };
  const automaticEnvironment = environmentSnapshot({ protection_rules: [{ type: 'branch_policy' }] });
  assert.equal(gate.verifyEnvironmentSnapshot({
    environment: automaticEnvironment,
    branchPolicies,
    expected: { id: 42, name: 'production', owner: OWNER, branch: 'main', authorizationMode: 'automatic' },
  }), true);
  for (const environment of [
    environmentSnapshot(),
    environmentSnapshot({ protection_rules: [{ type: 'wait_timer', wait_timer: 1 }, { type: 'branch_policy' }] }),
    environmentSnapshot({ can_admins_bypass: true, protection_rules: [{ type: 'branch_policy' }] }),
  ]) {
    assertDenied(() => gate.verifyEnvironmentSnapshot({
      environment,
      branchPolicies,
      expected: { id: 42, name: 'production', owner: OWNER, branch: 'main', authorizationMode: 'automatic' },
    }), 'UNSAFE_ENVIRONMENT');
  }
});

test('persistent owner declaration records expected OFF without claiming provider observation', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.deepEqual(gate.verifyAutoDeployExpectation({
    declaration: 'OFF',
    policy: policy.auto_deploy,
  }), {
    declaration_variable: 'SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED',
    expected_state: 'OFF',
    declared_state: 'OFF',
    evidence_kind: 'OWNER_PERSISTENT_DECLARATION',
    observed_state: 'UNAVAILABLE',
    independently_verified: false,
    risk_treatment: 'owner_accepted_unobserved_state',
  });
});

test('missing changed or unknown auto-deploy declaration fails closed', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  for (const declaration of [undefined, null, '', 'ON', 'UNKNOWN', 'off', ' OFF ']) {
    assertDenied(() => gate.verifyAutoDeployExpectation({
      declaration,
      policy: policy.auto_deploy,
    }), 'AUTO_DEPLOY_DECLARATION_MISMATCH');
  }
});

test('auto-deploy policy cannot claim provider observation or weaken expected state', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  for (const patch of [
    { expected_state: 'ON' },
    { observed_state: 'OFF' },
    { independently_verified: true },
    { evidence_kind: 'SCREENSHOT' },
    { declaration_variable: 'ANOTHER_VARIABLE' },
    { risk_treatment: 'verified_automatically' },
  ]) {
    assertDenied(() => gate.verifyAutoDeployExpectation({
      declaration: 'OFF',
      policy: { ...policy.auto_deploy, ...patch },
    }), 'INVALID_AUTO_DEPLOY_POLICY');
  }
});

test('plan_only gate_proof and postcheck recovery never require Supabase deployment secrets', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.deepEqual(gate.requiredSecretsForMode('plan_only', {}), []);
  assert.deepEqual(gate.requiredSecretsForMode('gate_proof', {}), []);
  assert.deepEqual(gate.requiredSecretsForMode('postcheck_recovery', {}), []);
  assertDenied(() => gate.requiredSecretsForMode('release', {}), 'MISSING_SECRETS');
  assertDenied(() => gate.requiredSecretsForMode('admin_recovery', {}), 'MISSING_SECRETS');
  assert.deepEqual(gate.requiredSecretsForMode('release', { SUPABASE_ACCESS_TOKEN: 'scoped-deploy-token' }), ['SUPABASE_ACCESS_TOKEN']);
  assert.deepEqual(gate.requiredSecretsForMode('admin_recovery', { SUPABASE_ACCESS_TOKEN: 'scoped-deploy-token' }), ['SUPABASE_ACCESS_TOKEN']);
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
    candidate_sha: policy.baseline.sha,
    workflow_runtime: false,
    reviewed_policy_sha256: 'f'.repeat(64),
    migrations: {
      complete: true,
      items: Array.from({ length: policy.baseline.migration_count }, (_, index) => `2026${String(index).padStart(10, '0')}`),
      latest: policy.baseline.latest_migration,
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
      policy: { ...policy.supabase.finance_policy },
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
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy));
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  });
  assert.equal(verified.verification.state, 'verified');
  assert.deepEqual(Object.keys(evidence.digests).sort(), ['config_verify_jwt', 'cron_security', 'finance', 'function_source_parity', 'managed_functions', 'migrations', 'unmanaged_functions']);
  for (const value of Object.values(evidence.digests)) assert.match(value, /^[0-9a-f]{64}$/);
});

test('candidate baseline accepts canonical finance snapshot policy metadata', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  const snapshot = baselineSnapshot(policy);
  snapshot.finance.policy = {
    ...snapshot.finance.policy,
    policy_version: 'creator-premium-b4-v1',
  };
  const evidence = gate.buildBaselineEvidence(snapshot);

  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  });

  assert.equal(verified.verification.state, 'verified');
  assert.equal(verified.finance.policy.policy_version, 'creator-premium-b4-v1');
});

test('F4 promoted baseline accepts reconciled nonzero commerce under the exact general policy', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  policy.baseline.migration_count = 355;
  policy.baseline.latest_migration = F4_GENERAL_MIGRATION;
  policy.supabase.finance_policy = {
    purchase_enabled: true, subscription_enabled: true,
    refunds_enabled: true, platform_fee_bps: 2000,
  };
  const snapshot = baselineSnapshot(policy);
  snapshot.finance = {
    ...snapshot.finance,
    policy: { ...policy.supabase.finance_policy, policy_version: 'creator-premium-f4-general-v1' },
    premium_transaction_count: 4,
  };
  const evidence = gate.buildBaselineEvidence(snapshot);
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: 355,
      latestMigration: F4_GENERAL_MIGRATION,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  });
  assert.equal(verified.finance.premium_transaction_count, 4);
});

test('owner baseline finance digest matches the immutable production projection after F4', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const candidate = asCandidatePolicy(policy);
  candidate.baseline.migration_count = 356;
  candidate.baseline.latest_migration = '20261026072512_creator_premium_f5_autonomous_subscriptions';
  const snapshot = baselineSnapshot(candidate);
  snapshot.finance = {
    ...snapshot.finance,
    schema_sha256: 'a'.repeat(64),
    reconciliation: {
      account_balance_ledger_mismatch: 0,
      completed_credit_account_mismatch: 0,
      completed_credit_total_mismatch: 0,
      completed_debit_account_mismatch: 0,
      completed_debit_total_mismatch: 0,
      completed_without_credit: 0,
      completed_without_debit: 0,
      noncanonical_entry_type: 0,
      orphan_ledger_entries: 0,
      premium_finance_policy_row_count_mismatch: 0,
    },
    premium_transaction_count: 7,
    premium_bindings: { receipts: 4, subscription_periods: 3 },
  };
  const evidence = gate.buildBaselineEvidence(snapshot);
  const projectedFinance = {
    complete: true,
    schema_sha256: snapshot.finance.schema_sha256,
    policy: snapshot.finance.policy,
    reconciliation: snapshot.finance.reconciliation,
    c2_attributed_bdag_movement: 0,
    authority_phase: 'f4_general',
    mutable_commerce_inventory: 'reconciled_not_baselined',
  };
  assert.equal(evidence.digests.finance, gate.sha256Hex(gate.canonicalJson(projectedFinance)));
});

test('Git SHA equality alone cannot verify baseline', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  assertDenied(() => gate.buildBaselineEvidence({
    complete: true,
    source: 'owner-control-plane',
    project_ref: PROJECT_REF,
    candidate_sha: MAIN_SHA,
  }), 'INCOMPLETE_BASELINE_EVIDENCE');
  assert.equal(policy.baseline.state, 'candidate');
});

test('workflow actor and workflow runtime cannot promote baseline', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
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
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy));
  const verified = gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
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
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  const exactPolicyBytes = readFileSync(policyUrl);
  const exactDigest = gate.sha256Hex(exactPolicyBytes);
  const evidence = gate.buildBaselineEvidence(baselineSnapshot(policy, { reviewed_policy_sha256: exactDigest }));
  assert.equal(gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicyBytes: exactPolicyBytes,
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  }).verification.reviewed_policy_sha256, exactDigest);
  assertDenied(() => gate.verifyBaselineEvidence({
    candidate: policy.baseline,
    evidence,
    expected: {
      projectRef: PROJECT_REF,
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicyBytes: Buffer.from(`${exactPolicyBytes.toString('utf8')} `),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  }), 'BASELINE_EVIDENCE_MISMATCH');
});

test('baseline advancement records prior release ID manifest and evidence digests', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
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
      sha: policy.baseline.sha,
      migrationCount: policy.baseline.migration_count,
      latestMigration: policy.baseline.latest_migration,
      managedFunctions: MANAGED_FUNCTIONS,
      remoteFunctionCount: 34,
      financePolicy: policy.supabase.finance_policy,
      reviewedPolicySha256: 'f'.repeat(64),
      evidenceDigests: evidence.digests,
      blockedResources: evidence.blocked_resources,
    },
  });
  const proposal = gate.proposeVerifiedBaseline({ policy, evidence: verified, owner: OWNER });
  assert.deepEqual(proposal.policy.baseline.prior_release, priorRelease);
  assert.deepEqual(proposal.policy.baseline.evidence_digests, evidence.digests);
});

test('baseline promotion denies every independently reviewed section mismatch', async () => {
  const loaded = await loadGateAndPolicy();
  const { gate } = loaded;
  const policy = asCandidatePolicy(loaded.policy);
  const original = gate.buildBaselineEvidence(baselineSnapshot(policy));
  const expected = {
    projectRef: PROJECT_REF,
    sha: policy.baseline.sha,
    migrationCount: policy.baseline.migration_count,
    latestMigration: policy.baseline.latest_migration,
    managedFunctions: MANAGED_FUNCTIONS,
    remoteFunctionCount: 34,
    financePolicy: policy.supabase.finance_policy,
    reviewedPolicySha256: 'f'.repeat(64),
    evidenceDigests: original.digests,
    blockedResources: [],
  };
  const snapshots = [];
  const migration = baselineSnapshot(policy);
  migration.migrations.items[10] = 'tampered-migration';
  snapshots.push(migration);
  const version = baselineSnapshot(policy);
  version.functions.managed[0].version += 1;
  snapshots.push(version);
  const source = baselineSnapshot(policy);
  source.functions.managed[0].source_parity = false;
  snapshots.push(source);
  const config = baselineSnapshot(policy);
  config.config.managed_functions[0].verify_jwt = false;
  snapshots.push(config);
  const cron = baselineSnapshot(policy);
  cron.cron_security.security_findings.push({ name: 'unexpected-warning', level: 'WARN' });
  snapshots.push(cron);
  const finance = baselineSnapshot(policy);
  finance.finance.policy = { ...finance.finance.policy, platform_fee_bps: 1234 };
  snapshots.push(finance);
  for (const snapshot of snapshots) {
    const evidence = gate.buildBaselineEvidence(snapshot);
    assertDenied(() => gate.verifyBaselineEvidence({
      candidate: policy.baseline,
      evidence,
      expected,
    }), 'BASELINE_EVIDENCE_MISMATCH');
  }
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

function financeTransaction(id, overrides = {}) {
  return {
    id,
    from_account_id: `from-${id}`,
    to_account_id: `to-${id}`,
    operation_type: 'legitimate_concurrent_transfer',
    amount: '10.00000000',
    fee_amount: '0.00000000',
    currency: 'BDAG',
    status: 'completed',
    blockchain_txid_sha256: null,
    reference_type: 'external_operation',
    reference_id: `ref-${id}`,
    idempotency_key: `idem-${id}`,
    created_at: '2026-10-09T12:00:01.000Z',
    ...overrides,
  };
}

function ledgerPair(transaction, overrides = {}) {
  return [
    {
      id: `debit-${transaction.id}`,
      txn_id: transaction.id,
      account_id: transaction.from_account_id,
      entry_type: 'debit',
      amount: transaction.amount,
      metadata: { source: 'legitimate-concurrent-operation' },
      created_at: '2026-10-09T12:00:02.000Z',
      ...overrides,
    },
    {
      id: `credit-${transaction.id}`,
      txn_id: transaction.id,
      account_id: transaction.to_account_id,
      entry_type: 'credit',
      amount: transaction.amount,
      metadata: { source: 'legitimate-concurrent-operation' },
      created_at: '2026-10-09T12:00:02.000Z',
      ...overrides,
    },
  ];
}

function financeSnapshot({ transactions = [], ledgerEntries = [], databaseTime = '2026-10-09T12:00:05.000Z', policy = {} } = {}) {
  const sorted = [...transactions].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  const last = sorted.at(-1);
  return {
    complete: true,
    database_time: databaseTime,
    watermark: last ? { created_at: last.created_at, id: last.id } : null,
    policy: {
      purchase_enabled: false,
      subscription_enabled: false,
      refunds_enabled: false,
      platform_fee_bps: 0,
      ...policy,
    },
    transactions: { complete: true, count: transactions.length, items: transactions },
    ledger_entries: { complete: true, count: ledgerEntries.length, items: ledgerEntries },
    account_balances_digest: 'a'.repeat(64),
  };
}

function releaseIdentity() {
  return { releaseId: 'nelyon-20261009-001', runId: '123456789', runAttempt: 1 };
}

function zeroReconciliation(overrides = {}) {
  return {
    account_balance_ledger_mismatch: 0,
    completed_credit_account_mismatch: 0,
    completed_credit_total_mismatch: 0,
    completed_debit_account_mismatch: 0,
    completed_debit_total_mismatch: 0,
    completed_without_credit: 0,
    completed_without_debit: 0,
    noncanonical_entry_type: 0,
    orphan_ledger_entries: 0,
    premium_finance_policy_row_count_mismatch: 0,
    ...overrides,
  };
}

test('F4 activation postcheck permits only the exact OFF to general policy change with zero financial delta', async () => {
  const { gate } = await loadGateAndPolicy();
  const off = {
    purchase_enabled: false, subscription_enabled: false,
    refunds_enabled: false, platform_fee_bps: 0,
  };
  const general = {
    purchase_enabled: true, subscription_enabled: true,
    refunds_enabled: true, platform_fee_bps: 2000,
  };
  const before = financeSnapshot({ policy: off });
  const after = financeSnapshot({ policy: general, databaseTime: '2026-10-09T12:00:06.000Z' });
  const unchangedWindow = {
    integrity: 'PASS', count_growth: { transactions: 0, ledger_entries: 0 },
    new_transaction_ids: [], preexisting_confirmed_after_snapshot: [], findings: [],
  };
  const verified = gate.verifyFinancePostcheck({
    before,
    after,
    window: unchangedWindow,
    reconciliationResults: zeroReconciliation(),
    expectedBeforePolicy: off,
    expectedAfterPolicy: general,
    requireNoFinancialMovement: true,
  });
  assert.equal(verified.integrity, 'PASS');
  assert.deepEqual(verified.policy_transition, { before: off, after: general });

  const transaction = financeTransaction('txn-during-f4');
  const entries = ledgerPair(transaction);
  const movedAfter = financeSnapshot({
    transactions: [transaction], ledgerEntries: entries, policy: general,
    databaseTime: '2026-10-09T12:00:06.000Z',
  });
  const movedWindow = gate.classifyFinanceWindow({
    before,
    after: movedAfter,
    transactions: [transaction],
    ledgerEntries: entries,
    releaseIdentity: releaseIdentity(),
  });
  assertDenied(() => gate.verifyFinancePostcheck({
    before,
    after: movedAfter,
    window: movedWindow,
    reconciliationResults: zeroReconciliation(),
    expectedBeforePolicy: off,
    expectedAfterPolicy: general,
    requireNoFinancialMovement: true,
  }), 'FINANCE_MOVEMENT_DURING_POLICY_ACTIVATION');
});

test('unchanged counters are not required when legitimate concurrent transactions reconcile', async () => {
  const { gate } = await loadGateAndPolicy();
  const existingBefore = financeTransaction('txn-old', { status: 'pending', created_at: '2026-10-09T11:00:00.000Z' });
  const existingAfter = { ...existingBefore, status: 'completed', blockchain_txid_sha256: 'a'.repeat(64) };
  const createdDuring = financeTransaction('txn-new');
  const before = financeSnapshot({ transactions: [existingBefore] });
  const entries = [...ledgerPair(existingAfter), ...ledgerPair(createdDuring)];
  const after = financeSnapshot({ transactions: [existingAfter, createdDuring], ledgerEntries: entries });
  const window = gate.classifyFinanceWindow({
    before,
    after,
    transactions: [existingAfter, createdDuring],
    ledgerEntries: entries,
    releaseIdentity: releaseIdentity(),
  });
  assert.deepEqual(window.preexisting_confirmed_after_snapshot, ['txn-old']);
  assert.deepEqual(window.new_transaction_ids, ['txn-new']);
  const result = gate.verifyFinancePostcheck({
    before,
    after,
    window,
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: FINANCE_OFF_POLICY,
  });
  assert.equal(result.integrity, 'PASS');
  assert.equal(result.count_growth.transactions, 1);
  assert.equal(result.count_growth.ledger_entries, 4);
});

test('postcheck authority derives finance window from raw rows instead of trusting PASS', async () => {
  const { gate } = await loadGateAndPolicy();
  const existingBefore = financeTransaction('txn-old', { status: 'pending', created_at: '2026-10-09T11:00:00.000Z' });
  const existingAfter = { ...existingBefore, status: 'completed', blockchain_txid_sha256: 'a'.repeat(64) };
  const entries = ledgerPair(existingAfter);
  const before = financeSnapshot({ transactions: [existingBefore] });
  const after = financeSnapshot({ transactions: [existingAfter], ledgerEntries: entries });
  const result = gate.verifyFinancePostcheckFromRaw({
    before,
    after,
    windowRows: { complete: true, integrity: 'PASS', transactions: [existingAfter], ledger_entries: entries },
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: FINANCE_OFF_POLICY,
    releaseIdentity: releaseIdentity(),
  });
  assert.deepEqual(result.window.preexisting_confirmed_after_snapshot, ['txn-old']);
  assert.equal(result.finance.integrity, 'PASS');
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after,
    windowRows: { complete: true, integrity: 'PASS', transactions: [], ledger_entries: entries },
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: FINANCE_OFF_POLICY,
    releaseIdentity: releaseIdentity(),
  }), 'INVALID_FINANCE_WINDOW');
});

test('finance postcheck requires the exact reconciliation inventory and monotonic database time', async () => {
  const { gate } = await loadGateAndPolicy();
  const before = financeSnapshot({ databaseTime: '2026-10-09T12:00:05.000Z' });
  const after = financeSnapshot({ databaseTime: '2026-10-09T12:00:04.000Z' });
  const windowRows = { complete: true, transactions: [], ledger_entries: [] };
  const exact = zeroReconciliation();
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after: financeSnapshot({ databaseTime: '2026-10-09T12:00:06.000Z' }),
    windowRows,
    reconciliationResults: { not_a_canonical_reconciliation: 0 },
    expectedPolicy: FINANCE_OFF_POLICY,
    releaseIdentity: releaseIdentity(),
  }), 'FINANCE_RECONCILIATION_FAILED');
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after,
    windowRows,
    reconciliationResults: exact,
    expectedPolicy: FINANCE_OFF_POLICY,
    releaseIdentity: releaseIdentity(),
  }), 'INVALID_FINANCE_WINDOW');
});

test('database timestamp and created_at id watermarks assign boundary rows once', async () => {
  const { gate } = await loadGateAndPolicy();
  const old = financeTransaction('b', { created_at: '2026-10-09T12:00:00.000Z' });
  const boundary = financeTransaction('c', { created_at: old.created_at });
  const later = financeTransaction('d', { created_at: '2026-10-09T12:00:01.000Z' });
  const before = financeSnapshot({ transactions: [old], databaseTime: '2026-10-09T12:00:00.000Z' });
  const entries = [...ledgerPair(boundary), ...ledgerPair(later)];
  const after = financeSnapshot({ transactions: [old, boundary, later], ledgerEntries: entries });
  const window = gate.classifyFinanceWindow({ before, after, transactions: [boundary, later], ledgerEntries: entries, releaseIdentity: releaseIdentity() });
  assert.deepEqual(window.new_transaction_ids, ['c', 'd']);
  assertDenied(() => gate.classifyFinanceWindow({ before, after, transactions: [boundary, boundary, later], ledgerEntries: entries, releaseIdentity: releaseIdentity() }), 'INVALID_FINANCE_WINDOW');
});

test('every new financial transaction requires balanced matching ledger entries', async () => {
  const { gate } = await loadGateAndPolicy();
  const transaction = financeTransaction('txn-new');
  const before = financeSnapshot();
  const validEntries = ledgerPair(transaction);
  const after = financeSnapshot({ transactions: [transaction], ledgerEntries: validEntries });
  assert.equal(gate.classifyFinanceWindow({ before, after, transactions: [transaction], ledgerEntries: validEntries, releaseIdentity: releaseIdentity() }).integrity, 'PASS');
  for (const entries of [
    validEntries.slice(0, 1),
    [validEntries[0], { ...validEntries[1], amount: '9.00000000' }],
    [validEntries[0], { ...validEntries[1], account_id: 'wrong-account' }],
  ]) {
    assertDenied(() => gate.classifyFinanceWindow({ before, after, transactions: [transaction], ledgerEntries: entries, releaseIdentity: releaseIdentity() }), 'FINANCE_RECONCILIATION_FAILED');
  }
});

test('release-attributed financial transaction or ledger metadata denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const transaction = financeTransaction('txn-new');
  const before = financeSnapshot();
  const validEntries = ledgerPair(transaction);
  const after = financeSnapshot({ transactions: [transaction], ledgerEntries: validEntries });
  assertDenied(() => gate.classifyFinanceWindow({
    before,
    after,
    transactions: [{ ...transaction, reference_id: releaseIdentity().releaseId }],
    ledgerEntries: validEntries,
    releaseIdentity: releaseIdentity(),
  }), 'RELEASE_ATTRIBUTED_FINANCE');
  assertDenied(() => gate.classifyFinanceWindow({
    before,
    after,
    transactions: [transaction],
    ledgerEntries: ledgerPair(transaction, { metadata: { run_id: releaseIdentity().runId } }),
    releaseIdentity: releaseIdentity(),
  }), 'RELEASE_ATTRIBUTED_FINANCE');
});

test('changed historical immutable rows frozen policy or platform fee denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const terminal = financeTransaction('txn-old', { created_at: '2026-10-09T11:00:00.000Z' });
  const before = financeSnapshot({ transactions: [terminal] });
  const changed = { ...terminal, amount: '99.00000000' };
  const after = financeSnapshot({ transactions: [changed] });
  assertDenied(() => gate.classifyFinanceWindow({ before, after, transactions: [changed], ledgerEntries: [], releaseIdentity: releaseIdentity() }), 'HISTORICAL_FINANCE_MUTATION');
  const cleanWindow = { integrity: 'PASS', count_growth: { transactions: 0, ledger_entries: 0 }, new_transaction_ids: [], preexisting_confirmed_after_snapshot: [], findings: [] };
  assertDenied(() => gate.verifyFinancePostcheck({
    before: financeSnapshot(),
    after: financeSnapshot({ policy: { platform_fee_bps: 100 } }),
    window: cleanWindow,
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: FINANCE_OFF_POLICY,
  }), 'FINANCE_POLICY_CHANGED');
});

test('transaction confirmation permits only null-to-hash and rejects hash replacement or removal', async () => {
  const { gate } = await loadGateAndPolicy();
  const pending = financeTransaction('txn-old', {
    status: 'pending',
    created_at: '2026-10-09T11:00:00.000Z',
    blockchain_txid_sha256: 'a'.repeat(64),
  });
  for (const blockchain_txid_sha256 of ['b'.repeat(64), null]) {
    const completed = { ...pending, status: 'completed', blockchain_txid_sha256 };
    assertDenied(() => gate.classifyFinanceWindow({
      before: financeSnapshot({ transactions: [pending] }),
      after: financeSnapshot({ transactions: [completed], ledgerEntries: ledgerPair(completed) }),
      transactions: [completed],
      ledgerEntries: ledgerPair(completed),
      releaseIdentity: releaseIdentity(),
    }), 'HISTORICAL_FINANCE_MUTATION');
  }
});

test('failed canonical reconciliation denies even when changes appear legitimate', async () => {
  const { gate } = await loadGateAndPolicy();
  const transaction = financeTransaction('txn-new');
  const entries = ledgerPair(transaction);
  const before = financeSnapshot();
  const after = financeSnapshot({ transactions: [transaction], ledgerEntries: entries });
  const window = gate.classifyFinanceWindow({ before, after, transactions: [transaction], ledgerEntries: entries, releaseIdentity: releaseIdentity() });
  assertDenied(() => gate.verifyFinancePostcheck({
    before,
    after,
    window,
    reconciliationResults: zeroReconciliation({ orphan_ledger_entries: 1 }),
    expectedPolicy: FINANCE_OFF_POLICY,
  }), 'FINANCE_RECONCILIATION_FAILED');
});

test('snapshot count growth is reported separately from integrity verdict', async () => {
  const { gate } = await loadGateAndPolicy();
  const transaction = financeTransaction('txn-new');
  const entries = ledgerPair(transaction);
  const before = financeSnapshot();
  const after = financeSnapshot({ transactions: [transaction], ledgerEntries: entries });
  assert.equal(gate.validateFinanceSnapshot(before), true);
  assert.equal(gate.validateFinanceSnapshot(after), true);
  const window = gate.classifyFinanceWindow({ before, after, transactions: [transaction], ledgerEntries: entries, releaseIdentity: releaseIdentity() });
  const result = gate.verifyFinancePostcheck({
    before,
    after,
    window,
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: FINANCE_OFF_POLICY,
  });
  assert.deepEqual(result.count_growth, { ledger_entries: 2, transactions: 1 });
  assert.equal(result.integrity, 'PASS');
});

function workflowText() {
  assert.ok(existsSync(workflowUrl), 'production release workflow must exist');
  return readFileSync(workflowUrl, 'utf8').replace(/\r\n?/g, '\n');
}

function workflowJob(text, name, nextName) {
  const start = text.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end = nextName ? text.indexOf(`  ${nextName}:\n`, start + 1) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

test('workflow trigger is exclusively workflow_dispatch with four required inputs and one optional recovery source', () => {
  const text = workflowText();
  const trigger = text.slice(text.indexOf('on:'), text.indexOf('\npermissions:'));
  assert.match(trigger, /^on:\s*\n\s+workflow_dispatch:/m);
  for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'workflow_run:']) assert.doesNotMatch(trigger, new RegExp(forbidden));
  for (const input of ['approved_sha', 'release_id', 'scope_confirmation', 'mode']) {
    assert.match(trigger, new RegExp(`\\n      ${input}:\\n        description:.*\\n        required: true`));
  }
  assert.match(trigger, /recovery_source_run_id:\n\s+description:.*\n\s+required: false/);
  assert.match(trigger, /mode:[\s\S]*type: choice[\s\S]*- plan_only[\s\S]*- gate_proof[\s\S]*- release[\s\S]*- postcheck_recovery/);
});

test('workflow uses exact immutable action pins Node and Supabase CLI versions', () => {
  const text = workflowText();
  for (const pin of [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
    'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333',
    'supabase/setup-cli@45a513f8c64c0bc8e0e3dfe572b5c95be85f6359',
  ]) assert.match(text, new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /node-version: '24\.21\.0'/);
  assert.match(text, /version: '2\.120\.0'/);
  assert.doesNotMatch(text, /uses:\s+[^\n]+@(main|master|v?\d+(?:\.x)?|latest)\s*$/m);
});

test('plan has no production environment secrets or mutating commands', () => {
  const plan = workflowJob(workflowText(), 'plan', 'deploy');
  assert.doesNotMatch(plan, /environment:\s*production/);
  assert.doesNotMatch(plan, /secrets\./);
  assert.doesNotMatch(plan, /supabase\s+(db\s+push|migration\s+up|functions\s+deploy)/);
  assert.doesNotMatch(plan, /\b(curl|fetch)\b[^\n]*(supabase\.co|api\.supabase)/i);
});

test('deploy needs plan uses production and fixed noncancelling concurrency', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.match(deploy, /needs: plan/);
  assert.match(deploy, /environment:\s*production/);
  assert.match(deploy, /concurrency:\s*\n\s+group: nelyon-supabase-production\s*\n\s+cancel-in-progress: false/);
  assert.match(deploy, /NELYON_RELEASE_POLICY_SHA256:\s*\$\{\{ vars\.NELYON_RELEASE_POLICY_SHA256 \}\}/);
  assert.match(deploy, /--policy-sha256\s+"\$NELYON_RELEASE_POLICY_SHA256"/);
});

test('canonical workflow uses automatic Environment authorization without approval comments', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.match(deploy, /name: Checkout exact authorized SHA/);
  assert.match(deploy, /name: Fetch current Environment and authorization evidence/);
  assert.match(deploy, /name: Revalidate immutable manifest after authorization/);
  assert.doesNotMatch(deploy, /after approval/i);
  assert.doesNotMatch(deploy, /NELYON-APPROVE/);
});

test('protected gate consumes persistent OFF declaration without screenshot artifacts', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan', 'deploy');
  const deploy = workflowJob(text, 'deploy');
  assert.match(deploy, /SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED:\s*\$\{\{ vars\.SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED \}\}/);
  const gateProofStep = deploy.slice(deploy.indexOf('name: Verify gate proof'), deploy.indexOf('name: Verify release gate'));
  assert.match(gateProofStep, /--auto-deploy-expected "\$SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED"/);
  const releaseGateStep = deploy.slice(deploy.indexOf('name: Verify release gate'), deploy.indexOf('name: Set up pinned Supabase CLI'));
  assert.match(releaseGateStep, /--auto-deploy-expected "\$SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED"/);
  assert.equal((deploy.match(/--auto-deploy-expected "\$SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED"/g) ?? []).length, 3);
  assert.doesNotMatch(plan, /NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64|auto-deploy-evidence\.json|base64 --decode/);
  assert.doesNotMatch(deploy, /NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64|auto-deploy-evidence\.json|base64 --decode|auto_deploy_max_age_seconds/);
});

test('plan_only cannot schedule deploy and gate_proof contains no Supabase mutation', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.match(deploy, /if: >-[\s\S]*needs\.plan\.outputs\.mode == 'gate_proof'[\s\S]*needs\.plan\.outputs\.mode == 'release'[\s\S]*needs\.plan\.outputs\.result == 'PLAN READY'[\s\S]*fromJSON\(needs\.plan\.outputs\.productive_change_count\) > 0/);
  assert.doesNotMatch(deploy, /needs\.plan\.outputs\.mode == 'plan_only'/);
  assert.match(deploy, /if: needs\.plan\.outputs\.mode == 'gate_proof'[\s\S]*verify-gate/);
  assert.match(deploy, /if: needs\.plan\.outputs\.mode == 'release'[\s\S]*supabase\/setup-cli/);
});

test('workflow routes postcheck_recovery through exact source artifacts and no mutation', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan', 'deploy');
  const deploy = workflowJob(text, 'deploy');
  assert.match(plan, /INPUT_RECOVERY_SOURCE_RUN_ID:\s*\$\{\{ inputs\.recovery_source_run_id \}\}/);
  assert.match(plan, /postcheck_recovery[\s\S]*POSTCHECK_RECOVERY_READ_ONLY/);
  assert.match(plan, /recoverySourceRunId:[\s\S]*productiveResources:\s*\[\]/);
  assert.match(plan, /recovery_release_artifact_name/);
  assert.match(plan, /recovery_gate_artifact_name/);
  assert.match(deploy, /needs\.plan\.outputs\.mode == 'postcheck_recovery'[\s\S]*needs\.plan\.outputs\.result == 'NO PRODUCTIVE CHANGES'/);
  assert.match(deploy, /name: Download exact approved source release artifact[\s\S]*name: \$\{\{ needs\.plan\.outputs\.recovery_release_artifact_name \}\}[\s\S]*run-id: \$\{\{ inputs\.recovery_source_run_id \}\}[\s\S]*github-token: \$\{\{ github\.token \}\}/);
  assert.match(deploy, /name: Download exact approved source gate artifact[\s\S]*name: \$\{\{ needs\.plan\.outputs\.recovery_gate_artifact_name \}\}[\s\S]*run-id: \$\{\{ inputs\.recovery_source_run_id \}\}/);
  const verifySource = deploy.indexOf(' verify-recovery-source ');
  const capture = deploy.indexOf('--phase recovery');
  const recover = deploy.indexOf(' postcheck-recovery ');
  assert.ok(verifySource > 0 && capture > verifySource && recover > capture);
  assert.match(deploy, /name: Upload sanitized postcheck recovery evidence[\s\S]*name: nelyon-postcheck-recovery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*retention-days: 90/);
  const recoveryRegion = deploy.slice(deploy.indexOf('name: Download exact approved source release artifact'), deploy.indexOf('name: Upload sanitized postcheck recovery evidence'));
  assert.doesNotMatch(recoveryRegion, /supabase\s+(?:db\s+push|migration|functions\s+deploy)|--phase\s+(?:pre|post)\b/);
  for (const mutation of ['Set up pinned Supabase CLI', 'Verify exact remote migration dry-run', 'Apply exact manifest migrations', 'Deploy each exact manifest function', 'Require postcheck before release success']) {
    const index = deploy.indexOf(`name: ${mutation}`);
    assert.ok(index > 0);
    assert.match(deploy.slice(index, index + 260), /if:.*mode == 'release'/s);
  }
});

test('release path revalidates before secrets and before every mutation', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const revalidate = deploy.indexOf(' revalidate ');
  const verifyGate = deploy.indexOf(' verify-gate ');
  const secretReference = deploy.indexOf('secrets.SUPABASE_ACCESS_TOKEN');
  const migration = deploy.indexOf('supabase db push --project-ref');
  const functions = deploy.indexOf('supabase functions deploy "$function_name"');
  assert.ok(revalidate >= 0 && verifyGate > revalidate && secretReference > verifyGate);
  assert.ok(migration > secretReference && functions > migration);
  assert.match(deploy.slice(migration - 500, migration), /revalidate/);
  assert.match(deploy.slice(functions - 700, functions), /verify-function-contract/);
  assert.match(deploy.slice(functions, functions + 220), /--use-api/);
  assert.match(deploy, /supabase db push --dry-run --project-ref "\$NELYON_PROJECT_REF" --skip-vault --yes/);
  assert.match(deploy, /supabase db push --dry-run --project-ref "\$NELYON_PROJECT_REF" --skip-vault --yes --output-format json/);
  assert.match(deploy, /supabase db push --project-ref "\$NELYON_PROJECT_REF" --skip-vault --yes/);
  assert.doesNotMatch(deploy, /SUPABASE_DB_PASSWORD|SUPABASE_READ_ONLY_ACCESS_TOKEN/);
  assert.match(deploy, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
});

test('fresh completed physical backup and owner-reviewed baseline are verified before every mutation', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const preCapture = deploy.indexOf('production-pre.json');
  const preVerify = deploy.indexOf(' verify-pre-snapshot ');
  const dryRun = deploy.indexOf('supabase db push --dry-run');
  const apply = deploy.indexOf('supabase db push --project-ref');
  assert.ok(preCapture >= 0 && preVerify > preCapture && dryRun > preVerify && apply > preVerify);
  assert.match(deploy, /--pre-snapshot gate-evidence\/production-pre\.json/);
  assert.match(deploy, /nelyon-production-snapshot-adapter\.mjs capture/);
});

test('workflow inventories every active release status and never relies on in-progress alone', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.match(deploy, /\['in_progress', 'queued', 'requested', 'waiting', 'pending'\]/);
  assert.match(deploy, /status=\$\{status\}/);
  assert.doesNotMatch(deploy, /runs\?status=in_progress&/);
});

test('release workflow uses the reviewed snapshot adapter and retains sanitized gate evidence on failure', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  assert.match(deploy, /nelyon-production-snapshot-adapter\.mjs/);
  assert.doesNotMatch(deploy, /reviewed snapshot adapter required/);
  assert.doesNotMatch(deploy, /\{"complete":false/);
  assert.match(deploy, /name: Upload sanitized gate evidence/);
  assert.match(deploy, /if: always\(\)/);
  assert.match(deploy, /migration-dry-run\.json/);
  assert.match(deploy, /id: pre_snapshot/);
  assert.match(deploy, /id: apply_migrations/);
  assert.match(deploy, /id: deploy_functions/);
  assert.match(deploy, /id: post_snapshot/);
  assert.match(deploy, /steps\.pre_snapshot\.outcome == 'success'/);
  assert.match(deploy, /release-observation\.json/);
  assert.doesNotMatch(deploy.slice(deploy.indexOf('name: Upload sanitized gate evidence')), /production-(?:pre|post)\.json/);
});

test('workflow has no contents write force prune bulk deploy or secret logging', () => {
  const text = workflowText();
  assert.match(text, /^permissions:\s*\n\s+contents: read/m);
  assert.doesNotMatch(text, /contents:\s*write/);
  assert.doesNotMatch(text, /(--force|--prune|git push(?:\s+[^\n]*)?\s-f(?:\s|$)|git reset|git clean)/m);
  assert.doesNotMatch(text, /supabase functions deploy\s*(?:\\?\s*)?$/m);
  assert.doesNotMatch(text, /(echo|printf|Write-Output)[^\n]*(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/i);
});

test('postcheck failure cannot mark success or baseline advancement', () => {
  const deploy = workflowJob(workflowText(), 'deploy');
  const postcheck = deploy.indexOf(' postcheck ');
  const success = deploy.indexOf('RELEASE SUCCESS');
  assert.ok(postcheck >= 0 && success > postcheck);
  assert.match(deploy.slice(postcheck, success), /&&/);
  assert.doesNotMatch(deploy, /(write|update|promote)[^\n]*baseline/i);
  assert.doesNotMatch(deploy, /nelyon-production-release-policy\.json[^\n]*(>|Set-Content|Out-File)/i);
});

test('runbook covers the simplified single-owner release finance and recovery controls', () => {
  assert.ok(existsSync(runbookUrl), 'production release runbook must exist');
  const text = readFileSync(runbookUrl, 'utf8');
  for (const section of [
    '## Single-owner security model',
    '## GitHub production configuration',
    '## Baseline candidate to verified',
    '## Supabase automatic-deploy cutover',
    '## Run plan_only',
    '## Run gate_proof',
    '## Future release procedure',
    '## Concurrent finance reconciliation',
    '## Failure recovery and rollback',
    '## Creator Premium postcheck recovery',
    '## Stop conditions',
    '## Zero-mutation postcheck',
  ]) assert.match(text, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const literal of [
    'andressan101989',
    'Required reviewer: `None`',
    'Authorization mode: `automatic`',
    'Deployment branches and tags: `Selected branches and tags`',
    'main',
    'Allow administrators to bypass configured protection rules: `OFF`',
    'SUPABASE_ACCESS_TOKEN',
    'NELYON_RELEASE_POLICY_SHA256',
    'SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED',
    'OWNER_PERSISTENT_DECLARATION',
    'observed_state=UNAVAILABLE',
    'not independently verified',
    'temporary `cli_login_postgres` role',
    'fresh completed physical backup',
    'Deploy to production',
    'no deployment approval comment',
    'current empty deployment approval history',
    'forward-only corrective migration',
    'previously approved reproducible Edge source',
    'POSTCHECK_RECOVERY_READ_ONLY',
    'nelyon-postcheck-recovery-<run-id>-<run-attempt>',
    'does not mean `PHYSICAL_PASS`',
    'transactions confirmed after the pre-snapshot even when created before it',
  ]) assert.ok(text.includes(literal), `runbook missing ${literal}`);
  assert.doesNotMatch(text, /NELYON-APPROVE|Review deployments|paste the exact generated approval token/);
  assert.doesNotMatch(text, /SUPABASE_READ_ONLY_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|Every renewed evidence record must also replace|NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64|fresh screenshot|15 minutes/);
  assert.doesNotMatch(text, /SUPABASE_ACCESS_TOKEN\s*[=:]\s*[^`\s]+/);
});
