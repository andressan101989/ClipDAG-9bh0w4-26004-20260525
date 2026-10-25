import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import {
  parseCreatorPremiumCancellationReceipt,
  parseCreatorPremiumCommerce,
  parseCreatorPremiumCommerceV2,
  parseCreatorPremiumCommercialSummary,
  parseCreatorPremiumFinancePolicy,
  parseCreatorPremiumFinancialHistoryPage,
  parseCreatorPremiumSubscriptionsPage,
  parseCreatorPremiumSubscriptionsPageV2,
  parseCreatorPremiumPurchaseReceipt,
  parseCreatorPremiumSignedBdagText,
  parseCreatorPremiumSubscriptionReceipt,
} from '../services/creatorPremiumFinanceContracts.mjs';
import { creatorPremiumErrorMessage } from '../services/creatorPremiumIntegrationState.ts';
import { normalizeCreatorPremiumPriceBdag } from '../services/creatorPremiumMoney.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const contentId = '20000000-0000-4000-8000-000000000001';
const otherContentId = '20000000-0000-4000-8000-000000000002';
const planId = '30000000-0000-4000-8000-000000000001';
const otherPlanId = '30000000-0000-4000-8000-000000000002';
const subscriptionId = '40000000-0000-4000-8000-000000000001';
const otherSubscriptionId = '40000000-0000-4000-8000-000000000002';
const idempotencyKey = '50000000-0000-4000-8000-000000000001';
const receiptId = '60000000-0000-4000-8000-000000000001';
const periodId = '70000000-0000-4000-8000-000000000001';
const transactionId = '80000000-0000-4000-8000-000000000001';
const otherTransactionId = '80000000-0000-4000-8000-000000000002';
const creatorId = '90000000-0000-4000-8000-000000000001';
const offerId = 'a0000000-0000-4000-8000-000000000001';

const purchaseReceipt = Object.freeze({
  receipt_id: receiptId,
  content_id: contentId,
  financial_transaction_id: transactionId,
  gross_amount_bdag: '2000.00000000',
  platform_fee_bdag: '0.00000000',
  creator_net_bdag: '2000.00000000',
  access_state: 'active',
  already_owned: false,
  money_moved: true,
  replayed: false,
});

const subscriptionReceipt = Object.freeze({
  subscription_id: subscriptionId,
  period_id: periodId,
  plan_id: planId,
  financial_transaction_id: transactionId,
  gross_amount_bdag: '2000.00000000',
  platform_fee_bdag: '0.00000000',
  creator_net_bdag: '2000.00000000',
  billing_period_days: 30,
  starts_at: '2026-10-24T17:00:00.000Z',
  paid_through_at: '2026-11-23T17:00:00.000Z',
  status: 'active',
  already_subscribed: false,
  renewed: false,
  auto_renew: false,
  money_moved: true,
  replayed: false,
});

const cancellationReceipt = Object.freeze({
  subscription_id: subscriptionId,
  status: 'cancelled',
  paid_through_at: '2026-11-23T17:00:00.000Z',
  money_moved: false,
  replayed: false,
  already_cancelled: false,
});

const financialHistoryPage = Object.freeze({
  policy: {
    purchase_enabled: false,
    subscription_enabled: false,
    refunds_enabled: false,
    platform_fee_bps: 0,
    policy_version: 'creator-premium-b4-v1',
  },
  settlement_model: 'immediate_direct_credit',
  items: [{
    id: transactionId,
    source: 'purchase',
    event_type: 'charge',
    reference_id: receiptId,
    subscription_id: null,
    content: { id: contentId, title: 'Curso', lifecycle_status: 'published' },
    plan: null,
    gross_amount_bdag: '2000.00000000',
    platform_fee_bdag: '0.00000000',
    creator_net_bdag: '2000.00000000',
    access_state: 'active',
    relationship_status: null,
    occurred_at: '2026-10-24T17:00:00.000Z',
    starts_at: null,
    paid_through_at: null,
  }],
  next_cursor: { event_at: '2026-10-24T17:00:00.000Z', id: transactionId },
});

const financeOffPolicy = Object.freeze({
  purchase_enabled: false,
  subscription_enabled: false,
  refunds_enabled: false,
  platform_fee_bps: 0,
  policy_version: 'creator-premium-b4-v1',
});

const commerceProjection = Object.freeze({
  content: {
    id: contentId,
    creator_id: creatorId,
    title: 'Curso',
    description: '',
    content_kind: 'video',
    access_mode: 'purchase_or_subscription',
    teaser_url: 'https://cdn.example.test/teaser.jpg',
    published_at: '2026-10-24T17:00:00.000Z',
  },
  creator: {
    id: creatorId,
    username: 'creador',
    display_name: 'Creador',
    avatar_url: null,
  },
  offer: {
    id: offerId,
    version: 2,
    price_bdag: '2000.00000000',
    currency: 'BDAG',
    status: 'active',
  },
  plans: [{
    id: planId,
    name: 'VIP',
    description: '',
    version: 2,
    price_bdag: '2000.00000000',
    currency: 'BDAG',
    billing_period_days: 30,
    status: 'active',
    relationship: null,
    subscription_available: false,
    subscription_blocker: 'creator_premium_subscription_disabled',
    renewal_available: false,
    renewal_blocker: 'creator_premium_subscription_disabled',
  }],
  plan_count: 1,
  plans_truncated: false,
  entitlement: {
    allowed: false,
    source: 'none',
    reason: 'not_entitled',
    expires_at: null,
  },
  operations: {
    purchase_available: false,
    purchase_blocker: 'creator_premium_purchase_disabled',
  },
  policy: financeOffPolicy,
});

const subscriptionsProjection = Object.freeze({
  policy: financeOffPolicy,
  items: [{
    id: subscriptionId,
    creator: {
      id: creatorId,
      username: 'creador',
      display_name: 'Creador',
      avatar_url: null,
    },
    plan: {
      id: planId,
      name: 'VIP',
      description: '',
      version: 2,
      price_bdag: '2000.00000000',
      currency: 'BDAG',
      billing_period_days: 30,
      status: 'active',
      relationship: {
        id: subscriptionId,
        status: 'cancelled',
        cancelled_at: '2026-10-30T17:00:00.000Z',
        paid_through_at: '2026-11-23T17:00:00.000Z',
        access_state: 'expired',
      },
      subscription_available: false,
      subscription_blocker: 'creator_premium_renewal_required',
      renewal_available: false,
      renewal_blocker: 'creator_premium_subscription_disabled',
    },
    status: 'cancelled',
    started_at: '2026-10-24T17:00:00.000Z',
    cancelled_at: '2026-10-30T17:00:00.000Z',
    ended_at: null,
    period: {
      id: periodId,
      starts_at: '2026-10-24T17:00:00.000Z',
      paid_through_at: '2026-11-23T17:00:00.000Z',
      access_state: 'expired',
      gross_amount_bdag: '2000.00000000',
    },
    access_active: false,
    auto_renew: false,
    renewal_supported: true,
    renewal_available: false,
    renewal_blocker: 'creator_premium_subscription_disabled',
    is_latest_relationship: true,
    created_at: '2026-10-24T17:00:00.000Z',
    updated_at: '2026-10-30T17:00:00.000Z',
  }],
  next_cursor: {
    created_at: '2026-10-24T17:00:00.000Z',
    id: subscriptionId,
  },
});

const commercialSummaryProjection = Object.freeze({
  range: {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-25T00:00:00.000Z',
  },
  currency: 'BDAG',
  gross: '2000.00000000',
  platform_fee: '0.00000000',
  creator_net: '2000.00000000',
  refund: '0.00000000',
  net_retained: '2000.00000000',
  pending_bdag: '0.00000000',
  canonical_account_balance_bdag: '2000.00000000',
  balance_scope: 'all_bdag_activity',
  settlement_model: 'immediate_direct_credit',
  integrity_failure_count: 0,
  policy: financeOffPolicy,
  purchase_count: 1,
  subscription_period_count: 0,
  refund_count: 0,
  published_contents: 1,
  pending_contents: 0,
  rejected_contents: 0,
  active_subscription_grants: 0,
  revoked_subscription_count: 0,
  recent_transactions: [{
    source: 'purchase',
    event_type: 'charge',
    reference_id: receiptId,
    content_id: contentId,
    financial_transaction_id: transactionId,
    gross_amount_bdag: '2000.00000000',
    platform_fee_bdag: '0.00000000',
    creator_net_bdag: '2000.00000000',
    created_at: '2026-10-24T17:00:00.000Z',
  }],
  content_performance: [{
    content_id: contentId,
    title: 'Curso',
    lifecycle_status: 'published',
    purchase_sales: 1,
    purchase_net_retained: '2000.00000000',
    subscription_revenue_allocation: 'not_allocated',
  }],
  views_instrumented: false,
});

function withField(value, field, replacement) {
  return { ...value, [field]: replacement };
}

test('summary net amounts accept canonical signed values without accepting ambiguous decimals', () => {
  assert.equal(parseCreatorPremiumSignedBdagText('-13.50000000'), '-13.50000000');
  assert.equal(parseCreatorPremiumSignedBdagText('0.00000000'), '0.00000000');
  assert.equal(parseCreatorPremiumSignedBdagText('13.50000000'), '13.50000000');
  for (const invalid of ['-0.00000000', '-01.00000000', '-1', '-1.0', 1, null]) {
    assert.throws(
      () => parseCreatorPremiumSignedBdagText(invalid),
      /creator_premium_summary_invalid/,
    );
  }
});

test('purchase receipts are exact, balanced and bound to the requested content', () => {
  assert.deepEqual(parseCreatorPremiumPurchaseReceipt(purchaseReceipt, contentId), purchaseReceipt);

  for (const invalid of [
    null,
    [],
    { ...purchaseReceipt, receipt_id: 'not-a-uuid' },
    { ...purchaseReceipt, content_id: otherContentId },
    { ...purchaseReceipt, financial_transaction_id: null },
    { ...purchaseReceipt, gross_amount_bdag: 2000 },
    { ...purchaseReceipt, gross_amount_bdag: '2000' },
    { ...purchaseReceipt, gross_amount_bdag: '2000.0' },
    { ...purchaseReceipt, gross_amount_bdag: '02000.00000000' },
    { ...purchaseReceipt, gross_amount_bdag: '2e3' },
    { ...purchaseReceipt, gross_amount_bdag: '-1.00000000' },
    { ...purchaseReceipt, creator_net_bdag: '1999.99999999' },
    { ...purchaseReceipt, access_state: 'refunded' },
    { ...purchaseReceipt, money_moved: true, replayed: true },
    { ...purchaseReceipt, money_moved: false, already_owned: false, replayed: false },
    { ...purchaseReceipt, already_owned: 'false' },
  ]) {
    assert.throws(
      () => parseCreatorPremiumPurchaseReceipt(invalid, contentId),
      /creator_premium_purchase_receipt_invalid/,
    );
  }
});

test('subscription receipts distinguish initial charge, renewal, replay and existing access', () => {
  assert.deepEqual(parseCreatorPremiumSubscriptionReceipt(subscriptionReceipt, planId), subscriptionReceipt);
  assert.deepEqual(
    parseCreatorPremiumSubscriptionReceipt({
      ...subscriptionReceipt,
      already_subscribed: true,
      renewed: true,
    }, planId),
    { ...subscriptionReceipt, already_subscribed: true, renewed: true },
  );
  assert.deepEqual(
    parseCreatorPremiumSubscriptionReceipt({
      ...subscriptionReceipt,
      already_subscribed: true,
      money_moved: false,
      replayed: true,
    }, planId),
    { ...subscriptionReceipt, already_subscribed: true, money_moved: false, replayed: true },
  );
  assert.deepEqual(
    parseCreatorPremiumSubscriptionReceipt({
      ...subscriptionReceipt,
      status: 'cancelled',
      already_subscribed: true,
      money_moved: false,
    }, planId),
    { ...subscriptionReceipt, status: 'cancelled', already_subscribed: true, money_moved: false },
  );

  for (const invalid of [
    { ...subscriptionReceipt, plan_id: otherPlanId },
    { ...subscriptionReceipt, period_id: 'not-a-uuid' },
    { ...subscriptionReceipt, gross_amount_bdag: ' 2000.00000000' },
    { ...subscriptionReceipt, platform_fee_bdag: '0.000000001' },
    { ...subscriptionReceipt, creator_net_bdag: '1999.00000000' },
    { ...subscriptionReceipt, billing_period_days: 0 },
    { ...subscriptionReceipt, starts_at: 'tomorrow' },
    { ...subscriptionReceipt, paid_through_at: '2026-10-23T17:00:00.000Z' },
    { ...subscriptionReceipt, auto_renew: true },
    { ...subscriptionReceipt, renewed: true, already_subscribed: false },
    { ...subscriptionReceipt, money_moved: true, replayed: true },
    { ...subscriptionReceipt, money_moved: true, already_subscribed: true, renewed: false },
    { ...subscriptionReceipt, money_moved: false, replayed: false, already_subscribed: false },
    { ...subscriptionReceipt, status: 'expired' },
  ]) {
    assert.throws(
      () => parseCreatorPremiumSubscriptionReceipt(invalid, planId),
      /creator_premium_subscription_receipt_invalid/,
    );
  }
});

test('cancellation receipts cannot claim money movement and bind to the requested subscription', () => {
  assert.deepEqual(
    parseCreatorPremiumCancellationReceipt(cancellationReceipt, subscriptionId),
    cancellationReceipt,
  );
  assert.deepEqual(
    parseCreatorPremiumCancellationReceipt({
      ...cancellationReceipt,
      replayed: true,
      already_cancelled: true,
    }, subscriptionId),
    { ...cancellationReceipt, replayed: true, already_cancelled: true },
  );

  for (const invalid of [
    { ...cancellationReceipt, subscription_id: otherSubscriptionId },
    { ...cancellationReceipt, status: 'active' },
    { ...cancellationReceipt, paid_through_at: 'invalid' },
    { ...cancellationReceipt, money_moved: true },
    { ...cancellationReceipt, replayed: true, already_cancelled: false },
    { ...cancellationReceipt, replayed: 'false' },
  ]) {
    assert.throws(
      () => parseCreatorPremiumCancellationReceipt(invalid, subscriptionId),
      /creator_premium_cancellation_receipt_invalid/,
    );
  }
});

test('financial history projections reject malformed policy, money, cursors and facts', () => {
  assert.deepEqual(parseCreatorPremiumFinancialHistoryPage(financialHistoryPage), financialHistoryPage);
  const newerItem = {
    ...financialHistoryPage.items[0],
    id: otherTransactionId,
    reference_id: '60000000-0000-4000-8000-000000000002',
    occurred_at: '2026-10-25T17:00:00.000Z',
  };
  const oversizedItems = Array.from({ length: 101 }, (_, index) => ({
    ...financialHistoryPage.items[0],
    id: `80000000-0000-4000-8000-${String(101 - index).padStart(12, '0')}`,
    reference_id: `60000000-0000-4000-8000-${String(101 - index).padStart(12, '0')}`,
  }));
  for (const invalid of [
    { ...financialHistoryPage, settlement_model: 'escrow' },
    { ...financialHistoryPage, policy: { ...financialHistoryPage.policy, platform_fee_bps: 10000 } },
    { ...financialHistoryPage, policy: { ...financialHistoryPage.policy, purchase_enabled: 'false' } },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], gross_amount_bdag: 2000 }] },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], creator_net_bdag: '1999.00000000' }] },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], source: 'unknown' }] },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], starts_at: '2026-10-24T17:00:00.000Z', paid_through_at: '2026-11-23T17:00:00.000Z' }] },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], event_type: 'refund', access_state: 'active' }] },
    { ...financialHistoryPage, items: [{ ...financialHistoryPage.items[0], content: { id: contentId, title: 'Curso' } }] },
    { ...financialHistoryPage, next_cursor: { event_at: 'invalid', id: transactionId } },
    { ...financialHistoryPage, items: [financialHistoryPage.items[0], financialHistoryPage.items[0]], next_cursor: null },
    { ...financialHistoryPage, items: [financialHistoryPage.items[0], newerItem], next_cursor: null },
    { ...financialHistoryPage, items: oversizedItems, next_cursor: null },
    { ...financialHistoryPage, next_cursor: { event_at: financialHistoryPage.items[0].occurred_at, id: otherTransactionId } },
    { ...financialHistoryPage, items: [], next_cursor: financialHistoryPage.next_cursor },
  ]) {
    assert.throws(
      () => parseCreatorPremiumFinancialHistoryPage(invalid),
      /creator_premium_financial_history_invalid/,
    );
  }
});

test('financial history preserves PostgreSQL microsecond order and exact cursor binding', () => {
  const page = structuredClone(financialHistoryPage);
  page.items = [
    {
      ...page.items[0],
      occurred_at: '2026-10-24T17:00:00.123900Z',
    },
    {
      ...page.items[0],
      id: otherTransactionId,
      reference_id: '60000000-0000-4000-8000-000000000002',
      occurred_at: '2026-10-24T17:00:00.123100Z',
    },
  ];
  page.next_cursor = {
    event_at: page.items[1].occurred_at,
    id: page.items[1].id,
  };
  assert.deepEqual(parseCreatorPremiumFinancialHistoryPage(page), page);

  const mismatchedCursor = structuredClone(financialHistoryPage);
  mismatchedCursor.items[0].occurred_at = '2026-10-24T17:00:00.123900Z';
  mismatchedCursor.next_cursor.event_at = '2026-10-24T17:00:00.123100Z';
  assert.throws(
    () => parseCreatorPremiumFinancialHistoryPage(mismatchedCursor),
    /creator_premium_financial_history_invalid/,
  );
});

test('commerce projections are exact, target-bound and preserve authoritative availability', () => {
  assert.deepEqual(
    parseCreatorPremiumCommerce(commerceProjection, contentId),
    commerceProjection,
  );

  const financeOn = structuredClone(commerceProjection);
  financeOn.policy.purchase_enabled = true;
  financeOn.policy.subscription_enabled = true;
  financeOn.operations.purchase_available = true;
  financeOn.operations.purchase_blocker = null;
  financeOn.plans[0].subscription_available = true;
  financeOn.plans[0].subscription_blocker = null;
  financeOn.plans[0].renewal_blocker = 'creator_premium_subscription_not_found';
  assert.deepEqual(parseCreatorPremiumCommerce(financeOn, contentId), financeOn);

  const familyAccessBlocked = structuredClone(commerceProjection);
  familyAccessBlocked.plans[0].subscription_blocker = 'creator_premium_plan_family_access_active';
  familyAccessBlocked.plans[0].renewal_blocker = 'creator_premium_plan_family_access_active';
  assert.deepEqual(
    parseCreatorPremiumCommerce(familyAccessBlocked, contentId),
    familyAccessBlocked,
  );
});

test('commerce projections reject malformed nested facts and contradictory operations', () => {
  const invalidProjections = [
    { ...commerceProjection, unexpected: true },
    { ...commerceProjection, content: { ...commerceProjection.content, id: otherContentId } },
    { ...commerceProjection, creator: { ...commerceProjection.creator, id: 'not-a-uuid' } },
    { ...commerceProjection, content: { ...commerceProjection.content, published_at: 'tomorrow' } },
    { ...commerceProjection, plans: [{ ...commerceProjection.plans[0], price_bdag: 2000 }] },
    { ...commerceProjection, plans: [{ ...commerceProjection.plans[0], price_bdag: '2000' }] },
    { ...commerceProjection, plans: [{ ...commerceProjection.plans[0], status: 'retired' }] },
    { ...commerceProjection, plans: [{ ...commerceProjection.plans[0], subscription_available: 'false' }] },
    { ...commerceProjection, plan_count: '1' },
    { ...commerceProjection, plan_count: 2, plans_truncated: false },
    { ...commerceProjection, entitlement: { ...commerceProjection.entitlement, allowed: true } },
    { ...commerceProjection, operations: { purchase_available: true, purchase_blocker: 'creator_premium_purchase_disabled' } },
    { ...commerceProjection, operations: { purchase_available: false, purchase_blocker: null } },
    { ...commerceProjection, operations: { purchase_available: false, purchase_blocker: 'unknown_blocker' } },
    { ...commerceProjection, content: { ...commerceProjection.content, extra: 'field' } },
    { ...commerceProjection, plans: [commerceProjection.plans[0], commerceProjection.plans[0]], plan_count: 2 },
  ];

  for (const invalid of invalidProjections) {
    assert.throws(
      () => parseCreatorPremiumCommerce(invalid, contentId),
      /creator_premium_commerce_invalid/,
    );
  }
});

test('subscription projections validate canonical history, relationship binding and cursor', () => {
  assert.deepEqual(
    parseCreatorPremiumSubscriptionsPage(subscriptionsProjection),
    subscriptionsProjection,
  );

  const pending = structuredClone(subscriptionsProjection);
  pending.items[0].status = 'pending';
  pending.items[0].started_at = null;
  pending.items[0].cancelled_at = null;
  pending.items[0].ended_at = null;
  pending.items[0].period = null;
  pending.items[0].plan.relationship.status = 'pending';
  pending.items[0].plan.relationship.cancelled_at = null;
  pending.items[0].plan.relationship.paid_through_at = null;
  pending.items[0].plan.relationship.access_state = null;
  assert.deepEqual(parseCreatorPremiumSubscriptionsPage(pending), pending);
});

test('subscription projections reject malformed facts, cursors and availability invariants', () => {
  const item = subscriptionsProjection.items[0];
  const invalidProjections = [
    { ...subscriptionsProjection, unexpected: true },
    { ...subscriptionsProjection, items: [{ ...item, id: 'not-a-uuid' }] },
    { ...subscriptionsProjection, items: [{ ...item, status: 'unknown' }] },
    { ...subscriptionsProjection, items: [{ ...item, auto_renew: true }] },
    { ...subscriptionsProjection, items: [{ ...item, renewal_supported: false }] },
    { ...subscriptionsProjection, items: [{ ...item, created_at: 'tomorrow' }] },
    { ...subscriptionsProjection, items: [{ ...item, period: { ...item.period, gross_amount_bdag: '2000' } }] },
    { ...subscriptionsProjection, items: [{ ...item, plan: { ...item.plan, relationship: { ...item.plan.relationship, id: otherSubscriptionId } } }] },
    { ...subscriptionsProjection, items: [{ ...item, plan: { ...item.plan, renewal_blocker: null } }] },
    { ...subscriptionsProjection, items: [{ ...item, renewal_available: true, renewal_blocker: null }] },
    { ...subscriptionsProjection, next_cursor: { created_at: 'invalid', id: subscriptionId } },
    { ...subscriptionsProjection, next_cursor: { created_at: item.created_at, id: otherSubscriptionId } },
    { ...subscriptionsProjection, items: [], next_cursor: subscriptionsProjection.next_cursor },
    { ...subscriptionsProjection, items: [item, item], next_cursor: null },
    { ...subscriptionsProjection, items: [{ ...item, extra: 'field' }] },
  ];

  for (const invalid of invalidProjections) {
    assert.throws(
      () => parseCreatorPremiumSubscriptionsPage(invalid),
      /creator_premium_subscriptions_invalid/,
    );
  }
});

test('commercial summary projection is exact, balanced and authoritative', () => {
  assert.deepEqual(
    parseCreatorPremiumCommercialSummary(commercialSummaryProjection),
    commercialSummaryProjection,
  );

  const refunded = structuredClone(commercialSummaryProjection);
  refunded.refund = '3000.00000000';
  refunded.net_retained = '-500.00000000';
  refunded.refund_count = 1;
  refunded.recent_transactions[0].event_type = 'refund';
  refunded.content_performance[0].purchase_net_retained = '-500.00000000';
  assert.deepEqual(parseCreatorPremiumCommercialSummary(refunded), refunded);

  const deletedPerformance = structuredClone(commercialSummaryProjection);
  deletedPerformance.content_performance[0].lifecycle_status = 'deleted';
  assert.deepEqual(
    parseCreatorPremiumCommercialSummary(deletedPerformance),
    deletedPerformance,
  );

  const microsecondSummary = structuredClone(commercialSummaryProjection);
  microsecondSummary.purchase_count = 2;
  microsecondSummary.content_performance[0].purchase_sales = 2;
  microsecondSummary.recent_transactions = [
    {
      ...microsecondSummary.recent_transactions[0],
      created_at: '2026-10-24T17:00:00.123900Z',
    },
    {
      ...microsecondSummary.recent_transactions[0],
      reference_id: '60000000-0000-4000-8000-000000000002',
      financial_transaction_id: otherTransactionId,
      created_at: '2026-10-24T17:00:00.123100Z',
    },
  ];
  assert.deepEqual(
    parseCreatorPremiumCommercialSummary(microsecondSummary),
    microsecondSummary,
  );
});

test('commercial summary rejects malformed money, identities, counts and nested projections', () => {
  const transaction = commercialSummaryProjection.recent_transactions[0];
  const performance = commercialSummaryProjection.content_performance[0];
  const tooManyTransactions = Array.from(
    { length: 51 },
    (_, index) => ({
      ...transaction,
      financial_transaction_id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }),
  );
  const invalidProjections = [
    { ...commercialSummaryProjection, unexpected: true },
    { ...commercialSummaryProjection, range: { ...commercialSummaryProjection.range, extra: true } },
    { ...commercialSummaryProjection, range: { from: 'tomorrow', to: commercialSummaryProjection.range.to } },
    { ...commercialSummaryProjection, range: { from: commercialSummaryProjection.range.to, to: commercialSummaryProjection.range.from } },
    { ...commercialSummaryProjection, range: { from: '2025-01-01T00:00:00.000Z', to: '2026-10-24T00:00:00.000Z' } },
    { ...commercialSummaryProjection, currency: 'USD' },
    { ...commercialSummaryProjection, gross: 2000 },
    { ...commercialSummaryProjection, gross: '2000' },
    { ...commercialSummaryProjection, gross: '-1.00000000' },
    { ...commercialSummaryProjection, platform_fee: '1.00000000' },
    { ...commercialSummaryProjection, net_retained: '-0.00000000' },
    { ...commercialSummaryProjection, pending_bdag: '1.00000000' },
    { ...commercialSummaryProjection, canonical_account_balance_bdag: '-1.00000000' },
    { ...commercialSummaryProjection, balance_scope: 'premium_only' },
    { ...commercialSummaryProjection, settlement_model: 'escrow' },
    { ...commercialSummaryProjection, integrity_failure_count: 1 },
    { ...commercialSummaryProjection, policy: { ...financeOffPolicy, extra: true } },
    { ...commercialSummaryProjection, purchase_count: -1 },
    { ...commercialSummaryProjection, refund_count: 0.5 },
    { ...commercialSummaryProjection, recent_transactions: 'not-an-array' },
    { ...commercialSummaryProjection, recent_transactions: tooManyTransactions },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, extra: true }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, reference_id: 'not-a-uuid' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, content_id: null }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, financial_transaction_id: 'not-a-uuid' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, created_at: 'tomorrow' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, gross_amount_bdag: '2000' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, creator_net_bdag: '1999.00000000' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, source: 'unknown' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, event_type: 'unknown' }] },
    { ...commercialSummaryProjection, recent_transactions: [{ ...transaction, source: 'subscription' }] },
    { ...commercialSummaryProjection, recent_transactions: [transaction, transaction] },
    { ...commercialSummaryProjection, content_performance: 'not-an-array' },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, extra: true }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, content_id: 'not-a-uuid' }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, title: '' }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, lifecycle_status: 'unknown' }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, purchase_sales: -1 }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, purchase_net_retained: '-0.00000000' }] },
    { ...commercialSummaryProjection, content_performance: [{ ...performance, subscription_revenue_allocation: 'allocated' }] },
    { ...commercialSummaryProjection, content_performance: [performance, performance] },
    { ...commercialSummaryProjection, views_instrumented: true },
  ];

  for (const invalid of invalidProjections) {
    assert.throws(
      () => parseCreatorPremiumCommercialSummary(invalid),
      /creator_premium_summary_invalid/,
    );
  }
});

test('Premium finance errors expose approved domain copy and sanitize unknown backend detail', () => {
  assert.match(creatorPremiumErrorMessage(new Error('creator_premium_offer_changed')), /oferta.*cambi[oó]/i);
  assert.match(
    creatorPremiumErrorMessage(new Error('creator_premium_purchase_readback_pending')),
    /acceso todav[ií]a no pudo confirmarse/i,
  );
  assert.doesNotMatch(
    creatorPremiumErrorMessage(new Error('duplicate key value violates unique constraint private_secret_idx')),
    /duplicate|constraint|private_secret_idx/i,
  );
});

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadCreatorPremiumService(rpcResponses) {
  const rpcCalls = [];
  const responseIndexes = new Map();
  const client = {
    auth: { async getUser() { return { data: { user: null }, error: null }; } },
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      const source = rpcResponses[name];
      let response;
      if (typeof source === 'function') {
        response = source(args, rpcCalls);
      } else if (Array.isArray(source)) {
        const index = responseIndexes.get(name) ?? 0;
        response = source[Math.min(index, source.length - 1)];
        responseIndexes.set(name, index + 1);
      } else {
        response = source;
      }
      return { data: structuredClone(response), error: null };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/creatorPremiumService.ts'), 'creatorPremiumService.ts'), {
    module,
    exports: module.exports,
    console,
    require(specifier) {
      if (specifier === '@/template') return { getSupabaseClient: () => client };
      if (specifier === '@/services/creatorPremiumFinanceContracts.mjs') {
        return {
          parseCreatorPremiumCommerce,
          parseCreatorPremiumCommerceV2,
          parseCreatorPremiumCommercialSummary,
          parseCreatorPremiumFinancePolicy,
          parseCreatorPremiumFinancialHistoryPage,
          parseCreatorPremiumSignedBdagText,
          parseCreatorPremiumSubscriptionsPage,
          parseCreatorPremiumSubscriptionsPageV2,
        };
      }
      if (specifier === '@/services/creatorPremiumMoney.mjs') {
        return { normalizeCreatorPremiumPriceBdag };
      }
      throw new Error(`Unexpected creatorPremiumService module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumService.js' });
  Object.defineProperty(module.exports, '__testRpcCalls', { value: rpcCalls });
  return module.exports;
}

test('Premium service fetchers return only strictly parsed commerce, summary and subscription projections', async () => {
  const summaryWithDeletedPerformance = structuredClone(commercialSummaryProjection);
  summaryWithDeletedPerformance.content_performance[0].lifecycle_status = 'deleted';
  const service = loadCreatorPremiumService({
    get_creator_premium_commerce_v2: commerceProjection,
    get_my_creator_premium_commercial_summary_v1: summaryWithDeletedPerformance,
    get_my_creator_premium_subscriptions_v2: subscriptionsProjection,
  });
  assert.deepEqual(
    structuredClone(await service.fetchMyCreatorPremiumCommercialSummary()),
    summaryWithDeletedPerformance,
  );
  assert.deepEqual(
    structuredClone(await service.fetchCreatorPremiumCommerce(contentId)),
    commerceProjection,
  );
  assert.deepEqual(
    structuredClone(await service.fetchMyCreatorPremiumSubscriptions()),
    {
      policy: subscriptionsProjection.policy,
      items: subscriptionsProjection.items,
      nextCursor: {
        timestamp: subscriptionsProjection.next_cursor.created_at,
        id: subscriptionsProjection.next_cursor.id,
      },
    },
  );

  const malformed = loadCreatorPremiumService({
    get_creator_premium_commerce_v2: {
      ...commerceProjection,
      content: { ...commerceProjection.content, id: otherContentId },
    },
    get_my_creator_premium_commercial_summary_v1: {
      ...commercialSummaryProjection,
      recent_transactions: [{
        ...commercialSummaryProjection.recent_transactions[0],
        creator_net_bdag: '1999.00000000',
      }],
    },
    get_my_creator_premium_subscriptions_v2: {
      ...subscriptionsProjection,
      items: [{ ...subscriptionsProjection.items[0], auto_renew: true }],
    },
  });
  await assert.rejects(
    malformed.fetchMyCreatorPremiumCommercialSummary(),
    /creator_premium_summary_invalid/,
  );
  await assert.rejects(
    malformed.fetchCreatorPremiumCommerce(contentId),
    /creator_premium_commerce_invalid/,
  );
  await assert.rejects(
    malformed.fetchMyCreatorPremiumSubscriptions(),
    /creator_premium_subscriptions_invalid/,
  );
});

test('Premium subscription readback follows bounded canonical pagination beyond the first page', async () => {
  const firstPage = structuredClone(subscriptionsProjection);
  const secondItem = structuredClone(subscriptionsProjection.items[0]);
  secondItem.id = otherSubscriptionId;
  secondItem.plan.id = otherPlanId;
  secondItem.plan.relationship.id = otherSubscriptionId;
  secondItem.created_at = '2026-10-23T17:00:00.000Z';
  secondItem.updated_at = '2026-10-31T17:00:00.000Z';
  const secondPage = {
    policy: financeOffPolicy,
    items: [secondItem],
    next_cursor: null,
  };
  const service = loadCreatorPremiumService({
    get_my_creator_premium_subscriptions_v2: [firstPage, secondPage],
  });

  const snapshot = await service.fetchMyCreatorPremiumSubscriptionsSnapshot(101);

  assert.deepEqual(
    structuredClone(snapshot.items.map(item => item.id)),
    [subscriptionId, otherSubscriptionId],
  );
  assert.equal(snapshot.nextCursor, null);
  assert.deepEqual(structuredClone(service.__testRpcCalls), [{
    name: 'get_my_creator_premium_subscriptions_v2',
    args: {
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_limit: 100,
    },
  }, {
    name: 'get_my_creator_premium_subscriptions_v2',
    args: {
      p_cursor_created_at: subscriptionsProjection.next_cursor.created_at,
      p_cursor_id: subscriptionsProjection.next_cursor.id,
      p_limit: 100,
    },
  }]);
  await assert.rejects(
    service.fetchMyCreatorPremiumSubscriptionsSnapshot(0),
    /creator_premium_subscription_readback_invalid/,
  );
});

function loadLedgerClient(responses) {
  const invokes = [];
  const logs = [];
  const client = {
    functions: {
      async invoke(name, options) {
        invokes.push({ name, body: structuredClone(options.body) });
        return { data: { success: true, data: responses[options.body.action] }, error: null };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/financial/ledgerClient.ts'), 'ledgerClient.ts'), {
    module,
    exports: module.exports,
    console: {
      log(...args) { logs.push(['log', ...structuredClone(args)]); },
      warn(...args) { logs.push(['warn', ...structuredClone(args)]); },
      error(...args) { logs.push(['error', ...structuredClone(args)]); },
    },
    crypto: { randomUUID: () => idempotencyKey },
    require(specifier) {
      if (specifier === '@/template') return { getSupabaseClient: () => client };
      if (specifier === '@/services/walletApi') {
        return { getWithdrawalConfigFromBackend: async () => ({ minimumBdag: 1 }) };
      }
      if (specifier === '@/services/creatorPremiumFinanceContracts.mjs') {
        return {
          parseCreatorPremiumCancellationReceipt,
          parseCreatorPremiumPurchaseReceipt,
          parseCreatorPremiumSubscriptionReceipt,
        };
      }
      if (specifier === '@supabase/supabase-js') {
        return { FunctionsHttpError: class FunctionsHttpError extends Error {} };
      }
      throw new Error(`Unexpected ledgerClient module: ${specifier}`);
    },
  }, { filename: 'ledgerClient.js' });
  return { service: module.exports, invokes, logs };
}

test('Premium ledger helpers return sanitized typed receipts and send identity-only commands', async () => {
  const harness = loadLedgerClient({
    creator_premium_purchase: purchaseReceipt,
    creator_premium_subscribe: subscriptionReceipt,
    creator_premium_cancel_subscription: cancellationReceipt,
  });

  assert.deepEqual(
    structuredClone(await harness.service.purchaseContent({ contentId, offerVersionId: offerId, idempotencyKey })),
    { success: true, data: purchaseReceipt },
  );
  assert.deepEqual(
    structuredClone(await harness.service.subscribeToPlan({ planId, idempotencyKey })),
    { success: true, data: subscriptionReceipt },
  );
  assert.deepEqual(
    structuredClone(await harness.service.cancelCreatorPremiumSubscription({ subscriptionId, idempotencyKey })),
    { success: true, data: cancellationReceipt },
  );
  assert.deepEqual(harness.invokes, [
    {
      name: 'bdag-ledger',
      body: { action: 'creator_premium_purchase', idempotency_key: idempotencyKey,
        content_id: contentId, offer_version_id: offerId, client_contract: 'creator-premium-f3-v2' },
    },
    {
      name: 'bdag-ledger',
      body: { action: 'creator_premium_subscribe', idempotency_key: idempotencyKey,
        plan_id: planId, client_contract: 'creator-premium-f3-v2' },
    },
    {
      name: 'bdag-ledger',
      body: {
        action: 'creator_premium_cancel_subscription',
        idempotency_key: idempotencyKey,
        subscription_id: subscriptionId,
      },
    },
  ]);

  const serializedLogs = JSON.stringify(harness.logs);
  for (const secretValue of [contentId, planId, subscriptionId, receiptId, periodId, transactionId, '2000.00000000']) {
    assert.equal(serializedLogs.includes(secretValue), false);
  }
});

test('Premium ledger helpers fail closed on malformed or target-mismatched responses', async () => {
  const harness = loadLedgerClient({
    creator_premium_purchase: withField(purchaseReceipt, 'content_id', otherContentId),
    creator_premium_subscribe: withField(subscriptionReceipt, 'plan_id', otherPlanId),
    creator_premium_cancel_subscription: withField(cancellationReceipt, 'money_moved', true),
  });

  assert.deepEqual(
    structuredClone(await harness.service.purchaseContent({ contentId, offerVersionId: offerId, idempotencyKey })),
    { success: false, error: 'creator_premium_purchase_receipt_invalid' },
  );
  assert.deepEqual(
    structuredClone(await harness.service.subscribeToPlan({ planId, idempotencyKey })),
    { success: false, error: 'creator_premium_subscription_receipt_invalid' },
  );
  assert.deepEqual(
    structuredClone(await harness.service.cancelCreatorPremiumSubscription({ subscriptionId, idempotencyKey })),
    { success: false, error: 'creator_premium_cancellation_receipt_invalid' },
  );
});
