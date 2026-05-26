/**
 * services/walletConnect.ts — Web stub
 *
 * WalletConnect is native-only. This stub makes web builds compile without errors.
 */

// WalletConnect Project ID — loaded from env var at runtime.
// Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in your .env file.
// Obtain a project ID at https://cloud.walletconnect.com
export const WC_PROJECT_ID: string =
  process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

export const SESSION_PARAMS = {
  namespaces: {
    eip155: {
      methods: ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData'],
      chains: ['eip155:1404'],
      events: ['chainChanged', 'accountsChanged'],
      rpcMap: { 1404: 'https://rpc.bdagscan.com/' },
    },
  },
};

export const PROVIDER_METADATA = {
  name: 'ClipDAG',
  description: 'TikTok meets BlockDAG — earn BDAG for your content',
  url: 'https://clipdag.app',
  icons: ['https://clipdag.app/icon.png'],
  redirect: { native: 'clipdag://', universal: 'https://clipdag.app' },
};
