/**
 * useBlockDAG Hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified hook for all BlockDAG wallet/token operations.
 * Consumes blockdagService and wraps state management.
 * Ready for native BlockDAG SDK integration — swap provider in blockdagService.ts.
 */

import { useState, useCallback, useMemo } from 'react';
import { getSupabaseClient } from '@/template';
import {
  blockdagProvider,
  BLOCKDAG_CONFIG,
  RewardCalculator,
  WalletUtils,
  TransactionBuilder,
  getCreatorTier,
  getNextTier,
  dagToNextTier,
  CREATOR_TIERS,
  type DAGTransaction,
  type WalletInfo,
  type WithdrawalRequest,
  type GiftPayload,
  type MarketplacePurchase,
  type CreatorTier,
} from '@/services/blockdagService';

interface UseBlockDAGOptions {
  userId?: string;
  dagBalance?: number;
  walletAddress?: string | null;
}

interface UseBlockDAGReturn {
  // ── State ──
  isProcessing: boolean;
  walletInfo: WalletInfo | null;
  recentTransactions: DAGTransaction[];

  // ── Wallet ──
  connectWallet: () => Promise<{ address: string | null; error?: string }>;
  disconnectWallet: () => Promise<void>;
  validateAddress: (address: string) => boolean;

  // ── Rewards ──
  calculateLikeReward: () => number;
  calculateGiftNet: (amount: number) => { creatorReceives: number; platformFee: number };
  projectedMonthly: (dailyLikes: number) => number;
  formatDAG: (amount: number) => string;

  // ── Withdrawal ──
  requestWithdrawal: (amount: number, destination: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  canWithdraw: (amount: number) => { valid: boolean; reason?: string };

  // ── Creator Tier ──
  currentTier: CreatorTier;
  tierInfo: typeof CREATOR_TIERS[CreatorTier];
  nextTier: CreatorTier | null;
  dagToNextTier: number;
  tierProgress: number; // 0–1

  // ── Wallet display ──
  shortAddress: string;
  config: typeof BLOCKDAG_CONFIG;
}

export function useBlockDAG({
  userId,
  dagBalance = 0,
  walletAddress,
}: UseBlockDAGOptions = {}): UseBlockDAGReturn {
  const supabase = getSupabaseClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<DAGTransaction[]>([]);

  // ── Wallet operations ──────────────────────────────────────────────────────
  const connectWallet = useCallback(async (): Promise<{ address: string | null; error?: string }> => {
    if (!userId) return { address: null, error: 'Usuario no autenticado' };
    setIsProcessing(true);
    try {
      const info = await blockdagProvider.connectWallet();
      if (!info) return { address: null, error: 'No se pudo conectar la wallet' };
      setWalletInfo(info);

      // Persist wallet address to profile
      await supabase
        .from('user_profiles')
        .update({ wallet_address: info.address })
        .eq('id', userId);

      return { address: info.address };
    } catch (e: any) {
      return { address: null, error: e.message || 'Error de conexion' };
    } finally {
      setIsProcessing(false);
    }
  }, [userId, supabase]);

  const disconnectWallet = useCallback(async () => {
    await blockdagProvider.disconnectWallet();
    setWalletInfo(null);
  }, []);

  const validateAddress = useCallback((address: string) => {
    return blockdagProvider.isValidAddress(address);
  }, []);

  // ── Withdrawal ─────────────────────────────────────────────────────────────
  const requestWithdrawal = useCallback(async (
    amount: number,
    destination: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!userId) return { success: false, error: 'No autenticado' };

    const check = WalletUtils.canWithdraw(dagBalance, amount);
    if (!check.valid) return { success: false, error: check.reason };

    if (!blockdagProvider.isValidAddress(destination)) {
      return { success: false, error: 'Direccion de wallet invalida' };
    }

    setIsProcessing(true);
    try {
      // Simulate on-chain transfer (swap for real SDK call)
      const result = await blockdagProvider.sendDAG(walletAddress || userId, destination, amount);
      if (!result) return { success: false, error: 'Transferencia fallida' };

      // Build transaction record
      const txRecord = TransactionBuilder.withdrawal({
        userId,
        amount,
        destinationAddress: destination,
        network: 'blockdag',
      } as WithdrawalRequest);

      // Deduct from balance
      const newBalance = Math.max(0, dagBalance - amount);
      await supabase
        .from('user_profiles')
        .update({ dag_balance: newBalance })
        .eq('id', userId);

      // Log transaction
      await supabase.from('transactions').insert({
        user_id: userId,
        amount,
        type: 'withdraw',
        status: 'pending',
        description: txRecord.description,
      });

      // Prepend to local transaction history
      setRecentTransactions(prev => [{
        ...txRecord,
        id: `tx_${Date.now()}`,
        txHash: result.txHash,
        status: 'pending',
      }, ...prev].slice(0, 50));

      return { success: true, txHash: result.txHash };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al procesar retiro' };
    } finally {
      setIsProcessing(false);
    }
  }, [userId, dagBalance, walletAddress, supabase]);

  // ── Marketplace purchase ───────────────────────────────────────────────────
  // Architecture ready — call this from ShopContext when Stripe is replaced by DAG
  const _processMarketplacePurchase = useCallback(async (
    params: MarketplacePurchase,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!userId) return { success: false, error: 'No autenticado' };
    if (dagBalance < params.totalPrice) return { success: false, error: 'Balance insuficiente' };

    setIsProcessing(true);
    try {
      const txRecord = TransactionBuilder.marketplacePurchase(params);
      await supabase.from('transactions').insert({
        user_id: userId,
        amount: params.totalPrice,
        type: 'tip', // reuse type; extend enum when marketplace grows
        status: 'completed',
        description: txRecord.description,
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    } finally {
      setIsProcessing(false);
    }
  }, [userId, dagBalance, supabase]);

  // ── Creator Tier ───────────────────────────────────────────────────────────
  const currentTier = useMemo(() => getCreatorTier(dagBalance), [dagBalance]);
  const tierInfo = useMemo(() => CREATOR_TIERS[currentTier], [currentTier]);
  const nextTier = useMemo(() => getNextTier(currentTier), [currentTier]);
  const dagToNext = useMemo(() => dagToNextTier(dagBalance), [dagBalance]);

  const tierProgress = useMemo(() => {
    if (!nextTier) return 1;
    const current = CREATOR_TIERS[currentTier].minDAG;
    const next = CREATOR_TIERS[nextTier].minDAG;
    const range = next - current;
    return range > 0 ? Math.min(1, (dagBalance - current) / range) : 1;
  }, [currentTier, nextTier, dagBalance]);

  // ── Computed values ────────────────────────────────────────────────────────
  const shortAddress = useMemo(() => {
    return walletAddress ? WalletUtils.shortenAddress(walletAddress) : '';
  }, [walletAddress]);

  const canWithdrawCheck = useCallback(
    (amount: number) => WalletUtils.canWithdraw(dagBalance, amount),
    [dagBalance],
  );

  return {
    isProcessing,
    walletInfo,
    recentTransactions,

    connectWallet,
    disconnectWallet,
    validateAddress,

    calculateLikeReward: RewardCalculator.likeReward,
    calculateGiftNet: (amount: number) => ({
      creatorReceives: RewardCalculator.creatorNet(amount),
      platformFee: RewardCalculator.platformFee(amount),
    }),
    projectedMonthly: RewardCalculator.projectedMonthlyEarnings,
    formatDAG: RewardCalculator.formatDAG,

    requestWithdrawal,
    canWithdraw: canWithdrawCheck,

    currentTier,
    tierInfo,
    nextTier,
    dagToNextTier: dagToNext,
    tierProgress,

    shortAddress,
    config: BLOCKDAG_CONFIG,
  };
}
