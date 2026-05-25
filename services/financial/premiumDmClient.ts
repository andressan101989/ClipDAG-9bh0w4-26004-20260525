/**
 * services/financial/premiumDmClient.ts
 *
 * Premium DM financial operations — fully hardened with idempotency.
 * All BDAG movements go through the ledger Edge Function.
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

const supabase = getSupabaseClient();

function makeKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}:${Date.now()}`; }

async function extractError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try { const t = await error.context?.text(); return JSON.parse(t ?? '{}').error ?? t ?? error.message; } catch { return error.message; }
  }
  return error instanceof Error ? error.message : String(error);
}

// ── Get creator's Premium DM config ───────────────────────────────────────
export async function getPremiumDmConfig(creatorId: string) {
  const { data } = await supabase.from('premium_dm_config').select('*').eq('user_id', creatorId).single();
  return data;
}

// ── Update creator's Premium DM config ────────────────────────────────────
export async function updatePremiumDmConfig(params: {
  enabled:         boolean;
  priceBdag:       number;
  welcomeMessage?: string;
}) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase.from('premium_dm_config').upsert({
    user_id:         user.user.id,
    enabled:         params.enabled,
    price_bdag:      params.priceBdag,
    welcome_message: params.welcomeMessage ?? '',
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return error ? { success: false, error: error.message } : { success: true };
}

// ── Send Premium DM (escrow flow) ─────────────────────────────────────────
export async function sendPremiumDM(params: {
  recipientId: string;
  messageText: string;
  amountBdag:  number;
}): Promise<{ success: boolean; error?: string; messageId?: string; paymentId?: string; isFree?: boolean }> {
  const { data, error } = await supabase.functions.invoke('bdag-economy', {
    body: {
      action:           'premium_dm_send',
      recipient_id:     params.recipientId,
      message_text:     params.messageText,
      amount_bdag:      params.amountBdag,
      idempotency_key:  makeKey('pdm_send'),
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  if (!data?.success) return { success: false, error: data?.error ?? 'send failed' };
  return { success: true, messageId: data.message_id, paymentId: data.payment_id, isFree: data.is_free };
}

// ── Creator releases held payment ─────────────────────────────────────────
export async function releasePremiumDMPayment(paymentId: string): Promise<{ success: boolean; error?: string; released?: number }> {
  const { data, error } = await supabase.functions.invoke('bdag-economy', {
    body: {
      action:          'premium_dm_release',
      payment_id:      paymentId,
      idempotency_key: makeKey('pdm_release'),
    },
  });
  if (error) return { success: false, error: await extractError(error) };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true, released: data.released_amount };
}

// ── Fetch creator premium DM inbox ────────────────────────────────────────
export async function fetchPremiumDmInbox(creatorId: string) {
  const { data, error } = await supabase.rpc('get_creator_premium_dm_inbox', { p_creator_id: creatorId });
  if (error) return [];
  return data ?? [];
}
