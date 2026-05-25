import React, { useState } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { height: H } = Dimensions.get('window');

export interface GiftItem {
  type: string;
  emoji: string;
  label: string;
  dagValue: number;
  color: string;
}

export const GIFT_ITEMS: GiftItem[] = [
  { type: 'heart', emoji: '❤️', label: 'Corazon', dagValue: 0.1, color: '#FF2D55' },
  { type: 'star', emoji: '⭐', label: 'Estrella', dagValue: 0.5, color: '#FFD700' },
  { type: 'dag', emoji: '◈', label: 'DAG', dagValue: 1.0, color: '#00D4FF' },
  { type: 'rocket', emoji: '🚀', label: 'Rocket', dagValue: 2.0, color: '#8B5CF6' },
  { type: 'diamond', emoji: '💎', label: 'Diamante', dagValue: 5.0, color: '#00D4FF' },
  { type: 'crown', emoji: '👑', label: 'Corona', dagValue: 10.0, color: '#FFD700' },
];

interface GiftSheetProps {
  visible: boolean;
  recipientUsername: string;
  recipientId: string;
  videoId: string | null;
  currentDagBalance: number;
  onClose: () => void;
  onSend: (recipientId: string, videoId: string | null, giftType: string, dagValue: number) => Promise<{ success: boolean; error?: string }>;
}

export function GiftSheet({
  visible, recipientUsername, recipientId, videoId,
  currentDagBalance, onClose, onSend,
}: GiftSheetProps) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSend = async () => {
    if (!selected) return;
    setIsSending(true);
    setResult(null);
    const res = await onSend(recipientId, videoId, selected.type, selected.dagValue);
    setIsSending(false);
    if (res.success) {
      setResult('success');
      setTimeout(() => {
        setResult(null);
        setSelected(null);
        onClose();
      }, 1500);
    } else {
      setResult('error');
      setErrorMsg(res.error || 'Error al enviar gift');
      setTimeout(() => setResult(null), 3000);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        {/* Handle */}
        <View style={styles.handleWrap}>
          <View style={styles.handleBar} />
        </View>

        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Enviar Gift</Text>
            <Text style={styles.sub}>a @{recipientUsername}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {/* Balance */}
        <View style={styles.balanceRow}>
          <Text style={styles.balanceIcon}>◈</Text>
          <Text style={styles.balanceLabel}>Tu saldo: </Text>
          <Text style={styles.balanceValue}>{currentDagBalance.toFixed(4)} $DAG</Text>
        </View>

        {/* Gift grid */}
        <View style={styles.grid}>
          {GIFT_ITEMS.map(gift => {
            const canAfford = currentDagBalance >= gift.dagValue;
            const isSelected = selected?.type === gift.type;
            return (
              <Pressable
                key={gift.type}
                style={[
                  styles.giftCard,
                  isSelected && styles.giftCardSelected,
                  !canAfford && styles.giftCardDisabled,
                ]}
                onPress={() => canAfford ? setSelected(gift) : undefined}
              >
                <LinearGradient
                  colors={isSelected ? [gift.color + '40', gift.color + '20'] : ['rgba(255,255,255,0.04)', 'transparent']}
                  style={styles.giftCardGrad}
                >
                  <Text style={styles.giftEmoji}>{gift.emoji}</Text>
                  <Text style={[styles.giftLabel, isSelected && { color: gift.color }]}>{gift.label}</Text>
                  <View style={styles.giftPriceRow}>
                    <Text style={[styles.giftPrice, !canAfford && styles.giftPriceDisabled]}>
                      {gift.dagValue} $DAG
                    </Text>
                  </View>
                  {isSelected ? (
                    <View style={[styles.selectedDot, { backgroundColor: gift.color }]} />
                  ) : null}
                </LinearGradient>
              </Pressable>
            );
          })}
        </View>

        {/* Result feedback */}
        {result === 'success' ? (
          <View style={styles.resultSuccess}>
            <MaterialIcons name="check-circle" size={18} color={Colors.accent} />
            <Text style={styles.resultSuccessText}>Gift enviado!</Text>
          </View>
        ) : result === 'error' ? (
          <View style={styles.resultError}>
            <MaterialIcons name="error-outline" size={16} color={Colors.secondary} />
            <Text style={styles.resultErrorText}>{errorMsg}</Text>
          </View>
        ) : null}

        {/* Send button */}
        <Pressable
          style={[styles.sendBtn, (!selected || isSending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!selected || isSending}
        >
          <LinearGradient
            colors={selected ? ['#00D4FF', '#0066FF'] : ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)']}
            style={styles.sendBtnGrad}
          >
            {isSending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.sendBtnEmoji}>{selected?.emoji || '◈'}</Text>
                <Text style={styles.sendBtnText}>
                  {selected ? `Enviar ${selected.label} (${selected.dagValue} $DAG)` : 'Selecciona un gift'}
                </Text>
              </>
            )}
          </LinearGradient>
        </Pressable>

        <Text style={styles.note}>El 90% del valor va directo al creador en $DAG</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg,
    gap: Spacing.md,
    maxHeight: H * 0.78,
  },
  handleWrap: { alignItems: 'center', marginBottom: -Spacing.xs },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  sub: { color: Colors.primary, fontSize: FontSize.sm, marginTop: 1 },
  balanceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(0,212,255,0.25)',
  },
  balanceIcon: { fontSize: 16, color: Colors.primary, marginRight: 4 },
  balanceLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  balanceValue: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: Spacing.sm, justifyContent: 'space-between',
  },
  giftCard: {
    width: '30%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  giftCardSelected: { borderColor: Colors.primary },
  giftCardDisabled: { opacity: 0.4 },
  giftCardGrad: {
    alignItems: 'center', paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm, gap: 4, position: 'relative',
  },
  giftEmoji: { fontSize: 28 },
  giftLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: FontWeight.semibold },
  giftPriceRow: { flexDirection: 'row', alignItems: 'center' },
  giftPrice: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.bold },
  giftPriceDisabled: { color: Colors.textSubtle },
  selectedDot: {
    position: 'absolute', top: 6, right: 6,
    width: 8, height: 8, borderRadius: 4,
  },
  resultSuccess: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(0,255,136,0.1)', borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: 'rgba(0,255,136,0.25)',
  },
  resultSuccessText: { color: Colors.accent, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  resultError: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,45,85,0.1)', borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: 'rgba(255,45,85,0.25)',
  },
  resultErrorText: { color: Colors.secondary, fontSize: FontSize.sm, flex: 1 },
  sendBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, gap: Spacing.sm,
  },
  sendBtnEmoji: { fontSize: 18 },
  sendBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  note: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },
});
