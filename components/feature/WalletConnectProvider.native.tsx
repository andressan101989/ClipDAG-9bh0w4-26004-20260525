/**
 * WalletConnectProvider.native.tsx — iOS + Android
 *
 * MULTI-CHAIN ARCHITECTURE:
 * Required namespaces use eip155:1 (Ethereum) and eip155:8453 (Base) —
 * both universally supported by MetaMask, Trust Wallet, and Coinbase Wallet.
 *
 * BlockDAG (1404) is kept as an optional namespace so wallets that already
 * have it configured can use it directly, but it is NOT required during
 * session establishment (prevents MetaMask from rejecting the session).
 *
 * Network switching to Base, BlockDAG, or Ethereum happens post-connection
 * via wallet_switchEthereumChain / wallet_addEthereumChain.
 */

import * as ExpoLinking from 'expo-linking';

// ── Polyfills — MUST load before any WC import ────────────────────────────────
try {
  require('@walletconnect/react-native-compat');
  console.log('[WC] compat loaded');
} catch (e: any) {
  console.warn('[WC] @walletconnect/react-native-compat missing:', e?.message);
}
try {
  require('react-native-get-random-values');
  console.log('[WC] get-random-values loaded');
} catch (e: any) {
  console.warn('[WC] react-native-get-random-values missing:', e?.message);
}

import React from 'react';

export const WC_PROJECT_ID = '52504dd1b11201773cc4f803a6125d2e';

// Dynamically resolve the app's deep-link URL so WalletConnect redirect
// matches the scheme declared in app.json ("onspaceapp").
// ExpoLinking.createURL('/') → "onspaceapp://" on device, "http://localhost:8081/" in Expo Go.
const _appRedirect = ExpoLinking.createURL('/');
console.log('[WC] redirect.native =', _appRedirect);

const PROVIDER_METADATA = {
  name: 'ClipDAG',
  description: 'TikTok meets BlockDAG — earn BDAG for your content',
  url: 'https://clipdag.app',
  icons: ['https://clipdag.app/icon.png'],
  redirect: {
    // MUST match scheme in app.json so MetaMask/Trust can return to the app
    native:    _appRedirect,   // "onspaceapp://"
    universal: 'https://clipdag.app',
  },
};

/**
 * SESSION PARAMS — stable multi-chain handshake
 *
 * Required: eip155:1 (Ethereum) + eip155:8453 (Base)
 *   → Every major wallet (MetaMask, Trust, Coinbase) has these pre-configured
 *   → Session settles immediately — no "unrecognized chain" rejection
 *
 * Optional: eip155:1404 (BlockDAG)
 *   → Used automatically if the wallet already has BlockDAG configured
 *   → If not, user can add it later via wallet_addEthereumChain
 */
const SESSION_PARAMS = {
  namespaces: {
    eip155: {
      methods: [
        'eth_sendTransaction',
        'eth_signTransaction',
        'eth_sign',
        'personal_sign',
        'eth_signTypedData',
        'eth_getBalance',
        'eth_call',
        'eth_chainId',
        'wallet_switchEthereumChain',
        'wallet_addEthereumChain',
      ],
      // Ethereum + Base: universally supported by all major wallets
      chains: ['eip155:1', 'eip155:8453'],
      events: ['chainChanged', 'accountsChanged'],
      rpcMap: {
        '1':    'https://ethereum-rpc.publicnode.com',
        '8453': 'https://mainnet.base.org',
      },
    },
  },
  optionalNamespaces: {
    eip155: {
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_getBalance', 'eth_call'],
      // BlockDAG is optional — wallet connects even if it doesn't have chain 1404
      chains: ['eip155:1404'],
      events: ['chainChanged', 'accountsChanged'],
      rpcMap: {
        '1404': 'https://rpc.bdagscan.com/',
      },
    },
  },
};

// ── Resolve WalletConnectModal at module load ─────────────────────────────────
let WalletConnectModal: React.ComponentType<any> | null = null;

try {
  const pkg = require('@walletconnect/modal-react-native');
  const keys = Object.keys(pkg ?? {});
  console.log('[WC] Package exports:', keys);

  const candidate =
    pkg?.WalletConnectModal ??
    pkg?.default?.WalletConnectModal ??
    (typeof pkg?.default === 'function' ? pkg.default : null);

  if (candidate && (typeof candidate === 'function' || typeof candidate === 'object')) {
    WalletConnectModal = candidate;
    console.log('[WC] WalletConnectModal resolved ✓');
  } else {
    console.error('[WC] WalletConnectModal not found in exports. Keys:', keys);
  }
} catch (e: any) {
  console.error('[WC] Package load failed:', e?.message ?? e);
}

// ── Provider ──────────────────────────────────────────────────────────────────
interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  if (!WalletConnectModal) {
    console.warn('[WC] WalletConnectModal unavailable — children rendered without WC');
    return <>{children}</>;
  }

  const Modal = WalletConnectModal;

  return (
    <>
      {children}
      <Modal
        projectId={WC_PROJECT_ID}
        providerMetadata={PROVIDER_METADATA}
        sessionParams={SESSION_PARAMS}
      />
    </>
  );
}
