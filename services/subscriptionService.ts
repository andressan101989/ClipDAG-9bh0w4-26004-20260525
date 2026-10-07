/**
 * services/subscriptionService.ts
 *
 * Creator subscription management: subscribe, cancel, check status, fetch plans.
 */
import { creatorPremiumUnavailable } from '@/services/creatorPremiumService';

export interface SubscriptionPlan {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  perks: string[];
  price_bdag: number;
  billing_cycle: string;
  status: string;
  subscribers_count: number;
  created_at: string;
  creator?: { username: string; avatar_url: string | null; display_name: string | null };
}

export interface ActiveSubscription {
  id: string;
  plan_id: string;
  subscriber_id: string;
  creator_id: string;
  amount_bdag: number;
  status: string;
  started_at: string;
  expires_at: string;
  last_renewed_at: string;
  free_dms_used: number;
  free_dms_quota: number;
  quota_reset_at: string;
  plan?: SubscriptionPlan;
}

/** B1 is metadata/entitlement only; charging is intentionally unavailable. */
export async function subscribeToPlan(planId: string): Promise<{
  success: boolean; error?: string; expires_at?: string; new_balance?: number;
}> {
  void planId;
  return creatorPremiumUnavailable();
}

/** Cancel an active subscription */
export async function cancelSubscription(subId: string, subscriberId: string): Promise<{
  success: boolean; error?: string;
}> {
  void subId;
  void subscriberId;
  return creatorPremiumUnavailable();
}

/** Check if user has active subscription to a creator */
export async function checkSubscription(subscriberId: string, creatorId: string): Promise<{
  isSubscribed: boolean;
  subscription: ActiveSubscription | null;
  freeDmsRemaining: number;
  planName: string;
}> {
  void subscriberId;
  void creatorId;
  return { isSubscribed: false, subscription: null, freeDmsRemaining: 0, planName: '' };
}

/** Fetch all subscription plans (marketplace discovery) */
export async function fetchSubscriptionPlans(opts?: {
  creatorId?: string; limit?: number;
}): Promise<SubscriptionPlan[]> {
  void opts;
  return [];
}

/** Fetch my active subscriptions */
export async function fetchMySubscriptions(userId: string): Promise<ActiveSubscription[]> {
  void userId;
  return [];
}

/** Create or update a subscription plan (for creator) */
export async function upsertSubscriptionPlan(opts: {
  creatorId: string;
  name: string;
  description: string;
  priceBdag: number;
  billingCycle: string;
  perks: string[];
  planId?: string;
}): Promise<{ success: boolean; error?: string; plan_id?: string }> {
  void opts;
  return creatorPremiumUnavailable();
}

/** Toggle plan status (active/inactive) */
export async function togglePlanStatus(planId: string, creatorId: string, active: boolean): Promise<boolean> {
  void planId;
  void creatorId;
  void active;
  return false;
}
