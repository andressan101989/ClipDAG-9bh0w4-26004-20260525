import { syntheticVaultEdgeParity } from './fixtures/nelyonB2SyntheticVaultEdgeParity.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  compileB2SourceParity,
  createTrustedB2DeployedFunctionInventory,
  createTrustedB2ReviewedTree,
} from '../scripts/nelyon-b2-source-parity.mjs';
import * as privateCli from '../scripts/nelyon-private-authority-cli.mjs';
import {
  bootstrapPrivateAuthorityRuntime,
  createPrivateAuthorityRuntime,
  loadProtectedB2RecoveryRuntime,
} from '../scripts/nelyon-private-authority-runtime.mjs';
import { buildPrivateRuntimeClosure } from '../scripts/nelyon-private-runtime-closure.mjs';
import {
  canonicalJson,
  retainB2MigrationAttemptProof,
  parseB2ReleaseDescriptor,
  parseFunctionConfig,
  verifyAdminRecoveryBuildBinding,
  verifyB2RecoveryOperation,
  verifyB2ProtectedAuthority,
  verifyPostcheckRecovery,
} from '../scripts/nelyon-production-release.mjs';
import {
  advisorExceptionsForPhase,
  buildProductionBaselineDigests,
  captureProductionSnapshot,
  RPC_SECURITY_ATTESTATION_SQL,
  validateB2InstalledB1State,
  validateB2RpcSecurityAttestations,
  validatePremiumPostcheckState,
  verifyProductionRecoverySnapshot,
  verifyProductionAdminRecoverySnapshot,
  verifyProductionSnapshotPair,
} from '../scripts/nelyon-production-snapshot-adapter.mjs';
import {
  createReleaseAuthorityContext,
  publicAuthorityReceipt,
} from '../scripts/nelyon-release-authority-context.mjs';
import { b2DatabaseFunctionMatrix, b2SyntheticRelationAclRecords } from './fixtures/nelyonB2DatabaseFunctionMatrix.mjs';
import { b2AdminHistoricalFixture, b2ChainedCapture, b2HistoricalCapture } from './fixtures/nelyonB2HistoricalCapture.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_AT = '2026-10-12T12:00:01.000Z';
const RECOVERY_AT = '2026-10-14T12:00:01.000Z';
const SECRET = 'PRIVATE_B2_E2E_SECRET_MARKER';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitBlob = bytes => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
const gitBytes = relativePath => Buffer.from(execFileSync('git', ['show', `HEAD:${relativePath}`], {
  cwd: ROOT, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024,
}));

const removeOwnedRealPolicyAdminTempDirectory = directory => {
  const prefix = 'nelyon-b2-real-policy-admin-';
  try {
    const temporaryRoot = realpathSync(tmpdir());
    const target = resolve(directory);
    const targetReal = realpathSync(target);
    const stat = lstatSync(target);
    const fromTemporaryRoot = relative(temporaryRoot, targetReal);
    const suffix = fromTemporaryRoot.slice(prefix.length);
    if (targetReal !== target || stat.isSymbolicLink() || !stat.isDirectory()
      || !fromTemporaryRoot.startsWith(prefix) || !/^[A-Za-z0-9_-]{6}$/.test(suffix)
      || fromTemporaryRoot.includes(sep)) {
      throw new Error('blocked');
    }
    rmSync(targetReal, { recursive: true, force: false });
    if (existsSync(targetReal)) throw new Error('blocked');
  } catch {
    throw new Error('B2 real-policy temporary evidence cleanup failed');
  }
};

let migrationApprovedSha = 'a'.repeat(40);
const baseRequest = () => ({
  approvedSha: migrationApprovedSha,
  releaseId: 'nelyon-20261012-001',
  runId: '123456789',
  runAttempt: 1,
});

const baseManifest = () => ({
  identity: {
    approved_sha: migrationApprovedSha,
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
    function_contracts: [],
    migrations: [],
  },
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const healthyServices = () => ['auth', 'db', 'pooler', 'realtime', 'rest', 'storage']
  .map(name => ({ healthy: true, name, status: 'ACTIVE_HEALTHY' }));
const completedBackup = insertedAt => ({
  id: insertedAt,
  inserted_at: insertedAt,
  is_physical_backup: true,
  status: 'COMPLETED',
});
const financeSnapshot = financePolicy => ({
  schema_version: 1,
  complete: true,
  query_id: 'nelyon-finance-snapshot-v1',
  database_time: '2026-10-12T12:00:00.000000Z',
  schema_sha256: '1'.repeat(64),
  watermark: null,
  policy: {
    purchase_enabled: financePolicy.purchase_enabled,
    subscription_enabled: financePolicy.subscription_enabled,
    refunds_enabled: financePolicy.refunds_enabled,
    platform_fee_bps: financePolicy.platform_fee_bps,
    policy_version: 'creator-premium-b4-v1',
  },
  transactions: { complete: true, count: 0, items: [] },
  ledger_entries: { complete: true, count: 0, items: [] },
  ledger_accounts: { complete: true, count: 1, items: [{
    id: '11111111-1111-4111-8111-111111111111',
    owner_id_sha256: '2'.repeat(64),
    account_type: 'user',
    currency: 'BDAG',
    created_at: '2026-10-01T12:00:00.000000Z',
  }] },
  premium_transaction_count: 0,
  premium_bindings: {
    purchase_receipts: { count: 0, sha256: '3'.repeat(64) },
    subscription_periods: { count: 0, sha256: '4'.repeat(64) },
  },
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
});
const cronSnapshot = installed => {
  const command = 'select public.wake_scheduled_publications_b2_v1()';
  const items = installed ? [{
    jobid: '1',
    jobname: 'process-scheduled-publications-b2',
    schedule: '* * * * *',
    database: 'postgres',
    username: 'postgres',
    active: true,
    nodename: 'localhost',
    nodeport: 5432,
    command_sha256: sha256(command),
    legacy_normalized_command_sha256: sha256(command),
  }] : [];
  return { schema_version: 1, complete: true, query_id: 'nelyon-cron-snapshot-v1', count: items.length, items };
};
const premiumState = () => ({
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
    schema: 'private', name: 'creator_premium_contents', owner: 'postgres',
    rls_enabled: true, force_rls: true,
    acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
  }],
});

const PROTECTED_RPC_IDENTITIES = [
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
const protectedRpcRows = () => PROTECTED_RPC_IDENTITIES.map(([name, argumentTypes]) => ({
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
}));

const deployedBundleSha256 = name => sha256(`synthetic deployed bundle for ${name}`);

function deployedRows(policy, contract, installed) {
  const names = [...policy.supabase.managed_functions];
  let index = 0;
  while (names.length < policy.supabase.expected_remote_function_count) names.push(`unmanaged-${String(index++).padStart(2, '0')}`);
  const rows = [...new Set(names)].sort().map((name, rowIndex) => {
    const expected = contract?.functions?.find(item => item.name === name);
    return { slug: name, status: 'ACTIVE', version: rowIndex + 1 + (installed && expected ? 100 : 0),
      verify_jwt: expected?.verify_jwt ?? true,
      ezbr_sha256: expected ? installed ? deployedBundleSha256(name) : sha256(`pre:${name}`) : sha256(name) };
  });
  if (installed) {
    const expected = contract.functions.find(item => item.name === 'process-scheduled-publications');
    rows.push({ slug: expected.name, status: 'ACTIVE', version: 1,
      verify_jwt: expected.verify_jwt, ezbr_sha256: deployedBundleSha256(expected.name) });
  }
  return rows.sort((left, right) => left.slug.localeCompare(right.slug));
}

function baseManagementFetch({ policy, contract, phase, backupMode = 'source', parity = null, databaseMatrix = null, calls = [] }) {
  return async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    calls.push({ url, method: options.method ?? input?.method ?? 'GET', headers: options.headers ?? input?.headers });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/health')) return jsonResponse(healthyServices());
    if (pathname.endsWith('/database/migrations')) {
      const migrations = [{ version: '20261009021414', name: 'creator_premium_b5_creator_management_ux' }];
      if (phase() !== 'pre' && phase() !== 'authority') {
        migrations.push({ version: '20261108061946', name: 'web_control_centers_b2_scheduled_publishing' });
      }
      return jsonResponse(migrations);
    }
    if (pathname.endsWith('/functions')) {
      return jsonResponse(deployedRows(policy, contract, phase() !== 'pre' && phase() !== 'authority'));
    }
    if (pathname.endsWith('/database/backups')) {
      const inserted = backupMode() === 'fresh' ? RECOVERY_AT
        : backupMode() === 'stale' ? SOURCE_AT : '2026-10-12T05:15:56.590Z';
      return jsonResponse({ backups: backupMode() === 'missing' ? [] : [completedBackup(inserted)],
        pitr_enabled: false, region: 'us-east-1', walg_enabled: true });
    }
    if (pathname.endsWith('/advisors/security')) return jsonResponse({ lints: [] });
    if (pathname.endsWith('/database/query/read-only')) {
      const queryRequest = JSON.parse(options.body);
      const query = queryRequest.query;
      if (query.includes('nelyon-finance-snapshot-v1')) {
        return jsonResponse([{ snapshot: financeSnapshot(policy.supabase.finance_policy) }], 201);
      }
      if (query.includes('nelyon-cron-snapshot-v1')) {
        const installed = phase() !== 'pre' && phase() !== 'authority';
        return jsonResponse([{ snapshot: cronSnapshot(installed) }], 201);
      }
      if (query.includes('nelyon-premium-postcheck-state-v1')) return jsonResponse([{ snapshot: premiumState() }], 201);
      if (query.includes('nelyon-b2-catalog-v1')) {
        assert.ok(parity(), 'post/recovery catalog requires branded parity-derived fixture');
        const identities = [...query.match(/= any\(array\[([\s\S]+?)\]::text\[\]\)/)[1]
          .matchAll(/'([^']+)'/g)].map(match => match[1]);
        const selected = databaseMatrix.catalog.filter(row => identities.includes(row.value.identity));
        const relations = parity().databaseRelations.map(({ acl: ignoredAcl, access: ignoredAccess, ...value }) => ({ kind: 'relation', value }));
        return jsonResponse([...relations, ...selected], 201);
      }
      if (query === RPC_SECURITY_ATTESTATION_SQL) {
        const requested = JSON.parse(queryRequest.parameters?.[0] ?? '[]');
        const databaseNames = new Set(databaseMatrix.rows.map(row => row.name));
        const b2AuthorityQuery = requested.length === databaseMatrix.rows.length
          && requested.every(item => databaseNames.has(item.name));
        if (b2AuthorityQuery) return jsonResponse(databaseMatrix.rows, 201);
        // The fixed B2 pre-state query observes all five inherited functions;
        // the separate legacy policy query still receives its baseline rows.
        const inheritedNames = new Set(['create_carousel_post', 'create_photo_post_with_media',
          'delete_my_publication_draft_v1', 'publish_my_publication_draft_v1', 'update_my_publication_draft_v1']);
        if (requested.length === inheritedNames.size && requested.every(item => inheritedNames.has(item.name))) {
          return jsonResponse(requested.map(identity => databaseMatrix.rows.find(row => row.schema === identity.schema
            && row.name === identity.name
            && canonicalJson(row.argument_types) === canonicalJson(identity.argument_types))), 201);
        }
        const baselineRows = protectedRpcRows();
        return jsonResponse(requested.map(identity => baselineRows.find(row => row.schema === identity.schema
          && row.name === identity.name
          && canonicalJson(row.argument_types) === canonicalJson(identity.argument_types))), 201);
      }
      if (query.includes('nelyon-b2-relation-acl-v1')) {
        if (phase() === 'pre' || phase() === 'authority') return jsonResponse(['public.media_asset_links', 'public.media_assets'].map(identity => ({
          identity, owner: 'postgres', rls: true, forceRls: true, acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
          access: { public: false, anon: false, authenticated: false, service_role: false } })), 201);
        return jsonResponse(parity().databaseRelations.map(({ definitionSha256: ignored, ...row }) => row), 201);
      }
      if (query.includes('pg_catalog.jsonb_to_recordset($1::jsonb)')) return jsonResponse(protectedRpcRows(), 201);
      throw new Error(`unexpected read-only SQL: ${query.slice(0, 80)}`);
    }
    throw new Error(`unexpected management request ${url}`);
  };
}

function r2Response(authorityBytes, request) {
  const headers = { 'content-length': String(authorityBytes.length), 'content-encoding': 'identity' };
  return request.method === 'HEAD'
    ? new Response(null, { status: 200, headers })
    : new Response(authorityBytes, { status: 200, headers });
}

function publicInputs(policyBytes, requestBytes, manifest, descriptorBytes) {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  return Object.freeze({
    descriptorBytes,
    manifestBytes,
    manifestDigestBytes: Buffer.from(`${sha256(manifestBytes)}\n`, 'utf8'),
    policyBytes,
    requestBytes,
  });
}

function runtimeInvocation(action, paths, extra = {}) {
  return {
    action,
    inputs: { policy: paths.policy, request: paths.request, bundle: paths.bundle, ...extra },
    verificationOutput: join(paths.root, `${action}-runtime-verification.json`),
  };
}

// Test-only input verification. Missing private pins fail closed; there is no
// embedded default or assertion output containing captured evidence identities.
const parsePinnedOwnerCapture = (bytes, { bytesSha256, evidenceSha256 } = {}) => {
  const deny = () => { throw new Error('Private capture identity verification failed'); };
  if (!/^[a-f0-9]{64}$/.test(bytesSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(evidenceSha256 ?? '')) deny();
  if (sha256(bytes) !== bytesSha256) deny();
  let capture;
  try { capture = JSON.parse(bytes.toString('utf8')); } catch { deny(); }
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)
    || capture.evidence_sha256 !== evidenceSha256) deny();
  return capture;
};

test('private owner capture requires both independently supplied pins and emits no identity values on failure', () => {
  const capture = { phase: 'post', evidence_sha256: 'a'.repeat(64), marker: 'synthetic-only' };
  const bytes = Buffer.from(JSON.stringify(capture));
  const pins = { bytesSha256: sha256(bytes), evidenceSha256: 'a'.repeat(64) };
  assert.deepEqual(parsePinnedOwnerCapture(bytes, pins), capture);
  for (const invalid of [undefined, {}, { bytesSha256: pins.bytesSha256 },
    { evidenceSha256: pins.evidenceSha256 }, { ...pins, bytesSha256: 'b'.repeat(64) },
    { ...pins, evidenceSha256: 'b'.repeat(64) }, { ...pins, bytesSha256: 'not-a-digest' }]) {
    assert.throws(() => parsePinnedOwnerCapture(bytes, invalid),
      { message: 'Private capture identity verification failed' });
  }
  assert.throws(() => parsePinnedOwnerCapture(Buffer.concat([bytes, Buffer.from(' ')]), pins),
    { message: 'Private capture identity verification failed' });
  for (const invalidJson of ['{', 'null', '[]', '"synthetic"']) {
    const invalidBytes = Buffer.from(invalidJson);
    assert.throws(() => parsePinnedOwnerCapture(invalidBytes,
      { ...pins, bytesSha256: sha256(invalidBytes) }),
    { message: 'Private capture identity verification failed' });
  }
});

test('Task 7 production graph closes current and exact-attempt recovery authority end to end', async t => {
  assert.equal(typeof privateCli.createPrivateAuthorityProductionHost, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nelyon-b2-runtime-e2e-'));
  const approvedRoot = join(root, 'approved-tree');
  mkdirSync(approvedRoot);
  const fixtureDescriptor = JSON.parse(readFileSync(new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json',import.meta.url)));
  const fixturePaths = ['supabase/config.toml',fixtureDescriptor.contract.productive_changes.at(-1).path,
    ...fixtureDescriptor.contract.functions.map(item=>'supabase/functions/'+item.name+'/index.ts')];
  for(const relativePath of fixturePaths) {
    const target=join(approvedRoot,relativePath);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,gitBytes(relativePath));
  }
  const fixtureGit=args=>execFileSync('git',['-c','core.autocrlf=false','-c','core.hooksPath=NUL',...args],{cwd:approvedRoot,stdio:'pipe',
    env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
      GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'}}).toString().trim();
  fixtureGit(['init','--quiet']);fixtureGit(['add','.']);fixtureGit(['commit','--quiet','-m','synthetic approved migration source']);
  migrationApprovedSha=fixtureGit(['rev-parse','HEAD']);
  const installedPolicy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url)));
  const policy = structuredClone(installedPolicy);
  policy.baseline.sha = 'f'.repeat(40);
  policy.baseline.migration_count = 351;
  policy.baseline.latest_migration = '20261024173500_creator_premium_f2_complete_monetization';
  policy.supabase.finance_policy = {
    platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true, subscription_enabled: true,
  };
  const manifest = baseManifest();
  manifest.schema_version = 1;
  manifest.generated_at = SOURCE_AT;
  manifest.identity = {
    actor: policy.owner,
    triggering_actor: policy.owner,
    repository: policy.repository,
    workflow_ref: `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`,
    ref: `refs/heads/${policy.default_branch}`,
    run_id: baseRequest().runId,
    run_attempt: baseRequest().runAttempt,
    release_id: baseRequest().releaseId,
    approved_sha: baseRequest().approvedSha,
    mode: 'release',
    scope_confirmation: policy.scope_confirmations.release_high_risk,
  };
  manifest.resources.config_changed = true;
  manifest.risk = { level: 'HIGH', findings: [] };
  manifest.blockers = [];
  manifest.result = 'PLAN READY';
  const runtimeClosure = buildPrivateRuntimeClosure({ repositoryRoot: ROOT, readFile: readFileSync });
  manifest.runtime_closure = runtimeClosure;
  manifest.compiler.path = 'scripts/nelyon-production-release.mjs';
  manifest.compiler.sha256 = runtimeClosure.files.find(item => item.path === manifest.compiler.path).sha256;
  manifest.compiler.snapshot_adapter_sha256 = runtimeClosure.files
    .find(item => item.path === manifest.compiler.snapshot_adapter_path).sha256;
  const descriptorTemplate = JSON.parse(readFileSync(
    new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url),
  ));
  const contract = structuredClone(descriptorTemplate.contract);
  contract.state = 'approved';
  contract.release_ready = true;
  contract.baseline_sha = policy.baseline.sha;
  contract.reviewed_source_sha = baseRequest().approvedSha;
  contract.integration_base_sha = 'b'.repeat(40);
  contract.function_inventory = { before: policy.supabase.expected_remote_function_count,
    after: policy.supabase.expected_remote_function_count + 1 };
  const functionConfig = parseFunctionConfig(gitBytes('supabase/config.toml').toString('utf8'));
  const functionContracts = contract.functions.map(expected => {
    const entrypoint = `supabase/functions/${expected.name}/index.ts`;
    const bytes = gitBytes(entrypoint);
    const source_files = [{ path: entrypoint, sha256: sha256(bytes) }];
    const config = functionConfig[expected.name];
    expected.source_sha256 = sha256(canonicalJson({ entrypoint, import_map: null, source_files }));
    expected.config_sha256 = sha256(canonicalJson(config));
    return { name: expected.name, verify_jwt: expected.verify_jwt, entrypoint, import_map: null,
      source_files, source_changed: true, source_sha256: expected.source_sha256 };
  });
  const migrationPath = contract.productive_changes.at(-1).path;
  const migrationBytes = gitBytes(migrationPath);
  manifest.delta = { productive_change_count: contract.productive_changes.length,
    files: contract.productive_changes.map(item => ({ file_type: 'file', path: item.path, status: item.status })) };
  manifest.resources.functions = contract.functions.map(item => item.name);
  manifest.resources.function_contracts = functionContracts;

  let phase = 'pre';
  let backupMode = 'source';
  let compiledParity = null;
  const databaseMatrix = b2DatabaseFunctionMatrix();
  const initialFetch = baseManagementFetch({ policy, contract, phase: () => phase, backupMode: () => backupMode,
    parity: () => compiledParity, databaseMatrix });
  const legacy = await captureProductionSnapshot({ phase: 'pre', policy, request: baseRequest(), manifest,
    token: 'synthetic-supabase-token', fetchImpl: initialFetch, observedAt: '2026-10-12T12:00:00.000Z',
    adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256 });
  for (const exception of policy.security_advisor.exceptions) {
    const actual = legacy.rpc_security.items.find(item => item.name === exception.object.name);
    if (actual) {
      exception.object.identity_arguments = actual.identity_arguments;
      exception.attestation = Object.fromEntries(
        ['acl', 'definition_sha256', 'execute', 'owner', 'search_path', 'security_definer'].map(key => [key, actual[key]]),
      );
    }
  }
  policy.baseline = {
    ...policy.baseline,
    state: 'verified',
    migration_count: 1,
    latest_migration: '20261009021414_creator_premium_b5_creator_management_ux',
    evidence: '7'.repeat(64),
    evidence_digests: buildProductionBaselineDigests({ evidence: legacy, policy }),
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    verified_by: policy.owner,
    verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  manifest.baseline = { state: policy.baseline.state, sha: policy.baseline.sha,
    origin_main_sha: baseRequest().approvedSha };

  const privateMarker = 'PRIVATE_B2_E2E_AUTHORITY_MARKER';
  const markerCanonical = canonicalJson({
    definitionSha256: '1'.repeat(64), forceRls: true,
    identity: 'private.PRIVATE_B2_E2E_AUTHORITY_MARKER', owner: privateMarker, rls: true,
  }).trimEnd();
  const authority = {
    schemaVersion: 1,
    authorityId: 'web-control-centers-b2-release-authority-v1',
    publicContractSha256: sha256(canonicalJson(contract)),
    phase: contract.to_phase,
    issuedFor: { baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
      integrationBaseSha: contract.integration_base_sha },
    successorCatalog: { schemaVersion: 1, records: [{ kind: 'relation', identity: `private.${privateMarker}`,
      expectedCanonicalJson: markerCanonical, expectedSha256: sha256(markerCanonical) }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: legacy.cron_security.advisors.sha256, baselineItems: legacy.cron_security.advisors.items, records: [] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical',
      projectRefSha256: sha256(policy.supabase.project_ref), evidenceSha256: sha256(canonicalJson(legacy.backup)),
      status: 'COMPLETED', insertedAt: legacy.backup.inserted_at, completedObservedAt: legacy.observed_at,
      expiresAt: new Date(Date.parse(legacy.backup.inserted_at) + 86_400_000).toISOString() },
    vaultEdgeParity: syntheticVaultEdgeParity(legacy.observed_at),
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: [contract.to_phase],
      authorizationSha256: '5'.repeat(64), approvedAt: legacy.observed_at,
      expiresAt: '2026-10-13T11:00:00.000Z' },
  };
  const scheduleRelations = [
    'public.media_asset_links',
    'public.media_assets',
    'private.publication_schedule_attempts',
    'private.publication_schedule_commands',
    'private.publication_schedule_materializations',
    'private.publication_schedule_policy',
    'private.publication_schedules',
  ].map(identity => {
    const expectedCanonicalJson = canonicalJson({ definitionSha256: sha256(identity), forceRls: true,
      identity, owner: 'postgres', rls: true }).trimEnd();
    return { kind: 'relation', identity, expectedCanonicalJson, expectedSha256: sha256(expectedCanonicalJson) };
  });
  const functionInventoryRecords = contract.functions.map(item => {
    const expectedCanonicalJson = canonicalJson({ configSha256: item.config_sha256,
      identity: item.name, sourceSha256: item.source_sha256, verifyJwt: item.verify_jwt }).trimEnd();
    return { kind: 'function_inventory', identity: item.name, expectedCanonicalJson,
      expectedSha256: sha256(expectedCanonicalJson) };
  });
  authority.successorCatalog.records.push(...databaseMatrix.records, ...scheduleRelations,
    ...functionInventoryRecords);
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((left, right) => {
    const leftKey = `${left.kind}\0${left.identity}`;
    const rightKey = `${right.kind}\0${right.identity}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (let index = 1; index < authority.successorCatalog.records.length; index += 1) {
    const previous = authority.successorCatalog.records[index - 1];
    const current = authority.successorCatalog.records[index];
    assert.ok(`${previous.kind}\0${previous.identity}` < `${current.kind}\0${current.identity}`,
      `${previous.kind}:${previous.identity} sorts before ${current.kind}:${current.identity}`);
  }
  const authorityJson = JSON.stringify(authority);
  const authorityBytes = Buffer.from(authorityJson, 'utf8');
  const descriptor = { schema_version: 1, contract, public_contract_sha256: authority.publicContractSha256,
    private_authority: { required: true, schema_version: 1, authority_id: authority.authorityId,
      sha256: sha256(authorityBytes) } };
  const descriptorBytes = Buffer.from(JSON.stringify(descriptor), 'utf8');
  const contextArgs = { descriptorBytes, expectedDescriptorSha256: sha256(descriptorBytes), phase: contract.to_phase,
    transitionId: contract.id, baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
    integrationBaseSha: contract.integration_base_sha, requestedAt: SOURCE_AT, authorityJson,
    expectedPrivateAuthoritySha256: sha256(authorityBytes) };
  const expectedContext = createReleaseAuthorityContext(contextArgs);
  const expectedReceipt = publicAuthorityReceipt(expectedContext);
  for (const privateMetadata of [authority.vaultEdgeParity.vault.revision, authority.vaultEdgeParity.edge.provisioningGeneration,
    authority.vaultEdgeParity.changeFreezeId, authority.vaultEdgeParity.vault.secretVersion]) {
    assert.equal(JSON.stringify(expectedReceipt).includes(privateMetadata), false);
  }
  manifest.resources.web_control_centers_b2_transition = { contract, descriptorSha256: sha256(descriptorBytes),
    publicContractSha256: authority.publicContractSha256, expectedPrivateAuthoritySha256: sha256(authorityBytes),
    privateAuthorityRequired: true };
  manifest.resources.migrations = [{ ...Object.fromEntries(Object.entries(contract.productive_changes.at(-1))
    .filter(([key]) => key !== 'status')), version: '20261108061946' }];

  for (const relativePath of ['supabase/config.toml', migrationPath,
    ...functionContracts.flatMap(item => item.source_files.map(file => file.path))]) {
    const target = join(approvedRoot, ...relativePath.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, gitBytes(relativePath));
  }
  const paths = { root, policy: join(root, 'policy.json'), request: join(root, 'request.json'),
    bundle: join(root, 'bundle') };
  mkdirSync(paths.bundle);
  const releaseRequest = { ...baseRequest(), actor: policy.owner, triggeringActor: policy.owner,
    repository: policy.repository, workflowRef: `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`,
    ref: `refs/heads/${policy.default_branch}`, mainSha: baseRequest().approvedSha, mode: 'release',
    scopeConfirmation: policy.scope_confirmations.release_high_risk };
  const policyBytes = Buffer.from(canonicalJson(policy), 'utf8');
  const requestBytes = Buffer.from(canonicalJson(releaseRequest), 'utf8');
  writeFileSync(paths.policy, policyBytes);
  writeFileSync(paths.request, requestBytes);
  writeFileSync(join(paths.bundle, 'manifest.json'), canonicalJson(manifest));
  writeFileSync(join(paths.bundle, 'manifest.sha256'), `${sha256(canonicalJson(manifest))}\n`);

  let secretEnvironmentConstructed = false;
  const closureEnvironment = { NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: runtimeClosure.closure_sha256 };
  const bootstrapCapability = await bootstrapPrivateAuthorityRuntime({ environment: closureEnvironment,
    manifestClosure: runtimeClosure, repositoryRoot: ROOT, readFile: readFileSync, nodeVersion: '24.21.0' });
  assert.equal(secretEnvironmentConstructed, false);
  secretEnvironmentConstructed = true;
  const environment = {
    NELYON_PRIVATE_AUTHORITY_PROVIDER: 'r2',
    NELYON_PRIVATE_AUTHORITY_R2_ACCOUNT_ID: 'a'.repeat(32),
    NELYON_PRIVATE_AUTHORITY_R2_BUCKET: 'nelyon-private-authority',
    NELYON_PRIVATE_AUTHORITY_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    NELYON_PRIVATE_AUTHORITY_R2_SECRET_ACCESS_KEY: SECRET,
    NELYON_PRIVATE_AUTHORITY_DESCRIPTOR_SHA256: sha256(descriptorBytes),
    NELYON_PRIVATE_AUTHORITY_SHA256: sha256(authorityBytes),
    NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: runtimeClosure.closure_sha256,
    NELYON_RELEASE_POLICY_SHA256: sha256(policyBytes),
    NELYON_PRIVATE_AUTHORITY_TIMEOUT_MS: '10000',
    SUPABASE_ACCESS_TOKEN: 'synthetic-supabase-token',
    GITHUB_TOKEN: 'synthetic-github-token',
    RUNNER_TEMP: root,
  };
  assert.equal(secretEnvironmentConstructed, true);

  const reviewedTree = createTrustedB2ReviewedTree({ approvedSha: manifest.identity.approved_sha,
    files: [{ path: migrationPath, bytes: migrationBytes }, ...functionContracts.flatMap(item => (
      item.source_files.map(file => ({ path: file.path, bytes: gitBytes(file.path) }))
    ))],
    functionConfigs: contract.functions.map(item => ({ name: item.name, config: functionConfig[item.name] })) });
  compiledParity = compileB2SourceParity({ authorityContext: expectedContext, manifest, descriptorBytes,
    reviewedTree, deployedFunctionInventory: createTrustedB2DeployedFunctionInventory({ capturedAt: SOURCE_AT,
      functions: contract.functions.map(item => ({ name: item.name, deployedSha256: deployedBundleSha256(item.name) })) }),
    capturedAt: SOURCE_AT });
  const recoveryParity = compileB2SourceParity({ authorityContext: expectedContext, manifest, descriptorBytes,
    reviewedTree, deployedFunctionInventory: createTrustedB2DeployedFunctionInventory({ capturedAt: RECOVERY_AT,
      functions: contract.functions.map(item => ({ name: item.name, deployedSha256: deployedBundleSha256(item.name) })) }),
    capturedAt: RECOVERY_AT });
  assert.equal(compiledParity.manifestSha256, sha256(canonicalJson(manifest)));
  const calls = [];
  let managementFetch = baseManagementFetch({ policy, contract, phase: () => phase, backupMode: () => backupMode,
    parity: () => compiledParity, databaseMatrix, calls });
  const currentFetch = async (input, options) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    if (new URL(url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      calls.push({ url, method: request.method, headers: request.headers });
      assert.ok(url.endsWith(`/sha256/${sha256(authorityBytes)}.json`));
      return r2Response(authorityBytes, request);
    }
    return managementFetch(input, options);
  };
  const currentPublicInputs = publicInputs(policyBytes, requestBytes, manifest, descriptorBytes);
  let runtimeContext;
  phase = 'authority';
  assert.doesNotThrow(() => parseB2ReleaseDescriptor(descriptorBytes, sha256(descriptorBytes)),
    'synthetic approved descriptor parses under the production schema');
  assert.doesNotThrow(() => verifyB2ProtectedAuthority({ manifest, authorityContext: expectedContext,
    inventory: { schemaVersion: 1, complete: true, capturedAt: SOURCE_AT,
      names: deployedRows(policy, contract, false).map(item => item.slug) }, requestedAt: SOURCE_AT }));
  const host = privateCli.createPrivateAuthorityProductionHost({ publicInputs: currentPublicInputs,
    environment, fetchImpl: currentFetch, repositoryRoot: approvedRoot, recoveryRuntime: null });
  const runtime = createPrivateAuthorityRuntime({ bootstrapCapability, environment, fetchImpl: currentFetch,
    now: () => SOURCE_AT, host });
  let authorityResult;
  await assert.doesNotReject(async () => {
    authorityResult = await runtime.execute(runtimeInvocation('authority-proof', paths));
  }, 'authority-proof through production controller');
  assert.deepEqual(authorityResult, { schemaVersion: 1, result: 'VERIFIED', releaseReady: false });
  runtimeContext = expectedContext;
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'authority-proof-runtime-verification.json'))), expectedReceipt);

  await t.test('junction stage output cannot escape RUNNER_TEMP', async () => {
    const externalStageRoot = mkdtempSync(join(tmpdir(), 'nelyon-b2-stage-escape-'));
    const stageJunction = join(root, 'stage-output-junction');
    symlinkSync(externalStageRoot, stageJunction, 'junction');
    const escapedSnapshot = join(stageJunction, 'escaped-pre.json');
    await assert.rejects(runtime.execute(runtimeInvocation('pre-snapshot', paths,
      { snapshotOutput: escapedSnapshot })), { code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' });
    assert.equal(existsSync(join(externalStageRoot, 'escaped-pre.json')), false,
      'stage output cannot follow a junction outside RUNNER_TEMP');
  });

  const prePath = join(root, 'pre.json');
  phase = 'pre';
  await assert.doesNotReject(runtime.execute(runtimeInvocation('pre-snapshot', paths, { snapshotOutput: prePath })),
    'pre-snapshot through production controller');
  const pre = JSON.parse(readFileSync(prePath));
  assert.deepEqual(pre.authority_verification.receipt, expectedReceipt);
  await t.test('protected migration CLI invokes fixed adapters only after source, snapshot, gate and independent binary pin',async()=>{
    const binaryPath=join(root,process.platform==='win32'?'fixture-supabase.exe':'fixture-supabase');
    writeFileSync(binaryPath,'synthetic binary bytes never executed');
    const pin=sha256(readFileSync(binaryPath));let mints=0,executions=0,time=SOURCE_AT,expireAfterMint=false,failApply=false;
    const migrationRoot=join(root,'nelyon-private-authority-public');mkdirSync(migrationRoot,{recursive:true});
    const migrationEnvironment={...environment,NELYON_SUPABASE_CLI_SHA256:pin};
    const gatePath=join(root,'migration-current-gate.json');
    const gate={result:'GATE_VERIFIED',run_id:releaseRequest.runId,run_attempt:releaseRequest.runAttempt,
      release_id:releaseRequest.releaseId,approved_sha:releaseRequest.approvedSha,
      manifest_sha256:sha256(canonicalJson(manifest)),environment:policy.environment,authorityReceipt:expectedReceipt};
    writeFileSync(gatePath,canonicalJson(gate));
    const migrationFetch=async(input,options)=>{
      if(String(input)==='https://api.supabase.com/v1/projects/aewwdlvbwpczqyvkwvvj/cli/login-role') {
        assert.equal(options.method,'POST');assert.equal(options.redirect,'error');mints++;
        if(expireAfterMint)time='2030-01-01T00:00:00.000Z';
        return new Response(JSON.stringify({role:'cli_login_fixture',password:'SYNTHETIC_DB_PASSWORD'}),{status:201});
      }
      return currentFetch(input,options);
    };
    const execMock=(file,args,options,callback)=>{
      executions++;assert.equal(options.shell,false);assert.equal(options.env.PGPASSWORD,'SYNTHETIC_DB_PASSWORD');
      assert.equal(options.env.SUPABASE_ACCESS_TOKEN,undefined);assert.equal(args.includes('--project-ref'),false);
      assert.equal(args.some(value=>value.includes('SYNTHETIC_DB_PASSWORD')),false);
      if(failApply&&!args.includes('--dry-run')){callback(new Error('synthetic timeout'));return;}
      callback(null,args.includes('--dry-run')?JSON.stringify({dryRun:true,message:'pending',migrations:manifest.resources.migrations.map(x=>x.path.split('/').at(-1)),roles:[],seeds:[],upToDate:false}):'applied');
    };
    const make=env=>createPrivateAuthorityRuntime({bootstrapCapability,environment:env,fetchImpl:migrationFetch,now:()=>time,
      host:privateCli.createPrivateAuthorityProductionHost({publicInputs:currentPublicInputs,environment:env,fetchImpl:migrationFetch,
        repositoryRoot:approvedRoot,migrationExecFileImpl:execMock,clock:()=>time})});
    const invoke=async(action,label,env=migrationEnvironment,override={})=>{
      const stageRoot=join(env.RUNNER_TEMP,'nelyon-private-authority-public');
      const output=join(stageRoot,label+'.json'),verification=join(stageRoot,label+'-receipt.json');const chunks=[];
      const code=await privateCli.runPrivateAuthorityCli([action,'--policy',paths.policy,'--request',paths.request,'--bundle',paths.bundle,
        '--current-gate',override.gatePath??gatePath,'--pre-snapshot',override.prePath??prePath,'--binary-path',binaryPath,'--stage-output',output,'--verification-output',verification],
        {execute:invocation=>make(env).execute(invocation),stdout:{write:x=>chunks.push(x)},stderr:{write:x=>chunks.push(x)}});
      assert.doesNotMatch(chunks.join(''),/SYNTHETIC_DB_PASSWORD|synthetic-supabase-token/);return {code,output,verification};
    };
    assert.notEqual((await invoke('dryrun-migrations','missing-binary-pin',environment)).code,0);assert.equal(mints,0);assert.equal(executions,0);
    assert.notEqual((await invoke('dryrun-migrations','wrong-binary-pin',{...migrationEnvironment,NELYON_SUPABASE_CLI_SHA256:'0'.repeat(64)})).code,0);assert.equal(mints,0);
    writeFileSync(gatePath,canonicalJson({...gate,result:'READ_ONLY_REFRESH_AUTHORIZED'}));
    assert.notEqual((await invoke('dryrun-migrations','readonly-not-full-gate')).code,0);assert.equal(mints,0);assert.equal(executions,0);
    writeFileSync(gatePath,canonicalJson(gate));
    time=authority.vaultEdgeParity.expiresAt;
    const expiredParity=await invoke('apply-migrations','expired-parity');
    assert.notEqual(expiredParity.code,0);
    assert.equal(mints,0);assert.equal(executions,0);
    assert.equal(existsSync(expiredParity.verification),false);
    assert.equal(existsSync(join(migrationRoot,'protected-stage-proofs.json')),false);
    time=SOURCE_AT;
    expireAfterMint=true;assert.notEqual((await invoke('dryrun-migrations','expired-during-mint')).code,0);
    assert.equal(mints,1);assert.equal(executions,0);time=SOURCE_AT;expireAfterMint=false;mints=0;
    const dry=await invoke('dryrun-migrations','protected-dryrun');assert.equal(dry.code,0);
    assert.equal(JSON.parse(readFileSync(dry.output)).complete,true);assert.equal(existsSync(join(migrationRoot,'protected-stage-proofs.json')),false);
    const applied=await invoke('apply-migrations','protected-apply');assert.equal(applied.code,0);
    assert.equal(JSON.parse(readFileSync(applied.output)).result,'MIGRATIONS_EXECUTED');
    assert.equal(JSON.parse(readFileSync(join(migrationRoot,'protected-stage-proofs.json')))[0].stage,'migrations');
    assert.equal(mints,3);assert.equal(executions,3);
    assert.notEqual((await invoke('apply-migrations','duplicate-apply')).code,0);assert.equal(mints,3);assert.equal(executions,3);
    const failureRoot=join(root,'failed-attempt'),failurePublic=join(failureRoot,'nelyon-private-authority-public'),failureGate=join(failureRoot,'gate-evidence');
    mkdirSync(failurePublic,{recursive:true});mkdirSync(failureGate);
    const failurePre=join(failurePublic,'pre.json'),failureGatePath=join(failurePublic,'gate.json');
    writeFileSync(failurePre,canonicalJson(pre));writeFileSync(failureGatePath,canonicalJson(gate));
    failApply=true;
    const failure=await invoke('apply-migrations','partial-failure',{...migrationEnvironment,RUNNER_TEMP:failureRoot},{prePath:failurePre,gatePath:failureGatePath});
    assert.notEqual(failure.code,0);assert.equal(existsSync(failure.output),false);assert.equal(existsSync(failure.verification),false);
    assert.equal(retainB2MigrationAttemptProof({trustedProofRoot:failurePublic,destinationDirectory:failureGate,manifest,request:releaseRequest,expectedReceipt}),true);
    const retained=JSON.parse(readFileSync(join(failureGate,'protected-stage-proofs.json')));
    assert.equal(retained[0].stage,'migrations');assert.equal(Object.hasOwn(retained[0],'complete'),false);
    assert.equal(mints,5);assert.equal(executions,5);

  });

  await t.test('junction stage input cannot escape RUNNER_TEMP', async () => {
    const externalStageRoot = mkdtempSync(join(tmpdir(), 'nelyon-b2-stage-escape-'));
    const stageJunction = join(root, 'stage-input-junction');
    symlinkSync(externalStageRoot, stageJunction, 'junction');
    writeFileSync(join(externalStageRoot, 'escaped-pre.json'), canonicalJson(pre));
    await assert.rejects(runtime.execute(runtimeInvocation('post-snapshot', paths, {
      preSnapshot: join(stageJunction, 'escaped-pre.json'),
      snapshotOutput: join(root, 'blocked-post.json'),
    })), { code: 'PRIVATE_AUTHORITY_STAGE_BLOCKED' });
    assert.equal(existsSync(join(root, 'blocked-post.json')), false,
      'stage input cannot follow a junction outside RUNNER_TEMP');
  });
  const postPath = join(root, 'post.json');
  phase = 'post';
  await assert.doesNotReject(runtime.execute(runtimeInvocation('post-snapshot', paths,
    { preSnapshot: prePath, snapshotOutput: postPath })), 'post-snapshot through production controller');
  const post = JSON.parse(readFileSync(postPath));
  const postcheck = verifyProductionSnapshotPair({ pre, post, policy, request: releaseRequest, manifest,
    adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256, authorityContext: runtimeContext,
    requestedAt: SOURCE_AT });
  assert.deepEqual(postcheck.receipt, expectedReceipt);
  assert.ok(Object.values(postcheck.checks).every(value => value === true));

  // The capture above uses synthetic catalog definition bytes so it can exercise
  // B2's private successor catalog. The protected CLI must instead load an exact,
  // structurally valid public policy. Project the same complete evidence onto the
  // tracked public exception attestations without changing any policy authority.
  const rpcIdentity = item => `${item.schema}.${item.name}(${item.argument_types.join(',')})`;
  const exactRpcItems = installedPolicy.security_advisor.exceptions
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
    .sort((left, right) => rpcIdentity(left).localeCompare(rpcIdentity(right)));
  const replacedRpcNames = new Set(['update_my_publication_draft_v1', 'delete_my_publication_draft_v1',
    'publish_my_publication_draft_v1', 'create_photo_post_with_media', 'create_carousel_post']);
  const observedPostRpcs = new Map(post.rpc_security.items.map(item => [rpcIdentity(item), item]));
  const exactRpcSnapshot = phaseName => {
    const items = exactRpcItems.map(item => {
      if (phaseName !== 'post' || !replacedRpcNames.has(item.name)) return structuredClone(item);
      const observed = observedPostRpcs.get(rpcIdentity(item));
      assert.ok(observed, `successor RPC ${rpcIdentity(item)} was captured`);
      return { ...structuredClone(item), definition_sha256: observed.definition_sha256 };
    });
    return { complete: true, count: items.length, items, sha256: sha256(canonicalJson(items)) };
  };
  const financeOff = { platform_fee_bps: 0, purchase_enabled: false, refunds_enabled: false,
    subscription_enabled: false };
  const exactEvidence = (source, phaseName) => {
    const evidence = structuredClone(source);
    evidence.rpc_security = exactRpcSnapshot(phaseName);
    Object.assign(evidence.finance.policy, financeOff);
    const { evidence_sha256: ignoredEvidenceSha256, ...unsigned } = evidence;
    evidence.evidence_sha256 = sha256(canonicalJson(unsigned));
    return evidence;
  };
  const verifiedPre = exactEvidence(pre, 'pre');
  const verifiedPost = exactEvidence(post, 'post');
  const verifiedPolicy = structuredClone(installedPolicy);
  verifiedPolicy.supabase.finance_policy = financeOff;
  verifiedPolicy.baseline = {
    ...verifiedPolicy.baseline,
    state: 'verified',
    sha: policy.baseline.sha,
    migration_count: 1,
    latest_migration: '20261009021414_creator_premium_b5_creator_management_ux',
    evidence: '7'.repeat(64),
    evidence_digests: verifiedPolicy.baseline.evidence_digests,
    blocked_resources: [],
    reviewed_policy_sha256: '8'.repeat(64),
    verified_by: verifiedPolicy.owner,
    verified_at: '2026-10-12T11:59:00.000Z',
    authority_source: 'owner-control-plane',
    requires_separate_policy_commit: true,
  };
  const baselineEvidence = structuredClone(verifiedPre);
  delete baselineEvidence.authority_verification;
  {
    const { evidence_sha256: ignoredEvidenceSha256, ...unsigned } = baselineEvidence;
    baselineEvidence.evidence_sha256 = sha256(canonicalJson(unsigned));
  }
  assert.doesNotThrow(() => {
    verifiedPolicy.baseline.evidence_digests = buildProductionBaselineDigests({
      evidence: baselineEvidence,
      policy: verifiedPolicy,
    });
  }, 'the exact tracked-policy projection produces verified baseline digests');
  const verifiedPolicyBytes = Buffer.from(canonicalJson(verifiedPolicy), 'utf8');
  const verifiedPaths = { ...paths, policy: join(root, 'verified-policy.json') };
  const verifiedPrePath = join(root, 'verified-pre.json');
  const verifiedPostPath = join(root, 'verified-post.json');
  writeFileSync(verifiedPaths.policy, verifiedPolicyBytes);
  writeFileSync(verifiedPrePath, canonicalJson(verifiedPre));
  writeFileSync(verifiedPostPath, canonicalJson(verifiedPost));
  const verifiedEnvironment = { ...environment,
    NELYON_RELEASE_POLICY_SHA256: sha256(verifiedPolicyBytes) };
  const verifiedHost = privateCli.createPrivateAuthorityProductionHost({
    publicInputs: publicInputs(verifiedPolicyBytes, requestBytes, manifest, descriptorBytes),
    environment: verifiedEnvironment,
    fetchImpl: currentFetch,
    repositoryRoot: approvedRoot,
    recoveryRuntime: null,
  });
  const verifiedController = createPrivateAuthorityRuntime({ bootstrapCapability,
    environment: verifiedEnvironment, fetchImpl: currentFetch, now: () => SOURCE_AT, host: verifiedHost });
  let verifiedPostcheck;
  assert.doesNotThrow(() => {
    verifiedPostcheck = verifyProductionSnapshotPair({ pre: verifiedPre, post: verifiedPost,
      policy: verifiedPolicy, request: releaseRequest, manifest,
      adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256, authorityContext: runtimeContext,
      requestedAt: SOURCE_AT });
  }, 'the exact tracked-policy projection validates before controller dispatch');
  const controllerPostcheckPath = join(root, 'controller-postcheck.json');
  await assert.doesNotReject(verifiedController.execute(runtimeInvocation('postcheck', verifiedPaths, {
    manifest: join(paths.bundle, 'manifest.json'),
    preSnapshot: verifiedPrePath,
    postSnapshot: verifiedPostPath,
    stageOutput: controllerPostcheckPath,
  })), 'postcheck through the production controller and protected release CLI');
  assert.deepEqual(JSON.parse(readFileSync(controllerPostcheckPath)), verifiedPostcheck);

  let historical;
  await assert.doesNotReject(async () => {
    historical = await b2HistoricalCapture({ manifest, request: releaseRequest, contextArgs, policy,
      at: SOURCE_AT, deployedFunctionRows: deployedRows(policy, contract, true) });
  }, 'historical source artifacts authenticate the completed direct attempt');
  // The real protected policy has no approved B2 attempt. Even valid synthetic
  // artifacts cannot supply that missing approval or replace its policy pin.
  const installedPolicyBytes = readFileSync(join(ROOT, '.github', 'nelyon-production-release-policy.json'));
  const emptyAuthorizationBytes = Buffer.from(canonicalJson({ schema_version: 1,
    kind: 'nelyon-b2-exact-attempt-recovery-v1', repository: installedPolicy.repository,
    workflow_path: installedPolicy.workflow_path, policy_sha256: sha256(installedPolicyBytes), approved_sources: [] }));
  const pinnedEnvironment = { ...environment, NELYON_RELEASE_POLICY_SHA256: sha256(installedPolicyBytes),
    NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: sha256(emptyAuthorizationBytes) };
  const syntheticAdmin = await b2AdminHistoricalFixture();
  let rejectedSourceFetches = 0;
  const rejectExternalFetch = async request => {
    if (request instanceof Request && new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      return r2Response(emptyAuthorizationBytes, request);
    }
    rejectedSourceFetches += 1; throw new Error('unexpected transport');
  };
  const pinnedSourceOptions = { bootstrapCapability, environment: pinnedEnvironment,
    policyBytes: installedPolicyBytes, runId: syntheticAdmin.historical.request.runId,
    runAttempt: syntheticAdmin.historical.request.runAttempt,
    releaseBundle: syntheticAdmin.releaseBundle, gateEvidence: syntheticAdmin.gateEvidence,
    fetchImpl: rejectExternalFetch };
  await assert.rejects(loadProtectedB2RecoveryRuntime(pinnedSourceOptions),
    { code: 'PRIVATE_AUTHORITY_SOURCE_INVALID' }, 'the pinned policy does not approve the synthetic attempt');
  await assert.rejects(loadProtectedB2RecoveryRuntime({ ...pinnedSourceOptions, policyBytes: syntheticAdmin.historical.policyBytes }),
    { code: 'PRIVATE_AUTHORITY_SOURCE_INVALID' }, 'synthetic approval cannot replace the protected policy digest');
  assert.equal(rejectedSourceFetches, 0, 'unapproved or unpinned sources fail before transport');
  // This capture exercises the synthetic transport facts separately from the
  // real-policy protected Admin source controller covered in the runtime suite.
  const recoveryPolicy = structuredClone(policy);
  recoveryPolicy.security_advisor.exceptions = recoveryPolicy.security_advisor.exceptions.map(exception => {
    const retained = structuredClone(exception); delete retained.origin; return retained;
  });
  recoveryPolicy.postcheck_recovery.approved_sources = [historical.source];
  const makeRecoveryRequest = (runId, mode, sourceRun) => ({ ...releaseRequest, runId,
    releaseId: `nelyon-20261014-${runId.slice(-3)}`, mode, recoverySourceRunId: sourceRun,
    scopeConfirmation: recoveryPolicy.scope_confirmations[mode], productiveResources: [] });
  const makeRecoveryManifest = request => ({ identity: { approved_sha: request.approvedSha, mode: request.mode,
    release_id: request.releaseId, run_id: request.runId, run_attempt: request.runAttempt }, compiler: manifest.compiler,
    runtime_closure: runtimeClosure, resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] },
    recovery: { kind: request.mode === 'admin_recovery' ? 'admin_cloudflare_forward_completion' : 'postcheck_only',
      source_run_id: request.recoverySourceRunId, authorityReceipt: expectedReceipt } });
  const directRequest = makeRecoveryRequest('123456790', 'postcheck_recovery', releaseRequest.runId);
  const directManifest = makeRecoveryManifest(directRequest);
  const historicalFiles = new Map([[migrationPath, migrationBytes],
    ['supabase/config.toml', gitBytes('supabase/config.toml')],
    ...functionContracts.flatMap(item => item.source_files.map(file => (
      [file.path, gitBytes(file.path)]
    )))]);
  const exactHistoricalFile = relativePath => historicalFiles.get(relativePath) ?? null;
  const recoveryCalls = [];
  managementFetch = baseManagementFetch({ policy: recoveryPolicy, contract, phase: () => phase, backupMode: () => backupMode,
    parity: () => compiledParity, databaseMatrix, calls: recoveryCalls });
  const recoveryFetch = async (input, options) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
      recoveryCalls.push({ url, method: request.method, headers: request.headers });
      assert.ok(url.endsWith(`/sha256/${contextArgs.expectedPrivateAuthoritySha256}.json`));
      assert.equal(url.includes(`${'e'.repeat(64)}.json`), false);
      return r2Response(authorityBytes, request);
    }
    const marker = `/repos/${policy.repository}/contents/`;
    if (parsed.pathname.includes(marker) && parsed.searchParams.get('ref') === releaseRequest.approvedSha) {
      const relativePath = decodeURIComponent(parsed.pathname.split(marker)[1]);
      const bytes = exactHistoricalFile(relativePath);
      if (bytes) return jsonResponse({ path: relativePath, type: 'file', encoding: 'base64', size: bytes.length,
        sha: gitBlob(bytes), content: bytes.toString('base64') });
    }
    if (parsed.hostname === 'api.github.com') return historical.fetchImpl(url, options);
    return managementFetch(input, options);
  };
  phase = 'recovery';
  backupMode = 'fresh';
  const currentGate = { result: 'GATE_VERIFIED', run_id: directRequest.runId,
    run_attempt: directRequest.runAttempt, release_id: directRequest.releaseId,
    approved_sha: directRequest.approvedSha, manifest_sha256: sha256(canonicalJson(directManifest)),
    environment: recoveryPolicy.environment, authorityReceipt: expectedReceipt };
  assert.equal(recoveryParity.manifestSha256,
    sha256(canonicalJson(historical.verifiedSource.source_manifest)),
    'recovery parity is bound to the authenticated historical manifest');
  const direct = await captureProductionSnapshot({ phase: 'recovery', policy: recoveryPolicy,
    request: directRequest, manifest: directManifest, token: 'synthetic-supabase-token', fetchImpl: recoveryFetch,
    observedAt: RECOVERY_AT, requestedAt: RECOVERY_AT, adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, sourceParity: recoveryParity,
    recoveryAuthorization: { verifiedSource: historical.verifiedSource, currentGate } });
  const directPostcheck = verifyPostcheckRecovery({ policy: recoveryPolicy, recoveryRequest: directRequest,
    recoveryManifest: directManifest, sourceManifest: historical.verifiedSource.source_manifest,
    sourceObservation: historical.verifiedSource.source_observation, currentEvidence: direct,
    adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, verifiedSource: historical.verifiedSource,
    currentGate, requestedAt: RECOVERY_AT });
  assert.deepEqual(directPostcheck.receipt, expectedReceipt);
  assert.ok(Object.values(directPostcheck.checks).every(value => value === true));

  await t.test('historical capture rejects a live Edge version absent from the authenticated attempt', async () => {
    const liveRows = deployedRows(policy, contract, true);
    liveRows.find(row => row.slug === 'process-scheduled-publications').version += 1;
    await assert.rejects(captureProductionSnapshot({
      phase: 'recovery', policy: recoveryPolicy, request: directRequest, manifest: directManifest,
      token: 'synthetic-supabase-token', observedAt: RECOVERY_AT, requestedAt: RECOVERY_AT,
      adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256, authorityContext: historical.authorityContext,
      sourceParity: recoveryParity, recoveryAuthorization: { verifiedSource: historical.verifiedSource, currentGate },
      fetchImpl: (input, options) => new URL(input).pathname.endsWith('/functions')
        ? jsonResponse(liveRows)
        : recoveryFetch(input, options),
    }), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  });

  await t.test('historical recovery rejects a different deployed Edge function with a recomputed snapshot digest', () => {
    for (const [key, change] of [
      ['ezbr_sha256', () => sha256('unapproved Edge bundle')],
      ['version', version => version + 1],
      ['verify_jwt', verifyJwt => !verifyJwt],
    ]) {
      const different = structuredClone(direct);
      const row = different.functions.items.find(item => item.slug === 'process-scheduled-publications');
      row[key] = change(row[key]);
      if (Object.hasOwn(different.functions, 'sha256')) {
        different.functions.sha256 = sha256(canonicalJson(different.functions.items));
      }
      const { evidence_sha256: previousDigest, ...unsigned } = different;
      different.evidence_sha256 = sha256(canonicalJson(unsigned));
      assert.notEqual(different.evidence_sha256, previousDigest);
      assert.throws(() => verifyProductionRecoverySnapshot({
        recovery: different, policy: recoveryPolicy, request: directRequest, manifest: directManifest,
        adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256, authorityContext: historical.authorityContext,
        requestedAt: RECOVERY_AT, recoveryAuthorization: { verifiedSource: historical.verifiedSource, currentGate },
      }), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' }, key);
    }
  });

  backupMode = 'stale';
  await assert.rejects(captureProductionSnapshot({ phase: 'recovery', policy: recoveryPolicy,
    request: directRequest, manifest: directManifest, token: 'synthetic-supabase-token',
    fetchImpl: recoveryFetch, observedAt: RECOVERY_AT, requestedAt: RECOVERY_AT,
    adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, sourceParity: recoveryParity,
    recoveryAuthorization: { verifiedSource: historical.verifiedSource, currentGate } }),
  { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  backupMode = 'fresh';

  assert.throws(() => createReleaseAuthorityContext({ ...contextArgs, requestedAt: RECOVERY_AT }),
    { code: 'RELEASE_AUTHORITY_CONTEXT_INVALID' });
  const adminRequest = makeRecoveryRequest('123456791', 'admin_recovery', directRequest.runId);
  const adminManifest = makeRecoveryManifest(adminRequest);
  const chained = b2ChainedCapture({ historical, policy: recoveryPolicy,
    currentEvidence: direct.authority_verification, chainRequest: directRequest,
    chainManifest: directManifest, recoveryRequest: adminRequest, recoveryManifest: adminManifest });
  const adminGate = { ...currentGate, run_id: adminRequest.runId, release_id: adminRequest.releaseId,
    manifest_sha256: sha256(canonicalJson(adminManifest)) };
  const admin = await captureProductionSnapshot({ phase: 'recovery', policy: recoveryPolicy,
    request: adminRequest, manifest: adminManifest, token: 'synthetic-supabase-token',
    fetchImpl: recoveryFetch, observedAt: RECOVERY_AT, requestedAt: RECOVERY_AT,
    adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, sourceParity: recoveryParity,
    recoveryAuthorization: { verifiedSource: chained, currentGate: adminGate } });
  const adminVerification = verifyProductionRecoverySnapshot({ recovery: admin, policy: recoveryPolicy,
    request: adminRequest, manifest: adminManifest, adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, requestedAt: RECOVERY_AT,
    recoveryAuthorization: { verifiedSource: chained, currentGate: adminGate } });
  assert.deepEqual(adminVerification.receipt, expectedReceipt);
  let adminPostcheck;
  assert.doesNotThrow(() => { adminPostcheck = verifyProductionAdminRecoverySnapshot({ post: admin, policy: recoveryPolicy,
    request: adminRequest, manifest: adminManifest, adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
    authorityContext: historical.authorityContext, requestedAt: RECOVERY_AT,
    recoveryAuthorization: { verifiedSource: chained, currentGate: adminGate } }); },
  'Admin verification accepts the authenticated recovery-stage snapshot');
  assert.deepEqual(adminPostcheck.receipt, expectedReceipt);
  for (const [phaseValue, stageValue] of [['pre', 'pre_snapshot'], ['post', 'post_snapshot'],
    ['recovery', 'post_snapshot'], ['post', 'recovery']]) {
    const wrong = structuredClone(admin);
    wrong.phase = phaseValue; wrong.authority_verification.stage = stageValue;
    const { evidence_sha256: ignored, ...unsigned } = wrong;
    wrong.evidence_sha256 = sha256(canonicalJson(unsigned));
    assert.throws(() => verifyProductionAdminRecoverySnapshot({ post: wrong, policy: recoveryPolicy,
      request: adminRequest, manifest: adminManifest, adapterSourceSha256: manifest.compiler.snapshot_adapter_sha256,
      authorityContext: historical.authorityContext, requestedAt: RECOVERY_AT,
      recoveryAuthorization: { verifiedSource: chained, currentGate: adminGate } }),
    { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }

  const ownerCapturePath = process.env.NELYON_QA_C3_BASELINE_CAPTURE;
  let optInRecoveryRoot = null;
  await t.test('tracked policy accepts a normalized QA-C3 capture plus only the verified B2 delta', {
    skip: !ownerCapturePath,
  }, async optInTest => {
    // Private evidence pins are supplied explicitly by the owner, never by this checkout.
    const ownerCapture = parsePinnedOwnerCapture(readFileSync(ownerCapturePath), {
      bytesSha256: process.env.NELYON_QA_C3_BASELINE_CAPTURE_SHA256,
      evidenceSha256: process.env.NELYON_QA_C3_BASELINE_EVIDENCE_SHA256,
    });
    assert.equal(ownerCapture.phase, 'post');
    assert.deepEqual(buildProductionBaselineDigests({ evidence: ownerCapture, policy: installedPolicy }), {
      migrations: 'fa6b5f36693a0edd7c4a0bef91701c2b58751589c7f748249ecdeb380e4509c6',
      managed_functions: '93eddb2a83d06900a78277827a5f00eec185bc75a06202653969b2a539fb2d6c',
      unmanaged_functions: '26f9c59179198817e55c7940177bf72cf7024f77b4b3c707d205ab7d5c3eaafc',
      function_source_parity: '031993a08f4e7178169e26468e746c13178cd752e30d1694e9904781cde8c9c4',
      config_verify_jwt: '703749fce46f724c7c4e791f7a222915b166af0ded38f00f34f983798355ba15',
      cron_security: '14e2f511010a0bd1dddb859223d730c24fc99ac3ca6fa5ddafd19184e55583ba',
      finance: 'f94d54264c5d7658dc04aba34b028c815e99d7eb8ccf2490410817d47566754f',
    }, 'the local capture reproduces every owner-reviewed baseline digest under the tracked policy bytes');

    const realContract = structuredClone(contract);
    realContract.baseline_sha = installedPolicy.baseline.sha;
    const realAuthority = structuredClone(authority);
    // The historical owner capture has no protected Vault/Edge parity observation.
    delete realAuthority.vaultEdgeParity;
    const b2InstalledB1State = structuredClone(ownerCapture.web_control_centers_b1_state);
    const predecessorConstraint = b2InstalledB1State.media_asset_links.entity_type_constraint;
    b2InstalledB1State.media_asset_links.entity_type_constraint = predecessorConstraint.replace(
      "'publication_draft'::text]))",
      "'publication_draft'::text, 'publication_schedule'::text]))",
    );
    assert.notEqual(b2InstalledB1State.media_asset_links.entity_type_constraint, predecessorConstraint,
      'the B2 delta adds only the reviewed publication_schedule media-link reservation');
    for (const name of ['media_asset_links_owner_read', 'media_asset_links_public_read']) {
      const row = b2InstalledB1State.media_asset_links.policies.find(item => item.name === name);
      assert.ok(row, `the QA-C3 baseline contains ${name}`);
      const predecessorQual = row.qual;
      row.qual = predecessorQual.replace(
        "'publication_draft'::text]))",
        "'publication_draft'::text, 'publication_schedule'::text]))",
      );
      assert.notEqual(row.qual, predecessorQual, `${name} receives the exact B2 private-reservation exclusion`);
      const identity = `public.media_asset_links.${name}`;
      const expectedCanonicalJson = canonicalJson({
        identity,
        relation: 'public.media_asset_links',
        command: row.command,
        roles: row.roles,
        using: row.qual.replace(/\r\n?|\n/g, ' '),
        check: row.with_check?.replace(/\r\n?|\n/g, ' ') ?? null,
      }).trimEnd();
      realAuthority.successorCatalog.records.push({ kind: 'policy', identity,
        expectedCanonicalJson, expectedSha256: sha256(expectedCanonicalJson) });
    }
    realAuthority.successorCatalog.records.sort((left, right) => {
      const leftKey = `${left.kind}\0${left.identity}`;
      const rightKey = `${right.kind}\0${right.identity}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    realAuthority.publicContractSha256 = sha256(canonicalJson(realContract));
    realAuthority.issuedFor.baselineSha = realContract.baseline_sha;
    realAuthority.securityAdvisor.baselineSha256 = ownerCapture.cron_security.advisors.sha256;
    realAuthority.backup.evidenceSha256 = sha256(canonicalJson(ownerCapture.backup));
    realAuthority.backup.insertedAt = ownerCapture.backup.inserted_at;
    realAuthority.backup.completedObservedAt = ownerCapture.observed_at;
    realAuthority.backup.expiresAt = new Date(Math.min(Date.parse(ownerCapture.backup.inserted_at) + 86_400_000,
      Date.parse(ownerCapture.observed_at) + 300_000)).toISOString();
    realAuthority.approval.approvedAt = ownerCapture.observed_at;
    realAuthority.approval.expiresAt = new Date(Date.parse(ownerCapture.observed_at) + 300_000).toISOString();
    // Synthetic protected steps occur after the authentic baseline observation,
    // rather than backdating approval to precede that observation.
    const sourceProofAt = new Date(Date.parse(ownerCapture.observed_at) + 1_000).toISOString();
    const recoveryOperationAt = new Date(Date.parse(ownerCapture.observed_at) + 2_000).toISOString();
    const realAuthorityJson = JSON.stringify(realAuthority);
    const realAuthorityBytes = Buffer.from(realAuthorityJson, 'utf8');
    const realDescriptor = structuredClone(descriptor);
    realDescriptor.contract = realContract;
    realDescriptor.public_contract_sha256 = realAuthority.publicContractSha256;
    realDescriptor.private_authority.sha256 = sha256(realAuthorityBytes);
    const realDescriptorBytes = Buffer.from(JSON.stringify(realDescriptor), 'utf8');
    const realContextArgs = {
      descriptorBytes: realDescriptorBytes,
      expectedDescriptorSha256: sha256(realDescriptorBytes),
      phase: realContract.to_phase,
      transitionId: realContract.id,
      baselineSha: realContract.baseline_sha,
      reviewedSourceSha: realContract.reviewed_source_sha,
      integrationBaseSha: realContract.integration_base_sha,
      requestedAt: ownerCapture.observed_at,
      authorityJson: realAuthorityJson,
      expectedPrivateAuthoritySha256: sha256(realAuthorityBytes),
    };
    const realAuthorityContext = createReleaseAuthorityContext(realContextArgs);
    const realReceipt = publicAuthorityReceipt(realAuthorityContext);
    const realSourceManifest = structuredClone(manifest);
    realSourceManifest.generated_at = ownerCapture.observed_at;
    realSourceManifest.baseline = { state: installedPolicy.baseline.state,
      sha: installedPolicy.baseline.sha, origin_main_sha: releaseRequest.approvedSha };
    realSourceManifest.resources.web_control_centers_b2_transition = {
      contract: realContract,
      descriptorSha256: sha256(realDescriptorBytes),
      publicContractSha256: realAuthority.publicContractSha256,
      expectedPrivateAuthoritySha256: sha256(realAuthorityBytes),
      privateAuthorityRequired: true,
    };
    const realHistorical = await b2HistoricalCapture({ manifest: realSourceManifest,
      request: releaseRequest, contextArgs: realContextArgs, policy: installedPolicy,
      at: ownerCapture.observed_at, proofAt: sourceProofAt, admin: true,
      deployedFunctionRows: admin.functions.items });
    assert.deepEqual(realHistorical.authorityContext.receipt, realAuthorityContext.receipt,
      'the exact source resolves the same private authority receipt');

    const realAdminRequest = { ...adminRequest,
      scopeConfirmation: installedPolicy.scope_confirmations.admin_recovery,
      recoverySourceRunId: realHistorical.request.runId };
    const realAdminManifest = structuredClone(adminManifest);
    realAdminManifest.recovery = { ...realAdminManifest.recovery,
      source_run_id: realHistorical.request.runId, authorityReceipt: realReceipt };
    const realCurrentGate = { ...adminGate,
      manifest_sha256: sha256(canonicalJson(realAdminManifest)),
      authorityReceipt: realReceipt,
      environment: installedPolicy.environment };

    const b2Migration = admin.migrations.items.find(item => (
      `${item.version}_${item.name}` === '20261108061946_web_control_centers_b2_scheduled_publishing'
    ));
    assert.ok(b2Migration, 'the verified B2 capture contains the exact migration append');
    const b2FunctionNames = new Set(realContract.functions.map(item => item.name));
    const b2Functions = new Map(admin.functions.items.map(item => [item.slug, item]));
    for (const name of b2FunctionNames) {
      assert.ok(b2Functions.has(name), `the verified B2 capture contains function ${name}`);
    }
    const functionItems = ownerCapture.functions.items.map(item => (
      b2FunctionNames.has(item.slug) ? structuredClone(b2Functions.get(item.slug)) : structuredClone(item)
    ));
    for (const name of b2FunctionNames) {
      if (!functionItems.some(item => item.slug === name)) functionItems.push(structuredClone(b2Functions.get(name)));
    }
    functionItems.sort((left, right) => left.slug.localeCompare(right.slug));

    const replacedRpcNames = new Set(['update_my_publication_draft_v1', 'delete_my_publication_draft_v1',
      'publish_my_publication_draft_v1', 'create_photo_post_with_media', 'create_carousel_post']);
    const rpcItems = ownerCapture.rpc_security.items.map(item => {
      const successor = structuredClone(item);
      if (!replacedRpcNames.has(item.name)) return successor;
      const identity = `${item.schema}.${item.name}(${item.argument_types.join(',').replaceAll(' ', '')})`;
      const record = realAuthority.successorCatalog.records.find(candidate => (
        candidate.kind === 'function' && candidate.identity === identity
      ));
      assert.ok(record, `the private B2 authority contains successor RPC ${identity}`);
      successor.definition_sha256 = JSON.parse(record.expectedCanonicalJson).definitionSha256;
      return successor;
    }).sort((left, right) => rpcIdentity(left).localeCompare(rpcIdentity(right)));
    const b2Queries = admin.adapter.queries.filter(item => item.id.startsWith('nelyon-b2-'));
    assert.equal(b2Queries.length, 3, 'the delta contributes only the fixed B2 read-only queries');
    assert.deepEqual(b2Queries.map(item => item.id), [
      'nelyon-b2-catalog-v1', 'nelyon-b2-rpc-security-v1', 'nelyon-b2-relation-acl-v1',
    ]);
    const currentQueriesById = new Map(admin.adapter.queries.map(item => [item.id, item]));
    const normalizedQueries = ownerCapture.adapter.queries.map(item => (
      structuredClone(currentQueriesById.get(item.id) ?? item)
    ));
    normalizedQueries.push(...b2Queries.map(item => structuredClone(item)));
    const recoveryEvidence = structuredClone(ownerCapture);
    recoveryEvidence.phase = 'recovery';
    recoveryEvidence.identity = {
      approved_sha: realAdminRequest.approvedSha,
      release_id: realAdminRequest.releaseId,
      run_id: String(realAdminRequest.runId),
      run_attempt: realAdminRequest.runAttempt,
      manifest_sha256: sha256(canonicalJson(realAdminManifest)),
    };
    const migrationItems = [...ownerCapture.migrations.items.map(item => structuredClone(item)),
      structuredClone(b2Migration)];
    recoveryEvidence.migrations = { complete: true, count: migrationItems.length,
      items: migrationItems, latest: structuredClone(b2Migration),
      sha256: sha256(canonicalJson(migrationItems)) };
    recoveryEvidence.functions = { complete: true, count: functionItems.length, items: functionItems,
      sha256: sha256(canonicalJson(functionItems)) };
    recoveryEvidence.rpc_security = { complete: true, count: rpcItems.length, items: rpcItems,
      sha256: sha256(canonicalJson(rpcItems)) };
    recoveryEvidence.adapter = { source_sha256: realAdminManifest.compiler.snapshot_adapter_sha256,
      queries: normalizedQueries };
    recoveryEvidence.requests = [...ownerCapture.requests.map(item => structuredClone(item)),
      ...admin.requests.slice(-4).map(item => structuredClone(item))];
    recoveryEvidence.web_control_centers_b1_state = b2InstalledB1State;
    recoveryEvidence.authority_verification = { schemaVersion: 1, stage: 'recovery', result: 'VERIFIED',
      receipt: realReceipt, checks: { catalog: true, securityAdvisor: true, backup: true, finance: true,
        manifest: true, functionInventory: true, sourceParity: true } };
    {
      const { evidence_sha256: ignoredEvidenceSha256, ...unsigned } = recoveryEvidence;
      recoveryEvidence.evidence_sha256 = sha256(canonicalJson(unsigned));
    }

    const installedPolicyHash = sha256(installedPolicyBytes);
    const authorizationBytes = Buffer.from(canonicalJson({ schema_version: 1,
      kind: 'nelyon-b2-exact-attempt-recovery-v1', repository: installedPolicy.repository,
      workflow_path: installedPolicy.workflow_path, policy_sha256: installedPolicyHash,
      approved_sources: [{ source: realHistorical.source,
        admin_artifact: realHistorical.adminArtifact, postcheck_chain: null }] }));
    const recoveryRoot = mkdtempSync(join(tmpdir(), 'nelyon-b2-real-policy-admin-'));
    optInRecoveryRoot = recoveryRoot;
    optInTest.after(() => removeOwnedRealPolicyAdminTempDirectory(recoveryRoot));
    const recoveryEnvironment = { ...environment,
      RUNNER_TEMP: recoveryRoot,
      NELYON_RELEASE_POLICY_SHA256: installedPolicyHash,
      NELYON_B2_RECOVERY_AUTHORIZATION_SHA256: sha256(authorizationBytes),
      NELYON_ADMIN_RECOVERY_B2_REQUIRED: 'true',
    };
    const recoveryFetchImpl = async (input, options) => {
      const request = input instanceof Request ? input : null;
      const parsed = new URL(request?.url ?? String(input));
      if (request && parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
        return r2Response(parsed.pathname.endsWith(`${sha256(authorizationBytes)}.json`)
          ? authorizationBytes : realAuthorityBytes, request);
      }
      if (parsed.hostname === 'api.github.com') return realHistorical.fetchImpl(input, options);
      if (parsed.hostname === 'api.supabase.com' && parsed.pathname.endsWith('/functions')) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected opt-in transport ${parsed.hostname}${parsed.pathname}`);
    };
    const recoveryBootstrap = await bootstrapPrivateAuthorityRuntime({ environment: recoveryEnvironment,
      manifestClosure: runtimeClosure, repositoryRoot: ROOT, readFile: readFileSync, nodeVersion: '24.21.0' });
    const loadedRecovery = await loadProtectedB2RecoveryRuntime({ bootstrapCapability: recoveryBootstrap,
      environment: recoveryEnvironment, policyBytes: installedPolicyBytes,
      runId: realHistorical.request.runId, runAttempt: realHistorical.request.runAttempt,
      releaseBundle: { directory: realHistorical.paths.release },
      gateEvidence: { directory: realHistorical.paths.gate }, fetchImpl: recoveryFetchImpl });
    const recoveryPaths = { policy: join(recoveryRoot, 'policy.json'), request: join(recoveryRoot, 'request.json'),
      bundle: join(recoveryRoot, 'bundle'), run: join(recoveryRoot, 'run.json'),
      artifacts: join(recoveryRoot, 'artifacts.json') };
    mkdirSync(recoveryPaths.bundle);
    const realRequestBytes = Buffer.from(canonicalJson(realAdminRequest));
    const realManifestBytes = Buffer.from(canonicalJson(realAdminManifest));
    writeFileSync(recoveryPaths.policy, installedPolicyBytes);
    writeFileSync(recoveryPaths.request, realRequestBytes);
    writeFileSync(join(recoveryPaths.bundle, 'manifest.json'), realManifestBytes);
    writeFileSync(join(recoveryPaths.bundle, 'manifest.sha256'), `${sha256(realManifestBytes)}\n`);
    writeFileSync(recoveryPaths.run, canonicalJson(realHistorical.run));
    writeFileSync(recoveryPaths.artifacts, canonicalJson([
      { ...realHistorical.source.release_artifact, expired: false },
      { ...realHistorical.source.gate_artifact, expired: false },
      { ...realHistorical.adminArtifact, expired: false },
    ]));
    const realPublicInputs = publicInputs(installedPolicyBytes, realRequestBytes,
      realAdminManifest, realDescriptorBytes);
    const recoveryHost = privateCli.createPrivateAuthorityProductionHost({ publicInputs: realPublicInputs,
      environment: recoveryEnvironment, fetchImpl: recoveryFetchImpl, repositoryRoot: approvedRoot,
      recoveryRuntime: loadedRecovery });
    const recoveryController = createPrivateAuthorityRuntime({ bootstrapCapability: recoveryBootstrap,
      environment: recoveryEnvironment, fetchImpl: recoveryFetchImpl, now: () => recoveryOperationAt,
      host: recoveryHost, recoveryRuntime: loadedRecovery });
    const verifiedSourcePath = join(recoveryRoot, 'verified-source.json');
    await recoveryController.execute({ action: 'verify-admin-recovery-source', inputs: {
      policy: recoveryPaths.policy, request: recoveryPaths.request, bundle: recoveryPaths.bundle,
      recoverySourceRun: realHistorical.request.runId, run: recoveryPaths.run,
      artifacts: recoveryPaths.artifacts, releaseBundle: realHistorical.paths.release,
      gateEvidence: realHistorical.paths.gate, adminEvidence: realHistorical.paths.admin,
      stageOutput: verifiedSourcePath,
    }, verificationOutput: join(recoveryRoot, 'verified-source-receipt.json') });
    const verifiedRealSource = JSON.parse(readFileSync(verifiedSourcePath, 'utf8'));
    const currentSnapshotPath = join(recoveryRoot, 'current-recovery.json');
    const currentGatePath = join(recoveryRoot, 'current-gate.json');
    const currentAdminManifestPath = join(recoveryRoot, 'admin-web-manifest.json');
    const currentBuildPath = join(recoveryRoot, 'admin-web-build.json');
    const currentAdminManifest = JSON.parse(readFileSync(join(realHistorical.paths.admin, 'admin-web-manifest.json'), 'utf8'));
    currentAdminManifest.release = { ...currentAdminManifest.release, mode: 'admin_recovery',
      approved_sha: realAdminRequest.approvedSha, recovery_source_run_id: realHistorical.request.runId };
    const currentBuild = { approved_sha: realAdminRequest.approvedSha,
      source_manifest_sha256: sha256(canonicalJson(currentAdminManifest).trimEnd()),
      dist_sha256: verifiedRealSource.source_build_sha256 ?? 'd'.repeat(64) };
    writeFileSync(currentSnapshotPath, canonicalJson(recoveryEvidence));
    writeFileSync(currentGatePath, canonicalJson(realCurrentGate));
    writeFileSync(currentAdminManifestPath, canonicalJson(currentAdminManifest));
    writeFileSync(currentBuildPath, canonicalJson(currentBuild));
    assert.doesNotThrow(() => verifyB2RecoveryOperation({ recoveryRequest: realAdminRequest,
      recoveryManifest: realAdminManifest, verifiedSource: realHistorical.verifiedSource,
      authorityContext: realHistorical.authorityContext, currentGate: realCurrentGate,
      backup: recoveryEvidence.backup, policy: installedPolicy, requestedAt: recoveryOperationAt }),
    'the real-policy recovery chain independently authenticates before the protected controller');
    const bindingSource = structuredClone(verifiedRealSource);
    delete bindingSource.authorityReceipt;
    assert.doesNotThrow(() => verifyAdminRecoveryBuildBinding({ recoveryRequest: realAdminRequest,
      recoveryManifest: realAdminManifest, verifiedSource: bindingSource,
      currentAdminManifest, currentBuild, authorityContext: null }),
    'the Admin build binding independently matches the authenticated source');
    assert.doesNotThrow(() => validateB2InstalledB1State(recoveryEvidence.web_control_centers_b1_state,
      installedPolicy.web_control_centers_b1_transition, realHistorical.authorityContext, 'recovery'),
    'the normalized QA-C3 B1 state contains only the reviewed B2 successor delta');
    assert.doesNotThrow(() => validatePremiumPostcheckState(recoveryEvidence.premium_state),
      'the owner-captured Premium state remains exact');
    const recoveryExceptions = advisorExceptionsForPhase(installedPolicy, realAdminManifest, 'recovery', {
      request: realAdminRequest, migrations: recoveryEvidence.migrations,
    });
    assert.doesNotThrow(() => validateB2RpcSecurityAttestations(recoveryEvidence.rpc_security,
      recoveryExceptions, realHistorical.authorityContext, 'recovery'),
    'the normalized RPC catalog applies only the privately authorized B2 successor definitions');
    assert.doesNotThrow(() => verifyProductionRecoverySnapshot({ recovery: recoveryEvidence,
      policy: installedPolicy, request: realAdminRequest, manifest: realAdminManifest,
      adapterSourceSha256: realAdminManifest.compiler.snapshot_adapter_sha256,
      authorityContext: realHistorical.authorityContext, requestedAt: recoveryOperationAt,
      recoveryAuthorization: { verifiedSource: realHistorical.verifiedSource, currentGate: realCurrentGate } }),
    'the normalized real-policy recovery snapshot independently satisfies every B2 validator');
    assert.doesNotThrow(() => verifyProductionAdminRecoverySnapshot({ post: recoveryEvidence,
      policy: installedPolicy, request: realAdminRequest, manifest: realAdminManifest,
      adapterSourceSha256: realAdminManifest.compiler.snapshot_adapter_sha256,
      authorityContext: realHistorical.authorityContext, requestedAt: recoveryOperationAt,
      recoveryAuthorization: { verifiedSource: realHistorical.verifiedSource, currentGate: realCurrentGate } }),
    'the normalized real-policy snapshot independently satisfies the governed postcheck');
    const postcheckPath = join(recoveryRoot, 'postcheck-result.json');
    const postcheckReceiptPath = join(recoveryRoot, 'postcheck-receipt.json');
    await assert.doesNotReject(recoveryController.execute({ action: 'postcheck-admin-recovery', inputs: {
      policy: recoveryPaths.policy, request: recoveryPaths.request, bundle: recoveryPaths.bundle,
      recoverySourceRun: realHistorical.request.runId, run: recoveryPaths.run,
      artifacts: recoveryPaths.artifacts, releaseBundle: realHistorical.paths.release,
      gateEvidence: realHistorical.paths.gate, adminEvidence: realHistorical.paths.admin,
      verifiedSource: verifiedSourcePath, currentGate: currentGatePath,
      currentSnapshot: currentSnapshotPath, adminManifest: currentAdminManifestPath,
      build: currentBuildPath, stageOutput: postcheckPath,
    }, verificationOutput: postcheckReceiptPath }),
    'the actual protected Admin controller accepts the real QA-C3 facts plus the verified B2 delta');
    assert.deepEqual(JSON.parse(readFileSync(postcheckPath)), {
      schemaVersion: 1, stage: 'recovery', result: 'VERIFIED', receipt: realReceipt,
      checks: { catalog: true, securityAdvisor: true, backup: true, finance: true,
        manifest: true, functionInventory: true, sourceParity: true },
    });
    assert.deepEqual(JSON.parse(readFileSync(postcheckReceiptPath)), realReceipt);
    assert.equal(sha256(readFileSync(join(ROOT, '.github', 'nelyon-production-release-policy.json'))),
      installedPolicyHash, 'the tracked policy remains byte-exact');
  });
  if (optInRecoveryRoot !== null) {
    assert.equal(existsSync(optInRecoveryRoot), false,
      'the opt-in recovery workspace is removed after verification');
  }

  const allPublic = [authorityResult, pre, post, postcheck, direct, directPostcheck, admin, adminVerification,
    ...['authority-proof', 'pre-snapshot', 'post-snapshot'].map(action => (
      JSON.parse(readFileSync(join(root, `${action}-runtime-verification.json`)))
    ))];
  const serialized = JSON.stringify(allPublic);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(privateMarker), false);
  assert.equal(serialized.includes('expectedCanonicalJson'), false);
  assert.equal(recoveryCalls.some(call => JSON.stringify(call).includes(SECRET)), false);
  assert.ok(calls.some(call => call.method === 'HEAD'));
  assert.ok(calls.some(call => call.method === 'GET'));
});
