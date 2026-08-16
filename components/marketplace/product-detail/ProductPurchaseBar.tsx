import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from "@/constants/theme";

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
  const { width } = useWindowDimensions(),
    compact = width <= 360;
  return (
    <View style={[styles.bar, { paddingBottom: bottom + Spacing.sm }]}>
      <View style={styles.purchaseRow}>
        {actionable ? (
          <View
            style={[styles.quantity, compact && styles.quantityCompact]}
            accessibilityRole="adjustable"
            accessibilityLabel={`Cantidad ${quantity}`}
          >
            <Pressable
              style={[
                styles.quantityButton,
                quantity <= 1 && styles.controlDisabled,
              ]}
              disabled={quantity <= 1}
              onPress={() => onQuantity(Math.max(1, quantity - 1))}
              accessibilityRole="button"
              accessibilityLabel="Reducir cantidad"
              accessibilityState={{ disabled: quantity <= 1 }}
            >
              <MaterialIcons
                name="remove"
                size={20}
                color={Colors.textPrimary}
              />
            </Pressable>
            <Text style={styles.quantityText}>{quantity}</Text>
            <Pressable
              style={[
                styles.quantityButton,
                quantity >= available && styles.controlDisabled,
              ]}
              disabled={quantity >= available}
              onPress={() => onQuantity(Math.min(available, quantity + 1))}
              accessibilityRole="button"
              accessibilityLabel="Aumentar cantidad"
              accessibilityState={{ disabled: quantity >= available }}
            >
              <MaterialIcons name="add" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.unavailableIcon}>
            <MaterialIcons
              name="info-outline"
              size={18}
              color={Colors.textSecondary}
            />
          </View>
        )}
        <Pressable
          style={[
            styles.action,
            styles.cartAction,
            !actionable && styles.actionDisabled,
          ]}
          disabled={!actionable}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={actionable ? "Agregar al carrito" : label}
          accessibilityHint={
            actionable
              ? `Precio por unidad ${price.toFixed(2)} BDAG`
              : undefined
          }
          accessibilityState={{ disabled: !actionable }}
        >
          <MaterialIcons
            name="add-shopping-cart"
            size={20}
            color={actionable ? "#fff" : Colors.textSubtle}
          />
          <View style={styles.actionCopy}>
            <Text
              style={[
                styles.cartActionText,
                !actionable && styles.disabledText,
              ]}
              numberOfLines={1}
            >
              Agregar al carrito
            </Text>
            {actionable ? (
              <Text style={styles.actionPrice}>{price.toFixed(2)} BDAG</Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          style={[
            styles.action,
            styles.buyAction,
            !actionable && styles.actionDisabled,
          ]}
          disabled={!actionable}
          onPress={onBuy}
          accessibilityRole="button"
          accessibilityLabel={actionable ? "Comprar ahora" : label}
          accessibilityState={{ disabled: !actionable }}
        >
          <MaterialIcons
            name="bolt"
            size={20}
            color={actionable ? "#fff" : Colors.textSubtle}
          />
          <View style={styles.actionCopy}>
            <Text
              style={[styles.buyActionText, !actionable && styles.disabledText]}
              numberOfLines={1}
            >
              Comprar ahora
            </Text>
            {actionable ? (
              <Text style={styles.actionPrice}>{price.toFixed(2)} BDAG</Text>
            ) : null}
          </View>
        </Pressable>
      </View>
      <View style={styles.secureStrip}>
        <MaterialIcons
          name="verified-user"
          size={17}
          color={Colors.primaryLight}
        />
        <Text style={styles.secureText}>
          Compra segura en{" "}
          <Text style={styles.secureBrand}>OnSpace Marketplace</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 7,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    backgroundColor: "rgba(17,17,24,.98)",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  purchaseRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 7,
  },
  quantity: {
    width: 112,
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
    borderRadius: Radius.md,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  quantityCompact: { width: 94 },
  quantityButton: {
    flex: 1,
    minWidth: 30,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  controlDisabled: { opacity: 0.35 },
  quantityText: {
    minWidth: 24,
    textAlign: "center",
    color: Colors.textPrimary,
    fontWeight: FontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  unavailableIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: Colors.surface,
  },
  action: {
    minWidth: 0,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
    borderRadius: Radius.md,
  },
  cartAction: {
    flex: 1.24,
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  buyAction: {
    flex: 1,
    backgroundColor: Colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
  },
  actionDisabled: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionCopy: { minWidth: 0, alignItems: "center" },
  cartActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: FontWeight.extrabold,
  },
  buyActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: FontWeight.extrabold,
  },
  actionPrice: {
    color: "rgba(255,255,255,.68)",
    fontSize: 10,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  disabledText: { color: Colors.textSubtle },
  secureStrip: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  secureText: { color: Colors.textSecondary, fontSize: 11 },
  secureBrand: { color: Colors.primaryLight, fontWeight: FontWeight.semibold },
});
