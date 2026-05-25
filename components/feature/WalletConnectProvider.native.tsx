/**
 * WalletConnectProvider.native.tsx — iOS + Android
 *
 * In the OnSpace preview runtime (Expo Go–like), ALL @walletconnect/* packages
 * are stubbed to empty objects by metro.config.js because they require native
 * modules that are not available outside a full EAS build.
 *
 * In a proper EAS native build the stubs are still applied (metro resolver runs
 * at bundle time). WalletConnect modal will gracefully show nothing.
 *
 * This component never crashes — it always renders children.
 */

import React from 'react';

export const WC_PROJECT_ID = '52504dd1b11201773cc4f803a6125d2e';

interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  // WalletConnect requires a full EAS native build with native modules.
  // In the OnSpace preview runtime all @walletconnect/* packages are empty stubs.
  // Render children directly — the wallet screen handles the unavailable state.
  return <>{children}</>;
}
