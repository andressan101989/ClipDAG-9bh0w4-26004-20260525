import React, { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { MarketplaceSettlementError, reportMarketplaceOrderProblem } from '@/services/marketplaceSettlementService';
import type { MarketplaceDisputeOutcome, MarketplaceDisputeStatus } from '@/services/marketplaceFulfillmentService';

type Reason = 'not_received' | 'damaged' | 'incorrect_item' | 'missing_items' | 'other';
const reasons: { code: Reason; label: string }[] = [
  { code: 'not_received', label: 'No recibí el pedido' },
  { code: 'damaged', label: 'Producto dañado' },
  { code: 'incorrect_item', label: 'Producto incorrecto' },
  { code: 'missing_items', label: 'Faltan artículos' },
  { code: 'other', label: 'Otro problema' },
];
const statusLabels: Record<MarketplaceDisputeStatus, string> = {
  open: 'Abierta', under_review: 'En revisión', resolved: 'Resuelta', rejected: 'Rechazada', cancelled: 'Cancelada',
};
const outcomeLabels: Record<MarketplaceDisputeOutcome, string> = {
  refund_buyer: 'Reembolso completado', release_seller: 'Fondos liberados al vendedor',
  reject_claim: 'Reclamo rechazado',
};

export function MarketplaceDisputePanel({ orderId, current, onSubmitted }: {
  orderId: string;
  current: { status: MarketplaceDisputeStatus; reasonCode: string; outcome?: MarketplaceDisputeOutcome | null } | null;
  onSubmitted: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<Reason>('not_received');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(randomUUID());
  const submit = () => {
    if (reason === 'other' && note.trim().length < 3) {
      Alert.alert('Describe el problema', 'Agrega una breve explicación para continuar.');
      return;
    }
    Alert.alert('Reportar problema', 'El pago permanecerá retenido mientras soporte revisa el caso.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Enviar reporte', onPress: async () => {
        if (busy) return;
        setBusy(true);
        try {
          await reportMarketplaceOrderProblem(orderId, reason, note, key.current);
          await onSubmitted();
          setExpanded(false);
        } catch (error) {
          const code = error instanceof MarketplaceSettlementError ? error.code : 'marketplace_settlement_unknown';
          const message = code === 'marketplace_dispute_settlement_completed'
            ? 'Este pedido ya fue liquidado. Contacta a soporte para revisar el caso.'
            : code === 'marketplace_dispute_order_state_conflict'
              ? 'Este pedido todavía no admite reportes.'
              : 'No pudimos enviar el reporte. No se realizaron movimientos de fondos.';
          Alert.alert('No se pudo reportar', message);
        } finally { setBusy(false); }
      } },
    ]);
  };
  if (current) return <View style={styles.card}><Text style={styles.title}>Problema reportado · {current.outcome ? outcomeLabels[current.outcome] : statusLabels[current.status]}</Text><Text style={styles.help}>{current.status === 'open' || current.status === 'under_review' ? 'Los fondos permanecen pausados mientras soporte revisa el caso.' : current.outcome === 'release_seller' ? 'Soporte resolvió el caso y liberó los fondos al vendedor.' : 'Soporte completó la revisión del caso.'}</Text></View>;
  if (!expanded) return <Pressable style={styles.outline} onPress={() => setExpanded(true)} accessibilityRole="button"><Text style={styles.buttonText}>Reportar problema</Text></Pressable>;
  return <View style={styles.card}>
    <Text style={styles.title}>Reportar problema</Text>
    {reasons.map(item => <Pressable key={item.code} style={[styles.reason, reason === item.code && styles.selected]} onPress={() => setReason(item.code)} accessibilityRole="radio" accessibilityState={{ checked: reason === item.code }}><Text style={styles.text}>{item.label}</Text></Pressable>)}
    <TextInput style={styles.input} value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Nota para soporte" placeholderTextColor={Colors.textSubtle} accessibilityLabel="Descripción del problema" />
    <Pressable style={styles.button} disabled={busy} onPress={submit} accessibilityRole="button" accessibilityState={{ disabled: busy }}><Text style={styles.buttonText}>{busy ? 'Enviando…' : 'Revisar y enviar'}</Text></Pressable>
    <Pressable style={styles.outline} disabled={busy} onPress={() => setExpanded(false)}><Text style={styles.buttonText}>Cancelar</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: 10 },
  title: { color: Colors.textPrimary, fontWeight: '800' }, text: { color: Colors.textPrimary }, help: { color: Colors.textSecondary },
  reason: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 12 },
  selected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  input: { minHeight: 96, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, color: Colors.textPrimary, padding: 12, textAlignVertical: 'top' },
  button: { minHeight: 48, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  outline: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: Colors.textPrimary, fontWeight: '800' },
});
