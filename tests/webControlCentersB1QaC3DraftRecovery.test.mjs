import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

function recoveryMigration() {
  const names = readdirSync(migrationsDir)
    .filter(name => name.endsWith('_web_control_centers_b1_qa_c3_draft_list_recovery.sql'));
  assert.equal(names.length, 1, 'QA-C3 must add exactly one focal forward-only migration');
  return {
    name: names[0],
    sql: readFileSync(path.join(migrationsDir, names[0]), 'utf8'),
  };
}

function extractFunction(source, signature) {
  const start = source.toLowerCase().indexOf(signature.toLowerCase());
  assert.ok(start >= 0, `missing ${signature}`);
  const tail = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(tail);
  assert.ok(opening, `missing body for ${signature}`);
  const delimiter = opening[1];
  const bodyStart = opening.index + opening[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  assert.ok(bodyEnd >= bodyStart, `unterminated ${signature}`);
  const semicolon = tail.indexOf(';', bodyEnd + delimiter.length);
  assert.ok(semicolon > bodyEnd, `missing terminator for ${signature}`);
  return tail.slice(0, semicolon + 1);
}

test('QA-C3 replaces only the broken draft-list RPC and keeps its exact contract', () => {
  const { name, sql } = recoveryMigration();
  assert.match(name, /^\d{14}_web_control_centers_b1_qa_c3_draft_list_recovery\.sql$/);

  const definitions = sql.match(/create\s+or\s+replace\s+function\s+/gi) ?? [];
  assert.equal(definitions.length, 1, 'the migration must replace exactly one function');
  const body = extractFunction(
    sql,
    'create or replace function public.list_my_publication_drafts_v1(',
  );

  assert.match(body, /p_limit\s+integer\s+default\s+20/i);
  assert.match(body, /p_cursor_updated_at\s+timestamptz\s+default\s+null/i);
  assert.match(body, /p_cursor_id\s+uuid\s+default\s+null/i);
  assert.match(body, /returns\s+setof\s+jsonb/i);
  assert.match(body, /language\s+plpgsql/i);
  assert.match(body, /\bstable\b/i);
  assert.match(body, /security\s+definer/i);
  assert.match(body, /set\s+search_path\s*=\s*''/i);
  assert.match(body, /v_actor\s+uuid\s*:=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(body, /greatest\s*\(\s*1\s*,\s*least\s*\(\s*coalesce\s*\(\s*p_limit\s*,\s*20\s*\)\s*,\s*50\s*\)\s*\)/i);
  assert.doesNotMatch(body, /pg_catalog\.(?:least|greatest)\s*\(/i);
  assert.match(body, /draft\.owner_id\s*=\s*v_actor/i);
  assert.match(body, /draft\.state\s*=\s*'draft'/i);
  assert.match(body, /\(draft\.updated_at\s*,\s*draft\.id\)\s*<\s*\(p_cursor_updated_at\s*,\s*p_cursor_id\)/i);
  assert.match(body, /order\s+by\s+draft\.updated_at\s+desc\s*,\s*draft\.id\s+desc/i);
  assert.match(body, /limit\s+v_limit/i);

  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+table\b/i);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?(?:public|private)\./i);
  assert.doesNotMatch(sql, /\b(?:ledger|wallet|finance|cron|scheduler)\b/i);
});

test('QA-C3 preserves historical B1 bytes, ACL and ownership instead of recreating authority', () => {
  const { sql } = recoveryMigration();
  const historical = readFileSync(
    path.join(migrationsDir, '20261102065812_web_control_centers_b1_publication_drafts.sql'),
  );
  assert.equal(
    createHash('sha256').update(historical).digest('hex'),
    '216a7c43bb161aadcb1818c69d1bc499bc4de8fa192cfffa7bfba42e80ffd967',
  );
  assert.match(historical.toString('utf8'), /pg_catalog\.greatest\s*\([\s\S]{0,80}pg_catalog\.least/i);
  assert.doesNotMatch(sql, /\b(?:grant|revoke)\b/i, 'CREATE OR REPLACE must preserve the existing ACL');
  assert.doesNotMatch(sql, /alter\s+function[\s\S]{0,180}\bowner\s+to\b/i);
});
