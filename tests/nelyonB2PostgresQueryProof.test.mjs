import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  B2_CATALOG_SQL,
  B2_DATABASE_FUNCTION_SCOPE,
  RPC_SECURITY_ATTESTATION_SQL,
} from '../scripts/nelyon-production-snapshot-adapter.mjs';

const proof = readFileSync(new URL('../scripts/prove-web-control-centers-b2-disposable.mjs', import.meta.url), 'utf8');

test('B2 function identity SQL is independent of the session search path', () => {
  for (const query of [B2_CATALOG_SQL, RPC_SECURITY_ATTESTATION_SQL]) {
    assert.match(query, /canonical_context\s+as\s+materialized\s*\(\s*select\s+pg_catalog\.set_config\('search_path','',true\)/i);
    assert.match(query, /pg_catalog\.pg_type\s+argument_type/i);
    assert.match(query, /pg_catalog\.pg_namespace\s+type_namespace/i);
    assert.match(query, /type_namespace\.nspname\s*=\s*'pg_catalog'/i);
    assert.match(query, /pg_catalog\.quote_ident\(type_namespace\.nspname\)/i);
  }
  assert.doesNotMatch(B2_CATALOG_SQL, /oidvectortypes/i);
  assert.doesNotMatch(RPC_SECURITY_ATTESTATION_SQL, /pg_get_function_identity_arguments/i);
});

test('B2 disposable proof executes the three real adapter queries after an inert synthetic cron fixture', () => {
  assert.equal(B2_DATABASE_FUNCTION_SCOPE.length, 30);
  assert.equal(new Set(B2_DATABASE_FUNCTION_SCOPE).size, 30);

  assert.match(proof, /import\s*\{[\s\S]*\bB2_CATALOG_SQL\b[\s\S]*\bB2_DATABASE_FUNCTION_SCOPE\b[\s\S]*\bB2_RELATION_ACL_SQL\b[\s\S]*\bRPC_SECURITY_ATTESTATION_SQL\b[\s\S]*\}\s*from\s*['"]\.\/nelyon-production-snapshot-adapter\.mjs['"]/);

  const migration = proof.indexOf("sql(read('supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql'))");
  const syntheticCron = proof.indexOf('create schema cron');
  const proofInvocation = proof.indexOf('runB2PostgresQueryProof();', migration);
  const catalogQuery = proof.indexOf('${B2_CATALOG_SQL}', syntheticCron);
  const functionQuery = proof.indexOf('${RPC_SECURITY_ATTESTATION_SQL}', catalogQuery);
  const relationQuery = proof.indexOf('${B2_RELATION_ACL_SQL}', functionQuery);
  assert.ok(migration >= 0, 'B2 migration must remain in the disposable lifecycle');
  assert.ok(syntheticCron >= 0, 'the proof must create only its explicit synthetic cron shape');
  assert.ok(proofInvocation > migration, 'the query proof must execute after the B1 to B2 migration');
  assert.ok(catalogQuery > syntheticCron, 'the exact catalog query must execute after the synthetic cron row exists');
  assert.ok(functionQuery > catalogQuery, 'the exact parameterized function query must execute without a copied SQL authority');
  assert.ok(relationQuery > functionQuery, 'the exact relation query must execute without a copied SQL authority');
  assert.match(proof, /executeB2AdapterQueries\('default'\)/,
    'the exact adapter queries must execute under the transport-default search path');
  assert.match(proof, /executeB2AdapterQueries\('empty'\)/,
    'the exact adapter queries must also execute under an empty search path');
  assert.match(proof, /adapter query results are search-path independent/,
    'both search-path variants must return identical runtime-consumed rows');

  assert.match(proof, /synthetic-publication-query-proof/);
  assert.match(proof, /active\s+boolean\s+not\s+null/);
  assert.match(proof, /'synthetic-publication-query-proof',[\s\S]*?false/);
  assert.match(proof, /pg_extension[\s\S]*?pg_cron/);
  assert.match(proof, /tableAclPrivileges\s*=\s*new Set\(\[[^\]]*'MAINTAIN'[^\]]*\]\)/,
    'PostgreSQL 17 owner ACL shape includes the MAINTAIN table privilege');
  assert.match(proof, /B2_POSTGRES_QUERY_PROOF_PASS/);
  assert.match(proof, /syntheticCron:true/);
  assert.match(proof, /pgCronExtension:false/);
  assert.match(proof, /CLEANUP[\s\S]*?serverStopped[\s\S]*?directoryRemoved/);
});
