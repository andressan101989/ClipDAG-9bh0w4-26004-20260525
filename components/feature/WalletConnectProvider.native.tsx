import '@walletconnect/react-native-compat';

import React, { createContext, useContext, useMemo } from 'react';
import {
  AppKit,
  AppKitProvider,
  useAccount as useReownAccount,
  useAppKit as useReownAppKit,
  useProvider as useReownProvider,
  type AppKitNetwork,
} from '@reown/appkit-react-native';
import {
  WALLETCONNECT_AVAILABLE,
  WALLETCONNECT_INIT_ERROR,
  walletConnectAppKit,
} from '@/services/walletConnectConfig.native';

interface Props {
  children: React.ReactNode;
}

type WalletConnectControls = {
  open: (options?: { view?: string }) => Promise<unknown> | unknown;
  close: () => Promise<unknown> | unknown;
  disconnect: (namespace?: string) => Promise<unknown> | unknown;
  switchNetwork: (network: AppKitNetwork) => Promise<unknown> | unknown;
};

type WalletConnectAccount = {
  address?: string;
  isConnected: boolean;
  chainId?: string;
};

type WalletConnectProviderState = {
  provider?: unknown;
  providerType?: unknown;
};

type WalletConnectBridge = {
  appKit: WalletConnectControls;
  account: WalletConnectAccount;
  provider: WalletConnectProviderState;
};

const unavailableError = () => new Error(
  WALLETCONNECT_INIT_ERROR ?? 'WalletConnect no está disponible.',
);

const disabledBridge: WalletConnectBridge = {
  appKit: {
    open: async () => { throw unavailableError(); },
    close: async () => {},
    disconnect: async () => {},
    switchNetwork: async () => { throw unavailableError(); },
  },
  account: { isConnected: false },
  provider: {},
};

const WalletConnectBridgeContext = createContext<WalletConnectBridge>(disabledBridge);

function WalletConnectHooksBridge({ children }: Props) {
  const appKit = useReownAppKit();
  const account = useReownAccount();
  const provider = useReownProvider();
  const value = useMemo<WalletConnectBridge>(() => ({
    appKit: appKit as unknown as WalletConnectControls,
    account,
    provider,
  }), [account, appKit, provider]);

  return (
    <WalletConnectBridgeContext.Provider value={value}>
      {children}
    </WalletConnectBridgeContext.Provider>
  );
}

export function useWalletConnectAccount() {
  return useContext(WalletConnectBridgeContext).account;
}

export function useWalletConnectAppKit() {
  return useContext(WalletConnectBridgeContext).appKit;
}

export function useWalletConnectProvider() {
  return useContext(WalletConnectBridgeContext).provider;
}

export const WC_PROJECT_ID_PRESENT = WALLETCONNECT_AVAILABLE;

export function WalletConnectProvider({ children }: Props) {
  if (!walletConnectAppKit) {
    return (
      <WalletConnectBridgeContext.Provider value={disabledBridge}>
        {children}
      </WalletConnectBridgeContext.Provider>
    );
  }

  return (
    <AppKitProvider instance={walletConnectAppKit}>
      <WalletConnectHooksBridge>{children}</WalletConnectHooksBridge>
      <AppKit />
    </AppKitProvider>
  );
}

export default WalletConnectProvider;
