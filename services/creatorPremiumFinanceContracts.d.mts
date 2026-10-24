export type ExactBdagDecimal = string;

export function parseCreatorPremiumSignedBdagText(
  value: unknown,
  code?: string,
): ExactBdagDecimal;

export type CreatorPremiumFinancePolicyProjection = Readonly<{
  purchase_enabled: boolean;
  subscription_enabled: boolean;
  refunds_enabled: boolean;
  platform_fee_bps: number;
  policy_version: string;
}>;

export type CreatorPremiumRelationshipProjection = Readonly<{
  id: string;
  status: 'pending' | 'active' | 'cancelled' | 'expired' | 'revoked';
  cancelled_at: string | null;
  paid_through_at: string | null;
  access_state: 'active' | 'expired' | 'revoked' | 'refunded' | null;
}>;

export type CreatorPremiumPlanProjection = Readonly<{
  id: string;
  name: string;
  description: string;
  version: number;
  price_bdag: ExactBdagDecimal;
  currency: 'BDAG';
  billing_period_days: number;
  status: 'draft' | 'active' | 'retired';
  relationship: CreatorPremiumRelationshipProjection | null;
  subscription_available: boolean;
  subscription_blocker: string | null;
  renewal_available: boolean;
  renewal_blocker: string | null;
}>;

export type CreatorPremiumCommerceProjection = Readonly<{
  content: Readonly<{
    id: string;
    creator_id: string;
    title: string;
    description: string;
    content_kind: 'image' | 'video';
    access_mode: 'purchase' | 'subscription' | 'purchase_or_subscription';
    teaser_url: string;
    published_at: string;
  }>;
  creator: Readonly<{
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>;
  offer: Readonly<{
    id: string;
    version: number;
    price_bdag: ExactBdagDecimal;
    currency: 'BDAG';
    status: 'active';
  }> | null;
  plans: readonly (CreatorPremiumPlanProjection & Readonly<{ status: 'active' }>)[];
  plan_count: number;
  plans_truncated: boolean;
  entitlement: Readonly<{
    allowed: boolean;
    source: 'owner' | 'purchase' | 'subscription' | 'none';
    reason: 'owner' | 'active_purchase' | 'active_subscription_period' | 'not_entitled';
    expires_at: string | null;
  }>;
  operations: Readonly<{
    purchase_available: boolean;
    purchase_blocker: string | null;
  }>;
  policy: CreatorPremiumFinancePolicyProjection;
}>;

export type CreatorPremiumSubscriptionsProjection = Readonly<{
  policy: CreatorPremiumFinancePolicyProjection;
  items: readonly Readonly<{
    id: string;
    creator: Readonly<{
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
    }>;
    plan: CreatorPremiumPlanProjection & Readonly<{
      relationship: CreatorPremiumRelationshipProjection;
    }>;
    status: 'pending' | 'active' | 'cancelled' | 'expired' | 'revoked';
    started_at: string | null;
    cancelled_at: string | null;
    ended_at: string | null;
    period: Readonly<{
      id: string;
      starts_at: string;
      paid_through_at: string;
      access_state: 'active' | 'expired' | 'revoked' | 'refunded';
      gross_amount_bdag: ExactBdagDecimal;
    }> | null;
    access_active: boolean;
    auto_renew: false;
    renewal_supported: true;
    renewal_available: boolean;
    renewal_blocker: string | null;
    is_latest_relationship: boolean;
    created_at: string;
    updated_at: string;
  }>;
  next_cursor: Readonly<{ created_at: string; id: string }> | null;
}>;

export type CreatorPremiumFinancialHistoryProjection = Readonly<{
  policy: CreatorPremiumFinancePolicyProjection;
  settlement_model: 'immediate_direct_credit';
  items: readonly Readonly<{
    id: string;
    source: 'purchase' | 'subscription';
    event_type: 'charge' | 'refund';
    reference_id: string;
    subscription_id: string | null;
    content: Readonly<{ id: string; title: string; lifecycle_status: string }> | null;
    plan: Readonly<{ id: string; name: string; version: number; status: string }> | null;
    gross_amount_bdag: ExactBdagDecimal;
    platform_fee_bdag: ExactBdagDecimal;
    creator_net_bdag: ExactBdagDecimal;
    access_state: 'active' | 'expired' | 'revoked' | 'refunded';
    relationship_status: 'pending' | 'active' | 'cancelled' | 'expired' | 'revoked' | null;
    occurred_at: string;
    starts_at: string | null;
    paid_through_at: string | null;
  }>[];
  next_cursor: Readonly<{ event_at: string; id: string }> | null;
}>;

export type CreatorPremiumCommercialSummaryProjection = Readonly<{
  range: Readonly<{ from: string; to: string }>;
  currency: 'BDAG';
  gross: ExactBdagDecimal;
  platform_fee: ExactBdagDecimal;
  creator_net: ExactBdagDecimal;
  refund: ExactBdagDecimal;
  net_retained: ExactBdagDecimal;
  pending_bdag: '0.00000000';
  canonical_account_balance_bdag: ExactBdagDecimal;
  balance_scope: 'all_bdag_activity';
  settlement_model: 'immediate_direct_credit';
  integrity_failure_count: 0;
  policy: CreatorPremiumFinancePolicyProjection;
  purchase_count: number;
  subscription_period_count: number;
  refund_count: number;
  published_contents: number;
  pending_contents: number;
  rejected_contents: number;
  active_subscription_grants: number;
  revoked_subscription_count: number;
  recent_transactions: readonly Readonly<{
    source: 'purchase' | 'subscription';
    event_type: 'charge' | 'refund';
    reference_id: string;
    content_id: string | null;
    financial_transaction_id: string;
    gross_amount_bdag: ExactBdagDecimal;
    platform_fee_bdag: ExactBdagDecimal;
    creator_net_bdag: ExactBdagDecimal;
    created_at: string;
  }>[];
  content_performance: readonly Readonly<{
    content_id: string;
    title: string;
    lifecycle_status:
      | 'draft'
      | 'pending_review'
      | 'published'
      | 'rejected'
      | 'quarantined'
      | 'removed'
      | 'deleted';
    purchase_sales: number;
    purchase_net_retained: ExactBdagDecimal;
    subscription_revenue_allocation: 'not_allocated';
  }>[];
  views_instrumented: false;
}>;

export type CreatorPremiumPurchaseReceipt = Readonly<{
  receipt_id: string;
  content_id: string;
  financial_transaction_id: string;
  gross_amount_bdag: ExactBdagDecimal;
  platform_fee_bdag: ExactBdagDecimal;
  creator_net_bdag: ExactBdagDecimal;
  access_state: 'active';
  already_owned: boolean;
  money_moved: boolean;
  replayed: boolean;
}>;

export type CreatorPremiumSubscriptionReceipt = Readonly<{
  subscription_id: string;
  period_id: string;
  plan_id: string;
  financial_transaction_id: string;
  gross_amount_bdag: ExactBdagDecimal;
  platform_fee_bdag: ExactBdagDecimal;
  creator_net_bdag: ExactBdagDecimal;
  billing_period_days: number;
  starts_at: string;
  paid_through_at: string;
  status: 'active' | 'cancelled';
  already_subscribed: boolean;
  renewed: boolean;
  auto_renew: false;
  money_moved: boolean;
  replayed: boolean;
}>;

export type CreatorPremiumCancellationReceipt = Readonly<{
  subscription_id: string;
  status: 'cancelled';
  paid_through_at: string;
  money_moved: false;
  replayed: boolean;
  already_cancelled: boolean;
}>;

export function parseCreatorPremiumPurchaseReceipt(
  value: unknown,
  expectedContentId: string,
): CreatorPremiumPurchaseReceipt;

export function parseCreatorPremiumSubscriptionReceipt(
  value: unknown,
  expectedPlanId: string,
): CreatorPremiumSubscriptionReceipt;

export function parseCreatorPremiumCancellationReceipt(
  value: unknown,
  expectedSubscriptionId: string,
): CreatorPremiumCancellationReceipt;

export function parseCreatorPremiumFinancePolicy(
  value: unknown,
): CreatorPremiumFinancePolicyProjection;

export function parseCreatorPremiumFinancialHistoryPage(
  value: unknown,
): CreatorPremiumFinancialHistoryProjection;

export function parseCreatorPremiumCommercialSummary(
  value: unknown,
): CreatorPremiumCommercialSummaryProjection;

export function parseCreatorPremiumCommerce(
  value: unknown,
  expectedContentId: string,
): CreatorPremiumCommerceProjection;

export function parseCreatorPremiumSubscriptionsPage(
  value: unknown,
): CreatorPremiumSubscriptionsProjection;
