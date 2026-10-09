import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b5_creator_management_ux.sql'));
const path = matches.length === 1
  ? new URL(`../supabase/migrations/${matches[0]}`, import.meta.url)
  : null;
const sql = path && existsSync(path) ? readFileSync(path, 'utf8') : '';

const functionBody = name => {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public|private)\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/);
  return end < 0 ? rest : rest.slice(0, end + 4);
};

test('B5 is exactly one forward migration over the canonical Premium domain', () => {
  assert.equal(matches.length, 1, 'exactly one generated B5 migration must exist');
  assert.match(matches[0], /^\d{14}_creator_premium_b5_creator_management_ux\.sql$/);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.(?:creator_premium_contents|creator_premium_offer_versions|creator_premium_plans|creator_premium_plan_contents)\b/i);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.(?:wallet|ledger|balance|escrow)/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:purchase_exclusive_content|subscribe_to_creator)\b/i);
  assert.doesNotMatch(sql, /creator_premium_finance_policy[\s\S]*(?:purchase_enabled|subscription_enabled|refunds_enabled|platform_fee_bps)\s*=/i);
});

test('draft updates lock kind after media and access mode after incompatible commercial facts', () => {
  const body = functionBody('update_my_creator_premium_draft_v1');
  assert.match(body, /creator_premium_content_kind_locked_by_media/i);
  assert.match(body, /public\.media_asset_links/i);
  assert.match(body, /public\.video_asset_links/i);
  assert.match(body, /creator_premium_access_mode_locked_by_commercial_state/i);
  assert.match(body, /private\.creator_premium_offer_versions/i);
  assert.match(body, /private\.creator_premium_plan_contents/i);
  assert.match(body, /lifecycle_status\s*<>\s*'draft'/i);
});

test('offer commands version immutable active prices and are authenticated-only', () => {
  const body = functionBody('set_my_creator_premium_offer_v1');
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /current_user_is_creator_exclusive_age_eligible/i);
  assert.match(body, /creator_premium_actor_is_operational_v1/i);
  assert.match(body, /access_mode\s+not\s+in\s*\(\s*'purchase'\s*,\s*'purchase_or_subscription'\s*\)/i);
  assert.match(body, /status\s*=\s*'retired'/i);
  assert.match(body, /max\s*\(\s*offer\.version\s*\)\s*,\s*0\s*\)\s*\+\s*1/i);
  assert.match(body, /creator_premium_offer_idempotency_conflict/i);
  assert.match(body, /public\.idempotency_keys/i);
  assert.match(body, /creator_premium_offer_set/i);
  assert.match(body, /response_body/i);
  assert.match(body, /p_price_bdag::numeric\(20\s*,\s*8\)::text/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.set_my_creator_premium_offer_v1\([^;]+\)\s+to\s+authenticated/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.set_my_creator_premium_offer_v1\([^;]+\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('offer and plan price authority rejects PostgreSQL non-finite numerics at RPC and storage layers', () => {
  const offer = functionBody('set_my_creator_premium_offer_v1');
  const createPlan = functionBody('create_my_creator_premium_plan_draft_v1');
  const updatePlan = functionBody('update_my_creator_premium_plan_draft_v1');
  for (const body of [offer, createPlan, updatePlan]) {
    assert.match(body, /p_price_bdag::text\s+in\s*\(\s*'NaN'\s*,\s*'Infinity'\s*,\s*'-Infinity'\s*\)/i);
  }
  assert.match(sql, /constraint\s+creator_premium_offer_versions_price_check[\s\S]*price_bdag::text\s+not\s+in\s*\(\s*'NaN'\s*,\s*'Infinity'\s*,\s*'-Infinity'\s*\)/i);
  assert.match(sql, /constraint\s+creator_premium_plans_price_check[\s\S]*price_bdag::text\s+not\s+in\s*\(\s*'NaN'\s*,\s*'Infinity'\s*,\s*'-Infinity'\s*\)/i);
});

test('plan-create idempotency uses unambiguous payload encoding and exact replay comparison', () => {
  const body = functionBody('create_my_creator_premium_plan_draft_v1');
  assert.match(body, /jsonb_build_object/i);
  assert.doesNotMatch(body, /concat_ws\s*\(\s*'\|'/i);
  assert.match(body, /p_price_bdag::numeric\(20\s*,\s*8\)::text/i);
  assert.match(body, /v_existing\.name\s+is\s+distinct\s+from\s+v_name/i);
  assert.match(body, /v_existing\.description\s+is\s+distinct\s+from\s+v_description/i);
  assert.match(body, /v_existing\.price_bdag\s+is\s+distinct\s+from\s+p_price_bdag/i);
  assert.match(body, /v_existing\.billing_period_days\s+is\s+distinct\s+from\s+p_billing_period_days/i);
});

test('plan management creates drafts, replaces mappings, clones versions, activates, and retires', () => {
  for (const name of [
    'create_my_creator_premium_plan_draft_v1',
    'update_my_creator_premium_plan_draft_v1',
    'set_my_creator_premium_plan_contents_v1',
    'clone_my_creator_premium_plan_version_v1',
    'activate_my_creator_premium_plan_v1',
    'retire_my_creator_premium_plan_v1',
    'get_my_creator_premium_plans_v1',
  ]) assert.ok(functionBody(name), `${name} must exist`);

  assert.match(functionBody('create_my_creator_premium_plan_draft_v1'), /billing_period_days\s+not\s+between\s+1\s+and\s+365/i);
  assert.match(functionBody('create_my_creator_premium_plan_draft_v1'), /'plan_'\s*\|\|/i);
  assert.match(functionBody('set_my_creator_premium_plan_contents_v1'), /access_mode\s+not\s+in\s*\(\s*'subscription'\s*,\s*'purchase_or_subscription'\s*\)/i);
  assert.match(functionBody('set_my_creator_premium_plan_contents_v1'), /lifecycle_status\s+in\s*\(\s*'quarantined'\s*,\s*'removed'\s*,\s*'deleted'\s*\)/i);
  assert.match(functionBody('clone_my_creator_premium_plan_version_v1'), /max\s*\(\s*plan\.version\s*\)\s*,\s*0\s*\)\s*\+\s*1/i);
  assert.match(functionBody('clone_my_creator_premium_plan_version_v1'), /insert\s+into\s+private\.creator_premium_plan_contents/i);
  assert.match(functionBody('activate_my_creator_premium_plan_v1'), /lifecycle_status\s+not\s+in\s*\(\s*'pending_review'\s*,\s*'published'\s*\)/i);
  assert.match(functionBody('activate_my_creator_premium_plan_v1'), /status\s*=\s*'retired'/i);
  assert.match(functionBody('retire_my_creator_premium_plan_v1'), /status\s*=\s*'retired'/i);
});

test('draft plan remapping cannot invalidate content already pending review', () => {
  const body = functionBody('set_my_creator_premium_plan_contents_v1');
  assert.match(body, /creator_premium_plan_content_review_locked/i);
  assert.match(body, /mapping\.plan_id\s*=\s*v_plan\.id[\s\S]*content\.id\s*=\s*any\(v_content_ids\)/i);
  assert.match(body, /other_plan\.status\s+in\s*\(\s*'draft'\s*,\s*'active'\s*\)/i);
});

test('plan lifecycle cannot strand pending-review subscription content without a live grant', () => {
  for (const name of [
    'activate_my_creator_premium_plan_v1',
    'retire_my_creator_premium_plan_v1',
  ]) {
    const body = functionBody(name);
    assert.match(body, /creator_premium_plan_content_review_locked/i);
    assert.match(body, /lifecycle_status\s*=\s*'pending_review'/i);
    assert.match(body, /other_plan\.status\s+in\s*\(\s*'draft'\s*,\s*'active'\s*\)/i);
  }
});

test('plan-family commands acquire the family advisory lock before row locks', () => {
  for (const name of [
    'clone_my_creator_premium_plan_version_v1',
    'activate_my_creator_premium_plan_v1',
    'retire_my_creator_premium_plan_v1',
  ]) {
    const body = functionBody(name);
    const familyLock = body.indexOf("'creator-premium-plan-version:'");
    const firstRowLock = body.search(/for\s+update/i);
    assert.notEqual(familyLock, -1, `${name} must acquire the plan-family lock`);
    assert.notEqual(firstRowLock, -1, `${name} must lock plan rows`);
    assert.ok(familyLock < firstRowLock, `${name} must take the family lock before row locks`);
  }
});

test('submission requires exact image/video and commercial readiness and can only enter review', () => {
  const helper = functionBody('creator_premium_submission_blocker_v1');
  const videoReady = functionBody('creator_premium_video_is_ready_v1');
  const submit = functionBody('submit_my_creator_premium_content_for_review_v1');
  assert.match(helper, /creator_premium_image_media_not_ready/i);
  assert.match(helper, /creator_premium_video_media_not_ready/i);
  assert.match(videoReady, /provider_metadata\s*->\s*'require_signed_urls'/i);
  assert.match(videoReady, /hls_url\s+is\s+null/i);
  assert.match(videoReady, /dash_url\s+is\s+null/i);
  assert.match(videoReady, /thumbnail_url\s+is\s+null/i);
  assert.match(helper, /creator_premium_active_offer_required/i);
  assert.match(helper, /creator_premium_plan_mapping_required/i);
  assert.match(submit, /lifecycle_status\s*=\s*'pending_review'/i);
  assert.doesNotMatch(submit, /lifecycle_status\s*=\s*'published'/i);
  assert.doesNotMatch(submit, /published_at\s*=/i);
});

test('draft deletion fails closed on history, removes only draft mappings, and schedules canonical media', () => {
  const body = functionBody('delete_my_creator_premium_draft_v1');
  assert.match(body, /creator_premium_draft_has_financial_history/i);
  assert.match(body, /creator_premium_draft_in_immutable_plan/i);
  assert.match(body, /private\.creator_premium_purchase_receipts/i);
  assert.match(body, /private\.creator_premium_subscription_periods/i);
  assert.match(body, /public\.schedule_media_asset_deletion/i);
  assert.match(body, /private\.schedule_creator_premium_video_deletion_v1/i);
  assert.match(body, /lifecycle_status\s*=\s*'deleted'/i);
  assert.match(body, /deleted_at\s*=\s*pg_catalog\.clock_timestamp\(\)/i);
});

test('owner projection exposes readiness and commercial management facts without private IDs', () => {
  const contents = functionBody('get_my_creator_premium_contents_v1');
  const detail = functionBody('get_my_creator_premium_content_v1');
  const plans = functionBody('get_my_creator_premium_plans_v1');
  for (const field of [
    'active_offer_version', 'price_bdag', 'mapped_plan_count', 'active_plan_count',
    'submission_ready', 'submission_blocker',
  ]) assert.match(contents, new RegExp(`\\b${field}\\b`, 'i'));
  for (const field of ['mapped_content_count', 'mapped_content_ids', 'billing_period_days']) {
    assert.match(plans, new RegExp(`\\b${field}\\b`, 'i'));
  }
  for (const forbidden of ['cloudflare_uid', 'object_key', 'bucket_name', 'buyer_account_id', 'creator_account_id']) {
    assert.doesNotMatch(contents, new RegExp(`\\b${forbidden}\\b`, 'i'));
    assert.doesNotMatch(detail, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
  assert.match(detail, /content\.id\s*=\s*p_content_id/i);
  assert.match(detail, /content\.creator_id\s*=\s*v_actor/i);
});

test('all creator management RPCs use empty search_path and authenticated-only grants', () => {
  const names = [
    'set_my_creator_premium_offer_v1',
    'create_my_creator_premium_plan_draft_v1',
    'update_my_creator_premium_plan_draft_v1',
    'set_my_creator_premium_plan_contents_v1',
    'clone_my_creator_premium_plan_version_v1',
    'activate_my_creator_premium_plan_v1',
    'retire_my_creator_premium_plan_v1',
    'submit_my_creator_premium_content_for_review_v1',
    'delete_my_creator_premium_draft_v1',
    'get_my_creator_premium_content_v1',
    'get_my_creator_premium_plans_v1',
  ];
  for (const name of names) {
    const body = functionBody(name);
    assert.match(body, /security\s+definer/i, `${name} must be SECURITY DEFINER`);
    assert.match(body, /set\s+search_path\s*=\s*''/i, `${name} must use an empty search_path`);
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+to\\s+authenticated`, 'i'));
  }
});
