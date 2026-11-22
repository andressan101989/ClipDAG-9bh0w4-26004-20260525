import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

const HEX64 = /^[0-9a-f]{64}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const postgresCatalogEvidenceValues = new WeakMap();
const pgCronEvidenceValues = new WeakMap();
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEWED_POSTGRES_IMAGE_ID = 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
const REVIEWED_POSTGRES_IMAGE = `public.ecr.aws/supabase/postgres@${REVIEWED_POSTGRES_IMAGE_ID}`;
const REVIEWED_PROOF_ENV_KEYS = Object.freeze(['COMSPEC', 'HOME', 'LANG', 'LC_ALL',
  'LOCALAPPDATA', 'PATH', 'PATHEXT', 'PROGRAMDATA', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'TZ', 'USERPROFILE',
  'WINDIR']);
const REVIEWED_PROOF_FORBIDDEN_ENVIRONMENT = /^(?:[A-Z0-9]+_PROXY|BASH_ENV|DOCKER_CONTEXT|DOCKER_HOST|ENV|GITHUB_PATH|NODE_OPTIONS|NODE_PATH|npm(?:_|$))/iu;
const REVIEWED_DOCKER_BINARIES = Object.freeze({
  linux: '/usr/bin/docker',
  win32: 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
});
const REVIEWED_PROOF_RUNNERS = Object.freeze({
  catalog: Object.freeze({ path: 'scripts/prove-web-control-centers-b2-disposable.mjs',
    marker: 'B2_POSTGRES_CATALOG_CAPABILITY ' }),
  cron: Object.freeze({ path: 'scripts/prove-web-control-centers-b2-pg-cron-disposable.mjs',
    marker: 'B2_REAL_PG_CRON_CAPABILITY ' }),
});

export const B2_AUTHORITY_FUNCTION_SCOPE = Object.freeze([
  'private.create_media_post_as_actor_v1(uuid,text,text,text,uuid[])',
  'private.execute_publication_schedule_command_v1(text,uuid,bigint,uuid,timestampwithouttimezone,text,integer)',
  'private.fail_publication_claim_v1(private.publication_schedules,text,boolean)',
  'private.guard_media_asset_link_lifecycle_v1()',
  'private.guard_publication_schedule_audit_v1()',
  'private.lock_publication_draft_v1(uuid)',
  'private.publication_schedule_integrity_error_v1(private.publication_schedules)',
  'private.publication_schedule_json_v1(private.publication_schedules)',
  'private.publication_source_fingerprint_v1(public.media_assets)',
  'private.publication_target_fingerprint_v1(public.media_assets)',
  'private.publish_publication_draft_as_actor_v1(uuid,uuid,bigint,uuid,uuid[])',
  'private.require_publication_claim_v1(uuid,bigint,uuid,boolean,boolean)',
  'private.require_publication_service_v1()',
  'private.resolve_publication_schedule_time_v1(timestampwithouttimezone,text,integer)',
  'public.cancel_my_publication_schedule_v1(uuid,bigint,uuid)',
  'public.claim_publication_schedules_v1(integer)',
  'public.confirm_publication_schedule_item_v1(uuid,bigint,uuid,integer,bigint,text,text,text)',
  'public.create_carousel_post(text,text,uuid[])',
  'public.create_photo_post_with_media(text,text,uuid)',
  'public.delete_my_publication_draft_v1(uuid,bigint,uuid)',
  'public.fail_publication_schedule_v1(uuid,bigint,uuid,text,boolean)',
  'public.list_my_publication_schedules_v1(integer,timestampwithtimezone,uuid)',
  'public.prepare_publication_schedule_v1(uuid,bigint,uuid)',
  'public.publish_my_publication_draft_v1(uuid,bigint,uuid,uuid[])',
  'public.publish_publication_schedule_v1(uuid,bigint,uuid)',
  'public.reconcile_publication_schedules_v1(integer)',
  'public.reschedule_my_publication_v1(uuid,bigint,uuid,timestampwithouttimezone,text,integer)',
  'public.retry_my_publication_schedule_v1(uuid,bigint,uuid)',
  'public.schedule_my_publication_draft_v1(uuid,bigint,uuid,timestampwithouttimezone,text,integer)',
  'public.update_my_publication_draft_v1(uuid,bigint,uuid,text,text,text,jsonb,uuid[])',
  'public.wake_scheduled_publications_b2_v1()',
]);

export const B2_AUTHORITY_RELATION_SCOPE = Object.freeze([
  'private.publication_schedule_attempts',
  'private.publication_schedule_commands',
  'private.publication_schedule_materializations',
  'private.publication_schedule_policy',
  'private.publication_schedules',
  'public.media_asset_links',
  'public.media_assets',
]);

const scoped = (identity, relation) => Object.freeze({ identity, relation });
export const B2_AUTHORITY_POLICY_SCOPE = Object.freeze([
  scoped('public.media_asset_links.media_asset_links_owner_read', 'public.media_asset_links'),
  scoped('public.media_asset_links.media_asset_links_public_read', 'public.media_asset_links'),
  scoped('public.media_assets.media_assets_owner_read', 'public.media_assets'),
  scoped('public.media_assets.media_assets_public_read', 'public.media_assets'),
]);
export const B2_AUTHORITY_TRIGGER_SCOPE = Object.freeze([
  scoped('private.publication_schedule_attempts.publication_schedule_attempts_immutable', 'private.publication_schedule_attempts'),
  scoped('private.publication_schedule_commands.publication_schedule_commands_immutable', 'private.publication_schedule_commands'),
  scoped('public.media_asset_links.media_asset_links_guard_lifecycle_c1', 'public.media_asset_links'),
  scoped('public.media_asset_links.media_asset_links_guard_publication_draft', 'public.media_asset_links'),
  scoped('public.media_assets.media_assets_guard_ready_identity', 'public.media_assets'),
]);
export const B2_AUTHORITY_INDEX_SCOPE = Object.freeze([
  scoped('private.publication_schedule_attempts_pkey', 'private.publication_schedule_attempts'),
  scoped('private.publication_schedule_commands_pkey', 'private.publication_schedule_commands'),
  scoped('private.publication_schedule_materializations_pkey', 'private.publication_schedule_materializations'),
  scoped('private.publication_schedule_materializations_release_idx', 'private.publication_schedule_materializations'),
  scoped('private.publication_schedule_materializations_target_asset_id_key', 'private.publication_schedule_materializations'),
  scoped('private.publication_schedule_policy_pkey', 'private.publication_schedule_policy'),
  scoped('private.publication_schedules_active_draft_idx', 'private.publication_schedules'),
  scoped('private.publication_schedules_due_idx', 'private.publication_schedules'),
  scoped('private.publication_schedules_owner_id_publish_command_id_key', 'private.publication_schedules'),
  scoped('private.publication_schedules_owner_idx', 'private.publication_schedules'),
  scoped('private.publication_schedules_pkey', 'private.publication_schedules'),
  scoped('public.media_asset_links_asset_id_entity_type_entity_id_slot_posit_key', 'public.media_asset_links'),
  scoped('public.media_asset_links_entity_idx', 'public.media_asset_links'),
  scoped('public.media_asset_links_pkey', 'public.media_asset_links'),
  scoped('public.media_assets_bucket_name_object_key_key', 'public.media_assets'),
  scoped('public.media_assets_pkey', 'public.media_assets'),
  scoped('public.publication_draft_media_asset_uidx', 'public.media_asset_links'),
  scoped('public.publication_draft_media_position_uidx', 'public.media_asset_links'),
  scoped('public.publication_schedule_media_target_idx', 'public.media_asset_links'),
]);

export const B2_ADVISOR_CHANGED_OBJECT_IDENTITIES = Object.freeze([...new Set([
  ...B2_AUTHORITY_FUNCTION_SCOPE.map(identity => `function:${identity.replace(/\(.*$/u, '')}`),
  ...B2_AUTHORITY_RELATION_SCOPE.filter(identity => identity !== 'public.media_assets')
    .map(identity => `relation:${identity}`),
])].sort());

export const B2_AUTHORITY_EDGE_FUNCTION_SCOPE = Object.freeze([
  ['ai-handoff', false],
  ['cleanup-stale-media-uploads', false],
  ['content-safety-scan', true],
  ['create-media-upload', true],
  ['finalize-media-upload', true],
  ['get-media-url', true],
  ['process-scheduled-publications', false],
  ['video-semantic-index', true],
].map(([name, verifyJwt]) => Object.freeze({ name, verifyJwt })));

export const B2_ADVISOR_AUTHORIZATION_CONTRACT = Object.freeze({
  schemaVersion: 1,
  transitionId: 'web-control-centers-b2-scheduled-publishing-v1',
  allowedActions: Object.freeze(['replace', 'retain']),
  forbiddenActions: Object.freeze(['add', 'remove']),
  preservedFindingFields: Object.freeze([
    'fingerprint', 'identity', 'objectIdentity', 'objectSha256', 'severity', 'type',
  ]),
  forbiddenPostReleaseDeltas: Object.freeze([
    'added_finding', 'removed_finding', 'fingerprint', 'severity', 'resource_kind',
    'object_identity', 'object_sha256', 'duplicate_authorization', 'omitted_authorization',
    'missing_successor_catalog_coverage',
  ]),
  requiredChecks: Object.freeze([
    'prestate', 'successor_catalog', 'acl', 'source_parity', 'poststate', 'recovery',
  ]),
});

function fail() {
  const error = new Error('B2 authority preparation rejected');
  error.code = 'B2_AUTHORITY_PREPARATION_INVALID';
  error.stack = 'Error: B2 authority preparation rejected';
  throw Object.freeze(error);
}

function own(value, keys, array = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) !== array
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (FORBIDDEN.has(key) || !Object.hasOwn(descriptor, 'value')
      || (!descriptor.enumerable && !(array && key === 'length'))) fail();
  }
  const actual = Object.keys(descriptors);
  if (keys && (actual.length !== keys.length || actual.some(key => !keys.includes(key)))) fail();
  return descriptors;
}

function copy(value, state = { nodes: 0, seen: new Set() }, depth = 0) {
  if (++state.nodes > 50_000 || depth > 48) fail();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail(); return value; }
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value || Buffer.from(value, 'utf8').toString('utf8') !== value
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || Buffer.byteLength(value) > 1_000_000) fail();
    return value;
  }
  const array = Array.isArray(value);
  const descriptors = own(value, null, array);
  if (state.seen.has(value)) fail();
  state.seen.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      if (!Number.isSafeInteger(length) || length > 10_000 || Object.keys(descriptors).length !== length + 1) fail();
      return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(descriptors, index)) fail();
        return copy(descriptors[index].value, state, depth + 1);
      });
    }
    return Object.fromEntries(Object.keys(descriptors).map(key => [key, copy(descriptors[key].value, state, depth + 1)]));
  } finally { state.seen.delete(value); }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalB2AuthorityJson(value) { return JSON.stringify(normalize(copy(value))); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function domainHash(domain, value) {
  return sha256(Buffer.concat([Buffer.from(domain, 'utf8'), Buffer.from([0]), Buffer.from(canonicalB2AuthorityJson(value), 'utf8')]));
}
function record(kind, value) {
  const expectedCanonicalJson = canonicalB2AuthorityJson(value);
  return Object.freeze({ kind, identity: value.identity, expectedCanonicalJson,
    expectedSha256: sha256(Buffer.from(expectedCanonicalJson, 'utf8')) });
}
function advisorRecord(action, value) {
  const expectedCanonicalJson = canonicalB2AuthorityJson(value);
  return Object.freeze({ action, identity: value.identity, expectedCanonicalJson,
    expectedSha256: sha256(Buffer.from(expectedCanonicalJson, 'utf8')) });
}
function sortRecords(records) {
  records.sort((left, right) => {
    const a = `${left.kind}\0${left.identity}`, b = `${right.kind}\0${right.identity}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (let index = 1; index < records.length; index += 1) {
    if (`${records[index - 1].kind}\0${records[index - 1].identity}`
      === `${records[index].kind}\0${records[index].identity}`) fail();
  }
  return records;
}
function exactDigest(value) { if (typeof value !== 'string' || !HEX64.test(value)) fail(); return value; }
function exactSha(value) { if (typeof value !== 'string' || !SHA40.test(value)) fail(); return value; }

function text(value, pattern = /^.{1,16384}$/u) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}
function bool(value) { if (typeof value !== 'boolean') fail(); return value; }
function strings(value, empty = false, unique = true) {
  if (!Array.isArray(value) || (!empty && value.length < 1) || value.length > 64
    || value.some(item => typeof item !== 'string') || unique && new Set(value).size !== value.length) fail();
  return value;
}
function access(value) {
  own(value, ['anon', 'authenticated', 'public', 'service_role']);
  Object.values(value).forEach(bool);
  return value;
}
function acl(value, privileges) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) fail();
  let previous = null;
  for (const row of value) {
    own(row, ['grantee', 'privilege_type', 'is_grantable']);
    text(row.grantee); if (!privileges.includes(row.privilege_type)) fail(); bool(row.is_grantable);
    const identity = `${row.grantee}\0${row.privilege_type}`;
    if (previous !== null && identity <= previous) fail();
    previous = identity;
  }
  return value;
}
function catalogValue(kind, input) {
  const value = copy(input);
  const keys = {
    function: ['identity', 'execute', 'owner', 'securityDefiner', 'searchPath', 'definitionSha256'],
    relation: ['identity', 'rls', 'forceRls', 'owner', 'definitionSha256'],
    policy: ['identity', 'relation', 'command', 'roles', 'usingSha256', 'checkSha256'],
    trigger: ['identity', 'relation', 'functionIdentity', 'enabled', 'definitionSha256'],
    index: ['identity', 'relation', 'valid', 'ready', 'unique', 'definitionSha256'],
    cron_job: ['identity', 'schedule', 'commandSha256', 'database', 'username', 'active'],
  }[kind];
  own(value, keys);
  text(value.identity);
  if (kind === 'function') {
    bool(value.execute); text(value.owner); bool(value.securityDefiner); strings(value.searchPath); exactDigest(value.definitionSha256);
  } else if (kind === 'relation') {
    bool(value.rls); bool(value.forceRls); text(value.owner); exactDigest(value.definitionSha256);
  } else if (kind === 'policy') {
    text(value.relation); if (!['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(value.command)) fail();
    strings(value.roles); if (value.usingSha256 !== null) exactDigest(value.usingSha256);
    if (value.checkSha256 !== null) exactDigest(value.checkSha256);
  } else if (kind === 'trigger') {
    text(value.relation); text(value.functionIdentity); if (!['O', 'D', 'R', 'A'].includes(value.enabled)) fail();
    exactDigest(value.definitionSha256);
  } else if (kind === 'index') {
    text(value.relation); bool(value.valid); bool(value.ready); bool(value.unique); exactDigest(value.definitionSha256);
  } else {
    text(value.schedule); exactDigest(value.commandSha256); text(value.database); text(value.username); bool(value.active);
  }
  return value;
}
function exactIdentityRows(rows, expected, relation = false) {
  if (rows.length !== expected.length) fail();
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    if (rows[index].value.identity !== (relation ? wanted.identity : wanted)
      || relation && rows[index].value.relation !== wanted.relation) fail();
  }
}
function catalogRows(input) {
  if (!Array.isArray(input) || input.length !== 66) fail();
  const rows = input.map(row => {
    own(row, ['kind', 'value']);
    if (!['function', 'index', 'policy', 'relation', 'trigger'].includes(row.kind)) fail();
    return { kind: row.kind, value: catalogValue(row.kind, row.value) };
  });
  const keys = rows.map(row => `${row.kind}\0${row.value.identity}`);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1])) fail();
  exactIdentityRows(rows.filter(row => row.kind === 'function'), B2_AUTHORITY_FUNCTION_SCOPE);
  exactIdentityRows(rows.filter(row => row.kind === 'relation'), B2_AUTHORITY_RELATION_SCOPE);
  exactIdentityRows(rows.filter(row => row.kind === 'policy'), B2_AUTHORITY_POLICY_SCOPE, true);
  exactIdentityRows(rows.filter(row => row.kind === 'trigger'), B2_AUTHORITY_TRIGGER_SCOPE, true);
  exactIdentityRows(rows.filter(row => row.kind === 'index'), B2_AUTHORITY_INDEX_SCOPE, true);
  return rows;
}
function functionSecurityRows(input) {
  if (!Array.isArray(input) || input.length !== B2_AUTHORITY_FUNCTION_SCOPE.length) fail();
  return input.map((row, index) => {
    own(row, ['identity', 'owner', 'securityDefiner', 'searchPath', 'definitionSha256', 'acl', 'execute']);
    if (row.identity !== B2_AUTHORITY_FUNCTION_SCOPE[index]) fail();
    text(row.owner); bool(row.securityDefiner); strings(row.searchPath); exactDigest(row.definitionSha256);
    acl(row.acl, ['EXECUTE']); access(row.execute);
    return copy(row);
  });
}
function relationAclRows(input) {
  if (!Array.isArray(input) || input.length !== B2_AUTHORITY_RELATION_SCOPE.length) fail();
  return input.map((row, index) => {
    own(row, ['identity', 'owner', 'rls', 'forceRls', 'acl', 'access']);
    if (row.identity !== B2_AUTHORITY_RELATION_SCOPE[index]) fail();
    text(row.owner); bool(row.rls); bool(row.forceRls);
    acl(row.acl, ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']);
    access(row.access);
    return { identity: row.identity, acl: copy(row.acl), access: copy(row.access) };
  });
}
function capabilityCore(value) {
  const core = copy(value); delete core.capabilitySha256; return core;
}

function postgresCatalogEvidenceEnvelope(input) {
    own(input, ['schemaVersion', 'kind', 'result', 'mintEligibility', 'provenance', 'catalogRows',
      'functionSecurityRows', 'relationAclRows', 'capabilitySha256']);
    exactDigest(input.capabilitySha256);
    if (sha256(canonicalB2AuthorityJson(capabilityCore(input))) !== input.capabilitySha256
      || input.schemaVersion !== 1 || input.kind !== 'nelyon-b2-postgres-catalog-evidence-v1'
      || input.result !== 'VERIFIED' || input.mintEligibility !== 'CATALOG_COMPONENT_ONLY') fail();
    own(input.provenance, ['image', 'imageId', 'imageRepoDigest', 'imageOs', 'imageArchitecture', 'imagePlatform',
      'postgresMajor', 'database', 'migrationSha256', 'catalogSqlSha256', 'rpcSecuritySqlSha256',
      'relationAclSqlSha256', 'syntheticCronAuthorityExcluded', 'pgCronExtension']);
    if (input.provenance.image !== REVIEWED_POSTGRES_IMAGE || input.provenance.imageId !== REVIEWED_POSTGRES_IMAGE_ID
      || input.provenance.imageRepoDigest !== REVIEWED_POSTGRES_IMAGE || input.provenance.imageOs !== 'linux'
      || input.provenance.imageArchitecture !== 'amd64' || input.provenance.imagePlatform !== 'linux/amd64'
      || input.provenance.postgresMajor !== 17 || input.provenance.database !== 'b2concurrency'
      || input.provenance.syntheticCronAuthorityExcluded !== true || input.provenance.pgCronExtension !== false) fail();
    for (const key of ['migrationSha256', 'catalogSqlSha256', 'rpcSecuritySqlSha256', 'relationAclSqlSha256']) {
      exactDigest(input.provenance[key]);
    }
    const value = copy(input);
    catalogRows(value.catalogRows); functionSecurityRows(value.functionSecurityRows); relationAclRows(value.relationAclRows);
    return value;
}

function realPgCronEvidenceEnvelope(input) {
    own(input, ['schemaVersion', 'kind', 'result', 'mintEligibility', 'provenance', 'cronRecord', 'capabilitySha256']);
    exactDigest(input.capabilitySha256);
    if (sha256(canonicalB2AuthorityJson(capabilityCore(input))) !== input.capabilitySha256
      || input.schemaVersion !== 1 || input.kind !== 'nelyon-b2-real-pg-cron-evidence-v1'
      || input.result !== 'VERIFIED' || input.mintEligibility !== 'PRODUCTION_CRON_COMPONENT') fail();
    const provenance = input.provenance;
    own(provenance, ['image', 'imageId', 'imageRepoDigest', 'imageOs', 'imageArchitecture', 'imagePlatform',
      'pgCronVersion', 'effectiveRole', 'roleSuperuser', 'roleBypassRls', 'migrationSha256', 'activationSha256',
      'databaseNormalization']);
    if (provenance.image !== REVIEWED_POSTGRES_IMAGE || provenance.imageId !== REVIEWED_POSTGRES_IMAGE_ID
      || provenance.imageRepoDigest !== REVIEWED_POSTGRES_IMAGE || provenance.imageOs !== 'linux'
      || provenance.imageArchitecture !== 'amd64' || provenance.imagePlatform !== 'linux/amd64'
      || provenance.pgCronVersion !== '1.6.4' || provenance.effectiveRole !== 'postgres'
      || provenance.roleSuperuser !== false || provenance.roleBypassRls !== true) fail();
    exactDigest(provenance.migrationSha256); exactDigest(provenance.activationSha256);
    own(provenance.databaseNormalization, ['schemaVersion', 'contract', 'observed', 'normalized', 'exact']);
    if (canonicalB2AuthorityJson(provenance.databaseNormalization) !== canonicalB2AuthorityJson({
      schemaVersion: 1, contract: 'supabase-hosted-primary-database-v1', observed: 'postgres',
      normalized: 'postgres', exact: true,
    })) fail();
    const cron = catalogValue('cron_job', input.cronRecord);
    if (canonicalB2AuthorityJson(cron) !== canonicalB2AuthorityJson({
      active: true, commandSha256: sha256('select public.wake_scheduled_publications_b2_v1()'),
      database: 'postgres', identity: 'process-scheduled-publications-b2', schedule: '* * * * *', username: 'postgres',
    })) fail();
    return copy(input);
}

/** Validate the public PG17 proof envelope without minting a private capability. */
export function verifyB2PostgresCatalogEvidenceEnvelope(input) {
  try { postgresCatalogEvidenceEnvelope(input); return true; } catch { fail(); }
}

/** Validate the public real-pg_cron proof envelope without minting a private capability. */
export function verifyB2RealPgCronEvidenceEnvelope(input) {
  try { realPgCronEvidenceEnvelope(input); return true; } catch { fail(); }
}

function fixedReviewedRunnerPath(path) {
  const absolute = resolve(REPOSITORY_ROOT, ...path.split('/'));
  if (!absolute.startsWith(`${REPOSITORY_ROOT}\\`) && !absolute.startsWith(`${REPOSITORY_ROOT}/`)) fail();
  return absolute;
}

/** Build the closed, secret-free environment inherited by reviewed proof subprocesses. */
export function sanitizeB2ReviewedProofEnvironment(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)) fail();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output = {};
    for (const key of REVIEWED_PROOF_ENV_KEYS) {
      const descriptor = descriptors[key] ?? (key === 'PATH' ? descriptors.Path : undefined);
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string'
        || descriptor.value.includes('\0')) fail();
      output[key] = descriptor.value;
    }
    const dockerDescriptor = descriptors.NELYON_B2_DOCKER_BIN;
    if (!dockerDescriptor || !Object.hasOwn(dockerDescriptor, 'value')
      || typeof dockerDescriptor.value !== 'string' || dockerDescriptor.value.includes('\0')) fail();
    const expectedDocker = REVIEWED_DOCKER_BINARIES[process.platform];
    const pathApi = process.platform === 'win32' ? win32 : posix;
    if (!expectedDocker || dockerDescriptor.value !== expectedDocker || !pathApi.isAbsolute(expectedDocker)
      || pathApi.normalize(expectedDocker) !== expectedDocker
      || pathApi.basename(expectedDocker) !== (process.platform === 'win32' ? 'docker.exe' : 'docker')) fail();
    const dockerStat = lstatSync(expectedDocker);
    if (!dockerStat.isFile() || dockerStat.isSymbolicLink() || realpathSync(expectedDocker) !== expectedDocker
      || process.platform === 'linux' && (dockerStat.uid !== 0 || (dockerStat.mode & 0o022) !== 0)) fail();
    output.NELYON_B2_DOCKER_BIN = expectedDocker;
    output.CI = 'true';
    output.NO_COLOR = '1';
    output.NELYON_B2_REVIEWED_PROOF = '1';
    if (Object.keys(output).some(key => REVIEWED_PROOF_FORBIDDEN_ENVIRONMENT.test(key))) fail();
    return Object.freeze(output);
  } catch { fail(); }
}

function runReviewedProof(spec) {
  const runner = fixedReviewedRunnerPath(spec.path);
  const output = execFileSync(process.execPath, [runner, '--authority-evidence'], {
    cwd: REPOSITORY_ROOT, env: sanitizeB2ReviewedProofEnvironment(process.env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 128 * 1024 * 1024,
  });
  const matches = output.split(/\r?\n/u).filter(line => line.startsWith(spec.marker));
  if (matches.length !== 1 || matches[0].length <= spec.marker.length) fail();
  return JSON.parse(matches[0].slice(spec.marker.length));
}

/**
 * Execute the fixed reviewed PG17 and real-pg_cron proof runners, then mint
 * opaque in-process capabilities. No caller-provided JSON or digest crosses
 * this authority boundary.
 */
export function runB2ReviewedAuthorityEvidenceProofs() {
  try {
    const catalogValue = postgresCatalogEvidenceEnvelope(runReviewedProof(REVIEWED_PROOF_RUNNERS.catalog));
    const cronValue = realPgCronEvidenceEnvelope(runReviewedProof(REVIEWED_PROOF_RUNNERS.cron));
    const catalogEvidence = Object.freeze(Object.create(null));
    const pgCronEvidence = Object.freeze(Object.create(null));
    postgresCatalogEvidenceValues.set(catalogEvidence, catalogValue);
    pgCronEvidenceValues.set(pgCronEvidence, cronValue);
    return Object.freeze({ catalogEvidence, pgCronEvidence });
  } catch { fail(); }
}

/** Build the exact private successor catalog from both branded real components. */
export function normalizeB2SuccessorCatalogFromDisposableEvidence(input) {
  try {
    own(input, ['catalogEvidence', 'pgCronEvidence', 'functionInventory']);
    const catalogEvidence = postgresCatalogEvidenceValues.get(input.catalogEvidence);
    const pgCronEvidence = pgCronEvidenceValues.get(input.pgCronEvidence);
    if (!catalogEvidence || !pgCronEvidence
      || catalogEvidence.provenance.migrationSha256 !== pgCronEvidence.provenance.migrationSha256) fail();
    const base = catalogRows(catalogEvidence.catalogRows);
    const functionSecurity = functionSecurityRows(catalogEvidence.functionSecurityRows);
    const functionFacts = new Map(base.filter(row => row.kind === 'function').map(row => [row.value.identity, row.value]));
    const functions = functionSecurity.map(row => {
      const facts = functionFacts.get(row.identity);
      if (!facts || facts.owner !== row.owner || facts.securityDefiner !== row.securityDefiner
        || canonicalB2AuthorityJson(facts.searchPath) !== canonicalB2AuthorityJson(row.searchPath)
        || facts.definitionSha256 !== row.definitionSha256) fail();
      return { identity: row.identity, acl: row.acl, execute: row.execute };
    });
    const relations = relationAclRows(catalogEvidence.relationAclRows);
    const cron = catalogValue('cron_job', pgCronEvidence.cronRecord);
    const inventory = copy(input.functionInventory);
    if (inventory.length !== B2_AUTHORITY_EDGE_FUNCTION_SCOPE.length) fail();
    for (let index = 0; index < B2_AUTHORITY_EDGE_FUNCTION_SCOPE.length; index += 1) {
      const expected = B2_AUTHORITY_EDGE_FUNCTION_SCOPE[index];
      const item = inventory[index];
      own(item, ['identity', 'verifyJwt', 'sourceSha256', 'configSha256']);
      if (item.identity !== expected.name || item.verifyJwt !== expected.verifyJwt) fail();
      exactDigest(item.sourceSha256); exactDigest(item.configSha256);
    }
    const records = [
      ...base.map(row => record(row.kind, row.value)), record('cron_job', cron),
      ...functions.map(value => record('function_acl', value)),
      ...relations.map(value => record('relation_acl', value)),
      ...inventory.map(value => record('function_inventory', value)),
    ];
    if (records.length !== 113) fail();
    return Object.freeze({ schemaVersion: 1, records: Object.freeze(sortRecords(records)) });
  } catch { fail(); }
}

function baselineDigest(items) { return sha256(`${canonicalB2AuthorityJson(items)}\n`); }
function baselineItem(value) {
  own(value, ['fingerprint', 'level', 'resource_kind']);
  exactDigest(value.fingerprint);
  if (!['INFO', 'WARN', 'ERROR'].includes(value.level)) fail();
  text(value.resource_kind);
  return copy(value);
}
function parsedCatalog(catalog) {
  own(catalog, ['schemaVersion', 'records']);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.records)) fail();
  const rows = catalog.records.map(item => {
    own(item, ['kind', 'identity', 'expectedCanonicalJson', 'expectedSha256']);
    exactDigest(item.expectedSha256);
    if (sha256(item.expectedCanonicalJson) !== item.expectedSha256) fail();
    const value = JSON.parse(item.expectedCanonicalJson);
    if (value.identity !== item.identity || canonicalB2AuthorityJson(value) !== item.expectedCanonicalJson) fail();
    return { ...item, value };
  });
  if (rows.length !== 113) fail();
  const keys = rows.map(row => `${row.kind}\0${row.identity}`);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1])) fail();
  const exact = (kind, expected, relation = false) => {
    const selected = rows.filter(row => row.kind === kind);
    if (selected.length !== expected.length) fail();
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      if (selected[index].identity !== (relation ? wanted.identity : wanted)
        || relation && selected[index].value.relation !== wanted.relation) fail();
    }
  };
  exact('function', B2_AUTHORITY_FUNCTION_SCOPE);
  exact('function_acl', B2_AUTHORITY_FUNCTION_SCOPE);
  exact('relation', B2_AUTHORITY_RELATION_SCOPE);
  exact('relation_acl', B2_AUTHORITY_RELATION_SCOPE);
  exact('policy', B2_AUTHORITY_POLICY_SCOPE, true);
  exact('trigger', B2_AUTHORITY_TRIGGER_SCOPE, true);
  exact('index', B2_AUTHORITY_INDEX_SCOPE, true);
  const cron = rows.filter(row => row.kind === 'cron_job');
  if (cron.length !== 1 || canonicalB2AuthorityJson(cron[0].value) !== canonicalB2AuthorityJson({
    active: true, commandSha256: sha256('select public.wake_scheduled_publications_b2_v1()'),
    database: 'postgres', identity: 'process-scheduled-publications-b2', schedule: '* * * * *', username: 'postgres',
  })) fail();
  const inventory = rows.filter(row => row.kind === 'function_inventory');
  if (inventory.length !== B2_AUTHORITY_EDGE_FUNCTION_SCOPE.length) fail();
  for (let index = 0; index < inventory.length; index += 1) {
    const expected = B2_AUTHORITY_EDGE_FUNCTION_SCOPE[index];
    const value = inventory[index].value;
    own(value, ['identity', 'verifyJwt', 'sourceSha256', 'configSha256']);
    if (value.identity !== expected.name || value.verifyJwt !== expected.verifyJwt) fail();
    exactDigest(value.sourceSha256); exactDigest(value.configSha256);
  }
  return rows;
}
function successorsForObject(records, objectIdentity) {
  if (objectIdentity.startsWith('function:')) {
    const name = objectIdentity.slice('function:'.length);
    return records.filter(row => ['function', 'function_acl'].includes(row.kind)
      && row.identity.replace(/\(.*$/u, '') === name);
  }
  if (objectIdentity.startsWith('relation:')) {
    const name = objectIdentity.slice('relation:'.length);
    return records.filter(row => ['relation', 'relation_acl'].includes(row.kind) && row.identity === name
      || ['policy', 'trigger', 'index'].includes(row.kind) && row.value.relation === name);
  }
  return [];
}
function finding(value) {
  own(value, ['fingerprint', 'identity', 'objectIdentity', 'objectSha256', 'severity', 'type']);
  exactDigest(value.fingerprint); exactDigest(value.objectSha256);
  if (!['INFO', 'WARN', 'ERROR'].includes(value.severity) || value.identity !== `advisor:${value.fingerprint}`) fail();
  return copy(value);
}
function advisorOrigin(value) {
  own(value, ['repository', 'transitionId', 'reviewedSourceSha', 'reviewedSourceTreeSha', 'integrationBaseSha',
    'migration', 'changedObjectIdentities', 'contractSha256', 'verifierSha256', 'testsSha256']);
  if (value.repository !== 'andressan101989/ClipDAG-9bh0w4-26004-20260525'
    || value.transitionId !== B2_ADVISOR_AUTHORIZATION_CONTRACT.transitionId) fail();
  exactSha(value.reviewedSourceSha); exactSha(value.reviewedSourceTreeSha); exactSha(value.integrationBaseSha);
  exactDigest(value.contractSha256); exactDigest(value.verifierSha256); exactDigest(value.testsSha256);
  if (value.contractSha256 !== B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256) fail();
  own(value.migration, ['path', 'blob', 'sha256', 'byteLength']);
  if (value.migration.path !== 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql') fail();
  exactSha(value.migration.blob); exactDigest(value.migration.sha256);
  if (!Number.isSafeInteger(value.migration.byteLength) || value.migration.byteLength < 1) fail();
  if (!Array.isArray(value.changedObjectIdentities)
    || canonicalB2AuthorityJson(value.changedObjectIdentities)
      !== canonicalB2AuthorityJson(B2_ADVISOR_CHANGED_OBJECT_IDENTITIES)) fail();
  return copy(value);
}
function claimProjection(facts, successorRows, origin) {
  const successors = successorRows.map(row => ({ kind: row.kind, identity: row.identity, expectedSha256: row.expectedSha256 }))
    .sort((a, b) => `${a.kind}\0${a.identity}`.localeCompare(`${b.kind}\0${b.identity}`));
  const successorRecordsSha256 = sha256(canonicalB2AuthorityJson(successors));
  return {
    attestationSha256: domainHash('nelyon-b2-advisor-attestation-v1', {
      schemaVersion: 1, action: 'replace', finding: facts,
      successorRecords: successors, successorRecordsSha256,
    }),
    negativeEvidenceSha256: domainHash('nelyon-b2-advisor-negative-evidence-v1', {
      schemaVersion: 1, contract: B2_ADVISOR_AUTHORIZATION_CONTRACT,
      contractSha256: origin.contractSha256, verifierSha256: origin.verifierSha256, testsSha256: origin.testsSha256,
    }),
    originSha256: domainHash('nelyon-b2-advisor-origin-v1', {
      schemaVersion: 1, repository: origin.repository, transitionId: origin.transitionId,
      findingIdentity: facts.identity, reviewedSourceSha: origin.reviewedSourceSha,
      reviewedSourceTreeSha: origin.reviewedSourceTreeSha, integrationBaseSha: origin.integrationBaseSha,
      migration: origin.migration, changedObjectIdentities: origin.changedObjectIdentities,
      authorizationContractSha256: origin.contractSha256,
    }),
  };
}

export function computeB2AdvisorAuthorizations({ baselineItems, findings, successorCatalog, origin }) {
  try {
    if (!Array.isArray(baselineItems) || !Array.isArray(findings)) fail();
    const items = baselineItems.map(baselineItem); const facts = findings.map(finding); const context = advisorOrigin(origin);
    if (items.length !== facts.length || items.length > 1024) fail();
    const catalog = parsedCatalog(successorCatalog);
    items.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    facts.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    if (new Set(items.map(item => item.fingerprint)).size !== items.length
      || new Set(facts.map(item => item.fingerprint)).size !== facts.length) fail();
    const baselineSha256 = baselineDigest(items);
    const byFingerprint = new Map(items.map(item => [item.fingerprint, item]));
    const records = facts.map(item => {
      const baseline = byFingerprint.get(item.fingerprint);
      if (!baseline || baseline.level !== item.severity || baseline.resource_kind !== item.type) fail();
      const changed = context.changedObjectIdentities.includes(item.objectIdentity);
      const successors = changed ? successorsForObject(catalog, item.objectIdentity) : [];
      if (changed && successors.length === 0) fail();
      const action = changed ? 'replace' : 'retain';
      const value = action === 'replace' ? { ...item, ...claimProjection(item, successors, context) }
        : { ...item, baselineSha256 };
      return advisorRecord(action, value);
    });
    records.sort((left, right) => {
      const a = `${left.action}\0${left.identity}`, b = `${right.action}\0${right.identity}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.freeze({ schemaVersion: 2, baselineSha256, baselineItems: Object.freeze(items),
      records: Object.freeze(records) });
  } catch { fail(); }
}

export function verifyB2AdvisorAuthorizationClaims({ securityAdvisor, successorCatalog, origin }) {
  try {
    const factKeys = ['fingerprint', 'identity', 'objectIdentity', 'objectSha256', 'severity', 'type'];
    const expected = computeB2AdvisorAuthorizations({ baselineItems: securityAdvisor.baselineItems,
      findings: securityAdvisor.records.map(item => {
        const value = JSON.parse(item.expectedCanonicalJson);
        return Object.fromEntries(factKeys.map(key => [key, value[key]]));
      }), successorCatalog, origin });
    if (canonicalB2AuthorityJson(expected) !== canonicalB2AuthorityJson(securityAdvisor)) fail();
    return true;
  } catch { fail(); }
}

export function assertB2AdvisorPostState({ before, after, authorizations }) {
  try {
    const left = copy(before).map(finding).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    const right = copy(after).map(finding).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    if (canonicalB2AuthorityJson(left) !== canonicalB2AuthorityJson(right)) fail();
    const records = copy(authorizations);
    if (records.length !== left.length || records.some(item => !['retain', 'replace'].includes(item.action))) fail();
    const identities = records.map(item => item.identity);
    if (new Set(identities).size !== identities.length
      || canonicalB2AuthorityJson(identities.slice().sort()) !== canonicalB2AuthorityJson(left.map(item => item.identity).sort())) fail();
    return true;
  } catch { fail(); }
}

export const B2_ADVISOR_AUTHORIZATION_CONTRACT_SHA256 = domainHash(
  'nelyon-b2-advisor-contract-v1', B2_ADVISOR_AUTHORIZATION_CONTRACT,
);
