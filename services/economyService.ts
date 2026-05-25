/**
 * services/economyService.ts
 *
 * Client-side service for all BDAG internal economy operations.
 * All calls go through the bdag-economy Edge Function (server-side atomic).
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExclusiveContent {
  id:              string;
  creator_id:      string;
  title:           string;
  description:     string;
  content_type:    'post' | 'video' | 'image' | 'download' | 'bundle';
  preview_text:    string;
  preview_url:     string;
  content_url:     string;
  price_bdag:      number;
  platform_fee_pct: number;
  status:          string;
  purchases_count: number;
  total_earned:    number;
  tags:            string[];
  created_at:      string;
  creator?:        { username: string; avatar_url: string | null; display_name: string | null };
  is_purchased?:   boolean;
}

export interface SubscriptionPlan {
  id:               string;
  creator_id:       string;
  name:             string;
  description:      string;
  perks:            string[];
  price_bdag:       number;
  billing_cycle:    string;
  status:           string;
  subscribers_count: number;
  created_at:       string;
  creator?:         { username: string; avatar_url: string | null; display_name: string | null };
  is_subscribed?:   boolean;
}

export interface AdCampaign {
  id:            string;
  advertiser_id: string;
  title:         string;
  description:   string;
  media_url:     string;
  ad_type:       'feed' | 'banner' | 'profile_boost' | 'listing_boost';
  budget_bdag:   number;
  spent_bdag:    number;
  impressions:   number;
  clicks:        number;
  status:        string;
  starts_at:     string;
  ends_at:       string;
  created_at:    string;
}

export interface Boost {
  id:             string;
  user_id:        string;
  boost_type:     string;
  reference_id:   string;
  reference_type: string;
  amount_bdag:    number;
  multiplier:     number;
  status:         string;
  expires_at:     string;
  impressions:    number;
}

export interface EconomyStats {
  total_content_earnings: number;
  total_subscription_earnings: number;
  total_ad_spend: number;
  total_boost_spend: number;
  content_sales: number;
  active_subscribers: number;
  active_boosts: number;
  active_campaigns: number;
}

// ── Error extraction ──────────────────────────────────────────────────────────
async function extractError(error: any): Promise<string> {
  let msg = error?.message ?? 'Error desconocido';
  if (error instanceof FunctionsHttpError) {
    try {
      const text   = await error.context?.text?.();
      const parsed = text ? JSON.parse(text) : null;
      msg = parsed?.error ?? parsed?.message ?? text ?? msg;
    } catch { /* keep */ }
  }
  return String(msg).slice(0, 300);
}

// ── Economy API ───────────────────────────────────────────────────────────────
const supabase = () => getSupabaseClient();

/** Purchase exclusive content */
export async function purchaseContent(contentId: string): Promise<{
  success: boolean; error?: string; already_owned?: boolean; amount_paid?: number;
}> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: { action: 'content_purchase', content_id: contentId },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Subscribe to creator plan */
export async function subscribeToPlan(planId: string): Promise<{
  success: boolean; error?: string; expires_at?: string; new_balance?: number;
}> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: { action: 'subscribe', plan_id: planId },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Purchase a boost */
export async function purchaseBoost(opts: {
  referenceId: string; referenceType: string; boostType: string;
  amountBdag: number; durationHrs: number;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: {
      action: 'boost_purchase',
      reference_id:   opts.referenceId,
      reference_type: opts.referenceType,
      boost_type:     opts.boostType,
      amount_bdag:    opts.amountBdag,
      duration_hrs:   opts.durationHrs,
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Create ad campaign */
export async function createAdCampaign(opts: {
  title: string; description?: string; mediaUrl?: string;
  adType: string; budgetBdag: number; durationDays: number;
  referenceId?: string; referenceType?: string;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: {
      action: 'ad_create',
      title:          opts.title,
      description:    opts.description ?? '',
      media_url:      opts.mediaUrl ?? '',
      ad_type:        opts.adType,
      budget_bdag:    opts.budgetBdag,
      duration_days:  opts.durationDays,
      reference_id:   opts.referenceId,
      reference_type: opts.referenceType,
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Configure premium DM */
export async function configurePremiumDm(opts: {
  enabled: boolean; priceBdag: number; welcomeMessage?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: {
      action:          'premium_dm_config',
      enabled:         opts.enabled,
      price_bdag:      opts.priceBdag,
      welcome_message: opts.welcomeMessage ?? '',
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Create exclusive content listing */
export async function createExclusiveContent(opts: {
  title: string; description: string; contentType: string;
  previewText: string; previewUrl: string; contentUrl: string;
  priceBdag: number; tags?: string[];
}): Promise<{ success: boolean; error?: string; content_id?: string }> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: {
      action:        'create_content',
      title:         opts.title,
      description:   opts.description,
      content_type:  opts.contentType,
      preview_text:  opts.previewText,
      preview_url:   opts.previewUrl,
      content_url:   opts.contentUrl,
      price_bdag:    opts.priceBdag,
      tags:          opts.tags ?? [],
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/** Fetch exclusive content marketplace */
export async function fetchExclusiveContent(opts?: {
  creatorId?: string; limit?: number; contentType?: string;
}): Promise<ExclusiveContent[]> {
  let q = supabase()
    .from('exclusive_content')
    .select(`
      *,
      creator:user_profiles!creator_id(username, avatar_url, display_name)
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 30);

  if (opts?.creatorId) q = q.eq('creator_id', opts.creatorId);
  if (opts?.contentType) q = q.eq('content_type', opts.contentType);

  const { data } = await q;
  return (data as ExclusiveContent[]) ?? [];
}

/** Check which content IDs are purchased by a user */
export async function fetchPurchasedContentIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase()
    .from('content_purchases')
    .select('content_id')
    .eq('buyer_id', userId)
    .eq('status', 'completed');
  return new Set((data ?? []).map((r: any) => r.content_id));
}

/** Fetch subscription plans (optionally by creator) */
export async function fetchSubscriptionPlans(opts?: {
  creatorId?: string; limit?: number;
}): Promise<SubscriptionPlan[]> {
  let q = supabase()
    .from('subscription_plans')
    .select(`
      *,
      creator:user_profiles!creator_id(username, avatar_url, display_name)
    `)
    .eq('status', 'active')
    .order('subscribers_count', { ascending: false })
    .limit(opts?.limit ?? 20);

  if (opts?.creatorId) q = q.eq('creator_id', opts.creatorId);
  const { data } = await q;
  return (data as SubscriptionPlan[]) ?? [];
}

/** Fetch my active subscriptions */
export async function fetchMySubscriptions(userId: string): Promise<creator_subscriptions[]> {
  const { data } = await supabase()
    .from('creator_subscriptions')
    .select(`
      *,
      plan:subscription_plans(name, price_bdag, perks, creator:user_profiles!creator_id(username, avatar_url))
    `)
    .eq('subscriber_id', userId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  return (data ?? []) as any[];
}

/** Fetch my ad campaigns */
export async function fetchMyCampaigns(userId: string): Promise<AdCampaign[]> {
  const { data } = await supabase()
    .from('ad_campaigns')
    .select('*')
    .eq('advertiser_id', userId)
    .order('created_at', { ascending: false });
  return (data as AdCampaign[]) ?? [];
}

/** Fetch my active boosts */
export async function fetchMyBoosts(userId: string): Promise<Boost[]> {
  const { data } = await supabase()
    .from('boosts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return (data as Boost[]) ?? [];
}

/** Compute economy stats for a creator */
export async function fetchEconomyStats(userId: string): Promise<EconomyStats> {
  const [contentSales, subs, campaigns, boosts] = await Promise.all([
    supabase().from('content_purchases').select('creator_earnings').eq('creator_id', userId),
    supabase().from('creator_subscriptions').select('amount_bdag').eq('creator_id', userId).eq('status', 'active'),
    supabase().from('ad_campaigns').select('budget_bdag, status').eq('advertiser_id', userId),
    supabase().from('boosts').select('amount_bdag, status, expires_at').eq('user_id', userId),
  ]);

  const contentEarnings = (contentSales.data ?? []).reduce((s: number, r: any) => s + Number(r.creator_earnings), 0);
  const subEarnings     = (subs.data ?? []).reduce((s: number, r: any) => s + Number(r.amount_bdag) * 0.9, 0);
  const adSpend         = (campaigns.data ?? []).reduce((s: number, r: any) => s + Number(r.budget_bdag), 0);
  const boostSpend      = (boosts.data ?? []).reduce((s: number, r: any) => s + Number(r.amount_bdag), 0);
  const activeBoosts    = (boosts.data ?? []).filter((b: any) => b.status === 'active' && new Date(b.expires_at) > new Date()).length;
  const activeCampaigns = (campaigns.data ?? []).filter((c: any) => c.status === 'active').length;

  return {
    total_content_earnings:      contentEarnings,
    total_subscription_earnings: subEarnings,
    total_ad_spend:    adSpend,
    total_boost_spend: boostSpend,
    content_sales:     (contentSales.data ?? []).length,
    active_subscribers: (subs.data ?? []).length,
    active_boosts:     activeBoosts,
    active_campaigns:  activeCampaigns,
  };
}

// Fix TS type alias
type creator_subscriptions = any;

// ── Premium DM helpers ────────────────────────────────────────────────────────

/** Send a Premium DM (BDAG escrow until creator responds) */
export async function sendPremiumDM(opts: {
  recipientId: string; amountBdag: number; messageText: string;
}): Promise<{ success: boolean; error?: string; is_free_dm?: boolean; new_balance?: number; message_id?: string }> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: { action: 'premium_dm_send', recipient_id: opts.recipientId, amount_bdag: opts.amountBdag, message_text: opts.messageText },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Release Premium DM escrow after creator responds */
export async function releasePremiumDMPayment(messageId: string): Promise<{
  success: boolean; error?: string; creator_earned?: number; new_balance?: number;
}> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: { action: 'premium_dm_release', message_id: messageId },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Get Premium DM config for a user */
export async function getPremiumDMConfig(targetUserId?: string): Promise<{
  enabled: boolean; price_bdag: number; welcome_message: string; total_earned: number; messages_count: number;
} | null> {
  const { data, error } = await supabase().functions.invoke('bdag-economy', {
    body: { action: 'get_premium_dm_config', target_user_id: targetUserId },
  });
  if (error) return null;
  return data?.config ?? null;
}

/** Fetch pending premium DM payments for a creator (as recipient) */
export async function fetchPendingPremiumDMs(creatorId: string) {
  const { data } = await supabase()
    .from('premium_dm_payments')
    .select('*, sender:user_profiles!sender_id(username, avatar_url)')
    .eq('recipient_id', creatorId)
    .eq('status', 'held')
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Check if user has active subscription to a creator (for free DM quota) */
export async function checkSubscriptionForDM(subscriberId: string, creatorId: string): Promise<{
  isSubscribed: boolean; freeDmsRemaining: number;
}> {
  const { data } = await supabase()
    .from('creator_subscriptions')
    .select('free_dms_used, free_dms_quota, expires_at')
    .eq('subscriber_id', subscriberId)
    .eq('creator_id', creatorId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!data) return { isSubscribed: false, freeDmsRemaining: 0 };
  return {
    isSubscribed: true,
    freeDmsRemaining: Math.max(0, (data.free_dms_quota ?? 10) - (data.free_dms_used ?? 0)),
  };
}
