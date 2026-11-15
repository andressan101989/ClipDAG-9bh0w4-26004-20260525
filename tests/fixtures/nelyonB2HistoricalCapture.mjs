import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as release from '../../scripts/nelyon-production-release.mjs';
import {
  createB2RecoveryProvenanceLoader,
  loadApprovedB2RecoverySource,
} from '../../scripts/nelyon-b2-recovery-provenance.mjs';
import { parseB2PrivateAuthority } from '../../scripts/nelyon-private-authority.mjs';
import { buildPrivateRuntimeClosure } from '../../scripts/nelyon-private-runtime-closure.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const gitBlobHash = bytes => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
function storedZipFiles(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, raw] of entries) {
    const nameBytes = Buffer.from(name, 'utf8'); const bytes = Buffer.from(raw); const crc = crc32(bytes);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    locals.push(local, bytes); centrals.push(central); offset += local.length + bytes.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
const storedZip = (name, raw) => storedZipFiles([[name, raw]]);
const fixtureResponse = value => value instanceof Uint8Array
  ? new Response(value, { status: 200, headers: { 'content-length': String(value.length) } })
  : new Response(JSON.stringify(value), { status: 200 });
const write = (path, value) => writeFileSync(path, release.canonicalJson(value));
const directories = () => {
  const root = mkdtempSync(join(tmpdir(), 'b2-capture-source-'));
  const paths = Object.fromEntries(['release', 'gate', 'recovery'].map(name => [name, join(root, name)]));
  for (const path of Object.values(paths)) mkdirSync(path);
  mkdirSync(join(paths.release, 'bundle'));
  return paths;
};
const bundle = (directory, manifest, request) => {
  write(join(directory, 'bundle', 'manifest.json'), manifest);
  writeFileSync(join(directory, 'bundle', 'manifest.sha256'), hash(release.canonicalJson(manifest)));
  writeFileSync(join(directory, 'bundle', 'summary.md'), 'synthetic B2 recovery capture');
  write(join(directory, 'request.json'), request); write(join(directory, 'remote-evidence.json'), {});
};

export async function b2HistoricalCapture({ manifest: inputManifest, request: inputRequest, contextArgs, policy, at, admin = false,
  adminStages = [], observedAdminStages = adminStages, proofAt = at, allowUnresolvedAuthority = false }) {
  const manifest = structuredClone(inputManifest); manifest.identity.mode = 'release';
  const request = { ...inputRequest, repository: policy.repository, mainSha: inputRequest.approvedSha, mode: 'release' };
  const paths = directories(); const digest = hash(release.canonicalJson(manifest));
  const { createReleaseAuthorityContext } = await import('../../scripts/nelyon-release-authority-context.mjs');
  const receipt = createReleaseAuthorityContext(contextArgs).receipt;
  const proofs = ['migrations', 'functions', ...adminStages].map(stage => ({ runId: request.runId, runAttempt: request.runAttempt,
    releaseId: request.releaseId, approvedSha: request.approvedSha, manifestSha256: digest, stage, verifiedAt: proofAt, receipt }));
  const proofBytes = Buffer.from(release.canonicalJson(proofs), 'utf8');
  let gateArchive = storedZip('protected-stage-proofs.json', proofBytes);
  let releaseArchive;
  const source = { repository: policy.repository, run_id: request.runId, run_attempt: request.runAttempt,
    source_sha: request.approvedSha, release_id: request.releaseId, mutation_status: 'completed', manifest_sha256: digest,
    expected_migrations: manifest.resources.migrations.map(item => ({ blob: item.blob,
      name: item.path.replace(/^.*\//, '').replace(/\.sql$/, '') })),
    expected_migration_count: 367,
    expected_latest_migration: manifest.resources.migrations.at(-1).path.replace(/^.*\//, '').replace(/\.sql$/, ''),
    edge_functions: manifest.resources.functions.map(name => {
      const contract = manifest.resources.function_contracts?.find(item => item.name === name);
      return { name, source_sha256: contract?.source_sha256 ?? '0'.repeat(64), status: 'ACTIVE',
        verify_jwt: contract?.verify_jwt ?? true, version: 1 };
    }),
    productive_resources: [...manifest.resources.migrations.map(item => `migration:${item.path.replace(/^.*\//, '').replace(/\.sql$/, '')}`),
      ...manifest.resources.functions.map(name => `function:${name}`)],
    premium_relation_security_sha256: '6'.repeat(64),
    premium_legacy: { content_count: 0, pending_review_count: 0, deleted_count: 0 },
    gate_artifact: { id: '11', name: `nelyon-gate-evidence-${request.runId}-${request.runAttempt}`,
      digest: `sha256:${hash(gateArchive)}` },
    release_artifact: { id: '12', name: `nelyon-release-${request.runId}-${request.runAttempt}`,
      digest: `sha256:${'2'.repeat(64)}` },
    protected_stage_proof_sha256: hash(release.canonicalJson(proofs)), post_snapshot_status: 'success', postcheck_status: admin ? 'success' : 'failure',
    pre_snapshot_evidence_sha256: '3'.repeat(64), post_snapshot_evidence_sha256: '4'.repeat(64),
    runtime_closure_sha256: manifest.runtime_closure.closure_sha256 };
  const observation = { schema_version: 1, result: 'INCOMPLETE_OR_FAILED', steps: { pre_snapshot: 'success', pre_verification: 'success',
    migration_dry_run: 'success', migrations: 'success', functions: 'success', post_snapshot: 'success', postcheck: admin ? 'success' : 'failure' },
    pre_evidence_sha256: source.pre_snapshot_evidence_sha256, post_evidence_sha256: source.post_snapshot_evidence_sha256 };
  if (admin) {
    const postcheck = { schemaVersion: 1, stage: 'postcheck', result: 'VERIFIED', receipt,
      checks: Object.fromEntries(['catalog','securityAdvisor','backup','finance','manifest','functionInventory','sourceParity'].map(key => [key, true])) };
    write(join(paths.gate, 'postcheck-result.json'), postcheck);
    observation.postcheck_file_sha256 = hash(release.canonicalJson(postcheck));
    observation.admin_web = { required: true, build: observedAdminStages.length ? 'success' : 'failure',
      upload: observedAdminStages.includes('admin_upload') ? 'success' : 'skipped',
      candidate: observedAdminStages.includes('admin_upload') ? 'success' : 'skipped',
      promote: observedAdminStages.includes('admin_promote') ? 'success' : 'skipped',
      routes: observedAdminStages.includes('admin_route') ? 'success' : 'skipped',
      finalize: 'failure', recovery: 'skipped', result_sha256: null };
  }
  bundle(paths.release, manifest, request); write(join(paths.gate, 'release-observation.json'), observation);
  write(join(paths.gate, 'protected-stage-proofs.json'), proofs);
  const gateNames = ['release-observation.json', 'protected-stage-proofs.json', ...(admin ? ['postcheck-result.json'] : [])];
  gateArchive = storedZipFiles(gateNames.map(name => [name, readFileSync(join(paths.gate, name))]));
  source.gate_artifact.digest = `sha256:${hash(gateArchive)}`;
  releaseArchive = storedZipFiles(['bundle/manifest.json', 'bundle/manifest.sha256', 'bundle/summary.md',
    'request.json', 'remote-evidence.json'].map(name => [name, readFileSync(join(paths.release, ...name.split('/')))]));
  source.release_artifact.digest = `sha256:${hash(releaseArchive)}`;
  const run = { id: request.runId, run_attempt: request.runAttempt, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch',
    head_branch: policy.default_branch, head_sha: request.approvedSha, path: policy.workflow_path, repository: { full_name: policy.repository } };
  const protectedSteps = { runId: request.runId, runAttempt: request.runAttempt, repository: policy.repository,
    workflow: policy.workflow_path, approvedSha: request.approvedSha, steps: proofs.map(proof => ({ name: `B2 protected ${proof.stage}`,
      conclusion: 'success', startedAt: new Date(Date.parse(proofAt) - 500).toISOString(), completedAt: new Date(Date.parse(proofAt) + 500).toISOString() })) };
  const jobs = [{ id: 81, run_id: Number(request.runId), run_attempt: request.runAttempt,
    steps: protectedSteps.steps.map((step, index) => ({ id: index + 1, name: step.name, status: 'completed',
      conclusion: step.conclusion, started_at: step.startedAt, completed_at: step.completedAt })) }];
  const artifacts = [source.gate_artifact, source.release_artifact].map(item => ({ ...item, id: Number(item.id), expired: false }));
  let adminArchive = null; let adminArtifact = null;
  if (admin) {
    paths.admin = join(paths.gate, '..', 'admin'); mkdirSync(paths.admin);
    const adminManifest = { schema_version: 1, enabled: true, release: { approved_sha: request.approvedSha, mode: 'release',
      release_id: request.releaseId, run_id: request.runId, run_attempt: request.runAttempt,
      manifest_sha256: hash(release.canonicalJson(manifest).trimEnd()) },
    source: { files: [], sha256: hash(release.canonicalJson([]).trimEnd()) } };
    write(join(paths.admin, 'admin-web-manifest.json'), adminManifest);
    writeFileSync(join(paths.admin, 'admin-web-manifest.sha256'), hash(release.canonicalJson(adminManifest).trimEnd()));
    write(join(paths.admin, 'admin-web-previous.json'), { version_id: '11111111-1111-4111-8111-111111111111' });
    write(join(paths.admin, 'admin-web-before-routes.json'), { zone_id: 'zone-1', routes: [{ pattern: 'nelyon.app/admin', script: 'nelyon-admin-web' }] });
    adminArchive = storedZipFiles(['admin-web-manifest.json', 'admin-web-manifest.sha256',
      'admin-web-previous.json', 'admin-web-before-routes.json'].map(name => [name, readFileSync(join(paths.admin, name))]));
    adminArtifact = { id: '13', name: `nelyon-admin-evidence-${request.runId}-${request.runAttempt}`,
      digest: `sha256:${hash(adminArchive)}` };
    artifacts.push({ ...adminArtifact, id: Number(adminArtifact.id), expired: false });
  }
  const policyBytes = Buffer.from(`${JSON.stringify({ schema_version: 2, repository: policy.repository,
    workflow_path: policy.workflow_path, postcheck_recovery: { approved_sources: [source] } }, null, 2)}\n`);
  let approvedSource;
  try {
    approvedSource = loadApprovedB2RecoverySource({ policyBytes, expectedPolicySha256: hash(policyBytes),
      runId: request.runId, runAttempt: request.runAttempt });
  } catch { throw new Error('synthetic approved-source fixture rejected'); }
  const fetchImpl = async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith(`/actions/runs/${request.runId}/attempts/${request.runAttempt}`)) return fixtureResponse({ ...run, id: Number(run.id) });
      if (parsed.pathname.endsWith(`/actions/runs/${request.runId}/attempts/${request.runAttempt}/jobs`)) return fixtureResponse({ total_count: jobs.length, jobs });
      if (parsed.pathname.endsWith(`/actions/runs/${request.runId}/artifacts`)) return fixtureResponse({ total_count: artifacts.length, artifacts });
      if (parsed.pathname.endsWith('/actions/artifacts/11/zip')) return fixtureResponse(gateArchive);
      if (parsed.pathname.endsWith('/actions/artifacts/12/zip')) return fixtureResponse(releaseArchive);
      if (parsed.pathname.endsWith('/actions/artifacts/13/zip') && adminArchive) return fixtureResponse(adminArchive);
      const marker = `/repos/${policy.repository}/contents/`;
      if (parsed.pathname.includes(marker) && parsed.searchParams.get('ref') === request.approvedSha) {
        const member = decodeURIComponent(parsed.pathname.split(marker)[1]);
        const bytes = member === '.github/nelyon-web-control-centers-b2-release-descriptor.json'
          ? Buffer.from(contextArgs.descriptorBytes)
          : manifest.runtime_closure.files.some(item => item.path === member)
            ? readFileSync(new URL(`../../${member}`, import.meta.url))
            : null;
        if (!bytes) return new Response('{}', { status: 404 });
        return fixtureResponse({ path: member, type: 'file', encoding: 'base64', size: bytes.length,
          sha: gitBlobHash(bytes), content: bytes.toString('base64') });
      }
      return new Response('{}', { status: 404 });
    };
  const github = createB2RecoveryProvenanceLoader({
    githubToken: 'synthetic-token', repository: policy.repository, workflowPath: policy.workflow_path,
    apiOrigin: 'https://github.invalid', fetchImpl,
  });
  let recoveryProvenance;
  try { recoveryProvenance = await github.loadExactAttempt({ approvedSource }); }
  catch { throw new Error('synthetic exact-attempt fixture rejected'); }
  const historicalRuntimeClosure = await github.loadHistoricalRuntimeClosure({ recoveryProvenance });
  let verifiedSource;
  try {
    verifiedSource = release.verifyRecoveryArtifactProvenance({ recoveryProvenance,
      releaseBundle: { directory: paths.release }, gateEvidence: { directory: paths.gate } });
  } catch { throw new Error('synthetic release provenance fixture rejected'); }
  let authorityContext = null;
  try {
    authorityContext = await release.resolveB2HistoricalAuthority({ verifiedSource, descriptorBytes: contextArgs.descriptorBytes,
      provider: { getBySha256: async () => Buffer.from(contextArgs.authorityJson) }, historicalRuntimeClosure });
  } catch (error) {
    if (!allowUnresolvedAuthority) throw error;
  }
  return { verifiedSource, authorityContext, recoveryProvenance, historicalRuntimeClosure, source, manifest, request, observation,
    paths, run, policyBytes, fetchImpl, adminArtifact };
}

export async function b2AdminHistoricalFixture({ adminStages = [], observedAdminStages = adminStages, proofAt,
  allowUnresolvedAuthority = false, approvedSha = 'a'.repeat(40) } = {}) {
  const at = '2026-11-08T12:00:00.000Z';
  const policy = JSON.parse(readFileSync(new URL('../../.github/nelyon-production-release-policy.json', import.meta.url)));
  const descriptor = JSON.parse(readFileSync(new URL('../../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url)));
  const c = descriptor.contract;
  c.state = 'approved'; c.release_ready = true; c.reviewed_source_sha = approvedSha; c.integration_base_sha = 'b'.repeat(40);
  c.function_inventory = { before: 34, after: 35 };
  const contracts = c.functions.map(item => {
    const entrypoint = `supabase/functions/${item.name}/index.ts`, source_files = [{ path: entrypoint, sha256: '1'.repeat(64) }];
    item.source_sha256 = hash(release.canonicalJson({ entrypoint, import_map: null, source_files })); item.config_sha256 = '2'.repeat(64);
    return { name: item.name, verify_jwt: item.verify_jwt, entrypoint, import_map: null, source_files, source_changed: true, source_sha256: item.source_sha256 };
  });
  descriptor.public_contract_sha256 = hash(release.canonicalJson(c));
  const value = { identity: 'private.synthetic', owner: 'postgres', rls: true, forceRls: true, definitionSha256: '3'.repeat(64) };
  const canonical = release.canonicalJson(value).trimEnd();
  const authority = { schemaVersion: 1, authorityId: descriptor.private_authority.authority_id,
    publicContractSha256: descriptor.public_contract_sha256, phase: c.to_phase,
    issuedFor: { baselineSha: c.baseline_sha, reviewedSourceSha: c.reviewed_source_sha, integrationBaseSha: c.integration_base_sha },
    successorCatalog: { schemaVersion: 1, records: [{ kind: 'relation', identity: value.identity, expectedCanonicalJson: canonical, expectedSha256: hash(canonical) }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: hash('[]\n'), baselineItems: [], records: [] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: hash(policy.supabase.project_ref), evidenceSha256: '6'.repeat(64), status: 'COMPLETED',
      insertedAt: '2026-11-08T10:00:00.000Z', completedObservedAt: '2026-11-08T10:30:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: [c.to_phase], authorizationSha256: '7'.repeat(64),
      approvedAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-09T11:00:00.000Z' } };
  const relationAcl = release.canonicalJson({ identity: value.identity,
    acl: [{ grantee: value.owner, privilege_type: 'SELECT', is_grantable: false }],
    access: { public: false, anon: false, authenticated: false, service_role: false } }).trimEnd();
  authority.successorCatalog.records.push({ kind: 'relation_acl', identity: value.identity,
    expectedCanonicalJson: relationAcl, expectedSha256: hash(relationAcl) });
  const authorityJson = JSON.stringify(authority); descriptor.private_authority.sha256 = hash(authorityJson);
  const descriptorBytes = JSON.stringify(descriptor);
  const contextArgs = { descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes), phase: c.to_phase,
    transitionId: c.id, baselineSha: c.baseline_sha, reviewedSourceSha: c.reviewed_source_sha, integrationBaseSha: c.integration_base_sha,
    requestedAt: at, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) };
  parseB2PrivateAuthority(authorityJson, hash(authorityJson), at);
  const request = { approvedSha: c.reviewed_source_sha, mainSha: c.reviewed_source_sha, runId: '123456789', runAttempt: 1,
    releaseId: 'nelyon-20261108-001', actor: policy.owner, triggeringActor: policy.owner, repository: policy.repository,
    workflowRef: `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`, ref: `refs/heads/${policy.default_branch}`,
    mode: 'release', scopeConfirmation: policy.scope_confirmations.release_high_risk };
  const runtimeClosure = buildPrivateRuntimeClosure({
    repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)),
    readFile: readFileSync,
  });
  const manifest = { schema_version: 1, generated_at: at, identity: { approved_sha: request.approvedSha, run_id: request.runId,
    run_attempt: request.runAttempt, release_id: request.releaseId, mode: 'release', actor: request.actor, triggering_actor: request.triggeringActor,
    repository: request.repository, workflow_ref: request.workflowRef, ref: request.ref, scope_confirmation: request.scopeConfirmation },
    baseline: { sha: c.baseline_sha, state: 'verified', origin_main_sha: request.approvedSha },
    delta: { files: c.productive_changes.map(item => ({ file_type: 'file', path: item.path, status: item.status })), productive_change_count: 5 },
    resources: { config_changed: true, functions: c.functions.map(item => item.name), function_contracts: contracts,
      migrations: [{ ...Object.fromEntries(Object.entries(c.productive_changes.at(-1)).filter(([key]) => key !== 'status')), version: '20261108061946' }],
      web_control_centers_b2_transition: { contract: c, descriptorSha256: hash(descriptorBytes), publicContractSha256: descriptor.public_contract_sha256,
        expectedPrivateAuthoritySha256: hash(authorityJson), privateAuthorityRequired: true } },
    risk: { level: 'HIGH', findings: [] }, blockers: [], result: 'PLAN READY',
    runtime_closure: runtimeClosure,
    compiler: { path: 'scripts/nelyon-production-release.mjs',
      sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-release.mjs').sha256,
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-snapshot-adapter.mjs').sha256 } };
  const historical = await b2HistoricalCapture({ manifest, request, contextArgs, policy, at, admin: true,
    adminStages, observedAdminStages, proofAt, allowUnresolvedAuthority });
  const adminDirectory = historical.paths.admin;
  const recoveryRequest = { ...request, mode: 'admin_recovery', scopeConfirmation: policy.scope_confirmations.admin_recovery,
    runId: '123456790', releaseId: 'nelyon-20261110-001', recoverySourceRunId: request.runId, productiveResources: [] };
  const recoveryManifest = { identity: { approved_sha: recoveryRequest.approvedSha, mode: recoveryRequest.mode, release_id: recoveryRequest.releaseId,
    run_id: recoveryRequest.runId, run_attempt: 1 }, recovery: { kind: 'admin_cloudflare_forward_completion', source_run_id: request.runId },
    resources: { config_changed: false, function_contracts: [], functions: [], migrations: [] } };
  return { historical, contextArgs, policy, recoveryRequest, recoveryManifest, run: { ...historical.run, head_branch: policy.default_branch },
    artifacts: [{ ...historical.source.release_artifact, expired: false }, { ...historical.source.gate_artifact, expired: false },
      { ...historical.adminArtifact, expired: false }],
    releaseBundle: { directory: historical.paths.release }, gateEvidence: { directory: historical.paths.gate }, adminEvidence: { directory: adminDirectory },
    authorityContext: historical.authorityContext, verifiedB2Source: historical.verifiedSource };
}

export function b2ChainedCapture({ historical, policy, currentEvidence, chainRequest, chainManifest, recoveryRequest, recoveryManifest, alterArtifacts }) {
  const paths = directories(); const policySha256 = '9'.repeat(64);
  bundle(paths.release, chainManifest, chainRequest);
  write(join(paths.gate, 'gate-proof.json'), { schema_version: 1, result: 'GATE_VERIFIED', run_id: chainRequest.runId,
    run_attempt: chainRequest.runAttempt, release_id: chainRequest.releaseId, approved_sha: chainRequest.approvedSha,
    policy_sha256: policySha256, manifest_sha256: hash(release.canonicalJson(chainManifest)),
    authorization_mode: policy.environment.authorization_mode, authorityReceipt: historical.authorityContext.receipt });
  write(join(paths.recovery, 'verified-source.json'), { schema_version: 1, result: 'RECOVERY_SOURCE_VERIFIED', ...historical.verifiedSource });
  write(join(paths.recovery, 'production-recovery.json'), currentEvidence);
  write(join(paths.recovery, 'postcheck-recovery-result.json'), currentEvidence);
  const artifacts = [['release', 'nelyon-release'], ['gate', 'nelyon-gate-evidence'], ['recovery', 'nelyon-postcheck-recovery']]
    .map(([, prefix], index) => ({ id: String(index + 31), name: `${prefix}-${chainRequest.runId}-${chainRequest.runAttempt}`,
      expired: false, digest: `sha256:${String(index + 5).repeat(64)}` }));
  if (alterArtifacts) alterArtifacts(paths);
  return release.verifyAdminRecoveryPostcheckChainProvenance({ policy, policySha256, recoveryRequest, recoveryManifest,
    run: { id: chainRequest.runId, run_attempt: chainRequest.runAttempt, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
      head_branch: policy.default_branch, head_sha: chainRequest.approvedSha, path: policy.workflow_path, repository: { full_name: policy.repository } },
    artifacts, releaseBundle: { directory: paths.release }, gateEvidence: { directory: paths.gate }, recoveryEvidence: { directory: paths.recovery },
    adapterSourceSha256: chainManifest.compiler.snapshot_adapter_sha256, authorityContext: historical.authorityContext,
    verifiedB2Source: historical.verifiedSource });
}

export function b2ChainStagedFixture({ historical, policy, policySha256, chainRequest, chainManifest }) {
  const paths = directories();
  bundle(paths.release, chainManifest, chainRequest);
  write(join(paths.gate, 'gate-proof.json'), { schema_version: 1, result: 'GATE_VERIFIED', run_id: chainRequest.runId,
    run_attempt: chainRequest.runAttempt, release_id: chainRequest.releaseId, approved_sha: chainRequest.approvedSha,
    policy_sha256: policySha256, manifest_sha256: hash(release.canonicalJson(chainManifest)),
    authorization_mode: policy.environment.authorization_mode, authorityReceipt: historical.authorityContext.receipt });
  const current = { schemaVersion: 1, stage: 'recovery', result: 'VERIFIED', receipt: historical.authorityContext.receipt,
    checks: Object.fromEntries(['catalog', 'securityAdvisor', 'backup', 'finance', 'manifest', 'functionInventory', 'sourceParity']
      .map(key => [key, true])) };
  write(join(paths.recovery, 'verified-source.json'), { schema_version: 1, result: 'RECOVERY_SOURCE_VERIFIED', ...historical.verifiedSource });
  write(join(paths.recovery, 'production-recovery.json'), current);
  write(join(paths.recovery, 'postcheck-recovery-result.json'), current);
  const entries = {
    release: ['bundle/manifest.json', 'bundle/manifest.sha256', 'bundle/summary.md', 'request.json', 'remote-evidence.json'],
    gate: ['gate-proof.json'], recovery: ['verified-source.json', 'production-recovery.json', 'postcheck-recovery-result.json'],
  };
  const archives = Object.fromEntries(Object.entries(entries).map(([kind, names]) => [kind,
    storedZipFiles(names.map(name => [name, readFileSync(join(paths[kind], ...name.split('/')))]))]));
  const prefixes = { release: 'nelyon-release', gate: 'nelyon-gate-evidence', recovery: 'nelyon-postcheck-recovery' };
  const artifacts = Object.fromEntries(Object.keys(prefixes).map((kind, index) => [kind, { id: String(index + 31),
    name: `${prefixes[kind]}-${chainRequest.runId}-${chainRequest.runAttempt}`, digest: `sha256:${hash(archives[kind])}` }]));
  const run = { id: Number(chainRequest.runId), run_attempt: chainRequest.runAttempt, status: 'completed', conclusion: 'success',
    event: 'workflow_dispatch', head_branch: policy.default_branch, head_sha: chainRequest.approvedSha,
    path: policy.workflow_path, repository: { full_name: policy.repository } };
  return { paths, archives, artifacts, run };
}
