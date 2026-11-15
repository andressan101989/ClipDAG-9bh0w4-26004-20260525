import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { canonicalJson } from '../scripts/nelyon-production-release.mjs';
import { createReleaseAuthorityContext } from '../scripts/nelyon-release-authority-context.mjs';
import { b2DatabaseFunctionMatrix, b2SyntheticRelationAclRecords } from './fixtures/nelyonB2DatabaseFunctionMatrix.mjs';
import {
  assertTrustedB2SourceParity,
  compileB2SourceParity,
  createTrustedB2DeployedFunctionInventory,
  createTrustedB2ReviewedTree,
} from '../scripts/nelyon-b2-source-parity.mjs';
import * as sourceParityModule from '../scripts/nelyon-b2-source-parity.mjs';
import { createPrivateAuthorityProductionHost } from '../scripts/nelyon-private-authority-cli.mjs';

const AT = '2026-11-10T12:00:00.000Z';
const SHA = 'a'.repeat(40);
const BASELINE = 'b'.repeat(40);
const INTEGRATION = 'c'.repeat(40);
const MIGRATION_PATH = 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql';
const FUNCTION_PATH = 'supabase/functions/process-scheduled-publications/index.ts';
const migrationBytes = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

function compactCanonical(value) {
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

function fixture(overrides = {}) {
  const reviewedMigration = overrides.migrationBytes ?? migrationBytes;
  const matrix = b2DatabaseFunctionMatrix();
  const functionBytes = Buffer.from('export default { fetch() { return new Response("ok") } };\n');
  const sourceFiles = [{ path: FUNCTION_PATH, sha256: hash(functionBytes) }];
  const sourceSha256 = hash(canonicalJson({
    entrypoint: FUNCTION_PATH,
    import_map: null,
    source_files: sourceFiles,
  }));
  const functionConfig = { verify_jwt: false };
  const configSha256 = hash(canonicalJson(functionConfig));
  const relationNames = [
    'publication_schedule_attempts',
    'publication_schedule_commands',
    'publication_schedule_materializations',
    'publication_schedule_policy',
    'publication_schedules',
  ];
  const relationRecords = relationNames.map(name => {
    const value = {
      definitionSha256: hash(`private.${name}`),
      forceRls: true,
      identity: `private.${name}`,
      owner: 'postgres',
      rls: true,
    };
    const expectedCanonicalJson = compactCanonical(value);
    return { kind: 'relation', identity: value.identity, expectedCanonicalJson,
      expectedSha256: hash(expectedCanonicalJson) };
  });
  const advisor = {
    attestationSha256: '1'.repeat(64),
    fingerprint: '2'.repeat(64),
    identity: 'public.synthetic_relation',
    negativeEvidenceSha256: '3'.repeat(64),
    objectSha256: '0'.repeat(64),
    originSha256: '4'.repeat(64),
    severity: 'WARN',
    type: 'rls_disabled',
  };
  const advisorJson = compactCanonical(advisor);
  const contract = {
    id: 'web-control-centers-b2-scheduled-publishing-v1',
    to_phase: 'web-control-centers-b2',
    baseline_sha: BASELINE,
    reviewed_source_sha: SHA,
    integration_base_sha: INTEGRATION,
    productive_changes: [{ path: MIGRATION_PATH, sha256: hash(reviewedMigration) }],
    functions: [{ name: 'process-scheduled-publications', verify_jwt: false,
      source_sha256: sourceSha256, config_sha256: configSha256 }],
  };
  const publicContractSha256 = hash(canonicalJson(contract));
  const authority = {
    schemaVersion: 1,
    authorityId: 'web-control-centers-b2-release-authority-v1',
    publicContractSha256,
    phase: contract.to_phase,
    issuedFor: { baselineSha: BASELINE, reviewedSourceSha: SHA, integrationBaseSha: INTEGRATION },
    successorCatalog: { schemaVersion: 1, records: [...matrix.records, ...relationRecords, ...b2SyntheticRelationAclRecords(relationRecords)]
      .sort((left, right) => {
        const a = `${left.kind}\0${left.identity}`, b = `${right.kind}\0${right.identity}`;
        return a < b ? -1 : a > b ? 1 : 0;
      }) },
    securityAdvisor: { schemaVersion: 1, baselineSha256: '5'.repeat(64), records: [{
      action: 'retain', identity: advisor.identity, expectedCanonicalJson: advisorJson,
      expectedSha256: hash(advisorJson),
    }] },
    backup: { schemaVersion: 1, provider: 'supabase', kind: 'physical',
      projectRefSha256: '6'.repeat(64), evidenceSha256: '7'.repeat(64), status: 'COMPLETED',
      completedAt: '2026-11-10T10:00:00.000Z', expiresAt: '2026-11-11T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: ['web-control-centers-b2'],
      authorizationSha256: '8'.repeat(64), approvedAt: '2026-11-10T11:00:00.000Z',
      expiresAt: '2026-11-11T11:00:00.000Z' },
  };
  overrides.mutateAuthority?.(authority);
  const authorityJson = JSON.stringify(authority);
  const descriptor = { schema_version: 1, contract, public_contract_sha256: publicContractSha256,
    private_authority: { required: true, schema_version: 1, authority_id: authority.authorityId,
      sha256: hash(authorityJson) } };
  const descriptorBytes = Buffer.from(JSON.stringify(descriptor));
  const authorityContext = createReleaseAuthorityContext({ descriptorBytes,
    expectedDescriptorSha256: hash(descriptorBytes), phase: contract.to_phase, transitionId: contract.id,
    baselineSha: BASELINE, reviewedSourceSha: SHA, integrationBaseSha: INTEGRATION,
    requestedAt: AT, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) });
  const manifest = {
    identity: { approved_sha: SHA },
    resources: {
      migrations: [{ path: MIGRATION_PATH, sha256: hash(reviewedMigration) }],
      function_contracts: [{ name: 'process-scheduled-publications', entrypoint: FUNCTION_PATH,
        import_map: null, verify_jwt: false, source_changed: true, source_files: sourceFiles,
        source_sha256: sourceSha256 }],
    },
  };
  const reviewedTree = createTrustedB2ReviewedTree({
    approvedSha: SHA,
    files: [{ path: MIGRATION_PATH, bytes: reviewedMigration }, { path: FUNCTION_PATH, bytes: functionBytes }],
    functionConfigs: [{ name: 'process-scheduled-publications', config: functionConfig }],
  });
  const deployedFunctionInventory = createTrustedB2DeployedFunctionInventory({
    capturedAt: AT,
    functions: [{ name: 'process-scheduled-publications', deployedSha256: '9'.repeat(64) }],
  });
  return { authorityContext, manifest, descriptorBytes, reviewedTree, deployedFunctionInventory,
    matrix, advisor, relationNames };
}

function compileFixture(f, overrides = {}) {
  return compileB2SourceParity({ authorityContext: f.authorityContext, manifest: f.manifest,
    descriptorBytes: f.descriptorBytes, reviewedTree: f.reviewedTree,
    deployedFunctionInventory: f.deployedFunctionInventory, capturedAt: AT, ...overrides });
}

test('trusted compiler derives the complete source authority from exact reviewed bytes', () => {
  const f = fixture();
  const result = compileFixture(f);
  assert.equal(assertTrustedB2SourceParity(result), result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.capturedAt, AT);
  assert.equal(result.descriptorSha256, hash(f.descriptorBytes));
  assert.equal(result.approvedSha, SHA);
  assert.equal(result.manifestSha256, hash(canonicalJson(f.manifest)));
  assert.equal(result.migrationSha256, hash(migrationBytes));
  assert.deepEqual(result.functions, [{ identity: 'process-scheduled-publications',
    deployedSha256: '9'.repeat(64), sourceSha256: f.authorityContext.descriptor.contract.functions[0].source_sha256,
    configSha256: f.authorityContext.descriptor.contract.functions[0].config_sha256, verifyJwt: false }]);
  assert.deepEqual(result.advisors, [{ fingerprint: f.advisor.fingerprint,
    attestationSha256: f.advisor.attestationSha256,
    negativeEvidenceSha256: f.advisor.negativeEvidenceSha256,
    originSha256: f.advisor.originSha256 }]);
  assert.deepEqual(result.databaseFunctions, f.matrix.sourceRows);
  assert.equal(result.databaseFunctions.length, 30);
  assert.deepEqual(result.databaseRelations.map(row => row.identity),
    f.relationNames.map(name => `private.${name}`).sort());
  for (const row of result.databaseRelations) {
    assert.deepEqual(row.access, { public: false, anon: false, authenticated: false, service_role: false });
    assert.equal(row.owner, 'postgres');
    assert.equal(row.rls, true);
    assert.equal(row.forceRls, true);
  }
});

test('source parity brand rejects plain, copied, serialized and proxied values', () => {
  const f = fixture();
  const result = compileFixture(f);
  for (const candidate of [{ ...result }, structuredClone(result), JSON.parse(JSON.stringify(result)),
    new Proxy(result, {})]) {
    assert.throws(() => assertTrustedB2SourceParity(candidate), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  }
});

test('compiler rejects candidate tree, inventory, clock and exact-byte drift without a fallback', () => {
  const f = fixture();
  const base = { authorityContext: f.authorityContext, manifest: f.manifest, descriptorBytes: f.descriptorBytes,
    reviewedTree: f.reviewedTree, deployedFunctionInventory: f.deployedFunctionInventory, capturedAt: AT };
  const cases = [
    { ...base, reviewedTree: structuredClone(f.reviewedTree) },
    { ...base, deployedFunctionInventory: structuredClone(f.deployedFunctionInventory) },
    { ...base, capturedAt: '2026-11-10T12:00:01.000Z' },
    { ...base, descriptorBytes: Buffer.concat([f.descriptorBytes, Buffer.from('\n')]) },
  ];
  for (const input of cases) {
    assert.throws(() => compileB2SourceParity(input), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  }
  const files = [
    { path: MIGRATION_PATH, bytes: Buffer.from(migrationBytes.toString('utf8').replace('security definer', 'security invoker')) },
    { path: FUNCTION_PATH, bytes: Buffer.from('export default { fetch() { return new Response("ok") } };\n') },
  ];
  const changedTree = createTrustedB2ReviewedTree({ approvedSha: SHA, files,
    functionConfigs: [{ name: 'process-scheduled-publications', config: { verify_jwt: false } }] });
  assert.throws(() => compileB2SourceParity({ ...base, reviewedTree: changedTree }),
    { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
});

test('reviewed-tree and deployed-inventory readers reject getters, unknown keys and duplicate identities', () => {
  const f = fixture();
  assert.throws(() => createTrustedB2ReviewedTree({
    approvedSha: SHA,
    files: [{ path: MIGRATION_PATH, get bytes() { throw new Error('marker'); } }],
    functionConfigs: [],
  }), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  assert.throws(() => createTrustedB2ReviewedTree({ approvedSha: SHA, files: [], functionConfigs: [], extra: true }),
    { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  assert.throws(() => createTrustedB2DeployedFunctionInventory({ capturedAt: AT,
    functions: [{ name: 'x', deployedSha256: '9'.repeat(64) }, { name: 'x', deployedSha256: '8'.repeat(64) }] }),
  { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  assert.doesNotMatch(JSON.stringify(f.reviewedTree), /export default|create table|secret/i);
});

test('PG17 function header casing preserves exact canonical definitions', () => {
  for (const [from, to] of [['security definer', 'security DEFINER'], ['language plpgsql', 'LANGUAGE PLPGSQL'],
    ['set search_path=public', 'SET search_path=PUBLIC']]) {
    const bytes = Buffer.from(migrationBytes.toString('utf8').replaceAll(from, to));
    assert.doesNotThrow(() => compileFixture(fixture({ migrationBytes: bytes })));
  }
});

test('source parity requires complete independent ACL evidence and preserves new-function security', () => {
  for (const kind of ['relation_acl', 'function_acl']) {
    for (const mutation of ['missing', 'wrong-identity', 'extra']) {
      const f = fixture({ mutateAuthority(authority) {
        const records = authority.successorCatalog.records;
        const index = records.findIndex(row => row.kind === kind);
        if (mutation === 'missing') records.splice(index, 1);
        else {
          const record = structuredClone(records[index]);
          record.identity = 'zz.synthetic';
          const value = JSON.parse(record.expectedCanonicalJson); value.identity = record.identity;
          record.expectedCanonicalJson = compactCanonical(value); record.expectedSha256 = hash(record.expectedCanonicalJson);
          if (mutation === 'extra') records.push(record); else records[index] = record;
          records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
        }
      } });
      assert.throws(() => compileFixture(f), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
    }
  }
  for (const kind of ['relation_acl', 'function_acl']) {
    const f = fixture({ mutateAuthority(authority) {
      const record = authority.successorCatalog.records.find(row => row.kind === kind);
      const value = JSON.parse(record.expectedCanonicalJson); (value.access ?? value.execute).anon = true;
      record.expectedCanonicalJson = compactCanonical(value); record.expectedSha256 = hash(record.expectedCanonicalJson);
    } });
    assert.throws(() => compileFixture(f), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  }
});

test('database preflight rejects incomplete or unsafe authority before deployed inventory exists', () => {
  assert.equal(typeof sourceParityModule.verifyB2DatabaseSourcePreflight, 'function');
  const verify = f => sourceParityModule.verifyB2DatabaseSourcePreflight({ authorityContext: f.authorityContext,
    manifest: f.manifest, descriptorBytes: f.descriptorBytes, migrationBytes });
  assert.equal(verify(fixture()), true);
  for (const kind of ['function_acl', 'relation_acl']) {
    for (const unsafe of [false, true]) {
      const f = fixture({ mutateAuthority(authority) {
        const records = authority.successorCatalog.records, index = records.findIndex(row => row.kind === kind);
        if (!unsafe) records.splice(index, 1);
        else {
          const value = JSON.parse(records[index].expectedCanonicalJson); (value.access ?? value.execute).anon = true;
          records[index].expectedCanonicalJson = compactCanonical(value);
          records[index].expectedSha256 = hash(records[index].expectedCanonicalJson);
        }
      } });
      assert.throws(() => verify(f), { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
    }
  }
});

test('every current B2 protected host entry rejects missing ACL before fetch or stage work', async () => {
  const f = fixture({ mutateAuthority(authority) {
    authority.successorCatalog.records = authority.successorCatalog.records.filter(row => row.kind !== 'function_acl');
  } });
  let fetches = 0;
  const host = createPrivateAuthorityProductionHost({ publicInputs: { descriptorBytes: f.descriptorBytes },
    environment: {}, repositoryRoot: process.cwd(), fetchImpl: async () => { fetches++; throw new Error('unexpected fetch'); } });
  for (const action of ['authority-proof', 'revalidate', 'verify-gate', 'pre-snapshot', 'verify-pre-snapshot', 'post-snapshot', 'postcheck']) {
    await assert.rejects(host.dispatch({ action, inputs: {}, authorityContext: f.authorityContext,
      receipt: f.authorityContext.receipt, now: AT,
      manifest: { ...f.manifest, resources: { ...f.manifest.resources, web_control_centers_b2_transition: {} } } }),
    { code: 'B2_SOURCE_PARITY_AUTHORITY_INVALID' });
  }
  assert.equal(fetches, 0);
});
