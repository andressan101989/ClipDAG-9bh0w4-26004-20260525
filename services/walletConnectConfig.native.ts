import '@walletconnect/react-native-compat';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import {
  createAppKit,
  type AppKitNetwork,
  type Storage,
} from '@reown/appkit-react-native';

const rawProjectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? '';

export const WALLETCONNECT_PROJECT_ID_PRESENT = rawProjectId.length > 0;
export const WALLETCONNECT_INIT_ERROR = WALLETCONNECT_PROJECT_ID_PRESENT
  ? null
  : 'WalletConnect no está configurado en esta versión.';

const storage: Storage = {
  async getKeys() {
    return Array.from(await AsyncStorage.getAllKeys());
  },
  async getEntries<T>() {
    const entries = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    return entries.flatMap(([key, value]) => {
      if (value === null) return [];
      try {
        return [[key, JSON.parse(value) as T] as [string, T]];
      } catch {
        return [[key, value as T] as [string, T]];
      }
    });
  },
  async getItem<T>(key: string) {
    const value = await AsyncStorage.getItem(key);
    if (value === null) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  },
  async setItem<T>(key: string, value: T) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  },
};

export const ethereumNetwork: AppKitNetwork = {
  id: 1,
  name: 'Ethereum Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://ethereum-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:1',
};

export const baseNetwork: AppKitNetwork = {
  id: 8453,
  name: 'Base Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://base-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'Basescan', url: 'https://basescan.org' } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:8453',
};

export const walletConnectNetworks = [ethereumNetwork, baseNetwork] as const;
export const walletConnectNetworkByKey: Record<string, AppKitNetwork> = {
  ethereum: ethereumNetwork,
  base: baseNetwork,
};

export const walletConnectAppKit = createAppKit({
  projectId: rawProjectId || 'walletconnect-project-id-not-configured',
  metadata: {
    name: 'OnSpace',
    description: 'OnSpace / ClipDAG',
    url: 'https://clipdag.io',
    icons: [
      'https://raw.githubusercontent.com/andressan101989/ClipDAG-9bh0w4-26004-20260525/main/assets/images/logo.png',
    ],
    redirect: {
      native: 'onspaceapp://',
      universal: 'https://clipdag.io',
    },
  },
  adapters: [new EthersAdapter()],
  networks: [...walletConnectNetworks],
  defaultNetwork: ethereumNetwork,
  storage,
  enableAnalytics: false,
  debug: __DEV__,
  logger: __DEV__ ? 'warn' : 'error',
});
