export type StablecoinAsset = 'usdt' | 'usdc';
export type StablecoinNetworkKey = 'ethereum' | 'base';
export interface StablecoinConfig {
  key: StablecoinAsset;
  symbol: 'USDT' | 'USDC';
  chainId: 1 | 8453;
  contractAddress: string;
  decimals: 6;
}
const REGISTRY: Record<StablecoinNetworkKey, readonly StablecoinConfig[]> = {
  ethereum: [
    { key: 'usdt', symbol: 'USDT', chainId: 1, contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { key: 'usdc', symbol: 'USDC', chainId: 1, contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  ],
  base: [{ key: 'usdc', symbol: 'USDC', chainId: 8453, contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }],
};
export const getSupportedStablecoins = (networkKey: string): readonly StablecoinConfig[] =>
  REGISTRY[networkKey as StablecoinNetworkKey] ?? [];
export const getStablecoinConfig = (networkKey: string, asset: string): StablecoinConfig | null =>
  getSupportedStablecoins(networkKey).find(item => item.key === asset.toLowerCase()) ?? null;
export const isStablecoinSupported = (networkKey: string, asset: string): boolean =>
  getStablecoinConfig(networkKey, asset) !== null;
