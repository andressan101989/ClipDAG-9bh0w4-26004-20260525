/**
 * WalletConnectProvider.native.tsx — iOS + Android (REAL PROVIDER)
 *
 * Mounts WalletConnectModalProvider (the context provider, NOT the modal UI).
 *
 * EXPORT MAP for @walletconnect/modal-react-native:
 *   WalletConnectModalProvider — context provider (what we need here)
 *   WalletConnectModal         — modal UI component (NOT a provider)
 *
 * We ONLY accept WalletConnectModalProvider. If that specific export is absent
 * the SDK will render children without WC context rather than mounting the
 * wrong component and breaking all wallet hooks downstream.
 *
 * Metro blocks @walletconnect/* on web/preview — this file is only
 * evaluated on iOS/Android where the native SDK is compiled in.
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
    native:    'onspaceapp://',
    universal: 'https://clipdag.io',
  },
};

// ── Resolve WalletConnectModalProvider (context provider) ────────────────────
// STRICT: only WalletConnectModalProvider is accepted.
// WalletConnectModal is the modal UI — mounting it as a root provider would
// render visible modal UI at startup and NOT provide wallet context to hooks.
let WCModalProvider: React.ComponentType<{
  projectId:        string;
  providerMetadata: typeof PROVIDER_METADATA;
  children:         React.ReactNode;
}> | null = null;

try {
  const pkg = require('@walletconnect/modal-react-native');

  // Log all available exports so we can diagnose version differences
  const exportKeys: string[] = Object.keys(pkg ?? {});
  console.log('[WC Provider] package exports:', exportKeys.join(', '));

  // ── Resolve WalletConnectModalProvider ONLY ──────────────────────────────
  // Precedence: named export → default.WalletConnectModalProvider
  // We do NOT fall back to WalletConnectModal — that is the modal UI, not
  // the context provider, and mounting it here would silently break hooks.
  const candidate: unknown =
    pkg?.WalletConnectModalProvider ??
    pkg?.default?.WalletConnectModalProvider ??
    null;

  if (candidate !== null && typeof candidate === 'function') {
    WCModalProvider = candidate as typeof WCModalProvider;
    console.log('[WC Provider] WalletConnectModalProvider resolved ✓');
  } else {
    // Log what was found so it is easy to add the correct key in a future fix
    console.warn(
      '[WC Provider] WalletConnectModalProvider NOT found in package exports.',
      'Available keys:', exportKeys.join(', '),
      '— WalletConnect context will be unavailable until the correct export is identified.',
    );
  }
} catch (e: any) {
  console.warn('[WC Provider] @walletconnect/modal-react-native require failed:', e?.message ?? e);
}

interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  if (!WCModalProvider) {
    // SDK not available or wrong export — children render without WC context.
    // Wallet hooks will detect this and show a graceful "not available" UI.
    console.log('[WC Provider] No provider mounted — rendering children without WalletConnect context');
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
