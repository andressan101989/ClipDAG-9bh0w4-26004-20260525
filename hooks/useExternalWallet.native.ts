
/**
 * hooks/useExternalWallet.native.ts — iOS + Android
 *
 * Multi-chain WalletConnect v2 hook.
 *
 * KEY FIX: Session account resolution reads from provider.session.namespaces
 * (the canonical WalletConnect session object) instead of relying solely on
 * wcState.address, which @walletconnect/modal-react-native may not populate
 * immediately after session settlement.
 *
 * Account extraction order:
 *   1. provider.session.namespaces.eip155.accounts  (most reliable)
 *   2. provider.accounts                             (provider-level fallback)
 *   3. wcState.address                               (hook-level fallback)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  NETWORKS, readAllBalances, switchChain,
  getNetworkByChainId, getNetworkKey,
  type ChainBalances, type NetworkConfig,
} from '@/services/multiChainService';

// ── WalletConnect hook resolution ─────────────────────────────────────────────
type WCModalHook = () => {
  isConnected: boolean;
  address?:    string;
  open:        (opts?: { route?: string }) => Promise<void>;
  close:       () => void;
  provider?:   any;
};

let _useWCModal: WCModalHook | null = null;

try {
  const pkg  = require('@walletconnect/modal-react-native');
  const keys = Object.keys(pkg ?? {});
  console.log('[WC hook] exports:', keys);

  const hook =
    pkg?.useWalletConnectModal ??
    pkg?.default?.useWalletConnectModal ??
    null;

  if (typeof hook === 'function') {
    _useWCModal = hook;
    console.log('[WC hook] useWalletConnectModal resolved ✓');
  } else {
    console.error('[WC hook] useWalletConnectModal not found. Keys:', keys);
  }
} catch (e: any) {
  console.error('[WC hook] require failed:', e?.message ?? e);
}

const IS_AVAILABLE = _useWCModal !== null;

const _noopHook: WCModalHook = () => ({
  isConnected: false,
  address:     undefined,
  open:        async () => {},
  close:       () => {},
  provider:    undefined,
});

// ── Extract address from WC session namespaces ────────────────────────────────
/**
 * WalletConnect stores connected accounts inside the session object.
 * Format: "eip155:1:0xABCD..."
 * This is the most reliable source — populated even if useWalletConnectModal()
 * hasn't re-rendered yet after session settlement.
 */
function extractAddressFromSession(provider: any): string | null {
  try {
    // Path 1: provider.session.namespaces.eip155.accounts
    const nsAccounts: string[] | undefined =
      provider?.session?.namespaces?.eip155?.accounts ??
      provider?.session?.namespaces?.['eip155']?.accounts;

    if (nsAccounts && nsAccounts.length > 0) {
      // Each entry is "eip155:{chainId}:{address}"
      const parts = nsAccounts[0].split(':');
      if (parts.length >= 3) {
        const addr = parts[parts.length - 1];
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
          console.log('[WC] Address from session.namespaces:', addr);
          return addr;
        }
      }
    }

    // Path 2: provider.accounts (older WC providers expose this)
    const provAccounts: string[] | undefined = provider?.accounts;
    if (provAccounts && provAccounts.length > 0) {
      const addr = provAccounts[0].split(':').pop() ?? provAccounts[0];
      if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        console.log('[WC] Address from provider.accounts:', addr);
        return addr;
      }
    }

    // Path 3: provider.signer?.accounts
    const signerAccounts: string[] | undefined = provider?.signer?.accounts;
    if (signerAccounts && signerAccounts.length > 0) {
      const addr = signerAccounts[0];
      if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        console.log('[WC] Address from provider.signer.accounts:', addr);
        return addr;
      }
    }
  } catch (e: any) {
    console.warn('[WC] extractAddressFromSession error:', e?.message);
  }
  return null;
}

/** Extract active chainId from session namespaces */
function extractChainIdFromSession(provider: any): number | null {
  try {
    const nsAccounts: string[] | undefined =
      provider?.session?.namespaces?.eip155?.accounts;

    if (nsAccounts && nsAccounts.length > 0) {
      const parts = nsAccounts[0].split(':');
      if (parts.length >= 3) {
        const id = parseInt(parts[1], 10);
        if (!isNaN(id)) {
          console.log('[WC] ChainId from session.namespaces:', id);
          return id;
        }
      }
    }

    // Fallback: provider.chainId
    const cid = provider?.chainId;
    if (cid) return parseInt(String(cid), 10);
  } catch (e: any) {
    console.warn('[WC] extractChainIdFromSession error:', e?.message);
  }
  return null;
}

/** Log full session state for debugging */
function logSessionState(provider: any, wcState: ReturnType<WCModalHook>) {
  console.log('[WC] ═══════ SESSION STATE ═══════');
  console.log('[WC] wcState.isConnected :', wcState.isConnected);
  console.log('[WC] wcState.address     :', wcState.address ?? 'none');
  console.log('[WC] wcState.provider    :', wcState.provider ? 'present' : 'null');

  if (provider) {
    try {
      const session = provider.session ?? provider._session ?? null;
      if (session) {
        console.log('[WC] session.topic     :', session.topic?.slice(0, 20) ?? 'none');
        console.log('[WC] session.expiry    :', session.expiry);
        const ns = session.namespaces?.eip155;
        if (ns) {
          console.log('[WC] ns.accounts       :', JSON.stringify(ns.accounts));
          console.log('[WC] ns.chains         :', JSON.stringify(ns.chains));
          console.log('[WC] ns.methods        :', JSON.stringify(ns.methods?.slice(0, 4)));
        } else {
          console.log('[WC] namespaces.eip155 : (missing)');
          console.log('[WC] all namespaces    :', JSON.stringify(Object.keys(session.namespaces ?? {})));
        }
      } else {
        console.log('[WC] provider.session  : null — session not yet settled');
      }

      // Provider-level accounts
      console.log('[WC] provider.accounts :', JSON.stringify(provider.accounts ?? '(none)'));
      console.log('[WC] provider.connected:', provider.connected ?? provider.isConnected ?? '(no flag)');
      console.log('[WC] provider.chainId  :', provider.chainId ?? '(none)');
    } catch (e: any) {
      console.warn('[WC] provider introspection error:', e?.message);
    }
  }
  console.log('[WC] ════════════════════════════');
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useExternalWallet() {
  // Always call the same function every render (Rules of Hooks compliant)
  const wcState = (_useWCModal ?? _noopHook)();

  const wcProvider = wcState.provider ?? null;

  // ── Resolve address and connection from session namespaces (primary) ──────
  // Then fall back to wcState fields
  const sessionAddress = wcProvider ? extractAddressFromSession(wcProvider) : null;
  const sessionChainId = wcProvider ? extractChainIdFromSession(wcProvider) : null;

  const resolvedAddress = sessionAddress ?? (wcState.address && /^0x[a-fA-F0-9]{40}$/.test(wcState.address) ? wcState.address : null);
  const isConnected     = IS_AVAILABLE && !!(wcState.isConnected || resolvedAddress) && !!resolvedAddress;
  const address         = isConnected ? resolvedAddress : null;

  // ── State ─────────────────────────────────────────────────────────────────
  const [chainId,           setChainId]          = useState<number | null>(null);
  const [balances,          setBalances]          = useState<ChainBalances | null>(null);
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [isSendingTx,       setIsSendingTx]       = useState(false);
  const [isSwitchingChain,  setIsSwitchingChain]  = useState(false);
  const [initError,         setInitError]          = useState<string | null>(null);

  const mountedRef     = useRef(true);
  const prevAddressRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Debug log on every state change ──────────────────────────────────────
  useEffect(() => {
    logSessionState(wcProvider, wcState);
    console.log('[WC] resolvedAddress :', resolvedAddress ?? 'none');
    console.log('[WC] sessionChainId  :', sessionChainId ?? 'none');
    console.log('[WC] isConnected     :', isConnected);
  }, [wcState.isConnected, wcState.address, wcProvider, resolvedAddress, sessionChainId, isConnected]); // Added sessionChainId, isConnected to dependencies

  // ── Detect chain ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !wcProvider) return;

    const detect = async () => {
      // First try session namespace (no network round-trip needed)
      if (sessionChainId && sessionChainId > 0) {
        const netName = getNetworkByChainId(sessionChainId)?.shortName ?? 'unknown';
        console.log('[WC] Chain from session namespace:', sessionChainId, '(' + netName + ')');
        if (mountedRef.current) setChainId(sessionChainId);
        return;
      }
      // Fallback: ask provider
      try {
        const hex: string = await wcProvider.request({ method: 'eth_chainId', params: [] });
        const id = parseInt(hex, 16);
        console.log('[WC] Chain from eth_chainId RPC:', id, '(' + (getNetworkByChainId(id)?.shortName ?? 'unknown') + ')');
        if (mountedRef.current) setChainId(id);
      } catch (e: any) {
        console.warn('[WC] eth_chainId failed:', e?.message);
      }
    };

    detect();
  }, [isConnected, wcProvider, sessionChainId]);

  // ── Auto-fetch balances on address / chain change ──────────────────────────
  useEffect(() => {
    if (isConnected && address && wcProvider && chainId !== null) {
      if (address !== prevAddressRef.current) {
        prevAddressRef.current = address;
        _fetchBalances(wcProvider, address, chainId);
      }
    } else if (!isConnected) {
      prevAddressRef.current = null;
      if (mountedRef.current) {
        setBalances(null);
        setChainId(null);
      }
    }
  }, [isConnected, address, chainId, wcProvider]); // Removed the eslint-disable-next-line comment

  const _fetchBalances = async (provider: any, addr: string, cId: number) => {
    if (!provider || !addr) return;
    if (mountedRef.current) setIsFetchingBalance(true);
    try {
      const result = await readAllBalances(provider, addr, cId);
      console.log('[WC] Balances fetched:', JSON.stringify(result));
      if (mountedRef.current) setBalances(result);
    } catch (e: any) {
      console.warn('[WC] fetchBalances error:', e?.message);
    } finally {
      if (mountedRef.current) setIsFetchingBalance(false);
    }
  };

  const fetchBalance = useCallback(async () => {
    if (wcProvider && address && chainId !== null) {
      await _fetchBalances(wcProvider, address, chainId);
    }
  }, [wcProvider, address, chainId]);

  // ── Poll safety net ───────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (isConnected) stopPoll();
  }, [isConnected, stopPoll]);

  // Cleanup poll on unmount — must return a function, NOT the result of stopPoll()
  useEffect(() => {
    return () => { stopPoll(); };
  }, [stopPoll]);

  // ── Open QR modal ─────────────────────────────────────────────────────────
  const openModal = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!IS_AVAILABLE) {
      return {
        success: false,
        error:   'WalletConnect requiere un development build de Expo (no Expo Go).',
      };
    }
    try {
      setInitError(null);
      console.log('[WC] Opening modal...');
      await wcState.open();
      console.log('[WC] Modal opened — waiting for wallet approval...');

      // Poll every 2 s for up to 90 s — catches sessions that settle without
      // triggering a React re-render in the hook.
      stopPoll();
      let ticks = 0;
      pollRef.current = setInterval(() => {
        ticks++;
        const st = (_useWCModal ?? _noopHook)();
        const prov = st.provider;
        const sessionAddr  = prov ? extractAddressFromSession(prov) : null;
        const sessionCId   = prov ? extractChainIdFromSession(prov) : null;
        const resolvedAddr = sessionAddr ?? st.address;
        const connected    = !!(st.isConnected || resolvedAddr) && !!resolvedAddr;

        console.log(`[WC] poll #${ticks} → connected:${connected} addr:${resolvedAddr ?? 'none'} chain:${sessionCId ?? 'none'} provider:${prov ? 'yes' : 'no'}`);

        if (connected && resolvedAddr) {
          console.log('[WC] Session confirmed by poll ✔ addr:', resolvedAddr);
          stopPoll();
          // Force chainId detection if session resolved but state hasn't updated
          if (sessionCId && mountedRef.current) setChainId(sessionCId);
        }
        if (ticks >= 45) {
          console.warn('[WC] poll timeout — session not confirmed after 90 s');
          stopPoll();
        }
      }, 2000);

      return { success: true };
    } catch (e: any) {
      const msg = e?.message ?? 'Error abriendo el modal de WalletConnect';
      console.error('[WC] openModal error:', msg);
      if (mountedRef.current) setInitError(msg);
      return { success: false, error: msg };
    }
  }, [wcState.open, stopPoll]); // Added setChainId and mountedRef to dependencies as they are used in the interval, though react-hooks/exhaustive-deps typically ignores refs if they are only for `current`

  // ── Switch network ────────────────────────────────────────────────────────
  const switchNetwork = useCallback(async (
    networkKey: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isConnected || !wcProvider) return { success: false, error: 'Wallet no conectada' };
    const target = NETWORKS[networkKey];
    if (!target) return { success: false, error: 'Red desconocida: ' + networkKey };

    if (mountedRef.current) setIsSwitchingChain(true);
    try {
      const result = await switchChain(wcProvider, target);
      if (result.success) {
        const newId = target.chainId;
        if (mountedRef.current) setChainId(newId);
        if (address) await _fetchBalances(wcProvider, address, newId);
      }
      return result;
    } finally {
      if (mountedRef.current) setIsSwitchingChain(false);
    }
  }, [isConnected, wcProvider, address, mountedRef, setChainId, setIsSwitchingChain]); // Added mountedRef, setChainId, setIsSwitchingChain

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    try {
      if (wcProvider?.disconnect) await wcProvider.disconnect();
      else wcState.close?.();
      console.log('[WC] Disconnected');
    } catch (e) {
      console.warn('[WC] disconnect error:', e);
    }
    if (mountedRef.current) { setBalances(null); setChainId(null); }
  }, [wcProvider, wcState.close, mountedRef, setBalances, setChainId]); // Added mountedRef, setBalances, setChainId

  // ── ERC-20 token transfer (USDT) ─────────────────────────────────────────
  // Encodes transfer(address,uint256) calldata and sends via eth_sendTransaction.
  // No BigInt: uses Number arithmetic (safe for USDT amounts up to 9 quadrillion micro-units).
  const sendErc20Transaction = useCallback(async (
    tokenContract: string,
    toAddress:     string,
    amount:        number,
    decimals:      number,
    targetNetwork?: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!isConnected || !wcProvider || !address)
      return { success: false, error: 'Wallet no conectada' };

    if (targetNetwork && chainId !== NETWORKS[targetNetwork]?.chainId) {
      const sw = await switchNetwork(targetNetwork);
      if (!sw.success) return { success: false, error: sw.error };
    }

    if (mountedRef.current) setIsSendingTx(true);
    try {
      // ABI-encode: transfer(address _to, uint256 _value)
      // selector: a9059cbb
      // _to: 32-byte padded address (12 zero bytes + 20 addr bytes)
      // _value: 32-byte big-endian uint256 (amount in smallest token unit)
      const selector = 'a9059cbb';
      const addrPad  = toAddress.replace('0x', '').toLowerCase().padStart(64, '0');

      // Convert amount to token units (decimals=6 for USDT).
      // Use integer math to avoid floating-point precision issues.
      const unitAmt  = Math.round(amount * 10 ** decimals);
      const amtHex   = unitAmt.toString(16).padStart(64, '0');
      const data     = '0x' + selector + addrPad + amtHex;

      console.log('[WC] ERC-20 transfer', {
        token:   tokenContract,
        to:      toAddress,
        amount,
        decimals,
        unitAmt,
        data: data.slice(0, 30) + '...',
      });

      const txHash: string = await wcProvider.request({
        method: 'eth_sendTransaction',
        params: [{
          from:  address,
          to:    tokenContract,   // call the token contract, NOT the recipient
          value: '0x0',           // no native ETH value for ERC-20 transfers
          data,
        }],
      });

      console.log('[WC] ERC-20 TX hash:', txHash);
      return { success: true, txHash };
    } catch (e: any) {
      const msg = e?.message ?? 'Transacción ERC-20 rechazada';
      console.warn('[WC] sendErc20Transaction error:', msg);
      return { success: false, error: msg };
    } finally {
      if (mountedRef.current) setIsSendingTx(false);
    }
  }, [isConnected, wcProvider, address, chainId, switchNetwork, mountedRef, setIsSendingTx]);

  // ── Generic send native transaction ──────────────────────────────────────
  const sendTransaction = useCallback(async (
    toAddress: string,
    amountNative: number,
    _targetNetwork?: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!isConnected || !wcProvider || !address)
      return { success: false, error: 'Wallet no conectada' };

    // Optionally switch network before TX
    if (_targetNetwork && chainId !== NETWORKS[_targetNetwork]?.chainId) {
      const sw = await switchNetwork(_targetNetwork);
      if (!sw.success) return { success: false, error: sw.error };
    }

    if (mountedRef.current) setIsSendingTx(true);
    try {
      const net      = getNetworkByChainId(chainId ?? 1);
      const decimals = net?.decimals ?? 18;
      // Avoid BigInt — use Number arithmetic (safe for display-level ETH amounts)
      const weiAmt   = Math.round(amountNative * 10 ** decimals);
      const valueHex = '0x' + weiAmt.toString(16);

      console.log('[WC] eth_sendTransaction', { to: toAddress, value: amountNative, network: net?.shortName });

      const txHash: string = await wcProvider.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: toAddress, value: valueHex, data: '0x' }],
      });

      console.log('[WC] TX hash:', txHash);
      return { success: true, txHash };
    } catch (e: any) {
      const msg = e?.message ?? 'Transacción rechazada';
      console.warn('[WC] sendTransaction error:', msg);
      return { success: false, error: msg };
    } finally {
      if (mountedRef.current) setIsSendingTx(false);
    }
  }, [isConnected, wcProvider, address, chainId, switchNetwork, mountedRef, setIsSendingTx]);

  // ── USDT contract addresses per chain ────────────────────────────────────
  const USDT_CONTRACTS: Record<number, string> = {
    1:    '0xdac17f958d2ee523a2206206994597c13d831ec7', // Ethereum mainnet
    8453: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // Base mainnet
  };

  // ── Send to treasury (deposit flow) ──────────────────────────────────────
  // Routes ETH deposits as native tx, USDT deposits as ERC-20 transfer.
  const sendToTreasury = useCallback(async (
    amount:          number,
    treasuryAddress: string,
    targetNetwork?:  string,
    depositAsset?:   'eth' | 'usdt' | string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    const isUSDT = (depositAsset ?? '').toLowerCase() === 'usdt';

    if (isUSDT) {
      // Resolve token contract for the active chain
      const activeChainId = chainId ?? NETWORKS[targetNetwork ?? 'ethereum']?.chainId ?? 1;
      const tokenContract = USDT_CONTRACTS[activeChainId];
      if (!tokenContract) {
        return { success: false, error: `USDT not supported on chain ${activeChainId}` };
      }
      console.log('[WC] Routing as ERC-20 USDT transfer on chain', activeChainId);
      return sendErc20Transaction(tokenContract, treasuryAddress, amount, 6, targetNetwork);
    }

    // Default: native ETH transfer
    console.log('[WC] Routing as native ETH transfer');
    return sendTransaction(treasuryAddress, amount, targetNetwork);
  }, [chainId, sendErc20Transaction, sendTransaction]);

  // ── Sign message (EIP-191) ────────────────────────────────────────────────
  const signMessage = useCallback(async (
    message: string,
  ): Promise<{ success: boolean; signature?: string; error?: string }> => {
    if (!isConnected || !wcProvider || !address)
      return { success: false, error: 'Wallet no conectada' };
    try {
      // Need to ensure Buffer is available in the environment, or use another method for hex encoding
      // For React Native/Expo, 'Buffer' might need to be imported or polyfilled.
      // Assuming 'Buffer' is globally available or polyfilled for the target environment.
      const msgHex  = '0x' + Buffer.from(message, 'utf8').toString('hex');
      console.log('[WC] personal_sign request for:', address);
      const signature: string = await wcProvider.request({
        method: 'personal_sign',
        params: [msgHex, address],
      });
      return { success: true, signature };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Firma rechazada' };
    }
  }, [isConnected, wcProvider, address]);

  // ── Derived helpers ───────────────────────────────────────────────────────
  const currentNetwork: NetworkConfig | null = chainId ? (getNetworkByChainId(chainId) ?? null) : null;
  const currentNetworkKey: string            = chainId ? getNetworkKey(chainId) : '';

  return {
    isAvailable:       IS_AVAILABLE,
    initError,

    // Connection — resolved from session.namespaces first
    isConnected,
    address,
    provider:          wcProvider,

    // Chain
    chainId,
    currentNetwork,
    currentNetworkKey,

    // Balances
    balances,
    isFetchingBalance,

    // TX state
    isSendingTx,
    isSwitchingChain,

    // Actions
    openModal,
    disconnect,
    fetchBalance,
    switchNetwork,
    sendTransaction,
    sendToTreasury,
    signMessage,
  };
}
