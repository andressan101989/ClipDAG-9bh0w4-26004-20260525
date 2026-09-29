import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('_age_eligibility_legacy_remediation_projection.sql'));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), 'utf8')
  : '';
const servicePath = new URL('../services/ageEligibilityService.ts', import.meta.url);
const screenPath = new URL('../app/age-eligibility.tsx', import.meta.url);
const accountSettings = readFileSync(new URL('../app/account-settings.tsx', import.meta.url), 'utf8');

test('C4 adds exactly one forward-only self-only status projection', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.get_my_age_eligibility_status_v2\(\)/i);
  assert.match(migration, /returns\s+jsonb/i);
  assert.match(migration, /language\s+plpgsql/i);
  assert.match(migration, /\bstable\b/i);
  assert.match(migration, /security\s+definer/i);
  assert.match(migration, /set\s+search_path\s*=\s*''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /get_my_age_eligibility_status_v2\s*\(\s*p_/i);
});

test('the projection returns only minimum derived state and never returns a DOB', () => {
  for (const field of [
    'authority',
    'state',
    'evaluated',
    'birth_date_present',
    'remediation_required',
    'policy_version',
    'minimum_age',
  ]) {
    assert.match(migration, new RegExp(`'${field}'`, 'i'));
  }
  assert.match(migration, /'complete'/i);
  assert.match(migration, /'remediation_required'/i);
  assert.match(migration, /'ineligible'/i);
  assert.match(migration, /'unavailable'/i);
  assert.doesNotMatch(migration, /'birth_date'\s*,/i);
  assert.doesNotMatch(migration, /raw_user_meta_data|email|exact_age/i);
  assert.doesNotMatch(migration, /insert\s+into|update\s+private\.user_age_eligibility|delete\s+from/i);
});

test('the projection has an authenticated-only ACL', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.get_my_age_eligibility_status_v2\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.get_my_age_eligibility_status_v2\(\)\s+to\s+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+execute[\s\S]*\b(?:anon|service_role)\b/i);
});

test('Mobile uses only the V2 projection and canonical remediation RPC', () => {
  assert.equal(existsSync(servicePath), true);
  const service = readFileSync(servicePath, 'utf8');
  assert.match(service, /\.rpc\(['"]get_my_age_eligibility_status_v2['"]/);
  assert.match(service, /\.rpc\(['"]remediate_my_age_eligibility['"]\s*,\s*\{\s*p_date_of_birth:/s);
  assert.doesNotMatch(service, /\.from\(|service_role|user_id\s*:/i);
  assert.doesNotMatch(service, /isAdult|age_band\s*:|eligible\s*:/i);
  assert.doesNotMatch(service, /console\.|AsyncStorage|SecureStore|analytics/i);
});

test('the Account Settings route provides a local-only remediation form', () => {
  assert.equal(existsSync(screenPath), true);
  const screen = readFileSync(screenPath, 'utf8');
  assert.match(accountSettings, /Edad y elegibilidad/);
  assert.match(accountSettings, /router\.push\(['"]\/age-eligibility['"]\)/);
  assert.match(screen, /validateSignupDob/);
  assert.match(screen, /formatLocalCalendarDate/);
  assert.match(screen, /getMyAgeEligibilityStatus/);
  assert.match(screen, /remediateMyAgeEligibility/);
  assert.match(screen, /Verificaci[oó]n de edad completada/i);
  assert.match(screen, /setDateOfBirth\(['"]['"]\)/);
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|useLocalSearchParams|console\.|analytics/i);
  assert.doesNotMatch(screen, /date_of_birth|birth_date|viewer_age_range_mismatch|PLR|canary|Supabase/i);
});
