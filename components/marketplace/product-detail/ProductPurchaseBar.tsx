import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";

type Props = {
  bottom: number;
  quantity: number;
  available: number;
  price: number;
  disabled: boolean;
  label: string;
  onQuantity: (value: number) => void;
  onAdd: () => void;
  onBuy: () => void;
};

export function ProductPurchaseBar({
  bottom,
  quantity,
  available,
  price,
  disabled,
  label,
  onQuantity,
  onAdd,
  onBuy,
}: Props) {
  const actionable = !disabled && available > 0;
  return (
    <View style={[styles.bar, { paddingBottom: bottom + Spacing.sm }]}>
      <View style={styles.summaryRow}>
        {actionable ? (
          <View style={styles.quantity} accessibilityRole="adjustable" accessibilityLabel={`Cantidad ${quantity}`}>
            <Pressable
              style={[styles.quantityButton, quantity <= 1 && styles.controlDisabled]}
              disabled={quantity <= 1}
              onPress={() => onQuantity(Math.max(1,quantity-1))}
              accessibilityRole="button"
              accessibilityLabel="Reducir cantidad"
              accessibilityState={{ disabled: quantity <= 1 }}
            >
              <MaterialIcons name="remove" size={20} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.quantityText}>{quantity}</Text>
            <Pressable
              style={[styles.quantityButton, quantity >= available && styles.controlDisabled]}
              disabled={quantity >= available}
              onPress={() => onQuantity(Math.min(available,quantity+1))}
              accessibilityRole="button"
              accessibilityLabel="Aumentar cantidad"
              accessibilityState={{ disabled: quantity >= available }}
            >
              <MaterialIcons name="add" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.unavailableIcon}><MaterialIcons name="info-outline" size={18} color={Colors.textSecondary} /></View>
        )}
        <View style={styles.priceContext}>
          <Text style={styles.priceLabel}>{actionable ? "Precio por unidad" : "Disponibilidad"}</Text>
          <Text style={styles.priceValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
            {actionable ? `${price.toFixed(2)} BDAG` : label}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.action, styles.cartAction, !actionable && styles.actionDisabled]}
          disabled={!actionable}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={actionable ? "Agregar al carrito" : label}
          accessibilityState={{ disabled: !actionable }}
        >
          <MaterialIcons name="add-shopping-cart" size={19} color={actionable ? Colors.primaryLight : Colors.textSubtle} />
          <Text style={[styles.cartActionText, !actionable && styles.disabledText]} numberOfLines={1}>Agregar</Text>
        </Pressable>
        <Pressable
          style={[styles.action, styles.buyAction, !actionable && styles.actionDisabled]}
          disabled={!actionable}
          onPress={onBuy}
          accessibilityRole="button"
          accessibilityLabel={actionable ? "Comprar ahora" : label}
          accessibilityState={{ disabled: !actionable }}
        >
          <Text style={[styles.buyActionText, !actionable && styles.disabledText]} numberOfLines={1}>Comprar ahora</Text>
          <MaterialIcons name="arrow-forward" size={18} color={actionable ? "#fff" : Colors.textSubtle} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, backgroundColor: Colors.surfaceElevated, borderTopWidth: 1, borderTopColor: Colors.border, shadowColor: "#000", shadowOpacity: .28, shadowRadius: 12, shadowOffset: { width: 0, height: -5 }, elevation: 18 },
  summaryRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: Spacing.md },
  quantity: { height: 44, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.borderHighlight, borderRadius: Radius.full, overflow: "hidden", backgroundColor: Colors.surface },
  quantityButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  controlDisabled: { opacity: .35 },
  quantityText: { minWidth: 30, textAlign: "center", color: Colors.textPrimary, fontWeight: FontWeight.bold, fontVariant: ["tabular-nums"] },
  unavailableIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: Colors.surface },
  priceContext: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  priceLabel: { color: Colors.textSubtle, fontSize: 10, fontWeight: FontWeight.semibold, textTransform: "uppercase", letterSpacing: .6 },
  priceValue: { maxWidth: "100%", color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: Spacing.sm },
  action: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: Spacing.sm, borderRadius: Radius.full },
  cartAction: { flex: .92, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary + "66" },
  buyAction: { flex: 1.08, backgroundColor: Colors.primary },
  actionDisabled: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  cartActionText: { color: Colors.primaryLight, fontSize: FontSize.sm, fontWeight: FontWeight.extrabold },
  buyActionText: { color: "#fff", fontSize: FontSize.sm, fontWeight: FontWeight.extrabold },
  disabledText: { color: Colors.textSubtle },
});
