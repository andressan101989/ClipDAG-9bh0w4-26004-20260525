import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const EXACT_MODES = ['plan_only', 'gate_proof', 'release'];

export class GateDeniedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GateDeniedError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new GateDeniedError(code, message, details);
}

function assertExactArray(actual, expected, code, label) {
  if (!Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    deny(code, `${label} does not match the controlled policy`);
  }
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    deny('INVALID_POLICY', 'policy must be an object');
  }
  if (policy.schema_version !== 1) deny('INVALID_POLICY_SCHEMA', 'unsupported policy schema');
  if (policy.owner !== 'andressan101989') deny('INVALID_POLICY_OWNER', 'unexpected policy owner');
  if (policy.repository !== 'andressan101989/ClipDAG-9bh0w4-26004-20260525') {
    deny('INVALID_POLICY_REPOSITORY', 'unexpected repository authority');
  }
  if (policy.default_branch !== 'main') deny('INVALID_POLICY_BRANCH', 'default branch must be main');
  if (policy.workflow_path !== '.github/workflows/nelyon-production-release.yml') {
    deny('INVALID_POLICY_WORKFLOW', 'unexpected workflow path');
  }
  assertExactArray(policy.modes, EXACT_MODES, 'INVALID_POLICY_MODES', 'modes');
  const confirmations = policy.scope_confirmations ?? {};
  const expectedConfirmations = {
    plan_only: 'PLAN_ONLY',
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    release_standard: 'RELEASE_STANDARD',
    release_high_risk: 'RELEASE_HIGH_RISK',
  };
  if (canonicalJson(confirmations) !== canonicalJson(expectedConfirmations)) {
    deny('INVALID_POLICY_CONFIRMATIONS', 'scope confirmations do not match');
  }
  if (!SHA_PATTERN.test(policy.baseline?.sha ?? '')) deny('INVALID_BASELINE_SHA', 'baseline SHA is invalid');
  if (!['candidate', 'verified'].includes(policy.baseline?.state)) {
    deny('INVALID_BASELINE_STATE', 'baseline state is invalid');
  }
  if (!['pending', 'verified'].includes(policy.cutover?.state)) {
    deny('INVALID_CUTOVER_STATE', 'cutover state is invalid');
  }
  if (policy.supabase?.project_ref !== 'aewwdlvbwpczqyvkwvvj') {
    deny('INVALID_PROJECT_REF', 'unexpected Supabase project');
  }
  if (!Array.isArray(policy.supabase?.managed_functions) || policy.supabase.managed_functions.length !== 17) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist must contain exactly 17 functions');
  }
  if (new Set(policy.supabase.managed_functions).size !== policy.supabase.managed_functions.length) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist contains duplicates');
  }
  assertExactArray(policy.supabase?.forbidden_functions, ['bdag-economy'], 'INVALID_FORBIDDEN_FUNCTIONS', 'forbidden functions');
  return true;
}

export function loadPolicy(filePath) {
  const policy = JSON.parse(readFileSync(filePath, 'utf8'));
  validatePolicy(policy);
  return policy;
}

function expectedConfirmation(request, policy) {
  if (request.mode === 'plan_only') return policy.scope_confirmations.plan_only;
  if (request.mode === 'gate_proof') return policy.scope_confirmations.gate_proof;
  if (request.mode === 'release') {
    if (request.scopeConfirmation === policy.scope_confirmations.release_high_risk) {
      return policy.scope_confirmations.release_high_risk;
    }
    return policy.scope_confirmations.release_standard;
  }
  return null;
}

export function validateRequest(request, policy) {
  validatePolicy(policy);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    deny('INVALID_REQUEST', 'release request must be an object');
  }
  if (request.actor !== policy.owner) deny('ACTOR_NOT_AUTHORIZED', 'workflow actor is not authorized');
  if (request.triggeringActor !== policy.owner) {
    deny('TRIGGERING_ACTOR_NOT_AUTHORIZED', 'triggering actor is not authorized');
  }
  if (request.repository !== policy.repository) deny('REPOSITORY_MISMATCH', 'repository identity mismatch');
  const expectedWorkflowRef = `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`;
  if (request.workflowRef !== expectedWorkflowRef) deny('WORKFLOW_REF_MISMATCH', 'workflow identity mismatch');
  if (request.ref !== `refs/heads/${policy.default_branch}`) deny('REF_NOT_MAIN', 'workflow must run from main');
  if (!SHA_PATTERN.test(request.approvedSha ?? '') || !SHA_PATTERN.test(request.mainSha ?? '')) {
    deny('INVALID_SHA', 'approved and main SHAs must be lowercase 40-character hexadecimal values');
  }
  if (request.approvedSha !== request.mainSha) deny('MAIN_SHA_MISMATCH', 'approved SHA is not current main');
  if (!policy.modes.includes(request.mode)) deny('MODE_NOT_ALLOWED', 'workflow mode is not allowed');
  const expected = expectedConfirmation(request, policy);
  if (request.scopeConfirmation !== expected) {
    deny('SCOPE_CONFIRMATION_MISMATCH', 'scope confirmation does not match mode and risk class');
  }
  if (!RELEASE_ID_PATTERN.test(request.releaseId ?? '')) deny('INVALID_RELEASE_ID', 'release ID format is invalid');
  if (!/^[1-9][0-9]*$/.test(String(request.runId ?? ''))) deny('INVALID_RUN_ID', 'run ID is invalid');
  if (!Number.isSafeInteger(request.runAttempt) || request.runAttempt < 1) {
    deny('INVALID_RUN_ATTEMPT', 'run attempt is invalid');
  }
  if (request.mode === 'release' && policy.baseline.state !== 'verified') {
    deny('BASELINE_NOT_VERIFIED', 'production baseline is not verified');
  }
  if (request.mode === 'release' && policy.cutover.state !== 'verified') {
    deny('CUTOVER_NOT_VERIFIED', 'production cutover is not verified');
  }
  return Object.freeze({ ...request });
}

function normalizeCanonical(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('unsupported non-finite number in canonical JSON');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`unsupported ${typeof value} in canonical JSON`);
  if (seen.has(value)) throw new TypeError('unsupported cyclic value in canonical JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeCanonical(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('unsupported object type in canonical JSON');
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = normalizeCanonical(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeCanonical(value, new Set()))}\n`;
}

export function sha256Hex(bytes) {
  if (!(typeof bytes === 'string' || bytes instanceof Uint8Array)) {
    throw new TypeError('sha256Hex requires UTF-8 text or bytes');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    deny('INVALID_GIT_OUTPUT', `${label} is not valid UTF-8`, { cause: error.message });
  }
}

export function parseNameStatusZ(buffer) {
  if (!(buffer instanceof Uint8Array)) deny('INVALID_GIT_OUTPUT', 'name-status output must be bytes');
  const text = decodeUtf8(buffer, 'name-status output');
  if (text.length === 0) return [];
  if (!text.endsWith('\0')) deny('INVALID_GIT_OUTPUT', 'name-status output is not NUL terminated');
  const fields = text.split('\0');
  fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|R[0-9]{1,3}|C[0-9]{1,3})$/.test(status)) {
      deny('INVALID_GIT_OUTPUT', `unsupported name-status token: ${status}`);
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (!oldPath || !path) deny('INVALID_GIT_OUTPUT', 'rename/copy record is incomplete');
      changes.push({ status, oldPath, path });
    } else {
      const path = fields[index++];
      if (!path) deny('INVALID_GIT_OUTPUT', 'name-status record is incomplete');
      changes.push({ status, path });
    }
  }
  return changes;
}

function gitText(runGit, args, cwd) {
  const result = runGit(args, { cwd });
  if (!(typeof result === 'string' || result instanceof Uint8Array)) {
    deny('INVALID_GIT_OUTPUT', `git ${args[0]} returned an unsupported value`);
  }
  return (typeof result === 'string' ? result : decodeUtf8(result, `git ${args[0]} output`)).trim();
}

function repositoryFromRemote(remote) {
  const normalized = remote.trim().replace(/\\/g, '/').replace(/\.git$/, '');
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (https) return https[1];
  const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  return ssh?.[1] ?? null;
}

function fileTypeAtCommit(runGit, cwd, sha, path) {
  const record = gitText(runGit, ['ls-tree', '-z', sha, '--', path], cwd);
  if (!record) return 'missing';
  const match = record.match(/^(\d{6})\s+(blob|tree|commit)\s+[0-9a-f]{40}\t/);
  if (!match) return 'unknown';
  if (match[1] === '120000') return 'symlink';
  if (match[1] === '160000' || match[2] === 'commit') return 'submodule';
  if (match[2] === 'tree') return 'directory';
  if (match[1] === '100644' || match[1] === '100755') return 'file';
  return 'unknown';
}

export function resolveGitState({ cwd, baselineSha, approvedSha, expectedRepository, runGit }) {
  if (typeof runGit !== 'function') throw new TypeError('runGit adapter is required');
  if (!SHA_PATTERN.test(baselineSha ?? '') || !SHA_PATTERN.test(approvedSha ?? '')) {
    deny('INVALID_SHA', 'baseline and approved SHA must be full lowercase commit IDs');
  }
  const remote = gitText(runGit, ['remote', 'get-url', 'origin'], cwd);
  if (repositoryFromRemote(remote)?.toLowerCase() !== expectedRepository.toLowerCase()) {
    deny('REPOSITORY_MISMATCH', 'origin does not identify the expected repository');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
  } catch {
    deny('APPROVED_COMMIT_MISSING', 'approved SHA is not an available commit');
  }
  const originMainSha = gitText(runGit, ['rev-parse', 'refs/remotes/origin/main^{commit}'], cwd);
  if (approvedSha !== originMainSha) deny('MAIN_SHA_MISMATCH', 'approved SHA does not equal fetched origin/main');
  try {
    runGit(['merge-base', '--is-ancestor', baselineSha, approvedSha], { cwd });
  } catch {
    deny('BASELINE_NOT_ANCESTOR', 'verified baseline is not an ancestor of approved main');
  }
  const raw = runGit(['diff', '--name-status', '-z', '--no-renames', baselineSha, approvedSha, '--'], { cwd });
  const changes = parseNameStatusZ(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw)
    .map(change => ({
      ...change,
      fileType: ['A', 'M', 'T'].includes(change.status)
        ? fileTypeAtCommit(runGit, cwd, approvedSha, change.path)
        : undefined,
    }));
  return Object.freeze({ approvedSha, baselineSha, originMainSha, remote, changes });
}

function validateGitPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    deny('UNSUPPORTED_GIT_CHANGE', 'Git change contains an invalid path');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some(part => part === '..' || part === '')) {
    deny('UNSUPPORTED_GIT_CHANGE', `Git path escapes the repository: ${path}`);
  }
  return normalized;
}

export function classifyChangedPaths(changes) {
  if (!Array.isArray(changes)) deny('UNSUPPORTED_GIT_CHANGE', 'Git changes must be an array');
  const result = {
    all: [],
    config: [],
    functions: [],
    governance: [],
    migrations: [],
    other: [],
    productive: [],
    shared: [],
  };
  for (const raw of changes) {
    const path = validateGitPath(raw?.path);
    if (!['A', 'M'].includes(raw.status)) {
      deny('UNSUPPORTED_GIT_CHANGE', `Git status ${raw.status} is not releasable`, { path });
    }
    if (raw.fileType && !['file', 'directory'].includes(raw.fileType)) {
      deny('UNSUPPORTED_GIT_CHANGE', `Git path is not an ordinary file or directory`, { path, fileType: raw.fileType });
    }
    const change = Object.freeze({ ...raw, path });
    result.all.push(change);
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(path)) {
      result.migrations.push(change);
      result.productive.push(change);
    } else if (path === 'supabase/config.toml') {
      result.config.push(change);
      result.productive.push(change);
    } else if (/^supabase\/functions\/_shared\//.test(path)) {
      result.shared.push(change);
      result.productive.push(change);
    } else if (/^supabase\/functions\/[^/]+\//.test(path)) {
      result.functions.push(change);
      result.productive.push(change);
    } else if (path.startsWith('supabase/')) {
      deny('UNSUPPORTED_GIT_CHANGE', `unknown Supabase path: ${path}`, { path });
    } else if (path === '.github/nelyon-production-release-policy.json'
      || path === '.github/workflows/nelyon-production-release.yml'
      || path === 'scripts/nelyon-production-release.mjs'
      || path === 'tests/nelyonProductionReleaseGate.test.mjs'
      || path === 'docs/runbooks/nelyon-production-release.md'
      || path.startsWith('docs/superpowers/specs/')
      || path.startsWith('docs/superpowers/plans/')) {
      result.governance.push(change);
    } else {
      result.other.push(change);
    }
  }
  return Object.freeze(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Object.freeze(value)])));
}

function migrationVersion(value) {
  const name = String(value).replace(/\\/g, '/').split('/').at(-1);
  return name?.match(/^(\d{14})(?:_[A-Za-z0-9][A-Za-z0-9_-]*)?(?:\.sql)?$/)?.[1] ?? null;
}

export function validateMigrationDelta({ changes, baselineLatestMigration, remoteMigrations, dryRunPending }) {
  if (!Array.isArray(changes) || !Array.isArray(remoteMigrations) || !Array.isArray(dryRunPending)) {
    deny('INVALID_MIGRATION_DELTA', 'migration inputs must be arrays');
  }
  const baselineVersion = migrationVersion(baselineLatestMigration);
  if (!baselineVersion) deny('INVALID_MIGRATION_DELTA', 'baseline latest migration is invalid');
  const migrations = [];
  const seen = new Set();
  for (const change of changes) {
    const path = validateGitPath(change?.path);
    if (!path.startsWith('supabase/migrations/')) continue;
    if (change.status !== 'A') deny('INVALID_MIGRATION_DELTA', 'migrations are forward-only additions', { path, status: change.status });
    const version = migrationVersion(path);
    if (!version || version <= baselineVersion || seen.has(version)) {
      deny('INVALID_MIGRATION_DELTA', 'migration timestamp is invalid, duplicate, or not newer than baseline', { path });
    }
    seen.add(version);
    migrations.push({ version, path });
  }
  migrations.sort((left, right) => left.version.localeCompare(right.version));
  const remote = new Set(remoteMigrations.map(migrationVersion));
  if (remote.has(null)) deny('INVALID_MIGRATION_DELTA', 'remote migration inventory contains an invalid version');
  for (const migration of migrations) {
    if (remote.has(migration.version)) deny('MIGRATION_ALREADY_APPLIED', 'manifest migration already exists remotely', migration);
  }
  const pending = dryRunPending.map(migrationVersion);
  if (pending.includes(null)) deny('MIGRATION_DRY_RUN_MISMATCH', 'dry-run returned an invalid migration');
  const expected = migrations.map(migration => migration.version);
  if (canonicalJson([...pending].sort()) !== canonicalJson(expected)) {
    deny('MIGRATION_DRY_RUN_MISMATCH', 'remote dry-run does not exactly match the manifest migrations', { expected, pending });
  }
  return migrations;
}

function parseTomlScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:0|[1-9][0-9]*)$/.test(value)) return Number(value);
  const quoted = value.match(/^(["'])(.*)\1$/);
  if (quoted && !quoted[2].includes(quoted[1])) return quoted[2];
  deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported TOML value on line ${lineNumber}`);
}

export function parseFunctionConfig(toml) {
  if (typeof toml !== 'string') deny('AMBIGUOUS_FUNCTION_CONFIG', 'config.toml must be text');
  const result = {};
  let current = null;
  const allowedKeys = new Set(['entrypoint', 'import_map', 'verify_jwt']);
  for (const [offset, original] of toml.split(/\r?\n/).entries()) {
    const lineNumber = offset + 1;
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[functions\.([A-Za-z0-9][A-Za-z0-9-]*)\]$/);
    if (section) {
      current = section[1];
      if (Object.hasOwn(result, current)) {
        deny('AMBIGUOUS_FUNCTION_CONFIG', `duplicate function section ${current}`);
      }
      result[current] = {};
      continue;
    }
    if (line.startsWith('[')) deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported TOML section on line ${lineNumber}`);
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!assignment || !current || !allowedKeys.has(assignment[1])) {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported or misplaced TOML key on line ${lineNumber}`);
    }
    const [, key, rawValue] = assignment;
    if (Object.hasOwn(result[current], key)) {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `duplicate ${key} for function ${current}`);
    }
    result[current][key] = parseTomlScalar(rawValue, lineNumber);
  }
  for (const [name, config] of Object.entries(result)) {
    if (typeof config.verify_jwt !== 'boolean') {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `function ${name} has no unambiguous verify_jwt value`);
    }
  }
  return result;
}

function stripQuotedLiteral(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1$/s);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[2].replace(/"/g, '\\"')}"`);
  } catch {
    return null;
  }
}

export function parseModuleSpecifiers(source, path = '<source>') {
  if (typeof source !== 'string') deny('AMBIGUOUS_IMPORT', `module ${path} is not text`);
  const imports = [];
  const seen = new Set();
  const add = (kind, specifier) => {
    const key = `${kind}\0${specifier}`;
    if (!seen.has(key)) {
      seen.add(key);
      imports.push({ kind, specifier });
    }
  };
  const dynamicPattern = /\bimport\s*\(([^)]*)\)/gs;
  for (const match of source.matchAll(dynamicPattern)) {
    const specifier = stripQuotedLiteral(match[1]);
    if (!specifier) deny('AMBIGUOUS_IMPORT', `non-literal dynamic import in ${path}`);
    add('dynamic', specifier);
  }
  const staticImportPattern = /\bimport\s+(?!\()(?:(?:[^'";]*?)\s+from\s+)?(["'])([^"']+)\1/g;
  for (const match of source.matchAll(staticImportPattern)) add('static', match[2]);
  const exportPattern = /\bexport\s+[^'";]*?\s+from\s+(["'])([^"']+)\1/g;
  for (const match of source.matchAll(exportPattern)) add('export', match[2]);
  return imports;
}

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];

function normalizeModulePath(path) {
  const normalized = validateGitPath(path);
  if (!normalized.startsWith('supabase/functions/')) {
    deny('IMPORT_ESCAPES_FUNCTIONS', `module is outside supabase/functions: ${path}`);
  }
  return normalized;
}

function resolveLocalModule(fromPath, specifier, available) {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (joined === '..' || joined.startsWith('../') || !joined.startsWith('supabase/functions/')) {
    deny('IMPORT_ESCAPES_FUNCTIONS', `import ${specifier} from ${fromPath} escapes supabase/functions`);
  }
  const extension = posix.extname(joined);
  const candidates = extension
    ? [joined]
    : [...MODULE_EXTENSIONS.map(item => `${joined}${item}`), ...MODULE_EXTENSIONS.map(item => `${joined}/index${item}`)];
  const matches = candidates.filter(candidate => available.has(candidate));
  if (matches.length === 0) deny('UNRESOLVED_IMPORT', `cannot resolve ${specifier} from ${fromPath}`);
  if (matches.length !== 1) deny('AMBIGUOUS_IMPORT', `multiple resolutions for ${specifier} from ${fromPath}`, { matches });
  return matches[0];
}

function functionNameForPath(path) {
  const match = path.match(/^supabase\/functions\/([^/]+)\//);
  return match && match[1] !== '_shared' ? match[1] : null;
}

export function buildFunctionGraph(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    deny('AMBIGUOUS_IMPORT', 'function graph files must be a path-to-source object');
  }
  const normalizedFiles = new Map();
  for (const [rawPath, source] of Object.entries(files)) {
    const path = normalizeModulePath(rawPath);
    if (normalizedFiles.has(path)) deny('AMBIGUOUS_IMPORT', `duplicate normalized module path ${path}`);
    if (typeof source !== 'string') deny('AMBIGUOUS_IMPORT', `module ${path} is not text`);
    normalizedFiles.set(path, source);
  }
  const nodes = {};
  const reverse = {};
  for (const [path, source] of normalizedFiles) {
    const specifiers = parseModuleSpecifiers(source, path);
    const localImports = [];
    const externalImports = [];
    for (const entry of specifiers) {
      if (entry.specifier.startsWith('.')) {
        const resolved = resolveLocalModule(path, entry.specifier, normalizedFiles);
        localImports.push(resolved);
        (reverse[resolved] ??= []).push(path);
      } else {
        externalImports.push(entry.specifier);
      }
    }
    nodes[path] = {
      externalImports: [...new Set(externalImports)].sort(),
      functionName: functionNameForPath(path),
      localImports: [...new Set(localImports)].sort(),
      path,
      specifiers,
    };
  }
  for (const importers of Object.values(reverse)) importers.sort();
  return Object.freeze({ nodes, reverse });
}

function assertAuthorizedFunction(name, managed, forbidden) {
  if (!name || forbidden.has(name) || !managed.has(name)) {
    deny('FUNCTION_NOT_AUTHORIZED', `function ${name ?? '<unknown>'} is not managed by the release gate`);
  }
}

export function resolveAffectedFunctions({ changes, graph, managedFunctions, forbiddenFunctions = [] }) {
  if (!Array.isArray(changes) || !graph?.nodes || !graph?.reverse) {
    deny('FUNCTION_NOT_AUTHORIZED', 'affected-function inputs are incomplete');
  }
  const managed = new Set(managedFunctions);
  const forbidden = new Set(forbiddenFunctions);
  const affected = new Set();
  const queue = [];
  for (const change of changes) {
    const path = validateGitPath(change.path);
    if (path === 'supabase/config.toml') {
      for (const name of managed) affected.add(name);
      continue;
    }
    const name = functionNameForPath(path);
    if (name) {
      assertAuthorizedFunction(name, managed, forbidden);
      affected.add(name);
    } else if (path.startsWith('supabase/functions/_shared/')) {
      if (!graph.nodes[path]) deny('UNRESOLVED_IMPORT', `changed shared module ${path} is missing from approved tree`);
      queue.push(path);
    }
  }
  const visited = new Set(queue);
  while (queue.length) {
    const imported = queue.shift();
    for (const importer of graph.reverse[imported] ?? []) {
      const name = graph.nodes[importer]?.functionName;
      if (name) {
        assertAuthorizedFunction(name, managed, forbidden);
        affected.add(name);
      }
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push(importer);
      }
    }
  }
  return [...affected].sort();
}

function isImmutableExternalSpecifier(specifier) {
  if (specifier.startsWith('node:')) return true;
  if (/^npm:(?:@[^/]+\/[^@/]+|[^@/]+)@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/.*)?$/.test(specifier)) return true;
  if (/^jsr:@[^/]+\/[^@/]+@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/.*)?$/.test(specifier)) return true;
  if (/^https?:\/\//.test(specifier)) {
    return /@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/|$|\?)/.test(specifier)
      || /(?:^|[/?#])(?:[0-9a-f]{40}|sha256-[A-Za-z0-9_-]{32,})(?:[/?#]|$)/i.test(specifier);
  }
  return false;
}

export function analyzeFunctionReproducibility({ affectedFunctions, graph }) {
  const findings = [];
  const blockedFunctions = new Set();
  for (const functionName of affectedFunctions) {
    const starts = Object.values(graph.nodes).filter(node => node.functionName === functionName).map(node => node.path);
    if (starts.length === 0) {
      findings.push({ severity: 'BLOCKING', code: 'FUNCTION_SOURCE_MISSING', path: null, resource: functionName, message: 'managed function source is missing' });
      blockedFunctions.add(functionName);
      continue;
    }
    const queue = [...starts];
    const visited = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (visited.has(path)) continue;
      visited.add(path);
      const node = graph.nodes[path];
      if (!node) {
        findings.push({ severity: 'BLOCKING', code: 'UNRESOLVED_IMPORT', path, resource: functionName, message: 'resolved dependency is absent from graph' });
        blockedFunctions.add(functionName);
        continue;
      }
      for (const specifier of node.externalImports) {
        if (!isImmutableExternalSpecifier(specifier)) {
          findings.push({
            severity: 'BLOCKING',
            code: 'FLOATING_DEPENDENCY',
            path,
            resource: functionName,
            message: `dependency is not immutably pinned: ${specifier}`,
            specifier,
          });
          blockedFunctions.add(functionName);
        }
      }
      queue.push(...node.localImports);
    }
  }
  findings.sort((left, right) => `${left.resource}:${left.path}:${left.code}`.localeCompare(`${right.resource}:${right.path}:${right.code}`));
  return Object.freeze({ allowed: findings.length === 0, blockedFunctions: [...blockedFunctions].sort(), findings });
}

function riskFinding(code, resource, path, message) {
  return { severity: 'HIGH', code, path: path ?? null, resource: resource ?? null, message };
}

export function classifyRisk({ affectedFunctions = [], changedPaths = [], configBefore = {}, configAfter = {} }) {
  const findings = [];
  const seen = new Set();
  const add = finding => {
    const key = `${finding.code}:${finding.resource}:${finding.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };
  for (const name of affectedFunctions) {
    if (/stripe|finance|financial|checkout/.test(name)) add(riskFinding('FINANCE_RESOURCE', name, null, 'financial or Stripe resource'));
    if (/webhook/.test(name)) add(riskFinding('WEBHOOK_RESOURCE', name, null, 'webhook resource'));
    if (/bdag/.test(name)) add(riskFinding('BDAG_RESOURCE', name, null, 'BDAG resource'));
    if (/media|stream/.test(name)) add(riskFinding('PRIVATE_MEDIA_RESOURCE', name, null, 'private media resource'));
    if (/moderation|content-safety/.test(name)) add(riskFinding('MODERATION_RESOURCE', name, null, 'moderation resource'));
    if (/auth|token|agora/.test(name)) add(riskFinding('AUTH_RESOURCE', name, null, 'authentication or token resource'));
    const before = configBefore[name]?.verify_jwt;
    const after = configAfter[name]?.verify_jwt;
    if (before !== undefined && after !== undefined && before !== after) {
      add(riskFinding('VERIFY_JWT_CHANGED', name, 'supabase/config.toml', 'verify_jwt changed'));
    }
    if (after === false) add(riskFinding('VERIFY_JWT_DISABLED', name, 'supabase/config.toml', 'verify_jwt is disabled'));
  }
  for (const path of changedPaths) {
    if (path === '.github/nelyon-production-release-policy.json'
      || path === '.github/workflows/nelyon-production-release.yml'
      || path === 'scripts/nelyon-production-release.mjs') {
      add(riskFinding('GATE_AUTHORITY_CHANGE', 'release-gate', path, 'release authority changed'));
    }
  }
  findings.sort((left, right) => `${left.code}:${left.resource}:${left.path}`.localeCompare(`${right.code}:${right.resource}:${right.path}`));
  return Object.freeze({ level: findings.length ? 'HIGH' : 'STANDARD', findings });
}

function collectFunctionSources(directory, root, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) deny('AMBIGUOUS_IMPORT', `function source link is unsupported: ${path}`);
    if (entry.isDirectory()) collectFunctionSources(path, root, files);
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files[relative(root, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
    }
  }
  return files;
}

export function compileLocalEvidence({ cwd, policy, request, generatedAt = new Date().toISOString() }) {
  const runGit = args => execFileSync('git', args, { cwd, encoding: args.includes('-z') ? 'buffer' : 'utf8' });
  const gitState = resolveGitState({
    cwd,
    baselineSha: policy.baseline.sha,
    approvedSha: request.approvedSha,
    expectedRepository: policy.repository,
    runGit,
  });
  const classified = classifyChangedPaths(gitState.changes);
  const migrations = validateMigrationDelta({
    changes: gitState.changes,
    baselineLatestMigration: policy.baseline.latest_migration,
    remoteMigrations: [],
    dryRunPending: [],
  });
  const graph = buildFunctionGraph(collectFunctionSources(join(cwd, 'supabase', 'functions'), cwd));
  const affectedFunctions = resolveAffectedFunctions({
    changes: gitState.changes,
    graph,
    managedFunctions: policy.supabase.managed_functions,
    forbiddenFunctions: policy.supabase.forbidden_functions,
  });
  const reproducibility = analyzeFunctionReproducibility({ affectedFunctions, graph });
  const baselineConfig = runGit(['show', `${policy.baseline.sha}:supabase/config.toml`]);
  const currentConfig = readFileSync(join(cwd, 'supabase', 'config.toml'), 'utf8');
  const risk = classifyRisk({
    affectedFunctions,
    changedPaths: gitState.changes.map(change => change.path),
    configBefore: parseFunctionConfig(baselineConfig),
    configAfter: parseFunctionConfig(currentConfig),
  });
  const compilerPath = join(cwd, 'scripts', 'nelyon-production-release.mjs');
  return {
    gitState,
    classified,
    migrations,
    affectedFunctions,
    reproducibility,
    risk,
    compiler: { path: 'scripts/nelyon-production-release.mjs', sha256: sha256Hex(readFileSync(compilerPath)) },
    generatedAt,
  };
}

function stableCopy(value) {
  return JSON.parse(canonicalJson(value));
}

export function buildManifest({
  request,
  policy,
  gitState,
  classified,
  migrations,
  affectedFunctions,
  reproducibility,
  risk,
  compiler,
  generatedAt,
}) {
  validateRequest(request, policy);
  if (!/^[0-9a-f]{64}$/.test(compiler?.sha256 ?? '')) {
    deny('INVALID_COMPILER_IDENTITY', 'compiler SHA-256 is invalid');
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    deny('INVALID_MANIFEST_TIME', 'manifest generation time is invalid');
  }
  const files = [...(classified?.all ?? [])]
    .map(change => ({ file_type: change.fileType ?? null, path: change.path, status: change.status }))
    .sort((left, right) => `${left.path}:${left.status}`.localeCompare(`${right.path}:${right.status}`));
  const blockers = [...(reproducibility?.findings ?? [])]
    .map(stableCopy)
    .sort((left, right) => `${left.code}:${left.resource}:${left.path}`.localeCompare(`${right.code}:${right.resource}:${right.path}`));
  const productiveCount = classified?.productive?.length ?? 0;
  const result = blockers.length > 0
    ? 'DENY'
    : productiveCount === 0
      ? 'NO PRODUCTIVE CHANGES'
      : 'PLAN READY';
  return {
    schema_version: 1,
    generated_at: new Date(generatedAt).toISOString(),
    identity: {
      actor: request.actor,
      triggering_actor: request.triggeringActor,
      repository: request.repository,
      workflow_ref: request.workflowRef,
      ref: request.ref,
      run_id: String(request.runId),
      run_attempt: request.runAttempt,
      release_id: request.releaseId,
      approved_sha: request.approvedSha,
      mode: request.mode,
      scope_confirmation: request.scopeConfirmation,
    },
    baseline: {
      state: policy.baseline.state,
      sha: gitState.baselineSha,
      origin_main_sha: gitState.originMainSha,
    },
    delta: {
      files,
      productive_change_count: productiveCount,
    },
    resources: {
      functions: [...affectedFunctions].sort(),
      migrations: [...migrations].map(stableCopy).sort((left, right) => left.version.localeCompare(right.version)),
      config_changed: (classified?.config?.length ?? 0) > 0,
    },
    risk: stableCopy(risk),
    blockers,
    compiler: {
      path: compiler.path,
      sha256: compiler.sha256,
    },
    result,
  };
}

const BUNDLE_FILES = ['manifest.json', 'manifest.sha256', 'summary.md'];

function assertSafeBundleDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    deny('UNSAFE_ARTIFACT', 'bundle directory must resolve to an absolute path');
  }
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) deny('UNSAFE_ARTIFACT', 'bundle directory is not an ordinary directory');
  const entries = readdirSync(directory);
  for (const entry of entries) {
    if (!BUNDLE_FILES.includes(entry)) deny('UNSAFE_ARTIFACT', `unexpected bundle entry ${entry}`);
    const child = lstatSync(join(directory, entry));
    if (!child.isFile() || child.isSymbolicLink()) deny('UNSAFE_ARTIFACT', `bundle entry ${entry} is not an ordinary file`);
  }
}

function manifestSummary(manifest, digest) {
  return [
    '# Nelyon production release plan',
    '',
    `- Release: ${manifest.identity.release_id}`,
    `- Mode: ${manifest.identity.mode}`,
    `- SHA: ${manifest.identity.approved_sha}`,
    `- Manifest SHA-256: ${digest}`,
    `- Risk: ${manifest.risk.level}`,
    `- Productive changes: ${manifest.delta.productive_change_count}`,
    `- Result: ${manifest.result}`,
    '',
  ].join('\n');
}

export function writeManifestBundle({ manifest, outputDirectory }) {
  assertSafeBundleDirectory(outputDirectory);
  const manifestBytes = canonicalJson(manifest);
  const digest = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  writeFileSync(join(outputDirectory, 'manifest.json'), manifestBytes, { encoding: 'utf8', flag: 'w' });
  writeFileSync(join(outputDirectory, 'manifest.sha256'), `${digest}\n`, { encoding: 'utf8', flag: 'w' });
  writeFileSync(join(outputDirectory, 'summary.md'), manifestSummary(manifest, digest), { encoding: 'utf8', flag: 'w' });
  return {
    digest,
    provenance: {
      approvedSha: manifest.identity.approved_sha,
      compilerSha256: manifest.compiler.sha256,
      environmentName: 'production',
      manifestDigest: digest,
      releaseId: manifest.identity.release_id,
      runAttempt: manifest.identity.run_attempt,
      runId: manifest.identity.run_id,
    },
  };
}

function verifyArtifactEntries(entries) {
  if (!Array.isArray(entries)) return;
  const seen = new Set();
  for (const entry of entries) {
    const path = entry?.path;
    if (typeof path !== 'string' || path.includes('\\') || path.includes('/')
      || path === '.' || path === '..' || /^[A-Za-z]:/.test(path) || isAbsolute(path)
      || !BUNDLE_FILES.includes(path) || entry.type !== 'file' || seen.has(path)) {
      deny('UNSAFE_ARTIFACT', 'artifact archive contains an unsafe, duplicate, or unexpected entry', { entry });
    }
    seen.add(path);
  }
  if (seen.size !== BUNDLE_FILES.length || BUNDLE_FILES.some(path => !seen.has(path))) {
    deny('UNSAFE_ARTIFACT', 'artifact archive does not contain exactly the expected files');
  }
}

export function verifyManifestBundle({ directory, expected }) {
  assertSafeBundleDirectory(directory);
  verifyArtifactEntries(expected?.artifactEntries);
  const actualEntries = readdirSync(directory).sort();
  if (canonicalJson(actualEntries) !== canonicalJson([...BUNDLE_FILES].sort())) {
    deny('UNSAFE_ARTIFACT', 'manifest bundle contains unexpected filesystem entries');
  }
  for (const entry of actualEntries) {
    const stat = lstatSync(join(directory, entry));
    if (!stat.isFile() || stat.isSymbolicLink()) deny('UNSAFE_ARTIFACT', `bundle entry ${entry} is not an ordinary file`);
  }
  const manifestBytes = readFileSync(join(directory, 'manifest.json'), 'utf8');
  const claimedDigest = readFileSync(join(directory, 'manifest.sha256'), 'utf8').trim();
  const actualDigest = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  if (!/^[0-9a-f]{64}$/.test(claimedDigest) || claimedDigest !== actualDigest) {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest digest does not match exact bytes');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest is not valid JSON');
  }
  if (canonicalJson(manifest) !== manifestBytes) {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest bytes are not canonical');
  }
  const actualProvenance = {
    approvedSha: manifest.identity?.approved_sha,
    compilerSha256: manifest.compiler?.sha256,
    environmentName: 'production',
    manifestDigest: actualDigest,
    releaseId: manifest.identity?.release_id,
    runAttempt: manifest.identity?.run_attempt,
    runId: manifest.identity?.run_id,
  };
  for (const key of ['approvedSha', 'compilerSha256', 'environmentName', 'manifestDigest', 'releaseId', 'runAttempt', 'runId']) {
    if (expected?.[key] !== actualProvenance[key]) {
      deny('ARTIFACT_PROVENANCE_MISMATCH', `artifact ${key} does not match the current release attempt`);
    }
  }
  return { digest: actualDigest, manifest, provenance: actualProvenance };
}

export function validateReleaseHistory({ releaseId, pages, policy }) {
  if (!pages || pages.complete !== true || !Array.isArray(pages.pages)) {
    deny('INCOMPLETE_RELEASE_HISTORY', 'workflow release history pagination is incomplete');
  }
  const records = [];
  for (const page of pages.pages) {
    if (!page || !Array.isArray(page.items)) deny('INCOMPLETE_RELEASE_HISTORY', 'workflow history page is incomplete');
    records.push(...page.items);
  }
  records.push(...(policy.release_history ?? []));
  if (records.some(record => record?.release_id === releaseId || record?.releaseId === releaseId)) {
    deny('RELEASE_ID_REPLAY', `release ID ${releaseId} has already been used`);
  }
  return true;
}

function requireUnsignedInteger(value, code, label, { positive = false } = {}) {
  const text = String(value ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(text) || (positive && BigInt(text) === 0n)) {
    deny(code, `${label} must be a ${positive ? 'positive ' : ''}unsigned integer`);
  }
  return text;
}

function requireTokenPart(value, code, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    deny(code, `${label} contains unsupported token characters`);
  }
  return value;
}

function flattenCompletePages(envelope, code, label) {
  if (!envelope || envelope.complete !== true || !Array.isArray(envelope.pages)) {
    deny(code, `${label} pagination is incomplete`);
  }
  const records = [];
  for (const page of envelope.pages) {
    if (!page || !Array.isArray(page.items)) deny(code, `${label} page is incomplete`);
    records.push(...page.items);
  }
  return records;
}

export function buildApprovalToken(input) {
  const runId = requireUnsignedInteger(input?.runId, 'INVALID_APPROVAL_TOKEN', 'run ID', { positive: true });
  const runAttempt = requireUnsignedInteger(input?.runAttempt, 'INVALID_APPROVAL_TOKEN', 'run attempt', { positive: true });
  const environmentId = requireUnsignedInteger(input?.environmentId, 'INVALID_APPROVAL_TOKEN', 'environment ID', { positive: true });
  const releaseId = requireTokenPart(input?.releaseId, 'INVALID_APPROVAL_TOKEN', 'release ID');
  const evidenceId = requireTokenPart(input?.evidenceId, 'INVALID_APPROVAL_TOKEN', 'auto-deploy evidence ID');
  if (!SHA_PATTERN.test(input?.approvedSha ?? '')) deny('INVALID_APPROVAL_TOKEN', 'approved SHA must be a full lowercase commit ID');
  if (!/^[0-9a-f]{64}$/.test(input?.manifestDigest ?? '')) deny('INVALID_APPROVAL_TOKEN', 'manifest digest must be lowercase SHA-256');
  if (!/^[0-9a-f]{64}$/.test(input?.evidenceSha256 ?? '')) deny('INVALID_APPROVAL_TOKEN', 'auto-deploy evidence digest must be lowercase SHA-256');
  return `NELYON-APPROVE run=${runId} attempt=${runAttempt} env=${environmentId} release=${releaseId} sha=${input.approvedSha} manifest=${input.manifestDigest} auto_deploy_evidence=${evidenceId} auto_deploy_sha256=${input.evidenceSha256}`;
}

export function verifyEnvironmentSnapshot({ environment, branchPolicies, expected }) {
  const fail = message => deny('UNSAFE_ENVIRONMENT', message);
  if (!environment || String(environment.id) !== String(expected?.id) || environment.name !== expected?.name) {
    fail('the Environment identity does not match the current release');
  }
  if (environment.can_admins_bypass !== false) fail('Environment administrative bypass must be disabled');
  if (environment.deployment_branch_policy?.protected_branches !== false
    || environment.deployment_branch_policy?.custom_branch_policies !== true) {
    fail('Environment must use a main-only custom deployment branch policy');
  }
  const reviewerRules = (environment.protection_rules ?? []).filter(rule => rule?.type === 'required_reviewers');
  if (reviewerRules.length !== 1) fail('Environment must have exactly one required-reviewers rule');
  const rule = reviewerRules[0];
  const reviewers = rule?.reviewers ?? [];
  if (rule?.prevent_self_review !== false
    || reviewers.length !== 1
    || reviewers[0]?.type !== 'User'
    || reviewers[0]?.reviewer?.login !== expected?.owner) {
    fail('Environment reviewer must be the sole owner with self-review enabled');
  }
  const policies = flattenCompletePages(branchPolicies, 'UNSAFE_ENVIRONMENT', 'Environment branch-policy');
  if (policies.length !== 1 || policies[0]?.name !== expected?.branch) {
    fail('Environment must allow deployments from main only');
  }
  return true;
}

export function verifyApprovalHistory({
  approvals,
  expectedToken,
  owner,
  environmentId,
  environmentName,
  expectedRunId,
  expectedRunAttempt,
}) {
  const records = flattenCompletePages(approvals, 'INCOMPLETE_APPROVAL_HISTORY', 'deployment approval');
  if (String(approvals.sourceRunId) !== String(expectedRunId)
    || Number(approvals.sourceRunAttempt) !== Number(expectedRunAttempt)) {
    deny('INVALID_CURRENT_APPROVAL', 'approval evidence was not fetched for the current workflow attempt');
  }
  const matching = records.filter(record => {
    const environments = Array.isArray(record?.environments) ? record.environments : [];
    return record?.state === 'approved'
      && record?.comment === expectedToken
      && record?.user?.login === owner
      && environments.length === 1
      && String(environments[0]?.id) === String(environmentId)
      && environments[0]?.name === environmentName;
  });
  if (matching.length !== 1 || records.length !== 1) {
    deny('INVALID_CURRENT_APPROVAL', 'exactly one owner approval bound to the current attempt is required');
  }
  return true;
}

export function verifyAutoDeployEvidence({
  evidence,
  approval,
  now,
  maxAgeSeconds = 900,
  maxFutureSkewSeconds = 60,
}) {
  const validEvidence = evidence
    && evidence.state === 'off'
    && evidence.redacted === true
    && evidence.source === 'owner-dashboard'
    && evidence.id === approval?.evidenceId
    && /^[0-9a-f]{64}$/.test(evidence.sha256 ?? '')
    && evidence.sha256 === approval?.evidenceSha256
    && evidence.project_ref === approval?.projectRef
    && evidence.production_branch === approval?.productionBranch
    && evidence.observed_by === approval?.owner;
  if (!validEvidence) deny('INVALID_AUTO_DEPLOY_EVIDENCE', 'auto-deploy evidence does not match the owner-approved project binding');
  const observedAt = Date.parse(evidence.observed_at);
  const nowAt = Date.parse(now);
  if (!Number.isFinite(observedAt) || !Number.isFinite(nowAt)) {
    deny('INVALID_AUTO_DEPLOY_EVIDENCE', 'auto-deploy evidence timestamps are invalid');
  }
  const ageSeconds = (nowAt - observedAt) / 1000;
  if (ageSeconds > maxAgeSeconds) deny('STALE_AUTO_DEPLOY_EVIDENCE', 'auto-deploy evidence has expired');
  if (ageSeconds < -maxFutureSkewSeconds) deny('FUTURE_AUTO_DEPLOY_EVIDENCE', 'auto-deploy evidence is too far in the future');
  return true;
}

export function verifyConcurrency({ runs, currentRunId, complete }) {
  const envelope = complete === undefined ? runs : { pages: runs, complete };
  const records = flattenCompletePages(envelope, 'INCOMPLETE_RUN_HISTORY', 'workflow run');
  const active = new Set(['in_progress', 'pending', 'queued', 'requested', 'waiting']);
  if (records.some(run => active.has(run?.status) && String(run?.id) !== String(currentRunId))) {
    deny('CONCURRENT_RELEASE', 'another production release workflow is active');
  }
  return true;
}

export function requiredSecretsForMode(mode, secrets) {
  if (mode === 'plan_only' || mode === 'gate_proof') return [];
  if (mode !== 'release') deny('INVALID_MODE', 'unsupported release mode');
  const required = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'];
  const missing = required.filter(name => typeof secrets?.[name] !== 'string' || secrets[name].length === 0);
  if (missing.length > 0) deny('MISSING_SECRETS', 'required Environment deployment secrets are unavailable', { missing });
  return required;
}

function assertCompleteBaselineSection(section, label, { arrayKey } = {}) {
  if (!section || section.complete !== true || (arrayKey && !Array.isArray(section[arrayKey]))) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', `${label} evidence is incomplete`);
  }
}

function baselineEvidencePayload(evidence) {
  const { evidence_sha256: ignored, verification: ignoredVerification, ...payload } = evidence;
  return payload;
}

function assertBaselineEvidenceDigest(evidence) {
  if (!evidence || !/^[0-9a-f]{64}$/.test(evidence.evidence_sha256 ?? '')) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'baseline evidence digest is missing');
  }
  const actual = sha256Hex(canonicalJson(baselineEvidencePayload(evidence)));
  if (actual !== evidence.evidence_sha256) deny('BASELINE_EVIDENCE_MISMATCH', 'baseline evidence bytes do not match their digest');
}

export function buildBaselineEvidence(snapshot) {
  if (!snapshot || (snapshot.source !== undefined && snapshot.source !== 'owner-control-plane') || snapshot.workflow_runtime === true) {
    deny('INVALID_BASELINE_AUTHORITY', 'baseline evidence must come from the owner control plane outside a workflow runtime');
  }
  if (snapshot.complete !== true
    || snapshot.source !== 'owner-control-plane'
    || snapshot.workflow_runtime !== false
    || !SHA_PATTERN.test(snapshot.candidate_sha ?? '')
    || typeof snapshot.project_ref !== 'string'
    || !Number.isFinite(Date.parse(snapshot.observed_at))
    || !/^[0-9a-f]{64}$/.test(snapshot.reviewed_policy_sha256 ?? '')) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', 'baseline identity evidence is incomplete');
  }
  assertCompleteBaselineSection(snapshot.migrations, 'migration', { arrayKey: 'items' });
  assertCompleteBaselineSection(snapshot.functions, 'function', { arrayKey: 'managed' });
  if (!Array.isArray(snapshot.functions.unmanaged)) deny('INCOMPLETE_BASELINE_EVIDENCE', 'unmanaged function inventory is incomplete');
  assertCompleteBaselineSection(snapshot.config, 'config and verify_jwt', { arrayKey: 'managed_functions' });
  assertCompleteBaselineSection(snapshot.cron_security, 'cron and security', { arrayKey: 'cron' });
  assertCompleteBaselineSection(snapshot.finance, 'finance');
  assertCompleteBaselineSection(snapshot.health, 'project health');
  const prior = snapshot.prior_release;
  if (!prior || !['bootstrap', 'post-release'].includes(prior.kind)
    || !/^[0-9a-f]{64}$/.test(prior.postcheck_evidence_sha256 ?? '')
    || (prior.kind === 'post-release' && (!RELEASE_ID_PATTERN.test(prior.release_id ?? '')
      || !/^[0-9a-f]{64}$/.test(prior.manifest_sha256 ?? '')))) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', 'prior release authority evidence is incomplete');
  }
  const managed = [...snapshot.functions.managed].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unmanaged = [...snapshot.functions.unmanaged].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const blockedResources = managed.filter(item => item.source_parity !== true).map(item => item.name).sort();
  const digestOf = value => sha256Hex(canonicalJson(value));
  const payload = {
    schema_version: 1,
    complete: true,
    source: snapshot.source,
    observed_at: snapshot.observed_at,
    project_ref: snapshot.project_ref,
    candidate_sha: snapshot.candidate_sha,
    workflow_runtime: false,
    reviewed_policy_sha256: snapshot.reviewed_policy_sha256,
    migrations: {
      count: snapshot.migrations.items.length,
      latest: snapshot.migrations.latest,
      items: [...snapshot.migrations.items],
    },
    functions: { managed, unmanaged },
    config: snapshot.config,
    cron_security: snapshot.cron_security,
    finance: snapshot.finance,
    health: snapshot.health,
    prior_release: prior,
    blocked_resources: blockedResources,
    digests: {
      migrations: digestOf(snapshot.migrations.items),
      managed_functions: digestOf(managed.map(item => ({ name: item.name, version: item.version, verify_jwt: item.verify_jwt }))),
      unmanaged_functions: digestOf(unmanaged),
      function_source_parity: digestOf(managed.map(item => ({ name: item.name, source_sha256: item.source_sha256, source_parity: item.source_parity }))),
      config_verify_jwt: digestOf(snapshot.config),
      cron_security: digestOf(snapshot.cron_security),
      finance: digestOf(snapshot.finance),
    },
  };
  return { ...payload, evidence_sha256: digestOf(payload) };
}

export function verifyBaselineEvidence({ candidate, evidence, expected }) {
  assertBaselineEvidenceDigest(evidence);
  if (candidate?.state !== 'candidate'
    || candidate.sha !== expected?.sha
    || evidence.complete !== true
    || evidence.source !== 'owner-control-plane'
    || evidence.workflow_runtime !== false
    || evidence.project_ref !== expected?.projectRef
    || evidence.candidate_sha !== expected?.sha
    || evidence.migrations?.count !== expected?.migrationCount
    || evidence.migrations?.latest !== expected?.latestMigration
    || evidence.health?.complete !== true
    || evidence.health?.status !== 'ACTIVE_HEALTHY') {
    deny('BASELINE_EVIDENCE_MISMATCH', 'baseline identity, migration, or project-health evidence does not match');
  }
  const managedNames = (evidence.functions?.managed ?? []).map(item => item.name).sort();
  const expectedManaged = [...(expected?.managedFunctions ?? [])].sort();
  if (managedNames.length !== expectedManaged.length
    || managedNames.some((name, index) => name !== expectedManaged[index])
    || managedNames.length + (evidence.functions?.unmanaged ?? []).length !== expected?.remoteFunctionCount) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'remote function inventory does not match the controlled scope');
  }
  if (canonicalJson(evidence.finance?.policy) !== canonicalJson(expected?.financePolicy)
    || evidence.finance?.premium_transaction_count !== 0
    || evidence.finance?.c2_attributed_bdag_movement !== 0) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'finance baseline does not match the disabled zero-activity bootstrap');
  }
  const reviewedPolicySha256 = expected?.reviewedPolicyBytes !== undefined
    ? sha256Hex(expected.reviewedPolicyBytes)
    : expected?.reviewedPolicySha256;
  if (!/^[0-9a-f]{64}$/.test(reviewedPolicySha256 ?? '')
    || evidence.reviewed_policy_sha256 !== reviewedPolicySha256) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'reviewed policy bytes do not match the independent digest');
  }
  return {
    ...evidence,
    verification: {
      state: 'verified',
      source: 'owner-control-plane',
      reviewed_policy_sha256: reviewedPolicySha256,
      evidence_sha256: evidence.evidence_sha256,
    },
  };
}

export function proposeVerifiedBaseline({ policy, evidence, owner, source = 'owner-control-plane' }) {
  if (owner !== 'andressan101989'
    || source !== 'owner-control-plane'
    || policy?.baseline_authority?.workflow_may_promote !== false
    || policy?.baseline_authority?.requires_separate_policy_commit !== true
    || evidence?.verification?.state !== 'verified'
    || evidence?.workflow_runtime !== false) {
    deny('INVALID_BASELINE_AUTHORITY', 'only the owner control plane may propose a separately committed baseline');
  }
  assertBaselineEvidenceDigest(evidence);
  const proposed = structuredClone(policy);
  proposed.baseline = {
    ...proposed.baseline,
    state: 'verified',
    sha: evidence.candidate_sha,
    migration_count: evidence.migrations.count,
    latest_migration: evidence.migrations.latest,
    evidence: evidence.evidence_sha256,
    evidence_digests: evidence.digests,
    blocked_resources: evidence.blocked_resources,
    reviewed_policy_sha256: evidence.reviewed_policy_sha256,
    prior_release: evidence.prior_release,
    verified_by: owner,
    verified_at: evidence.observed_at,
    authority_source: source,
    requires_separate_policy_commit: true,
  };
  const bytes = canonicalJson(proposed);
  return { bytes, digest: sha256Hex(bytes), policy: proposed };
}

const FINANCE_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'reversed']);
const FINANCE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'reversed']);
const FINANCE_ALLOWED_TRANSITIONS = new Set([
  'pending:processing',
  'pending:completed',
  'pending:failed',
  'pending:reversed',
  'processing:completed',
  'processing:failed',
  'processing:reversed',
]);

function uniqueRecords(records, label, code = 'INVALID_FINANCE_SNAPSHOT') {
  const map = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0 || map.has(record.id)) {
      deny(code, `${label} contains a missing or duplicate ID`);
    }
    map.set(record.id, record);
  }
  return map;
}

function compareWatermark(left, right) {
  const timestamp = String(left.created_at).localeCompare(String(right.created_at));
  return timestamp || String(left.id).localeCompare(String(right.id));
}

function financePolicyShape(policy) {
  return {
    purchase_enabled: policy?.purchase_enabled,
    subscription_enabled: policy?.subscription_enabled,
    refunds_enabled: policy?.refunds_enabled,
    platform_fee_bps: policy?.platform_fee_bps,
  };
}

export function validateFinanceSnapshot(snapshot) {
  if (!snapshot || snapshot.complete !== true || !Number.isFinite(Date.parse(snapshot.database_time))) {
    deny('INVALID_FINANCE_SNAPSHOT', 'finance snapshot identity is incomplete');
  }
  const policy = financePolicyShape(snapshot.policy);
  if (typeof policy.purchase_enabled !== 'boolean'
    || typeof policy.subscription_enabled !== 'boolean'
    || typeof policy.refunds_enabled !== 'boolean'
    || !Number.isInteger(policy.platform_fee_bps)) {
    deny('INVALID_FINANCE_SNAPSHOT', 'finance policy snapshot is malformed');
  }
  for (const [key, label] of [['transactions', 'transaction'], ['ledger_entries', 'ledger entry']]) {
    const inventory = snapshot[key];
    if (!inventory || inventory.complete !== true || !Array.isArray(inventory.items) || inventory.count !== inventory.items.length) {
      deny('INVALID_FINANCE_SNAPSHOT', `${label} inventory is incomplete`);
    }
    uniqueRecords(inventory.items, label);
  }
  const transactions = snapshot.transactions.items;
  const ordered = [...transactions].sort(compareWatermark);
  const last = ordered.at(-1);
  if ((!last && snapshot.watermark !== null)
    || (last && (!snapshot.watermark
      || snapshot.watermark.created_at !== last.created_at
      || snapshot.watermark.id !== last.id))) {
    deny('INVALID_FINANCE_SNAPSHOT', 'transaction watermark does not match the complete inventory');
  }
  const databaseTime = Date.parse(snapshot.database_time);
  for (const transaction of transactions) {
    if (!FINANCE_STATUSES.has(transaction.status)
      || transaction.currency !== 'BDAG'
      || !Number.isFinite(Date.parse(transaction.created_at))
      || Date.parse(transaction.created_at) > databaseTime) {
      deny('INVALID_FINANCE_SNAPSHOT', `transaction ${transaction.id} has invalid canonical fields`);
    }
  }
  return true;
}

function decimalUnits(value) {
  const text = String(value);
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,18}))?$/.exec(text);
  if (!match) deny('FINANCE_RECONCILIATION_FAILED', `invalid numeric value ${text}`);
  const units = BigInt(`${match[2]}${(match[3] ?? '').padEnd(18, '0')}`);
  return match[1] ? -units : units;
}

function withoutTransitionFields(transaction) {
  const { status: ignoredStatus, blockchain_txid: ignoredBlockchain, ...stable } = transaction;
  return stable;
}

function containsReleaseIdentity(value, releaseIdentity) {
  const forbidden = [releaseIdentity?.releaseId, releaseIdentity?.runId].filter(Boolean).map(String);
  const visit = candidate => {
    if (typeof candidate === 'string') return forbidden.some(token => candidate.includes(token));
    if (Array.isArray(candidate)) return candidate.some(visit);
    if (candidate && typeof candidate === 'object') return Object.values(candidate).some(visit);
    return false;
  };
  return visit(value);
}

function assertBalancedTransaction(transaction, entries) {
  if (transaction.status !== 'completed') return;
  const debit = entries.filter(entry => entry.entry_type === 'debit');
  const credit = entries.filter(entry => entry.entry_type === 'credit');
  if (debit.length === 0 || credit.length === 0
    || entries.some(entry => !['debit', 'credit'].includes(entry.entry_type))) {
    deny('FINANCE_RECONCILIATION_FAILED', `transaction ${transaction.id} lacks canonical debit and credit legs`);
  }
  const debitTotal = debit.reduce((sum, entry) => sum + decimalUnits(entry.amount), 0n);
  const creditTotal = credit.reduce((sum, entry) => sum + decimalUnits(entry.amount), 0n);
  const amount = decimalUnits(transaction.amount);
  if (amount <= 0n || debitTotal !== amount || creditTotal !== amount
    || (transaction.from_account_id && !debit.some(entry => entry.account_id === transaction.from_account_id))
    || (transaction.to_account_id && !credit.some(entry => entry.account_id === transaction.to_account_id))) {
    deny('FINANCE_RECONCILIATION_FAILED', `transaction ${transaction.id} ledger legs do not reconcile`);
  }
}

export function classifyFinanceWindow({ before, after, transactions, ledgerEntries, releaseIdentity }) {
  validateFinanceSnapshot(before);
  validateFinanceSnapshot(after);
  if (!Array.isArray(transactions) || !Array.isArray(ledgerEntries)) deny('INVALID_FINANCE_WINDOW', 'finance window rows are incomplete');
  const queriedTransactions = uniqueRecords(transactions, 'window transaction', 'INVALID_FINANCE_WINDOW');
  const queriedLedger = uniqueRecords(ledgerEntries, 'window ledger entry', 'INVALID_FINANCE_WINDOW');
  if ([...queriedTransactions.values(), ...queriedLedger.values()].some(record => containsReleaseIdentity(record, releaseIdentity))) {
    deny('RELEASE_ATTRIBUTED_FINANCE', 'finance activity is attributed to the current release attempt');
  }
  const beforeTransactions = uniqueRecords(before.transactions.items, 'pre-snapshot transaction');
  const afterTransactions = uniqueRecords(after.transactions.items, 'post-snapshot transaction');
  const beforeLedger = uniqueRecords(before.ledger_entries.items, 'pre-snapshot ledger entry');
  const afterLedger = uniqueRecords(after.ledger_entries.items, 'post-snapshot ledger entry');
  for (const id of beforeTransactions.keys()) {
    if (!afterTransactions.has(id)) deny('HISTORICAL_FINANCE_MUTATION', `historical transaction ${id} disappeared`);
  }
  for (const [id, entry] of beforeLedger) {
    if (!afterLedger.has(id) || canonicalJson(afterLedger.get(id)) !== canonicalJson(entry)) {
      deny('HISTORICAL_FINANCE_MUTATION', `historical ledger entry ${id} changed`);
    }
  }
  const newIds = [];
  const transitionedIds = [];
  const changedIds = [];
  for (const [id, current] of afterTransactions) {
    const previous = beforeTransactions.get(id);
    if (!previous) {
      if (before.watermark && compareWatermark(current, before.watermark) <= 0) {
        deny('INVALID_FINANCE_WINDOW', `new transaction ${id} falls outside the complete pre-snapshot watermark`);
      }
      newIds.push(id);
      changedIds.push(id);
      continue;
    }
    if (canonicalJson(current) === canonicalJson(previous)) continue;
    if (FINANCE_TERMINAL_STATUSES.has(previous.status)
      || !FINANCE_ALLOWED_TRANSITIONS.has(`${previous.status}:${current.status}`)
      || canonicalJson(withoutTransitionFields(previous)) !== canonicalJson(withoutTransitionFields(current))) {
      deny('HISTORICAL_FINANCE_MUTATION', `historical transaction ${id} changed outside an allowed status confirmation`);
    }
    transitionedIds.push(id);
    changedIds.push(id);
  }
  const expectedChanged = [...changedIds].sort();
  const queriedIds = [...queriedTransactions.keys()].sort();
  if (canonicalJson(queriedIds) !== canonicalJson(expectedChanged)) {
    deny('INVALID_FINANCE_WINDOW', 'window transaction query does not equal the complete pre/post delta');
  }
  for (const id of queriedIds) {
    if (canonicalJson(queriedTransactions.get(id)) !== canonicalJson(afterTransactions.get(id))) {
      deny('INVALID_FINANCE_WINDOW', `window transaction ${id} does not match the post-snapshot row`);
    }
  }
  const newLedgerEntries = [...afterLedger.values()].filter(entry => !beforeLedger.has(entry.id));
  const expectedLedgerIds = newLedgerEntries.map(entry => entry.id).sort();
  if (canonicalJson([...queriedLedger.keys()].sort()) !== canonicalJson(expectedLedgerIds)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'window ledger query does not equal the complete pre/post delta');
  }
  for (const entry of newLedgerEntries) {
    if (canonicalJson(queriedLedger.get(entry.id)) !== canonicalJson(entry) || !changedIds.includes(entry.txn_id)) {
      deny('FINANCE_RECONCILIATION_FAILED', `ledger entry ${entry.id} is not tied to an eligible changed transaction`);
    }
  }
  for (const id of changedIds) {
    const transaction = afterTransactions.get(id);
    if (!FINANCE_STATUSES.has(transaction.status) || transaction.currency !== 'BDAG') {
      deny('FINANCE_RECONCILIATION_FAILED', `transaction ${id} has noncanonical status or currency`);
    }
    assertBalancedTransaction(transaction, newLedgerEntries.filter(entry => entry.txn_id === id));
  }
  return {
    integrity: 'PASS',
    new_transaction_ids: newIds.sort(),
    preexisting_confirmed_after_snapshot: transitionedIds.sort(),
    count_growth: {
      transactions: after.transactions.count - before.transactions.count,
      ledger_entries: after.ledger_entries.count - before.ledger_entries.count,
    },
    findings: [],
  };
}

function allReconciliationsZero(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every(allReconciliationsZero);
}

export function verifyFinancePostcheck({ before, after, window, reconciliationResults, expectedPolicy }) {
  validateFinanceSnapshot(before);
  validateFinanceSnapshot(after);
  if (canonicalJson(financePolicyShape(before.policy)) !== canonicalJson(expectedPolicy)
    || canonicalJson(financePolicyShape(after.policy)) !== canonicalJson(expectedPolicy)) {
    deny('FINANCE_POLICY_CHANGED', 'Premium Finance switches or platform fee changed');
  }
  if (window?.integrity !== 'PASS' || !allReconciliationsZero(reconciliationResults)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'canonical finance reconciliation reported a mismatch');
  }
  const growth = {
    transactions: after.transactions.count - before.transactions.count,
    ledger_entries: after.ledger_entries.count - before.ledger_entries.count,
  };
  if (growth.transactions < 0 || growth.ledger_entries < 0 || canonicalJson(growth) !== canonicalJson(window.count_growth)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'reported finance growth does not match complete snapshots');
  }
  return { integrity: 'PASS', count_growth: growth, concurrent_activity: growth.transactions > 0 || window.preexisting_confirmed_after_snapshot.length > 0 };
}

function parseCliArguments(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid CLI argument near ${flag ?? '<end>'}`);
    }
    values[flag.slice(2)] = value;
  }
  return { command, values };
}

function printHelp() {
  process.stdout.write('Usage: nelyon-production-release.mjs <plan|revalidate|verify-gate|postcheck> [options]\n');
}

async function runCli(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return 0;
  }
  const { command, values } = parseCliArguments(argv);
  if (command === 'revalidate') {
    for (const required of ['policy', 'request', 'bundle', 'compiler-sha256', 'remote-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const gitState = resolveGitState({
      cwd: process.cwd(),
      baselineSha: policy.baseline.sha,
      approvedSha: releaseRequest.approvedSha,
      expectedRepository: policy.repository,
      runGit: args => execFileSync('git', args, { cwd: process.cwd(), encoding: args.includes('-z') ? 'buffer' : 'utf8' }),
    });
    const evidence = JSON.parse(readFileSync(values['remote-evidence'], 'utf8'));
    if (canonicalJson(evidence.gitState?.changes ?? []) !== canonicalJson(gitState.changes)) {
      deny('POST_APPROVAL_DRIFT', 'regenerated Git delta differs from the approved plan');
    }
    const regenerated = buildManifest({ ...evidence, request: releaseRequest, policy, gitState });
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const verified = verifyManifestBundle({
      directory: resolve(values.bundle),
      expected: {
        approvedSha: releaseRequest.approvedSha,
        compilerSha256: values['compiler-sha256'],
        environmentName: policy.environment.name,
        manifestDigest: digest,
        releaseId: releaseRequest.releaseId,
        runAttempt: releaseRequest.runAttempt,
        runId: releaseRequest.runId,
      },
    });
    if (canonicalJson(regenerated) !== canonicalJson(verified.manifest)) {
      deny('POST_APPROVAL_DRIFT', 'regenerated manifest differs from the approved artifact');
    }
    const result = { schema_version: 1, result: 'REVALIDATED', manifest_sha256: digest, approved_sha: releaseRequest.approvedSha };
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`REVALIDATED ${digest}\n`);
    return 0;
  }
  if (command === 'postcheck') {
    for (const required of ['policy', 'request', 'pre-finance', 'post-finance', 'finance-window', 'reconciliation', 'remote-postcheck', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const remote = JSON.parse(readFileSync(values['remote-postcheck'], 'utf8'));
    if (remote?.complete !== true
      || remote.project_ref !== policy.supabase.project_ref
      || remote.health !== 'ACTIVE_HEALTHY'
      || remote.unexpected_deployments !== 0
      || remote.migrations_match !== true
      || remote.functions_match !== true
      || remote.cron_security_match !== true) {
      deny('REMOTE_POSTCHECK_FAILED', 'Supabase production postcheck evidence is incomplete or divergent');
    }
    const finance = verifyFinancePostcheck({
      before: JSON.parse(readFileSync(values['pre-finance'], 'utf8')),
      after: JSON.parse(readFileSync(values['post-finance'], 'utf8')),
      window: JSON.parse(readFileSync(values['finance-window'], 'utf8')),
      reconciliationResults: JSON.parse(readFileSync(values.reconciliation, 'utf8')),
      expectedPolicy: policy.supabase.finance_policy,
    });
    const result = {
      schema_version: 1,
      result: 'SUCCESS',
      release_id: releaseRequest.releaseId,
      approved_sha: releaseRequest.approvedSha,
      remote_postcheck_sha256: sha256Hex(canonicalJson(remote)),
      finance,
    };
    const bytes = canonicalJson(result);
    writeFileSync(resolve(values.output), bytes, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`POSTCHECK SUCCESS ${sha256Hex(bytes)}\n`);
    return 0;
  }
  if (command === 'verify-gate') {
    for (const required of ['policy', 'request', 'bundle', 'compiler-sha256', 'environment', 'branch-policies', 'approvals', 'auto-deploy-evidence', 'runs', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const verifiedBundle = verifyManifestBundle({
      directory: resolve(values.bundle),
      expected: {
        approvedSha: releaseRequest.approvedSha,
        compilerSha256: values['compiler-sha256'],
        environmentName: policy.environment.name,
        manifestDigest: digest,
        releaseId: releaseRequest.releaseId,
        runAttempt: releaseRequest.runAttempt,
        runId: releaseRequest.runId,
      },
    });
    const environment = JSON.parse(readFileSync(values.environment, 'utf8'));
    const branchPolicies = JSON.parse(readFileSync(values['branch-policies'], 'utf8'));
    verifyEnvironmentSnapshot({
      environment,
      branchPolicies,
      expected: {
        id: environment.id,
        name: policy.environment.name,
        owner: policy.owner,
        branch: policy.environment.protected_branch,
      },
    });
    const autoDeployEvidence = JSON.parse(readFileSync(values['auto-deploy-evidence'], 'utf8'));
    const approvalToken = buildApprovalToken({
      runId: releaseRequest.runId,
      runAttempt: releaseRequest.runAttempt,
      environmentId: environment.id,
      environmentName: environment.name,
      releaseId: releaseRequest.releaseId,
      approvedSha: releaseRequest.approvedSha,
      manifestDigest: verifiedBundle.digest,
      evidenceId: autoDeployEvidence.id,
      evidenceSha256: autoDeployEvidence.sha256,
    });
    const approvals = JSON.parse(readFileSync(values.approvals, 'utf8'));
    verifyApprovalHistory({
      approvals,
      expectedToken: approvalToken,
      owner: policy.owner,
      environmentId: environment.id,
      environmentName: environment.name,
      expectedRunId: releaseRequest.runId,
      expectedRunAttempt: releaseRequest.runAttempt,
    });
    verifyAutoDeployEvidence({
      evidence: autoDeployEvidence,
      approval: {
        evidenceId: autoDeployEvidence.id,
        evidenceSha256: autoDeployEvidence.sha256,
        projectRef: policy.supabase.project_ref,
        productionBranch: policy.default_branch,
        owner: policy.owner,
      },
      now: new Date().toISOString(),
      maxAgeSeconds: policy.evidence.auto_deploy_max_age_seconds,
      maxFutureSkewSeconds: policy.evidence.max_future_clock_skew_seconds,
    });
    verifyConcurrency({
      runs: JSON.parse(readFileSync(values.runs, 'utf8')),
      currentRunId: releaseRequest.runId,
    });
    requiredSecretsForMode(releaseRequest.mode, releaseRequest.mode === 'release' ? process.env : {});
    const proof = {
      schema_version: 1,
      result: 'GATE_VERIFIED',
      run_id: releaseRequest.runId,
      run_attempt: releaseRequest.runAttempt,
      environment: { id: environment.id, name: environment.name },
      release_id: releaseRequest.releaseId,
      approved_sha: releaseRequest.approvedSha,
      manifest_sha256: verifiedBundle.digest,
      auto_deploy_evidence: { id: autoDeployEvidence.id, sha256: autoDeployEvidence.sha256 },
      approval_token_sha256: sha256Hex(approvalToken),
    };
    writeFileSync(resolve(values.output), canonicalJson(proof), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`GATE VERIFIED ${verifiedBundle.digest}\n`);
    return 0;
  }
  if (command !== 'plan') throw new Error(`command ${command} is not implemented yet`);
  for (const required of ['policy', 'request', 'history', 'output']) {
    if (!values[required]) throw new Error(`missing --${required}`);
  }
  const policy = loadPolicy(values.policy);
  const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
  const evidence = values['remote-evidence']
    ? JSON.parse(readFileSync(values['remote-evidence'], 'utf8'))
    : compileLocalEvidence({ cwd: process.cwd(), policy, request: releaseRequest });
  if (values['evidence-output']) writeFileSync(resolve(values['evidence-output']), canonicalJson(evidence), { encoding: 'utf8', flag: 'wx' });
  const history = JSON.parse(readFileSync(values.history, 'utf8'));
  validateRequest(releaseRequest, policy);
  validateReleaseHistory({ releaseId: releaseRequest.releaseId, pages: history, policy });
  const manifest = buildManifest({ ...evidence, request: releaseRequest, policy });
  const bundle = writeManifestBundle({ manifest, outputDirectory: resolve(values.output) });
  process.stdout.write(`${manifest.result} ${bundle.digest}\n`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => {
      if (error instanceof GateDeniedError) {
        process.stderr.write(`DENY ${error.code}: ${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(`ERROR: ${error.message}\n`);
        process.exitCode = 1;
      }
    },
  );
}
