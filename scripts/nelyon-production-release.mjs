import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
