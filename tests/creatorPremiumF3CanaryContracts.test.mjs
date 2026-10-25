import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as finance from '../services/creatorPremiumFinanceContracts.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = { buyer: uuid(1), content: uuid(2), offer: uuid(3), key: uuid(4), creator: uuid(5), plan: uuid(6) };
const policy = {
  purchase_enabled: true, subscription_enabled: true, refunds_enabled: true,
  platform_fee_bps: 1000, policy_version: 'creator-premium-f3-v1',
};
const commerce = {
  content: { id: id.content, creator_id: id.creator, title: 'Synthetic canary', description: '',
    content_kind: 'image', access_mode: 'purchase_or_subscription',
    teaser_url: 'https://example.invalid/teaser.jpg', published_at: '2026-10-25T00:00:00Z' },
  creator: { id: id.creator, username: 'synthetic', display_name: null, avatar_url: null },
  offer: { id: id.offer, version: 1, price_bdag: '10.00000000', currency: 'BDAG', status: 'active' },
  plans: [{ id: id.plan, name: 'Manual', description: '', version: 1,
    price_bdag: '20.00000000', currency: 'BDAG', billing_period_days: 30, status: 'active',
    relationship: null, subscription_available: false,
    subscription_blocker: 'creator_premium_subscription_disabled', renewal_available: false,
    renewal_blocker: 'creator_premium_subscription_disabled' }],
  plan_count: 1, plans_truncated: false,
  entitlement: { allowed: false, source: 'none', reason: 'not_entitled', expires_at: null },
  operations: { purchase_available: false, purchase_blocker: 'creator_premium_purchase_disabled' },
  policy,
};

function load(file, require, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, console, ...globals }, { filename: file });
  return module.exports;
}

test('F3 foundation ships exactly one forward migration and no activation migration', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(name => name.includes('_creator_premium_f3_'));
  assert.deepEqual(names, ['20261025011000_creator_premium_f3_bounded_financial_activation.sql']);
});

test('mobile accepts effective-disabled canary blockers with the unchanged five-key policy', () => {
  assert.deepEqual(finance.parseCreatorPremiumCommerce(commerce, id.content), commerce);
  assert.equal(Object.keys(finance.parseCreatorPremiumFinancePolicy(policy)).length, 5);
  for (const blocker of ['creator_premium_canary_denied', 'creator_premium_canary_expired', 'public', '', null]) {
    const invalid = structuredClone(commerce);
    invalid.operations.purchase_blocker = blocker;
    assert.throws(() => finance.parseCreatorPremiumCommerce(invalid, id.content), /creator_premium_commerce_invalid/);
  }
  for (const extra of [{ activation_mode: 'canary' }, { active_authorization_id: uuid(8) }]) {
    assert.throws(() => finance.parseCreatorPremiumFinancePolicy({ ...policy, ...extra }), /creator_premium_/);
  }
  const invalid = structuredClone(commerce);
  invalid.plans[0].subscription_blocker = 'creator_premium_canary_denied';
  assert.throws(() => finance.parseCreatorPremiumCommerce(invalid, id.content), /creator_premium_commerce_invalid/);
});

test('F3 v2 parser accepts safe canary blockers without weakening the installed v1 contract', () => {
  assert.equal(typeof finance.parseCreatorPremiumCommerceV2, 'function', 'versioned canary commerce parser is missing');
  for (const blocker of ['creator_premium_canary_denied', 'creator_premium_canary_not_open',
    'creator_premium_canary_expired', 'creator_premium_canary_limit_reached']) {
    const projection = structuredClone(commerce);
    projection.operations.purchase_blocker = blocker;
    projection.plans[0].subscription_blocker = blocker;
    projection.plans[0].renewal_blocker = blocker;
    assert.deepEqual(finance.parseCreatorPremiumCommerceV2(projection, id.content), projection);
    assert.throws(() => finance.parseCreatorPremiumCommerce(projection, id.content), /creator_premium_commerce_invalid/);
  }
  const unknown = structuredClone(commerce);
  unknown.operations.purchase_blocker = 'creator_premium_canary_debug_private_actor';
  assert.throws(() => finance.parseCreatorPremiumCommerceV2(unknown, id.content), /creator_premium_commerce_invalid/);
});

test('F3 v2 subscription parser accepts capped renewal while v1 remains strict', () => {
  assert.equal(typeof finance.parseCreatorPremiumSubscriptionsPageV2, 'function', 'versioned subscription parser is missing');
  const relationship = { id: uuid(30), status: 'cancelled', cancelled_at: '2026-10-25T00:00:00Z',
    paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired' };
  const plan = { ...commerce.plans[0], relationship,
    subscription_blocker: 'creator_premium_renewal_required',
    renewal_blocker: 'creator_premium_canary_limit_reached' };
  const projection = { policy, items: [{
    id: relationship.id, creator: commerce.creator, plan, status: 'cancelled',
    started_at: '2026-09-26T00:00:00Z', cancelled_at: relationship.cancelled_at, ended_at: null,
    period: { id: uuid(31), starts_at: '2026-09-26T00:00:00Z', paid_through_at: relationship.paid_through_at,
      access_state: 'expired', gross_amount_bdag: '20.00000000' },
    access_active: false, auto_renew: false, renewal_supported: true,
    renewal_available: false, renewal_blocker: 'creator_premium_canary_limit_reached',
    is_latest_relationship: true, created_at: '2026-09-26T00:00:00Z', updated_at: relationship.cancelled_at,
  }], next_cursor: null };
  assert.deepEqual(finance.parseCreatorPremiumSubscriptionsPageV2(projection), projection);
  assert.throws(() => finance.parseCreatorPremiumSubscriptionsPage(projection), /creator_premium_subscriptions_invalid/);
  const unknown = structuredClone(projection);
  unknown.items[0].renewal_blocker = 'private_debug_unknown';
  assert.throws(() => finance.parseCreatorPremiumSubscriptionsPageV2(unknown), /creator_premium_subscriptions_invalid/);
});

test('purchase client preserves the displayed immutable offer version in the gateway command', async () => {
  const invokes = [];
  const receipt = { receipt_id: uuid(10), content_id: id.content, financial_transaction_id: uuid(11),
    gross_amount_bdag: '10.00000000', platform_fee_bdag: '1.00000000', creator_net_bdag: '9.00000000',
    access_state: 'active', already_owned: false, money_moved: true, replayed: false };
  const api = load('services/financial/ledgerClient.ts', name => {
    if (name === '@/template') return { getSupabaseClient: () => ({ functions: {
      async invoke(name, options) { invokes.push({ name, body: structuredClone(options.body) });
        return { data: { success: true, data: receipt }, error: null }; },
    } }) };
    if (name === '@/services/walletApi') return { getWithdrawalConfigFromBackend: async () => ({ minimumBdag: 1 }) };
    if (name === '@/services/creatorPremiumFinanceContracts.mjs') return finance;
    if (name === '@supabase/supabase-js') return { FunctionsHttpError: class extends Error {} };
    throw new Error(`Unexpected import ${name}`);
  }, { crypto: { randomUUID: () => id.key } });
  const result = await api.purchaseContent({ contentId: id.content, offerVersionId: id.offer, idempotencyKey: id.key });
  assert.equal(result.success, true);
  assert.deepEqual(invokes, [{ name: 'bdag-ledger', body: {
    action: 'creator_premium_purchase', content_id: id.content,
    offer_version_id: id.offer, idempotency_key: id.key,
  } }]);
});

function gateway() {
  let handler;
  const calls = [];
  const admin = { auth: { async getUser() { return { data: { user: { id: id.buyer } }, error: null }; } },
    async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return { data: { money_moved: false }, error: null }; } };
  load('supabase/functions/bdag-ledger/index.ts', name => {
    if (name.includes('@supabase/supabase-js')) return { createClient: () => admin };
    if (name.endsWith('/cors.ts')) return { corsHeaders: {} };
    throw new Error(`Unexpected import ${name}`);
  }, { Deno: { env: { get: () => 'synthetic-only' }, serve(fn) { handler = fn; } }, Request, Response });
  return { calls, async request(body) {
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test('gateway forwards the expected offer UUID and server-derived actor only', async () => {
  const api = gateway();
  const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content,
    offer_version_id: id.offer, idempotency_key: id.key });
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls, [{ name: 'purchase_creator_premium_content_v1', args: {
    p_buyer_id: id.buyer, p_content_id: id.content,
    p_offer_version_id: id.offer, p_idempotency_key: id.key,
  } }]);
});

test('gateway rejects a missing displayed offer before calling a money-moving RPC', async () => {
  const api = gateway();
  const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content, idempotency_key: id.key });
  assert.equal(response.status, 400);
  assert.equal(api.calls.length, 0);
});

test('gateway rejects malformed offer identities and all client money/account authority', async () => {
  for (const fields of [
    { offer_version_id: 'bad' }, { amount: '10.00000000' }, { price_bdag: '10.00000000' },
    { platform_fee_bps: 0 }, { creator_id: id.creator }, { buyer_account_id: uuid(12) }, { extra: true },
  ]) {
    const api = gateway();
    const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content,
      offer_version_id: id.offer, idempotency_key: id.key, ...fields });
    assert.equal(response.status, 400);
    assert.equal(api.calls.length, 0);
  }
});

// This is a separate read boundary: never widen the strict mobile policy or existing search response.
const activation = {
  mode: 'canary', authorization_id: uuid(20),
  charge_starts_at: '2026-10-25T00:00:00Z', charge_expires_at: '2026-10-25T00:30:00Z',
  refund_expires_at: '2026-10-25T01:00:00Z',
  operations: { purchase_enabled: true, subscription_enabled: true, refunds_enabled: true },
  limits: { purchase_count: 1, subscription_count: 1, refund_count: 1,
    purchase_amount_bdag: '10.00000000', subscription_amount_bdag: '20.00000000', gross_bdag: '30.00000000' },
  consumed: { purchase_count: 1, subscription_count: 0, refund_count: 0, gross_bdag: '10.00000000' },
  remaining: { purchase_count: 0, subscription_count: 1, refund_count: 1, gross_bdag: '20.00000000' },
};

function adminApi() {
  return load('apps/admin-web/src/lib/adminObservabilityApi.ts', name => {
    if (name === './supabase') return { supabase: { rpc: async () => ({ data: { activation }, error: null }) } };
    throw new Error(`Unexpected import ${name}`);
  });
}

test('Admin parses exact sanitized activation limits and consumption without discarding them', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function', 'separate authorized activation parser is required');
  assert.deepEqual(structuredClone(api.parseAdminCreatorPremiumFinanceActivation({ activation })), { activation });
});

test('Admin treats a pre-F3 missing activation as UNKNOWN during rollout', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function');
  assert.deepEqual(structuredClone(api.parseAdminCreatorPremiumFinanceActivation({})), { activation: null });
});

test('Admin rejects public mode, malformed amounts, invalid windows, overconsumption and private fields', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function');
  const invalid = [
    { ...activation, mode: 'public' },
    { ...activation, charge_starts_at: 'tomorrow' },
    { ...activation, charge_expires_at: '2026-10-24T23:59:59Z' },
    { ...activation, charge_expires_at: '2026-10-25T02:00:00Z' },
    { ...activation, refund_expires_at: '2026-10-24T23:59:59Z' },
    { ...activation, limits: { ...activation.limits, gross_bdag: 30 } },
    { ...activation, limits: { ...activation.limits, purchase_amount_bdag: '1e1' } },
    { ...activation, consumed: { ...activation.consumed, purchase_count: 2 } },
    { ...activation, consumed: { ...activation.consumed, purchase_count: 0.5 } },
    { ...activation, remaining: { ...activation.remaining, gross_bdag: '30.00000000' } },
    { ...activation, buyer_account_id: uuid(21) },
    { ...activation, mode: 'off' },
  ];
  for (const value of invalid) {
    assert.throws(() => api.parseAdminCreatorPremiumFinanceActivation({ activation: value }), /activation|inválida/i);
  }
});
