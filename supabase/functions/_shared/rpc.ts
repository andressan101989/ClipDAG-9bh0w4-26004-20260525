/**
 * supabase/functions/_shared/rpc.ts
 *
 * Blockchain RPC proxy helper.
 * Routes JSON-RPC calls to the correct chain's RPC endpoint.
 * All calls go through bdag-rpc-proxy Edge Function to avoid CORS
 * and to keep RPC URLs server-side only.
 *
 * Supported chains:
 *   1     → Ethereum mainnet
 *   8453  → Base mainnet
 *   97    → BSC testnet
 *   11155111 → Sepolia testnet
 */

// Primary + fallback RPC endpoints per chain (tried in order).
// Having multiple endpoints reduces failure rate when a single public RPC is overloaded.
const RPC_FALLBACKS: Record<string, string[]> = {
  '1': [
    'https://ethereum-rpc.publicnode.com',
    'https://cloudflare-eth.com',
    'https://rpc.ankr.com/eth',
    'https://eth.llamarpc.com',
  ],
  '8453': [
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
    'https://rpc.ankr.com/base',
    'https://base.llamarpc.com',
  ],
  '97': [
    'https://data-seed-prebsc-1-s1.binance.org:8545',
    'https://data-seed-prebsc-2-s1.binance.org:8545',
  ],
  '11155111': [
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia-rpc.publicnode.com',
  ],
};

/**
 * Call a JSON-RPC method on the given chain.
 * Returns the `result` field directly, or throws on error.
 */
export async function callRPC(
  chainId: string,
  method:  string,
  params:  unknown[],
): Promise<unknown> {
  const urls = RPC_FALLBACKS[chainId];
  if (!urls || urls.length === 0) throw new Error(`unsupported chain_id: ${chainId}`);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id:      1,
    method,
    params,
  });

  let lastError: Error = new Error('no RPC endpoints available');

  for (const rpcUrl of urls) {
    try {
      const res = await fetch(rpcUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(10_000), // 10s per endpoint
      });

      if (!res.ok) {
        lastError = new Error(`RPC HTTP ${res.status} from ${rpcUrl}`);
        console.warn(`[rpc] ${rpcUrl} returned HTTP ${res.status} — trying next`);
        continue;
      }

      const json = await res.json() as { result?: unknown; error?: { message: string } };
      if (json.error) {
        lastError = new Error(`RPC error: ${json.error.message}`);
        console.warn(`[rpc] ${rpcUrl} returned RPC error: ${json.error.message} — trying next`);
        continue;
      }

      return json.result;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[rpc] ${rpcUrl} failed: ${lastError.message} — trying next`);
    }
  }

  throw lastError;
}

/**
 * Get current block number for a chain.
 */
export async function getLatestBlock(chainId: string): Promise<number> {
  const hex = await callRPC(chainId, 'eth_blockNumber', []) as string;
  return parseInt(hex, 16);
}

/**
 * Get transaction receipt.
 */
export async function getTransactionReceipt(chainId: string, txHash: string) {
  return callRPC(chainId, 'eth_getTransactionReceipt', [txHash]);
}

/**
 * Get transaction by hash.
 */
export async function getTransaction(chainId: string, txHash: string) {
  return callRPC(chainId, 'eth_getTransactionByHash', [txHash]);
}
