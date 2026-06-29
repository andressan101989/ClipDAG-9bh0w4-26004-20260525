import React from 'react';

interface Props { children: React.ReactNode }

export const WC_PROJECT_ID = '';

export function WalletConnectProvider({ children }: Props) {
  return <>{children}</>;
}

export default WalletConnectProvider;
