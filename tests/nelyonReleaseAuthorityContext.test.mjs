import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import test from 'node:test';

const module = await import('../scripts/nelyon-release-authority-context.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const create = (...args) => {
  assert.equal(typeof module.createReleaseAuthorityContext, 'function', 'context factory is implemented');
  return module.createReleaseAuthorityContext(...args);
};
const { publicAuthorityReceipt, assertAuthorityReceiptMatch } = module;
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const MARKER = 'SYNTHETIC_CONTEXT_PRIVATE_MARKER';
const AT = '2026-11-08T12:00:00.000Z';
// Independently specified bytes: deliberately different object insertion order.
const CONTRACT_BYTES = '{"baseline_sha":"' + '2'.repeat(40)
  + '","from_phase":"web-control-centers-b1","id":"synthetic-b2-v1",'
  + '"integration_base_sha":"' + '4'.repeat(40) + '",'
  + '"nested":{"a":[{"a":true,"z":3}],"z":null},'
  + '"reviewed_source_sha":"' + '3'.repeat(40) + '",'
  + '"to_phase":"web-control-centers-b2"}\n';
const RECEIPT_KEYS = ['schemaVersion', 'authorityId', 'descriptorSha256', 'publicContractSha256',
  'privateAuthoritySha256', 'bindingSha256', 'successorCatalogSha256',
  'securityAdvisorSha256', 'backupSha256', 'approvalSha256', 'verified'];

function fixture() {
  const contract = {
    to_phase: 'web-control-centers-b2', reviewed_source_sha: '3'.repeat(40),
    nested: { z: null, a: [{ z: 3, a: true }] }, integration_base_sha: '4'.repeat(40),
    id: 'synthetic-b2-v1', from_phase: 'web-control-centers-b1', baseline_sha: '2'.repeat(40),
  };
  const expectedCanonicalJson = '{"definitionSha256":"' + 'a'.repeat(64)
    + '","forceRls":false,"identity":"private.synthetic",'
    + '"owner":"' + MARKER + '","rls":true}';
  const authority = {
    schemaVersion: 1, authorityId: 'synthetic-b2-authority', publicContractSha256: hash(CONTRACT_BYTES),
    phase: 'web-control-centers-b2', issuedFor: { baselineSha: '2'.repeat(40),
      reviewedSourceSha: '3'.repeat(40), integrationBaseSha: '4'.repeat(40) },
    successorCatalog: { schemaVersion: 1, records: [{ kind: 'relation', identity: 'private.synthetic',
      expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) }] },
    securityAdvisor: { schemaVersion: 2, baselineSha256: hash('[]\n'), baselineItems: [], records: [] },
    backup: { schemaVersion: 2, provider: 'supabase', kind: 'physical', projectRefSha256: '6'.repeat(64),
      evidenceSha256: '7'.repeat(64), status: 'COMPLETED', insertedAt: '2026-11-08T10:00:00.000Z', completedObservedAt: '2026-11-08T10:30:00.000Z',
      expiresAt: '2026-11-09T10:00:00.000Z' },
    approval: { schemaVersion: 1, decision: 'APPROVED', scope: ['web-control-centers-b2'],
      authorizationSha256: '8'.repeat(64), approvedAt: '2026-11-08T11:00:00.000Z',
      expiresAt: '2026-11-09T11:00:00.000Z' },
  };
  const authorityJson = JSON.stringify(authority);
  const expectedPrivateAuthoritySha256 = hash(authorityJson);
  const descriptor = {
    schema_version: 1, contract, public_contract_sha256: hash(CONTRACT_BYTES),
    private_authority: { required: true, schema_version: 1,
      authority_id: authority.authorityId, sha256: expectedPrivateAuthoritySha256 },
  };
  const descriptorBytes = JSON.stringify(descriptor);
  return { descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes),
    publicPolicySha256: '9'.repeat(64), phase: 'web-control-centers-b2',
    transitionId: contract.id, baselineSha: '2'.repeat(40), reviewedSourceSha: '3'.repeat(40),
    integrationBaseSha: '4'.repeat(40), requestedAt: AT, authorityJson, expectedPrivateAuthoritySha256 };
}

function rewriteAuthority(input, mutate) {
  const authority = JSON.parse(input.authorityJson);
  mutate(authority);
  input.authorityJson = JSON.stringify(authority);
  input.expectedPrivateAuthoritySha256 = hash(input.authorityJson);
  rewriteDescriptor(input, d => { d.private_authority.sha256 = input.expectedPrivateAuthoritySha256; });
}

function rewriteDescriptor(input, mutate) {
  const descriptor = JSON.parse(input.descriptorBytes);
  mutate(descriptor);
  input.descriptorBytes = JSON.stringify(descriptor);
  input.expectedDescriptorSha256 = hash(input.descriptorBytes);
}

function rejected(operation, code = 'RELEASE_AUTHORITY_CONTEXT_INVALID') {
  assert.throws(operation, error => {
    assert.equal(error.code, code);
    const message = code === 'AUTHORITY_RECEIPT_MISMATCH'
      ? 'Authority receipt mismatch' : 'Release authority context rejected';
    assert.equal(error.message, message);
    assert.equal(error.stack, `Error: ${message}`);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    for (const surface of [String(error), JSON.stringify(error), inspect(error), error.stack]) {
      assert.equal(surface.includes(MARKER), false);
    }
    return true;
  });
}

test('hashes contract only with recursive key order and exactly one final newline', () => {
  const input = fixture();
  const context = create(input);
  assert.equal(context.publicContractSha256, hash(CONTRACT_BYTES));
  assert.notEqual(context.publicContractSha256, hash(CONTRACT_BYTES.trimEnd()));
  assert.notEqual(context.publicContractSha256, hash(CONTRACT_BYTES + '\n'));
  assert.notEqual(context.publicContractSha256, hash(input.descriptorBytes + '\n'));
  for (const bytes of [CONTRACT_BYTES.trimEnd(), CONTRACT_BYTES + '\n', input.descriptorBytes + '\n']) {
    const changed = fixture();
    rewriteDescriptor(changed, d => { d.public_contract_sha256 = hash(bytes); });
    rejected(() => create(changed));
  }
});

test('returns exactly the sanitized binding and four section digests', () => {
  const input = fixture();
  const context = create(input);
  const receipt = publicAuthorityReceipt(context);
  assert.deepEqual(Object.keys(receipt), RECEIPT_KEYS);
  assert.deepEqual(Reflect.ownKeys(receipt), RECEIPT_KEYS);
  assert.equal(Object.getPrototypeOf(receipt), Object.prototype);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.authorityId, 'synthetic-b2-authority');
  assert.equal(receipt.descriptorSha256, hash(input.descriptorBytes));
  assert.equal(receipt.publicContractSha256, hash(CONTRACT_BYTES));
  assert.equal(receipt.privateAuthoritySha256, hash(input.authorityJson));
  assert.equal(receipt.verified, true);
  const bindingBytes = '{"authorityId":"synthetic-b2-authority","baselineSha":"' + '2'.repeat(40)
    + '","descriptorSha256":"' + hash(input.descriptorBytes)
    + '","privateAuthoritySha256":"' + hash(input.authorityJson) + '","publicContractSha256":"'
    + hash(CONTRACT_BYTES) + '","reviewedSourceSha":"' + '3'.repeat(40)
    + '","schemaVersion":1,"transitionId":"synthetic-b2-v1"}\n';
  assert.equal(receipt.bindingSha256, hash(bindingBytes));
  const a = JSON.parse(input.authorityJson);
  const sectionBytes = {
    successorCatalog: '{"records":[{"expectedCanonicalJson":' + JSON.stringify(a.successorCatalog.records[0].expectedCanonicalJson)
      + ',"expectedSha256":"' + a.successorCatalog.records[0].expectedSha256
      + '","identity":"private.synthetic","kind":"relation"}],"schemaVersion":1}\n',
    securityAdvisor: '{"baselineItems":[],"baselineSha256":"' + hash('[]\n') + '","records":[],"schemaVersion":2}\n',
    backup: '{"completedObservedAt":"2026-11-08T10:30:00.000Z","evidenceSha256":"' + '7'.repeat(64)
      + '","expiresAt":"2026-11-09T10:00:00.000Z","insertedAt":"2026-11-08T10:00:00.000Z","kind":"physical","projectRefSha256":"'
      + '6'.repeat(64) + '","provider":"supabase","schemaVersion":2,"status":"COMPLETED"}\n',
    approval: '{"approvedAt":"2026-11-08T11:00:00.000Z","authorizationSha256":"' + '8'.repeat(64)
      + '","decision":"APPROVED","expiresAt":"2026-11-09T11:00:00.000Z",'
      + '"schemaVersion":1,"scope":["web-control-centers-b2"]}\n',
  };
  for (const [section, bytes] of Object.entries(sectionBytes)) assert.equal(receipt[`${section}Sha256`], hash(bytes));
  assert.equal(Object.values(receipt).some(value => typeof value === 'object' || typeof value === 'function'), false);
  for (const surface of [JSON.stringify(receipt), inspect(receipt, { showHidden: true, depth: null })]) {
    assert.equal(surface.includes(MARKER), false);
    assert.equal(surface.includes('private.synthetic'), false);
    assert.equal(surface.includes('2026-11-08'), false);
  }
});

test('retains a deeply frozen descriptor and private plane without retaining any policy object', () => {
  const input = fixture();
  const original = input.descriptorBytes;
  const context = create(input);
  assert.equal(input.descriptorBytes, original);
  assert.equal(context.descriptorSha256, hash(original));
  assert.equal(Object.hasOwn(context, 'publicPolicy'), false);
  assert.deepEqual(context.descriptor, JSON.parse(original));
  const visit = value => {
    if (value === null || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const key of Reflect.ownKeys(value)) visit(Object.getOwnPropertyDescriptor(value, key).value);
  };
  visit(context);
  assert.equal(context.privateAuthority.authorityId, 'synthetic-b2-authority');
  assert.throws(() => { context.privateAuthority.successorCatalog.records[0].identity = 'mutated'; }, TypeError);
  assert.throws(() => { context.descriptor.contract.id = 'mutated'; }, TypeError);
  assert.equal(context.descriptor.contract.nested.a[0].a, true);
  assert.equal(Object.keys(context).includes('privateAuthority'), false);
  assert.equal(JSON.stringify(context).includes(MARKER), false);
});

for (const field of ['authorityJson', 'expectedPrivateAuthoritySha256', 'descriptorBytes', 'expectedDescriptorSha256', 'requestedAt']) {
  test(`rejects missing ${field}`, () => {
    const input = fixture(); delete input[field]; rejected(() => create(input));
  });
}

test('independently checks exact private bytes and the descriptor digest', () => {
  const changedBytes = fixture(); changedBytes.authorityJson = changedBytes.authorityJson.replace(MARKER, `${MARKER}_ALTERED`);
  rejected(() => create(changedBytes));
  const changedExpected = fixture(); changedExpected.expectedPrivateAuthoritySha256 = 'a'.repeat(64);
  rejected(() => create(changedExpected));
  const changedDescriptor = fixture(); rewriteDescriptor(changedDescriptor, d => { d.private_authority.sha256 = 'a'.repeat(64); });
  rejected(() => create(changedDescriptor));
});

for (const field of ['authorityId', 'publicContractSha256', 'phase', 'baselineSha', 'reviewedSourceSha', 'integrationBaseSha']) {
  test(`rejects authority bound to another ${field}`, () => {
    const input = fixture();
    rewriteAuthority(input, a => {
      if (field.endsWith('Sha') && field !== 'publicContractSha256') a.issuedFor[field] = 'f'.repeat(40);
      else a[field] = field === 'publicContractSha256' ? 'f'.repeat(64) : `${MARKER}_WRONG`;
    });
    rejected(() => create(input));
  });
}

for (const field of ['phase', 'transitionId', 'baselineSha', 'reviewedSourceSha', 'integrationBaseSha']) {
  test(`rejects request with a mismatched ${field}`, () => {
    const input = fixture(); input[field] = field.endsWith('Sha') ? 'f'.repeat(40) : 'wrong-stage';
    rejected(() => create(input));
  });
}

test('rejects stale approval and backup at requested release time', () => {
  const input = fixture(); input.requestedAt = '2026-11-09T12:00:00.000Z'; rejected(() => create(input));
});

for (const key of ['candidate', 'candidateAuthority', 'privateAuthority', 'expectedSha256', 'loader', 'receipt', 'providerLocator', 'publicPolicy', 'descriptor']) {
  test(`rejects candidate override ${key} rather than silently ignoring it`, () => {
    const input = fixture(); input[key] = MARKER; rejected(() => create(input));
  });
}

test('rejects proxies and getters before executing caller behavior', () => {
  let called = 0;
  const getter = () => { called++; throw new Error(MARKER); };
  const proxy = value => new Proxy(value, { get: getter, ownKeys: getter, getPrototypeOf: getter, getOwnPropertyDescriptor: getter });
  rejected(() => create(proxy(fixture())));
  for (const key of ['descriptorBytes', 'expectedDescriptorSha256', 'authorityJson', 'publicPolicySha256']) {
    const input = fixture();
    Object.defineProperty(input, key, { get: getter, enumerable: true });
    rejected(() => create(input));
  }
  const input = fixture(); input.descriptorBytes = proxy(new Uint8Array());
  rejected(() => create(input));
  const coercion = fixture(); coercion.expectedPrivateAuthoritySha256 = { toString: getter };
  rejected(() => create(coercion));
  assert.equal(called, 0);
});

test('rejects objects, executable and coercible values in place of exact descriptor bytes', () => {
  for (const value of [JSON.parse(fixture().descriptorBytes), new Date(), new Map(), () => MARKER,
    NaN, undefined, 1n, Symbol(MARKER), {}, []]) {
    const input = fixture(); input.descriptorBytes = value; rejected(() => create(input));
  }
  const symbol = fixture(); symbol[Symbol(MARKER)] = true; rejected(() => create(symbol));
  const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: MARKER }); rejected(() => create(hidden));
});

test('authenticates descriptor exact bytes including pretty formatting and terminal LF', () => {
  const input = fixture();
  const compact = publicAuthorityReceipt(create(input));
  const bytes = JSON.stringify(JSON.parse(input.descriptorBytes), null, 2) + '\n';
  input.descriptorBytes = bytes;
  rejected(() => create(input));
  input.expectedDescriptorSha256 = hash(bytes);
  const pretty = publicAuthorityReceipt(create(input));
  assert.equal(pretty.descriptorSha256, hash(bytes));
  assert.equal(pretty.publicContractSha256, compact.publicContractSha256);
  assert.notEqual(pretty.bindingSha256, compact.bindingSha256);
  rejected(() => assertAuthorityReceiptMatch(compact, pretty), 'AUTHORITY_RECEIPT_MISMATCH');
  input.descriptorBytes = bytes.slice(0, -1);
  rejected(() => create(input));
  input.descriptorBytes = bytes.replace('"schema_version": 1', '"schema_version": 2');
  rejected(() => create(input));
});

test('accepts exact Uint8Array descriptor bytes and does not retain caller buffers', () => {
  const input = fixture();
  const bytes = new TextEncoder().encode(input.descriptorBytes);
  input.descriptorBytes = bytes;
  const context = create(input);
  bytes.fill(0);
  assert.equal(context.descriptor.contract.id, 'synthetic-b2-v1');
  assert.equal(context.descriptorSha256, input.expectedDescriptorSha256);
});

test('optional policy provenance is scalar only and never reaches receipt', () => {
  const input = fixture();
  delete input.publicPolicySha256;
  const context = create(input);
  assert.equal(Object.hasOwn(context, 'publicPolicy'), false);
  assert.equal(Object.hasOwn(publicAuthorityReceipt(context), 'publicPolicySha256'), false);
  assert.equal(Object.values(publicAuthorityReceipt(context)).every(value => value === null || typeof value !== 'object'), true);
});

for (const bytes of ['', '{', 'null', '[]', '{}', '{"schema_version":1,"contract":null}',
  '{"schema_version":1,"__proto__":{}}']) {
  test(`rejects authenticated malformed descriptor ${JSON.stringify(bytes)}`, () => {
    const input = fixture(); input.descriptorBytes = bytes; input.expectedDescriptorSha256 = hash(bytes);
    rejected(() => create(input));
  });
}

test('rejects malformed descriptor shapes even with the correct exact-byte digest', () => {
  for (const mutate of [d => { d.extra = MARKER; }, d => { delete d.contract; },
    d => { d.contract = []; }, d => { d.schema_version = 2; },
    d => { d.private_authority.required = false; }, d => { d.private_authority.extra = MARKER; },
    d => { d.contract.extra = JSON.parse('{"__proto__":{}}'); }]) {
    const input = fixture(); rewriteDescriptor(input, mutate); rejected(() => create(input));
  }
});

test('rejects duplicate descriptor identities even when exact bytes are authenticated', () => {
  const original = fixture().descriptorBytes;
  for (const bytes of [original.replace('"schema_version":1,', '"schema_version":1,"schema_version":1,'),
    original.replace('"id":"synthetic-b2-v1"', '"id":"synthetic-b2-v1","i\\u0064":"synthetic-b2-v1"')]) {
    const input = fixture(); input.descriptorBytes = bytes; input.expectedDescriptorSha256 = hash(bytes);
    rejected(() => create(input));
  }
});

test('rejects descriptor digest and provenance coercion without invoking user code', () => {
  let called = 0;
  const coercion = { toString() { called++; throw new Error(MARKER); } };
  for (const key of ['descriptorBytes', 'expectedDescriptorSha256', 'publicPolicySha256']) {
    for (const value of [coercion, ['a'.repeat(64)], null, 123]) {
      const input = fixture(); input[key] = value; rejected(() => create(input));
    }
  }
  assert.equal(called, 0);
});

test('receipt matching is exact across all protected stages and rejects extra private fields', () => {
  const context = create(fixture());
  const receipt = publicAuthorityReceipt(context);
  for (const stage of ['plan', 'gate', 'pre', 'post', 'postcheck', 'recovery']) {
    assert.equal(assertAuthorityReceiptMatch(receipt, JSON.parse(JSON.stringify(receipt))), true, stage);
  }
  const reordered = Object.fromEntries(Object.entries(receipt).reverse());
  assert.equal(assertAuthorityReceiptMatch(receipt, reordered), true);
  for (const key of RECEIPT_KEYS) {
    const missing = { ...receipt }; delete missing[key];
    rejected(() => assertAuthorityReceiptMatch(receipt, missing), 'AUTHORITY_RECEIPT_MISMATCH');
    const changed = { ...receipt, [key]: key === 'verified' ? false : key === 'schemaVersion' ? 2 : MARKER };
    rejected(() => assertAuthorityReceiptMatch(receipt, changed), 'AUTHORITY_RECEIPT_MISMATCH');
  }
  rejected(() => assertAuthorityReceiptMatch(receipt, { ...receipt, privateAuthority: context.privateAuthority }), 'AUTHORITY_RECEIPT_MISMATCH');
  const forged = { ...receipt, privateAuthoritySha256: 'a'.repeat(64) };
  rejected(() => assertAuthorityReceiptMatch(receipt, forged), 'AUTHORITY_RECEIPT_MISMATCH');
});

test('receipt matching rejects proxy/getter/coercion and unknown contexts without leakage', () => {
  const receipt = publicAuthorityReceipt(create(fixture()));
  let called = 0;
  const getter = () => { called++; throw new Error(MARKER); };
  for (const bad of [undefined, null, [], new Proxy(receipt, { ownKeys: getter }),
    Object.defineProperty({ ...receipt }, 'authorityId', { get: getter }),
    { ...receipt, bindingSha256: { toString: getter } }]) {
    rejected(() => assertAuthorityReceiptMatch(receipt, bad), 'AUTHORITY_RECEIPT_MISMATCH');
  }
  rejected(() => publicAuthorityReceipt({ ...create(fixture()) }));
  assert.equal(called, 0);
});

test('a different valid authority version cannot replace historical stage receipts', () => {
  const input = fixture(); const original = publicAuthorityReceipt(create(input));
  rewriteAuthority(input, a => { a.backup.evidenceSha256 = 'e'.repeat(64); });
  const next = publicAuthorityReceipt(create(input));
  rejected(() => assertAuthorityReceiptMatch(original, next), 'AUTHORITY_RECEIPT_MISMATCH');
});

test('B2-only constructor rejects non-B2 callers even without private inputs', () => {
  const input = fixture(); input.phase = 'web-control-centers-b1'; input.transitionId = 'synthetic-b1';
  delete input.authorityJson; delete input.expectedPrivateAuthoritySha256;
  rejected(() => create(input));
  input.authorityJson = fixture().authorityJson;
  rejected(() => create(input));
});
