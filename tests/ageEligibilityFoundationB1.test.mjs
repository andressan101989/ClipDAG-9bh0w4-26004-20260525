import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations).filter((name) => name.endsWith('_age_eligibility_foundation_b1.sql'));

test('B1 has one additive, non-activating migration', () => {
  assert.equal(matches.length, 1);
  const sql = readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8');
  assert.match(sql, /create table private\.user_age_eligibility\b/i);
  assert.match(sql, /create table private\.age_eligibility_policy\b/i);
  assert.match(sql, /create function private\.age_evaluate_dob\b/i);
  assert.match(sql, /create function private\.current_user_is_age_eligible\b/i);
  assert.match(sql, /create function private\.age_before_user_created\b/i);
  assert.match(sql, /'eligible'.*'unknown_legacy'.*'ineligible'/is);
  assert.match(sql, /'nelyon-age-v1'/i);
  assert.match(sql, /minimum_age[^;]*18/i);
  assert.match(sql, /revoke all on table private\.user_age_eligibility from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function private\.age_before_user_created\(jsonb\) from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /create\s+trigger|alter\s+table\s+auth\.users|alter\s+role\s+authenticator|pgrst\.db_pre_request/i);
  assert.doesNotMatch(sql, /insert\s+into\s+private\.user_age_eligibility/i);
  assert.doesNotMatch(sql, /ledger|wallet|settlement|payout|withdrawal/i);
});

test('B1 contract keeps no user-visible signup or legal changes', () => {
  const contract = readFileSync(new URL('../docs/age-eligibility-boundary-b1.md', import.meta.url), 'utf8');
  assert.match(contract, /missing row.*unknown_legacy.*deny normal access/is);
  assert.match(contract, /hook remains inactive/i);
  assert.match(contract, /first usable token/i);
  assert.match(contract, /financial resolution/i);
  const legal = readFileSync(new URL('../shared/legal/decisions.ts', import.meta.url), 'utf8');
  assert.match(legal, /minimumAge: owner\('owner_approved', '18'\)/);
});
