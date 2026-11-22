import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../scripts/nelyon-production-release.mjs';

// Synthetic PostgreSQL 17 deparser transport over the real migration signatures.
// No database, adapter normalizer or production source-parity compiler is used.
// This unit fixture is not the independent proof: the disposable harness checks
// all 31 real PostgreSQL rows against the compiler separately.
export function b2DatabaseFunctionMatrix() {
  const sql = readFileSync(new URL('../../supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql', import.meta.url), 'utf8');
  const workers = new Set(['claim_publication_schedules_v1', 'prepare_publication_schedule_v1',
    'confirm_publication_schedule_item_v1', 'publish_publication_schedule_v1', 'fail_publication_schedule_v1', 'reconcile_publication_schedules_v1']);
  const noExecute = new Set(['wake_scheduled_publications_b2_v1']);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const types = { timestamp: 'timestamp without time zone', timestamptz: 'timestamp with time zone' };
  const rows = [...sql.matchAll(/create (?:or replace )?function (\w+)\.(\w+)\(([\s\S]*?)\)\s*returns([\s\S]*?)as \$function\$[\s\S]*?\$function\$;/gi)].map(match => {
    const [, schema, name, parameters, attributes] = match;
    const args = parameters.trim() ? parameters.trim().split(',').map(value => value.trim().replace(/\s+default\s+[\s\S]*/i, '').split(/\s+/)) : [];
    const argument_types = args.map(([, type]) => types[type] ?? type);
    const role = schema === 'private' || noExecute.has(name) ? null : workers.has(name) ? 'service_role' : 'authenticated';
    const acl = ['postgres', ...(role ? [role] : [])].sort().map(grantee => ({ grantee, privilege_type: 'EXECUTE', is_grantable: false }));
    return { schema, name, identity_arguments: args.map(([name], index) => `${name} ${argument_types[index]}`).join(', '), argument_types,
      security_definer: /security\s+definer/i.test(attributes), owner: 'postgres', search_path: [/set\s+search_path\s*=\s*public/i.test(attributes) ? 'search_path=public' : 'search_path=""'],
      acl, execute: { public: false, anon: false, authenticated: role === 'authenticated', service_role: role === 'service_role' }, definition: pg17Definition(match[0], schema, name, parameters, attributes) };
  });
  assert.equal(rows.length, 31);
  assert.deepEqual([rows.filter(row => row.schema === 'private' && !row.security_definer).length,
    rows.filter(row => row.schema === 'private' && row.security_definer).length,
    rows.filter(row => row.execute.authenticated).length, rows.filter(row => row.execute.service_role).length], [13, 1, 10, 6]);
  const identity = row => `${row.schema}.${row.name}(${row.argument_types.join(',').replaceAll(' ', '')})`;
  const sourceRows = rows.map(({ definition, ...row }) => ({ ...row, definition_sha256: hash(definition.replace(/\r\n?/g, '\n')) }))
    .sort((a,b) => identity(a).localeCompare(identity(b)));
  const catalog = sourceRows.map(row => ({ kind: 'function', value: { identity: identity(row), owner: row.owner,
    securityDefiner: row.security_definer, searchPath: row.search_path, execute: row.execute.authenticated, definitionSha256: row.definition_sha256 } }));
  const records = catalog.map(({ kind, value }) => ({ kind, identity: value.identity,
    expectedCanonicalJson: canonicalJson(value).trimEnd(), expectedSha256: hash(canonicalJson(value).trimEnd()) }));
  for (const row of sourceRows) {
    const value = { identity: identity(row), acl: row.acl, execute: row.execute };
    const expectedCanonicalJson = canonicalJson(value).trimEnd();
    records.push({ kind: 'function_acl', identity: value.identity, expectedCanonicalJson, expectedSha256: hash(expectedCanonicalJson) });
  }
  records.sort((a,b) => `${a.kind}\0${a.identity}` < `${b.kind}\0${b.identity}` ? -1 : 1);
  return { rows, sourceRows, catalog, records };
}

function pg17Definition(sql, schema, name, parameters, attributes) {
  const types = { timestamp: 'timestamp without time zone', timestamptz: 'timestamp with time zone' };
  const args = parameters.trim() ? parameters.trim().split(',').map(part => {
    const [declaration, value] = part.trim().split(/\s+default\s+/i);
    const [argument, rawType] = declaration.split(/\s+/), type = types[rawType] ?? rawType;
    return `${argument} ${type}${value === undefined ? '' : ` DEFAULT ${value === 'null' ? `NULL::${type}` : value}`}`;
  }).join(', ') : '';
  const returnType = attributes.match(/^\s*(.*?)\s+language/i)[1];
  const result = returnType.startsWith('setof ') ? `SETOF ${returnType.slice(6)}` : types[returnType] ?? returnType;
  const language = attributes.match(/language\s+(\w+)/i)[1];
  const flags = [attributes.match(/\b(stable|immutable)\b/i)?.[1]?.toUpperCase(), /security\s+definer/i.test(attributes) ? 'SECURITY DEFINER' : null].filter(Boolean);
  const body = sql.slice(sql.indexOf('$function$') + 10, sql.lastIndexOf('$function$')).replace(/\r\n?/g, '\n');
  return `CREATE OR REPLACE FUNCTION ${schema}.${name}(${args})\n RETURNS ${result}\n LANGUAGE ${language}\n${flags.length ? ` ${flags.join(' ')}\n` : ''} SET search_path TO '${/search_path\s*=\s*public/i.test(attributes) ? 'public' : ''}'\nAS $function$${body}$function$\n`;
}

// Explicit synthetic unit-test authority only. Real expected ACLs are approved
// independently; the PostgreSQL integration proof never uses this helper.
export function b2SyntheticRelationAclRecords(records) {
  return records.filter(row => row.kind === 'relation').map(record => {
    const relation = JSON.parse(record.expectedCanonicalJson);
    const value = { identity: relation.identity,
      acl: (relation.identity.startsWith('private.publication_schedule')
        ? ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'] : ['SELECT'])
        .map(privilege_type => ({ grantee: relation.owner, privilege_type, is_grantable: false })),
      access: { public: false, anon: false, authenticated: false, service_role: false } };
    const expectedCanonicalJson = canonicalJson(value).trimEnd();
    return { kind: 'relation_acl', identity: value.identity, expectedCanonicalJson,
      expectedSha256: createHash('sha256').update(expectedCanonicalJson).digest('hex') };
  });
}
