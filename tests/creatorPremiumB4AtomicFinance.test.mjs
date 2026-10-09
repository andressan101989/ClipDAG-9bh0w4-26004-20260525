import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_creator_premium_b4_atomic_finance_authority.sql'));
const migrationPath = matches.length === 1
  ? new URL(`../supabase/migrations/${matches[0]}`, import.meta.url)
  : null;
const migration = migrationPath && existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

test('B4 uses exactly one generated migration and no parallel financial authority', () => {
  assert.equal(matches.length, 1, 'exactly one generated B4 migration must exist');
  assert.match(matches[0], /^\d{14}_creator_premium_b4_atomic_finance_authority\.sql$/);
  assert.doesNotMatch(migration, /create\s+table\s+(?:public\.|private\.)?(?:premium_)?(?:wallet|ledger|balance|escrow)(?:s|_accounts|_entries)?\b/i);
  assert.doesNotMatch(migration, /create\s+table\s+(?:public\.|private\.)?financial_transactions\b/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:purchase_exclusive_content|subscribe_to_creator)\b/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.atomic_ledger_transfer\b/i);
});

test('B4 creates one private forced-RLS finance policy in a disabled zero-fee state', () => {
  assert.match(migration, /create\s+table\s+private\.creator_premium_finance_policy/i);
  assert.match(migration, /singleton\s+boolean\s+primary\s+key[\s\S]*check\s*\(\s*singleton\s*=\s*true\s*\)/i);
  assert.match(migration, /purchase_enabled\s+boolean\s+not\s+null/i);
  assert.match(migration, /subscription_enabled\s+boolean\s+not\s+null/i);
  assert.match(migration, /refunds_enabled\s+boolean\s+not\s+null/i);
  assert.match(migration, /platform_fee_bps\s+integer\s+not\s+null[\s\S]*between\s+0\s+and\s+9999/i);
  assert.match(migration, /insert\s+into\s+private\.creator_premium_finance_policy[\s\S]*false[\s\S]*false[\s\S]*false[\s\S]*0/i);
  assert.match(migration, /alter\s+table\s+private\.creator_premium_finance_policy\s+enable\s+row\s+level\s+security/i);
  assert.match(migration, /alter\s+table\s+private\.creator_premium_finance_policy\s+force\s+row\s+level\s+security/i);
  assert.match(migration, /revoke\s+all\s+on\s+table\s+private\.creator_premium_finance_policy\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('B4 snapshots plan periods, receipt splits, period splits, cancellation and refunds', () => {
  assert.match(migration, /alter\s+table\s+private\.creator_premium_plans[\s\S]*add\s+column\s+billing_period_days\s+integer\s+not\s+null/i);
  assert.match(migration, /billing_period_days\s+between\s+1\s+and\s+365/i);

  const receiptFields = [
    'request_fingerprint', 'gross_amount_bdag', 'platform_fee_bdag', 'creator_net_bdag',
    'platform_fee_bps', 'buyer_account_id', 'creator_account_id', 'platform_account_id',
    'refund_idempotency_key', 'refund_request_fingerprint', 'refund_reason_code', 'refunded_at',
  ];
  const periodFields = [
    'idempotency_key', 'request_fingerprint', 'billing_period_days', 'gross_amount_bdag',
    'platform_fee_bdag', 'creator_net_bdag', 'platform_fee_bps', 'subscriber_account_id',
    'creator_account_id', 'platform_account_id', 'refund_idempotency_key',
    'refund_request_fingerprint', 'refund_reason_code', 'refunded_at',
  ];
  for (const field of receiptFields) assert.match(migration, new RegExp(`creator_premium_purchase_receipts[\\s\\S]*add\\s+column\\s+${field}\\b`, 'i'));
  for (const field of periodFields) assert.match(migration, new RegExp(`creator_premium_subscription_periods[\\s\\S]*add\\s+column\\s+${field}\\b`, 'i'));
  assert.match(migration, /creator_premium_subscriptions[\s\S]*add\s+column\s+cancel_idempotency_key\b/i);
  assert.match(migration, /creator_premium_subscriptions[\s\S]*add\s+column\s+cancel_request_fingerprint\b/i);
  assert.match(migration, /gross_amount_bdag\s*=\s*creator_net_bdag\s*\+\s*platform_fee_bdag/i);
  assert.match(migration, /gross_amount_bdag\s*=\s*round\s*\(\s*gross_amount_bdag\s*,\s*8\s*\)/i);
  assert.match(migration, /creator_net_bdag\s*=\s*round\s*\(\s*creator_net_bdag\s*,\s*8\s*\)/i);
  assert.match(migration, /platform_fee_bdag\s*=\s*round\s*\(\s*platform_fee_bdag\s*,\s*8\s*\)/i);
  assert.match(migration, /unique\s+index[\s\S]*creator_premium_purchase_receipts[\s\S]*buyer_id\s*,\s*content_id[\s\S]*access_state\s*=\s*'active'/i);
  assert.match(migration, /creator_premium_subscription_periods_state_name_check[\s\S]*'refunded'/i);
});

test('B4 freezes activated financial identity and non-draft plan grant mappings', () => {
  assert.match(migration, /function\s+private\.guard_creator_premium_offer_financial_identity_v1\(\)/i);
  assert.match(migration, /old\.status\s+in\s*\(\s*'active'\s*,\s*'retired'\s*\)/i);
  for (const field of ['content_id', 'creator_id', 'version', 'price_bdag', 'currency', 'activated_at']) {
    assert.match(migration, new RegExp(`new\\.${field}\\s+is\\s+distinct\\s+from\\s+old\\.${field}`, 'i'));
  }
  assert.match(migration, /function\s+private\.guard_creator_premium_plan_financial_identity_v1\(\)/i);
  for (const field of ['creator_id', 'plan_key', 'version', 'price_bdag', 'currency', 'billing_period_days', 'activated_at']) {
    assert.match(migration, new RegExp(`new\\.${field}\\s+is\\s+distinct\\s+from\\s+old\\.${field}`, 'i'));
  }
  assert.match(migration, /function\s+private\.guard_creator_premium_plan_content_v1\(\)/i);
  assert.match(migration, /plan\.status\s*<>\s*'draft'/i);
  assert.match(migration, /access_mode\s+not\s+in\s*\(\s*'subscription'\s*,\s*'purchase_or_subscription'\s*\)/i);
});

test('B4 adds canonical age, platform, split, composer and exact binding helpers', () => {
  assert.match(migration, /function\s+private\.creator_premium_actor_is_age_eligible_v1\(p_user_id\s+uuid\)/i);
  assert.match(migration, /private\.user_age_eligibility/i);
  assert.match(migration, /private\.age_eligibility_policy/i);
  assert.match(migration, /function\s+private\.resolve_creator_premium_platform_account_v1\(\)/i);
  assert.match(migration, /account_type\s*=\s*'platform'[\s\S]*owner_id\s+is\s+null[\s\S]*currency\s*=\s*'BDAG'/i);
  assert.match(migration, /function\s+private\.calculate_creator_premium_split_v1\(/i);
  assert.match(migration, /round\s*\(\s*p_gross\s*\*\s*p_platform_fee_bps\s*\/\s*10000\s*,\s*8\s*\)/i);
  assert.match(migration, /function\s+private\.post_creator_premium_charge_v1\(/i);
  assert.match(migration, /public\.ledger_debit\(/i);
  assert.match(migration, /public\.ledger_credit\(/i);
  assert.match(migration, /insert\s+into\s+public\.financial_transactions/i);
  assert.match(migration, /function\s+private\.creator_premium_purchase_binding_is_valid_v1\(/i);
  assert.match(migration, /function\s+private\.creator_premium_period_binding_is_valid_v1\(/i);
  assert.match(migration, /count\s*\(\s*\*\s*\)[\s\S]*(?:2|3)/i);
});

test('B4 hardens only creator_premium financial transactions and preserves exact reference vocabulary', () => {
  for (const operation of [
    'creator_premium_purchase', 'creator_premium_subscription',
    'creator_premium_purchase_refund', 'creator_premium_subscription_refund',
  ]) assert.match(migration, new RegExp(`'${operation}'`));
  for (const reference of ['creator_premium_purchase_receipt', 'creator_premium_subscription_period']) {
    assert.match(migration, new RegExp(`'${reference}'`));
  }
  assert.match(migration, /financial_transactions_creator_premium_integrity_check/i);
  assert.match(migration, /operation_type\s+not\s+like\s+'creator_premium_%'/i);
  assert.match(migration, /from_account_id\s+is\s+not\s+null[\s\S]*to_account_id\s+is\s+not\s+null[\s\S]*from_account_id\s*<>\s*to_account_id/i);
  assert.match(migration, /amount\s*=\s*round\s*\(\s*amount\s*,\s*8\s*\)/i);
  assert.match(migration, /fee_amount\s*>=\s*0[\s\S]*fee_amount\s*<\s*amount/i);
  assert.match(migration, /unique\s+index[\s\S]*financial_transactions[\s\S]*operation_type\s*,\s*reference_type\s*,\s*reference_id[\s\S]*creator_premium_/i);
  assert.match(migration, /unique\s+index[\s\S]*financial_transactions[\s\S]*operation_type\s*,\s*idempotency_key[\s\S]*creator_premium_/i);
});

test('B4 entitlement delegates paid access to exact financial binding validators', () => {
  assert.match(migration, /function\s+private\.resolve_creator_premium_entitlement_v1\(/i);
  assert.match(migration, /private\.creator_premium_purchase_binding_is_valid_v1\(/i);
  assert.match(migration, /private\.creator_premium_period_binding_is_valid_v1\(/i);
  assert.match(migration, /receipt\.access_state\s*=\s*'active'/i);
  assert.match(migration, /period\.access_state\s*=\s*'active'/i);
  assert.match(migration, /finance_tx\.status\s*=\s*'completed'/i);
});

test('B4 security-definer helpers use empty search paths', () => {
  assert.doesNotMatch(migration, /security\s+definer(?![\s\S]{0,160}set\s+search_path\s*=\s*'')/i);
});
