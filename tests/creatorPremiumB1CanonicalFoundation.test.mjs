import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

function candidateMigration() {
  const matches = readdirSync(migrationsDir)
    .filter(name => name.endsWith('_creator_premium_b1_canonical_foundation.sql'));
  assert.equal(matches.length, 1, 'exactly one B1 migration must exist');
  return readFileSync(join(migrationsDir, matches[0]), 'utf8');
}

const tableNames = [
  'creator_premium_contents',
  'creator_premium_offer_versions',
  'creator_premium_plans',
  'creator_premium_plan_contents',
  'creator_premium_purchase_receipts',
  'creator_premium_subscriptions',
  'creator_premium_subscription_periods',
];

test('B1 creates one private, force-RLS Premium domain with no client table grants', () => {
  const sql = candidateMigration();
  for (const table of tableNames) {
    assert.match(sql, new RegExp(`create table private\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated, service_role`, 'i'));
  }
  assert.doesNotMatch(sql, /create table (?:public\.)?(?:exclusive_content|content_purchases|subscription_plans|creator_subscriptions|premium_dm_config|premium_dm_payments)\b/i);
});

test('B1 entitlement is server-derived and reuses canonical age/account/block/finance truth', () => {
  const sql = candidateMigration();
  assert.match(sql, /private\.resolve_creator_premium_entitlement_v1\s*\(/i);
  assert.match(sql, /private\.current_user_is_creator_exclusive_age_eligible\s*\(\s*\)/i);
  assert.match(sql, /auth\.uid\s*\(\s*\)/i);
  assert.match(sql, /auth\.users/i);
  assert.match(sql, /banned_until/i);
  assert.match(sql, /deleted_at/i);
  assert.match(sql, /public\.blocked_users/i);
  assert.match(sql, /public\.financial_transactions/i);
  assert.match(sql, /status\s*=\s*'completed'/i);
  assert.doesNotMatch(sql, /create table private\.creator_premium_entitlements\b/i);
});

test('B1 publishes only narrow, age-gated, fixed-search-path RPCs', () => {
  const sql = candidateMigration();
  for (const name of [
    'get_creator_premium_catalog_v1',
    'create_my_creator_premium_draft_v1',
    'update_my_creator_premium_draft_v1',
    'get_my_creator_premium_contents_v1',
    'get_my_creator_premium_entitlement_v1',
    'get_my_creator_premium_library_v1',
  ]) {
    assert.match(sql, new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}`, 'i'));
  }
  assert.match(sql, /security definer[\s\S]*?set search_path\s*=\s*''/i);
  assert.match(sql, /creator_premium_invalid_limit/i);
  assert.match(sql, /p_limit\s+integer\s+default\s+24/i);
  assert.match(sql, /p_limit\s+between\s+1\s+and\s+100/i);
  assert.doesNotMatch(sql, /create (?:or replace )?function public\.[a-z0-9_]*(?:purchase|subscribe|refund|renew|publish|payout)[a-z0-9_]*\s*\(/i);
});

test('B1 never exposes Premium originals or creates financial movement', () => {
  const sql = candidateMigration();
  for (const forbidden of [
    'object_key', 'bucket_name', 'content_url', 'preview_url', 'hls_url',
    'dash_url', 'cloudflare_uid', 'atomic_ledger_transfer', 'ledger_debit', 'ledger_credit',
  ]) {
    assert.doesNotMatch(sql, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
  assert.match(sql, /revoke all on function public\.cancel_unpublished_exclusive_content\(uuid\)\s+from public, anon, authenticated/i);
});
