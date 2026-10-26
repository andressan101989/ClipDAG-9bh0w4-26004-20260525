import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const candidates = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_f4_general_bdag_activation.sql'));

function migrationSql() {
  assert.equal(candidates.length, 1,
    'F4 requires exactly one forward-only general activation migration');
  return readFileSync(new URL(candidates[0], migrations), 'utf8');
}

test('F4 has one forward-only migration after the Wallet integration baseline', () => {
  const sql = migrationSql();
  assert.match(candidates[0], /^20261026030000_creator_premium_f4_general_bdag_activation\.sql$/);
  assert.ok(candidates[0] > '20261025231500_creator_premium_f3_final_wallet_integration.sql');
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
    'PostgreSQL special expressions cannot be schema-qualified as functions');
});

test('F4 keeps one attested GENERAL provenance row rather than null authorization facts', () => {
  const sql = migrationSql();
  assert.match(sql, /add column authorization_scope text not null default 'CANARY'/i);
  assert.match(sql, /authorization_scope\s*=\s*'GENERAL'/i);
  assert.match(sql, /'f4000000-0000-4000-8000-000000000001'/i);
  assert.match(sql, /insert into private\.creator_premium_finance_owner_attestations_f3_c2/i);
  assert.match(sql, /insert into private\.creator_premium_finance_authorizations/i);
  assert.match(sql, /creator_premium_finance_configuration_digest_f4_v1/i);
  assert.match(sql, /creator_premium_finance_attestation_digest_f3_c2_v1/i);
});

test('F4 general scope has no buyer, creator, target, amount, count or expiry allowlist', () => {
  const sql = migrationSql();
  for (const field of [
    'buyer_id', 'creator_id', 'buyer_account_id', 'creator_account_id',
    'purchase_content_id', 'purchase_offer_version_id', 'subscription_plan_id',
    'purchase_amount_bdag', 'subscription_amount_bdag', 'max_purchase_count',
    'max_subscription_count', 'max_refund_count', 'max_gross_bdag',
    'charge_expires_at', 'refund_expires_at',
  ]) {
    assert.match(sql, new RegExp(`${field}\\s+is\\s+null`, 'i'),
      `GENERAL must not be allowlisted by ${field}`);
  }
  assert.match(sql, /platform_fee_bps\s*=\s*2000/i);
  assert.match(sql, /'client_contract'\s*,\s*'creator-premium-f3-v2'/i);
});

test('F4 activates all three operations at 2000 bps and retains an owner-only two-stage kill switch', () => {
  const sql = migrationSql();
  assert.match(sql, /activation_mode\s*=\s*'general'/i);
  assert.match(sql, /purchase_enabled\s*=\s*true/i);
  assert.match(sql, /subscription_enabled\s*=\s*true/i);
  assert.match(sql, /refunds_enabled\s*=\s*true/i);
  assert.match(sql, /current_user\s*<>\s*'postgres'/i);
  assert.match(sql, /old\.status\s*=\s*'OPEN'[\s\S]*?new\.status\s*=\s*'CLOSED'/i);
  assert.match(sql, /create or replace function private\.close_creator_premium_finance_authorization_f3_c2_v1/i);
  assert.match(sql, /create or replace function private\.finalize_creator_premium_finance_authorization_f3_c2_v1/i);
});

test('F4 keeps historical refunds provenance-bound instead of requiring the current authorization', () => {
  const sql = migrationSql();
  const refundStart = sql.indexOf('create or replace function private.admit_creator_premium_refund_f3_v1');
  const refundEnd = sql.indexOf('create or replace function private.assert_creator_premium_finance_deadline_f3_v1');
  assert.ok(refundStart >= 0 && refundEnd > refundStart);
  const refund = sql.slice(refundStart, refundEnd);
  assert.match(refund, /where\s+id\s*=\s*p_authorization_id/i);
  assert.match(refund, /status\s+not\s+in\s*\(\s*'OPEN'\s*,\s*'CLOSED'\s*\)/i);
  assert.doesNotMatch(refund, /p_authorization_id\s+is\s+distinct\s+from\s+v_policy\.active_authorization_id/i);
});

test('F4 migration cannot mint balances, transactions, receipts, periods or entitlements', () => {
  const sql = migrationSql().replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const target of [
    'public.ledger_accounts', 'public.ledger_entries', 'public.financial_transactions',
    'private.creator_premium_purchase_receipts',
    'private.creator_premium_subscription_periods',
    'private.creator_premium_subscriptions',
  ]) {
    assert.doesNotMatch(sql,
      new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+${target.replace('.', '\\.')}`, 'i'),
      `activation migration must not mutate ${target}`);
  }
});

test('F4 validates canonical BDAG accounts without denying unrelated account types', () => {
  const sql = migrationSql();
  const blockerStart = sql.indexOf(
    'create or replace function private.creator_premium_charge_blocker_f3_v1',
  );
  const blockerEnd = sql.indexOf(
    'create or replace function private.creator_premium_authorization_binding_f3_v1',
  );
  assert.ok(blockerStart >= 0 && blockerEnd > blockerStart);
  const blocker = sql.slice(blockerStart, blockerEnd);
  assert.match(blocker,
    /owner_id\s*=\s*p_buyer_id[\s\S]*?account_type\s*=\s*'user'[\s\S]*?currency\s*=\s*'BDAG'\)<>1/i);
  assert.match(blocker,
    /owner_id\s*=\s*p_buyer_id[\s\S]*?account_type\s*=\s*'user'[\s\S]*?currency\s*=\s*'BDAG'[\s\S]*?not account\.frozen\)<>1/i);
  assert.match(blocker,
    /owner_id\s*=\s*p_creator_id[\s\S]*?account_type\s*=\s*'user'[\s\S]*?currency\s*=\s*'BDAG'\)\s*>\s*1/i);
  assert.match(blocker,
    /owner_id\s*=\s*p_creator_id[\s\S]*?account_type\s*=\s*'user'[\s\S]*?currency\s*=\s*'BDAG'\s+and\s+account\.frozen/i);
  assert.doesNotMatch(blocker, /account\.currency\s*<>\s*'BDAG'/i,
    'unrelated currency accounts must not block the BDAG authority');
  assert.doesNotMatch(blocker,
    /owner_id\s+in\s*\(\s*p_buyer_id\s*,\s*p_creator_id\s*\)/i,
    'buyer and creator account validation must remain actor-specific');
});

test('existing private playback authorities remain entitlement-gated', () => {
  const stream = readFileSync(new URL('../supabase/functions/get-stream-playback/index.ts', import.meta.url), 'utf8');
  const image = readFileSync(new URL('../supabase/functions/get-media-url/index.ts', import.meta.url), 'utf8');
  for (const authority of [stream, image]) {
    assert.match(authority, /get_my_creator_premium_entitlement_v1/);
    assert.match(authority, /entitlement\?\.allowed\s*!==\s*true/);
  }
});

test('Admin activation contract distinguishes GENERAL from the final OFF state', () => {
  const sql = migrationSql();
  const start = sql.indexOf(
    'create or replace function public.get_admin_creator_premium_finance_activation_v1',
  );
  const end = sql.indexOf('-- Register exactly one owner attestation', start);
  assert.ok(start >= 0 && end > start);
  const admin = sql.slice(start, end);
  assert.match(admin, /if\s+v_authorization\.id\s+is\s+null\s+then/i);
  assert.match(admin, /'purchase_count'\s*,\s*0[\s\S]*?'gross_bdag'\s*,\s*'0\.00000000'/i);
  assert.match(admin, /elsif\s+v_authorization\.authorization_scope\s*=\s*'GENERAL'\s+then[\s\S]*?v_limits\s*:=\s*null[\s\S]*?v_remaining\s*:=\s*null/i);
});

test('F4 finalization validates refunded history with the canonical full-fact reconciler', () => {
  const sql = migrationSql();
  const start = sql.indexOf(
    'create or replace function private.finalize_creator_premium_finance_authorization_f3_c2_v1',
  );
  const end = sql.indexOf(
    'create or replace function public.get_admin_creator_premium_finance_activation_v1',
  );
  assert.ok(start >= 0 && end > start);
  const finalize = sql.slice(start, end);
  assert.equal((finalize.match(/creator_premium_financial_fact_is_valid_v1/g) ?? []).length, 2);
  assert.doesNotMatch(finalize, /creator_premium_purchase_binding_is_valid_v1/);
  assert.doesNotMatch(finalize, /creator_premium_subscription_period_fact_is_valid_f2_v1/);
});
