import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as provenance from '../scripts/nelyon-b2-recovery-provenance.mjs';

import {
  assertTrustedB2RecoveryProvenance,
  createB2RecoveryProvenanceLoader,
  loadApprovedB2RecoverySource,
  readTrustedB2RecoveryFunctionDeploymentProof,
  readTrustedB2RecoveryProvenance,
  readTrustedB2HistoricalRuntimeClosure,
  readTrustedB2HistoricalDescriptorBytes,
} from '../scripts/nelyon-b2-recovery-provenance.mjs';
import {
  buildPrivateRuntimeClosureFromExactBytes,
  privateRuntimeClosureMemberPaths,
} from '../scripts/nelyon-private-runtime-closure.mjs';
import {
  b2FunctionManifestSha256,
  canonicalB2FunctionDeploymentProof,
  createB2FunctionDeploymentNotStarted,
  createB2FunctionDeploymentAttempt,
  markB2FunctionDeploymentIntent,
  reconcileB2FunctionDeploymentTransition,
} from '../scripts/nelyon-b2-function-deployment-proof.mjs';

const REPOSITORY = 'andressan101989/ClipDAG-9bh0w4-26004-20260525';
const WORKFLOW = '.github/workflows/nelyon-production-release.yml';
const API = 'https://github.invalid';
const TOKEN = 'test-token-that-must-never-escape';
const RUN_ID = '90000000001';
const ATTEMPT = 2;
const RELEASE_ID = 'nelyon-20261108-001';
const SOURCE_SHA = 'a'.repeat(40);
const MANIFEST_SHA = 'b'.repeat(64);
const CLOSURE_SHA = 'c'.repeat(64);
const HEX = character => character.repeat(64);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const FUNCTION_NAMES = Object.freeze([
  'ai-handoff',
  'cleanup-stale-media-uploads',
  'content-safety-scan',
  'create-media-upload',
  'finalize-media-upload',
  'get-media-url',
  'process-scheduled-publications',
  'video-semantic-index',
]);
const FUNCTION_VERIFY_JWT = Object.freeze([false, false, true, true, true, true, false, true]);
const FUNCTION_MANIFEST = Object.freeze(FUNCTION_NAMES.map((name, index) => Object.freeze({
  name,
  verify_jwt: FUNCTION_VERIFY_JWT[index],
  source_sha256: sha256(`fixture-source:${name}`),
  config_sha256: sha256(`fixture-config:${name}`),
})));

function functionFixture(scenario = 'complete') {
  const manifestSha256 = b2FunctionManifestSha256(FUNCTION_MANIFEST);
  const beforeRows = FUNCTION_NAMES.filter(name => name !== 'process-scheduled-publications').map((name, index) => ({
    name,
    status: 'ACTIVE',
    verify_jwt: FUNCTION_VERIFY_JWT[FUNCTION_NAMES.indexOf(name)],
    version: index + 10,
    source_sha256: sha256(`provider-before:${name}`),
  }));
  const finalRows = FUNCTION_NAMES.map((name, index) => ({
    name,
    status: 'ACTIVE',
    verify_jwt: FUNCTION_VERIFY_JWT[index],
    version: name === 'process-scheduled-publications' ? 1 : beforeRows.find(row => row.name === name).version + 1,
    source_sha256: sha256(`provider-after:${name}`),
  }));
  if (scenario === 'not-started') {
    return {
      finalRows: beforeRows,
      proof: createB2FunctionDeploymentNotStarted({
        manifest: FUNCTION_MANIFEST,
        manifestSha256,
        capturedAt: '2026-11-08T11:59:00.000Z',
      }),
    };
  }
  let proof = createB2FunctionDeploymentAttempt({
    manifest: FUNCTION_MANIFEST,
    manifestSha256,
    beforeRows,
    capturedAt: '2026-11-08T11:59:00.000Z',
  });
  let currentRows = beforeRows.map(row => ({ ...row }));
  for (const [index, contract] of FUNCTION_MANIFEST.entries()) {
    proof = markB2FunctionDeploymentIntent({
      proof,
      manifest: FUNCTION_MANIFEST,
      manifestSha256,
      beforeRows,
      functionName: contract.name,
      capturedAt: new Date(Date.parse('2026-11-08T11:59:00.000Z') + ((index * 2 + 1) * 1000)).toISOString(),
    });
    const final = finalRows.find(row => row.name === contract.name);
    const existing = currentRows.findIndex(row => row.name === contract.name);
    if (existing < 0) currentRows.push({ ...final });
    else currentRows[existing] = { ...final };
    if (scenario === 'readback-failure' && index === 3) break;
    const commandSucceeded = !((scenario === 'partial-timeout' && index === 3)
      || (scenario === 'final-slug-recovery' && index === FUNCTION_MANIFEST.length - 1));
    proof = reconcileB2FunctionDeploymentTransition({
      proof,
      manifest: FUNCTION_MANIFEST,
      manifestSha256,
      beforeRows,
      afterRows: currentRows,
      functionName: contract.name,
      commandSucceeded,
      capturedAt: new Date(Date.parse('2026-11-08T11:59:00.000Z') + ((index * 2 + 2) * 1000)).toISOString(),
    });
    if (!commandSucceeded) break;
  }
  return { finalRows: currentRows, proof };
}

function canonical(value) {
  const normalize = item => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
      : item;
  return `${JSON.stringify(normalize(value))}\n`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const bytes = Buffer.from(raw);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, bytes);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length + bytes.length;
  }
  const centralOffset = offset;
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function receipt() {
  return {
    schemaVersion: 1,
    authorityId: 'b2-test-authority',
    descriptorSha256: HEX('1'),
    publicContractSha256: HEX('2'),
    privateAuthoritySha256: HEX('3'),
    bindingSha256: HEX('4'),
    successorCatalogSha256: HEX('5'),
    securityAdvisorSha256: HEX('6'),
    backupSha256: HEX('7'),
    approvalSha256: HEX('8'),
    verified: true,
  };
}

function baseProofs() {
  return ['migrations', 'functions'].map((stage, index) => ({
    runId: RUN_ID,
    runAttempt: ATTEMPT,
    releaseId: RELEASE_ID,
    approvedSha: SOURCE_SHA,
    manifestSha256: MANIFEST_SHA,
    stage,
    verifiedAt: `2026-11-08T12:0${index}:30.000Z`,
    receipt: receipt(),
  }));
}

function makeFixture({
  mutateProofs,
  mutateSource,
  mutateRun,
  mutateJobs,
  mutateArtifacts,
  mutateArchive,
  functionScenario = 'complete',
} = {}) {
  const proofs = baseProofs();
  mutateProofs?.(proofs);
  const proofBytes = Buffer.from(canonical(proofs));
  const functions = functionFixture(functionScenario);
  const functionProofBytes = Buffer.from(canonicalB2FunctionDeploymentProof(functions.proof));
  let archive = storedZip([
    ['protected-stage-proofs.json', proofBytes],
    ['function-deployment-proof.json', functionProofBytes],
    ['gate-proof.json', Buffer.from('{}\n')],
    ['release-observation.json', Buffer.from('{}\n')],
  ]);
  if (mutateArchive) archive = mutateArchive(Buffer.from(archive));

  const releaseManifest = { resources: { web_control_centers_b2_transition: { contract: {
    functions: FUNCTION_MANIFEST,
  } } } };
  const releaseArchive = storedZip([['bundle/manifest.json', canonical(releaseManifest)], ['bundle/manifest.sha256', HEX('1')],
    ['bundle/summary.md', 'fixture'], ['request.json', '{}\n'], ['remote-evidence.json', '{}\n']]);
  const source = {
    run_id: RUN_ID,
    run_attempt: ATTEMPT,
    release_id: RELEASE_ID,
    source_sha: SOURCE_SHA,
    repository: REPOSITORY,
    mutation_status: 'completed',
    post_snapshot_status: 'failure',
    postcheck_status: 'skipped',
    gate_artifact: {
      id: '7101',
      name: `nelyon-gate-evidence-${RUN_ID}-${ATTEMPT}`,
      digest: `sha256:${sha256(archive)}`,
    },
    release_artifact: {
      id: '7102',
      name: `nelyon-release-${RUN_ID}-${ATTEMPT}`,
      digest: `sha256:${sha256(releaseArchive)}`,
    },
    manifest_sha256: MANIFEST_SHA,
    pre_snapshot_evidence_sha256: HEX('d'),
    post_snapshot_evidence_sha256: HEX('e'),
    expected_migrations: [{ blob: 'f'.repeat(40), name: '20261108120000_web_control_centers_b2_scheduled_publishing' }],
    expected_migration_count: 367,
    expected_latest_migration: '20261108120000_web_control_centers_b2_scheduled_publishing',
    edge_functions: functions.finalRows,
    productive_resources: ['migration:20261108120000_web_control_centers_b2_scheduled_publishing',
      ...functions.finalRows.map(row => `function:${row.name}`)],
    premium_relation_security_sha256: HEX('b'),
    premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
    protected_stage_proof_sha256: sha256(proofBytes),
    runtime_closure_sha256: CLOSURE_SHA,
  };
  mutateSource?.(source);
  const policy = {
    schema_version: 2,
    repository: REPOSITORY,
    workflow_path: WORKFLOW,
    postcheck_recovery: { approved_sources: [source] },
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);

  const run = {
    id: Number(RUN_ID),
    run_attempt: ATTEMPT,
    status: 'completed',
    conclusion: 'failure',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: SOURCE_SHA,
    path: WORKFLOW,
    repository: { full_name: REPOSITORY },
  };
  mutateRun?.(run);
  const steps = proofs.map((proof, index) => ({
    name: `B2 protected ${proof.stage}`,
    status: 'completed',
    conclusion: 'success',
    number: index + 1,
    started_at: `2026-11-08T12:0${index}:00.000Z`,
    completed_at: `2026-11-08T12:0${index}:59.000Z`,
  }));
  const jobs = [{ id: 8101, run_id: Number(RUN_ID), run_attempt: ATTEMPT, status: 'completed', conclusion: 'success', steps }];
  mutateJobs?.(jobs);
  const artifacts = [
    { id: 7101, name: source.gate_artifact.name, digest: source.gate_artifact.digest, expired: false },
    { id: 7102, name: source.release_artifact.name, digest: source.release_artifact.digest, expired: false },
  ];
  mutateArtifacts?.(artifacts);
  return { archive, releaseArchive, artifacts, jobs, policyBytes, proofs, run, source };
}

function response(value, status = 200, headers = {}) {
  return value instanceof Uint8Array
    ? new Response(value, { status, headers: { 'content-type': 'application/zip', 'content-length': String(value.length), ...headers } })
    : new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function fakeGithub(fixture, { paginate = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init?.method, 'GET');
    assert.equal(init?.headers?.authorization, `Bearer ${TOKEN}`);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/zip')
      && init?.headers?.accept !== 'application/vnd.github+json') {
      return response({ message: 'Unsupported Media Type' }, 415);
    }
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/attempts/${ATTEMPT}`)) return response(fixture.run);
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/attempts/${ATTEMPT}/jobs`)) {
      const page = Number(parsed.searchParams.get('page'));
      if (!paginate) return response({ total_count: fixture.jobs.length, jobs: fixture.jobs });
      if (page === 1) {
        const filler = Array.from({ length: 100 }, (_, index) => ({
          id: 9000 + index,
          run_id: Number(RUN_ID),
          run_attempt: ATTEMPT,
          status: 'completed',
          conclusion: 'skipped',
          steps: [],
        }));
        return response({ total_count: 101, jobs: filler });
      }
      return response({ total_count: 101, jobs: fixture.jobs });
    }
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/artifacts`)) {
      const page = Number(parsed.searchParams.get('page'));
      if (!paginate) return response({ total_count: fixture.artifacts.length, artifacts: fixture.artifacts });
      if (page === 1) {
        const filler = Array.from({ length: 100 }, (_, index) => ({
          id: 10000 + index,
          name: `unrelated-${index}`,
          digest: `sha256:${HEX('0')}`,
          expired: false,
        }));
        return response({ total_count: 102, artifacts: filler });
      }
      return response({ total_count: 102, artifacts: fixture.artifacts });
    }
    if (parsed.pathname.endsWith('/actions/artifacts/7101/zip')) return response(fixture.archive);
    if (parsed.pathname.endsWith('/actions/artifacts/7102/zip')) return response(fixture.releaseArchive);
    if (parsed.pathname.endsWith('/actions/artifacts/7103/zip')) return response(fixture.adminArchive);
    return response({ message: 'not found' }, 404);
  };
  return { calls, fetchImpl };
}

function approved(fixture) {
  return loadApprovedB2RecoverySource({
    policyBytes: fixture.policyBytes,
    expectedPolicySha256: sha256(fixture.policyBytes),
    runId: RUN_ID,
    runAttempt: ATTEMPT,
  });
}

function loader(fetchImpl) {
  return createB2RecoveryProvenanceLoader({
    fetchImpl,
    githubToken: TOKEN,
    repository: REPOSITORY,
    workflowPath: WORKFLOW,
    apiOrigin: API,
  });
}

function assertRejected(operation) {
  return assert.rejects(operation, error => {
    assert.equal(error?.code, 'B2_RECOVERY_PROVENANCE_INVALID');
    assert.equal(error?.message, 'B2 recovery provenance rejected');
    assert.equal(error?.stack, 'Error: B2 recovery provenance rejected');
    assert.doesNotMatch(JSON.stringify(error), /test-token|protected-stage|authority/i);
    return true;
  });
}

test('separate exact-attempt authorization binds real policy and mints the existing source capability', async () => {
  const fixture = makeFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const authorization = { schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: REPOSITORY, workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
    approved_sources: [{ source: fixture.source, admin_artifact: null, postcheck_chain: null }] };
  const bytes = Buffer.from(canonical(authorization));
  const options = { authorizationBytes: bytes, expectedAuthorizationSha256: sha256(bytes), policyBytes,
    expectedPolicySha256: sha256(policyBytes), runId: RUN_ID, runAttempt: ATTEMPT };
  assert.equal(typeof provenance.loadB2RecoveryAuthorization, 'function');
  const source = provenance.loadB2RecoveryAuthorization(options);
  assert.equal(provenance.loadB2RecoveryAuthorization({ ...options, runAttempt: null }).runAttempt, ATTEMPT,
    'the attempt is selected from authorization bytes rather than an external selector');
  const github = fakeGithub(fixture);
  const result = await loader(github.fetchImpl).loadExactAttempt({ approvedSource: source });
  assert.equal(result.runId, RUN_ID);
  const validReleaseArchive = fixture.releaseArchive;
  fixture.releaseArchive = Buffer.from('tampered release archive');
  await assertRejected(loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: source }));
  fixture.releaseArchive = validReleaseArchive;
  assert.throws(() => provenance.loadB2RecoveryAuthorization({ ...options, expectedAuthorizationSha256: HEX('0') }),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  assert.throws(() => provenance.loadB2RecoveryAuthorization({ ...options, runAttempt: ATTEMPT + 1 }),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
});

test('recovery archive downloads negotiate the GitHub REST media type before receiving ZIP bytes', async () => {
  const fixture = makeFixture();
  const github = fakeGithub(fixture);
  await loader(github.fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) });
  const archiveCalls = github.calls.filter(call => new URL(call.url).pathname.endsWith('/zip'));
  assert.equal(archiveCalls.length, 2);
  for (const call of archiveCalls) {
    assert.equal(call.init?.headers?.accept, 'application/vnd.github+json');
  }
});

test('separate Admin authorization pins the exact unexpired Admin artifact', async () => {
  const fixture = makeFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  fixture.adminArchive = storedZip([['admin-web-manifest.json', '{}\n'], ['admin-web-manifest.sha256', HEX('1')]]);
  const admin = { id: '7103', name: `nelyon-admin-evidence-${RUN_ID}-${ATTEMPT}`, digest: `sha256:${sha256(fixture.adminArchive)}` };
  const bytes = Buffer.from(canonical({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: REPOSITORY, workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
    approved_sources: [{ source: fixture.source, admin_artifact: admin, postcheck_chain: null }] }));
  const source = provenance.loadB2RecoveryAuthorization({ authorizationBytes: bytes,
    expectedAuthorizationSha256: sha256(bytes), policyBytes, expectedPolicySha256: sha256(policyBytes),
    runId: RUN_ID, runAttempt: ATTEMPT });
  fixture.artifacts.push({ ...admin, id: Number(admin.id), expired: false });
  const github = fakeGithub(fixture);
  await loader(github.fetchImpl).loadExactAttempt({ approvedSource: source });
  assert.equal(github.calls.filter(call => new URL(call.url).pathname.endsWith('/zip')).length, 3);
  const validArchive = fixture.adminArchive;
  fixture.adminArchive = Buffer.from('tampered');
  await assertRejected(loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: source }));
  fixture.adminArchive = validArchive;
  fixture.artifacts.at(-1).digest = `sha256:${HEX('4')}`;
  await assertRejected(loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: source }));
});

test('separate authorization rejects policy drift, unknown fields, duplicates and malformed bytes', () => {
  const fixture = makeFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const doc = { schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1', repository: REPOSITORY,
    workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
    approved_sources: [{ source: fixture.source, admin_artifact: null, postcheck_chain: null }] };
  const load = bytes => provenance.loadB2RecoveryAuthorization({ authorizationBytes: bytes,
    expectedAuthorizationSha256: sha256(bytes), policyBytes, expectedPolicySha256: sha256(policyBytes),
    runId: RUN_ID, runAttempt: ATTEMPT });
  for (const mutation of [
    value => { value.policy_sha256 = HEX('0'); },
    value => { value.kind = 'candidate'; },
    value => { value.extra = true; },
    value => { value.approved_sources.push(structuredClone(value.approved_sources[0])); },
    value => { value.approved_sources[0].source.run_attempt = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.approved_sources[0].admin_artifact = { ...value.approved_sources[0].source.gate_artifact }; },
    value => { value.approved_sources = []; },
  ]) {
    const value = structuredClone(doc); mutation(value);
    assert.throws(() => load(Buffer.from(canonical(value))), { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  }
  assert.throws(() => load(Buffer.from('{"schema_version":1,"schema_version":1}\n')),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  assert.throws(() => load(Buffer.from([0xff, 0xfe])), { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  assert.throws(() => load(Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
});

test('separate authorization rejects unsafe or extra archive entries even with a pinned digest', async () => {
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  for (const extra of ['../escape', 'bundle/../escape', 'unapproved.json', 'request.json']) {
    const fixture = makeFixture();
    const entries = [['bundle/manifest.json', '{}\n'], ['bundle/manifest.sha256', HEX('1')],
      ['bundle/summary.md', 'fixture'], ['request.json', '{}\n'], ['remote-evidence.json', '{}\n'], [extra, 'bad']];
    fixture.releaseArchive = storedZip(entries);
    fixture.source.release_artifact.digest = `sha256:${sha256(fixture.releaseArchive)}`;
    fixture.artifacts[1].digest = fixture.source.release_artifact.digest;
    const bytes = Buffer.from(canonical({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
      repository: REPOSITORY, workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
      approved_sources: [{ source: fixture.source, admin_artifact: null, postcheck_chain: null }] }));
    const source = provenance.loadB2RecoveryAuthorization({ authorizationBytes: bytes,
      expectedAuthorizationSha256: sha256(bytes), policyBytes, expectedPolicySha256: sha256(policyBytes),
      runId: RUN_ID, runAttempt: ATTEMPT });
    await assertRejected(loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: source }));
  }
});

test('one-hop selector is resolved only from the separately pinned authorization', () => {
  const fixture = makeFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const chainId = '90000000002'; const attempt = 3;
  const artifact = (id, prefix) => ({ id, name: `${prefix}-${chainId}-${attempt}`, digest: `sha256:${HEX('a')}` });
  const chain = { run_id: chainId, run_attempt: attempt, release_id: RELEASE_ID, source_sha: SOURCE_SHA,
    manifest_sha256: MANIFEST_SHA, runtime_closure_sha256: CLOSURE_SHA,
    release_artifact: artifact('7201', 'nelyon-release'), gate_artifact: artifact('7202', 'nelyon-gate-evidence'),
    recovery_artifact: artifact('7203', 'nelyon-postcheck-recovery') };
  const bytes = Buffer.from(canonical({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: REPOSITORY, workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
    approved_sources: [{ source: fixture.source, admin_artifact: null, postcheck_chain: chain }] }));
  const selected = provenance.loadB2RecoveryAuthorization({ authorizationBytes: bytes,
    expectedAuthorizationSha256: sha256(bytes), policyBytes, expectedPolicySha256: sha256(policyBytes),
    runId: chainId, runAttempt: null });
  assert.equal(selected.runId, chainId);
  assert.equal(selected.runAttempt, attempt);
});

test('one-hop source requires exact successful attempt, archive bytes and historical closure', async () => {
  const fixture = makeFixture();
  const policyBytes = readFileSync(new URL('../.github/nelyon-production-release-policy.json', import.meta.url));
  const files = privateRuntimeClosureMemberPaths().map(member => ({ path: member,
    bytes: readFileSync(new URL(`../${member}`, import.meta.url)) }));
  const closure = buildPrivateRuntimeClosureFromExactBytes({ files });
  const chainId = '90000000002'; const attempt = 3;
  const chainManifest = Buffer.from(canonical({ identity: { approved_sha: SOURCE_SHA, mode: 'postcheck_recovery',
    run_id: chainId, run_attempt: attempt, release_id: RELEASE_ID }, runtime_closure: closure }));
  const archives = {
    '7201': storedZip([['bundle/manifest.json', chainManifest], ['bundle/manifest.sha256', sha256(chainManifest)],
      ['bundle/summary.md', 'fixture'], ['request.json', '{}\n'], ['remote-evidence.json', '{}\n']]),
    '7202': storedZip([['gate-proof.json', '{}\n']]),
    '7203': storedZip([['verified-source.json', '{}\n'], ['production-recovery.json', '{}\n'], ['postcheck-recovery-result.json', '{}\n']]),
  };
  const artifact = (id, prefix) => ({ id, name: `${prefix}-${chainId}-${attempt}`, digest: `sha256:${sha256(archives[id])}` });
  const chain = { run_id: chainId, run_attempt: attempt, release_id: RELEASE_ID, source_sha: SOURCE_SHA,
    manifest_sha256: sha256(chainManifest), runtime_closure_sha256: closure.closure_sha256,
    release_artifact: artifact('7201', 'nelyon-release'), gate_artifact: artifact('7202', 'nelyon-gate-evidence'),
    recovery_artifact: artifact('7203', 'nelyon-postcheck-recovery') };
  const bytes = Buffer.from(canonical({ schema_version: 1, kind: 'nelyon-b2-exact-attempt-recovery-v1',
    repository: REPOSITORY, workflow_path: WORKFLOW, policy_sha256: sha256(policyBytes),
    approved_sources: [{ source: fixture.source, admin_artifact: null, postcheck_chain: chain }] }));
  const approvedSource = provenance.loadB2RecoveryAuthorization({ authorizationBytes: bytes,
    expectedAuthorizationSha256: sha256(bytes), policyBytes, expectedPolicySha256: sha256(policyBytes),
    runId: chainId, runAttempt: null });
  const chainRun = { id: Number(chainId), run_attempt: attempt, status: 'completed', conclusion: 'success', head_branch: 'main',
    event: 'workflow_dispatch', head_sha: SOURCE_SHA, path: WORKFLOW, repository: { full_name: REPOSITORY } };
  const original = fakeGithub(fixture);
  const transport = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(`/actions/runs/${chainId}/attempts/${attempt}`)) return response(chainRun);
    if (parsed.pathname.endsWith(`/actions/runs/${chainId}/artifacts`)) {
      const artifacts = [chain.release_artifact, chain.gate_artifact, chain.recovery_artifact]
        .map(item => ({ ...item, id: Number(item.id), expired: false }));
      return response({ total_count: artifacts.length, artifacts });
    }
    const archiveId = parsed.pathname.match(/\/actions\/artifacts\/(720[123])\/zip$/)?.[1];
    if (archiveId) return response(archives[archiveId]);
    const marker = `/repos/${REPOSITORY}/contents/`;
    if (parsed.pathname.includes(marker)) {
      const member = decodeURIComponent(parsed.pathname.split(marker)[1]);
      const file = files.find(item => item.path === member); assert.ok(file);
      const header = Buffer.from(`blob ${file.bytes.length}\0`);
      return response({ path: member, type: 'file', encoding: 'base64', size: file.bytes.length,
        sha: createHash('sha1').update(header).update(file.bytes).digest('hex'), content: file.bytes.toString('base64') });
    }
    return original.fetchImpl(url, init);
  };
  const api = loader(transport);
  const recovered = await api.loadExactAttempt({ approvedSource });
  assert.equal(typeof api.loadExactChain, 'function');
  const authenticated = await api.loadExactChain({ recoveryProvenance: recovered });
  assert.equal(authenticated.runId, chainId);
  assert.throws(() => provenance.readTrustedB2ChainProvenance(structuredClone(authenticated), recovered),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  const originalArchive = archives['7203'];
  archives['7203'] = Buffer.from('altered chain archive');
  await assertRejected(api.loadExactChain({ recoveryProvenance: recovered }));
  archives['7203'] = originalArchive;
  chainRun.head_sha = 'f'.repeat(40);
  await assertRejected(api.loadExactChain({ recoveryProvenance: recovered }));
  chainRun.head_sha = SOURCE_SHA;
  chainRun.run_attempt += 1;
  await assertRejected(api.loadExactChain({ recoveryProvenance: recovered }));
  chainRun.run_attempt -= 1;
  const originalBytes = files[0].bytes;
  files[0].bytes = Buffer.from('altered historical closure member');
  await assertRejected(api.loadExactChain({ recoveryProvenance: recovered }));
  files[0].bytes = originalBytes;
});

test('approved source authenticates exact policy bytes and copied capabilities fail before fetch', async () => {
  const fixture = makeFixture();
  assert.throws(() => loadApprovedB2RecoverySource({
    policyBytes: fixture.policyBytes,
    expectedPolicySha256: HEX('0'),
    runId: RUN_ID,
    runAttempt: ATTEMPT,
  }), { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  const source = approved(fixture);
  assert.deepEqual(source, {
    schemaVersion: 1,
    result: 'APPROVED_SOURCE_AUTHENTICATED',
    runId: RUN_ID,
    runAttempt: ATTEMPT,
  });
  assert(Object.isFrozen(source));
  const transport = fakeGithub(fixture);
  await assertRejected(() => loader(transport.fetchImpl).loadExactAttempt({ approvedSource: { ...source } }));
  assert.equal(transport.calls.length, 0);

  const missingClosure = makeFixture({ mutateSource: value => { delete value.runtime_closure_sha256; } });
  assert.throws(() => approved(missingClosure), { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
});

test('legacy records may coexist but cannot be selected as a B2 recovery source', () => {
  const fixture = makeFixture();
  const policy = JSON.parse(fixture.policyBytes.toString('utf8'));
  policy.postcheck_recovery.approved_sources.unshift({
    run_id: '80000000001',
    run_attempt: 1,
    release_id: 'legacy-source',
    source_sha: '0'.repeat(40),
    repository: REPOSITORY,
  });
  fixture.policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
  assert.doesNotThrow(() => approved(fixture));
  assert.throws(() => loadApprovedB2RecoverySource({
    policyBytes: fixture.policyBytes,
    expectedPolicySha256: sha256(fixture.policyBytes),
    runId: '80000000001',
    runAttempt: 1,
  }), { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
});

test('known edge transition evidence remains part of the strict authenticated source schema', () => {
  const fixture = makeFixture({ mutateSource: source => {
    source.edge_transitions = [{
      name: 'scheduled-publication-runner',
      from: { source_sha256: HEX('1'), status: 'ACTIVE', verify_jwt: false, version: 1 },
      to: { source_sha256: HEX('2'), status: 'ACTIVE', verify_jwt: false, version: 2 },
    }];
  } });
  assert.doesNotThrow(() => approved(fixture));
});

test('exact attempt uses bounded pagination, authenticates archive/proof bytes and returns a closed brand', async () => {
  const fixture = makeFixture();
  const transport = fakeGithub(fixture, { paginate: true });
  const result = await loader(transport.fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) });
  assertTrustedB2RecoveryProvenance(result);
  assert(Object.isFrozen(result));
  assert.deepEqual(result, {
    schemaVersion: 1,
    result: 'EXACT_ATTEMPT_VERIFIED',
    repository: REPOSITORY,
    workflowPath: WORKFLOW,
    runId: RUN_ID,
    runAttempt: ATTEMPT,
    sourceSha: SOURCE_SHA,
    artifactDigests: {
      gate: fixture.source.gate_artifact.digest,
      release: fixture.source.release_artifact.digest,
    },
    protectedStageProofSha256: fixture.source.protected_stage_proof_sha256,
    protectedStepCount: 2,
    sourceRuntimeClosureSha256: CLOSURE_SHA,
    functionDeploymentProofSha256: readTrustedB2RecoveryProvenance(result).functionDeploymentProofSha256,
  });
  assert.doesNotMatch(JSON.stringify(result), /verifiedAt|receipt|test-token|startedAt|completedAt/);
  const state = readTrustedB2RecoveryProvenance(result);
  assert.equal(sha256(state.proofBytes), fixture.source.protected_stage_proof_sha256);
  assert.deepEqual(state.protectedSteps.steps.map(item => item.name), ['B2 protected migrations', 'B2 protected functions']);
  assert.deepEqual(state.proofs, fixture.proofs);
  const functionProof = readTrustedB2RecoveryFunctionDeploymentProof(result);
  assert.equal(functionProof.result, 'FUNCTIONS_EXECUTED');
  assert.equal(functionProof.receipts.length, 8);
  functionProof.receipts[0].name = 'caller-mutation';
  assert.notEqual(readTrustedB2RecoveryFunctionDeploymentProof(result).receipts[0].name, 'caller-mutation');
  assert(Object.isFrozen(state.protectedSteps));
  assert.equal(transport.calls.filter(item => item.url.includes('/jobs?')).length, 2);
  assert.equal(transport.calls.filter(item => item.url.includes('/artifacts?')).length, 2);
  assert.throws(() => assertTrustedB2RecoveryProvenance(JSON.parse(JSON.stringify(result))), {
    code: 'B2_RECOVERY_PROVENANCE_INVALID',
  });
});

test('actual-sized deploy job admits more than 100 bounded steps while retaining exact protected stages', async () => {
  const fixture = makeFixture({ mutateJobs: jobs => {
    const protectedSteps = jobs[0].steps;
    jobs[0].steps = [
      ...Array.from({ length: 108 }, (_, index) => ({ name: `ordinary-before-${index}`, status: 'completed', conclusion: 'success', number: index + 1,
        started_at: '2026-11-08T11:00:00.000Z', completed_at: '2026-11-08T11:00:01.000Z' })),
      protectedSteps[0], protectedSteps[1],
      ...Array.from({ length: 108 }, (_, index) => ({ name: `ordinary-after-${index}`, status: 'completed', conclusion: 'success', number: index + 111,
        started_at: '2026-11-08T13:00:00.000Z', completed_at: '2026-11-08T13:00:01.000Z' })),
    ];
  } });
  const result = await loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) });
  assert.deepEqual(readTrustedB2RecoveryProvenance(result).protectedSteps.steps.map(item => item.name),
    ['B2 protected migrations', 'B2 protected functions']);
});

for (const [scenario, expected] of [
  ['not-started', { result: 'NOT_STARTED', receipts: 0, disposition: null }],
  ['partial-timeout', { result: 'INCOMPLETE', receipts: 3, disposition: 'CHANGED_AFTER_FAILED_COMMAND' }],
  ['readback-failure', { result: 'INCOMPLETE', receipts: 3, disposition: 'DISPATCH_INTENT' }],
  ['final-slug-recovery', { result: 'INCOMPLETE', receipts: 7, disposition: 'CHANGED_AFTER_FAILED_COMMAND' }],
]) {
  test(`authenticated recovery archive accepts the recoverable ${scenario} function checkpoint`, async () => {
    const fixture = makeFixture({ functionScenario: scenario });
    const result = await loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({
      approvedSource: approved(fixture),
    });
    const proof = readTrustedB2RecoveryFunctionDeploymentProof(result);
    assert.equal(proof.result, expected.result);
    assert.equal(proof.receipts.length, expected.receipts);
    assert.equal(proof.in_flight?.disposition ?? null, expected.disposition);
  });
}

test('candidate provenance fields are rejected before transport', async () => {
  const fixture = makeFixture();
  const transport = fakeGithub(fixture);
  await assertRejected(() => loader(transport.fetchImpl).loadExactAttempt({
    approvedSource: approved(fixture),
    protectedSteps: { steps: [] },
  }));
  await assertRejected(() => loader(transport.fetchImpl).loadExactAttempt({
    approvedSource: approved(fixture),
    currentRuntimeClosureSha256: CLOSURE_SHA,
  }));
  assert.equal(transport.calls.length, 0);
});

for (const [name, mutate] of [
  ['wrong run id', fixture => { fixture.run.id += 1; }],
  ['wrong attempt', fixture => { fixture.run.run_attempt += 1; }],
  ['wrong repository', fixture => { fixture.run.repository.full_name = 'other/repository'; }],
  ['wrong workflow', fixture => { fixture.run.path = '.github/workflows/other.yml'; }],
  ['wrong head', fixture => { fixture.run.head_sha = 'f'.repeat(40); }],
  ['wrong event', fixture => { fixture.run.event = 'push'; }],
  ['wrong conclusion', fixture => { fixture.run.conclusion = 'success'; }],
]) {
  test(`exact attempt rejects ${name}`, async () => {
    const fixture = makeFixture();
    mutate(fixture);
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });
}

test('artifact metadata is exact, unique, unexpired and content-addressed', async t => {
  const cases = [
    ['missing', items => items.shift()],
    ['duplicate', items => items.push({ ...items[0], id: 7999 })],
    ['wrong id', items => { items[0].id = 7999; }],
    ['wrong digest', items => { items[0].digest = `sha256:${HEX('0')}`; }],
    ['expired', items => { items[0].expired = true; }],
  ];
  for (const [name, mutation] of cases) await t.test(name, async () => {
    const fixture = makeFixture({ mutateArtifacts: mutation });
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });

  const corrupt = makeFixture();
  corrupt.archive[35] ^= 0xff;
  await t.test('downloaded archive digest', () => assertRejected(
    () => loader(fakeGithub(corrupt).fetchImpl).loadExactAttempt({ approvedSource: approved(corrupt) }),
  ));
});

test('proof digest, canonical bytes, protected step uniqueness and exact interval are enforced', async t => {
  await t.test('wrong independently approved proof digest', async () => {
    const fixture = makeFixture({ mutateSource: source => { source.protected_stage_proof_sha256 = HEX('0'); } });
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });
  const cases = [
    ['missing protected step', fixture => { fixture.jobs[0].steps.pop(); }],
    ['duplicate protected step', fixture => { fixture.jobs[0].steps.push({ ...fixture.jobs[0].steps[0] }); }],
    ['step starts after proof', fixture => { fixture.jobs[0].steps[0].started_at = '2026-11-08T12:00:31.000Z'; }],
    ['step completes before proof', fixture => { fixture.jobs[0].steps[0].completed_at = '2026-11-08T12:00:29.000Z'; }],
  ];
  for (const [name, mutation] of cases) await t.test(name, async () => {
    const fixture = makeFixture();
    mutation(fixture);
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });

  await t.test('proof bytes cannot name an unapproved stage', async () => {
    const fixture = makeFixture({ mutateProofs: proofs => { proofs[1].stage = 'admin_route'; } });
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });

  await t.test('GitHub seconds precision is normalized conservatively', async () => {
    const fixture = makeFixture({ mutateJobs: jobs => {
      jobs[0].steps[0].started_at = '2026-11-08T12:00:00Z';
      jobs[0].steps[0].completed_at = '2026-11-08T12:00:59Z';
    } });
    const result = await loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) });
    const state = readTrustedB2RecoveryProvenance(result);
    assert.equal(state.protectedSteps.steps[0].startedAt, '2026-11-08T12:00:00.000Z');
    assert.equal(state.protectedSteps.steps[0].completedAt, '2026-11-08T12:00:59.999Z');
  });

  await t.test('seconds precision cannot hide a proof beyond the completed interval', async () => {
    const fixture = makeFixture({ mutateJobs: jobs => { jobs[0].steps[0].completed_at = '2026-11-08T12:00:29Z'; } });
    await assertRejected(() => loader(fakeGithub(fixture).fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  });
});

test('pagination is bounded and inconsistent totals fail closed', async () => {
  const fixture = makeFixture();
  const calls = [];
  const transport = fakeGithub(fixture);
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('/jobs?')) return response({ total_count: 501, jobs: [] });
    return transport.fetchImpl(url, init);
  };
  await assertRejected(() => loader(fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) }));
  assert.equal(calls.filter(url => url.includes('/jobs?')).length, 1);
});

test('the documented exact 500-record bound succeeds without requesting page six', async () => {
  const fixture = makeFixture();
  const calls = [];
  const fillerJobs = page => Array.from({ length: 100 }, (_, index) => ({ id: page * 1000 + index,
    run_id: Number(RUN_ID), run_attempt: ATTEMPT, status: 'completed', conclusion: 'skipped', steps: [] }));
  const fillerArtifacts = page => Array.from({ length: 100 }, (_, index) => ({ id: page * 10000 + index,
    name: `unrelated-${page}-${index}`, digest: `sha256:${HEX('0')}`, expired: false }));
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/attempts/${ATTEMPT}`)) return response(fixture.run);
    const page = Number(parsed.searchParams.get('page'));
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/attempts/${ATTEMPT}/jobs`)) {
      const jobs = page < 5 ? fillerJobs(page) : [...fillerJobs(page).slice(0, 99), fixture.jobs[0]];
      return response({ total_count: 500, jobs });
    }
    if (parsed.pathname.endsWith(`/actions/runs/${RUN_ID}/artifacts`)) {
      const artifacts = page < 5 ? fillerArtifacts(page) : [...fillerArtifacts(page).slice(0, 98), ...fixture.artifacts];
      return response({ total_count: 500, artifacts });
    }
    if (parsed.pathname.endsWith('/actions/artifacts/7101/zip')) return response(fixture.archive);
    if (parsed.pathname.endsWith('/actions/artifacts/7102/zip')) return response(fixture.releaseArchive);
    return response({ message: 'not found' }, 404);
  };
  const result = await loader(fetchImpl).loadExactAttempt({ approvedSource: approved(fixture) });
  assertTrustedB2RecoveryProvenance(result);
  assert.equal(calls.filter(url => url.includes('?per_page=100&page=5')).length, 2);
  assert.equal(calls.some(url => url.includes('page=6')), false);
});

test('historical closure is recomputed from authenticated source Git bytes without execution', async () => {
  const files = privateRuntimeClosureMemberPaths().map(member => ({ path: member, bytes: readFileSync(new URL(`../${member}`, import.meta.url)) }));
  const descriptorBytes = readFileSync(new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url));
  const closure = buildPrivateRuntimeClosureFromExactBytes({ files });
  const fixture = makeFixture({ mutateSource: source => { source.runtime_closure_sha256 = closure.closure_sha256; } });
  const transport = fakeGithub(fixture);
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const marker = `/repos/${REPOSITORY}/contents/`;
    if (parsed.pathname.includes(marker)) {
      assert.equal(parsed.searchParams.get('ref'), SOURCE_SHA);
      const member = decodeURIComponent(parsed.pathname.split(marker)[1]);
      const file = member === '.github/nelyon-web-control-centers-b2-release-descriptor.json'
        ? { path: member, bytes: descriptorBytes }
        : files.find(item => item.path === member);
      assert.ok(file, member);
      const header = Buffer.from(`blob ${file.bytes.length}\0`, 'utf8');
      return response({ path: member, type: 'file', encoding: 'base64', size: file.bytes.length,
        sha: createHash('sha1').update(header).update(file.bytes).digest('hex'), content: file.bytes.toString('base64') });
    }
    return transport.fetchImpl(url, init);
  };
  const provenanceLoader = loader(fetchImpl);
  const provenance = await provenanceLoader.loadExactAttempt({ approvedSource: approved(fixture) });
  const historical = await provenanceLoader.loadHistoricalRuntimeClosure({ recoveryProvenance: provenance });
  const state = readTrustedB2HistoricalRuntimeClosure(historical, provenance);
  assert.equal(state.sourceSha, SOURCE_SHA);
  assert.deepEqual(state.closure, closure);
  assert.deepEqual(readTrustedB2HistoricalDescriptorBytes(historical, provenance), descriptorBytes);
  assert.throws(() => readTrustedB2HistoricalRuntimeClosure(structuredClone(historical), provenance),
    { code: 'B2_RECOVERY_PROVENANCE_INVALID' });
  await assertRejected(() => provenanceLoader.loadHistoricalRuntimeClosure({ recoveryProvenance: structuredClone(provenance) }));

  const driftFetch = async (url, init) => {
    const responseValue = await fetchImpl(url, init);
    const parsed = new URL(url);
    if (!parsed.pathname.includes('/contents/scripts/nelyon-private-authority.mjs')) return responseValue;
    const value = await responseValue.json();
    const bytes = Buffer.from(`${Buffer.from(value.content, 'base64').toString('utf8')}\n// drift\n`);
    const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
    return response({ ...value, size: bytes.length, sha: createHash('sha1').update(header).update(bytes).digest('hex'),
      content: bytes.toString('base64') });
  };
  const driftLoader = loader(driftFetch);
  const driftProvenance = await driftLoader.loadExactAttempt({ approvedSource: approved(fixture) });
  await assertRejected(() => driftLoader.loadHistoricalRuntimeClosure({ recoveryProvenance: driftProvenance }));
});

test('module has no production-release import and does not execute historical source code', () => {
  const source = readFileSync(new URL('../scripts/nelyon-b2-recovery-provenance.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/nelyon-production-release|import\s*\(|node:vm|child_process|eval\s*\(/);
});
