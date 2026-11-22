import { createHash } from 'node:crypto';

import {
  B2_AUTHORITY_EDGE_FUNCTION_SCOPE,
  B2_AUTHORITY_INDEX_SCOPE,
  B2_AUTHORITY_POLICY_SCOPE,
  B2_AUTHORITY_RELATION_SCOPE,
  B2_AUTHORITY_TRIGGER_SCOPE,
  canonicalB2AuthorityJson,
} from '../../scripts/nelyon-b2-authority-preparation.mjs';
import { b2DatabaseFunctionMatrix, b2SyntheticRelationAclRecords } from './nelyonB2DatabaseFunctionMatrix.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const attestedRecord = (kind, value) => {
  const expectedCanonicalJson = canonicalB2AuthorityJson(value);
  return { kind, identity: value.identity, expectedCanonicalJson, expectedSha256: sha256(expectedCanonicalJson) };
};

// Test-only complete catalog fixture. It deliberately bypasses the opaque real
// disposable capabilities and therefore cannot mint production authority.
export function b2SyntheticCompleteSuccessorCatalog({ functionInventory } = {}) {
  const relations = B2_AUTHORITY_RELATION_SCOPE.map(identity => attestedRecord('relation', {
    identity, rls: true, forceRls: true, owner: 'postgres', definitionSha256: sha256(`relation:${identity}`),
  }));
  const policies = B2_AUTHORITY_POLICY_SCOPE.map(({ identity, relation }) => attestedRecord('policy', {
    identity, relation, command: 'SELECT', roles: ['authenticated'], usingSha256: sha256('true'), checkSha256: null,
  }));
  const triggers = B2_AUTHORITY_TRIGGER_SCOPE.map(({ identity, relation }) => attestedRecord('trigger', {
    identity, relation, functionIdentity: 'private.guard_publication_schedule_audit_v1()', enabled: 'O',
    definitionSha256: sha256(`trigger:${identity}`),
  }));
  const indexes = B2_AUTHORITY_INDEX_SCOPE.map(({ identity, relation }) => attestedRecord('index', {
    identity, relation, valid: true, ready: true, unique: identity.endsWith('_pkey'),
    definitionSha256: sha256(`index:${identity}`),
  }));
  const cron = attestedRecord('cron_job', {
    identity: 'process-scheduled-publications-b2', schedule: '* * * * *',
    commandSha256: sha256('select public.wake_scheduled_publications_b2_v1()'),
    database: 'postgres', username: 'postgres', active: true,
  });
  const inventory = functionInventory ?? B2_AUTHORITY_EDGE_FUNCTION_SCOPE.map(({ name, verifyJwt }) => ({
    identity: name, verifyJwt, sourceSha256: sha256(`source:${name}`), configSha256: sha256(`config:${name}`),
  }));
  const records = [
    ...b2DatabaseFunctionMatrix().records,
    ...relations,
    ...b2SyntheticRelationAclRecords(relations),
    ...policies,
    ...triggers,
    ...indexes,
    cron,
    ...inventory.map(value => attestedRecord('function_inventory', value)),
  ].sort((left, right) => {
    const a = `${left.kind}\0${left.identity}`; const b = `${right.kind}\0${right.identity}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { schemaVersion: 1, records };
}
