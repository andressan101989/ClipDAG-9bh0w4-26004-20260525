// DAG Reward Service - Mocked for V1.0
// In production: connects to BlockDAG network via Edge Functions

export interface RewardResult {
  success: boolean;
  amount: number;
  newBalance: number;
  txHash?: string;
  error?: string;
}

export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  amount: number;
  error?: string;
}

const DAG_REWARD_PER_LIKE = 0.01;

// Simulates process_dag_reward Edge Function
export async function processLikeReward(
  viewerUserId: string,
  creatorUserId: string,
  videoId: string,
  currentBalance: number,
): Promise<RewardResult> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // Simulate 98% success rate
  if (Math.random() < 0.02) {
    return { success: false, amount: 0, newBalance: currentBalance, error: 'Network error' };
  }

  const newBalance = Number((currentBalance + DAG_REWARD_PER_LIKE).toFixed(4));
  const mockTxHash = `0x${Math.random().toString(16).substr(2, 40)}`;

  return {
    success: true,
    amount: DAG_REWARD_PER_LIKE,
    newBalance,
    txHash: mockTxHash,
  };
}

export async function withdrawDAG(
  userId: string,
  amount: number,
  walletAddress: string,
): Promise<WithdrawResult> {
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (amount < 1) {
    return { success: false, amount, error: 'Monto mínimo de retiro: 1 $DAG' };
  }

  const mockTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;

  return {
    success: true,
    txHash: mockTxHash,
    amount,
  };
}

export async function validateWalletAddress(address: string): Promise<boolean> {
  await new Promise(resolve => setTimeout(resolve, 200));
  // Basic Ethereum-compatible address validation
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function formatDAGAmount(amount: number): string {
  return amount.toFixed(4);
}

export function estimateGasFee(): number {
  return 0.001; // Mock gas fee in $DAG
}
