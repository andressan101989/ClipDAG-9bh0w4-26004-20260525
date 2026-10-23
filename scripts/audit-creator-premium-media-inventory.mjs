import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORY_KEYS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const PROVIDERS = Object.freeze(['r2', 'stream']);
const FORBIDDEN_OPERATIONS = new Set([
  'create',
  'delete',
  'download',
  'get_body',
  'patch',
  'post',
  'put',
  'sign',
  'update',
  'upload',
  'write',
]);

const PROVIDER_CONTRACTS = Object.freeze({
  r2: Object.freeze({
    requiredOperations: Object.freeze(['list', 'head']),
    resourceField: 'bucket',
  }),
  stream: Object.freeze({
    requiredOperations: Object.freeze(['list', 'metadata']),
    resourceField: 'project',
  }),
});
const RETENTION_EVIDENCE_FIELDS = Object.freeze([
  'linksChecked',
  'receiptsChecked',
  'entitlementsChecked',
  'subscriptionsChecked',
  'disputesChecked',
  'legalHoldChecked',
]);
const ATTESTATION_MODE = 'official_read_only_scope_evidence';
const DEFAULT_CAPTURE_SKEW_MS = 5 * 60 * 1_000;

export class MediaInventoryValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MediaInventoryValidationError';
    this.code = code;
  }
}

function fail(code) {
  throw new MediaInventoryValidationError(code);
}

function safeString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function validateHashSalt(salt) {
  if (typeof salt !== 'string' || salt.length < 16) fail('inventory_hash_salt_invalid');
}

export function hashInventoryIdentifier(salt, namespace, identity) {
  validateHashSalt(salt);
  if (!safeString(namespace) || !safeString(identity)) fail('inventory_identifier_invalid');
  return createHash('sha256')
    .update(salt)
    .update('\0')
    .update(namespace)
    .update('\0')
    .update(identity)
    .digest('hex');
}

function validateReadOnlyOperations(provider, operations) {
  const contract = PROVIDER_CONTRACTS[provider];
  if (!Array.isArray(operations)) fail(`${provider}_inventory_scope_not_read_only`);
  const normalized = operations.map(operation => String(operation).toLowerCase());
  if (normalized.some(operation => FORBIDDEN_OPERATIONS.has(operation))) {
    fail(`${provider}_inventory_scope_not_read_only`);
  }
  if (contract.requiredOperations.some(operation => !normalized.includes(operation))) {
    fail(`${provider}_inventory_scope_not_read_only`);
  }
  if (normalized.some(operation => !contract.requiredOperations.includes(operation))) {
    fail(`${provider}_inventory_scope_not_read_only`);
  }
}

function validateCaptureEvidence(source, scope, expectedCaptureId) {
  if (scope?.captureId !== expectedCaptureId) fail(`${source}_inventory_capture_mismatch`);
  const capturedAt = Date.parse(scope?.capturedAt);
  if (!Number.isFinite(capturedAt)) fail(`${source}_inventory_capture_invalid`);
  const attestation = scope?.attestation;
  if (
    !attestation ||
    attestation.verified !== true ||
    attestation.mode !== ATTESTATION_MODE ||
    !Number.isFinite(Date.parse(attestation.verifiedAt)) ||
    !/^sha256:[a-f0-9]{64}$/i.test(String(attestation.evidenceDigest ?? ''))
  ) {
    fail(`${source}_inventory_scope_unattested`);
  }
  return Object.freeze({
    capturedAt,
    evidenceDigest: attestation.evidenceDigest.toLowerCase(),
  });
}

function validateProviderScope(
  provider,
  scope,
  expectedAccountId,
  expectedResource,
  expectedCaptureId,
) {
  const contract = PROVIDER_CONTRACTS[provider];
  if (!scope || scope.access !== 'read_only') fail(`${provider}_inventory_scope_not_read_only`);
  validateReadOnlyOperations(provider, scope.operations);
  if (
    scope.accountId !== expectedAccountId ||
    scope[contract.resourceField] !== expectedResource
  ) {
    fail(`${provider}_inventory_scope_mismatch`);
  }
  return validateCaptureEvidence(provider, scope, expectedCaptureId);
}

function validateProviderItem(provider, item) {
  if (!item || !safeString(item.identity)) fail(`${provider}_inventory_item_invalid`);
  const ownership = item.ownershipEvidence;
  const ownershipVerified = Boolean(
    ownership &&
    ownership.verified === true &&
    ownership.method === 'canonical_creator_premium_namespace' &&
    /^sha256:[a-f0-9]{64}$/i.test(String(ownership.evidenceDigest ?? '')),
  );
  const namespace = item.namespace === 'creator_premium' && ownershipVerified
    ? 'creator_premium'
    : 'unknown';
  return Object.freeze({ provider, identity: item.identity, namespace });
}

async function collectProviderInventory({
  provider,
  expectedAccountId,
  expectedResource,
  expectedCaptureId,
  fetchPage,
  maxPages = 10_000,
}) {
  if (!PROVIDER_CONTRACTS[provider]) fail('inventory_provider_invalid');
  if (
    !safeString(expectedAccountId) ||
    !safeString(expectedResource) ||
    !safeString(expectedCaptureId)
  ) {
    fail(`${provider}_inventory_expected_scope_missing`);
  }
  if (typeof fetchPage !== 'function') fail(`${provider}_inventory_adapter_missing`);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) fail(`${provider}_inventory_page_limit_invalid`);

  const items = [];
  const identities = new Set();
  const visitedCursors = new Set();
  const capturedAtValues = [];
  let attestationDigest = null;
  let cursor = null;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const cursorKey = cursor ?? '<first>';
    if (visitedCursors.has(cursorKey)) fail(`${provider}_inventory_cursor_repeated`);
    visitedCursors.add(cursorKey);

    let page;
    try {
      page = await fetchPage(Object.freeze({ cursor }));
    } catch (error) {
      if (error instanceof MediaInventoryValidationError) throw error;
      fail(`${provider}_inventory_page_unavailable`);
    }

    if (!page || page.complete !== true || !Array.isArray(page.items)) {
      fail(`${provider}_inventory_partial_page`);
    }
    const capture = validateProviderScope(
      provider,
      page.scope,
      expectedAccountId,
      expectedResource,
      expectedCaptureId,
    );
    capturedAtValues.push(capture.capturedAt);
    if (attestationDigest == null) attestationDigest = capture.evidenceDigest;
    if (attestationDigest !== capture.evidenceDigest) {
      fail(`${provider}_inventory_attestation_changed`);
    }

    for (const candidate of page.items) {
      const item = validateProviderItem(provider, candidate);
      if (identities.has(item.identity)) fail(`${provider}_inventory_duplicate_identity`);
      identities.add(item.identity);
      items.push(item);
    }

    if (page.hasMore === true) {
      if (!safeString(page.nextCursor)) fail(`${provider}_inventory_partial_page`);
      if (visitedCursors.has(page.nextCursor)) fail(`${provider}_inventory_cursor_repeated`);
      cursor = page.nextCursor;
      continue;
    }
    if (page.hasMore !== false || page.nextCursor != null) {
      fail(`${provider}_inventory_partial_page`);
    }
    return Object.freeze({
      items: Object.freeze(items),
      capturedAtValues: Object.freeze(capturedAtValues),
      attestationDigest,
    });
  }

  fail(`${provider}_inventory_page_limit_exceeded`);
}

export function collectR2Inventory({
  expectedAccountId,
  expectedBucket,
  expectedCaptureId,
  fetchPage,
  maxPages,
}) {
  return collectProviderInventory({
    provider: 'r2',
    expectedAccountId,
    expectedResource: expectedBucket,
    expectedCaptureId,
    fetchPage,
    maxPages,
  });
}

export function collectStreamInventory({
  expectedAccountId,
  expectedProject,
  expectedCaptureId,
  fetchPage,
  maxPages,
}) {
  return collectProviderInventory({
    provider: 'stream',
    expectedAccountId,
    expectedResource: expectedProject,
    expectedCaptureId,
    fetchPage,
    maxPages,
  });
}

function validateDatabaseSnapshot(snapshot, expectedProjectRef, expectedCaptureId) {
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.assets)) {
    fail('database_inventory_incomplete');
  }
  const { scope } = snapshot;
  if (!scope || scope.access !== 'read_only') fail('database_inventory_scope_not_read_only');
  if (
    !Array.isArray(scope.operations) ||
    scope.operations.length !== 1 ||
    scope.operations[0] !== 'select'
  ) {
    fail('database_inventory_scope_not_read_only');
  }
  if (scope.projectRef !== expectedProjectRef) fail('database_inventory_scope_mismatch');
  const capture = validateCaptureEvidence('database', scope, expectedCaptureId);

  const internalIds = new Set();
  const providerIdentities = new Set();
  const assets = [];
  for (const row of snapshot.assets) {
    if (!row || !safeString(row.internalId) || !PROVIDERS.includes(row.provider)) {
      fail('database_inventory_asset_invalid');
    }
    if (internalIds.has(row.internalId)) fail('database_inventory_duplicate_internal_identity');
    internalIds.add(row.internalId);

    const providerIdentity = safeString(row.providerIdentity);
    if (providerIdentity) {
      const providerKey = `${row.provider}\0${providerIdentity}`;
      if (providerIdentities.has(providerKey)) fail('database_inventory_duplicate_provider_identity');
      providerIdentities.add(providerKey);
    }
    if (!Number.isSafeInteger(row.referenceCount) || row.referenceCount < 0) {
      fail('database_inventory_reference_count_invalid');
    }
    if (!Number.isSafeInteger(row.currentLifecycleFence) || row.currentLifecycleFence < 0) {
      fail('database_inventory_lifecycle_fence_invalid');
    }
    assets.push(Object.freeze({ ...row, providerIdentity }));
  }
  return Object.freeze({
    assets: Object.freeze(assets),
    capturedAtValues: Object.freeze([capture.capturedAt]),
    attestationDigest: capture.evidenceDigest,
  });
}

function emptyCounts() {
  return Object.fromEntries(CATEGORY_KEYS.map(key => [key, 0]));
}

function emptyFindings() {
  return Object.fromEntries(CATEGORY_KEYS.map(key => [key, []]));
}

function safeScope(expected, hashSalt) {
  return Object.freeze({
    accountRef: hashInventoryIdentifier(hashSalt, 'scope:cloudflare-account', expected.accountId),
    r2BucketRef: hashInventoryIdentifier(hashSalt, 'scope:r2-bucket', expected.r2Bucket),
    streamProjectRef: hashInventoryIdentifier(hashSalt, 'scope:stream-project', expected.streamProject),
    supabaseProjectRef: hashInventoryIdentifier(hashSalt, 'scope:supabase-project', expected.supabaseProjectRef),
    captureRef: hashInventoryIdentifier(hashSalt, 'capture', expected.captureId),
  });
}

function findingFor(category, row, providerItem, hashSalt, reason) {
  const finding = {
    category,
    provider: row?.provider ?? providerItem.provider,
    reason,
  };
  if (row?.internalId) {
    finding.assetRef = hashInventoryIdentifier(hashSalt, 'database-asset', row.internalId);
  }
  const providerIdentity = row?.providerIdentity ?? providerItem?.identity;
  if (providerIdentity) {
    finding.providerRef = hashInventoryIdentifier(
      hashSalt,
      `provider:${finding.provider}`,
      providerIdentity,
    );
  }
  return Object.freeze(finding);
}

function retentionIsComplete(row) {
  const retention = row.retention;
  if (!retention || retention.complete !== true) return false;
  if (!['none', 'active'].includes(retention.legalHold)) return false;
  if (typeof retention.retain !== 'boolean') return false;
  if (!Array.isArray(retention.reasons)) return false;
  if (!retention.evidence || typeof retention.evidence !== 'object') return false;
  if (RETENTION_EVIDENCE_FIELDS.some(field => retention.evidence[field] !== true)) return false;
  return true;
}

function deletionEvidenceIsComplete(row) {
  const receipt = row.deletionReceipt;
  return Boolean(
    receipt &&
    receipt.absenceVerified === true &&
    Number.isSafeInteger(receipt.lifecycleFence) &&
    receipt.lifecycleFence > 0 &&
    receipt.lifecycleFence === row.currentLifecycleFence &&
    /^sha256:[a-f0-9]{64}$/i.test(String(receipt.evidenceDigest ?? '')),
  );
}

function retentionRequiresPreservation(row) {
  return Boolean(
    row.retention.retain === true ||
    row.retention.legalHold === 'active' ||
    row.retention.reasons.length > 0,
  );
}

function classifyMatchedAsset(row, providerItem) {
  if (row.legacy === true) return ['G', 'legacy_preserved'];
  if (!retentionIsComplete(row)) return ['G', 'retention_evidence_incomplete'];

  const activeStatuses = new Set(['pending', 'uploading', 'processing', 'ready']);
  if (row.referenceCount > 0 && activeStatuses.has(row.status)) {
    return ['A', 'active_referenced'];
  }
  if (retentionRequiresPreservation(row)) {
    return ['B', 'retention_required'];
  }
  if (
    row.status === 'delete_pending' ||
    ['pending', 'verification_pending', 'absence_expected'].includes(row.cleanupState)
  ) {
    return ['C', 'cleanup_pending'];
  }
  if (
    row.status === 'deleted' &&
    row.referenceCount === 0 &&
    Number(row.lifecycleContractVersion) >= 1 &&
    ['absence_verified', 'verified_then_reappeared'].includes(row.cleanupState)
  ) {
    if (!deletionEvidenceIsComplete(row)) return ['G', 'deletion_evidence_incomplete'];
    return ['F', 'deleted_tombstone_provider_present'];
  }
  if (providerItem.namespace !== 'creator_premium') return ['G', 'provider_namespace_unknown'];
  return ['G', 'lifecycle_evidence_incomplete'];
}

function classifyDbOnlyAsset(row) {
  if (row.legacy === true) return ['G', 'legacy_preserved'];
  if (!retentionIsComplete(row)) return ['G', 'retention_evidence_incomplete'];
  if (retentionRequiresPreservation(row)) return ['E', 'retained_provider_missing'];
  if (
    row.status === 'delete_pending' ||
    ['pending', 'verification_pending', 'absence_expected'].includes(row.cleanupState)
  ) {
    return ['C', 'cleanup_pending'];
  }
  if (row.status === 'deleted' && row.cleanupState === 'absence_verified') {
    if (!deletionEvidenceIsComplete(row)) return ['G', 'deletion_evidence_incomplete'];
    return ['E', 'verified_absence_tombstone'];
  }
  return ['E', 'supabase_only'];
}

function calculateVerdict(counts, findings) {
  if (counts.G > 0) return 'indeterminate';
  if (counts.D > 0 || counts.F > 0) return 'drift_detected';
  if (findings.E.some(finding => finding.reason !== 'verified_absence_tombstone')) {
    return 'drift_detected';
  }
  if (counts.C > 0) return 'pending_cleanup';
  return 'reconciled';
}

function resultBase(expected, hashSalt, now) {
  return {
    schemaVersion: 'creator-premium-media-inventory.v1',
    generatedAt: now().toISOString(),
    mode: 'read_only',
    scope: safeScope(expected, hashSalt),
    evidence: Object.freeze({
      mode: 'offline_attested_snapshots',
      liveProviderVerified: false,
      captureRef: hashInventoryIdentifier(hashSalt, 'capture', expected.captureId),
    }),
    mutations: Object.freeze({ providerWrites: 0, databaseWrites: 0, downloads: 0 }),
  };
}

function indeterminateResult({ expected, hashSalt, now, code }) {
  const counts = emptyCounts();
  counts.G = 1;
  return {
    ...resultBase(expected, hashSalt, now),
    complete: false,
    verdict: 'indeterminate',
    blockers: [code],
    counts,
    findings: { ...emptyFindings(), G: [{ category: 'G', reason: 'audit_input_rejected' }] },
    totals: { provider: { r2: 0, stream: 0 }, database: 0 },
    legacy: { preserved: 0, expected: null, matchesExpectation: false },
  };
}

export async function auditCreatorPremiumMediaInventory({
  expected,
  r2,
  stream,
  databaseSnapshot,
  hashSalt,
  expectedLegacyCount = 11,
  now = () => new Date(),
}) {
  validateHashSalt(hashSalt);
  if (
    !expected ||
    !safeString(expected.accountId) ||
    !safeString(expected.r2Bucket) ||
    !safeString(expected.streamProject) ||
    !safeString(expected.supabaseProjectRef) ||
    !safeString(expected.captureId)
  ) {
    fail('inventory_expected_scope_missing');
  }
  if (!Number.isSafeInteger(expectedLegacyCount) || expectedLegacyCount < 0) {
    fail('legacy_inventory_expected_count_invalid');
  }
  if (typeof now !== 'function') fail('inventory_clock_invalid');

  let databaseInventory;
  let r2Inventory;
  let streamInventory;
  try {
    databaseInventory = validateDatabaseSnapshot(
      databaseSnapshot,
      expected.supabaseProjectRef,
      expected.captureId,
    );
    r2Inventory = await collectR2Inventory({
      expectedAccountId: expected.accountId,
      expectedBucket: expected.r2Bucket,
      expectedCaptureId: expected.captureId,
      fetchPage: r2?.fetchPage,
    });
    streamInventory = await collectStreamInventory({
      expectedAccountId: expected.accountId,
      expectedProject: expected.streamProject,
      expectedCaptureId: expected.captureId,
      fetchPage: stream?.fetchPage,
    });
    const captureTimes = [
      ...databaseInventory.capturedAtValues,
      ...r2Inventory.capturedAtValues,
      ...streamInventory.capturedAtValues,
    ];
    if (Math.max(...captureTimes) - Math.min(...captureTimes) > DEFAULT_CAPTURE_SKEW_MS) {
      fail('inventory_capture_window_exceeded');
    }
  } catch (error) {
    const code = error instanceof MediaInventoryValidationError
      ? error.code
      : 'inventory_input_unavailable';
    return indeterminateResult({ expected, hashSalt, now, code });
  }

  const databaseAssets = databaseInventory.assets;
  const r2Items = r2Inventory.items;
  const streamItems = streamInventory.items;
  const counts = emptyCounts();
  const findings = emptyFindings();
  const providerItems = [...r2Items, ...streamItems];
  const providerByIdentity = new Map(
    providerItems.map(item => [`${item.provider}\0${item.identity}`, item]),
  );
  const matchedProviderKeys = new Set();

  const addFinding = (category, row, providerItem, reason) => {
    counts[category] += 1;
    findings[category].push(findingFor(category, row, providerItem, hashSalt, reason));
  };

  for (const row of databaseAssets) {
    const providerKey = row.providerIdentity ? `${row.provider}\0${row.providerIdentity}` : null;
    const providerItem = providerKey ? providerByIdentity.get(providerKey) : null;
    if (providerItem) matchedProviderKeys.add(providerKey);
    const [category, reason] = providerItem
      ? classifyMatchedAsset(row, providerItem)
      : classifyDbOnlyAsset(row);
    addFinding(category, row, providerItem, reason);
  }

  for (const providerItem of providerItems) {
    const providerKey = `${providerItem.provider}\0${providerItem.identity}`;
    if (matchedProviderKeys.has(providerKey)) continue;
    if (providerItem.namespace === 'creator_premium') {
      addFinding('D', null, providerItem, 'provider_only');
    } else {
      addFinding('G', null, providerItem, 'provider_namespace_unknown');
    }
  }

  const legacyPreserved = databaseAssets.filter(row => row.legacy === true).length;
  const blockers = [];
  let complete = true;
  if (legacyPreserved !== expectedLegacyCount) {
    complete = false;
    blockers.push('legacy_inventory_count_mismatch');
  }
  let verdict = calculateVerdict(counts, findings);
  if (!complete) verdict = 'indeterminate';

  return {
    ...resultBase(expected, hashSalt, now),
    complete,
    verdict,
    blockers,
    counts,
    findings,
    totals: {
      provider: { r2: r2Items.length, stream: streamItems.length },
      database: databaseAssets.length,
    },
    legacy: {
      preserved: legacyPreserved,
      expected: expectedLegacyCount,
      matchesExpectation: legacyPreserved === expectedLegacyCount,
    },
  };
}

function parseCliArgs(argv) {
  const parsed = { confirmReadOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--confirm-read-only') {
      parsed.confirmReadOnly = true;
      continue;
    }
    const fields = {
      '--database-snapshot': 'databaseSnapshot',
      '--r2-pages': 'r2Pages',
      '--stream-pages': 'streamPages',
      '--expected-account': 'expectedAccount',
      '--expected-bucket': 'expectedBucket',
      '--expected-stream-project': 'expectedStreamProject',
      '--expected-supabase-project': 'expectedSupabaseProject',
      '--expected-capture-id': 'expectedCaptureId',
      '--hash-salt-env': 'hashSaltEnv',
      '--expected-legacy-count': 'expectedLegacyCount',
    };
    const field = fields[flag];
    if (!field || index + 1 >= argv.length) fail('inventory_cli_arguments_invalid');
    parsed[field] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function isLocalInputPath(inputPath) {
  if (!safeString(inputPath) || inputPath.includes('\0')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) return false;
  if (inputPath.startsWith('\\\\') || inputPath.startsWith('//')) return false;
  return true;
}

function pagerFromSnapshot(document, provider) {
  if (!document || !document.pages || typeof document.pages !== 'object') {
    fail(`${provider}_inventory_snapshot_invalid`);
  }
  const pageKeys = Object.keys(document.pages);
  if (!pageKeys.includes('<first>')) fail(`${provider}_inventory_snapshot_invalid`);
  const consumed = new Set();
  return Object.freeze({
    async fetchPage({ cursor }) {
      const key = cursor ?? '<first>';
      if (!Object.hasOwn(document.pages, key)) fail(`${provider}_inventory_partial_page`);
      consumed.add(key);
      return document.pages[key];
    },
    assertFullyConsumed() {
      if (consumed.size !== pageKeys.length || pageKeys.some(key => !consumed.has(key))) {
        fail(`${provider}_inventory_unconsumed_pages`);
      }
    },
  });
}

function addArtifactBlocker(artifact, code) {
  if (artifact.blockers.includes(code)) return artifact;
  return {
    ...artifact,
    complete: false,
    verdict: 'indeterminate',
    blockers: [...artifact.blockers, code],
    counts: { ...artifact.counts, G: artifact.counts.G + 1 },
    findings: {
      ...artifact.findings,
      G: [...artifact.findings.G, { category: 'G', reason: 'audit_input_rejected' }],
    },
  };
}

async function defaultReadJsonFile(filePath) {
  try {
    const resolved = await realpath(filePath);
    if (!isLocalInputPath(resolved)) fail('inventory_cli_local_files_only');
    if (!(await stat(resolved)).isFile()) fail('inventory_cli_input_unavailable');
    return JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    if (error instanceof MediaInventoryValidationError) throw error;
    fail('inventory_cli_input_unavailable');
  }
}

export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? (value => process.stdout.write(`${value}\n`));
  const stderr = io.stderr ?? (value => process.stderr.write(`${value}\n`));
  const env = io.env ?? process.env;
  const now = io.now ?? (() => new Date());
  const readJsonFile = io.readJsonFile ?? defaultReadJsonFile;

  try {
    const args = parseCliArgs(argv);
    if (args.confirmReadOnly !== true) fail('inventory_cli_explicit_read_only_confirmation_required');

    const required = [
      args.databaseSnapshot,
      args.r2Pages,
      args.streamPages,
      args.expectedAccount,
      args.expectedBucket,
      args.expectedStreamProject,
      args.expectedSupabaseProject,
      args.expectedCaptureId,
      args.hashSaltEnv,
      args.expectedLegacyCount,
    ];
    if (required.some(value => !safeString(value))) fail('inventory_cli_arguments_invalid');
    if (![args.databaseSnapshot, args.r2Pages, args.streamPages].every(isLocalInputPath)) {
      fail('inventory_cli_local_files_only');
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(args.hashSaltEnv)) fail('inventory_cli_hash_salt_env_invalid');
    const hashSalt = env[args.hashSaltEnv];
    if (!safeString(hashSalt)) fail('inventory_cli_hash_salt_missing');
    validateHashSalt(hashSalt);
    const expectedLegacyCount = Number(args.expectedLegacyCount);
    if (!Number.isSafeInteger(expectedLegacyCount) || expectedLegacyCount < 0) {
      fail('inventory_cli_expected_legacy_count_invalid');
    }

    let databaseSnapshot;
    let r2Document;
    let streamDocument;
    try {
      [databaseSnapshot, r2Document, streamDocument] = await Promise.all([
        readJsonFile(path.resolve(args.databaseSnapshot)),
        readJsonFile(path.resolve(args.r2Pages)),
        readJsonFile(path.resolve(args.streamPages)),
      ]);
    } catch (error) {
      if (error instanceof MediaInventoryValidationError) throw error;
      fail('inventory_cli_input_unavailable');
    }

    const r2Pager = pagerFromSnapshot(r2Document, 'r2');
    const streamPager = pagerFromSnapshot(streamDocument, 'stream');
    let artifact = await auditCreatorPremiumMediaInventory({
      expected: {
        accountId: args.expectedAccount,
        r2Bucket: args.expectedBucket,
        streamProject: args.expectedStreamProject,
        supabaseProjectRef: args.expectedSupabaseProject,
        captureId: args.expectedCaptureId,
      },
      r2: { fetchPage: r2Pager.fetchPage },
      stream: { fetchPage: streamPager.fetchPage },
      databaseSnapshot,
      hashSalt,
      expectedLegacyCount,
      now,
    });
    for (const pager of [r2Pager, streamPager]) {
      try {
        pager.assertFullyConsumed();
      } catch (error) {
        const code = error instanceof MediaInventoryValidationError
          ? error.code
          : 'inventory_snapshot_unconsumed_pages';
        artifact = addArtifactBlocker(artifact, code);
      }
    }
    stdout(JSON.stringify(artifact, null, 2));
    if (!artifact.complete || artifact.verdict === 'indeterminate') return 3;
    if (artifact.verdict !== 'reconciled') return 4;
    return 0;
  } catch (error) {
    const code = error instanceof MediaInventoryValidationError
      ? error.code
      : 'inventory_cli_failed';
    stderr(code);
    return 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exitCode = await runCli(process.argv.slice(2));
}
