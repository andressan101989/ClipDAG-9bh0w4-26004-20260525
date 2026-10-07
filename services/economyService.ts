/**
 * services/economyService.ts
 *
 * Client-side service for all BDAG internal economy operations.
 * All calls go through the bdag-economy Edge Function (server-side atomic).
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  CREATOR_PREMIUM_FOUNDATION_MESSAGE,
  creatorPremiumUnavailable,
} from '@/services/creatorPremiumService';

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
  void contentId;
  return creatorPremiumUnavailable();
}

/** Subscribe to creator plan */
export async function subscribeToPlan(planId: string): Promise<{
  success: boolean; error?: string; expires_at?: string; new_balance?: number;
}> {
  void planId;
  return creatorPremiumUnavailable();
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
  void opts;
  return creatorPremiumUnavailable();
}

/** Create exclusive content listing */
export async function createExclusiveContent(opts: {
  title: string; description: string; contentType: string;
  previewText: string; previewUrl: string; contentUrl: string;
  priceBdag: number; tags?: string[];
}): Promise<{ success: boolean; error?: string; content_id?: string }> {
  void opts;
  return creatorPremiumUnavailable();
}

/** Cancel a newly-created exclusive listing that was never attached to a post. */
export async function cancelUnpublishedExclusiveContent(contentId: string): Promise<void> {
  void contentId;
  throw new Error(CREATOR_PREMIUM_FOUNDATION_MESSAGE);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/** Fetch exclusive content marketplace */
export async function fetchExclusiveContent(opts?: {
  creatorId?: string; limit?: number; contentType?: string;
}): Promise<ExclusiveContent[]> {
  void opts;
  return [];
}

/** Check which content IDs are purchased by a user */
export async function fetchPurchasedContentIds(userId: string): Promise<Set<string>> {
  void userId;
  return new Set();
}

/** Fetch subscription plans (optionally by creator) */
export async function fetchSubscriptionPlans(opts?: {
  creatorId?: string; limit?: number;
}): Promise<SubscriptionPlan[]> {
  void opts;
  return [];
}

/** Fetch my active subscriptions */
export async function fetchMySubscriptions(userId: string): Promise<creator_subscriptions[]> {
  void userId;
  return [];
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
  const [campaigns, boosts] = await Promise.all([
    supabase().from('ad_campaigns').select('budget_bdag, status').eq('advertiser_id', userId),
    supabase().from('boosts').select('amount_bdag, status, expires_at').eq('user_id', userId),
  ]);

  const adSpend         = (campaigns.data ?? []).reduce((s: number, r: any) => s + Number(r.budget_bdag), 0);
  const boostSpend      = (boosts.data ?? []).reduce((s: number, r: any) => s + Number(r.amount_bdag), 0);
  const activeBoosts    = (boosts.data ?? []).filter((b: any) => b.status === 'active' && new Date(b.expires_at) > new Date()).length;
  const activeCampaigns = (campaigns.data ?? []).filter((c: any) => c.status === 'active').length;

  return {
    total_content_earnings:      0,
    total_subscription_earnings: 0,
    total_ad_spend:    adSpend,
    total_boost_spend: boostSpend,
    content_sales:     0,
    active_subscribers: 0,
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
  void opts;
  return creatorPremiumUnavailable();
}

/** Release Premium DM escrow after creator responds */
export async function releasePremiumDMPayment(messageId: string): Promise<{
  success: boolean; error?: string; creator_earned?: number; new_balance?: number;
}> {
  void messageId;
  return creatorPremiumUnavailable();
}

/** Get Premium DM config for a user */
export async function getPremiumDMConfig(targetUserId?: string): Promise<{
  enabled: boolean; price_bdag: number; welcome_message: string; total_earned: number; messages_count: number;
} | null> {
  void targetUserId;
  return null;
}

/** Fetch pending premium DM payments for a creator (as recipient) */
export async function fetchPendingPremiumDMs(creatorId: string) {
  void creatorId;
  return [];
}

/** Check if user has active subscription to a creator (for free DM quota) */
export async function checkSubscriptionForDM(subscriberId: string, creatorId: string): Promise<{
  isSubscribed: boolean; freeDmsRemaining: number;
}> {
  void subscriberId;
  void creatorId;
  return { isSubscribed: false, freeDmsRemaining: 0 };
}
