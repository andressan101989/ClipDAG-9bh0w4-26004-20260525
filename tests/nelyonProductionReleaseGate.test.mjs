import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
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
  'b5ca8be9cf9433a21ee7f19906d8a23340ef629d6cedd414c196b431ab5dfaf1',
  'cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae',
  'ed55682047d682b69c66430b68fc819fb781b7289539fa398fadf09ec0c064fc',
  'f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32',
];
const A2_PREEXISTING_FINGERPRINTS = [
  '44c69807ea7e06dadbd8f841ec50a8911c25a76b28ed8096ec6fea66d129b55b',
  '92d3ea284e4ee4c77be88f4a3cade83460caa098dbbc3028587388cf0158933b',
];
const F1_EXCEPTION_FINGERPRINTS = [
  '1c20753b55dcdb2d0a8e6a3365fcf45453495a74a49d76b9b51af4e51d7b923f',
  'b0cdd5e8a440096ebc6bbd35fee9b785180d71ae6d06209ade7feaa6c0877c4d',
];
const F1_C4_EXCEPTION_FINGERPRINTS = [
  '5ceb93fa71004f64ba75a7bd251fadaf66d7ebdce81fb48904fd988ed9023fef',
];
const P2_RELATION_ADVISOR_FINGERPRINT = '8088d6be7ca6bd32b041ed429091a56f26d26ac0d7148eb5bf15f9e3c5e70bd6';

async function loadGateAndPolicy() {
  assert.ok(existsSync(policyUrl), 'release policy must exist');
  assert.ok(existsSync(gateUrl), 'release gate helper must exist');
  const gate = await import(`${gateUrl.href}?test=${Date.now()}-${Math.random()}`);
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  return { gate, policy };
}

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
      post_snapshot: 'success',
      postcheck: 'failure',
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

async function recoveryStateFixture(t, gate, policy, sourceIndex = 0) {
  const adapter = await import(`${adapterUrl.href}?recovery=${Date.now()}-${Math.random()}`);
  const controlledPolicy = structuredClone(policy);
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
  const functionRows = [
    ...source.edge_functions.map(item => ({
      slug: item.name,
      status: item.status,
      version: item.version,
      verify_jwt: item.verify_jwt,
      ezbr_sha256: item.source_sha256,
    })),
    ...Array.from({ length: 34 - source.edge_functions.length }, (_, index) => ({
      slug: `unmanaged-${String(index + 1).padStart(2, '0')}`,
      status: 'ACTIVE',
      version: index + 1,
      verify_jwt: true,
      ezbr_sha256: String(index + 1).padStart(64, '0'),
    })),
  ];
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
  const financeTransactions = Array.from({ length: 928 }, (_, index) => ({
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
    policy: { purchase_enabled: false, subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0, policy_version: 'creator-premium-b4-v1' },
    transactions: { complete: true, count: 928, items: financeTransactions },
    ledger_entries: { complete: true, count: 1918, items: Array.from({ length: 1918 }, (_, index) => ({ id: `entry-${index}` })) },
    ledger_accounts: {
      complete: true,
      count: 131,
      items: Array.from({ length: 131 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
        owner_id_sha256: '2'.repeat(64),
        account_type: 'user',
        currency: 'BDAG',
        created_at: '2026-10-01T12:00:00.000000Z',
      })),
    },
    premium_transaction_count: 0,
    premium_bindings: {
      purchase_receipts: { count: 0, sha256: '3'.repeat(64) },
      subscription_periods: { count: 0, sha256: '4'.repeat(64) },
    },
    reconciliation: zeroReconciliations,
  };
  const relationNames = [
    'creator_premium_contents', 'creator_premium_finance_policy', 'creator_premium_offer_versions',
    'creator_premium_plan_contents', 'creator_premium_plans', 'creator_premium_purchase_receipts',
    'creator_premium_subscription_periods', 'creator_premium_subscriptions',
  ];
  if (['39157300357', '39195966131'].includes(source.run_id)) {
    relationNames.unshift('creator_premium_content_safety_context_evaluations');
  }
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/health')) {
      return json(['auth', 'db', 'pooler', 'realtime', 'rest', 'storage'].map(name => ({ name, healthy: true, status: 'ACTIVE_HEALTHY' })));
    }
    if (pathname.endsWith('/database/migrations')) return json(migrationRows);
    if (pathname.endsWith('/functions')) return json(functionRows);
    if (pathname.endsWith('/advisors/security')) return json({ lints: [] });
    if (pathname.endsWith('/database/backups')) {
      return json({ backups: [{ id: '1988056631', inserted_at: '2026-10-17T05:15:56.590Z', is_physical_backup: true, status: 'COMPLETED' }] });
    }
    if (pathname.endsWith('/database/query/read-only')) {
      const body = JSON.parse(options.body);
      if (body.query.includes('nelyon-finance-snapshot-v1')) return json([{ snapshot: finance }], 201);
      if (body.query.includes('nelyon-cron-snapshot-v1')) return json([{ snapshot: { schema_version: 1, complete: true, query_id: 'nelyon-cron-snapshot-v1', count: 0, items: [] } }], 201);
      if (body.query.includes('pg_get_function_identity_arguments')) {
        return json(controlledPolicy.security_advisor.exceptions
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
    }
    throw new Error(`unexpected recovery fixture request ${url}`);
  };
  const currentEvidence = await adapter.captureProductionSnapshot({
    phase: 'recovery',
    policy: controlledPolicy,
    request: recoveryRequest,
    manifest: recoveryManifest,
    token: 'fixture-token',
    fetchImpl,
    observedAt: '2026-10-17T22:00:01.000Z',
    adapterSourceSha256,
  });
  const rpcItems = controlledPolicy.security_advisor.exceptions
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
  const baselineAdvisorItems = Array.from({ length: 554 }, (_, index) => ({
    fingerprint: String(index + 1).padStart(64, '0'),
    level: 'WARN',
    resource_kind: 'table',
  }));
  const advisorItems = [...baselineAdvisorItems, ...controlledPolicy.security_advisor.exceptions.map(exception => ({
    fingerprint: exception.advisor_fingerprint,
    level: exception.advisor_severity,
    resource_kind: exception.advisor_type,
  }))].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  currentEvidence.cron_security.advisors = {
    complete: true,
    count: advisorItems.length,
    items: advisorItems,
    sha256: gate.sha256Hex(gate.canonicalJson(advisorItems)),
  };
  controlledPolicy.security_advisor.baseline.cron_security_sha256 = gate.sha256Hex(gate.canonicalJson({
    complete: true,
    cron: currentEvidence.cron_security.cron.items,
    security_findings: baselineAdvisorItems,
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
    steps: { pre_snapshot: 'success', pre_verification: 'success', migration_dry_run: 'success', migrations: 'success', functions: 'success', post_snapshot: 'success', postcheck: 'failure' },
    pre_evidence_sha256: source.pre_snapshot_evidence_sha256,
    post_evidence_sha256: source.post_snapshot_evidence_sha256,
  };
  return { adapterSourceSha256, controlledPolicy, recoveryRequest, recoveryManifest, sourceManifest, sourceObservation, currentEvidence };
}

test('policy accepts the exact repository owner project modes and managed functions', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validatePolicy(policy), true);
  assert.equal(policy.owner, OWNER);
  assert.equal(policy.repository, REPOSITORY);
  assert.equal(policy.supabase.project_ref, PROJECT_REF);
  assert.equal(policy.schema_version, 2);
  assert.deepEqual(policy.modes, ['plan_only', 'gate_proof', 'release', 'postcheck_recovery']);
  assert.deepEqual(policy.scope_confirmations, {
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

test('Security Advisor exceptions are exact object-bound verified attestations', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(gate.validateSecurityAdvisorPolicy(policy.security_advisor), true);
  assert.equal(policy.security_advisor.baseline.count, 554);
  assert.equal(policy.security_advisor.baseline.cron_security_sha256, '2dd76dccc8b348eb932fee5c8ada572f57243287f3ca96bf851a75a2e9244846');
  const exceptions = policy.security_advisor.exceptions;
  assert.equal(exceptions.length, 16);
  assert.deepEqual(exceptions.map(item => item.advisor_fingerprint).sort(), [...A2_EXCEPTION_FINGERPRINTS, ...F1_EXCEPTION_FINGERPRINTS, ...F1_C4_EXCEPTION_FINGERPRINTS, P2_RELATION_ADVISOR_FINGERPRINT].sort());
  assert.equal(exceptions.some(item => A2_PREEXISTING_FINGERPRINTS.includes(item.advisor_fingerprint)), false);
  const rpcExceptions = exceptions.filter(item => item.advisor_type === 'authenticated_security_definer_function_executable');
  assert.equal(rpcExceptions.length, 15);
  for (const exception of rpcExceptions) {
    assert.equal(exception.advisor_type, 'authenticated_security_definer_function_executable');
    assert.equal(exception.advisor_severity, 'WARN');
    assert.equal(exception.object.schema, 'public');
    assert.ok(exception.object.name.length > 0);
    assert.ok(exception.object.argument_types.length > 0);
    assert.ok(exception.object.identity_arguments.length > 0);
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
    if (exception.object.name === 'submit_my_creator_premium_content_with_plans_v1') {
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
});

test('recovery source is exact immutable failed-postcheck authority', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  assert.equal(policy.postcheck_recovery.approved_sources.length, 3);
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
  assert.equal(result.security_advisor.exception_count, 16);
  assert.deepEqual(result.finance.policy, policy.supabase.finance_policy);
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
  const verifyStart = source.indexOf("if (command === 'verify-recovery-source')");
  const postcheckStart = source.indexOf("if (command === 'postcheck-recovery')");
  const nextCommand = source.indexOf("if (command === 'verify-function-contract')", postcheckStart);
  assert.ok(verifyStart > 0 && postcheckStart > verifyStart && nextCommand > postcheckStart);
  const recoveryDispatcher = source.slice(verifyStart, nextCommand);
  assert.match(recoveryDispatcher, /verifyRecoveryArtifactProvenance/);
  assert.match(recoveryDispatcher, /verifyPostcheckRecovery/);
  assert.doesNotMatch(recoveryDispatcher, /execFileSync|spawn|supabase\s+(?:db|migration|functions)|--command|child_process/);
  assert.match(source, /verify-recovery-source\|postcheck-recovery/);
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

function autoDeployEvidence(gate, overrides = {}) {
  const { sha256, ...payloadOverrides } = overrides;
  const payload = {
    id: 'supabase-off-20261009T120000Z',
    project_ref: PROJECT_REF,
    production_branch: 'main',
    state: 'off',
    observed_at: '2026-10-09T12:00:00.000Z',
    observed_by: OWNER,
    source: 'owner-dashboard',
    redacted: true,
    ...payloadOverrides,
  };
  return { ...payload, sha256: sha256 ?? gate.sha256Hex(gate.canonicalJson(payload)) };
}

test('release approval token binds run attempt environment release SHA manifest and fresh evidence', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.equal(
    gate.buildApprovalToken(approvalInput()),
    `NELYON-APPROVE run=123456789 attempt=1 env=42 release=nelyon-20261009-001 sha=${MAIN_SHA} manifest=${'c'.repeat(64)} auto_deploy_evidence=supabase-off-20261009T120000Z auto_deploy_sha256=${'d'.repeat(64)}`,
  );
});

test('gate proof approval token binds the run without requiring auto-deploy evidence', async () => {
  const { gate } = await loadGateAndPolicy();
  const input = approvalInput({ mode: 'gate_proof' });
  delete input.evidenceId;
  delete input.evidenceSha256;
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

test('release requires owner confirmation of current auto-deploy-off evidence', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence(gate);
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
  const evidence = autoDeployEvidence(gate);
  assertDenied(() => gate.verifyAutoDeployEvidence({
    evidence,
    approval: { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER },
    now: '2026-10-09T12:15:01.000Z',
  }), 'STALE_AUTO_DEPLOY_EVIDENCE');
});

test('future evidence beyond 60 seconds clock skew denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence(gate, { observed_at: '2026-10-09T12:01:01.000Z' });
  assertDenied(() => gate.verifyAutoDeployEvidence({
    evidence,
    approval: { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER },
    now: '2026-10-09T12:00:00.000Z',
  }), 'FUTURE_AUTO_DEPLOY_EVIDENCE');
});

test('mismatched evidence ID digest project branch or approval comment denies', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence(gate);
  const approval = { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER };
  const cases = [
    [evidence, { ...approval, evidenceId: 'another-evidence' }],
    [evidence, { ...approval, evidenceSha256: 'e'.repeat(64) }],
    [{ ...evidence, project_ref: 'wrongprojectwrongpro' }, approval],
    [{ ...evidence, production_branch: 'dev' }, approval],
    [{ ...evidence, observed_by: 'someone-else' }, approval],
  ];
  for (const [candidate, binding] of cases) {
    assertDenied(() => gate.verifyAutoDeployEvidence({
      evidence: candidate,
      approval: binding,
      now: '2026-10-09T12:10:00.000Z',
    }), 'INVALID_AUTO_DEPLOY_EVIDENCE');
  }
});

test('auto-deploy evidence digest binds canonical bytes without requiring a policy commit', async () => {
  const { gate } = await loadGateAndPolicy();
  const evidence = autoDeployEvidence(gate);
  const approval = { evidenceId: evidence.id, evidenceSha256: evidence.sha256, projectRef: PROJECT_REF, productionBranch: 'main', owner: OWNER };
  for (const candidate of [
    { ...evidence, observed_at: '2026-10-09T12:00:01.000Z' },
    { ...evidence, sha256: 'e'.repeat(64) },
  ]) {
    assertDenied(() => gate.verifyAutoDeployEvidence({
      evidence: candidate,
      approval,
      now: '2026-10-09T12:10:00.000Z',
    }), 'INVALID_AUTO_DEPLOY_EVIDENCE');
  }
});

test('plan_only gate_proof and postcheck recovery never require Supabase deployment secrets', async () => {
  const { gate } = await loadGateAndPolicy();
  assert.deepEqual(gate.requiredSecretsForMode('plan_only', {}), []);
  assert.deepEqual(gate.requiredSecretsForMode('gate_proof', {}), []);
  assert.deepEqual(gate.requiredSecretsForMode('postcheck_recovery', {}), []);
  assertDenied(() => gate.requiredSecretsForMode('release', {}), 'MISSING_SECRETS');
  assert.deepEqual(gate.requiredSecretsForMode('release', { SUPABASE_ACCESS_TOKEN: 'scoped-deploy-token' }), ['SUPABASE_ACCESS_TOKEN']);
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
  finance.finance.premium_ledger_entry_count = 1;
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

test('unchanged counters are not required when legitimate concurrent transactions reconcile', async () => {
  const { gate, policy } = await loadGateAndPolicy();
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
    expectedPolicy: policy.supabase.finance_policy,
  });
  assert.equal(result.integrity, 'PASS');
  assert.equal(result.count_growth.transactions, 1);
  assert.equal(result.count_growth.ledger_entries, 4);
});

test('postcheck authority derives finance window from raw rows instead of trusting PASS', async () => {
  const { gate, policy } = await loadGateAndPolicy();
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
    expectedPolicy: policy.supabase.finance_policy,
    releaseIdentity: releaseIdentity(),
  });
  assert.deepEqual(result.window.preexisting_confirmed_after_snapshot, ['txn-old']);
  assert.equal(result.finance.integrity, 'PASS');
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after,
    windowRows: { complete: true, integrity: 'PASS', transactions: [], ledger_entries: entries },
    reconciliationResults: zeroReconciliation(),
    expectedPolicy: policy.supabase.finance_policy,
    releaseIdentity: releaseIdentity(),
  }), 'INVALID_FINANCE_WINDOW');
});

test('finance postcheck requires the exact reconciliation inventory and monotonic database time', async () => {
  const { gate, policy } = await loadGateAndPolicy();
  const before = financeSnapshot({ databaseTime: '2026-10-09T12:00:05.000Z' });
  const after = financeSnapshot({ databaseTime: '2026-10-09T12:00:04.000Z' });
  const windowRows = { complete: true, transactions: [], ledger_entries: [] };
  const exact = zeroReconciliation();
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after: financeSnapshot({ databaseTime: '2026-10-09T12:00:06.000Z' }),
    windowRows,
    reconciliationResults: { not_a_canonical_reconciliation: 0 },
    expectedPolicy: policy.supabase.finance_policy,
    releaseIdentity: releaseIdentity(),
  }), 'FINANCE_RECONCILIATION_FAILED');
  assertDenied(() => gate.verifyFinancePostcheckFromRaw({
    before,
    after,
    windowRows,
    reconciliationResults: exact,
    expectedPolicy: policy.supabase.finance_policy,
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
  const { gate, policy } = await loadGateAndPolicy();
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
    expectedPolicy: policy.supabase.finance_policy,
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
  const { gate, policy } = await loadGateAndPolicy();
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
    expectedPolicy: policy.supabase.finance_policy,
  }), 'FINANCE_RECONCILIATION_FAILED');
});

test('snapshot count growth is reported separately from integrity verdict', async () => {
  const { gate, policy } = await loadGateAndPolicy();
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
    expectedPolicy: policy.supabase.finance_policy,
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

test('release compares fresh auto-deploy evidence while gate proof does not require it', () => {
  const text = workflowText();
  const plan = workflowJob(text, 'plan', 'deploy');
  const deploy = workflowJob(text, 'deploy');
  assert.match(plan, /name: Fetch fresh auto-deploy-off evidence for release only\s*\n\s*if: inputs\.mode == 'release'/);
  assert.match(plan, /cp release-input\/auto-deploy-evidence\.json release-artifact\/auto-deploy-evidence\.json/);
  assert.match(deploy, /cmp --silent release-artifact\/auto-deploy-evidence\.json gate-evidence\/auto-deploy-evidence\.json/);
  const gateProofStep = deploy.slice(deploy.indexOf('name: Verify gate proof'), deploy.indexOf('name: Verify release gate'));
  assert.doesNotMatch(gateProofStep, /auto-deploy-evidence/);
  const releaseGateStep = deploy.slice(deploy.indexOf('name: Verify release gate'), deploy.indexOf('name: Set up pinned Supabase CLI'));
  assert.match(releaseGateStep, /--auto-deploy-evidence gate-evidence\/auto-deploy-evidence\.json/);
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
    'NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64',
    'does not require a policy commit',
    '`gate_proof` does not require auto-deploy evidence',
    'temporary `cli_login_postgres` role',
    'fresh completed physical backup',
    'SHA-256 of `canonicalJson(evidenceWithoutSha256)`',
    'base64-encode the complete canonical JSON including `sha256`',
    '15 minutes',
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
  assert.doesNotMatch(text, /SUPABASE_READ_ONLY_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|Every renewed evidence record must also replace/);
  assert.doesNotMatch(text, /SUPABASE_ACCESS_TOKEN\s*[=:]\s*[^`\s]+/);
});
