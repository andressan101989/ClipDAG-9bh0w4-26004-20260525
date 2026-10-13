import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterUrl = new URL('../scripts/nelyon-production-snapshot-adapter.mjs', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url), 'utf8'));

async function loadAdapter() {
  return import(`${adapterUrl.href}?test=${Date.now()}-${Math.random()}`);
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
    if (pathname.endsWith('/advisors/security')) return jsonResponse(overrides.advisors ?? { lints: [] });
    if (pathname.endsWith('/database/query/read-only')) {
      const body = JSON.parse(options.body);
      return jsonResponse([{ snapshot: body.parameters ? (overrides.finance ?? financeSnapshot()) : cronSnapshot() }], 201);
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
  assert.match(result.evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(call => call.options.method ?? 'GET'), ['GET', 'GET', 'GET', 'GET', 'POST', 'POST']);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'api.supabase.com');
    assert.match(url.pathname, new RegExp(`/v1/projects/${policy.supabase.project_ref}/`));
    assert.equal(call.options.redirect, 'error');
  }
  const sqlCalls = calls.filter(call => (call.options.method ?? 'GET') === 'POST');
  assert.equal(sqlCalls.length, 2);
  assert.ok(sqlCalls.every(call => new URL(call.url).pathname.endsWith('/database/query/read-only')));
  assert.ok(sqlCalls.every(call => !new URL(call.url).pathname.endsWith('/database/query')));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-read-token/);
  assert.doesNotMatch(serialized, /authorization/i);
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
    assert.ok(calls.length <= 5);
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
