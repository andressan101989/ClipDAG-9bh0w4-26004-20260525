/**
 * services/walletConnect.ts — Web stub
 *
 * WalletConnect is native-only. This stub makes web builds compile without errors.
 */

export const WC_PROJECT_ID = '52504dd1b11201773cc4f803a6125d2e';

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
