import React from 'react';
import { WalletConnectModal, useWalletConnectModal } from '@walletconnect/modal-react-native';

interface Props { children: React.ReactNode }

const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
export const WC_PROJECT_ID = projectId;

export { useWalletConnectModal };

export function WalletConnectProvider({ children }: Props) {
  return (
    <>
      <WalletConnectModal
        projectId={projectId}
        providerMetadata={{
          name: 'OnSpace',
          description: 'OnSpace / ClipDAG',
          url: 'https://clipdag.io',
          icons: ['https://clipdag.io/icon.png'],
        }}
      />
      {children}
    </>
  );
}

export default WalletConnectProvider;
