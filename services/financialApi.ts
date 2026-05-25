/**
 * services/financialApi.ts
 *
 * Centralized API client for all internal BDAG economy operations.
 * Routes through the bdag-ledger Edge Function with validated payloads.
 *
 * Covers:
 *   - transfer (peer-to-peer)
 *   - purchase (exclusive content)
 *   - subscribe (creator plans)
 *   - gift/tip
 *   - boost (profile / content)
 *   - premium_dm_send / release
 *   - balance read (authoritative)
 *
 * Every request:
 *   1. Generates idempotency_key client-side
 *   2. Validates required fields locally
 *   3. Invokes bdag-ledger
 *   4. Unpacks FunctionsHttpError for human-readable errors
 *   5. Logs request + response
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { generateIdempotencyKey } from './walletApi';

const supabase = getSupabaseClient();

// ── Error extraction ──────────────────────────────────────────────────────
async function unpackError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const status = error.context?.status ?? 500;
      const text   = await error.context?.text();
      let parsed: any;
      try { parsed = JSON.parse(text ?? '{}'); } catch { parsed = {}; }
      const msg = parsed?.error ?? parsed?.message ?? text ?? error.message;
      console.error(`[financialApi] FunctionsHttpError [${status}]:`, msg);
      return `${msg}`;
    } catch {
      return error.message;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[financialApi] error:', msg);
  return msg;
}

// ── Generic ledger invoker ────────────────────────────────────────────────
async function callLedger(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }> {
  const idempotencyKey = generateIdempotencyKey(action);
  const body = { action, idempotency_key: idempotencyKey, ...payload };

  console.log('[financialApi] invoke bdag-ledger', action, {
    ...body,
    idempotency_key: idempotencyKey.slice(0, 30) + '...',
  });

  const { data, error } = await supabase.functions.invoke('bdag-ledger', { body });

  if (error) {
    const msg = await unpackError(error);
    return { success: false, error: msg };
  }

  console.log('[financialApi] bdag-ledger response', action, data);

  if (!data?.success) {
    return { success: false, error: data?.error ?? `${action} failed` };
  }

  return { success: true, data: data.data ?? data };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/** Authoritative BDAG balance from ledger (never user_profiles). */
export async function getLedgerBalanceApi(): Promise<number> {
  const result = await callLedger('balance', {});
  if (!result.success) return 0;
  return Number(result.data?.balance ?? 0);
}

/** Peer-to-peer BDAG transfer. No gas, no fee. Max 20/hour. */
export async function transferBdagApi(params: {
  toUserId: string;
  amount:   number;
}): Promise<{ success: boolean; error?: string }> {
  if (!params.toUserId)    return { success: false, error: 'to_user_id required' };
  if (params.amount <= 0)  return { success: false, error: 'amount must be positive' };
  return callLedger('transfer', { to_user_id: params.toUserId, amount: params.amount });
}

/** Purchase exclusive content. Idempotent. 90% creator / 10% platform. */
export async function purchaseContentApi(params: {
  contentId: string;
}): Promise<{ success: boolean; error?: string; alreadyPurchased?: boolean }> {
  if (!params.contentId) return { success: false, error: 'content_id required' };
  const result = await callLedger('purchase', { content_id: params.contentId });
  if (!result.success && result.error?.includes('already_purchased')) {
    return { success: true, alreadyPurchased: true };
  }
  return result;
}

/** Subscribe to a creator plan. */
export async function subscribeToCreatorApi(params: {
  planId: string;
}): Promise<{ success: boolean; error?: string; alreadySubscribed?: boolean }> {
  if (!params.planId) return { success: false, error: 'plan_id required' };
  const result = await callLedger('subscribe', { plan_id: params.planId });
  if (!result.success && result.error?.includes('already_subscribed')) {
    return { success: true, alreadySubscribed: true };
  }
  return result;
}

/** Send a gift/tip to another user. 10% platform fee. */
export async function sendGiftApi(params: {
  toUserId:  string;
  amount:    number;
  giftType?: string;
  videoId?:  string;
}): Promise<{ success: boolean; error?: string }> {
  if (!params.toUserId)   return { success: false, error: 'to_user_id required' };
  if (params.amount <= 0) return { success: false, error: 'amount must be positive' };
  return callLedger('gift', {
    to_user_id: params.toUserId,
    amount:     params.amount,
    gift_type:  params.giftType ?? 'heart',
    video_id:   params.videoId ?? null,
  });
}

/** Boost a profile or content piece. Full amount goes to platform_fee account. */
export async function boostApi(params: {
  referenceId:   string;
  referenceType: string;
  boostType:     string;
  amount:        number;
  hours:         number;
  multiplier:    number;
}): Promise<{ success: boolean; error?: string; boostId?: string }> {
  if (!params.referenceId) return { success: false, error: 'reference_id required' };
  if (params.amount <= 0)  return { success: false, error: 'amount must be positive' };
  const result = await callLedger('boost', {
    reference_id:   params.referenceId,
    reference_type: params.referenceType,
    boost_type:     params.boostType,
    amount:         params.amount,
    hours:          params.hours,
    multiplier:     params.multiplier,
  });
  return { ...result, boostId: result.data?.boost_id as string | undefined };
}

/** Send a Premium DM with BDAG escrow (or free if subscriber quota available). */
export async function sendPremiumDmApi(params: {
  recipientId:  string;
  messageText:  string;
  amountBdag:   number;
}): Promise<{
  success:    boolean;
  error?:     string;
  messageId?: string;
  paymentId?: string;
  isFree?:    boolean;
  amount?:    number;
}> {
  if (!params.recipientId)  return { success: false, error: 'recipient_id required' };
  if (!params.messageText)  return { success: false, error: 'message_text required' };
  const result = await callLedger('premium_dm_send', {
    recipient_id: params.recipientId,
    message_text: params.messageText,
    amount_bdag:  params.amountBdag,
  });
  return {
    ...result,
    messageId: result.data?.message_id as string | undefined,
    paymentId: result.data?.payment_id as string | undefined,
    isFree:    result.data?.is_free as boolean | undefined,
    amount:    result.data?.amount as number | undefined,
  };
}

/** Creator releases a held Premium DM payment (after replying). */
export async function releasePremiumDmApi(params: {
  paymentId: string;
}): Promise<{ success: boolean; error?: string; releasedAmount?: number }> {
  if (!params.paymentId) return { success: false, error: 'payment_id required' };
  const result = await callLedger('premium_dm_release', { payment_id: params.paymentId });
  return {
    ...result,
    releasedAmount: result.data?.released_amount as number | undefined,
  };
}

/** Get creator earnings breakdown by operation type. */
export async function getCreatorEarningsApi(userId: string): Promise<{
  contentSales:  number;
  subscriptions: number;
  premiumDms:    number;
  gifts:         number;
  total:         number;
}> {
  const empty = { contentSales: 0, subscriptions: 0, premiumDms: 0, gifts: 0, total: 0 };
  if (!userId) return empty;

  // SECURITY: always filter by owner_id — never .single() without owner_id
  const { data: acct } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('owner_id', userId)          // ← scoped to specific user
    .eq('account_type', 'user')
    .single();

  if (!acct) return empty;

  const { data } = await supabase
    .from('financial_transactions')
    .select('operation_type, amount, fee_amount')
    .eq('to_account_id', acct.id)
    .in('operation_type', ['content_purchase', 'subscription', 'premium_dm', 'gift'])
    .eq('status', 'completed');

  const breakdown = { contentSales: 0, subscriptions: 0, premiumDms: 0, gifts: 0 };
  for (const txn of (data ?? [])) {
    const net = Number(txn.amount) - Number(txn.fee_amount);
    switch (txn.operation_type) {
      case 'content_purchase': breakdown.contentSales  += net; break;
      case 'subscription':     breakdown.subscriptions += net; break;
      case 'premium_dm':       breakdown.premiumDms    += net; break;
      case 'gift':             breakdown.gifts         += net; break;
    }
  }

  return { ...breakdown, total: Object.values(breakdown).reduce((a, b) => a + b, 0) };
}
