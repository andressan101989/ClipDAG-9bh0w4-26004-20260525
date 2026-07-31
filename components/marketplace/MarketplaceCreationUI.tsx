import React, { memo, type ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme';

const STEPS = ['Información', 'Fotos', 'Opciones', 'Variantes', 'Revisar'];

export function MarketplaceCreationProgress({ current }: { current: number }) {
  return (
    <View
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityLabel={`Paso ${current + 1} de 5: ${STEPS[current]}`}
      accessibilityValue={{ min: 1, max: 5, now: current + 1 }}
    >
      <View style={styles.progressTop}>
        <Text style={styles.progressEyebrow}>PASO {current + 1} DE 5</Text>
        <Text style={styles.progressCurrent}>{STEPS[current]}</Text>
      </View>
      <View style={styles.progressTrack}>
        {STEPS.map((label, index) => (
          <View key={label} style={styles.progressItem}>
            <View style={[
              styles.progressDot,
              index < current && styles.progressDotComplete,
              index === current && styles.progressDotCurrent,
            ]}>
              {index < current
                ? <MaterialIcons name="check" size={12} color={Colors.textOnBrand} />
                : <Text style={styles.progressNumber}>{index + 1}</Text>}
            </View>
            <Text numberOfLines={1} style={[styles.progressLabel, index === current && styles.progressLabelCurrent]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function MarketplaceSectionCard({
  icon, title, subtitle, children,
}: { icon?: keyof typeof MaterialIcons.glyphMap; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeading}>
        {icon ? <View style={styles.sectionIcon}><MaterialIcons name={icon} size={20} color={Colors.primaryLight} /></View> : null}
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export function MarketplaceChoiceCard({
  selected, icon, title, description, onPress,
}: {
  selected: boolean; icon: keyof typeof MaterialIcons.glyphMap; title: string;
  description: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.choiceCard, selected && styles.choiceSelected, pressed && styles.pressed,
      ]}
    >
      <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
        <MaterialIcons name={icon} size={25} color={selected ? Colors.primaryLight : Colors.textSecondary} />
      </View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDescription}>{description}</Text>
      </View>
      <MaterialIcons
        name={selected ? 'check-circle' : 'radio-button-unchecked'}
        size={24}
        color={selected ? Colors.primary : Colors.textSubtle}
      />
    </Pressable>
  );
}

export const MarketplaceVariantListItem = memo(function MarketplaceVariantListItem({
  label, sku, price, inventory, active, imageUrl, expanded, onPress, children,
}: {
  label: string; sku: string; price: string; inventory: string; active: boolean;
  imageUrl?: string; expanded: boolean; onPress: () => void; children?: ReactNode;
}) {
  return (
    <View style={[styles.variantRow, expanded && styles.variantRowExpanded]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${price || 'sin precio'} BDAG, ${inventory || '0'} disponibles`}
        accessibilityHint={expanded ? 'Contraer edición' : 'Abrir edición de variante'}
        style={({ pressed }) => [styles.variantSummary, pressed && styles.pressed]}
      >
        <View style={styles.variantThumb}>
          {imageUrl
            ? <Image source={{ uri: imageUrl }} style={styles.variantThumbImage} contentFit="cover" />
            : <MaterialIcons name="inventory-2" size={23} color={Colors.textSubtle} />}
        </View>
        <View style={styles.variantCopy}>
          <Text style={styles.variantName} numberOfLines={1}>{label}</Text>
          <Text style={styles.variantMeta}>{price || '—'} BDAG · {inventory || '0'} disponibles</Text>
          <Text style={styles.variantSku} numberOfLines={1}>SKU: {sku || 'Pendiente'}</Text>
        </View>
        <View style={styles.variantState}>
          <View style={[styles.statusPill, !active && styles.statusInactive]}>
            <Text style={[styles.statusText, !active && styles.statusTextInactive]}>
              {active ? 'Activa' : 'Inactiva'}
            </Text>
          </View>
          <MaterialIcons name={expanded ? 'expand-less' : 'chevron-right'} size={23} color={Colors.textSecondary} />
        </View>
      </Pressable>
      {expanded ? <View style={styles.variantEditor}>{children}</View> : null}
    </View>
  );
});

export function MarketplaceBulkEditSheet({
  visible, count, price, stock, onPriceChange, onStockChange, onClose,
  onApplyPrice, onApplyStock, onGenerateSkus, onActivateAll, onDeactivateAll, onClearCompareAt,
}: {
  visible: boolean; count: number; price: string; stock: string;
  onPriceChange: (value: string) => void; onStockChange: (value: string) => void; onClose: () => void;
  onApplyPrice: () => void; onApplyStock: () => void; onGenerateSkus: () => void;
  onActivateAll: () => void; onDeactivateAll: () => void; onClearCompareAt: () => void;
}) {
  const insets = useSafeAreaInsets();
  const action = (icon: keyof typeof MaterialIcons.glyphMap, label: string, onPress: () => void) => (
    <Pressable style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]} onPress={onPress}>
      <MaterialIcons name={icon} size={21} color={Colors.primaryLight} />
      <Text style={styles.sheetActionText}>{label}</Text>
      <MaterialIcons name="chevron-right" size={21} color={Colors.textSubtle} />
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Cerrar edición en grupo" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>Editar en grupo</Text>
            <Text style={styles.sheetSubtitle}>Los cambios afectarán {count} variantes.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityLabel="Cerrar">
            <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.sheetFieldRow}>
            <TextInput
              style={styles.sheetInput}
              value={price}
              onChangeText={onPriceChange}
              keyboardType="decimal-pad"
              placeholder="Precio BDAG"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel="Precio para todas las variantes"
            />
            <Pressable style={styles.sheetApply} onPress={onApplyPrice}><Text style={styles.sheetApplyText}>Aplicar</Text></Pressable>
          </View>
          <View style={styles.sheetFieldRow}>
            <TextInput
              style={styles.sheetInput}
              value={stock}
              onChangeText={onStockChange}
              keyboardType="number-pad"
              placeholder="Inventario"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel="Inventario para todas las variantes"
            />
            <Pressable style={styles.sheetApply} onPress={onApplyStock}><Text style={styles.sheetApplyText}>Aplicar</Text></Pressable>
          </View>
          {action('qr-code-2', 'Generar SKU automáticamente', onGenerateSkus)}
          {action('toggle-on', 'Activar todas', onActivateAll)}
          {action('toggle-off', 'Desactivar todas', onDeactivateAll)}
          {action('money-off', 'Limpiar precios anteriores', onClearCompareAt)}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function MarketplaceStickyFooter({
  primaryLabel, onPrimary, secondaryLabel = 'Volver', onSecondary, disabled, loading, bottom,
}: {
  primaryLabel: string; onPrimary: () => void; secondaryLabel?: string; onSecondary: () => void;
  disabled?: boolean; loading?: boolean; bottom: number;
}) {
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(bottom, Spacing.sm) }]}>
      <Pressable
        onPress={onSecondary}
        accessibilityRole="button"
        style={({ pressed }) => [styles.footerSecondary, pressed && styles.pressed]}
      >
        <Text style={styles.footerSecondaryText}>{secondaryLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onPrimary}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
        style={({ pressed }) => [
          styles.footerPrimary, (disabled || loading) && styles.footerDisabled, pressed && styles.pressed,
        ]}
      >
        <Text style={styles.footerPrimaryText}>{loading ? 'Procesando…' : primaryLabel}</Text>
        {!loading ? <MaterialIcons name="arrow-forward" size={19} color={Colors.textOnBrand} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: 12 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressEyebrow: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1 },
  progressCurrent: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  progressTrack: { flexDirection: 'row', alignItems: 'flex-start' },
  progressItem: { flex: 1, alignItems: 'center', gap: 5 },
  progressDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.border },
  progressDotComplete: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  progressDotCurrent: { borderColor: Colors.primaryLight, backgroundColor: Colors.primaryDim, borderWidth: 2 },
  progressNumber: { color: Colors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold },
  progressLabel: { color: Colors.textSubtle, fontSize: 9, maxWidth: 68 },
  progressLabelCurrent: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle, ...Shadow.subtle },
  sectionHeading: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  sectionIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryDim },
  sectionCopy: { flex: 1, gap: 3 },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  sectionSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  choiceCard: { minHeight: 104, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  choiceSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  choiceIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight },
  choiceIconSelected: { backgroundColor: Colors.primaryGlow },
  choiceCopy: { flex: 1, gap: 5 },
  choiceTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  choiceDescription: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  pressed: { opacity: 0.72 },
  variantRow: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, overflow: 'hidden' },
  variantRowExpanded: { borderColor: Colors.primaryGlow },
  variantSummary: { minHeight: 92, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 12 },
  variantThumb: { width: 54, height: 54, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  variantThumbImage: { width: 54, height: 54 },
  variantCopy: { flex: 1, gap: 3 },
  variantName: { color: Colors.textPrimary, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  variantMeta: { color: Colors.textSecondary, fontSize: FontSize.sm },
  variantSku: { color: Colors.textSubtle, fontSize: FontSize.xs },
  variantState: { alignItems: 'flex-end', gap: 9 },
  statusPill: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: Colors.accentDim },
  statusInactive: { backgroundColor: Colors.surfaceHighlight },
  statusText: { color: Colors.success, fontSize: 9, fontWeight: FontWeight.bold },
  statusTextInactive: { color: Colors.textSubtle },
  variantEditor: { padding: Spacing.md, paddingTop: 0, gap: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.64)' },
  sheet: { maxHeight: '76%', backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: Colors.borderHighlight, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  sheetSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 3 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated },
  sheetFieldRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  sheetInput: { flex: 1, minHeight: 50, color: Colors.textPrimary, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  sheetApply: { minWidth: 86, minHeight: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  sheetApplyText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  sheetAction: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  sheetActionText: { flex: 1, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  footer: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderSubtle, backgroundColor: Colors.surface },
  footerSecondary: { minHeight: 52, minWidth: 100, paddingHorizontal: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  footerSecondaryText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  footerPrimary: { flex: 1, minHeight: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: Colors.primary, ...Shadow.brand },
  footerPrimaryText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  footerDisabled: { opacity: 0.42, shadowOpacity: 0 },
});
