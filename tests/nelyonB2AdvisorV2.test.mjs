import { createReleaseAuthorityContext } from '../scripts/nelyon-release-authority-context.mjs';
import { verifyB2AdvisorPrestate, b2AdvisorObjectIdentity } from '../scripts/nelyon-production-snapshot-adapter.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseB2PrivateAuthority } from '../scripts/nelyon-private-authority.mjs';
import {
  B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256,
  B2_ADVISOR_CHANGED_OBJECT_IDENTITIES,
  computeB2AdvisorAuthorizations,
} from '../scripts/nelyon-b2-authority-preparation.mjs';
import { b2SyntheticCompleteSuccessorCatalog } from './fixtures/nelyonB2CompleteAuthorityFixture.mjs';
import { readFileSync } from 'node:fs';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
const at = '2026-11-08T12:00:00.000Z';
const fingerprint = '1'.repeat(64);
const item = { fingerprint, level: 'WARN', resource_kind: 'function' };
const baselineSha256 = hash(canonical([item]) + '\n');
const facts = { fingerprint, identity: `advisor:${fingerprint}`, objectIdentity: 'function:public.synthetic_rpc',
  type: 'function', severity: 'WARN', objectSha256: '2'.repeat(64) };
const claims = { attestationSha256: '3'.repeat(64), negativeEvidenceSha256: '4'.repeat(64), originSha256: '5'.repeat(64) };
const record = (action, projection) => ({ action, identity: projection.identity,
  expectedCanonicalJson: canonical(projection), expectedSha256: hash(canonical(projection)) });
function authority(action = 'retain') {
  const projection = action === 'retain' ? { ...facts, baselineSha256 } : { ...facts, ...claims };
  return { schemaVersion: 1, authorityId: 'synthetic-v2', publicContractSha256: '6'.repeat(64),
    phase: 'web-control-centers-b2', issuedFor: { baselineSha: 'a'.repeat(40), reviewedSourceSha: 'b'.repeat(40), integrationBaseSha: 'c'.repeat(40) },
    successorCatalog: { schemaVersion: 1, records: [{ kind: 'relation', identity: 'public.synthetic',
      expectedCanonicalJson: canonical({ identity: 'public.synthetic', owner: 'postgres', rls: true, forceRls: false, definitionSha256: '7'.repeat(64) }),
      expectedSha256: hash(canonical({ identity: 'public.synthetic', owner: 'postgres', rls: true, forceRls: false, definitionSha256: '7'.repeat(64) })) }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256, baselineItems: [{ ...item }], records: [record(action, projection)] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: '8'.repeat(64), evidenceSha256: '9'.repeat(64),
      status: 'COMPLETED', insertedAt: '2026-11-08T10:00:00.000Z', completedObservedAt: '2026-11-08T10:30:00.000Z', expiresAt: '2026-11-09T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: ['web-control-centers-b2'], authorizationSha256: 'd'.repeat(64),
      approvedAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-09T11:00:00.000Z' } };
}
function parse(value) { const text = JSON.stringify(value); return parseB2PrivateAuthority(text, hash(text), at); }
const rejected = value => assert.throws(() => parse(value), { code: 'PRIVATE_PREPARATION_INPUT_INVALID' });

test('Advisor v2 retains an exact baseline member without fabricated claims', () => {
  const parsed = parse(authority());
  const projection = JSON.parse(parsed.authority.securityAdvisor.records[0].expectedCanonicalJson);
  assert.equal(projection.baselineSha256, baselineSha256);
  assert.equal(Object.hasOwn(projection, 'attestationSha256'), false);
});
test('Advisor v2 permits same-fingerprint replacement only with independent successor claims', () => {
  assert.doesNotThrow(() => parse(authority('replace')));
  const value = authority('replace');
  value.securityAdvisor.records = [record('replace', { ...facts, baselineSha256 })];
  rejected(value);
});
test('Advisor v2 requires exact pre membership and coverage even with rehashed records', () => {
  for (const mutate of [
    v => { v.securityAdvisor.records = []; },
    v => { v.securityAdvisor.records[0] = record('add', { ...facts, ...claims }); },
    v => { v.securityAdvisor.records[0] = record('retain', { ...facts, baselineSha256, fingerprint: 'e'.repeat(64), identity: `advisor:${'e'.repeat(64)}` }); },
    v => { v.securityAdvisor.baselineItems.push({ ...item }); },
    v => { v.securityAdvisor.baselineItems[0].level = 'ERROR'; },
    v => { v.securityAdvisor.records[0] = record('retain', { ...facts, baselineSha256, ...claims }); },
    v => { v.securityAdvisor.records[0] = record('retain', { ...facts, baselineSha256, objectIdentity: '' }); },
  ]) { const value = authority(); mutate(value); rejected(value); }
});
test('Advisor v2 rejects old or mixed schemas instead of falling back', () => {
  const old = authority(); old.securityAdvisor.schemaVersion = 1; rejected(old);
  const mixed = authority(); delete mixed.securityAdvisor.baselineItems; rejected(mixed);
});
test('Advisor v2 rejects remove/add churn when a fingerprint changes', () => {
  const value = authority('remove');
  const next = { ...facts, fingerprint: 'e'.repeat(64), identity: `advisor:${'e'.repeat(64)}` };
  value.securityAdvisor.records.push(record('add', { ...next, ...claims }));
  value.securityAdvisor.records.sort((a, b) => a.action.localeCompare(b.action) || a.identity.localeCompare(b.identity));
  rejected(value);
  value.securityAdvisor.records = [record('replace', { ...next, ...claims })]; rejected(value);
});

// Provider-shaped, wholly synthetic pre-state. The schema-only shell above is
// independent of these live-observation checks.
function observedFixture(mutate = () => {}) {
  const lint = { name: 'synthetic_function_warning', level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'],
    metadata: { schema: 'public', name: 'synthetic_rpc', arguments: '', language: 'sql', security_definer: true } };
  const fp = hash(canonical({ ...lint, cache_key: 'synthetic_function_warning_public_synthetic_rpc_' }) + '\n');
  const value = authority();
  const projection = { fingerprint: fp, identity: `advisor:${fp}`, objectIdentity: 'function:public.synthetic_rpc',
    type: lint.name, severity: 'WARN', objectSha256: hash(canonical(lint.metadata) + '\n') };
  const successorCatalog = b2SyntheticCompleteSuccessorCatalog();
  value.successorCatalog = successorCatalog;
  const contract = { id: 'web-control-centers-b2-scheduled-publishing-v1', to_phase: value.phase,
    baseline_sha: 'a'.repeat(40), reviewed_source_sha: 'b'.repeat(40), reviewed_source_tree_sha: 'd'.repeat(40),
    integration_base_sha: 'c'.repeat(40),
    advisor_authorization_contract_sha256: B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256,
    advisor_authorization_verifier_sha256: hash(readFileSync(new URL('../scripts/nelyon-b2-authority-preparation.mjs', import.meta.url))),
    advisor_authorization_tests_sha256: hash(readFileSync(new URL('./nelyonB2AuthorityPreparation.test.mjs', import.meta.url))),
    productive_changes: [{ path: 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql',
      blob: 'e'.repeat(40), sha256: 'f'.repeat(64), byte_length: 1 }] };
  const origin = { repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525', transitionId: contract.id,
    reviewedSourceSha: contract.reviewed_source_sha, reviewedSourceTreeSha: contract.reviewed_source_tree_sha,
    integrationBaseSha: contract.integration_base_sha,
    migration: { path: contract.productive_changes[0].path, blob: contract.productive_changes[0].blob,
      sha256: contract.productive_changes[0].sha256, byteLength: contract.productive_changes[0].byte_length },
    changedObjectIdentities: B2_ADVISOR_CHANGED_OBJECT_IDENTITIES,
    contractSha256: contract.advisor_authorization_contract_sha256,
    verifierSha256: contract.advisor_authorization_verifier_sha256,
    testsSha256: contract.advisor_authorization_tests_sha256 };
  value.securityAdvisor = structuredClone(computeB2AdvisorAuthorizations({
    baselineItems: [{ fingerprint: fp, level: 'WARN', resource_kind: lint.name }],
    findings: [projection], successorCatalog, origin,
  }));
  const mutableProjection = JSON.parse(value.securityAdvisor.records[0].expectedCanonicalJson);
  mutate(value, mutableProjection);
  if (canonical(mutableProjection) !== value.securityAdvisor.records[0].expectedCanonicalJson) {
    value.securityAdvisor.records = [record('retain', mutableProjection)];
  }
  value.publicContractSha256 = hash(canonical(contract) + '\n');
  const authorityJson = JSON.stringify(value);
  const descriptorBytes = JSON.stringify({ schema_version: 1, contract, public_contract_sha256: value.publicContractSha256,
    private_authority: { required: true, schema_version: 1, authority_id: value.authorityId, sha256: hash(authorityJson) } });
  const context = createReleaseAuthorityContext({ descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes),
    phase: value.phase, transitionId: contract.id, baselineSha: contract.baseline_sha, reviewedSourceSha: contract.reviewed_source_sha,
    integrationBaseSha: contract.integration_base_sha, requestedAt: at, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) });
  return { context, body: { lints: [lint] } };
}

test('Advisor v2 pre observes true object mapping and exact finding facts, not repinned assertions', () => {
  const valid = observedFixture(); assert.equal(verifyB2AdvisorPrestate(valid.body, valid.context), true);
  for (const mutate of [
    p => { p.objectIdentity = 'function:public.unaffected'; },
    p => { p.objectSha256 = 'f'.repeat(64); },
  ]) {
    const f = observedFixture((v, p) => { mutate(p); v.securityAdvisor.records = [record('retain', p)]; });
    assert.throws(() => verifyB2AdvisorPrestate(f.body, f.context), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }
  for (const body of [{ lints: [] }, { lints: [...valid.body.lints, ...valid.body.lints] },
    { lints: [{ ...valid.body.lints[0], metadata: { ...valid.body.lints[0].metadata, arguments: 'uuid' } }] }]) {
    assert.throws(() => verifyB2AdvisorPrestate(body, valid.context), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }
});

test('Advisor v2 mapping supports documented metadata and rejects unknown or ambiguous objects', () => {
  assert.equal(b2AdvisorObjectIdentity({ metadata: { schema: 'public', name: 'rpc', arguments: '', language: 'sql' } }), 'function:public.rpc');
  assert.equal(b2AdvisorObjectIdentity({ metadata: { schema: 'public', name: 'items', type: 'table' } }), 'relation:public.items');
  assert.equal(b2AdvisorObjectIdentity({ metadata: { entity: 'auth', type: 'auth' } }), 'auth:auth');
  for (const metadata of [{}, { type: 'unknown', name: 'items', schema: 'public' },
    { type: 'auth', entity: 'auth', schema: 'public' }, { type: 'table', schema: 'public', name: 'rpc', arguments: '' }]) {
    assert.throws(() => b2AdvisorObjectIdentity({ metadata }), { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' });
  }
});
