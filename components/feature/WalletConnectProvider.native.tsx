import '@walletconnect/react-native-compat';

import React from 'react';
import {
  AppKit,
  AppKitProvider,
  useAccount,
  useAppKit,
  useProvider,
} from '@reown/appkit-react-native';
import {
  WALLETCONNECT_PROJECT_ID_PRESENT,
  walletConnectAppKit,
} from '@/services/walletConnectConfig.native';

interface Props {
  children: React.ReactNode;
}

export {
  useAccount as useWalletConnectAccount,
  useAppKit as useWalletConnectAppKit,
  useProvider as useWalletConnectProvider,
};

export const WC_PROJECT_ID_PRESENT = WALLETCONNECT_PROJECT_ID_PRESENT;

export function WalletConnectProvider({ children }: Props) {
  return (
    <AppKitProvider instance={walletConnectAppKit}>
      {children}
      <AppKit />
    </AppKitProvider>
  );
}

export default WalletConnectProvider;
