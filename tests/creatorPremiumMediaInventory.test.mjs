import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  auditCreatorPremiumMediaInventory,
  collectR2Inventory,
  hashInventoryIdentifier,
  runCli,
} from '../scripts/audit-creator-premium-media-inventory.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const ACCOUNT_ID = 'account-secret-value';
const BUCKET = 'premium-private-bucket';
const PROJECT_REF = 'project-secret-ref';
const HASH_SALT = 'test-only-salt-at-least-16-bytes';
const CAPTURE_ID = 'capture-2026-10-23-media-c1';
const CAPTURED_AT = '2026-10-23T11:59:00.000Z';
const SCOPE_EVIDENCE_DIGEST = `sha256:${'a'.repeat(64)}`;

const captureEvidence = {
  captureId: CAPTURE_ID,
  capturedAt: CAPTURED_AT,
  attestation: {
    verified: true,
    mode: 'official_read_only_scope_evidence',
    verifiedAt: CAPTURED_AT,
    evidenceDigest: SCOPE_EVIDENCE_DIGEST,
  },
};

const r2Scope = {
  access: 'read_only',
  accountId: ACCOUNT_ID,
  bucket: BUCKET,
  operations: ['list', 'head'],
  ...captureEvidence,
};

const streamScope = {
  access: 'read_only',
  accountId: ACCOUNT_ID,
  project: 'account_stream',
  operations: ['list', 'metadata'],
  ...captureEvidence,
};

const databaseScope = {
  access: 'read_only',
  projectRef: PROJECT_REF,
  operations: ['select'],
  ...captureEvidence,
};

const completeRetentionEvidence = {
  linksChecked: true,
  receiptsChecked: true,
  entitlementsChecked: true,
  subscriptionsChecked: true,
  disputesChecked: true,
  legalHoldChecked: true,
};

function providerItem(identity, namespace = 'creator_premium') {
  return {
    identity,
    namespace,
    ownershipEvidence: namespace === 'creator_premium'
      ? {
          verified: true,
          method: 'canonical_creator_premium_namespace',
          evidenceDigest: `sha256:${'e'.repeat(64)}`,
        }
      : null,
  };
}

function asset(overrides = {}) {
  return {
    internalId: overrides.internalId ?? 'asset-default',
    provider: overrides.provider ?? 'r2',
    providerIdentity: overrides.providerIdentity ?? 'premium/default',
    status: overrides.status ?? 'ready',
    referenceCount: overrides.referenceCount ?? 1,
    lifecycleContractVersion: overrides.lifecycleContractVersion ?? 1,
    cleanupState: overrides.cleanupState ?? 'none',
    legacy: overrides.legacy ?? false,
    currentLifecycleFence: overrides.currentLifecycleFence ?? 0,
    deletionReceipt: Object.hasOwn(overrides, 'deletionReceipt')
      ? overrides.deletionReceipt
      : null,
    retention: Object.hasOwn(overrides, 'retention')
      ? overrides.retention
      : {
          complete: true,
          retain: false,
          reasons: [],
          legalHold: 'none',
          evidence: { ...completeRetentionEvidence },
        },
  };
}

function page(scope, items, { nextCursor = null, hasMore = false, complete = true } = {}) {
  return { scope, items, nextCursor, hasMore, complete };
}

function pager(pages, calls = []) {
  return async ({ cursor }) => {
    calls.push(cursor);
    const key = cursor ?? '<first>';
    if (!Object.hasOwn(pages, key)) throw new Error('provider leaked raw failure details');
    return structuredClone(pages[key]);
  };
}

function baseAuditInput(overrides = {}) {
  return {
    expected: {
      accountId: ACCOUNT_ID,
      r2Bucket: BUCKET,
      streamProject: 'account_stream',
      supabaseProjectRef: PROJECT_REF,
      captureId: CAPTURE_ID,
    },
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, []),
      }),
    },
    stream: {
      fetchPage: pager({
        '<first>': page(streamScope, []),
      }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [],
    },
    hashSalt: HASH_SALT,
    expectedLegacyCount: 0,
    now: () => new Date('2026-10-23T12:00:00.000Z'),
    ...overrides,
  };
}

test('read-only adapters paginate every page and classify the complete A-G matrix', async () => {
  const r2Calls = [];
  const streamCalls = [];
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [
          providerItem('premium/retained'),
          providerItem('premium/pending'),
        ], { nextCursor: 'r2-page-2', hasMore: true }),
        'r2-page-2': page(r2Scope, [
          providerItem('premium/provider-only'),
          providerItem('premium/orphan'),
          providerItem('unknown/key', 'unknown'),
        ]),
      }, r2Calls),
    },
    stream: {
      fetchPage: pager({
        '<first>': page(streamScope, [
          providerItem('premium-stream-active'),
        ], { nextCursor: 'stream-page-2', hasMore: true }),
        'stream-page-2': page(streamScope, []),
      }, streamCalls),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [
        asset({
          internalId: 'db-active',
          provider: 'stream',
          providerIdentity: 'premium-stream-active',
        }),
        asset({
          internalId: 'db-retained',
          providerIdentity: 'premium/retained',
          status: 'removed',
          referenceCount: 0,
          retention: {
            complete: true,
            retain: true,
            reasons: ['active_entitlement'],
            legalHold: 'none',
            evidence: { ...completeRetentionEvidence },
          },
        }),
        asset({
          internalId: 'db-pending',
          providerIdentity: 'premium/pending',
          status: 'delete_pending',
          referenceCount: 0,
          cleanupState: 'pending',
        }),
        asset({
          internalId: 'db-only',
          providerIdentity: 'premium/db-only',
          status: 'ready',
          referenceCount: 1,
        }),
        asset({
          internalId: 'db-orphan',
          providerIdentity: 'premium/orphan',
          status: 'deleted',
          referenceCount: 0,
          cleanupState: 'verified_then_reappeared',
          currentLifecycleFence: 3,
          deletionReceipt: {
            absenceVerified: true,
            lifecycleFence: 3,
            evidenceDigest: `sha256:${'b'.repeat(64)}`,
          },
        }),
      ],
    },
  }));

  assert.deepEqual(r2Calls, [null, 'r2-page-2']);
  assert.deepEqual(streamCalls, [null, 'stream-page-2']);
  assert.equal(audit.complete, true);
  assert.equal(audit.verdict, 'indeterminate');
  assert.deepEqual(audit.counts, {
    A: 1,
    B: 1,
    C: 1,
    D: 1,
    E: 1,
    F: 1,
    G: 1,
  });
  assert.equal(audit.totals.provider.r2, 5);
  assert.equal(audit.totals.provider.stream, 1);
  assert.equal(audit.totals.database, 5);
  assert.deepEqual(audit.mutations, {
    providerWrites: 0,
    databaseWrites: 0,
    downloads: 0,
  });
  assert.deepEqual(audit.evidence, {
    mode: 'offline_attested_snapshots',
    liveProviderVerified: false,
    captureRef: hashInventoryIdentifier(HASH_SALT, 'capture', CAPTURE_ID),
  });
});

test('pagination rejects incomplete pages, cursor loops, duplicate identities, and provider exceptions safely', async () => {
  for (const [fetchPage, blocker] of [
    [pager({ '<first>': page(r2Scope, [], { complete: false }) }), 'r2_inventory_partial_page'],
    [pager({
      '<first>': page(r2Scope, [], { nextCursor: 'again', hasMore: true }),
      again: page(r2Scope, [], { nextCursor: 'again', hasMore: true }),
    }), 'r2_inventory_cursor_repeated'],
    [pager({ '<first>': page(r2Scope, [providerItem('same'), providerItem('same')]) }), 'r2_inventory_duplicate_identity'],
    [async () => { throw new Error('private cursor and provider details'); }, 'r2_inventory_page_unavailable'],
  ]) {
    const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({ r2: { fetchPage } }));
    assert.equal(audit.complete, false);
    assert.equal(audit.verdict, 'indeterminate');
    assert.deepEqual(audit.blockers, [blocker]);
    assert.equal(audit.counts.G, 1);
    assert.doesNotMatch(JSON.stringify(audit), /private cursor|provider details/);
  }
});

test('scope validation fails closed for write capability and wrong account, bucket, stream project, or Supabase project', async () => {
  const cases = [
    {
      override: { r2: { fetchPage: pager({ '<first>': page({ ...r2Scope, operations: ['list', 'head', 'delete'] }, []) }) } },
      blocker: 'r2_inventory_scope_not_read_only',
    },
    {
      override: { r2: { fetchPage: pager({ '<first>': page({ ...r2Scope, accountId: 'wrong-account' }, []) }) } },
      blocker: 'r2_inventory_scope_mismatch',
    },
    {
      override: { r2: { fetchPage: pager({ '<first>': page({ ...r2Scope, bucket: 'wrong-bucket' }, []) }) } },
      blocker: 'r2_inventory_scope_mismatch',
    },
    {
      override: { stream: { fetchPage: pager({ '<first>': page({ ...streamScope, project: 'wrong-project' }, []) }) } },
      blocker: 'stream_inventory_scope_mismatch',
    },
    {
      override: {
        stream: {
          fetchPage: pager({
            '<first>': page({
              ...streamScope,
              operations: ['list', 'metadata', 'delete'],
            }, []),
          }),
        },
      },
      blocker: 'stream_inventory_scope_not_read_only',
    },
    {
      override: { databaseSnapshot: { scope: { ...databaseScope, projectRef: 'wrong-project' }, complete: true, assets: [] } },
      blocker: 'database_inventory_scope_mismatch',
    },
  ];

  for (const { override, blocker } of cases) {
    const audit = await auditCreatorPremiumMediaInventory(baseAuditInput(override));
    assert.equal(audit.verdict, 'indeterminate');
    assert.deepEqual(audit.blockers, [blocker]);
  }
});

test('scope and pagination require one independently attested capture identity and bounded capture window', async () => {
  for (const [override, blocker] of [
    [{
      r2: {
        fetchPage: pager({
          '<first>': page({ ...r2Scope, captureId: 'different-capture' }, []),
        }),
      },
    }, 'r2_inventory_capture_mismatch'],
    [{
      stream: {
        fetchPage: pager({
          '<first>': page({ ...streamScope, attestation: null }, []),
        }),
      },
    }, 'stream_inventory_scope_unattested'],
    [{
      databaseSnapshot: {
        scope: { ...databaseScope, capturedAt: '2026-10-23T12:30:00.000Z' },
        complete: true,
        assets: [],
      },
    }, 'inventory_capture_window_exceeded'],
  ]) {
    const audit = await auditCreatorPremiumMediaInventory(baseAuditInput(override));
    assert.equal(audit.complete, false);
    assert.equal(audit.verdict, 'indeterminate');
    assert.deepEqual(audit.blockers, [blocker]);
  }
});

test('confirmed physical orphan requires canonical retention checks and a prior absence receipt', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [
          providerItem('premium/no-receipt'),
          providerItem('premium/with-receipt'),
        ]),
      }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [
        asset({
          internalId: 'db-no-receipt',
          providerIdentity: 'premium/no-receipt',
          status: 'deleted',
          referenceCount: 0,
          cleanupState: 'verified_then_reappeared',
          currentLifecycleFence: 2,
        }),
        asset({
          internalId: 'db-with-receipt',
          providerIdentity: 'premium/with-receipt',
          status: 'deleted',
          referenceCount: 0,
          cleanupState: 'verified_then_reappeared',
          currentLifecycleFence: 2,
          deletionReceipt: {
            absenceVerified: true,
            lifecycleFence: 2,
            evidenceDigest: `sha256:${'c'.repeat(64)}`,
          },
        }),
      ],
    },
  }));

  assert.equal(audit.counts.F, 1);
  assert.equal(audit.counts.G, 1);
  assert.equal(audit.findings.G[0].reason, 'deletion_evidence_incomplete');
});

test('a verified absent provider object retains its Supabase tombstone without creating false drift', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [asset({
        internalId: 'verified-tombstone',
        providerIdentity: 'premium/verified-absent',
        status: 'deleted',
        referenceCount: 0,
        cleanupState: 'absence_verified',
        currentLifecycleFence: 4,
        deletionReceipt: {
          absenceVerified: true,
          lifecycleFence: 4,
          evidenceDigest: `sha256:${'d'.repeat(64)}`,
        },
      })],
    },
  }));

  assert.equal(audit.counts.E, 1);
  assert.equal(audit.findings.E[0].reason, 'verified_absence_tombstone');
  assert.equal(audit.verdict, 'reconciled');
});

test('DB-only media that still has a legal hold or entitlement is missing-provider drift, never reconciled absence', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [
        asset({
          internalId: 'legal-hold-provider-missing',
          providerIdentity: 'premium/legal-hold-provider-missing',
          status: 'deleted',
          referenceCount: 0,
          cleanupState: 'absence_verified',
          currentLifecycleFence: 9,
          deletionReceipt: {
            absenceVerified: true,
            lifecycleFence: 9,
            evidenceDigest: `sha256:${'2'.repeat(64)}`,
          },
          retention: {
            complete: true,
            retain: true,
            reasons: ['legal_hold'],
            legalHold: 'active',
            evidence: { ...completeRetentionEvidence },
          },
        }),
        asset({
          internalId: 'entitlement-provider-missing',
          providerIdentity: 'premium/entitlement-provider-missing',
          status: 'ready',
          referenceCount: 1,
          retention: {
            complete: true,
            retain: true,
            reasons: ['active_entitlement'],
            legalHold: 'none',
            evidence: { ...completeRetentionEvidence },
          },
        }),
      ],
    },
  }));

  assert.equal(audit.counts.E, 2);
  assert.deepEqual(audit.findings.E.map(finding => finding.reason), [
    'retained_provider_missing',
    'retained_provider_missing',
  ]);
  assert.equal(audit.verdict, 'drift_detected');
});

test('a DB-only delete_pending asset remains category C while absence verification is pending', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [asset({
        internalId: 'pending-absence-check',
        providerIdentity: 'premium/pending-absence-check',
        status: 'delete_pending',
        referenceCount: 0,
        cleanupState: 'verification_pending',
        currentLifecycleFence: 5,
      })],
    },
  }));

  assert.equal(audit.counts.C, 1);
  assert.equal(audit.counts.E, 0);
  assert.equal(audit.findings.C[0].reason, 'cleanup_pending');
  assert.equal(audit.verdict, 'pending_cleanup');
});

test('current provider presence derives category F from a prior verified-absence tombstone', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [providerItem('premium/reappeared')]),
      }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [asset({
        internalId: 'reappeared-after-verified-absence',
        providerIdentity: 'premium/reappeared',
        status: 'deleted',
        referenceCount: 0,
        cleanupState: 'absence_verified',
        currentLifecycleFence: 6,
        deletionReceipt: {
          absenceVerified: true,
          lifecycleFence: 6,
          evidenceDigest: `sha256:${'f'.repeat(64)}`,
        },
      })],
    },
  }));

  assert.equal(audit.counts.F, 1);
  assert.equal(audit.counts.G, 0);
  assert.equal(audit.findings.F[0].reason, 'deleted_tombstone_provider_present');
  assert.equal(audit.verdict, 'drift_detected');
});

test('a stale deletion receipt fence is indeterminate and cannot prove absence or reappearance', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [providerItem('premium/stale-receipt')]),
      }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [asset({
        internalId: 'stale-receipt',
        providerIdentity: 'premium/stale-receipt',
        status: 'deleted',
        referenceCount: 0,
        cleanupState: 'absence_verified',
        currentLifecycleFence: 8,
        deletionReceipt: {
          absenceVerified: true,
          lifecycleFence: 7,
          evidenceDigest: `sha256:${'1'.repeat(64)}`,
        },
      })],
    },
  }));

  assert.equal(audit.counts.F, 0);
  assert.equal(audit.counts.G, 1);
  assert.equal(audit.findings.G[0].reason, 'deletion_evidence_incomplete');
});

test('unknown provider objects, missing retention evidence, and legacy rows remain indeterminate and preserved', async () => {
  const legacy = Array.from({ length: 11 }, (_, index) => asset({
    internalId: `legacy-${index}`,
    providerIdentity: `legacy/key-${index}`,
    status: 'failed',
    referenceCount: 0,
    lifecycleContractVersion: null,
    legacy: true,
    retention: null,
  }));
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    expectedLegacyCount: 11,
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [
          providerItem('unknown/provider-object', 'unknown'),
          providerItem('premium/missing-retention'),
        ]),
      }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [
        asset({
          internalId: 'missing-retention',
          providerIdentity: 'premium/missing-retention',
          retention: null,
        }),
        ...legacy,
      ],
    },
  }));

  assert.equal(audit.complete, true);
  assert.equal(audit.verdict, 'indeterminate');
  assert.equal(audit.counts.G, 13);
  assert.equal(audit.legacy.preserved, 11);
  assert.equal(audit.legacy.expected, 11);
  assert.equal(audit.legacy.matchesExpectation, true);
  assert.equal(audit.mutations.providerWrites, 0);
});

test('a provider-only object without canonical ownership evidence is indeterminate, never an orphan candidate', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({
        '<first>': page(r2Scope, [{
          identity: 'premium/unattested-provider-only',
          namespace: 'creator_premium',
        }]),
      }),
    },
  }));

  assert.equal(audit.counts.D, 0);
  assert.equal(audit.counts.F, 0);
  assert.equal(audit.counts.G, 1);
  assert.equal(audit.findings.G[0].reason, 'provider_namespace_unknown');
});

test('legacy count drift fails closed instead of silently enrolling rows into cleanup', async () => {
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    expectedLegacyCount: 11,
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [],
    },
  }));

  assert.equal(audit.complete, false);
  assert.equal(audit.verdict, 'indeterminate');
  assert.ok(audit.blockers.includes('legacy_inventory_count_mismatch'));
});

test('artifact redacts every raw identity and uses stable salted hashes only', async () => {
  const rawValues = [
    ACCOUNT_ID,
    BUCKET,
    PROJECT_REF,
    HASH_SALT,
    'sensitive-internal-id',
    'private/key/with-name.mov',
    'stream-sensitive-uid',
  ];
  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: {
      fetchPage: pager({ '<first>': page(r2Scope, [providerItem('private/key/with-name.mov')]) }),
    },
    stream: {
      fetchPage: pager({ '<first>': page(streamScope, [providerItem('stream-sensitive-uid')]) }),
    },
    databaseSnapshot: {
      scope: databaseScope,
      complete: true,
      assets: [asset({
        internalId: 'sensitive-internal-id',
        providerIdentity: 'private/key/with-name.mov',
      })],
    },
  }));
  const serialized = JSON.stringify(audit);

  for (const raw of rawValues) assert.equal(serialized.includes(raw), false, `leaked ${raw}`);
  assert.match(serialized, /[a-f0-9]{64}/);
  assert.equal(
    hashInventoryIdentifier(HASH_SALT, 'r2', 'same'),
    hashInventoryIdentifier(HASH_SALT, 'r2', 'same'),
  );
  assert.notEqual(
    hashInventoryIdentifier(HASH_SALT, 'r2', 'same'),
    hashInventoryIdentifier('another-test-salt-long-enough', 'r2', 'same'),
  );
});

test('reconciliation does not mutate frozen inputs or request write/download capabilities', async () => {
  const calls = [];
  const frozenPage = Object.freeze(page(Object.freeze({
    ...r2Scope,
    operations: Object.freeze([...r2Scope.operations]),
  }), Object.freeze([Object.freeze(providerItem('premium/frozen'))])));
  const adapter = new Proxy({
    async fetchPage({ cursor }) {
      calls.push({ operation: 'list', cursor });
      return frozenPage;
    },
  }, {
    get(target, property, receiver) {
      if (property !== 'fetchPage') throw new Error(`forbidden adapter operation: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const snapshot = Object.freeze({
    scope: Object.freeze({ ...databaseScope, operations: Object.freeze(['select']) }),
    complete: true,
    assets: Object.freeze([]),
  });

  const audit = await auditCreatorPremiumMediaInventory(baseAuditInput({
    r2: adapter,
    databaseSnapshot: snapshot,
  }));
  assert.deepEqual(calls, [{ operation: 'list', cursor: null }]);
  assert.equal(audit.counts.D, 1);
  assert.deepEqual(audit.mutations, {
    providerWrites: 0,
    databaseWrites: 0,
    downloads: 0,
  });
});

test('direct R2 collector requires explicit exact read-only scope', async () => {
  const calls = [];
  const items = await collectR2Inventory({
    expectedAccountId: ACCOUNT_ID,
    expectedBucket: BUCKET,
    expectedCaptureId: CAPTURE_ID,
    fetchPage: pager({
      '<first>': page(r2Scope, [providerItem('premium/one')], { nextCursor: 'next', hasMore: true }),
      next: page(r2Scope, [providerItem('premium/two')]),
    }, calls),
  });
  assert.deepEqual(calls, [null, 'next']);
  assert.equal(items.items.length, 2);
});

test('collector fails closed when pagination exceeds its declared bound', async () => {
  await assert.rejects(
    collectR2Inventory({
      expectedAccountId: ACCOUNT_ID,
      expectedBucket: BUCKET,
      expectedCaptureId: CAPTURE_ID,
      maxPages: 1,
      fetchPage: pager({
        '<first>': page(r2Scope, [], { nextCursor: 'second', hasMore: true }),
      }),
    }),
    error => error?.code === 'r2_inventory_page_limit_exceeded',
  );
});

test('audit implementation contains no network or provider mutation primitive', () => {
  const source = read('scripts/audit-creator-premium-media-inventory.mjs');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.(?:delete|put|post|patch|upload|download)\s*\(/i);
  assert.doesNotMatch(source, /https?:\/\//i);
});

test('CLI refuses implicit, network, or unscoped execution and only consumes explicit local read-only snapshots', async () => {
  const outputs = [];
  const errors = [];
  const io = {
    env: {},
    now: () => new Date('2026-10-23T12:00:00.000Z'),
    stdout: value => outputs.push(value),
    stderr: value => errors.push(value),
    async readJsonFile(file) {
      if (path.basename(file) === 'db.json') return { scope: databaseScope, complete: true, assets: [] };
      if (path.basename(file) === 'r2.json') return { pages: { '<first>': page(r2Scope, []) } };
      if (path.basename(file) === 'r2-drift.json') {
        return { pages: { '<first>': page(r2Scope, [providerItem('premium/provider-only')]) } };
      }
      if (path.basename(file) === 'r2-extra.json') {
        return {
          pages: {
            '<first>': page(r2Scope, []),
            unreachable: page(r2Scope, [providerItem('premium/unreachable-provider-only')]),
          },
        };
      }
      if (path.basename(file) === 'stream.json') return { pages: { '<first>': page(streamScope, []) } };
      throw new Error('unexpected file');
    },
  };

  assert.equal(await runCli([], io), 2);
  assert.deepEqual(errors, ['inventory_cli_explicit_read_only_confirmation_required']);

  errors.length = 0;
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', 'db.json',
    '--r2-pages', 'https://provider.example.test/pages',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], io), 2);
  assert.deepEqual(errors, ['inventory_cli_local_files_only']);

  errors.length = 0;
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', '//server/share/db.json',
    '--r2-pages', 'r2.json',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], io), 2);
  assert.deepEqual(errors, ['inventory_cli_local_files_only']);

  errors.length = 0;
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', 'db.json',
    '--r2-pages', 'r2.json',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], io), 2);
  assert.deepEqual(errors, ['inventory_cli_hash_salt_missing']);

  outputs.length = 0;
  errors.length = 0;
  const successIo = { ...io, env: { MEDIA_INVENTORY_HASH_SALT: HASH_SALT } };
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', 'db.json',
    '--r2-pages', 'r2.json',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], successIo), 0);
  assert.equal(errors.length, 0);
  const artifact = JSON.parse(outputs[0]);
  assert.equal(artifact.complete, true);
  assert.equal(artifact.mode, 'read_only');

  outputs.length = 0;
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', 'db.json',
    '--r2-pages', 'r2-drift.json',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], successIo), 4);
  assert.equal(JSON.parse(outputs[0]).verdict, 'drift_detected');

  outputs.length = 0;
  assert.equal(await runCli([
    '--confirm-read-only',
    '--database-snapshot', 'db.json',
    '--r2-pages', 'r2-extra.json',
    '--stream-pages', 'stream.json',
    '--expected-account', ACCOUNT_ID,
    '--expected-bucket', BUCKET,
    '--expected-stream-project', 'account_stream',
    '--expected-supabase-project', PROJECT_REF,
    '--expected-capture-id', CAPTURE_ID,
    '--hash-salt-env', 'MEDIA_INVENTORY_HASH_SALT',
    '--expected-legacy-count', '0',
  ], successIo), 3);
  const incompleteArtifact = JSON.parse(outputs[0]);
  assert.equal(incompleteArtifact.verdict, 'indeterminate');
  assert.equal(incompleteArtifact.complete, false);
  assert.ok(incompleteArtifact.blockers.includes('r2_inventory_unconsumed_pages'));
  assert.equal(JSON.stringify(incompleteArtifact).includes('unreachable-provider-only'), false);
});

test('retention policy preserves rights, uncertainty, provider-only findings, and all eleven legacy rows without inventing legal periods', () => {
  const doc = read('docs/creator-premium-media-retention-v1.md');
  assert.match(doc, /active and referenced media is retained/i);
  assert.match(doc, /receipts/i);
  assert.match(doc, /entitlements/i);
  assert.match(doc, /disputes/i);
  assert.match(doc, /legal hold/i);
  assert.match(doc, /provider-only[\s\S]*preserv/i);
  assert.match(doc, /eleven \(11\) legacy/i);
  assert.match(doc, /no legal retention period is invented/i);
  assert.match(doc, /never authorizes automatic deletion/i);
});
