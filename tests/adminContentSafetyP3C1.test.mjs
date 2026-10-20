import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const migrationsDirectory = join(root, 'supabase', 'migrations')
const b7Sql = readFileSync(
  join(migrationsDirectory, '20261010053524_creator_premium_b7_full_functional_commercial_completion.sql'),
  'utf8',
).replaceAll('\r\n', '\n')
const migrationNames = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith('_content_safety_p3_c1_admin_alerts_sql_recovery.sql'),
)

function functionDefinition(sql, name) {
  const match = sql.replaceAll('\r\n', '\n').match(new RegExp(
    `create or replace function (?:private|public)\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  assert.ok(match, name)
  return match[0]
}

test('P3-C1 is one forward-only recovery migration with the two affected authorities only', () => {
  assert.equal(migrationNames.length, 1)
  assert.match(
    migrationNames[0],
    /^\d{14}_content_safety_p3_c1_admin_alerts_sql_recovery\.sql$/,
  )
  const sql = readFileSync(join(migrationsDirectory, migrationNames[0]), 'utf8')
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 2)
  assert.match(sql, /create or replace function public\.search_admin_content_safety_alerts\(/i)
  assert.match(sql, /create or replace function private\.preview_content_safety_rule_definition\(/i)
  assert.doesNotMatch(sql, /pg_catalog\.coalesce/i)
  assert.match(sql, /'items'\s*,\s*coalesce\(/i)
  assert.match(sql, /'evidence_excerpt'\s*,\s*coalesce\(/i)
})

test('P3-C1 preserves both B7 function bodies byte-for-byte except for unqualifying COALESCE', () => {
  const sql = readFileSync(join(migrationsDirectory, migrationNames[0]), 'utf8')
  for (const name of ['preview_content_safety_rule_definition', 'search_admin_content_safety_alerts']) {
    assert.equal(
      functionDefinition(sql, name),
      functionDefinition(b7Sql, name).replaceAll('pg_catalog.coalesce', 'coalesce'),
    )
  }
})

test('P3-C1 preserves capability checks, hardened execution context, and exact ACL posture', () => {
  const sql = readFileSync(join(migrationsDirectory, migrationNames[0]), 'utf8')
  assert.match(sql, /perform public\.admin_require_capability\('content\.items\.read'\)/i)
  assert.match(sql, /stable security definer set search_path\s*=\s*''/i)
  assert.match(sql, /alter function public\.search_admin_content_safety_alerts[\s\S]*owner to postgres/i)
  assert.match(sql, /alter function private\.preview_content_safety_rule_definition[\s\S]*owner to postgres/i)
  assert.match(sql, /revoke all on function public\.search_admin_content_safety_alerts[\s\S]*from public,anon,authenticated,service_role/i)
  assert.match(sql, /grant execute on function public\.search_admin_content_safety_alerts[\s\S]*to authenticated/i)
  assert.match(sql, /revoke all on function private\.preview_content_safety_rule_definition[\s\S]*from public,anon,authenticated,service_role/i)
})

test('P3-C1 cannot review alerts, mutate content, alter Finance, or change the P3 policy', () => {
  const sql = readFileSync(join(migrationsDirectory, migrationNames[0]), 'utf8')
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|drop)\b/i)
  assert.doesNotMatch(sql, /admin_review_content_safety_alert|\brestore\b|\bpublish\b|\breconcile\b/i)
  assert.doesNotMatch(sql, /creator_premium_finance_policy|ledger|wallet|escrow/i)
  assert.doesNotMatch(sql, /creator_premium_content_safety_policy_p1_v1|content_safety_rules\s+set/i)
})
