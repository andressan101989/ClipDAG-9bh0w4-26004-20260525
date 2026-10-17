import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterUrl = new URL('../scripts/nelyon-production-snapshot-adapter.mjs', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url), 'utf8'));

async function loadAdapter() {
  return import(`${adapterUrl.href}?test=${Date.now()}-${Math.random()}`);
}

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
  ['get_my_creator_premium_subscriptions_v1', ['timestamp with time zone', 'uuid', 'integer']],
  ['reopen_my_creator_premium_rejected_v1', ['uuid']],
  ['report_creator_premium_content_v1', ['uuid', 'text', 'text']],
  ['search_admin_creator_premium_content_v1', ['text', 'text', 'timestamp with time zone', 'uuid', 'integer']],
  ['cancel_my_creator_premium_submission_v1', ['uuid']],
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
      return jsonResponse([{ slug: 'content-safety-scan', status: 'ACTIVE', version: 35, verify_jwt: true, ezbr_sha256: '5'.repeat(64) }]);
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
  assert.equal(snapshot.count, 12);
  assert.equal(snapshot.items.length, 12);
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

test('Premium postcheck state validates fail-closed counts and exact relation security', async () => {
  const adapter = await loadAdapter();
  const state = adapter.normalizePremiumPostcheckState(premiumPostcheckSnapshot());
  assert.equal(adapter.validatePremiumPostcheckState(state, state.relation_security.items), true);
  assert.deepEqual(state.content_safety, {
    approved_rule_count: 0,
    active_rule_count: 0,
    fabricated_pass_count: 0,
  });
  assert.deepEqual(state.legacy, { content_count: 2, pending_review_count: 1, deleted_count: 1 });
  for (const drift of [
    { content_safety: { ...state.content_safety, approved_rule_count: 1 } },
    { content_safety: { ...state.content_safety, active_rule_count: 1 } },
    { content_safety: { ...state.content_safety, fabricated_pass_count: 1 } },
    { legacy: { ...state.legacy, content_count: 3 } },
    { legacy: { ...state.legacy, pending_review_count: 0 } },
    { legacy: { ...state.legacy, deleted_count: 0 } },
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

test('fixed documented recovery capture uses four read-only SQL requests and redacts credentials', async () => {
  const adapter = await loadAdapter();
  const calls = [];
  const result = await adapter.captureProductionSnapshot({
    phase: 'recovery', policy, request: request(), manifest: manifest(),
    token: 'never-serialize-recovery-token', fetchImpl: successfulFetch(calls),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
  assert.equal(result.phase, 'recovery');
  assert.equal(result.rpc_security.count, 12);
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
  const items = policy.security_advisor.exceptions.map(exception => ({
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
  const controlledPolicy = structuredClone(policy);
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
  const controlledPolicy = structuredClone(policy);
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
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
    assert.throws(() => adapter.verifyProductionSnapshotPair({
      pre, post, policy: controlledPolicy, request: request(), manifest: postManifest,
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_POSTCHECK_FAILED/);
  }
});

test('postcheck preserves every pre-existing ledger account identity while allowing new accounts', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  const pre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
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
    assert.throws(() => adapter.verifyProductionSnapshotPair({
      pre, post: invalidPost, policy: controlledPolicy, request: request(), manifest: manifest(),
      adapterSourceSha256: '6'.repeat(64),
    }), /REMOTE_POSTCHECK_FAILED/);
  }
});

test('pre-snapshot must match every owner-reviewed baseline digest before mutation', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
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

test('pre-snapshot baseline binds finance schema Premium bindings and zero reconciliation', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  controlledPolicy.supabase.expected_remote_function_count = 1;
  controlledPolicy.supabase.managed_functions = ['content-safety-scan'];
  controlledPolicy.baseline.migration_count = 1;
  controlledPolicy.baseline.latest_migration = '20261009021414_creator_premium_b5_creator_management_ux';
  const baselinePre = await adapter.captureProductionSnapshot({
    phase: 'pre', policy: controlledPolicy, request: request(), manifest: manifest(),
    token: 'private-read-token', fetchImpl: successfulFetchWithFunctionVersion([], 35),
    observedAt: '2026-10-12T12:00:01.000Z', adapterSourceSha256: '6'.repeat(64),
  });
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

test('phase-bound RPC attestations include a new protected RPC only after its manifest migration', async () => {
  const adapter = await loadAdapter();
  const controlledPolicy = structuredClone(policy);
  const controlledManifest = manifest();
  controlledManifest.resources.migrations = [{
    path: 'supabase/migrations/20261017193000_creator_premium_c1_submission_cancellation.sql',
    version: '20261017193000',
  }];
  assert.equal(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'pre').length, 11);
  assert.equal(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'post').length, 12);
  assert.equal(adapter.advisorExceptionsForPhase(controlledPolicy, controlledManifest, 'recovery').length, 12);
});

test('postcheck advisor delta accepts only exact phase-approved fingerprints', async () => {
  const adapter = await loadAdapter();
  const pre = [{ fingerprint: '1'.repeat(64), level: 'WARN', resource_kind: 'existing' }];
  const allowed = { advisor_fingerprint: '2'.repeat(64) };
  const post = [...pre, { fingerprint: allowed.advisor_fingerprint, level: 'WARN', resource_kind: 'new' }];
  assert.equal(adapter.validateSecurityAdvisorDelta(pre, post, [allowed]), true);
  assert.throws(
    () => adapter.validateSecurityAdvisorDelta(pre, [...post, { fingerprint: '3'.repeat(64), level: 'WARN', resource_kind: 'unknown' }], [allowed]),
    /REMOTE_POSTCHECK_FAILED/,
  );
  assert.throws(() => adapter.validateSecurityAdvisorDelta(pre, pre, [allowed]), /REMOTE_POSTCHECK_FAILED/);
});
