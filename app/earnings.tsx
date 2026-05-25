/**
 * app/earnings.tsx — Creator Earnings Dashboard
 *
 * Shows authoritative ledger-based earnings breakdown:
 *   - Total BDAG by source (content sales, subscriptions, gifts, premium DMs)
 *   - Immutable ledger audit trail
 *   - Withdrawal queue status
 *   - 'Retirar' action
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFinancialAccount } from '@/hooks/useFinancialAccount';
import { getCreatorEarningsApi } from '@/services/financialApi';
import { getSupabaseClient } from '@/template';

const C = {
  bg: '#07070F', surface: '#0F0F1E', surfaceUp: '#161628',
  border: '#1C1C38', text: '#FFFFFF', textSub: '#8888AA', textMuted: '#44445A',
  primary: '#7C5CFF', secondary: '#FF2D78', accent: '#00E5A0',
  blue: '#2D9EFF', gold: '#FFD700', warning: '#FFB800', error: '#FF6B6B',
};

function fmt(n: number, dec = 2) { return (isNaN(n) ? 0 : n).toFixed(dec); }

function timeAgo(iso: string): string {
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'Ahora';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  } catch { return ''; }
}

export default function EarningsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const account = useFinancialAccount();

  const [earnings, setEarnings] = useState({
    contentSales: 0, subscriptions: 0, premiumDms: 0, gifts: 0, total: 0,
  });
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loadingEarnings, setLoadingEarnings] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoadingEarnings(true);
    try {
      const [e, wds] = await Promise.all([
        getCreatorEarningsApi(user.id),
        getSupabaseClient()
          .from('withdrawal_requests')
          .select('id, status, bdag_amount, net_bdag, fee_bdag, to_address, tx_hash, failure_reason, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      setEarnings(e);
      setWithdrawals(wds.data ?? []);
    } finally {
      setLoadingEarnings(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const EARNING_SOURCES = [
    { key: 'contentSales',  label: 'Ventas de Contenido', icon: 'lock-outline'         as const, color: C.primary  },
    { key: 'subscriptions', label: 'Suscripciones',       icon: 'crown-outline'         as const, color: C.gold    },
    { key: 'premiumDms',    label: 'Premium DMs',          icon: 'message-badge-outline' as const, color: C.warning },
    { key: 'gifts',         label: 'Regalos y Propinas',  icon: 'gift-outline'          as const, color: C.secondary},
  ] as const;

  function statusColor(s: string) {
    switch (s) {
      case 'completed': return C.accent;
      case 'queued': case 'signing': case 'broadcasted': return C.warning;
      case 'failed': case 'cancelled': return C.error;
      default: return '#888';
    }
  }
  function statusLabel(s: string) {
    const m: Record<string, string> = {
      queued: 'En cola', signing: 'Firmando', broadcasted: 'Enviado',
      confirmed: 'Confirmado', completed: 'Completado', failed: 'Fallido', cancelled: 'Cancelado',
    };
    return m[s] ?? s;
  }

  return (
    <View style={[sty.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={sty.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={sty.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <View>
          <Text style={sty.title}>Ganancias</Text>
          <Text style={sty.subtitle}>BDAG acumulado como creador</Text>
        </View>
        <Pressable onPress={load} hitSlop={8} style={sty.refreshBtn}>
          {loadingEarnings
            ? <ActivityIndicator size="small" color={C.primary} />
            : <MaterialCommunityIcons name="refresh" size={20} color={C.textMuted} />}
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={[sty.scroll, { paddingBottom: 80 + insets.bottom }]}>

        {/* ── Total earnings hero ─────────────────────────────────────── */}
        <LinearGradient colors={['#1A0A3A', '#0B1430']} style={sty.heroCard}>
          <Text style={sty.heroLabel}>TOTAL GANADO (NETO)</Text>
          <Text style={sty.heroAmount}>{fmt(earnings.total)} BDAG</Text>
          <Text style={sty.heroUsd}>≈ ${fmt(earnings.total * 0.01)} USD</Text>

          <Pressable style={sty.withdrawCta} onPress={() => router.push('/(tabs)/wallet' as any)}>
            <LinearGradient colors={['#FF2D78', '#B44FFF']} style={sty.withdrawCtaGrad}>
              <MaterialIcons name="arrow-upward" size={16} color="#fff" />
              <Text style={sty.withdrawCtaText}>Retirar BDAG</Text>
            </LinearGradient>
          </Pressable>
        </LinearGradient>

        {/* ── Earnings breakdown ──────────────────────────────────────── */}
        <Text style={sty.sectionTitle}>Desglose por fuente</Text>
        <View style={sty.sourcesGrid}>
          {EARNING_SOURCES.map(s => {
            const val = earnings[s.key] as number;
            const pct = earnings.total > 0 ? (val / earnings.total) * 100 : 0;
            return (
              <View key={s.key} style={sty.sourceCard}>
                <LinearGradient colors={[s.color + '18', s.color + '08']} style={sty.sourceCardGrad}>
                  <View style={[sty.sourceIcon, { backgroundColor: s.color + '22' }]}>
                    <MaterialCommunityIcons name={s.icon} size={22} color={s.color} />
                  </View>
                  <Text style={sty.sourceLabel}>{s.label}</Text>
                  <Text style={[sty.sourceAmount, { color: s.color }]}>{fmt(val)} BDAG</Text>
                  <Text style={sty.sourceUsd}>≈ ${fmt(val * 0.01)}</Text>
                  {/* Progress bar */}
                  <View style={sty.progressBar}>
                    <View style={[sty.progressFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: s.color }]} />
                  </View>
                  <Text style={sty.sourcePct}>{pct.toFixed(0)}% del total</Text>
                </LinearGradient>
              </View>
            );
          })}
        </View>

        {/* ── Current balance ─────────────────────────────────────────── */}
        <View style={sty.balanceCard}>
          <MaterialCommunityIcons name="hexagon-outline" size={20} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={sty.balanceLabel}>Saldo disponible en billetera</Text>
            <Text style={sty.balanceAmount}>{fmt(account.balance)} BDAG</Text>
          </View>
          <Text style={sty.balanceUsd}>${fmt(account.balance * 0.01)}</Text>
        </View>

        {/* ── Ledger audit trail ──────────────────────────────────────── */}
        <Text style={sty.sectionTitle}>Registro de movimientos</Text>
        {account.historyLoading ? (
          <View style={sty.loadingBox}>
            <ActivityIndicator color={C.primary} size="small" />
            <Text style={sty.loadingText}>Cargando...</Text>
          </View>
        ) : account.ledgerEntries.length === 0 ? (
          <View style={sty.emptyBox}>
            <MaterialCommunityIcons name="chart-line-stacked" size={44} color="#1A1A30" />
            <Text style={sty.emptyText}>Sin movimientos registrados</Text>
          </View>
        ) : (
          <View style={sty.entryList}>
            {account.ledgerEntries.slice(0, 20).map(entry => {
              const isCredit = entry.entry_type === 'credit';
              const color    = isCredit ? C.accent : C.secondary;
              return (
                <View key={entry.id} style={sty.entryRow}>
                  <View style={[sty.entryDot, { backgroundColor: color + '30' }]}>
                    <MaterialCommunityIcons
                      name={isCredit ? 'arrow-down-circle' : 'arrow-up-circle'}
                      size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sty.entryDesc} numberOfLines={1}>
                      {entry.description || (isCredit ? 'Crédito' : 'Débito')}
                    </Text>
                    <Text style={sty.entryTime}>{timeAgo(entry.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[sty.entryAmt, { color }]}>
                      {isCredit ? '+' : '-'}{fmt(entry.amount)} BDAG
                    </Text>
                    <Text style={sty.entryBalance}>Saldo: {fmt(entry.balance_after)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Withdrawal queue ────────────────────────────────────────── */}
        {withdrawals.length > 0 ? (
          <>
            <Text style={sty.sectionTitle}>Retiros</Text>
            <View style={sty.entryList}>
              {withdrawals.map(wd => (
                <View key={wd.id} style={sty.wdRow}>
                  <View style={[sty.entryDot, { backgroundColor: C.warning + '20' }]}>
                    <MaterialIcons name="arrow-upward" size={16} color={C.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sty.entryDesc}>{fmt(wd.bdag_amount)} BDAG solicitados</Text>
                    {wd.tx_hash ? (
                      <Text style={sty.txHash} numberOfLines={1}>
                        TX: {wd.tx_hash.slice(0, 18)}...
                      </Text>
                    ) : null}
                    <Text style={sty.entryTime}>{timeAgo(wd.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[sty.statusPill, { backgroundColor: statusColor(wd.status) + '20' }]}>
                      <Text style={[sty.statusText, { color: statusColor(wd.status) }]}>
                        {statusLabel(wd.status)}
                      </Text>
                    </View>
                    <Text style={sty.entryBalance}>Neto: {fmt(wd.net_bdag)} BDAG</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const sty = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 16 },

  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surfaceUp, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surfaceUp, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  title:    { color: C.text, fontSize: 20, fontWeight: '700' },
  subtitle: { color: C.textMuted, fontSize: 12 },

  heroCard:   { borderRadius: 20, padding: 24, gap: 6, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)' },
  heroLabel:  { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  heroAmount: { color: C.text, fontSize: 42, fontWeight: '800' },
  heroUsd:    { color: C.accent, fontSize: 14 },

  withdrawCta:     { marginTop: 10, borderRadius: 14, overflow: 'hidden', width: '100%' },
  withdrawCtaGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  withdrawCtaText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  sourcesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sourceCard:  { width: '47.5%', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  sourceCardGrad: { padding: 14, gap: 6 },
  sourceIcon:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  sourceLabel: { color: C.textSub, fontSize: 11, fontWeight: '500' },
  sourceAmount:{ fontSize: 16, fontWeight: '700' },
  sourceUsd:   { color: C.textMuted, fontSize: 11 },
  progressBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 4 },
  progressFill:{ height: 3, borderRadius: 2 },
  sourcePct:   { color: C.textMuted, fontSize: 10 },

  balanceCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surfaceUp, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,229,160,0.25)' },
  balanceLabel:  { color: C.textMuted, fontSize: 11 },
  balanceAmount: { color: C.accent, fontSize: 20, fontWeight: '700' },
  balanceUsd:    { color: C.textSub, fontSize: 13 },

  loadingBox:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 32 },
  loadingText: { color: C.textMuted, fontSize: 13 },
  emptyBox:    { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText:   { color: C.textMuted, fontSize: 13 },

  entryList: { gap: 8 },
  entryRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.surfaceUp, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  wdRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.surfaceUp, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(255,184,0,0.20)' },
  entryDot:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  entryDesc: { color: C.text, fontSize: 12, fontWeight: '500' },
  entryTime: { color: C.textMuted, fontSize: 10, marginTop: 2 },
  txHash:    { color: C.blue, fontSize: 10 },
  entryAmt:  { fontSize: 12, fontWeight: '700' },
  entryBalance: { color: C.textMuted, fontSize: 10 },

  statusPill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
});
