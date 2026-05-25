/**
 * services/adService.ts
 *
 * Ad campaign management: create, pause, resume, analytics.
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface AdCampaign {
  id: string;
  advertiser_id: string;
  title: string;
  description: string;
  media_url: string;
  target_url: string;
  ad_type: 'feed' | 'banner' | 'profile_boost' | 'listing_boost';
  reference_id?: string;
  reference_type?: string;
  budget_bdag: number;
  spent_bdag: number;
  cpm_bdag: number;
  impressions: number;
  clicks: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export const AD_TYPES = [
  { key: 'feed',          label: 'Feed Patrocinado',  icon: 'feed',        color: '#F59E0B' },
  { key: 'profile_boost', label: 'Boost de Perfil',   icon: 'person',      color: '#2D9EFF' },
  { key: 'listing_boost', label: 'Producto Destacado', icon: 'storefront', color: '#10B981' },
  { key: 'banner',        label: 'Banner',             icon: 'view-agenda', color: '#A855F7' },
];

const db = () => getSupabaseClient();

async function extractError(error: any): Promise<string> {
  let msg = error?.message ?? 'Error';
  if (error instanceof FunctionsHttpError) {
    try {
      const text = await error.context?.text?.();
      const parsed = text ? JSON.parse(text) : null;
      msg = parsed?.error ?? text ?? msg;
    } catch { /* keep */ }
  }
  return String(msg).slice(0, 300);
}

/** Create a new ad campaign */
export async function createAdCampaign(opts: {
  title: string;
  description?: string;
  mediaUrl?: string;
  adType: string;
  budgetBdag: number;
  durationDays: number;
  cpmBdag?: number;
  referenceId?: string;
  referenceType?: string;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  const { data, error } = await db().functions.invoke('bdag-economy', {
    body: {
      action:         'ad_create',
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

/** Fetch my ad campaigns */
export async function fetchMyCampaigns(userId: string): Promise<AdCampaign[]> {
  const { data } = await db()
    .from('ad_campaigns')
    .select('*')
    .eq('advertiser_id', userId)
    .order('created_at', { ascending: false });
  return (data as AdCampaign[]) ?? [];
}

/** Pause or resume a campaign */
export async function setCampaignStatus(
  campaignId: string,
  advertiserId: string,
  status: 'active' | 'paused',
): Promise<boolean> {
  const { error } = await db()
    .from('ad_campaigns')
    .update({ status })
    .eq('id', campaignId)
    .eq('advertiser_id', advertiserId);
  return !error;
}

/** Compute CTR for a campaign */
export function computeCTR(impressions: number, clicks: number): string {
  if (!impressions) return '0.00%';
  return ((clicks / impressions) * 100).toFixed(2) + '%';
}

/** Compute remaining budget */
export function remainingBudget(campaign: AdCampaign): number {
  return Math.max(0, campaign.budget_bdag - campaign.spent_bdag);
}
