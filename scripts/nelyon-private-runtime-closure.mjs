import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { types } from 'node:util';

const ERROR_CODE = 'PRIVATE_RUNTIME_CLOSURE_INVALID';
const ERROR_MESSAGE = 'private runtime closure rejected';
const CLOSURE_IDENTITY = 'nelyon-b2-private-release-runtime-v1';
const NODE_VERSION = '24.21.0';
const SETUP_NODE_ACTION = '949feb2413d6458794dcd2491c4babbbce0c15c1';
const SUPABASE_SETUP_ACTION = '45a513f8c64c0bc8e0e3dfe572b5c95be85f6359';
const WRANGLER_VERSION = '4.135.0';
const AWS4FETCH_VERSION = '1.0.20';
const AWS4FETCH_RESOLVED = 'https://registry.npmjs.org/aws4fetch/-/aws4fetch-1.0.20.tgz';
const AWS4FETCH_INTEGRITY = 'sha512-/djoAN709iY65ETD6LKCtyyEI04XIBP5xVvfmNxsEP0uJB5tyaGBztSryRr4HqMStr9R06PisQE7m9zDTXKu6g==';
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MEMBER_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;

const CLOSURE_MEMBERS = Object.freeze([
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

const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

function closedError() {
  const error = new Error(ERROR_MESSAGE);
  Object.defineProperty(error, 'code', {
    value: ERROR_CODE,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(error, 'stack', {
    value: `Error: ${ERROR_MESSAGE}`,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(error);
}

function isProxy(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? types.isProxy(value)
    : false;
}

function strictRecord(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) throw closedError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw closedError();
  if (Object.getOwnPropertySymbols(value).length !== 0) throw closedError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Object.keys(descriptors).sort();
  const wantedKeys = [...expectedKeys].sort();
  if (actualKeys.length !== wantedKeys.length) throw closedError();
  for (let index = 0; index < wantedKeys.length; index += 1) {
    if (actualKeys[index] !== wantedKeys[index]) throw closedError();
    const descriptor = descriptors[wantedKeys[index]];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw closedError();
  }
  return Object.fromEntries(expectedKeys.map(key => [key, descriptors[key].value]));
}

function strictArray(value, expectedLength) {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw closedError();
  if (Object.getOwnPropertySymbols(value).length !== 0) throw closedError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || descriptors.length?.value !== expectedLength) {
    throw closedError();
  }
  const expectedKeys = [...Array.from({ length: expectedLength }, (_, index) => String(index)), 'length'].sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (actualKeys.length !== expectedKeys.length) throw closedError();
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (actualKeys[index] !== expectedKeys[index]) throw closedError();
  }
  const entries = [];
  for (let index = 0; index < expectedLength; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw closedError();
    entries.push(descriptor.value);
  }
  return entries;
}

function strictFunction(value) {
  if (typeof value !== 'function' || isProxy(value)) throw closedError();
  return value;
}

function strictRepositoryRoot(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) throw closedError();
  if (!path.isAbsolute(value)) throw closedError();
  return path.resolve(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function utf8(bytes) {
  return textDecoder.decode(bytes);
}

function parseJson(bytes) {
  const parsed = JSON.parse(utf8(bytes));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw closedError();
  return parsed;
}

function stripYamlComment(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (double && escaped) { escaped = false; continue; }
    if (double && character === '\\') { escaped = true; continue; }
    if (character === "'" && !double) single = !single;
    else if (character === '"' && !single) double = !double;
    else if (character === '#' && !single && !double
      && (index === 0 || /\s/u.test(line[index - 1]))) return line.slice(0, index);
  }
  if (single || double) throw closedError();
  return line;
}

function yamlScalar(raw) {
  const value = raw.trim();
  if (value.length === 0 || /^[&*!>{[]/u.test(value) || value.includes('${{')) throw closedError();
  if (value[0] === "'") {
    if (value.at(-1) !== "'") throw closedError();
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value[0] === '"') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw closedError();
      return parsed;
    } catch { throw closedError(); }
  }
  if (/\s/u.test(value) || /[:#]/u.test(value)) throw closedError();
  return value;
}

function shellWithoutComments(script) {
  return script.split(/\r?\n/u).map(line => {
    let single = false;
    let double = false;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\' && !single) { escaped = true; continue; }
      if (character === "'" && !double) single = !single;
      else if (character === '"' && !single) double = !double;
      else if (character === '#' && !single && !double
        && (index === 0 || /\s/u.test(line[index - 1]))) return line.slice(0, index);
    }
    return line;
  }).join('\n');
}

function validateWorkflowPins(bytes) {
  const lines = utf8(bytes).split(/\r?\n/u);
  const contexts = [];
  const steps = [];
  const scripts = [];
  let currentStep = null;
  let block = null;
  const processLine = rawLine => {
    if (/^\t/u.test(rawLine)) throw closedError();
    const indent = rawLine.match(/^ */u)[0].length;
    if (block) {
      if (rawLine.trim().length === 0 || indent > block.indent) {
        block.lines.push(rawLine.trim().length === 0 ? '' : rawLine.slice(Math.min(rawLine.length, block.indent + 2)));
        return;
      }
      scripts.push(block.lines.join('\n'));
      block = null;
    }
    const line = stripYamlComment(rawLine);
    if (line.trim().length === 0) return;
    while (contexts.length && contexts.at(-1).indent >= indent) contexts.pop();
    const match = line.match(/^( *)(-[ ]+)?([A-Za-z0-9_-]+)[ ]*:[ ]*(.*?)\s*$/u);
    if (!match) return;
    const sequence = Boolean(match[2]);
    const key = match[3];
    const raw = match[4];
    if (key !== 'node-version' && key.includes('node-version')) throw closedError();
    const inSteps = contexts.some(context => context.key === 'steps') || key === 'steps';
    if (sequence && inSteps) currentStep = { indent, uses: null, nodeVersions: [] };
    else if (currentStep && indent <= currentStep.indent) currentStep = null;
    if (raw === '') { contexts.push({ indent, key }); return; }
    if (key === 'run' && /^[|>][+-]?[0-9]?$/u.test(raw.trim())) {
      block = { indent, lines: [] };
      return;
    }
    if (key === 'run') {
      const candidate = raw.trim();
      if (candidate.startsWith("'") || candidate.startsWith('"')) scripts.push(yamlScalar(candidate));
      else {
        if (/^[&*!>{[]/u.test(candidate) || candidate.includes('${{')) throw closedError();
        scripts.push(candidate);
      }
      return;
    }
    if (key === 'uses' && currentStep && inSteps && (sequence || indent > currentStep.indent)) {
      const value = yamlScalar(raw);
      currentStep.uses = value;
      steps.push(currentStep);
    } else if (key === 'node-version' && currentStep && indent > currentStep.indent) currentStep.nodeVersions.push(yamlScalar(raw));
  };
  for (const line of lines) processLine(line);
  if (block) scripts.push(block.lines.join('\n'));

  const setupSteps = steps.filter(step => step.uses?.startsWith('actions/setup-node@'));
  const supabaseSteps = steps.filter(step => step.uses?.startsWith('supabase/setup-cli@'));
  if (setupSteps.length === 0 || supabaseSteps.length === 0
    || setupSteps.some(step => step.uses !== `actions/setup-node@${SETUP_NODE_ACTION}`
      || step.nodeVersions.length !== 1 || step.nodeVersions[0] !== NODE_VERSION)
    || supabaseSteps.some(step => step.uses !== `supabase/setup-cli@${SUPABASE_SETUP_ACTION}`)) throw closedError();
  const versions = scripts.flatMap(script => [...shellWithoutComments(script).matchAll(
    /NELYON_WRANGLER["']?\s+--version\)"?\s*=\s*['"]([^'"]+)['"]/gu,
  )].map(match => match[1]));
  if (versions.length === 0 || versions.some(version => version !== WRANGLER_VERSION)) throw closedError();
}

function javaScriptTokens(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];
    if (index === 0 && character === '#' && next === '!') {
      index = source.indexOf('\n', 2);
      if (index < 0) break;
      continue;
    }
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === '/' && next === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) break;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw closedError();
      index = end + 2;
      continue;
    }
    if (character === '/' && (tokens.length === 0
      || (tokens.at(-1).kind === 'punctuator' && ['(', '=', ',', ':', '[', '!', '?', '{', ';', '>', '&', '|'].includes(tokens.at(-1).value))
      || (tokens.at(-1).kind === 'identifier' && ['return', 'case', 'throw', 'else'].includes(tokens.at(-1).value)))) {
      index += 1;
      let escaped = false;
      let characterClass = false;
      for (; index < source.length; index += 1) {
        const current = source[index];
        if (escaped) { escaped = false; continue; }
        if (current === '\\') { escaped = true; continue; }
        if (current === '[') characterClass = true;
        else if (current === ']') characterClass = false;
        else if (current === '/' && !characterClass) { index += 1; break; }
        else if (current === '\n' || current === '\r') throw closedError();
      }
      if (source[index - 1] !== '/') throw closedError();
      while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1;
      tokens.push({ kind: 'regex' });
      continue;
    }
    if (character === '`') {
      index += 1;
      let escaped = false;
      for (; index < source.length; index += 1) {
        if (escaped) { escaped = false; continue; }
        if (source[index] === '\\') { escaped = true; continue; }
        if (source[index] === '`') { index += 1; break; }
      }
      if (index > source.length || source[index - 1] !== '`') throw closedError();
      tokens.push({ kind: 'template' });
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      let value = '';
      index += 1;
      for (; index < source.length && source[index] !== quote; index += 1) {
        if (source[index] === '\n' || source[index] === '\r') throw closedError();
        if (source[index] === '\\') {
          if (index + 1 >= source.length) throw closedError();
          value += `${source[index]}${source[index + 1]}`;
          index += 1;
          continue;
        }
        value += source[index];
      }
      if (source[index] !== quote) throw closedError();
      index += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u)?.[0];
    if (identifier) { tokens.push({ kind: 'identifier', value: identifier }); index += identifier.length; continue; }
    tokens.push({ kind: 'punctuator', value: character });
    index += 1;
  }
  return tokens;
}

function validateAdminToolPin(bytes) {
  const tokens = javaScriptTokens(utf8(bytes));
  const declarations = [];
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index].kind === 'identifier' && ['const', 'let', 'var'].includes(tokens[index].value)
      && tokens[index + 1].kind === 'identifier' && tokens[index + 1].value === 'WRANGLER_VERSION') {
      declarations.push({ declaration: tokens[index].value, assignment: tokens[index + 2], value: tokens[index + 3] });
    }
  }
  if (declarations.length !== 1 || declarations[0].declaration !== 'const'
    || declarations[0].assignment.kind !== 'punctuator' || declarations[0].assignment.value !== '='
    || declarations[0].value.kind !== 'string' || declarations[0].value.value !== WRANGLER_VERSION) throw closedError();
}

function dataProperty(record, key) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw closedError();
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw closedError();
  return descriptor.value;
}

function validateDependencyBinding(packageBytes, lockBytes) {
  const packageJson = parseJson(packageBytes);
  const dependencies = dataProperty(packageJson, 'dependencies');
  if (dataProperty(dependencies, 'aws4fetch') !== AWS4FETCH_VERSION) throw closedError();

  const packageLock = parseJson(lockBytes);
  const packages = dataProperty(packageLock, 'packages');
  const rootEntry = dataProperty(packages, '');
  const rootDependencies = dataProperty(rootEntry, 'dependencies');
  if (dataProperty(rootDependencies, 'aws4fetch') !== AWS4FETCH_VERSION) throw closedError();

  const dependency = dataProperty(packages, 'node_modules/aws4fetch');
  if (dataProperty(dependency, 'version') !== AWS4FETCH_VERSION
    || dataProperty(dependency, 'resolved') !== AWS4FETCH_RESOLVED
    || dataProperty(dependency, 'integrity') !== AWS4FETCH_INTEGRITY) {
    throw closedError();
  }
}

function fixedAbsolutePath(repositoryRoot, member) {
  const absolutePath = path.resolve(repositoryRoot, ...member.split('/'));
  const prefix = repositoryRoot.endsWith(path.sep) ? repositoryRoot : `${repositoryRoot}${path.sep}`;
  if (!absolutePath.startsWith(prefix)) throw closedError();
  return absolutePath;
}

function assertOrdinaryClosureMember(repositoryRoot, member) {
  if (!existsSync(repositoryRoot)) return;
  const rootStat = lstatSync(repositoryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw closedError();
  const rootReal = realpathSync(repositoryRoot);
  let current = repositoryRoot;
  for (const segment of member.split('/')) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw closedError();
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.isSymbolicLink()) throw closedError();
  const resolved = realpathSync(current);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw closedError();
}

function readFixedMembers(repositoryRoot, readFile) {
  const files = new Map();
  let totalBytes = 0;
  for (const member of CLOSURE_MEMBERS) {
    assertOrdinaryClosureMember(repositoryRoot, member);
    const candidate = readFile(fixedAbsolutePath(repositoryRoot, member));
    if (isProxy(candidate) || !Buffer.isBuffer(candidate)) throw closedError();
    if (Object.hasOwn(candidate, 'length')
      || Object.hasOwn(candidate, 'byteLength')
      || Object.hasOwn(candidate, 'byteOffset')
      || Object.hasOwn(candidate, 'buffer')
      || Object.getOwnPropertySymbols(candidate).length !== 0) {
      throw closedError();
    }
    if (candidate.length > MAX_MEMBER_BYTES) throw closedError();
    totalBytes += candidate.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw closedError();
    files.set(member, Buffer.from(candidate));
  }
  return files;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function closureWithoutDigest(files) {
  return {
    schema_version: 1,
    identity: CLOSURE_IDENTITY,
    algorithm: 'sha256',
    files: CLOSURE_MEMBERS.map(member => ({ path: member, sha256: sha256(files.get(member)) })),
    runtime: {
      node: NODE_VERSION,
      setup_node_action: SETUP_NODE_ACTION,
    },
    dependencies: [{
      name: 'aws4fetch',
      version: AWS4FETCH_VERSION,
      integrity: AWS4FETCH_INTEGRITY,
      lock_path: 'node_modules/aws4fetch',
    }],
    operation_tools: {
      wrangler: WRANGLER_VERSION,
      supabase_setup_action: SUPABASE_SETUP_ACTION,
    },
  };
}

function compileClosure(files) {
  validateWorkflowPins(files.get('.github/workflows/nelyon-production-release.yml'));
  validateAdminToolPin(files.get('scripts/nelyon-admin-production-release.mjs'));
  validateDependencyBinding(files.get('package.json'), files.get('package-lock.json'));
  const withoutDigest = closureWithoutDigest(files);
  return deepFreeze({
    ...withoutDigest,
    closure_sha256: sha256(Buffer.from(canonicalJson(withoutDigest), 'utf8')),
  });
}

function buildClosure(options) {
  const { repositoryRoot: repositoryRootValue, readFile: readFileValue } = strictRecord(options, [
    'repositoryRoot',
    'readFile',
  ]);
  const repositoryRoot = strictRepositoryRoot(repositoryRootValue);
  const readFile = strictFunction(readFileValue);
  const files = readFixedMembers(repositoryRoot, readFile);
  return compileClosure(files);
}

export function privateRuntimeClosureMemberPaths() {
  return Object.freeze([...CLOSURE_MEMBERS]);
}

export function buildPrivateRuntimeClosureFromExactBytes(options) {
  try {
    const record = strictRecord(options, ['files']);
    const entries = strictArray(record.files, CLOSURE_MEMBERS.length);
    const files = new Map();
    let totalBytes = 0;
    entries.forEach((entry, index) => {
      const item = strictRecord(entry, ['path', 'bytes']);
      if (item.path !== CLOSURE_MEMBERS[index] || !Buffer.isBuffer(item.bytes) || isProxy(item.bytes)
        || Object.hasOwn(item.bytes, 'length') || Object.getOwnPropertySymbols(item.bytes).length !== 0
        || item.bytes.length > MAX_MEMBER_BYTES) throw closedError();
      totalBytes += item.bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw closedError();
      files.set(item.path, Buffer.from(item.bytes));
    });
    return compileClosure(files);
  } catch { throw closedError(); }
}

function validateHex64(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw closedError();
  return value;
}

function validateManifestClosure(value) {
  const record = strictRecord(value, [
    'schema_version',
    'identity',
    'algorithm',
    'files',
    'runtime',
    'dependencies',
    'operation_tools',
    'closure_sha256',
  ]);
  if (record.schema_version !== 1 || record.identity !== CLOSURE_IDENTITY || record.algorithm !== 'sha256') {
    throw closedError();
  }

  const fileValues = strictArray(record.files, CLOSURE_MEMBERS.length);
  const files = fileValues.map((entry, index) => {
    const parsed = strictRecord(entry, ['path', 'sha256']);
    if (parsed.path !== CLOSURE_MEMBERS[index]) throw closedError();
    return { path: parsed.path, sha256: validateHex64(parsed.sha256) };
  });

  const runtime = strictRecord(record.runtime, ['node', 'setup_node_action']);
  if (runtime.node !== NODE_VERSION || runtime.setup_node_action !== SETUP_NODE_ACTION) throw closedError();

  const dependencyValues = strictArray(record.dependencies, 1);
  const dependency = strictRecord(dependencyValues[0], ['name', 'version', 'integrity', 'lock_path']);
  if (dependency.name !== 'aws4fetch'
    || dependency.version !== AWS4FETCH_VERSION
    || dependency.integrity !== AWS4FETCH_INTEGRITY
    || dependency.lock_path !== 'node_modules/aws4fetch') {
    throw closedError();
  }

  const operationTools = strictRecord(record.operation_tools, ['wrangler', 'supabase_setup_action']);
  if (operationTools.wrangler !== WRANGLER_VERSION
    || operationTools.supabase_setup_action !== SUPABASE_SETUP_ACTION) {
    throw closedError();
  }

  const normalized = {
    schema_version: 1,
    identity: CLOSURE_IDENTITY,
    algorithm: 'sha256',
    files,
    runtime: { node: runtime.node, setup_node_action: runtime.setup_node_action },
    dependencies: [{
      name: dependency.name,
      version: dependency.version,
      integrity: dependency.integrity,
      lock_path: dependency.lock_path,
    }],
    operation_tools: {
      wrangler: operationTools.wrangler,
      supabase_setup_action: operationTools.supabase_setup_action,
    },
  };
  const declaredDigest = validateHex64(record.closure_sha256);
  const recomputedDigest = sha256(Buffer.from(canonicalJson(normalized), 'utf8'));
  if (!equalDigest(declaredDigest, recomputedDigest)) throw closedError();
  return { normalized, closure_sha256: declaredDigest };
}

function equalDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'));
}

export function buildPrivateRuntimeClosure(options) {
  try {
    return buildClosure(options);
  } catch {
    throw closedError();
  }
}
export function verifyPrivateRuntimeClosure(options) {
  try {
    const values = strictRecord(options, [
      'manifestClosure',
      'protectedClosureSha256',
      'repositoryRoot',
      'readFile',
      'nodeVersion',
    ]);
    const protectedClosureSha256 = validateHex64(values.protectedClosureSha256);
    if (values.nodeVersion !== NODE_VERSION) throw closedError();
    const manifest = validateManifestClosure(values.manifestClosure);
    if (!equalDigest(manifest.closure_sha256, protectedClosureSha256)) throw closedError();
    const localClosure = buildClosure({
      repositoryRoot: values.repositoryRoot,
      readFile: values.readFile,
    });
    if (!equalDigest(localClosure.closure_sha256, manifest.closure_sha256)
      || canonicalJson(localClosure) !== canonicalJson({
        ...manifest.normalized,
        closure_sha256: manifest.closure_sha256,
      })) {
      throw closedError();
    }
    return localClosure;
  } catch {
    throw closedError();
  }
}
