import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b7_full_functional_commercial_completion.sql'));
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : '';
const service = readFileSync(new URL('services/creatorPremiumService.ts', root), 'utf8');
const ledger = readFileSync(new URL('services/financial/ledgerClient.ts', root), 'utf8');

function functionBody(name, schema = '(?:public|private)') {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/);
  return end < 0 ? rest : rest.slice(0, end + 4);
}

test('commerce detail is content-id-only and exposes exact active offers/plans plus policy', () => {
  const body = functionBody('get_creator_premium_commerce_v1', 'public');
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /current_user_is_creator_exclusive_age_eligible/i);
  assert.match(body, /creator_premium_actor_is_operational_v1/i);
  assert.match(body, /creator_premium_pair_is_unblocked_v1/i);
  assert.match(body, /lifecycle_status\s*=\s*'published'/i);
  assert.match(body, /creator_premium_offer_versions/i);
  assert.match(body, /offer\.status\s*=\s*'active'/i);
  assert.match(body, /creator_premium_plans/i);
  assert.match(body, /plan\.status\s*=\s*'active'/i);
  assert.match(body, /price_bdag::text/i);
  assert.match(body, /creator_premium_finance_policy/i);
  assert.match(body, /resolve_creator_premium_entitlement_v1/i);
  for (const forbidden of ['object_key', 'bucket_name', 'cloudflare_uid', 'account_id', 'financial_transaction_id']) {
    assert.doesNotMatch(body, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
});

test('subscriber projection reports real relationship and paid-period state without auto-renew fiction', () => {
  const body = functionBody('get_my_creator_premium_subscriptions_v1', 'public');
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /creator_premium_subscriptions/i);
  assert.match(body, /creator_premium_subscription_periods/i);
  assert.match(body, /billing_period_days/i);
  assert.match(body, /gross_amount_bdag::text/i);
  assert.match(body, /paid_through_at/i);
  assert.match(body, /access_active/i);
  assert.match(body, /false[\s\S]*(?:auto_renew|renewal_supported)|(?:auto_renew|renewal_supported)[\s\S]*false/i);
  assert.match(body, /(?:pg_catalog\.)?least\s*\(\s*(?:pg_catalog\.)?greatest/i);
  assert.doesNotMatch(body, /insert\s+into\s+private\.creator_premium_subscription_periods/i);
});

test('creator summary is canonical, exact-string, refund-aware, and does not invent views', () => {
  const body = functionBody('get_my_creator_premium_commercial_summary_v1', 'public');
  const binding = functionBody('creator_premium_financial_fact_is_valid_v1', 'private');
  assert.match(body, /creator_premium_purchase_receipts/i);
  assert.match(body, /creator_premium_subscription_periods/i);
  assert.match(body, /creator_premium_financial_fact_is_valid_v1/i);
  assert.match(binding, /financial_transactions/i);
  assert.match(binding, /creator_premium_purchase_receipt/i);
  assert.match(binding, /creator_premium_subscription_period/i);
  assert.match(binding, /creator_premium_purchase_refund/i);
  assert.match(binding, /creator_premium_subscription_refund/i);
  assert.match(binding, /original\.status\s*=\s*case[\s\S]*'reversed'[\s\S]*'completed'/i);
  assert.match(binding, /reversal\.status\s*=\s*'completed'/i);
  assert.match(binding, /p_gross_amount_bdag\s*=\s*p_creator_net_bdag\s*\+\s*p_platform_fee_bdag/i);
  assert.match(binding, /round\s*\(\s*p_gross_amount_bdag\s*\*\s*p_platform_fee_bps\s*\/\s*10000/i);
  for (const leg of [
    'payer_gross_debit',
    'creator_net_credit',
    'platform_fee_credit',
    'creator_net_debit',
    'platform_fee_debit',
    'payer_gross_credit',
  ]) assert.match(binding, new RegExp(`financial_leg['"]?\\s*=\\s*['"]${leg}`, 'i'));
  assert.match(binding, /count\s*\(\s*\*\s*\)[\s\S]*case\s+when\s+p_platform_fee_bdag\s*=\s*0\s+then\s+2\s+else\s+3\s+end/i);
  for (const field of ['gross', 'platform_fee', 'creator_net', 'refund', 'net_retained']) {
    assert.match(body, new RegExp(field, 'i'));
  }
  assert.match(body, /::text/i);
  assert.match(body, /active_subscription_grants/i);
  assert.doesNotMatch(body, /views_count|conversion_rate|estimated_revenue/i);
  assert.doesNotMatch(body, /create\s+table/i);
});

test('admin refund wrappers require an explicit WRITE capability and delegate to B4 atomically', () => {
  const purchase = functionBody('admin_refund_creator_premium_purchase_v1', 'public');
  const period = functionBody('admin_refund_creator_premium_subscription_period_v1', 'public');
  for (const [body, target, delegated] of [
    [purchase, 'receipt', 'refund_creator_premium_purchase_v1'],
    [period, 'period', 'refund_creator_premium_subscription_period_v1'],
  ]) {
    assert.match(body, /admin_require_capability\s*\(\s*'creator_premium\.refunds\.write'/i);
    assert.match(body, /pg_advisory_xact_lock/i);
    assert.match(body, new RegExp(`p_${target}_id`, 'i'));
    assert.match(body, /request_fingerprint/i);
    assert.match(body, new RegExp(`public\\.${delegated}`, 'i'));
    assert.match(body, /admin_action_audit/i);
    assert.match(body, /financial_effect[\s\S]*true/i);
    assert.doesNotMatch(body, /ledger_debit|ledger_credit|update\s+public\.ledger_accounts/i);
  }
  const authority = functionBody('creator_premium_internal_finance_authority_v1', 'private');
  assert.match(authority, /creator_premium\.refunds\.write/i);
  assert.match(authority, /auth\.uid\(\)\s+is\s+not\s+null/i);
  assert.match(authority, /current_user\s*=\s*'postgres'/i);
});

test('finance policy and fee remain untouched by B7 migration', () => {
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_finance_policy/i);
  assert.doesNotMatch(sql, /insert\s+into\s+private\.creator_premium_finance_policy/i);
  assert.doesNotMatch(sql, /platform_fee_bps\s*=\s*\d+/i);
  assert.doesNotMatch(sql, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/i);
});

test('ledgerClient accepts stable UUID retries for Premium without client monetary authority', () => {
  assert.match(ledger, /idempotencyKey\??:\s*string/i);
  assert.match(ledger, /options:\s*\{[\s\S]*idempotencyKey\??:\s*string/i);
  assert.match(ledger, /UUID_RE\.test\(options\.idempotencyKey\)/i);
  for (const helper of ['purchaseContent', 'subscribeToPlan', 'cancelCreatorPremiumSubscription']) {
    const start = ledger.indexOf(`export async function ${helper}`);
    assert.notEqual(start, -1);
    const next = ledger.indexOf('\nexport async function ', start + 1);
    const body = ledger.slice(start, next < 0 ? undefined : next)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(body, /idempotencyKey/i);
    assert.doesNotMatch(body, /\b(?:amount|price|fee|creatorId|accountId|transactionId)\b/);
  }
});

test('creator Premium service adds only canonical RPC clients and keeps finance disabled', () => {
  assert.match(service, /CREATOR_PREMIUM_FINANCE_AVAILABLE:\s*boolean\s*=\s*false/i);
  for (const rpc of [
    'get_creator_premium_commerce_v1',
    'get_my_creator_premium_subscriptions_v1',
    'get_my_creator_premium_commercial_summary_v1',
    'reopen_my_creator_premium_rejected_v1',
    'report_creator_premium_content_v1',
  ]) assert.match(service, new RegExp(`rpc\\(\\s*['"]${rpc}['"]`, 'i'));
  assert.doesNotMatch(service, /\.from\(\s*['"]creator_premium_/i);
  assert.doesNotMatch(service, /platform_fee_bps\s*[:=]\s*(?:1000|10)/i);
});
