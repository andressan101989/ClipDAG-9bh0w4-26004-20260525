import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterUrl = new URL('../scripts/nelyon-production-snapshot-adapter.mjs', import.meta.url);
const installedPolicy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url), 'utf8'));
const FINANCE_OFF_POLICY = Object.freeze({
  platform_fee_bps: 0,
  purchase_enabled: false,
  refunds_enabled: false,
  subscription_enabled: false,
});
// Most adapter fixtures exercise the historical F3 transition itself. Keep those
// fixtures anchored to the exact predecessor baseline after production promotion.
const policy = structuredClone(installedPolicy);
policy.baseline.sha = policy.finance_authority_transition.baseline_sha;
policy.baseline.migration_count = 351;
policy.baseline.latest_migration = '20261024173500_creator_premium_f2_complete_monetization';
policy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
const c2TransitionPolicy = structuredClone(installedPolicy);
c2TransitionPolicy.baseline.sha = installedPolicy.finance_authority_c2_transition.baseline_sha;
c2TransitionPolicy.baseline.migration_count = 352;
c2TransitionPolicy.baseline.latest_migration = '20261025011000_creator_premium_f3_bounded_financial_activation';
c2TransitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
const f4TransitionPolicy = structuredClone(installedPolicy);
f4TransitionPolicy.baseline.sha = installedPolicy.finance_authority_f4_transition.baseline_sha;
f4TransitionPolicy.baseline.migration_count = 354;
f4TransitionPolicy.baseline.latest_migration = '20261025231500_creator_premium_f3_final_wallet_integration';
f4TransitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
const f5TransitionPolicy = structuredClone(installedPolicy);
f5TransitionPolicy.baseline.sha = installedPolicy.finance_authority_f5_transition.baseline_sha;
f5TransitionPolicy.baseline.migration_count = 355;
f5TransitionPolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
f5TransitionPolicy.supabase.finance_policy = {
  platform_fee_bps: 2000,
  purchase_enabled: true,
  refunds_enabled: true,
  subscription_enabled: true,
};
const walletTransitionPolicy = structuredClone(installedPolicy);
walletTransitionPolicy.baseline.sha = '05cdd2ecbeda6132fffb7edc0cf4e7ab2848625a';
walletTransitionPolicy.baseline.migration_count = 353;
walletTransitionPolicy.baseline.latest_migration = '20261025160452_creator_premium_f3_c2_isolated_canary_governance';
walletTransitionPolicy.supabase.finance_policy = { ...FINANCE_OFF_POLICY };
const STORY_B1_RELATION_NAMES = [
  'story_analytics_events',
  'story_b1_worker_lane_state',
  'story_interactive_elements',
  'story_interactive_responses',
  'story_operation_policy',
  'story_safety_state',
];
const STORY_B1_RELATIONS = STORY_B1_RELATION_NAMES.map(name => ({
  schema: 'private',
  name,
  owner: 'postgres',
  rls_enabled: true,
  force_rls: true,
  acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
    .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
}));
// Authority hashes bind the canonical Git LF bytes, independent of Windows checkout conversion.
const gitSql = path => execFileSync('git', ['show', `HEAD:${path}`], {
  cwd: new URL('../', import.meta.url), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const f3MigrationSql = () => gitSql(
  'supabase/migrations/20261025011000_creator_premium_f3_bounded_financial_activation.sql',
);
const f3C2MigrationSql = () => gitSql(
  'supabase/migrations/20261025160452_creator_premium_f3_c2_isolated_canary_governance.sql',
);
const f3FinalWalletMigrationSql = () => gitSql(
  'supabase/migrations/20261025231500_creator_premium_f3_final_wallet_integration.sql',
);
const f4GeneralMigrationSql = () => gitSql(
  'supabase/migrations/20261026030000_creator_premium_f4_general_bdag_activation.sql',
);
const preF3CreatorPremiumMigrations = [
  '20261007035032_creator_premium_b1_canonical_foundation.sql',
  '20261007135515_creator_premium_b2_private_image_media.sql',
  '20261008213002_creator_premium_b3_signed_stream_playback.sql',
  '20261009001706_creator_premium_b4_atomic_finance_authority.sql',
  '20261009010509_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '20261009021414_creator_premium_b5_creator_management_ux.sql',
  '20261010053524_creator_premium_b7_full_functional_commercial_completion.sql',
  '20261017193000_creator_premium_c1_submission_cancellation.sql',
  '20261018050000_creator_premium_c3_visual_retry_producer.sql',
  '20261018120000_creator_premium_content_safety_p1_policy_gate.sql',
  '20261018170000_creator_premium_content_safety_p2_evidence_runtime.sql',
  '20261018200000_creator_premium_content_safety_p2_activation.sql',
  '20261018211327_creator_premium_qa_final_f1.sql',
  '20261019023431_creator_premium_f1_c4_final_recovery.sql',
  '20261019170853_creator_premium_f1_c6_submit_unavailable_mapping_recovery.sql',
  '20261019201914_creator_premium_content_safety_p3_contextual_violence_policy_v2.sql',
  '20261020000758_content_safety_p3_c1_admin_alerts_sql_recovery.sql',
  '20261020030515_creator_premium_p3_c2_admin_restriction_recovery.sql',
  '20261020203718_creator_premium_p3_c3_safety_decision_recovery.sql',
  '20261023141630_creator_premium_media_lifecycle_c1.sql',
  '20261024173500_creator_premium_f2_complete_monetization.sql',
];
const preB7AdminFixture = `
  insert into private.admin_roles(
    role_code,display_name,description,is_assignable,is_root,is_exclusive
  ) values(
    'MODERATOR','Moderator','Cross-domain safety and moderation authority.',
    true,false,false
  ) on conflict(role_code) do nothing;
  insert into private.admin_capabilities(
    capability_code,domain,effect,description,is_sensitive
  ) values
    ('content.items.moderate','content','write','Moderate content.',true),
    ('finance.ledger.read','finance','read','Read immutable ledger projections.',true)
  on conflict(capability_code) do nothing;
  insert into private.admin_role_capabilities(role_code,capability_code)
  values
    ('SUPER_ADMIN','content.items.moderate'),
    ('SUPER_ADMIN','finance.ledger.read'),
    ('MODERATOR','content.items.moderate')
  on conflict(role_code,capability_code) do nothing;
`;

function createPreF3GovernanceDatabase({ docker, sql, db }) {
  docker(['createdb','-U','supabase_admin','-T','algo6_final_compile_a2',db]);
  for (const migration of preF3CreatorPremiumMigrations) {
    if (migration === '20261010053524_creator_premium_b7_full_functional_commercial_completion.sql') {
      sql(preB7AdminFixture);
    }
    const migrationSql = gitSql(`supabase/migrations/${migration}`);
    assert.equal(migrationSql.includes('\r'), false, `${migration} must use canonical Git LF bytes`);
    sql(migrationSql);
  }
}

function f4DisposablePostgres(db) {
  assert.match(db, /^premium_f4_adapter_[a-z0-9_]+$/);
  const wslPid = process.env.CREATOR_PREMIUM_PG_WSL_PID ?? '';
  assert.ok(wslPid === '' || /^\d+$/.test(wslPid));
  const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
  const sh = (command, input = '', allowFailure = false) => {
    const result = wslPid
      ? spawnSync('wsl.exe', ['-d','docker-desktop','-u','root','-e','nsenter','-t',wslPid,
        '-m','-u','-i','-n','-p','/bin/sh','-c',command],
      { input, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 })
      : spawnSync('docker', ['exec','-i',container,'/bin/sh','-c',command],
      { input, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
    if (!allowFailure) assert.equal(result.status, 0,
      `${command}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
  };
  const quote = value => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
  const docker = args => sh(args.map(quote).join(' ')).stdout;
  const sql = (input, allowFailure = false) => sh(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At`, input, allowFailure,
  );
  return { docker, sql };
}

async function loadAdapter() {
  return import(`${adapterUrl.href}?test=${Date.now()}-${Math.random()}`);
}

const CONTROL_CENTER_MIGRATIONS = [
  ['20261031020113', 'superuser_control_center_mfa_aal2'],
  ['20261031025722', 'superuser_control_center_cursor_terminal_truth'],
  ['20261031032022', 'superuser_control_center_overview'],
];

function controlCenterMigrations(installed) {
  const base = Array.from({ length: 360 }, (_, index) => ({
    version: `2026${String(index).padStart(10, '0')}`,
    name: `historical_${index}`,
  }));
  base.push({ version: '20261029042807', name: 'stories_v2_qa_c1_question_answer_authority' });
  if (installed) base.push(...CONTROL_CENTER_MIGRATIONS.map(([version, name]) => ({ version, name })));
  base.sort((a, b) => a.version.localeCompare(b.version));
  return { complete: true, count: base.length, items: base, latest: base.at(-1),
    sha256: sha256(canonicalJson(base)) };
}

function controlCenterState(transition, { installed, concurrentDelta = 0 } = {}) {
  const predecessor = transition.security_advisor.predecessor_exception;
  const oldFunction = {
    identity: 'public.search_admin_advertising_ads(text,integer)',
    ...predecessor.attestation,
    volatility: 's',
  };
  const probeLimit = transition.bounded_postcheck.probe_limit;
  return {
    schema_version: 1,
    complete: true,
    installed,
    capability_count: transition.required_aal_catalog.capability_count,
    aal2_codes: installed ? transition.required_aal_catalog.aal2_codes : [],
    refund_roles: installed ? transition.required_aal_catalog.refund_roles : [],
    root_role: transition.required_aal_catalog.root_role,
    root_grant_rule_count: transition.required_aal_catalog.root_grant_rule_count,
    functions: installed ? transition.function_definitions : [oldFunction],
    predecessor_function: installed ? null : oldFunction,
    index: installed ? {
      schema: transition.index_attestation.schema,
      table: transition.index_attestation.table,
      name: transition.index_attestation.name,
      owner: transition.index_attestation.owner,
      definition: transition.index_attestation.definition,
      valid: transition.index_attestation.valid,
      ready: transition.index_attestation.ready,
      unique: transition.index_attestation.unique,
      primary: transition.index_attestation.primary,
    } : null,
    bounded_observations: {
      probe_limit: probeLimit,
      mfa_factors: { observed_rows: concurrentDelta, saturated: false },
      admin_action_audit: { observed_rows: 112 + concurrentDelta, saturated: false },
      advertising_ads: { observed_rows: 5 + concurrentDelta, saturated: false },
      admin_audit_release_attributed: false,
    },
  };
}

function perfC1Migrations(installed) {
  const base = controlCenterMigrations(true).items;
  if (installed) base.push({ version: '20261101181907', name: 'superuser_qa_perf_c1' });
  base.sort((a, b) => a.version.localeCompare(b.version));
  return { complete: true, count: base.length, items: base, latest: base.at(-1),
    sha256: sha256(canonicalJson(base)) };
}

function perfC1State(transition, installed) {
  const history = transition.cron_history_attestation;
  return {
    schema_version: 3,
    complete: true,
    installed,
    functions: installed ? transition.function_definitions : transition.predecessor_functions,
    cron_history: {
      schema: history.schema, table: history.table, relation_kind: history.relation_kind,
      schema_owner: history.schema_owner, table_owner: history.table_owner,
      extension: history.extension, primary_index: structuredClone(history.primary_index),
      release_index_name: history.release_index_name,
      release_index_present: history.release_index_expected,
    },
    finance: {
      activation_mode: 'general', active_authorization: true,
      platform_fee_bps: 2000, purchase_enabled: true,
      refunds_enabled: true, subscription_enabled: true,
    },
  };
}

test('PERF C1 snapshot permits only the exact managed-cron prestate and freezes the bounded post-state', async () => {
  const adapter = await loadAdapter();
  const transition = installedPolicy.superuser_qa_perf_c1_transition;
  assert.equal(adapter.assertReadOnlySql(adapter.SUPERUSER_QA_PERF_C1_STATE_SQL), true);
  const approvedSha = 'c'.repeat(40);
  const manifest = { identity: { approved_sha: approvedSha }, resources: {
    superuser_qa_perf_c1_transition: { ...structuredClone(transition), approved_sha: approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_bytes_verified: true },
  } };
  const preRequirement = adapter.superuserQaPerfC1StateRequirement(installedPolicy, manifest, 'pre',
    { migrations: perfC1Migrations(false) });
  const postRequirement = adapter.superuserQaPerfC1StateRequirement(installedPolicy, manifest, 'post',
    { migrations: perfC1Migrations(true) });
  assert.equal(preRequirement.required, true);
  assert.equal(preRequirement.installed, false);
  assert.equal(perfC1Migrations(false).count, 364);
  for (const collision of [
    { version: transition.migrations[0].version, name: 'wrong_name_same_version' },
    { version: '20990101000000', name: 'superuser_qa_perf_c1' },
  ]) {
    const migrations = perfC1Migrations(false);
    migrations.items.push(collision);
    migrations.items.sort((left, right) => left.version.localeCompare(right.version));
    migrations.count = migrations.items.length;
    migrations.latest = migrations.items.at(-1);
    migrations.sha256 = sha256(canonicalJson(migrations.items));
    assert.throws(() => adapter.superuserQaPerfC1StateRequirement(installedPolicy, manifest, 'pre',
      { migrations }), /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/);
  }
  assert.equal(postRequirement.required, true);
  assert.equal(postRequirement.installed, true);
  assert.equal(perfC1Migrations(true).count, 365);
  for (const { collision, error } of [
    { collision: { version: '20990101000000', name: 'superuser_qa_perf_c1' },
      error: /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/ },
    { collision: { version: transition.migrations[0].version, name: 'wrong_name_same_version' },
      error: /(?:INVALID_REMOTE_INVENTORY|SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED)/ },
  ]) {
    const migrations = perfC1Migrations(true);
    migrations.items.push(collision);
    migrations.items.sort((left, right) => left.version.localeCompare(right.version));
    migrations.count = migrations.items.length;
    migrations.latest = migrations.items.at(-1);
    migrations.sha256 = sha256(canonicalJson(migrations.items));
    assert.throws(() => adapter.superuserQaPerfC1StateRequirement(installedPolicy, manifest, 'post',
      { migrations }), error);
  }
  const pre = perfC1State(transition, false), post = perfC1State(transition, true);
  assert.equal(adapter.validateSuperuserQaPerfC1StateTransition(pre, post, transition), true);
  for (const mutate of [
    value => { value.probe_order = ['start_time']; },
    value => { value.probe_direction = 'asc'; },
    value => { value.probe_limit = 100000; },
    value => { value.complete_only_when_unsaturated = false; },
    value => { value.exact_only_when_complete = false; },
    value => { value.unavailable_reason = 'other'; },
    value => { value.unavailable_value = 0; },
  ]) {
    const hostileTransition = structuredClone(transition);
    mutate(hostileTransition.cron_history_attestation.metrics_contract);
    assert.throws(
      () => adapter.validateSuperuserQaPerfC1StateTransition(pre, post, hostileTransition),
      /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/,
    );
  }
  for (const mutate of [
    value => { value.installed = true; },
    value => { value.functions[0] = structuredClone(transition.function_definitions[0]); },
    value => { value.functions.push(structuredClone(value.functions[0])); },
    value => { value.cron_history.schema_owner = 'postgres'; },
    value => { value.cron_history.table_owner = 'postgres'; },
    value => { value.cron_history.schema = 'public'; },
    value => { value.cron_history.table = 'job'; },
    value => { value.cron_history.relation_kind = 'v'; },
    value => { value.cron_history.extension = 'other'; },
    value => { value.cron_history.primary_index.name = 'other'; },
    value => { value.cron_history.primary_index.key_columns = ['start_time']; },
    value => { value.cron_history.primary_index.included_columns = ['status']; },
    value => { value.cron_history.primary_index.primary = false; },
    value => { value.cron_history.primary_index.unique = false; },
    value => { value.cron_history.primary_index.valid = false; },
    value => { value.cron_history.primary_index.ready = false; },
    value => { value.cron_history.primary_index.predicate = true; },
    value => { value.cron_history.primary_index.expressions = true; },
    value => { value.cron_history.release_index_name = 'other_idx'; },
    value => { value.cron_history.release_index_present = true; },
    value => { value.finance.platform_fee_bps = 0; },
  ]) {
    const hostile = structuredClone(pre); mutate(hostile);
    assert.throws(() => adapter.validateSuperuserQaPerfC1StateTransition(hostile, post, transition),
      /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/);
  }
  const expandedHistory = structuredClone(pre);
  expandedHistory.cron_history.unexpected = true;
  assert.throws(
    () => adapter.validateSuperuserQaPerfC1StateTransition(expandedHistory, post, transition),
    error => error?.code === 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED',
  );
  const expandedPrimaryIndex = structuredClone(pre);
  expandedPrimaryIndex.cron_history.primary_index.unexpected = true;
  assert.throws(
    () => adapter.validateSuperuserQaPerfC1StateTransition(expandedPrimaryIndex, post, transition),
    error => error?.code === 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED',
  );
  for (const mutate of [
    value => { value.installed = false; },
    value => { value.cron_history.release_index_present = true; },
    value => { value.functions[0] = structuredClone(transition.predecessor_functions[0]); },
  ]) {
    const hostile = structuredClone(post); mutate(hostile);
    assert.throws(() => adapter.validateSuperuserQaPerfC1StateTransition(hostile, post, transition),
      /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/);
  }
  for (const mutate of [
    value => { value.functions[0].definition_sha256 = '0'.repeat(64); },
    value => { value.functions[1].definition_sha256 = '0'.repeat(64); },
    value => { value.functions[0].owner = 'authenticated'; },
    value => { value.functions[1].security_definer = false; },
    value => { value.functions[1].search_path.pop(); },
    value => { value.functions[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.functions[1].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.cron_history.schema_owner = 'authenticated'; },
    value => { value.cron_history.table_owner = 'authenticated'; },
    value => { value.cron_history.extension = 'other'; },
    value => { value.cron_history.primary_index.valid = false; },
    value => { value.cron_history.primary_index.ready = false; },
    value => { value.cron_history.primary_index.key_columns = ['start_time']; },
    value => { value.cron_history.release_index_present = true; },
    value => { value.finance.platform_fee_bps = 0; },
    value => { value.finance.activation_mode = 'off'; },
  ]) {
    const hostile = structuredClone(post); mutate(hostile);
    assert.throws(() => adapter.validateSuperuserQaPerfC1StateTransition(pre, hostile, transition),
      /SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED/);
  }
});

test('PERF C1 capture and postcheck bind the fixed query and exact one-migration transition', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const transition = controlledPolicy.superuser_qa_perf_c1_transition;
  controlledPolicy.baseline.sha = transition.baseline_sha;
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.baseline.blocked_resources = [];
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  controlledPolicy.supabase.finance_policy = {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  };
  const releaseManifest = manifest();
  releaseManifest.resources = {
    config_changed: false,
    function_contracts: [],
    functions: [],
    migrations: transition.migrations.map(({ blob, path, version }) => ({ blob, path, version })),
    superuser_qa_perf_c1_transition: {
      ...structuredClone(transition),
      approved_sha: releaseManifest.identity.approved_sha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    },
  };
  const baseMigration = {
    version: '20261009021414',
    name: 'creator_premium_b5_creator_management_ux',
  };
  const generalFinance = financeSnapshot({
    policy: {
      purchase_enabled: true,
      subscription_enabled: true,
      refunds_enabled: true,
      platform_fee_bps: 2000,
      policy_version: 'creator-premium-f4-general-v1',
    },
  });
  const capture = async (phase, installed) => {
    const calls = [];
    const base = successfulFetch(calls, {
      finance: generalFinance,
      backups: [completedPhysicalBackup({
        id: '2026-11-01T17:00:00.000Z',
        inserted_at: '2026-11-01T17:00:00.000Z',
      })],
    });
    const migrationRows = [
      baseMigration,
      ...(installed ? transition.migrations.map(item => ({
        version: item.version,
        name: item.path.split('/').at(-1).replace(/^\d{14}_|\.sql$/gu, ''),
      })) : []),
    ];
    const fetchImpl = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/database/migrations')) {
        calls.push({ url: String(url), options });
        return jsonResponse(migrationRows);
      }
      if (pathname.endsWith('/database/query/read-only')) {
        const body = JSON.parse(options.body);
        if (body.query === adapter.SUPERUSER_QA_PERF_C1_STATE_SQL) {
          calls.push({ url: String(url), options });
          return jsonResponse([{ snapshot: perfC1State(transition, installed) }], 201);
        }
      }
      return base(url, options);
    };
    const evidence = await adapter.captureProductionSnapshot({
      phase,
      policy: controlledPolicy,
      request: request(),
      manifest: releaseManifest,
      token: 'private-read-token',
      fetchImpl,
      observedAt: installed ? '2026-11-01T17:02:00.000Z' : '2026-11-01T17:01:00.000Z',
      adapterSourceSha256: '6'.repeat(64),
    });
    bindRpcSecurityEvidence(evidence, adapter.advisorExceptionsForPhase(
      controlledPolicy,
      releaseManifest,
      phase,
      { request: request(), migrations: evidence.migrations },
    ));
    return evidence;
  };
  const pre = await capture('pre', false);
  assert.equal(pre.superuser_qa_perf_c1_state.installed, false);
  assert.ok(pre.adapter.queries.some(item => (
    item.id === 'nelyon-superuser-qa-perf-c1-state-v3'
      && item.sha256 === sha256(adapter.SUPERUSER_QA_PERF_C1_STATE_SQL)
  )));
  controlledPolicy.baseline.evidence_digests = adapter.buildProductionBaselineDigests({
    evidence: pre,
    policy: controlledPolicy,
  });
  const post = await capture('post', true);
  assert.equal(post.superuser_qa_perf_c1_state.installed, true);
  const pair = {
    pre,
    post,
    policy: controlledPolicy,
    request: request(),
    manifest: releaseManifest,
    adapterSourceSha256: '6'.repeat(64),
  };
  assert.equal(adapter.verifyProductionSnapshotPair(pair).result, 'REMOTE_POSTCHECK_VERIFIED');
  const renamedHistorical = structuredClone(post);
  renamedHistorical.migrations.items[0].name = 'concurrently_renamed_historical_migration';
  renamedHistorical.migrations.sha256 = sha256(canonicalJson(renamedHistorical.migrations.items));
  resignEvidence(renamedHistorical);
  assert.throws(() => adapter.verifyProductionSnapshotPair({ ...pair, post: renamedHistorical }),
    /REMOTE_POSTCHECK_FAILED/);
});

test('Control Center snapshot uses bounded provenance, permits concurrency, and rejects release attribution', async () => {
  const adapter = await loadAdapter();
  const transition = installedPolicy.superuser_control_center_transition;
  const preControlCenterPolicy = structuredClone(installedPolicy);
  preControlCenterPolicy.baseline.sha = transition.baseline_sha;
  preControlCenterPolicy.baseline.migration_count = 361;
  preControlCenterPolicy.baseline.latest_migration =
    '20261029042807_stories_v2_qa_c1_question_answer_authority';
  preControlCenterPolicy.baseline.evidence_digests.migrations =
    '2491beef8b04623de0c0c2dffd73aa1b79f57de6cf7f3144590744f2165c6bc9';
  assert.equal(adapter.assertReadOnlySql(adapter.SUPERUSER_CONTROL_CENTER_STATE_SQL), true);
  const approvedSha = 'd'.repeat(40);
  const manifest = {
    identity: { approved_sha: approvedSha },
    resources: { superuser_control_center_transition: {
      ...structuredClone(transition), approved_sha: approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    } },
  };
  const preMigrations = controlCenterMigrations(false);
  const postMigrations = controlCenterMigrations(true);
  const preRequirement = adapter.superuserControlCenterStateRequirement(
    preControlCenterPolicy, manifest, 'pre', { migrations: preMigrations },
  );
  const postRequirement = adapter.superuserControlCenterStateRequirement(
    preControlCenterPolicy, manifest, 'post', { migrations: postMigrations },
  );
  assert.equal(preRequirement.required, true);
  assert.equal(preRequirement.installed, false);
  assert.equal(postRequirement.required, true);
  assert.equal(postRequirement.installed, true);
  assert.equal(preRequirement.query, adapter.SUPERUSER_CONTROL_CENTER_STATE_SQL);
  assert.doesNotMatch(adapter.SUPERUSER_CONTROL_CENTER_STATE_SQL,
    /jsonb_agg\s*\(\s*pg_catalog\.to_jsonb\s*\(\s*x\s*\)/iu);
  assert.doesNotMatch(adapter.SUPERUSER_CONTROL_CENTER_STATE_SQL,
    /from\s+(?:public\.)?financial_transactions|from\s+(?:public\.)?ledger_entries|from\s+(?:private\.)?creator_premium_purchase_receipts|from\s+(?:private\.)?creator_premium_subscription_periods/iu);
  const pre = controlCenterState(transition, { installed: false });
  const post = controlCenterState(transition, { installed: true, concurrentDelta: 1 });
  assert.equal(adapter.validateSuperuserControlCenterStateTransition(pre, post, transition), true);
  const preExceptions = adapter.advisorExceptionsForPhase(preControlCenterPolicy, manifest, 'pre', {
    migrations: preMigrations,
  });
  const postExceptions = adapter.advisorExceptionsForPhase(preControlCenterPolicy, manifest, 'post', {
    migrations: postMigrations,
  });
  assert.equal(preExceptions.filter(item => item.advisor_fingerprint
    === transition.security_advisor.predecessor_exception.advisor_fingerprint).length, 1);
  assert.equal(postExceptions.some(item => item.advisor_fingerprint
    === transition.security_advisor.predecessor_exception.advisor_fingerprint), false);
  for (const item of transition.security_advisor.introduced_exceptions) {
    assert.equal(postExceptions.filter(candidate => candidate.advisor_fingerprint === item.advisor_fingerprint).length, 1);
  }
  for (const mutate of [
    value => { value.aal2_codes.pop(); },
    value => { value.refund_roles.push('PLATFORM_ADMIN'); },
    value => { value.functions[0].definition_sha256 = '0'.repeat(64); },
    value => { value.functions[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.index.ready = false; },
    value => { value.bounded_observations.admin_audit_release_attributed = true; },
    value => { value.bounded_observations.probe_limit += 1; },
    value => { value.bounded_observations.advertising_ads.observed_rows = value.bounded_observations.probe_limit + 1; },
    value => { value.bounded_observations.advertising_ads.observed_rows = value.bounded_observations.probe_limit;
      value.bounded_observations.advertising_ads.saturated = true; },
  ]) {
    const hostile = structuredClone(post); mutate(hostile);
    assert.throws(() => adapter.validateSuperuserControlCenterStateTransition(pre, hostile, transition),
      /SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED/);
  }
});

test('Admin recovery post-state requires the exact installed Control Center state and migration inventory', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(installedPolicy);
  const transition = controlledPolicy.superuser_control_center_transition;
  const migrations = controlCenterMigrations(true);
  controlledPolicy.baseline.sha = transition.baseline_sha;
  controlledPolicy.baseline.migration_count = 361;
  controlledPolicy.baseline.latest_migration =
    '20261029042807_stories_v2_qa_c1_question_answer_authority';
  controlledPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson(
    migrations.items.slice(0, controlledPolicy.baseline.migration_count)
      .map(item => `${item.version}_${item.name}`),
  ));
  const state = controlCenterState(transition, { installed: true });
  assert.equal(adapter.validateAdminRecoveryControlCenterPostState({
    migrations, state, policy: controlledPolicy,
  }), true);
  const missingMigration = structuredClone(migrations);
  missingMigration.items = missingMigration.items.filter(item => item.version !== transition.migrations[1].version);
  missingMigration.count = missingMigration.items.length;
  missingMigration.latest = missingMigration.items.at(-1);
  missingMigration.sha256 = sha256(canonicalJson(missingMigration.items));
  assert.throws(() => adapter.validateAdminRecoveryControlCenterPostState({
    migrations: missingMigration, state, policy: controlledPolicy,
  }), /ADMIN_RECOVERY_POSTCHECK_FAILED/);
  const replacedHistoricalMigration = structuredClone(migrations);
  replacedHistoricalMigration.items[0].name = 'replaced_historical_migration';
  replacedHistoricalMigration.sha256 = sha256(canonicalJson(replacedHistoricalMigration.items));
  assert.throws(() => adapter.validateAdminRecoveryControlCenterPostState({
    migrations: replacedHistoricalMigration, state, policy: controlledPolicy,
  }), /ADMIN_RECOVERY_POSTCHECK_FAILED/);
  const driftedAcl = structuredClone(state);
  driftedAcl.functions[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false });
  assert.throws(() => adapter.validateAdminRecoveryControlCenterPostState({
    migrations, state: driftedAcl, policy: controlledPolicy,
  }), /ADMIN_RECOVERY_POSTCHECK_FAILED|SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED/);
});

test('Admin recovery infrastructure rejects Edge, cron, and Advisor drift after the exact three-migration append', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(installedPolicy);
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20260000000000_admin_recovery_fixture';
  controlledPolicy.supabase.managed_functions = [];
  controlledPolicy.supabase.expected_remote_function_count = 0;
  const baseMigrations = [{ version: '20260000000000', name: 'admin_recovery_fixture' }];
  const migrations = [...baseMigrations, ...CONTROL_CENTER_MIGRATIONS.map(([version, name]) => ({ version, name }))];
  const migrationInventory = { complete: true, count: migrations.length, items: migrations,
    latest: migrations.at(-1), sha256: sha256(canonicalJson(migrations)) };
  const functions = { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) };
  const cron = cronSnapshot();
  const predecessor = controlledPolicy.superuser_control_center_transition.security_advisor.predecessor_exception;
  const additions = controlledPolicy.superuser_control_center_transition.security_advisor.introduced_exceptions;
  const advisorRow = item => ({ fingerprint: item.advisor_fingerprint,
    level: item.advisor_severity, resource_kind: item.advisor_type });
  const baselineAdvisors = [advisorRow(predecessor)];
  const postAdvisorItems = additions.map(advisorRow).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const finance = financeSnapshot();
  controlledPolicy.supabase.finance_policy = {
    platform_fee_bps: finance.policy.platform_fee_bps,
    purchase_enabled: finance.policy.purchase_enabled,
    refunds_enabled: finance.policy.refunds_enabled,
    subscription_enabled: finance.policy.subscription_enabled,
  };
  const baselineEvidence = {
    migrations: { complete: true, count: 1, items: baseMigrations, latest: baseMigrations[0],
      sha256: sha256(canonicalJson(baseMigrations)) },
    functions,
    cron_security: { cron, advisors: { complete: true, count: baselineAdvisors.length,
      items: baselineAdvisors, sha256: sha256(canonicalJson(baselineAdvisors)) } },
    finance,
    rpc_security: { items: [] },
  };
  controlledPolicy.baseline.evidence_digests = adapter.buildProductionBaselineDigests({
    evidence: baselineEvidence, policy: controlledPolicy,
  });
  controlledPolicy.superuser_control_center_transition.security_advisor.transition.after_count = postAdvisorItems.length;
  controlledPolicy.superuser_control_center_transition.security_advisor.transition.after_sha256 = sha256(canonicalJson(postAdvisorItems));
  const post = {
    ...baselineEvidence,
    migrations: migrationInventory,
    cron_security: { cron, advisors: { complete: true, count: postAdvisorItems.length,
      items: postAdvisorItems, sha256: sha256(canonicalJson(postAdvisorItems)) } },
    superuser_control_center_state: controlCenterState(
      controlledPolicy.superuser_control_center_transition, { installed: true },
    ),
  };
  assert.equal(adapter.verifyAdminRecoveryInfrastructurePostState({ post, policy: controlledPolicy }).migrations,
    controlledPolicy.baseline.evidence_digests.migrations);

  for (const mutate of [
    value => {
      value.functions.items.push({ slug: 'rogue-edge', status: 'ACTIVE', version: 1,
        verify_jwt: true, ezbr_sha256: 'a'.repeat(64) });
      value.functions.count = value.functions.items.length;
      value.functions.sha256 = sha256(canonicalJson(value.functions.items));
    },
    value => {
      value.cron_security.cron.items.push({ active: true, command_sha256: 'a'.repeat(64),
        database: 'postgres', jobid: '1', jobname: 'rogue', legacy_normalized_command_sha256: 'b'.repeat(64),
        nodename: 'localhost', nodeport: 5432, schedule: '* * * * *', username: 'postgres' });
      value.cron_security.cron.count = value.cron_security.cron.items.length;
    },
    value => {
      value.cron_security.advisors.items.push({ fingerprint: 'c'.repeat(64), level: 'WARN', resource_kind: 'rogue' });
      value.cron_security.advisors.items.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
      value.cron_security.advisors.count = value.cron_security.advisors.items.length;
      value.cron_security.advisors.sha256 = sha256(canonicalJson(value.cron_security.advisors.items));
    },
  ]) {
    const hostile = structuredClone(post);
    mutate(hostile);
    assert.throws(() => adapter.verifyAdminRecoveryInfrastructurePostState({ post: hostile, policy: controlledPolicy }),
      /ADMIN_RECOVERY_POSTCHECK_FAILED|RECOVERY_POSTCHECK_FAILED|REMOTE_BASELINE_MISMATCH/);
  }
});

test('Stories B1 snapshot contract is fail-closed and rejects policy activation or fabricated pass', async () => {
  const adapter = await loadAdapter();
  assert.equal(adapter.assertReadOnlySql(adapter.STORIES_B1_PRE_STATE_SQL), true);
  assert.equal(adapter.assertReadOnlySql(adapter.STORIES_B1_POST_STATE_SQL), true);
  assert.match(adapter.STORIES_B1_PRE_STATE_SQL, /content_safety_rules/);
  assert.match(adapter.STORIES_B1_POST_STATE_SQL, /story_safety_state/);
  const pre = adapter.normalizeStoriesB1State({
    schema_version: 1,
    complete: true,
    infrastructure_installed: false,
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
    relations: [],
  });
  const post = adapter.normalizeStoriesB1State({
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
    relations: STORY_B1_RELATIONS,
  });
  assert.equal(adapter.validateStoriesB1StateTransition(pre, post, installedPolicy.stories_b1_transition), true);

  for (const mutate of [
    state => { state.owner_approved_policy = true; },
    state => { state.activation = true; },
    state => { state.safety_state_counts.passed = 1; state.fabricated_pass_count = 1; },
    state => { state.complete_evidence_count = 1; state.complete_evidence_pass_count = 1; },
    state => { state.relations[0].force_rls = false; },
    state => { state.relations[0].acl.push({ grantee: 'authenticated', privilege_type: 'SELECT', is_grantable: false }); },
  ]) {
    const hostile = structuredClone(post);
    delete hostile.sha256;
    mutate(hostile);
    assert.throws(() => adapter.validateStoriesB1StateTransition(
      pre,
      adapter.normalizeStoriesB1State(hostile),
      installedPolicy.stories_b1_transition,
    ), /STORIES_B1_POSTCHECK_FAILED/);
  }

  const preWithStory = structuredClone(pre);
  delete preWithStory.sha256;
  preWithStory.story_count = 1;
  preWithStory.direct_story_count = 1;
  for (const mutate of [
    state => {
      state.safety_state_counts.pending = 1;
      state.complete_evidence_count = 1;
      state.complete_evidence_non_review_count = 1;
    },
    state => {
      state.safety_state_counts.review = 1;
      state.incomplete_evidence_non_pending_count = 1;
    },
    state => { state.safety_state_counts.blocked = 1; },
  ]) {
    const hostile = structuredClone(post);
    delete hostile.sha256;
    hostile.story_count = 1;
    hostile.direct_story_count = 1;
    mutate(hostile);
    assert.throws(() => adapter.validateStoriesB1StateTransition(
      adapter.normalizeStoriesB1State(preWithStory),
      adapter.normalizeStoriesB1State(hostile),
      installedPolicy.stories_b1_transition,
    ), /STORIES_B1_POSTCHECK_FAILED/);
  }
});

test('Stories Safety C2 snapshot exposes distinct publication moderation and scan facts', async () => {
  const adapter = await loadAdapter();
  assert.equal(typeof adapter.normalizeStoriesSafetyC2State, 'function');
  assert.equal(typeof adapter.validateStoriesSafetyC2StateTransition, 'function');
  assert.equal(adapter.assertReadOnlySql(adapter.STORIES_SAFETY_C2_STATE_SQL), true);
  assert.equal(adapter.assertReadOnlySql(adapter.STORIES_SAFETY_C2_PRE_STATE_SQL), true);
  assert.match(adapter.STORIES_SAFETY_C2_PRE_STATE_SQL, /pg_catalog\.to_jsonb\(safety\)::text/);
  assert.match(adapter.STORIES_SAFETY_C2_STATE_SQL, /publication_status/);
  assert.match(adapter.STORIES_SAFETY_C2_STATE_SQL, /moderation_status/);
  assert.match(adapter.STORIES_SAFETY_C2_STATE_SQL, /scan_status/);
  const executableSql = adapter.STORIES_SAFETY_C2_STATE_SQL.replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(executableSql, /\bprivate\.[a-z_0-9]+\s*\(/i,
    'Management read-only snapshots must not execute owner-only helpers');
});

test('Stories Safety C2 phase selection keeps C1 pre and supports promoted baseline and exact recovery', async () => {
  const adapter = await loadAdapter();
  const predecessorPolicy = structuredClone(installedPolicy);
  predecessorPolicy.baseline.sha = 'e4c7199da157446f455822ea96e812784354b1db';
  predecessorPolicy.baseline.migration_count = 359;
  predecessorPolicy.baseline.latest_migration = '20261027120000_stories_v2_safety_c1_technical_policy_prep';
  const transition = predecessorPolicy.stories_safety_c2_transition;
  assert.ok(transition, 'C2 authority must be present');
  const attestedManifest = { identity: { approved_sha: 'a'.repeat(40) }, resources: {
    stories_safety_c2_transition: { ...transition, approved_sha: 'a'.repeat(40),
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true },
  } };
  assert.equal(adapter.storiesSafetyC2StateRequirement(predecessorPolicy, attestedManifest, 'pre').required, false);
  assert.equal(adapter.storiesSafetyC2StateRequirement(predecessorPolicy, attestedManifest, 'post').required, true);
  assert.equal(adapter.storiesSafetyC2StateRequirement(predecessorPolicy, { resources: {} }, 'post').required, false);
  const promoted = structuredClone(predecessorPolicy);
  promoted.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  for (const phase of ['pre', 'post', 'recovery']) {
    assert.equal(adapter.storiesSafetyC2StateRequirement(promoted, { resources: {} }, phase).required, true);
  }
  const recovering = structuredClone(predecessorPolicy);
  recovering.postcheck_recovery.approved_sources.push({ run_id: '123456789',
    expected_latest_migration: '20261027191918_stories_v2_safety_c2_publish_first_async_review',
    expected_migration_count: 360,
    expected_migrations: [{ name: '20261027191918_stories_v2_safety_c2_publish_first_async_review', blob: transition.migration_blob }],
    edge_functions: [{ name: 'get-stream-playback', verify_jwt: true, status: 'ACTIVE', version: 50,
      source_sha256: 'b'.repeat(64) }],
  });
  const recoveryManifest = { identity: { mode: 'postcheck_recovery' }, resources: {
    config_changed: false, function_contracts: [], functions: [], migrations: [],
  } };
  const recoveryRequest = { mode: 'postcheck_recovery', scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY', recoverySourceRunId: '123456789' };
  assert.equal(adapter.storiesSafetyC2StateRequirement(recovering, recoveryManifest, 'recovery', { request: recoveryRequest }).required, true);
  for (const mutate of [
    value => { value.edge_functions = []; },
    value => { value.edge_functions[0].verify_jwt = false; },
    value => { value.edge_functions.push({ ...value.edge_functions[0], name: 'content-safety-scan' }); },
  ]) {
    const hostileRecovery = structuredClone(recovering);
    mutate(hostileRecovery.postcheck_recovery.approved_sources.at(-1));
    assert.equal(adapter.storiesSafetyC2StateRequirement(hostileRecovery, recoveryManifest, 'recovery', { request: recoveryRequest }).required, false);
  }
  recovering.postcheck_recovery.approved_sources.at(-1).expected_migrations[0].blob = '0'.repeat(40);
  assert.equal(adapter.storiesSafetyC2StateRequirement(recovering, recoveryManifest, 'recovery', { request: recoveryRequest }).required, false);
  const hostile = structuredClone(attestedManifest);
  hostile.resources.stories_safety_c2_transition.policy_artifact.sha256 = '0'.repeat(64);
  assert.throws(() => adapter.storiesSafetyC2StateRequirement(predecessorPolicy, hostile, 'post'), /INVALID_STORIES_SAFETY_C2_TRANSITION/);
});

test('Stories Safety C2 RPC attestations replace only C2 post authority and preserve C1 history', async () => {
  const adapter = await loadAdapter();
  const predecessorPolicy = structuredClone(installedPolicy);
  predecessorPolicy.baseline.sha = 'e4c7199da157446f455822ea96e812784354b1db';
  predecessorPolicy.baseline.migration_count = 359;
  predecessorPolicy.baseline.latest_migration = '20261027120000_stories_v2_safety_c1_technical_policy_prep';
  const transition = predecessorPolicy.stories_safety_c2_transition;
  assert.ok(transition, 'C2 authority must be present');
  const manifest = { identity: { approved_sha: 'a'.repeat(40) }, resources: {
    stories_safety_c2_transition: { ...transition, approved_sha: 'a'.repeat(40),
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true },
  } };
  const identity = 'public.create_story_with_media(uuid,jsonb,uuid,jsonb)';
  const helper = transition.helper_attestations.find(item => item.identity === identity);
  assert.ok(helper);
  const find = values => values.find(item => item.object?.name === 'create_story_with_media' && item.object.argument_types.length === 4);
  const pre = find(adapter.advisorExceptionsForPhase(predecessorPolicy, manifest, 'pre'));
  const post = find(adapter.advisorExceptionsForPhase(predecessorPolicy, manifest, 'post'));
  assert.notEqual(pre.attestation.definition_sha256, helper.definition_sha256);
  assert.equal(post.attestation.definition_sha256, helper.definition_sha256);
  assert.equal(post.origin.migration, '20261027191918_stories_v2_safety_c2_publish_first_async_review');
  assert.equal(post.attestation.execute.service_role, false);
  assert.equal(post.attestation.execute.authenticated, true);
  assert.equal(find(predecessorPolicy.stories_b1_transition.security_advisor.introduced_exceptions).attestation.definition_sha256,
    pre.attestation.definition_sha256);
});

test('Stories QA C1 fixed SQL preserves historical C2 bytes and reconstructs question then answer read-only', async () => {
  const adapter = await loadAdapter();
  assert.equal(sha256(adapter.STORIES_SAFETY_C2_PRE_STATE_SQL),
    'af830400c954e241081cfc9ca6988cc588462ade69f147af12ffe4591915989e');
  assert.equal(sha256(adapter.STORIES_SAFETY_C2_STATE_SQL),
    'c02cd3c076b951c0e99269082c2152bc4113017554a7a1a76951a8e30e3f2336');
  for (const sql of [adapter.STORIES_QA_C1_PRE_STATE_SQL, adapter.STORIES_QA_C1_POST_STATE_SQL,
    adapter.STORIES_SAFETY_C2_QA_STATE_SQL]) assert.equal(adapter.assertReadOnlySql(sql), true);
  assert.doesNotMatch(adapter.STORIES_QA_C1_PRE_STATE_SQL,
    /\bfrom\s+private\.story_question_answer_links\b/i);
  assert.match(adapter.STORIES_QA_C1_POST_STATE_SQL, /story_question_answer_links/);
  assert.match(adapter.STORIES_QA_C1_POST_STATE_SQL, /story_question_answer_link_required/);
  assert.match(adapter.STORIES_SAFETY_C2_QA_STATE_SQL, /x\.element->>'type'='question_answer'/);
  assert.match(adapter.STORIES_SAFETY_C2_QA_STATE_SQL,
    /\(0::bigint,x\.element->>'question'\)[\s\S]*\(1::bigint,x\.element->>'answer'\)/);
  const executable = adapter.STORIES_SAFETY_C2_QA_STATE_SQL.replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(executable, /\bprivate\.[a-z_0-9]+\s*\(/i);
});

test('Stories QA C1 selector uses observed migration inventory for installed authority without rewriting C2 history', async () => {
  const adapter = await loadAdapter();
  const policy = structuredClone(installedPolicy);
  const transition = policy.stories_qa_c1_transition;
  assert.ok(transition, 'QA C1 authority must be present');
  policy.baseline.sha = transition.baseline_sha;
  policy.baseline.migration_count = 360;
  policy.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  const attestation = { ...transition, approved_sha: 'a'.repeat(40),
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true };
  const manifest = { identity: { approved_sha: 'a'.repeat(40) }, resources: {
    migrations: [{ version: '20261029042807', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256 }],
    stories_qa_c1_transition: attestation,
  } };
  const normalizeMigrations = items => ({
    complete: true,
    count: items.length,
    items,
    latest: items.at(-1) ?? null,
    sha256: sha256(canonicalJson(items)),
  });
  const beforeItems = [
    { version: '20260901000000', name: 'add_realtime_publications' },
    { version: '20260902000000', name: 'add_realtime_publications' },
    { version: '20261027191918', name: 'stories_v2_safety_c2_publish_first_async_review' },
  ];
  const afterItems = [...beforeItems, {
    version: '20261029042807', name: 'stories_v2_qa_c1_question_answer_authority',
  }];
  const before = normalizeMigrations(beforeItems);
  const after = normalizeMigrations(afterItems);
  const pre = adapter.storiesQaC1StateRequirement(policy, manifest, 'pre', { migrations: before });
  const post = adapter.storiesQaC1StateRequirement(policy, manifest, 'post', { migrations: after });
  assert.equal(pre.installed, false);
  assert.equal(pre.query, adapter.STORIES_QA_C1_PRE_STATE_SQL);
  assert.equal(before.items.filter(item => item.name === 'add_realtime_publications').length, 2,
    'distinct historical migration versions may legitimately reuse a descriptive name');
  assert.equal(post.installed, true);
  assert.equal(post.query, adapter.STORIES_QA_C1_POST_STATE_SQL);
  assert.equal(adapter.storiesSafetyC2AuthorityForPhase(policy, manifest, 'pre', { migrations: before }).query,
    adapter.STORIES_SAFETY_C2_STATE_SQL);
  const installed = adapter.storiesSafetyC2AuthorityForPhase(policy, manifest, 'post', { migrations: after });
  assert.equal(installed.query, adapter.STORIES_SAFETY_C2_QA_STATE_SQL);
  assert.equal(installed.helpers.length, 27);
  for (const identity of transition.c2_helper_replacements) {
    assert.equal(installed.helpers.find(item => item.identity === identity)?.definition_sha256,
      transition.helper_attestations.find(item => item.identity === identity)?.definition_sha256);
  }
  const promoted = structuredClone(policy);
  promoted.baseline.sha = 'b'.repeat(40);
  promoted.baseline.migration_count = 361;
  promoted.baseline.latest_migration = '20261029042807_stories_v2_qa_c1_question_answer_authority';
  for (const phase of ['pre', 'post', 'recovery']) assert.equal(
    adapter.storiesQaC1StateRequirement(promoted, { resources: {} }, phase, { migrations: after }).installed,
    true,
  );
  assert.throws(() => adapter.storiesQaC1StateRequirement(policy, manifest, 'post', {
    migrations: normalizeMigrations([...afterItems, afterItems.at(-1)]),
  }), /INVALID_REMOTE_INVENTORY|STORIES_QA_C1_POSTCHECK_FAILED/);
  assert.throws(() => adapter.storiesQaC1StateRequirement(policy, manifest, 'post', {
    migrations: normalizeMigrations([...afterItems, {
      version: '20261029042808', name: 'stories_v2_qa_c1_question_answer_authority',
    }]),
  }), /STORIES_QA_C1_POSTCHECK_FAILED/);

  const historicalPartialFixture = {
    items: [{ version: '20261009021414', name: 'creator_premium_b5_creator_management_ux' }],
  };
  assert.equal(adapter.storiesQaC1StateRequirement(
    policy, { resources: {} }, 'recovery', { migrations: historicalPartialFixture },
  ).required, false, 'legacy partial fixtures without a QA signal remain on historical authority');
  for (const wrong of [
    { version: '20261029042807', name: 'wrong_qa_authority' },
    { version: '20261029042808', name: 'stories_v2_qa_c1_question_answer_authority' },
  ]) assert.throws(() => adapter.storiesQaC1StateRequirement(
    policy,
    { resources: {} },
    'post',
    { migrations: normalizeMigrations([...beforeItems, wrong]) },
  ), /STORIES_QA_C1_POSTCHECK_FAILED/,
  'either half of the QA migration identity must fail closed without a manifest');
  assert.throws(() => adapter.storiesQaC1StateRequirement(policy, { resources: {} }, 'recovery', {
    migrations: { items: [afterItems.at(-1)] },
  }), /INVALID_REMOTE_INVENTORY/,
  'an inventory that claims the QA migration must satisfy the complete normalized contract');
  assert.throws(() => adapter.storiesQaC1StateRequirement(policy, manifest, 'pre', {
    migrations: historicalPartialFixture,
  }), /INVALID_REMOTE_INVENTORY/,
  'an exact QA transition requires complete normalized migration evidence even before install');
  assert.throws(() => adapter.storiesQaC1StateRequirement(promoted, { resources: {} }, 'post', {
    migrations: historicalPartialFixture,
  }), /INVALID_REMOTE_INVENTORY/,
  'a promoted QA baseline requires complete normalized migration evidence');
  assert.throws(() => adapter.storiesQaC1StateRequirement(policy, { resources: {} }, 'post', {
    evidence: { adapter: { queries: [{ id: 'nelyon-stories-qa-c1-post-state-v1' }] } },
    migrations: historicalPartialFixture,
  }), /INVALID_REMOTE_INVENTORY/,
  'a QA query receipt requires complete normalized migration evidence');
});

test('Stories QA C1 advisor projection replaces exactly four public RPC identities only after install', async () => {
  const adapter = await loadAdapter();
  const policy = structuredClone(installedPolicy);
  const transition = policy.stories_qa_c1_transition;
  policy.baseline.sha = transition.baseline_sha;
  policy.baseline.migration_count = 360;
  policy.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  const manifest = { identity: { approved_sha: 'a'.repeat(40) }, resources: {
    migrations: [{ version: '20261029042807', path: transition.migration_path,
      blob: transition.migration_blob, sha256: transition.migration_sha256 }],
    stories_qa_c1_transition: { ...transition, approved_sha: 'a'.repeat(40),
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true },
  } };
  const migrationInventory = items => ({ complete: true, count: items.length, items,
    latest: items.at(-1) ?? null, sha256: sha256(canonicalJson(items)) });
  const before = adapter.advisorExceptionsForPhase(policy, manifest, 'pre', {
    migrations: migrationInventory([]),
  });
  const after = adapter.advisorExceptionsForPhase(policy, manifest, 'post', {
    migrations: migrationInventory([{
      version: '20261029042807', name: 'stories_v2_qa_c1_question_answer_authority',
    }]),
  });
  const predecessorFingerprint = transition.rpc_predecessor_exception.advisor_fingerprint;
  assert.equal(predecessorFingerprint,
    '010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14');
  assert.equal(before.filter(item => item.advisor_fingerprint === predecessorFingerprint).length, 1);
  assert.equal(after.filter(item => item.advisor_fingerprint === predecessorFingerprint).length, 1);
  assert.equal(adapter.advisorExceptionsForPhase(policy, { resources: {} }, 'post', {
    migrations: migrationInventory([]),
  })
    .some(item => item.advisor_fingerprint === predecessorFingerprint), false,
  'QA-local predecessor evidence must not rewrite the historical baseline projection');
  const byIdentity = (items, identity) => items.find(item => {
    const args = (item.object?.argument_types ?? []).join(',').replaceAll(' ', '');
    return `${item.object?.schema}.${item.object?.name}(${args})` === identity;
  });
  for (const identity of transition.rpc_replacements) {
    const oldRow = byIdentity(before, identity);
    const newRow = byIdentity(after, identity);
    assert.ok(oldRow && newRow, identity);
    assert.notEqual(oldRow.attestation.definition_sha256, newRow.attestation.definition_sha256);
    assert.equal(newRow.attestation.definition_sha256,
      transition.helper_attestations.find(item => item.identity === identity).definition_sha256);
    assert.equal(newRow.origin.migration, '20261029042807_stories_v2_qa_c1_question_answer_authority');
  }
});

test('Stories QA C1 capture refines to observed installed authority before executing fixed queries', async () => {
  const adapter = await loadAdapter();
  const controlled = structuredClone(installedPolicy);
  const transition = controlled.stories_qa_c1_transition;
  controlled.baseline.sha = transition.baseline_sha;
  controlled.baseline.migration_count = 360;
  controlled.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  const emptyManifest = manifest();
  emptyManifest.resources = { config_changed: false, function_contracts: [], functions: [], migrations: [] };
  const migrationRows = [
    { version: '20261027042552', name: 'stories_v2_interactive_b1' },
    { version: '20261027191918', name: 'stories_v2_safety_c2_publish_first_async_review' },
    { version: '20261029042807', name: 'stories_v2_qa_c1_question_answer_authority' },
  ];
  const normalizedMigrations = {
    complete: true, count: migrationRows.length, items: migrationRows, latest: migrationRows.at(-1),
    sha256: sha256(canonicalJson(migrationRows)),
  };
  const c2Authority = adapter.storiesSafetyC2AuthorityForPhase(
    controlled, emptyManifest, 'post', { migrations: normalizedMigrations },
  );
  const helperRows = c2Authority.helpers.map(item => ({ ...item, acl: [
    ...(item.execute.authenticated
      ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
      : []),
    { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ...(item.execute.service_role
      ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }]
      : []),
  ] }));
  const c2 = controlled.stories_safety_c2_transition;
  const c2State = {
    schema_version: 1, complete: true, installed: true,
    policy_id: c2.policy_artifact.policy_id, policy_artifact_sha256: c2.policy_artifact.sha256,
    control: { policy_id: c2.policy_artifact.policy_id, policy_artifact_sha256: c2.policy_artifact.sha256,
      activation: true, owner_approved_operating_model: true, owner_approved_policy: false,
      mode: 'PUBLISH_FIRST_ASYNC_REVIEW', automatic_allow_authorized: false,
      automatic_block_authorized: false, numeric_thresholds: null, historical_backfill: false },
    approved_story_rule_count: 0, passed_count: 0, policy_digest_count: 0,
    story_count: 0, safety_state_count: 0, story_inventory_sha256: '1'.repeat(64),
    safety_inventory_sha256: '2'.repeat(64), transcript_refresh_trigger_installed: true,
    trigger: controlled.stories_safety_c1_transition.trigger_attestation, helpers: helperRows,
    publication_status: { unpublished: 0, published: 0, restricted: 0, removed: 0 },
    moderation_status: { unreviewed: 0, alerted: 0, reviewed_keep: 0, reviewed_restrict: 0, reviewed_remove: 0 },
    scan_status: { queued: 0, processing: 0, completed: 0, failed: 0 },
    enabled_numeric_story_rule_count: 0, published_without_current_scan_count: 0,
    no_current_scan_count: 0, publication_metadata_count: 0,
    alert_trigger: c2.alert_trigger_attestation, initialization_trigger: c2.initialization_trigger_attestation,
    columns: c2.column_attestations,
  };
  const qaFunctions = transition.helper_attestations.map(item => ({ ...item, acl: [
    ...(item.execute.authenticated
      ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
      : []),
    { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
  ] }));
  const qaState = {
    schema_version: 1, complete: true, installed: true, initial_link_count: 0,
    functions: qaFunctions,
    relation: transition.relation_attestation,
    trigger: transition.trigger_attestation,
  };
  const b1State = {
    schema_version: 1, complete: true, infrastructure_installed: true,
    owner_approved_policy: false, activation: false, mode: 'fail_closed_review',
    story_count: 0, direct_story_count: 0,
    safety_state_counts: { blocked: 0, passed: 0, pending: 0, review: 0 },
    complete_evidence_count: 0, complete_evidence_non_review_count: 0,
    incomplete_evidence_non_pending_count: 0, complete_evidence_pass_count: 0,
    fabricated_pass_count: 0, relations: STORY_B1_RELATIONS,
  };
  const exceptions = adapter.advisorExceptionsForPhase(controlled, emptyManifest, 'post', {
    request: request(), migrations: normalizedMigrations,
  });
  const rpcRows = exceptions.filter(item => Array.isArray(item.object?.argument_types)).map(item => ({
    schema: item.object.schema, name: item.object.name,
    identity_arguments: item.object.identity_arguments ?? item.object.argument_types.join(', '),
    argument_types: item.object.argument_types, security_definer: item.attestation.security_definer,
    owner: item.attestation.owner, search_path: item.attestation.search_path,
    acl: item.attestation.acl, execute: item.attestation.execute,
    definition: `CREATE FUNCTION ${item.object.schema}.${item.object.name}(${item.object.argument_types.join(', ')}) RETURNS jsonb SECURITY DEFINER`,
  }));
  const calls = [];
  const base = successfulFetch(calls, {
    rpcSecurity: rpcRows,
    finance: financeSnapshot({
      policy: {
        purchase_enabled: true, subscription_enabled: true, refunds_enabled: true,
        platform_fee_bps: 2000, policy_version: 'creator-premium-f4-general-v1',
      },
    }),
    backups: [completedPhysicalBackup({
      id: '2026-10-29T11:45:00.000Z',
      inserted_at: '2026-10-29T11:45:00.000Z',
    })],
  });
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/database/migrations')) {
      calls.push({ url: String(url), options });
      return jsonResponse(migrationRows);
    }
    if (pathname.endsWith('/database/query/read-only')) {
      const body = JSON.parse(options.body);
      if (body.query === adapter.STORIES_B1_POST_STATE_SQL) {
        calls.push({ url: String(url), options });
        return jsonResponse([{ snapshot: b1State }], 201);
      }
      if (body.query === adapter.STORIES_SAFETY_C2_QA_STATE_SQL) {
        calls.push({ url: String(url), options });
        return jsonResponse([{ snapshot: c2State }], 201);
      }
      if (body.query === adapter.STORIES_QA_C1_POST_STATE_SQL) {
        calls.push({ url: String(url), options });
        return jsonResponse([{ snapshot: qaState }], 201);
      }
    }
    return base(url, options);
  };
  const captured = await adapter.captureProductionSnapshot({
    phase: 'post', policy: controlled, request: request(), manifest: emptyManifest,
    token: 'private-read-token', fetchImpl, observedAt: '2026-10-29T12:00:00.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(captured.stories_qa_c1_state.installed, true);
  assert.ok(captured.adapter.queries.some(item => item.id === 'nelyon-stories-qa-c1-post-state-v1'
    && item.sha256 === sha256(adapter.STORIES_QA_C1_POST_STATE_SQL)));
  assert.ok(captured.adapter.queries.some(item => item.id === 'nelyon-stories-safety-c2-qa-state-v1'
    && item.sha256 === sha256(adapter.STORIES_SAFETY_C2_QA_STATE_SQL)));
  assert.ok(!calls.some(call => call.options?.body
    && JSON.parse(call.options.body).query === adapter.STORIES_QA_C1_PRE_STATE_SQL));
  assert.equal(adapter.validateStoriesQaC1CapturedEvidence(captured, controlled, emptyManifest, 'post', {
    request: request(), migrations: captured.migrations,
  }), true);
  for (const mutate of [
    value => {
      value.migrations.items.at(-1).name = 'wrong_qa_authority';
      value.migrations.sha256 = sha256(canonicalJson(value.migrations.items));
    },
    value => {
      value.adapter.queries.find(item => item.id === 'nelyon-stories-qa-c1-post-state-v1').sha256 = '0'.repeat(64);
    },
  ]) {
    const hostile = structuredClone(captured);
    mutate(hostile);
    resignEvidence(hostile);
    assert.throws(() => adapter.validateStoriesQaC1CapturedEvidence(
      hostile, controlled, emptyManifest, 'post', { request: request(), migrations: hostile.migrations },
    ), /STORIES_QA_C1_POSTCHECK_FAILED/);
  }

  const asAdvisorRows = exceptions => exceptions.map(exception => ({
    fingerprint: exception.advisor_fingerprint,
    level: exception.advisor_severity,
    resource_kind: exception.advisor_type,
  }));
  const unrelatedFinding = {
    fingerprint: '4'.repeat(64), level: 'WARN', resource_kind: 'unrelated_provider_finding',
  };
  const b1Findings = asAdvisorRows(controlled.stories_b1_transition.security_advisor.introduced_exceptions);
  const qaFindings = adapter.normalizeSecurityAdvisors({ lints: storiesQaC1ProviderLints() }).items;
  const setAdvisors = (value, items) => {
    const sorted = [...items].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    value.cron_security.advisors = {
      complete: true, count: sorted.length, items: sorted, sha256: sha256(canonicalJson(sorted)),
    };
  };
  const expectedHistoricalFindings = [
    unrelatedFinding,
    ...controlled.stories_b1_transition.security_advisor.removed_findings.map(item => ({
      fingerprint: item.fingerprint, level: item.level, resource_kind: item.resource_kind,
    })),
  ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const expectedHistoricalCronDigest = sha256(canonicalJson({
    complete: true,
    cron: [],
    security_findings: expectedHistoricalFindings,
  }));
  const installedQaEvidence = structuredClone(captured);
  setAdvisors(installedQaEvidence, [...b1Findings, ...qaFindings, unrelatedFinding]);
  assert.equal(adapter.buildProductionBaselineDigests({
    evidence: installedQaEvidence, policy: controlled, managedFunctions: ['content-safety-scan'],
  }).cron_security, expectedHistoricalCronDigest,
  'installed QA projection removes exactly its three findings and reconstructs B1 history');

  const preQaEvidence = structuredClone(captured);
  preQaEvidence.migrations.items = migrationRows.slice(0, -1);
  preQaEvidence.migrations.count = preQaEvidence.migrations.items.length;
  preQaEvidence.migrations.latest = preQaEvidence.migrations.items.at(-1);
  preQaEvidence.migrations.sha256 = sha256(canonicalJson(preQaEvidence.migrations.items));
  delete preQaEvidence.stories_qa_c1_state;
  const preQaC2Authority = adapter.storiesSafetyC2AuthorityForPhase(
    controlled, emptyManifest, 'post', { migrations: preQaEvidence.migrations },
  );
  preQaEvidence.stories_safety_c2_state.helpers = preQaC2Authority.helpers.map(item => ({
    ...item,
    acl: [
      ...(item.execute.authenticated
        ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
        : []),
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(item.execute.service_role
        ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }]
        : []),
    ],
  }));
  delete preQaEvidence.stories_safety_c2_state.sha256;
  setAdvisors(preQaEvidence, [...b1Findings, unrelatedFinding]);
  const policyWithoutQaSuccessor = structuredClone(controlled);
  delete policyWithoutQaSuccessor.stories_qa_c1_transition;
  assert.equal(adapter.buildProductionBaselineDigests({
    evidence: preQaEvidence, policy: controlled, managedFunctions: ['content-safety-scan'],
  }).cron_security, expectedHistoricalCronDigest);
  assert.equal(adapter.buildProductionBaselineDigests({
    evidence: preQaEvidence, policy: policyWithoutQaSuccessor,
    managedFunctions: ['content-safety-scan'],
  }).cron_security, expectedHistoricalCronDigest,
  'future QA policy bytes cannot change the historical B1/C2 baseline projection');

  const predecessorFinding = adapter.normalizeSecurityAdvisors({ lints: [{
    name: 'authenticated_security_definer_function_executable',
    level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
    metadata: {
      schema: 'public', name: 'create_story_from_content', language: 'plpgsql',
      arguments: 'p_video_id uuid, p_composition jsonb, p_client_story_id uuid',
      security_definer: true,
    },
  }] }).items[0];
  const predecessorVisible = structuredClone(preQaEvidence);
  setAdvisors(predecessorVisible, [...b1Findings, unrelatedFinding, predecessorFinding]);
  const expectedWithPredecessor = [...expectedHistoricalFindings, predecessorFinding]
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  assert.equal(adapter.buildProductionBaselineDigests({
    evidence: predecessorVisible, policy: controlled, managedFunctions: ['content-safety-scan'],
  }).cron_security, sha256(canonicalJson({
    complete: true, cron: [], security_findings: expectedWithPredecessor,
  })), 'the pre-existing three-argument wrapper finding remains visible in pre-QA baselines');

  const promoted = structuredClone(controlled);
  promoted.baseline.sha = 'b'.repeat(40);
  promoted.baseline.migration_count = migrationRows.length;
  promoted.baseline.latest_migration = '20261029042807_stories_v2_qa_c1_question_answer_authority';
  promoted.baseline.blocked_resources = [];
  promoted.supabase.managed_functions = ['content-safety-scan'];
  promoted.supabase.expected_remote_function_count = 1;
  const promotedPre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: promoted, request: request(), manifest: emptyManifest,
    token: 'private-read-token', fetchImpl, observedAt: '2026-10-29T12:00:30.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(promotedPre, adapter.advisorExceptionsForPhase(
    promoted, emptyManifest, 'pre', { request: request(), migrations: promotedPre.migrations },
  ));
  const promotedDigests = adapter.buildProductionBaselineDigests({ evidence: promotedPre, policy: promoted });
  assert.match(promotedDigests.migrations, /^[a-f0-9]{64}$/);
  assert.match(promotedDigests.cron_security, /^[a-f0-9]{64}$/);
  promoted.baseline.evidence_digests = promotedDigests;
  assert.equal(adapter.verifyProductionPreSnapshot({
    pre: promotedPre, policy: promoted, request: request(), manifest: emptyManifest,
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'REMOTE_BASELINE_VERIFIED');
  const promotedPost = await adapter.captureProductionSnapshot({
    phase: 'post', policy: promoted, request: request(), manifest: emptyManifest,
    token: 'private-read-token', fetchImpl, observedAt: '2026-10-29T12:00:45.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(promotedPost, adapter.advisorExceptionsForPhase(
    promoted, emptyManifest, 'post', { request: request(), migrations: promotedPost.migrations },
  ));
  assert.equal(adapter.verifyProductionSnapshotPair({
    pre: promotedPre, post: promotedPost, policy: promoted, request: request(), manifest: emptyManifest,
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'REMOTE_POSTCHECK_VERIFIED');

  const recoveryRequest = {
    ...request(),
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: '99900011122',
  };
  const recoveryManifest = structuredClone(emptyManifest);
  recoveryManifest.identity.mode = 'postcheck_recovery';
  const recoveryPolicy = structuredClone(controlled);
  recoveryPolicy.baseline.migration_count = 2;
  recoveryPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson([
    '20261027042552_stories_v2_interactive_b1',
    '20261027191918_stories_v2_safety_c2_publish_first_async_review',
  ]));
  recoveryPolicy.postcheck_recovery.approved_sources.push({
    run_id: recoveryRequest.recoverySourceRunId,
    repository: recoveryPolicy.repository,
    mutation_status: 'completed',
    expected_migrations: [{
      blob: transition.migration_blob,
      name: '20261029042807_stories_v2_qa_c1_question_answer_authority',
    }],
    expected_migration_count: 3,
    expected_latest_migration: '20261029042807_stories_v2_qa_c1_question_answer_authority',
    edge_functions: [],
    productive_resources: [
      'migration:20261029042807_stories_v2_qa_c1_question_answer_authority',
    ],
  });
  assert.equal(adapter.storiesQaC1StateRequirement(
    recoveryPolicy, recoveryManifest, 'recovery', {
      request: recoveryRequest, migrations: normalizedMigrations,
    },
  ).recovery, true);
  const wrongRecoveryCases = [
    {
      request: { ...recoveryRequest, recoverySourceRunId: 'unknown-run' },
      manifest: recoveryManifest,
      migrations: normalizedMigrations,
    },
    {
      request: { ...recoveryRequest, scopeConfirmation: 'WRONG_SCOPE' },
      manifest: recoveryManifest,
      migrations: normalizedMigrations,
    },
    {
      request: recoveryRequest,
      manifest: { ...recoveryManifest, resources: {
        ...recoveryManifest.resources,
        migrations: [{ version: '20261029042807' }],
      } },
      migrations: normalizedMigrations,
    },
    { request: recoveryRequest, manifest: recoveryManifest, migrations: undefined },
    {
      request: recoveryRequest,
      manifest: recoveryManifest,
      migrations: { ...normalizedMigrations, sha256: '0'.repeat(64) },
    },
  ];
  for (const invalid of wrongRecoveryCases) assert.throws(
    () => adapter.storiesQaC1StateRequirement(
      recoveryPolicy, invalid.manifest, 'recovery', {
        request: invalid.request, migrations: invalid.migrations,
      },
    ),
    /INVALID_REMOTE_INVENTORY|STORIES_QA_C1_POSTCHECK_FAILED/,
  );
  const recovery = await adapter.captureProductionSnapshot({
    phase: 'recovery', policy: recoveryPolicy, request: recoveryRequest, manifest: recoveryManifest,
    token: 'private-read-token', fetchImpl, observedAt: '2026-10-29T12:01:00.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(recovery, adapter.advisorExceptionsForPhase(
    recoveryPolicy, recoveryManifest, 'recovery', { request: recoveryRequest, migrations: recovery.migrations },
  ));
  assert.equal(adapter.verifyProductionRecoverySnapshot({
    recovery, policy: recoveryPolicy, request: recoveryRequest, manifest: recoveryManifest,
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'RECOVERY_SNAPSHOT_VERIFIED');
  for (const mutate of [
    value => { value.stories_qa_c1_state.functions[0].owner = 'authenticated'; },
    value => { value.stories_qa_c1_state.relation.force_rls = false; },
    value => { value.stories_qa_c1_state.trigger.enabled = 'D'; },
    value => {
      value.adapter.queries.find(item => item.id === 'nelyon-stories-safety-c2-qa-state-v1').sha256
        = '0'.repeat(64);
    },
  ]) {
    const hostile = structuredClone(recovery);
    mutate(hostile);
    resignEvidence(hostile);
    assert.throws(() => adapter.verifyProductionRecoverySnapshot({
      recovery: hostile, policy: recoveryPolicy, request: recoveryRequest, manifest: recoveryManifest,
      adapterSourceSha256: '6'.repeat(64),
    }), /INVALID_SNAPSHOT_IDENTITY|STORIES_QA_C1_POSTCHECK_FAILED|STORIES_SAFETY_C2_POSTCHECK_FAILED/);
  }
});

test('Stories Safety C2 transition rejects sanctions, fabricated PASS, stale grants and historical publication', async () => {
  const adapter = await loadAdapter();
  const c1 = installedPolicy.stories_safety_c1_transition;
  const transition = installedPolicy.stories_safety_c2_transition;
  assert.ok(transition, 'C2 authority must be present');
  const aclHelpers = items => items.map(item => ({ ...item, acl: [
    ...(item.execute.authenticated ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }] : []),
    { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ...(item.execute.service_role ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
  ] }));
  const pre = {
    schema_version: 1, complete: true, installed: true,
    policy_id: c1.policy_artifact.policy_id, policy_artifact_sha256: c1.policy_artifact.sha256,
    control: { policy_artifact_sha256: c1.policy_artifact.sha256,
      activation: false, owner_approved_policy: false, auto_publish_enabled: false,
      mode: 'fail_closed_review', automatic_allow_authorized: false, automatic_block_authorized: false },
    approved_story_rule_count: 0, passed_count: 0, policy_digest_count: 0,
    story_count: 2, safety_state_count: 2,
    story_inventory_sha256: '1'.repeat(64), safety_inventory_sha256: '2'.repeat(64),
    transcript_refresh_trigger_installed: true, trigger: c1.trigger_attestation,
    helpers: aclHelpers(c1.helper_attestations),
  };
  const post = {
    ...pre, policy_id: transition.policy_artifact.policy_id,
    policy_artifact_sha256: transition.policy_artifact.sha256,
    control: { policy_artifact_sha256: transition.policy_artifact.sha256,
      policy_id: transition.policy_artifact.policy_id,
      activation: true, owner_approved_policy: false, owner_approved_operating_model: true,
      mode: 'PUBLISH_FIRST_ASYNC_REVIEW', automatic_allow_authorized: false, automatic_block_authorized: false,
      numeric_thresholds: null, historical_backfill: false },
    helpers: aclHelpers(transition.helper_attestations),
    publication_status: { unpublished: 2, published: 0, restricted: 0, removed: 0 },
    moderation_status: { unreviewed: 2, alerted: 0, reviewed_keep: 0, reviewed_restrict: 0, reviewed_remove: 0 },
    scan_status: { queued: 2, processing: 0, completed: 0, failed: 0 },
    enabled_numeric_story_rule_count: 0, published_without_current_scan_count: 0,
    no_current_scan_count: 0, publication_metadata_count: 0,
    alert_trigger: transition.alert_trigger_attestation,
    initialization_trigger: transition.initialization_trigger_attestation,
    columns: transition.column_attestations,
  };
  assert.equal(adapter.validateStoriesSafetyC2StateTransition(pre, post, transition, c1), true);
  assert.equal(adapter.validateStoriesSafetyC2InstalledState(post, transition).installed, true);
  for (const mutate of [
    value => { value.control.automatic_allow_authorized = true; },
    value => { value.control.automatic_block_authorized = true; },
    value => { value.control.owner_approved_operating_model = false; },
    value => { value.control.owner_approved_policy = true; },
    value => { value.control.numeric_thresholds = { unsafe: 0.9 }; },
    value => { value.approved_story_rule_count = 1; },
    value => { value.enabled_numeric_story_rule_count = 1; },
    value => { value.passed_count = 1; },
    value => { value.published_without_current_scan_count = 1; },
    value => { value.publication_metadata_count = 1; },
    value => { value.alert_trigger.enabled = 'D'; },
    value => { value.initialization_trigger.enabled = 'D'; },
    value => { value.columns[0].not_null = !value.columns[0].not_null; },
    value => { value.columns[0].default = "'published'::text"; },
    value => { value.publication_status = { unpublished: 1, published: 1, restricted: 0, removed: 0 }; },
    value => { value.moderation_status.reviewed_keep = 1; value.moderation_status.unreviewed = 1; },
    value => { value.scan_status.unknown = 1; },
    value => { value.story_inventory_sha256 = '3'.repeat(64); },
    value => { value.safety_inventory_sha256 = '3'.repeat(64); },
    value => { value.helpers[0].owner = 'authenticated'; },
    value => { value.helpers[0].search_path = ['search_path=public']; },
    value => { value.helpers[0].acl.push({ grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }); },
    value => { value.helpers[0].definition_sha256 = '0'.repeat(64); },
  ]) {
    const hostile = structuredClone(post);
    mutate(hostile);
    assert.throws(() => adapter.validateStoriesSafetyC2StateTransition(pre, hostile, transition, c1),
      /STORIES_SAFETY_C2_POSTCHECK_FAILED/);
  }
});

test('Stories Safety C1 snapshot attests inactive controls, private helpers, and unchanged inventories', async () => {
  const adapter = await loadAdapter();
  assert.equal(adapter.assertReadOnlySql(adapter.STORIES_SAFETY_C1_STATE_SQL), true);
  assert.match(adapter.STORIES_SAFETY_C1_STATE_SQL,
    /where rule\.approval_state='approved'\s+and rule\.scopes/);
  assert.doesNotMatch(adapter.STORIES_SAFETY_C1_STATE_SQL,
    /rule\.approval_state='approved'\s+and rule\.enabled/);
  const transition = installedPolicy.stories_safety_c1_transition;
  const helperRows = transition.helper_attestations.map(item => ({
    ...item,
    owner: 'postgres',
    security_definer: true,
    search_path: ['search_path=""'],
    execute: {
      anon: false,
      authenticated: item.identity === 'private.story_can_access(uuid,boolean)',
      public: false,
      service_role: false,
    },
    acl: [
      ...(item.identity === 'private.story_can_access(uuid,boolean)'
        ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
        : []),
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ],
  }));
  const pre = adapter.normalizeStoriesSafetyC1State({
    schema_version: 1,
    complete: true,
    installed: false,
    policy_id: null,
    policy_artifact_sha256: null,
    control: null,
    approved_story_rule_count: 0,
    passed_count: 0,
    policy_digest_count: 0,
    story_count: 0,
    safety_state_count: 0,
    story_inventory_sha256: '1'.repeat(64),
    safety_inventory_sha256: '2'.repeat(64),
    transcript_refresh_trigger_installed: false,
    trigger: null,
    helpers: [],
  });
  const post = adapter.normalizeStoriesSafetyC1State({
    schema_version: 1,
    complete: true,
    installed: true,
    policy_id: transition.policy_artifact.policy_id,
    policy_artifact_sha256: transition.policy_artifact.sha256,
    control: {
      policy_artifact_sha256: transition.policy_artifact.sha256,
      activation: false,
      owner_approved_policy: false,
      auto_publish_enabled: false,
      mode: 'fail_closed_review',
      automatic_allow_authorized: false,
      automatic_block_authorized: false,
    },
    approved_story_rule_count: 0,
    passed_count: 0,
    policy_digest_count: 0,
    story_count: 0,
    safety_state_count: 0,
    story_inventory_sha256: pre.story_inventory_sha256,
    safety_inventory_sha256: pre.safety_inventory_sha256,
    transcript_refresh_trigger_installed: true,
    trigger: transition.trigger_attestation,
    helpers: helperRows,
  });
  assert.equal(adapter.validateStoriesSafetyC1StateTransition(pre, post, transition), true);

  for (const mutate of [
    value => { value.control.activation = true; },
    value => { value.control.owner_approved_policy = true; },
    value => { value.passed_count = 1; },
    value => { value.policy_digest_count = 1; },
    value => { value.approved_story_rule_count = 1; },
    value => { value.story_inventory_sha256 = '3'.repeat(64); },
    value => { value.transcript_refresh_trigger_installed = false; },
    value => { value.helpers[0].owner = 'authenticated'; },
    value => { value.helpers[0].definition_sha256 = '0'.repeat(64); },
    value => { value.helpers[0].execute.authenticated = true; },
  ]) {
    const hostile = structuredClone(post);
    delete hostile.sha256;
    mutate(hostile);
    assert.throws(() => adapter.validateStoriesSafetyC1StateTransition(
      pre,
      adapter.normalizeStoriesSafetyC1State(hostile),
      transition,
    ), /STORIES_SAFETY_C1_POSTCHECK_FAILED/);
  }
});

test('Stories B1 advisor transition is phase-bound to exact introduced and replaced findings', async () => {
  const adapter = await loadAdapter();
  const transition = installedPolicy.stories_b1_transition;
  const phasePolicy = structuredClone(installedPolicy);
  phasePolicy.baseline.sha = transition.baseline_sha;
  phasePolicy.baseline.migration_count = 357;
  phasePolicy.baseline.latest_migration = '20261026120000_live_battles_final_c1';
  const storiesManifest = manifest();
  storiesManifest.identity.approved_sha = 'b'.repeat(40);
  storiesManifest.resources.stories_b1_transition = {
    ...structuredClone(transition),
    approved_sha: storiesManifest.identity.approved_sha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  };
  storiesManifest.resources.migrations = [{
    path: transition.migration_path,
    version: '20261027042552',
    blob: transition.migration_blob,
    sha256: transition.migration_sha256,
  }];
  storiesManifest.resources.functions = transition.functions.map(item => item.name);
  storiesManifest.resources.function_contracts = transition.functions.map(item => ({
    name: item.name,
    entrypoint: `supabase/functions/${item.name}/index.ts`,
    import_map: null,
    verify_jwt: item.verify_jwt,
    source_changed: true,
    source_files: [],
    source_sha256: item.source_sha256,
  }));
  const pre = adapter.advisorExceptionsForPhase(phasePolicy, storiesManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(phasePolicy, storiesManifest, 'post');
  const preFingerprints = new Set(pre.map(item => item.advisor_fingerprint));
  const introduced = post.filter(item => !preFingerprints.has(item.advisor_fingerprint));
  assert.deepEqual(introduced, transition.security_advisor.introduced_exceptions);
  assert.equal(introduced.length, 15);

  const retained = [{ fingerprint: '1'.repeat(64), level: 'WARN', resource_kind: 'existing' }];
  const removed = transition.security_advisor.removed_findings.map(item => ({
    fingerprint: item.fingerprint,
    level: item.level,
    resource_kind: item.resource_kind,
  }));
  const added = introduced.map(item => ({
    fingerprint: item.advisor_fingerprint,
    level: item.advisor_severity,
    resource_kind: item.advisor_type,
  }));
  assert.equal(adapter.validateSecurityAdvisorDelta(
    [...retained, ...removed],
    [...retained, ...added],
    introduced,
    transition.security_advisor.removed_findings,
  ), true);
  const wrongRemoved = structuredClone(transition.security_advisor.removed_findings);
  wrongRemoved[0].level = 'INFO';
  assert.throws(() => adapter.validateSecurityAdvisorDelta(
    [...retained, ...removed], [...retained, ...added], introduced, wrongRemoved,
  ), /REMOTE_POSTCHECK_FAILED/);
});

test('Stories B1 baseline projection restores replaced findings and requires complete fail-closed authority', async () => {
  const adapter = await loadAdapter();
  const controlled = structuredClone(installedPolicy);
  controlled.baseline.latest_migration = '20261027042552_stories_v2_interactive_b1';
  controlled.baseline.migration_count = 1;
  controlled.baseline.blocked_resources = [];
  controlled.supabase.managed_functions = [];
  controlled.security_advisor.exceptions = [];
  const transition = controlled.stories_b1_transition;
  const migrationItems = [{
    version: '20261027042552',
    name: 'stories_v2_interactive_b1',
  }];
  const retained = {
    fingerprint: '1'.repeat(64),
    level: 'WARN',
    resource_kind: 'existing',
  };
  const introduced = transition.security_advisor.introduced_exceptions.map(exception => ({
    fingerprint: exception.advisor_fingerprint,
    level: exception.advisor_severity,
    resource_kind: exception.advisor_type,
  }));
  const advisorItems = [retained, ...introduced]
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const storiesState = adapter.normalizeStoriesB1State({
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
    relations: STORY_B1_RELATIONS,
  });
  const rpcItems = transition.security_advisor.introduced_exceptions
    .filter(exception => Array.isArray(exception.object.argument_types))
    .map(exception => ({
      schema: exception.object.schema,
      name: exception.object.name,
      argument_types: exception.object.argument_types,
    }));
  const evidence = {
    migrations: {
      complete: true,
      count: migrationItems.length,
      items: migrationItems,
      latest: migrationItems[0],
      sha256: sha256(canonicalJson(migrationItems)),
    },
    functions: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
    cron_security: {
      cron: cronSnapshot(),
      advisors: {
        complete: true,
        count: advisorItems.length,
        items: advisorItems,
        sha256: sha256(canonicalJson(advisorItems)),
      },
    },
    finance: financeSnapshot({
      policy: {
        ...controlled.supabase.finance_policy,
        policy_version: 'creator-premium-f4-general-v1',
      },
    }),
    rpc_security: { complete: true, count: rpcItems.length, items: rpcItems,
      sha256: sha256(canonicalJson(rpcItems)) },
    stories_b1_state: storiesState,
  };
  const expectedHistoricalAdvisors = [
    retained,
    ...transition.security_advisor.removed_findings.map(item => ({
      fingerprint: item.fingerprint,
      level: item.level,
      resource_kind: item.resource_kind,
    })),
  ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const digests = adapter.buildProductionBaselineDigests({ evidence, policy: controlled });
  assert.equal(digests.cron_security, sha256(canonicalJson({
    complete: true,
    cron: [],
    security_findings: expectedHistoricalAdvisors,
  })));

  const returnedRemovedFinding = structuredClone(evidence);
  const removedFinding = transition.security_advisor.removed_findings[0];
  returnedRemovedFinding.cron_security.advisors.items.push({
    fingerprint: removedFinding.fingerprint,
    level: removedFinding.level,
    resource_kind: removedFinding.resource_kind,
  });
  returnedRemovedFinding.cron_security.advisors.items.sort((left, right) => (
    left.fingerprint.localeCompare(right.fingerprint)
  ));
  returnedRemovedFinding.cron_security.advisors.count =
    returnedRemovedFinding.cron_security.advisors.items.length;
  returnedRemovedFinding.cron_security.advisors.sha256 = sha256(canonicalJson(
    returnedRemovedFinding.cron_security.advisors.items,
  ));
  assert.throws(() => adapter.buildProductionBaselineDigests({
    evidence: returnedRemovedFinding,
    policy: controlled,
  }), /REMOTE_BASELINE_MISMATCH/);

  const missingRpc = structuredClone(evidence);
  missingRpc.rpc_security.items.pop();
  assert.throws(() => adapter.buildProductionBaselineDigests({ evidence: missingRpc, policy: controlled }),
    /REMOTE_BASELINE_MISMATCH/);

  const unsafeRelation = structuredClone(evidence);
  unsafeRelation.stories_b1_state.relations[0].force_rls = false;
  assert.throws(() => adapter.buildProductionBaselineDigests({ evidence: unsafeRelation, policy: controlled }),
    /STORIES_B1_POSTCHECK_FAILED|REMOTE_BASELINE_MISMATCH/);

  const missingState = structuredClone(evidence);
  delete missingState.stories_b1_state;
  assert.throws(() => adapter.buildProductionBaselineDigests({ evidence: missingState, policy: controlled }),
    /STORIES_B1_POSTCHECK_FAILED|REMOTE_BASELINE_MISMATCH/);
});

test('F3 disposable catalog verifies exact authority and detects real PostgreSQL security drift', {
  skip: process.env.RUN_F3_GOVERNANCE_LOCAL !== '1', timeout: 120000,
}, async t => {
  const adapter = await loadAdapter();
  const db = `premium_f3_governance_${process.pid}_${Date.now()}`;
  assert.match(db, /^premium_f3_governance_[0-9]+_[0-9]+$/);
  const docker = args => execFileSync('docker', ['exec','-i','nelyon-ads-v2-d-compile',...args], {encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const sql = input => execFileSync('docker',['exec','-i','nelyon-ads-v2-d-compile','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',db,'-At'],
    {input,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
  const deniedSql = (input, expected) => {
    let failure;
    try { sql(input); } catch (error) { failure = error; }
    assert.ok(failure, 'negative PostgreSQL authorization probe unexpectedly succeeded');
    const diagnostic = `${failure.message ?? ''}\n${failure.stderr ?? ''}`;
    assert.match(diagnostic, expected);
    assert.doesNotMatch(diagnostic, /does not exist|syntax error|deadlock detected|statement timeout/i,
      'negative probe failed because its disposable fixture was broken');
  };
  try {
    createPreF3GovernanceDatabase({ docker, sql, db });
    const raw = JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL));
    sql([...raw.relations.filter(r=>r.authority.owner==='supabase_admin').map(r=>`alter table ${r.identity} owner to postgres;`),
      ...raw.functions.filter(r=>r.authority.owner==='supabase_admin').map(r=>`alter function ${r.identity} owner to postgres;`)].join('\n'));
    const pre=adapter.normalizeFinanceAuthority(JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL)),'legacy');
    assert.equal(adapter.validateFinanceAuthority(pre,policy,'legacy'),true);
    const captureActualAuthority = async phase => {
      const m = f3FoundationManifest();
      const items = [{version:'20261024173500',name:'creator_premium_f2_complete_monetization'},
        ...(phase==='post'?[{version:'20261025011000',name:'creator_premium_f3_bounded_financial_activation'}]:[])];
      const rpcSecurity=adapter.advisorExceptionsForPhase(policy,m,phase).filter(e=>Array.isArray(e.object.argument_types))
        .map(e=>({...e.object,...e.attestation,definition:`CREATE FUNCTION public.${e.object.name}()`}))
        .map(({definition_sha256:ignored,...row})=>row);
      const fallback=successfulFetch([],{rpcSecurity});
      const fetchImpl=async(url,options)=>{
        if(new URL(url).pathname.endsWith('/database/migrations')) return jsonResponse(items);
        if(options?.method==='POST') {
          const body=JSON.parse(options.body);
          if(body.query===adapter.FINANCE_AUTHORITY_SQL) return jsonResponse([{snapshot:JSON.parse(sql(body.query))}],201);
          if(body.query.includes("'acquisition_exposure_bdag'")) {
            let query=body.query;
            for(const [i,value] of body.parameters.entries()) query=query.replaceAll(`$${i+1}`,`'${value.replaceAll("'","''")}'`);
            return jsonResponse([{snapshot:JSON.parse(sql(query))}],201);
          }
        }
        return fallback(url,options);
      };
      const result=await adapter.captureProductionSnapshot({phase,policy,request:request(),manifest:m,
        token:'local-never-retained',fetchImpl,observedAt:'2026-10-12T12:00:01.000Z',adapterSourceSha256:'6'.repeat(64)});
      assert.equal(result.requests.length,11);
      assert.equal(result.finance_authority.phase,phase==='pre'?'legacy':'f3_foundation');
      assert.equal(result.finance_facts.authorizations.length,0);
      assert.doesNotMatch(JSON.stringify(result),/local-never-retained|CREATE FUNCTION/);
    };
    await captureActualAuthority('pre');
    sql(f3MigrationSql());
    const rawPost=JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL));
    const post=adapter.normalizeFinanceAuthority(rawPost,'f3_foundation');
    assert.equal(adapter.validateFinanceAuthority(post,policy,'f3_foundation'),true);
    const authorityAtSearchPath = searchPath => JSON.parse(sql(`begin;
      set local search_path = ${searchPath};
      ${adapter.FINANCE_AUTHORITY_SQL}
      rollback;`));
    const replayPathAuthority = authorityAtSearchPath('"$user", public, auth, extensions');
    const productionPathAuthority = authorityAtSearchPath('"$user", public, extensions');
    assert.deepEqual(replayPathAuthority, productionPathAuthority,
      'finance authority must not inherit the caller search_path');
    const authorizationConstraints = productionPathAuthority.relations.find(row =>
      row.identity === 'private.creator_premium_finance_authorizations').authority.constraints;
    assert.match(authorizationConstraints.find(row =>
      row[0] === 'creator_premium_finance_authorizations_buyer_id_fkey')[5],
    /REFERENCES auth\.users\(id\)/);
    assert.match(authorizationConstraints.find(row =>
      row[0] === 'creator_premium_finance_authorizations_creator_id_fkey')[5],
    /REFERENCES auth\.users\(id\)/);
    assert.deepEqual(pre.legacy_relations,post.legacy_relations);
    assert.deepEqual(pre.legacy_functions,post.legacy_functions);
    await captureActualAuthority('post');
    const facts=JSON.parse(sql(adapter.FINANCE_FACTS_F3_SQL.replaceAll('$1', "'local-release'").replaceAll('$2', "'local-run'")));
    assert.equal(adapter.validateFinanceFacts(facts,'f3_foundation'),facts);
    const disableForeignKeyTrigger = (source, target, side) => `do $$ declare enforcement record; begin
      select namespace.nspname schema_name,relation.relname relation_name,trigger.tgname trigger_name
      into strict enforcement from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_trigger trigger on trigger.tgconstraint=constraint_row.oid
      join pg_catalog.pg_class relation on relation.oid=trigger.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where constraint_row.contype='f' and constraint_row.conrelid='${source}'::regclass
        and constraint_row.confrelid='${target}'::regclass and trigger.tgisinternal
        and trigger.tgrelid=constraint_row.${side === 'referencing' ? 'conrelid' : 'confrelid'}
      order by trigger.tgtype limit 1;
      execute pg_catalog.format('alter table %I.%I disable trigger %I',enforcement.schema_name,
        enforcement.relation_name,enforcement.trigger_name);
    end $$;`;
    const projectionDefinition=rawPost.functions.find(row=>row.identity===
      'private.creator_premium_subscriptions_projection_f3_v1(boolean, timestamp with time zone, uuid, integer)').authority.definition;
    assert.match(projectionDefinition,/case when item\.access_active\s+then/);
    const staleProjection=projectionDefinition.replace(/case when item\.access_active\s+then/,
      'case when item.access_active and not p_legacy\n              then');
    assert.notEqual(staleProjection,projectionDefinition);
    const mutations = [
      ['stale pre-compatibility projection',`${staleProjection};`],
      ['disabled referencing FK enforcement trigger',disableForeignKeyTrigger('private.creator_premium_purchase_receipts','private.creator_premium_finance_authorizations','referencing')],
      ['disabled referenced FK enforcement trigger',disableForeignKeyTrigger('private.creator_premium_purchase_receipts','private.creator_premium_finance_authorizations','referenced')],
      ['disabled external referenced FK enforcement trigger',disableForeignKeyTrigger('private.creator_premium_finance_authorizations','auth.users','referenced')],
      ['missing OFF guard','alter table private.creator_premium_finance_policy drop constraint creator_premium_finance_policy_f3_foundation_off_check;'],
      ['unvalidated OFF guard',`alter table private.creator_premium_finance_policy drop constraint creator_premium_finance_policy_f3_foundation_off_check;
        alter table private.creator_premium_finance_policy add constraint creator_premium_finance_policy_f3_foundation_off_check
        ${rawPost.relations.find(r=>r.identity==='private.creator_premium_finance_policy').authority.constraints.find(c=>c[0]==='creator_premium_finance_policy_f3_foundation_off_check')[5]} not valid;`],
      ['disabled insert guard','alter table private.creator_premium_finance_authorizations disable trigger creator_premium_finance_auth_f3_foundation_insert_guard;'],
      ['missing insert guard','drop trigger creator_premium_finance_auth_f3_foundation_insert_guard on private.creator_premium_finance_authorizations;'],
      ['missing client contract check','alter table private.creator_premium_finance_authorizations drop constraint creator_premium_finance_authorizations_client_contract_check;'],
      ['extra old purchase overload',"create function public.purchase_creator_premium_content_v1(uuid,uuid,uuid) returns jsonb language sql as 'select null::jsonb';"],
      ['extra old subscription overload',"create function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid) returns jsonb language sql as 'select null::jsonb';"],
      ['extra helper overload',"create function private.lock_creator_premium_finance_f3_v1(uuid) returns jsonb language sql as 'select null::jsonb';"],
      ['missing canonical purchase overload','drop function public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid,text);'],
      ['missing canonical subscription overload','drop function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text);'],
      ['altered owner','alter function private.lock_creator_premium_finance_f3_v1() owner to supabase_admin;'],
      ['altered search path',"alter function private.lock_creator_premium_finance_f3_v1() set search_path='public';"],
      ['client helper grant','grant execute on function private.lock_creator_premium_finance_f3_v1() to authenticated;'],
      ['client eligibility helper grant','grant execute on function private.creator_premium_actor_is_age_eligible_v1(uuid) to authenticated;'],
      ['service-only purchase RPC grant','grant execute on function public.purchase_creator_premium_content_v1(uuid,uuid,uuid,uuid,text) to authenticated;'],
      ['service-only subscription RPC grant','grant execute on function public.subscribe_creator_premium_plan_v1(uuid,uuid,uuid,text) to authenticated;'],
      ['authorization table grant','grant select on private.creator_premium_finance_authorizations to service_role;'],
      ['disabled RLS','alter table private.creator_premium_finance_authorizations disable row level security;'],
      ['disabled FORCE RLS','alter table private.creator_premium_finance_authorizations no force row level security;'],
      ['unexpected authorization policy','create policy unsafe_policy on private.creator_premium_finance_authorizations using (true);'],
      ['missing authorization index','drop index private.creator_premium_purchase_receipts_f3_authorization_idx;'],
      ['missing authorization FK','alter table private.creator_premium_purchase_receipts drop constraint creator_premium_purchase_receipts_finance_authorization_id_fkey;'],
    ];
    for(const [label,mutation] of mutations) await t.test(label,()=>{
      const changed=JSON.parse(sql(`begin;${mutation}\n${adapter.FINANCE_AUTHORITY_SQL}\nrollback;`));
      const normalized=adapter.normalizeFinanceAuthority(changed,'f3_foundation');
      if(label==='stale pre-compatibility projection') assert.notEqual(normalized.functions.find(row=>row.identity===
        'private.creator_premium_subscriptions_projection_f3_v1(boolean, timestamp with time zone, uuid, integer)').sha256,
      policy.finance_authority.f3_foundation.functions.find(row=>row.identity===
        'private.creator_premium_subscriptions_projection_f3_v1(boolean, timestamp with time zone, uuid, integer)').sha256);
      assert.throws(()=>adapter.validateFinanceAuthority(normalized,policy,'f3_foundation'),/FINANCE_AUTHORITY/);
    });
    assert.equal(adapter.validateFinanceAuthority(adapter.normalizeFinanceAuthority(JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL)),'f3_foundation'),policy,'f3_foundation'),true);
    sql(f3C2MigrationSql());
    const rawC2 = JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL));
    const c2 = adapter.normalizeFinanceAuthority(rawC2, 'f3_c2');
    try {
      assert.equal(adapter.validateFinanceAuthority(c2, installedPolicy, 'f3_c2'), true);
    } catch (error) {
      const contract = installedPolicy.finance_authority.f3_c2;
      const functions = new Map(installedPolicy.finance_authority.f3_foundation.functions
        .map(row => [row.identity, row]));
      for (const row of contract.function_overrides) functions.set(row.identity, row);
      for (const row of contract.function_additions) functions.set(row.identity, row);
      assert.deepEqual(c2.relations, contract.relations);
      assert.deepEqual(c2.functions, [...functions.values()].sort((a, b) => a.identity.localeCompare(b.identity)));
      throw error;
    }
    assert.ok(c2.functions.some(row => row.identity === 'private.guard_creator_premium_owner_attestation_f3_c2_v1()'));
    const c2Facts = JSON.parse(sql(adapter.FINANCE_FACTS_F3_C2_SQL
      .replaceAll('$1', "'local-release'").replaceAll('$2', "'local-run'")));
    assert.equal(adapter.validateFinanceFacts(c2Facts, 'f3_c2'), c2Facts);
    const c2Actors = {
      admin: '10000000-0000-4000-8000-000000000101',
      moderator: '10000000-0000-4000-8000-000000000102',
      noRole: '10000000-0000-4000-8000-000000000103',
    };
    sql(`alter table auth.users disable trigger on_auth_user_age_eligibility;
      insert into auth.users(id,is_anonymous) values
        ('${c2Actors.admin}',false),('${c2Actors.moderator}',false),('${c2Actors.noRole}',false);
      alter table auth.users enable trigger on_auth_user_age_eligibility;
      insert into private.admin_user_roles(
        user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason
      ) values
        ('${c2Actors.admin}','SUPER_ADMIN','trusted_operator','f3-c2-g1-disposable-proof','Exact positive capability control'),
        ('${c2Actors.moderator}','MODERATOR','trusted_operator','f3-c2-g1-disposable-proof','Exact negative capability control');`);
    const adminFinanceCall = (role, actor = null) => `begin;
      set local request.jwt.claim.role='${role}';
      ${actor ? `set local request.jwt.claim.sub='${actor}';` : ''}
      set local role ${role};
      select public.search_admin_creator_premium_finance_v1(null,null,null,null,null,100);
      rollback;`;
    deniedSql(adminFinanceCall('anon'), /permission denied/i);
    deniedSql(adminFinanceCall('service_role'), /permission denied/i);
    deniedSql(adminFinanceCall('authenticated', c2Actors.noRole), /admin_capability_forbidden/i);
    deniedSql(adminFinanceCall('authenticated', c2Actors.moderator), /admin_capability_forbidden/i);
    const allowedAdminProjection = JSON.parse(sql(adminFinanceCall('authenticated', c2Actors.admin)));
    assert.equal(allowedAdminProjection.counts.integrity_failures, 0);
    const c2Mutations = [
      ['altered owner attestation guard', 'alter function private.guard_creator_premium_owner_attestation_f3_c2_v1() owner to supabase_admin;'],
      ['altered attestation guard search path', "alter function private.guard_creator_premium_owner_attestation_f3_c2_v1() set search_path='public';"],
      ['client attestation guard grant', 'grant execute on function private.guard_creator_premium_owner_attestation_f3_c2_v1() to authenticated;'],
      ['disabled owner attestation insert trigger', 'alter table private.creator_premium_finance_owner_attestations_f3_c2 disable trigger creator_premium_owner_attestation_f3_c2_insert_guard;'],
      ['disabled owner attestation immutable trigger', 'alter table private.creator_premium_finance_owner_attestations_f3_c2 disable trigger creator_premium_owner_attestation_f3_c2_immutable_guard;'],
      ['disabled authorization INSERT integrity trigger', 'alter table private.creator_premium_finance_authorizations disable trigger creator_premium_finance_authorization_f3_c2_insert_integrity_gu;'],
      ['attestation table grant', 'grant select on private.creator_premium_finance_owner_attestations_f3_c2 to service_role;'],
      ['attestation RLS disabled', 'alter table private.creator_premium_finance_owner_attestations_f3_c2 disable row level security;'],
      ['attestation FORCE RLS disabled', 'alter table private.creator_premium_finance_owner_attestations_f3_c2 no force row level security;'],
      ['attestation policy introduced', 'create policy unsafe_c2_policy on private.creator_premium_finance_owner_attestations_f3_c2 using (true);'],
      ['Admin finance RPC search path altered', "alter function public.search_admin_creator_premium_finance_v1(text,text,text,timestamptz,uuid,integer) set search_path='public';"],
      ['foundation OFF guard removed after C2', 'alter table private.creator_premium_finance_policy drop constraint creator_premium_finance_policy_f3_foundation_off_check;'],
    ];
    for (const [label, mutation] of c2Mutations) await t.test(`C2 ${label}`, () => {
      const changed = JSON.parse(sql(`begin;${mutation}\n${adapter.FINANCE_AUTHORITY_SQL}\nrollback;`));
      const normalized = adapter.normalizeFinanceAuthority(changed, 'f3_c2');
      assert.throws(() => adapter.validateFinanceAuthority(normalized, installedPolicy, 'f3_c2'), /FINANCE_AUTHORITY/);
    });
  } finally { docker(['dropdb','-U','supabase_admin','--force','--if-exists',db]); }
});

test('F3 fact envelopes execute as the Management API read-only role before and after migration', {
  skip: process.env.RUN_F3_GOVERNANCE_LOCAL !== '1', timeout: 120000,
}, async () => {
  const adapter = await loadAdapter();
  const db = `premium_f3_readonly_${process.pid}_${Date.now()}`;
  assert.match(db, /^premium_f3_readonly_[0-9]+_[0-9]+$/);
  const docker = args => execFileSync('docker', ['exec','-i','nelyon-ads-v2-d-compile',...args],
    {encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const sql = input => execFileSync('docker',['exec','-i','nelyon-ads-v2-d-compile','psql','-X','-q',
    '-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',db,'-At'],
  {input,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
  const inventory = items => ({ complete: true, count: items.length, items,
    latest: items.at(-1) ?? null, sha256: sha256(canonicalJson(items)) });
  const bindingHelperPermissions = () => JSON.parse(sql(`select pg_catalog.jsonb_build_object(
    'purchase',pg_catalog.has_function_privilege('supabase_read_only_user',
      'private.creator_premium_purchase_binding_is_valid_v1(uuid)','EXECUTE'),
    'period',pg_catalog.has_function_privilege('supabase_read_only_user',
      'private.creator_premium_period_binding_is_valid_v1(uuid)','EXECUTE'));`));
  const readFacts = (query, phase) => {
    assert.doesNotMatch(query, /private\.creator_premium_(?:purchase|period)_binding_is_valid_v1/);
    const bound = query.replaceAll('$1', "'local-release'").replaceAll('$2', "'local-run'");
    const facts = JSON.parse(sql(`begin read only;
      set local role supabase_read_only_user;
      ${bound}
      rollback;`));
    assert.equal(adapter.validateFinanceFacts(facts, phase), facts);
  };
  try {
    createPreF3GovernanceDatabase({ docker, sql, db });
    assert.deepEqual(bindingHelperPermissions(), { purchase: false, period: false });
    readFacts(adapter.selectFinanceSnapshotQueries(inventory([])).facts, 'legacy');
    sql(f3MigrationSql());
    assert.deepEqual(bindingHelperPermissions(), { purchase: false, period: false });
    readFacts(adapter.selectFinanceSnapshotQueries(inventory([
      { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    ])).facts, 'f3_foundation');
    sql(f3C2MigrationSql());
    readFacts(adapter.selectFinanceSnapshotQueries(inventory([
      { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
      { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
    ])).facts, 'f3_c2');
  } finally { docker(['dropdb','-U','supabase_admin','--force','--if-exists',db]); }
});

test('F4 read-only facts execute against refunded commerce and reject hostile provenance/reconciliation drift', {
  skip: process.env.RUN_F4_SNAPSHOT_PG_LOCAL !== '1', timeout: 600000,
}, async () => {
  const adapter = await loadAdapter();
  const db = `premium_f4_adapter_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const { docker, sql } = f4DisposablePostgres(db);
  const id = Object.fromEntries([
    'buyer','creator','content','offer','plan','scan','buyerAccount','platformAccount',
  ].map(name => [name, randomUUID()]));
  const boundFacts = adapter.FINANCE_FACTS_F4_GENERAL_SQL
    .replaceAll('$1', "'f4-adapter-release'").replaceAll('$2', "'f4-adapter-run'");
  const readFacts = mutation => {
    const result = sql(`begin;
      ${mutation || ''}
      set local role supabase_read_only_user;
      ${boundFacts}
      rollback;`);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const expectClean = facts => assert.deepEqual(facts.reconciliation, {
    purchase_binding_mismatches: 0,
    period_binding_mismatches: 0,
    orphan_premium_transactions: 0,
    orphan_premium_ledger_entries: 0,
    subscriptions_without_period: 0,
    multiple_periods_per_relationship: 0,
    duplicate_open_relationships: 0,
  });
  const service = statement => `begin;
    set local request.jwt.claim.role='service_role';
    set local role service_role;
    ${statement};
    commit;`;
  try {
    createPreF3GovernanceDatabase({ docker, sql: input => sql(input).stdout, db });
    const preAuthority = JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL).stdout);
    sql([
      ...preAuthority.relations.filter(row => row.authority.owner === 'supabase_admin')
        .map(row => `alter table ${row.identity} owner to postgres;`),
      ...preAuthority.functions.filter(row => row.authority.owner === 'supabase_admin')
        .map(row => `alter function ${row.identity} owner to postgres;`),
      'truncate public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;',
    ].join('\n'));
    sql(f3MigrationSql());
    sql(f3C2MigrationSql());
    sql(f3FinalWalletMigrationSql());
    const actors = [id.buyer, id.creator];
    sql(`alter table auth.users disable trigger on_auth_user_age_eligibility;
      insert into auth.users(id,is_anonymous) values
        ('${id.buyer}',false),('${id.creator}',false);
      alter table auth.users enable trigger on_auth_user_age_eligibility;
      insert into public.user_profiles(id,username) values
        ('${id.buyer}','f4_adapter_buyer'),('${id.creator}','f4_adapter_creator');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date)
      select fixture.id,'eligible',policy.minimum_age,policy.policy_version,clock_timestamp(),
        'signup_metadata','age_18_plus',current_date-interval '25 years'
      from (values ${actors.map(actor => `('${actor}'::uuid)`).join(',')}) fixture(id)
      cross join private.age_eligibility_policy policy where policy.singleton;
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,
        requested_reason,detector_version,text_status,audio_status,visual_status,reports_status,
        attempt_count,available_at,started_at,completed_at,created_at,updated_at)
      values('${id.scan}','creator_premium','${id.content}','${id.creator}',repeat('a',64),'completed',
        'content_created','f4-adapter-v1','analyzed','not_applicable','not_applicable','analyzed',1,
        current_timestamp,current_timestamp,current_timestamp,current_timestamp,current_timestamp);
      insert into private.creator_premium_contents(
        id,creator_id,title,content_kind,access_mode,lifecycle_status,submitted_at,published_at,
        verification_generation,verification_scan_id,verification_fingerprint,verification_status,
        verification_requested_at,verification_completed_at)
      values('${id.content}','${id.creator}','F4 adapter synthetic','image','purchase_or_subscription','published',
        clock_timestamp(),clock_timestamp(),1,'${id.scan}',repeat('a',64),'passed',clock_timestamp(),clock_timestamp());
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,status,activated_at)
      values('${id.offer}','${id.content}','${id.creator}',1,10,'active',clock_timestamp());
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,price_bdag,currency,status,billing_period_days)
      values('${id.plan}','${id.creator}','f4_adapter',1,'F4 adapter',20,'BDAG','draft',30);
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.plan}','${id.content}','${id.creator}');
      update private.creator_premium_plans set status='active',activated_at=clock_timestamp()
      where id='${id.plan}';
      insert into public.ledger_accounts(id,owner_id,account_type,currency,balance,frozen)
      values('${id.platformAccount}',null,'platform','BDAG',0,false),
        ('${id.buyerAccount}','${id.buyer}','user','BDAG',100,false);
      grant usage,create on schema public,private to postgres;
      alter table private.creator_premium_finance_policy owner to postgres;
      set role postgres;
      ${f4GeneralMigrationSql()}
      reset role;`);
    const f4Authority = adapter.normalizeFinanceAuthority(
      JSON.parse(sql(adapter.FINANCE_AUTHORITY_SQL).stdout),
      'f4_general',
    );
    assert.equal(f4Authority.functions.length, 63);
    assert.equal(adapter.validateFinanceAuthority(f4Authority, installedPolicy, 'f4_general'), true);
    const purchase = JSON.parse(sql(service(`select public.purchase_creator_premium_content_v1(
      '${id.buyer}','${id.content}','${id.offer}','${randomUUID()}','creator-premium-f3-v2')`)).stdout);
    const subscription = JSON.parse(sql(service(`select public.subscribe_creator_premium_plan_v1(
      '${id.buyer}','${id.plan}','${randomUUID()}','creator-premium-f3-v2')`)).stdout);
    let facts = readFacts('');
    expectClean(facts);
    assert.equal(adapter.validateFinanceFacts(facts, 'f4_general'), facts);
    sql(service(`select public.refund_creator_premium_purchase_v1(
      '${purchase.receipt_id}','${randomUUID()}','owner_approved')`));
    sql(service(`select public.refund_creator_premium_subscription_period_v1(
      '${subscription.period_id}','${randomUUID()}','owner_approved')`));
    facts = readFacts('');
    expectClean(facts);
    assert.equal(adapter.validateFinanceFacts(facts, 'f4_general'), facts);

    const authTamper = readFacts(`
      alter table private.creator_premium_finance_authorizations disable trigger all;
      update private.creator_premium_finance_authorizations
      set configuration_digest=repeat('0',64) where authorization_scope='GENERAL';`);
    assert.ok(authTamper.reconciliation.purchase_binding_mismatches > 0);
    assert.ok(authTamper.reconciliation.period_binding_mismatches > 0);

    const orphanTransaction = readFacts(`
      alter table public.financial_transactions disable trigger all;
      update public.financial_transactions
      set reference_id='${randomUUID()}'
      where id=(select financial_transaction_id from private.creator_premium_purchase_receipts limit 1);`);
    assert.ok(orphanTransaction.reconciliation.orphan_premium_transactions > 0);

    const orphanLedger = readFacts(`
      alter table public.ledger_entries disable trigger all;
      update public.ledger_entries set metadata=metadata||jsonb_build_object('reference_id','${randomUUID()}')
      where ctid=(select ctid from public.ledger_entries
        where txn_id=(select financial_transaction_id from private.creator_premium_purchase_receipts limit 1)
        limit 1);`);
    assert.ok(orphanLedger.reconciliation.orphan_premium_ledger_entries > 0);

    const legacyBeforeCutoff = readFacts(`
      alter table private.creator_premium_purchase_receipts disable trigger all;
      alter table private.creator_premium_subscription_periods disable trigger all;
      update private.creator_premium_purchase_receipts set finance_authorization_id=null,
        created_at=(select created_at-interval '1 microsecond'
          from private.creator_premium_finance_authorizations where authorization_scope='GENERAL');
      update private.creator_premium_subscription_periods set finance_authorization_id=null,
        created_at=(select created_at-interval '1 microsecond'
          from private.creator_premium_finance_authorizations where authorization_scope='GENERAL');`);
    expectClean(legacyBeforeCutoff);
    const legacyAfterCutoff = readFacts(`
      alter table private.creator_premium_purchase_receipts disable trigger all;
      alter table private.creator_premium_subscription_periods disable trigger all;
      update private.creator_premium_purchase_receipts set finance_authorization_id=null,
        created_at=(select created_at+interval '1 microsecond'
          from private.creator_premium_finance_authorizations where authorization_scope='GENERAL');
      update private.creator_premium_subscription_periods set finance_authorization_id=null,
        created_at=(select created_at+interval '1 microsecond'
          from private.creator_premium_finance_authorizations where authorization_scope='GENERAL');`);
    assert.ok(legacyAfterCutoff.reconciliation.purchase_binding_mismatches > 0);
    assert.ok(legacyAfterCutoff.reconciliation.period_binding_mismatches > 0);

    const canaryBinding = readFacts(`
      alter table private.creator_premium_finance_authorizations disable trigger all;
      alter table private.creator_premium_finance_owner_attestations_f3_c2 disable trigger all;
      update private.creator_premium_finance_authorizations envelope set
        authorization_scope='CANARY',buyer_id='${id.buyer}',creator_id='${id.creator}',
        buyer_account_id='${id.buyerAccount}',
        creator_account_id=(select id from public.ledger_accounts
          where owner_id='${id.creator}' and account_type='user' and currency='BDAG'),
        purchase_content_id='${id.content}',purchase_offer_version_id='${id.offer}',
        subscription_plan_id='${id.plan}',purchase_amount_bdag=10,subscription_amount_bdag=20,
        max_purchase_count=1,max_subscription_count=1,max_refund_count=2,max_gross_bdag=30,
        charge_expires_at=envelope.charge_starts_at+interval '30 minutes',
        refund_expires_at=envelope.charge_starts_at+interval '60 minutes',
        configuration_digest=repeat('0',64),approval_digest=repeat('0',64)
      where authorization_scope='GENERAL';
      update private.creator_premium_finance_authorizations envelope
      set configuration_digest=private.creator_premium_finance_configuration_digest_f3_c2_v1(to_jsonb(envelope));
      update private.creator_premium_finance_owner_attestations_f3_c2 attestation
      set configuration_digest=envelope.configuration_digest,approval_digest=repeat('0',64)
      from private.creator_premium_finance_authorizations envelope;
      update private.creator_premium_finance_owner_attestations_f3_c2 attestation
      set approval_digest=private.creator_premium_finance_attestation_digest_f3_c2_v1(to_jsonb(attestation));
      update private.creator_premium_finance_authorizations envelope set approval_digest=attestation.approval_digest
      from private.creator_premium_finance_owner_attestations_f3_c2 attestation;`);
    expectClean(canaryBinding);

    const orphanRelationship = readFacts(`
      alter table private.creator_premium_subscriptions disable trigger all;
      insert into private.creator_premium_subscriptions
      select (jsonb_populate_record(null::private.creator_premium_subscriptions,
        to_jsonb(relationship)||jsonb_build_object(
          'id','${randomUUID()}','idempotency_key','${randomUUID()}',
          'status','expired','ended_at',clock_timestamp(),'updated_at',clock_timestamp()))).*
      from private.creator_premium_subscriptions relationship limit 1;`);
    assert.equal(orphanRelationship.reconciliation.subscriptions_without_period, 1);

    const multiplePeriods = readFacts(`
      alter table private.creator_premium_subscription_periods disable trigger all;
      alter table private.creator_premium_subscription_periods
        drop constraint creator_premium_subscription_periods_transaction_key;
      insert into private.creator_premium_subscription_periods
      select (jsonb_populate_record(null::private.creator_premium_subscription_periods,
        to_jsonb(period)||jsonb_build_object(
          'id','${randomUUID()}','idempotency_key','${randomUUID()}',
          'refund_idempotency_key','${randomUUID()}',
          'starts_at',period.starts_at-interval '60 days',
          'paid_through_at',period.paid_through_at-interval '60 days',
          'created_at',period.created_at-interval '60 days',
          'updated_at',period.updated_at-interval '60 days'))).*
      from private.creator_premium_subscription_periods period limit 1;`);
    assert.equal(multiplePeriods.reconciliation.multiple_periods_per_relationship, 1);

    const duplicateOpen = readFacts(`
      drop index private.creator_premium_subscriptions_one_open_relationship_uidx;
      alter table private.creator_premium_subscriptions disable trigger all;
      update private.creator_premium_subscriptions set status='active',
        started_at=coalesce(started_at,clock_timestamp()),cancelled_at=null,ended_at=null,
        updated_at=clock_timestamp();
      insert into private.creator_premium_subscriptions
      select (jsonb_populate_record(null::private.creator_premium_subscriptions,
        to_jsonb(relationship)||jsonb_build_object(
          'id','${randomUUID()}','idempotency_key','${randomUUID()}',
          'status','active','started_at',clock_timestamp(),
          'cancelled_at',null,'ended_at',null,'updated_at',clock_timestamp()))).*
      from private.creator_premium_subscriptions relationship limit 1;`);
    assert.equal(duplicateOpen.reconciliation.duplicate_open_relationships, 1);
  } finally {
    docker(['dropdb','-U','supabase_admin','--force','--if-exists',db]);
  }
});

test('F3 selects attested SQL only from complete migration inventory and rejects phase mismatch', async () => {
  const adapter = await loadAdapter();
  const inventory = items => ({ complete: true, count: items.length, items,
    latest: items.at(-1) ?? null, sha256: sha256(canonicalJson(items)) });
  const legacy = adapter.selectFinanceSnapshotQueries(inventory([]));
  assert.equal(legacy.phase, 'legacy');
  assert.doesNotMatch(legacy.facts, /from private\.creator_premium_finance_authorizations/);
  assert.doesNotMatch(legacy.facts,
    /private\.creator_premium_(?:purchase|period)_binding_is_valid_v1/);
  const f3 = adapter.selectFinanceSnapshotQueries(inventory([
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
  ]));
  assert.equal(f3.phase, 'f3_foundation');
  assert.notEqual(f3.facts, legacy.facts);
  const c2 = adapter.selectFinanceSnapshotQueries(inventory([
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
  ]));
  assert.equal(c2.phase, 'f3_c2');
  assert.notEqual(c2.facts, f3.facts);
  assert.match(c2.facts, /creator_premium_finance_owner_attestations_f3_c2/);
  for (const query of [legacy.authority, legacy.facts, f3.authority, f3.facts, c2.authority, c2.facts]) {
    assert.equal(adapter.assertReadOnlySql(query), true);
  }
  assert.throws(() => adapter.selectFinanceSnapshotQueries(inventory([
    { version: '20261025011000', name: 'unrelated_migration' },
  ])), /FINANCE_AUTHORITY/);
  assert.throws(() => adapter.selectFinanceSnapshotQueries(inventory([
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    { version: '20261025160452', name: 'unrelated_migration' },
  ])), /FINANCE_AUTHORITY/);
  assert.throws(() => adapter.selectFinanceSnapshotQueries(inventory([
    { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
  ])), /FINANCE_AUTHORITY/);
  assert.throws(() => adapter.selectFinanceSnapshotQueries({ ...inventory([]), complete: false }), /INVALID_REMOTE_INVENTORY/);
});

test('F3 fact envelope rejects any activity and malformed or forged foundation policy', async () => {
  const adapter = await loadAdapter();
  const empty = { schema_version: 1, complete: true, phase: 'f3_foundation',
    policy: { activation_mode: 'off', active_authorization_id: null, purchase_enabled: false,
      subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 },
    authorizations: [], receipts: [], periods: [], subscriptions: [], transactions: [],
    acquisition_exposure_bdag: '0.00000000', release_movement_bdag: '0.00000000', reconciliation: { purchase_binding_mismatches: 0, period_binding_mismatches: 0 } };
  assert.equal(adapter.validateFinanceFacts(empty, 'f3_foundation'), empty);
  assert.throws(() => adapter.validateFinanceFacts({ ...empty, phase: 'canary' }, 'canary'), /FINANCE_FACTS/);
  for (const key of ['authorizations', 'receipts', 'periods', 'subscriptions', 'transactions']) {
    assert.throws(() => adapter.validateFinanceFacts({ ...empty, [key]: [{ id_sha256: 'a'.repeat(64) }] }, 'f3_foundation'), /FINANCE_FACTS/);
  }
  for (const patch of [{ activation_mode: 'canary' }, { activation_mode: 'public' },
    { purchase_enabled: true }, { refunds_enabled: true }, { subscription_enabled: true },
    { platform_fee_bps: 1 }, { active_authorization_id: 'a'.repeat(64) }]) {
    assert.throws(() => adapter.validateFinanceFacts({ ...empty, policy: { ...empty.policy, ...patch } }, 'f3_foundation'), /FINANCE_FACTS/);
  }
  const missing = structuredClone(empty); delete missing.policy.activation_mode;
  assert.throws(() => adapter.validateFinanceFacts(missing, 'f3_foundation'), /FINANCE_FACTS/);
  for (const patch of [{ phase: 'legacy' }, { acquisition_exposure_bdag: '1.00000000' },
    { release_movement_bdag: '1.00000000' }, { unrelated: true }, { reconciliation: { forged: 0 } }]) {
    assert.throws(() => adapter.validateFinanceFacts({ ...empty, ...patch }, 'f3_foundation'), /FINANCE_FACTS/);
  }
});

test('F3 no-argument Admin read retains authenticated-only RPC enforcement', async () => {
  const adapter = await loadAdapter();
  const row = { schema: 'public', name: 'get_admin_creator_premium_finance_activation_v1',
    argument_types: [], identity_arguments: '', security_definer: true, owner: 'postgres',
    search_path: ['search_path=""'], acl: [
      { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ], execute: { anon: false, authenticated: true, public: false, service_role: false },
    definition: 'CREATE FUNCTION public.get_admin_creator_premium_finance_activation_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER' };
  assert.equal(adapter.normalizeRpcSecurityAttestations([row]).count, 1);
  for (const role of ['anon','public','service_role']) {
    assert.throws(() => adapter.normalizeRpcSecurityAttestations([{ ...row, execute: { ...row.execute, [role]: true } }]), /RPC_SECURITY_ATTESTATION_FAILED/);
  }
  assert.throws(() => adapter.normalizeRpcSecurityAttestations([{ ...row, argument_types: ['uuid'] }]), /RPC_SECURITY_ATTESTATION_FAILED/);
});

function f3FoundationManifest() {
  const t = policy.finance_authority_transition;
  return { ...manifest(), baseline: { sha: t.baseline_sha }, delta: { files: [
    { path: t.function_path, status: 'M' }, { path: t.migration_path, status: 'A' },
  ] }, resources: { functions: ['bdag-ledger'], config_changed: false,
    function_contracts: [{ ...manifest().resources.function_contracts[0], name: 'bdag-ledger',
      entrypoint: t.function_path, source_sha256: t.function_source_sha256 }],
    migrations: [{ version: '20261025011000', path: t.migration_path, blob: t.migration_blob, sha256: t.migration_sha256 }],
    finance_authority_transition: { id: t.id, phase: t.phase, baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha, integration_base_sha: t.integration_base_sha,
      approved_sha: request().approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: t.migration_blob, migration_sha256: t.migration_sha256,
      function_blob: t.function_blob, function_source_sha256: t.function_source_sha256, config_blob: t.config_blob,
      client_contract: t.client_contract, client_sources: t.client_sources,
      frozen_f2_parser: t.frozen_f2_parser },
  } };
}

function f3C2Manifest() {
  const t = installedPolicy.finance_authority_c2_transition;
  return { ...manifest(), baseline: { sha: t.baseline_sha }, delta: { files: [
    { path: t.migration_path, status: 'A' },
  ] }, resources: {
    functions: [],
    config_changed: false,
    function_contracts: [],
    migrations: [{ version: '20261025160452', path: t.migration_path, blob: t.migration_blob, sha256: t.migration_sha256 }],
    finance_authority_transition: {
      id: t.id,
      from_phase: t.from_phase,
      to_phase: t.to_phase,
      baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha,
      integration_base_sha: t.integration_base_sha,
      approved_sha: request().approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      migration_blob: t.migration_blob,
      migration_sha256: t.migration_sha256,
    },
  } };
}

function f4GeneralManifest() {
  const t = installedPolicy.finance_authority_f4_transition;
  return { ...manifest(), baseline: { sha: t.baseline_sha }, delta: { files: [
    { path: t.migration_path, status: 'A' },
  ] }, resources: {
    functions: [],
    config_changed: false,
    function_contracts: [],
    migrations: [{ version: '20261026030000', path: t.migration_path, blob: t.migration_blob, sha256: t.migration_sha256 }],
    finance_authority_transition: {
      id: t.id,
      from_phase: t.from_phase,
      to_phase: t.to_phase,
      baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha,
      integration_base_sha: t.integration_base_sha,
      approved_sha: request().approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      migration_blob: t.migration_blob,
      migration_sha256: t.migration_sha256,
    },
  } };
}

function f5AutonomousManifest() {
  const t = installedPolicy.finance_authority_f5_transition;
  return { ...manifest(), baseline: { sha: t.baseline_sha }, delta: { files: [
    { path: t.function_path, status: 'M' },
    { path: t.migration_path, status: 'A' },
  ] }, resources: {
    functions: [t.function],
    config_changed: false,
    function_contracts: [{
      name: t.function,
      entrypoint: t.function_path,
      import_map: null,
      verify_jwt: true,
      source_changed: true,
      source_files: [
        { path: 'supabase/functions/_shared/cors.ts', sha256: '2ec2fbe24a648db8750e74da1225dfb0d4f7aa00d86001d8c2990b9a428d4a87' },
        { path: t.function_path, sha256: 'd16d76b509c2592c4e3f558c8ba80a25b77df650f52b16194a19a072f93dc693' },
      ],
      source_sha256: t.function_source_sha256,
    }],
    migrations: [{ version: '20261026072512', path: t.migration_path,
      blob: t.migration_blob, sha256: t.migration_sha256 }],
    finance_authority_transition: {
      id: t.id,
      from_phase: t.from_phase,
      to_phase: t.to_phase,
      baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha,
      integration_base_sha: t.integration_base_sha,
      approved_sha: request().approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      migration_blob: t.migration_blob,
      migration_sha256: t.migration_sha256,
      function_blob: t.function_blob,
      function_source_sha256: t.function_source_sha256,
      config_blob: t.config_blob,
      client_contract: t.client_contract,
      client_sources: t.client_sources,
      cron_job: t.cron_job,
    },
  } };
}

test('F5 snapshot authority selects the autonomous phase and exact inherited catalog', async () => {
  const adapter = await loadAdapter();
  const transitionPolicy = structuredClone(installedPolicy);
  transitionPolicy.baseline.sha = installedPolicy.finance_authority_f5_transition.baseline_sha;
  transitionPolicy.baseline.migration_count = 355;
  transitionPolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
  const transition = adapter.activeFinanceAuthorityTransition(transitionPolicy, f5AutonomousManifest());
  assert.equal(transition.to_phase, 'f5_autonomous');

  const inventory = items => ({ complete: true, count: items.length, items,
    latest: items.at(-1) ?? null, sha256: sha256(canonicalJson(items)) });
  const migrations = [
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
    { version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' },
    { version: '20261026072512', name: 'creator_premium_f5_autonomous_subscriptions' },
  ];
  const selected = adapter.selectFinanceSnapshotQueries(inventory(migrations));
  assert.equal(selected.phase, 'f5_autonomous');
  assert.equal(selected.facts, adapter.FINANCE_FACTS_F5_AUTONOMOUS_SQL);
  assert.match(selected.authority, /creator_premium_auto_renewal_attempts/);
  assert.match(selected.authority, /authorization\|renewal/);
  assert.match(selected.facts, /'mandates'.*creator_premium_auto_renewal_mandates/s);
  assert.match(selected.facts, /'attempts'.*creator_premium_auto_renewal_attempts/s);

  const functions = new Map(installedPolicy.finance_authority.f3_foundation.functions
    .map(row => [row.identity, row]));
  for (const phase of ['f3_c2', 'f4_general', 'f5_autonomous']) {
    for (const row of installedPolicy.finance_authority[phase].function_overrides) functions.set(row.identity, row);
    for (const row of installedPolicy.finance_authority[phase].function_additions) functions.set(row.identity, row);
  }
  const unsigned = {
    schema_version: 1,
    complete: true,
    phase: 'f5_autonomous',
    relations: installedPolicy.finance_authority.f5_autonomous.relations,
    functions: [...functions.values()].sort((left, right) => left.identity.localeCompare(right.identity)),
    legacy_functions: installedPolicy.finance_authority.f3_foundation.legacy_function_identities
      .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
    legacy_relations: ['public.financial_transactions', 'public.ledger_accounts', 'public.ledger_entries']
      .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
  };
  assert.equal(adapter.validateFinanceAuthority({ ...unsigned, sha256: sha256(canonicalJson(unsigned)) },
    installedPolicy, 'f5_autonomous'), true);

  const beforeProjection = adapter.advisorExceptionsForPhase(transitionPolicy, f5AutonomousManifest(), 'pre')
    .find(row => row.object.name === 'get_my_creator_premium_subscriptions_v2');
  const afterProjection = adapter.advisorExceptionsForPhase(transitionPolicy, f5AutonomousManifest(), 'post')
    .find(row => row.object.name === 'get_my_creator_premium_subscriptions_v2');
  assert.equal(beforeProjection.attestation.definition_sha256,
    '307938b5ec832f0bdc2c4ad4009180c6a1b3ae28a7cc1f617c5b856fa13210a9');
  assert.deepEqual(afterProjection, beforeProjection);
  const pre = adapter.advisorExceptionsForPhase(transitionPolicy, f5AutonomousManifest(), 'pre');
  const post = adapter.advisorExceptionsForPhase(transitionPolicy, f5AutonomousManifest(), 'post');
  assert.equal(pre.some(row => row.object.name === 'get_my_creator_premium_subscriptions_v3'), false);
  assert.equal(post.find(row => row.object.name === 'get_my_creator_premium_subscriptions_v3').attestation.definition_sha256,
    '246ab182de52bedd431e12a54ddf48923ecbd85e296ad6e138e54017f5ed7489');
  for (const addition of installedPolicy.finance_security_advisor.f5_relation_additions) {
    assert.equal(pre.some(row => row.advisor_fingerprint === addition.advisor_fingerprint), false);
    assert.equal(post.some(row => row.advisor_fingerprint === addition.advisor_fingerprint), true);
  }
  assert.equal(beforeProjection.advisor_fingerprint, afterProjection.advisor_fingerprint);
});

test('F5 cron transition preserves exact command bytes and rejects quoted whitespace drift', async () => {
  const adapter = await loadAdapter();
  const cron = installedPolicy.finance_authority_f5_transition.cron_job;
  assert.equal(adapter.normalizeCronCommand(`  select\n private.process_creator_premium_auto_renewals_f5_v1(25);  `),
    cron.command);
  const commandPairs = [
    ["select public.job('a b');", "select public.job('a  b');"],
    ['select public.job($body$a b$body$);', 'select public.job($body$a  b$body$);'],
  ];
  for (const [before, after] of commandPairs) {
    assert.equal(adapter.normalizeCronCommand(before), adapter.normalizeCronCommand(after));
    assert.equal(adapter.cronCommandSha256(before), sha256(before));
    assert.equal(adapter.cronCommandSha256(after), sha256(after));
    assert.notEqual(adapter.cronCommandSha256(before), adapter.cronCommandSha256(after));
  }
  assert.equal(adapter.normalizedCronCommandSha256(cron.command), cron.normalized_command_sha256);
  assert.equal(adapter.cronCommandSha256(cron.command), sha256(cron.command));
  assert.match(adapter.CRON_SNAPSHOT_SQL,
    /'command_sha256'[\s\S]*?convert_to\(\s*j\.command\s*,\s*'UTF8'\s*\)/i);
  assert.match(adapter.CRON_SNAPSHOT_SQL,
    /'legacy_normalized_command_sha256'[\s\S]*?regexp_replace\(pg_catalog\.btrim\(j\.command\)/i);

  const existingSingleQuoted = {
    jobid: '3', jobname: 'existing-safe-job', schedule: '0 3 * * *', database: 'postgres',
    username: 'postgres', active: true, nodename: 'localhost', nodeport: 5432,
    command_sha256: adapter.cronCommandSha256(commandPairs[0][0]),
    legacy_normalized_command_sha256: adapter.normalizedCronCommandSha256(commandPairs[0][0]),
  };
  const existingDollarQuoted = {
    jobid: '4', jobname: 'existing-dollar-quoted-job', schedule: '0 4 * * *', database: 'postgres',
    username: 'postgres', active: true, nodename: 'localhost', nodeport: 5432,
    command_sha256: adapter.cronCommandSha256(commandPairs[1][0]),
    legacy_normalized_command_sha256: adapter.normalizedCronCommandSha256(commandPairs[1][0]),
  };
  const rawBaselineIdentity = { ...existingSingleQuoted };
  delete rawBaselineIdentity.legacy_normalized_command_sha256;
  const legacyBaselineIdentity = {
    ...rawBaselineIdentity,
    command_sha256: existingSingleQuoted.legacy_normalized_command_sha256,
  };
  assert.deepEqual(adapter.projectCronBaselineItems([existingSingleQuoted], false),
    [legacyBaselineIdentity]);
  assert.deepEqual(adapter.projectCronBaselineItems([existingSingleQuoted], true),
    [rawBaselineIdentity]);
  const added = {
    jobid: '17', jobname: cron.jobname, schedule: cron.schedule, database: cron.database,
    username: cron.username, active: cron.active, nodename: 'localhost', nodeport: 5432,
    command_sha256: adapter.cronCommandSha256(cron.command),
    legacy_normalized_command_sha256: cron.normalized_command_sha256,
  };
  const snapshot = items => ({ schema_version: 1, complete: true, query_id: 'nelyon-cron-snapshot-v1',
    count: items.length, items });
  const pre = snapshot([existingSingleQuoted, existingDollarQuoted]);
  const post = snapshot([existingSingleQuoted, existingDollarQuoted, added]);
  assert.equal(adapter.verifyCronSnapshotTransition(pre, post,
    installedPolicy.finance_authority_f5_transition), true);

  const mutations = [
    items => items.filter(item => item.jobid !== existingSingleQuoted.jobid),
    items => items.map(item => item.jobid === existingSingleQuoted.jobid
      ? { ...item, command_sha256: adapter.cronCommandSha256(commandPairs[0][1]) } : item),
    items => items.map(item => item.jobid === existingDollarQuoted.jobid
      ? { ...item, command_sha256: adapter.cronCommandSha256(commandPairs[1][1]) } : item),
    items => [...items, { ...added, jobid: '18', jobname: 'unexpected-job' }],
    items => items.map(item => item.jobid === added.jobid ? { ...item, jobname: 'renamed' } : item),
    items => items.map(item => item.jobid === added.jobid ? { ...item, active: false } : item),
    items => items.map(item => item.jobid === added.jobid ? { ...item, schedule: '*/10 * * * *' } : item),
    items => items.map(item => item.jobid === added.jobid ? { ...item, username: 'supabase_admin' } : item),
    items => items.map(item => item.jobid === added.jobid ? { ...item, command_sha256: 'b'.repeat(64) } : item),
    items => [...items, { ...added, jobid: '18' }],
  ];
  for (const mutate of mutations) assert.throws(() => adapter.verifyCronSnapshotTransition(
    pre, snapshot(mutate(post.items)), installedPolicy.finance_authority_f5_transition,
  ), /REMOTE_POSTCHECK_FAILED|INVALID_SNAPSHOT/);
});

test('F5 post-release facts forbid retroactive enrollment and any release-window financial delta', async () => {
  const adapter = await loadAdapter();
  const pre = {
    phase: 'f4_general',
    attestations: [{ fact_sha256: '1'.repeat(64) }],
    authorizations: [{ fact_sha256: '2'.repeat(64) }],
    receipts: [{ fact_sha256: '3'.repeat(64) }],
    periods: [{ fact_sha256: '4'.repeat(64) }],
    subscriptions: [{ fact_sha256: '5'.repeat(64) }],
    transactions: [{ fact_sha256: '6'.repeat(64) }],
    acquisition_exposure_bdag: '100.00000000',
    release_movement_bdag: '0.00000000',
  };
  const post = { ...structuredClone(pre), phase: 'f5_autonomous', mandates: [], attempts: [] };
  assert.equal(adapter.verifyF5AutonomousPostReleaseFacts(pre, post), true);
  for (const hostile of [
    { ...post, mandates: [{ fact_sha256: '7'.repeat(64) }] },
    { ...post, attempts: [{ fact_sha256: '8'.repeat(64) }] },
    { ...post, receipts: [...post.receipts, { fact_sha256: '9'.repeat(64) }] },
    { ...post, periods: [...post.periods, { fact_sha256: 'a'.repeat(64) }] },
    { ...post, authorizations: [...post.authorizations, { fact_sha256: 'b'.repeat(64) }] },
    { ...post, release_movement_bdag: '0.00000001' },
  ]) assert.throws(() => adapter.verifyF5AutonomousPostReleaseFacts(pre, hostile),
    /REMOTE_POSTCHECK_FAILED/);
});

test('F3-C2 successor authority pins the new relation, changed Admin RPC, empty facts and exact phase', async () => {
  const adapter = await loadAdapter();
  assert.deepEqual(adapter.FINANCE_POLICY_DIGESTS, {
    historical_transition: sha256(canonicalJson(installedPolicy.finance_authority_transition)),
    c2_transition: sha256(canonicalJson(installedPolicy.finance_authority_c2_transition)),
    f4_transition: sha256(canonicalJson(installedPolicy.finance_authority_f4_transition)),
    f5_transition: sha256(canonicalJson(installedPolicy.finance_authority_f5_transition)),
    authority: sha256(canonicalJson(installedPolicy.finance_authority)),
    security_advisor: sha256(canonicalJson(installedPolicy.finance_security_advisor)),
  });
  const contract = installedPolicy.finance_authority.f3_c2;
  assert.ok(contract);
  assert.ok(contract.relations.some(row => (
    row.identity === 'private.creator_premium_finance_owner_attestations_f3_c2'
  )));
  assert.ok([...contract.function_overrides, ...contract.function_additions].some(row => (
    row.identity === 'private.guard_creator_premium_owner_attestation_f3_c2_v1()'
  )));
  const c2Rpc = installedPolicy.finance_security_advisor.c2_rpc_replacements.find(row => (
    row.object.name === 'search_admin_creator_premium_finance_v1'
  ));
  assert.match(c2Rpc.attestation.definition_sha256, /^[0-9a-f]{64}$/);
  const predecessor = installedPolicy.security_advisor.exceptions.find(row => (
    row.object.name === 'search_admin_creator_premium_finance_v1'
  ));
  assert.notEqual(c2Rpc.attestation.definition_sha256, predecessor.attestation.definition_sha256);

  const empty = {
    schema_version: 1,
    complete: true,
    phase: 'f3_c2',
    policy: { activation_mode: 'off', active_authorization_id: null, purchase_enabled: false,
      subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 },
    attestations: [], authorizations: [], receipts: [], periods: [], subscriptions: [], transactions: [],
    acquisition_exposure_bdag: '0.00000000', release_movement_bdag: '0.00000000',
    reconciliation: {
      purchase_binding_mismatches: 0,
      period_binding_mismatches: 0,
    },
  };
  assert.equal(adapter.validateFinanceFacts(empty, 'f3_c2'), empty);
  assert.throws(() => adapter.validateFinanceFacts({
    ...empty,
    attestations: [{ approval_digest_sha256: 'a'.repeat(64) }],
  }, 'f3_c2'), /FINANCE_FACTS/);

  const transition = adapter.activeFinanceAuthorityTransition(c2TransitionPolicy, f3C2Manifest());
  assert.equal(transition.to_phase, 'f3_c2');
  const pre = adapter.advisorExceptionsForPhase(c2TransitionPolicy, f3C2Manifest(), 'pre');
  const post = adapter.advisorExceptionsForPhase(c2TransitionPolicy, f3C2Manifest(), 'post');
  assert.equal(pre.find(row => row.object.name === 'search_admin_creator_premium_finance_v1')
    .attestation.definition_sha256, predecessor.attestation.definition_sha256);
  assert.equal(post.find(row => row.object.name === 'search_admin_creator_premium_finance_v1')
    .attestation.definition_sha256, c2Rpc.attestation.definition_sha256);
  assert.equal(post.filter(row => (
    row.object.name === 'creator_premium_finance_owner_attestations_f3_c2'
  )).length, 1);
});

test('F4 successor pins exact general authority and phase-bound Admin RPC replacement', async () => {
  const adapter = await loadAdapter();
  const transition = adapter.activeFinanceAuthorityTransition(f4TransitionPolicy, f4GeneralManifest());
  assert.equal(transition.to_phase, 'f4_general');

  const foundation = new Map(installedPolicy.finance_authority.f3_foundation.functions
    .map(row => [row.identity, row]));
  for (const row of installedPolicy.finance_authority.f3_c2.function_overrides) foundation.set(row.identity, row);
  for (const row of installedPolicy.finance_authority.f3_c2.function_additions) foundation.set(row.identity, row);
  for (const row of installedPolicy.finance_authority.f4_general.function_overrides) foundation.set(row.identity, row);
  for (const row of installedPolicy.finance_authority.f4_general.function_additions) foundation.set(row.identity, row);
  const unsigned = {
    schema_version: 1,
    complete: true,
    phase: 'f4_general',
    relations: [...installedPolicy.finance_authority.f4_general.relations]
      .sort((left, right) => left.identity.localeCompare(right.identity)),
    functions: [...foundation.values()].sort((left, right) => left.identity.localeCompare(right.identity)),
    legacy_functions: installedPolicy.finance_authority.f3_foundation.legacy_function_identities
      .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
    legacy_relations: ['public.financial_transactions','public.ledger_accounts','public.ledger_entries']
      .map(identity => ({ identity, sha256: 'a'.repeat(64) })),
  };
  const authority = { ...unsigned, sha256: sha256(canonicalJson(unsigned)) };
  assert.equal(adapter.validateFinanceAuthority(authority, installedPolicy, 'f4_general'), true);
  const hostile = structuredClone(authority);
  hostile.relations[0].sha256 = 'b'.repeat(64);
  hostile.sha256 = sha256(canonicalJson(Object.fromEntries(Object.entries(hostile)
    .filter(([key]) => key !== 'sha256'))));
  assert.throws(() => adapter.validateFinanceAuthority(hostile, installedPolicy, 'f4_general'), /FINANCE_AUTHORITY/);

  const pre = adapter.advisorExceptionsForPhase(f4TransitionPolicy, f4GeneralManifest(), 'pre');
  const post = adapter.advisorExceptionsForPhase(f4TransitionPolicy, f4GeneralManifest(), 'post');
  const predecessor = installedPolicy.finance_security_advisor.rpc_attestations.find(row => (
    row.object.name === 'get_admin_creator_premium_finance_activation_v1'
  ));
  const successor = installedPolicy.finance_security_advisor.f4_rpc_replacements[0];
  assert.equal(pre.find(row => row.object.name === predecessor.object.name)
    .attestation.definition_sha256, predecessor.attestation.definition_sha256);
  assert.equal(post.find(row => row.object.name === successor.object.name)
    .attestation.definition_sha256, successor.attestation.definition_sha256);
});

test('F3 phase authority admits exact pinned static evidence and rejects extra or altered records', async () => {
  const adapter = await loadAdapter();
  const contract = policy.finance_authority.f3_foundation;
  const unsigned = { schema_version: 1, complete: true, phase: 'f3_foundation',
    relations: contract.relations, functions: contract.functions,
    legacy_functions: contract.legacy_function_identities.map(identity=>({identity,sha256:'a'.repeat(64)})),
    legacy_relations: ['public.financial_transactions','public.ledger_accounts','public.ledger_entries']
      .map(identity => ({ identity, sha256: 'a'.repeat(64) })) };
  const sign = object => ({ ...object, sha256: sha256(canonicalJson(object)) });
  assert.equal(adapter.validateFinanceAuthority(sign(unsigned), policy, 'f3_foundation'), true);
  for (const patch of [
    { phase: 'legacy' }, { functions: unsigned.functions.slice(1) },
    { functions: [...unsigned.functions, { identity: 'public.purchase_creator_premium_content_v1(uuid, uuid, uuid)', sha256: 'b'.repeat(64) }] },
    { relations: unsigned.relations.map((r,i) => i ? r : { ...r, sha256: 'f'.repeat(64) }) },
    { legacy_relations: unsigned.legacy_relations.slice(1) }, { unrelated: true },
  ]) assert.throws(() => adapter.validateFinanceAuthority(sign({ ...unsigned, ...patch }), policy, 'f3_foundation'), /FINANCE_AUTHORITY/);
});

test('F3 projection and relation exceptions require exact foundation transition and cannot be reused', async () => {
  const adapter = await loadAdapter();
  const m = f3FoundationManifest();
  assert.deepEqual(adapter.advisorExceptionsForPhase(policy,m,'pre'), policy.security_advisor.exceptions);
  const post = adapter.advisorExceptionsForPhase(policy,m,'post');
  assert.equal(post.filter(e => e.object.name === 'get_creator_premium_commerce_v1')[0].attestation.definition_sha256,
    '16bfbc3bb13e8fedc69ae444dfac0e24ef02fb5285e775b72df1e3e36f2ce3b4');
  assert.equal(post.filter(e => e.object.name === 'get_admin_creator_premium_finance_activation_v1').length,1);
  assert.equal(post.filter(e => e.object.name === 'creator_premium_finance_authorizations').length,1);
  for (const mutate of [
    candidate => { candidate.resources.finance_authority_transition.approved_sha = 'b'.repeat(40); },
    candidate => { candidate.resources.finance_authority_transition.integration_base_sha = 'b'.repeat(40); },
    candidate => { candidate.resources.migrations[0].blob = 'b'.repeat(40); },
    candidate => { delete candidate.resources.finance_authority_transition; },
    candidate => { candidate.resources.config_changed = true; },
    candidate => { candidate.resources.functions.push('agora-token'); },
    candidate => { candidate.delta.files.push({path:'supabase/functions/agora-token/index.ts',status:'M'}); },
  ]) { const changed = structuredClone(m); mutate(changed);
    assert.throws(() => adapter.advisorExceptionsForPhase(policy,changed,'post'), /FINANCE_AUTHORITY_TRANSITION/); }
  assert.throws(() => adapter.advisorExceptionsForPhase({ ...policy, baseline: { ...policy.baseline, sha: 'b'.repeat(40) } },m,'post'), /FINANCE_AUTHORITY_TRANSITION/);
});

test('F3 recovery authorities require the exact approved source and installed migration inventory', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const source = controlledPolicy.postcheck_recovery.approved_sources.find(item => item.run_id === '40166468648');
  assert.ok(source);
  const recoveryRequest = {
    ...request(),
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: source.run_id,
  };
  const recoveryManifest = {
    ...manifest(),
    identity: { ...manifest().identity, mode: 'postcheck_recovery' },
    resources: { functions: [], function_contracts: [], migrations: [], config_changed: false },
  };
  const rows = [
    ...Array.from({ length: source.expected_migration_count - 1 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    {
      version: source.expected_latest_migration.slice(0, 14),
      name: source.expected_latest_migration.slice(15),
    },
  ];
  const migrations = {
    complete: true,
    count: rows.length,
    items: rows,
    latest: rows.at(-1),
    sha256: sha256(canonicalJson(rows)),
  };
  controlledPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson(
    rows.slice(0, -1).map(item => `${item.version}_${item.name}`),
  ));
  const selected = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    recoveryManifest,
    'recovery',
    { request: recoveryRequest, migrations },
  );
  assert.equal(selected.length, 22);
  assert.equal(selected.filter(item => Array.isArray(item.object.argument_types)).length, 20);
  assert.equal(selected.some(item => item.object.name === 'get_admin_creator_premium_finance_activation_v1'), true);
  assert.equal(selected.some(item => item.object.name === 'get_creator_premium_commerce_v2'), true);
  assert.equal(selected.some(item => item.object.name === 'get_my_creator_premium_subscriptions_v2'), true);
  assert.equal(selected.some(item => item.object.name === 'creator_premium_finance_authorizations'), true);

  const swappedHistory = structuredClone(migrations);
  swappedHistory.items[0].name = 'historical_identity_swapped';
  swappedHistory.sha256 = sha256(canonicalJson(swappedHistory.items));
  const baselineRecoveryExceptions = controlledPolicy.security_advisor.exceptions.filter(exception => (
    typeof exception?.origin?.migration !== 'string'
    || exception.origin.migration <= controlledPolicy.baseline.latest_migration
  ));
  assert.deepEqual(
    adapter.advisorExceptionsForPhase(
      controlledPolicy,
      recoveryManifest,
      'recovery',
      { request: recoveryRequest, migrations: swappedHistory },
    ),
    baselineRecoveryExceptions,
  );

  for (const options of [
    { request: { ...recoveryRequest, recoverySourceRunId: controlledPolicy.postcheck_recovery.approved_sources[0].run_id }, migrations },
    { request: recoveryRequest, migrations: { ...migrations, count: migrations.count - 1 } },
    { request: recoveryRequest, migrations: { ...migrations, latest: rows.at(-2) } },
  ]) {
    assert.deepEqual(
      adapter.advisorExceptionsForPhase(controlledPolicy, recoveryManifest, 'recovery', options),
      baselineRecoveryExceptions,
    );
  }
});

test('F4 recovery selects the exact general successor only for the immutable failed-postcheck source', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(f4TransitionPolicy);
  const source = controlledPolicy.postcheck_recovery.approved_sources
    .find(item => item.run_id === '40268500711');
  assert.ok(source);
  const recoveryRequest = {
    ...request(),
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: source.run_id,
  };
  const recoveryManifest = {
    ...manifest(),
    identity: { ...manifest().identity, mode: 'postcheck_recovery' },
    resources: { functions: [], function_contracts: [], migrations: [], config_changed: false },
  };
  const rows = [
    ...Array.from({ length: source.expected_migration_count - 4 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
    { version: '20261025231500', name: 'creator_premium_f3_final_wallet_integration' },
    { version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' },
  ];
  const migrations = {
    complete: true,
    count: rows.length,
    items: rows,
    latest: rows.at(-1),
    sha256: sha256(canonicalJson(rows)),
  };
  controlledPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson(
    rows.slice(0, -1).map(item => `${item.version}_${item.name}`),
  ));
  const selected = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    recoveryManifest,
    'recovery',
    { request: recoveryRequest, migrations },
  );
  const f4Admin = controlledPolicy.finance_security_advisor.f4_rpc_replacements[0];
  assert.equal(selected.find(item => item.object.name === f4Admin.object.name)
    .attestation.definition_sha256, f4Admin.attestation.definition_sha256);
  assert.equal(selected.some(item => (
    item.object.name === 'creator_premium_finance_owner_attestations_f3_c2'
  )), true);

  for (const options of [
    { request: { ...recoveryRequest, recoverySourceRunId: '40166468648' }, migrations },
    { request: recoveryRequest, migrations: { ...migrations, count: migrations.count - 1 } },
    { request: recoveryRequest, migrations: { ...migrations, latest: rows.at(-2) } },
    { request: recoveryRequest, migrations: {
      ...migrations,
      items: rows.map((item, index) => index === 0 ? { ...item, name: 'history_drift' } : item),
    } },
  ]) {
    const fallback = adapter.advisorExceptionsForPhase(
      controlledPolicy,
      recoveryManifest,
      'recovery',
      options,
    );
    assert.notEqual(fallback.find(item => item.object.name === f4Admin.object.name)
      .attestation.definition_sha256, f4Admin.attestation.definition_sha256);
  }
});

test('F5 recovery selects the autonomous successor only for the immutable failed-postcheck source', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(f5TransitionPolicy);
  const source = controlledPolicy.postcheck_recovery.approved_sources
    .find(item => item.run_id === '40324910390');
  assert.ok(source);
  const recoveryRequest = {
    ...request(),
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: source.run_id,
  };
  const recoveryManifest = {
    ...manifest(),
    identity: { ...manifest().identity, mode: 'postcheck_recovery' },
    resources: { functions: [], function_contracts: [], migrations: [], config_changed: false },
  };
  const rows = [
    ...Array.from({ length: source.expected_migration_count - 5 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' },
    { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
    { version: '20261025231500', name: 'creator_premium_f3_final_wallet_integration' },
    { version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' },
    { version: '20261026072512', name: 'creator_premium_f5_autonomous_subscriptions' },
  ];
  const migrations = {
    complete: true,
    count: rows.length,
    items: rows,
    latest: rows.at(-1),
    sha256: sha256(canonicalJson(rows)),
  };
  controlledPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson(
    rows.slice(0, -1).map(item => `${item.version}_${item.name}`),
  ));
  const selected = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    recoveryManifest,
    'recovery',
    { request: recoveryRequest, migrations },
  );
  for (const addition of controlledPolicy.finance_security_advisor.f5_rpc_additions) {
    assert.equal(selected.some(item => item.advisor_fingerprint === addition.advisor_fingerprint), true);
  }
  for (const addition of controlledPolicy.finance_security_advisor.f5_relation_additions) {
    assert.equal(selected.some(item => item.advisor_fingerprint === addition.advisor_fingerprint), true);
  }
  assert.equal(selected.some(item => (
    item.object.name === 'creator_premium_finance_owner_attestations_f3_c2'
  )), true);

  for (const options of [
    { request: { ...recoveryRequest, recoverySourceRunId: '40268500711' }, migrations },
    { request: recoveryRequest, migrations: { ...migrations, count: migrations.count - 1 } },
    { request: recoveryRequest, migrations: { ...migrations, latest: rows.at(-2) } },
  ]) {
    const fallback = adapter.advisorExceptionsForPhase(
      controlledPolicy,
      recoveryManifest,
      'recovery',
      options,
    );
    assert.equal(controlledPolicy.finance_security_advisor.f5_rpc_additions.every(addition => (
      !fallback.some(item => item.advisor_fingerprint === addition.advisor_fingerprint)
    )), true);
    assert.equal(controlledPolicy.finance_security_advisor.f5_relation_additions.every(addition => (
      !fallback.some(item => item.advisor_fingerprint === addition.advisor_fingerprint)
    )), true);
  }
});

test('zero-Edge F4 recovery still binds the complete unchanged Edge inventory to the baseline', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(f4TransitionPolicy);
  const migrationRows = [
    ...Array.from({ length: 353 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    { version: '20261025231500', name: 'creator_premium_f3_final_wallet_integration' },
    { version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' },
  ];
  const migrations = {
    complete: true,
    count: migrationRows.length,
    items: migrationRows,
    latest: migrationRows.at(-1),
    sha256: sha256(canonicalJson(migrationRows)),
  };
  const managedSet = new Set(controlledPolicy.supabase.managed_functions);
  const functionRows = [
    ...controlledPolicy.supabase.managed_functions.map((slug, index) => ({
      slug, status: 'ACTIVE', version: index + 100, verify_jwt: true,
      ezbr_sha256: String(index + 100).padStart(64, '0'),
    })),
    ...Array.from({ length: 34 - controlledPolicy.supabase.managed_functions.length }, (_, index) => ({
      slug: `unmanaged-${String(index + 1).padStart(2, '0')}`,
      status: 'ACTIVE', version: index + 1, verify_jwt: true,
      ezbr_sha256: String(index + 1).padStart(64, '0'),
    })),
  ].sort((left, right) => left.slug.localeCompare(right.slug));
  const functions = {
    complete: true,
    count: functionRows.length,
    items: functionRows,
    sha256: sha256(canonicalJson(functionRows)),
  };
  const blocked = new Set(controlledPolicy.baseline.blocked_resources);
  const managed = functionRows.filter(item => managedSet.has(item.slug)).map(item => ({
    name: item.slug,
    source_sha256: item.ezbr_sha256,
    source_parity: !blocked.has(item.slug),
    verify_jwt: item.verify_jwt,
    version: item.version,
  })).sort((left, right) => left.name.localeCompare(right.name));
  const unmanaged = functionRows.filter(item => !managedSet.has(item.slug))
    .map(item => ({ name: item.slug, version: item.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const digest = value => sha256(canonicalJson(value));
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
  assert.equal(adapter.verifyRecoveryInfrastructureBaseline({
    policy: controlledPolicy,
    migrations,
    functions,
    expectedLatestMigration: '20261026030000_creator_premium_f4_general_bdag_activation',
    functionTransitions: [],
  }).migrations, controlledPolicy.baseline.evidence_digests.migrations);
  assert.throws(() => adapter.verifyRecoveryInfrastructureBaseline({
    policy: controlledPolicy,
    migrations,
    functions,
    expectedLatestMigration: '20261026030000_creator_premium_f4_general_bdag_activation',
    functionTransitions: undefined,
  }), /RECOVERY_POSTCHECK_FAILED/);

  for (const mutate of [
    item => { item.version += 1; },
    item => { item.ezbr_sha256 = 'f'.repeat(64); },
    item => { item.verify_jwt = false; },
  ]) {
    const drift = structuredClone(functions);
    mutate(drift.items[0]);
    drift.sha256 = digest(drift.items);
    assert.throws(() => adapter.verifyRecoveryInfrastructureBaseline({
      policy: controlledPolicy,
      migrations,
      functions: drift,
      expectedLatestMigration: '20261026030000_creator_premium_f4_general_bdag_activation',
      functionTransitions: [],
    }), /RECOVERY_POSTCHECK_FAILED/);
  }
});

test('F3 recovery capture requests only the successor RPC authority set', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const source = controlledPolicy.postcheck_recovery.approved_sources.find(item => item.run_id === '40166468648');
  assert.ok(source);
  const recoveryRequest = {
    ...request(),
    mode: 'postcheck_recovery',
    scopeConfirmation: 'POSTCHECK_RECOVERY_READ_ONLY',
    recoverySourceRunId: source.run_id,
  };
  const recoveryManifest = {
    ...manifest(),
    identity: { ...manifest().identity, mode: 'postcheck_recovery' },
    resources: { functions: [], function_contracts: [], migrations: [], config_changed: false },
  };
  const migrationRows = [
    ...Array.from({ length: source.expected_migration_count - 1 }, (_, index) => ({
      version: `2025${String(index).padStart(10, '0')}`,
      name: `historical_${String(index).padStart(3, '0')}`,
    })),
    {
      version: source.expected_latest_migration.slice(0, 14),
      name: source.expected_latest_migration.slice(15),
    },
  ];
  controlledPolicy.baseline.evidence_digests.migrations = sha256(canonicalJson(
    migrationRows.slice(0, -1).map(item => `${item.version}_${item.name}`),
  ));
  const calls = [];
  const fallback = successfulFetch(calls);
  let requestedRpcIdentities = null;
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/database/migrations')) {
      calls.push({ url: String(url), options });
      return jsonResponse(migrationRows);
    }
    if (pathname.endsWith('/database/query/read-only') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.query.includes('pg_get_function_identity_arguments')) {
        requestedRpcIdentities = JSON.parse(body.parameters[0]);
        throw new Error('stop-after-rpc-authority-selection');
      }
    }
    return fallback(url, options);
  };
  await assert.rejects(adapter.captureProductionSnapshot({
    phase: 'recovery',
    policy: controlledPolicy,
    request: recoveryRequest,
    manifest: recoveryManifest,
    token: 'never-retained',
    fetchImpl,
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  }), /REMOTE_READ_FAILED: RPC security attestation request failed/);
  assert.equal(requestedRpcIdentities.length, 20);
  assert.equal(requestedRpcIdentities.some(item => item.name === 'get_admin_creator_premium_finance_activation_v1'), true);
  assert.equal(requestedRpcIdentities.some(item => item.name === 'get_creator_premium_commerce_v2'), true);
  assert.equal(requestedRpcIdentities.some(item => item.name === 'get_my_creator_premium_subscriptions_v2'), true);
  assert.equal(requestedRpcIdentities.some(item => item.name === 'creator_premium_finance_authorizations'), false);
});

test('snapshot adapter never pretends to observe Supabase GitHub auto-deploy state', () => {
  const source = readFileSync(adapterUrl, 'utf8');
  assert.doesNotMatch(source, /SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED|auto_deploy_(?:evidence|expectation)|Deploy to production/);
});

function canonicalJson(value) {
  const normalize = item => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
    }
    return item;
  };
  return `${JSON.stringify(normalize(value))}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resignEvidence(evidence) {
  const { evidence_sha256: ignored, ...unsigned } = evidence;
  evidence.evidence_sha256 = sha256(canonicalJson(unsigned));
  return evidence;
}

function bindRpcSecurityEvidence(evidence, exceptions) {
  const items = exceptions
    .filter(exception => Array.isArray(exception?.object?.argument_types))
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
    }))
    .sort((left, right) => `${left.schema}.${left.name}(${left.argument_types.join(',')})`
      .localeCompare(`${right.schema}.${right.name}(${right.argument_types.join(',')})`));
  evidence.rpc_security = {
    complete: true,
    count: items.length,
    items,
    sha256: sha256(canonicalJson(items)),
  };
  return resignEvidence(evidence);
}

function request() {
  return {
    approvedSha: 'a'.repeat(40),
    releaseId: 'nelyon-20261012-001',
    runId: '123456789',
    runAttempt: 1,
  };
}

function manifest() {
  return {
    identity: {
      approved_sha: 'a'.repeat(40),
      release_id: 'nelyon-20261012-001',
      run_id: '123456789',
      run_attempt: 1,
    },
    compiler: {
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: '6'.repeat(64),
    },
    resources: {
      functions: ['content-safety-scan'],
      function_contracts: [{
        name: 'content-safety-scan',
        entrypoint: 'supabase/functions/content-safety-scan/index.ts',
        import_map: null,
        verify_jwt: true,
        source_changed: true,
        source_files: [{
          path: 'supabase/functions/content-safety-scan/index.ts',
          sha256: '9'.repeat(64),
        }],
        source_sha256: '8'.repeat(64),
      }],
      migrations: [],
    },
  };
}

function f2ManagedScopeManifest(overrides = {}) {
  const base = {
    identity: {
      approved_sha: 'a'.repeat(40),
      release_id: 'nelyon-20261012-001',
      run_id: '123456789',
      run_attempt: 1,
    },
    baseline: {
      state: 'verified',
      sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
      origin_main_sha: 'a'.repeat(40),
    },
    compiler: {
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: '6'.repeat(64),
    },
    resources: {
      functions: ['bdag-ledger'],
      function_contracts: [{
        name: 'bdag-ledger',
        entrypoint: 'supabase/functions/bdag-ledger/index.ts',
        import_map: null,
        verify_jwt: true,
        source_changed: true,
        source_files: [
          { path: 'supabase/functions/_shared/cors.ts', sha256: '225ca89a1d2e584317beef75c9bb76265496fb8a5e5a543f42c59f1dc1c78e29' },
          { path: 'supabase/functions/bdag-ledger/index.ts', sha256: '7feea234fc2624c5c2047d4807d8155ebc7ea461a2afb90627918dd9cde42b41' },
        ],
        source_sha256: '06a7f77242df926411f7aae44eb808f8bb1ce1e88b8a342376911f1e6519e8fa',
      }],
      migrations: [{
        blob: 'fce8789a0c79251afbe962bd39f6bd81ae248296',
        path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql',
        version: '20261024173500',
      }],
      config_changed: true,
      managed_scope_transition: {
        id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
        attested_source_sha: '97f6638acaa5be2af336b427184c11185e3d0fe1',
        approved_sha: 'a'.repeat(40),
        descendant_verified: true,
        migration_blob: 'fce8789a0c79251afbe962bd39f6bd81ae248296',
      },
    },
  };
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...(overrides.identity ?? {}) },
    baseline: { ...base.baseline, ...(overrides.baseline ?? {}) },
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
  };
}

function f2ManagedScopeTransition() {
  return {
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
}

function markManagedScopeTransitionPromoted(policyValue) {
  policyValue.baseline.sha = 'f'.repeat(40);
  return policyValue;
}

function zeroReconciliation() {
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
  };
}

function ledgerAccount(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id_sha256: '2'.repeat(64),
    account_type: 'user',
    currency: 'BDAG',
    created_at: '2026-10-01T12:00:00.000000Z',
    ...overrides,
  };
}

function financeSnapshot(overrides = {}) {
  const { ledger_accounts: ledgerAccountOverride, ...remainingOverrides } = overrides;
  const ledgerAccounts = ledgerAccountOverride?.items ?? [ledgerAccount()];
  return {
    schema_version: 1,
    complete: true,
    query_id: 'nelyon-finance-snapshot-v1',
    database_time: '2026-10-12T12:00:00.000000Z',
    schema_sha256: '1'.repeat(64),
    watermark: null,
    policy: {
      purchase_enabled: false,
      subscription_enabled: false,
      refunds_enabled: false,
      platform_fee_bps: 0,
      policy_version: 'creator-premium-b4-v1',
    },
    transactions: { complete: true, count: 0, items: [] },
    ledger_entries: { complete: true, count: 0, items: [] },
    ledger_accounts: { complete: true, count: ledgerAccounts.length, items: ledgerAccounts },
    premium_transaction_count: 0,
    premium_bindings: {
      purchase_receipts: { count: 0, sha256: '3'.repeat(64) },
      subscription_periods: { count: 0, sha256: '4'.repeat(64) },
    },
    reconciliation: zeroReconciliation(),
    ...remainingOverrides,
  };
}

function cronSnapshot() {
  return {
    schema_version: 1,
    complete: true,
    query_id: 'nelyon-cron-snapshot-v1',
    count: 0,
    items: [],
  };
}

const PROTECTED_TEST_RPC_IDENTITIES = [
  ['admin_refund_creator_premium_purchase_v1', ['uuid', 'uuid', 'text']],
  ['admin_refund_creator_premium_subscription_period_v1', ['uuid', 'uuid', 'text']],
  ['admin_review_creator_premium_content_v1', ['uuid', 'text', 'text', 'uuid']],
  ['get_admin_creator_premium_content_v1', ['uuid']],
  ['get_admin_creator_premium_refund_candidates_v1', ['uuid']],
  ['get_creator_premium_commerce_v1', ['uuid']],
  ['get_my_creator_premium_commercial_summary_v1', ['timestamp with time zone', 'timestamp with time zone']],
  ['get_my_creator_premium_financial_history_v1', ['text', 'text', 'timestamp with time zone', 'uuid', 'integer']],
  ['get_my_creator_premium_subscriptions_v1', ['timestamp with time zone', 'uuid', 'integer']],
  ['reopen_my_creator_premium_rejected_v1', ['uuid']],
  ['report_creator_premium_content_v1', ['uuid', 'text', 'text']],
  ['search_admin_creator_premium_content_v1', ['text', 'text', 'timestamp with time zone', 'uuid', 'integer']],
  ['search_admin_creator_premium_finance_v1', ['text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer']],
  ['cancel_my_creator_premium_submission_v1', ['uuid']],
  ['submit_my_creator_premium_content_with_plans_v1', ['uuid', 'uuid[]', 'uuid']],
  ['retire_my_creator_premium_content_v1', ['uuid']],
  ['delete_my_creator_premium_plan_draft_v1', ['uuid', 'uuid']],
  ['ensure_my_ledger_account', []],
];

function rpcSecurityRows(overrides = {}) {
  return PROTECTED_TEST_RPC_IDENTITIES.map(([name, argumentTypes]) => ({
    schema: 'public',
    name,
    identity_arguments: argumentTypes.join(', '),
    argument_types: argumentTypes,
    security_definer: true,
    owner: 'postgres',
    search_path: ['search_path='],
    acl: [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }],
    execute: { public: false, anon: false, authenticated: true, service_role: false },
    definition: `CREATE FUNCTION public.${name}(${argumentTypes.join(',')})\r\nRETURNS jsonb\r\nSECURITY DEFINER`,
    ...(overrides[name] ?? {}),
  }));
}

function rpcSecurityRowsBeforeWallet(overrides = {}) {
  return rpcSecurityRows(overrides).filter(row => row.name !== 'ensure_my_ledger_account');
}

function premiumPostcheckSnapshot(overrides = {}) {
  return {
    schema_version: 1,
    complete: true,
    query_id: 'nelyon-premium-postcheck-state-v1',
    approved_rule_count: 0,
    active_rule_count: 0,
    fabricated_pass_count: 0,
    content_count: 2,
    pending_review_count: 1,
    deleted_count: 1,
    relations: [{
      schema: 'private',
      name: 'creator_premium_contents',
      owner: 'postgres',
      rls_enabled: true,
      force_rls: true,
      acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
    }],
    ...overrides,
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function healthyServices() {
  return ['auth', 'db', 'pooler', 'realtime', 'rest', 'storage']
    .map(name => ({ healthy: true, name, status: 'ACTIVE_HEALTHY' }));
}

function completedPhysicalBackup(overrides = {}) {
  return {
    id: '2026-10-12T05:15:56.590Z',
    inserted_at: '2026-10-12T05:15:56.590Z',
    is_physical_backup: true,
    status: 'COMPLETED',
    ...overrides,
  };
}

function successfulFetch(log, overrides = {}) {
  return async (url, options = {}) => {
    log.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/health')) return jsonResponse(overrides.health ?? healthyServices());
    if (pathname.endsWith('/database/migrations')) {
      return jsonResponse([{ version: '20261009021414', name: 'creator_premium_b5_creator_management_ux' }]);
    }
    if (pathname.endsWith('/functions')) {
      return jsonResponse(overrides.functions ?? [{ slug: 'content-safety-scan', status: 'ACTIVE', version: 35, verify_jwt: true, ezbr_sha256: '5'.repeat(64) }]);
    }
    if (pathname.endsWith('/database/backups')) {
      return jsonResponse({
        backups: overrides.backups ?? [completedPhysicalBackup()],
        pitr_enabled: false,
        region: 'us-east-1',
        walg_enabled: true,
      });
    }
    if (pathname.endsWith('/advisors/security')) return jsonResponse(overrides.advisors ?? { lints: [] });
    if (pathname.endsWith('/database/query/read-only')) {
      const body = JSON.parse(options.body);
      if (body.query.includes('nelyon-finance-snapshot-v1')) {
        return jsonResponse([{ snapshot: overrides.finance ?? financeSnapshot() }], 201);
      }
      if (body.query.includes('nelyon-cron-snapshot-v1')) {
        return jsonResponse([{ snapshot: overrides.cron ?? cronSnapshot() }], 201);
      }
      if (body.query.includes('pg_get_function_identity_arguments')) {
        return jsonResponse(overrides.rpcSecurity ?? rpcSecurityRows(), 201);
      }
      if (body.query.includes('nelyon-premium-postcheck-state-v1')) {
        return jsonResponse([{ snapshot: overrides.premiumState ?? premiumPostcheckSnapshot() }], 201);
      }
      throw new Error('unexpected read-only SQL query');
    }
    throw new Error(`unexpected request ${url}`);
  };
}

function successfulFetchWithFunctionVersion(log, version, overrides = {}) {
  const base = successfulFetch(log, overrides);
  return async (url, options = {}) => {
    if (new URL(url).pathname.endsWith('/functions')) {
      log.push({ url: String(url), options });
      return jsonResponse([{
        slug: 'content-safety-scan',
        status: 'ACTIVE',
        version,
        verify_jwt: true,
        ezbr_sha256: String(version).padStart(64, '0'),
      }]);
    }
    return base(url, options);
  };
}

test('F3 foundation complete snapshot pair binds catalog phase and rejects resigned hostile evidence', async () => {
  const adapter = await loadAdapter();
  const m = f3FoundationManifest();
  const controlled = structuredClone(policy);
  controlled.baseline.migration_count = 1;
  controlled.supabase.expected_remote_function_count = 1;
  controlled.supabase.managed_functions = ['bdag-ledger'];
  const pair = {};
  for (const phase of ['pre','post']) {
    const e = await adapter.captureProductionSnapshot({ phase, policy, request: request(), manifest: manifest(),
      token: 'local-fixture-token', fetchImpl: successfulFetch([]),
      observedAt: phase === 'pre' ? '2026-10-12T12:00:01.000Z' : '2026-10-12T12:01:01.000Z', adapterSourceSha256: '6'.repeat(64) });
    const catalogPhase = phase === 'pre' ? 'legacy' : 'f3_foundation';
    const expected = policy.finance_authority[catalogPhase];
    const authority = { schema_version: 1, complete: true, phase: catalogPhase,
      relations: expected.relations, functions: expected.functions,
      legacy_functions: expected.legacy_function_identities.map(identity=>({identity,sha256:'a'.repeat(64)})),
      legacy_relations: ['public.financial_transactions','public.ledger_accounts','public.ledger_entries']
        .map(identity => ({ identity, sha256: 'a'.repeat(64) })) };
    e.finance_authority = { ...authority, sha256: sha256(canonicalJson(authority)) };
    e.finance_facts = { schema_version: 1, complete: true, phase: catalogPhase,
      policy: { activation_mode: 'off', active_authorization_id: null, purchase_enabled: false,
        subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 },
      authorizations: [], receipts: [], periods: [], subscriptions: [], transactions: [],
      acquisition_exposure_bdag: '0.00000000', release_movement_bdag: '0.00000000', reconciliation: { purchase_binding_mismatches: 0, period_binding_mismatches: 0 } };
    const items = [{ version:'20261024173500', name:'creator_premium_f2_complete_monetization' },
      ...(phase === 'post' ? [{version:'20261025011000',name:'creator_premium_f3_bounded_financial_activation'}] : [])];
    e.migrations = { complete:true,count:items.length,items,latest:items.at(-1),sha256:sha256(canonicalJson(items)) };
    const queries = adapter.selectFinanceSnapshotQueries(e.migrations);
    e.adapter.queries.push({id:'nelyon-finance-authority-v1',sha256:sha256(queries.authority)},
      {id:`nelyon-finance-facts-${catalogPhase}-v1`,sha256:sha256(queries.facts)});
    e.requests.push(...[1,2].map(() => ({method:'POST',path:'/v1/projects/aewwdlvbwpczqyvkwvvj/database/query/read-only',status:201,response_sha256:'a'.repeat(64)})));
    e.identity.manifest_sha256 = sha256(canonicalJson(m));
    const functions = [{slug:'bdag-ledger',status:'ACTIVE',verify_jwt:true,version:phase==='pre'?6:7,ezbr_sha256:phase==='pre'?'a'.repeat(64):'b'.repeat(64)}];
    e.functions = {complete:true,count:1,items:functions,sha256:sha256(canonicalJson(functions))};
    const exceptions = adapter.advisorExceptionsForPhase(policy,m,phase);
    const advisors = exceptions.map(x=>({fingerprint:x.advisor_fingerprint,level:x.advisor_severity,resource_kind:x.advisor_type})).sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint));
    e.cron_security.advisors={complete:true,count:advisors.length,items:advisors,sha256:sha256(canonicalJson(advisors))};
    e.finance.schema_sha256=expected.schema_sha256;
    if (phase==='post') {
      const state=premiumPostcheckSnapshot();
      state.relations.push({schema:'private',name:'creator_premium_finance_authorizations',owner:'postgres',rls_enabled:true,force_rls:true,
        acl:['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'].map(privilege_type=>({grantee:'postgres',privilege_type,is_grantable:false}))});
      e.premium_state=adapter.normalizePremiumPostcheckState(state);
    }
    bindRpcSecurityEvidence(e,exceptions);
    pair[phase]=e;
  }
  controlled.baseline.evidence_digests=adapter.buildProductionBaselineDigests({evidence:pair.pre,policy:controlled});
  const input={...pair,policy:controlled,request:request(),manifest:m,adapterSourceSha256:'6'.repeat(64)};
  assert.equal(adapter.verifyProductionSnapshotPair(input).result,'REMOTE_POSTCHECK_VERIFIED');
  for (const mutate of [
    e=>{delete e.finance_authority;}, e=>{delete e.finance_facts;},
    e=>{e.finance_authority.functions.pop();},
    e=>{e.finance_facts.authorizations.push({id_sha256:'a'.repeat(64)});},
    e=>{e.finance_facts.release_movement_bdag='1.00000000';},
    e=>{e.finance_authority.phase='legacy';},
    e=>{e.finance_authority.relations.find(row=>row.identity==='private.creator_premium_purchase_receipts').sha256='a36e29bc8d8e2df1b9df71d7a001f43346e799f0773e25c63289a05aab7b7e26';
      const {sha256:ignored,...unsigned}=e.finance_authority;e.finance_authority.sha256=sha256(canonicalJson(unsigned));},
    e=>{e.finance_authority.legacy_functions[0].sha256='b'.repeat(64);const {sha256:ignored,...unsigned}=e.finance_authority;e.finance_authority.sha256=sha256(canonicalJson(unsigned));},
    e=>{e.finance_authority.legacy_relations[0].sha256='b'.repeat(64);const {sha256:ignored,...unsigned}=e.finance_authority;e.finance_authority.sha256=sha256(canonicalJson(unsigned));},
    e=>{e.adapter.queries.at(-1).sha256='f'.repeat(64);},
    e=>{e.premium_state.relation_security.items.find(r=>r.name==='creator_premium_finance_authorizations').acl.push({grantee:'authenticated',privilege_type:'SELECT',is_grantable:false});
      e.premium_state.relation_security.sha256=sha256(canonicalJson(e.premium_state.relation_security.items));
      const {sha256:ignored,...unsigned}=e.premium_state;e.premium_state.sha256=sha256(canonicalJson(unsigned));},
    e=>{e.migrations.items.at(-1).name='wrong';e.migrations.sha256=sha256(canonicalJson(e.migrations.items));},
    e=>{e.cron_security.advisors.items=e.cron_security.advisors.items.filter(item=>item.fingerprint!=='8088d6be7ca6bd32b041ed429091a56f26d26ac0d7148eb5bf15f9e3c5e70bd6');
      e.cron_security.advisors.count=e.cron_security.advisors.items.length;e.cron_security.advisors.sha256=sha256(canonicalJson(e.cron_security.advisors.items));},
  ]) {const hostile=structuredClone(pair.post);mutate(hostile);resignEvidence(hostile);
    assert.throws(()=>adapter.verifyProductionSnapshotPair({...input,post:hostile}));}
  assert.throws(()=>adapter.verifyProductionSnapshotPair({...input,request:{...request(),approvedSha:'b'.repeat(40)}}),/INVALID_SNAPSHOT_IDENTITY/);
});

test('F3-C2 complete snapshot pair preserves foundation findings and permits only the exact C2 advisor delta', async () => {
  const adapter = await loadAdapter();
  const m = f3C2Manifest();
  const controlled = structuredClone(c2TransitionPolicy);
  controlled.baseline.migration_count = 2;
  controlled.supabase.expected_remote_function_count = 1;
  controlled.supabase.managed_functions = ['content-safety-scan'];
  const effectiveAuthority = phase => {
    if (phase === 'f3_foundation') return controlled.finance_authority.f3_foundation;
    const c2 = controlled.finance_authority.f3_c2;
    const functions = new Map(controlled.finance_authority.f3_foundation.functions
      .map(row => [row.identity, row]));
    for (const row of c2.function_overrides) functions.set(row.identity, row);
    for (const row of c2.function_additions) functions.set(row.identity, row);
    return { relations: c2.relations, functions: [...functions.values()].sort((a, b) => a.identity.localeCompare(b.identity)),
      legacy_function_identities: controlled.finance_authority.f3_foundation.legacy_function_identities,
      schema_sha256: c2.schema_sha256 };
  };
  const pair = {};
  for (const phase of ['pre','post']) {
    const e = await adapter.captureProductionSnapshot({ phase, policy, request: request(), manifest: manifest(),
      token: 'local-fixture-token', fetchImpl: successfulFetch([]),
      observedAt: phase === 'pre' ? '2026-10-12T12:00:01.000Z' : '2026-10-12T12:01:01.000Z',
      adapterSourceSha256: '6'.repeat(64) });
    const catalogPhase = phase === 'pre' ? 'f3_foundation' : 'f3_c2';
    const expected = effectiveAuthority(catalogPhase);
    const authority = { schema_version: 1, complete: true, phase: catalogPhase,
      relations: expected.relations, functions: expected.functions,
      legacy_functions: expected.legacy_function_identities.map(identity => ({ identity, sha256: 'a'.repeat(64) })),
      legacy_relations: ['public.financial_transactions','public.ledger_accounts','public.ledger_entries']
        .map(identity => ({ identity, sha256: 'a'.repeat(64) })) };
    e.finance_authority = { ...authority, sha256: sha256(canonicalJson(authority)) };
    e.finance_facts = { schema_version: 1, complete: true, phase: catalogPhase,
      policy: { activation_mode: 'off', active_authorization_id: null, purchase_enabled: false,
        subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 },
      ...(phase === 'post' ? { attestations: [] } : {}),
      authorizations: [], receipts: [], periods: [], subscriptions: [], transactions: [],
      acquisition_exposure_bdag: '0.00000000', release_movement_bdag: '0.00000000',
      reconciliation: { purchase_binding_mismatches: 0, period_binding_mismatches: 0 } };
    const items = [
      { version:'20261024173500', name:'creator_premium_f2_complete_monetization' },
      { version:'20261025011000', name:'creator_premium_f3_bounded_financial_activation' },
      ...(phase === 'post' ? [{ version:'20261025160452', name:'creator_premium_f3_c2_isolated_canary_governance' }] : []),
    ];
    e.migrations = { complete:true,count:items.length,items,latest:items.at(-1),sha256:sha256(canonicalJson(items)) };
    const queries = adapter.selectFinanceSnapshotQueries(e.migrations);
    e.adapter.queries.push({ id:'nelyon-finance-authority-v1', sha256:sha256(queries.authority) },
      { id:`nelyon-finance-facts-${catalogPhase}-v1`, sha256:sha256(queries.facts) });
    e.requests.push(...[1,2].map(() => ({ method:'POST', path:'/v1/projects/aewwdlvbwpczqyvkwvvj/database/query/read-only',
      status:201,response_sha256:'a'.repeat(64) })));
    e.identity.manifest_sha256 = sha256(canonicalJson(m));
    const functions = [{ slug:'content-safety-scan', status:'ACTIVE', verify_jwt:true, version:35,
      ezbr_sha256:'a'.repeat(64) }];
    e.functions = { complete:true,count:1,items:functions,sha256:sha256(canonicalJson(functions)) };
    const exceptions = adapter.advisorExceptionsForPhase(controlled,m,phase);
    const advisors = exceptions.map(value => ({ fingerprint:value.advisor_fingerprint,
      level:value.advisor_severity,resource_kind:value.advisor_type }))
      .sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint));
    e.cron_security.advisors = { complete:true,count:advisors.length,items:advisors,
      sha256:sha256(canonicalJson(advisors)) };
    e.finance.schema_sha256 = expected.schema_sha256;
    if (phase === 'post') {
      const state = premiumPostcheckSnapshot();
      state.relations.push({ schema:'private',name:'creator_premium_finance_owner_attestations_f3_c2',
        owner:'postgres',rls_enabled:true,force_rls:true,
        acl:['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
          .map(privilege_type=>({grantee:'postgres',privilege_type,is_grantable:false})) });
      e.premium_state = adapter.normalizePremiumPostcheckState(state);
    }
    bindRpcSecurityEvidence(e, exceptions);
    pair[phase] = e;
  }
  controlled.baseline.evidence_digests = adapter.buildProductionBaselineDigests({ evidence:pair.pre,policy:controlled });
  const input = { ...pair,policy:controlled,request:request(),manifest:m,adapterSourceSha256:'6'.repeat(64) };
  assert.equal(adapter.verifyProductionSnapshotPair(input).result, 'REMOTE_POSTCHECK_VERIFIED');
  const postFingerprints = new Set(adapter.advisorExceptionsForPhase(controlled,m,'post')
    .map(item => item.advisor_fingerprint));
  for (const finding of adapter.advisorExceptionsForPhase(controlled,m,'pre')) {
    assert.equal(postFingerprints.has(finding.advisor_fingerprint), true,
      `C2 must preserve pre-existing advisor finding ${finding.object.name}`);
  }
});

test('health evidence requires the exact documented service set with healthy=true', async () => {
  const adapter = await loadAdapter();
  await assert.rejects(adapter.captureProductionSnapshot({
    phase: 'pre',
    policy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetch([], { health: [{ healthy: true, name: 'db', status: 'ACTIVE_HEALTHY' }] }),
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  }), /UNHEALTHY_REMOTE_PROJECT|INVALID_REMOTE_INVENTORY/);
});

test('adapter uses only fixed documented read-only endpoints and produces sanitized bound evidence', async () => {
  const adapter = await loadAdapter();
  const calls = [];
  const result = await adapter.captureProductionSnapshot({
    phase: 'pre',
    policy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetch(calls),
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(result.complete, true);
  assert.equal(result.phase, 'pre');
  assert.equal(result.project_ref, policy.supabase.project_ref);
  assert.equal(result.finance.reconciliation.orphan_ledger_entries, 0);
  assert.deepEqual(result.backup, completedPhysicalBackup());
  assert.match(result.evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.map(call => call.options.method ?? 'GET'), ['GET', 'GET', 'GET', 'GET', 'GET', 'POST', 'POST', 'POST', 'POST']);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'api.supabase.com');
    assert.match(url.pathname, new RegExp(`/v1/projects/${policy.supabase.project_ref}/`));
    assert.equal(call.options.redirect, 'error');
  }
  const sqlCalls = calls.filter(call => (call.options.method ?? 'GET') === 'POST');
  assert.equal(sqlCalls.length, 4);
  assert.ok(sqlCalls.every(call => new URL(call.url).pathname.endsWith('/database/query/read-only')));
  assert.ok(sqlCalls.every(call => !new URL(call.url).pathname.endsWith('/database/query')));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-read-token/);
  assert.doesNotMatch(serialized, /authorization/i);
});

test('snapshot fails closed unless a recent completed physical backup exists', async () => {
  const adapter = await loadAdapter();
  for (const backups of [
    [],
    [completedPhysicalBackup({ status: 'FAILED' })],
    [completedPhysicalBackup({ is_physical_backup: false })],
    [completedPhysicalBackup({ inserted_at: '2026-10-10T12:00:00.000Z' })],
  ]) {
    await assert.rejects(adapter.captureProductionSnapshot({
      phase: 'pre',
      policy,
      request: request(),
      manifest: manifest(),
      token: 'scoped-deployment-token',
      fetchImpl: successfulFetch([], { backups }),
      observedAt: '2026-10-12T12:00:01.000Z',
      adapterSourceSha256: '6'.repeat(64),
    }), /INVALID_BACKUP|STALE_BACKUP/);
  }
});

test('ledger identity inventory accepts every account type present in the canonical schema', async () => {
  const adapter = await loadAdapter();
  const types = [
    'user', 'escrow', 'treasury', 'platform', 'marketplace_escrow',
    'marketplace_ads_escrow', 'marketplace_ads_revenue', 'marketplace_return_escrow',
  ];
  const items = types.map((accountType, index) => ledgerAccount({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    owner_id_sha256: accountType === 'user' ? '2'.repeat(64) : null,
    account_type: accountType,
  }));
  const result = await adapter.captureProductionSnapshot({
    phase: 'pre', policy, request: request(), manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetch([], { finance: financeSnapshot({ ledger_accounts: { items } }) }),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  assert.deepEqual(result.finance.ledger_accounts.items.map(item => item.account_type), types);
});

test('SQL allowlist rejects mutations multiple statements and application reconciler invocation', async () => {
  const adapter = await loadAdapter();
  assert.equal(adapter.assertReadOnlySql(adapter.FINANCE_SNAPSHOT_SQL), true);
  assert.equal(adapter.assertReadOnlySql(adapter.CRON_SNAPSHOT_SQL), true);
  for (const sql of [
    'select 1; delete from public.users',
    'update public.users set email = email',
    'select public.reconcile_creator_premium_publications_v1(25)',
    'copy public.users to stdout',
  ]) {
    assert.throws(() => adapter.assertReadOnlySql(sql), /READ_ONLY_QUERY_REJECTED/);
  }
});

test('RPC security SQL and Premium postcheck SQL are fixed documented read-only statements', async () => {
  const adapter = await loadAdapter();
  assert.equal(adapter.assertReadOnlySql(adapter.RPC_SECURITY_ATTESTATION_SQL), true);
  assert.equal(adapter.assertReadOnlySql(adapter.PREMIUM_POSTCHECK_STATE_SQL), true);
  assert.match(adapter.RPC_SECURITY_ATTESTATION_SQL, /jsonb_to_recordset\(\$1::jsonb\)/i);
  for (const contract of [
    /pg_catalog\.pg_proc/i,
    /pg_catalog\.pg_namespace/i,
    /pg_catalog\.pg_roles/i,
    /pg_catalog\.aclexplode/i,
    /pg_catalog\.pg_get_function_identity_arguments/i,
    /pg_catalog\.pg_get_functiondef/i,
  ]) assert.match(adapter.RPC_SECURITY_ATTESTATION_SQL, contract);
  for (const contract of [
    /private\.content_safety_rules/i,
    /private\.creator_premium_contents/i,
    /private\.content_safety_scans/i,
    /pg_catalog\.pg_class/i,
    /pg_catalog\.aclexplode/i,
  ]) assert.match(adapter.PREMIUM_POSTCHECK_STATE_SQL, contract);
  assert.doesNotMatch(`${adapter.RPC_SECURITY_ATTESTATION_SQL}\n${adapter.PREMIUM_POSTCHECK_STATE_SQL}`, /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i);
});

test('RPC security normalization preserves overload identity hashes definitions and fails closed on attestation drift', async () => {
  const adapter = await loadAdapter();
  const raw = rpcSecurityRows();
  const snapshot = adapter.normalizeRpcSecurityAttestations(raw);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.count, 18);
  assert.equal(snapshot.items.length, 18);
  assert.deepEqual(snapshot.items.map(item => item.name), [...snapshot.items.map(item => item.name)].sort());
  const firstRaw = raw.find(item => item.name === snapshot.items[0].name);
  assert.equal(
    snapshot.items[0].definition_sha256,
    createHash('sha256').update(firstRaw.definition.replace(/\r\n?/g, '\n')).digest('hex'),
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /CREATE FUNCTION|RETURNS jsonb/);
  assert.deepEqual(snapshot.items[0].execute, {
    public: false, anon: false, authenticated: true, service_role: false,
  });

  const exceptions = snapshot.items.map(item => ({
    object: {
      schema: item.schema,
      name: item.name,
      identity_arguments: item.identity_arguments,
      argument_types: item.argument_types,
    },
    attestation: {
      security_definer: item.security_definer,
      owner: item.owner,
      search_path: item.search_path,
      acl: item.acl,
      execute: item.execute,
      definition_sha256: item.definition_sha256,
    },
  }));
  assert.equal(adapter.validateRpcSecurityAttestations(snapshot, exceptions), true);
  const mutations = [
    list => list.slice(1),
    list => [...list, structuredClone(list[0])],
    list => [...list, { ...structuredClone(list[0]), object: { ...list[0].object, name: 'unexpected_rpc' } }],
    list => list.map((item, index) => index ? item : { ...structuredClone(item), attestation: { ...item.attestation, owner: 'other_owner' } }),
    list => list.map((item, index) => index ? item : { ...structuredClone(item), attestation: { ...item.attestation, acl: [] } }),
    list => list.map((item, index) => index ? item : { ...structuredClone(item), attestation: { ...item.attestation, search_path: ['search_path=public'] } }),
    list => list.map((item, index) => index ? item : { ...structuredClone(item), attestation: { ...item.attestation, security_definer: false } }),
    list => list.map((item, index) => index ? item : { ...structuredClone(item), object: { ...item.object, identity_arguments: `${item.object.identity_arguments}, text` } }),
    list => list.map((item, index) => index ? item : { ...structuredClone(item), attestation: { ...item.attestation, definition_sha256: 'f'.repeat(64) } }),
  ];
  for (const mutate of mutations) {
    assert.throws(() => adapter.validateRpcSecurityAttestations(snapshot, mutate(exceptions)), /RPC_SECURITY_ATTESTATION_FAILED/);
  }
  const overload = adapter.normalizeRpcSecurityAttestations([
    raw[0],
    { ...raw[0], identity_arguments: 'uuid, text', argument_types: ['uuid', 'text'], definition: `${raw[0].definition}\n-- overload` },
  ]);
  assert.equal(overload.count, 2);
  assert.notEqual(overload.items[0].identity_arguments, overload.items[1].identity_arguments);
});

test('Premium postcheck state preserves historical minima while allowing a fully drained review queue', async () => {
  const adapter = await loadAdapter();
  const state = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot());
  assert.equal(adapter.validatePremiumPostcheckState(state, state.relation_security.items), true);
  assert.deepEqual(state.content_safety, {
    approved_rule_count: 0,
    active_rule_count: 0,
    fabricated_pass_count: 0,
  });
  assert.deepEqual(state.legacy, { content_count: 2, pending_review_count: 1, deleted_count: 1 });
  const physicalQaState = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    content_count: 3,
    pending_review_count: 2,
  }));
  assert.equal(adapter.validatePremiumPostcheckState(physicalQaState, state.relation_security.items), true);
  assert.equal(adapter.validatePremiumStateTransition(physicalQaState, structuredClone(physicalQaState)), true);
  assert.throws(() => adapter.validatePremiumStateTransition(physicalQaState, state), /PREMIUM_POSTCHECK_FAILED/);
  const drainedQueueState = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    pending_review_count: 0,
  }));
  assert.equal(adapter.validatePremiumPostcheckState(drainedQueueState, state.relation_security.items), true);
  for (const drift of [
    { content_safety: { ...state.content_safety, approved_rule_count: 1 } },
    { content_safety: { ...state.content_safety, active_rule_count: 1 } },
    { content_safety: { ...state.content_safety, fabricated_pass_count: 1 } },
    { legacy: { ...state.legacy, content_count: 1 } },
    { legacy: { ...state.legacy, pending_review_count: -1 } },
    { legacy: { ...state.legacy, deleted_count: 0 } },
    { legacy: { ...state.legacy, content_count: 2, pending_review_count: 2, deleted_count: 1 } },
  ]) assert.throws(() => adapter.validatePremiumPostcheckState({ ...state, ...drift }, state.relation_security.items), /PREMIUM_POSTCHECK_FAILED/);

  const relation = state.relation_security.items[0];
  for (const expectedRelations of [
    [],
    [relation, { ...relation, name: 'creator_premium_extra' }],
    [{ ...relation, owner: 'other_owner' }],
    [{ ...relation, rls_enabled: false }],
    [{ ...relation, force_rls: false }],
    [{ ...relation, acl: [] }],
  ]) assert.throws(() => adapter.validatePremiumPostcheckState(state, expectedRelations), /PREMIUM_POSTCHECK_FAILED/);
});

test('Premium transition permits only the exact P2 relation addition bound to the exact manifest migration', async () => {
  const adapter = await loadAdapter();
  const originalRelation = premiumPostcheckSnapshot().relations[0];
  const p2Relation = {
    schema: 'private',
    name: 'creator_premium_content_safety_context_evaluations',
    owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
  };
  const pre = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot());
  const post = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    relations: [p2Relation, originalRelation],
  }));
  const p2Manifest = {
    resources: {
      migrations: [{
        path: 'supabase/migrations/20261018170000_creator_premium_content_safety_p2_evidence_runtime.sql',
        version: '20261018170000',
      }],
    },
  };

  assert.equal(adapter.validatePremiumStateTransition(pre, post, p2Manifest), true);
  for (const manifestCandidate of [
    { resources: { migrations: [] } },
    { resources: { migrations: [{ ...p2Manifest.resources.migrations[0], version: '20261018170001' }] } },
    { resources: { migrations: [{ ...p2Manifest.resources.migrations[0], path: 'supabase/migrations/20261018170000_wrong.sql' }] } },
  ]) {
    assert.throws(() => adapter.validatePremiumStateTransition(pre, post, manifestCandidate), /PREMIUM_POSTCHECK_FAILED/);
  }

  const unexpected = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    relations: [p2Relation, originalRelation, { ...p2Relation, name: 'creator_premium_unapproved_relation' }],
  }));
  assert.throws(() => adapter.validatePremiumStateTransition(pre, unexpected, p2Manifest), /PREMIUM_POSTCHECK_FAILED/);

  const changedExisting = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    relations: [
      p2Relation,
      { ...originalRelation, acl: [...originalRelation.acl, { grantee: 'postgres', privilege_type: 'UPDATE', is_grantable: false }] },
    ],
  }));
  assert.throws(() => adapter.validatePremiumStateTransition(pre, changedExisting, p2Manifest), /PREMIUM_POSTCHECK_FAILED/);
});

test('F3-C2 Premium transition permits only the owner-only attestation relation', async () => {
  const adapter = await loadAdapter();
  const originalRelation = premiumPostcheckSnapshot().relations[0];
  const attestationRelation = {
    schema: 'private',
    name: 'creator_premium_finance_owner_attestations_f3_c2',
    owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    acl: ['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
  };
  const pre = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot());
  const post = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
    relations: [attestationRelation, originalRelation],
  }));
  assert.equal(adapter.validatePremiumStateTransition(pre, post, f3C2Manifest(), c2TransitionPolicy), true);
  for (const changed of [
    { ...attestationRelation, owner: 'supabase_admin' },
    { ...attestationRelation, rls_enabled: false },
    { ...attestationRelation, force_rls: false },
    { ...attestationRelation, acl: attestationRelation.acl.slice(1) },
  ]) {
    const invalid = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({
      relations: [changed, originalRelation],
    }));
    assert.throws(() => adapter.validatePremiumStateTransition(pre, invalid, f3C2Manifest(), c2TransitionPolicy),
      /PREMIUM_POSTCHECK_FAILED/);
  }
});

test('F5 Premium transition permits exactly two owner-only renewal relations', async () => {
  const adapter = await loadAdapter();
  const originalRelation = premiumPostcheckSnapshot().relations[0];
  const ownerOnly = name => ({
    schema: 'private', name, owner: 'postgres', rls_enabled: true, force_rls: true,
    acl: ['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
  });
  const attempts = ownerOnly('creator_premium_auto_renewal_attempts');
  const mandates = ownerOnly('creator_premium_auto_renewal_mandates');
  const pre = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot());
  const transitionPolicy = structuredClone(installedPolicy);
  transitionPolicy.baseline.sha = installedPolicy.finance_authority_f5_transition.baseline_sha;
  transitionPolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
  const valid = relations => adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot({ relations }));
  const post = valid([attempts, mandates, originalRelation]);
  assert.equal(adapter.validatePremiumStateTransition(pre, post, f5AutonomousManifest(), transitionPolicy), true);
  for (const relations of [
    [attempts, originalRelation],
    [attempts, mandates, ownerOnly('creator_premium_unapproved_relation'), originalRelation],
    [{ ...attempts, owner: 'supabase_admin' }, mandates, originalRelation],
    [attempts, { ...mandates, rls_enabled: false }, originalRelation],
    [attempts, { ...mandates, force_rls: false }, originalRelation],
    [attempts, { ...mandates, acl: mandates.acl.slice(1) }, originalRelation],
  ]) assert.throws(() => adapter.validatePremiumStateTransition(
    pre, valid(relations), f5AutonomousManifest(), transitionPolicy,
  ), /PREMIUM_POSTCHECK_FAILED/);
});

test('fixed documented recovery capture uses four read-only SQL requests and redacts credentials', async () => {
  const adapter = await loadAdapter();
  const calls = [];
  const result = await adapter.captureProductionSnapshot({
    phase: 'recovery', policy, request: request(), manifest: manifest(),
    token: 'never-serialize-recovery-token', fetchImpl: successfulFetch(calls, { rpcSecurity: rpcSecurityRowsBeforeWallet() }),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(result.phase, 'recovery');
  assert.equal(result.rpc_security.count, 17);
  assert.equal(result.premium_state.complete, true);
  assert.equal(calls.length, 9);
  const sqlCalls = calls.filter(call => (call.options.method ?? 'GET') === 'POST');
  assert.equal(sqlCalls.length, 4);
  assert.ok(sqlCalls.every(call => new URL(call.url).pathname.endsWith('/database/query/read-only')));
  assert.doesNotMatch(JSON.stringify(result), /never-serialize-recovery-token|authorization|CREATE FUNCTION/i);
});

test('recovery snapshot verifies exact exception attestations and remains read only', async () => {
  const adapter = await loadAdapter();
  const recovery = await adapter.captureProductionSnapshot({
    phase: 'recovery', policy, request: request(), manifest: manifest(),
    token: 'never-serialize-recovery-token', fetchImpl: successfulFetch([], { rpcSecurity: rpcSecurityRowsBeforeWallet() }),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  const recoveryMigrations = { items: [{ version: '20261009021414', name: 'creator_premium_b5_creator_management_ux' }] };
  const items = adapter.advisorExceptionsForPhase(policy, manifest(), 'recovery', { migrations: recoveryMigrations })
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
  recovery.rpc_security = { complete: true, count: items.length, items, sha256: sha256(canonicalJson(items)) };
  const { evidence_sha256: ignored, ...unsigned } = recovery;
  recovery.evidence_sha256 = sha256(canonicalJson(unsigned));
  assert.equal(adapter.verifyProductionRecoverySnapshot({
    recovery,
    policy,
    request: request(),
    manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'RECOVERY_SNAPSHOT_VERIFIED');

  const drifted = structuredClone(recovery);
  drifted.rpc_security.items[0].owner = 'other_owner';
  drifted.rpc_security.sha256 = sha256(canonicalJson(drifted.rpc_security.items));
  const { evidence_sha256: omitted, ...driftedUnsigned } = drifted;
  drifted.evidence_sha256 = sha256(canonicalJson(driftedUnsigned));
  assert.throws(() => adapter.verifyProductionRecoverySnapshot({
    recovery: drifted,
    policy,
    request: request(),
    manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  }), /RPC_SECURITY_ATTESTATION_FAILED/);
});

test('authorization and provider failures redact secrets and fail closed', async () => {
  const adapter = await loadAdapter();
  for (const status of [200, 401, 403, 404, 429, 500]) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/health')) return jsonResponse(healthyServices());
      if (pathname.endsWith('/database/migrations')) return jsonResponse([]);
      if (pathname.endsWith('/functions')) return jsonResponse([]);
      if (pathname.endsWith('/advisors/security')) return jsonResponse({ lints: [] });
      return jsonResponse({ private: 'provider-body-must-not-leak' }, status);
    };
    await assert.rejects(adapter.captureProductionSnapshot({
      phase: 'pre',
      policy,
      request: request(),
      manifest: manifest(),
      token: 'never-print-this-token',
      fetchImpl,
      observedAt: '2026-10-12T12:00:01.000Z',
      adapterSourceSha256: '6'.repeat(64),
    }), error => {
      assert.doesNotMatch(error.message, /never-print-this-token|provider-body-must-not-leak/);
      return true;
    });
    assert.ok(calls.length <= 6);
  }
});

test('malformed oversized and release-attributed finance evidence is rejected', async () => {
  const adapter = await loadAdapter();
  const cases = [
    () => jsonResponse([{ snapshot: financeSnapshot() }, { snapshot: financeSnapshot() }], 201),
    () => jsonResponse([{ snapshot: { ...financeSnapshot(), unexpected: true } }], 201),
    () => jsonResponse([{ snapshot: { ...financeSnapshot(), transactions: {
      complete: true,
      count: 1,
      items: [{ release_attributed: true }],
    } } }], 201),
    () => jsonResponse([{ snapshot: financeSnapshot() }], 201, { 'content-length': String(9 * 1024 * 1024) }),
  ];
  for (const makeSqlResponse of cases) {
    const base = successfulFetch([]);
    const fetchImpl = async (url, options) => {
      if (new URL(url).pathname.endsWith('/database/query/read-only')) return makeSqlResponse();
      return base(url, options);
    };
    await assert.rejects(adapter.captureProductionSnapshot({
      phase: 'post',
      policy,
      request: request(),
      manifest: manifest(),
      token: 'private-read-token',
      fetchImpl,
      observedAt: '2026-10-12T12:00:01.000Z',
      adapterSourceSha256: '6'.repeat(64),
    }));
  }
});

test('missing token identity drift and arbitrary public transport inputs are denied before network', async () => {
  const adapter = await loadAdapter();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('network must not open'); };
  for (const overrides of [
    { token: '' },
    { phase: 'release' },
    { request: { ...request(), approvedSha: 'b'.repeat(40) } },
    { policy: { ...policy, supabase: { ...policy.supabase, project_ref: 'otherprojectxxxxxxxx' } } },
    { manifest: { ...manifest(), compiler: { ...manifest().compiler, snapshot_adapter_sha256: '7'.repeat(64) } } },
  ]) {
    await assert.rejects(adapter.captureProductionSnapshot({
      phase: 'pre',
      policy,
      request: request(),
      manifest: manifest(),
      token: 'private-read-token',
      fetchImpl,
      observedAt: '2026-10-12T12:00:01.000Z',
      adapterSourceSha256: '6'.repeat(64),
      ...overrides,
    }));
  }
  assert.equal(calls, 0);
  await assert.rejects(adapter.captureProductionSnapshot({
    phase: 'pre', policy, request: request(), manifest: manifest(), token: '', fetchImpl,
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  }), /MISSING_SNAPSHOT_TOKEN/);
  assert.doesNotMatch(readFileSync(adapterUrl, 'utf8'), /--(?:url|query|transport|fetch)/);
});

test('snapshot pair binds immutable evidence and permits only manifest-listed remote changes', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = markManagedScopeTransitionPromoted(structuredClone(policy));
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre',
    policy: controlledPolicy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  const baselineDigests = adapter.buildProductionBaselineDigests({ evidence: pre, policy: controlledPolicy });
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified',
    evidence: '7'.repeat(64),
    evidence_digests: baselineDigests,
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner,
    verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  const post = await adapter.captureProductionSnapshot({
    phase: 'post',
    policy: controlledPolicy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetchWithFunctionVersion([], 36),
    observedAt: '2026-10-12T12:01:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(post, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'post'));
  const verified = adapter.verifyProductionSnapshotPair({
    pre,
    post,
    policy: controlledPolicy,
    request: request(),
    manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(verified.result, 'REMOTE_POSTCHECK_VERIFIED');
  assert.deepEqual(verified.changed_functions, ['content-safety-scan']);
  assert.deepEqual(verified.function_attestations, [{
    name: 'content-safety-scan',
    before_version: 35,
    after_version: 36,
    before_source_sha256: String(35).padStart(64, '0'),
    after_source_sha256: String(36).padStart(64, '0'),
    verify_jwt: true,
  }]);
  assert.deepEqual(verified.applied_migrations, []);

  for (const phase of ['pre', 'post']) {
    const candidate = {
      pre: structuredClone(pre),
      post: structuredClone(post),
      policy: structuredClone(controlledPolicy),
      request: request(),
      manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    };
    candidate[phase].rpc_security.items[0].definition_sha256 = '0'.repeat(64);
    candidate[phase].rpc_security.sha256 = sha256(canonicalJson(candidate[phase].rpc_security.items));
    resignEvidence(candidate[phase]);
    assert.throws(() => adapter.verifyProductionSnapshotPair(candidate), /RPC_SECURITY_ATTESTATION_FAILED/);
  }

  for (const mutate of [
    candidate => { candidate.pre.evidence_sha256 = '0'.repeat(64); },
    candidate => { candidate.manifest.resources.functions = []; },
    candidate => { candidate.post.cron_security.advisors.items = [{ fingerprint: '9'.repeat(64), level: 'WARN', resource_kind: 'table' }]; },
    candidate => { candidate.post.finance.schema_sha256 = '8'.repeat(64); },
  ]) {
    const candidate = {
      pre: structuredClone(pre),
      post: structuredClone(post),
      policy: structuredClone(controlledPolicy),
      request: request(),
      manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    };
    mutate(candidate);
    assert.throws(() => adapter.verifyProductionSnapshotPair(candidate));
  }

});

test('postcheck binds deployed function config and source identity to each manifest contract', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = markManagedScopeTransitionPromoted(structuredClone(policy));
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified', evidence: '7'.repeat(64),
    evidence_digests: adapter.buildProductionBaselineDigests({ evidence: pre, policy: controlledPolicy }),
    blocked_resources: [], reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner, verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane', requires_separate_policy_commit: true,
  };
  for (const { remote, mutateManifest } of [
    { remote: { version: 36, verify_jwt: false, ezbr_sha256: '3'.repeat(64) } },
    { remote: { version: 36, verify_jwt: true, ezbr_sha256: String(35).padStart(64, '0') } },
  ]) {
    const base = successfulFetch([], {});
    const fetchImpl = async (url, options = {}) => {
      if (new URL(url).pathname.endsWith('/functions')) {
        return jsonResponse([{ slug: 'content-safety-scan', status: 'ACTIVE', ...remote }]);
      }
      return base(url, options);
    };
    const postManifest = manifest();
    mutateManifest?.(postManifest);
    const post = await adapter.captureProductionSnapshot({
      phase: 'post', policy: controlledPolicy, request: request(), manifest: postManifest,
      token: 'private-read-token', fetchImpl,
      observedAt: '2026-10-12T12:01:01.000Z', adapterSourceSha256: '6'.repeat(64),
    });
    bindRpcSecurityEvidence(post, adapter.advisorExceptionsForPhase(controlledPolicy, postManifest, 'post'));
    assert.throws(() => adapter.verifyProductionSnapshotPair({
      pre, post, policy: controlledPolicy, request: request(), manifest: postManifest,
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_POSTCHECK_FAILED/);
  }
});

test('postcheck preserves every pre-existing ledger account identity while allowing new accounts', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = markManagedScopeTransitionPromoted(structuredClone(policy));
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified', evidence: '7'.repeat(64),
    evidence_digests: adapter.buildProductionBaselineDigests({ evidence: pre, policy: controlledPolicy }),
    blocked_resources: [], reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner, verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane', requires_separate_policy_commit: true,
  };
  const added = ledgerAccount({
    id: '22222222-2222-4222-8222-222222222222',
    owner_id_sha256: null,
    account_type: 'platform',
    created_at: '2026-10-12T12:00:30.000000Z',
  });
  const validPost = await adapter.captureProductionSnapshot({
    phase: 'post', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetchWithFunctionVersion([], 36, {
      finance: financeSnapshot({ ledger_accounts: { items: [ledgerAccount(), added] } }),
    }),
    observedAt: '2026-10-12T12:01:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(validPost, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'post'));
  assert.equal(adapter.verifyProductionSnapshotPair({
    pre, post: validPost, policy: controlledPolicy, request: request(), manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'REMOTE_POSTCHECK_VERIFIED');

  for (const items of [
    [],
    [ledgerAccount({ currency: 'USD' })],
  ]) {
    const invalidPost = await adapter.captureProductionSnapshot({
      phase: 'post', policy: controlledPolicy, request: request(), manifest: manifest(),
      token: 'private-read-token',
      fetchImpl: successfulFetchWithFunctionVersion([], 36, {
        finance: financeSnapshot({ ledger_accounts: { items } }),
      }),
      observedAt: '2026-10-12T12:01:01.000Z', adapterSourceSha256: '6'.repeat(64),
    });
    bindRpcSecurityEvidence(invalidPost, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'post'));
    assert.throws(() => adapter.verifyProductionSnapshotPair({
      pre, post: invalidPost, policy: controlledPolicy, request: request(), manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_POSTCHECK_FAILED/);
  }
});

test('pre-snapshot must match every owner-reviewed baseline digest before mutation', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = markManagedScopeTransitionPromoted(structuredClone(policy));
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre',
    policy: controlledPolicy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  const digests = adapter.buildProductionBaselineDigests({ evidence: pre, policy: controlledPolicy });
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified',
    migration_count: 1,
    latest_migration: '20261009021414_creator_premium_b5_creator_management_ux',
    evidence: '7'.repeat(64),
    evidence_digests: digests,
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner,
    verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  assert.equal(adapter.verifyProductionPreSnapshot({
    pre,
    policy: controlledPolicy,
    request: request(),
    manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  }).result, 'REMOTE_BASELINE_VERIFIED');
  for (const key of Object.keys(digests)) {
    const changed = structuredClone(controlledPolicy);
    changed.baseline.evidence_digests[key] = '0'.repeat(64);
    assert.throws(() => adapter.verifyProductionPreSnapshot({
      pre,
      policy: changed,
      request: request(),
      manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_BASELINE_MISMATCH/);
  }
});

test('pre-snapshot permits only the attested F2 bdag-ledger unmanaged-to-managed transition', async () => {
  const adapter = await loadAdapter();
  const oldPolicy = structuredClone(policy);
  oldPolicy.supabase.expected_remote_function_count = 2;
  oldPolicy.supabase.managed_functions = ['content-safety-scan'];
  delete oldPolicy.managed_scope_transitions;
  const functions = [
    { slug: 'bdag-ledger', status: 'ACTIVE', version: 22, verify_jwt: true, ezbr_sha256: 'b'.repeat(64) },
    { slug: 'content-safety-scan', status: 'ACTIVE', version: 46, verify_jwt: true, ezbr_sha256: 'c'.repeat(64) },
  ];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: oldPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetch([], { functions }),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  pre.identity.manifest_sha256 = sha256(canonicalJson(f2ManagedScopeManifest()));
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(oldPolicy, f2ManagedScopeManifest(), 'pre'));
  const controlledPolicy = structuredClone(oldPolicy);
  controlledPolicy.supabase.managed_functions = ['bdag-ledger', 'content-safety-scan'];
  controlledPolicy.managed_scope_transitions = [f2ManagedScopeTransition()];
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified',
    sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
    migration_count: 1,
    latest_migration: '20261009021414_creator_premium_b5_creator_management_ux',
    evidence: '7'.repeat(64),
    evidence_digests: adapter.buildProductionBaselineDigests({ evidence: pre, policy: oldPolicy }),
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner,
    verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  const result = adapter.verifyProductionPreSnapshot({
    pre, policy: controlledPolicy, request: request(), manifest: f2ManagedScopeManifest(),
    adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(result.result, 'REMOTE_BASELINE_VERIFIED');
  assert.deepEqual(result.managed_scope_transition, {
    id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
    resource: 'bdag-ledger',
    from_classification: 'unmanaged',
    to_classification: 'managed',
    observed_version: 22,
    observed_source_sha256: 'b'.repeat(64),
    requires_postcheck: true,
    requires_separate_baseline_promotion: true,
  });
});

test('managed scope transition fails closed for any non-attested baseline manifest or inventory delta', async () => {
  const adapter = await loadAdapter();
  const oldPolicy = structuredClone(policy);
  oldPolicy.supabase.expected_remote_function_count = 3;
  oldPolicy.supabase.managed_functions = ['content-safety-scan'];
  delete oldPolicy.managed_scope_transitions;
  const functions = [
    { slug: 'bdag-ledger', status: 'ACTIVE', version: 22, verify_jwt: true, ezbr_sha256: 'b'.repeat(64) },
    { slug: 'content-safety-scan', status: 'ACTIVE', version: 46, verify_jwt: true, ezbr_sha256: 'c'.repeat(64) },
    { slug: 'rogue-function', status: 'ACTIVE', version: 1, verify_jwt: true, ezbr_sha256: 'd'.repeat(64) },
  ];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: oldPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetch([], { functions }),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  pre.identity.manifest_sha256 = sha256(canonicalJson(f2ManagedScopeManifest()));
  bindRpcSecurityEvidence(pre, adapter.advisorExceptionsForPhase(oldPolicy, f2ManagedScopeManifest(), 'pre'));
  const controlledPolicy = structuredClone(oldPolicy);
  controlledPolicy.supabase.managed_functions = ['bdag-ledger', 'content-safety-scan'];
  controlledPolicy.managed_scope_transitions = [f2ManagedScopeTransition()];
  controlledPolicy.baseline = {
    ...controlledPolicy.baseline,
    state: 'verified', sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
    migration_count: 1, latest_migration: '20261009021414_creator_premium_b5_creator_management_ux',
    evidence: '7'.repeat(64),
    evidence_digests: adapter.buildProductionBaselineDigests({ evidence: pre, policy: oldPolicy }),
    blocked_resources: [], reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner, verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane', requires_separate_policy_commit: true,
  };
  const verify = ({ policyPatch = {}, manifestValue = f2ManagedScopeManifest(), evidence = pre } = {}) => adapter.verifyProductionPreSnapshot({
    pre: evidence,
    policy: { ...structuredClone(controlledPolicy), ...policyPatch },
    request: request(),
    manifest: manifestValue,
    adapterSourceSha256: '6'.repeat(64),
  });
  assert.throws(() => verify({ policyPatch: { managed_scope_transitions: [] } }), /REMOTE_BASELINE_MISMATCH/);
  assert.throws(() => verify({
    policyPatch: {
      managed_scope_transitions: [{ ...f2ManagedScopeTransition(), resource: 'rogue-function' }],
    },
  }), /REMOTE_BASELINE_MISMATCH/);
  const extraFunctionManifest = f2ManagedScopeManifest({
    resources: { ...f2ManagedScopeManifest().resources, functions: ['bdag-ledger', 'rogue-function'] },
  });
  const reboundEvidence = structuredClone(pre);
  reboundEvidence.identity.manifest_sha256 = sha256(canonicalJson(extraFunctionManifest));
  resignEvidence(reboundEvidence);
  assert.throws(() => verify({
    manifestValue: extraFunctionManifest,
    evidence: reboundEvidence,
  }), /REMOTE_BASELINE_MISMATCH/);
  const originalF2Manifest = f2ManagedScopeManifest();
  const changedMigrationBlobManifest = f2ManagedScopeManifest({
    resources: {
      ...originalF2Manifest.resources,
      migrations: [{ ...originalF2Manifest.resources.migrations[0], blob: '0'.repeat(40) }],
    },
  });
  const changedMigrationBlobEvidence = structuredClone(pre);
  changedMigrationBlobEvidence.identity.manifest_sha256 = sha256(canonicalJson(changedMigrationBlobManifest));
  resignEvidence(changedMigrationBlobEvidence);
  assert.throws(() => verify({
    manifestValue: changedMigrationBlobManifest,
    evidence: changedMigrationBlobEvidence,
  }), /RPC_SECURITY_ATTESTATION_FAILED/);
  const extraManaged = structuredClone(controlledPolicy);
  extraManaged.supabase.managed_functions.push('rogue-function');
  assert.throws(() => verify({ policyPatch: { supabase: extraManaged.supabase } }), /REMOTE_BASELINE_MISMATCH/);
  const changedVersion = structuredClone(pre);
  changedVersion.functions.items.find(item => item.slug === 'bdag-ledger').version = 23;
  changedVersion.functions.sha256 = sha256(canonicalJson(changedVersion.functions.items));
  resignEvidence(changedVersion);
  assert.throws(() => verify({ evidence: changedVersion }), /REMOTE_BASELINE_MISMATCH/);
});

test('pre-snapshot baseline binds finance schema Premium bindings and zero reconciliation', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = markManagedScopeTransitionPromoted(structuredClone(policy));
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  const baselinePre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(baselinePre, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  const baseline = {
    ...controlledPolicy.baseline,
    state: 'verified', evidence: '7'.repeat(64),
    evidence_digests: adapter.buildProductionBaselineDigests({ evidence: baselinePre, policy: controlledPolicy }),
    blocked_resources: [], reviewed_policy_sha256: '8'.repeat(64),
    verified_by: controlledPolicy.owner, verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane', requires_separate_policy_commit: true,
  };
  controlledPolicy.baseline = baseline;
  for (const finance of [
    financeSnapshot({ schema_sha256: '9'.repeat(64) }),
    financeSnapshot({ premium_bindings: {
      purchase_receipts: { count: 0, sha256: '9'.repeat(64) },
      subscription_periods: { count: 0, sha256: '4'.repeat(64) },
    } }),
  ]) {
    const drift = await adapter.captureProductionSnapshot({
      phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
      token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35, { finance }),
      observedAt: '2026-10-12T12:00:02.000Z', adapterSourceSha256: '6'.repeat(64),
    });
    bindRpcSecurityEvidence(drift, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
    assert.throws(() => adapter.verifyProductionPreSnapshot({
      pre: drift, policy: controlledPolicy, request: request(), manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_BASELINE_MISMATCH/);
  }

  const inconsistent = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetchWithFunctionVersion([], 35, {
      finance: financeSnapshot({ reconciliation: { ...zeroReconciliation(), orphan_ledger_entries: 1 } }),
    }),
    observedAt: '2026-10-12T12:00:03.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  bindRpcSecurityEvidence(inconsistent, adapter.advisorExceptionsForPhase(controlledPolicy, manifest(), 'pre'));
  const inconsistentPolicy = structuredClone(controlledPolicy);
  inconsistentPolicy.baseline.evidence_digests = adapter.buildProductionBaselineDigests({
    evidence: inconsistent,
    policy: inconsistentPolicy,
  });
  assert.throws(() => adapter.verifyProductionPreSnapshot({
    pre: inconsistent, policy: inconsistentPolicy, request: request(), manifest: manifest(),
    adapterSourceSha256: '6'.repeat(64),
  }), /REMOTE_BASELINE_MISMATCH/);
});

test('finance attribution never treats the numeric run attempt as an identity substring', async () => {
  const adapter = await loadAdapter();
  assert.doesNotMatch(adapter.FINANCE_SNAPSHOT_SQL, /\$3::text/);
  assert.doesNotMatch(adapter.FINANCE_SNAPSHOT_SQL, /String\(identity\.run_attempt\)/);
});

test('security advisor fingerprints exclude volatile observation timestamps', async () => {
  const adapter = await loadAdapter();
  const lint = {
    cache_key: 'rls-disabled-public-table',
    level: 'WARN',
    name: 'rls_disabled',
    metadata: { schema: 'public', table: 'example', type: 'table' },
  };
  const capture = observedAt => adapter.captureProductionSnapshot({
    phase: 'pre',
    policy,
    request: request(),
    manifest: manifest(),
    token: 'private-read-token',
    fetchImpl: successfulFetch([], { advisors: { lints: [{ ...lint, observed_at: observedAt }] } }),
    observedAt: '2026-10-12T12:00:01.000Z',
    adapterSourceSha256: '6'.repeat(64),
  });
  const first = await capture('2026-10-12T11:59:00.000Z');
  const second = await capture('2026-10-12T12:00:00.000Z');
  assert.equal(first.cron_security.advisors.items[0].fingerprint, second.cron_security.advisors.items[0].fingerprint);
});

test('security advisor fingerprints bind semantic object identity, not mutable advisory prose', async () => {
  const adapter = await loadAdapter();
  const lint = {
    cache_key: 'authenticated_security_definer_function_executable_public_cancel_my_creator_premium_submission_v1_p_content_id uuid',
    categories: ['SECURITY'],
    description: 'Original provider copy.',
    detail: 'Original detail.',
    facing: 'EXTERNAL',
    level: 'WARN',
    metadata: {
      arguments: 'p_content_id uuid',
      language: 'plpgsql',
      name: 'cancel_my_creator_premium_submission_v1',
      schema: 'public',
      security_definer: true,
    },
    name: 'authenticated_security_definer_function_executable',
    remediation: 'Original remediation.',
    title: 'Original title.',
  };
  const first = adapter.normalizeSecurityAdvisors({ lints: [lint] });
  const proseOnly = adapter.normalizeSecurityAdvisors({
    lints: [{ ...lint, description: 'Changed provider copy.', detail: 'Changed detail.', remediation: 'Changed remediation.', title: 'Changed title.' }],
  });
  const changedIdentity = adapter.normalizeSecurityAdvisors({
    lints: [{ ...lint, metadata: { ...lint.metadata, arguments: 'p_content_id uuid, p_force boolean' } }],
  });
  assert.equal(first.items[0].fingerprint, proseOnly.items[0].fingerprint);
  assert.notEqual(first.items[0].fingerprint, changedIdentity.items[0].fingerprint);
  assert.equal(first.items[0].resource_kind, lint.name);
  const noArgumentLint = {
    ...lint,
    cache_key: 'authenticated_security_definer_function_executable_public_ensure_my_ledger_account_',
    metadata: {
      arguments: '',
      language: 'plpgsql',
      name: 'ensure_my_ledger_account',
      schema: 'public',
      security_definer: true,
    },
  };
  assert.equal(
    adapter.normalizeSecurityAdvisors({ lints: [noArgumentLint] }).items[0].fingerprint,
    'acc6db2023e39518a9407ac3dada47063023550ae9f275eb058b6f6aff32753e',
  );
});

function canonicalAdvisorLints() {
  return [
    ...['anon', 'authenticated'].map(role => ({
      name: `${role}_security_definer_function_executable`,
      level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: { schema: 'public', name: 'ensure_my_ledger_account',
        arguments: '', language: 'plpgsql', security_definer: true },
      cache_key: `${role}_security_definer_function_executable_public_ensure_my_ledger_account_`,
    })),
    { name: 'rls_enabled_no_policy', level: 'INFO', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: { schema: 'private', name: 'creator_premium_auto_renewal_attempts', type: 'table' },
      cache_key: 'rls_enabled_no_policy_private_creator_premium_auto_renewal_attempts' },
    { name: 'auth_leaked_password_protection', level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: { entity: 'Auth', type: 'auth' }, cache_key: 'auth_leaked_password_protection' },
  ];
}

function groupedAdvisorLints(lints) {
  return { lints: lints.map(({ cache_key: ignored, metadata, ...group }) => ({
    ...group, count: 1, findings: [{ metadata }],
  })) };
}

function storiesQaC1ProviderLints() {
  return [
    {
      name: 'rls_enabled_no_policy', level: 'INFO', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: { schema: 'private', name: 'story_question_answer_links', type: 'table' },
      cache_key: 'rls_enabled_no_policy_private_story_question_answer_links',
    },
    {
      name: 'authenticated_security_definer_function_executable',
      level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: {
        schema: 'public', name: 'create_story_question_answer_with_media', language: 'plpgsql',
        arguments: 'p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid, p_asset_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb',
        security_definer: true,
      },
      cache_key: 'authenticated_security_definer_function_executable_public_create_story_question_answer_with_media_p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid, p_asset_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb',
    },
    {
      name: 'authenticated_security_definer_function_executable',
      level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
      metadata: {
        schema: 'public', name: 'prepare_story_question_answer', language: 'sql',
        arguments: 'p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid',
        security_definer: true,
      },
      cache_key: 'authenticated_security_definer_function_executable_public_prepare_story_question_answer_p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid',
    },
  ];
}

test('Security Advisor raw and grouped inventories have identical historical fingerprints', async () => {
  const adapter = await loadAdapter();
  const lints = canonicalAdvisorLints();
  const raw = adapter.normalizeSecurityAdvisors({ lints });
  assert.equal(raw.count, 4);
  assert.ok(raw.items.some(item => item.fingerprint === 'acc6db2023e39518a9407ac3dada47063023550ae9f275eb058b6f6aff32753e'));
  assert.ok(raw.items.some(item => item.fingerprint === '70d2706125a8861824f9c876848c472a28bde6db0813543ba97ec3409516967f'));
  assert.deepEqual(adapter.normalizeSecurityAdvisors(groupedAdvisorLints(lints)), raw);
});

test('Stories QA C1 pins official Splinter provenance, exact findings, and historical projection continuity', async () => {
  const adapter = await loadAdapter();
  const transition = installedPolicy.stories_qa_c1_transition;
  assert.deepEqual(transition.security_advisor.provider, {
    source: 'supabase/splinter',
    commit: 'fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975',
    sql_sha256: 'd8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349',
  });
  const raw = adapter.normalizeSecurityAdvisors({ lints: storiesQaC1ProviderLints() });
  const grouped = adapter.normalizeSecurityAdvisors(groupedAdvisorLints(storiesQaC1ProviderLints()));
  assert.deepEqual(grouped, raw);
  assert.deepEqual(raw.items.map(item => item.fingerprint), [
    '2195e746b4232e0a54f1fbb9fdd51dc4d87014ec20c4b8d6a6bd8b05bbc25d39',
    '3428d19b7577fa13fcae7ea23166d7053b98ce34804fcc5ac6f66d2339c80c64',
    '9cf89de2d5c962441f655087f8b3e5e89f2e7d6d94ce4196b48bd41bee29790a',
  ]);
  assert.equal(raw.sha256, 'b32e3e37e5776d90e73b1ee67ce79e74362f892ec84470cbb2b3b24f33c5c36d');
  assert.equal(transition.security_advisor.normalized_digest, raw.sha256);
  assert.deepEqual(
    transition.security_advisor.introduced_exceptions.map(item => item.advisor_fingerprint).sort(),
    raw.items.map(item => item.fingerprint).sort(),
  );

  const preQaPolicy = structuredClone(installedPolicy);
  preQaPolicy.baseline.sha = transition.baseline_sha;
  preQaPolicy.baseline.migration_count = 360;
  preQaPolicy.baseline.latest_migration = '20261027191918_stories_v2_safety_c2_publish_first_async_review';
  preQaPolicy.baseline.evidence_digests.cron_security =
    '83fe49cce6d9d0d69232f4afdcc1fab3665fbd5c8bf27aa8d4f626fd37b7dbf9';
  const withoutQaPolicy = structuredClone(preQaPolicy);
  delete withoutQaPolicy.stories_qa_c1_transition;
  const emptyInventory = {
    complete: true, count: 0, items: [], latest: null, sha256: sha256(canonicalJson([])),
  };
  const historicalManifest = { resources: {} };
  const withQa = adapter.advisorExceptionsForPhase(
    preQaPolicy, historicalManifest, 'post', { migrations: emptyInventory },
  );
  const withoutQa = adapter.advisorExceptionsForPhase(
    withoutQaPolicy, historicalManifest, 'post', { migrations: emptyInventory },
  );
  assert.deepEqual(withQa, withoutQa,
    'adding a future QA successor must not rewrite historical B1/C2 Advisor projection');
  assert.equal(preQaPolicy.baseline.evidence_digests.cron_security,
    '83fe49cce6d9d0d69232f4afdcc1fab3665fbd5c8bf27aa8d4f626fd37b7dbf9');
  const historicalFingerprints = new Set(withQa.map(item => item.advisor_fingerprint));
  for (const item of raw.items) assert.equal(historicalFingerprints.has(item.fingerprint), false,
    'QA-introduced findings must not project out of the pre-QA baseline');
  const predecessor = adapter.normalizeSecurityAdvisors({ lints: [{
    name: 'authenticated_security_definer_function_executable',
    level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
    metadata: {
      schema: 'public', name: 'create_story_from_content', language: 'plpgsql',
      arguments: 'p_video_id uuid, p_composition jsonb, p_client_story_id uuid',
      security_definer: true,
    },
  }] }).items[0];
  assert.equal(predecessor.fingerprint,
    '010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14');
  assert.equal(historicalFingerprints.has(predecessor.fingerprint), false,
    'the unmodeled historical wrapper finding remains visible before the QA successor');
});

test('Security Advisor transport cache keys cannot change semantic identity', async () => {
  const adapter = await loadAdapter();
  const lints = canonicalAdvisorLints();
  const raw = adapter.normalizeSecurityAdvisors({ lints });
  for (const replacement of [undefined, 'untrusted-provider-key', null, { forged: true }]) {
    const changed = lints.map(({ cache_key: ignored, ...lint }) => ({
      ...lint, ...(replacement === undefined ? {} : { cache_key: replacement }),
    }));
    assert.deepEqual(adapter.normalizeSecurityAdvisors({ lints: changed }), raw);
  }
});

test('Security Advisor semantic metadata and severity remain normative', async () => {
  const adapter = await loadAdapter();
  const lint = canonicalAdvisorLints()[1];
  const fingerprint = value => adapter.normalizeSecurityAdvisors({ lints: [value] }).items[0].fingerprint;
  for (const change of [
    { name: 'anon_security_definer_function_executable' }, { level: 'ERROR' },
    { facing: 'INTERNAL' }, { categories: ['PERFORMANCE', 'SECURITY'] },
    ...[{ schema: 'private' }, { name: 'other_function' }, { arguments: 'p_id uuid' },
      { language: 'sql' }, { security_definer: false }].map(metadata => ({ metadata: { ...lint.metadata, ...metadata } })),
  ]) assert.notEqual(fingerprint({ ...lint, ...change }), fingerprint(lint));
  const multiCategory = { ...lint, categories: ['SECURITY', 'PERFORMANCE'] };
  assert.equal(fingerprint(multiCategory), fingerprint({ ...multiCategory, categories: ['PERFORMANCE', 'SECURITY'] }));
  assert.equal(fingerprint(lint), fingerprint({ ...lint, title: 'New prose', observed_at: 'later',
    metadata: { ...lint.metadata, last_seen_at: 'later' } }));
});

test('Security Advisor malformed groups and findings fail closed', async () => {
  const adapter = await loadAdapter();
  const grouped = groupedAdvisorLints(canonicalAdvisorLints()).lints[0];
  for (const lint of [
    { ...grouped, count: 2 }, { ...grouped, count: -1 }, { ...grouped, count: '1' },
    { ...grouped, count: undefined }, { ...grouped, findings: null },
    { ...grouped, findings: [null] }, { ...grouped, findings: [{ metadata: [] }] },
    { ...grouped, findings: [{ findings: [], count: 0 }] }, null, {},
  ]) assert.throws(() => adapter.normalizeSecurityAdvisors({ lints: [lint] }), /INVALID_REMOTE_INVENTORY/);
});

test('Security Advisor duplicate semantic identities fail closed across raw and grouped records', async () => {
  const adapter = await loadAdapter();
  const lint = canonicalAdvisorLints()[1];
  for (const duplicate of [
    { ...lint }, { ...lint, cache_key: 'different-transport-key' },
    { ...lint, level: 'ERROR', metadata: { ...lint.metadata, observed_at: 'later' } },
    groupedAdvisorLints([lint]).lints[0],
  ]) assert.throws(() => adapter.normalizeSecurityAdvisors({ lints: [lint, duplicate] }), /INVALID_REMOTE_INVENTORY/);
});

test('baseline phase-effective exceptions replace both historical F2 predecessor fingerprints', async () => {
  const adapter = await loadAdapter();
  const controlled = structuredClone(installedPolicy);
  controlled.baseline.latest_migration = '20261026072512_creator_premium_f5_autonomous_subscriptions';
  controlled.supabase.managed_functions = [];
  const exceptions = adapter.advisorExceptionsForPhase(controlled, null, 'post');
  const names = ['get_creator_premium_commerce_v1', 'get_my_creator_premium_subscriptions_v1'];
  const predecessors = controlled.security_advisor.exceptions.filter(item => names.includes(item.object.name));
  const successors = exceptions.filter(item => names.includes(item.object.name));
  assert.deepEqual(predecessors.map(item => item.advisor_fingerprint), [
    'f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32',
    'cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae',
  ]);
  assert.deepEqual(successors.map(item => item.advisor_fingerprint), [
    '339d435525f93706824b968958882e6616e3b4cb19728a5c1c425e8503f4df2e',
    'f8947b5a77fa93ff7dc019508d54eb859dffe9fcc0526d925e2d85d05a37f284',
  ]);
  const inventory = items => ({ complete: true, count: items.length, items, sha256: sha256(canonicalJson(items)) });
  // Include historical fingerprints to prove they no longer suppress findings.
  const retained = predecessors.map(item => ({ fingerprint: item.advisor_fingerprint,
    level: item.advisor_severity, resource_kind: item.advisor_type }));
  const advisors = [...retained, ...exceptions.map(item => ({ fingerprint: item.advisor_fingerprint,
    level: item.advisor_severity, resource_kind: item.advisor_type }))]
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const evidence = {
    migrations: { ...inventory([]), latest: null }, functions: inventory([]),
    cron_security: { cron: cronSnapshot(), advisors: inventory(advisors) }, finance: financeSnapshot(),
  };
  bindRpcSecurityEvidence(evidence, exceptions);
  assert.equal(adapter.buildProductionBaselineDigests({ evidence, policy: controlled }).cron_security,
    sha256(canonicalJson({ complete: true, cron: [], security_findings: retained.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) })));
  assert.deepEqual(controlled.security_advisor.exceptions.filter(item => names.includes(item.object.name)), predecessors);
});

test('current successor RPC attestations require exact definition ACL owner and search_path', async () => {
  const adapter = await loadAdapter();
  const items = [
    { version: '20261029042807', name: 'stories_v2_qa_c1_question_answer_authority' },
    ...CONTROL_CENTER_MIGRATIONS.map(([version, name]) => ({ version, name })),
  ];
  const migrations = {
    complete: true, count: items.length, items, latest: items.at(-1), sha256: sha256(canonicalJson(items)),
  };
  const exceptions = adapter.advisorExceptionsForPhase(installedPolicy, null, 'post', { migrations });
  const evidence = {};
  bindRpcSecurityEvidence(evidence, exceptions);
  assert.equal(adapter.validateRpcSecurityAttestations(evidence.rpc_security, exceptions), true);
  for (const name of ['get_creator_premium_commerce_v1', 'get_my_creator_premium_subscriptions_v1']) {
    for (const change of [
      { definition_sha256: '0'.repeat(64) }, { acl: [] }, { owner: 'other_owner' },
      { search_path: ['search_path=public'] }, { security_definer: false },
      { execute: { anon: false, authenticated: true, public: false, service_role: true } },
    ]) {
      const hostile = structuredClone(evidence.rpc_security);
      Object.assign(hostile.items.find(item => item.name === name), change);
      hostile.sha256 = sha256(canonicalJson(hostile.items));
      assert.throws(() => adapter.validateRpcSecurityAttestations(hostile, exceptions), /RPC_SECURITY_ATTESTATION_FAILED/);
    }
  }
});

test('Stories Safety C2 observed complete inventory selects helper attestations before baseline promotion', async () => {
  const adapter = await loadAdapter();
  const controlled = structuredClone(installedPolicy);
  controlled.baseline.latest_migration = '20261027120000_stories_v2_safety_c1_technical_policy_prep';
  controlled.baseline.migration_count = 1;
  const before = [{ version: '20261027120000', name: 'stories_v2_safety_c1_technical_policy_prep' }];
  controlled.baseline.evidence_digests.migrations = sha256(canonicalJson(before.map(item => `${item.version}_${item.name}`)));
  const items = [...before, { version: '20261027191918', name: 'stories_v2_safety_c2_publish_first_async_review' }];
  const inventory = values => ({ complete: true, count: values.length, items: values,
    latest: values.at(-1), sha256: sha256(canonicalJson(values)) });
  const migrations = inventory(items);
  const requirement = adapter.storiesSafetyC2StateRequirement(controlled, null, 'post', { migrations });
  assert.equal(requirement.installed, true);
  assert.equal(requirement.required, true);
  assert.equal(requirement.recovery, false);
  const beforeExceptions = adapter.advisorExceptionsForPhase(controlled, null, 'post', { migrations: inventory(before) });
  const afterExceptions = adapter.advisorExceptionsForPhase(controlled, null, 'post', { migrations });
  for (const helper of controlled.stories_safety_c2_transition.helper_attestations) {
    const find = values => values.find(item => item.object?.argument_types
      && `${item.object.schema}.${item.object.name}(${item.object.argument_types.join(',')})`.replaceAll(' ', '') === helper.identity.replaceAll(' ', ''));
    if (!find(afterExceptions)) continue;
    assert.equal(find(afterExceptions).attestation.definition_sha256, helper.definition_sha256);
  }
  const create = values => values.find(item => item.object?.name === 'create_story_with_media' && item.object.argument_types?.length === 4);
  assert.notEqual(create(beforeExceptions).attestation.definition_sha256, create(afterExceptions).attestation.definition_sha256);
  for (const hostile of [
    { ...migrations, complete: false }, { ...migrations, count: 3 }, { ...migrations, sha256: '0'.repeat(64) },
    inventory([...before, { ...items[1], name: 'different_c2' }]),
  ]) assert.equal(adapter.storiesSafetyC2StateRequirement(controlled, null, 'post', { migrations: hostile }).installed, false);
  assert.equal(adapter.storiesSafetyC2StateRequirement(controlled, null, 'post', {
    migrations: inventory([...items, { version: '20261028120000', name: 'later_migration' }]),
  }).installed, true, 'installed state is distinct from exact recovery append authorization');
});

test('phase-bound RPC attestations keep successor authorities stable for an older F1 manifest', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261018211327_creator_premium_qa_final_f1.sql',
    version: '20261018211327',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre')), 18);
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post')), 18);
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'recovery')), 17);
});

test('phase-bound RPC attestations introduce self-only Wallet provisioning only after F3-FINAL', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(walletTransitionPolicy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    blob: 'cdcb1e2bd4db2e2e61c7e5815d62daf27cf15fba',
    path: 'supabase/migrations/20261025231500_creator_premium_f3_final_wallet_integration.sql',
    source_sha: '584c29978bd903e44b436db4417d458946bc2119',
    version: '20261025231500',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post');
  const recoveryBeforeInstall = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    controlledManifest,
    'recovery',
    { migrations: { items: [{ version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' }] } },
  );
  const recoveryAfterInstall = adapter.advisorExceptionsForPhase(
    controlledPolicy,
    controlledManifest,
    'recovery',
    { migrations: { items: [
      { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' },
      { version: '20261025231500', name: 'creator_premium_f3_final_wallet_integration' },
    ] } },
  );
  assert.equal(pre.length, 23);
  assert.equal(post.length, 24);
  assert.equal(recoveryBeforeInstall.length, 23);
  assert.equal(recoveryAfterInstall.length, 24);
  assert.equal(rpcCount(pre), 20);
  assert.equal(rpcCount(post), 21);
  assert.equal(rpcCount(recoveryBeforeInstall), 20);
  assert.equal(rpcCount(recoveryAfterInstall), 21);
  assert.equal(pre.some(item => item.object.name === 'ensure_my_ledger_account'), false);
  assert.equal(post.some(item => item.object.name === 'ensure_my_ledger_account'), true);
  assert.equal(recoveryBeforeInstall.some(item => item.object.name === 'ensure_my_ledger_account'), false);
  assert.equal(recoveryAfterInstall.some(item => item.object.name === 'ensure_my_ledger_account'), true);
  for (const key of ['blob', 'source_sha']) {
    const hostileManifest = structuredClone(controlledManifest);
    hostileManifest.resources.migrations[0][key] = key === 'blob' ? '0'.repeat(40) : '1'.repeat(40);
    assert.throws(
      () => adapter.advisorExceptionsForPhase(controlledPolicy, hostileManifest, 'pre'),
      /RPC_SECURITY_ATTESTATION_FAILED/,
    );
  }
  const preFingerprints = new Set(pre.map(item => item.advisor_fingerprint));
  const introduced = post.filter(item => !preFingerprints.has(item.advisor_fingerprint));
  assert.deepEqual(introduced.map(item => item.advisor_fingerprint), [
    'acc6db2023e39518a9407ac3dada47063023550ae9f275eb058b6f6aff32753e',
  ]);
  const advisorRows = items => items.map(item => ({
    fingerprint: item.advisor_fingerprint,
    level: item.advisor_severity,
    resource_kind: item.advisor_type,
  }));
  assert.equal(
    adapter.validateSecurityAdvisorDelta(advisorRows(pre), advisorRows(post), introduced),
    true,
  );
});

test('phase-bound RPC attestations activate the revised plan deletion definition only after C4', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261019023431_creator_premium_f1_c4_final_recovery.sql',
    version: '20261019023431',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post');
  assert.equal(rpcCount(pre), 18);
  assert.equal(rpcCount(post), 18);
  const preDeletePlan = pre.find(item => item.object.name === 'delete_my_creator_premium_plan_draft_v1');
  const postDeletePlan = post.find(item => item.object.name === 'delete_my_creator_premium_plan_draft_v1');
  assert.equal(preDeletePlan.attestation.definition_sha256, '40cbc02821cceb68cdd5a31cfd531d9ec8f537d36c47acb1fc7fcafd0df42ed3');
  assert.equal(postDeletePlan.attestation.definition_sha256, 'a7bab775b77a5230658cea58c7bcb9f139b4b6102c89c1095a5e3f5d8548d520');
});

test('phase-bound RPC attestations activate the repaired submit definition only after C6', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261019170853_creator_premium_f1_c6_submit_unavailable_mapping_recovery.sql',
    version: '20261019170853',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post');
  assert.equal(rpcCount(pre), 18);
  assert.equal(rpcCount(post), 18);
  const preSubmit = pre.find(item => item.object.name === 'submit_my_creator_premium_content_with_plans_v1');
  const postSubmit = post.find(item => item.object.name === 'submit_my_creator_premium_content_with_plans_v1');
  assert.equal(preSubmit.attestation.definition_sha256, '7e3e9f176c216fd35bd9dc4fe00b7d577558265afe2f884630d53747737f02ee');
  assert.equal(postSubmit.attestation.definition_sha256, '00e9195a045185a65ca260a9abacc6916b289f7b1a2cf094cdaf9d4d86f55eff');
});

test('phase-bound RPC attestations activate P3-C2 recovery readiness only after its migration', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261020030515_creator_premium_p3_c2_admin_restriction_recovery.sql',
    version: '20261020030515',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post');
  const recovery = adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'recovery');
  assert.equal(rpcCount(pre), 18);
  assert.equal(rpcCount(post), 18);
  assert.equal(rpcCount(recovery), 17);
  const preDetail = pre.find(item => item.object.name === 'get_admin_creator_premium_content_v1');
  const postDetail = post.find(item => item.object.name === 'get_admin_creator_premium_content_v1');
  const recoveryDetail = recovery.find(item => item.object.name === 'get_admin_creator_premium_content_v1');
  assert.equal(preDetail.attestation.definition_sha256, '2a91f72e122beeee0f3d3c9f59ef99f13d2aefab9bcbc987594a5ac43c40a47e');
  assert.equal(postDetail.attestation.definition_sha256, 'da4ae0e4416fc032f0b0cb3dfad00b6e1c5b95592bfa6b7ae926964b696f79bc');
  assert.equal(recoveryDetail.attestation.definition_sha256, 'da4ae0e4416fc032f0b0cb3dfad00b6e1c5b95592bfa6b7ae926964b696f79bc');
});

test('phase-bound RPC attestations activate F2 projections only after the exact migration', async () => {
  const adapter = await loadAdapter();
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    blob: 'fce8789a0c79251afbe962bd39f6bd81ae248296',
    path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql',
    source_sha: '97f6638acaa5be2af336b427184c11185e3d0fe1',
    version: '20261024173500',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(policy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(policy, controlledManifest, 'post');
  assert.equal(rpcCount(pre), 16);
  assert.equal(rpcCount(post), 18);
  assert.equal(pre.some(item => item.object.name === 'get_my_creator_premium_financial_history_v1'), false);
  assert.equal(pre.some(item => item.object.name === 'search_admin_creator_premium_finance_v1'), false);
  const expected = new Map([
    ['get_creator_premium_commerce_v1', ['30c9a4a75712f74d3d62a39f962f87ce98f22269dd1b46b259b1d15ef89d7e86', 'e96caaab2c8ad2cd24e508849c0a7fff15d0257ac7a55a035aaa59b8632ed5c0']],
    ['get_my_creator_premium_commercial_summary_v1', ['1a34a92abe226cdb66b3d8ba95b848d7576fe81e324839c9424582dc44610d05', 'e4f4cb3d311ba740bd9827b821c28ba2069be49adfad954b29ba790a6bd3dadb']],
    ['get_my_creator_premium_subscriptions_v1', ['dddaf6f218f2abe7a24d97dfdd4fc0cb125fed5b7e2088c510bd4f8368124685', '8cf06818806f7b82dc9773ef87821897c6c861f3921e0bfc2cd804855545dfb3']],
    ['retire_my_creator_premium_content_v1', ['10a91f4a47efeda414aa7ed7d1ceed81fff971f6eb5009e4f2bfc4f2acbb78d9', 'ac6cd5a65b129c471184ffb080a5a80dcfb2c3283daf5fb2c2100a945e340580']],
  ]);
  for (const [name, [before, after]] of expected) {
    assert.equal(pre.find(item => item.object.name === name).attestation.definition_sha256, before);
    assert.equal(post.find(item => item.object.name === name).attestation.definition_sha256, after);
  }
});

test('postcheck advisor delta accepts only exact phase-approved fingerprints', async () => {
  const adapter = await loadAdapter();
  const pre = [{ fingerprint: '1'.repeat(64), level: 'WARN', resource_kind: 'existing' }];
  const allowed = { advisor_fingerprint: '2'.repeat(64) };
  const post = [...pre, { fingerprint: allowed.advisor_fingerprint, level: 'WARN', resource_kind: 'new' }];
  assert.equal(adapter.validateSecurityAdvisorDelta(pre, post, [allowed]), true);
  const preexistingApproved = [
    ...pre,
    { fingerprint: allowed.advisor_fingerprint, level: 'WARN', resource_kind: 'existing-protected-rpc' },
  ];
  assert.equal(adapter.validateSecurityAdvisorDelta(preexistingApproved, preexistingApproved, [allowed]), true);
  assert.throws(
    () => adapter.validateSecurityAdvisorDelta(pre, [...post, { fingerprint: '3'.repeat(64), level: 'WARN', resource_kind: 'unknown' }], [allowed]),
    /REMOTE_POSTCHECK_FAILED/,
  );
  assert.throws(() => adapter.validateSecurityAdvisorDelta(pre, pre, [allowed]), /REMOTE_POSTCHECK_FAILED/);
});

test('F4 inventory selects the general finance facts contract only after its exact migration chain', async () => {
  const adapter = await loadAdapter();
  const inventory = items => ({ complete: true, count: items.length, items,
    latest: items.at(-1) ?? null, sha256: sha256(canonicalJson(items)) });
  const foundation = { version: '20261025011000', name: 'creator_premium_f3_bounded_financial_activation' };
  const c2 = { version: '20261025160452', name: 'creator_premium_f3_c2_isolated_canary_governance' };
  const f4 = { version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' };
  const selected = adapter.selectFinanceSnapshotQueries(inventory([foundation, c2, f4]));
  assert.equal(selected.phase, 'f4_general');
  assert.equal(selected.facts, adapter.FINANCE_FACTS_F4_GENERAL_SQL);
  assert.match(selected.facts, /authorization_scope='GENERAL'/);
  assert.match(selected.facts, /receipt\.finance_authorization_id/);
  assert.match(selected.facts, /period\.finance_authorization_id/);
  assert.doesNotMatch(selected.facts,
    /private\.creator_premium_(?:purchase|period)_binding_is_valid_v1/,
    'Management API read-only evidence must not require EXECUTE on private helpers');
  assert.throws(
    () => adapter.selectFinanceSnapshotQueries(inventory([foundation, f4])),
    /FINANCE_AUTHORITY_MISMATCH/,
  );
});

test('F4 general finance facts accept reconciled nonempty commerce and reject binding drift', async () => {
  const adapter = await loadAdapter();
  const digest = value => createHash('sha256').update(value).digest('hex');
  const configurationDigest = digest('configuration-digest');
  const approvalDigest = digest('approval-digest');
  const fact = (kind, amount) => ({
    id: digest(`${kind}-id`),
    gross_amount_bdag: amount,
    fact_sha256: digest(`${kind}-fact`),
  });
  const facts = {
    schema_version: 1,
    complete: true,
    phase: 'f4_general',
    policy: {
      activation_mode: 'general', active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
      purchase_enabled: true, subscription_enabled: true,
      refunds_enabled: true, platform_fee_bps: 2000,
    },
    attestations: [{
      id: digest('attestation-id'), configuration_digest: configurationDigest,
      approval_digest: approvalDigest, fact_sha256: digest('attestation-fact'),
    }],
    authorizations: [{
      id: digest('f4000000-0000-4000-8000-000000000001'),
      authorization_scope: 'GENERAL', client_contract: 'creator-premium-f3-v2', status: 'OPEN',
      platform_fee_bps: 2000, configuration_digest: configurationDigest,
      approval_digest: approvalDigest,
      buyer_id: null, creator_id: null, buyer_account_id: null, creator_account_id: null,
      purchase_content_id: null, purchase_offer_version_id: null, subscription_plan_id: null,
      purchase_amount_bdag: null, subscription_amount_bdag: null,
      max_purchase_count: null, max_subscription_count: null, max_refund_count: null,
      max_gross_bdag: null, charge_expires_at: null, refund_expires_at: null,
      fact_sha256: digest('authorization-fact'),
    }],
    receipts: [fact('receipt', '1500.00000000')],
    periods: [fact('period', '1500.00000000')],
    subscriptions: [{ id: digest('subscription-id'), fact_sha256: digest('subscription-fact') }],
    transactions: [{ id: digest('transaction-id'), amount: '1500.00000000', fact_sha256: digest('transaction-fact') }],
    acquisition_exposure_bdag: '3000.00000000',
    release_movement_bdag: '0.00000000',
    reconciliation: {
      purchase_binding_mismatches: 0,
      period_binding_mismatches: 0,
      orphan_premium_transactions: 0,
      orphan_premium_ledger_entries: 0,
      subscriptions_without_period: 0,
      multiple_periods_per_relationship: 0,
      duplicate_open_relationships: 0,
    },
  };
  assert.equal(adapter.validateFinanceFacts(facts, 'f4_general'), facts);
  for (const hostile of [
    { ...facts, reconciliation: { ...facts.reconciliation, purchase_binding_mismatches: 1 } },
    { ...facts, reconciliation: { ...facts.reconciliation, orphan_premium_transactions: 1 } },
    { ...facts, reconciliation: { ...facts.reconciliation, orphan_premium_ledger_entries: 1 } },
    { ...facts, reconciliation: { ...facts.reconciliation, subscriptions_without_period: 1 } },
    { ...facts, reconciliation: { ...facts.reconciliation, multiple_periods_per_relationship: 1 } },
    { ...facts, reconciliation: { ...facts.reconciliation, duplicate_open_relationships: 1 } },
    { ...facts, release_movement_bdag: '0.00000001' },
    { ...facts, policy: { ...facts.policy, platform_fee_bps: 1999 } },
    { ...facts, authorizations: [{ ...facts.authorizations[0], id: digest('wrong-authorization') }] },
    { ...facts, authorizations: [{ ...facts.authorizations[0], buyer_id: digest('forbidden-buyer') }] },
    { ...facts, authorizations: [{ ...facts.authorizations[0], client_contract: 'creator-premium-f3-v1' }] },
    { ...facts, authorizations: [{ ...facts.authorizations[0], approval_digest: digest('wrong-approval') }] },
  ]) assert.throws(() => adapter.validateFinanceFacts(hostile, 'f4_general'), /FINANCE_FACTS_REJECTED/);
});

test('F4 read-only reconciliation covers canonical refunded facts, reversals, accounts and ledger legs', async () => {
  const adapter = await loadAdapter();
  const sql = adapter.FINANCE_FACTS_F4_GENERAL_SQL;
  for (const alias of ['receipt', 'period']) {
    assert.match(sql, new RegExp(`original\\.status=case\\s+when ${alias}\\.access_state='refunded' then 'reversed'\\s+else 'completed' end`));
    assert.match(sql, new RegExp(`${alias}\\.access_state='refunded'[\\s\\S]+?reversal\\.status='completed'`));
    assert.match(sql, new RegExp(`reversal\\.id=${alias}\\.reversal_financial_transaction_id`));
    assert.match(sql, new RegExp(`original\\.id=${alias}\\.financial_transaction_id`));
  }
  for (const leg of [
    'payer_gross_debit', 'creator_net_credit', 'platform_fee_credit',
    'creator_net_debit', 'platform_fee_debit', 'payer_gross_credit',
  ]) assert.match(sql, new RegExp(`financial_leg'='${leg}'`));
  assert.match(sql, /payer_account\.owner_id=receipt\.buyer_id/);
  assert.match(sql, /creator_account\.owner_id=period\.creator_id/);
  assert.match(sql, /platform_account\.account_type='platform'/);
  assert.match(sql, /when 'GENERAL' then pg_catalog\.encode\(pg_catalog\.sha256/);
  assert.match(sql, /attestation\.approval_digest=pg_catalog\.encode\(pg_catalog\.sha256/);
  assert.match(sql, /attestation\.registered_by='postgres'/);
  assert.match(sql, /receipt\.buyer_id<>receipt\.creator_id/);
  assert.match(sql, /receipt\.content_id is not null and receipt\.offer_version_id is not null/);
  assert.match(sql, /period\.subscriber_id<>period\.creator_id/);
  assert.match(sql, /period\.plan_id is not null/);
  assert.match(sql, /receipt\.gross_amount_bdag<=1000000000000/);
  assert.match(sql, /period\.gross_amount_bdag<=1000000000000/);
  assert.match(sql, /finance_authorization_id is null and receipt\.created_at<\(/);
  assert.match(sql, /finance_authorization_id is null and period\.created_at<\(/);
  assert.match(sql, /'orphan_premium_transactions'/);
  assert.match(sql, /'orphan_premium_ledger_entries'/);
  assert.match(sql, /'subscriptions_without_period'/);
  assert.match(sql, /'multiple_periods_per_relationship'/);
  assert.match(sql, /'duplicate_open_relationships'/);
  assert.match(sql, /transaction_row\.operation_type='creator_premium_purchase_refund'/);
  assert.match(sql, /entry\.metadata->>'fin_txn_id'=transaction_row\.id::text/);
  assert.match(sql, /envelope\.authorization_scope='CANARY'/);
  assert.match(sql, /envelope\.purchase_content_id=receipt\.content_id/);
  assert.match(sql, /envelope\.subscription_plan_id=period\.plan_id/);
  assert.match(sql, /receipt\.gross_amount_bdag=receipt\.creator_net_bdag\+receipt\.platform_fee_bdag/);
  assert.match(sql, /period\.gross_amount_bdag=period\.creator_net_bdag\+period\.platform_fee_bdag/);
});

test('F4 promoted baseline finance digest is stable across reconciled commerce growth', async () => {
  const adapter = await loadAdapter();
  const activePolicy = structuredClone(installedPolicy);
  activePolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
  activePolicy.baseline.migration_count = 355;
  activePolicy.baseline.blocked_resources = [];
  activePolicy.supabase.finance_policy = {
    purchase_enabled: true, subscription_enabled: true,
    refunds_enabled: true, platform_fee_bps: 2000,
  };
  activePolicy.supabase.managed_functions = [];
  activePolicy.security_advisor.exceptions = [];
  const migrations = [{ version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' }];
  const evidence = finance => ({
    migrations: { complete: true, count: 1, items: migrations, latest: migrations[0], sha256: sha256(canonicalJson(migrations)) },
    functions: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
    cron_security: {
      cron: cronSnapshot(),
      advisors: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
    },
    finance,
    rpc_security: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
  });
  const activeFinance = financeSnapshot({
    policy: {
      purchase_enabled: true, subscription_enabled: true,
      refunds_enabled: true, platform_fee_bps: 2000,
      policy_version: 'creator-premium-f4-general-v1',
    },
    premium_transaction_count: 2,
    premium_bindings: {
      purchase_receipts: { count: 1, sha256: '5'.repeat(64) },
      subscription_periods: { count: 1, sha256: '6'.repeat(64) },
    },
  });
  const before = adapter.buildProductionBaselineDigests({ evidence: evidence(activeFinance), policy: activePolicy });
  const after = adapter.buildProductionBaselineDigests({
    evidence: evidence({
      ...activeFinance,
      premium_transaction_count: 4,
      premium_bindings: {
        purchase_receipts: { count: 2, sha256: '7'.repeat(64) },
        subscription_periods: { count: 2, sha256: '8'.repeat(64) },
      },
    }),
    policy: activePolicy,
  });
  assert.equal(before.finance, after.finance,
    'legitimate reconciled commerce must not invalidate an active steady-state baseline');
});

test('F4 promoted baseline preserves the owner-reviewed raw cron command identity', async () => {
  const adapter = await loadAdapter();
  const activePolicy = structuredClone(installedPolicy);
  activePolicy.baseline.latest_migration = '20261026030000_creator_premium_f4_general_bdag_activation';
  activePolicy.baseline.migration_count = 355;
  activePolicy.baseline.blocked_resources = [];
  activePolicy.supabase.finance_policy = {
    purchase_enabled: true, subscription_enabled: true,
    refunds_enabled: true, platform_fee_bps: 2000,
  };
  activePolicy.supabase.managed_functions = [];
  activePolicy.security_advisor.exceptions = [];
  const migrations = [{ version: '20261026030000', name: 'creator_premium_f4_general_bdag_activation' }];
  const cronItem = {
    jobid: '4', jobname: 'call-incoming-dispatch-history-retention', schedule: '0 5 * * *',
    database: 'postgres', username: 'postgres', active: true,
    nodename: 'localhost', nodeport: 5432,
    command_sha256: 'a'.repeat(64),
    legacy_normalized_command_sha256: 'b'.repeat(64),
  };
  const evidence = {
    migrations: { complete: true, count: 1, items: migrations, latest: migrations[0], sha256: sha256(canonicalJson(migrations)) },
    functions: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
    cron_security: {
      cron: { ...cronSnapshot(), count: 1, items: [cronItem] },
      advisors: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
    },
    finance: financeSnapshot({
      policy: {
        purchase_enabled: true, subscription_enabled: true,
        refunds_enabled: true, platform_fee_bps: 2000,
        policy_version: 'creator-premium-f4-general-v1',
      },
    }),
    rpc_security: { complete: true, count: 0, items: [], sha256: sha256(canonicalJson([])) },
  };
  const rawCronItem = { ...cronItem };
  delete rawCronItem.legacy_normalized_command_sha256;
  const legacyCronItem = { ...rawCronItem, command_sha256: cronItem.legacy_normalized_command_sha256 };
  const expectedRawDigest = sha256(canonicalJson({
    complete: true,
    cron: [rawCronItem],
    security_findings: [],
  }));
  const legacyDigest = sha256(canonicalJson({
    complete: true,
    cron: [legacyCronItem],
    security_findings: [],
  }));
  assert.notEqual(expectedRawDigest, legacyDigest);
  const digests = adapter.buildProductionBaselineDigests({ evidence, policy: activePolicy });
  assert.equal(digests.cron_security, expectedRawDigest,
    'the promoted F4 baseline was signed over raw cron command bytes');
});
