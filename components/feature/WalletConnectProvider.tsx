/**
 * WalletConnectProvider.tsx — Web stub
 *
 * WalletConnect is native-only. On web, just render children.
 */
import React from 'react';
interface Props { children: React.ReactNode }
export function WalletConnectProvider({ children }: Props) {
  return <>{children}</>;
}
