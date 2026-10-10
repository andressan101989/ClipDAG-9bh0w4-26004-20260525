import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b7_full_functional_commercial_completion.sql'));
const path = matches.length === 1
  ? new URL(`../supabase/migrations/${matches[0]}`, import.meta.url)
  : null;
const sql = path && existsSync(path) ? readFileSync(path, 'utf8') : '';

function functionBody(name, schema = '(?:public|private)') {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/);
  return end < 0 ? rest : rest.slice(0, end + 4);
}

test('B7 is one forward migration over the canonical Premium and admin domains', () => {
  assert.equal(matches.length, 1, 'exactly one generated B7 migration must exist');
  assert.match(matches[0], /^\d{14}_creator_premium_b7_full_functional_commercial_completion\.sql$/);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.creator_premium_/i);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.(?:wallet|ledger|balance|escrow|entitlement)/i);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.(?:creator_premium_review|creator_premium_report|creator_premium_analytics)/i);
  assert.doesNotMatch(sql, /cron\.schedule|create\s+extension/i);
});

test('content lifecycle adds rejected and binds current review metadata without weakening prior states', () => {
  assert.match(sql, /add\s+column\s+submitted_at\s+timestamptz/i);
  assert.match(sql, /add\s+column\s+reviewed_at\s+timestamptz/i);
  assert.match(sql, /add\s+column\s+reviewed_by\s+uuid/i);
  assert.match(sql, /add\s+column\s+review_reason\s+text/i);
  assert.match(sql, /creator_premium_contents_lifecycle_check[\s\S]*'rejected'/i);
  assert.match(sql, /creator_premium_contents_state_check[\s\S]*lifecycle_status\s*=\s*'rejected'/i);
  assert.match(sql, /review_reason[\s\S]*char_length[\s\S]*(?:500|1000)/i);
  assert.match(sql, /reviewed_by[\s\S]*references\s+auth\.users/i);
});

test('creator submission records review timing and creator can only reopen rejection to draft', () => {
  const submit = functionBody('submit_my_creator_premium_content_for_review_v1', 'public');
  const reopen = functionBody('reopen_my_creator_premium_rejected_v1', 'public');
  assert.match(submit, /lifecycle_status\s*=\s*'pending_review'/i);
  assert.match(submit, /submitted_at\s*=\s*pg_catalog\.clock_timestamp\(\)/i);
  assert.doesNotMatch(submit, /lifecycle_status\s*=\s*'published'/i);
  assert.match(reopen, /auth\.uid\(\)/i);
  assert.match(reopen, /current_user_is_creator_exclusive_age_eligible/i);
  assert.match(reopen, /creator_premium_actor_is_operational_v1/i);
  assert.match(reopen, /lifecycle_status\s*<>\s*'rejected'/i);
  assert.match(reopen, /for\s+update/i);
  assert.match(reopen, /lifecycle_status\s*=\s*'draft'/i);
  assert.doesNotMatch(reopen, /lifecycle_status\s*=\s*'published'/i);
});

test('canonical owner list exposes bounded review feedback for correction', () => {
  const projection = functionBody('get_my_creator_premium_contents_v1', 'public');
  assert.match(sql, /drop\s+function\s+public\.get_my_creator_premium_contents_v1\s*\(\s*integer\s*,\s*timestamptz\s*,\s*uuid\s*\)/i);
  assert.match(projection, /submitted_at\s+timestamptz/i);
  assert.match(projection, /reviewed_at\s+timestamptz/i);
  assert.match(projection, /reviewed_by\s+uuid/i);
  assert.match(projection, /review_reason\s+text/i);
  assert.match(projection, /content\.review_reason/i);
  for (const forbidden of ['object_key', 'bucket_name', 'cloudflare_uid', 'hls_url', 'dash_url']) {
    assert.doesNotMatch(projection, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
});

test('publication blocker revalidates media, creator, active offer, and active plan', () => {
  const body = functionBody('creator_premium_publication_blocker_v1', 'private');
  assert.match(body, /creator_premium_actor_is_age_eligible_v1/i);
  assert.match(body, /creator_premium_actor_is_operational_v1/i);
  assert.match(body, /creator_premium_image_is_ready_v1/i);
  assert.match(body, /creator_premium_video_is_ready_v1/i);
  assert.match(body, /creator_premium_offer_versions/i);
  assert.match(body, /offer\.status\s*=\s*'active'/i);
  assert.match(body, /creator_premium_plan_contents/i);
  assert.match(body, /plan\.status\s*=\s*'active'/i);
});

test('admin Premium capabilities are narrow and refund write is deliberately unassigned', () => {
  for (const capability of [
    'creator_premium.review.read',
    'creator_premium.review.moderate',
    'creator_premium.refunds.write',
  ]) assert.match(sql, new RegExp(capability.replaceAll('.', '\\.'), 'i'));

  for (const role of ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'MODERATOR']) {
    assert.match(sql, new RegExp(`${role}[\\s\\S]*creator_premium\\.review\\.read`, 'i'));
    assert.match(sql, new RegExp(`${role}[\\s\\S]*creator_premium\\.review\\.moderate`, 'i'));
  }
  const roleMappings = [...sql.matchAll(/insert\s+into\s+private\.admin_role_capabilities[\s\S]*?;/gi)]
    .map(match => match[0]).join('\n');
  assert.doesNotMatch(roleMappings, /creator_premium\.refunds\.write/i);
});

test('admin review projection is bounded and contains no private media locator', () => {
  const search = functionBody('search_admin_creator_premium_content_v1', 'public');
  const detail = functionBody('get_admin_creator_premium_content_v1', 'public');
  assert.match(search, /admin_require_capability\s*\(\s*'creator_premium\.review\.read'/i);
  assert.match(search, /(?:pg_catalog\.)?least\s*\(\s*(?:pg_catalog\.)?greatest/i);
  assert.match(search, /\(content\.(?:submitted_at|created_at)\s*,\s*content\.id\)/i);
  assert.match(detail, /admin_require_capability\s*\(\s*'creator_premium\.review\.read'/i);
  assert.match(detail, /creator_premium_teaser_url_v1/i);
  assert.match(detail, /admin_action_audit/i);
  assert.match(detail, /reports/i);
  for (const forbidden of ['object_key', 'bucket_name', 'cloudflare_uid', 'hls_url', 'dash_url', 'buyer_account_id', 'creator_account_id']) {
    assert.doesNotMatch(search, new RegExp(`\\b${forbidden}\\b`, 'i'));
    assert.doesNotMatch(detail, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
});

test('admin decision is capability-gated, locked, idempotent, auditable, and never a creator authority', () => {
  const body = functionBody('admin_review_creator_premium_content_v1', 'public');
  assert.match(body, /admin_require_capability\s*\(\s*'creator_premium\.review\.moderate'/i);
  assert.match(body, /pg_advisory_xact_lock/i);
  assert.match(body, /for\s+update/i);
  assert.match(body, /request_fingerprint/i);
  assert.match(body, /admin_action_audit/i);
  assert.match(body, /creator_premium_publication_blocker_v1/i);
  for (const action of ['approve', 'reject', 'quarantine', 'remove', 'restore']) {
    assert.match(body, new RegExp(`'${action}'`, 'i'));
  }
  assert.match(body, /approve[\s\S]*lifecycle_status\s*=\s*'published'/i);
  assert.match(body, /restore[\s\S]*lifecycle_status\s*=\s*'pending_review'/i);
  assert.doesNotMatch(sql, /grant\s+execute\s+on\s+function\s+public\.admin_review_creator_premium_content_v1\([^;]+\)\s+to\s+anon/i);
});

test('Premium reporting reuses reports and admin report center without carrying originals', () => {
  const report = functionBody('report_creator_premium_content_v1', 'public');
  assert.match(sql, /reports_reported_content_type_check[\s\S]*'creator_premium'/i);
  assert.match(report, /auth\.uid\(\)/i);
  assert.match(report, /lifecycle_status\s*=\s*'published'/i);
  assert.match(report, /creator_premium_report_self_forbidden/i);
  assert.match(report, /insert\s+into\s+public\.reports/i);
  assert.match(report, /not\s+exists[\s\S]*status\s*=\s*'pending'/i);
  for (const forbidden of ['signed', 'object_key', 'bucket_name', 'cloudflare_uid', 'hls_url', 'dash_url']) {
    assert.doesNotMatch(report, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
  assert.match(functionBody('search_admin_reports', 'public'), /'creator_premium'/i);
  assert.match(functionBody('get_admin_report_detail', 'public'), /creator_premium\.review\.read/i);
});

test('all new management definers use empty search_path and explicit least-privilege grants', () => {
  const authenticated = [
    'reopen_my_creator_premium_rejected_v1',
    'report_creator_premium_content_v1',
    'get_creator_premium_commerce_v1',
    'get_my_creator_premium_subscriptions_v1',
    'get_my_creator_premium_commercial_summary_v1',
  ];
  const admin = [
    'search_admin_creator_premium_content_v1',
    'get_admin_creator_premium_content_v1',
    'admin_review_creator_premium_content_v1',
    'admin_refund_creator_premium_purchase_v1',
    'admin_refund_creator_premium_subscription_period_v1',
  ];
  for (const name of [...authenticated, ...admin]) {
    const body = functionBody(name, 'public');
    assert.match(body, /security\s+definer/i, `${name} must be SECURITY DEFINER`);
    assert.match(body, /set\s+search_path\s*=\s*''/i, `${name} must have empty search_path`);
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\([^;]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
  }
  for (const name of authenticated) {
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]*\\)\\s+to\\s+authenticated`, 'i'));
  }
  for (const name of admin) {
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]*\\)\\s+to\\s+authenticated`, 'i'));
  }
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.refund_creator_premium_purchase_v1\([^;]+\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.refund_creator_premium_purchase_v1\([^;]+\)\s+to\s+service_role/i);
});
