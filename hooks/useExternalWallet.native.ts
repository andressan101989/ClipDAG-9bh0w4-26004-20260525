import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWalletConnectAccount,
  useWalletConnectAppKit,
  useWalletConnectProvider,
  WC_PROJECT_ID_PRESENT,
} from '@/components/feature/WalletConnectProvider.native';
import {
  NETWORKS,
  getNetworkByChainId,
  getNetworkKey,
  readAllBalances,
  type ChainBalances,
  type NetworkConfig,
} from '@/services/multiChainService';
import {
  WALLETCONNECT_INIT_ERROR,
  walletConnectNetworkByKey,
} from '@/services/walletConnectConfig.native';
import {
  decimalToUnits,
  encodeErc20Transfer,
  isUserRejectedWalletRequest,
  isValidEvmAddress,
  unitsToHex,
  utf8ToHex,
} from '@/services/walletTransactionEncoding';
import { getStablecoinConfig } from '@/services/stablecoinRegistry';
import { markWalletExternalOperation } from '@/services/walletExternalOperation';

type WalletResult = {
  success: boolean;
  error?: string;
  cancelled?: boolean;
  txHash?: string;
  status?: 'modal_opened' | 'connection_confirmed';
};

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function parseChainId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  const segment = text.includes(':') ? text.split(':').pop() ?? '' : text;
  const parsed = segment.startsWith('0x')
    ? Number.parseInt(segment, 16)
    : Number.parseInt(segment, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function useExternalWallet() {
  const appKit = useWalletConnectAppKit();
  const account = useWalletConnectAccount();
  const providerState = useWalletConnectProvider();
  const provider = providerState.provider as Eip1193Provider | undefined;
  const validAddress = account.address && isValidEvmAddress(account.address)
    ? account.address
    : null;
  const isConnected = WC_PROJECT_ID_PRESENT && account.isConnected && validAddress !== null;

  const [chainId, setChainId] = useState<number | null>(() => parseChainId(account.chainId));
  const [balances, setBalances] = useState<ChainBalances | null>(null);
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [isSendingTx, setIsSendingTx] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [initError, setInitError] = useState<string | null>(WALLETCONNECT_INIT_ERROR);
  const mountedRef = useRef(true);
  const balanceRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const officialChainId = parseChainId(account.chainId);
    if (officialChainId !== null) setChainId(officialChainId);
    if (!account.isConnected) {
      setChainId(null);
      setBalances(null);
    }
  }, [account.chainId, account.isConnected]);

  const fetchBalancesFor = useCallback(async (
    activeProvider: Eip1193Provider,
    walletAddress: string,
    activeChainId: number,
  ) => {
    const requestId = ++balanceRequestRef.current;
    if (mountedRef.current) setIsFetchingBalance(true);
    try {
      const result = await readAllBalances(activeProvider, walletAddress, activeChainId);
      if (mountedRef.current && requestId === balanceRequestRef.current) setBalances(result);
    } catch (error) {
      console.warn('[WalletConnect] balance_fetch_failed', (error as Error)?.message);
    } finally {
      if (mountedRef.current && requestId === balanceRequestRef.current) setIsFetchingBalance(false);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    if (provider && validAddress && chainId !== null) {
      await fetchBalancesFor(provider, validAddress, chainId);
    }
  }, [chainId, fetchBalancesFor, provider, validAddress]);

  useEffect(() => {
    if (isConnected && provider && validAddress && chainId !== null) {
      void fetchBalancesFor(provider, validAddress, chainId);
    }
  }, [chainId, fetchBalancesFor, isConnected, provider, validAddress]);

  const openModal = useCallback(async (): Promise<WalletResult> => {
    if (!WC_PROJECT_ID_PRESENT) {
      return { success: false, error: WALLETCONNECT_INIT_ERROR ?? 'WalletConnect no disponible' };
    }
    try {
      await markWalletExternalOperation();
      setInitError(null);
      await appKit.open({ view: 'Connect' });
      return {
        success: true,
        status: isConnected ? 'connection_confirmed' : 'modal_opened',
      };
    } catch (error) {
      if (isUserRejectedWalletRequest(error)) return { success: false, cancelled: true };
      const message = (error as Error)?.message ?? 'No se pudo abrir WalletConnect';
      setInitError(message);
      return { success: false, error: message };
    }
  }, [appKit, isConnected]);

  const disconnect = useCallback(async () => {
    try {
      await appKit.disconnect('eip155');
    } catch (error) {
      console.warn('[WalletConnect] disconnect_failed', (error as Error)?.message);
    } finally {
      if (mountedRef.current) {
        setBalances(null);
        setChainId(null);
      }
    }
  }, [appKit]);

  const switchNetwork = useCallback(async (networkKey: string): Promise<WalletResult> => {
    if (!isConnected || !provider) return { success: false, error: 'Wallet no conectada' };
    const target = walletConnectNetworkByKey[networkKey];
    if (!target) return { success: false, error: `Red desconocida: ${networkKey}` };
    if (mountedRef.current) setIsSwitchingChain(true);
    try {
      await markWalletExternalOperation();
      await appKit.switchNetwork(target);
      const reported = parseChainId(await provider.request({ method: 'eth_chainId', params: [] }));
      if (reported !== Number(target.id)) {
        return { success: false, error: `La wallet no confirmó la red ${target.name}` };
      }
      if (mountedRef.current) setChainId(reported);
      if (validAddress) await fetchBalancesFor(provider, validAddress, reported);
      return { success: true };
    } catch (error) {
      if (isUserRejectedWalletRequest(error)) return { success: false, cancelled: true };
      return { success: false, error: (error as Error)?.message ?? 'No se pudo cambiar la red' };
    } finally {
      if (mountedRef.current) setIsSwitchingChain(false);
    }
  }, [appKit, fetchBalancesFor, isConnected, provider, validAddress]);

  const ensureNetwork = useCallback(async (networkKey?: string): Promise<WalletResult> => {
    if (!networkKey) return { success: true };
    const targetId = NETWORKS[networkKey]?.chainId;
    if (!targetId) return { success: false, error: `Red desconocida: ${networkKey}` };
    const reported = provider
      ? parseChainId(await provider.request({ method: 'eth_chainId', params: [] }))
      : null;
    return reported === targetId ? { success: true } : switchNetwork(networkKey);
  }, [provider, switchNetwork]);

  const sendErc20Transaction = useCallback(async (
    tokenContract: string,
    toAddress: string,
    amount: string | number,
    decimals: number,
    targetNetwork?: string,
  ): Promise<WalletResult> => {
    if (!isConnected || !provider || !validAddress) {
      return { success: false, error: 'Wallet no conectada' };
    }
    if (!isValidEvmAddress(tokenContract) || !isValidEvmAddress(toAddress)) {
      return { success: false, error: 'Dirección EVM inválida' };
    }
    const networkResult = await ensureNetwork(targetNetwork);
    if (!networkResult.success) return networkResult;
    if (mountedRef.current) setIsSendingTx(true);
    try {
      await markWalletExternalOperation();
      const data = encodeErc20Transfer(toAddress, decimalToUnits(amount, decimals));
      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: validAddress, to: tokenContract, value: '0x0', data }],
      });
      return typeof txHash === 'string'
        ? { success: true, txHash }
        : { success: false, error: 'La wallet no devolvió un hash de transacción' };
    } catch (error) {
      if (isUserRejectedWalletRequest(error)) return { success: false, cancelled: true };
      return { success: false, error: (error as Error)?.message ?? 'Transacción ERC-20 rechazada' };
    } finally {
      if (mountedRef.current) setIsSendingTx(false);
    }
  }, [ensureNetwork, isConnected, provider, validAddress]);

  const sendTransaction = useCallback(async (
    toAddress: string,
    amountNative: string | number,
    targetNetwork?: string,
  ): Promise<WalletResult> => {
    if (!isConnected || !provider || !validAddress) {
      return { success: false, error: 'Wallet no conectada' };
    }
    if (!isValidEvmAddress(toAddress)) return { success: false, error: 'Dirección EVM inválida' };
    const networkResult = await ensureNetwork(targetNetwork);
    if (!networkResult.success) return networkResult;
    if (mountedRef.current) setIsSendingTx(true);
    try {
      const value = unitsToHex(decimalToUnits(amountNative, 18));
      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: validAddress, to: toAddress, value, data: '0x' }],
      });
      return typeof txHash === 'string'
        ? { success: true, txHash }
        : { success: false, error: 'La wallet no devolvió un hash de transacción' };
    } catch (error) {
      if (isUserRejectedWalletRequest(error)) return { success: false, cancelled: true };
      return { success: false, error: (error as Error)?.message ?? 'Transacción rechazada' };
    } finally {
      if (mountedRef.current) setIsSendingTx(false);
    }
  }, [ensureNetwork, isConnected, provider, validAddress]);

  const sendToTreasury = useCallback(async (
    amount: string | number,
    treasuryAddress: string,
    targetNetwork?: string,
    depositAsset?: 'usdt' | 'usdc' | string,
  ): Promise<WalletResult> => {
    const networkKey = targetNetwork ?? getNetworkKey(chainId ?? 0);
    const stablecoin = getStablecoinConfig(networkKey, depositAsset ?? '');
    if (!stablecoin) return { success: false, error: `${String(depositAsset).toUpperCase()} no está habilitado en ${networkKey}.` };
    const switched = await ensureNetwork(networkKey);
    if (!switched.success) return switched;
    const actualChainId = parseChainId(await provider?.request({ method: 'eth_chainId', params: [] }));
    if (actualChainId !== stablecoin.chainId) return { success: false, error: 'La wallet no confirmó la red solicitada' };
    return sendErc20Transaction(stablecoin.contractAddress, treasuryAddress, amount, stablecoin.decimals, networkKey);
  }, [chainId, ensureNetwork, provider, sendErc20Transaction]);

  const signMessage = useCallback(async (message: string): Promise<WalletResult & { signature?: string }> => {
    if (!isConnected || !provider || !validAddress) {
      return { success: false, error: 'Wallet no conectada' };
    }
    try {
      await markWalletExternalOperation();
      const signature = await provider.request({
        method: 'personal_sign',
        params: [utf8ToHex(message), validAddress],
      });
      return typeof signature === 'string'
        ? { success: true, signature }
        : { success: false, error: 'La wallet no devolvió una firma' };
    } catch (error) {
      if (isUserRejectedWalletRequest(error)) return { success: false, cancelled: true };
      return { success: false, error: (error as Error)?.message ?? 'Firma rechazada' };
    }
  }, [isConnected, provider, validAddress]);

  const currentNetwork: NetworkConfig | null = chainId
    ? getNetworkByChainId(chainId) ?? null
    : null;
  const currentNetworkKey = chainId ? getNetworkKey(chainId) : '';

  return useMemo(() => ({
    isAvailable: WC_PROJECT_ID_PRESENT,
    initError,
    isConnected,
    address: isConnected ? validAddress : null,
    provider: provider ?? null,
    chainId,
    currentNetwork,
    currentNetworkKey,
    balances,
    isFetchingBalance,
    isSendingTx,
    isSwitchingChain,
    openModal,
    disconnect,
    fetchBalance,
    switchNetwork,
    sendTransaction,
    sendErc20Transaction,
    sendToTreasury,
    signMessage,
  }), [
    balances, chainId, currentNetwork, currentNetworkKey, disconnect, fetchBalance,
    initError, isConnected, isFetchingBalance, isSendingTx, isSwitchingChain,
    openModal, provider, sendErc20Transaction, sendToTreasury, sendTransaction,
    signMessage, switchNetwork, validAddress,
  ]);
}
