/**
 * hooks/useFinancialAccount.tsx
 *
 * Primary financial hook — single source of truth for all BDAG state.
 *
 * Architecture:
 *   - Balance: ledger_accounts (authoritative, ALWAYS filtered by owner_id)
 *   - History: financial_transactions + ledger_entries (both scoped by userId)
 *   - Operations: all route through bdag-ledger / bdag-deposit / bdag-withdraw
 *   - Polling: 30s interval keeps balance fresh (no real-time available)
 *
 * SECURITY: Every ledger read passes userId explicitly — no ambiguous .single() calls.
 *
 * Usage:
 *   const account = useFinancialAccount();
 *   account.balance          → authoritative BDAG balance
 *   account.transfer(id, 50) → atomic ledger transfer
 *   account.withdraw(...)    → queue-based withdrawal
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getLedgerBalance,
  getFinancialHistory,
  getLedgerEntries,
  listWithdrawals,
  transferBDAG,
  purchaseContent,
  subscribeToPlan,
  sendGift,
  boostContent,
  submitDeposit,
  requestWithdrawal,
  getCreatorEarnings,
  type FinancialTxn,
  type LedgerEntry,
} from '@/services/financial/ledgerClient';

const POLL_INTERVAL_MS = 30_000;

export interface CreatorEarnings {
  contentSales:  number;
  subscriptions: number;
  premiumDms:    number;
  gifts:         number;
  total:         number;
}

export interface OpResult {
  success: boolean;
  error?:  string;
  data?:   Record<string, unknown>;
}

export interface BoostParams {
  referenceId:   string;
  referenceType: string;
  boostType:     string;
  amount:        number;
  hours:         number;
  multiplier:    number;
}

export interface FinancialAccountState {
  // Balance (authoritative from ledger)
  balance:        number;
  balanceLoading: boolean;
  lastSyncAt:     Date | null;

  // Transaction history
  transactions:   FinancialTxn[];
  ledgerEntries:  LedgerEntry[];
  historyLoading: boolean;

  // Withdrawals
  withdrawals: Record<string, unknown>[];

  // Creator earnings (lazy-loaded)
  earnings: CreatorEarnings | null;

  // Operations
  transfer:  (toUserId: string, amount: number) => Promise<OpResult>;
  purchase:  (contentId: string) => Promise<OpResult>;
  subscribe: (planId: string) => Promise<OpResult>;
  gift:      (toUserId: string, amount: number, giftType?: string, videoId?: string) => Promise<OpResult>;
  boost:     (params: BoostParams) => Promise<OpResult>;
  deposit:   (txHash: string, chainId: string, walletAddress: string) => Promise<OpResult>;
  withdraw:  (amount: number, toAddress: string, chainId: string, tokenType: 'ETH' | 'USDT') => Promise<OpResult>;

  // Utilities
  refresh:      () => Promise<void>;
  loadEarnings: () => Promise<void>;
}

export function useFinancialAccount(): FinancialAccountState {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [balance,        setBalance]        = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [lastSyncAt,     setLastSyncAt]     = useState<Date | null>(null);
  const [transactions,   setTransactions]   = useState<FinancialTxn[]>([]);
  const [ledgerEntries,  setLedgerEntries]  = useState<LedgerEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [withdrawals,    setWithdrawals]    = useState<Record<string, unknown>[]>([]);
  const [earnings,       setEarnings]       = useState<CreatorEarnings | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Balance refresh (lightweight, polled) ──────────────────────────────
  const fetchBalance = useCallback(async () => {
    if (!userId) return;
    const bal = await getLedgerBalance(userId);  // always passes userId
    setBalance(bal);
    setLastSyncAt(new Date());
    setBalanceLoading(false);
  }, [userId]);

  // ── Full history refresh (heavier, on-demand) ──────────────────────────
  const fetchHistory = useCallback(async () => {
    if (!userId) return;
    setHistoryLoading(true);
    try {
      const [txns, entries, wds] = await Promise.all([
        getFinancialHistory(userId, 30),   // userId explicitly passed
        getLedgerEntries(userId, 50),      // userId explicitly passed
        listWithdrawals(),
      ]);
      setTransactions(txns);
      setLedgerEntries(entries);
      setWithdrawals(wds);
    } finally {
      setHistoryLoading(false);
    }
  }, [userId]);

  // ── Full refresh ───────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    await Promise.all([fetchBalance(), fetchHistory()]);
  }, [fetchBalance, fetchHistory]);

  // ── Lazy creator earnings ──────────────────────────────────────────────
  const loadEarnings = useCallback(async () => {
    if (!userId) return;
    const e = await getCreatorEarnings(userId);
    setEarnings(e);
  }, [userId]);

  // ── Polling setup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) {
      setBalanceLoading(false);
      setBalance(0);
      setTransactions([]);
      setLedgerEntries([]);
      return;
    }
    refresh();
    pollRef.current = setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [userId, refresh, fetchBalance]);

  // ── Operation wrapper: refresh balance on success ──────────────────────
  const withBalanceRefresh = useCallback(
    async (op: () => Promise<OpResult>): Promise<OpResult> => {
      const result = await op();
      if (result.success) void fetchBalance();
      return result;
    },
    [fetchBalance],
  );

  return {
    balance,
    balanceLoading,
    lastSyncAt,
    transactions,
    ledgerEntries,
    historyLoading,
    withdrawals,
    earnings,

    transfer: (toUserId, amount) =>
      withBalanceRefresh(() => transferBDAG({ toUserId, amount })),

    purchase: (contentId) =>
      withBalanceRefresh(() => purchaseContent({ contentId })),

    subscribe: (planId) =>
      withBalanceRefresh(() => subscribeToPlan({ planId })),

    gift: (toUserId, amount, giftType, videoId) =>
      withBalanceRefresh(() => sendGift({ toUserId, amount, giftType, videoId })),

    boost: (params) =>
      withBalanceRefresh(() => boostContent(params)),

    deposit: async (txHash, chainId, walletAddress) => {
      const result = await submitDeposit({ txHash, chainId, walletAddress });
      if (result.success) void refresh(); // also refresh history after deposit
      return result;
    },

    withdraw: async (amount, toAddress, chainId, tokenType) => {
      const result = await requestWithdrawal({ amount, toAddress, chainId, tokenType });
      if (result.success) void refresh();
      return result;
    },

    refresh,
    loadEarnings,
  };
}
