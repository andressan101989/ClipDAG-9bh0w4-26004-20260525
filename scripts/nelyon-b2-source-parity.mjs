import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { publicAuthorityReceipt } from './nelyon-release-authority-context.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIGRATION_PATH = 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql';
const PRIVATE_RELATIONS = Object.freeze([
  'private.publication_schedule_attempts',
  'private.publication_schedule_commands',
  'private.publication_schedule_materializations',
  'private.publication_schedule_policy',
  'private.publication_schedules',
]);
const SERVICE_FUNCTIONS = new Set([
  'claim_publication_schedules_v1',
  'prepare_publication_schedule_v1',
  'confirm_publication_schedule_item_v1',
  'publish_publication_schedule_v1',
  'fail_publication_schedule_v1',
  'reconcile_publication_schedules_v1',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const reviewedTrees = new WeakMap();
const deployedInventories = new WeakMap();
const sourceParityValues = new WeakMap();
const byteLengthOf = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;

function reject() {
  const error = new Error('B2 source parity authority rejected');
  error.code = 'B2_SOURCE_PARITY_AUTHORITY_INVALID';
  error.stack = 'Error: B2 source parity authority rejected';
  throw Object.freeze(error);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizeJson(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(normalizeJson(value))}\n`;
}

function compactCanonical(value) {
  return JSON.stringify(normalizeJson(value));
}

function ownData(value, keys, array = false) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) !== array
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !Object.hasOwn(descriptor, 'value')
      || (!descriptor.enumerable && !(array && key === 'length'))) reject();
  }
  const actual = Object.keys(descriptors);
  if (keys && (actual.length !== keys.length || actual.some(key => !keys.includes(key)))) reject();
  return descriptors;
}

function copyJson(value, state = { nodes: 0, bytes: 0, seen: new Set() }, depth = 0) {
  if (++state.nodes > 50_000 || depth > 48) reject();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value);
    if (state.bytes > 4 * 1024 * 1024 || Buffer.from(value).toString('utf8') !== value) reject();
    return value;
  }
  const array = Array.isArray(value);
  const descriptors = ownData(value, null, array);
  if (state.seen.has(value)) reject();
  state.seen.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      if (length > 50_000 || Object.keys(descriptors).length !== length + 1) reject();
      const result = [];
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(descriptors, index)) reject();
        result.push(copyJson(descriptors[index].value, state, depth + 1));
      }
      return result;
    }
    return Object.fromEntries(Object.keys(descriptors)
      .map(key => [key, copyJson(descriptors[key].value, state, depth + 1)]));
  } finally {
    state.seen.delete(value);
  }
}

function copyBytes(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(value))) reject();
  const size = Reflect.apply(byteLengthOf, value, []);
  if (size < 1 || size > 2 * 1024 * 1024
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key))) reject();
  return Buffer.from(value);
}

function timestamp(value) {
  if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) reject();
  return value;
}

function pathValue(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')
    || /[\u0000-\u001f\u007f]/u.test(value)) reject();
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Trusted in-process reviewed-tree reader boundary. Bytes remain private in a
 * WeakMap and cannot be reconstructed from the closed returned projection. */
export function createTrustedB2ReviewedTree(input) {
  try {
    const data = ownData(input, ['approvedSha', 'files', 'functionConfigs']);
    const approvedSha = data.approvedSha.value;
    if (typeof approvedSha !== 'string' || !SHA40.test(approvedSha)) reject();
    const fileInputs = data.files.value;
    ownData(fileInputs, null, true);
    const files = new Map();
    for (const item of fileInputs) {
      const row = ownData(item, ['path', 'bytes']);
      const path = pathValue(row.path.value);
      if (files.has(path)) reject();
      files.set(path, copyBytes(row.bytes.value));
    }
    const configInputs = data.functionConfigs.value;
    ownData(configInputs, null, true);
    const configs = new Map();
    for (const item of configInputs) {
      const row = ownData(item, ['name', 'config']);
      const name = row.name.value;
      if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name) || configs.has(name)) reject();
      configs.set(name, copyJson(row.config.value));
    }
    const projection = deepFreeze({ schemaVersion: 1, approvedSha, fileCount: files.size,
      functionConfigCount: configs.size });
    reviewedTrees.set(projection, { approvedSha, files, configs });
    return projection;
  } catch { reject(); }
}

/** Trusted live function-inventory reader boundary. Only closed names/counts
 * are public; deployed package digests remain in the branded private state. */
export function createTrustedB2DeployedFunctionInventory(input) {
  try {
    const data = ownData(input, ['capturedAt', 'functions']);
    const capturedAt = timestamp(data.capturedAt.value);
    const rows = data.functions.value;
    ownData(rows, null, true);
    const functions = new Map();
    for (const item of rows) {
      const row = ownData(item, ['name', 'deployedSha256']);
      const name = row.name.value;
      const digest = row.deployedSha256.value;
      if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)
        || typeof digest !== 'string' || !HEX64.test(digest) || functions.has(name)) reject();
      functions.set(name, digest);
    }
    const names = [...functions.keys()].sort();
    const projection = deepFreeze({ schemaVersion: 1, capturedAt, count: names.length, names });
    deployedInventories.set(projection, { capturedAt, functions });
    return projection;
  } catch { reject(); }
}

function parseFunctions(migrationBytes) {
  const text = migrationBytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(migrationBytes)) reject();
  const typesMap = { timestamp: 'timestamp without time zone', timestamptz: 'timestamp with time zone' };
  // Closed PostgreSQL 17 deparser contract for this migration, not a general SQL
  // formatter. Unknown attributes/defaults/types fail closed. The independent
  // disposable PostgreSQL proof compares every complete definition byte-for-byte.
  const allowedTypes = new Set(['timestamp', 'timestamptz', 'text', 'integer', 'bigint', 'boolean',
    'uuid', 'uuid[]', 'jsonb', 'trigger', 'void', 'private.publication_schedules', 'public.media_assets']);
  const rows = [...text.matchAll(/create (?:or replace )?function (\w+)\.(\w+)\(([\s\S]*?)\)\s*returns([\s\S]*?)as \$function\$([\s\S]*?)\$function\$;/gi)]
    .map(match => {
      const [, schema, name, parameters, attributes, body] = match;
      const attrs = /^(setof\s+)?([a-z_.]+)\s+language\s+(sql|plpgsql)(?:\s+(stable|immutable))?(?:\s+security\s+(invoker|definer))?\s+set\s+search_path\s*=\s*(''|public)\s*$/.exec(attributes.trim().toLowerCase());
      if (!attrs || !allowedTypes.has(attrs[2]) || !['private', 'public'].includes(schema)) reject();
      const args = parameters.trim() ? parameters.trim().split(',').map(value => {
        const arg = /^([a-z_][a-z0-9_]*)\s+([a-z_.]+(?:\[\])?)(?:\s+default\s+(null|true|[0-9]+))?$/i.exec(value.trim());
        if (!arg || !allowedTypes.has(arg[2]) || arg[3] === 'true' && arg[2] !== 'boolean'
          || /^[0-9]+$/.test(arg[3] ?? '') && arg[2] !== 'integer') reject();
        return arg.slice(1);
      }) : [];
      const argumentTypes = args.map(([, type]) => typesMap[type] ?? type);
      const argumentSql = args.map(([argument, , defaultValue], index) => `${argument} ${argumentTypes[index]}${defaultValue === undefined ? ''
        : ` DEFAULT ${defaultValue.toLowerCase() === 'null' ? `NULL::${argumentTypes[index]}` : defaultValue}`}`).join(', ');
      const flags = [attrs[4]?.toUpperCase(), attrs[5] === 'definer' ? 'SECURITY DEFINER' : null].filter(Boolean);
      const definition = `CREATE OR REPLACE FUNCTION ${schema}.${name}(${argumentSql})\n RETURNS ${attrs[1] ? 'SETOF ' : ''}${typesMap[attrs[2]] ?? attrs[2]}\n LANGUAGE ${attrs[3]}\n${flags.length ? ` ${flags.join(' ')}\n` : ''} SET search_path TO '${attrs[6] === 'public' ? 'public' : ''}'\nAS $function$${body.replace(/\r\n?/g, '\n')}$function$\n`;
      const role = schema === 'private' ? null : SERVICE_FUNCTIONS.has(name) ? 'service_role' : 'authenticated';
      const acl = ['postgres', ...(role ? [role] : [])].sort()
        .map(grantee => ({ grantee, privilege_type: 'EXECUTE', is_grantable: false }));
      return {
        schema,
        name,
        identity_arguments: args.map(([argument], index) => `${argument} ${argumentTypes[index]}`).join(', '),
        argument_types: argumentTypes,
        security_definer: /security\s+definer/i.test(attributes),
        owner: 'postgres',
        search_path: [/set\s+search_path\s*=\s*public/i.test(attributes) ? 'search_path=public' : 'search_path=""'],
        acl,
        execute: { public: false, anon: false, authenticated: role === 'authenticated',
          service_role: role === 'service_role' },
        definition_sha256: sha256(definition),
      };
    });
  if (rows.length !== 30) reject();
  const identity = row => `${row.schema}.${row.name}(${row.argument_types.join(',').replaceAll(' ', '')})`;
  rows.sort((left, right) => identity(left).localeCompare(identity(right)));
  if (new Set(rows.map(identity)).size !== 30) reject();
  return { rows, identity, text };
}

function compileDatabaseFunctions(migrationBytes, authority) {
  const { rows, identity } = parseFunctions(migrationBytes);
  const records = authority.successorCatalog.records.filter(record => record.kind === 'function');
  const aclRecords = authority.successorCatalog.records.filter(record => record.kind === 'function_acl');
  if (records.length !== 30 || aclRecords.length !== records.length) reject();
  const inherited = new Set(['public.create_photo_post_with_media', 'public.create_carousel_post',
    'public.update_my_publication_draft_v1', 'public.delete_my_publication_draft_v1', 'public.publish_my_publication_draft_v1']);
  for (const row of rows) {
    const id = identity(row);
    const record = records.find(candidate => candidate.identity === id);
    const aclRecord = aclRecords.find(candidate => candidate.identity === id);
    if (!aclRecord) reject();
    const security = JSON.parse(aclRecord.expectedCanonicalJson);
    if (!inherited.has(`${row.schema}.${row.name}`)
      && (compactCanonical(security.acl) !== compactCanonical(row.acl)
        || compactCanonical(security.execute) !== compactCanonical(row.execute))) reject();
    row.acl = [...security.acl].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    row.execute = security.execute;
    const projection = { identity: id, owner: row.owner, securityDefiner: row.security_definer,
      searchPath: row.search_path, execute: row.execute.authenticated, definitionSha256: row.definition_sha256 };
    if (!record || record.expectedCanonicalJson !== compactCanonical(projection)
      || record.expectedSha256 !== sha256(record.expectedCanonicalJson)) reject();
  }
  return rows;
}

function compileDatabaseRelations(migrationBytes, authority) {
  const text = migrationBytes.toString('utf8');
  const records = authority.successorCatalog.records.filter(record => record.kind === 'relation');
  const aclRecords = authority.successorCatalog.records.filter(record => record.kind === 'relation_acl');
  if (aclRecords.length !== records.length) reject();
  const rows = records.map(record => {
    let projection;
    try { projection = JSON.parse(record.expectedCanonicalJson); } catch { reject(); }
    if (compactCanonical(projection) !== record.expectedCanonicalJson
      || record.expectedSha256 !== sha256(record.expectedCanonicalJson)
      || record.identity !== projection.identity) reject();
    const [schema, name] = record.identity.split('.');
    if (!schema || !name || schema === 'private' && PRIVATE_RELATIONS.includes(record.identity)
      && (!new RegExp(`create table private\\.${name}\\s*\\(`, 'i').test(text)
        || !new RegExp(`alter table private\\.${name} enable row level security`, 'i').test(text)
        || !new RegExp(`alter table private\\.${name} force row level security`, 'i').test(text))) reject();
    const aclRecord = aclRecords.find(item => item.identity === record.identity);
    if (!aclRecord) reject();
    const security = JSON.parse(aclRecord.expectedCanonicalJson);
    const row = { ...projection, access: security.access, acl: security.acl };
    const privateAcl = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false }));
    if (PRIVATE_RELATIONS.includes(record.identity)
      && (projection.owner !== 'postgres' || projection.rls !== true || projection.forceRls !== true
        || Object.values(row.access).some(Boolean)
        || compactCanonical(row.acl) !== compactCanonical(privateAcl))) reject();
    return row;
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  if (PRIVATE_RELATIONS.some(identity => !rows.some(row => row.identity === identity))) reject();
  return rows;
}

function compileAdvisors(authority) {
  return authority.securityAdvisor.records.filter(record => record.action !== 'remove').map(record => {
    let value;
    try { value = JSON.parse(record.expectedCanonicalJson); } catch { reject(); }
    ownData(value, ['attestationSha256', 'fingerprint', 'identity', 'negativeEvidenceSha256',
      'objectSha256', 'originSha256', 'severity', 'type']);
    if (compactCanonical(value) !== record.expectedCanonicalJson
      || record.expectedSha256 !== sha256(record.expectedCanonicalJson)
      || ![value.attestationSha256, value.fingerprint, value.negativeEvidenceSha256, value.originSha256]
        .every(item => typeof item === 'string' && HEX64.test(item))) reject();
    return { fingerprint: value.fingerprint, attestationSha256: value.attestationSha256,
      negativeEvidenceSha256: value.negativeEvidenceSha256, originSha256: value.originSha256 };
  }).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

// Pre-mutation source check, independent of any deployed successor inventory.
// The host provides reviewed bytes; the private context independently binds
// their exact public descriptor and migration digests. Nothing is emitted.
export function verifyB2DatabaseSourcePreflight(input) {
  try {
    const data = ownData(input, ['authorityContext', 'manifest', 'descriptorBytes', 'migrationBytes']);
    const context = data.authorityContext.value;
    publicAuthorityReceipt(context);
    assertB2CatalogSecurityCoverage(context);
    const manifest = copyJson(data.manifest.value);
    const migration = copyBytes(data.migrationBytes.value);
    const expected = context.descriptor.contract.productive_changes?.at(-1);
    if (sha256(copyBytes(data.descriptorBytes.value)) !== context.descriptorSha256
      || manifest?.identity?.approved_sha !== context.descriptor.contract.reviewed_source_sha
      || expected?.path !== MIGRATION_PATH || sha256(migration) !== expected.sha256
      || manifest?.resources?.migrations?.length !== 1
      || manifest.resources.migrations[0].path !== MIGRATION_PATH
      || manifest.resources.migrations[0].sha256 !== expected.sha256) reject();
    compileDatabaseFunctions(migration, context.privateAuthority);
    compileDatabaseRelations(migration, context.privateAuthority);
    return true;
  } catch { reject(); }
}

export function assertB2CatalogSecurityCoverage(authorityContext) {
  try {
    publicAuthorityReceipt(authorityContext);
    const records = authorityContext.privateAuthority.successorCatalog.records;
    for (const kind of ['function', 'relation']) {
      const identities = records.filter(row => row.kind === kind).map(row => row.identity).sort();
      const companions = records.filter(row => row.kind === `${kind}_acl`).map(row => row.identity).sort();
      if (new Set(identities).size !== identities.length || new Set(companions).size !== companions.length
        || canonicalJson(identities) !== canonicalJson(companions)) reject();
    }
    return true;
  } catch { reject(); }
}

export function compileB2SourceParity(input) {
  try {
    const data = ownData(input, ['authorityContext', 'manifest', 'descriptorBytes', 'reviewedTree',
      'deployedFunctionInventory', 'capturedAt']);
    const authorityContext = data.authorityContext.value;
    publicAuthorityReceipt(authorityContext);
    const reviewed = reviewedTrees.get(data.reviewedTree.value);
    const deployed = deployedInventories.get(data.deployedFunctionInventory.value);
    if (!reviewed || !deployed) reject();
    const capturedAt = timestamp(data.capturedAt.value);
    if (capturedAt !== deployed.capturedAt) reject();
    const descriptorBytes = copyBytes(data.descriptorBytes.value);
    if (sha256(descriptorBytes) !== authorityContext.descriptorSha256) reject();
    const manifest = copyJson(data.manifest.value);
    if (reviewed.approvedSha !== manifest?.identity?.approved_sha
      || reviewed.approvedSha !== authorityContext.descriptor.contract.reviewed_source_sha) reject();
    const productive = authorityContext.descriptor.contract.productive_changes;
    const migrationContract = productive?.at(-1);
    const migration = reviewed.files.get(migrationContract?.path);
    if (!migration || migrationContract.path !== MIGRATION_PATH || !HEX64.test(migrationContract.sha256)
      || sha256(migration) !== migrationContract.sha256) reject();
    const manifestMigration = manifest?.resources?.migrations;
    if (!Array.isArray(manifestMigration) || manifestMigration.length !== 1
      || manifestMigration[0].path !== migrationContract.path
      || manifestMigration[0].sha256 !== migrationContract.sha256) reject();
    const expectedFunctions = authorityContext.descriptor.contract.functions ?? [];
    const contracts = manifest?.resources?.function_contracts;
    if (!Array.isArray(contracts) || contracts.length !== expectedFunctions.length
      || deployed.functions.size !== expectedFunctions.length || reviewed.configs.size !== expectedFunctions.length) reject();
    const functions = expectedFunctions.map(expected => {
      const contract = contracts.find(candidate => candidate.name === expected.name);
      if (!contract || contract.verify_jwt !== expected.verify_jwt || contract.source_sha256 !== expected.source_sha256
        || !Array.isArray(contract.source_files) || contract.source_files.length < 1) reject();
      const sourceFiles = contract.source_files.map(file => {
        const bytes = reviewed.files.get(file.path);
        if (!bytes || sha256(bytes) !== file.sha256) reject();
        return { path: file.path, sha256: file.sha256 };
      });
      if (sha256(canonicalJson({ entrypoint: contract.entrypoint, import_map: contract.import_map,
        source_files: sourceFiles })) !== expected.source_sha256) reject();
      const config = reviewed.configs.get(expected.name);
      if (!config || sha256(canonicalJson(config)) !== expected.config_sha256
        || config.verify_jwt !== expected.verify_jwt) reject();
      const deployedSha256 = deployed.functions.get(expected.name);
      if (!deployedSha256) reject();
      return { identity: expected.name, deployedSha256, sourceSha256: expected.source_sha256,
        configSha256: expected.config_sha256, verifyJwt: expected.verify_jwt };
    }).sort((left, right) => left.identity.localeCompare(right.identity));
    const result = deepFreeze({ capturedAt, descriptorSha256: authorityContext.descriptorSha256,
      approvedSha: reviewed.approvedSha, manifestSha256: sha256(canonicalJson(manifest)),
      migrationSha256: migrationContract.sha256, functions,
      advisors: compileAdvisors(authorityContext.privateAuthority),
      databaseFunctions: compileDatabaseFunctions(migration, authorityContext.privateAuthority),
      databaseRelations: compileDatabaseRelations(migration, authorityContext.privateAuthority) });
    sourceParityValues.set(result, canonicalJson(result));
    return result;
  } catch { reject(); }
}

export function assertTrustedB2SourceParity(value) {
  try {
    if (!sourceParityValues.has(value) || sourceParityValues.get(value) !== canonicalJson(value)) reject();
    return value;
  } catch { reject(); }
}
