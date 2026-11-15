import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../scripts/nelyon-production-release.mjs';
import { createReleaseAuthorityContext } from '../../scripts/nelyon-release-authority-context.mjs';
import { compileB2SourceParity, createTrustedB2ReviewedTree,
  createTrustedB2DeployedFunctionInventory, verifyB2DatabaseSourcePreflight } from '../../scripts/nelyon-b2-source-parity.mjs';
import { normalizeB2DatabaseFunctionAttestations, verifyB2DatabaseFunctionAuthority,
  verifyB2DatabaseRelationAuthority } from '../../scripts/nelyon-production-snapshot-adapter.mjs';

// Only the disposable database's synthetic state is admitted here. This is not
// a production authority, baseline, export or provider payload.
export function proveB2PostgresSourceParity({ catalogRows, functionRows, relationRows }) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const at = '2026-11-10T12:00:00.000Z';
  const source = 'a'.repeat(40), baseline = 'b'.repeat(40), integration = 'c'.repeat(40);
  const migrationPath = 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql';
  const migrationBytes = readFileSync(new URL(`../../${migrationPath}`, import.meta.url));
  const entrypoint = 'supabase/functions/process-scheduled-publications/index.ts';
  const functionBytes = Buffer.from('export default {};\n');
  const sourceFiles = [{ path: entrypoint, sha256: hash(functionBytes) }];
  const config = { verify_jwt: false };
  const sourceDigest = hash(canonicalJson({ entrypoint, import_map: null, source_files: sourceFiles }));
  const contract = { id: 'web-control-centers-b2-scheduled-publishing-v1',
    to_phase: 'web-control-centers-b2', baseline_sha: baseline, reviewed_source_sha: source,
    integration_base_sha: integration,
    productive_changes: [{ path: migrationPath, sha256: hash(migrationBytes) }],
    functions: [{ name: 'process-scheduled-publications', verify_jwt: false,
      source_sha256: sourceDigest, config_sha256: hash(canonicalJson(config)) }] };
  const publicContractSha256 = hash(canonicalJson(contract));
  const securityRows = [
    ...functionRows.map(row => ({ kind: 'function_acl', value: {
      identity: `${row.schema}.${row.name}(${row.argument_types.join(',').replaceAll(' ', '')})`, acl: row.acl, execute: row.execute } })),
    ...relationRows.map(row => ({ kind: 'relation_acl', value: { identity: row.identity, acl: row.acl, access: row.access } })),
  ].map(row => ({ ...row, value: { ...row.value, acl: [...row.value.acl].sort((a,b) => `${a.grantee}\0${a.privilege_type}` < `${b.grantee}\0${b.privilege_type}` ? -1 : 1) } }));
  const records = [...catalogRows.filter(row => ['function', 'relation'].includes(row.kind)), ...securityRows].map(({ kind, value }) => {
    const expectedCanonicalJson = canonicalJson(value).trimEnd();
    return { kind, identity: value.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) };
  }).sort((a, b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  const authority = { schemaVersion: 1, authorityId: 'web-control-centers-b2-release-authority-v1',
    publicContractSha256, phase: contract.to_phase,
    issuedFor: { baselineSha: baseline, reviewedSourceSha: source, integrationBaseSha: integration },
    successorCatalog: { schemaVersion: 1, records },
    securityAdvisor: { schemaVersion: 1, baselineSha256: '5'.repeat(64), records: [] },
    backup: { schemaVersion: 1, provider: 'supabase', kind: 'physical', projectRefSha256: '6'.repeat(64),
      evidenceSha256: '7'.repeat(64), status: 'COMPLETED', completedAt: '2026-11-10T10:00:00.000Z',
      expiresAt: '2026-11-11T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: ['web-control-centers-b2'],
      authorizationSha256: '8'.repeat(64), approvedAt: '2026-11-10T11:00:00.000Z',
      expiresAt: '2026-11-11T11:00:00.000Z' } };
  const authorityJson = JSON.stringify(authority);
  const descriptorBytes = Buffer.from(JSON.stringify({ schema_version: 1, contract,
    public_contract_sha256: publicContractSha256, private_authority: { required: true,
      schema_version: 1, authority_id: authority.authorityId, sha256: hash(authorityJson) } }));
  const authorityContext = createReleaseAuthorityContext({ descriptorBytes,
    expectedDescriptorSha256: hash(descriptorBytes), phase: contract.to_phase, transitionId: contract.id,
    baselineSha: baseline, reviewedSourceSha: source, integrationBaseSha: integration,
    requestedAt: at, authorityJson, expectedPrivateAuthoritySha256: hash(authorityJson) });
  const manifest = { identity: { approved_sha: source }, resources: {
    migrations: [{ path: migrationPath, sha256: hash(migrationBytes) }],
    function_contracts: [{ name: 'process-scheduled-publications', entrypoint, import_map: null,
      verify_jwt: false, source_changed: true, source_files: sourceFiles, source_sha256: sourceDigest }] } };
  const reviewedTree = createTrustedB2ReviewedTree({ approvedSha: source,
    files: [{ path: migrationPath, bytes: migrationBytes }, { path: entrypoint, bytes: functionBytes }],
    functionConfigs: [{ name: 'process-scheduled-publications', config }] });
  assert.equal(verifyB2DatabaseSourcePreflight({ authorityContext, manifest, descriptorBytes, migrationBytes }), true);
  const deployedFunctionInventory = createTrustedB2DeployedFunctionInventory({ capturedAt: at,
    functions: [{ name: 'process-scheduled-publications', deployedSha256: '9'.repeat(64) }] });
  let parity;
  assert.doesNotThrow(() => { parity = compileB2SourceParity({ authorityContext, manifest, descriptorBytes,
    reviewedTree, deployedFunctionInventory, capturedAt: at }); }, 'reviewed source must compile against real PostgreSQL function definitions');
  const functions = normalizeB2DatabaseFunctionAttestations(functionRows);
  assert.deepEqual(parity.databaseFunctions, functions.items, 'all 30 compiled function definitions and security fields equal PostgreSQL');
  assert.equal(verifyB2DatabaseFunctionAuthority(functions.items, parity.databaseFunctions, authorityContext), true);
  const relations = relationRows.map(row => ({ ...row,
    definitionSha256: catalogRows.find(record => record.kind === 'relation' && record.value.identity === row.identity).value.definitionSha256 }));
  assert.deepEqual(parity.databaseRelations, relations, 'all 7 compiled relation ACL/access rows equal PostgreSQL');
  assert.equal(verifyB2DatabaseRelationAuthority(relations, parity.databaseRelations, authorityContext), true);
  let negativeChecks = 0;
  for (let index = 0; index < functions.items.length; index++) {
    for (const mutate of [row => { row.definition_sha256 = '0'.repeat(64); },
      row => { row.acl[0].is_grantable = !row.acl[0].is_grantable; },
      row => { row.execute.anon = !row.execute.anon; }]) {
      const changed = structuredClone(functions.items); mutate(changed[index]);
      assert.throws(() => verifyB2DatabaseFunctionAuthority(changed, parity.databaseFunctions, authorityContext),
        { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' }); negativeChecks++;
    }
  }
  for (let index = 0; index < relations.length; index++) {
    for (const mutate of [row => { row.acl[0].is_grantable = !row.acl[0].is_grantable; },
      row => { row.access.anon = !row.access.anon; }]) {
      const changed = structuredClone(relations); mutate(changed[index]);
      assert.throws(() => verifyB2DatabaseRelationAuthority(changed, parity.databaseRelations, authorityContext),
        { code: 'B2_SNAPSHOT_AUTHORITY_INVALID' }); negativeChecks++;
    }
  }
  console.log(`B2_POSTGRES_SOURCE_PARITY_PASS functions=30 relations=7 negativeChecks=${negativeChecks} postgres=17 syntheticOnly=true`);
}
