/**
 * services/walletApi.ts
 *
 * Centralized, validated request builders for all blockchain wallet operations.
 *
 * Contract rules (must match backend exactly):
 *   bdag-deposit  expects: { tx_hash, chain_id, wallet_address }
 *   bdag-withdraw expects: { action, amount, to_address, chain_id, token_type, idempotency_key }
 *   bdag-transfer expects: { recipient_query, amount, note }
 *
 * All idempotency keys are generated here — never in the UI layer.
 * All payloads are validated before invoke() to surface errors before network round-trip.
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

const supabase = getSupabaseClient();

// ── Idempotency key factory ─────────────────────────────────────────────────
// Uses crypto.randomUUID() when available (modern RN), falls back to Math.random()
export function generateIdempotencyKey(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid}:${Date.now()}`;
}

// ── Chain ID map (network key → EIP-155 chain ID string) ─────────────────
const CHAIN_ID_MAP: Record<string, string> = {
  ethereum:  '1',
  base:      '8453',
  sepolia:   '11155111',
  bsc:       '56',
  bsc_test:  '97',
};

export function chainKeyToId(chainKey: string): string {
  return CHAIN_ID_MAP[chainKey] ?? '1';
}

// ── Asset type → token_type normalization ─────────────────────────────────
export function assetToTokenType(asset: string): 'ETH' | 'USDT' {
  return asset?.toLowerCase() === 'usdt' ? 'USDT' : 'ETH';
}

// ── Error extractor ───────────────────────────────────────────────────────
export async function extractApiError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const statusCode = error.context?.status ?? 500;
      const text       = await error.context?.text();
      let parsed: any;
      try { parsed = JSON.parse(text ?? '{}'); } catch { parsed = {}; }
      const msg = parsed?.error ?? parsed?.message ?? text ?? error.message;
      console.error(`[walletApi] FunctionsHttpError [${statusCode}]:`, msg);
      return `${msg}`;
    } catch {
      return error.message;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  console.error('[walletApi] error:', msg);
  return msg;
}

// ── Retry helper: exponential backoff ────────────────────────────────────
async function invokeWithRetry<T>(
  fn:       () => Promise<T>,
  retries = 3,
  baseMs  = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        const delay = baseMs * Math.pow(2, i); // 1s, 2s, 4s
        console.warn(`[walletApi] invoke failed (attempt ${i + 1}/${retries}), retrying in ${delay}ms:`, (e as Error)?.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}


// Call these BEFORE invoke() to surface missing-field errors locally.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepositPayload {
  tx_hash:        string;   // 0x + 64 hex chars
  chain_id:       string;   // EIP-155 chain ID (e.g. "1", "8453")
  wallet_address: string;   // sender's EVM address (0x + 40 hex chars)
}

export function validateDepositPayload(p: Partial<DepositPayload>): string | null {
  if (!p.tx_hash)        return 'tx_hash is required';
  if (!/^0x[a-fA-F0-9]{64}$/i.test(p.tx_hash))
    return `invalid tx_hash format: "${p.tx_hash}" (must be 0x + 64 hex chars)`;
  if (!p.chain_id)       return 'chain_id is required';
  if (!p.wallet_address) return 'wallet_address is required';
  if (!/^0x[a-fA-F0-9]{40}$/i.test(p.wallet_address))
    return `invalid wallet_address format: "${p.wallet_address}" (must be 0x + 40 hex chars)`;
  return null;
}

export interface WithdrawalPayload {
  amount:           number;           // BDAG amount (>= 100)
  to_address:       string;           // destination EVM address
  chain_id:         string;           // EIP-155 chain ID
  token_type:       'ETH' | 'USDT';  // withdrawal asset
  idempotency_key:  string;           // unique per request
  action:           'request';        // always 'request' for new withdrawal
}

export function validateWithdrawalPayload(p: Partial<WithdrawalPayload>): string | null {
  if (!p.amount || p.amount <= 0)      return 'amount must be positive';
  if (p.amount < 100)                  return 'minimum withdrawal is 100 BDAG';
  if (!p.to_address)                   return 'to_address is required';
  if (!/^0x[a-fA-F0-9]{40}$/i.test(p.to_address))
    return `invalid to_address format: "${p.to_address}"`;
  if (!p.chain_id)                     return 'chain_id is required';
  if (!p.token_type)                   return 'token_type is required (ETH or USDT)';
  if (!['ETH', 'USDT'].includes(p.token_type))
    return `token_type must be ETH or USDT, got: "${p.token_type}"`;
  if (!p.idempotency_key)              return 'idempotency_key is required';
  return null;
}

export interface TransferPayload {
  recipient_query: string;   // username, email, or user ID
  amount:          number;
  note?:           string;
}

export function validateTransferPayload(p: Partial<TransferPayload>): string | null {
  if (!p.recipient_query?.trim()) return 'recipient_query is required';
  if (!p.amount || p.amount <= 0) return 'amount must be positive';
  if (p.amount < 1)               return 'minimum transfer is 1 BDAG';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface DepositResult {
  success:       boolean;
  error?:        string;
  bdagCredited?: number;
  tokenType?:    string;
  newBalance?:   number;
  finTxnId?:     string;
  blockNumber?:  number;
}

/**
 * Submit a blockchain deposit for backend verification and BDAG crediting.
 *
 * Backend (bdag-deposit) independently verifies the tx via RPC:
 *   - Never trusts frontend-provided amounts
 *   - Verifies tx recipient = treasury
 *   - Checks confirmations depth
 *   - Prevents replay attacks (UNIQUE tx_hash + chain_id)
 *
 * @param txHash       Transaction hash from the blockchain (0x + 64 hex)
 * @param chainKey     Network key: 'ethereum' | 'base' | 'sepolia' etc.
 * @param walletAddress Sender's EVM address (the connected wallet)
 */
export async function submitDepositToBackend(params: {
  txHash:        string;
  chainKey:      string;
  walletAddress: string;
}): Promise<DepositResult> {
  const payload: DepositPayload = {
    tx_hash:        params.txHash.toLowerCase().trim(),
    chain_id:       chainKeyToId(params.chainKey),
    wallet_address: params.walletAddress.toLowerCase().trim(),
  };

  console.log('[walletApi] submitDeposit payload:', JSON.stringify(payload));

  const validationError = validateDepositPayload(payload);
  if (validationError) {
    console.error('[walletApi] deposit validation failed:', validationError);
    return { success: false, error: validationError };
  }

  let lastResult: DepositResult = { success: false, error: 'all retries failed' };

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.functions.invoke('bdag-deposit', { body: payload });

    if (error) {
      const msg = await extractApiError(error);
      console.error(`[walletApi] bdag-deposit error (attempt ${attempt + 1}):`, msg);
      lastResult = { success: false, error: msg };
      // Only retry on network-level errors (not business logic rejections)
      const isNetworkError = msg.toLowerCase().includes('failed to fetch') ||
                             msg.toLowerCase().includes('networkerror') ||
                             msg.toLowerCase().includes('network request') ||
                             msg.toLowerCase().includes('timeout');
      if (!isNetworkError) break; // don't retry validation or business errors
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }

    console.log(`[walletApi] bdag-deposit response (attempt ${attempt + 1}):`, JSON.stringify(data));

    // 202 retryable: tx not yet visible in mempool — retry after backoff
    if (data?.success === false && (data?.error ?? '').toLowerCase().includes('not yet visible')) {
      lastResult = { success: false, error: data.error };
      if (attempt < 2) {
        const delay = 3000 * (attempt + 1); // 3s, 6s
        console.log(`[walletApi] tx not visible yet — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!data?.success) {
      lastResult = { success: false, error: data?.error ?? 'deposit verification failed' };
      break;
    }

    // Idempotent hit: already credited
    if (data?.data?.already_credited || data?.already_credited) {
      return {
        success:      true,
        bdagCredited: Number(data.data?.bdag_credited ?? 0),
        newBalance:   Number(data.data?.new_balance ?? 0),
      };
    }

    return {
      success:      true,
      bdagCredited: Number(data.data?.bdag_credited ?? data.bdag_credited ?? 0),
      tokenType:    data.data?.token_type ?? data.token_type,
      newBalance:   Number(data.data?.new_balance ?? data.new_balance ?? 0),
      finTxnId:     data.data?.fin_txn_id ?? data.fin_txn_id,
      blockNumber:  data.data?.block_number ?? data.block_number,
    };
  }

  return lastResult;
}

export interface WithdrawalResult {
  success:       boolean;
  error?:        string;
  withdrawalId?: string;
  finTxnId?:     string;
  netBdag?:      number;
  feeBdag?:      number;
  txHash?:       string;   // present when status = 'broadcasted'
  status?:       string;
  message?:      string;
}

/**
 * Request a BDAG withdrawal (queue-based, atomic).
 *
 * Funds move from user ledger → escrow immediately.
 * Settlement worker (bdag-monitor) processes the queue within 24h.
 * On failure, funds auto-refund from escrow back to user.
 *
 * @param amount       BDAG amount to withdraw (>= 100)
 * @param toAddress    Destination EVM wallet address
 * @param chainKey     Target chain: 'ethereum' | 'base'
 * @param asset        'usdt' | 'eth'
 */
export async function requestWithdrawalFromBackend(params: {
  amount:    number;
  toAddress: string;
  chainKey:  string;
  asset:     string;
}): Promise<WithdrawalResult> {
  const idempotencyKey = generateIdempotencyKey('withdrawal');

  const payload: WithdrawalPayload = {
    action:          'request',
    amount:          params.amount,
    to_address:      params.toAddress.toLowerCase().trim(),
    chain_id:        chainKeyToId(params.chainKey),
    token_type:      assetToTokenType(params.asset),
    idempotency_key: idempotencyKey,
  };

  console.log('[walletApi] requestWithdrawal payload:', JSON.stringify({
    ...payload,
    idempotency_key: payload.idempotency_key.slice(0, 30) + '...',
  }));

  const validationError = validateWithdrawalPayload(payload);
  if (validationError) {
    console.error('[walletApi] withdrawal validation failed:', validationError);
    return { success: false, error: validationError };
  }

  const { data, error } = await supabase.functions.invoke('bdag-withdraw', {
    body: payload,
  });

  if (error) {
    const msg = await extractApiError(error);
    console.error('[walletApi] bdag-withdraw error:', msg);
    return { success: false, error: msg };
  }

  console.log('[walletApi] bdag-withdraw response:', JSON.stringify(data));

  if (!data?.success) {
    return { success: false, error: data?.error ?? 'withdrawal request failed' };
  }

  const d = data.data ?? data;
  return {
    success:      true,
    withdrawalId: d.withdrawal_id,
    finTxnId:     d.fin_txn_id,
    netBdag:      Number(d.net_bdag ?? 0),
    feeBdag:      Number(d.fee_bdag ?? 0),
    txHash:       d.tx_hash ?? undefined,
    status:       d.status ?? 'broadcasted',
    message:      d.message,
  };
}

export interface TransferResult {
  success:           boolean;
  error?:            string;
  newBalance?:       number;
  recipientUsername?: string;
  recipientAvatar?:  string | null;
}

/**
 * Internal BDAG peer-to-peer transfer (no blockchain, no gas).
 * Routes through bdag-transfer edge function.
 */
export async function transferBdagToUser(params: {
  recipientQuery: string;
  amount:         number;
  note?:          string;
}): Promise<TransferResult> {
  const payload: TransferPayload = {
    recipient_query: params.recipientQuery.trim(),
    amount:          params.amount,
    note:            params.note?.trim() ?? '',
  };

  const validationError = validateTransferPayload(payload);
  if (validationError) {
    return { success: false, error: validationError };
  }

  console.log('[walletApi] transferBdag to:', payload.recipient_query, 'amount:', payload.amount);

  const { data, error } = await supabase.functions.invoke('bdag-transfer', {
    body: payload,
  });

  if (error) {
    const msg = await extractApiError(error);
    return { success: false, error: msg };
  }

  if (!data?.success) {
    return { success: false, error: data?.error ?? 'transfer failed' };
  }

  return {
    success:           true,
    newBalance:        data.new_balance,
    recipientUsername: data.recipient_username,
    recipientAvatar:   data.recipient_avatar ?? null,
  };
}

/**
 * Check status of a queued withdrawal.
 */
export async function getWithdrawalStatusFromBackend(withdrawalId: string): Promise<{
  status?: string;
  txHash?: string;
  failureReason?: string;
} | null> {
  const { data, error } = await supabase.functions.invoke('bdag-withdraw', {
    body: { action: 'status', withdrawal_id: withdrawalId },
  });
  if (error || !data?.success) return null;
  const d = data.data ?? data;
  return {
    status:        d.status,
    txHash:        d.tx_hash,
    failureReason: d.failure_reason,
  };
}
