import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
  B2_VAULT_EDGE_PARITY_SQL,
  assertReadOnlySql,
  captureB2AuthorityObservation,
  normalizeB2EdgeSecretDigestInventory,
  readSnapshotDiagnostic,
  verifyB2AuthorityObservation,
} from '../scripts/nelyon-production-snapshot-adapter.mjs';

const PROJECT_REF = 'aewwdlvbwpczqyvkwvvj';
const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const SHA = '1'.repeat(40);
const TREE = '2'.repeat(40);
const STARTED = '2026-11-22T09:00:00.000Z';
const COMPLETED = '2026-11-22T09:00:02.000Z';
const NONCE = Buffer.alloc(32, 0xa5);
const SECRET = 'observer synthetic secret';
const EDGE_DIGEST = createHash('sha256').update(Buffer.from(SECRET, 'utf8')).digest('hex');
const TAG = createHmac('sha256', Buffer.from(EDGE_DIGEST, 'hex')).update(NONCE).digest('hex');
const BACKUP_POLICY = Object.freeze({ required_status: 'COMPLETED', require_physical: true, max_age_seconds: 86_400 });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function edgeRows(value = EDGE_DIGEST, unrelatedValue = 'f'.repeat(64)) {
  return [
    { name: 'CALL_DISPATCH_SECRET', value, updated_at: '2026-11-22T08:59:00.000Z' },
    { name: 'UNRELATED_SECRET', value: unrelatedValue, updated_at: '2026-11-22T08:58:00.000Z' },
  ];
}

function backupRows() {
  return { backups: [
    { id: 'old', inserted_at: '2026-11-22T08:00:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
    { id: 'latest', inserted_at: '2026-11-22T08:55:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
  ] };
}

const EXISTING_B2_EDGE_FUNCTIONS = [
  'ai-handoff',
  'cleanup-stale-media-uploads',
  'content-safety-scan',
  'create-media-upload',
  'finalize-media-upload',
  'get-media-url',
  'video-semantic-index',
];

function functionRows() {
  return [...EXISTING_B2_EDGE_FUNCTIONS, ...Array.from({ length: 27 }, (_, index) => `existing-${String(index).padStart(2, '0')}`)]
    .map((slug, index) => ({
      slug,
      status: 'ACTIVE',
      version: index + 1,
      verify_jwt: ['content-safety-scan', 'create-media-upload', 'finalize-media-upload', 'get-media-url', 'video-semantic-index']
        .includes(slug),
      ezbr_sha256: createHash('sha256').update(slug).digest('hex'),
    }));
}

function advisorRows() {
  return { lints: [{
    name: 'auth_mfa',
    level: 'WARN',
    facing: 'EXTERNAL',
    categories: ['SECURITY'],
    metadata: { type: 'auth', entity: 'mfa' },
  }] };
}

function captureOptions(overrides = {}) {
  const times = [STARTED, COMPLETED];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ init, path: `${url.pathname}${url.search}` });
    if (url.pathname.endsWith('/database/backups')) return response(backupRows());
    if (url.pathname.endsWith('/functions')) return response(functionRows());
    if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
    if (url.pathname.endsWith('/secrets')) return response(edgeRows());
    if (url.pathname.endsWith('/database/query/read-only')) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.query, B2_VAULT_EDGE_PARITY_SQL);
      assert.deepEqual(payload.parameters, [NONCE.toString('hex')]);
      return response([{ snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } }], 201);
    }
    throw new Error('unexpected request');
  };
  return {
    approvedSha: SHA,
    approvedTreeSha: TREE,
    backupPolicy: BACKUP_POLICY,
    fetchImpl,
    now: () => times.shift(),
    randomBytesImpl: size => { assert.equal(size, 32); return Buffer.from(NONCE); },
    repository: REPOSITORY,
    token: 'synthetic-token-never-retained',
    ...overrides,
    calls,
  };
}

async function rejectsWithoutSensitiveSurface(options) {
  await assert.rejects(() => captureB2AuthorityObservation(options), error => {
    const surfaces = [String(error), error?.stack ?? '', JSON.stringify(error)];
    for (const surface of surfaces) {
      for (const forbidden of ['synthetic-token-never-retained', EDGE_DIGEST, TAG, SECRET]) {
        assert.equal(surface.includes(forbidden), false, forbidden);
      }
    }
    return true;
  });
}

test('fixed Vault parity SQL is read-only and returns no Vault value or digest', () => {
  assert.equal(assertReadOnlySql(B2_VAULT_EDGE_PARITY_SQL), true);
  assert.match(B2_VAULT_EDGE_PARITY_SQL, /vault\.decrypted_secrets/u);
  assert.match(B2_VAULT_EDGE_PARITY_SQL, /call_dispatch_secret/u);
  assert.doesNotMatch(B2_VAULT_EDGE_PARITY_SQL, /jsonb_build_object\([^)]*decrypted_secret/isu);
});

test('strict Edge secret inventory accepts only exact documented rows and detaches digest bytes', () => {
  const rows = edgeRows();
  const normalized = normalizeB2EdgeSecretDigestInventory(rows);
  const expected = Buffer.from(EDGE_DIGEST, 'hex');
  assert.equal(normalized.targetName, 'CALL_DISPATCH_SECRET');
  assert.equal(normalized.targetDigest.equals(expected), true);
  assert.notStrictEqual(normalized.targetDigest, expected);
  assert.equal(Object.hasOwn(normalized, 'records'), false);
  assert.equal(rows.every(row => row.value === ''), true);
  for (const invalid of [
    { secrets: edgeRows() },
    [{ name: 'CALL_DISPATCH_SECRET', value: EDGE_DIGEST, extra: true }],
    [{ name: 'CALL_DISPATCH_SECRET', value: EDGE_DIGEST.toUpperCase() }],
    [{ name: 'CALL_DISPATCH_SECRET', value: 'f'.repeat(63) }],
    [...edgeRows(), ...edgeRows()],
    [{ name: 'OTHER', value: EDGE_DIGEST }],
    [{ name: 'CALL_DISPATCH_SECRET', value: EDGE_DIGEST, updated_at: 'not-a-time' }],
  ]) assert.throws(() => normalizeB2EdgeSecretDigestInventory(invalid));
  const duplicateRows = [...edgeRows(), ...edgeRows()];
  assert.throws(() => normalizeB2EdgeSecretDigestInventory(duplicateRows));
  assert.equal(duplicateRows.every(row => row.value === ''), true);
  normalized.dispose();
  assert.equal(normalized.targetDigest.every(byte => byte === 0), true);
});

test('authority observation captures strict Advisor facts and current Edge inventory in addition to backup and parity', async () => {
  const options = captureOptions();
  const observation = await captureB2AuthorityObservation(options);
  assert.deepEqual(options.calls.map(call => call.path), [
    `/v1/projects/${PROJECT_REF}/database/backups`,
    `/v1/projects/${PROJECT_REF}/functions`,
    `/v1/projects/${PROJECT_REF}/advisors/security`,
    `/v1/projects/${PROJECT_REF}/secrets`,
    `/v1/projects/${PROJECT_REF}/database/query/read-only`,
    `/v1/projects/${PROJECT_REF}/secrets`,
  ]);
  assert.equal(observation.kind, 'nelyon-b2-authority-observation-v1');
  assert.equal(observation.startedAt, STARTED);
  assert.equal(observation.completedObservedAt, COMPLETED);
  assert.equal(observation.backup.status, 'COMPLETED');
  assert.equal(observation.backup.insertedAt, '2026-11-22T08:55:00.000Z');
  assert.equal(observation.backup.completedObservedAt, COMPLETED);
  assert.equal(observation.vaultEdgeParity.schemaVersion, 2);
  assert.equal(observation.vaultEdgeParity.mechanism, 'supabase-vault-edge-nonce-hmac-sha256-v1');
  assert.equal(observation.vaultEdgeParity.result, 'MATCH');
  assert.equal(observation.functionInventory.count, 34);
  assert.equal(observation.functionInventory.items.some(item => item.slug === 'process-scheduled-publications'), false);
  assert.equal(observation.securityAdvisor.baselineItems.length, 1);
  assert.equal(observation.securityAdvisor.findings.length, 1);
  assert.deepEqual(Object.keys(observation.securityAdvisor.findings[0]).sort(), [
    'fingerprint', 'identity', 'objectIdentity', 'objectSha256', 'severity', 'type',
  ]);
  assert.equal(verifyB2AuthorityObservation(observation).observationSha256, observation.observationSha256);
  const serialized = JSON.stringify(observation);
  for (const forbidden of ['synthetic-token', EDGE_DIGEST, TAG, NONCE.toString('hex'), 'hmac_tag', 'response_sha256', 'latest']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('authority observation ignores unrelated secret rotation and zeroes an injected nonce buffer', async () => {
  let secretReads = 0;
  const injectedNonce = Uint8Array.from(NONCE);
  const options = captureOptions({
    randomBytesImpl: () => injectedNonce,
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith('/database/backups')) return response(backupRows());
      if (url.pathname.endsWith('/functions')) return response(functionRows());
      if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
      if (url.pathname.endsWith('/secrets')) {
        return response(edgeRows(EDGE_DIGEST, secretReads++ === 0 ? 'e'.repeat(64) : 'f'.repeat(64)));
      }
      const payload = JSON.parse(init.body);
      assert.equal(payload.query, B2_VAULT_EDGE_PARITY_SQL);
      return response([{ snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } }], 201);
    },
  });
  const observation = await captureB2AuthorityObservation(options);
  assert.equal(observation.vaultEdgeParity.result, 'MATCH');
  assert.equal(injectedNonce.every(byte => byte === 0), true);
  assert.equal(JSON.stringify(observation).includes(EDGE_DIGEST), false);
  assert.equal(JSON.stringify(observation).includes(TAG), false);
});

test('authority observation fails closed on parity mismatch, secret rotation and ambiguous Vault results', async () => {
  const mismatch = captureOptions({
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith('/database/backups')) return response(backupRows());
      if (url.pathname.endsWith('/functions')) return response(functionRows());
      if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
      if (url.pathname.endsWith('/secrets')) return response(edgeRows());
      const payload = JSON.parse(init.body);
      assert.equal(payload.query, B2_VAULT_EDGE_PARITY_SQL);
      return response([{ snapshot: { schema_version: 1, complete: true, hmac_tag: '0'.repeat(64) } }], 201);
    },
  });
  await assert.rejects(() => captureB2AuthorityObservation(mismatch));

  let secretReads = 0;
  const rotation = captureOptions({
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith('/database/backups')) return response(backupRows());
      if (url.pathname.endsWith('/functions')) return response(functionRows());
      if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
      if (url.pathname.endsWith('/secrets')) return response(edgeRows(secretReads++ === 0 ? EDGE_DIGEST : 'f'.repeat(64)));
      JSON.parse(init.body);
      return response([{ snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } }], 201);
    },
  });
  await assert.rejects(() => captureB2AuthorityObservation(rotation));

  const ambiguous = captureOptions({
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith('/database/backups')) return response(backupRows());
      if (url.pathname.endsWith('/functions')) return response(functionRows());
      if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
      if (url.pathname.endsWith('/secrets')) return response(edgeRows());
      JSON.parse(init.body);
      return response([{ snapshot: { schema_version: 1, complete: false, hmac_tag: null } }], 201);
    },
  });
  await assert.rejects(() => captureB2AuthorityObservation(ambiguous));

  for (const vaultBody of [[], [
    { snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } },
    { snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } },
  ]]) {
    const invalidCardinality = captureOptions({
      fetchImpl: async (url) => {
        if (url.pathname.endsWith('/database/backups')) return response(backupRows());
        if (url.pathname.endsWith('/functions')) return response(functionRows());
        if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
        if (url.pathname.endsWith('/secrets')) return response(edgeRows());
        return response(vaultBody, 201);
      },
    });
    await rejectsWithoutSensitiveSurface(invalidCardinality);
  }
});

test('authority observation rejects stale, future, absent, duplicate and ambiguous backup candidates', async () => {
  const invalidBackups = [
    { backups: [{ id: 'stale', inserted_at: '2026-11-20T08:00:00.000Z', is_physical_backup: true, status: 'COMPLETED' }] },
    { backups: [{ id: 'future', inserted_at: '2026-11-22T10:00:00.000Z', is_physical_backup: true, status: 'COMPLETED' }] },
    { backups: [] },
    { backups: [
      { id: 'duplicate', inserted_at: '2026-11-22T08:55:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
      { id: 'duplicate', inserted_at: '2026-11-22T08:54:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
    ] },
    { backups: [
      { id: 'ambiguous-a', inserted_at: '2026-11-22T08:55:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
      { id: 'ambiguous-b', inserted_at: '2026-11-22T08:55:00.000Z', is_physical_backup: true, status: 'COMPLETED' },
    ] },
  ];
  for (const backups of invalidBackups) {
    const options = captureOptions({
      fetchImpl: async (url) => {
        if (url.pathname.endsWith('/database/backups')) return response(backups);
        if (url.pathname.endsWith('/functions')) return response(functionRows());
        if (url.pathname.endsWith('/advisors/security')) return response(advisorRows());
        if (url.pathname.endsWith('/secrets')) return response(edgeRows());
        return response([{ snapshot: { schema_version: 1, complete: true, hmac_tag: TAG } }], 201);
      },
    });
    await rejectsWithoutSensitiveSurface(options);
  }
});

test('sensitive transport rejects auth, redirect, non-JSON and oversized responses without retained evidence', async () => {
  const cases = [
    () => response({ message: `denied ${EDGE_DIGEST}` }, 401),
    () => Response.redirect('https://example.invalid/redirected', 302),
    () => new Response(TAG, { status: 200, headers: { 'content-type': 'text/plain' } }),
    () => new Response('{}', { status: 200, headers: {
      'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024 + 1),
    } }),
  ];
  for (const makeFailure of cases) {
    const options = captureOptions({
      fetchImpl: async url => url.pathname.endsWith('/database/backups') ? response(backupRows()) : makeFailure(),
    });
    await rejectsWithoutSensitiveSurface(options);
  }
});

test('authority observation exposes only a bounded stage/category diagnostic for provider failures', async () => {
  const options = captureOptions({
    fetchImpl: async url => {
      if (url.pathname.endsWith('/database/backups')) {
        return response({ message: `denied ${EDGE_DIGEST}` }, 403);
      }
      throw new Error('provider request order escaped the backup boundary');
    },
  });
  let captured;
  await assert.rejects(() => captureB2AuthorityObservation(options), error => {
    captured = error;
    return true;
  });
  assert.deepEqual(readSnapshotDiagnostic(captured), {
    phase: 'AUTHORITY_OBSERVATION',
    category: 'BACKUP_READ_ACCESS_DENIED',
  });
  const surface = JSON.stringify(readSnapshotDiagnostic(captured));
  for (const forbidden of [EDGE_DIGEST, 'denied', 'database/backups', 'synthetic-token-never-retained']) {
    assert.equal(surface.includes(forbidden), false, forbidden);
  }
});

test('observation verifier rejects stale, value-bearing and digest-mutated evidence', async () => {
  const observation = await captureB2AuthorityObservation(captureOptions());
  for (const invalid of [
    { ...observation, observationSha256: '0'.repeat(64) },
    { ...observation, vaultEdgeParity: { ...observation.vaultEdgeParity, result: 'UNKNOWN' } },
    { ...observation, vaultEdgeParity: { ...observation.vaultEdgeParity, value: EDGE_DIGEST } },
    { ...observation, vaultEdgeParity: { ...observation.vaultEdgeParity, expiresAt: observation.vaultEdgeParity.observedAt } },
    { ...observation, projectRef: 'other-project' },
    { ...observation, functionInventory: { ...observation.functionInventory, count: 33 } },
    { ...observation, functionInventory: { ...observation.functionInventory,
      items: [...observation.functionInventory.items, { ...observation.functionInventory.items[0], slug: 'process-scheduled-publications' }] } },
    { ...observation, securityAdvisor: { ...observation.securityAdvisor,
      findings: [{ ...observation.securityAdvisor.findings[0], value: SECRET }] } },
  ]) assert.throws(() => verifyB2AuthorityObservation(invalid));
});
