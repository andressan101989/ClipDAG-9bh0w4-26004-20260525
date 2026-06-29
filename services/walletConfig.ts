/**
 * services/walletConfig.ts
 *
 * Unified multi-chain wallet configuration.
 * Single source of truth for all wallet constants.
 *
 * Architecture:
 *   Layer A — External blockchain (Ethereum, Base, USDT)
 *   Layer B — Internal economy (BDAG credits)
 *   Layer C — Conversion Engine (see conversionEngine.ts)
 */

// ── Re-export conversion constants for convenience ────────────────────────────
export {
  USD_TO_BDAG_RATE,
  BDAG_TO_USD_RATE,
  WITHDRAWAL_FEE_PERCENT as PLATFORM_FEE_PERCENT,
  usdToBdag,
  bdagToUsd,
  usdtToBdag,
  ethToBdag,
  bdagToEth,
  depositToBdag,
  bdagToWithdrawAsset,
  applyWithdrawalFee,
  formatBdagWithUsd,
  fetchAndCacheEthPrice,
} from './conversionEngine';

// ── Platform treasury addresses per chain (Layer A) ───────────────────────────
// Each chain gets its own deposit address.
// Backend validates inbound transactions on the correct chain.
export const TREASURY_ADDRESSES: Record<string, string> = {
  ethereum: '0xEA0Af178948BebBfE71A223d8915d596592CB200',
  base:     '0xEA0Af178948BebBfE71A223d8915d596592CB200',
  blockdag: '0xEA0Af178948BebBfE71A223d8915d596592CB200',
};

// Default fallback
export const TREASURY_DEPOSIT_ADDRESS = TREASURY_ADDRESSES.ethereum;

// ── Minimum withdrawal in platform BDAG credits (Layer B) ─────────────────────
/** Min withdrawal in internal BDAG credits = $0.10 */
export const MIN_WITHDRAWAL_AMOUNT = 10;

/** Legacy alias */
export const MIN_WITHDRAWAL_BDAG = MIN_WITHDRAWAL_AMOUNT;

// ── EVM address validation ────────────────────────────────────────────────────
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// ── Creator reward rates (internal BDAG credits, Layer B) ─────────────────────
// All amounts are in internal BDAG credits.
export const REWARD_RATES = {
  like:           1,     // 1 BDAG = $0.01
  comment:        0.5,   // 0.5 BDAG = $0.005
  gift_heart:     10,    // 10 BDAG = $0.10
  gift_star:      50,    // 50 BDAG = $0.50
  gift_superstar: 200,   // 200 BDAG = $2.00
  gift_diamond:   1000,  // 1000 BDAG = $10.00
};

// ── Supported deposit assets per chain (Layer A) ──────────────────────────────
export type DepositAsset = 'eth' | 'usdt';

export const DEPOSIT_ASSETS_BY_NETWORK: Record<string, DepositAsset[]> = {
  ethereum: ['eth', 'usdt'],
  base:     ['eth', 'usdt'],
  blockdag: [],  // optional/manual only — not shown by default
};

// ── Minimum deposit amounts per asset (Layer A) ───────────────────────────────
export const MIN_DEPOSIT: Record<DepositAsset, number> = {
  eth:  0.001,   // ~$3 at $3000/ETH
  usdt: 1,       // $1 minimum
};

// ── Human-readable chain labels ───────────────────────────────────────────────
export const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  base:     'Base',
  blockdag: 'BlockDAG (opcional)',
};

// ── Withdraw asset options (Layer A) ─────────────────────────────────────────
export const WITHDRAW_ASSETS: { key: DepositAsset; label: string; icon: string }[] = [
  { key: 'usdt', label: 'USDT', icon: 'currency-usd' },
  { key: 'eth',  label: 'ETH',  icon: 'ethereum' },
];
