/**
 * hooks/useWallet.tsx — Multi-layer platform wallet (v5 — polling-based sync)
 *
 * Layer A: Blockchain deposits/withdrawals via Edge Functions
 * Layer B: BDAG credit balance in ledger_accounts (authoritative, always scoped by owner_id)
 * Layer C: conversionEngine.ts for asset↔BDAG display math
 *
 * NOTE (v5): Realtime is NOT supported by this backend.
 * Balance sync uses:
 *   - Initial load on mount
 *   - Background poll every 30 seconds
 *   - Post-deposit burst poll: 5× every 3 seconds after successful deposit
 *   - Explicit fullSync() calls after any write operation
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { getSupabaseClient } from '@/template';
import {
  MIN_WITHDRAWAL_AMOUNT,
  TREASURY_ADDRESSES,
  TREASURY_DEPOSIT_ADDRESS,
  isValidEvmAddress,
} from '@/services/walletConfig';
import {
  bdagToWithdrawAsset,
  bdagToUsd,
  type DepositAsset,
} from '@/services/conversionEngine';
import {
  submitDepositToBackend,
  requestWithdrawalFromBackend,
  transferBdagToUser,
  chainKeyToId,
  assetToTokenType,
} from '@/services/walletApi';

export { MIN_WITHDRAWAL_AMOUNT as MIN_WITHDRAWAL_BDAG };

// ── Types ─────────────────────────────────────────────────────────────────────

export type TxType   = 'reward' | 'withdraw' | 'deposit' | 'tip' | 'gift';
export type TxStatus = 'pending' | 'completed' | 'failed';

export interface PlatformTransaction {
  id:             string;
  userId:         string;
  amount:         number;
  feeAmount:      number;
  type:           TxType;
  status:         TxStatus;
  description:    string;
  txHash?:        string;
  walletAddress?: string;
  createdAt:      string;
  chainKey?:      string;
}

export interface WalletStats {
  totalEarned:       number;
  totalWithdrawn:    number;
  totalDeposited:    number;
  totalEarnedUsd:    number;
  totalDepositedUsd: number;
}

export interface SyncStatus {
  isSyncing:  boolean;
  lastSyncAt: Date | null;
  syncError:  string | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWallet() {
  const { user, updateDAGBalance } = useAuth();
  const supabase = getSupabaseClient();

  const [transactions,       setTransactions]      = useState<PlatformTransaction[]>([]);
  const [syncStatus,         setSyncStatus]         = useState<SyncStatus>({ isSyncing: false, lastSyncAt: null, syncError: null });
  const [isWithdrawing,      setIsWithdrawing]      = useState(false);
  const [isVerifyingDeposit, setIsVerifyingDeposit] = useState(false);
  const [isLoadingTx,        setIsLoadingTx]        = useState(false);

  const userIdRef    = useRef<string | null>(null);
  const supa         = useRef(supabase);
  const updateBal    = useRef(updateDAGBalance);
  const isSyncing    = useRef(false);
  const isBalWriting = useRef(false);

  useEffect(() => { supa.current = supabase; });
  useEffect(() => { updateBal.current = updateDAGBalance; });
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user?.id]);

  // ── Read authoritative balance from ledger_accounts ────────────────────
  const dbBalance = useCallback(async (): Promise<number> => {
    const uid = userIdRef.current;
    if (!uid || isBalWriting.current) return 0;
    isBalWriting.current = true;
    try {
      const { data: ledger } = await supa.current
        .from('ledger_accounts')
        .select('balance')
        .eq('owner_id', uid)
        .eq('account_type', 'user')
        .single();

      if (ledger) {
        const bal = Number(ledger.balance ?? 0);
        updateBal.current(bal);
        return bal;
      }

      // Fallback: user_profiles.dag_balance
      const { data: profile } = await supa.current
        .from('user_profiles').select('dag_balance').eq('id', uid).single();
      const bal = Number(profile?.dag_balance ?? 0);
      updateBal.current(bal);
      return bal;
    } catch {
      return 0;
    } finally {
      // Always reset the guard — must be in finally to handle thrown errors too
      isBalWriting.current = false;
    }
  }, []);

  // ── Load transaction history ──────────────────────────────────────────
  const loadTx = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setIsLoadingTx(true);
    try {
      const { data: acct } = await supa.current
        .from('ledger_accounts')
        .select('id')
        .eq('owner_id', uid)
        .eq('account_type', 'user')
        .single();

      const mapped: PlatformTransaction[] = [];

      if (acct?.id) {
        const { data: ledgerTxns } = await supa.current
          .from('financial_transactions')
          .select('id, operation_type, amount, fee_amount, currency, status, blockchain_txid, reference_type, reference_id, created_at, from_account_id, to_account_id')
          .or(`from_account_id.eq.${acct.id},to_account_id.eq.${acct.id}`)
          .order('created_at', { ascending: false })
          .limit(60);

        if (ledgerTxns && Array.isArray(ledgerTxns) && ledgerTxns.length > 0) {
          for (const t of ledgerTxns) {
            mapped.push({
              id:          t.id,
              userId:      uid,
              amount:      Number(t.amount ?? 0),
              feeAmount:   Number(t.fee_amount ?? 0),
              type:        opTypeToTxType(t.operation_type),
              status:      t.status === 'completed' ? 'completed' : t.status === 'reversed' ? 'failed' : 'pending',
              description: buildDescription(t),
              txHash:      t.blockchain_txid ?? undefined,
              createdAt:   t.created_at,
            });
          }
        }
      }

      // Fallback: legacy transactions table
      if (mapped.length === 0) {
        const { data: legacyTxns } = await supa.current
          .from('transactions').select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(60);

        if (legacyTxns) {
          for (const t of legacyTxns) {
            mapped.push({
              id:            t.id,
              userId:        t.user_id,
              amount:        Number(t.amount),
              feeAmount:     Number(t.fee_amount ?? 0),
              type:          t.type,
              status:        t.status,
              description:   t.description,
              txHash:        t.tx_hash ?? undefined,
              walletAddress: t.wallet_address ?? undefined,
              createdAt:     t.created_at,
            });
          }
        }
      }

      setTransactions(mapped.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } finally {
      setIsLoadingTx(false);
    }
  }, []);

  // ── Full sync ─────────────────────────────────────────────────────────
  const fullSync = useCallback(async () => {
    if (!userIdRef.current || isSyncing.current) return;
    isSyncing.current = true;
    setSyncStatus(s => ({ ...s, isSyncing: true, syncError: null }));
    try {
      await Promise.all([dbBalance(), loadTx()]);
      setSyncStatus({ isSyncing: false, lastSyncAt: new Date(), syncError: null });
    } catch (e: any) {
      setSyncStatus(s => ({ ...s, isSyncing: false, syncError: e?.message ?? 'Sync error' }));
    } finally {
      isSyncing.current = false;
    }
  }, [dbBalance, loadTx]);

  // ── Post-deposit/withdrawal burst poll ────────────────────────────────
  // Polls the balance 5 times every 3 seconds after a write operation
  // to quickly reflect backend credits without requiring manual refresh.
  // This replaces realtime subscriptions which are not supported.
  const pollBalanceBurst = useCallback(async (times = 5, intervalMs = 3000) => {
    for (let i = 0; i < times; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const uid = userIdRef.current;
      if (!uid) break;
      try {
        const { data: ledger } = await supa.current
          .from('ledger_accounts')
          .select('balance')
          .eq('owner_id', uid)
          .eq('account_type', 'user')
          .single();
        if (ledger) {
          const bal = Number(ledger.balance ?? 0);
          updateBal.current(bal);
          console.log(`[useWallet] burst poll ${i + 1}/${times} — balance: ${bal}`);
        }
      } catch { /* ignore transient errors */ }
    }
    // Final full sync to also refresh tx history
    loadTx().catch(() => {});
  }, [loadTx]);

  // ── Mount / user change: initial load + 30s background poll ──────────
  // Realtime is NOT supported — we use polling as the sync mechanism.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) {
      setTransactions([]);
      setSyncStatus({ isSyncing: false, lastSyncAt: null, syncError: null });
      return;
    }

    // Initial load immediately
    fullSync();

    // Background poll every 30 seconds to stay current
    const pollInterval = setInterval(() => {
      dbBalance().catch(() => {});
    }, 30_000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [user?.id]);

  // ── Connect wallet address to profile ─────────────────────────────────
  const connectWalletAddress = useCallback(async (address: string) => {
    const uid = userIdRef.current;
    if (!uid) return { success: false, error: 'No autenticado' };
    const addr = address.trim().toLowerCase();
    if (!isValidEvmAddress(addr)) return { success: false, error: 'Dirección EVM inválida' };
    const { error } = await supa.current
      .from('user_profiles').update({ wallet_address: addr }).eq('id', uid);
    return error ? { success: false, error: error.message } : { success: true };
  }, []);

  // ── DEPOSIT ────────────────────────────────────────────────────────────
  const verifyAndCreditDeposit = useCallback(async (
    txHash:         string,
    chainKey?:      string,
    walletAddress?: string,
    _assetType?:    DepositAsset,
    _txData?:       any,
    _receiptData?:  any,
    _blockHex?:     string,
  ): Promise<{ success: boolean; amount?: number; error?: string; queued?: boolean }> => {
    const uid = userIdRef.current;
    if (!uid) return { success: false, error: 'No autenticado' };

    setIsVerifyingDeposit(true);
    try {
      const resolvedChainKey = chainKey ?? 'ethereum';
      const resolvedChainId  = chainKeyToId(resolvedChainKey);
      const resolvedAddr     = (walletAddress ?? '').trim().toLowerCase();

      if (!txHash || !/^0x[a-fA-F0-9]{64}$/i.test(txHash)) {
        return { success: false, error: `invalid tx_hash format: "${txHash?.slice(0, 12)}..."` };
      }
      if (!resolvedAddr || !/^0x[a-fA-F0-9]{40}$/i.test(resolvedAddr)) {
        return { success: false, error: 'wallet_address required for deposit verification' };
      }

      const result = await submitDepositToBackend({
        txHash,
        chainKey:      resolvedChainKey,
        walletAddress: resolvedAddr,
      });

      if (result.success) {
        // Immediate sync then burst poll to catch the credited balance
        await dbBalance();
        await loadTx();
        pollBalanceBurst(5, 3000); // non-blocking burst: 5 polls × 3s
        return { success: true, amount: result.bdagCredited };
      }

      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Error desconocido' };
    } finally {
      setIsVerifyingDeposit(false);
    }
  }, [dbBalance, loadTx, pollBalanceBurst]);

  // ── WITHDRAWAL ────────────────────────────────────────────────────────
  const requestWithdraw = useCallback(async (
    bdagAmount:    number,
    toAddress:     string,
    withdrawAsset: DepositAsset = 'usdt',
    chainKey?:     string,
  ): Promise<{ success: boolean; error?: string; refunded?: boolean; netAssetAmount?: number; txHash?: string }> => {
    const uid = userIdRef.current;
    if (!uid) return { success: false, error: 'No autenticado' };

    const destAddr = (toAddress ?? '').trim().toLowerCase();
    if (!isValidEvmAddress(destAddr))
      return { success: false, error: 'Wallet destino inválida (debe ser 0x + 40 hex chars)' };
    if (bdagAmount < MIN_WITHDRAWAL_AMOUNT)
      return { success: false, error: `Mínimo: ${MIN_WITHDRAWAL_AMOUNT} BDAG` };

    const liveBal = await dbBalance();
    if (bdagAmount > liveBal)
      return { success: false, error: `Saldo insuficiente. Disponible: ${liveBal.toFixed(2)} BDAG` };

    setIsWithdrawing(true);
    try {
      const result = await requestWithdrawalFromBackend({
        amount:    bdagAmount,
        toAddress: destAddr,
        chainKey:  chainKey ?? 'ethereum',
        asset:     withdrawAsset,
      });

      await dbBalance();
      await loadTx();

      if (!result.success) return { success: false, error: result.error };

      const netAsset = bdagToWithdrawAsset(result.netBdag ?? 0, withdrawAsset);
      return { success: true, netAssetAmount: netAsset };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Error desconocido' };
    } finally {
      setIsWithdrawing(false);
    }
  }, [dbBalance, loadTx]);

  // ── TRANSFER ──────────────────────────────────────────────────────────
  const transferBdag = useCallback(async (
    recipientQuery: string,
    bdagAmount:     number,
    note?:          string,
  ): Promise<{
    success: boolean;
    error?: string;
    newBalance?: number;
    recipientUsername?: string;
    recipientAvatar?: string | null;
  }> => {
    const uid = userIdRef.current;
    if (!uid) return { success: false, error: 'No autenticado' };

    try {
      const result = await transferBdagToUser({ recipientQuery, amount: bdagAmount, note });
      if (result.success) {
        await dbBalance();
        await loadTx();
      }
      return result;
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Error desconocido' };
    }
  }, [dbBalance, loadTx]);

  // ── ADD REWARD (legacy) ───────────────────────────────────────────────
  const addReward = useCallback(async (
    amount: number,
    description: string,
    type: 'reward' | 'tip' | 'gift' = 'reward',
  ) => {
    const uid = userIdRef.current;
    if (!uid || amount <= 0) return;

    let waited = 0;
    while (isBalWriting.current && waited < 500) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    isBalWriting.current = true;
    try {
      const { data: prof } = await supa.current
        .from('user_profiles').select('dag_balance').eq('id', uid).single();
      const newBal = Number((Number(prof?.dag_balance ?? 0) + amount).toFixed(8));
      await Promise.all([
        supa.current.from('user_profiles').update({ dag_balance: newBal }).eq('id', uid),
        supa.current.from('transactions').insert({
          user_id: uid, amount, type, status: 'completed', description,
        }),
      ]);
      updateBal.current(newBal);
    } finally {
      isBalWriting.current = false;
    }
    await loadTx();
  }, [loadTx]);

  // ── Treasury address helper ───────────────────────────────────────────
  const getTreasuryAddress = useCallback((chainKey?: string): string => {
    if (!chainKey) return TREASURY_DEPOSIT_ADDRESS;
    return TREASURY_ADDRESSES[chainKey] ?? TREASURY_DEPOSIT_ADDRESS;
  }, []);

  // ── Computed stats ────────────────────────────────────────────────────
  const totalEarned    = transactions.filter(t => ['reward','tip','gift'].includes(t.type) && t.status === 'completed').reduce((s, t) => s + t.amount, 0);
  const totalDeposited = transactions.filter(t => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + t.amount, 0);

  const stats: WalletStats = {
    totalEarned,
    totalWithdrawn:    transactions.filter(t => t.type === 'withdraw' && t.status === 'completed').reduce((s, t) => s + t.amount, 0),
    totalDeposited,
    totalEarnedUsd:    bdagToUsd(totalEarned),
    totalDepositedUsd: bdagToUsd(totalDeposited),
  };

  return {
    balance:               user?.dagBalance ?? 0,
    walletAddress:         user?.walletAddress ?? null,
    getTreasuryAddress,
    treasuryAddress:       TREASURY_DEPOSIT_ADDRESS,
    transactions,
    stats,
    syncStatus,
    isLoadingTx,
    isWithdrawing,
    isVerifyingDeposit,
    connectWalletAddress,
    verifyAndCreditDeposit,
    requestWithdraw,
    addReward,
    transferBdag,
    fullSync,
    pollBalanceBurst,
    refreshBalance: dbBalance,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function opTypeToTxType(opType: string): TxType {
  switch (opType) {
    case 'deposit':          return 'deposit';
    case 'withdrawal':       return 'withdraw';
    case 'transfer':         return 'tip';
    case 'gift':             return 'gift';
    case 'reward':           return 'reward';
    case 'content_purchase': return 'tip';
    case 'subscription':     return 'tip';
    case 'premium_dm':       return 'tip';
    case 'boost':            return 'withdraw';
    default:                 return 'reward';
  }
}

function buildDescription(t: any): string {
  switch (t.operation_type) {
    case 'deposit':          return `Depósito blockchain${t.blockchain_txid ? ` · ${t.blockchain_txid.slice(0, 10)}...` : ''}`;
    case 'withdrawal':       return 'Retiro BDAG';
    case 'transfer':         return 'Transferencia BDAG';
    case 'gift':             return 'Regalo enviado';
    case 'content_purchase': return 'Compra de contenido exclusivo';
    case 'subscription':     return 'Suscripción a creador';
    case 'premium_dm':       return 'Premium DM';
    case 'boost':            return 'Boost de perfil/contenido';
    default:                 return t.operation_type ?? 'Transacción';
  }
}
