import { useCallback } from 'react';

export function useExternalWallet() {
  const openModal = useCallback(() => {
    console.log('[useExternalWallet] WalletConnect disabled for crash isolation test');
  }, []);

  return {
    openModal,
    isConnected: false,
    address: null,
    disconnect: () => {},
  };
}

export default useExternalWallet;
