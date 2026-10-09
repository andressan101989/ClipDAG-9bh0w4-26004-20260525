import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b4_atomic_finance_authority.sql'));
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : '';

const c1Matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b4_c1_exact_fee_snapshot_binding.sql'));
const c1Sql = c1Matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${c1Matches[0]}`, import.meta.url), 'utf8')
  : '';

const functionBody = name => {
  const start = sql.search(new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+(?:public|private)\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const end = sql.indexOf('\n$$;', start);
  return end < 0 ? sql.slice(start) : sql.slice(start, end + 4);
};

const c1FunctionBody = name => {
  const start = c1Sql.search(new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+(?:public|private)\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const end = c1Sql.indexOf('\n$$;', start);
  return end < 0 ? c1Sql.slice(start) : c1Sql.slice(start, end + 4);
};

test('purchase authority derives every financial fact and binds one active receipt atomically', () => {
  const body = functionBody('purchase_creator_premium_content_v1');
  assert.ok(body.length > 0);
  assert.match(body, /creator_premium_internal_finance_authority_v1/i);
  assert.match(body, /pg_advisory_xact_lock[\s\S]*p_buyer_id[\s\S]*p_idempotency_key/i);
  assert.match(body, /creator_premium_finance_policy[\s\S]*purchase_enabled/i);
  assert.match(body, /creator_premium_actor_is_age_eligible_v1\(p_buyer_id\)/i);
  assert.match(body, /creator_premium_actor_is_operational_v1\(p_buyer_id\)/i);
  assert.match(body, /creator_premium_pair_is_unblocked_v1\(p_buyer_id\s*,\s*v_content\.creator_id\)/i);
  assert.match(body, /lifecycle_status\s*<>\s*'published'/i);
  assert.match(body, /access_mode\s+not\s+in\s*\(\s*'purchase'\s*,\s*'purchase_or_subscription'\s*\)/i);
  assert.match(body, /creator_premium_offer_versions[\s\S]*status\s*=\s*'active'[\s\S]*for\s+(?:no\s+key\s+)?update/i);
  assert.match(body, /creator_premium_purchase_receipts[\s\S]*access_state\s*=\s*'active'/i);
  assert.match(body, /private\.post_creator_premium_charge_v1/i);
  assert.match(body, /insert\s+into\s+private\.creator_premium_purchase_receipts/i);
  assert.match(body, /creator_premium_purchase_idempotency_conflict/i);
  assert.match(body, /already_owned/i);
  assert.match(body, /money_moved/i);
  assert.doesNotMatch(body, /p_(?:price|amount|fee|gross|net|creator_id|account_id|transaction_id)\b/i);
});

test('subscription authority implements an initial period only with exact plan grant and period snapshot', () => {
  const body = functionBody('subscribe_creator_premium_plan_v1');
  assert.ok(body.length > 0);
  assert.match(body, /creator_premium_finance_policy[\s\S]*subscription_enabled/i);
  assert.match(body, /creator_premium_actor_is_age_eligible_v1\(p_subscriber_id\)/i);
  assert.match(body, /creator_premium_plans[\s\S]*v_plan\.status\s*<>\s*'active'/i);
  assert.match(body, /billing_period_days/i);
  assert.match(body, /creator_premium_plan_contents/i);
  assert.match(body, /access_mode\s+in\s*\(\s*'subscription'\s*,\s*'purchase_or_subscription'\s*\)/i);
  assert.match(body, /creator_premium_subscription_renewal_not_implemented/i);
  assert.match(body, /private\.post_creator_premium_charge_v1/i);
  assert.match(body, /insert\s+into\s+private\.creator_premium_subscriptions/i);
  assert.match(body, /insert\s+into\s+private\.creator_premium_subscription_periods/i);
  assert.match(body, /paid_through_at[\s\S]*billing_period_days/i);
  assert.doesNotMatch(body, /p_(?:price|amount|fee|gross|net|creator_id|account_id|transaction_id)\b/i);
});

test('cancellation is idempotent and contains no ledger mutation', () => {
  const body = functionBody('cancel_creator_premium_subscription_v1');
  assert.ok(body.length > 0);
  assert.match(body, /subscriber_id\s*=\s*p_subscriber_id/i);
  assert.match(body, /status\s*=\s*'cancelled'/i);
  assert.match(body, /cancel_idempotency_key/i);
  assert.match(body, /cancel_request_fingerprint/i);
  assert.doesNotMatch(body, /ledger_(?:debit|credit)|financial_transactions|post_creator_premium_charge/i);
});

test('purchase and subscription refunds validate original binding and perform exact full reversal', () => {
  const reversal = functionBody('post_creator_premium_refund_v1');
  assert.match(reversal, /public\.ledger_debit\([\s\S]*p_creator_net_bdag/i);
  assert.match(reversal, /p_platform_fee_bdag\s*>\s*0[\s\S]*public\.ledger_debit/i);
  assert.match(reversal, /public\.ledger_credit\([\s\S]*p_gross_amount_bdag/i);
  assert.match(reversal, /creator_premium_refund_source_balance_insufficient/i);

  const cases = [
    ['refund_creator_premium_purchase_v1', 'creator_premium_purchase_binding_is_valid_v1', 'creator_premium_purchase_refund', 'creator_premium_purchase_receipt'],
    ['refund_creator_premium_subscription_period_v1', 'creator_premium_period_binding_is_valid_v1', 'creator_premium_subscription_refund', 'creator_premium_subscription_period'],
  ];
  for (const [name, validator, operation, reference] of cases) {
    const body = functionBody(name);
    assert.ok(body.length > 0, name);
    assert.match(body, /creator_premium_finance_policy[\s\S]*refunds_enabled/i);
    assert.match(body, new RegExp(`private\\.${validator}\\(`, 'i'));
    assert.match(body, new RegExp(`'${operation}'`));
    assert.match(body, new RegExp(`'${reference}'`));
    assert.match(body, /private\.post_creator_premium_refund_v1/i);
    assert.match(body, /status\s*=\s*'reversed'/i);
    assert.match(body, /access_state\s*=\s*'refunded'/i);
    assert.match(body, /creator_premium_refund_source_balance_insufficient/i);
    assert.doesNotMatch(body, /partial|negative\s+balance|debt/i);
  }
  assert.match(functionBody('refund_creator_premium_subscription_period_v1'), /status\s*=\s*'revoked'/i);
});

test('all public B4 commands are service-role-only and defend internal authority', () => {
  assert.match(sql, /function\s+private\.creator_premium_internal_finance_authority_v1\(\)/i);
  assert.match(sql, /request\.jwt\.claim\.role|auth\.role\(\)/i);
  const commands = [
    ['purchase_creator_premium_content_v1', 'uuid,uuid,uuid'],
    ['subscribe_creator_premium_plan_v1', 'uuid,uuid,uuid'],
    ['cancel_creator_premium_subscription_v1', 'uuid,uuid,uuid'],
    ['refund_creator_premium_purchase_v1', 'uuid,uuid,text'],
    ['refund_creator_premium_subscription_period_v1', 'uuid,uuid,text'],
  ];
  for (const [name, signature] of commands) {
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+to\\s+service_role`, 'i'));
    assert.doesNotMatch(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)\\s+to\\s+(?:public|anon|authenticated)`, 'i'));
    assert.match(functionBody(name), /security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
  }
});

test('B4 financial metadata and identity use exact canonical transaction and ledger vocabulary', () => {
  const charge = functionBody('post_creator_premium_charge_v1');
  assert.match(charge, /financial_transaction_id\s*:=\s*gen_random_uuid\(\)/i);
  assert.match(charge, /insert\s+into\s+public\.financial_transactions[\s\S]*financial_transaction_id/i);
  assert.match(charge, /public\.ledger_debit\(\s*financial_transaction_id/i);
  assert.match(charge, /public\.ledger_credit\(\s*financial_transaction_id/i);
  for (const field of ['fin_txn_id', 'reference_type', 'reference_id', 'financial_leg']) {
    assert.match(charge, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:purchase_exclusive_content|subscribe_to_creator)\b/i);
});

test('entitlement binding ties every snapshot account to its canonical owner and account type', () => {
  for (const name of [
    'creator_premium_purchase_binding_is_valid_v1',
    'creator_premium_period_binding_is_valid_v1',
  ]) {
    const body = functionBody(name);
    assert.match(body, /join\s+public\.ledger_accounts\s+payer_account/i);
    assert.match(body, /payer_account\.account_type\s*=\s*'user'/i);
    assert.match(body, /join\s+public\.ledger_accounts\s+creator_account/i);
    assert.match(body, /creator_account\.account_type\s*=\s*'user'/i);
    assert.match(body, /join\s+public\.ledger_accounts\s+platform_account/i);
    assert.match(body, /platform_account\.owner_id\s+is\s+null/i);
    assert.match(body, /platform_account\.account_type\s*=\s*'platform'/i);
  }
});

test('B4-C1 entitlement validators independently reject fee snapshots that disagree with policy bps', () => {
  assert.equal(c1Matches.length, 1, 'exactly one generated B4-C1 migration must exist');
  for (const [name, alias] of [
    ['creator_premium_purchase_binding_is_valid_v1', 'receipt'],
    ['creator_premium_period_binding_is_valid_v1', 'period'],
  ]) {
    const body = c1FunctionBody(name);
    assert.ok(body.length > 0, name);
    assert.match(body, new RegExp(`${alias}\\.platform_fee_bdag\\s*=\\s*pg_catalog\\.round\\s*\\(\\s*${alias}\\.gross_amount_bdag\\s*\\*\\s*${alias}\\.platform_fee_bps\\s*\\/\\s*10000\\s*,\\s*8\\s*\\)`, 'i'));
  }
});
