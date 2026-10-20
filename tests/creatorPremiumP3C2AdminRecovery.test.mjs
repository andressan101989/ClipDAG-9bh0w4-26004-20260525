import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationNames = fs.readdirSync(migrationsDir)
  .filter(name => /creator_premium_p3_c2_admin_restriction_recovery\.sql$/i.test(name));

test('P3-C2 adds one forward-only read projection without weakening moderation authority', () => {
  assert.equal(migrationNames.length, 1, 'exactly one focal P3-C2 migration must exist');
  const sql = fs.readFileSync(path.join(migrationsDir, migrationNames[0]), 'utf8');
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.get_admin_creator_premium_content_v1\s*\(\s*p_content_id\s+uuid\s*\)/i);
  assert.match(sql, /admin_require_capability\s*\(\s*'creator_premium\.review\.read'\s*\)/i);
  assert.match(sql, /'reverification'\s*,\s*pg_catalog\.jsonb_build_object/i);
  assert.match(sql, /'current_scan_alert_count'/i);
  assert.match(sql, /'favorable_alert_count'/i);
  assert.match(sql, /'blocking_alert_count'/i);
  assert.match(sql, /alert\.scan_id\s*=\s*content\.verification_scan_id/i);
  assert.match(sql, /alert\.target_type\s*=\s*'creator_premium'[\s\S]*alert\.target_id\s*=\s*content\.id/i,
    'current-scan readiness must stay bounded by the existing target index');
  assert.match(sql, /alert\.status\s*=\s*'dismissed'[\s\S]*alert\.resolution\s*=\s*'no_violation'/i);
  assert.match(sql, /creator_premium_safety_alert_resolution_required/i);
  assert.doesNotMatch(sql, /alter\s+function\s+public\.get_admin_creator_premium_content_v1\s*\(\s*uuid\s*\)\s+owner\s+to/i,
    'CREATE OR REPLACE must preserve the already-audited canonical owner');
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.get_admin_creator_premium_content_v1\s*\(\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.get_admin_creator_premium_content_v1\s*\(\s*uuid\s*\)\s+to\s+authenticated/i);
  const detailStart=sql.search(/create\s+or\s+replace\s+function\s+public\.get_admin_creator_premium_content_v1/i);
  const alertAuthorityStart=sql.search(/create\s+or\s+replace\s+function\s+public\.admin_review_content_safety_alert/i);
  assert.ok(detailStart>=0&&alertAuthorityStart>detailStart);
  assert.doesNotMatch(sql.slice(detailStart,alertAuthorityStart), /\b(?:insert\s+into|update|delete\s+from)\s+private\./i,
    'the recovery projection migration must not mutate production content or alerts');
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.admin_review_content_safety_alert\s*\(/i);
  assert.match(sql, /pg_advisory_xact_lock\s*\(\s*pg_catalog\.hashtextextended\s*\([\s\S]*p_idempotency_key/i,
    'exact concurrent replays must serialize before the audit lookup');
  assert.match(sql, /p_action\s+in\s*\(\s*'dismiss'\s*,\s*'resolve'\s*\)[\s\S]*v_alert\.status\s+not\s+in\s*\(\s*'open'\s*,\s*'in_review'\s*\)[\s\S]*content_safety_alert_already_closed/i,
    'terminal alert decisions must be immutable while exact idempotent replay remains available');
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.admin_review_content_safety_alert\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.admin_review_content_safety_alert\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*uuid\s*\)\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+execute[^;]*\b(?:anon|service_role)\b/i);
});
