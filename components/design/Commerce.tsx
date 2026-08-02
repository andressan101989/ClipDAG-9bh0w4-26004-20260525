import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "@/components/ui/SafeImage";
import { colors, layout, radii, spacing } from "@/design";
import { OnSpaceText } from "./OnSpaceText";
import { Badge } from "./Feedback";

export function CommercePrice({
  price,
  compareAtPrice,
  size = "regular",
}: {
  price: number;
  compareAtPrice?: number | null;
  size?: "regular" | "large";
}) {
  return (
    <View
      accessibilityLabel={`${price.toFixed(2)} BDAG`}
      style={styles.priceRow}
    >
      <OnSpaceText
        variant={size === "large" ? "priceLarge" : "price"}
        color="commercePrice"
      >
        {price.toFixed(2)} BDAG
      </OnSpaceText>
      {compareAtPrice && compareAtPrice > price ? (
        <OnSpaceText
          variant="bodySmall"
          color="textMuted"
          style={styles.strike}
        >
          {compareAtPrice.toFixed(2)}
        </OnSpaceText>
      ) : null}
    </View>
  );
}
export function ProductThumbnail({
  uri,
  size = "medium",
  label = "Imagen del producto",
}: {
  uri?: string | null;
  size?: "small" | "medium" | "large";
  label?: string;
}) {
  const dimension =
    size === "small"
      ? layout.thumbnailSmall
      : size === "large"
        ? layout.thumbnailLarge
        : layout.thumbnailMedium;
  return uri ? (
    <Image
      accessibilityLabel={label}
      source={{ uri }}
      style={{
        width: dimension,
        height: dimension,
        borderRadius: radii.md,
        backgroundColor: colors.backgroundElevated,
      }}
    />
  ) : (
    <View
      accessibilityLabel="Producto sin imagen"
      style={[styles.fallback, { width: dimension, height: dimension }]}
    >
      <MaterialIcons
        name="image-not-supported"
        size={22}
        color={colors.textMuted}
      />
    </View>
  );
}
export function ProductAvailabilityBadge({
  availability,
}: {
  availability:
    | "available"
    | "out_of_stock"
    | "product_unavailable"
    | "live_ended";
}) {
  const value =
    availability === "available"
      ? ["Disponible", "success"]
      : availability === "out_of_stock"
        ? ["Agotado", "neutral"]
        : availability === "live_ended"
          ? ["LIVE finalizado", "warning"]
          : ["No disponible", "danger"];
  return (
    <Badge
      label={value[0]}
      tone={value[1] as "success" | "neutral" | "warning" | "danger"}
    />
  );
}
export function QuantityStepper({
  value,
  minimum = 1,
  maximum,
  onChange,
  disabled = false,
}: {
  value: number;
  minimum?: number;
  maximum: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const change = (next: number) => {
    if (disabled || next < minimum || next > maximum) return;
    void Haptics.selectionAsync();
    onChange(next);
  };
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={`Cantidad ${value}`}
      accessibilityValue={{ min: minimum, max: maximum, now: value }}
      style={styles.stepper}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reducir cantidad"
        accessibilityState={{ disabled: disabled || value <= minimum }}
        disabled={disabled || value <= minimum}
        onPress={() => change(value - 1)}
        style={styles.step}
      >
        <MaterialIcons name="remove" size={20} color={colors.textPrimary} />
      </Pressable>
      <OnSpaceText variant="labelStrong" style={styles.quantity}>
        {value}
      </OnSpaceText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Aumentar cantidad"
        accessibilityState={{ disabled: disabled || value >= maximum }}
        disabled={disabled || value >= maximum}
        onPress={() => change(value + 1)}
        style={styles.step}
      >
        <MaterialIcons name="add" size={20} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  strike: { textDecorationLine: "line-through" },
  fallback: {
    borderRadius: radii.md,
    backgroundColor: colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  stepper: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  step: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  quantity: {
    minWidth: 34,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
