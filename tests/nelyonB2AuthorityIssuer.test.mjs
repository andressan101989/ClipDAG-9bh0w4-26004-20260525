import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as issuerModule from '../scripts/nelyon-private-authority-issuer.mjs';

import {
  B2_AUTHORITY_INTEGRATION_BASE_SHA,
  classifyB2AuthorityIssuanceDescriptor,
  computeB2AuthorityPreissuance,
  createB2AuthorityIssuanceGithubObserver,
  issueB2PrivateAuthority,
  prepareB2AuthorityIssuance,
  readB2AuthorityIssuanceDiagnostic,
  readB2AuthorityPreparationSummary,
  readTrustedB2AuthorityApproval,
  readTrustedB2AuthorityObservation,
  verifyB2ApprovedDescriptorRenewalBoundary,
} from '../scripts/nelyon-private-authority-issuer.mjs';
import { canonicalJson } from '../scripts/nelyon-production-release.mjs';

const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const WORKFLOW = '.github/workflows/nelyon-production-release.yml';
const SHA = '1'.repeat(40);
const TREE = '2'.repeat(40);
const OBSERVATION_RUN = '9001';
const ISSUE_RUN = '9002';
const OWNER_ID = 1234567;
const OBSERVATION_JOB_ID = 9101;
const ISSUE_JOB_ID = 9102;
const ARTIFACT_ID = 9201;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalBytes = value => Buffer.from(`${canonicalJson(value)}\n`, 'utf8');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(name, bytes, { streamed = false } = {}) {
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(bytes);
  const local = Buffer.alloc(30 + nameBytes.length);
  const flags = streamed ? 0x0808 : 0x0800;
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
  if (!streamed) {
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22);
  }
  local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30);
  const descriptor = streamed ? Buffer.alloc(16) : Buffer.alloc(0);
  if (streamed) {
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(bytes.length, 8); descriptor.writeUInt32LE(bytes.length, 12);
  }
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); nameBytes.copy(central, 46);
  if (streamed) central.writeUInt32LE(0x81a40000, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + bytes.length + descriptor.length, 16);
  return Buffer.concat([local, bytes, descriptor, central, end]);
}

function observation({ approvedSha = SHA, approvedTreeSha = TREE } = {}) {
  const names = [
    'ai-handoff', 'cleanup-stale-media-uploads', 'content-safety-scan', 'create-media-upload',
    'finalize-media-upload', 'get-media-url', 'video-semantic-index',
    ...Array.from({ length: 27 }, (_, index) => `existing-${String(index).padStart(2, '0')}`),
  ].sort();
  const items = names.map((slug, index) => ({ slug, status: 'ACTIVE', version: index + 1,
    verify_jwt: ['content-safety-scan', 'create-media-upload', 'finalize-media-upload', 'get-media-url', 'video-semantic-index']
      .includes(slug), ezbr_sha256: hash(Buffer.from(slug)) }));
  const baselineItems = [];
  const unsigned = {
    schemaVersion: 1,
    kind: 'nelyon-b2-authority-observation-v1',
    projectRef: 'aewwdlvbwpczqyvkwvvj',
    repository: REPOSITORY,
    approvedSha,
    approvedTreeSha,
    startedAt: '2026-11-22T10:00:00.000Z',
    completedObservedAt: '2026-11-22T10:01:00.000Z',
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical',
      projectRefSha256: hash(Buffer.from('aewwdlvbwpczqyvkwvvj')), evidenceSha256: '3'.repeat(64),
      status: 'COMPLETED', insertedAt: '2026-11-22T09:30:00.000Z',
      completedObservedAt: '2026-11-22T10:01:00.000Z', expiresAt: '2026-11-23T09:30:00.000Z' },
    functionInventory: { schemaVersion: 1, complete: true, count: items.length, items,
      sha256: hash(Buffer.from(canonicalJson(items))) },
    securityAdvisor: { schemaVersion: 1, baselineSha256: hash(Buffer.from(canonicalJson(baselineItems))),
      baselineItems, findings: [] },
    vaultEdgeParity: { schemaVersion: 2, projectRef: 'aewwdlvbwpczqyvkwvvj',
      functionName: 'process-scheduled-publications', mechanism: 'supabase-vault-edge-nonce-hmac-sha256-v1',
      result: 'MATCH', observationId: '4'.repeat(64), vault: { secretName: 'call_dispatch_secret' },
      edge: { secretName: 'CALL_DISPATCH_SECRET' }, observedAt: '2026-11-22T10:01:00.000Z',
      expiresAt: '2026-11-22T12:01:00.000Z' },
  };
  return { ...unsigned, observationSha256: hash(Buffer.from(canonicalJson(unsigned))) };
}

function jsonResponse(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json',
    'content-length': String(bytes.length) } });
}

function fixture({ duplicate = false, issueCreatedAt = '2026-11-22T10:02:00Z', streamedArtifact = false,
  observationActorId = OWNER_ID, issueActorId = OWNER_ID,
  repositoryOwnerIds = [OWNER_ID, OWNER_ID], approvedSha = SHA, approvedTreeSha = TREE } = {}) {
  const observed = observation({ approvedSha, approvedTreeSha });
  const observationBytes = canonicalBytes(observed);
  const archive = storedZip('observation.json', observationBytes, { streamed: streamedArtifact });
  const preissuance = computeB2AuthorityPreissuance({
    repository: REPOSITORY, workflowPath: WORKFLOW, approvedSha, approvedTreeSha,
    publicContractSha256: '5'.repeat(64), manifestSha256: '6'.repeat(64), policySha256: '7'.repeat(64),
    baselineSha: '8'.repeat(40), runtimeClosureSha256: '9'.repeat(64),
    observationSha256: observed.observationSha256,
  });
  const releaseId = `b2-authority-${preissuance.preissuanceSha256}`;
  let currentIssueReleaseId = releaseId;
  const run = (id, issue = false) => ({ id: Number(id), run_attempt: 1,
    status: issue ? 'in_progress' : 'completed', conclusion: issue ? null : 'success', event: 'workflow_dispatch',
    head_branch: 'main', head_sha: approvedSha, path: WORKFLOW, created_at: issue
      ? issueCreatedAt : '2026-11-22T09:59:00Z',
    display_title: issue ? currentIssueReleaseId : 'Nelyon B2 authority observation',
    actor: { login: 'andressan101989', id: issue ? issueActorId : observationActorId },
    triggering_actor: { login: 'andressan101989', id: issue ? issueActorId : observationActorId },
    repository: { full_name: REPOSITORY } });
  const history = Array.from({ length: 100 }, (_, index) => ({ id: 10000 + index,
    display_title: `unrelated-${index}`, status: 'completed', conclusion: index % 2 ? 'success' : 'failure' }));
  history.unshift(run(ISSUE_RUN, true));
  if (duplicate) history[50] = { ...history[50], display_title: releaseId };
  const calls = [];
  let repositoryReads = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === `/repos/${REPOSITORY}`) {
      const id = repositoryOwnerIds[Math.min(repositoryReads, repositoryOwnerIds.length - 1)];
      repositoryReads += 1;
      return jsonResponse({ owner: { login: 'andressan101989', id } });
    }
    if (url.pathname.endsWith(`/actions/runs/${OBSERVATION_RUN}/attempts/1`)) return jsonResponse(run(OBSERVATION_RUN));
    if (url.pathname.endsWith(`/actions/runs/${ISSUE_RUN}/attempts/1`)) return jsonResponse(run(ISSUE_RUN, true));
    if (url.pathname.endsWith(`/git/commits/${approvedSha}`)) {
      return jsonResponse({ sha: approvedSha, tree: { sha: approvedTreeSha } });
    }
    if (url.pathname.endsWith(`/actions/runs/${OBSERVATION_RUN}/attempts/1/jobs`)) return jsonResponse({
      total_count: 1, jobs: [{ id: OBSERVATION_JOB_ID, run_id: Number(OBSERVATION_RUN), run_attempt: 1,
        name: 'Observe fresh B2 backup and Vault/Edge parity', status: 'completed', conclusion: 'success',
        head_sha: approvedSha }],
    });
    if (url.pathname.endsWith(`/actions/runs/${ISSUE_RUN}/attempts/1/jobs`)) return jsonResponse({
      total_count: 1, jobs: [{ id: ISSUE_JOB_ID, run_id: Number(ISSUE_RUN), run_attempt: 1,
        name: 'Issue immutable B2 private authority', status: 'in_progress', conclusion: null,
        head_sha: approvedSha }],
    });
    if (url.pathname.endsWith(`/actions/runs/${OBSERVATION_RUN}/artifacts`)) return jsonResponse({ total_count: 1,
      artifacts: [{ id: ARTIFACT_ID, name: `nelyon-b2-authority-observation-${OBSERVATION_RUN}`,
        size_in_bytes: archive.length, digest: `sha256:${hash(archive)}`, expired: false,
        workflow_run: { id: Number(OBSERVATION_RUN), head_branch: 'main', head_sha: approvedSha } }] });
    if (url.pathname.endsWith(`/actions/artifacts/${ARTIFACT_ID}/zip`)) {
      if (init.headers?.accept !== 'application/vnd.github+json') {
        return new Response(JSON.stringify({ message: 'Unsupported Media Type' }), {
          status: 415,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(archive, { status: 200, headers: { 'content-type': 'application/zip',
        'content-length': String(archive.length) } });
    }
    if (url.pathname.endsWith('/actions/workflows/nelyon-production-release.yml/runs')) {
      const page = Number(url.searchParams.get('page'));
      const all = page === 1 ? history.slice(0, 100) : history.slice(100);
      return jsonResponse({ total_count: history.length, workflow_runs: all });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { observed, preissuance, releaseId, fetchImpl, calls, archive,
    setIssueReleaseId(value) { currentIssueReleaseId = value; history[0].display_title = value; } };
}

test('authenticated observation and owner dispatch approval bind exact GitHub provenance and paginate all statuses', async () => {
  const value = fixture({ streamedArtifact: true });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  const observed = await observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256 });
  const observation = readTrustedB2AuthorityObservation(observed);
  assert.equal(observation.artifact.id, String(ARTIFACT_ID));
  assert.equal(observation.artifact.bytes, value.archive.length);
  assert.equal(observation.jobId, String(OBSERVATION_JOB_ID));
  const approved = await observer.authenticateOwnerApproval({ runId: ISSUE_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, releaseId: value.releaseId,
    preissuanceSha256: value.preissuance.preissuanceSha256, observation: observed });
  const approval = readTrustedB2AuthorityApproval(approved, observed);
  assert.equal(approval.approval.approvedAt, '2026-11-22T10:02:00.000Z');
  assert.equal(approval.actor.id, String(OWNER_ID));
  assert.equal(approval.actor.login, 'andressan101989');
  assert.equal(approval.triggeringActor.id, String(OWNER_ID));
  assert.equal(approval.jobId, String(ISSUE_JOB_ID));
  assert.ok(value.calls.some(call => call.includes('page=2')), 'complete workflow history was not paginated');
});

test('owner approval is one-use and rejects a prior run with the deterministic preissuance release id', async () => {
  const value = fixture({ duplicate: true });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  const observed = await observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256 });
  await assert.rejects(() => observer.authenticateOwnerApproval({ runId: ISSUE_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, releaseId: value.releaseId,
    preissuanceSha256: value.preissuance.preissuanceSha256, observation: observed }), error => {
    assert.equal(String(error), 'Error: B2 authority issuance blocked');
    assert.equal(JSON.stringify(error).includes(value.releaseId), false);
    return true;
  });
});

test('authenticated observation actor identities must equal the repository owner numeric identity', async () => {
  const value = fixture({ observationActorId: OWNER_ID + 1 });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  await assert.rejects(() => observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256 }));
});

test('owner approval cannot switch numeric owner identity after the authenticated observation', async () => {
  const value = fixture({ issueActorId: OWNER_ID + 1, repositoryOwnerIds: [OWNER_ID, OWNER_ID + 1] });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  const observed = await observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256 });
  await assert.rejects(() => observer.authenticateOwnerApproval({ runId: ISSUE_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, releaseId: value.releaseId,
    preissuanceSha256: value.preissuance.preissuanceSha256, observation: observed }));
});

test('owner approval must be dispatched strictly after the authenticated observation', async () => {
  const value = fixture({ issueCreatedAt: '2026-11-22T10:01:00Z' });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  const observed = await observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256 });
  await assert.rejects(() => observer.authenticateOwnerApproval({ runId: ISSUE_RUN, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, releaseId: value.releaseId,
    preissuanceSha256: value.preissuance.preissuanceSha256, observation: observed }));
});

test('plain observation, approval and preparation objects cannot reach the immutable publisher', async () => {
  let writes = 0;
  const publisher = { async publishBySha256() { writes += 1; throw new Error('must not run'); } };
  await assert.rejects(() => issueB2PrivateAuthority({
    preparation: Object.freeze({ schemaVersion: 1, result: 'B2_AUTHORITY_PREPARED' }),
    observation: Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_AUTHORITY_OBSERVATION' }),
    approval: Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_OWNER_APPROVAL' }),
    publisher,
    issuedAt: '2026-11-22T10:03:00.000Z',
  }));
  assert.equal(writes, 0);
});

test('only an authentic issuance receipt can materialize the exact approved public descriptor', () => {
  assert.equal(typeof issuerModule.readB2ApprovedDescriptorMaterialization, 'function');
  assert.throws(() => issuerModule.readB2ApprovedDescriptorMaterialization(Object.freeze({
    schemaVersion: 2,
    kind: 'nelyon-b2-private-authority-issuance-receipt-v2',
  })), error => {
    assert.equal(String(error), 'Error: B2 authority issuance blocked');
    return true;
  });
});

test('approved descriptor bytes are fully parsed before immutable provider publication', () => {
  const source = readFileSync(new URL('../scripts/nelyon-private-authority-issuer.mjs', import.meta.url), 'utf8');
  const descriptorParse = source.indexOf('parseB2ReleaseDescriptor(descriptorBytes, descriptorSha256)');
  const publication = source.indexOf('input.publisher.publishBySha256(authoritySha256, authorityBytes)');
  assert.ok(descriptorParse >= 0 && publication > descriptorParse);
});

test('R2 write/readback failures have a non-forgeable closed issuance diagnostic', async () => {
  assert.equal(typeof readB2AuthorityIssuanceDiagnostic, 'function');
  const repositoryRoot = process.cwd();
  const approvedSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const approvedTreeSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8',
  }).trim();
  const value = fixture({ approvedSha, approvedTreeSha });
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  const observed = await observer.authenticateObservation({ runId: OBSERVATION_RUN, runAttempt: 1,
    approvedSha, approvedTreeSha, expectedObservationSha256: value.observed.observationSha256 });
  const preparation = prepareB2AuthorityIssuance({ repositoryRoot, approvedSha, approvedTreeSha,
    integrationBaseSha: B2_AUTHORITY_INTEGRATION_BASE_SHA, observation: observed });
  const summary = readB2AuthorityPreparationSummary(preparation);
  value.setIssueReleaseId(summary.releaseId);
  const approved = await observer.authenticateOwnerApproval({ runId: ISSUE_RUN, runAttempt: 1,
    approvedSha, approvedTreeSha, releaseId: summary.releaseId,
    preissuanceSha256: summary.preissuanceSha256, observation: observed });
  const privateMarker = 'PRIVATE_R2_PROVIDER_BODY_NEVER_EXPOSED';
  let failure;
  await assert.rejects(() => issueB2PrivateAuthority({ preparation, observation: observed,
    approval: approved, publisher: Object.freeze({ async publishBySha256() {
      throw new Error(`${privateMarker} https://private.example.invalid/authority status=503`);
    } }), issuedAt: '2026-11-22T10:03:00.000Z' }), error => {
    failure = error;
    assert.equal(String(error), 'Error: B2 authority issuance blocked');
    return true;
  });
  const diagnostic = readB2AuthorityIssuanceDiagnostic(failure);
  assert.deepEqual(diagnostic, Object.freeze({
    phase: 'AUTHORITY_ISSUANCE',
    category: 'R2_WRITE_READBACK',
  }));
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.doesNotMatch(`${String(failure)}${JSON.stringify(diagnostic)}`,
    /PRIVATE_R2_PROVIDER_BODY|private\.example|503/iu);
  const forged = new Error('B2 authority issuance blocked');
  Object.defineProperty(forged, 'diagnostic', {
    value: { phase: 'AUTHORITY_ISSUANCE', category: 'R2_WRITE_READBACK' }, enumerable: true,
  });
  assert.equal(readB2AuthorityIssuanceDiagnostic(forged), undefined);
});

test('authority descriptor classifier accepts the initial candidate and an invariant approved renewal', () => {
  const candidateBytes = readFileSync(new URL(
    '../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url));
  const candidate = classifyB2AuthorityIssuanceDescriptor({ descriptorBytes: candidateBytes,
    descriptorSha256: hash(candidateBytes), currentSha: SHA, currentTreeSha: TREE,
    integrationBaseSha: '3'.repeat(40) });
  assert.equal(candidate.mode, 'initial');
  assert.equal(candidate.reviewedSourceSha, SHA);
  assert.equal(candidate.reviewedSourceTreeSha, TREE);

  const approvedDescriptor = JSON.parse(candidateBytes.toString('utf8'));
  approvedDescriptor.contract.state = 'approved';
  approvedDescriptor.contract.release_ready = true;
  approvedDescriptor.contract.reviewed_source_sha = SHA;
  approvedDescriptor.contract.reviewed_source_tree_sha = TREE;
  approvedDescriptor.contract.integration_base_sha = '3'.repeat(40);
  approvedDescriptor.contract.advisor_authorization_contract_sha256 = '4'.repeat(64);
  approvedDescriptor.contract.advisor_authorization_verifier_sha256 = '5'.repeat(64);
  approvedDescriptor.contract.advisor_authorization_tests_sha256 = '6'.repeat(64);
  approvedDescriptor.contract.function_inventory = { before: 34, after: 35 };
  approvedDescriptor.contract.functions = approvedDescriptor.contract.functions.map((entry, index) => ({
    ...entry, source_sha256: String((index % 8) + 1).repeat(64),
    config_sha256: String(((index + 1) % 8) + 1).repeat(64),
  }));
  approvedDescriptor.public_contract_sha256 = hash(Buffer.from(canonicalJson(approvedDescriptor.contract), 'utf8'));
  approvedDescriptor.private_authority.sha256 = 'a'.repeat(64);
  const approvedBytes = Buffer.from(`${JSON.stringify(approvedDescriptor, null, 2)}\n`, 'utf8');
  const renewal = classifyB2AuthorityIssuanceDescriptor({ descriptorBytes: approvedBytes,
    descriptorSha256: hash(approvedBytes), currentSha: 'b'.repeat(40), currentTreeSha: 'c'.repeat(40),
    integrationBaseSha: '3'.repeat(40) });
  assert.equal(renewal.mode, 'renewal');
  assert.equal(renewal.reviewedSourceSha, SHA);
  assert.equal(renewal.reviewedSourceTreeSha, TREE);
  assert.equal(canonicalJson(renewal.descriptor.contract), canonicalJson(approvedDescriptor.contract));

  const invalidApproved = structuredClone(approvedDescriptor);
  invalidApproved.private_authority.sha256 = null;
  const invalidApprovedBytes = Buffer.from(`${JSON.stringify(invalidApproved)}\n`, 'utf8');
  assert.throws(() => classifyB2AuthorityIssuanceDescriptor({ descriptorBytes: invalidApprovedBytes,
    descriptorSha256: hash(invalidApprovedBytes), currentSha: 'b'.repeat(40), currentTreeSha: 'c'.repeat(40),
    integrationBaseSha: '3'.repeat(40) }));

  const invalidCandidate = JSON.parse(candidateBytes.toString('utf8'));
  invalidCandidate.private_authority.sha256 = 'd'.repeat(64);
  const invalidCandidateBytes = Buffer.from(`${JSON.stringify(invalidCandidate)}\n`, 'utf8');
  assert.throws(() => classifyB2AuthorityIssuanceDescriptor({ descriptorBytes: invalidCandidateBytes,
    descriptorSha256: hash(invalidCandidateBytes), currentSha: SHA, currentTreeSha: TREE,
    integrationBaseSha: '3'.repeat(40) }));
});

test('approved authority renewal permits only the descriptor metadata delta from reviewed source', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nelyon-b2-renewal-boundary-'));
  const git = args => execFileSync('git', ['-C', root, '-c', 'user.name=Nelyon Test',
    '-c', 'user.email=nelyon-test@example.invalid', ...args], { encoding: 'utf8' }).trim();
  try {
    git(['init']);
    mkdirSync(path.join(root, '.github'), { recursive: true });
    writeFileSync(path.join(root, '.github', 'nelyon-web-control-centers-b2-release-descriptor.json'),
      '{"state":"candidate"}\n', 'utf8');
    writeFileSync(path.join(root, 'reviewed.txt'), 'reviewed\n', 'utf8');
    git(['add', '--', '.github/nelyon-web-control-centers-b2-release-descriptor.json', 'reviewed.txt']);
    git(['commit', '-m', 'reviewed source']);
    const reviewedSourceSha = git(['rev-parse', 'HEAD']);
    const reviewedSourceTreeSha = git(['rev-parse', 'HEAD^{tree}']);
    writeFileSync(path.join(root, '.github', 'nelyon-web-control-centers-b2-release-descriptor.json'),
      '{"state":"approved"}\n', 'utf8');
    git(['add', '--', '.github/nelyon-web-control-centers-b2-release-descriptor.json']);
    git(['commit', '-m', 'authority metadata']);
    const currentSha = git(['rev-parse', 'HEAD']);
    const verified = verifyB2ApprovedDescriptorRenewalBoundary({ repositoryRoot: root, currentSha,
      reviewedSourceSha, reviewedSourceTreeSha });
    assert.deepEqual(verified, { schemaVersion: 1, result: 'B2_AUTHORITY_RENEWAL_BOUNDARY_VERIFIED' });
    assert.throws(() => verifyB2ApprovedDescriptorRenewalBoundary({ repositoryRoot: root, currentSha,
      reviewedSourceSha, reviewedSourceTreeSha: 'f'.repeat(40) }));

    writeFileSync(path.join(root, 'reviewed.txt'), 'unexpected change\n', 'utf8');
    git(['add', '--', 'reviewed.txt']);
    git(['commit', '-m', 'unexpected source change']);
    assert.throws(() => verifyB2ApprovedDescriptorRenewalBoundary({ repositoryRoot: root,
      currentSha: git(['rev-parse', 'HEAD']), reviewedSourceSha, reviewedSourceTreeSha }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approved descriptor Git bytes are explicitly normalized to LF', () => {
  const attributes = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
  assert.match(attributes,
    /^\.github\/nelyon-web-control-centers-b2-release-descriptor\.json text eol=lf$/mu);
});

test('authority issuer rejects accessors and coercible identifiers without evaluating them', async () => {
  let reads = 0;
  const hostile = {
    observation: Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_AUTHORITY_OBSERVATION' }),
    approval: Object.freeze({ schemaVersion: 1, result: 'AUTHENTICATED_OWNER_APPROVAL' }),
    publisher: Object.freeze({ async publishBySha256() { throw new Error('must not run'); } }),
    issuedAt: '2026-11-22T10:03:00.000Z',
  };
  Object.defineProperty(hostile, 'preparation', { enumerable: true, get() { reads += 1; return {}; } });
  await assert.rejects(() => issueB2PrivateAuthority(hostile));
  assert.equal(reads, 0);

  const value = fixture();
  const observer = createB2AuthorityIssuanceGithubObserver({ fetchImpl: value.fetchImpl,
    githubToken: 'github-token-not-retained', repository: REPOSITORY, workflowPath: WORKFLOW,
    apiOrigin: 'https://api.github.com' });
  let coercions = 0;
  await assert.rejects(() => observer.authenticateObservation({
    runId: { toString() { coercions += 1; return OBSERVATION_RUN; } }, runAttempt: 1,
    approvedSha: SHA, approvedTreeSha: TREE, expectedObservationSha256: value.observed.observationSha256,
  }));
  assert.equal(coercions, 0);
});
