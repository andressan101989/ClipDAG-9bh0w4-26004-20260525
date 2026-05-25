/**
 * services/subscriptionService.ts
 *
 * Creator subscription management: subscribe, cancel, check status, fetch plans.
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

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

const db = () => getSupabaseClient();

async function extractError(error: any): Promise<string> {
  let msg = error?.message ?? 'Error desconocido';
  if (error instanceof FunctionsHttpError) {
    try {
      const text = await error.context?.text?.();
      const parsed = text ? JSON.parse(text) : null;
      msg = parsed?.error ?? parsed?.message ?? text ?? msg;
    } catch { /* keep */ }
  }
  return String(msg).slice(0, 300);
}

/** Subscribe to a creator plan (deducts BDAG, activates access) */
export async function subscribeToPlan(planId: string): Promise<{
  success: boolean; error?: string; expires_at?: string; new_balance?: number;
}> {
  const { data, error } = await db().functions.invoke('bdag-economy', {
    body: { action: 'subscribe', plan_id: planId },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Cancel an active subscription */
export async function cancelSubscription(subId: string, subscriberId: string): Promise<{
  success: boolean; error?: string;
}> {
  const { data, error } = await db().rpc('cancel_creator_subscription', {
    p_subscriber_id: subscriberId,
    p_sub_id: subId,
  });
  if (error) return { success: false, error: error.message };
  return data ?? { success: false, error: 'No response' };
}

/** Check if user has active subscription to a creator */
export async function checkSubscription(subscriberId: string, creatorId: string): Promise<{
  isSubscribed: boolean;
  subscription: ActiveSubscription | null;
  freeDmsRemaining: number;
  planName: string;
}> {
  const { data } = await db()
    .from('creator_subscriptions')
    .select('*, plan:subscription_plans(name, price_bdag, perks)')
    .eq('subscriber_id', subscriberId)
    .eq('creator_id', creatorId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!data) return { isSubscribed: false, subscription: null, freeDmsRemaining: 0, planName: '' };

  const sub = data as ActiveSubscription;
  return {
    isSubscribed: true,
    subscription: sub,
    freeDmsRemaining: Math.max(0, (sub.free_dms_quota ?? 10) - (sub.free_dms_used ?? 0)),
    planName: (sub.plan as any)?.name ?? 'VIP',
  };
}

/** Fetch all subscription plans (marketplace discovery) */
export async function fetchSubscriptionPlans(opts?: {
  creatorId?: string; limit?: number;
}): Promise<SubscriptionPlan[]> {
  let q = db()
    .from('subscription_plans')
    .select('*, creator:user_profiles!creator_id(username, avatar_url, display_name)')
    .eq('status', 'active')
    .order('subscribers_count', { ascending: false })
    .limit(opts?.limit ?? 20);

  if (opts?.creatorId) q = q.eq('creator_id', opts.creatorId);
  const { data } = await q;
  return (data as SubscriptionPlan[]) ?? [];
}

/** Fetch my active subscriptions */
export async function fetchMySubscriptions(userId: string): Promise<ActiveSubscription[]> {
  const { data } = await db()
    .from('creator_subscriptions')
    .select(`
      *,
      plan:subscription_plans(
        name, price_bdag, billing_cycle, perks,
        creator:user_profiles!creator_id(username, avatar_url, display_name)
      )
    `)
    .eq('subscriber_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false });
  return (data as ActiveSubscription[]) ?? [];
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
  const { data, error } = await db().rpc('upsert_subscription_plan', {
    p_creator_id:    opts.creatorId,
    p_name:          opts.name,
    p_description:   opts.description,
    p_price_bdag:    opts.priceBdag,
    p_billing_cycle: opts.billingCycle,
    p_perks:         opts.perks,
    p_plan_id:       opts.planId ?? null,
  });
  if (error) return { success: false, error: error.message };
  return data ?? { success: false };
}

/** Toggle plan status (active/inactive) */
export async function togglePlanStatus(planId: string, creatorId: string, active: boolean): Promise<boolean> {
  const { error } = await db()
    .from('subscription_plans')
    .update({ status: active ? 'active' : 'inactive' })
    .eq('id', planId)
    .eq('creator_id', creatorId);
  return !error;
}
