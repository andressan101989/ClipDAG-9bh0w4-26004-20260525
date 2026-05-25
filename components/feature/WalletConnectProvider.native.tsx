/**
 * WalletConnectProvider.native.tsx — iOS + Android
 *
 * ALL requires are lazy (inside try/catch) to prevent Hermes from bundling
 * WalletConnect's transitive @opentelemetry deps into main.jsbundle.
 * Those deps use  import(/* webpackIgnore *‌/)  syntax that Hermes cannot parse.
 *
 * This component gracefully degrades: if WalletConnect is unavailable
 * (preview runtime, missing native module, etc.) children render normally.
 */

import React, { useEffect, useState } from 'react';
import * as ExpoLinking from 'expo-linking';

export const WC_PROJECT_ID = '52504dd1b11201773cc4f803a6125d2e';

const _appRedirect = ExpoLinking.createURL('/');

const PROVIDER_METADATA = {
  name: 'ClipDAG',
  description: 'TikTok meets BlockDAG — earn BDAG for your content',
  url: 'https://clipdag.app',
  icons: ['https://clipdag.app/icon.png'],
  redirect: {
    native: _appRedirect,
    universal: 'https://clipdag.app',
  },
};

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
      chains: ['eip155:1', 'eip155:8453'],
      events: ['chainChanged', 'accountsChanged'],
      rpcMap: {
        '1': 'https://ethereum-rpc.publicnode.com',
        '8453': 'https://mainnet.base.org',
      },
    },
  },
  optionalNamespaces: {
    eip155: {
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_getBalance', 'eth_call'],
      chains: ['eip155:1404'],
      events: ['chainChanged', 'accountsChanged'],
      rpcMap: {
        '1404': 'https://rpc.bdagscan.com/',
      },
    },
  },
};

interface Props { children: React.ReactNode }

export function WalletConnectProvider({ children }: Props) {
  const [Modal, setModal] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    // Load polyfills + modal AFTER mount so they don't block the initial render
    // and don't get bundled synchronously into main.jsbundle by Hermes.
    const timer = setTimeout(() => {
      try {
        require('@walletconnect/react-native-compat');
      } catch (e: any) {
        console.warn('[WC] compat skipped:', e?.message);
      }
      try {
        require('react-native-get-random-values');
      } catch (e: any) {
        console.warn('[WC] get-random-values skipped:', e?.message);
      }
      try {
        const pkg = require('@walletconnect/modal-react-native');
        const candidate =
          pkg?.WalletConnectModal ??
          pkg?.default?.WalletConnectModal ??
          (typeof pkg?.default === 'function' ? pkg.default : null);
        if (candidate) {
          setModal(() => candidate);
          console.log('[WC] WalletConnectModal loaded');
        } else {
          console.warn('[WC] WalletConnectModal not found in package exports');
        }
      } catch (e: any) {
        console.warn('[WC] modal-react-native skipped:', e?.message);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {children}
      {Modal ? (
        <Modal
          projectId={WC_PROJECT_ID}
          providerMetadata={PROVIDER_METADATA}
          sessionParams={SESSION_PARAMS}
        />
      ) : null}
    </>
  );
}
