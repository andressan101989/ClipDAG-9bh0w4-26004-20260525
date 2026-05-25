/**
 * services/premiumDmService.ts
 *
 * Premium DM: configure, send (escrow), release, refund.
 */
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface PremiumDMConfig {
  user_id: string;
  enabled: boolean;
  price_bdag: number;
  welcome_message: string;
  total_earned: number;
  messages_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface PremiumDMPayment {
  id: string;
  message_id: string;
  sender_id: string;
  recipient_id: string;
  amount_bdag: number;
  platform_fee: number;
  creator_earning: number;
  status: 'held' | 'released' | 'refunded' | 'expired';
  responded_at?: string;
  expires_at: string;
  created_at: string;
  sender?: { username: string; avatar_url: string | null };
  message_text?: string;
}

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

/** Configure Premium DM pricing and toggle */
export async function configurePremiumDm(opts: {
  enabled: boolean; priceBdag: number; welcomeMessage?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db().functions.invoke('bdag-economy', {
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

/** Get Premium DM config for any user */
export async function getPremiumDMConfig(userId: string): Promise<PremiumDMConfig | null> {
  const { data } = await db()
    .from('premium_dm_config')
    .select('*')
    .eq('user_id', userId)
    .single();
  return (data as PremiumDMConfig) ?? null;
}

/** Send a premium DM — BDAG held in escrow until creator responds */
export async function sendPremiumDM(opts: {
  recipientId: string; amountBdag: number; messageText: string;
}): Promise<{
  success: boolean; error?: string;
  is_free_dm?: boolean; new_balance?: number; message_id?: string;
}> {
  const { data, error } = await db().rpc('send_premium_dm', {
    p_sender_id:    (await db().auth.getUser()).data.user?.id,
    p_recipient_id: opts.recipientId,
    p_amount_bdag:  opts.amountBdag,
    p_message_text: opts.messageText,
  });
  if (error) return { success: false, error: error.message };
  return data ?? { success: false };
}

/** Release Premium DM escrow (creator confirms reply) */
export async function releasePremiumDM(creatorId: string, messageId: string): Promise<{
  success: boolean; error?: string; creator_earned?: number; new_balance?: number;
}> {
  const { data, error } = await db().rpc('release_premium_dm', {
    p_creator_id: creatorId,
    p_message_id: messageId,
  });
  if (error) return { success: false, error: error.message };
  return data ?? { success: false };
}

/** Fetch pending premium DM payments for creator inbox */
export async function fetchPendingPremiumDMs(creatorId: string): Promise<PremiumDMPayment[]> {
  const { data } = await db()
    .from('premium_dm_payments')
    .select(`
      *,
      sender:user_profiles!sender_id(username, avatar_url),
      message:messages!message_id(text)
    `)
    .eq('recipient_id', creatorId)
    .eq('status', 'held')
    .order('created_at', { ascending: false })
    .limit(30);

  return ((data ?? []) as any[]).map(row => ({
    ...row,
    message_text: row.message?.text ?? '',
    sender: row.sender,
  }));
}

/** Fetch all premium DM history for a user (sent or received) */
export async function fetchPremiumDMHistory(userId: string): Promise<PremiumDMPayment[]> {
  const { data } = await db()
    .from('premium_dm_payments')
    .select(`
      *,
      sender:user_profiles!sender_id(username, avatar_url)
    `)
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data as PremiumDMPayment[]) ?? [];
}
