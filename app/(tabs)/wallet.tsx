import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  StyleSheet, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator, Dimensions, Linking, Alert,
} from 'react-native';
import { WalletErrorBoundary } from '@/components/wallet/WalletErrorBoundary';
import { TransactionRow } from '@/components/wallet/TransactionRow';
import type { TransactionItem } from '@/components/wallet/TransactionRow';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useExternalWallet } from '@/hooks/useExternalWallet';
import { getSupabaseClient } from '@/template';
import { Spacing } from '@/constants/theme';
import {
  submitDepositToBackend,
  requestWithdrawalFromBackend,
  chainKeyToId,
  assetToTokenType,
} from '@/services/walletApi';
import {
  NETWORKS, shortAddress, getExplorerTxUrl,
  getExplorerAddressUrl,
} from '@/services/multiChainService';
import {
  isValidEvmAddress,
  MIN_WITHDRAWAL_AMOUNT,
  REWARD_RATES,
} from '@/services/walletConfig';
import {
  usdtToBdag, ethToBdag, bdagToUsd, bdagToWithdrawAsset,
  applyWithdrawalFee, formatBdagWithUsd,
  WITHDRAWAL_FEE_PERCENT, USD_TO_BDAG_RATE, BDAG_TO_USD_RATE,
  fetchAndCacheEthPrice, getEthPrice,
  type DepositAsset,
} from '@/services/conversionEngine';

const { width: W } = Dimensions.get('window');

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  bg:        '#07070F',
  surface:   '#0F0F1E',
  surfaceUp: '#161628',
  border:    '#1C1C38',
  borderSub: '#111126',
  text:      '#FFFFFF',
  textSub:   '#8888AA',
  textMuted: '#44445A',
  primary:   '#7C5CFF',
  secondary: '#FF2D78',
  accent:    '#00E5A0',
  blue:      '#2D9EFF',
  warning:   '#FFB800',
  error:     '#FF6B6B',
  eth:       '#627EEA',
  base:      '#0052FF',
  usdt:      '#26A17B',
  gold:      '#FFD700',
  transfer:  '#FF9D00',
};


// ── Helpers ───────────────────────────────────────────────────────────────────
function safeFmt(n: number | undefined | null, dec = 2): string {
  const v = Number(n ?? 0);
  return isNaN(v) ? '0.00' : v.toFixed(dec);
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ModalView = 'none' | 'deposit' | 'withdraw' | 'transfer' | 'info';
type TxFilter  = 'all' | 'earned' | 'deposits' | 'withdrawals' | 'transfers';
const FILTERS: { key: TxFilter; label: string }[] = [
  { key: 'all',         label: 'Todos' },
  { key: 'earned',      label: 'Ganancias' },
  { key: 'deposits',    label: 'Depósitos' },
  { key: 'withdrawals', label: 'Retiros' },
  { key: 'transfers',   label: 'Transferencias' },
];

interface RecipientUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
}

// ── Stable network chips ────────────────────────────────────────────────────
const PRIMARY_NETWORKS = [
  { key: 'ethereum', label: 'Ethereum', color: C.eth,  icon: 'ethereum' as const },
  { key: 'base',     label: 'Base',     color: C.base, icon: 'circle-multiple' as const },
];


// ─────────────────────────────────────────────────────────────────────────────
// WALLET SCREEN INNER
// ─────────────────────────────────────────────────────────────────────────────
function WalletScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading } = useAuth();
  const walletData     = useWallet();
  const externalWallet = useExternalWallet();
  const supabase       = getSupabaseClient();

  // ── useWallet destructuring ─────────────────────────────────────────────
  const balance                = walletData?.balance ?? 0;
  const savedWallet            = walletData?.walletAddress ?? null;
  const transactions           = walletData?.transactions ?? [];
  const stats                  = walletData?.stats ?? { totalEarned: 0, totalWithdrawn: 0, totalDeposited: 0, totalEarnedUsd: 0, totalDepositedUsd: 0 };
  const syncStatus             = walletData?.syncStatus ?? { isSyncing: false, lastSyncAt: null, syncError: null };
  const isLoadingTx            = walletData?.isLoadingTx ?? false;
  const connectWalletAddress   = walletData?.connectWalletAddress ?? (async () => ({ success: false, error: 'N/A' }));
  const transferBdag           = walletData?.transferBdag ?? (async () => ({ success: false, error: 'N/A' }));
  const getTreasuryAddress     = walletData?.getTreasuryAddress ?? ((_key?: string) => '0xEA0Af178948BebBfE71A223d8915d596592CB200');
  const fullSync               = walletData?.fullSync ?? (async () => {});
  const pollBalanceBurst       = walletData?.pollBalanceBurst ?? (async () => {});

  // ── Local loading states for direct walletApi calls ────────────────────
  const [isWithdrawing,      setIsWithdrawing]      = useState(false);
  const [isVerifyingDeposit, setIsVerifyingDeposit] = useState(false);

  // ── useExternalWallet destructuring ────────────────────────────────────
  const wcAvailable       = externalWallet?.isAvailable ?? false;
  const isConnected       = externalWallet?.isConnected ?? false;
  const walletAddress     = externalWallet?.address ?? null;
  const balances          = externalWallet?.balances ?? null;
  const isFetchingBalance = externalWallet?.isFetchingBalance ?? false;
  const isSendingTx       = externalWallet?.isSendingTx ?? false;
  const isSwitchingChain  = externalWallet?.isSwitchingChain ?? false;
  const wcInitError       = externalWallet?.initError ?? null;
  const chainId           = externalWallet?.chainId ?? null;
  const currentNetwork    = externalWallet?.currentNetwork ?? null;
  const openModal         = externalWallet?.openModal ?? (async () => ({ success: false, error: 'N/A' }));
  const disconnectWallet  = externalWallet?.disconnect ?? (async () => {});
  const fetchBalance      = externalWallet?.fetchBalance ?? (async () => {});
  const sendToTreasury    = externalWallet?.sendToTreasury ?? (async () => ({ success: false, error: 'N/A' }));
  const switchNetwork     = externalWallet?.switchNetwork ?? (async () => ({ success: false, error: 'N/A' }));

  // ── Modal / UI state ────────────────────────────────────────────────────
  const [modal, setModal]               = useState<ModalView>('none');

  // Deposit
  const [depositAmt, setDepositAmt]       = useState('');
  const [depositNetwork, setDepositNetwork] = useState<string>('ethereum');
  const [depositAsset, setDepositAsset]   = useState<DepositAsset>('usdt');
  const [depositStep, setDepositStep]     = useState<'input' | 'awaiting_wallet' | 'verifying' | 'done'>('input');
  const [depositTxHash, setDepositTxHash] = useState('');
  const [depositBdagPreview, setDepositBdagPreview] = useState(0);

  // Withdraw
  const [withdrawAmt, setWithdrawAmt]     = useState('');
  const [withdrawAddr, setWithdrawAddr]   = useState('');
  const [withdrawAsset, setWithdrawAsset] = useState<DepositAsset>('usdt');
  const [withdrawOk, setWithdrawOk]       = useState(false);

  // Transfer
  const [transferQuery, setTransferQuery]         = useState('');
  const [transferAmount, setTransferAmount]       = useState('');
  const [transferNote, setTransferNote]           = useState('');
  const [transferSearching, setTransferSearching] = useState(false);
  const [searchResults, setSearchResults]         = useState<RecipientUser[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientUser | null>(null);
  const [transferring, setTransferring]           = useState(false);
  const [transferDone, setTransferDone]           = useState(false);
  const [transferDoneMsg, setTransferDoneMsg]     = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Other
  const [txFilter, setTxFilter]       = useState<TxFilter>('all');
  const [addrCopied, setAddrCopied]   = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ethPrice, setEthPrice]       = useState(getEthPrice());

  useEffect(() => {
    fetchAndCacheEthPrice().then(p => setEthPrice(p)).catch(() => {});
  }, []);

  const closeModal = useCallback(() => {
    setModal('none');
    setWithdrawAmt(''); setWithdrawAddr('');
    setDepositAmt(''); setDepositTxHash(''); setDepositStep('input');
    setDepositBdagPreview(0); setWithdrawOk(false);
    // Transfer reset
    setTransferQuery(''); setTransferAmount(''); setTransferNote('');
    setSelectedRecipient(null); setSearchResults([]);
    setTransferring(false); setTransferDone(false); setTransferDoneMsg('');
  }, []);

  // Sync wallet address to DB
  const syncedAddrRef = useRef<string | null>(null);
  useEffect(() => {
    if (walletAddress && walletAddress !== syncedAddrRef.current) {
      syncedAddrRef.current = walletAddress;
      connectWalletAddress(walletAddress).catch(() => {});
    }
  }, [walletAddress, connectWalletAddress]);

  // Deposit BDAG preview
  useEffect(() => {
    const n = parseFloat(depositAmt);
    if (!isNaN(n) && n > 0) {
      const bdag = depositAsset === 'usdt' ? usdtToBdag(n) : ethToBdag(n);
      setDepositBdagPreview(Math.round(bdag * 100) / 100);
    } else {
      setDepositBdagPreview(0);
    }
  }, [depositAmt, depositAsset, ethPrice]);

  const copyAddress = useCallback((addr: string) => {
    try { Clipboard.setStringAsync(addr).catch(() => {}); } catch { /* ok */ }
    setAddrCopied(true);
    setTimeout(() => setAddrCopied(false), 2000);
  }, []);

  // ── Recipient search (debounced) ─────────────────────────────────────────
  const searchRecipients = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) { setSearchResults([]); return; }
    setTransferSearching(true);
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, username, display_name, avatar_url, email')
        .or(`username.ilike.%${q.trim()}%,display_name.ilike.%${q.trim()}%,email.ilike.%${q.trim()}%`)
        .neq('id', user?.id ?? '')
        .limit(5);
      setSearchResults((data as RecipientUser[]) ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setTransferSearching(false);
    }
  }, [supabase, user?.id]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!transferQuery || selectedRecipient) return;
    searchTimerRef.current = setTimeout(() => searchRecipients(transferQuery), 350);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [transferQuery, selectedRecipient, searchRecipients]);

  // ── Handle transfer ──────────────────────────────────────────────────────
  const handleTransfer = useCallback(async () => {
    if (!selectedRecipient) { Alert.alert('Destinatario', 'Selecciona a quién enviar'); return; }
    const amt = parseFloat(transferAmount);
    if (isNaN(amt) || amt <= 0) { Alert.alert('Monto inválido', 'Ingresa un monto mayor a 0'); return; }
    if (amt < 1) { Alert.alert('Mínimo', 'El mínimo de transferencia es 1 BDAG'); return; }
    if (amt > balance) { Alert.alert('Saldo insuficiente', `Tienes ${safeFmt(balance)} BDAG disponibles`); return; }

    const recipientName = selectedRecipient.display_name || selectedRecipient.username;
    Alert.alert(
      'Confirmar transferencia',
      `Enviar ${safeFmt(amt)} BDAG\n≈ $${safeFmt(bdagToUsd(amt))} USD\n\nA: @${selectedRecipient.username}${transferNote ? `\n\nNota: ${transferNote}` : ''}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Transferir',
          onPress: async () => {
            setTransferring(true);
            const result = await transferBdag(selectedRecipient.username, amt, transferNote);
            setTransferring(false);
            if (result.success) {
              setTransferDone(true);
              setTransferDoneMsg(`+${safeFmt(amt)} BDAG enviados a @${result.recipientUsername ?? selectedRecipient.username}`);
              setTimeout(() => closeModal(), 2200);
            } else {
              Alert.alert('Error', result.error ?? 'No se pudo completar la transferencia');
            }
          },
        },
      ],
    );
  }, [selectedRecipient, transferAmount, transferNote, balance, transferBdag, closeModal]);

  if (authLoading && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  const handleConnect = async () => {
    if (!wcAvailable) {
      Alert.alert('WalletConnect no disponible',
        'Necesitas un development build de Expo (no Expo Go) para conectar wallets.\n\nDescarga el APK desde el menú superior.');
      return;
    }
    setIsConnecting(true);
    try {
      const result = await openModal();
      if (!result.success && result.error) Alert.alert('Error', result.error);
    } finally { setIsConnecting(false); }
  };

  const handleSwitchNetwork = async (key: string) => {
    const target = NETWORKS[key];
    if (!target) return;
    const result = await switchNetwork(key);
    if (!result.success) {
      Alert.alert('No se pudo cambiar la red',
        result.error ?? 'Cámbiala manualmente en tu wallet.');
    }
  };

  // ── Deposit ─────────────────────────────────────────────────────────────
  // Lean flow: WalletConnect signs → txHash → backend validates from mempool → instant credit.
  // No client-side receipt polling. Backend reads mempool directly (<1.5 s).
  // bdag-monitor confirms on-chain in background; reverses if reorg (extremely rare).
  const handleDeposit = async () => {
    if (!isConnected) { Alert.alert('Conecta tu wallet', 'Primero conecta MetaMask, Trust Wallet u otra wallet.'); return; }
    const amount = parseFloat(depositAmt);
    if (isNaN(amount) || amount <= 0) { Alert.alert('Monto inválido', 'Ingresa un monto mayor a 0'); return; }

    setDepositStep('awaiting_wallet');

    // Switch network if needed
    const targetNet = NETWORKS[depositNetwork];
    if (targetNet && chainId !== targetNet.chainId) {
      const sw = await switchNetwork(depositNetwork);
      if (!sw.success) {
        setDepositStep('input');
        Alert.alert('Red incorrecta', `Cambia a ${targetNet.name} en tu wallet e intenta de nuevo.`);
        return;
      }
    }

    // Send tx via WalletConnect
    const treasury   = getTreasuryAddress(depositNetwork);
    const sendResult = await sendToTreasury(amount, treasury, depositNetwork, depositAsset);
    if (!sendResult.success) {
      setDepositStep('input');
      Alert.alert('Transacción rechazada', sendResult.error ?? 'No se pudo enviar la transacción');
      return;
    }

    const txHash = sendResult.txHash ?? '';
    if (!txHash || !/^0x[a-fA-F0-9]{64}$/i.test(txHash)) {
      setDepositStep('input');
      Alert.alert('Error', 'No se recibió el hash de transacción de la wallet.');
      return;
    }

    // Show verifying UI immediately — backend does the mempool check (<1.5 s)
    setDepositTxHash(txHash);
    setDepositStep('verifying');
    setIsVerifyingDeposit(true);

    const depositPayload = {
      txHash,
      chainKey:      depositNetwork,
      walletAddress: (walletAddress ?? '').trim().toLowerCase(),
    };
    console.log('[wallet.tsx] submitDepositToBackend →', {
      txHash:        depositPayload.txHash.slice(0, 12) + '...',
      chainKey:      depositPayload.chainKey,
      walletAddress: depositPayload.walletAddress.slice(0, 10) + '...',
    });

    const creditResult = await submitDepositToBackend(depositPayload);
    setIsVerifyingDeposit(false);
    console.log('[wallet.tsx] submitDepositToBackend ←', creditResult);

    if (creditResult.success) {
      setDepositStep('done');
      if (creditResult.bdagCredited && creditResult.bdagCredited > 0) {
        setDepositBdagPreview(creditResult.bdagCredited);
      }
      // Immediate sync + burst poll (5× every 3s) to reflect credited balance
      // without requiring manual refresh (realtime not supported by backend)
      fullSync();
      pollBalanceBurst(5, 3000);
      setTimeout(() => { setModal('none'); setDepositStep('input'); setDepositAmt(''); }, 2200);
    } else {
      setDepositStep('input');
      const err = creditResult.error ?? '';
      const isRetryable = err.toLowerCase().includes('not yet visible') || err.toLowerCase().includes('retry');
      Alert.alert(
        isRetryable ? 'Red congestionada' : 'Error al acreditar',
        isRetryable
          ? `Tu transacción fue enviada (${shortAddress(txHash)}) pero aún no es visible en la red.\n\nEspera unos segundos e intenta de nuevo — tus fondos están seguros.`
          : (err || 'Verifica tu conexión e intenta de nuevo.'),
      );
    }
  };

  // ── Withdraw ─────────────────────────────────────────────────────────────
  const wNum   = parseFloat(withdrawAmt) || 0;
  const { gross: wGross, fee: wFee, net: wNet } = applyWithdrawalFee(wNum);
  const wAsset = bdagToWithdrawAsset(wNet, withdrawAsset);
  const wUsd   = bdagToUsd(wNet);

  const handleRefresh = async () => {
    try { await Promise.all([fullSync(), fetchBalance()]); } catch { /* ok */ }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmt);
    if (isNaN(amount) || amount < MIN_WITHDRAWAL_AMOUNT) {
      Alert.alert('Mínimo', `El mínimo es ${MIN_WITHDRAWAL_AMOUNT} créditos BDAG`);
      return;
    }
    const dest = (withdrawAddr.trim() || walletAddress || savedWallet || '').toLowerCase();
    if (!isValidEvmAddress(dest)) { Alert.alert('Error', 'Ingresa una dirección EVM válida (0x...)'); return; }

    const assetLabel = withdrawAsset === 'usdt' ? 'USDT' : 'ETH';
    Alert.alert(
      'Confirmar retiro',
      `Monto bruto: ${safeFmt(amount)} BDAG\nComisión (${WITHDRAWAL_FEE_PERCENT}%): ${safeFmt(wFee)} BDAG\nRecibes: ${safeFmt(wNet)} BDAG\n≈ $${safeFmt(wUsd)}\nEnviado como: ${safeFmt(wAsset, 4)} ${assetLabel}\nDestino: ${shortAddress(dest)}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Retirar', onPress: async () => {
            // Direct call to walletApi.requestWithdrawalFromBackend —
            // builds+validates payload, generates idempotency key, invokes bdag-withdraw
            setIsWithdrawing(true);
            const withdrawPayload = {
              amount:    amount,
              toAddress: dest,
              chainKey:  depositNetwork,
              asset:     withdrawAsset,
            };
            console.log('[wallet.tsx] requestWithdrawalFromBackend payload:', {
              amount:     withdrawPayload.amount,
              toAddress:  withdrawPayload.toAddress.slice(0, 10) + '...',
              chainKey:   withdrawPayload.chainKey,
              chain_id:   chainKeyToId(withdrawPayload.chainKey),
              token_type: assetToTokenType(withdrawPayload.asset),
            });
            const r = await requestWithdrawalFromBackend(withdrawPayload);
            setIsWithdrawing(false);
            console.log('[wallet.tsx] requestWithdrawalFromBackend result:', r);
            if (r.success) {
              fullSync();
              setWithdrawOk(true);
              setTimeout(closeModal, 1600);
              const displayNet = r.netBdag != null
                ? bdagToWithdrawAsset(r.netBdag, withdrawAsset)
                : wAsset;
              const txHashShort = r.txHash ? ` · TX: ${shortAddress(r.txHash)}` : '';
              Alert.alert(
                '✅ Transacción enviada',
                `${safeFmt(displayNet, 4)} ${assetLabel} enviados a ${shortAddress(dest)}.${txHashShort}\n\nEsperando confirmación on-chain.`,
              );
              // Refresh balance now and after confirmation window
              fullSync();
              setTimeout(() => fullSync(), 15000);
              setTimeout(() => fullSync(), 45000);
            } else {
              const errMsg = r.error ?? 'No se pudo procesar el retiro';
              // Parse cooldown remaining time from backend message
              const cooldownMatch = errMsg.match(/Next withdrawal available in (.+)/);
              if (cooldownMatch) {
                Alert.alert(
                  'Retiro en espera',
                  `Por seguridad, solo se permite un retiro cada 10 minutos.\n\nPróximo retiro disponible en: ${cooldownMatch[1]}`,
                );
              } else {
                Alert.alert('Error', errMsg);
              }
            }
          },
        },
      ],
    );
  };

  // ── Build history ────────────────────────────────────────────────────────
  const allHistory: TransactionItem[] = transactions
    .filter(tx => {
      if (txFilter === 'earned')      return ['reward', 'tip', 'gift'].includes(tx.type);
      if (txFilter === 'deposits')    return tx.type === 'deposit';
      if (txFilter === 'withdrawals') return tx.type === 'withdraw';
      if (txFilter === 'transfers')   return ['transfer_sent', 'transfer_received'].includes(tx.type);
      return true;
    })
    .map(tx => ({
      id: tx.id, type: tx.type, amount: tx.amount,
      status: tx.status, description: tx.description, txHash: tx.txHash, createdAt: tx.createdAt,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const depositStepLabel: Record<string, string> = {
    input: 'Depositar', awaiting_wallet: 'Confirma en tu wallet...', verifying: 'Verificando...', done: 'Depósito acreditado',
  };
  const depositNetworkConfig = NETWORKS[depositNetwork];
  const assetSymbol = depositAsset === 'usdt' ? 'USDT' : (depositNetworkConfig?.symbol ?? 'ETH');

  // Transfer amt num
  const transferAmt = parseFloat(transferAmount) || 0;
  const transferUsd = bdagToUsd(transferAmt);

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <View style={[sty.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={sty.header}>
        <View>
          <Text style={sty.headerTitle}>Billetera</Text>
          <Text style={sty.headerSub}>
            {isConnected
              ? `${currentNetwork?.shortName ?? 'EVM'} · ${shortAddress(walletAddress ?? '')}`
              : 'Ethereum · Base · BDAG'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable style={sty.refreshBtn} onPress={() => setModal('info')} hitSlop={8}>
            <MaterialCommunityIcons name="information-outline" size={18} color={C.textMuted} />
          </Pressable>
          <Pressable style={[sty.refreshBtn, syncStatus.isSyncing && { opacity: 0.4 }]}
            onPress={handleRefresh} disabled={syncStatus.isSyncing} hitSlop={8}>
            {syncStatus.isSyncing
              ? <ActivityIndicator size="small" color={C.primary} />
              : <MaterialCommunityIcons name="refresh" size={20} color={C.textMuted} />}
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={[sty.scroll, { paddingBottom: 120 + insets.bottom }]}>

        {/* ── Warnings ──────────────────────────────────────────────────── */}
        {!wcAvailable ? (
          <View style={[sty.banner, { borderColor: 'rgba(255,184,0,0.30)', backgroundColor: 'rgba(255,184,0,0.06)' }]}>
            <MaterialCommunityIcons name="alert-outline" size={14} color={C.warning} />
            <Text style={[sty.bannerText, { color: C.warning }]}>
              WalletConnect requiere un development build de Expo. Descarga el APK para conectar tu wallet.
            </Text>
          </View>
        ) : wcInitError ? (
          <View style={[sty.banner, { borderColor: 'rgba(255,107,107,0.30)', backgroundColor: 'rgba(255,107,107,0.06)' }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={C.error} />
            <Text style={[sty.bannerText, { color: C.error }]}>{wcInitError}</Text>
          </View>
        ) : null}

        {/* ── Connect card ───────────────────────────────────────────────── */}
        {!isConnected ? (
          <View style={sty.connectCard}>
            <LinearGradient colors={['#0D0D2A', '#0A1428']} style={sty.connectCardInner}>
              <View style={sty.connectIconCircle}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="wallet-outline" size={34} color="#fff" />
                </LinearGradient>
              </View>
              <Text style={sty.connectTitle}>Conecta tu Wallet</Text>
              <Text style={sty.connectSub}>
                Deposita ETH o USDT → recibe créditos BDAG instantáneamente.{'\n'}Soporta MetaMask, Trust Wallet y Coinbase Wallet.
              </Text>

              <View style={sty.ratePreviewBox}>
                <View style={sty.ratePreviewRow}>
                  <MaterialCommunityIcons name="currency-usd" size={16} color={C.usdt} />
                  <Text style={sty.ratePreviewText}>1 USDT</Text>
                  <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                  <Text style={[sty.ratePreviewVal, { color: C.primary }]}>{USD_TO_BDAG_RATE} BDAG</Text>
                </View>
                <View style={sty.ratePreviewRow}>
                  <MaterialCommunityIcons name="ethereum" size={16} color={C.eth} />
                  <Text style={sty.ratePreviewText}>1 ETH</Text>
                  <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                  <Text style={[sty.ratePreviewVal, { color: C.primary }]}>{(ethPrice * USD_TO_BDAG_RATE).toLocaleString()} BDAG</Text>
                </View>
                <View style={sty.ratePreviewRow}>
                  <MaterialCommunityIcons name="cash" size={16} color={C.accent} />
                  <Text style={sty.ratePreviewText}>1 BDAG</Text>
                  <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                  <Text style={[sty.ratePreviewVal, { color: C.accent }]}>${BDAG_TO_USD_RATE}</Text>
                </View>
              </View>

              <View style={sty.networkChips}>
                {PRIMARY_NETWORKS.map(n => (
                  <View key={n.key} style={[sty.networkChip, { borderColor: n.color + '55' }]}>
                    <MaterialCommunityIcons name={n.icon} size={14} color={n.color} />
                    <Text style={[sty.networkChipText, { color: n.color }]}>{n.label}</Text>
                  </View>
                ))}
                <View style={[sty.networkChip, { borderColor: C.usdt + '55' }]}>
                  <MaterialCommunityIcons name="currency-usd" size={14} color={C.usdt} />
                  <Text style={[sty.networkChipText, { color: C.usdt }]}>USDT</Text>
                </View>
              </View>

              <View style={sty.walletLogos}>
                {[
                  { name: 'MetaMask',  icon: 'ethereum' as const,        color: '#E2761B' },
                  { name: 'Trust',     icon: 'shield-check' as const,    color: '#3375BB' },
                  { name: 'Coinbase',  icon: 'circle-multiple' as const, color: '#0052FF' },
                ].map(w => (
                  <View key={w.name} style={sty.walletLogo}>
                    <LinearGradient colors={[w.color + '28', w.color + '10']} style={sty.walletLogoCircle}>
                      <MaterialCommunityIcons name={w.icon} size={22} color={w.color} />
                    </LinearGradient>
                    <Text style={sty.walletLogoName}>{w.name}</Text>
                  </View>
                ))}
              </View>

              <Pressable style={[sty.connectBtn, isConnecting && { opacity: 0.6 }]}
                onPress={handleConnect} disabled={isConnecting}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={sty.connectBtnGrad}>
                  {isConnecting ? <ActivityIndicator color="#fff" size="small" />
                    : <MaterialCommunityIcons name="qrcode-scan" size={20} color="#fff" />}
                  <Text style={sty.connectBtnText}>
                    {isConnecting ? 'Abriendo QR...' : 'Conectar Wallet (QR)'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </LinearGradient>
          </View>
        ) : (
          <View style={sty.connectedBanner}>
            <LinearGradient colors={['rgba(0,229,160,0.12)', 'rgba(45,158,255,0.07)']} style={sty.connectedBannerInner}>
              <View style={sty.connectedLeft}>
                <LinearGradient colors={['#00E5A0', '#2D9EFF']} style={sty.connectedDot} />
                <View style={{ flex: 1 }}>
                  <Text style={sty.connectedLabel}>WalletConnect v2 · {currentNetwork?.shortName ?? 'EVM'}</Text>
                  <Text style={sty.connectedAddr} numberOfLines={1}>{walletAddress}</Text>
                </View>
              </View>
              <View style={sty.connectedActions}>
                <Pressable onPress={() => copyAddress(walletAddress ?? '')} hitSlop={8} style={sty.addrBtn}>
                  <MaterialIcons name={addrCopied ? 'check' : 'content-copy'} size={15} color={addrCopied ? C.accent : C.textSub} />
                </Pressable>
                {chainId ? (
                  <Pressable onPress={() => Linking.openURL(getExplorerAddressUrl(walletAddress ?? '', chainId)).catch(() => {})} hitSlop={8} style={sty.addrBtn}>
                    <MaterialCommunityIcons name="open-in-new" size={15} color={C.textSub} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => Alert.alert('Desconectar', '¿Desconectar wallet?', [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Desconectar', style: 'destructive', onPress: () => disconnectWallet() },
                  ])}
                  hitSlop={8} style={[sty.addrBtn, { borderColor: 'rgba(255,107,107,0.35)' }]}>
                  <MaterialCommunityIcons name="link-off" size={15} color={C.error} />
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* ── Network selector ───────────────────────────────────────────── */}
        {isConnected ? (
          <View>
            <Text style={sty.sectionLabel}>Red activa</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {PRIMARY_NETWORKS.map(n => {
                const isActive = chainId === NETWORKS[n.key]?.chainId;
                return (
                  <Pressable key={n.key}
                    style={[sty.netChip, isActive && { borderColor: n.color, backgroundColor: n.color + '22' }]}
                    onPress={() => handleSwitchNetwork(n.key)}
                    disabled={isSwitchingChain}>
                    {isSwitchingChain && !isActive
                      ? <ActivityIndicator size="small" color={n.color} />
                      : <MaterialCommunityIcons name={n.icon} size={16} color={isActive ? n.color : C.textMuted} />}
                    <Text style={[sty.netChipText, isActive && { color: n.color, fontWeight: '700' }]}>{n.label}</Text>
                    {isActive ? <View style={[sty.netChipDot, { backgroundColor: n.color }]} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Main balance card ───────────────────────────────────────────── */}
        <LinearGradient colors={['#160A35', '#0B1430', '#060E22']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={sty.balCard}>

          <View>
            <Text style={sty.balLabel}>CRÉDITOS BDAG</Text>
            <Text style={sty.balAmt}>{safeFmt(balance, 2)}</Text>
            <Text style={sty.balUsd}>≈ ${safeFmt(bdagToUsd(balance))} USD</Text>
            <View style={sty.bdagBadge}><Text style={sty.bdagBadgeText}>1 BDAG = $0.01</Text></View>
          </View>

          {isConnected && balances ? (
            <View style={sty.onChainSection}>
              <View style={sty.onChainRow}>
                <MaterialCommunityIcons name="link-variant" size={12} color="rgba(255,255,255,0.28)" />
                <Text style={sty.onChainSectionLabel}>Tu wallet on-chain · {currentNetwork?.shortName ?? 'EVM'}</Text>
                {isFetchingBalance ? <ActivityIndicator size="small" color={C.textMuted} style={{ marginLeft: 6 }} /> : null}
              </View>
              <View style={sty.tokenRow}>
                <View style={[sty.tokenIcon, { backgroundColor: (currentNetwork?.color ?? C.eth) + '22' }]}>
                  <MaterialCommunityIcons name="ethereum" size={16} color={currentNetwork?.color ?? C.eth} />
                </View>
                <Text style={sty.tokenName}>{currentNetwork?.symbol ?? 'ETH'}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={sty.tokenBal}>{safeFmt(balances.native, 4)}</Text>
                  <Text style={sty.tokenUsd}>≈ ${safeFmt(balances.native * ethPrice)}</Text>
                </View>
              </View>
              <View style={sty.tokenRow}>
                <View style={[sty.tokenIcon, { backgroundColor: C.usdt + '22' }]}>
                  <MaterialCommunityIcons name="currency-usd" size={16} color={C.usdt} />
                </View>
                <Text style={sty.tokenName}>USDT</Text>
                <Text style={sty.tokenBal}>{isFetchingBalance ? '...' : safeFmt(balances.usdt)}</Text>
              </View>
            </View>
          ) : null}

          <View style={sty.balDivider} />
          <View style={sty.statsRow}>
            {[
              { icon: 'trending-up' as const,      label: 'Ganado',     val: safeFmt(stats.totalEarned),    color: C.accent },
              { icon: 'arrow-up-circle' as const,   label: 'Retirado',   val: safeFmt(stats.totalWithdrawn), color: C.secondary },
              { icon: 'arrow-down-circle' as const, label: 'Depositado', val: safeFmt(stats.totalDeposited), color: C.blue },
            ].map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <View style={sty.statDiv} />}
                <View style={sty.stat}>
                  <MaterialCommunityIcons name={s.icon} size={14} color={s.color} />
                  <Text style={sty.statLabel}>{s.label}</Text>
                  <Text style={[sty.statVal, { color: s.color }]}>{s.val}</Text>
                  <Text style={sty.statUsd}>${safeFmt(bdagToUsd(parseFloat(s.val) || 0))}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        </LinearGradient>

        {syncStatus.syncError ? (
          <View style={sty.banner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={C.warning} />
            <Text style={sty.bannerText} numberOfLines={2}>{syncStatus.syncError}</Text>
            <Pressable onPress={handleRefresh} hitSlop={8}>
              <Text style={sty.errRetry}>Reintentar</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Action grid (3 buttons: Deposit · Withdraw · Transfer) ──────── */}
        <View style={sty.actGrid}>
          {([
            {
              colors: ['rgba(45,158,255,0.18)', 'rgba(124,92,255,0.10)'] as [string, string],
              circleColors: ['#2D9EFF', '#7C5CFF'] as [string, string],
              icon: 'arrow-downward', isMaterial: true,
              label: 'Depositar', sub: 'ETH / USDT → BDAG',
              onPress: () => isConnected ? setModal('deposit') : handleConnect(),
            },
            {
              colors: ['rgba(255,45,120,0.18)', 'rgba(180,79,255,0.10)'] as [string, string],
              circleColors: ['#FF2D78', '#B44FFF'] as [string, string],
              icon: 'arrow-upward', isMaterial: true,
              label: 'Retirar', sub: 'BDAG → USDT / ETH',
              onPress: () => setModal('withdraw'),
            },
            {
              colors: ['rgba(255,157,0,0.18)', 'rgba(255,90,0,0.10)'] as [string, string],
              circleColors: ['#FF9D00', '#FF5A00'] as [string, string],
              icon: 'swap-horizontal', isMaterial: false,
              label: 'Transferir', sub: 'BDAG entre usuarios',
              onPress: () => setModal('transfer'),
            },
          ] as const).map((btn, i) => (
            <Pressable key={i} style={sty.actBtn3} onPress={btn.onPress}>
              <LinearGradient colors={btn.colors} style={sty.actBtnGrad}>
                <LinearGradient colors={btn.circleColors} style={sty.actBtnCircle}>
                  {btn.isMaterial
                    ? <MaterialIcons name={btn.icon as any} size={20} color="#fff" />
                    : <MaterialCommunityIcons name={btn.icon as any} size={20} color="#fff" />}
                </LinearGradient>
                <Text style={sty.actBtnLabel}>{btn.label}</Text>
                <Text style={sty.actBtnSub} numberOfLines={1}>{btn.sub}</Text>
              </LinearGradient>
            </Pressable>
          ))}
        </View>

        {/* ── Reward rates ─────────────────────────────────────────────────── */}
        <View style={sty.rateCard}>
          <View style={sty.rateHeader}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={sty.rateHeaderIcon}>
              <MaterialCommunityIcons name="star-four-points" size={15} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={sty.rateTitle}>Tasas de Recompensa</Text>
              <Text style={sty.rateSub}>Gana BDAG creando contenido</Text>
            </View>
          </View>
          {([
            { icon: 'heart-outline' as const,   label: 'Por like',         rate: REWARD_RATES.like,           color: C.secondary },
            { icon: 'comment-outline' as const,  label: 'Por comentario',   rate: REWARD_RATES.comment,        color: C.primary },
            { icon: 'gift-outline' as const,     label: 'Regalo Corazón',   rate: REWARD_RATES.gift_heart,     color: C.gold },
            { icon: 'star-outline' as const,     label: 'Regalo Estrella',  rate: REWARD_RATES.gift_star,      color: C.gold },
            { icon: 'diamond-outline' as const,  label: 'Regalo Diamante',  rate: REWARD_RATES.gift_diamond,   color: C.blue },
          ]).map(r => (
            <View key={r.label} style={sty.rateRow}>
              <MaterialCommunityIcons name={r.icon} size={14} color={r.color} />
              <Text style={sty.rateRowLabel}>{r.label}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[sty.rateRowVal, { color: r.color }]}>+{r.rate} BDAG</Text>
                <Text style={sty.rateRowUsd}>≈ ${bdagToUsd(r.rate).toFixed(3)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Transaction history ──────────────────────────────────────────── */}
        <View>
          <View style={sty.histHead}>
            <Text style={sty.histTitle}>Historial</Text>
            <Text style={sty.histCount}>{allHistory.length} movimientos</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sty.filterRow}>
            {FILTERS.map(f => (
              <Pressable key={f.key} style={[sty.filterPill, txFilter === f.key && sty.filterPillActive]}
                onPress={() => setTxFilter(f.key)}>
                <Text style={[sty.filterPillText, txFilter === f.key && sty.filterPillTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {isLoadingTx ? (
            <View style={sty.loadingBox}>
              <ActivityIndicator color={C.primary} size="small" />
              <Text style={sty.loadingText}>Cargando...</Text>
            </View>
          ) : allHistory.length === 0 ? (
            <View style={sty.emptyBox}>
              <MaterialCommunityIcons name="swap-horizontal-circle-outline" size={48} color="#1A1A30" />
              <Text style={sty.emptyTitle}>Sin movimientos</Text>
              <Text style={sty.emptySub}>Tus transacciones aparecerán aquí</Text>
            </View>
          ) : (
            <View style={sty.txList}>
              {allHistory.map(item => <TransactionRow key={item.id} item={item} activeChainId={chainId} />)}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ════════ DEPOSIT MODAL ══════════════════════════════════════════════ */}
      <Modal visible={modal === 'deposit'} transparent animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={depositStep === 'input' ? closeModal : undefined}>
        <Pressable style={sty.backdrop} onPress={depositStep === 'input' ? closeModal : undefined} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[sty.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={sty.sheetHandle} />
            <View style={sty.sheetTitleRow}>
              <LinearGradient colors={['#00E5A0', '#2D9EFF']} style={sty.sheetIconCircle}>
                <MaterialIcons name="arrow-downward" size={18} color="#fff" />
              </LinearGradient>
              <Text style={sty.sheetTitle}>{depositStepLabel[depositStep] ?? 'Depositar'}</Text>
            </View>

            {depositStep === 'awaiting_wallet' ? (
              <View style={sty.statusBox}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={sty.statusTitle}>Confirma en tu wallet</Text>
                <Text style={sty.statusSub}>MetaMask / Trust Wallet mostrará la solicitud.</Text>
              </View>
            ) : depositStep === 'verifying' ? (
              <View style={sty.statusBox}>
                <ActivityIndicator size="large" color={C.accent} />
                <Text style={sty.statusTitle}>Verificando en blockchain...</Text>
                {depositTxHash ? (
                  <Pressable onPress={() => chainId ? Linking.openURL(getExplorerTxUrl(depositTxHash, chainId)).catch(() => {}) : null}>
                    <Text style={sty.txLink}>Ver TX: {shortAddress(depositTxHash)} ↗</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : depositStep === 'done' ? (
              <View style={sty.statusBox}>
                <MaterialCommunityIcons name="check-circle" size={64} color={C.accent} />
                <Text style={sty.statusTitle}>Créditos BDAG acreditados</Text>
                {depositBdagPreview > 0
                  ? <Text style={sty.statusSub}>+{safeFmt(depositBdagPreview)} BDAG añadidos a tu balance</Text>
                  : null}
              </View>
            ) : (
              <>
                <Text style={sty.inputLabel}>Red</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {PRIMARY_NETWORKS.map(n => (
                    <Pressable key={n.key} style={[sty.netChip, depositNetwork === n.key && { borderColor: n.color, backgroundColor: n.color + '22' }]}
                      onPress={() => setDepositNetwork(n.key)}>
                      <MaterialCommunityIcons name={n.icon} size={14} color={depositNetwork === n.key ? n.color : C.textMuted} />
                      <Text style={[sty.netChipText, depositNetwork === n.key && { color: n.color, fontWeight: '700' }]}>{n.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={sty.inputLabel}>Token a depositar</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(['usdt', 'eth'] as DepositAsset[]).map(asset => (
                    <Pressable key={asset}
                      style={[sty.assetChip, depositAsset === asset && { borderColor: asset === 'usdt' ? C.usdt : C.eth, backgroundColor: (asset === 'usdt' ? C.usdt : C.eth) + '22' }]}
                      onPress={() => setDepositAsset(asset)}>
                      <MaterialCommunityIcons
                        name={asset === 'usdt' ? 'currency-usd' : 'ethereum'}
                        size={18} color={depositAsset === asset ? (asset === 'usdt' ? C.usdt : C.eth) : C.textMuted} />
                      <Text style={[sty.assetChipText, depositAsset === asset && { color: asset === 'usdt' ? C.usdt : C.eth, fontWeight: '700' }]}>
                        {asset === 'usdt' ? 'USDT' : depositNetworkConfig?.symbol ?? 'ETH'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={sty.inputLabel}>Monto ({assetSymbol})</Text>
                <TextInput style={sty.input} value={depositAmt} onChangeText={setDepositAmt}
                  placeholder="Ej: 10" placeholderTextColor="#333"
                  keyboardType="decimal-pad" />
                <View style={sty.quickRow}>
                  {(depositAsset === 'usdt' ? ['1', '5', '10', '50'] : ['0.001', '0.005', '0.01', '0.05']).map(v => (
                    <Pressable key={v} style={sty.quickPill} onPress={() => setDepositAmt(v)}>
                      <Text style={sty.quickPillText}>{v}</Text>
                    </Pressable>
                  ))}
                </View>

                {depositBdagPreview > 0 ? (
                  <View style={sty.conversionBox}>
                    <View style={sty.conversionRow}>
                      <MaterialCommunityIcons name={depositAsset === 'usdt' ? 'currency-usd' : 'ethereum'} size={16} color={depositAsset === 'usdt' ? C.usdt : C.eth} />
                      <Text style={sty.conversionFrom}>{depositAmt} {assetSymbol}</Text>
                      <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                      <MaterialCommunityIcons name="hexagon-outline" size={16} color={C.primary} />
                      <Text style={sty.conversionTo}>~{safeFmt(depositBdagPreview)} BDAG</Text>
                    </View>
                    <Text style={sty.conversionRate}>
                      {depositAsset === 'usdt'
                        ? `Estimado · 1 USDT = ${USD_TO_BDAG_RATE} BDAG`
                        : `Estimado · ETH/USD ~$${ethPrice.toLocaleString()} · monto final calculado por el servidor`}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  style={[sty.primaryBtn, (!parseFloat(depositAmt) || isSendingTx) && sty.primaryBtnDisabled]}
                  onPress={handleDeposit} disabled={!parseFloat(depositAmt) || isSendingTx}>
                  <LinearGradient colors={['#00E5A0', '#2D9EFF']} style={sty.primaryBtnGrad}>
                    {isSendingTx ? <ActivityIndicator color="#fff" size="small" />
                      : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
                    <Text style={sty.primaryBtnText}>
                      {isSendingTx ? 'Esperando confirmación...'
                        : depositBdagPreview > 0
                          ? `Depositar ${depositAmt} ${assetSymbol} (~${safeFmt(depositBdagPreview)} BDAG)`
                          : 'Depositar'}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Pressable style={sty.ghostBtn} onPress={closeModal}>
                  <Text style={sty.ghostBtnText}>Cancelar</Text>
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════ WITHDRAW MODAL ══════════════════════════════════════════════ */}
      <Modal visible={modal === 'withdraw'} transparent animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={closeModal}>
        <Pressable style={sty.backdrop} onPress={closeModal} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={sty.sheet}
            contentContainerStyle={{ gap: 14, padding: Spacing.lg, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={sty.sheetHandle} />
            <View style={sty.sheetTitleRow}>
              <LinearGradient colors={['#FF2D78', '#B44FFF']} style={sty.sheetIconCircle}>
                <MaterialIcons name="arrow-upward" size={18} color="#fff" />
              </LinearGradient>
              <Text style={sty.sheetTitle}>Retirar BDAG</Text>
            </View>

            <View style={sty.availBox}>
              <Text style={sty.availLabel}>Saldo disponible</Text>
              <Text style={sty.availVal}>{safeFmt(balance)} BDAG</Text>
              <Text style={sty.availUsd}>≈ ${safeFmt(bdagToUsd(balance))}</Text>
            </View>

            <Text style={sty.inputLabel}>Recibir como</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['usdt', 'eth'] as DepositAsset[]).map(asset => (
                <Pressable key={asset}
                  style={[sty.assetChip, { flex: 1 }, withdrawAsset === asset && { borderColor: asset === 'usdt' ? C.usdt : C.eth, backgroundColor: (asset === 'usdt' ? C.usdt : C.eth) + '22' }]}
                  onPress={() => setWithdrawAsset(asset)}>
                  <MaterialCommunityIcons
                    name={asset === 'usdt' ? 'currency-usd' : 'ethereum'}
                    size={18} color={withdrawAsset === asset ? (asset === 'usdt' ? C.usdt : C.eth) : C.textMuted} />
                  <Text style={[sty.assetChipText, withdrawAsset === asset && { color: asset === 'usdt' ? C.usdt : C.eth, fontWeight: '700' }]}>
                    {asset.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={sty.inputLabel}>Monto a retirar (BDAG)</Text>
            <TextInput style={sty.input} value={withdrawAmt} onChangeText={setWithdrawAmt}
              placeholder={`Min. ${MIN_WITHDRAWAL_AMOUNT} BDAG`} placeholderTextColor="#333"
              keyboardType="decimal-pad" editable={!isWithdrawing && !withdrawOk} />
            <View style={sty.quickRow}>
              {([100, 250, 500, 1000] as const).map(v => (
                <Pressable key={v} style={sty.quickPill} onPress={() => setWithdrawAmt(String(Math.min(v, balance)))}>
                  <Text style={sty.quickPillText}>{v}</Text>
                </Pressable>
              ))}
              <Pressable style={[sty.quickPill, { borderColor: C.primary + '55', backgroundColor: 'rgba(124,92,255,0.12)' }]}
                onPress={() => setWithdrawAmt(String(Math.floor(balance * 100) / 100))}>
                <Text style={[sty.quickPillText, { color: C.primary }]}>MAX</Text>
              </Pressable>
            </View>

            <Text style={sty.inputLabel}>Wallet destino (EVM)</Text>
            <TextInput style={sty.input}
              value={withdrawAddr || walletAddress || savedWallet || ''}
              onChangeText={setWithdrawAddr}
              placeholder="0x..." placeholderTextColor="#333"
              autoCapitalize="none" autoCorrect={false}
              editable={!isWithdrawing && !withdrawOk} />
            {isConnected && walletAddress && !withdrawAddr ? (
              <View style={[sty.banner, { borderColor: 'rgba(0,229,160,0.25)' }]}>
                <MaterialCommunityIcons name="check-circle-outline" size={14} color={C.accent} />
                <Text style={[sty.bannerText, { color: C.accent }]}>
                  Se enviará a tu wallet: {shortAddress(walletAddress)}
                </Text>
              </View>
            ) : null}

            {wNum > 0 ? (
              <View style={sty.feeBox}>
                <View style={sty.feeRow}><Text style={sty.feeLabel}>BDAG bruto</Text><Text style={sty.feeValue}>{safeFmt(wGross)} BDAG</Text></View>
                <View style={sty.feeRow}><Text style={sty.feeLabel}>Comisión ({WITHDRAWAL_FEE_PERCENT}%)</Text><Text style={[sty.feeValue, { color: C.secondary }]}>-{safeFmt(wFee)} BDAG</Text></View>
                <View style={[sty.feeRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6, marginTop: 2 }]}>
                  <Text style={[sty.feeLabel, { color: C.text, fontWeight: '700' }]}>BDAG neto</Text>
                  <Text style={[sty.feeValue, { color: C.accent }]}>{safeFmt(wNet)} BDAG</Text>
                </View>
                <View style={sty.conversionBox}>
                  <View style={sty.conversionRow}>
                    <MaterialCommunityIcons name="hexagon-outline" size={16} color={C.primary} />
                    <Text style={sty.conversionFrom}>{safeFmt(wNet)} BDAG</Text>
                    <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                    <MaterialCommunityIcons name={withdrawAsset === 'usdt' ? 'currency-usd' : 'ethereum'} size={16} color={withdrawAsset === 'usdt' ? C.usdt : C.eth} />
                    <Text style={sty.conversionTo}>{safeFmt(wAsset, 4)} {withdrawAsset.toUpperCase()}</Text>
                  </View>
                  <Text style={sty.conversionRate}>≈ ${safeFmt(wUsd)} USD</Text>
                </View>
              </View>
            ) : null}

            <Pressable
              style={[sty.primaryBtn, (isWithdrawing || withdrawOk || balance < MIN_WITHDRAWAL_AMOUNT) && sty.primaryBtnDisabled]}
              onPress={handleWithdraw} disabled={isWithdrawing || withdrawOk || balance < MIN_WITHDRAWAL_AMOUNT}>
              <LinearGradient colors={withdrawOk ? ['#00C87A', '#00C87A'] : ['#FF2D78', '#B44FFF']} style={sty.primaryBtnGrad}>
                {withdrawOk
                  ? <><MaterialIcons name="check-circle" size={18} color="#fff" /><Text style={sty.primaryBtnText}>Completado</Text></>
                  : isWithdrawing
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={sty.primaryBtnText}>Procesando...</Text></>
                    : <><MaterialIcons name="arrow-upward" size={18} color="#fff" />
                        <Text style={sty.primaryBtnText}>
                          {wNum > 0 ? `Retirar → ${safeFmt(wAsset, 4)} ${withdrawAsset.toUpperCase()}` : 'Retirar BDAG'}
                        </Text></>}
              </LinearGradient>
            </Pressable>
            <Pressable style={sty.ghostBtn} onPress={closeModal}>
              <Text style={sty.ghostBtnText}>Cancelar</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════ TRANSFER MODAL ══════════════════════════════════════════════ */}
      <Modal visible={modal === 'transfer'} transparent animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={closeModal}>
        <Pressable style={sty.backdrop} onPress={closeModal} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ justifyContent: 'flex-end' }}>
          <View style={[sty.sheet, { paddingBottom: insets.bottom + 24, maxHeight: '92%' }]}>
            <View style={sty.sheetHandle} />
            <View style={sty.sheetTitleRow}>
              <LinearGradient colors={['#FF9D00', '#FF5A00']} style={sty.sheetIconCircle}>
                <MaterialCommunityIcons name="swap-horizontal" size={18} color="#fff" />
              </LinearGradient>
              <Text style={sty.sheetTitle}>Transferir BDAG</Text>
            </View>

            {transferDone ? (
              <View style={sty.statusBox}>
                <LinearGradient colors={['#FF9D00', '#FF5A00']} style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="check-circle-outline" size={38} color="#fff" />
                </LinearGradient>
                <Text style={sty.statusTitle}>Transferencia completada</Text>
                <Text style={sty.statusSub}>{transferDoneMsg}</Text>
                <View style={[sty.banner, { marginTop: 8, borderColor: 'rgba(0,229,160,0.3)' }]}>
                  <MaterialCommunityIcons name="information-outline" size={14} color={C.accent} />
                  <Text style={[sty.bannerText, { color: C.accent }]}>Sin gas · Instantáneo · Solo en plataforma</Text>
                </View>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 14 }}>

                {/* Balance display */}
                <View style={sty.availBox}>
                  <Text style={sty.availLabel}>Saldo disponible</Text>
                  <Text style={sty.availVal}>{safeFmt(balance)} BDAG</Text>
                  <Text style={sty.availUsd}>≈ ${safeFmt(bdagToUsd(balance))}</Text>
                </View>

                {/* Zero fees info */}
                <View style={[sty.banner, { borderColor: 'rgba(0,229,160,0.20)', backgroundColor: 'rgba(0,229,160,0.04)' }]}>
                  <MaterialCommunityIcons name="lightning-bolt" size={14} color={C.accent} />
                  <Text style={[sty.bannerText, { color: C.accent }]}>
                    Transferencia interna · Sin gas · Sin comisión · Instantánea
                  </Text>
                </View>

                {/* Recipient search */}
                <Text style={sty.inputLabel}>Destinatario</Text>
                {selectedRecipient ? (
                  <View style={sty.recipientSelected}>
                    {selectedRecipient.avatar_url ? (
                      <Image source={{ uri: selectedRecipient.avatar_url }} style={sty.recipientAvatar} contentFit="cover" />
                    ) : (
                      <View style={[sty.recipientAvatar, { backgroundColor: C.primary + '33', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: C.primary, fontSize: 16, fontWeight: '700' }}>
                          {(selectedRecipient.display_name || selectedRecipient.username || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={sty.recipientName}>{selectedRecipient.display_name || selectedRecipient.username}</Text>
                      <Text style={sty.recipientUser}>@{selectedRecipient.username}</Text>
                    </View>
                    <Pressable onPress={() => { setSelectedRecipient(null); setTransferQuery(''); setSearchResults([]); }}
                      style={sty.recipientClear} hitSlop={8}>
                      <MaterialIcons name="close" size={16} color={C.textSub} />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={sty.input}
                      value={transferQuery}
                      onChangeText={setTransferQuery}
                      placeholder="Buscar por usuario o email..."
                      placeholderTextColor="#333"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {transferSearching ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                        <ActivityIndicator size="small" color={C.primary} />
                        <Text style={{ color: C.textMuted, fontSize: 12 }}>Buscando...</Text>
                      </View>
                    ) : searchResults.length > 0 ? (
                      <View style={sty.searchResults}>
                        {searchResults.map(u => (
                          <Pressable key={u.id} style={sty.searchResultItem}
                            onPress={() => { setSelectedRecipient(u); setTransferQuery(''); setSearchResults([]); }}>
                            {u.avatar_url ? (
                              <Image source={{ uri: u.avatar_url }} style={sty.searchResultAvatar} contentFit="cover" />
                            ) : (
                              <View style={[sty.searchResultAvatar, { backgroundColor: C.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                                <Text style={{ color: C.primary, fontSize: 14, fontWeight: '700' }}>
                                  {(u.display_name || u.username || '?')[0].toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={sty.searchResultName}>{u.display_name || u.username}</Text>
                              <Text style={sty.searchResultUser}>@{u.username}</Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={18} color={C.textMuted} />
                          </Pressable>
                        ))}
                      </View>
                    ) : transferQuery.length >= 2 && !transferSearching ? (
                      <Text style={{ color: C.textMuted, fontSize: 12, paddingTop: 4 }}>No se encontró ningún usuario</Text>
                    ) : null}
                  </>
                )}

                {/* Amount */}
                <Text style={sty.inputLabel}>Monto (BDAG)</Text>
                <TextInput
                  style={sty.input}
                  value={transferAmount}
                  onChangeText={setTransferAmount}
                  placeholder="Ej: 50"
                  placeholderTextColor="#333"
                  keyboardType="decimal-pad"
                />
                <View style={sty.quickRow}>
                  {([10, 50, 100, 500] as const).map(v => (
                    <Pressable key={v} style={sty.quickPill}
                      onPress={() => setTransferAmount(String(Math.min(v, Math.floor(balance * 100) / 100)))}>
                      <Text style={sty.quickPillText}>{v}</Text>
                    </Pressable>
                  ))}
                  <Pressable style={[sty.quickPill, { borderColor: C.transfer + '55', backgroundColor: 'rgba(255,157,0,0.10)' }]}
                    onPress={() => setTransferAmount(String(Math.floor(balance * 100) / 100))}>
                    <Text style={[sty.quickPillText, { color: C.transfer }]}>MAX</Text>
                  </Pressable>
                </View>

                {/* USD preview */}
                {transferAmt > 0 ? (
                  <View style={[sty.conversionBox, { borderColor: 'rgba(255,157,0,0.25)', backgroundColor: 'rgba(255,157,0,0.06)' }]}>
                    <View style={sty.conversionRow}>
                      <MaterialCommunityIcons name="hexagon-outline" size={16} color={C.transfer} />
                      <Text style={[sty.conversionFrom, { color: C.transfer }]}>{safeFmt(transferAmt)} BDAG</Text>
                      <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                      <MaterialCommunityIcons name="currency-usd" size={16} color={C.accent} />
                      <Text style={[sty.conversionTo, { color: C.accent }]}>≈ ${safeFmt(transferUsd)}</Text>
                    </View>
                    <Text style={sty.conversionRate}>Sin comisión · Acreditado instantáneamente</Text>
                  </View>
                ) : null}

                {/* Note */}
                <Text style={sty.inputLabel}>Nota (opcional)</Text>
                <TextInput
                  style={sty.input}
                  value={transferNote}
                  onChangeText={setTransferNote}
                  placeholder="Ej: Gracias por el stream!"
                  placeholderTextColor="#333"
                  maxLength={200}
                />

                <Pressable
                  style={[sty.primaryBtn, (!selectedRecipient || transferAmt <= 0 || transferring) && sty.primaryBtnDisabled]}
                  onPress={handleTransfer}
                  disabled={!selectedRecipient || transferAmt <= 0 || transferring}>
                  <LinearGradient colors={['#FF9D00', '#FF5A00']} style={sty.primaryBtnGrad}>
                    {transferring
                      ? <><ActivityIndicator color="#fff" size="small" /><Text style={sty.primaryBtnText}>Transfiriendo...</Text></>
                      : <><MaterialCommunityIcons name="swap-horizontal" size={18} color="#fff" />
                          <Text style={sty.primaryBtnText}>
                            {selectedRecipient && transferAmt > 0
                              ? `Enviar ${safeFmt(transferAmt)} BDAG a @${selectedRecipient.username}`
                              : 'Transferir BDAG'}
                          </Text></>}
                  </LinearGradient>
                </Pressable>
                <Pressable style={sty.ghostBtn} onPress={closeModal}>
                  <Text style={sty.ghostBtnText}>Cancelar</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════ INFO MODAL ══════════════════════════════════════════════════ */}
      <Modal visible={modal === 'info'} transparent animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={closeModal}>
        <Pressable style={sty.backdrop} onPress={closeModal} />
        <View style={[sty.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={sty.sheetHandle} />
          <View style={sty.sheetTitleRow}>
            <LinearGradient colors={['#7C5CFF', '#2D9EFF']} style={sty.sheetIconCircle}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#fff" />
            </LinearGradient>
            <Text style={sty.sheetTitle}>Economía BDAG</Text>
          </View>

          <View style={sty.infoSection}>
            <Text style={sty.infoSectionTitle}>Tasas de conversión</Text>
            {[
              { from: '1 USDT', to: `${USD_TO_BDAG_RATE} BDAG`, note: 'USDT = USD (1:1)' },
              { from: '1 ETH',  to: `${(ethPrice * USD_TO_BDAG_RATE).toLocaleString()} BDAG`, note: `Precio ETH: $${ethPrice.toLocaleString()}` },
              { from: '100 BDAG', to: '$1.00 USD', note: 'Tasa fija de retiro' },
            ].map(r => (
              <View key={r.from} style={sty.infoRow}>
                <Text style={sty.infoFrom}>{r.from}</Text>
                <MaterialCommunityIcons name="arrow-right" size={14} color={C.textMuted} />
                <Text style={sty.infoTo}>{r.to}</Text>
                <Text style={sty.infoNote}>{r.note}</Text>
              </View>
            ))}
          </View>

          <View style={sty.infoSection}>
            <Text style={sty.infoSectionTitle}>Arquitectura del sistema</Text>
            {[
              { icon: 'link-variant' as const,       color: C.eth,      label: 'Capa A: Blockchain',    desc: 'Ethereum, Base, USDT — depósitos y retiros reales' },
              { icon: 'hexagon-outline' as const,     color: C.primary,  label: 'Capa B: Economía BDAG', desc: 'Balance interno, recompensas, regalos, transferencias' },
              { icon: 'swap-horizontal' as const,     color: C.transfer, label: 'Transferencias',        desc: 'Sin gas · Sin comisión · Instantáneas entre usuarios' },
            ].map(l => (
              <View key={l.label} style={sty.infoLayerRow}>
                <View style={[sty.infoLayerIcon, { backgroundColor: l.color + '22' }]}>
                  <MaterialCommunityIcons name={l.icon} size={18} color={l.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sty.infoLayerLabel}>{l.label}</Text>
                  <Text style={sty.infoLayerDesc}>{l.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable style={sty.ghostBtn} onPress={closeModal}>
            <Text style={sty.ghostBtnText}>Cerrar</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function WalletScreen() {
  return (
    <WalletErrorBoundary>
      <WalletScreenInner />
    </WalletErrorBoundary>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sty = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 14 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 11, color: C.textMuted, marginTop: 2 },
  refreshBtn:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceUp, borderWidth: 1, borderColor: C.border },

  sectionLabel: { color: C.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },

  connectCard:        { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,92,255,0.22)' },
  connectCardInner:   { padding: 24, gap: 16, alignItems: 'center' },
  connectIconCircle:  { marginBottom: 4 },
  connectTitle:       { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  connectSub:         { color: C.textSub, fontSize: 13, textAlign: 'center', lineHeight: 20 },

  ratePreviewBox:  { width: '100%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  ratePreviewRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratePreviewText: { flex: 1, color: C.textSub, fontSize: 13 },
  ratePreviewVal:  { fontSize: 13, fontWeight: '700' },

  networkChips:    { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  networkChip:     { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.04)' },
  networkChipText: { fontSize: 11, fontWeight: '600' },
  walletLogos:     { flexDirection: 'row', gap: 20 },
  walletLogo:      { alignItems: 'center', gap: 6 },
  walletLogoCircle:{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  walletLogoName:  { color: C.textSub, fontSize: 10 },
  connectBtn:      { width: '100%', borderRadius: 16, overflow: 'hidden' },
  connectBtnGrad:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  connectBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },

  connectedBanner:      { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,229,160,0.22)' },
  connectedBannerInner: { padding: 14 },
  connectedLeft:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  connectedDot:         { width: 10, height: 10, borderRadius: 5 },
  connectedLabel:       { color: 'rgba(0,229,160,0.60)', fontSize: 10, fontWeight: '600' },
  connectedAddr:        { color: C.accent, fontSize: 13, fontWeight: '700', marginTop: 2 },
  connectedActions:     { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  addrBtn:              { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },

  netChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.surfaceUp },
  netChipText: { color: C.textMuted, fontSize: 12, fontWeight: '500' },
  netChipDot:  { width: 6, height: 6, borderRadius: 3, marginLeft: 2 },

  balCard:      { borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: 'rgba(124,92,255,0.18)' },
  balLabel:     { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '600', letterSpacing: 0.9, textTransform: 'uppercase' },
  balAmt:       { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: -1.5, marginTop: 4 },
  balUsd:       { color: C.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  bdagBadge:    { alignSelf: 'flex-start', backgroundColor: 'rgba(124,92,255,0.22)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(124,92,255,0.35)', marginTop: 4 },
  bdagBadgeText:{ color: '#A080FF', fontSize: 12, fontWeight: '600' },

  onChainSection:      { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 12, gap: 8 },
  onChainRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onChainSectionLabel: { flex: 1, color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  tokenRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tokenIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tokenName: { flex: 1, color: C.textSub, fontSize: 13 },
  tokenBal:  { color: '#fff', fontSize: 13, fontWeight: '600' },
  tokenUsd:  { color: C.textMuted, fontSize: 10 },

  balDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  statsRow:   { flexDirection: 'row', alignItems: 'center' },
  stat:       { flex: 1, alignItems: 'center', gap: 2 },
  statDiv:    { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.06)' },
  statLabel:  { color: 'rgba(255,255,255,0.30)', fontSize: 10 },
  statVal:    { fontSize: 12, fontWeight: '700' },
  statUsd:    { color: C.textMuted, fontSize: 9 },

  banner:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(0,229,160,0.06)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(0,229,160,0.20)' },
  bannerText: { flex: 1, color: C.accent, fontSize: 12, lineHeight: 17 },
  errRetry:   { color: C.blue, fontSize: 11, fontWeight: '600' },

  // 3-button action grid
  actGrid:    { flexDirection: 'row', gap: 10 },
  actBtn3:    { flex: 1, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  actBtnGrad: { padding: 14, gap: 7, alignItems: 'flex-start' },
  actBtnCircle:{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  actBtnLabel: { color: C.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
  actBtnSub:   { color: C.textMuted, fontSize: 10 },

  rateCard:      { backgroundColor: C.surfaceUp, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  rateHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  rateHeaderIcon:{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rateTitle:     { color: C.text, fontSize: 15, fontWeight: '700' },
  rateSub:       { color: C.textMuted, fontSize: 11 },
  rateRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.borderSub },
  rateRowLabel:  { flex: 1, color: C.textSub, fontSize: 13 },
  rateRowVal:    { fontSize: 13, fontWeight: '700' },
  rateRowUsd:    { color: C.textMuted, fontSize: 10 },

  histHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  histTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  histCount: { color: C.textMuted, fontSize: 12 },
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2, marginBottom: 10 },
  filterPill:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surfaceUp, borderWidth: 1, borderColor: C.border },
  filterPillActive:     { backgroundColor: C.primary, borderColor: C.primary },
  filterPillText:       { color: C.textMuted, fontSize: 12, fontWeight: '500' },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },
  loadingBox:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 36 },
  loadingText: { color: C.textMuted, fontSize: 13 },
  emptyBox:    { alignItems: 'center', paddingVertical: 44, gap: 8 },
  emptyTitle:  { color: C.textSub, fontSize: 16, fontWeight: '600' },
  emptySub:    { color: C.textMuted, fontSize: 12 },
  txList:      { gap: 8 },

  txRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.surfaceUp, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: C.border },
  txIcon:   { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  txBody:   { flex: 1, gap: 4 },
  txTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  txLabel:  { color: C.text, fontSize: 13, fontWeight: '600' },
  txAmt:    { fontSize: 13, fontWeight: '700' },
  txUsdEq:  { color: C.textMuted, fontSize: 10 },
  txBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  txDesc:   { flex: 1, color: C.textMuted, fontSize: 11 },
  txMeta:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  txTime:   { color: C.textMuted, fontSize: 11 },
  statusPill:  { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  statusText:  { fontSize: 10, fontWeight: '700' },
  txLink:   { color: C.blue, fontSize: 11 },

  backdrop:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:           { backgroundColor: C.surfaceUp, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md },
  sheetHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 4 },
  sheetTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sheetTitle:      { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },

  statusBox:   { alignItems: 'center', paddingVertical: 32, gap: 14 },
  statusTitle: { color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  statusSub:   { color: C.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },

  assetChip:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, backgroundColor: C.surface },
  assetChipText: { color: C.textMuted, fontSize: 14, fontWeight: '600' },

  conversionBox:  { backgroundColor: 'rgba(124,92,255,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(124,92,255,0.20)' },
  conversionRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conversionFrom: { color: C.textSub, fontSize: 14, fontWeight: '600' },
  conversionTo:   { color: C.primary, fontSize: 14, fontWeight: '700' },
  conversionRate: { color: C.textMuted, fontSize: 11, marginTop: 4 },

  availBox:   { backgroundColor: C.surface, borderRadius: 14, padding: 14, gap: 3, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  availLabel: { color: C.textMuted, fontSize: 12 },
  availVal:   { color: C.accent, fontSize: 28, fontWeight: '800' },
  availUsd:   { color: C.textMuted, fontSize: 13 },
  feeBox:     { backgroundColor: C.surface, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: C.border },
  feeRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeLabel:   { color: C.textSub, fontSize: 13 },
  feeValue:   { color: C.text, fontSize: 13, fontWeight: '600' },

  inputLabel: { color: C.textSub, fontSize: 13, fontWeight: '500' },
  input:      { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: C.text, fontSize: 15 },
  quickRow:   { flexDirection: 'row', gap: 8 },
  quickPill:  { flex: 1, alignItems: 'center', paddingVertical: 9, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  quickPillText: { color: C.textSub, fontSize: 13, fontWeight: '600' },

  primaryBtn:         { borderRadius: 14, overflow: 'hidden' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnGrad:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  primaryBtnText:     { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghostBtn:           { alignItems: 'center', paddingVertical: 14, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  ghostBtnText:       { color: C.textSub, fontSize: 14, fontWeight: '600' },

  // Transfer — recipient
  recipientSelected: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,157,0,0.30)' },
  recipientAvatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface },
  recipientName:     { color: C.text, fontSize: 14, fontWeight: '700' },
  recipientUser:     { color: C.transfer, fontSize: 12 },
  recipientClear:    { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },

  searchResults:      { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  searchResultItem:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.borderSub },
  searchResultAvatar: { width: 38, height: 38, borderRadius: 19 },
  searchResultName:   { color: C.text, fontSize: 13, fontWeight: '600' },
  searchResultUser:   { color: C.textMuted, fontSize: 11 },

  // Info modal
  infoSection:      { gap: 8 },
  infoSectionTitle: { color: C.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  infoRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surface, borderRadius: 10, padding: 10 },
  infoFrom:         { color: C.textSub, fontSize: 13, fontWeight: '600', width: 60 },
  infoTo:           { color: C.primary, fontSize: 13, fontWeight: '700', flex: 1 },
  infoNote:         { color: C.textMuted, fontSize: 10 },
  infoLayerRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.surface, borderRadius: 12, padding: 12 },
  infoLayerIcon:    { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  infoLayerLabel:   { color: C.text, fontSize: 13, fontWeight: '700' },
  infoLayerDesc:    { color: C.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },

  pendingRow:   { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,184,0,0.06)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  pendingLabel: { flex: 1, color: C.warning, fontSize: 12 },
  pendingVal:   { color: C.warning, fontSize: 12, fontWeight: '600' },
  cancelBtn:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5 },
  cancelBtnText: { color: C.secondary, fontSize: 11, fontWeight: '600' },
  txErr:    { color: C.error, fontSize: 10, lineHeight: 14 },
});
