import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import * as adapter from '../scripts/nelyon-production-snapshot-adapter.mjs';
import * as release from '../scripts/nelyon-production-release.mjs';
import { createReleaseAuthorityContext } from '../scripts/nelyon-release-authority-context.mjs';
import { b2DatabaseFunctionMatrix, b2SyntheticRelationAclRecords } from './fixtures/nelyonB2DatabaseFunctionMatrix.mjs';
import { b2AdminHistoricalFixture, b2ChainedCapture } from './fixtures/nelyonB2HistoricalCapture.mjs';

const AT = '2026-11-08T12:00:00.000Z';
const MARKER = 'SYNTHETIC_B2_PRIVATE_MARKER';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => release.canonicalJson(value).trimEnd();
function fixture({ backupInsertedAt = '2026-11-08T10:00:00.000Z' } = {}) {
  const contract = { id: 'synthetic-b2', to_phase: 'web-control-centers-b2', baseline_sha: 'a'.repeat(40),
    reviewed_source_sha: 'b'.repeat(40), integration_base_sha: 'c'.repeat(40), function_inventory: { before: 1, after: 2 } };
  const records = [
    ['function_acl', { identity: MARKER, acl: [{ grantee: MARKER, privilege_type: 'EXECUTE', is_grantable: false }], execute: { public: false, anon: false, authenticated: false, service_role: false } }],
    ['relation_acl', { identity: MARKER, acl: [{ grantee: MARKER, privilege_type: 'SELECT', is_grantable: false }], access: { public: false, anon: false, authenticated: false, service_role: false } }],
    ['relation', { identity: MARKER, rls: true, forceRls: true, owner: MARKER, definitionSha256: '1'.repeat(64) }],
    ['function', { identity: MARKER, execute: false, owner: MARKER, securityDefiner: true, searchPath: [], definitionSha256: '2'.repeat(64) }],
    ['policy', { identity: MARKER, relation: MARKER, command: 'SELECT', roles: ['authenticated'], using: 'true', check: null }],
    ['trigger', { identity: MARKER, relation: MARKER, functionIdentity: MARKER, enabled: 'O', definitionSha256: '3'.repeat(64) }],
    ['index', { identity: MARKER, relation: MARKER, valid: true, ready: true, unique: false, definitionSha256: '4'.repeat(64) }],
    ['cron_job', { identity: MARKER, schedule: '* * * * *', commandSha256: '5'.repeat(64), database: MARKER, username: MARKER, active: true }],
    ['function_inventory', { identity: MARKER, verifyJwt: true, sourceSha256: '6'.repeat(64), configSha256: '7'.repeat(64) }],
  ].map(([kind, value]) => ({ kind, identity: value.identity, expectedCanonicalJson: canonical(value), expectedSha256: hash(canonical(value)) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const advisor = { fingerprint: '8'.repeat(64), identity: `advisor:${'8'.repeat(64)}`, type: 'security', severity: 'WARN', objectIdentity: 'function:public.synthetic_rpc', objectSha256: '9'.repeat(64),
    attestationSha256: 'a'.repeat(64), negativeEvidenceSha256: 'b'.repeat(64), originSha256: 'c'.repeat(64) };
  const authority = { schemaVersion: 1, authorityId: 'synthetic-b2-authority', publicContractSha256: hash(release.canonicalJson(contract)),
    phase: contract.to_phase, issuedFor: { baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha, integrationBaseSha: contract.integration_base_sha },
    successorCatalog: { schemaVersion: 1, records }, securityAdvisor: { schemaVersion: 2, baselineSha256: hash(canonical([{ fingerprint: advisor.fingerprint, level: advisor.severity, resource_kind: advisor.type }]) + '\n'), baselineItems: [{ fingerprint: advisor.fingerprint, level: advisor.severity, resource_kind: advisor.type }],
      records: [{ action: 'replace', identity: advisor.identity, expectedCanonicalJson: canonical(advisor), expectedSha256: hash(canonical(advisor)) }] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: hash('aewwdlvbwpczqyvkwvvj'),
      evidenceSha256: hash(release.canonicalJson({ id: MARKER, inserted_at: '2026-11-08T10:00:00.000Z', is_physical_backup: true, status: 'COMPLETED' })),
      status: 'COMPLETED', insertedAt: backupInsertedAt, completedObservedAt: '2026-11-08T10:30:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: [contract.to_phase], authorizationSha256: 'f'.repeat(64),
      approvedAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-09T11:00:00.000Z' } };
  const authorityJson = JSON.stringify(authority);
  const descriptor = { schema_version: 1, contract, public_contract_sha256: authority.publicContractSha256,
    private_authority: { required: true, schema_version: 1, authority_id: authority.authorityId, sha256: hash(authorityJson) } };
  const descriptorBytes = JSON.stringify(descriptor);
  const options = { descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes), phase: contract.to_phase,
    transitionId: contract.id, baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
    integrationBaseSha: contract.integration_base_sha, requestedAt: AT, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) };
  const context = createReleaseAuthorityContext(options);
  const manifest = { identity: { approved_sha: contract.reviewed_source_sha, run_id: '123', run_attempt: 1, release_id: 'nelyon-20261108-001' },
    baseline: { sha: contract.baseline_sha }, compiler: { snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs', snapshot_adapter_sha256: '6'.repeat(64) },
    resources: { web_control_centers_b2_transition: { contract, descriptorSha256: context.descriptorSha256,
      publicContractSha256: context.publicContractSha256, expectedPrivateAuthoritySha256: context.privateAuthoritySha256, privateAuthorityRequired: true } } };
  const request = { approvedSha: manifest.identity.approved_sha, runId: '123', runAttempt: 1, releaseId: manifest.identity.release_id };
  const catalog = records.map(r => ({ kind: r.kind, value: JSON.parse(r.expectedCanonicalJson) }));
  return { options, context, manifest, request, catalog, advisor, authority };
}
const rejected = fn => assert.throws(fn, error => {
  assert.equal(error.code, 'B2_SNAPSHOT_AUTHORITY_INVALID');
  assert.equal(error.stack, 'Error: B2 snapshot authority rejected');
  assert.doesNotMatch(`${error}${error.stack}${JSON.stringify(error)}`, new RegExp(MARKER)); return true;
});

test('B2 snapshot rejects missing, copied, or manifest-mismatched contexts before first fetch', async () => {
  const f = fixture();
  for (const context of [undefined, {}, structuredClone(f.context), new Proxy(f.context, {})]) {
    let calls = 0;
    await assert.rejects(adapter.captureProductionSnapshot({ phase: 'pre', policy: { supabase: { project_ref: 'aewwdlvbwpczqyvkwvvj' } },
      request: f.request, manifest: f.manifest, authorityContext: context, token: 'synthetic', observedAt: AT,
      adapterSourceSha256: '6'.repeat(64), fetchImpl: async () => { calls++; throw new Error(MARKER); } }), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
    assert.equal(calls, 0);
  }
  for (const mutate of [a => a.sourceParity.functions.push({ identity: 'wrong', deployedSha256: '0'.repeat(64), sourceSha256: '0'.repeat(64), configSha256: '0'.repeat(64), verifyJwt: true }),
    a => a.sourceParity.advisors[0].originSha256 = '0'.repeat(64),
    a => a.manifest.resources.web_control_centers_b2_transition.descriptorSha256 = '0'.repeat(64)]) {
    let calls = 0;
    const a = { phase: 'post', policy: { supabase: { project_ref: 'aewwdlvbwpczqyvkwvvj' } },
      request: f.request, manifest: structuredClone(f.manifest), authorityContext: f.context, token: 'synthetic', observedAt: AT, requestedAt: AT,
      sourceParity: { capturedAt: AT, descriptorSha256: f.context.descriptorSha256, approvedSha: f.request.approvedSha,
        manifestSha256: hash(release.canonicalJson(f.manifest)), functions: [], advisors: [{ action: 'replace', objectIdentity: f.advisor.objectIdentity, fingerprint: f.advisor.fingerprint,
          attestationSha256: f.advisor.attestationSha256, negativeEvidenceSha256: f.advisor.negativeEvidenceSha256, originSha256: f.advisor.originSha256 }] },
      adapterSourceSha256: '6'.repeat(64), fetchImpl: async () => { calls++; throw new Error(MARKER); } };
    mutate(a); await assert.rejects(adapter.captureProductionSnapshot(a), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' }); assert.equal(calls, 0);
  }
});

test('B2 exact v1 projection compares all catalog kinds and emits only the closed verification', () => {
  assert.equal(typeof adapter.verifyB2PrivateObservations, 'function');
  const f = fixture();
  const args = { authorityContext: f.context, manifest: f.manifest, stage: 'post_snapshot', requestedAt: AT,
    catalog: f.catalog, advisors: [f.advisor], backupEvidenceSha256: f.authority.backup.evidenceSha256,
    financeVerified: true, sourceParityVerified: true };
  const result = adapter.verifyB2PrivateObservations(args);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'stage', 'result', 'receipt', 'checks']);
  assert.deepEqual(result.checks, { catalog: true, securityAdvisor: true, backup: true, finance: true, manifest: true, functionInventory: true, sourceParity: true });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${MARKER}|expectedCanonicalJson|completedAt|insertedAt|completedObservedAt`));
  for (const mutate of [a => a.catalog.pop(), a => a.catalog.push(a.catalog[0]), a => a.catalog[0].value.identity = 'wrong',
    a => a.catalog[0].value.extra = MARKER, a => a.advisors[0].negativeEvidenceSha256 = '0'.repeat(64),
    a => a.backupEvidenceSha256 = '0'.repeat(64), a => a.sourceParityVerified = false, a => a.financeVerified = false,
    a => a.requestedAt = '2026-11-10T12:00:00.000Z']) {
    const a = { ...args, catalog: structuredClone(f.catalog), advisors: [structuredClone(f.advisor)] }; mutate(a); rejected(() => adapter.verifyB2PrivateObservations(a));
  }
  for (let index = 0; index < f.catalog.length; index++) {
    const a = { ...args, catalog: structuredClone(f.catalog) }; a.catalog[index].value.identity = 'different';
    rejected(() => adapter.verifyB2PrivateObservations(a));
  }
});

test('B2 stage verification rejects deserialized, cross-stage and replaced receipts', () => {
  const f = fixture();
  for (const verify of [adapter.verifyProductionPreSnapshot, adapter.verifyProductionSnapshotPair, adapter.verifyProductionRecoverySnapshot]) {
    rejected(() => verify({ pre: {}, post: {}, recovery: {}, manifest: f.manifest, request: f.request, authorityContext: f.context }));
  }
});

function sourceFixture() {
  const f = fixture();
  f.manifest.identity.mode = 'release'; f.manifest.resources.migrations = []; f.manifest.resources.functions = [];
  const dir = mkdtempSync(join(tmpdir(), 'b2-source-'));
  const releaseDir = join(dir, 'release'); const gateDir = join(dir, 'gate');
  mkdirSync(join(releaseDir, 'bundle'), { recursive: true }); mkdirSync(gateDir);
  const manifestDigest = hash(release.canonicalJson(f.manifest));
  const proof = stage => ({ runId: '123', runAttempt: 1, releaseId: f.request.releaseId,
    approvedSha: f.request.approvedSha, manifestSha256: manifestDigest, stage, verifiedAt: AT, receipt: f.context.receipt });
  const proofs = ['migrations', 'functions'].map(proof);
  const proofBytes = release.canonicalJson(proofs);
  const source = { repository: 'synthetic/repo', run_id: '123', run_attempt: 1, source_sha: f.request.approvedSha,
    release_id: f.request.releaseId, manifest_sha256: manifestDigest, expected_migrations: [], edge_functions: [],
    gate_artifact: { id: '11', name: 'gate', digest: `sha256:${'1'.repeat(64)}` },
    release_artifact: { id: '12', name: 'release', digest: `sha256:${'2'.repeat(64)}` },
    protected_stage_proof_sha256: hash(proofBytes), post_snapshot_status: 'success', postcheck_status: 'failure',
    pre_snapshot_evidence_sha256: '3'.repeat(64), post_snapshot_evidence_sha256: '4'.repeat(64) };
  const observation = { schema_version: 1, result: 'INCOMPLETE_OR_FAILED', steps: { pre_snapshot: 'success', pre_verification: 'success',
    migration_dry_run: 'success', migrations: 'success', functions: 'success', post_snapshot: 'success', postcheck: 'failure' },
    pre_evidence_sha256: source.pre_snapshot_evidence_sha256, post_evidence_sha256: source.post_snapshot_evidence_sha256 };
  const json = (path, value) => writeFileSync(path, release.canonicalJson(value));
  json(join(releaseDir, 'bundle', 'manifest.json'), f.manifest);
  writeFileSync(join(releaseDir, 'bundle', 'manifest.sha256'), manifestDigest);
  writeFileSync(join(releaseDir, 'bundle', 'summary.md'), 'synthetic');
  json(join(releaseDir, 'request.json'), { ...f.request, repository: source.repository, mainSha: f.request.approvedSha, mode: 'release' });
  json(join(releaseDir, 'remote-evidence.json'), {}); json(join(gateDir, 'release-observation.json'), observation);
  writeFileSync(join(gateDir, 'protected-stage-proofs.json'), proofBytes);
  const run = { id: '123', run_attempt: 1, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch',
    head_sha: f.request.approvedSha, path: '.github/workflows/nelyon-production-release.yml', repository: { full_name: source.repository } };
  const protectedSteps = { runId: '123', runAttempt: 1, repository: source.repository, workflow: run.path, approvedSha: run.head_sha,
    steps: ['migrations', 'functions'].map(stage => ({ name: `B2 protected ${stage}`, conclusion: 'success',
      startedAt: '2026-11-08T11:59:59.000Z', completedAt: '2026-11-08T12:00:01.000Z' })) };
  return { ...f, dir, gateDir, proofs, source, protectedSteps, args: { source, run, artifacts: [source.gate_artifact, source.release_artifact],
    releaseBundle: { directory: releaseDir }, gateEvidence: { directory: gateDir }, protectedSteps } };
}

test('B2 historical recovery obtains original digest only after exact source proof provenance', async () => {
  const f = await b2AdminHistoricalFixture();
  const source = f.historical.verifiedSource;
  assert.equal(typeof release.resolveB2HistoricalAuthority, 'function');
  const requested = [];
  const provider = { getBySha256: async digest => { requested.push(digest); return Buffer.from(f.contextArgs.authorityJson); } };
  const context = await release.resolveB2HistoricalAuthority({ verifiedSource: source,
    descriptorBytes: f.contextArgs.descriptorBytes, provider,
    historicalRuntimeClosure: f.historical.historicalRuntimeClosure });
  assert.deepEqual(context.receipt, f.authorityContext.receipt);
  assert.deepEqual(requested, [f.authorityContext.privateAuthoritySha256]);
  assert.throws(() => createReleaseAuthorityContext({ ...f.contextArgs, requestedAt: '2026-11-10T12:00:00.000Z' }));
  for (const fake of [{}, structuredClone(source)]) {
    requested.length = 0;
    await assert.rejects(release.resolveB2HistoricalAuthority({ verifiedSource: fake,
      descriptorBytes: f.contextArgs.descriptorBytes, provider,
      historicalRuntimeClosure: f.historical.historicalRuntimeClosure }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
    assert.equal(requested.length, 0);
  }
  assert.doesNotMatch(JSON.stringify(source), new RegExp(MARKER));
});

test('B2 source rejects missing ambiguous proof and candidate or generic run timestamps', () => {
  for (const change of [a => delete a.protectedSteps, a => a.protectedSteps.steps.push(a.protectedSteps.steps[0]),
    a => a.protectedSteps.runAttempt++, a => a.protectedSteps.repository = 'other/repo',
    a => { a.protectedSteps.steps = []; a.run.run_started_at = AT; },
    a => a.source.protected_stage_proof_sha256 = '0'.repeat(64)]) {
    const f = sourceFixture(); change(f.args);
    assert.throws(() => release.verifyRecoveryArtifactProvenance(f.args), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
});

test('B2 historical source rejects a mutation interval extending past private expiry', async () => {
  const f = await b2AdminHistoricalFixture({ proofAt: '2026-11-10T12:00:00.000Z', allowUnresolvedAuthority: true });
  await assert.rejects(release.resolveB2HistoricalAuthority({ verifiedSource: f.historical.verifiedSource,
    descriptorBytes: f.contextArgs.descriptorBytes,
    provider: { getBySha256: async () => Buffer.from(f.contextArgs.authorityJson) },
    historicalRuntimeClosure: f.historical.historicalRuntimeClosure }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
});

test('B2 source proof preserves additional successful protected Admin boundaries', async () => {
  const f = await b2AdminHistoricalFixture({ adminStages: ['admin_upload'] });
  assert.deepEqual(f.historical.authorityContext.receipt, f.authorityContext.receipt);
});

test('B2 source proof requires exactly the successful Admin boundary prefix and no extra protected steps', async () => {
  const adminStages = ['admin_upload', 'admin_promote', 'admin_route'];
  for (let count = 0; count <= 3; count++) {
    const prefix = adminStages.slice(0, count);
    assert.ok((await b2AdminHistoricalFixture({ adminStages: prefix })).historical.verifiedSource.authorityReceipt);
    if (count) {
      await assert.rejects(b2AdminHistoricalFixture({ adminStages: prefix.slice(0, -1), observedAdminStages: prefix }));
    }
    if (count < 3) {
      await assert.rejects(b2AdminHistoricalFixture({ adminStages: adminStages.slice(0, count + 1), observedAdminStages: prefix }));
    }
  }
});

function operationFixture(f, at = AT) {
  const request = { ...f.request, runId: '456', releaseId: 'nelyon-20261110-001', mode: 'admin_recovery', recoverySourceRunId: '123' };
  const manifest = { identity: { approved_sha: request.approvedSha, run_id: request.runId, run_attempt: request.runAttempt, release_id: request.releaseId },
    resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] } };
  const currentGate = { result: 'GATE_VERIFIED', run_id: request.runId, run_attempt: request.runAttempt,
    release_id: request.releaseId, approved_sha: request.approvedSha, manifest_sha256: hash(release.canonicalJson(manifest)),
    environment: { name: 'production', id: 1 }, authorityReceipt: f.context.receipt };
  const backup = { id: MARKER, status: 'COMPLETED', is_physical_backup: true, inserted_at: f.authority.backup.insertedAt };
  const policy = { environment: { name: 'production', id: 1 }, supabase: { project_ref: 'aewwdlvbwpczqyvkwvvj',
    backup: { required_status: 'COMPLETED', require_physical: true, max_age_seconds: 86400 } } };
  return { recoveryRequest: request, recoveryManifest: manifest, currentGate, backup, policy, requestedAt: at };
}

test('B2 historical recovery separately requires current gate identity and fresh current backup', async () => {
  assert.equal(typeof release.verifyB2RecoveryOperation, 'function');
  const f = await b2AdminHistoricalFixture();
  const verifiedSource = f.historical.verifiedSource;
  const authorityContext = f.authorityContext;
  const requestedAt = '2026-11-10T12:00:00.000Z';
  const currentGate = { result: 'GATE_VERIFIED', run_id: f.recoveryRequest.runId,
    run_attempt: f.recoveryRequest.runAttempt, release_id: f.recoveryRequest.releaseId,
    approved_sha: f.recoveryRequest.approvedSha, manifest_sha256: hash(release.canonicalJson(f.recoveryManifest)),
    environment: { name: 'production', id: f.policy.environment.id }, authorityReceipt: authorityContext.receipt };
  const backup = { id: MARKER, status: 'COMPLETED', is_physical_backup: true, inserted_at: requestedAt };
  const args = { recoveryRequest: f.recoveryRequest, recoveryManifest: f.recoveryManifest, currentGate,
    backup, policy: f.policy, requestedAt, verifiedSource, authorityContext };
  assert.equal(typeof release.verifyB2RecoveryPreflight, 'function');
  assert.deepEqual(release.verifyB2RecoveryPreflight({ ...args, backup: undefined }), { authorityReceipt: authorityContext.receipt });
  assert.deepEqual(release.verifyB2RecoveryOperation(args), { authorityReceipt: authorityContext.receipt });
  for (const mutate of [a => a.currentGate.run_id = '123', a => a.currentGate.run_attempt++,
    a => a.currentGate.manifest_sha256 = '0'.repeat(64), a => a.currentGate.authorityReceipt.approvalSha256 = '0'.repeat(64),
    a => a.backup.inserted_at = AT,
    a => a.backup.inserted_at = '2026-11-10T12:00:00.001Z',
    a => a.backup.inserted_at = '2026-11-09T12:00:00.000Z',
    a => a.policy.supabase.project_ref = 'another-project',
    a => delete a.backup, a => a.authorityContext = structuredClone(authorityContext),
    a => a.verifiedSource = structuredClone(verifiedSource)]) {
    const a = { ...args, policy: structuredClone(args.policy), currentGate: structuredClone(args.currentGate), backup: { ...args.backup } }; mutate(a);
    assert.throws(() => release.verifyB2RecoveryOperation(a), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  const trustedProofRoot = mkdtempSync(join(tmpdir(), 'b2-admin-proof-'));
  const mutationArgs = { ...args, manifest: args.recoveryManifest, request: args.recoveryRequest,
    trustedProofRoot, proofPath: join(trustedProofRoot, 'protected-stage-proofs.json'), mutate: async () => {} };
  for (const stage of ['migrations', 'functions', 'admin_promote', 'admin_route']) {
    await assert.rejects(release.executeB2ProtectedMutation({ ...mutationArgs, stage }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  for (const stage of ['admin_upload', 'admin_promote', 'admin_route']) await release.executeB2ProtectedMutation({ ...mutationArgs, stage });
  assert.deepEqual(JSON.parse(readFileSync(mutationArgs.proofPath)).map(proof => proof.stage), ['admin_upload', 'admin_promote', 'admin_route']);
});

test('B2 mutation wrapper writes closed proof before invoking mutation and rejects stale authority', async () => {
  assert.equal(typeof release.executeB2ProtectedMutation, 'function');
  const f = fixture(); const op = operationFixture(f);
  op.recoveryManifest = f.manifest; op.recoveryRequest = f.request;
  op.currentGate = { ...op.currentGate, run_id: f.request.runId, release_id: f.request.releaseId,
    manifest_sha256: hash(release.canonicalJson(f.manifest)) };
  const trustedProofRoot = mkdtempSync(join(tmpdir(), 'b2-proof-'));
  const proofPath = join(trustedProofRoot, 'protected-stage-proofs.json');
  let mutations = 0;
  const args = { manifest: f.manifest, request: f.request, currentGate: op.currentGate, authorityContext: f.context,
    policy: op.policy, backup: op.backup, requestedAt: AT, stage: 'migrations', proofPath, trustedProofRoot,
    mutate: async () => { mutations++; const proof = JSON.parse(readFileSync(proofPath, 'utf8'))[0];
      assert.deepEqual(Object.keys(proof).sort(), ['runId', 'runAttempt', 'releaseId', 'approvedSha', 'manifestSha256', 'stage', 'verifiedAt', 'receipt'].sort());
      assert.doesNotMatch(JSON.stringify(proof), new RegExp(MARKER)); } };
  await release.executeB2ProtectedMutation(args); assert.equal(mutations, 1);
  await assert.rejects(release.executeB2ProtectedMutation({ ...args, requestedAt: '2026-11-10T12:00:00.000Z' }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  assert.equal(mutations, 1);
});

test('B2 current mutation binds the normalized backup identity and project before any proof or mutation', async () => {
  const f = fixture(), op = operationFixture(f);
  const trustedProofRoot = mkdtempSync(join(tmpdir(), 'b2-backup-binding-'));
  const currentGate = { ...op.currentGate, run_id: f.request.runId, release_id: f.request.releaseId,
    manifest_sha256: hash(release.canonicalJson(f.manifest)) };
  let mutations = 0;
  for (const change of [a => { a.backup.id = 'another-backup'; },
    a => { a.backup.inserted_at = '2026-11-08T10:01:00.000Z'; },
    a => { a.backup.status = 'PENDING'; }, a => { a.backup.is_physical_backup = false; },
    a => { a.policy.supabase.project_ref = 'another-project'; }]) {
    const args = { manifest: f.manifest, request: f.request, currentGate, authorityContext: f.context,
      policy: structuredClone(op.policy), backup: { ...op.backup }, requestedAt: AT, stage: 'migrations',
      proofPath: join(trustedProofRoot, 'protected-stage-proofs.json'), trustedProofRoot,
      mutate: async () => { mutations++; } };
    change(args);
    await assert.rejects(release.executeB2ProtectedMutation(args), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
    assert.equal(fs.existsSync(args.proofPath), false);
    assert.equal(mutations, 0);
  }
});

test('B2 current mutation rejects a repinned insertion timestamp inconsistent with the approved backup digest', async () => {
  const f = fixture({ backupInsertedAt: '2026-11-08T10:01:00.000Z' }), op = operationFixture(f);
  op.backup.inserted_at = '2026-11-08T10:00:00.000Z';
  assert.equal(hash(release.canonicalJson(op.backup)), f.authority.backup.evidenceSha256,
    'the observed backup still matches the independently pinned evidence digest');
  const trustedProofRoot = mkdtempSync(join(tmpdir(), 'b2-backup-insertion-binding-'));
  let mutations = 0;
  const proofPath = join(trustedProofRoot, 'protected-stage-proofs.json');
  await assert.rejects(release.executeB2ProtectedMutation({ manifest: f.manifest, request: f.request,
    currentGate: { ...op.currentGate, run_id: f.request.runId, release_id: f.request.releaseId,
      manifest_sha256: hash(release.canonicalJson(f.manifest)) }, authorityContext: f.context,
    policy: op.policy, backup: op.backup, requestedAt: AT, stage: 'migrations', trustedProofRoot, proofPath,
    mutate: async () => { mutations++; } }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  assert.equal(mutations, 0); assert.equal(fs.existsSync(proofPath), false);
});

test('B2 proof writer requires trusted containment and ordered atomic persistence', async () => {
  const f = fixture(); const op = operationFixture(f);
  const trustedProofRoot = mkdtempSync(join(tmpdir(), 'b2-safe-proof-'));
  const proofPath = join(trustedProofRoot, 'protected-stage-proofs.json');
  const currentGate = { ...op.currentGate, run_id: f.request.runId, release_id: f.request.releaseId,
    manifest_sha256: hash(release.canonicalJson(f.manifest)) };
  let mutations = 0;
  const args = { manifest: f.manifest, request: f.request, currentGate, authorityContext: f.context,
    policy: op.policy, backup: op.backup, requestedAt: AT, stage: 'migrations', proofPath, trustedProofRoot,
    mutate: async () => { mutations++; } };
  for (const change of [a => delete a.trustedProofRoot, a => a.proofPath = join(trustedProofRoot, '..', 'protected-stage-proofs.json'),
    a => a.stage = 'functions', a => a.stage = 'admin_upload']) {
    const a = { ...args }; change(a);
    await assert.rejects(release.executeB2ProtectedMutation(a), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  const junction = join(trustedProofRoot, 'junction'); fs.symlinkSync(trustedProofRoot, junction, 'junction');
  await assert.rejects(release.executeB2ProtectedMutation({ ...args, trustedProofRoot: junction,
    proofPath: join(junction, 'protected-stage-proofs.json') }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  assert.equal(mutations, 0);
  await release.executeB2ProtectedMutation(args);
  const before = readFileSync(proofPath, 'utf8');
  const originalWrite = fs.writeSync;
  try {
    fs.writeSync = (fd, buffer, ...rest) => { originalWrite(fd, buffer, 0, Math.min(7, buffer.length)); throw new Error(MARKER); };
    syncBuiltinESMExports();
    await assert.rejects(release.executeB2ProtectedMutation({ ...args, stage: 'functions' }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  } finally { fs.writeSync = originalWrite; syncBuiltinESMExports(); }
  assert.equal(readFileSync(proofPath, 'utf8'), before, 'partial temp write preserves prior proof');
  assert.equal(mutations, 1);
  try {
    let raced = false;
    fs.writeSync = (fd, buffer, ...rest) => {
      if (!raced) { raced = true; fs.renameSync(proofPath, join(trustedProofRoot, 'saved-proof.json')); writeFileSync(proofPath, before); }
      return originalWrite(fd, buffer, ...rest);
    };
    syncBuiltinESMExports();
    await assert.rejects(release.executeB2ProtectedMutation({ ...args, stage: 'functions' }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  } finally { fs.writeSync = originalWrite; syncBuiltinESMExports(); }
  assert.equal(readFileSync(proofPath, 'utf8'), before, 'replacement race is not overwritten');
  assert.equal(mutations, 1);
  writeFileSync(join(trustedProofRoot, '.protected-stage-proofs.lock'), 'busy', { flag: 'wx' });
  await assert.rejects(release.executeB2ProtectedMutation({ ...args, stage: 'functions' }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  fs.unlinkSync(join(trustedProofRoot, '.protected-stage-proofs.lock'));
  await release.executeB2ProtectedMutation({ ...args, stage: 'functions' });
  await assert.rejects(release.executeB2ProtectedMutation({ ...args, stage: 'admin_route' }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  assert.deepEqual(JSON.parse(readFileSync(proofPath)).map(proof => proof.stage), ['migrations', 'functions']);
  assert.equal(mutations, 2);
});

test('B2 recovery entry points reject copied source records and mismatched context before downstream work', () => {
  const f = fixture(); const op = operationFixture(f);
  for (const fn of [release.verifyPostcheckRecovery, release.verifyAdminRecoveryPostcheck]) {
    assert.throws(() => fn({ ...op, authorityContext: f.context,
      sourceManifest: f.manifest, sourceObservation: {}, verifiedSource: { source_manifest: f.manifest }, currentEvidence: {} }),
    error => { assert.equal(error.code, 'B2_RECOVERY_AUTHORITY_INVALID');
      assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true; });
  }
});

test('B2 source artifact allowlists reject authority bytes and closed proof rejects extra fields', () => {
  for (const root of ['gate', 'release', 'bundle']) {
    const f = sourceFixture();
    const directory = root === 'gate' ? f.gateDir : root === 'release' ? f.args.releaseBundle.directory : join(f.args.releaseBundle.directory, 'bundle');
    writeFileSync(join(directory, 'private-authority.json'), MARKER);
    assert.throws(() => release.verifyRecoveryArtifactProvenance(f.args), error => {
      assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true;
    });
  }
  const f = sourceFixture(); f.proofs[0].private = MARKER;
  const bytes = release.canonicalJson(f.proofs);
  writeFileSync(join(f.gateDir, 'protected-stage-proofs.json'), bytes);
  f.source.protected_stage_proof_sha256 = hash(bytes);
  assert.throws(() => release.verifyRecoveryArtifactProvenance(f.args), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
});

test('B2 verified source rejects nested retained private markers before returning artifacts', () => {
  for (const [file, change] of [
    ['bundle/manifest.json', value => value.compiler.private = { raw: MARKER }],
    ['bundle/manifest.json', value => value.resources.web_control_centers_b2_transition.contract.private = { raw: MARKER }],
    ['request.json', value => value.private = { raw: MARKER }],
    ['release-observation.json', value => value.private = { raw: MARKER }],
  ]) {
    const f = sourceFixture();
    const path = join(file === 'release-observation.json' ? f.gateDir : f.args.releaseBundle.directory, file);
    const value = JSON.parse(readFileSync(path)); change(value); writeFileSync(path, release.canonicalJson(value));
    if (file === 'bundle/manifest.json') {
      const digest = hash(release.canonicalJson(value)); f.source.manifest_sha256 = digest;
      writeFileSync(join(f.args.releaseBundle.directory, 'bundle/manifest.sha256'), digest);
      for (const proof of f.proofs) proof.manifestSha256 = digest;
      const bytes = release.canonicalJson(f.proofs); writeFileSync(join(f.gateDir, 'protected-stage-proofs.json'), bytes);
      f.source.protected_stage_proof_sha256 = hash(bytes);
    }
    assert.throws(() => release.verifyRecoveryArtifactProvenance(f.args), error => {
      assert.equal(error.code, 'B2_RECOVERY_AUTHORITY_INVALID');
      assert.doesNotMatch(`${error}${error.stack}${JSON.stringify(error)}`, new RegExp(MARKER)); return true;
    });
  }
});

test('B2 Admin source supports direct and branded chained recovery with closed retained projections', async () => {
  const f = await b2AdminHistoricalFixture();
  const direct = release.verifyAdminRecoverySourceProvenance(f);
  assert.equal(direct.result, 'ADMIN_RECOVERY_SOURCE_VERIFIED');
  assert.deepEqual(direct.authorityReceipt, f.authorityContext.receipt);
  for (const index of [0, 1]) for (const key of ['id', 'digest']) {
    const artifacts = structuredClone(f.artifacts); artifacts[index][key] = key === 'id' ? '999' : `sha256:${'9'.repeat(64)}`;
    assert.throws(() => release.verifyAdminRecoverySourceProvenance({ ...f, artifacts }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  const originalDigest = f.verifiedB2Source.source_artifact_digests.release;
  f.verifiedB2Source.source_artifact_digests.release = `sha256:${'9'.repeat(64)}`;
  assert.throws(() => release.verifyAdminRecoverySourceProvenance(f), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  f.verifiedB2Source.source_artifact_digests.release = originalDigest;
  const chainRequest = { ...f.recoveryRequest, runId: '123456792', releaseId: 'nelyon-20261110-002', mode: 'postcheck_recovery',
    scopeConfirmation: f.policy.scope_confirmations.postcheck_recovery };
  const chainManifest = { ...structuredClone(f.recoveryManifest), compiler: f.historical.manifest.compiler,
    identity: { approved_sha: chainRequest.approvedSha, mode: chainRequest.mode, release_id: chainRequest.releaseId, run_id: chainRequest.runId, run_attempt: 1 } };
  const recoveryRequest = { ...f.recoveryRequest, recoverySourceRunId: chainRequest.runId };
  const recoveryManifest = { ...f.recoveryManifest, recovery: { ...f.recoveryManifest.recovery, source_run_id: chainRequest.runId } };
  const chainPolicy = structuredClone(f.policy); chainPolicy.postcheck_recovery.approved_sources = [f.historical.source];
  const currentEvidence = { schemaVersion: 1, stage: 'recovery', result: 'VERIFIED', receipt: f.authorityContext.receipt,
    checks: Object.fromEntries(['catalog','securityAdvisor','backup','finance','manifest','functionInventory','sourceParity'].map(key => [key, true])) };
  const chain = b2ChainedCapture({ historical: f.historical, policy: chainPolicy, currentEvidence, chainRequest, chainManifest, recoveryRequest, recoveryManifest });
  for (const kind of ['release', 'gate']) for (const key of ['id', 'digest']) {
    const substitutedPolicy = structuredClone(chainPolicy);
    substitutedPolicy.postcheck_recovery.approved_sources[0][`${kind}_artifact`][key] = key === 'id' ? '999' : `sha256:${'9'.repeat(64)}`;
    assert.throws(() => b2ChainedCapture({ historical: f.historical, policy: substitutedPolicy, currentEvidence,
      chainRequest, chainManifest, recoveryRequest, recoveryManifest, alterArtifacts: paths => {
        if (key !== 'digest') return;
        const path = join(paths.recovery, 'verified-source.json'), value = JSON.parse(readFileSync(path));
        value.source_artifact_digests[kind] = `sha256:${'9'.repeat(64)}`;
        writeFileSync(path, release.canonicalJson(value));
      } }), { code: 'B2_RECOVERY_AUTHORITY_INVALID' });
  }
  for (const alterArtifacts of [paths => writeFileSync(join(paths.recovery, 'private-authority.json'), MARKER),
    paths => { const path = join(paths.recovery, 'verified-source.json'), value = JSON.parse(readFileSync(path));
      value.source_request.private = { raw: MARKER }; writeFileSync(path, release.canonicalJson(value)); },
    paths => { const path = join(paths.recovery, 'production-recovery.json'), value = JSON.parse(readFileSync(path));
      value.receipt.private = { raw: MARKER }; writeFileSync(path, release.canonicalJson(value)); }]) {
    assert.throws(() => b2ChainedCapture({ historical: f.historical, policy: chainPolicy, currentEvidence, chainRequest, chainManifest,
      recoveryRequest, recoveryManifest, alterArtifacts }), error => {
      assert.equal(error.code, 'B2_RECOVERY_AUTHORITY_INVALID'); assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true;
    });
  }
  const chainedArgs = { ...f, recoveryRequest, recoveryManifest, postcheckRecoveryChain: chain };
  const chained = release.verifyAdminRecoverySourceProvenance(chainedArgs);
  assert.equal(chained.result, 'ADMIN_RECOVERY_SOURCE_VERIFIED');
  assert.equal(chained.source_run_id, chainRequest.runId);
  assert.deepEqual(chained.postcheck_recovery_chain, chain);
  assert.notEqual(chained.postcheck_recovery_chain, chain);
  for (const change of [value => value.extra = { raw: MARKER }, value => value.recovery_artifacts.gate.extra = MARKER]) {
    const copy = structuredClone(chain); change(copy);
    assert.throws(() => release.verifyAdminRecoverySourceProvenance({ ...chainedArgs, postcheckRecoveryChain: copy }), error => {
      assert.equal(error.code, 'B2_RECOVERY_AUTHORITY_INVALID'); assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true;
    });
  }
  for (const directory of [f.adminEvidence.directory, f.gateEvidence.directory]) {
    const path = join(directory, 'private-authority.json'); writeFileSync(path, MARKER);
    try { assert.throws(() => release.verifyAdminRecoverySourceProvenance(f), error => {
      assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true;
    }); } finally { fs.unlinkSync(path); }
  }
  for (const [path, mutate] of [
    [join(f.releaseBundle.directory, 'request.json'), value => value.extra = { raw: MARKER }],
    [join(f.gateEvidence.directory, 'release-observation.json'), value => value.admin_web.extra = { raw: MARKER }],
    [join(f.adminEvidence.directory, 'admin-web-manifest.json'), value => value.source.files.push({ path: 'public.js', bytes: 1, sha256: 'a'.repeat(64), raw: MARKER })],
  ]) {
    const before = readFileSync(path, 'utf8'), value = JSON.parse(before); mutate(value); writeFileSync(path, release.canonicalJson(value));
    try { assert.throws(() => release.verifyAdminRecoverySourceProvenance(f), error => {
      assert.equal(error.code, 'B2_RECOVERY_AUTHORITY_INVALID'); assert.doesNotMatch(`${error}${error.stack}`, new RegExp(MARKER)); return true;
    }); } finally { writeFileSync(path, before); }
  }
});

test('B2 compiler and snapshot imports initialize in either ESM order', () => {
  const modules = ['scripts/nelyon-production-release.mjs', 'scripts/nelyon-production-snapshot-adapter.mjs'];
  for (const order of [modules, [...modules].reverse()]) {
    const program = order.map(path => `await import(${JSON.stringify(new URL(`../${path}`, import.meta.url).href)});`).join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], { encoding: 'utf8', env: process.env });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  }
});

test('B2 installed B1 media successors preserve unrelated B1 and QA guards', () => {
  assert.equal(typeof adapter.validateB2InstalledB1State, 'function');
  const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url)));
  const transition = policy.web_control_centers_b1_transition;
  const state = { schema_version: 1, complete: true, installed: true, relations: structuredClone(transition.catalog.relations),
    helpers: structuredClone(transition.catalog.helpers), rpc_identities: transition.rpc_attestations.map(item => item.identity),
    media_asset_links: structuredClone(transition.catalog.media_asset_links) };
  const oldConstraint = state.media_asset_links.entity_type_constraint;
  state.media_asset_links.entity_type_constraint = oldConstraint.replace("'publication_draft'::text", "'publication_draft'::text, 'publication_schedule'::text");
  for (const row of state.media_asset_links.policies) row.qual = row.qual.replace("'publication_draft'::text", "'publication_draft'::text, 'publication_schedule'::text");
  const f = fixture(); const authority = JSON.parse(f.options.authorityJson);
  authority.successorCatalog.records = state.media_asset_links.policies.map(row => {
    const value = { identity: `${row.schema}.${row.table}.${row.name}`, relation: `${row.schema}.${row.table}`,
      command: row.command, roles: row.roles, using: row.qual.replace(/\r\n?|\n/g, ' '), check: row.with_check };
    const expectedCanonicalJson = canonical(value);
    return { kind: 'policy', identity: value.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) };
  }).sort((a,b) => a.identity.localeCompare(b.identity));
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const options = { ...f.options, authorityJson: JSON.stringify(authority) };
  options.expectedPrivateAuthoritySha256 = hash(options.authorityJson);
  const descriptor = JSON.parse(options.descriptorBytes); descriptor.private_authority.sha256 = options.expectedPrivateAuthoritySha256;
  options.descriptorBytes = JSON.stringify(descriptor); options.expectedDescriptorSha256 = hash(options.descriptorBytes);
  const authorityContext = createReleaseAuthorityContext(options);
  assert.equal(adapter.validateB2InstalledB1State(state, transition, authorityContext, 'post'), true);
  assert.throws(() => adapter.validateB2InstalledB1State(state, transition, authorityContext, 'pre'));
  assert.throws(() => adapter.validateB2InstalledB1State(state, transition, structuredClone(authorityContext), 'post'));
  for (const mutate of [s => s.helpers[0].definition_sha256 = '0'.repeat(64), s => s.relations[0].force_rls = false,
    s => s.media_asset_links.policies[0].qual = 'true', s => s.media_asset_links.indexes[0].valid = false,
    s => s.media_asset_links.triggers[0].enabled = 'D', s => s.rpc_identities.pop()]) {
    const changed = structuredClone(state); mutate(changed);
    assert.throws(() => adapter.validateB2InstalledB1State(changed, transition, authorityContext, 'post'));
  }
  const successor = structuredClone(policy.web_control_centers_b1_qa_c3_transition.rpc_replacement.successor);
  delete successor.advisor_fingerprint;
  const qa = { schema_version: 1, complete: true, function: successor };
  assert.equal(adapter.validateWebControlCentersB1QaC3InstalledState(qa, policy.web_control_centers_b1_qa_c3_transition), true);
  qa.function.definition_sha256 = '0'.repeat(64);
  assert.throws(() => adapter.validateWebControlCentersB1QaC3InstalledState(qa, policy.web_control_centers_b1_qa_c3_transition));
});

test('B2 RPC successor comparison replaces only migration-defined bodies and preserves ACL and unrelated RPCs', () => {
  assert.equal(typeof adapter.validateB2RpcSecurityAttestations, 'function');
  const policy = JSON.parse(readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url)));
  const exceptions = [...policy.security_advisor.exceptions,
    ...policy.web_control_centers_b1_transition.security_advisor.introduced_exceptions];
  const items = exceptions.filter(row => Array.isArray(row.object?.argument_types)).map(row => ({
    schema: row.object.schema, name: row.object.name, identity_arguments: row.object.identity_arguments,
    argument_types: row.object.argument_types, ...structuredClone(row.attestation),
  })).sort((a,b) => `${a.schema}.${a.name}(${a.argument_types.join(',')})`.localeCompare(`${b.schema}.${b.name}(${b.argument_types.join(',')})`));
  const names = new Set(['update_my_publication_draft_v1','delete_my_publication_draft_v1','publish_my_publication_draft_v1',
    'create_photo_post_with_media','create_carousel_post']);
  const records = items.filter(row => names.has(row.name)).map(row => {
    row.definition_sha256 = 'a'.repeat(64);
    const value = { identity: `${row.schema}.${row.name}(${row.argument_types.join(',')})`, owner: row.owner,
      securityDefiner: row.security_definer, searchPath: row.search_path, execute: row.execute.authenticated, definitionSha256: row.definition_sha256 };
    const expectedCanonicalJson = canonical(value);
    return { kind: 'function', identity: value.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) };
  }).sort((a,b) => a.identity.localeCompare(b.identity));
  assert.ok(records.length >= 3);
  for (const row of items.filter(row => names.has(row.name))) {
    const identity = `${row.schema}.${row.name}(${row.argument_types.join(',')})`;
    const acl = [...row.acl].sort((a,b) => `${a.grantee}\0${a.privilege_type}` < `${b.grantee}\0${b.privilege_type}` ? -1 : 1);
    const expectedCanonicalJson = canonical({ identity, acl, execute: row.execute });
    records.push({ kind: 'function_acl', identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) });
  }
  const f = fixture(); const authority = JSON.parse(f.options.authorityJson); authority.successorCatalog.records = records;
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const options = { ...f.options, authorityJson: JSON.stringify(authority) }; options.expectedPrivateAuthoritySha256 = hash(options.authorityJson);
  const descriptor = JSON.parse(options.descriptorBytes); descriptor.private_authority.sha256 = options.expectedPrivateAuthoritySha256;
  options.descriptorBytes = JSON.stringify(descriptor); options.expectedDescriptorSha256 = hash(options.descriptorBytes);
  const authorityContext = createReleaseAuthorityContext(options);
  const snapshot = { complete: true, count: items.length, items, sha256: hash(release.canonicalJson(items)) };
  assert.equal(adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, authorityContext, 'post'), true);
  assert.throws(() => adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, authorityContext, 'pre'));
  for (const mutate of [s => s.items.find(row => names.has(row.name)).execute.anon = true,
    s => s.items.find(row => !names.has(row.name)).definition_sha256 = 'b'.repeat(64)]) {
    const changed = structuredClone(snapshot); mutate(changed); changed.sha256 = hash(release.canonicalJson(changed.items));
    assert.throws(() => adapter.validateB2RpcSecurityAttestations(changed, exceptions, authorityContext, 'post'));
  }
});

test('B2 scheduler enrollment uses the exact descriptor JWT-disabled contract', () => {
  assert.equal(typeof adapter.validateB2SchedulerEnrollment, 'function');
  const descriptor = JSON.parse(readFileSync(new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url)));
  const contract = descriptor.contract.functions.find(item => item.name === 'process-scheduled-publications');
  assert.equal(contract.verify_jwt, false);
  const after = { slug: contract.name, status: 'ACTIVE', version: 1, verify_jwt: false, ezbr_sha256: 'a'.repeat(64) };
  assert.equal(adapter.validateB2SchedulerEnrollment(undefined, after, contract), true);
  assert.throws(() => adapter.validateB2SchedulerEnrollment(undefined, { ...after, verify_jwt: true }, contract));
  assert.throws(() => adapter.validateB2SchedulerEnrollment(after, after, contract));
});

test('B2 exact database source authority checks all role grants without expanding private v1', () => {
  assert.equal(typeof adapter.verifyB2DatabaseFunctionAuthority, 'function');
  const f = fixture(); const authority = JSON.parse(f.options.authorityJson);
  const record = authority.successorCatalog.records.find(row => row.kind === 'function');
  const value = JSON.parse(record.expectedCanonicalJson); value.identity = 'private.synthetic()';
  record.identity = value.identity; record.expectedCanonicalJson = canonical(value); record.expectedSha256 = hash(record.expectedCanonicalJson);
  const security = { identity: value.identity, acl: [{ grantee: value.owner, privilege_type: 'EXECUTE', is_grantable: false }],
    execute: { public: false, anon: false, authenticated: false, service_role: false } };
  authority.successorCatalog.records = [record, { kind: 'function_acl', identity: value.identity,
    expectedCanonicalJson: canonical(security), expectedSha256: hash(canonical(security)) }];
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const options = { ...f.options, authorityJson: JSON.stringify(authority) }; options.expectedPrivateAuthoritySha256 = hash(options.authorityJson);
  const descriptor = JSON.parse(options.descriptorBytes); descriptor.private_authority.sha256 = options.expectedPrivateAuthoritySha256;
  options.descriptorBytes = JSON.stringify(descriptor); options.expectedDescriptorSha256 = hash(options.descriptorBytes);
  const authorityContext = createReleaseAuthorityContext(options);
  const rows = [{ schema: 'private', name: 'synthetic', argument_types: [], identity_arguments: '', owner: value.owner,
    security_definer: value.securityDefiner, search_path: value.searchPath, definition_sha256: value.definitionSha256,
    execute: { public: false, anon: false, authenticated: false, service_role: false },
    acl: [{ grantee: value.owner, privilege_type: 'EXECUTE', is_grantable: false }] }];
  assert.equal(adapter.verifyB2DatabaseFunctionAuthority(rows, rows, authorityContext), true);
  for (const role of ['public','anon','authenticated','service_role']) {
    const changed = structuredClone(rows); changed[0].execute[role] = true;
    assert.throws(() => adapter.verifyB2DatabaseFunctionAuthority(changed, rows, authorityContext), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }
  const changed = structuredClone(rows); changed[0].acl.push({ grantee: 'anon', privilege_type: 'EXECUTE', is_grantable: false });
  assert.throws(() => adapter.verifyB2DatabaseFunctionAuthority(changed, rows, authorityContext), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  assert.throws(() => adapter.verifyB2DatabaseFunctionAuthority(rows, undefined, authorityContext), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
});

test('B2 neutral database normalizer accepts all 30 real signatures and rejects malformed or drifting authority', () => {
  const matrix = b2DatabaseFunctionMatrix();
  assert.throws(() => adapter.normalizeRpcSecurityAttestations(matrix.rows), { code: 'RPC_SECURITY_ATTESTATION_FAILED' }, 'legacy public/authenticated policy stays intact');
  assert.equal(typeof adapter.normalizeB2DatabaseFunctionAttestations, 'function');
  const normalized = adapter.normalizeB2DatabaseFunctionAttestations([...matrix.rows].reverse());
  assert.deepEqual(normalized.items, matrix.sourceRows);
  assert.equal(normalized.count, 30);
  assert.equal(normalized.sha256, hash(release.canonicalJson(matrix.sourceRows)));
  const f = fixture(); const authority = JSON.parse(f.options.authorityJson);
  authority.successorCatalog.records = matrix.records;
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const options = { ...f.options, authorityJson: JSON.stringify(authority) }; options.expectedPrivateAuthoritySha256 = hash(options.authorityJson);
  const descriptor = JSON.parse(options.descriptorBytes); descriptor.private_authority.sha256 = options.expectedPrivateAuthoritySha256;
  options.descriptorBytes = JSON.stringify(descriptor); options.expectedDescriptorSha256 = hash(options.descriptorBytes);
  const context = createReleaseAuthorityContext(options);
  assert.equal(typeof adapter.verifyB2DatabaseFunctionScope, 'function');
  assert.equal(adapter.verifyB2DatabaseFunctionScope(matrix.sourceRows, context), true);
  assert.deepEqual([...adapter.B2_DATABASE_FUNCTION_SCOPE], matrix.records.filter(row => row.kind === 'function').map(row => row.identity));
  for (const rows of [matrix.sourceRows.slice(1), [...matrix.sourceRows, { ...matrix.sourceRows[0], name: 'guard_publication_receipt_immutable_v1' }]]) {
    rejected(() => adapter.verifyB2DatabaseFunctionScope(rows, context));
  }
  assert.equal(adapter.verifyB2DatabaseFunctionAuthority(normalized.items, matrix.sourceRows, context), true);
  for (const change of [rows => rows.push(rows[0]), rows => rows[0].extra = MARKER,
    rows => rows[0].security_definer = 'false', rows => rows[0].owner = '', rows => rows[0].argument_types = [''],
    rows => rows[0].argument_types = [' timestamp without time zone'], rows => rows[0].identity_arguments = '',
    rows => rows[0].search_path.push(rows[0].search_path[0]), rows => rows[0].acl.push(rows[0].acl[0]),
    rows => rows[0].acl[0].privilege_type = 'SELECT', rows => rows[0].execute.anon = 'false',
    rows => rows[0].definition = '', rows => rows[0].definition_sha256 = '0'.repeat(64)]) {
    const rows = structuredClone(matrix.rows); change(rows); rejected(() => adapter.normalizeB2DatabaseFunctionAttestations(rows));
  }
  for (const change of [row => row.owner = 'other', row => row.security_definer = !row.security_definer,
    row => row.search_path = ['search_path=unsafe'], row => row.definition += '\n-- drift',
    ...['public','anon','authenticated','service_role'].map(role => row => row.execute[role] = !row.execute[role]),
    row => row.acl.push({ grantee: 'anon', privilege_type: 'EXECUTE', is_grantable: false })]) {
    const rows = structuredClone(matrix.rows); change(rows[0]);
    const observed = adapter.normalizeB2DatabaseFunctionAttestations(rows).items;
    rejected(() => adapter.verifyB2DatabaseFunctionAuthority(observed, matrix.sourceRows, context));
  }
});

test('B2 inherited function ACL approval must equal the independently verified pre baseline', () => {
  assert.equal(typeof adapter.verifyB2InheritedFunctionPrestate, 'function');
  const f = fixture(), matrix = b2DatabaseFunctionMatrix();
  const names = new Set(['create_photo_post_with_media', 'create_carousel_post', 'update_my_publication_draft_v1',
    'delete_my_publication_draft_v1', 'publish_my_publication_draft_v1']);
  const items = matrix.sourceRows.filter(row => row.schema === 'public' && names.has(row.name));
  const snapshot = { complete: true, count: items.length, items, sha256: hash(release.canonicalJson(items)) };
  const exceptions = items.map(({ schema, name, identity_arguments, argument_types, ...attestation }) => ({
    object: { schema, name, identity_arguments, argument_types }, attestation }));
  function context(mutate) {
    const authority = JSON.parse(f.options.authorityJson);
    authority.successorCatalog.records = structuredClone(matrix.records);
    mutate?.(authority.successorCatalog.records);
    const authorityJson = JSON.stringify(authority), expectedPrivateAuthoritySha256 = hash(authorityJson);
    const descriptor = JSON.parse(f.options.descriptorBytes); descriptor.private_authority.sha256 = expectedPrivateAuthoritySha256;
    const descriptorBytes = JSON.stringify(descriptor);
    return createReleaseAuthorityContext({ ...f.options, descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes),
      authorityJson, expectedPrivateAuthoritySha256 });
  }
  assert.equal(adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, context(), 'pre'), true);
  const rawRows = matrix.rows.filter(row => row.schema === 'public' && names.has(row.name));
  assert.equal(adapter.verifyB2InheritedFunctionPrestate(rawRows, context()), true);
  rejected(() => adapter.verifyB2InheritedFunctionPrestate(rawRows.slice(1), context()));
  rejected(() => adapter.verifyB2InheritedFunctionPrestate([...rawRows, rawRows[0]], context()));
  const overload = structuredClone(rawRows); overload[0].argument_types = ['text']; overload[0].identity_arguments = 'p_unknown text';
  rejected(() => adapter.verifyB2InheritedFunctionPrestate(overload, context()));
  const incomplete = context(records => {
    const index = records.findIndex(row => row.kind === 'function_acl' && row.identity.startsWith('private.'));
    records.splice(index, 1);
  });
  rejected(() => adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, incomplete, 'pre'));
  for (const name of names) {
    const changed = context(records => {
      const record = records.find(row => row.kind === 'function_acl' && row.identity.startsWith(`public.${name}(`));
      const value = JSON.parse(record.expectedCanonicalJson); value.acl[0].is_grantable = true;
      record.expectedCanonicalJson = canonical(value); record.expectedSha256 = hash(record.expectedCanonicalJson);
    });
    rejected(() => adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, changed, 'pre'));
    rejected(() => adapter.validateB2RpcSecurityAttestations(snapshot, exceptions, changed, 'post'));
    rejected(() => adapter.verifyB2InheritedFunctionPrestate(rawRows, changed));
  }
});

test('B2 public relation prestate must equal independently approved ACLs before mutation', () => {
  assert.equal(typeof adapter.verifyB2PublicRelationPrestate, 'function');
  const f = fixture(), authority = JSON.parse(f.options.authorityJson);
  const rows = ['public.media_asset_links', 'public.media_assets'].map(identity => ({ identity, owner: 'postgres', rls: true, forceRls: false,
    acl: [{ grantee: 'authenticated', privilege_type: 'SELECT', is_grantable: false }, { grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
    access: { public: false, anon: false, authenticated: true, service_role: false } }));
  for (const { acl, access, ...row } of rows) {
    for (const [kind, value] of [['relation', { ...row, definitionSha256: '1'.repeat(64) }], ['relation_acl', { identity: row.identity, acl, access }]]) {
      const expectedCanonicalJson = canonical(value);
      authority.successorCatalog.records.push({ kind, identity: row.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) });
    }
  }
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const authorityJson = JSON.stringify(authority), expectedPrivateAuthoritySha256 = hash(authorityJson);
  const descriptor = JSON.parse(f.options.descriptorBytes); descriptor.private_authority.sha256 = expectedPrivateAuthoritySha256;
  const descriptorBytes = JSON.stringify(descriptor);
  const context = createReleaseAuthorityContext({ ...f.options, descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes), authorityJson, expectedPrivateAuthoritySha256 });
  assert.equal(adapter.verifyB2PublicRelationPrestate(rows, context), true);
  for (const change of [items => items.pop(), items => items.push(items[0]),
    items => { items[0].access.anon = true; }, items => { items[1].acl[0].is_grantable = true; }]) {
    const changed = structuredClone(rows); change(changed);
    rejected(() => adapter.verifyB2PublicRelationPrestate(changed, context));
  }
});

test('B2 exact relation source authority rejects PUBLIC and role ACL drift', () => {
  assert.equal(typeof adapter.verifyB2DatabaseRelationAuthority, 'function');
  const f = fixture();
  const value = f.catalog.find(row => row.kind === 'relation').value;
  const rows = [{ ...value, access: { public: false, anon: false, authenticated: false, service_role: false },
    acl: [{ grantee: value.owner, privilege_type: 'SELECT', is_grantable: false }] }];
  assert.equal(adapter.verifyB2DatabaseRelationAuthority(rows, rows, f.context), true);
  for (const role of ['public','anon','authenticated','service_role']) {
    const changed = structuredClone(rows); changed[0].access[role] = true;
    assert.throws(() => adapter.verifyB2DatabaseRelationAuthority(changed, rows, f.context), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }
  const changed = structuredClone(rows); changed[0].acl.push({ grantee: 'anon', privilege_type: 'SELECT', is_grantable: false });
  assert.throws(() => adapter.verifyB2DatabaseRelationAuthority(changed, rows, f.context), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  assert.throws(() => adapter.verifyB2DatabaseRelationAuthority(rows, [], f.context), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  const authority = JSON.parse(f.options.authorityJson);
  const privateRows = ['publication_schedule_policy', 'publication_schedules', 'publication_schedule_commands',
    'publication_schedule_attempts', 'publication_schedule_materializations'].map(name => ({ ...value,
    identity: `private.${name}`, owner: 'postgres', access: { public: false, anon: false, authenticated: false, service_role: false },
    acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })) }));
  authority.successorCatalog.records = privateRows.map(({ acl, access, ...projection }) => ({ kind: 'relation', identity: projection.identity,
    expectedCanonicalJson: canonical(projection), expectedSha256: hash(canonical(projection)) })).sort((a,b) => a.identity.localeCompare(b.identity));
  authority.successorCatalog.records.push(...b2SyntheticRelationAclRecords(authority.successorCatalog.records));
  authority.successorCatalog.records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const options = { ...f.options, authorityJson: JSON.stringify(authority) }; options.expectedPrivateAuthoritySha256 = hash(options.authorityJson);
  const descriptor = JSON.parse(options.descriptorBytes); descriptor.private_authority.sha256 = options.expectedPrivateAuthoritySha256;
  options.descriptorBytes = JSON.stringify(descriptor); options.expectedDescriptorSha256 = hash(options.descriptorBytes);
  const privateContext = createReleaseAuthorityContext(options);
  assert.equal(adapter.verifyB2DatabaseRelationAuthority(privateRows, privateRows, privateContext), true);
  for (let index = 0; index < privateRows.length; index++) {
    for (const role of ['public','anon','authenticated','service_role']) {
      const unsafe = structuredClone(privateRows); unsafe[index].access[role] = true;
      assert.throws(() => adapter.verifyB2DatabaseRelationAuthority(unsafe, unsafe, privateContext), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
      unsafe[index].access[role] = false;
      unsafe[index].acl.push({ grantee: role, privilege_type: 'SELECT', is_grantable: false });
      assert.throws(() => adapter.verifyB2DatabaseRelationAuthority(unsafe, unsafe, privateContext), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
    }
  }
});
