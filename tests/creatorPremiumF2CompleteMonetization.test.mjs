import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_f2_complete_monetization.sql'));
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : '';
const ledger = readFileSync(new URL('services/financial/ledgerClient.ts', root), 'utf8');
const premium = readFileSync(new URL('services/creatorPremiumService.ts', root), 'utf8');
const offer = readFileSync(new URL('app/creator-premium-offer/[contentId].tsx', root), 'utf8');
const subscriptions = readFileSync(new URL('app/my-subscriptions.tsx', root), 'utf8');
const monetization = readFileSync(new URL('app/creator-monetization.tsx', root), 'utf8');
const library = readFileSync(new URL('app/my-premium-library.tsx', root), 'utf8');
const creatorProfile = readFileSync(new URL('app/creator/[id].tsx', root), 'utf8');
const profile = readFileSync(new URL('app/(tabs)/profile.tsx', root), 'utf8');
const adminApi = readFileSync(new URL('apps/admin-web/src/lib/adminObservabilityApi.ts', root), 'utf8');
const adminPage = readFileSync(new URL('apps/admin-web/src/pages/AdminFinanceAuditSystemPages.tsx', root), 'utf8');

function functionBody(name, schema = '(?:public|private)') {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/);
  return end < 0 ? rest : rest.slice(0, end + 4);
}

test('F2 is one forward-only migration and never enables production Finance', () => {
  assert.equal(matches.length, 1, 'expected one F2 migration');
  assert.match(matches[0], /^\d{14}_creator_premium_f2_complete_monetization\.sql$/);
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /platform_fee_bps\s*=\s*[1-9]/i);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.(?:ledger|wallet|escrow)/i);
  assert.doesNotMatch(sql, /pg_catalog\.coalesce\s*\(/i);
  const velocity = functionBody('check_velocity_limit', 'public');
  assert.match(velocity, /set\s+search_path\s*=\s*''/i);
  assert.match(velocity, /public\.velocity_counters/i);
  assert.match(velocity, /public\.suspicious_activity_logs/i);
});

test('renewal reuses B4 subscribe authority with immutable relationship-per-period history', () => {
  assert.match(sql, /drop\s+constraint\s+creator_premium_subscriptions_relationship_key/i);
  assert.match(sql, /create\s+unique\s+index[\s\S]*creator_premium_subscriptions[\s\S]*where[\s\S]*status\s+in\s*\(\s*'pending'\s*,\s*'active'\s*,\s*'cancelled'\s*\)/i);
  const body = functionBody('subscribe_creator_premium_plan_v1', 'public');
  assert.match(body, /creator-premium-subscription-family\|/i);
  assert.match(body, /creator-premium-plan-version:/i);
  assert.match(body, /family_plan\.plan_key\s*=\s*v_plan\.plan_key/i);
  assert.match(body, /creator_premium_plan_family_access_active/i);
  assert.match(body, /for\s+update/i);
  assert.match(body, /paid_through_at\s*>\s*v_now/i);
  assert.match(body, /access_state\s*=\s*'expired'/i);
  assert.match(body, /status\s*=\s*'expired'/i);
  assert.match(body, /insert\s+into\s+private\.creator_premium_subscriptions/i);
  assert.match(body, /insert\s+into\s+private\.creator_premium_subscription_periods/i);
  assert.match(body, /'renewed'/i);
  assert.match(body, /'auto_renew'\s*,\s*false/i);
  assert.match(body, /creator-premium-velocity\|creator_premium_subscribe/i);
  assert.match(body, /check_velocity_limit\([\s\S]*creator_premium_subscribe[\s\S]*20[\s\S]*24\s*\)/i);
  assert.doesNotMatch(body, /renewal_not_implemented/i);
});

test('purchase receipts cross the JSON boundary as exact money strings', () => {
  const body = functionBody('purchase_creator_premium_content_v1', 'public');
  assert.ok(body.length > 3_000, 'the canonical B4 purchase authority must be replaced in place');
  for (const field of ['gross_amount_bdag', 'platform_fee_bdag', 'creator_net_bdag']) {
    assert.match(
      body,
      new RegExp(`'${field}'[\\s\\S]*?${field}::numeric\\(38,8\\)::text`, 'i'),
    );
  }
  assert.match(body, /creator-premium-velocity\|creator_premium_purchase/i);
  assert.match(body, /check_velocity_limit\([\s\S]*creator_premium_purchase[\s\S]*100[\s\S]*1\s*\)/i);
  assert.match(body, /creator_premium_velocity_check_unavailable/i);
  assert.match(body, /creator_premium_rate_limited/i);
  assert.doesNotMatch(body, /create\s+function\s+public\.purchase_creator_premium_f2/i);
});

test('subscription replay backfills the F2 journal for historical B4 periods', () => {
  const body = functionBody('subscribe_creator_premium_plan_v1', 'public');
  assert.match(body, /creator_premium_subscription_periods[\s\S]*idempotency_key\s*=\s*p_idempotency_key/i);
  assert.match(body, /creator_premium_subscription_period_fact_is_valid_f2_v1/i);
  assert.match(body, /insert\s+into\s+public\.idempotency_keys[\s\S]*'creator_premium_subscription_command'/i);
  assert.match(body, /'money_moved'\s*,\s*false[\s\S]*'replayed'\s*,\s*true/i);
  assert.doesNotMatch(body, /period\.plan_id\s*=\s*p_plan_id[\s\S]*period\.idempotency_key\s*=\s*p_idempotency_key/i);
  assert.match(body, /v_existing_period\.plan_id\s*<>\s*p_plan_id[\s\S]*creator_premium_subscription_idempotency_conflict/i);
});

test('subscription history projects elapsed paid periods as expired without mutating financial facts', () => {
  const body = functionBody('get_my_creator_premium_subscriptions_v1', 'public');
  assert.match(body, /v_now\s+timestamptz\s*:=\s*pg_catalog\.clock_timestamp\(\)/i);
  assert.match(body, /paid_through_at\s*<=\s*v_now[\s\S]*effective_status/i);
  assert.match(body, /paid_through_at\s*<=\s*v_now[\s\S]*effective_access_state/i);
  assert.match(body, /then\s+coalesce\(base\.ended_at,base\.paid_through_at\)\s+else\s+base\.ended_at\s+end\s+as\s+effective_ended_at/i);
  assert.match(body, /'status'\s*,\s*item\.effective_status/i);
  assert.match(body, /'access_state'\s*,\s*item\.effective_access_state/i);
  assert.match(body, /'ended_at'\s*,\s*item\.effective_ended_at/i);
  assert.doesNotMatch(body, /update\s+private\.creator_premium_(?:subscriptions|subscription_periods)/i);
  assert.match(subscriptions, /item\.status==='active'&&<Pressable/);
});

test('creator withdrawal closes new sales while preserving only previously acquired access', () => {
  const entitlement = functionBody('resolve_creator_premium_entitlement_v1', 'private');
  const retire = functionBody('retire_my_creator_premium_content_v1', 'public');
  const libraryRpc = functionBody('get_my_creator_premium_library_v1', 'public');
  assert.match(retire, /removal_reason\s*=\s*'creator_withdrawn'/i);
  assert.match(retire, /creator_premium_offer_versions[\s\S]*status\s*=\s*'retired'/i);
  assert.doesNotMatch(retire, /creator_premium_content_has_financial_history/i);
  assert.match(entitlement, /lifecycle_status='removed'[\s\S]*removal_reason='creator_withdrawn'/i);
  assert.match(entitlement, /period\.starts_at\s*<=\s*v_content\.removed_at/i);
  assert.match(entitlement, /lifecycle_status\s+in\s*\('quarantined','deleted'\)/i);
  assert.match(libraryRpc, /lifecycle_status='removed'[\s\S]*removal_reason='creator_withdrawn'/i);
});

test('period refunds affect their own relationship and preserve unrelated renewed access', () => {
  const body = functionBody('refund_creator_premium_subscription_period_v1', 'public');
  assert.match(body, /where\s+id\s*=\s*v_period\.subscription_id/i);
  assert.match(body, /creator_premium_subscription_periods[\s\S]*subscription_id\s*<>\s*v_period\.subscription_id/i);
  assert.doesNotMatch(body, /where\s+subscriber_id\s*=\s*v_period\.subscriber_id[\s\S]*status\s*=\s*'revoked'/i);
  assert.match(body, /money_moved/i);
  assert.match(body, /already_refunded/i);
});

test('F2 adds safe caller history and one admin finance supervision authority', () => {
  for (const name of [
    'get_my_creator_premium_financial_history_v1',
    'search_admin_creator_premium_finance_v1',
  ]) {
    const body = functionBody(name, 'public');
    assert.ok(body.length > 300, `${name} must exist`);
    assert.match(body, /security\s+definer/i);
    assert.match(body, /set\s+search_path\s*=\s*''/i);
    assert.doesNotMatch(body, /object_key|bucket_name|cloudflare_uid|signed_url|secret/i);
  }
  assert.match(functionBody('get_my_creator_premium_financial_history_v1', 'public'), /auth\.uid\(\)/i);
  const admin = functionBody('search_admin_creator_premium_finance_v1', 'public');
  assert.match(admin, /finance\.ledger\.read/i);
  assert.match(admin, /creator_premium_financial_fact_is_valid_v1/i);
  assert.match(admin, /integrity|reconciliation/i);
  assert.match(admin, /duplicate_open_relationships[\s\S]*plan\.plan_key/i);
  assert.doesNotMatch(admin, /\bupdate\b|\binsert\b|\bdelete\b/i);
});

test('commerce preflight mirrors the plan-family overlap authority', () => {
  const body = functionBody('get_creator_premium_commerce_v1', 'public');
  assert.match(body, /v_now\s+timestamptz\s*:=\s*pg_catalog\.clock_timestamp\(\)/i);
  assert.match(body, /relationship_plan\.plan_key\s*=\s*active_plan\.plan_key/i);
  assert.match(body, /relationship_plan_id/i);
  assert.match(body, /paid_through_at\s*<=\s*v_now[\s\S]*relationship_status/i);
  assert.match(body, /paid_through_at\s*<=\s*v_now[\s\S]*relationship_access_state/i);
  assert.match(body, /creator_premium_plan_family_access_active/i);
});

test('F2 RPC ACLs are least privilege and private finance rows remain forced behind RLS', () => {
  for (const table of [
    'creator_premium_purchase_receipts',
    'creator_premium_subscriptions',
    'creator_premium_subscription_periods',
  ]) {
    assert.match(sql, new RegExp(`alter\\s+table\\s+private\\.${table}\\s+force\\s+row\\s+level\\s+security`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+(?:table\\s+)?private\\.${table}\\s+from\\s+public`, 'i'));
  }
  assert.match(sql, /get_my_creator_premium_financial_history_v1[\s\S]*grant\s+execute[\s\S]*to\s+authenticated/i);
  assert.match(sql, /search_admin_creator_premium_finance_v1[\s\S]*grant\s+execute[\s\S]*to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]*creator_premium_(?:purchase_receipts|subscriptions|subscription_periods)[\s\S]*to\s+(?:anon|authenticated)/i);
});

test('ledger client accepts only strict Premium receipts and never sends monetary authority', () => {
  assert.match(ledger, /parseCreatorPremiumPurchaseReceipt/i);
  assert.match(ledger, /parseCreatorPremiumSubscriptionReceipt/i);
  assert.match(ledger, /parseCreatorPremiumCancellationReceipt/i);
  assert.match(ledger, /creator_premium_subscription_receipt_invalid/i);
  for (const helper of ['purchaseContent', 'subscribeToPlan', 'cancelCreatorPremiumSubscription']) {
    const start = ledger.indexOf(`export async function ${helper}`);
    assert.notEqual(start, -1);
    const next = ledger.indexOf('\nexport async function ', start + 1);
    const body = ledger.slice(start, next < 0 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(body, /idempotencyKey/i);
    assert.doesNotMatch(body, /\b(?:amount|price|fee|creatorId|accountId|transactionId)\b/);
  }
});

test('mobile commerce is policy-driven, read-back verified and keeps stable ambiguous retries', () => {
  assert.doesNotMatch(premium, /CREATOR_PREMIUM_FINANCE_AVAILABLE\s*:\s*boolean\s*=\s*false/i);
  assert.match(premium, /get_my_creator_premium_financial_history_v1/i);
  assert.match(premium, /renewal_supported:\s*boolean/i);
  assert.match(offer, /commerce\?\.operations\.purchase_available/i);
  assert.match(offer, /commerce\.plans_truncated/i);
  assert.match(offer, /No se muestran todos los planes/i);
  assert.doesNotMatch(offer, /CREATOR_PREMIUM_FINANCE_AVAILABLE/i);
  assert.match(offer, /idempotencyKey/i);
  assert.match(offer, /read.?back|confirm/i);
  assert.match(offer, /creatorPremiumErrorMessage\(cause\)/);
  assert.match(subscriptions, /renew/i);
  assert.match(subscriptions, /idempotencyKey/i);
  assert.match(subscriptions, /read.?back|confirm/i);
  assert.match(subscriptions, /fetchMyCreatorPremiumSubscriptionsSnapshot\(items\.length\+1\)/i);
  assert.match(premium, /const maxPages\s*=\s*Math\.min\(100,\s*Math\.max\(1,\s*Math\.ceil\(minimumItems\s*\/\s*pageSize\)\)\)/i);
  assert.match(premium, /fetchMyCreatorPremiumSubscriptions\(\{\s*limit:\s*pageSize,\s*cursor\s*\}\)/i);
  assert.match(premium, /cursor\s*=\s*page\.nextCursor/i);
  assert.match(subscriptions, /const current=confirmed\.items\.find\(item=>item\.id===subscription\.id\)/i);
  assert.match(subscriptions, /creatorPremiumErrorMessage\(cause\)/);
  assert.match(monetization, /policy|finance/i);
  assert.match(monetization, /range/i);
  assert.match(monetization, /fetchMyCreatorPremiumFinancialHistory/i);
  assert.match(monetization, /!financialHistoryError\s*&&\s*financialHistory\.length\s*===\s*0/i);
  assert.match(monetization, /historyPageGeneration/i);
  assert.match(monetization, /canonical_account_balance_bdag/i);
  assert.match(monetization, /transaction\.event_type\s*===\s*'refund'\s*\?\s*'−'\s*:\s*'\+'/i);
  assert.match(library, /fetchMyCreatorPremiumFinancialHistory/i);
  assert.match(library, /financialHistoryNextCursor/i);
  assert.match(library, /loadMoreHistory/i);
  assert.match(library, /history|historial/i);
  assert.match(library, /item\.event_type\s*===\s*'refund'\s*\?\s*'\+'\s*:\s*'−'/i);
  assert.doesNotMatch(library, /Las compras y suscripciones a[uú]n no est[aá]n habilitadas\./i);
  assert.doesNotMatch(creatorProfile, /Premium pronto|acceso comercial todav[ií]a no est[aá] disponible/i);
  assert.match(creatorProfile, /creator-premium-offer|Ver Premium/i);
});

test('no simulated likes-derived earnings remain in the profile', () => {
  assert.doesNotMatch(profile, /totalLikes\s*\*\s*0\.01/i);
  assert.doesNotMatch(profile, /dagEarned/i);
});

test('bdag-ledger pins the Supabase client dependency for managed releases', () => {
  const edge = readFileSync(new URL('supabase/functions/bdag-ledger/index.ts', root), 'utf8');
  assert.match(edge, /https:\/\/esm\.sh\/@supabase\/supabase-js@2\.106\.1['"]/);
  assert.doesNotMatch(edge, /https:\/\/esm\.sh\/@supabase\/supabase-js@2['"]/);
});

test('Admin Premium consumes read-only commerce and reconciliation authorities separately from refund writes', () => {
  assert.match(adminApi, /searchAdminCreatorPremiumFinance/i);
  assert.match(adminPage, /finance\.ledger\.read/i);
  assert.match(adminPage, /Reconciliaci[oó]n/i);
});

test('legacy Premium mutation routes remain fail-closed and F2 does not create a second gateway', () => {
  const edge = readFileSync(new URL('supabase/functions/bdag-ledger/index.ts', root), 'utf8');
  const integrationState = readFileSync(new URL('services/creatorPremiumIntegrationState.ts', root), 'utf8');
  assert.match(edge, /action\s*===\s*'purchase'\s*\|\|\s*action\s*===\s*'subscribe'/i);
  assert.match(edge, /creator_premium_legacy_action_disabled[\s\S]*410/i);
  assert.equal((edge.match(/creator_premium_subscribe/g) ?? []).length > 0, true);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:purchase|subscribe)_creator_premium_f2/i);
  assert.doesNotMatch(edge, /enforcePremiumVelocity/i);
  assert.match(edge, /creator_premium_velocity_check_unavailable[\s\S]*503/i);
  assert.match(edge, /creator_premium_rate_limited[\s\S]*429/i);
  assert.match(integrationState, /creator_premium_velocity_check_unavailable/i);
  assert.match(integrationState, /creator_premium_rate_limited/i);
});
