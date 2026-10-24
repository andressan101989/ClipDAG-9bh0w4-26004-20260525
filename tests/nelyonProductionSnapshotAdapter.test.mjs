import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterUrl = new URL('../scripts/nelyon-production-snapshot-adapter.mjs', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url), 'utf8'));

async function loadAdapter() {
  return import(`${adapterUrl.href}?test=${Date.now()}-${Math.random()}`);
}

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
        blob: '01468928aac3743245916157a6acf0bd9d7aab7f',
        path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql',
        version: '20261024173500',
      }],
      config_changed: true,
      managed_scope_transition: {
        id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
        attested_source_sha: '5613724beb966f83cc39ee9b1cebe8c0e08b7d7b',
        approved_sha: 'a'.repeat(40),
        descendant_verified: true,
        migration_blob: '01468928aac3743245916157a6acf0bd9d7aab7f',
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
    attested_source_sha: '5613724beb966f83cc39ee9b1cebe8c0e08b7d7b',
    migration: '20261024173500_creator_premium_f2_complete_monetization',
    migration_blob: '01468928aac3743245916157a6acf0bd9d7aab7f',
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
  assert.equal(snapshot.count, 17);
  assert.equal(snapshot.items.length, 17);
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

test('fixed documented recovery capture uses four read-only SQL requests and redacts credentials', async () => {
  const adapter = await loadAdapter();
  const calls = [];
  const result = await adapter.captureProductionSnapshot({
    phase: 'recovery', policy, request: request(), manifest: manifest(),
    token: 'never-serialize-recovery-token', fetchImpl: successfulFetch(calls),
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
    token: 'never-serialize-recovery-token', fetchImpl: successfulFetch([]),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  const items = policy.security_advisor.exceptions
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
  }), /REMOTE_BASELINE_MISMATCH/);
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
});

test('phase-bound RPC attestations include F1 protected RPCs only after the manifest migration', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261018211327_creator_premium_qa_final_f1.sql',
    version: '20261018211327',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre')), 16);
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post')), 17);
  assert.equal(rpcCount(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'recovery')), 17);
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
  assert.equal(rpcCount(pre), 17);
  assert.equal(rpcCount(post), 17);
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
  assert.equal(rpcCount(pre), 17);
  assert.equal(rpcCount(post), 17);
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
  assert.equal(rpcCount(pre), 17);
  assert.equal(rpcCount(post), 17);
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
    path: 'supabase/migrations/20261024173500_creator_premium_f2_complete_monetization.sql',
    version: '20261024173500',
  }];
  const rpcCount = items => items.filter(item => Array.isArray(item.object.argument_types)).length;
  const pre = adapter.advisorExceptionsForPhase(policy, controlledManifest, 'pre');
  const post = adapter.advisorExceptionsForPhase(policy, controlledManifest, 'post');
  assert.equal(rpcCount(pre), 15);
  assert.equal(rpcCount(post), 17);
  assert.equal(pre.some(item => item.object.name === 'get_my_creator_premium_financial_history_v1'), false);
  assert.equal(pre.some(item => item.object.name === 'search_admin_creator_premium_finance_v1'), false);
  const expected = new Map([
    ['get_creator_premium_commerce_v1', ['30c9a4a75712f74d3d62a39f962f87ce98f22269dd1b46b259b1d15ef89d7e86', 'e96caaab2c8ad2cd24e508849c0a7fff15d0257ac7a55a035aaa59b8632ed5c0']],
    ['get_my_creator_premium_commercial_summary_v1', ['1a34a92abe226cdb66b3d8ba95b848d7576fe81e324839c9424582dc44610d05', 'e4f4cb3d311ba740bd9827b821c28ba2069be49adfad954b29ba790a6bd3dadb']],
    ['get_my_creator_premium_subscriptions_v1', ['dddaf6f218f2abe7a24d97dfdd4fc0cb125fed5b7e2088c510bd4f8368124685', 'e60b91e953d720f966b3c0622ba86cf375a125166dac8ba384dc956e35cb8830']],
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
