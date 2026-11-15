import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { b2FreshAdvisors, normalizeSecurityAdvisors } from '../scripts/nelyon-production-snapshot-adapter.mjs';

// Synthetic findings only. Same object, distinct finding types must not collide.
const metadata = { schema: 'public', name: 'synthetic_rpc', arguments: 'uuid', type: 'function' };
const lints = ['synthetic_anonymous_execute', 'synthetic_authenticated_execute'].map(name => ({
  name, level: 'WARN', facing: 'EXTERNAL', categories: ['SECURITY'], metadata,
}));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
// Independently construct the documented semantic fingerprint, not with the normalizer under test.
const proofs = lints.map(lint => ({ fingerprint: hash(canonical({ ...lint,
  cache_key: `${lint.name}_public_synthetic_rpc_uuid` })),
action: 'add', objectIdentity: 'function:public.synthetic_rpc',
attestationSha256: '1'.repeat(64), negativeEvidenceSha256: '2'.repeat(64), originSha256: '3'.repeat(64) }));
const grouped = () => ({ lints: lints.map(({ metadata: value, ...fields }) => ({
  ...fields, count: 1, findings: [{ metadata: value }],
})) });

test('B2 Advisor distinguishes finding types on one object and preserves supplied provenance', () => {
  const actual = b2FreshAdvisors({ lints }, proofs);
  assert.deepEqual(actual.map(row => row.identity), proofs.map(proof => `advisor:${proof.fingerprint}`));
  assert.equal(new Set(actual.map(row => row.identity)).size, 2);
  for (const [index, row] of actual.entries()) {
    assert.equal(row.fingerprint, proofs[index].fingerprint);
    assert.equal(row.objectSha256, hash(canonical(metadata)));
    assert.equal(row.objectIdentity, 'function:public.synthetic_rpc');
    assert.equal(row.attestationSha256, '1'.repeat(64));
    assert.equal(row.negativeEvidenceSha256, '2'.repeat(64));
    assert.equal(row.originSha256, '3'.repeat(64));
  }
});

test('B2 Advisor retain proves baseline membership without rebranding it as technical claims', () => {
  const retained = proofs.map(proof => ({ action: 'retain', fingerprint: proof.fingerprint,
    objectIdentity: proof.objectIdentity, baselineSha256: '4'.repeat(64) }));
  const rows = b2FreshAdvisors({ lints }, retained);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.baselineSha256 === '4'.repeat(64)));
  assert.ok(rows.every(row => !Object.hasOwn(row, 'attestationSha256') && !Object.hasOwn(row, 'originSha256')));
});

test('B2 Advisor accepts validated grouping without changing flat baseline bytes', () => {
  assert.deepEqual(normalizeSecurityAdvisors(grouped()), normalizeSecurityAdvisors({ lints }));
  assert.deepEqual(b2FreshAdvisors(grouped(), proofs), b2FreshAdvisors({ lints }, proofs));
});

for (const [name, mutate] of [
  ['missing authorization', (body, auth) => auth.pop()],
  ['extra authorization', (body, auth) => auth.push({ ...auth[0], fingerprint: 'f'.repeat(64) })],
  ['duplicate authorization', (body, auth) => { auth[1] = { ...auth[0] }; }],
  ['unknown authorization field', (body, auth) => { auth[0].unknown = true; }],
  ['tampered authorization fingerprint', (body, auth) => { auth[0].fingerprint = 'f'.repeat(64); }],
  ['malformed provenance', (body, auth) => { auth[0].originSha256 = 'untrusted'; }],
  ['false object mapping', (body, auth) => { auth[0].objectIdentity = 'function:public.other_rpc'; }],
  ['remove in successor proof', (body, auth) => { auth[0].action = 'remove'; }],
  ['duplicate finding', body => { body.lints[1] = structuredClone(body.lints[0]); }],
  ['changed finding', body => { body.lints[0].metadata.name = 'another_rpc'; }],
]) {
  test(`B2 Advisor rejects ${name}`, () => {
    const body = structuredClone({ lints }); const auth = structuredClone(proofs);
    mutate(body, auth);
    assert.throws(() => b2FreshAdvisors(body, auth));
  });
}

for (const [name, mutate] of [
  ['false count', body => { body.lints[0].count = 2; }],
  ['nested grouping', body => { body.lints[0].findings[0].findings = []; }],
  ['duplicate grouped identity', body => { body.lints.push(structuredClone(body.lints[0])); }],
]) {
  test(`B2 Advisor rejects ${name}`, () => {
    const body = grouped(); mutate(body);
    assert.throws(() => b2FreshAdvisors(body, proofs));
  });
}
