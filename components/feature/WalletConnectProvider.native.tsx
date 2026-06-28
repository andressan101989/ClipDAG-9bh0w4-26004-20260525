/**
 * WalletConnectProvider.native.tsx — iOS + Android
 *
 * In @walletconnect/modal-react-native v1.x there is no separate
 * WalletConnectModalProvider export. WalletConnectModal itself initialises
 * the universal-provider context AND renders the modal UI. Mount it once
 * near the app root as a sibling to children; useWalletConnectModal() in
 * useExternalWallet.native.ts will find the context it provides.
 *
 * Metro blocks @walletconnect/* on web/preview — this .native.tsx file is
 * only evaluated on iOS/Android.
 */

// Must be the first import — installs crypto, TextEncoder, URL and Buffer
// polyfills that @walletconnect/modal-react-native requires.
import '@walletconnect/react-native-compat';

import React from 'react';

export const WC_PROJECT_ID: string =
  process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

const PROVIDER_METADATA = {
  name:        'ClipDAG',
  description: 'Plataforma de video social con BDAG tokens',
  url:         'https://clipdag.io',
  icons:       ['https://pliqfesyffhudzgxpliq.backend.onspace.ai/storage/v1/object/public/images/clipdag-icon.png'],
  redirect: {
    native:    'onspaceapp://',
    universal: 'https://clipdag.io',
  },
};

// EVM session params covering Ethereum mainnet and Base.
const SESSION_PARAMS = {
  namespaces: {
    eip155: {
      methods: [
        'eth_sendTransaction', 'eth_signTransaction',
        'eth_sign', 'personal_sign', 'eth_signTypedData',
      ],
      chains: ['eip155:1', 'eip155:8453'],
      events: ['chainChanged', 'accountsChanged'],
    },
  },
};

// Resolve WalletConnectModal via require() to preserve Metro stub chain.
let WCModal: React.ComponentType<{
  projectId:        string;
  providerMetadata: typeof PROVIDER_METADATA;
  sessionParams?:   typeof SESSION_PARAMS;
}> | null = null;

try {
  const pkg  = require('@walletconnect/modal-react-native');
  const keys: string[] = Object.keys(pkg ?? {});
  console.log('[WC Provider] package exports:', keys.join(', '));

  const candidate: unknown =
    pkg?.WalletConnectModal ??
    pkg?.default?.WalletConnectModal ??
    null;

  if (candidate !== null && typeof candidate === 'function') {
    WCModal = candidate as typeof WCModal;
    console.log('[WC Provider] WalletConnectModal resolved ✓');
  } else {
    console.warn('[WC Provider] WalletConnectModal not found. Available exports:', keys.join(', '));
  }
} catch (e: any) {
  console.warn('[WC Provider] @walletconnect/modal-react-native require failed:', e?.message ?? e);
}

interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  if (!WCModal || !WC_PROJECT_ID) {
    if (!WC_PROJECT_ID) {
      console.warn('[WC Provider] EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — WalletConnect disabled');
    }
    return <>{children}</>;
  }

  const Modal = WCModal;

  // WalletConnectModal renders as a sibling, not a wrapper — it initialises
  // the provider context internally and renders the connection modal UI.
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

export default WalletConnectProvider;
