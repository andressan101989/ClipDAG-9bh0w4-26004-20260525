export type StablecoinSymbol = 'USDT' | 'USDC';
export interface StablecoinConfig {
  symbol: StablecoinSymbol;
  chainId: '1' | '8453';
  contractAddress: string;
  decimals: 6;
}
export const STABLECOINS: readonly StablecoinConfig[] = [
  { symbol: 'USDT', chainId: '1', contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'USDC', chainId: '1', contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDC', chainId: '8453', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
] as const;
export const getStablecoin = (chainId: string, symbol: string): StablecoinConfig | null =>
  STABLECOINS.find(item => item.chainId === chainId && item.symbol === symbol.toUpperCase()) ?? null;
export const getStablecoinByContract = (chainId: string, address: string): StablecoinConfig | null =>
  STABLECOINS.find(item => item.chainId === chainId && item.contractAddress.toLowerCase() === address.toLowerCase()) ?? null;
