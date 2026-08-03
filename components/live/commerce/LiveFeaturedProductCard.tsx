import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  CommercePrice,
  OnSpaceText,
  ProductAvailabilityBadge,
  ProductThumbnail,
} from "@/components/design";
import { colors, radii, shadows, spacing } from "@/design";
import type { LiveSessionProduct } from "@/services/liveCommerceService";

export function LiveFeaturedProductCard({
  product,
  mode,
  onAction,
}: {
  product: LiveSessionProduct;
  mode: "host" | "viewer";
  onAction: () => void;
}) {
  const unavailable = product.availability !== "available",
    disabled = mode === "viewer" && unavailable;
  return (
    <View style={s.card} accessibilityLabel="Producto destacado del LIVE">
      <ProductThumbnail uri={product.imageUrl} size="medium" />
      <View style={s.info}>
        <View style={s.badges}>
          {product.isFeatured ? (
            <OnSpaceText variant="caption" color="commerceAccent">
              DESTACADO
            </OnSpaceText>
          ) : null}
          <ProductAvailabilityBadge availability={product.availability} />
        </View>
        <OnSpaceText variant="labelStrong" numberOfLines={2}>
          {product.title}
        </OnSpaceText>
        <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
          {product.storeName || product.sellerName}
        </OnSpaceText>
        <View style={s.price}>
          <CommercePrice
            price={product.minPrice}
            compareAtPrice={product.compareAtPrice}
          />
          <OnSpaceText variant="caption" color="textMuted">
            {product.availableQuantity} disponibles
          </OnSpaceText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          mode === "host"
            ? `Gestionar ${product.title}`
            : `Comprar ${product.title}`
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onAction}
        style={({ pressed }) => [
          s.action,
          disabled && s.disabled,
          pressed && s.pressed,
        ]}
      >
        <OnSpaceText variant="labelStrong" color="textInverse">
          {mode === "host" ? "Gestionar" : "Comprar"}
        </OnSpaceText>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: "rgba(15,15,21,.91)",
    borderWidth: 1,
    borderColor: colors.borderElevated,
    ...shadows.floating,
  },
  info: { flex: 1, minWidth: 0, gap: 1 },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  price: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  action: {
    minWidth: 82,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.commerceAccent,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.commerce,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.48 },
});
