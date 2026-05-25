/**
 * BlockDAG Mainnet Blockchain Service
 * 
 * Network: BlockDAG Mainnet
 * RPC:     https://rpc.bdagscan.com/
 * ChainID: 1404
 * Symbol:  BDAG
 * Explorer: https://bdagscan.com/
 */

// ── Network configuration ─────────────────────────────────────────────────────
export const BDAG_NETWORK = {
  name: 'BlockDAG Mainnet',
  rpcUrl: 'https://rpc.bdagscan.com/',
  chainId: 1404,
  chainIdHex: '0x57C',
  symbol: 'BDAG',
  decimals: 18,
  explorer: 'https://bdagscan.com',
  explorerTx: 'https://bdagscan.com/tx/',
  explorerAddress: 'https://bdagscan.com/address/',
};

// ── Backend-proxied RPC helper ───────────────────────────────────────────────
// ALL blockchain queries go through the bdag-rpc-proxy edge function.
// The mobile app NEVER calls the BlockDAG RPC directly (Cloudflare blocks it).
import { getSupabaseClient } from '@/template';

async function rpcCallViaProxy<T>(method: string, params: unknown[]): Promise<T> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('bdag-rpc-proxy', {
    body: { method, params },
  });

  if (error) {
    // Try to extract a meaningful message from FunctionsHttpError
    let msg = error.message;
    try {
      const text = await (error as any).context?.text?.();
      const parsed = text ? JSON.parse(text) : null;
      msg = parsed?.error ?? text ?? msg;
    } catch { /* use original */ }
    throw new Error(msg);
  }

  if (data?.error) throw new Error(data.error);
  return data?.result as T;
}

// ── Hex / number utilities (BigInt-free for Hermes compatibility) ─────────────
function hexToNumber(hex: string): number {
  // Split large hex values into hi/lo halves to stay within Number precision
  const h = hex.replace('0x', '') || '0';
  const hi = h.length > 8 ? parseInt(h.slice(0, h.length - 8), 16) : 0;
  const lo = parseInt(h.slice(-8), 16);
  return hi * 0x100000000 + lo;
}

function bigIntToEther(wei: number, decimals = 18): number {
  return wei / 10 ** decimals;
}

function etherToWei(amount: number, decimals = 18): string {
  const wei = Math.round(amount * 10 ** decimals);
  return '0x' + wei.toString(16);
}

// Zero-pad to 32 bytes for ABI encoding
function padHex(hex: string, bytes = 32): string {
  return hex.replace('0x', '').padStart(bytes * 2, '0');
}

// ── EVM address validation ────────────────────────────────────────────────────
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// ── Get native BDAG balance (via backend proxy — never direct RPC) ───────────
export async function getBdagBalance(address: string): Promise<number> {
  if (!isValidEvmAddress(address)) return 0;
  try {
    const hexBalance = await rpcCallViaProxy<string>('eth_getBalance', [address, 'latest']);
    return bigIntToEther(hexToNumber(hexBalance));
  } catch (e) {
    console.warn('[BDAG] Balance fetch error:', e);
    return 0;
  }
}

// ── Get transaction by hash ───────────────────────────────────────────────────
export interface BdagTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;       // wei hex
  blockNumber: string; // hex
  gas: string;
  gasPrice: string;
  nonce: string;
  input: string;
  valueEther: number;
  blockNumberInt: number;
  status: 'pending' | 'confirmed';
}

export async function getTransaction(txHash: string): Promise<BdagTransaction | null> {
  try {
    const tx = await rpcCallViaProxy<any>('eth_getTransactionByHash', [txHash]);
    if (!tx) return null;

    const valueWei = hexToNumber(tx.value || '0x0');
    const blockNum = tx.blockNumber ? parseInt(tx.blockNumber, 16) : 0;

    return {
      hash: tx.hash,
      from: tx.from?.toLowerCase() || '',
      to: (tx.to || '')?.toLowerCase(),
      value: tx.value || '0x0',
      blockNumber: tx.blockNumber || '0x0',
      gas: tx.gas || '0x0',
      gasPrice: tx.gasPrice || '0x0',
      nonce: tx.nonce || '0x0',
      input: tx.input || '0x',
      valueEther: bigIntToEther(valueWei),
      blockNumberInt: blockNum,
      status: blockNum > 0 ? 'confirmed' : 'pending',
    };
  } catch (e) {
    console.warn('[BDAG] getTransaction error:', e);
    return null;
  }
}

// ── Get transaction receipt (for confirmation status) ─────────────────────────
export interface TxReceipt {
  status: '0x0' | '0x1';
  blockNumber: string;
  confirmations: number;
  gasUsed: string;
  transactionHash: string;
}

export async function getTransactionReceipt(txHash: string): Promise<TxReceipt | null> {
  try {
    const [receipt, blockHex] = await Promise.all([
      rpcCallViaProxy<any>('eth_getTransactionReceipt', [txHash]),
      rpcCallViaProxy<string>('eth_blockNumber', []),
    ]);
    if (!receipt) return null;

    const latestBlock = parseInt(blockHex, 16);
    const txBlock = parseInt(receipt.blockNumber || '0x0', 16);
    const confirmations = txBlock > 0 ? latestBlock - txBlock + 1 : 0;

    return {
      status: receipt.status as '0x0' | '0x1',
      blockNumber: receipt.blockNumber || '0x0',
      confirmations,
      gasUsed: receipt.gasUsed || '0x0',
      transactionHash: receipt.transactionHash,
    };
  } catch (e) {
    console.warn('[BDAG] getTransactionReceipt error:', e);
    return null;
  }
}

// ── Verify a deposit transaction ──────────────────────────────────────────────
export interface DepositVerification {
  valid: boolean;
  amount: number;
  confirmations: number;
  from: string;
  to: string;
  error?: string;
}

export async function verifyDeposit(
  txHash: string,
  expectedTo: string,
  minConfirmations = 2
): Promise<DepositVerification> {
  try {
    const [tx, receipt] = await Promise.all([
      getTransaction(txHash),
      getTransactionReceipt(txHash),
    ]);

    if (!tx) {
      return { valid: false, amount: 0, confirmations: 0, from: '', to: '', error: 'Transaction not found' };
    }

    if (!receipt || receipt.status !== '0x1') {
      return { valid: false, amount: tx.valueEther, confirmations: 0, from: tx.from, to: tx.to, error: 'Transaction failed or pending' };
    }

    if (receipt.confirmations < minConfirmations) {
      return {
        valid: false,
        amount: tx.valueEther,
        confirmations: receipt.confirmations,
        from: tx.from,
        to: tx.to,
        error: `Waiting for confirmations (${receipt.confirmations}/${minConfirmations})`,
      };
    }

    const normalizedTo = tx.to?.toLowerCase();
    const normalizedExpected = expectedTo?.toLowerCase();
    if (normalizedTo !== normalizedExpected) {
      return {
        valid: false,
        amount: tx.valueEther,
        confirmations: receipt.confirmations,
        from: tx.from,
        to: tx.to,
        error: 'Transaction recipient does not match deposit address',
      };
    }

    return {
      valid: true,
      amount: tx.valueEther,
      confirmations: receipt.confirmations,
      from: tx.from,
      to: tx.to,
    };
  } catch (e: any) {
    return { valid: false, amount: 0, confirmations: 0, from: '', to: '', error: e.message };
  }
}

// ── Get latest block number ───────────────────────────────────────────────────
export async function getBlockNumber(): Promise<number> {
  try {
    const hex = await rpcCallViaProxy<string>('eth_blockNumber', []);
    return parseInt(hex, 16);
  } catch {
    return 0;
  }
}

// ── Format BDAG amount ────────────────────────────────────────────────────────
export function formatBdag(amount: number, decimals = 4): string {
  return amount.toFixed(decimals);
}

// ── Shorten address for display ───────────────────────────────────────────────
export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ── Explorer URLs ─────────────────────────────────────────────────────────────
export function getExplorerTxUrl(txHash: string): string {
  return `${BDAG_NETWORK.explorerTx}${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${BDAG_NETWORK.explorerAddress}${address}`;
}

// ── Minimum withdrawal amount in BDAG ────────────────────────────────────────
export const MIN_WITHDRAWAL_BDAG = 1;
export const PLATFORM_FEE_PERCENT = 5; // 5% platform fee on withdrawals

// ── Platform treasury / deposit address ──────────────────────────────────────
// Users send BDAG to this address to deposit into the platform.
// The actual address is held in TREASURY_WALLET_ADDRESS env var (server-side).
// We expose a placeholder here for display in the UI; the real validation
// happens server-side in the bdag-deposit Edge Function.
export const TREASURY_DEPOSIT_ADDRESS = '0xEA0Af178948BebBfE71A223d8915d596592CB200';

// ── Creator reward rates ──────────────────────────────────────────────────────
export const REWARD_RATES = {
  like: 0.01,       // 0.01 BDAG per like
  comment: 0.005,   // 0.005 BDAG per comment
  gift_heart: 0.1,
  gift_star: 0.5,
  gift_superstar: 2.0,
  gift_diamond: 10.0,
};
