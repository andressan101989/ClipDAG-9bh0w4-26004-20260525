import { createHash } from 'node:crypto';

// Candidate only: never produces CLI-shaped evidence or grants release authority.
// Reconciliation semantics: supabase/cli v2.120.0 migration-pending.ts,
// default path only (no include-all, roles, seeds, vault or disabled migrations).
const PROJECT = 'aewwdlvbwpczqyvkwvvj';
const VERSION = /^20[0-9]{12}$/;
const PATH = /^supabase\/migrations\/(20[0-9]{12})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const reject = code => { throw new Error(code); };
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  reject('INVALID_JSON');
}

export function planReadOnlyMigrations({ projectRef, sourceSha, migrationsEnabled, localFiles, remoteRows, manifest }) {
  if (projectRef !== PROJECT) reject('PROJECT_MISMATCH');
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSha)) reject('SOURCE_SHA_INVALID');
  if (migrationsEnabled !== true) reject('MIGRATIONS_DISABLED_OR_UNKNOWN');
  if (!Array.isArray(localFiles)) reject('LOCAL_INVENTORY_INVALID');
  const local = localFiles.map(file => {
    const match = typeof file?.path === 'string' && file.path.match(PATH);
    if (!match || !(typeof file.content === 'string' || Buffer.isBuffer(file.content))) reject('LOCAL_INVENTORY_INVALID');
    return { path: file.path, version: match[1], sha256: digest(file.content) };
  }).sort((a,b) => a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
  if (new Set(local.map(f=>f.version)).size !== local.length) reject('LOCAL_INVENTORY_DUPLICATE');
  if (!Array.isArray(remoteRows)) reject('REMOTE_LEDGER_INVALID');
  const remote = remoteRows.map(row => {
    if (!row || Object.keys(row).length !== 1 || typeof row.version !== 'string' || !VERSION.test(row.version)) reject('REMOTE_LEDGER_INVALID');
    return row.version;
  });
  if (remote.some((version,i)=>i > 0 && remote[i-1] >= version)) reject('REMOTE_LEDGER_UNSORTED_OR_DUPLICATE');
  let i=0, j=0;
  const missing=[], unapplied=[];
  while (i < remote.length && j < local.length) {
    if (remote[i] === local[j].version) { i++; j++; }
    else if (remote[i] < local[j].version) missing.push(remote[i++]);
    else unapplied.push(local[j++].path);
  }
  if (j === local.length) missing.push(...remote.slice(i));
  if (missing.length) reject('MISSING_LOCAL');
  if (unapplied.length) reject('MISSING_REMOTE');
  const pending=local.slice(remote.length);
  if (manifest?.identity?.approved_sha !== sourceSha) reject('MANIFEST_SOURCE_SHA_MISMATCH');
  const declared=manifest?.resources?.migrations;
  if (!Array.isArray(declared) || declared.length !== pending.length) reject('MANIFEST_MISMATCH');
  const expected=[...declared].sort((a,b)=>String(a?.version).localeCompare(String(b?.version)));
  if (expected.some((item,index)=>item?.path !== pending[index].path || item?.version !== pending[index].version || item?.sha256 !== pending[index].sha256)) reject('MANIFEST_MISMATCH');
  return {
    source:'supabase-management-read-only-ledger-plan/v1',
    cli_version_semantics:'2.120.0',
    project_ref:projectRef, source_sha:sourceSha,
    deployment_authorized:false,
    pending_versions:pending.map(f=>f.version), pending_files:pending.map(f=>f.path),
    local_inventory_sha256:digest(canonical(local)),
    remote_ledger_sha256:digest(canonical(remote)),
    manifest_sha256:digest(canonical(manifest)),
  };
}
