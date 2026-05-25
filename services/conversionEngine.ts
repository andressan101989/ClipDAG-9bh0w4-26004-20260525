/**
 * services/conversionEngine.ts
 *
 * Layer C — Conversion Engine
 *
 * Handles all exchange rate math between:
 *   - External assets (ETH, USDT, Base ETH)
 *   - USD (intermediate unit)
 *   - Internal BDAG credits (platform economy)
 *
 * Fixed internal rate:
 *   1 USD = 100 internal BDAG
 *   1 internal BDAG = $0.01
 *
 * ETH prices are approximate and can be updated via `setEthPrice()`.
 * For production, fetch from a price feed (Coingecko, Chainlink, etc.).
 */

// ── Asset types (shared across wallet layers) ───────────────────────────────────
/** The external on-chain asset used for deposit / withdrawal */
export type DepositAsset = 'eth' | 'usdt';

// ── Fixed internal rate ───────────────────────────────────────────────────────

/** How many internal BDAG credits equal 1 USD */
export const USD_TO_BDAG_RATE = 100;

/** How many USD equal 1 internal BDAG credit */
export const BDAG_TO_USD_RATE = 0.01;

// ── Live price state (ETH in USD) ─────────────────────────────────────────────
// Default: conservative estimate. Update via setEthPrice() after fetching live price.

let _ethPriceUsd = 2000; // fallback ETH price in USD (conservative estimate for preview)

export function setEthPrice(priceUsd: number): void {
  if (priceUsd > 0) _ethPriceUsd = priceUsd;
}

export function getEthPrice(): number {
  return _ethPriceUsd;
}

// ── Conversion functions ──────────────────────────────────────────────────────

/**
 * Convert USD to internal BDAG credits.
 * Example: usdToBdag(10) → 1000
 *
 * NOTE: Frontend uses this for PREVIEW ONLY.
 * Backend is the authoritative source for all final BDAG amounts.
 */
export function usdToBdag(usd: number): number {
  return Number((usd * USD_TO_BDAG_RATE).toFixed(2));
}

/**
 * Convert internal BDAG credits to USD.
 * Example: bdagToUsd(1000) → 10.00
 */
export function bdagToUsd(bdag: number): number {
  return Math.round(bdag * BDAG_TO_USD_RATE * 100) / 100;
}

/**
 * Convert USDT amount to internal BDAG credits.
 * USDT is pegged 1:1 to USD.
 * Example: usdtToBdag(10) → 1000
 */
export function usdtToBdag(usdt: number): number {
  return usdToBdag(usdt);
}

/**
 * Convert ETH to USD at the current ETH price.
 * Example: ethToUsd(0.003) → ~9.00
 */
export function ethToUsd(eth: number): number {
  return Math.round(eth * _ethPriceUsd * 100) / 100;
}

/**
 * Convert USD to ETH at the current ETH price.
 */
export function usdToEth(usd: number): number {
  return usd / _ethPriceUsd;
}

/**
 * Convert ETH to internal BDAG credits.
 * ETH → USD → BDAG
 */
export function ethToBdag(eth: number): number {
  return usdToBdag(ethToUsd(eth));
}

/**
 * Convert internal BDAG credits to ETH.
 * BDAG → USD → ETH
 */
export function bdagToEth(bdag: number): number {
  return usdToEth(bdagToUsd(bdag));
}

/**
 * Given a deposit amount and asset type, return how many BDAG credits to award.
 *
 * Supports:
 *   'usdt'  → 1:100 (USDT is 1:1 USD)
 *   'eth'   → ETH price × 100
 *   'bdag'  → external BDAG chain → treated as 1:1 (legacy, if used)
 */
export function depositToBdag(amount: number, assetType: 'usdt' | 'eth' | 'bdag'): number {
  switch (assetType) {
    case 'usdt': return usdtToBdag(amount);
    case 'eth':  return ethToBdag(amount);
    case 'bdag': return amount;          // external BDAG 1:1 to internal (legacy)
    default:     return 0;
  }
}

/**
 * Given internal BDAG credits to withdraw, return the amount of the target asset.
 */
export function bdagToWithdrawAsset(bdag: number, assetType: 'usdt' | 'eth'): number {
  switch (assetType) {
    case 'usdt': return bdagToUsd(bdag);        // 1000 BDAG → 10 USDT
    case 'eth':  return bdagToEth(bdag);         // depends on ETH price
    default:     return 0;
  }
}

/**
 * Determine the deposit asset type from network + token selection.
 */
export function getDepositAssetType(
  networkKey: string,
  useUsdt: boolean,
): 'usdt' | 'eth' {
  if (useUsdt) return 'usdt';
  return 'eth';
}

/**
 * Format a BDAG credit amount for display.
 */
export function formatBdag(amount: number, decimals = 2): string {
  return amount.toFixed(decimals);
}

/**
 * Format a USD amount for display.
 */
export function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Show BDAG + USD equivalent: "1,000 BDAG ≈ $10.00"
 */
export function formatBdagWithUsd(bdag: number): string {
  const usd = bdagToUsd(bdag);
  const bdagStr = bdag >= 1000
    ? (bdag / 1000).toFixed(2) + 'K'
    : bdag.toFixed(2);
  return `${bdagStr} BDAG ≈ $${formatUsd(usd)}`;
}

/**
 * Platform fee on withdrawals (applied to BDAG before converting to external asset).
 */
export const WITHDRAWAL_FEE_PERCENT = 5;

/**
 * Calculate net BDAG after withdrawal fee.
 */
export function applyWithdrawalFee(grossBdag: number): {
  gross: number;
  fee: number;
  net: number;
} {
  const fee = Math.round(grossBdag * WITHDRAWAL_FEE_PERCENT / 100 * 10000) / 10000;
  const net = Math.round((grossBdag - fee) * 10000) / 10000;
  return { gross: grossBdag, fee, net };
}

/**
 * Fetch live ETH price from CoinGecko (best-effort, no auth required).
 * Call once at app startup and cache.
 */
export async function fetchAndCacheEthPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return _ethPriceUsd;
    const json = await res.json();
    const price = json?.ethereum?.usd;
    if (typeof price === 'number' && price > 0) {
      setEthPrice(price);
      return price;
    }
  } catch { /* use cached */ }
  return _ethPriceUsd;
}
