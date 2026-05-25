/**
 * services/multiChainService.ts
 *
 * Multi-chain EVM service: Ethereum, Base, BlockDAG
 * Supports native token (ETH/BDAG) and ERC-20 (USDT) balance reading
 * via the connected WalletConnect provider.
 */

// ── Network definitions ───────────────────────────────────────────────────────

export interface NetworkConfig {
  chainId:    number;
  chainIdHex: string;
  name:       string;
  shortName:  string;
  symbol:     string;       // native currency symbol
  decimals:   number;
  rpcUrl:     string;
  explorer:   string;
  explorerTx: string;
  explorerAddr: string;
  color:      string;
  isStable:   boolean;      // true = supported in WC session as required chain
}

export const NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    chainId:     1,
    chainIdHex:  '0x1',
    name:        'Ethereum Mainnet',
    shortName:   'Ethereum',
    symbol:      'ETH',
    decimals:    18,
    rpcUrl:      'https://ethereum-rpc.publicnode.com',
    explorer:    'https://etherscan.io',
    explorerTx:  'https://etherscan.io/tx/',
    explorerAddr:'https://etherscan.io/address/',
    color:       '#627EEA',
    isStable:    true,
  },
  base: {
    chainId:     8453,
    chainIdHex:  '0x2105',
    name:        'Base Mainnet',
    shortName:   'Base',
    symbol:      'ETH',
    decimals:    18,
    rpcUrl:      'https://mainnet.base.org',
    explorer:    'https://basescan.org',
    explorerTx:  'https://basescan.org/tx/',
    explorerAddr:'https://basescan.org/address/',
    color:       '#0052FF',
    isStable:    true,
  },
  blockdag: {
    chainId:     1404,
    chainIdHex:  '0x57C',
    name:        'BlockDAG Mainnet',
    shortName:   'BlockDAG',
    symbol:      'BDAG',
    decimals:    18,
    rpcUrl:      'https://rpc.bdagscan.com/',
    explorer:    'https://bdagscan.com',
    explorerTx:  'https://bdagscan.com/tx/',
    explorerAddr:'https://bdagscan.com/address/',
    color:       '#7C5CFF',
    isStable:    false,     // optional — added after connection
  },
};

// ── Token definitions ─────────────────────────────────────────────────────────

export interface TokenConfig {
  symbol:      string;
  name:        string;
  decimals:    number;
  networkKey:  string;    // key into NETWORKS
  contract:    string;    // ERC-20 contract address (lowercase)
  isNative?:   boolean;   // true = native coin (no contract call needed)
  color:       string;
  logoSymbol:  string;    // icon name for MaterialCommunityIcons
}

export const TOKENS: TokenConfig[] = [
  // Native ETH on Ethereum
  {
    symbol: 'ETH', name: 'Ethereum', decimals: 18,
    networkKey: 'ethereum', contract: '',
    isNative: true, color: '#627EEA', logoSymbol: 'ethereum',
  },
  // USDT on Ethereum (ERC-20)
  {
    symbol: 'USDT', name: 'Tether USD', decimals: 6,
    networkKey: 'ethereum',
    contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    color: '#26A17B', logoSymbol: 'currency-usd',
  },
  // Native ETH on Base
  {
    symbol: 'ETH', name: 'Ethereum (Base)', decimals: 18,
    networkKey: 'base', contract: '',
    isNative: true, color: '#0052FF', logoSymbol: 'ethereum',
  },
  // USDT on Base (bridged)
  {
    symbol: 'USDT', name: 'Tether USD (Base)', decimals: 6,
    networkKey: 'base',
    contract: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
    color: '#26A17B', logoSymbol: 'currency-usd',
  },
  // BDAG on BlockDAG
  {
    symbol: 'BDAG', name: 'BlockDAG', decimals: 18,
    networkKey: 'blockdag', contract: '',
    isNative: true, color: '#7C5CFF', logoSymbol: 'hexagon-outline',
  },
];

// ── Chain lookup helpers ──────────────────────────────────────────────────────

export function getNetworkByChainId(chainId: number): NetworkConfig | null {
  return Object.values(NETWORKS).find(n => n.chainId === chainId) ?? null;
}

export function getNetworkKey(chainId: number): string {
  return Object.entries(NETWORKS).find(([, n]) => n.chainId === chainId)?.[0] ?? 'unknown';
}

// ── ERC-20 balance via eth_call ───────────────────────────────────────────────
// balanceOf(address) selector = keccak256("balanceOf(address)").slice(0,4) = 0x70a08231

function encodeBalanceOf(address: string): string {
  const selector = '70a08231';
  // ABI encode: address padded to 32 bytes
  const addr = address.replace('0x', '').toLowerCase().padStart(64, '0');
  return '0x' + selector + addr;
}

export async function readErc20Balance(
  provider: any,
  contractAddress: string,
  holderAddress: string,
  decimals: number,
): Promise<number> {
  if (!provider?.request || !contractAddress || !holderAddress) return 0;
  try {
    const data = encodeBalanceOf(holderAddress);
    const result: string = await provider.request({
      method: 'eth_call',
      params: [{ to: contractAddress, data }, 'latest'],
    });
    if (!result || result === '0x' || result === '0x0') return 0;
    // Use parseInt with radix 16 — safe on all Hermes versions (no BigInt needed
    // since USDT balances fit in Number safely up to ~9 quadrillion micro-units)
    const raw = parseInt(result.replace('0x', ''), 16);
    return isNaN(raw) ? 0 : raw / 10 ** decimals;
  } catch (e: any) {
    console.warn('[multiChain] ERC-20 balance error:', e?.message);
    return 0;
  }
}

// ── Native balance via eth_getBalance ─────────────────────────────────────────

export async function readNativeBalance(
  provider: any,
  address: string,
  decimals = 18,
): Promise<number> {
  if (!provider?.request || !address) return 0;
  try {
    const hexBal: string = await provider.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });
    // Hex ETH balances can exceed Number.MAX_SAFE_INTEGER in wei, so we split
    // the hex into high/low 32-bit halves and combine — no BigInt required.
    const hex = hexBal.replace('0x', '') || '0';
    const hi  = hex.length > 8 ? parseInt(hex.slice(0, hex.length - 8), 16) : 0;
    const lo  = parseInt(hex.slice(-8), 16);
    const wei = hi * 0x100000000 + lo;        // safe: hi fits in Number
    return wei / 10 ** decimals;
  } catch (e: any) {
    console.warn('[multiChain] native balance error:', e?.message);
    return 0;
  }
}

// ── Read all balances for an address given a provider + current chain ─────────

export interface ChainBalances {
  networkKey: string;
  chainId:    number;
  native:     number;   // ETH or BDAG
  usdt:       number;   // USDT ERC-20 (0 if unavailable)
}

export async function readAllBalances(
  provider: any,
  address: string,
  chainId: number,
): Promise<ChainBalances> {
  const networkKey = getNetworkKey(chainId);
  const network    = NETWORKS[networkKey];

  if (!network || !address) {
    return { networkKey, chainId, native: 0, usdt: 0 };
  }

  // Find matching tokens for this network
  const nativeToken = TOKENS.find(t => t.networkKey === networkKey && t.isNative);
  const usdtToken   = TOKENS.find(t => t.networkKey === networkKey && t.symbol === 'USDT');

  const [native, usdt] = await Promise.all([
    nativeToken ? readNativeBalance(provider, address, nativeToken.decimals) : Promise.resolve(0),
    usdtToken   ? readErc20Balance(provider, usdtToken.contract, address, usdtToken.decimals) : Promise.resolve(0),
  ]);

  return { networkKey, chainId, native, usdt };
}

// ── Wallet switch / add chain ─────────────────────────────────────────────────

export async function switchChain(
  provider: any,
  targetNetwork: NetworkConfig,
): Promise<{ success: boolean; error?: string }> {
  if (!provider?.request) return { success: false, error: 'No provider' };
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetNetwork.chainIdHex }],
    });
    return { success: true };
  } catch (switchErr: any) {
    const code = switchErr?.code ?? switchErr?.data?.originalError?.code;
    if (code === 4902 || String(switchErr?.message).includes('Unrecognized chain')) {
      // Chain not yet in wallet — add it
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId:           targetNetwork.chainIdHex,
            chainName:         targetNetwork.name,
            nativeCurrency:    { name: targetNetwork.symbol, symbol: targetNetwork.symbol, decimals: targetNetwork.decimals },
            rpcUrls:           [targetNetwork.rpcUrl],
            blockExplorerUrls: [targetNetwork.explorer],
          }],
        });
        return { success: true };
      } catch (addErr: any) {
        return { success: false, error: addErr?.message ?? 'No se pudo agregar la red' };
      }
    }
    if (code === 4001) return { success: false, error: 'El usuario rechazó el cambio de red' };
    return { success: false, error: switchErr?.message ?? 'Error al cambiar red' };
  }
}

// ── Utility formatters ────────────────────────────────────────────────────────

export function formatAmount(amount: number, symbol: string): string {
  const decimals = symbol === 'USDT' ? 2 : 4;
  return `${amount.toFixed(decimals)} ${symbol}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getExplorerTxUrl(txHash: string, chainId: number): string {
  const net = getNetworkByChainId(chainId);
  return net ? `${net.explorerTx}${txHash}` : `https://bdagscan.com/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string, chainId: number): string {
  const net = getNetworkByChainId(chainId);
  return net ? `${net.explorerAddr}${address}` : `https://bdagscan.com/address/${address}`;
}
