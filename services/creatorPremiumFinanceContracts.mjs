const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_BDAG_RE = /^(?:0|[1-9]\d{0,29})\.\d{8}$/;
const EXACT_SIGNED_BDAG_RE = /^-?(?:0|[1-9]\d{0,29})\.\d{8}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BDAG_SCALE = 100_000_000n;

const PURCHASE_KEYS = Object.freeze([
  'receipt_id',
  'content_id',
  'financial_transaction_id',
  'gross_amount_bdag',
  'platform_fee_bdag',
  'creator_net_bdag',
  'access_state',
  'already_owned',
  'money_moved',
  'replayed',
]);

const SUBSCRIPTION_KEYS = Object.freeze([
  'subscription_id',
  'period_id',
  'plan_id',
  'financial_transaction_id',
  'gross_amount_bdag',
  'platform_fee_bdag',
  'creator_net_bdag',
  'billing_period_days',
  'starts_at',
  'paid_through_at',
  'status',
  'already_subscribed',
  'renewed',
  'auto_renew',
  'money_moved',
  'replayed',
]);

const CANCELLATION_KEYS = Object.freeze([
  'subscription_id',
  'status',
  'paid_through_at',
  'money_moved',
  'replayed',
  'already_cancelled',
]);

const POLICY_KEYS = Object.freeze([
  'purchase_enabled',
  'subscription_enabled',
  'refunds_enabled',
  'platform_fee_bps',
  'policy_version',
]);

const HISTORY_PAGE_KEYS = Object.freeze([
  'policy',
  'settlement_model',
  'items',
  'next_cursor',
]);

const HISTORY_ITEM_KEYS = Object.freeze([
  'id',
  'source',
  'event_type',
  'reference_id',
  'subscription_id',
  'content',
  'plan',
  'gross_amount_bdag',
  'platform_fee_bdag',
  'creator_net_bdag',
  'access_state',
  'relationship_status',
  'occurred_at',
  'starts_at',
  'paid_through_at',
]);

const COMMERCE_KEYS = Object.freeze([
  'content',
  'creator',
  'offer',
  'plans',
  'plan_count',
  'plans_truncated',
  'entitlement',
  'operations',
  'policy',
]);

const CONTENT_KEYS = Object.freeze([
  'id',
  'creator_id',
  'title',
  'description',
  'content_kind',
  'access_mode',
  'teaser_url',
  'published_at',
]);

const PROFILE_KEYS = Object.freeze(['id', 'username', 'display_name', 'avatar_url']);
const OFFER_KEYS = Object.freeze(['id', 'version', 'price_bdag', 'currency', 'status']);
const PLAN_KEYS = Object.freeze([
  'id',
  'name',
  'description',
  'version',
  'price_bdag',
  'currency',
  'billing_period_days',
  'status',
  'relationship',
  'subscription_available',
  'subscription_blocker',
  'renewal_available',
  'renewal_blocker',
]);
const RELATIONSHIP_KEYS = Object.freeze([
  'id',
  'status',
  'cancelled_at',
  'paid_through_at',
  'access_state',
]);
const ENTITLEMENT_KEYS = Object.freeze(['allowed', 'source', 'reason', 'expires_at']);
const OPERATIONS_KEYS = Object.freeze(['purchase_available', 'purchase_blocker']);
const SUBSCRIPTIONS_PAGE_KEYS = Object.freeze(['policy', 'items', 'next_cursor']);
const SUBSCRIPTION_ITEM_KEYS = Object.freeze([
  'id',
  'creator',
  'plan',
  'status',
  'started_at',
  'cancelled_at',
  'ended_at',
  'period',
  'access_active',
  'auto_renew',
  'renewal_supported',
  'renewal_available',
  'renewal_blocker',
  'is_latest_relationship',
  'created_at',
  'updated_at',
]);
const PERIOD_KEYS = Object.freeze([
  'id',
  'starts_at',
  'paid_through_at',
  'access_state',
  'gross_amount_bdag',
]);
const COMMERCIAL_SUMMARY_KEYS = Object.freeze([
  'range',
  'currency',
  'gross',
  'platform_fee',
  'creator_net',
  'refund',
  'net_retained',
  'pending_bdag',
  'canonical_account_balance_bdag',
  'balance_scope',
  'settlement_model',
  'integrity_failure_count',
  'policy',
  'purchase_count',
  'subscription_period_count',
  'refund_count',
  'published_contents',
  'pending_contents',
  'rejected_contents',
  'active_subscription_grants',
  'revoked_subscription_count',
  'recent_transactions',
  'content_performance',
  'views_instrumented',
]);
const SUMMARY_TRANSACTION_KEYS = Object.freeze([
  'source',
  'event_type',
  'reference_id',
  'content_id',
  'financial_transaction_id',
  'gross_amount_bdag',
  'platform_fee_bdag',
  'creator_net_bdag',
  'created_at',
]);
const CONTENT_PERFORMANCE_KEYS = Object.freeze([
  'content_id',
  'title',
  'lifecycle_status',
  'purchase_sales',
  'purchase_net_retained',
  'subscription_revenue_allocation',
]);

const CONTENT_KINDS = Object.freeze(['image', 'video']);
const ACCESS_MODES = Object.freeze(['purchase', 'subscription', 'purchase_or_subscription']);
const PLAN_STATUSES = Object.freeze(['draft', 'active', 'retired']);
const RELATIONSHIP_STATUSES = Object.freeze(['pending', 'active', 'cancelled', 'expired', 'revoked']);
const ACCESS_STATES = Object.freeze(['active', 'expired', 'revoked', 'refunded']);
const CONTENT_LIFECYCLES = Object.freeze([
  'draft',
  'pending_review',
  'published',
  'rejected',
  'quarantined',
  'removed',
  'deleted',
]);
const PURCHASE_BLOCKERS = Object.freeze([
  'creator_premium_self_purchase_forbidden',
  'creator_premium_purchase_access_mode_invalid',
  'creator_premium_already_owned',
  'creator_premium_active_offer_not_found',
  'creator_premium_purchase_disabled',
]);
const SUBSCRIPTION_BLOCKERS = Object.freeze([
  'creator_premium_self_subscription_forbidden',
  'creator_premium_subscription_disabled',
  'creator_premium_renewal_required',
  'creator_premium_plan_family_access_active',
]);
const RENEWAL_BLOCKERS = Object.freeze([
  'creator_premium_self_subscription_forbidden',
  'creator_premium_subscription_disabled',
  'creator_premium_subscription_not_found',
  'creator_premium_subscription_state_invalid',
  'creator_premium_subscription_financial_binding_invalid',
  'creator_premium_already_subscribed',
  'creator_premium_subscription_superseded',
  'creator_premium_active_plan_not_found',
  'creator_premium_plan_family_access_active',
]);

function invalid(code) {
  throw new Error(code);
}

function exactRecord(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    invalid(code);
  }
  return value;
}

function exactUuid(value, code) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) invalid(code);
  return value.toLowerCase();
}

function exactBoolean(value, code) {
  if (typeof value !== 'boolean') invalid(code);
  return value;
}

function exactInteger(value, code, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(code);
  return value;
}

function exactEnum(value, allowed, code) {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(code);
  return value;
}

function exactNullableEnum(value, allowed, code) {
  return value === null ? null : exactEnum(value, allowed, code);
}

function exactBdag(value, code) {
  if (typeof value !== 'string' || !EXACT_BDAG_RE.test(value)) invalid(code);
  return value;
}

export function parseCreatorPremiumSignedBdagText(
  value,
  code = 'creator_premium_summary_invalid',
) {
  if (typeof value !== 'string'
      || !EXACT_SIGNED_BDAG_RE.test(value)
      || value === '-0.00000000') {
    invalid(code);
  }
  return value;
}

function bdagAtomicUnits(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const units = BigInt(whole) * BDAG_SCALE + BigInt(fraction.padEnd(8, '0'));
  return negative ? -units : units;
}

function assertBalanced(record, code) {
  if (bdagAtomicUnits(record.gross_amount_bdag)
      !== bdagAtomicUnits(record.platform_fee_bdag) + bdagAtomicUnits(record.creator_net_bdag)) {
    invalid(code);
  }
}

function exactTimestamp(value, code) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid(code);
  }
  return value;
}

function timestampMicros(value, code) {
  const timestamp = exactTimestamp(value, code);
  const fraction = /\.(\d{1,6})/.exec(timestamp)?.[1] ?? '';
  const microsecondRemainder = BigInt((fraction.padEnd(6, '0') || '0')) % 1000n;
  return BigInt(Date.parse(timestamp)) * 1000n + microsecondRemainder;
}

function exactTarget(value, expected, code) {
  const normalized = exactUuid(value, code);
  if (normalized !== exactUuid(expected, code)) invalid(code);
  return normalized;
}

function exactNullableTimestamp(value, code) {
  return value === null ? null : exactTimestamp(value, code);
}

function exactText(value, code, maxLength = 200) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maxLength) {
    invalid(code);
  }
  return value;
}

function exactBoundedString(value, code, maxLength, allowEmpty = false) {
  if (typeof value !== 'string'
      || value.length > maxLength
      || (!allowEmpty && value.length === 0)) {
    invalid(code);
  }
  return value;
}

function exactNullableText(value, code, maxLength) {
  return value === null ? null : exactText(value, code, maxLength);
}

function exactNullableBoundedString(value, code, maxLength) {
  return value === null ? null : exactBoundedString(value, code, maxLength);
}

function parseFinancePolicy(value, code) {
  const record = exactRecord(value, POLICY_KEYS, code);
  const policy = {
    purchase_enabled: exactBoolean(record.purchase_enabled, code),
    subscription_enabled: exactBoolean(record.subscription_enabled, code),
    refunds_enabled: exactBoolean(record.refunds_enabled, code),
    platform_fee_bps: exactInteger(record.platform_fee_bps, code, 0, 9999),
    policy_version: exactText(record.policy_version, code, 80),
  };
  return Object.freeze(policy);
}

export function parseCreatorPremiumFinancePolicy(value) {
  return parseFinancePolicy(value, 'creator_premium_financial_history_invalid');
}

export function parseCreatorPremiumCommercialSummary(value) {
  const code = 'creator_premium_summary_invalid';
  const record = exactRecord(value, COMMERCIAL_SUMMARY_KEYS, code);
  const rangeRecord = exactRecord(record.range, ['from', 'to'], code);
  const range = Object.freeze({
    from: exactTimestamp(rangeRecord.from, code),
    to: exactTimestamp(rangeRecord.to, code),
  });
  const rangeFrom = timestampMicros(range.from, code);
  const rangeTo = timestampMicros(range.to, code);
  if (rangeFrom >= rangeTo || rangeTo - rangeFrom > 366n * 24n * 60n * 60n * 1_000_000n) invalid(code);

  const gross = exactBdag(record.gross, code);
  const platformFee = exactBdag(record.platform_fee, code);
  const creatorNet = exactBdag(record.creator_net, code);
  const refund = exactBdag(record.refund, code);
  const netRetained = parseCreatorPremiumSignedBdagText(record.net_retained, code);
  const pendingBdag = exactBdag(record.pending_bdag, code);
  const canonicalAccountBalanceBdag = exactBdag(record.canonical_account_balance_bdag, code);
  if (bdagAtomicUnits(gross) !== bdagAtomicUnits(platformFee) + bdagAtomicUnits(creatorNet)
      || pendingBdag !== '0.00000000') invalid(code);
  const creatorRefund = bdagAtomicUnits(creatorNet) - bdagAtomicUnits(netRetained);
  if (creatorRefund < 0n || creatorRefund > bdagAtomicUnits(refund)) invalid(code);

  if (!Array.isArray(record.recent_transactions) || record.recent_transactions.length > 50) invalid(code);
  const recentTransactions = record.recent_transactions.map(valueTransaction => {
    const transactionRecord = exactRecord(valueTransaction, SUMMARY_TRANSACTION_KEYS, code);
    const source = exactEnum(transactionRecord.source, ['purchase', 'subscription'], code);
    const transaction = {
      source,
      event_type: exactEnum(transactionRecord.event_type, ['charge', 'refund'], code),
      reference_id: exactUuid(transactionRecord.reference_id, code),
      content_id: transactionRecord.content_id === null
        ? null
        : exactUuid(transactionRecord.content_id, code),
      financial_transaction_id: exactUuid(transactionRecord.financial_transaction_id, code),
      gross_amount_bdag: exactBdag(transactionRecord.gross_amount_bdag, code),
      platform_fee_bdag: exactBdag(transactionRecord.platform_fee_bdag, code),
      creator_net_bdag: exactBdag(transactionRecord.creator_net_bdag, code),
      created_at: exactTimestamp(transactionRecord.created_at, code),
    };
    if ((source === 'purchase') !== (transaction.content_id !== null)
        || timestampMicros(transaction.created_at, code) < rangeFrom
        || timestampMicros(transaction.created_at, code) >= rangeTo) invalid(code);
    assertBalanced(transaction, code);
    return Object.freeze(transaction);
  });
  if (new Set(recentTransactions.map(transaction => transaction.financial_transaction_id)).size
      !== recentTransactions.length) invalid(code);
  for (let index = 1; index < recentTransactions.length; index += 1) {
    const previous = recentTransactions[index - 1];
    const current = recentTransactions[index];
    const previousTime = timestampMicros(previous.created_at, code);
    const currentTime = timestampMicros(current.created_at, code);
    if (currentTime > previousTime
        || (currentTime === previousTime
          && current.financial_transaction_id.localeCompare(previous.financial_transaction_id) > 0)) {
      invalid(code);
    }
  }

  if (!Array.isArray(record.content_performance)) invalid(code);
  const contentPerformance = record.content_performance.map(valuePerformance => {
    const performanceRecord = exactRecord(valuePerformance, CONTENT_PERFORMANCE_KEYS, code);
    return Object.freeze({
      content_id: exactUuid(performanceRecord.content_id, code),
      title: exactText(performanceRecord.title, code, 120),
      lifecycle_status: exactEnum(performanceRecord.lifecycle_status, CONTENT_LIFECYCLES, code),
      purchase_sales: exactInteger(
        performanceRecord.purchase_sales,
        code,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      purchase_net_retained: parseCreatorPremiumSignedBdagText(
        performanceRecord.purchase_net_retained,
        code,
      ),
      subscription_revenue_allocation: exactEnum(
        performanceRecord.subscription_revenue_allocation,
        ['not_allocated'],
        code,
      ),
    });
  });
  if (new Set(contentPerformance.map(performance => performance.content_id)).size
      !== contentPerformance.length) invalid(code);

  const count = field => exactInteger(record[field], code, 0, Number.MAX_SAFE_INTEGER);
  const purchaseCount = count('purchase_count');
  const subscriptionPeriodCount = count('subscription_period_count');
  const refundCount = count('refund_count');
  const recentPurchaseCharges = recentTransactions.filter(
    transaction => transaction.source === 'purchase' && transaction.event_type === 'charge',
  ).length;
  const recentSubscriptionCharges = recentTransactions.filter(
    transaction => transaction.source === 'subscription' && transaction.event_type === 'charge',
  ).length;
  const recentRefunds = recentTransactions.filter(
    transaction => transaction.event_type === 'refund',
  ).length;
  const performancePurchaseSales = contentPerformance.reduce(
    (total, performance) => total + performance.purchase_sales,
    0,
  );
  if (purchaseCount < recentPurchaseCharges
      || subscriptionPeriodCount < recentSubscriptionCharges
      || refundCount < recentRefunds
      || !Number.isSafeInteger(performancePurchaseSales)
      || performancePurchaseSales !== purchaseCount) invalid(code);

  if (record.currency !== 'BDAG'
      || record.balance_scope !== 'all_bdag_activity'
      || record.settlement_model !== 'immediate_direct_credit'
      || record.integrity_failure_count !== 0
      || record.views_instrumented !== false) invalid(code);

  return Object.freeze({
    range,
    currency: 'BDAG',
    gross,
    platform_fee: platformFee,
    creator_net: creatorNet,
    refund,
    net_retained: netRetained,
    pending_bdag: pendingBdag,
    canonical_account_balance_bdag: canonicalAccountBalanceBdag,
    balance_scope: 'all_bdag_activity',
    settlement_model: 'immediate_direct_credit',
    integrity_failure_count: 0,
    policy: parseFinancePolicy(record.policy, code),
    purchase_count: purchaseCount,
    subscription_period_count: subscriptionPeriodCount,
    refund_count: refundCount,
    published_contents: count('published_contents'),
    pending_contents: count('pending_contents'),
    rejected_contents: count('rejected_contents'),
    active_subscription_grants: count('active_subscription_grants'),
    revoked_subscription_count: count('revoked_subscription_count'),
    recent_transactions: Object.freeze(recentTransactions),
    content_performance: Object.freeze(contentPerformance),
    views_instrumented: false,
  });
}

export function parseCreatorPremiumFinancialHistoryPage(value) {
  const code = 'creator_premium_financial_history_invalid';
  const record = exactRecord(value, HISTORY_PAGE_KEYS, code);
  if (record.settlement_model !== 'immediate_direct_credit' || !Array.isArray(record.items)) invalid(code);
  if (record.items.length > 100) invalid(code);
  const items = record.items.map(valueItem => {
    const item = exactRecord(valueItem, HISTORY_ITEM_KEYS, code);
    const source = item.source;
    const eventType = item.event_type;
    if (!['purchase', 'subscription'].includes(source)
        || !['charge', 'refund'].includes(eventType)) invalid(code);
    const content = item.content === null ? null : exactRecord(
      item.content,
      ['id', 'title', 'lifecycle_status'],
      code,
    );
    const plan = item.plan === null ? null : exactRecord(
      item.plan,
      ['id', 'name', 'version', 'status'],
      code,
    );
    const parsed = {
      id: exactUuid(item.id, code),
      source,
      event_type: eventType,
      reference_id: exactUuid(item.reference_id, code),
      subscription_id: item.subscription_id === null ? null : exactUuid(item.subscription_id, code),
      content: content === null ? null : {
        id: exactUuid(content.id, code),
        title: exactText(content.title, code, 200),
        lifecycle_status: content.lifecycle_status,
      },
      plan: plan === null ? null : {
        id: exactUuid(plan.id, code),
        name: exactText(plan.name, code, 80),
        version: plan.version,
        status: plan.status,
      },
      gross_amount_bdag: exactBdag(item.gross_amount_bdag, code),
      platform_fee_bdag: exactBdag(item.platform_fee_bdag, code),
      creator_net_bdag: exactBdag(item.creator_net_bdag, code),
      access_state: item.access_state,
      relationship_status: item.relationship_status,
      occurred_at: exactTimestamp(item.occurred_at, code),
      starts_at: exactNullableTimestamp(item.starts_at, code),
      paid_through_at: exactNullableTimestamp(item.paid_through_at, code),
    };
    if (!['draft', 'pending_review', 'published', 'rejected', 'quarantined', 'removed', 'deleted'].includes(parsed.content?.lifecycle_status)
        && parsed.content !== null) invalid(code);
    if (parsed.plan !== null && (
      !Number.isInteger(parsed.plan.version)
      || parsed.plan.version < 1
      || !['draft', 'active', 'retired'].includes(parsed.plan.status)
    )) invalid(code);
    if (!['active', 'expired', 'revoked', 'refunded'].includes(parsed.access_state)) invalid(code);
    if (parsed.relationship_status !== null
        && !['pending', 'active', 'cancelled', 'expired', 'revoked'].includes(parsed.relationship_status)) invalid(code);
    if (source === 'purchase' && (
      parsed.content === null
      || parsed.plan !== null
      || parsed.subscription_id !== null
      || parsed.starts_at !== null
      || parsed.paid_through_at !== null
    )) invalid(code);
    if (source === 'subscription' && (
      parsed.content !== null
      || parsed.plan === null
      || parsed.subscription_id === null
      || parsed.starts_at === null
      || parsed.paid_through_at === null
      || parsed.relationship_status === null
    )) invalid(code);
    if (eventType === 'refund' && parsed.access_state !== 'refunded') invalid(code);
    if ((parsed.starts_at === null) !== (parsed.paid_through_at === null)) invalid(code);
    if (parsed.starts_at !== null
        && timestampMicros(parsed.paid_through_at, code) <= timestampMicros(parsed.starts_at, code)) invalid(code);
    assertBalanced(parsed, code);
    return Object.freeze(parsed);
  });
  if (new Set(items.map(item => item.id.toLowerCase())).size !== items.length) invalid(code);
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const previousTime = timestampMicros(previous.occurred_at, code);
    const currentTime = timestampMicros(current.occurred_at, code);
    if (previousTime < currentTime
        || (previousTime === currentTime
          && previous.id.toLowerCase() <= current.id.toLowerCase())) invalid(code);
  }
  let nextCursor = null;
  if (record.next_cursor !== null) {
    const cursor = exactRecord(record.next_cursor, ['event_at', 'id'], code);
    nextCursor = Object.freeze({
      event_at: exactTimestamp(cursor.event_at, code),
      id: exactUuid(cursor.id, code),
    });
    const lastItem = items.at(-1);
    if (lastItem === undefined
        || timestampMicros(nextCursor.event_at, code) !== timestampMicros(lastItem.occurred_at, code)
        || nextCursor.id.toLowerCase() !== lastItem.id.toLowerCase()) invalid(code);
  }
  return Object.freeze({
    policy: parseCreatorPremiumFinancePolicy(record.policy),
    settlement_model: 'immediate_direct_credit',
    items: Object.freeze(items),
    next_cursor: nextCursor,
  });
}

function parseProfile(value, code) {
  const record = exactRecord(value, PROFILE_KEYS, code);
  return Object.freeze({
    id: exactUuid(record.id, code),
    username: exactNullableText(record.username, code, 80),
    display_name: exactNullableText(record.display_name, code, 160),
    avatar_url: exactNullableBoundedString(record.avatar_url, code, 2048),
  });
}

function parseRelationship(value, code) {
  if (value === null) return null;
  const record = exactRecord(value, RELATIONSHIP_KEYS, code);
  const relationship = {
    id: exactUuid(record.id, code),
    status: exactEnum(record.status, RELATIONSHIP_STATUSES, code),
    cancelled_at: exactNullableTimestamp(record.cancelled_at, code),
    paid_through_at: exactNullableTimestamp(record.paid_through_at, code),
    access_state: exactNullableEnum(record.access_state, ACCESS_STATES, code),
  };
  if ((relationship.paid_through_at === null) !== (relationship.access_state === null)) invalid(code);
  return Object.freeze(relationship);
}

function parsePlan(value, code, requireActive) {
  const record = exactRecord(value, PLAN_KEYS, code);
  const relationship = parseRelationship(record.relationship, code);
  const plan = {
    id: exactUuid(record.id, code),
    name: exactText(record.name, code, 80),
    description: exactBoundedString(record.description, code, 1000, true),
    version: exactInteger(record.version, code, 1, Number.MAX_SAFE_INTEGER),
    price_bdag: exactBdag(record.price_bdag, code),
    currency: exactEnum(record.currency, ['BDAG'], code),
    billing_period_days: exactInteger(record.billing_period_days, code, 1, 365),
    status: exactEnum(record.status, PLAN_STATUSES, code),
    relationship,
    subscription_available: exactBoolean(record.subscription_available, code),
    subscription_blocker: exactNullableEnum(record.subscription_blocker, SUBSCRIPTION_BLOCKERS, code),
    renewal_available: exactBoolean(record.renewal_available, code),
    renewal_blocker: exactNullableEnum(record.renewal_blocker, RENEWAL_BLOCKERS, code),
  };
  if (bdagAtomicUnits(plan.price_bdag) <= 0n) invalid(code);
  if (requireActive && plan.status !== 'active') invalid(code);
  if (plan.subscription_available !== (plan.subscription_blocker === null)
      || plan.renewal_available !== (plan.renewal_blocker === null)
      || (plan.subscription_available && plan.renewal_available)
      || (relationship !== null && plan.subscription_available)
      || (relationship === null && plan.renewal_available)) {
    invalid(code);
  }
  if (plan.renewal_available && (
    relationship.status === 'pending'
    || relationship.paid_through_at === null
    || relationship.access_state === null
  )) invalid(code);
  return Object.freeze(plan);
}

function parseEntitlement(value, code) {
  const record = exactRecord(value, ENTITLEMENT_KEYS, code);
  const entitlement = {
    allowed: exactBoolean(record.allowed, code),
    source: exactEnum(record.source, ['owner', 'purchase', 'subscription', 'none'], code),
    reason: exactEnum(record.reason, [
      'owner',
      'active_purchase',
      'active_subscription_period',
      'not_entitled',
    ], code),
    expires_at: exactNullableTimestamp(record.expires_at, code),
  };
  const validPair = (
    (entitlement.source === 'owner'
      && entitlement.allowed && entitlement.reason === 'owner' && entitlement.expires_at === null)
    || (entitlement.source === 'purchase'
      && entitlement.allowed && entitlement.reason === 'active_purchase')
    || (entitlement.source === 'subscription'
      && entitlement.allowed
      && entitlement.reason === 'active_subscription_period'
      && entitlement.expires_at !== null)
    || (entitlement.source === 'none'
      && !entitlement.allowed
      && entitlement.reason === 'not_entitled'
      && entitlement.expires_at === null)
  );
  if (!validPair) invalid(code);
  return Object.freeze(entitlement);
}

export function parseCreatorPremiumCommerce(value, expectedContentId) {
  const code = 'creator_premium_commerce_invalid';
  const record = exactRecord(value, COMMERCE_KEYS, code);
  const contentRecord = exactRecord(record.content, CONTENT_KEYS, code);
  const content = Object.freeze({
    id: exactTarget(contentRecord.id, expectedContentId, code),
    creator_id: exactUuid(contentRecord.creator_id, code),
    title: exactText(contentRecord.title, code, 120),
    description: exactBoundedString(contentRecord.description, code, 2000, true),
    content_kind: exactEnum(contentRecord.content_kind, CONTENT_KINDS, code),
    access_mode: exactEnum(contentRecord.access_mode, ACCESS_MODES, code),
    teaser_url: exactBoundedString(contentRecord.teaser_url, code, 2048),
    published_at: exactTimestamp(contentRecord.published_at, code),
  });
  const creator = parseProfile(record.creator, code);
  if (creator.id !== content.creator_id) invalid(code);

  let offer = null;
  if (record.offer !== null) {
    const offerRecord = exactRecord(record.offer, OFFER_KEYS, code);
    offer = Object.freeze({
      id: exactUuid(offerRecord.id, code),
      version: exactInteger(offerRecord.version, code, 1, Number.MAX_SAFE_INTEGER),
      price_bdag: exactBdag(offerRecord.price_bdag, code),
      currency: exactEnum(offerRecord.currency, ['BDAG'], code),
      status: exactEnum(offerRecord.status, ['active'], code),
    });
    if (bdagAtomicUnits(offer.price_bdag) <= 0n) invalid(code);
  }

  if (!Array.isArray(record.plans) || record.plans.length > 100) invalid(code);
  const plans = record.plans.map(valuePlan => parsePlan(valuePlan, code, true));
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) invalid(code);

  const planCount = exactInteger(record.plan_count, code, 0, Number.MAX_SAFE_INTEGER);
  const plansTruncated = exactBoolean(record.plans_truncated, code);
  if (planCount < plans.length
      || plansTruncated !== (planCount > plans.length)
      || (plansTruncated && plans.length !== 100)) invalid(code);

  const entitlement = parseEntitlement(record.entitlement, code);
  const operationsRecord = exactRecord(record.operations, OPERATIONS_KEYS, code);
  const operations = Object.freeze({
    purchase_available: exactBoolean(operationsRecord.purchase_available, code),
    purchase_blocker: exactNullableEnum(operationsRecord.purchase_blocker, PURCHASE_BLOCKERS, code),
  });
  const policy = parseFinancePolicy(record.policy, code);
  if (operations.purchase_available !== (operations.purchase_blocker === null)
      || (operations.purchase_available && (
        !policy.purchase_enabled
        || offer === null
        || !['purchase', 'purchase_or_subscription'].includes(content.access_mode)
      ))) invalid(code);
  for (const plan of plans) {
    if ((plan.subscription_available || plan.renewal_available)
        && !policy.subscription_enabled) invalid(code);
  }

  return Object.freeze({
    content,
    creator,
    offer,
    plans: Object.freeze(plans),
    plan_count: planCount,
    plans_truncated: plansTruncated,
    entitlement,
    operations,
    policy,
  });
}

function parseSubscriptionPeriod(value, code) {
  if (value === null) return null;
  const record = exactRecord(value, PERIOD_KEYS, code);
  const period = {
    id: exactUuid(record.id, code),
    starts_at: exactTimestamp(record.starts_at, code),
    paid_through_at: exactTimestamp(record.paid_through_at, code),
    access_state: exactEnum(record.access_state, ACCESS_STATES, code),
    gross_amount_bdag: exactBdag(record.gross_amount_bdag, code),
  };
  if (timestampMicros(period.paid_through_at, code) <= timestampMicros(period.starts_at, code)) invalid(code);
  return Object.freeze(period);
}

export function parseCreatorPremiumSubscriptionsPage(value) {
  const code = 'creator_premium_subscriptions_invalid';
  const record = exactRecord(value, SUBSCRIPTIONS_PAGE_KEYS, code);
  const policy = parseFinancePolicy(record.policy, code);
  if (!Array.isArray(record.items) || record.items.length > 100) invalid(code);

  const items = record.items.map(valueItem => {
    const itemRecord = exactRecord(valueItem, SUBSCRIPTION_ITEM_KEYS, code);
    const id = exactUuid(itemRecord.id, code);
    const creator = parseProfile(itemRecord.creator, code);
    const plan = parsePlan(itemRecord.plan, code, false);
    const status = exactEnum(itemRecord.status, RELATIONSHIP_STATUSES, code);
    const startedAt = exactNullableTimestamp(itemRecord.started_at, code);
    const cancelledAt = exactNullableTimestamp(itemRecord.cancelled_at, code);
    const endedAt = exactNullableTimestamp(itemRecord.ended_at, code);
    const period = parseSubscriptionPeriod(itemRecord.period, code);
    const accessActive = exactBoolean(itemRecord.access_active, code);
    const autoRenew = exactBoolean(itemRecord.auto_renew, code);
    const renewalSupported = exactBoolean(itemRecord.renewal_supported, code);
    const renewalAvailable = exactBoolean(itemRecord.renewal_available, code);
    const renewalBlocker = exactNullableEnum(itemRecord.renewal_blocker, RENEWAL_BLOCKERS, code);
    const isLatestRelationship = exactBoolean(itemRecord.is_latest_relationship, code);
    const createdAt = exactTimestamp(itemRecord.created_at, code);
    const updatedAt = exactTimestamp(itemRecord.updated_at, code);

    if (plan.relationship === null
        || plan.relationship.id !== id
        || plan.relationship.status !== status
        || plan.relationship.cancelled_at !== cancelledAt
        || plan.relationship.paid_through_at !== (period === null ? null : period.paid_through_at)
        || plan.relationship.access_state !== (period === null ? null : period.access_state)
        || plan.subscription_available
        || plan.subscription_blocker !== (
          accessActive
            ? 'creator_premium_already_subscribed'
            : 'creator_premium_renewal_required'
        )
        || plan.renewal_available !== renewalAvailable
        || plan.renewal_blocker !== renewalBlocker
        || renewalAvailable !== (renewalBlocker === null)
        || autoRenew !== false
        || renewalSupported !== true) {
      invalid(code);
    }

    if ((status === 'pending' && (startedAt !== null || cancelledAt !== null || endedAt !== null))
        || (status === 'active' && (startedAt === null || cancelledAt !== null || endedAt !== null))
        || (status === 'cancelled' && (startedAt === null || cancelledAt === null))
        || (['expired', 'revoked'].includes(status) && (startedAt === null || endedAt === null))
        || (cancelledAt !== null && timestampMicros(cancelledAt, code) < timestampMicros(startedAt, code))
        || (endedAt !== null && timestampMicros(endedAt, code) < timestampMicros(startedAt, code))
        || timestampMicros(updatedAt, code) < timestampMicros(createdAt, code)) {
      invalid(code);
    }

    if ((status !== 'pending' && period === null)
        || (accessActive && (
          period === null
          || period.access_state !== 'active'
          || !['active', 'cancelled'].includes(status)
        ))) invalid(code);

    const expectedRenewalBlocker = !isLatestRelationship
      ? 'creator_premium_subscription_superseded'
      : plan.status !== 'active'
        ? 'creator_premium_active_plan_not_found'
        : !policy.subscription_enabled
          ? 'creator_premium_subscription_disabled'
          : status === 'pending'
            ? 'creator_premium_subscription_state_invalid'
            : period === null
              ? 'creator_premium_subscription_financial_binding_invalid'
              : accessActive
                ? 'creator_premium_already_subscribed'
                : renewalAvailable
                  ? null
                  : 'creator_premium_subscription_financial_binding_invalid';
    if (renewalBlocker !== expectedRenewalBlocker
        || (renewalAvailable && (
          !isLatestRelationship
          || plan.status !== 'active'
          || !policy.subscription_enabled
          || status === 'pending'
          || period === null
          || accessActive
        ))) invalid(code);

    return Object.freeze({
      id,
      creator,
      plan,
      status,
      started_at: startedAt,
      cancelled_at: cancelledAt,
      ended_at: endedAt,
      period,
      access_active: accessActive,
      auto_renew: false,
      renewal_supported: true,
      renewal_available: renewalAvailable,
      renewal_blocker: renewalBlocker,
      is_latest_relationship: isLatestRelationship,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  });

  if (new Set(items.map(item => item.id)).size !== items.length) invalid(code);
  let nextCursor = null;
  if (record.next_cursor !== null) {
    const cursor = exactRecord(record.next_cursor, ['created_at', 'id'], code);
    nextCursor = Object.freeze({
      created_at: exactTimestamp(cursor.created_at, code),
      id: exactUuid(cursor.id, code),
    });
    const lastItem = items.at(-1);
    if (!lastItem
        || nextCursor.created_at !== lastItem.created_at
        || nextCursor.id !== lastItem.id) invalid(code);
  }

  return Object.freeze({
    policy,
    items: Object.freeze(items),
    next_cursor: nextCursor,
  });
}

export function parseCreatorPremiumPurchaseReceipt(value, expectedContentId) {
  const code = 'creator_premium_purchase_receipt_invalid';
  const record = exactRecord(value, PURCHASE_KEYS, code);
  const parsed = {
    receipt_id: exactUuid(record.receipt_id, code),
    content_id: exactTarget(record.content_id, expectedContentId, code),
    financial_transaction_id: exactUuid(record.financial_transaction_id, code),
    gross_amount_bdag: exactBdag(record.gross_amount_bdag, code),
    platform_fee_bdag: exactBdag(record.platform_fee_bdag, code),
    creator_net_bdag: exactBdag(record.creator_net_bdag, code),
    access_state: record.access_state,
    already_owned: exactBoolean(record.already_owned, code),
    money_moved: exactBoolean(record.money_moved, code),
    replayed: exactBoolean(record.replayed, code),
  };
  if (parsed.access_state !== 'active') invalid(code);
  assertBalanced(parsed, code);
  if (parsed.money_moved && (parsed.already_owned || parsed.replayed)) invalid(code);
  if (!parsed.money_moved && !parsed.already_owned && !parsed.replayed) invalid(code);
  return Object.freeze(parsed);
}

export function parseCreatorPremiumSubscriptionReceipt(value, expectedPlanId) {
  const code = 'creator_premium_subscription_receipt_invalid';
  const record = exactRecord(value, SUBSCRIPTION_KEYS, code);
  const parsed = {
    subscription_id: exactUuid(record.subscription_id, code),
    period_id: exactUuid(record.period_id, code),
    plan_id: exactTarget(record.plan_id, expectedPlanId, code),
    financial_transaction_id: exactUuid(record.financial_transaction_id, code),
    gross_amount_bdag: exactBdag(record.gross_amount_bdag, code),
    platform_fee_bdag: exactBdag(record.platform_fee_bdag, code),
    creator_net_bdag: exactBdag(record.creator_net_bdag, code),
    billing_period_days: record.billing_period_days,
    starts_at: exactTimestamp(record.starts_at, code),
    paid_through_at: exactTimestamp(record.paid_through_at, code),
    status: record.status,
    already_subscribed: exactBoolean(record.already_subscribed, code),
    renewed: exactBoolean(record.renewed, code),
    auto_renew: exactBoolean(record.auto_renew, code),
    money_moved: exactBoolean(record.money_moved, code),
    replayed: exactBoolean(record.replayed, code),
  };
  if (!Number.isInteger(parsed.billing_period_days)
      || parsed.billing_period_days < 1
      || parsed.billing_period_days > 365) {
    invalid(code);
  }
  if (timestampMicros(parsed.paid_through_at, code) <= timestampMicros(parsed.starts_at, code)) invalid(code);
  if (parsed.status !== 'active' && parsed.status !== 'cancelled') invalid(code);
  if (parsed.auto_renew !== false) invalid(code);
  assertBalanced(parsed, code);
  if (parsed.renewed && !parsed.already_subscribed) invalid(code);
  if (parsed.money_moved) {
    if (parsed.replayed || parsed.status !== 'active') invalid(code);
    if (parsed.already_subscribed !== parsed.renewed) invalid(code);
  } else if (!parsed.replayed && !parsed.already_subscribed) {
    invalid(code);
  }
  return Object.freeze(parsed);
}

export function parseCreatorPremiumCancellationReceipt(value, expectedSubscriptionId) {
  const code = 'creator_premium_cancellation_receipt_invalid';
  const record = exactRecord(value, CANCELLATION_KEYS, code);
  const parsed = {
    subscription_id: exactTarget(record.subscription_id, expectedSubscriptionId, code),
    status: record.status,
    paid_through_at: exactTimestamp(record.paid_through_at, code),
    money_moved: exactBoolean(record.money_moved, code),
    replayed: exactBoolean(record.replayed, code),
    already_cancelled: exactBoolean(record.already_cancelled, code),
  };
  if (parsed.status !== 'cancelled' || parsed.money_moved !== false) invalid(code);
  if (parsed.replayed && !parsed.already_cancelled) invalid(code);
  return Object.freeze(parsed);
}
