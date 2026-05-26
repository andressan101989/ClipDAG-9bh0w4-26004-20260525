/**
 * components/wallet/TransactionRow.tsx
 * Single transaction history row for the Wallet screen.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Linking } from 'react-native';
import { getExplorerTxUrl, shortAddress } from '@/services/multiChainService';
import { bdagToUsd } from '@/services/conversionEngine';

const C = {
  surface:   '#161628',
  border:    '#1C1C38',
  text:      '#FFFFFF',
  textSub:   '#8888AA',
  textMuted: '#44445A',
  primary:   '#7C5CFF',
  secondary: '#FF2D78',
  accent:    '#00E5A0',
  blue:      '#2D9EFF',
  warning:   '#FFB800',
  error:     '#FF6B6B',
  gold:      '#FFD700',
  transfer:  '#FF9D00',
};

function txColor(type: string, status: string): string {
  if (status === 'failed' || status === 'canceled') return C.textMuted;
  switch (type) {
    case 'reward':            return C.accent;
    case 'tip':               return C.primary;
    case 'gift':              return C.gold;
    case 'deposit':           return C.blue;
    case 'withdraw':          return C.secondary;
    case 'transfer_sent':     return C.transfer;
    case 'transfer_received': return C.accent;
    default: return '#888';
  }
}

function txIcon(type: string): string {
  switch (type) {
    case 'reward':            return 'star';
    case 'tip':               return 'card-giftcard';
    case 'gift':              return 'redeem';
    case 'deposit':           return 'arrow-downward';
    case 'withdraw':          return 'arrow-upward';
    case 'transfer_sent':     return 'send';
    case 'transfer_received': return 'call-received';
    default: return 'swap-horiz';
  }
}

function txLabel(type: string): string {
  const m: Record<string, string> = {
    reward: 'Recompensa', tip: 'Propina', gift: 'Regalo',
    deposit: 'Depósito', withdraw: 'Retiro',
    transfer_sent: 'Enviado', transfer_received: 'Recibido',
  };
  return m[type] ?? type;
}

function statusColor(s: string): string {
  switch (s) {
    case 'completed':                           return C.accent;
    case 'pending': case 'queued': case 'processing': return C.warning;
    case 'failed': case 'canceled':             return C.error;
    default: return '#888';
  }
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    completed: 'OK', pending: 'Pend.', queued: 'En cola',
    processing: 'Proc.', failed: 'Fallido', canceled: 'Cancelado',
  };
  return m[s] ?? s;
}

function timeAgo(iso: string): string {
  try {
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60)    return 'Ahora';
    if (secs < 3600)  return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    return `${Math.floor(secs / 86400)}d`;
  } catch { return ''; }
}

function safeFmt(n: number | undefined | null, dec = 2): string {
  const v = Number(n ?? 0);
  return isNaN(v) ? '0.00' : v.toFixed(dec);
}

export interface TransactionItem {
  id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  txHash?: string;
  createdAt: string;
}

interface Props {
  item: TransactionItem;
  activeChainId?: number | null;
}

export function TransactionRow({ item, activeChainId }: Props) {
  const color = txColor(item.type, item.status);
  const sc    = statusColor(item.status);
  const sign  = (item.type === 'withdraw' || item.type === 'transfer_sent') ? '-' : '+';
  const usdEq = bdagToUsd(item.amount);

  return (
    <View style={s.row}>
      <View style={[s.icon, { backgroundColor: color + '1C' }]}>
        <MaterialIcons name={txIcon(item.type) as any} size={17} color={color} />
      </View>
      <View style={s.body}>
        <View style={s.top}>
          <Text style={s.label}>{txLabel(item.type)}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.amt, { color }]}>{sign}{safeFmt(item.amount)} BDAG</Text>
            <Text style={s.usd}>{sign}${safeFmt(usdEq)}</Text>
          </View>
        </View>
        <View style={s.bottom}>
          <Text style={s.desc} numberOfLines={1}>{item.description || ' '}</Text>
          <View style={s.meta}>
            <Text style={s.time}>{timeAgo(item.createdAt)}</Text>
            <View style={[s.pill, { backgroundColor: sc + '20' }]}>
              <Text style={[s.pillText, { color: sc }]}>{statusLabel(item.status)}</Text>
            </View>
          </View>
        </View>
        {item.txHash ? (
          <Pressable onPress={() => {
            const cid = activeChainId ?? 1;
            Linking.openURL(getExplorerTxUrl(item.txHash!, cid)).catch(() => {});
          }}>
            <Text style={s.link}>TX: {shortAddress(item.txHash)} ↗</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.surface, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: C.border },
  icon:    { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  body:    { flex: 1, gap: 4 },
  top:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  label:   { color: C.text, fontSize: 13, fontWeight: '600' },
  amt:     { fontSize: 13, fontWeight: '700' },
  usd:     { color: C.textMuted, fontSize: 10 },
  bottom:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  desc:    { flex: 1, color: C.textMuted, fontSize: 11 },
  meta:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time:    { color: C.textMuted, fontSize: 11 },
  pill:    { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  pillText:{ fontSize: 10, fontWeight: '700' },
  link:    { color: '#2D9EFF', fontSize: 11 },
});
