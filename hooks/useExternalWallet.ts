/**
 * hooks/useExternalWallet.ts — Web stub
 *
 * WalletConnect is native-only. Returns safe no-op values.
 */
import { useCallback } from 'react';

export function useExternalWallet() {
  const noop     = useCallback(async () => ({ success: false as const, error: 'Web: use native app' }), []);
  const noopVoid = useCallback(async () => {}, []);
  const noopTx   = useCallback(async (_to: string, _amt: number) => ({
    success: false as const, error: 'Web only', txHash: undefined as string | undefined,
  }), []);
  const noopSign = useCallback(async (_msg: string) => ({
    success: false as const, error: 'Web only', signature: undefined as string | undefined,
  }), []);

  return {
    isAvailable:       false,
    isConnected:       false,
    address:           null as string | null,
    provider:          null as any,
    initError:         null as string | null,
    chainId:           null as number | null,
    currentNetwork:    null as any,
    currentNetworkKey: '',
    balances:          null as any,
    isFetchingBalance: false,
    isSendingTx:       false,
    isSwitchingChain:  false,
    openModal:         noop,
    disconnect:        noopVoid,
    fetchBalance:      noopVoid,
    switchNetwork:     async (_key: string) => ({ success: false as const, error: 'Web only' }),
    sendTransaction:   noopTx,
    sendToTreasury:    async (_amt: number, _addr: string, _net?: string, _asset?: string) => ({ success: false as const, error: 'Web only', txHash: undefined as string | undefined }),
    signMessage:       noopSign,
  };
}
