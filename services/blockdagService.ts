/**
 * BlockDAG Blockchain Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Modular, blockchain-ready architecture for future native BlockDAG integration.
 *
 * Current state: All operations are simulated through Supabase backend.
 * Future state:  Swap provider implementations to use real BlockDAG RPC/SDK.
 *
 * Architecture layers:
 *   1. Provider Interface  — abstract wallet/chain operations
 *   2. Supabase Provider   — current implementation (DB-backed)
 *   3. BlockDAG Provider   — future implementation (native chain)
 *   4. Service Layer       — unified API consumed by hooks/components
 */

// ── Constants ──────────────────────────────────────────────────────────────────
export const BLOCKDAG_CONFIG = {
  /** DAG earned per like */
  DAG_PER_LIKE: 0.01,
  /** Gift tiers (DAG values) */
  GIFT_TIERS: [0.1, 0.5, 1, 5, 10, 50] as const,
  /** Minimum withdrawal amount */
  MIN_WITHDRAWAL: 1.0,
  /** Platform fee percentage (10%) */
  PLATFORM_FEE: 0.1,
  /** Creator share (90%) */
  CREATOR_SHARE: 0.9,
  /** BlockDAG chain ID (testnet placeholder) */
  CHAIN_ID: 'blockdag-testnet-1',
  /** Native token symbol */
  TOKEN_SYMBOL: 'DAG',
  /** Token display name */
  TOKEN_NAME: 'BlockDAG',
  /** Explorer base URL (placeholder) */
  EXPLORER_URL: 'https://explorer.blockdag.network',
  /** RPC endpoint (placeholder) */
  RPC_URL: 'https://rpc.blockdag.network',
} as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  balance: number;
  isConnected: boolean;
  chainId: string;
}

export interface DAGTransaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  txHash?: string;
  timestamp: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export type TransactionType =
  | 'like_reward'
  | 'gift_sent'
  | 'gift_received'
  | 'withdrawal'
  | 'deposit'
  | 'marketplace_purchase'
  | 'marketplace_sale'
  | 'subscription'
  | 'staking_reward';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

export interface GiftPayload {
  senderId: string;
  recipientId: string;
  videoId?: string | null;
  sessionId?: string | null;
  giftType: string;
  dagValue: number;
  message?: string;
}

export interface WithdrawalRequest {
  userId: string;
  amount: number;
  destinationAddress: string;
  network: 'blockdag' | 'ethereum' | 'polygon';
}

export interface RewardClaim {
  videoId: string;
  creatorId: string;
  likerId: string;
  dagAmount: number;
}

export interface MarketplacePurchase {
  buyerId: string;
  sellerId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
  currency: string;
}

// ── Blockchain Provider Interface ──────────────────────────────────────────────
// When native BlockDAG SDK is ready, implement this interface.

export interface IBlockDAGProvider {
  /** Connect external wallet (MetaMask, WalletConnect, etc.) */
  connectWallet(options?: { walletType?: 'metamask' | 'walletconnect' | 'blockdag' }): Promise<WalletInfo | null>;
  /** Disconnect wallet */
  disconnectWallet(): Promise<void>;
  /** Get wallet balance in DAG */
  getBalance(address: string): Promise<number>;
  /** Send DAG between addresses */
  sendDAG(from: string, to: string, amount: number): Promise<{ txHash: string } | null>;
  /** Validate a wallet address format */
  isValidAddress(address: string): boolean;
  /** Get transaction status from chain */
  getTransactionStatus(txHash: string): Promise<TransactionStatus>;
  /** Sign a message (for auth/verification) */
  signMessage(address: string, message: string): Promise<string | null>;
}

// ── Simulated Supabase Provider (Current) ─────────────────────────────────────
// Implements IBlockDAGProvider using Supabase as the ledger.
// Replace with real BlockDAG SDK implementation when available.

class SupabaseBlockDAGProvider implements IBlockDAGProvider {
  async connectWallet(_options?: { walletType?: 'metamask' | 'walletconnect' | 'blockdag' }): Promise<WalletInfo | null> {
    // Placeholder: generate internal wallet address
    const mockAddress = `0xDAG${Math.random().toString(16).substring(2, 12).toUpperCase()}`;
    return {
      address: mockAddress,
      balance: 0,
      isConnected: true,
      chainId: BLOCKDAG_CONFIG.CHAIN_ID,
    };
  }

  async disconnectWallet(): Promise<void> {
    // No-op for Supabase provider
  }

  async getBalance(_address: string): Promise<number> {
    // Balance is stored in user_profiles.dag_balance
    return 0;
  }

  async sendDAG(_from: string, _to: string, _amount: number): Promise<{ txHash: string } | null> {
    // Simulated: real transfers go through Supabase RPC
    const fakeTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;
    return { txHash: fakeTxHash };
  }

  isValidAddress(address: string): boolean {
    // Accept both ETH-style and BlockDAG-style addresses
    return /^0x[0-9a-fA-F]{10,40}$/.test(address) || /^DAG[0-9a-zA-Z]{10,}$/.test(address);
  }

  async getTransactionStatus(_txHash: string): Promise<TransactionStatus> {
    return 'confirmed';
  }

  async signMessage(_address: string, _message: string): Promise<string | null> {
    return `sig_${Math.random().toString(16).substring(2, 18)}`;
  }
}

// ── Singleton provider instance ────────────────────────────────────────────────
// Swap to `new BlockDAGNativeProvider()` when SDK is ready.
export const blockdagProvider: IBlockDAGProvider = new SupabaseBlockDAGProvider();

// ── Reward Calculator ──────────────────────────────────────────────────────────

export const RewardCalculator = {
  /** Calculate creator earnings from likes */
  likeReward(): number {
    return BLOCKDAG_CONFIG.DAG_PER_LIKE;
  },

  /** Calculate creator net after platform fee */
  creatorNet(grossAmount: number): number {
    return grossAmount * BLOCKDAG_CONFIG.CREATOR_SHARE;
  },

  /** Calculate platform fee */
  platformFee(grossAmount: number): number {
    return grossAmount * BLOCKDAG_CONFIG.PLATFORM_FEE;
  },

  /** Calculate gift breakdown */
  giftBreakdown(dagValue: number): { creatorReceives: number; platformFee: number; total: number } {
    return {
      total: dagValue,
      creatorReceives: dagValue * BLOCKDAG_CONFIG.CREATOR_SHARE,
      platformFee: dagValue * BLOCKDAG_CONFIG.PLATFORM_FEE,
    };
  },

  /** Projected monthly earnings based on daily likes */
  projectedMonthlyEarnings(dailyLikes: number): number {
    return dailyLikes * BLOCKDAG_CONFIG.DAG_PER_LIKE * 30;
  },

  /** Format DAG amount for display */
  formatDAG(amount: number, decimals = 4): string {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M ${BLOCKDAG_CONFIG.TOKEN_SYMBOL}`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K ${BLOCKDAG_CONFIG.TOKEN_SYMBOL}`;
    return `${amount.toFixed(decimals)} ${BLOCKDAG_CONFIG.TOKEN_SYMBOL}`;
  },
};

// ── Wallet Utilities ───────────────────────────────────────────────────────────

export const WalletUtils = {
  /** Shorten address for display: 0x1234...5678 */
  shortenAddress(address: string, chars = 4): string {
    if (!address || address.length < chars * 2 + 2) return address || '';
    return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
  },

  /** Generate explorer URL for transaction */
  txExplorerUrl(txHash: string): string {
    return `${BLOCKDAG_CONFIG.EXPLORER_URL}/tx/${txHash}`;
  },

  /** Generate explorer URL for address */
  addressExplorerUrl(address: string): string {
    return `${BLOCKDAG_CONFIG.EXPLORER_URL}/address/${address}`;
  },

  /** Validate minimum withdrawal */
  canWithdraw(balance: number, amount: number): { valid: boolean; reason?: string } {
    if (amount < BLOCKDAG_CONFIG.MIN_WITHDRAWAL) {
      return { valid: false, reason: `Minimo de retiro: ${BLOCKDAG_CONFIG.MIN_WITHDRAWAL} $DAG` };
    }
    if (amount > balance) {
      return { valid: false, reason: 'Balance insuficiente' };
    }
    return { valid: true };
  },

  /** Parse DAG amount from string input safely */
  parseAmount(input: string): number {
    const n = parseFloat(input.replace(',', '.'));
    return isNaN(n) ? 0 : Math.max(0, n);
  },
};

// ── Transaction Builder ────────────────────────────────────────────────────────
// Creates properly-typed transaction objects ready for Supabase insert.

export const TransactionBuilder = {
  likeReward(params: { userId: string; videoId: string; creatorUsername: string }): Omit<DAGTransaction, 'id'> {
    return {
      from: 'platform_reward_pool',
      to: params.userId,
      amount: BLOCKDAG_CONFIG.DAG_PER_LIKE,
      type: 'like_reward',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      description: `Like reward - @${params.creatorUsername}`,
      metadata: { videoId: params.videoId },
    };
  },

  gift(params: GiftPayload): Omit<DAGTransaction, 'id'> {
    return {
      from: params.senderId,
      to: params.recipientId,
      amount: params.dagValue,
      type: 'gift_sent',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      description: `Gift ${params.giftType} enviado`,
      metadata: {
        giftType: params.giftType,
        videoId: params.videoId,
        sessionId: params.sessionId,
        message: params.message,
      },
    };
  },

  withdrawal(params: WithdrawalRequest): Omit<DAGTransaction, 'id'> {
    return {
      from: params.userId,
      to: params.destinationAddress,
      amount: params.amount,
      type: 'withdrawal',
      status: 'pending',
      timestamp: new Date().toISOString(),
      description: `Retiro a ${WalletUtils.shortenAddress(params.destinationAddress)}`,
      metadata: { network: params.network },
    };
  },

  marketplacePurchase(params: MarketplacePurchase): Omit<DAGTransaction, 'id'> {
    return {
      from: params.buyerId,
      to: params.sellerId,
      amount: params.totalPrice,
      type: 'marketplace_purchase',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      description: `Compra en marketplace x${params.quantity}`,
      metadata: {
        productId: params.productId,
        quantity: params.quantity,
        currency: params.currency,
      },
    };
  },
};

// ── Staking / Premium Tier Placeholders ───────────────────────────────────────
// Architecture prepared for future staking and creator badge system.

export type CreatorTier = 'explorer' | 'creator' | 'pro' | 'elite' | 'legend';

export const CREATOR_TIERS: Record<CreatorTier, { label: string; minDAG: number; perks: string[]; color: string }> = {
  explorer: {
    label: 'Explorer',
    minDAG: 0,
    perks: ['Earn 0.01 DAG/like', 'Basic analytics'],
    color: '#A0A0B8',
  },
  creator: {
    label: 'Creator',
    minDAG: 100,
    perks: ['Earn 0.012 DAG/like', 'Advanced analytics', 'Creator badge'],
    color: '#7C5CFF',
  },
  pro: {
    label: 'Pro Creator',
    minDAG: 1000,
    perks: ['Earn 0.015 DAG/like', 'Priority feed placement', 'Pro badge', 'Custom gifts'],
    color: '#FF2D78',
  },
  elite: {
    label: 'Elite',
    minDAG: 10000,
    perks: ['Earn 0.02 DAG/like', 'Exclusive events', 'Elite badge', 'Revenue share'],
    color: '#FFB800',
  },
  legend: {
    label: 'Legend',
    minDAG: 100000,
    perks: ['Max earnings', 'Legend NFT badge', 'Governance vote', 'DAO access'],
    color: '#00E5A0',
  },
};

export function getCreatorTier(dagBalance: number): CreatorTier {
  if (dagBalance >= 100000) return 'legend';
  if (dagBalance >= 10000) return 'elite';
  if (dagBalance >= 1000) return 'pro';
  if (dagBalance >= 100) return 'creator';
  return 'explorer';
}

export function getNextTier(current: CreatorTier): CreatorTier | null {
  const order: CreatorTier[] = ['explorer', 'creator', 'pro', 'elite', 'legend'];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

export function dagToNextTier(dagBalance: number): number {
  const current = getCreatorTier(dagBalance);
  const next = getNextTier(current);
  if (!next) return 0;
  return Math.max(0, CREATOR_TIERS[next].minDAG - dagBalance);
}
