import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { LiveGiftCategory, LiveGiftDefinition } from '@/types/liveGifts';

type LiveGiftSheetProps = {
  visible: boolean;
  balance: number | null;
  catalog: LiveGiftDefinition[];
  sendingGiftId: string | null;
  giftsEnabled: boolean;
  feedback?: string | null;
  balanceLoading?: boolean;
  balanceError?: string | null;
  onSendGift: (gift: LiveGiftDefinition) => void;
  onClose: () => void;
};

const CATEGORIES: { key: LiveGiftCategory; label: string }[] = [
  { key: 'basic', label: 'Basicos' },
  { key: 'premium', label: 'Premium' },
  { key: 'legendary', label: 'Legendarios' },
];

function formatBdag(amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return '--';
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function LiveGiftSheet({
  visible,
  balance,
  catalog,
  sendingGiftId,
  giftsEnabled,
  feedback,
  balanceLoading = false,
  balanceError = null,
  onSendGift,
  onClose,
}: LiveGiftSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(380)).current;
  const [rendered, setRendered] = useState(visible);
  const [category, setCategory] = useState<LiveGiftCategory>('basic');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setRendered(true);
    Animated.timing(translateY, {
      toValue: visible ? 0 : 380,
      duration: visible ? 220 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });
  }, [translateY, visible]);

  useEffect(() => {
    if (!visible) setSelectedId(null);
  }, [visible]);

  const items = useMemo(
    () => catalog.filter(gift => gift.enabled && gift.category === category),
    [catalog, category],
  );

  const selected = items.find(item => item.id === selectedId) ?? null;
  const selectedInsufficient = !!selected && balance !== null && balance < selected.priceBdag;
  const canSendSelected = !!selected && giftsEnabled && balance !== null && !selectedInsufficient && !sendingGiftId && !balanceLoading && !balanceError;
  const sendLabel = !giftsEnabled
    ? 'Regalos deshabilitados'
    : balanceLoading
      ? 'Cargando saldo'
      : balanceError
        ? 'Saldo no disponible'
        : selectedInsufficient
          ? 'Saldo insuficiente'
          : selected
            ? `Enviar ${selected.name} - ${selected.priceBdag} BDAG`
            : 'Selecciona un regalo';

  const requestClose = () => {
    Animated.timing(translateY, {
      toValue: 380,
      duration: 180,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  return (
    <Modal visible={rendered} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={requestClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={requestClose} accessibilityLabel="Cerrar regalos" />
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 14, transform: [{ translateY }] }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Enviar regalo</Text>
              <Text style={styles.subtitle}>Los precios se validan en el servidor</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={requestClose} hitSlop={8} accessibilityLabel="Cerrar regalos">
              <MaterialIcons name="close" size={20} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.balanceRow}>
            <MaterialIcons name="account-balance-wallet" size={16} color={Colors.primary} />
            <Text style={styles.balanceLabel}>Saldo</Text>
            {balanceLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.balanceValue}>{formatBdag(balance)} BDAG</Text>
            )}
          </View>
          {balanceError ? <Text style={styles.errorText}>{balanceError}</Text> : null}
          {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}

          <View style={styles.tabs} accessibilityRole="tablist">
            {CATEGORIES.map(tab => (
              <Pressable
                key={tab.key}
                style={[styles.tab, category === tab.key && styles.tabActive]}
                onPress={() => {
                  setCategory(tab.key);
                  setSelectedId(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: category === tab.key }}
              >
                <Text style={[styles.tabText, category === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>

          <FlatList
            data={items}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.emptyText}>No hay regalos disponibles</Text>}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedId;
              const canAfford = balance !== null && balance >= item.priceBdag;
              const disabled = !giftsEnabled || !canAfford || !!sendingGiftId || balanceLoading || !!balanceError;
              return (
                <Pressable
                  style={[styles.card, isSelected && styles.cardSelected, disabled && styles.cardDisabled]}
                  onPress={() => setSelectedId(item.id)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected: isSelected }}
                  accessibilityLabel={`${item.name}, ${item.priceBdag} BDAG${!canAfford ? ', saldo insuficiente' : ''}`}
                >
                  <Text style={styles.icon}>{item.icon}</Text>
                  <Text style={styles.giftName} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.price, !canAfford && styles.priceDisabled]}>{item.priceBdag} BDAG</Text>
                  {sendingGiftId === item.id ? <ActivityIndicator size="small" color="#fff" style={styles.cardSpinner} /> : null}
                </Pressable>
              );
            }}
          />

          <Pressable
            style={[styles.sendBtn, !canSendSelected && styles.sendBtnDisabled]}
            onPress={() => selected && onSendGift(selected)}
            disabled={!canSendSelected}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSendSelected }}
          >
            {selected && sendingGiftId === selected.id ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialIcons name="send" size={17} color="#fff" />
            )}
            <Text style={styles.sendText}>{sendLabel}</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    minHeight: 360,
    padding: Spacing.lg,
    gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  subtitle: { color: Colors.textSubtle, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  balanceLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  balanceValue: { marginLeft: 'auto', color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  errorText: { color: Colors.secondary, fontSize: 12 },
  feedbackText: { color: Colors.textSecondary, fontSize: 12 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontSize: 12, fontWeight: FontWeight.semibold },
  tabTextActive: { color: '#fff' },
  grid: { minHeight: 130, paddingBottom: Spacing.sm, gap: 10 },
  gridRow: { gap: 10 },
  card: { flex: 1, minHeight: 106, maxWidth: '31.8%', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4 },
  cardSelected: { borderColor: Colors.primary, backgroundColor: 'rgba(124,92,255,0.18)' },
  cardDisabled: { opacity: 0.42 },
  icon: { fontSize: 29 },
  giftName: { color: Colors.textPrimary, fontSize: 11, fontWeight: FontWeight.semibold },
  price: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.bold },
  priceDisabled: { color: Colors.textSubtle },
  cardSpinner: { position: 'absolute', top: 7, right: 7 },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', paddingVertical: Spacing.lg },
  sendBtn: { minHeight: 48, borderRadius: Radius.full, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  sendBtnDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
