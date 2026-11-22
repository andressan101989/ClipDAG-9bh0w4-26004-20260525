import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  B2_CATALOG_SQL,
  B2_DATABASE_FUNCTION_SCOPE,
  B2_DATABASE_RELATION_SCOPE,
  B2_RELATION_ACL_SQL,
  RPC_SECURITY_ATTESTATION_SQL,
} from '../scripts/nelyon-production-snapshot-adapter.mjs';

const proof = readFileSync(new URL('../scripts/prove-web-control-centers-b2-disposable.mjs', import.meta.url), 'utf8');
const cronFixture = readFileSync(new URL('./fixtures/web-control-centers-b2-cron-stubs.sql', import.meta.url), 'utf8');

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
  for (const query of [B2_CATALOG_SQL, B2_RELATION_ACL_SQL]) {
    assert.doesNotMatch(query, /publication_schedule%|relname\s+like|jobname\s+like/i,
      'B2 relation and cron authority must never be wildcard-scoped');
    for (const identity of B2_DATABASE_RELATION_SCOPE) assert.match(query, new RegExp(identity.replace('.', '\\.')));
  }
  assert.match(B2_CATALOG_SQL, /j\.jobname\s*=\s*'process-scheduled-publications-b2'/i);
  assert.match(B2_CATALOG_SQL, /'usingSha256'.*sha256\(convert_to\(\s*pg_catalog\.pg_get_expr\(p\.polqual,p\.polrelid\),'UTF8'\)\)/is);
  assert.match(B2_CATALOG_SQL, /'checkSha256'.*sha256\(convert_to\(\s*pg_catalog\.pg_get_expr\(p\.polwithcheck,p\.polrelid\),'UTF8'\)\)/is);
  assert.equal(B2_DATABASE_RELATION_SCOPE.length, 7);
  assert.equal(new Set(B2_DATABASE_RELATION_SCOPE).size, 7);
});

test('B2 disposable proof executes the three real adapter queries after an inert synthetic cron fixture', () => {
  assert.equal(B2_DATABASE_FUNCTION_SCOPE.length, 31);
  assert.equal(new Set(B2_DATABASE_FUNCTION_SCOPE).size, 31);

  assert.match(proof, /import\s*\{[\s\S]*\bB2_CATALOG_SQL\b[\s\S]*\bB2_DATABASE_FUNCTION_SCOPE\b[\s\S]*\bB2_RELATION_ACL_SQL\b[\s\S]*\bRPC_SECURITY_ATTESTATION_SQL\b[\s\S]*\}\s*from\s*['"]\.\/nelyon-production-snapshot-adapter\.mjs['"]/);

  const syntheticCron = proof.indexOf("sql(read('tests/fixtures/web-control-centers-b2-cron-stubs.sql'))");
  const migration = proof.indexOf("sql(read('supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql'))");
  const proofInvocation = proof.indexOf('runB2PostgresQueryProof();', migration);
  const catalogQuery = proof.indexOf('${B2_CATALOG_SQL}');
  const functionQuery = proof.indexOf('${RPC_SECURITY_ATTESTATION_SQL}', catalogQuery);
  const relationQuery = proof.indexOf('${B2_RELATION_ACL_SQL}', functionQuery);
  assert.ok(syntheticCron >= 0, 'the proof must load its explicit inert cron fixture');
  assert.ok(migration > syntheticCron, 'the B2 migration must execute after the inert cron fixture');
  assert.ok(migration >= 0, 'B2 migration must remain in the disposable lifecycle');
  assert.ok(proofInvocation > migration, 'the query proof must execute after the B1 to B2 migration');
  assert.ok(catalogQuery >= 0, 'the proof must execute the exact catalog query');
  assert.ok(functionQuery > catalogQuery, 'the exact parameterized function query must execute without a copied SQL authority');
  assert.ok(relationQuery > functionQuery, 'the exact relation query must execute without a copied SQL authority');
  assert.match(cronFixture, /create schema cron/);
  assert.match(cronFixture, /create function cron\.schedule/);
  assert.match(cronFixture, /create function cron\.alter_job/);
  assert.match(cronFixture, /create function net\.http_post/);
  assert.match(proof, /executeB2AdapterQueries\('default'\)/,
    'the exact adapter queries must execute under the transport-default search path');
  assert.match(proof, /executeB2AdapterQueries\('empty'\)/,
    'the exact adapter queries must also execute under an empty search path');
  assert.match(proof, /adapter query results are search-path independent/,
    'both search-path variants must return identical runtime-consumed rows');

  assert.match(proof, /synthetic-publication-query-proof/);
  assert.match(cronFixture, /active\s+boolean\s+not\s+null/);
  assert.match(proof, /'synthetic-publication-query-proof',[\s\S]*?false/);
  assert.match(proof, /pg_extension[\s\S]*?pg_cron/);
  assert.match(proof, /tableAclPrivileges\s*=\s*new Set\(\[[^\]]*'MAINTAIN'[^\]]*\]\)/,
    'PostgreSQL 17 owner ACL shape includes the MAINTAIN table privilege');
  assert.match(proof, /B2_POSTGRES_QUERY_PROOF_PASS/);
  assert.match(proof, /syntheticCronExcluded:true/);
  assert.match(proof, /pgCronExtension:false/);
  assert.match(proof, /CLEANUP[\s\S]*?serverStopped[\s\S]*?directoryRemoved/);
});
