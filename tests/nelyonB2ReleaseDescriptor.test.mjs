import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import * as gate from '../scripts/nelyon-production-release.mjs';

const descriptorPath = new URL('../.github/nelyon-web-control-centers-b2-release-descriptor.json', import.meta.url);
const paths = [
  'supabase/config.toml',
  'supabase/functions/_shared/r2.ts',
  'supabase/functions/process-scheduled-publications/index.ts',
  'supabase/functions/process-scheduled-publications/worker.ts',
  'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql',
];
const names = ['ai-handoff', 'cleanup-stale-media-uploads', 'content-safety-scan',
  'create-media-upload', 'finalize-media-upload', 'get-media-url',
  'process-scheduled-publications', 'video-semantic-index'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Frozen historical public candidate from 15197130.
// Parser compatibility tests must not silently change with the live R2 candidate.
const candidateFixture = new URL('./fixtures/nelyonB2CandidateDescriptor.json', import.meta.url);
const bytes = () => readFileSync(candidateFixture);
const currentBytes = () => readFileSync(descriptorPath);
function parse(value = bytes(), digest = hash(value)) {
  assert.equal(typeof gate.parseB2ReleaseDescriptor, 'function', 'strict B2 descriptor parser is implemented');
  return gate.parseB2ReleaseDescriptor(value, digest);
}
function rewritten(mutate) {
  const value = JSON.parse(bytes());
  mutate(value);
  value.public_contract_sha256 = hash(gate.canonicalJson(value.contract));
  return Buffer.from(JSON.stringify(value));
}
function sourceInput() {
  const descriptorBytes = currentBytes();
  return { descriptorBytes, expectedDescriptorSha256: hash(descriptorBytes), affectedFunctions: names,
    productiveFiles: paths.map(path => ({ path, type: 'file', status: path === paths[0] || path === paths[1] ? 'M' : 'A',
      bytes: Buffer.from(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')) })) };
}
const denied = operation => assert.throws(operation, { code: 'B2_DESCRIPTOR_INVALID' });

test('closed B2 candidate binds public contract and defers protected facts', () => {
  // Missing parser is the first RED failure, before the dedicated file exists.
  assert.equal(typeof gate.parseB2ReleaseDescriptor, 'function', 'strict B2 descriptor parser is implemented');
  const value = parse();
  assert.equal(value.contract.state, 'candidate');
  assert.equal(value.contract.release_ready, false);
  assert.deepEqual(value.contract.productive_changes.map(item => item.path), paths);
  assert.deepEqual(value.contract.functions.map(item => item.name), names);
  assert.equal(value.contract.functions.find(item => item.name === names[6]).verify_jwt, false);
  assert.equal(value.contract.cron_activation, false);
  assert.deepEqual(value.contract.function_inventory, { before: null, after: null });
  assert.ok(value.contract.functions.every(item => item.source_sha256 === null && item.config_sha256 === null));
  assert.equal(value.private_authority.required, true);
  assert.equal(value.private_authority.sha256, null);
  assert.equal(value.public_contract_sha256, hash(gate.canonicalJson(value.contract)));
  assert.notEqual(value.public_contract_sha256, hash(gate.canonicalJson(value.contract).trimEnd()));
  assert.ok(Object.isFrozen(value.contract.functions[0]));
  assert.doesNotMatch(JSON.stringify(value), /successorCatalog|expectedCanonicalJson|advisor_fingerprint|backup|provider|locator|"acl"|actor/);
});

test('exact descriptor digest and strict bytes reject substitutions and ambiguous JSON', () => {
  const original = bytes();
  denied(() => parse(Buffer.concat([original, Buffer.from(' ')]), hash(original)));
  denied(() => parse(original, 'a'.repeat(64)));
  denied(() => parse(Buffer.from([0xff])));
  denied(() => parse(Buffer.from('{"schema_version":1,"schema_version":1}')));
  denied(() => parse(Buffer.from('{"schema_version":1,"schema_\\u0076ersion":1}')));
  denied(() => parse(Buffer.from('{"__proto__":{}}')));
  denied(() => parse(Buffer.from(' '.repeat(128 * 1024 + 1))));
  denied(() => parse(original, null));
});

test('unknown and altered public semantics fail even with recomputed digests', () => {
  for (const mutate of [
    value => { value.provider = 'SYNTHETIC_PRIVATE_MARKER'; },
    value => { value.contract.catalog = []; },
    value => { value.contract.productive_changes[0].extra = true; },
    value => { value.private_authority.locator = 'SYNTHETIC_PRIVATE_MARKER'; },
    value => { value.contract.functions.pop(); },
    value => { value.contract.functions[6].verify_jwt = true; },
    value => { value.contract.finance_invariants.require_no_movement = false; },
    value => { value.contract.productive_changes[0].path = '../supabase/config.toml'; },
    value => { value.contract.functions[0].name = 'bdag-ledger'; },
    value => { value.contract.state = 'approved'; },
    value => { value.contract.release_ready = true; },
    value => { value.private_authority.sha256 = 'a'.repeat(64); },
  ]) {
    denied(() => parse(rewritten(mutate)));
  }
  const invalidDigest = JSON.parse(bytes());
  invalidDigest.public_contract_sha256 = 'a'.repeat(64);
  denied(() => parse(Buffer.from(JSON.stringify(invalidDigest))));
});

test('source validation binds migration, config, shared bytes, exact closure and ordinary file paths', () => {
  const input = sourceInput();
  assert.equal(typeof gate.validateB2ReleaseDescriptorSources, 'function');
  assert.equal(gate.validateB2ReleaseDescriptorSources(input).contract.release_ready, false);
  for (const index of [0, 1, 2, 3, 4]) {
    const altered = sourceInput();
    altered.productiveFiles[index].bytes = Buffer.concat([altered.productiveFiles[index].bytes, Buffer.from('\n')]);
    denied(() => gate.validateB2ReleaseDescriptorSources(altered));
  }
  for (const mutate of [
    value => { value.affectedFunctions = names.slice(1); },
    value => { value.affectedFunctions = [...names, 'bdag-ledger']; },
    value => { value.productiveFiles[0].type = 'symlink'; },
    value => { value.productiveFiles[0].path = '../supabase/config.toml'; },
    value => { value.productiveFiles[0].path = 'supabase\\config.toml'; },
    value => { value.productiveFiles[0].status = 'A'; },
    value => { value.productiveFiles.push({ ...value.productiveFiles[0], path: 'extra.ts' }); },
    value => { value.productiveFiles[0].extra = true; },
  ]) {
    const altered = sourceInput(); mutate(altered);
    denied(() => gate.validateB2ReleaseDescriptorSources(altered));
  }
});

test('approved state requires all final bindings and protected inventory counts', () => {
  const approved = rewritten(value => {
    value.contract.state = 'approved'; value.contract.release_ready = true;
    value.contract.cron_activation = true;
    value.contract.reviewed_source_sha = 'a'.repeat(40);
    value.contract.integration_base_sha = 'b'.repeat(40);
    value.contract.function_inventory = { before: 40, after: 41 };
    value.contract.functions.forEach(item => { item.source_sha256 = 'c'.repeat(64); item.config_sha256 = 'd'.repeat(64); });
    value.private_authority.sha256 = 'e'.repeat(64);
  });
  const value = parse(approved);
  assert.equal(value.contract.state, 'approved');
  assert.equal(value.contract.cron_activation, true);
  for (const mutate of [
    d => { d.private_authority.sha256 = null; },
    d => { d.contract.function_inventory.before = null; },
    d => { d.contract.function_inventory.after = null; },
    d => { d.contract.functions[0].source_sha256 = null; },
    d => { d.contract.functions[0].config_sha256 = null; },
    d => { d.contract.reviewed_source_sha = null; },
    d => { d.contract.integration_base_sha = null; },
    d => { d.contract.cron_activation = false; },
  ]) {
    const changed = JSON.parse(approved); mutate(changed);
    changed.public_contract_sha256 = hash(gate.canonicalJson(changed.contract));
    denied(() => parse(Buffer.from(JSON.stringify(changed))));
  }
});

test('strict inputs never invoke caller getters proxies coercion or serialization hooks', () => {
  let calls = 0;
  const invoked = () => { calls++; throw new Error('SYNTHETIC_PRIVATE_MARKER'); };
  const proxy = new Proxy({}, { get: invoked, getPrototypeOf: invoked, ownKeys: invoked });
  for (const input of [proxy, { toString: invoked }, { toJSON: invoked }, null, 42, [], new DataView(new ArrayBuffer(1))]) {
    denied(() => gate.parseB2ReleaseDescriptor(input, hash(bytes())));
  }
  const accessor = sourceInput();
  Object.defineProperty(accessor, 'descriptorBytes', { get: invoked });
  denied(() => gate.validateB2ReleaseDescriptorSources(accessor));
  const indexed = sourceInput();
  Object.defineProperty(indexed.productiveFiles, 0, { get: invoked });
  denied(() => gate.validateB2ReleaseDescriptorSources(indexed));
  const entry = sourceInput();
  Object.defineProperty(entry.productiveFiles[0], 'bytes', { get: invoked });
  denied(() => gate.validateB2ReleaseDescriptorSources(entry));
  const proxied = sourceInput(); proxied.productiveFiles = new Proxy([], { get: invoked });
  denied(() => gate.validateB2ReleaseDescriptorSources(proxied));
  const nativeBytes = bytes();
  Object.defineProperty(nativeBytes, 'buffer', { get: invoked });
  assert.equal(parse(nativeBytes).contract.state, 'candidate');
  assert.equal(calls, 0);
});

test('descriptor digests and source bindings reject arrays instead of coercing them', () => {
  for (const mutate of [
    value => { value.contract.baseline_sha = [value.contract.baseline_sha]; },
    value => { value.contract.productive_changes[0].blob = [value.contract.productive_changes[0].blob]; },
    value => { value.contract.productive_changes[0].sha256 = [value.contract.productive_changes[0].sha256]; },
  ]) denied(() => parse(rewritten(mutate)));
  for (const mutate of [
    value => { value.contract.reviewed_source_sha = ['a'.repeat(40)]; },
    value => { value.contract.integration_base_sha = ['b'.repeat(40)]; },
    value => { value.contract.functions[0].source_sha256 = ['c'.repeat(64)]; },
    value => { value.contract.functions[0].config_sha256 = ['d'.repeat(64)]; },
    value => { value.private_authority.sha256 = ['e'.repeat(64)]; },
  ]) {
    denied(() => parse(rewritten(value => {
      value.contract.state = 'approved'; value.contract.release_ready = true;
      value.contract.cron_activation = true;
      value.contract.reviewed_source_sha = 'a'.repeat(40); value.contract.integration_base_sha = 'b'.repeat(40);
      value.contract.function_inventory = { before: 40, after: 41 };
      value.contract.functions.forEach(item => { item.source_sha256 = 'c'.repeat(64); item.config_sha256 = 'd'.repeat(64); });
      value.private_authority.sha256 = 'e'.repeat(64);
      mutate(value);
    })));
  }
});

test('rejections keep supplied private markers out of messages stacks and serialization', () => {
  const hostile = rewritten(value => { value.contract.provider = 'SYNTHETIC_PRIVATE_MARKER'; });
  assert.throws(() => parse(hostile), error => {
    assert.equal(error.code, 'B2_DESCRIPTOR_INVALID');
    assert.equal(error.message, 'B2 descriptor rejected');
    assert.equal(error.stack, 'Error: B2 descriptor rejected');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.doesNotMatch(`${error}${error.stack}${JSON.stringify(error)}`, /SYNTHETIC_PRIVATE_MARKER/);
    return true;
  });
});

test('actual repository import graph yields the exact public eight-function closure', () => {
  const sources = {};
  function readModules(path) {
    for (const entry of readdirSync(new URL(`../${path}`, import.meta.url), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) readModules(child);
      else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/.test(entry.name)) {
        sources[child] = readFileSync(new URL(`../${child}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
      }
    }
  }
  readModules('supabase/functions');
  const graph = gate.buildFunctionGraph(sources);
  const config = gate.parseFunctionConfig(readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'));
  // This public graph proof supplies the config scope only to calculate closure.
  // Production authorization continues to use the unchanged protected policy.
  const actual = gate.resolveAffectedFunctions({
    changes: paths.slice(1, 4).map(path => ({ status: 'M', path })), graph,
    managedFunctions: Object.keys(config), forbiddenFunctions: ['bdag-economy'],
  });
  assert.deepEqual(actual, names);
  const input = sourceInput(); input.affectedFunctions = actual;
  assert.equal(gate.validateB2ReleaseDescriptorSources(input).contract.state, 'candidate');
});

 test('current repository descriptor remains a fail-closed cron-enabled candidate',()=>{
  const current=readFileSync(descriptorPath);const value=parse(current,hash(current));
  assert.equal(value.contract.state,'candidate');assert.equal(value.contract.release_ready,false);
  assert.equal(value.contract.cron_activation,true);
  assert.equal(value.private_authority.sha256,null);
  assert.throws(()=>gate.compileB2PublicEvidence({descriptorBytes:current,expectedDescriptorSha256:hash(current)}),{code:'B2_DESCRIPTOR_INVALID'});
 });
