/**
 * WalletConnectProvider.native.tsx — iOS + Android (REAL PROVIDER)
 *
 * Mounts the real WalletConnectModalProvider for native EAS builds.
 * Metro blocks @walletconnect/* on web/preview — this file is only
 * evaluated on iOS/Android where the native SDK is compiled in.
 *
 * The try/catch around the require ensures that if the SDK is somehow
 * not available (e.g. running in a partial EAS build), we fall back
 * gracefully without crashing the app.
 */

import React from 'react';

export const WC_PROJECT_ID = '52504dd1b11201773cc4f803a6125d2e';

// Metadata shown in wallet apps (MetaMask, Trust, Coinbase) during connection
const PROVIDER_METADATA = {
  name:        'ClipDAG',
  description: 'Plataforma de video social con BDAG tokens',
  url:         'https://clipdag.io',
  icons:       ['https://pliqfesyffhudzgxpliq.backend.onspace.ai/storage/v1/object/public/images/clipdag-icon.png'],
  redirect: {
    native:     'onspaceapp://',
    universal:  'https://clipdag.io',
  },
};

// ── Lazy-load WalletConnectModalProvider ──────────────────────────────────────
// Metro blocks @walletconnect/* on web/preview — this require() only succeeds
// in a real EAS iOS/Android build where the native module is compiled in.
let WCModalProvider: React.ComponentType<{ projectId: string; providerMetadata: any; children: React.ReactNode }> | null = null;

try {
  const pkg = require('@walletconnect/modal-react-native');
  // Try different export paths
  WCModalProvider =
    pkg?.WalletConnectModal ??
    pkg?.default?.WalletConnectModal ??
    pkg?.WalletConnectModalProvider ??
    pkg?.default?.WalletConnectModalProvider ??
    null;

  if (WCModalProvider) {
    console.log('[WC Provider] WalletConnectModalProvider resolved ✓');
  } else {
    console.warn('[WC Provider] WalletConnectModalProvider not found. Keys:', Object.keys(pkg ?? {}));
  }
} catch (e: any) {
  console.warn('[WC Provider] @walletconnect/modal-react-native not available:', e?.message ?? e);
}

interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  if (!WCModalProvider) {
    // SDK not available (web preview or partial build) — render children without WC
    console.log('[WC Provider] Rendering without WalletConnect (SDK not loaded)');
    return <>{children}</>;
  }

  const Provider = WCModalProvider;

  return (
    <Provider
      projectId={WC_PROJECT_ID}
      providerMetadata={PROVIDER_METADATA}
    >
      {children}
    </Provider>
  );
}
