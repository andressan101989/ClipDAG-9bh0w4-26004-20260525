import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const closureModule = await import('../scripts/nelyon-private-runtime-closure.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

const buildClosure = options => {
  assert.equal(typeof closureModule.buildPrivateRuntimeClosure, 'function', 'closure builder exists');
  return closureModule.buildPrivateRuntimeClosure(options);
};
const verifyClosure = options => {
  assert.equal(typeof closureModule.verifyPrivateRuntimeClosure, 'function', 'closure verifier exists');
  return closureModule.verifyPrivateRuntimeClosure(options);
};

const ROOT = path.resolve('D:\\synthetic-private-runtime');
const NODE_VERSION = '24.21.0';
const SETUP_NODE_ACTION = '949feb2413d6458794dcd2491c4babbbce0c15c1';
const SUPABASE_SETUP_ACTION = '45a513f8c64c0bc8e0e3dfe572b5c95be85f6359';
const WRANGLER_VERSION = '4.135.0';
const AWS_VERSION = '1.0.20';
const AWS_INTEGRITY = 'sha512-/djoAN709iY65ETD6LKCtyyEI04XIBP5xVvfmNxsEP0uJB5tyaGBztSryRr4HqMStr9R06PisQE7m9zDTXKu6g==';
const AWS_RESOLVED = 'https://registry.npmjs.org/aws4fetch/-/aws4fetch-1.0.20.tgz';
const EXPECTED_CLOSURE_SHA256 = 'af1729530c2b2ab158507927cf9d0650aa5052da5b78d44a4627038d0cbf1fa8';
const MARKER = 'SYNTHETIC_RUNTIME_CLOSURE_PRIVATE_MARKER';

const MEMBERS = Object.freeze([
  '.github/workflows/nelyon-production-release.yml',
  'package-lock.json',
  'package.json',
  'scripts/nelyon-admin-production-release.mjs',
  'scripts/nelyon-b2-authority-preparation.mjs',
  'scripts/nelyon-b2-explicit-connection.mjs',
  'scripts/nelyon-b2-function-deployment-proof.mjs',
  'scripts/nelyon-b2-hermetic-workspace.mjs',
  'scripts/nelyon-b2-recovery-provenance.mjs',
  'scripts/nelyon-b2-source-parity.mjs',
  'scripts/nelyon-private-authority-cli.mjs',
  'scripts/nelyon-private-authority-issuer.mjs',
  'scripts/nelyon-private-authority-provider.mjs',
  'scripts/nelyon-private-authority-runtime.mjs',
  'scripts/nelyon-private-authority.mjs',
  'scripts/nelyon-private-runtime-closure.mjs',
  'scripts/nelyon-production-release.mjs',
  'scripts/nelyon-production-snapshot-adapter.mjs',
  'scripts/nelyon-release-authority-context.mjs',
  'scripts/prove-web-control-centers-b2-disposable.mjs',
  'scripts/prove-web-control-centers-b2-pg-cron-disposable.mjs',
  'shared/web-deployment/publicSupabaseBuildEnv.mjs',
]);

const WORKFLOW = `name: fixture
steps:
  - uses: actions/setup-node@${SETUP_NODE_ACTION}
    with:
      node-version: '${NODE_VERSION}'
  - uses: supabase/setup-cli@${SUPABASE_SETUP_ACTION}
  - run: test "$("$NELYON_WRANGLER" --version)" = '${WRANGLER_VERSION}'
`;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function fixtureFiles() {
  const files = new Map(MEMBERS.map(member => [member, Buffer.from(`fixture:${member}\r\n`)]));
  files.set('.github/workflows/nelyon-production-release.yml', Buffer.from(WORKFLOW));
  files.set('scripts/nelyon-admin-production-release.mjs', Buffer.from(`const WRANGLER_VERSION = '${WRANGLER_VERSION}';\n`));
  files.set('package.json', Buffer.from(`${JSON.stringify({
    name: 'closure-fixture',
    dependencies: { aws4fetch: AWS_VERSION },
  }, null, 2)}\n`));
  files.set('package-lock.json', Buffer.from(`${JSON.stringify({
    name: 'closure-fixture',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { aws4fetch: AWS_VERSION } },
      'node_modules/aws4fetch': {
        version: AWS_VERSION,
        resolved: AWS_RESOLVED,
        integrity: AWS_INTEGRITY,
        license: 'MIT',
      },
    },
  }, null, 2)}\n`));
  return files;
}

function relativeMember(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function fixtureReader(files, calls = []) {
  return absolutePath => {
    const member = relativeMember(absolutePath);
    calls.push(member);
    if (!files.has(member)) throw new Error(`${MARKER}: missing fixture`);
    return Buffer.from(files.get(member));
  };
}

function independentBootstrap(files) {
  const withoutDigest = {
    schema_version: 1,
    identity: 'nelyon-b2-private-release-runtime-v1',
    algorithm: 'sha256',
    files: MEMBERS.map(member => ({ path: member, sha256: sha256(files.get(member)) })),
    runtime: { node: NODE_VERSION, setup_node_action: SETUP_NODE_ACTION },
    dependencies: [{
      name: 'aws4fetch',
      version: AWS_VERSION,
      integrity: AWS_INTEGRITY,
      lock_path: 'node_modules/aws4fetch',
    }],
    operation_tools: {
      wrangler: WRANGLER_VERSION,
      supabase_setup_action: SUPABASE_SETUP_ACTION,
    },
  };
  const closure_sha256 = sha256(Buffer.from(canonicalJson(withoutDigest)));
  return { ...withoutDigest, closure_sha256 };
}

function cleanFailure(error) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, 'PRIVATE_RUNTIME_CLOSURE_INVALID');
  assert.equal(error.message, 'private runtime closure rejected');
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(String(error).includes(MARKER), false);
  assert.equal(String(error).includes(ROOT), false);
  return true;
}

function verifiedOptions(files, manifestClosure = buildClosure({
  repositoryRoot: ROOT,
  readFile: fixtureReader(files),
})) {
  return {
    manifestClosure,
    protectedClosureSha256: manifestClosure.closure_sha256,
    repositoryRoot: ROOT,
    readFile: fixtureReader(files),
    nodeVersion: NODE_VERSION,
  };
}

test('builds the exact sorted 22-member canonical closure from exact bytes', () => {
  const files = fixtureFiles();
  const calls = [];
  const actual = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files, calls) });
  const expected = independentBootstrap(files);
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.files.map(entry => entry.path), MEMBERS);
  assert.deepEqual(calls, MEMBERS);
  assert.equal(actual.closure_sha256, EXPECTED_CLOSURE_SHA256);
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(Object.isFrozen(actual.files), true);
  assert.equal(Object.isFrozen(actual.files[0]), true);
  assert.equal(Object.isFrozen(actual.dependencies), true);
  assert.equal(Object.isFrozen(actual.runtime), true);
  assert.equal(Object.isFrozen(actual.operation_tools), true);
});

test('verifies manifest, local exact bytes, protected digest and Node runtime together', () => {
  const files = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  const actual = verifyClosure(verifiedOptions(files, manifestClosure));
  assert.deepEqual(actual, manifestClosure);
  assert.equal(Object.isFrozen(actual), true);
});

test('closure helper is byte-for-byte equivalent to the independent no-import bootstrap contract', () => {
  const files = fixtureFiles();
  const helper = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  const bootstrap = independentBootstrap(files);
  assert.equal(canonicalJson(helper), canonicalJson(bootstrap));
  assert.equal(helper.closure_sha256, EXPECTED_CLOSURE_SHA256);
});

test('reviewed workflow inline bootstrap executes independently against the canonical closure', () => {
  const workflowBytes = readFileSync(new URL('../.github/workflows/nelyon-production-release.yml', import.meta.url));
  const workflow = workflowBytes.toString('utf8').replace(/\r\n?/g, '\n');
  const lines = workflow.split('\n');
  const begin = lines.findIndex(line => line.trim() === '// NELYON_PRIVATE_RUNTIME_BOOTSTRAP_BEGIN');
  const end = lines.findIndex((line, index) => index > begin
    && line.trim() === '// NELYON_PRIVATE_RUNTIME_BOOTSTRAP_END');
  assert.ok(begin >= 0 && end > begin);
  assert.equal(lines.filter(line => line.trim() === '// NELYON_PRIVATE_RUNTIME_BOOTSTRAP_BEGIN').length, 1);
  assert.equal(lines.filter(line => line.trim() === '// NELYON_PRIVATE_RUNTIME_BOOTSTRAP_END').length, 1);
  const source = `${lines.slice(begin + 1, end).map(line => {
    if (line.length === 0) return '';
    assert.match(line, /^ {10}/);
    return line.slice(10);
  }).join('\n')}\n`;
  assert.doesNotMatch(source, /require\(['"]\.\.?\//);

  const root = mkdtempSync(path.join(tmpdir(), 'b2-workflow-bootstrap-'));
  const files = fixtureFiles();
  files.set('.github/workflows/nelyon-production-release.yml', workflowBytes);
  for (const [member, bytes] of files) {
    const target = path.join(root, ...member.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const manifestClosure = buildClosure({ repositoryRoot: root, readFile: readFileSync });
  const manifestPath = path.join(root, 'release-artifact', 'bundle', 'manifest.json');
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({ runtime_closure: manifestClosure })}\n`);
  const execute = new Function('require', 'Buffer', 'process', source);
  const fakeProcess = Object.freeze({
    cwd: () => root,
    versions: Object.freeze({ node: NODE_VERSION }),
    env: Object.freeze({ NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: manifestClosure.closure_sha256 }),
  });
  assert.doesNotThrow(() => execute(createRequire(import.meta.url), Buffer, fakeProcess));
  assert.throws(() => execute(createRequire(import.meta.url), Buffer, {
    ...fakeProcess,
    env: { NELYON_PRIVATE_AUTHORITY_RUNTIME_CLOSURE_SHA256: '0'.repeat(64) },
  }), /private runtime closure rejected/);
});

test('hashes an empty reviewed source member as exact Git bytes rather than treating it as absent', () => {
  const files = fixtureFiles();
  files.set('scripts/nelyon-private-authority.mjs', Buffer.alloc(0));
  const actual = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  const entry = actual.files.find(candidate => candidate.path === 'scripts/nelyon-private-authority.mjs');
  assert.equal(entry.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('every member mutation fails verification', () => {
  const pristine = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(pristine) });
  for (const member of MEMBERS) {
    const mutated = fixtureFiles();
    mutated.set(member, Buffer.concat([mutated.get(member), Buffer.from(`mutated:${member}`)]));
    assert.throws(() => verifyClosure(verifiedOptions(mutated, manifestClosure)), cleanFailure, member);
  }
});

test('every missing local member fails closed without leaking reader failures', () => {
  const pristine = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(pristine) });
  for (const member of MEMBERS) {
    const missing = fixtureFiles();
    missing.delete(member);
    assert.throws(() => verifyClosure(verifiedOptions(missing, manifestClosure)), cleanFailure, member);
  }
});

test('every removed or duplicated manifest member and every unexpected addition fails', () => {
  const files = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  for (const member of MEMBERS) {
    const removed = structuredClone(manifestClosure);
    removed.files = removed.files.filter(entry => entry.path !== member);
    assert.throws(() => verifyClosure(verifiedOptions(files, removed)), cleanFailure, `removed ${member}`);

    const duplicated = structuredClone(manifestClosure);
    const entry = duplicated.files.find(candidate => candidate.path === member);
    duplicated.files.push({ ...entry });
    assert.throws(() => verifyClosure(verifiedOptions(files, duplicated)), cleanFailure, `duplicated ${member}`);
  }
  const added = structuredClone(manifestClosure);
  added.files.push({ path: 'scripts/unreviewed-runtime.mjs', sha256: 'a'.repeat(64) });
  assert.throws(() => verifyClosure(verifiedOptions(files, added)), cleanFailure);
});

test('workflow compiler fails closed for changed or ambiguous Node/action/tool pins', () => {
  const cases = [
    [SETUP_NODE_ACTION, 'a'.repeat(40)],
    [NODE_VERSION, '24.21.1'],
    [SUPABASE_SETUP_ACTION, 'b'.repeat(40)],
    [WRANGLER_VERSION, '4.136.0'],
    [`actions/setup-node@${SETUP_NODE_ACTION}`, `actions/setup-node@${SETUP_NODE_ACTION}\n  - uses: actions/setup-node@${'a'.repeat(40)}`],
    [`supabase/setup-cli@${SUPABASE_SETUP_ACTION}`, `supabase/setup-cli@${SUPABASE_SETUP_ACTION}\n  - uses: supabase/setup-cli@${'b'.repeat(40)}`],
    [`node-version: '${NODE_VERSION}'`, `node-version: '${NODE_VERSION}'\n      alternate-node-version: '22.0.0'`],
  ];
  for (const [from, to] of cases) {
    const files = fixtureFiles();
    files.set('.github/workflows/nelyon-production-release.yml', Buffer.from(WORKFLOW.replace(from, to)));
    assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) }), cleanFailure,
      `${from} -> ${to}`);
  }
  const adminFiles = fixtureFiles();
  adminFiles.set('scripts/nelyon-admin-production-release.mjs', Buffer.from("const WRANGLER_VERSION = '4.136.0';\n"));
  assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(adminFiles) }), cleanFailure);
});

test('comment decoys cannot authorize different active workflow or Admin tool pins', () => {
  const workflowFiles = fixtureFiles();
  workflowFiles.set('.github/workflows/nelyon-production-release.yml', Buffer.from(`# ${WORKFLOW.replaceAll('\n', '\n# ')}
steps:
  - uses : actions/setup-node@${'a'.repeat(40)}
    with:
      node-version : '24.21.1'
  - uses : supabase/setup-cli@${'b'.repeat(40)}
  - run: test "$("$NELYON_WRANGLER" --version --json)" = '4.136.0'
`));
  assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(workflowFiles) }), cleanFailure);

  const adminFiles = fixtureFiles();
  adminFiles.set('scripts/nelyon-admin-production-release.mjs', Buffer.from(`/* const WRANGLER_VERSION = '${WRANGLER_VERSION}'; */
let WRANGLER_VERSION = '4.136.0';
`));
  assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(adminFiles) }), cleanFailure);
});

test('block scalar and template literal decoys cannot satisfy active pin authority', () => {
  const workflowFiles = fixtureFiles();
  workflowFiles.set('.github/workflows/nelyon-production-release.yml', Buffer.from(`name: hostile
steps:
  - uses: "actions/setup-node@${'a'.repeat(40)}"
    with:
      node-version : "22.0.0"
  - uses: "supabase/setup-cli@${'b'.repeat(40)}"
  - run: |
      - uses: actions/setup-node@${SETUP_NODE_ACTION}
        node-version: '${NODE_VERSION}'
      - uses: supabase/setup-cli@${SUPABASE_SETUP_ACTION}
      test "$("$NELYON_WRANGLER" --version)" = '${WRANGLER_VERSION}'
`));
  assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(workflowFiles) }), cleanFailure);

  const adminFiles = fixtureFiles();
  adminFiles.set('scripts/nelyon-admin-production-release.mjs', Buffer.from(`const decoy = \`
const WRANGLER_VERSION = '${WRANGLER_VERSION}';
\`;
const WRANGLER_VERSION
  = '4.136.0';
`));
  assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(adminFiles) }), cleanFailure);
});

test('closed failure has an immutable constant stack and frozen stable fields', () => {
  const files = fixtureFiles();
  files.set('scripts/nelyon-admin-production-release.mjs', Buffer.from(`const ${MARKER} = true;\n`));
  let failure;
  try { buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) }); } catch (error) { failure = error; }
  assert.equal(failure?.stack, 'Error: private runtime closure rejected');
  assert.equal(Object.isFrozen(failure), true);
  assert.throws(() => { failure.stack = MARKER; }, TypeError);
  assert.equal(failure.stack.includes(MARKER), false);
});

test('real filesystem closure rejects a member reached through an external junction', () => {
  const files = fixtureFiles();
  const root = mkdtempSync(path.join(tmpdir(), 'b2-closure-root-'));
  const external = mkdtempSync(path.join(tmpdir(), 'b2-closure-external-'));
  for (const [member, bytes] of files) {
    const target = member.startsWith('scripts/')
      ? path.join(external, member.slice('scripts/'.length))
      : path.join(root, ...member.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  symlinkSync(external, path.join(root, 'scripts'), 'junction');
  assert.throws(() => buildClosure({ repositoryRoot: root, readFile: readFileSync }), cleanFailure);
});

test('package and lock dependency binding reject every version, resolution and integrity drift', () => {
  const mutations = [
    ['package.json', bytes => Buffer.from(bytes.toString('utf8').replace('"aws4fetch": "1.0.20"', '"aws4fetch": "^1.0.20"'))],
    ['package.json', bytes => Buffer.from(bytes.toString('utf8').replace('"aws4fetch": "1.0.20"', '"aws4fetch": "1.0.19"'))],
    ['package-lock.json', bytes => Buffer.from(bytes.toString('utf8').replace('"aws4fetch": "1.0.20"', '"aws4fetch": "^1.0.20"'))],
    ['package-lock.json', bytes => Buffer.from(bytes.toString('utf8').replace('"version": "1.0.20"', '"version": "1.0.19"'))],
    ['package-lock.json', bytes => Buffer.from(bytes.toString('utf8').replace(AWS_RESOLVED, 'https://registry.npmjs.org/aws4fetch/-/aws4fetch-1.0.19.tgz'))],
    ['package-lock.json', bytes => Buffer.from(bytes.toString('utf8').replace(AWS_INTEGRITY, `${AWS_INTEGRITY.slice(0, -2)}AA`))],
  ];
  for (const [member, mutate] of mutations) {
    const files = fixtureFiles();
    files.set(member, mutate(files.get(member)));
    assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) }), cleanFailure, member);
  }
});

test('malformed JSON, missing dependency records and extra dependency authority fail closed', () => {
  for (const [member, bytes] of [
    ['package.json', Buffer.from(`{${MARKER}`)],
    ['package.json', Buffer.from('{"dependencies":{}}')],
    ['package-lock.json', Buffer.from(`{${MARKER}`)],
    ['package-lock.json', Buffer.from('{"packages":{}}')],
  ]) {
    const files = fixtureFiles();
    files.set(member, bytes);
    assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) }), cleanFailure);
  }
});

test('manifest schema is exact and internally content-addressed before local comparison', () => {
  const files = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  const mutations = [
    record => { record.extra = MARKER; },
    record => { record.schema_version = 2; },
    record => { record.identity = 'legacy-compiler-only'; },
    record => { record.algorithm = 'sha512'; },
    record => { record.runtime.extra = true; },
    record => { record.runtime.node = '24.21.1'; },
    record => { record.runtime.setup_node_action = 'a'.repeat(40); },
    record => { record.dependencies[0].extra = true; },
    record => { record.dependencies[0].version = '1.0.19'; },
    record => { record.operation_tools.extra = true; },
    record => { record.operation_tools.wrangler = '4.136.0'; },
    record => { record.closure_sha256 = 'a'.repeat(64); },
    record => { record.files.reverse(); },
    record => { record.files[0].sha256 = 'a'.repeat(64); },
    record => { record.files[0].extra = MARKER; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(manifestClosure);
    mutate(candidate);
    assert.throws(() => verifyClosure(verifiedOptions(files, candidate)), cleanFailure);
  }
});

test('legacy compiler and adapter hashes cannot substitute for runtime closure', () => {
  const files = fixtureFiles();
  const legacy = {
    compiler: { path: 'scripts/nelyon-production-release.mjs', sha256: 'a'.repeat(64) },
    snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
    snapshot_adapter_sha256: 'b'.repeat(64),
  };
  assert.throws(() => verifyClosure({
    manifestClosure: legacy,
    protectedClosureSha256: 'a'.repeat(64),
    repositoryRoot: ROOT,
    readFile: fixtureReader(files),
    nodeVersion: NODE_VERSION,
  }), cleanFailure);
});

test('protected digest and runtime Node version are independent exact roots', () => {
  const files = fixtureFiles();
  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  for (const protectedClosureSha256 of [
    'a'.repeat(64),
    manifestClosure.closure_sha256.toUpperCase(),
    '',
    null,
  ]) assert.throws(() => verifyClosure({
    ...verifiedOptions(files, manifestClosure), protectedClosureSha256,
  }), cleanFailure);
  for (const nodeVersion of ['24.21.1', 'v24.21.0', '', null]) assert.throws(() => verifyClosure({
    ...verifiedOptions(files, manifestClosure), nodeVersion,
  }), cleanFailure);
});

test('public APIs reject extra, inherited, accessor, proxied and coercible input without byte reads', () => {
  const files = fixtureFiles();
  let reads = 0;
  let touched = 0;
  const reader = absolutePath => { reads++; return fixtureReader(files)(absolutePath); };
  const malicious = { toString() { touched++; throw new Error(MARKER); } };
  const inherited = Object.create({ repositoryRoot: ROOT });
  inherited.readFile = reader;
  const accessor = { readFile: reader };
  Object.defineProperty(accessor, 'repositoryRoot', { enumerable: true, get() { touched++; throw new Error(MARKER); } });
  const cases = [
    null,
    {},
    { repositoryRoot: ROOT, readFile: reader, extra: MARKER },
    { repositoryRoot: malicious, readFile: reader },
    inherited,
    accessor,
    new Proxy({ repositoryRoot: ROOT, readFile: reader }, { get() { touched++; throw new Error(MARKER); } }),
  ];
  for (const candidate of cases) assert.throws(() => buildClosure(candidate), cleanFailure);
  assert.equal(reads, 0);
  assert.equal(touched, 0);

  const manifestClosure = buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files) });
  const verifyBase = verifiedOptions(files, manifestClosure);
  const verifyAccessor = { ...verifyBase };
  Object.defineProperty(verifyAccessor, 'nodeVersion', { enumerable: true, get() { touched++; throw new Error(MARKER); } });
  for (const candidate of [
    { ...verifyBase, extra: MARKER },
    verifyAccessor,
    new Proxy(verifyBase, { ownKeys() { touched++; throw new Error(MARKER); } }),
  ]) assert.throws(() => verifyClosure(candidate), cleanFailure);
  assert.equal(touched, 0);
});

test('reader must return owned exact bytes and cannot redirect the fixed path set', () => {
  const files = fixtureFiles();
  let touched = 0;
  const accessorBytes = Buffer.from('bytes');
  Object.defineProperty(accessorBytes, 'length', {
    get() { touched += 1; throw new Error(MARKER); },
  });
  for (const readFile of [
    () => WORKFLOW,
    () => null,
    () => accessorBytes,
    () => new Proxy(Buffer.from('bytes'), { get() { touched++; throw new Error(MARKER); } }),
  ]) assert.throws(() => buildClosure({ repositoryRoot: ROOT, readFile }), cleanFailure);
  assert.equal(touched, 0);

  const calls = [];
  buildClosure({ repositoryRoot: ROOT, readFile: fixtureReader(files, calls) });
  assert.deepEqual(calls, MEMBERS);
  assert.equal(calls.some(member => member.includes('..') || path.isAbsolute(member)), false);
});
