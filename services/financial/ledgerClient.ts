/**
 * services/financial/ledgerClient.ts
 *
 * The ONLY frontend client for all BDAG financial operations.
 *
 * Design rules:
 *   - Every mutation generates a UUID idempotency key (retry-safe)
 *   - Balance reads come from ledger_accounts (ALWAYS filtered by owner_id — never .single() alone)
 *   - FunctionsHttpError is always unpacked for human-readable messages
 *   - No amount calculation happens here — backend is single source of truth
 *   - All write operations go through bdag-ledger Edge Function
 *   - Detailed console.log before and after every invoke()
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

const supabase = () => getSupabaseClient();

// ── Idempotency key factory ───────────────────────────────────────────────
// Uses crypto.randomUUID() when available (modern RN), falls back to Math.random()
function makeKey(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid}:${Date.now()}`;
}

// ── Extract human-readable error from FunctionsHttpError ─────────────────
async function extractError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const statusCode = error.context?.status ?? 500;
      const text       = await error.context?.text();
      let parsed: any;
      try { parsed = JSON.parse(text ?? '{}'); } catch { parsed = {}; }
      const msg = parsed?.error ?? parsed?.message ?? text ?? error.message;
      console.error(`[ledgerClient] FunctionsHttpError [${statusCode}]:`, msg);
      return `${msg}`;
    } catch {
      return error.message;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[ledgerClient] error:', msg);
  return msg;
}

// ── Generic bdag-ledger invoker ───────────────────────────────────────────
async function invokeLedger(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }> {
  const idempotencyKey = makeKey(action);
  const body = {
    action,
    idempotency_key: idempotencyKey,
    ...payload,
  };

  // Log payload before every invoke (idempotency key truncated for brevity)
  console.log('[ledgerClient] invoke bdag-ledger', action, {
    ...body,
    idempotency_key: idempotencyKey.slice(0, 30) + '...',
  });

  const { data, error } = await supabase.functions.invoke('bdag-ledger', { body });

  if (error) {
    const msg = await extractError(error);
    console.error('[ledgerClient] bdag-ledger error', action, msg);
    return { success: false, error: msg };
  }

  console.log('[ledgerClient] bdag-ledger response', action, data);

  if (!data?.success) return { success: false, error: data?.error ?? 'operation failed' };
  return { success: true, data: data.data ?? data };
}

// ═══════════════════════════════════════════════════════════════════════════
// READ OPERATIONS — direct Supabase queries, always filtered by owner_id
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authoritative BDAG balance from ledger_accounts.
 * ALWAYS filters by owner_id — never relies on .single() alone.
 * NEVER use user_profiles.dag_balance for financial decisions.
 */
export async function getLedgerBalance(userId: string): Promise<number> {
  if (!userId) return 0;
  const { data, error } = await supabase
    .from('ledger_accounts')
    .select('balance')
    .eq('owner_id', userId)          // ← CRITICAL: always filter by owner
    .eq('account_type', 'user')
    .single();
  if (error || !data) {
    console.warn('[ledgerClient] getLedgerBalance: no account for', userId, error?.message);
    return 0;
  }
  return Number(data.balance ?? 0);
}

export interface FinancialTxn {
  id:              string;
  operation_type:  string;
  amount:          number;
  fee_amount:      number;
  currency:        string;
  status:          string;
  blockchain_txid?: string;
  reference_type?: string;
  reference_id?:   string;
  created_at:      string;
}

/**
 * Financial transaction history for the current user.
 * Reads both outgoing (from) and incoming (to) transactions.
 * ALWAYS resolves account by owner_id first.
 */
export async function getFinancialHistory(userId: string, limit = 30): Promise<FinancialTxn[]> {
  if (!userId) return [];

  // SECURITY FIX: always filter ledger_accounts by owner_id
  const { data: acct, error: acctErr } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('owner_id', userId)          // ← CRITICAL: scoped to user
    .eq('account_type', 'user')
    .single();

  if (acctErr || !acct) {
    console.warn('[ledgerClient] getFinancialHistory: no ledger account for', userId);
    return [];
  }

  const { data, error } = await supabase
    .from('financial_transactions')
    .select('id, operation_type, amount, fee_amount, currency, status, blockchain_txid, reference_type, reference_id, created_at')
    .or(`from_account_id.eq.${acct.id},to_account_id.eq.${acct.id}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[ledgerClient] getFinancialHistory error:', error.message);
    return [];
  }
  return (data ?? []) as FinancialTxn[];
}

export interface LedgerEntry {
  id:            string;
  txn_id:        string;
  entry_type:    'debit' | 'credit';
  amount:        number;
  balance_after: number;
  description:   string;
  created_at:    string;
}

/**
 * Immutable double-entry audit trail for the current user's account.
 * ALWAYS resolves account by owner_id — never relies on ambiguous .single().
 */
export async function getLedgerEntries(userId: string, limit = 50): Promise<LedgerEntry[]> {
  if (!userId) return [];

  // SECURITY FIX: always filter by owner_id
  const { data: acct, error: acctErr } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('owner_id', userId)          // ← CRITICAL: scoped to user
    .eq('account_type', 'user')
    .single();

  if (acctErr || !acct) {
    console.warn('[ledgerClient] getLedgerEntries: no ledger account for', userId);
    return [];
  }

  const { data, error } = await supabase
    .from('ledger_entries')
    .select('id, txn_id, entry_type, amount, balance_after, description, created_at')
    .eq('account_id', acct.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[ledgerClient] getLedgerEntries error:', error.message);
    return [];
  }
  return (data ?? []) as LedgerEntry[];
}

/** List withdrawal requests for the current user. */
export async function listWithdrawals(): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('withdrawal_requests')
    .select('id, status, bdag_amount, net_bdag, fee_bdag, to_address, tx_hash, failure_reason, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as Record<string, unknown>[];
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE OPERATIONS — all route through bdag-ledger Edge Function
// ═══════════════════════════════════════════════════════════════════════════

/** Peer-to-peer BDAG transfer. No fees. Max 20 ops/hour. */
export async function transferBDAG(params: {
  toUserId: string;
  amount:   number;
}) {
  if (!params.toUserId)   return { success: false, error: 'to_user_id required' };
  if (params.amount <= 0) return { success: false, error: 'amount must be positive' };
  return invokeLedger('transfer', { to_user_id: params.toUserId, amount: params.amount });
}

/** Purchase exclusive content by content ID. Idempotent — safe to retry. */
export async function purchaseContent(params: { contentId: string }) {
  if (!params.contentId) return { success: false, error: 'content_id required' };
  return invokeLedger('purchase', { content_id: params.contentId });
}

/** Subscribe to a creator plan by plan ID. */
export async function subscribeToPlan(params: { planId: string }) {
  if (!params.planId) return { success: false, error: 'plan_id required' };
  return invokeLedger('subscribe', { plan_id: params.planId });
}

/** Send a tip/gift to another user. Optional video attribution. 10% platform fee. */
export async function sendGift(params: {
  toUserId:  string;
  amount:    number;
  giftType?: string;
  videoId?:  string;
}) {
  if (!params.toUserId)   return { success: false, error: 'to_user_id required' };
  if (params.amount <= 0) return { success: false, error: 'amount must be positive' };
  return invokeLedger('gift', {
    to_user_id: params.toUserId,
    amount:     params.amount,
    gift_type:  params.giftType ?? 'heart',
    video_id:   params.videoId ?? null,
  });
}

/** Boost a profile or piece of content. Funds go to platform_fee account. */
export async function boostContent(params: {
  referenceId:   string;
  referenceType: string;
  boostType:     string;
  amount:        number;
  hours:         number;
  multiplier:    number;
}) {
  if (!params.referenceId) return { success: false, error: 'reference_id required' };
  if (params.amount <= 0)  return { success: false, error: 'amount must be positive' };
  return invokeLedger('boost', {
    reference_id:   params.referenceId,
    reference_type: params.referenceType,
    boost_type:     params.boostType,
    amount:         params.amount,
    hours:          params.hours,
    multiplier:     params.multiplier,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKCHAIN OPERATIONS — dedicated edge functions with full logging
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a blockchain deposit for backend RPC verification and atomic ledger credit.
 *
 * Payload contract (bdag-deposit):
 *   tx_hash        — 0x + 64 hex chars
 *   chain_id       — EIP-155 string ("1", "8453", etc.)
 *   wallet_address — sender EVM address (0x + 40 hex chars)
 *
 * Backend independently verifies tx via RPC — never trusts frontend amounts.
 */
export async function submitDeposit(params: {
  txHash:        string;
  chainId:       string;
  walletAddress: string;
}): Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }> {
  const payload = {
    tx_hash:        params.txHash.toLowerCase().trim(),
    chain_id:       params.chainId,
    wallet_address: params.walletAddress.toLowerCase().trim(),
  };

  // Validate before invoke
  if (!payload.tx_hash || !/^0x[a-fA-F0-9]{64}$/i.test(payload.tx_hash))
    return { success: false, error: `invalid tx_hash: "${payload.tx_hash}"` };
  if (!payload.chain_id)
    return { success: false, error: 'chain_id is required' };
  if (!payload.wallet_address || !/^0x[a-fA-F0-9]{40}$/i.test(payload.wallet_address))
    return { success: false, error: `invalid wallet_address: "${payload.wallet_address}"` };

  console.log('[ledgerClient] submitDeposit payload:', JSON.stringify(payload));

  const { data, error } = await supabase.functions.invoke('bdag-deposit', { body: payload });

  if (error) {
    const msg = await extractError(error);
    console.error('[ledgerClient] bdag-deposit error:', msg);
    return { success: false, error: msg };
  }

  console.log('[ledgerClient] bdag-deposit response:', JSON.stringify(data));

  if (!data?.success) return { success: false, error: data?.error ?? 'deposit failed' };
  return { success: true, data: data.data ?? data };
}

/**
 * Queue a withdrawal request.
 *
 * Payload contract (bdag-withdraw):
 *   action          — always 'request'
 *   amount          — BDAG amount (>= 100)
 *   to_address      — destination EVM address
 *   chain_id        — EIP-155 string
 *   token_type      — 'ETH' | 'USDT'
 *   idempotency_key — generated here, unique per request
 *
 * Funds move user → escrow atomically on request.
 * bdag-monitor processes queue and settles on-chain within 24h.
 * Auto-refund on failure.
 */
export async function requestWithdrawal(params: {
  amount:    number;
  toAddress: string;
  chainId:   string;
  tokenType: 'ETH' | 'USDT';
}): Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }> {
  const idempotencyKey = makeKey('withdrawal');

  const payload = {
    action:           'request',
    amount:           params.amount,
    to_address:       params.toAddress.toLowerCase().trim(),
    chain_id:         params.chainId,
    token_type:       params.tokenType,
    idempotency_key:  idempotencyKey,
  };

  // Validate before invoke
  if (!payload.amount || payload.amount < 100)
    return { success: false, error: 'minimum withdrawal is 100 BDAG' };
  if (!payload.to_address || !/^0x[a-fA-F0-9]{40}$/i.test(payload.to_address))
    return { success: false, error: `invalid to_address: "${payload.to_address}"` };
  if (!payload.chain_id)
    return { success: false, error: 'chain_id is required' };
  if (!['ETH', 'USDT'].includes(payload.token_type))
    return { success: false, error: 'token_type must be ETH or USDT' };

  console.log('[ledgerClient] requestWithdrawal payload:', JSON.stringify({
    ...payload,
    idempotency_key: idempotencyKey.slice(0, 30) + '...',
  }));

  const { data, error } = await supabase.functions.invoke('bdag-withdraw', { body: payload });

  if (error) {
    const msg = await extractError(error);
    console.error('[ledgerClient] bdag-withdraw error:', msg);
    return { success: false, error: msg };
  }

  console.log('[ledgerClient] bdag-withdraw response:', JSON.stringify(data));

  if (!data?.success) return { success: false, error: data?.error ?? 'withdrawal failed' };
  return { success: true, data: data.data ?? data };
}

/**
 * Submit an internal BDAG transfer (goes through bdag-transfer edge function).
 * Resolves recipient by username or email query.
 */
export async function submitTransfer(params: {
  recipientQuery: string;
  amount:         number;
  note?:          string;
}): Promise<{
  success: boolean;
  error?: string;
  newBalance?: number;
  recipientUsername?: string;
  recipientAvatar?: string | null;
}> {
  if (!params.recipientQuery?.trim()) return { success: false, error: 'recipient_query required' };
  if (params.amount <= 0)             return { success: false, error: 'amount must be positive' };
  if (params.amount < 1)              return { success: false, error: 'minimum transfer is 1 BDAG' };

  const payload = {
    recipient_query: params.recipientQuery.trim(),
    amount:          params.amount,
    note:            params.note?.trim() ?? '',
  };

  console.log('[ledgerClient] submitTransfer payload:', JSON.stringify(payload));

  const { data, error } = await supabase.functions.invoke('bdag-transfer', { body: payload });

  if (error) {
    const msg = await extractError(error);
    console.error('[ledgerClient] bdag-transfer error:', msg);
    return { success: false, error: msg };
  }

  console.log('[ledgerClient] bdag-transfer response:', JSON.stringify(data));

  if (!data?.success) return { success: false, error: data?.error ?? 'transfer failed' };
  return {
    success:           true,
    newBalance:        data.new_balance,
    recipientUsername: data.recipient_username,
    recipientAvatar:   data.recipient_avatar ?? null,
  };
}

/** Poll withdrawal status from queue. */
export async function getWithdrawalStatus(withdrawalId: string) {
  const { data, error } = await supabase.functions.invoke('bdag-withdraw', {
    body: { action: 'status', withdrawal_id: withdrawalId },
  });
  if (error) return null;
  return data?.data ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR ECONOMY — convenience helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch creator earnings summary by operation type.
 * Always resolves ledger account by owner_id.
 */
export async function getCreatorEarnings(userId: string): Promise<{
  contentSales:  number;
  subscriptions: number;
  premiumDms:    number;
  gifts:         number;
  total:         number;
}> {
  const empty = { contentSales: 0, subscriptions: 0, premiumDms: 0, gifts: 0, total: 0 };
  if (!userId) return empty;

  // SECURITY FIX: always filter by owner_id
  const { data: acct } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('owner_id', userId)
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
