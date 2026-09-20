import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../supabase/migrations/', import.meta.url);

test('C1 supersedes the account policy without adding another age authority or touching legacy users', () => {
  const matches = readdirSync(dir).filter((name) => name.endsWith('_age_policy_account13_creator18_c1.sql'));
  assert.equal(matches.length, 1);
  const sql = readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8');
  assert.match(sql, /minimum_age\s*=\s*13/i);
  assert.match(sql, /creator_exclusive_minimum_age/i);
  assert.match(sql, /nelyon-age-v2/i);
  assert.match(sql, /age_band/i);
  assert.match(sql, /create or replace function private\.age_classify_dob/i);
  assert.match(sql, /create or replace function private\.current_user_is_creator_exclusive_age_eligible/i);
  assert.match(sql, /create or replace function private\.age_before_user_created/i);
  assert.match(sql, /create or replace function private\.materialize_user_age_eligibility/i);
  assert.doesNotMatch(sql, /create\s+table\s+private\./i);
  assert.doesNotMatch(sql, /update\s+private\.user_age_eligibility|insert\s+into\s+private\.user_age_eligibility\s+select/i);
  assert.doesNotMatch(sql, /ledger|wallet|settlement|payout|refund/i);
});
