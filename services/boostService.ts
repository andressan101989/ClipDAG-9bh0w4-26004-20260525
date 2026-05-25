/**
 * services/boostService.ts
 *
 * BDAG boosts: post boost, profile boost, product boost.
 * Creators spend BDAG to increase visibility, reach, and discoverability.
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface BoostTier {
  label: string;
  bdag: number;
  hours: number;
  multiplier: string;
  multiplierNum: number;
  color: string;
  description: string;
}

export interface ActiveBoost {
  id: string;
  user_id: string;
  boost_type: string;
  reference_id: string;
  reference_type: string;
  amount_bdag: number;
  multiplier: number;
  status: string;
  started_at: string;
  expires_at: string;
  impressions: number;
}

/** Standard boost tiers */
export const BOOST_TIERS: BoostTier[] = [
  { label: 'Starter',  bdag: 200,  hours: 6,  multiplier: '1.2×', multiplierNum: 1.2, color: '#10B981', description: 'Pequeño impulso · 6h' },
  { label: 'Regular',  bdag: 500,  hours: 12, multiplier: '1.5×', multiplierNum: 1.5, color: '#2D9EFF', description: 'Alcance moderado · 12h' },
  { label: 'Premium',  bdag: 2000, hours: 24, multiplier: '2.0×', multiplierNum: 2.0, color: '#7C5CFF', description: 'Alto rendimiento · 24h' },
  { label: 'Elite',    bdag: 5000, hours: 48, multiplier: '3.0×', multiplierNum: 3.0, color: '#FFD700', description: 'Máxima visibilidad · 48h' },
];

/** Profile boost tiers (higher investment for creator discoverability) */
export const PROFILE_BOOST_TIERS: BoostTier[] = [
  { label: 'Visibilidad',   bdag: 500,   hours: 24, multiplier: '1.5×', multiplierNum: 1.5, color: '#A855F7', description: 'Perfil destacado en búsqueda · 24h' },
  { label: 'Trending',      bdag: 2000,  hours: 48, multiplier: '2.5×', multiplierNum: 2.5, color: '#7C5CFF', description: 'Sección trending · 48h' },
  { label: 'Sugerido',      bdag: 5000,  hours: 72, multiplier: '4.0×', multiplierNum: 4.0, color: '#FF9D00', description: 'Creador sugerido + Explorar · 72h' },
  { label: 'Patrocinado',   bdag: 15000, hours: 168, multiplier: '8.0×', multiplierNum: 8.0, color: '#FF2D78', description: 'Feed patrocinado 1 semana' },
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

/** Purchase a boost (post, profile, or product) */
export async function purchaseBoost(opts: {
  referenceId: string;
  referenceType: 'video' | 'profile' | 'product';
  boostType: string;
  amountBdag: number;
  durationHrs: number;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  const { data, error } = await db().functions.invoke('bdag-economy', {
    body: {
      action:          'boost_purchase',
      reference_id:    opts.referenceId,
      reference_type:  opts.referenceType,
      boost_type:      opts.boostType,
      amount_bdag:     opts.amountBdag,
      duration_hrs:    opts.durationHrs,
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  return data;
}

/** Boost a creator's profile to increase discoverability */
export async function boostCreatorProfile(opts: {
  creatorId: string;
  tier: BoostTier;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  return purchaseBoost({
    referenceId:   opts.creatorId,
    referenceType: 'profile',
    boostType:     'profile',
    amountBdag:    opts.tier.bdag,
    durationHrs:   opts.tier.hours,
  });
}

/** Boost a specific video/post */
export async function boostVideo(opts: {
  videoId: string;
  tier: BoostTier;
}): Promise<{ success: boolean; error?: string; new_balance?: number }> {
  return purchaseBoost({
    referenceId:   opts.videoId,
    referenceType: 'video',
    boostType:     'post',
    amountBdag:    opts.tier.bdag,
    durationHrs:   opts.tier.hours,
  });
}

/** Fetch active boosts for a user */
export async function fetchActiveBoosts(userId: string): Promise<ActiveBoost[]> {
  const { data } = await db()
    .from('boosts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return (data as ActiveBoost[]) ?? [];
}

/** Check if a profile is currently boosted */
export async function isProfileBoosted(userId: string): Promise<{ boosted: boolean; expiresAt?: string }> {
  const { data } = await db()
    .from('boosts')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('reference_id', userId)
    .eq('reference_type', 'profile')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .single();
  if (!data) return { boosted: false };
  return { boosted: true, expiresAt: (data as any).expires_at };
}
