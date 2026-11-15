import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import test from 'node:test';
import {
  parseB2PrivateAuthority,
  parsePrivateAuthority,
  parsePrivatePreparationJson,
} from '../scripts/nelyon-private-authority.mjs';
import { preparePrivatePlan } from '../scripts/nelyon-private-preparation.mjs';

// Entirely synthetic. Byte agreement is not owner approval or installed state.
const MARKER = 'SYNTHETIC_PRIVATE_MARKER';
const source = '{"schemaVersion":1,"policy":{"schema_version":2,"owner":"SYNTHETIC_PRIVATE_MARKER","scope":["local"]}}';
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const BLOCKED = { schemaVersion: 1, result: 'BLOCKED', releaseReady: false };

const EXPECTED_AT = '2026-11-08T12:00:00.000Z';
const normalize = value => Array.isArray(value) ? value.map(normalize)
  : value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const compactCanonical = value => JSON.stringify(normalize(value));
const projections = {
  function_acl: { identity: 'private.synthetic()', acl: [{ grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }],
    execute: { public: false, anon: false, authenticated: false, service_role: false } },
  relation_acl: { identity: 'private.synthetic', acl: [{ grantee: 'postgres', privilege_type: 'SELECT', is_grantable: false }],
    access: { public: false, anon: false, authenticated: false, service_role: false } },
  relation: { identity: 'private.synthetic', rls: true, forceRls: false, owner: MARKER,
    definitionSha256: 'a'.repeat(64) },
  function: { identity: 'private.synthetic()', execute: false, owner: MARKER,
    securityDefiner: true, searchPath: ['private'], definitionSha256: 'a'.repeat(64) },
  policy: { identity: 'private.synthetic.policy', relation: 'private.synthetic', command: 'SELECT',
    roles: ['authenticated'], using: 'true', check: null },
  trigger: { identity: 'private.synthetic.trigger', relation: 'private.synthetic',
    functionIdentity: 'private.synthetic()', enabled: 'O', definitionSha256: 'a'.repeat(64) },
  index: { identity: 'private.synthetic_idx', relation: 'private.synthetic', valid: true,
    ready: true, unique: false, definitionSha256: 'a'.repeat(64) },
  cron_job: { identity: 'synthetic-job', schedule: '*/5 * * * *', commandSha256: 'a'.repeat(64),
    database: 'postgres', username: MARKER, active: true },
  function_inventory: { identity: 'synthetic-function', verifyJwt: true,
    sourceSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64) },
};
const advisorProjection = { fingerprint: 'c'.repeat(64), identity: 'synthetic-finding',
  type: 'function_security', severity: 'WARN', objectSha256: 'a'.repeat(64),
  attestationSha256: 'b'.repeat(64), negativeEvidenceSha256: 'd'.repeat(64), originSha256: 'e'.repeat(64) };
const catalogExpected = compactCanonical(projections.function);
const advisorExpected = compactCanonical(advisorProjection);

function projectionRecord(kind, projection = projections[kind]) {
  const expectedCanonicalJson = compactCanonical(projection);
  return { kind, identity: projection.identity, expectedCanonicalJson,
    expectedSha256: digest(expectedCanonicalJson) };
}

function replaceProjection(record, projection) {
  record.expectedCanonicalJson = compactCanonical(projection);
  record.expectedSha256 = digest(record.expectedCanonicalJson);
}

function b2Authority(overrides = {}) {
  const value = {
    schemaVersion: 1,
    authorityId: 'web-control-centers-b2-private-authority-v1',
    publicContractSha256: '1'.repeat(64),
    phase: 'web-control-centers-b2',
    issuedFor: {
      baselineSha: '2'.repeat(40),
      reviewedSourceSha: '3'.repeat(40),
      integrationBaseSha: '4'.repeat(40),
    },
    successorCatalog: {
      schemaVersion: 1,
      records: [{
        kind: 'function',
        identity: 'private.synthetic()',
        expectedCanonicalJson: catalogExpected,
        expectedSha256: digest(catalogExpected),
      }],
    },
    securityAdvisor: {
      schemaVersion: 1,
      baselineSha256: '5'.repeat(64),
      records: [{
        action: 'retain',
        identity: 'synthetic-finding',
        expectedCanonicalJson: advisorExpected,
        expectedSha256: digest(advisorExpected),
      }],
    },
    backup: {
      schemaVersion: 1,
      provider: 'supabase',
      kind: 'physical',
      projectRefSha256: '6'.repeat(64),
      evidenceSha256: '7'.repeat(64),
      status: 'COMPLETED',
      completedAt: '2026-11-08T10:00:00.000Z',
      expiresAt: '2026-11-09T10:00:00.000Z',
    },
    approval: {
      schemaVersion: 1,
      decision: 'APPROVED',
      scope: ['web-control-centers-b2'],
      authorizationSha256: '8'.repeat(64),
      approvedAt: '2026-11-08T11:00:00.000Z',
      expiresAt: '2026-11-09T11:00:00.000Z',
    },
    ...overrides,
  };
  return JSON.stringify(value);
}

function rejectedB2(text, expected = digest(typeof text === 'string' ? text : ''), at = EXPECTED_AT) {
  assert.throws(() => parseB2PrivateAuthority(text, expected, at), error => {
    assert.equal(error.message, 'Private preparation input rejected');
    assert.equal(error.code, 'PRIVATE_PREPARATION_INPUT_INVALID');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(error.stack, 'Error: Private preparation input rejected');
    for (const surface of [String(error), JSON.stringify(error), inspect(error), error.stack]) {
      assert.equal(surface.includes(MARKER), false);
    }
    return true;
  });
}

test('B2 authority accepts one exact closed envelope and deeply freezes it', () => {
  const source = b2Authority();
  const parsed = parseB2PrivateAuthority(source, digest(source), EXPECTED_AT);
  assert.equal(parsed.sha256, digest(source));
  assert.equal(parsed.authority.authorityId, 'web-control-centers-b2-private-authority-v1');
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.authority));
  assert.ok(Object.isFrozen(parsed.authority.successorCatalog.records));
  assert.ok(Object.isFrozen(parsed.authority.securityAdvisor.records[0]));
  assert.throws(() => parsed.authority.successorCatalog.records.push({}), TypeError);
});

test('B2 authority rejects reordered, extra, duplicate, stale and expired envelope facts', () => {
  const valid = JSON.parse(b2Authority());
  rejectedB2(JSON.stringify({ authorityId: valid.authorityId, schemaVersion: 1,
    ...Object.fromEntries(Object.entries(valid).slice(2)) }));
  rejectedB2(JSON.stringify({ ...valid, extra: true }));
  rejectedB2(b2Authority().replace('"phase":"web-control-centers-b2"',
    '"phase":"web-control-centers-b2","phase":"web-control-centers-b2"'));
  rejectedB2(b2Authority({ phase: 'web-control-centers-b1' }));
  rejectedB2(b2Authority({ backup: { ...valid.backup, expiresAt: EXPECTED_AT } }), undefined,
    '2026-11-08T12:00:00.001Z');
  rejectedB2(b2Authority({ approval: { ...valid.approval, expiresAt: EXPECTED_AT } }), undefined,
    '2026-11-08T12:00:00.001Z');
});

test('B2 authority enforces record ordering, uniqueness, bounds and embedded canonical digests', () => {
  const a = projectionRecord('function', { ...projections.function, identity: 'a' });
  const b = projectionRecord('function', { ...projections.function, identity: 'b' });
  assert.doesNotThrow(() => {
    const text = b2Authority({ successorCatalog: { schemaVersion: 1, records: [a, b] } });
    parseB2PrivateAuthority(text, digest(text), EXPECTED_AT);
  });
  rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [b, a] } }));
  rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [a, a] } }));
  rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [{
    ...a, expectedSha256: '9'.repeat(64),
  }] } }));
  rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [{
    ...a, expectedCanonicalJson: '{"z":1,"a":2}',
    expectedSha256: digest('{"z":1,"a":2}'),
  }] } }));
  rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1,
    records: Array.from({ length: 513 }, (_, i) => ({ ...a, identity: `item-${String(i).padStart(3, '0')}` })) } }));
});

test('B2 authority validates exact identities, timestamps and normalized bounded strings', () => {
  const valid = JSON.parse(b2Authority());
  rejectedB2(b2Authority({ authorityId: 'x'.repeat(129) }));
  rejectedB2(b2Authority({ authorityId: 'e\u0301' }));
  rejectedB2(b2Authority({ issuedFor: { ...valid.issuedFor, baselineSha: 'A'.repeat(40) } }));
  rejectedB2(b2Authority({ backup: { ...valid.backup, completedAt: '2026-11-08T10:00:00Z' } }));
  rejectedB2(b2Authority({ approval: { ...valid.approval,
    approvedAt: '2026-11-08T09:00:00.000Z' } }));
  rejectedB2(b2Authority({ securityAdvisor: { schemaVersion: 1, baselineSha256: '5'.repeat(64),
    records: [{ ...valid.securityAdvisor.records[0], identity: 'x'.repeat(513) }] } }));
});

for (const [kind, projection] of Object.entries(projections)) {
  test(`B2 ${kind} projection accepts its registered closed schema`, () => {
    const text = b2Authority({ successorCatalog: { schemaVersion: 1,
      records: [projectionRecord(kind)] } });
    assert.doesNotThrow(() => parseB2PrivateAuthority(text, digest(text), EXPECTED_AT));
  });
  for (const [mutation, changed] of [
    ['empty', {}], ['extra', { ...projection, extra: true }],
    ['missing', Object.fromEntries(Object.entries(projection).slice(1))],
    ['wrong-type', { ...projection, [Object.keys(projection)[1]]: [] }],
    ['wrong-kind', kind === 'function' ? projections.relation : projections.function],
    ['identity-mismatch', { ...projection, identity: 'different' }],
  ]) {
    test(`B2 ${kind} projection rejects ${mutation}`, () => {
      const record = projectionRecord(kind);
      replaceProjection(record, changed);
      rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [record] } }));
    });
  }
}

for (const kind of ['relation_acl', 'function_acl']) {
  for (const change of [
    value => { value.acl.push({ ...value.acl[0] }); },
    value => { value.acl[0].is_grantable = 'false'; },
    value => { value.acl[0].extra = true; },
    value => { value.acl[0].privilege_type = 'UNKNOWN'; },
    value => { (value.access ?? value.execute).anon = 'false'; },
    value => { (value.access ?? value.execute).extra = false; },
  ]) test(`${kind} rejects malformed or duplicate ACL/access entries ${change}`, () => {
    const record = projectionRecord(kind), projection = structuredClone(projections[kind]);
    change(projection); replaceProjection(record, projection);
    rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [record] } }));
  });
}

for (const [mutation, projection] of [
  ['empty', {}], ['extra', { ...advisorProjection, extra: true }],
  ...Object.keys(advisorProjection).flatMap(key => [
    [`missing-${key}`, Object.fromEntries(Object.entries(advisorProjection).filter(([name]) => name !== key))],
    [`wrong-type-${key}`, { ...advisorProjection, [key]: [] }],
  ]),
  ['identity-mismatch', { ...advisorProjection, identity: 'different' }],
  ['invalid-severity', { ...advisorProjection, severity: 'UNKNOWN' }],
]) {
  test(`B2 Advisor projection rejects ${mutation}`, () => {
    const value = JSON.parse(b2Authority());
    replaceProjection(value.securityAdvisor.records[0], projection);
    rejectedB2(JSON.stringify(value));
  });
}

const digestPaths = [
  ['publicContractSha256'], ['issuedFor', 'baselineSha'], ['issuedFor', 'reviewedSourceSha'],
  ['issuedFor', 'integrationBaseSha'], ['successorCatalog', 'records', 0, 'expectedSha256'],
  ['securityAdvisor', 'baselineSha256'], ['securityAdvisor', 'records', 0, 'expectedSha256'],
  ['backup', 'projectRefSha256'], ['backup', 'evidenceSha256'], ['approval', 'authorizationSha256'],
];
for (const path of digestPaths) {
  for (const [name, invalid] of [['array', value => [value]], ['nested-array', value => [[value]]],
    ['object', () => ({})], ['null', () => null], ['number', () => 123]]) {
    test(`B2 ${path.join('.')} rejects ${name} instead of coercing`, () => {
      const value = JSON.parse(b2Authority());
      const parent = path.slice(0, -1).reduce((current, key) => current[key], value);
      const key = path.at(-1);
      parent[key] = invalid(parent[key]);
      rejectedB2(JSON.stringify(value));
    });
  }
}

for (const actions of [['add', 'remove'], ['replace', 'retain']]) {
  test(`B2 Advisor rejects one identity with conflicting ${actions.join('/')} actions`, () => {
    const value = JSON.parse(b2Authority());
    value.securityAdvisor.records = actions.map(action => ({ ...value.securityAdvisor.records[0], action }));
    rejectedB2(JSON.stringify(value));
  });
}

test('B2 Advisor accepts sorted distinct identities and rejects ordering, duplicate and count violations', () => {
  const value = JSON.parse(b2Authority());
  const a = { ...value.securityAdvisor.records[0], action: 'add' };
  const b = { ...a, identity: 'z-finding' };
  replaceProjection(b, { ...advisorProjection, identity: b.identity, fingerprint: 'd'.repeat(64) });
  value.securityAdvisor.records = [a, b];
  let text = JSON.stringify(value);
  assert.doesNotThrow(() => parseB2PrivateAuthority(text, digest(text), EXPECTED_AT));
  for (const records of [[b, a], [a, a], Array(257).fill(a)]) {
    value.securityAdvisor.records = records;
    rejectedB2(JSON.stringify(value));
  }
});

for (const [name, invalid] of [['high-surrogate', '\ud800'], ['low-surrogate', '\udfff'],
  ['C1-control', '\u0085'], ['escaped-C0-control', '\u0000'], ['non-NFC', 'e\u0301']]) {
  test(`B2 decoded envelope rejects ${name}`, () => rejectedB2(b2Authority({ authorityId: invalid })));
  test(`B2 decoded projection rejects ${name}`, () => {
    const record = projectionRecord('function', { ...projections.function, owner: invalid });
    rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [record] } }));
  });
  test(`B2 decoded nested projection string rejects ${name}`, () => {
    const record = projectionRecord('function', { ...projections.function, searchPath: [invalid] });
    rejectedB2(b2Authority({ successorCatalog: { schemaVersion: 1, records: [record] } }));
  });
}

for (const section of ['backup', 'approval']) {
  test(`B2 ${section} expiry is exclusive at the requested instant`, () => {
    const value = JSON.parse(b2Authority());
    value[section].expiresAt = EXPECTED_AT;
    const text = JSON.stringify(value);
    assert.doesNotThrow(() => parseB2PrivateAuthority(text, digest(text), '2026-11-08T11:59:59.999Z'));
    rejectedB2(text, digest(text), EXPECTED_AT);
    rejectedB2(text, digest(text), '2026-11-08T12:00:00.001Z');
  });
}

test('B2 marked rejection keeps errors and child stdout/stderr free of private bytes', () => {
  const value = JSON.parse(b2Authority());
  assert.ok(JSON.stringify(value).includes(MARKER));
  value.publicContractSha256 = [value.publicContractSha256];
  const text = JSON.stringify(value);
  rejectedB2(text);
  const moduleUrl = new URL('../scripts/nelyon-private-authority.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { parseB2PrivateAuthority } from ${JSON.stringify(moduleUrl)};
    import { createHash } from 'node:crypto';
    import { inspect } from 'node:util';
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    try { parseB2PrivateAuthority(text, createHash('sha256').update(text).digest('hex'), '${EXPECTED_AT}');
      process.stdout.write('UNEXPECTED_SUCCESS');
    } catch (error) {
      process.stdout.write([String(error), JSON.stringify(error), inspect(error), error.stack].join('\\n'));
    }
  `], { input: text, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.ok(child.stdout.includes('PRIVATE_PREPARATION_INPUT_INVALID'));
  assert.equal(child.stdout.includes(MARKER), false);
  assert.equal(child.stderr, '');
});

function rejected(text, ...expectations) {
  const expected = expectations.length ? expectations[0] : digest(typeof text === 'string' ? text : '');
  assert.throws(() => parsePrivateAuthority(text, expected), error => {
    assert.equal(error.message, 'Private preparation input rejected');
    assert.equal(error.code, 'PRIVATE_PREPARATION_INPUT_INVALID');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(JSON.stringify(error).includes(MARKER), false);
    assert.equal(String(error).includes(MARKER), false);
    assert.equal(error.stack, 'Error: Private preparation input rejected');
    return true;
  });
}

test('exact text and independent digest yield one deeply immutable private context', () => {
  const context = parsePrivateAuthority(source, digest(source));
  assert.equal(context.policy.owner, MARKER);
  assert.equal(context.sha256, digest(source));
  assert.deepEqual(Object.keys(context).sort(), ['policy', 'sha256']);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.policy));
  assert.ok(Object.isFrozen(context.policy.scope));
  assert.throws(() => { context.policy.scope.push('release'); }, TypeError);
  assert.throws(() => { context.policy.owner = 'other'; }, TypeError);
  assert.equal(context.policy.owner, MARKER);
});

test('bounded intake accepts the byte limit exactly rather than silently truncating', () => {
  const prefix = '{"schemaVersion":1,"policy":{"value":"';
  const suffix = '"}}';
  const atLimit = prefix + 'x'.repeat(2 * 1024 * 1024 - prefix.length - suffix.length) + suffix;
  assert.equal(parsePrivateAuthority(atLimit, digest(atLimit)).policy.value.length,
    2 * 1024 * 1024 - prefix.length - suffix.length);
  rejected(prefix + 'x'.repeat(2 * 1024 * 1024 - prefix.length - suffix.length + 1) + suffix);
});

for (const [name, value] of [
  ['missing text', undefined], ['URL instead of JSON', 'https://example.invalid/private'],
  ['file path instead of JSON', 'D:\\private\\authority.json'], ['object instead of text', {}],
  ['JSON null', 'null'], ['JSON array', '[]'], ['empty object', '{}'],
  ['unknown envelope schema', '{"schemaVersion":2,"policy":{}}'],
  ['missing schema', '{"policy":{}}'], ['missing policy', '{"schemaVersion":1}'],
  ['null policy', '{"schemaVersion":1,"policy":null}'],
  ['array policy', '{"schemaVersion":1,"policy":[]}'],
  ['self-supplied digest', '{"schemaVersion":1,"policy":{},"sha256":"' + 'a'.repeat(64) + '"}'],
  ['extra envelope field', '{"schemaVersion":1,"policy":{},"releaseReady":true}'],
  ['duplicate envelope key', '{"schemaVersion":1,"policy":{},"policy":{}}'],
  ['duplicate nested key', '{"schemaVersion":1,"policy":{"owner":"old","owner":"SYNTHETIC_PRIVATE_MARKER"}}'],
  ['escaped duplicate key', '{"schemaVersion":1,"policy":{"owner":1,"own\\u0065r":2}}'],
  ['unsafe prototype field', '{"schemaVersion":1,"policy":{"__proto__":{"releaseReady":true}}}'],
  ['unsafe constructor field', '{"schemaVersion":1,"policy":{"constructor":{}}}'],
  ['noncompact encoding', '{ "schemaVersion":1,"policy":{}}'],
  ['trailing newline', source + '\n'],
  ['invalid JSON', '{"schemaVersion":1,"policy":"SYNTHETIC_PRIVATE_MARKER"'],
  ['nonfinite parsed number', '{"schemaVersion":1,"policy":{"value":1e400}}'],
  ['ill-formed Unicode text', '{"schemaVersion":1,"policy":{"value":"\ud800"}}'],
  ['over byte limit', JSON.stringify({ schemaVersion: 1, policy: { value: 'x'.repeat(2 * 1024 * 1024) } })],
  ['over depth limit', '{"schemaVersion":1,"policy":{"value":' + '['.repeat(49) + '0' + ']'.repeat(49) + '}}'],
  ['over node limit', JSON.stringify({ schemaVersion: 1, policy: { values: Array(50001).fill(0) } })],
]) {
  test(`intake rejects ${name} without disclosing content`, () => rejected(value));
}

for (const expected of [undefined, null, '', 'a'.repeat(63), 'A'.repeat(64), 'b'.repeat(64), {}]) {
  test(`intake rejects invalid or mismatched independent digest (${String(expected)})`, () => rejected(source, expected));
}

test('bounded JSON decoder freezes input without inventing missing fields', () => {
  const parsed = parsePrivatePreparationJson('{"mode":"plan_only","pre":{}}');
  assert.deepEqual(parsed, { mode: 'plan_only', pre: {} });
  assert.ok(Object.isFrozen(parsed.pre));
});

test('intake does not invoke user object coercion', () => {
  let invoked = 0;
  const value = { toString() { invoked++; throw new Error(MARKER); } };
  rejected(value, 'a'.repeat(64));
  assert.equal(invoked, 0);
});

test('facade returns a frozen generic block for synthetic authority rejected by real gates', () => {
  const result = preparePrivatePlan({
    authorityJson: source, expectedSha256: digest(source),
    requestJson: '{"mode":"plan_only"}', preSnapshotJson: '{}',
    cwd: 'D:\\synthetic-unavailable-repository',
    adapterSourceSha256: 'a'.repeat(64), generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(result, BLOCKED);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes(MARKER), false);
});

for (const mode of ['release', 'gate_proof', 'postcheck_recovery', 'admin_recovery', null]) {
  test(`facade does not enable ${String(mode)} mode`, () => {
    const result = preparePrivatePlan({ authorityJson: source, expectedSha256: digest(source),
      requestJson: JSON.stringify({ mode }), preSnapshotJson: '{}' });
    assert.deepEqual(result, BLOCKED);
  });
}

test('facade catches missing inputs and exception text without emitting it', () => {
  assert.deepEqual(preparePrivatePlan(), BLOCKED);
  assert.deepEqual(preparePrivatePlan({ get authorityJson() { throw new Error(MARKER); } }), BLOCKED);
  assert.deepEqual(preparePrivatePlan({ authorityJson: source, expectedSha256: 'f'.repeat(64) }), BLOCKED);
});

test('real compiler keeps failing Git diagnostics in captured pipes, not parent stderr', () => {
  const unavailableGitDirectory = resolve('SYNTHETIC_PRIVATE_GIT_DIRECTORY_DOES_NOT_EXIST');
  assert.equal(existsSync(unavailableGitDirectory), false);
  const gateUrl = new URL('../scripts/nelyon-production-release.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { compileLocalEvidence } from ${JSON.stringify(gateUrl)};
    try {
      compileLocalEvidence({ cwd: process.cwd(),
        policy: { baseline: { sha: '${'a'.repeat(40)}' }, repository: 'synthetic/repository' },
        request: { approvedSha: '${'b'.repeat(40)}' } });
      process.stdout.write('UNEXPECTED_SUCCESS');
    } catch { process.stdout.write('BLOCKED'); }
  `], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GIT_DIR: unavailableGitDirectory } });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, 'BLOCKED');
  assert.equal(child.stderr, '');
});
