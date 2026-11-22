import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import * as authorityPreparation from '../scripts/nelyon-b2-authority-preparation.mjs';
import {
  B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256,
  B2_AUTHORITY_EDGE_FUNCTION_SCOPE,
  B2_AUTHORITY_FUNCTION_SCOPE,
  B2_AUTHORITY_INDEX_SCOPE,
  B2_AUTHORITY_POLICY_SCOPE,
  B2_AUTHORITY_RELATION_SCOPE,
  B2_AUTHORITY_TRIGGER_SCOPE,
  assertB2AdvisorPostState,
  canonicalB2AuthorityJson,
  computeB2AdvisorAuthorizations,
  normalizeB2SuccessorCatalogFromDisposableEvidence,
  verifyB2PostgresCatalogEvidenceEnvelope,
  verifyB2RealPgCronEvidenceEnvelope,
  verifyB2AdvisorAuthorizationClaims,
} from '../scripts/nelyon-b2-authority-preparation.mjs';
import { B2_DATABASE_FUNCTION_SCOPE } from '../scripts/nelyon-production-snapshot-adapter.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const reviewedImageId = 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
const reviewedImage = `public.ecr.aws/supabase/postgres@${reviewedImageId}`;
const migration = { path: 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql',
  blob: '1'.repeat(40), sha256: '2'.repeat(64), byteLength: 81378 };
const origin = { repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  transitionId: 'web-control-centers-b2-scheduled-publishing-v1', reviewedSourceSha: '3'.repeat(40),
  reviewedSourceTreeSha: '4'.repeat(40), integrationBaseSha: '5'.repeat(40), migration,
  changedObjectIdentities: [...new Set([
    ...B2_DATABASE_FUNCTION_SCOPE.map(identity => `function:${identity.replace(/\(.*$/u, '')}`),
    ...B2_AUTHORITY_RELATION_SCOPE.filter(identity => identity !== 'public.media_assets')
      .map(identity => `relation:${identity}`),
  ])].sort(),
  contractSha256: B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256, verifierSha256: '6'.repeat(64), testsSha256: '7'.repeat(64) };

function withCapabilityDigest(core) {
  return { ...core, capabilitySha256: hash(canonicalB2AuthorityJson(core)) };
}

function catalogEvidence() {
  const catalogRows = [
    ...B2_AUTHORITY_FUNCTION_SCOPE.map(identity => ({ kind: 'function', value: { identity, execute: true, owner: 'postgres',
      securityDefiner: true, searchPath: ['search_path=""'], definitionSha256: hash(identity) } })),
    ...B2_AUTHORITY_RELATION_SCOPE.map(identity => ({ kind: 'relation', value: { identity, rls: true, forceRls: true,
      owner: 'postgres', definitionSha256: hash(identity) } })),
    ...B2_AUTHORITY_POLICY_SCOPE.map(({ identity, relation }) => ({ kind: 'policy', value: { identity, relation,
      command: 'SELECT', roles: ['authenticated'], usingSha256: hash('true'), checkSha256: null } })),
    ...B2_AUTHORITY_TRIGGER_SCOPE.map(({ identity, relation }) => ({ kind: 'trigger', value: { identity, relation,
      functionIdentity: 'private.guard_publication_schedule_audit_v1()', enabled: 'O', definitionSha256: hash(identity) } })),
    ...B2_AUTHORITY_INDEX_SCOPE.map(({ identity, relation }) => ({ kind: 'index', value: { identity, relation,
      valid: true, ready: true, unique: identity.endsWith('_pkey'), definitionSha256: hash(identity) } })),
  ];
  catalogRows.sort((left, right) => `${left.kind}\0${left.value.identity}` < `${right.kind}\0${right.value.identity}` ? -1 : 1);
  const functionSecurityRows = B2_AUTHORITY_FUNCTION_SCOPE.map(identity => {
    const facts = catalogRows.find(row => row.kind === 'function' && row.value.identity === identity).value;
    return { identity, owner: facts.owner, securityDefiner: facts.securityDefiner,
      searchPath: facts.searchPath, definitionSha256: facts.definitionSha256,
      acl: [{ grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }],
      execute: { anon: false, authenticated: true, public: false, service_role: false } };
  });
  const relationAclRows = B2_AUTHORITY_RELATION_SCOPE.map(identity => ({ identity, owner: 'postgres', rls: true,
    forceRls: true, acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
    access: { anon: false, authenticated: false, public: false, service_role: false } }));
  const core = { schemaVersion: 1, kind: 'nelyon-b2-postgres-catalog-evidence-v1', result: 'VERIFIED',
    mintEligibility: 'CATALOG_COMPONENT_ONLY', provenance: { image: reviewedImage, imageId: reviewedImageId,
      imageRepoDigest: reviewedImage, imageOs: 'linux', imageArchitecture: 'amd64', imagePlatform: 'linux/amd64',
      postgresMajor: 17, database: 'b2concurrency',
      migrationSha256: hash('migration'), catalogSqlSha256: hash('catalog-sql'),
      rpcSecuritySqlSha256: hash('rpc-sql'), relationAclSqlSha256: hash('acl-sql'),
      syntheticCronAuthorityExcluded: true, pgCronExtension: false },
    catalogRows, functionSecurityRows, relationAclRows };
  return withCapabilityDigest(core);
}

function cronEvidence() {
  const core = { schemaVersion: 1, kind: 'nelyon-b2-real-pg-cron-evidence-v1', result: 'VERIFIED',
    mintEligibility: 'PRODUCTION_CRON_COMPONENT', provenance: {
      image: reviewedImage, imageId: reviewedImageId, imageRepoDigest: reviewedImage,
      imageOs: 'linux', imageArchitecture: 'amd64', imagePlatform: 'linux/amd64',
      pgCronVersion: '1.6.4', effectiveRole: 'postgres', roleSuperuser: false, roleBypassRls: true,
      migrationSha256: hash('migration'), activationSha256: hash('activation'), databaseNormalization: {
        schemaVersion: 1, contract: 'supabase-hosted-primary-database-v1', observed: 'postgres', normalized: 'postgres', exact: true,
      } }, cronRecord: { identity: 'process-scheduled-publications-b2', schedule: '* * * * *',
      commandSha256: hash('select public.wake_scheduled_publications_b2_v1()'), database: 'postgres',
      username: 'postgres', active: true } };
  return withCapabilityDigest(core);
}

function functionInventory() {
  return B2_AUTHORITY_EDGE_FUNCTION_SCOPE.map(({ name, verifyJwt }) => ({ identity: name, verifyJwt,
    sourceSha256: hash(`source:${name}`), configSha256: hash(`config:${name}`) }));
}

function testRecord(kind, value) {
  const expectedCanonicalJson = canonicalB2AuthorityJson(value);
  return { kind, identity: value.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) };
}

// Advisor unit tests consume an explicit non-authoritative catalog fixture. They
// never call the production proof boundary or mint a production capability.
function catalog(value = catalogEvidence(), cron = cronEvidence(), inventory = functionInventory()) {
  const records = [
    ...value.catalogRows.map(row => testRecord(row.kind, row.value)),
    ...value.functionSecurityRows.map(row => testRecord('function_acl', {
      identity: row.identity, acl: row.acl, execute: row.execute,
    })),
    ...value.relationAclRows.map(row => testRecord('relation_acl', {
      identity: row.identity, acl: row.acl, access: row.access,
    })),
    testRecord('cron_job', cron.cronRecord),
    ...inventory.map(row => testRecord('function_inventory', row)),
  ].sort((left, right) => {
    const a = `${left.kind}\0${left.identity}`; const b = `${right.kind}\0${right.identity}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { schemaVersion: 1, records };
}

test('plain and synthetic evidence can be validated but cannot mint a successor catalog', () => {
  const plain = catalogEvidence();
  const cron = cronEvidence();
  assert.equal(verifyB2PostgresCatalogEvidenceEnvelope(plain), true);
  assert.equal(verifyB2RealPgCronEvidenceEnvelope(cron), true);
  assert.equal('attestB2PostgresCatalogEvidence' in authorityPreparation, false);
  assert.equal('attestB2RealPgCronEvidence' in authorityPreparation, false);
  assert.throws(() => normalizeB2SuccessorCatalogFromDisposableEvidence({
    catalogEvidence: plain, pgCronEvidence: cron, functionInventory: functionInventory(),
  }));
  const arbitrary = structuredClone(plain);
  arbitrary.catalogRows[0].value.owner = 'caller-constructed';
  const core = structuredClone(arbitrary); delete core.capabilitySha256;
  arbitrary.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
  assert.throws(() => normalizeB2SuccessorCatalogFromDisposableEvidence({
    catalogEvidence: arbitrary, pgCronEvidence: cron, functionInventory: functionInventory(),
  }), 'a caller-controlled payload and recomputed hash must not mint a capability');
});

test('strict public envelope verifiers accept the exact reviewed proof shapes without minting', () => {
  const rawCatalog = catalogEvidence();
  const { capabilitySha256, ...catalogCore } = rawCatalog;
  assert.equal(capabilitySha256, hash(canonicalB2AuthorityJson(catalogCore)));
  assert.deepEqual(rawCatalog.catalogRows.filter(row => row.kind === 'function').map(row => row.value.identity),
    B2_AUTHORITY_FUNCTION_SCOPE);
  assert.deepEqual(rawCatalog.catalogRows.filter(row => row.kind === 'relation').map(row => row.value.identity),
    B2_AUTHORITY_RELATION_SCOPE);
  assert.deepEqual(rawCatalog.functionSecurityRows.map(row => row.identity), B2_AUTHORITY_FUNCTION_SCOPE);
  assert.deepEqual(rawCatalog.relationAclRows.map(row => row.identity), B2_AUTHORITY_RELATION_SCOPE);
  assert.equal(verifyB2PostgresCatalogEvidenceEnvelope(rawCatalog), true);
  assert.equal(verifyB2RealPgCronEvidenceEnvelope(cronEvidence()), true);
  const successor = catalog(rawCatalog, cronEvidence(), functionInventory());
  assert.deepEqual(Object.fromEntries(['function', 'function_acl', 'relation', 'relation_acl', 'policy', 'trigger',
    'index', 'cron_job', 'function_inventory'].map(kind => [kind, successor.records.filter(row => row.kind === kind).length])),
  { function: 31, function_acl: 31, relation: 7, relation_acl: 7, policy: 4, trigger: 5, index: 19,
    cron_job: 1, function_inventory: 8 });
  const keys = successor.records.map(row => `${row.kind}\0${row.identity}`);
  assert.deepEqual(keys, [...keys].sort());
  for (const row of successor.records) assert.equal(hash(row.expectedCanonicalJson), row.expectedSha256);
});

test('proof envelopes reject every image platform and RepoDigest substitution', () => {
  for (const [field, replacement] of [
    ['imageRepoDigest', 'public.ecr.aws/supabase/postgres@sha256:' + 'f'.repeat(64)],
    ['imageOs', 'windows'],
    ['imageArchitecture', 'arm64'],
    ['imagePlatform', 'linux/arm64'],
  ]) {
    for (const [makeEvidence, verify] of [
      [catalogEvidence, verifyB2PostgresCatalogEvidenceEnvelope],
      [cronEvidence, verifyB2RealPgCronEvidenceEnvelope],
    ]) {
      const evidence = makeEvidence();
      evidence.provenance[field] = replacement;
      const core = structuredClone(evidence); delete core.capabilitySha256;
      evidence.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
      assert.throws(() => verify(evidence), `${field} substitution must fail even with a recomputed envelope digest`);
    }
  }
});

test('multiline policy SQL is represented by the SHA-256 of exact UTF-8 bytes', () => {
  const multiline = '(owner_id = auth.uid())\nAND (entity_type = \'publication_schedule\'::text)';
  const oneByteMutation = multiline.replace('AND', 'and');
  assert.notEqual(hash(multiline), hash(oneByteMutation));
  const evidence = catalogEvidence();
  const policy = evidence.catalogRows.find(row => row.kind === 'policy');
  policy.value.usingSha256 = hash(multiline);
  const core = structuredClone(evidence); delete core.capabilitySha256;
  evidence.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
  assert.equal(verifyB2PostgresCatalogEvidenceEnvelope(evidence), true);
  const changed = structuredClone(evidence);
  changed.catalogRows.find(row => row.kind === 'policy').value.usingSha256 = hash(oneByteMutation);
  assert.throws(() => verifyB2PostgresCatalogEvidenceEnvelope(changed),
    'one-byte SQL mutation invalidates the exact envelope digest');
});

for (const [name, mutate] of [
  ['extra relation', value => value.catalogRows.push({ ...value.catalogRows.find(row => row.kind === 'relation'),
    value: { ...value.catalogRows.find(row => row.kind === 'relation').value, identity: 'private.publication_schedule_shadow' } })],
  ['missing function acl', value => value.functionSecurityRows.pop()],
  ['unsorted catalog', value => value.catalogRows.reverse()],
  ['missing exact policy', value => value.catalogRows.splice(value.catalogRows.findIndex(row => row.kind === 'policy'), 1)],
]) test(`catalog rejects ${name}`, () => {
  const value = catalogEvidence(); mutate(value);
  const core = structuredClone(value); delete core.capabilitySha256; value.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
  assert.throws(() => verifyB2PostgresCatalogEvidenceEnvelope(value));
});

test('catalog rejects wildcard cron, wrong database normalization and duplicate inventory', () => {
  const wildcard = cronEvidence(); wildcard.cronRecord.identity = 'other-publication-job';
  let core = structuredClone(wildcard); delete core.capabilitySha256; wildcard.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
  assert.throws(() => verifyB2RealPgCronEvidenceEnvelope(wildcard));
  const wrongDatabase = cronEvidence(); wrongDatabase.provenance.databaseNormalization.normalized = 'template1';
  core = structuredClone(wrongDatabase); delete core.capabilitySha256; wrongDatabase.capabilitySha256 = hash(canonicalB2AuthorityJson(core));
  assert.throws(() => verifyB2RealPgCronEvidenceEnvelope(wrongDatabase));
  const inventory = functionInventory(); inventory[7] = { ...inventory[6] };
  const malformed = catalog(catalogEvidence(), cronEvidence(), inventory);
  assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems: [], findings: [],
    successorCatalog: malformed, origin }));
});

test('Advisor claims are deterministic retain/replace only and bind overloaded successors', () => {
  const successor = catalog();
  const changed = { fingerprint: hash('changed'), identity: `advisor:${hash('changed')}`,
    objectIdentity: 'function:public.create_carousel_post', objectSha256: hash('object'), severity: 'WARN', type: 'function' };
  const untouched = { fingerprint: hash('untouched'), identity: `advisor:${hash('untouched')}`,
    objectIdentity: 'auth:password_policy', objectSha256: hash('auth'), severity: 'INFO', type: 'auth' };
  const baselineItems = [changed, untouched].map(row => ({ fingerprint: row.fingerprint, level: row.severity, resource_kind: row.type }));
  const advisor = computeB2AdvisorAuthorizations({ baselineItems, findings: [changed, untouched], successorCatalog: successor, origin });
  assert.deepEqual(advisor.records.map(row => row.action), ['replace', 'retain']);
  assert.equal(verifyB2AdvisorAuthorizationClaims({ securityAdvisor: advisor, successorCatalog: successor, origin }), true);
  const replacement = JSON.parse(advisor.records.find(row => row.action === 'replace').expectedCanonicalJson);
  assert.match(replacement.attestationSha256, /^[0-9a-f]{64}$/u);
  assert.equal(replacement.objectIdentity, changed.objectIdentity);
  assert.equal(assertB2AdvisorPostState({ before: [changed, untouched], after: [untouched, changed], authorizations: advisor.records }), true);
});

test('catalogued but unchanged public.media_assets finding is retained while touched relation is replaced', () => {
  const successor = catalog();
  const retained = { fingerprint: hash('media-assets-retain'), identity: `advisor:${hash('media-assets-retain')}`,
    objectIdentity: 'relation:public.media_assets', objectSha256: hash('media-assets-object'),
    severity: 'WARN', type: 'relation' };
  const replaced = { fingerprint: hash('media-links-replace'), identity: `advisor:${hash('media-links-replace')}`,
    objectIdentity: 'relation:public.media_asset_links', objectSha256: hash('media-links-object'),
    severity: 'WARN', type: 'relation' };
  const baselineItems = [retained, replaced].map(row => ({ fingerprint: row.fingerprint,
    level: row.severity, resource_kind: row.type }));
  const advisor = computeB2AdvisorAuthorizations({ baselineItems, findings: [retained, replaced],
    successorCatalog: successor, origin });
  const byIdentity = new Map(advisor.records.map(row => [row.identity, row.action]));
  assert.equal(byIdentity.get(retained.identity), 'retain');
  assert.equal(byIdentity.get(replaced.identity), 'replace');
});

test('one-bit claim, added/removed finding and empty successor coverage fail closed', () => {
  const successor = catalog();
  const changed = { fingerprint: hash('changed'), identity: `advisor:${hash('changed')}`,
    objectIdentity: 'relation:private.publication_schedules', objectSha256: hash('object'), severity: 'ERROR', type: 'relation' };
  const baselineItems = [{ fingerprint: changed.fingerprint, level: changed.severity, resource_kind: changed.type }];
  const advisor = computeB2AdvisorAuthorizations({ baselineItems, findings: [changed], successorCatalog: successor, origin });
  const altered = structuredClone(advisor);
  const projection = JSON.parse(altered.records[0].expectedCanonicalJson);
  projection.originSha256 = `${projection.originSha256.slice(0, -1)}${projection.originSha256.endsWith('0') ? '1' : '0'}`;
  altered.records[0].expectedCanonicalJson = canonicalB2AuthorityJson(projection);
  altered.records[0].expectedSha256 = hash(altered.records[0].expectedCanonicalJson);
  assert.throws(() => verifyB2AdvisorAuthorizationClaims({ securityAdvisor: altered, successorCatalog: successor, origin }));
  assert.throws(() => assertB2AdvisorPostState({ before: [changed], after: [], authorizations: advisor.records }));
  assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems, findings: [changed],
    successorCatalog: { schemaVersion: 1, records: [] }, origin }));
});

test('Advisor verifier rejects incomplete, extra and unsorted successor records', () => {
  const successor = catalog();
  const untouched = { fingerprint: hash('untouched-catalog'), identity: `advisor:${hash('untouched-catalog')}`,
    objectIdentity: 'auth:password_policy', objectSha256: hash('auth-catalog'), severity: 'WARN', type: 'auth' };
  const baselineItems = [{ fingerprint: untouched.fingerprint, level: untouched.severity, resource_kind: untouched.type }];
  for (const mutate of [
    records => records.pop(),
    records => records.push(structuredClone(records.at(-1))),
    records => records.reverse(),
  ]) {
    const altered = structuredClone(successor); mutate(altered.records);
    assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems, findings: [untouched],
      successorCatalog: altered, origin }));
  }
});

test('Advisor origin is exact and cannot substitute changed scope or contract pins', () => {
  const successor = catalog();
  const changed = { fingerprint: hash('origin-changed'), identity: `advisor:${hash('origin-changed')}`,
    objectIdentity: 'relation:private.publication_schedules', objectSha256: hash('origin-object'),
    severity: 'ERROR', type: 'relation' };
  const baselineItems = [{ fingerprint: changed.fingerprint, level: changed.severity, resource_kind: changed.type }];
  for (const mutate of [
    value => value.changedObjectIdentities.pop(),
    value => { value.changedObjectIdentities.push('relation:public.synthetic'); value.changedObjectIdentities.sort(); },
    value => { value.contractSha256 = 'f'.repeat(64); },
  ]) {
    const alteredOrigin = structuredClone(origin); mutate(alteredOrigin);
    assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems, findings: [changed],
      successorCatalog: successor, origin: alteredOrigin }));
  }
});

test('Advisor preparation requires complete one-to-one baseline coverage', () => {
  const successor = catalog();
  const changed = { fingerprint: hash('duplicate-finding'), identity: `advisor:${hash('duplicate-finding')}`,
    objectIdentity: 'function:public.create_photo_post_with_media', objectSha256: hash('duplicate-object'),
    severity: 'WARN', type: 'function' };
  const baseline = { fingerprint: changed.fingerprint, level: changed.severity, resource_kind: changed.type };
  assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems: [baseline, structuredClone(baseline)],
    findings: [changed, structuredClone(changed)], successorCatalog: successor, origin }));
  assert.throws(() => computeB2AdvisorAuthorizations({ baselineItems: [{ ...baseline, unexpected: true }],
    findings: [changed], successorCatalog: successor, origin }));
});
