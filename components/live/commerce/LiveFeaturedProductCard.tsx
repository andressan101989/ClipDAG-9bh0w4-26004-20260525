import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
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
  hostV4 = false,
  onAction,
}: {
  product: LiveSessionProduct;
  mode: "host" | "viewer";
  hostV4?: boolean;
  onAction: () => void;
}) {
  const { width } = useWindowDimensions();
  const host = mode === "host";
  const compactHost = host && width < 370;
  const unavailable = product.availability !== "available",
    disabled = mode === "viewer" && unavailable;
  return (
    <View style={[s.card, host && s.hostCard, hostV4 && s.hostV4Card, compactHost && !hostV4 && s.compactHostCard]} accessibilityLabel="Producto destacado del LIVE">
      <ProductThumbnail uri={product.imageUrl} size={hostV4 ? "medium" : host && !compactHost ? "large" : "medium"} />
      <View style={[s.info, host && s.hostInfo, hostV4 && s.hostV4Info]}>
        <View style={s.badges}>
          {product.isFeatured ? (
            <View style={s.featuredBadge}>
              <OnSpaceText variant="caption" color="commerceAccent">
                {hostV4 ? "FIJADO" : "DESTACADO"}
              </OnSpaceText>
            </View>
          ) : null}
          <ProductAvailabilityBadge availability={product.availability} />
        </View>
        <OnSpaceText variant="labelStrong" numberOfLines={hostV4 ? 1 : 2}>
          {product.title}
        </OnSpaceText>
        {!hostV4 ? <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
          {product.storeName || product.sellerName}
        </OnSpaceText> : null}
        <View style={s.price}>
          <CommercePrice
            price={product.minPrice}
            compareAtPrice={product.compareAtPrice}
            size={host ? "large" : "regular"}
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
          host && s.hostAction,
          hostV4 && s.hostV4Action,
          compactHost && !hostV4 && s.compactAction,
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
  hostCard: {
    minHeight: 164,
    padding: spacing.md,
    borderRadius: 22,
    borderColor: "rgba(168,85,247,.88)",
    backgroundColor: "rgba(13,15,23,.97)",
  },
  hostV4Card: {
    minHeight: 88,
    padding: 10,
    gap: 10,
    borderRadius: 22,
    borderColor: "rgba(168,85,247,.72)",
  },
  compactHostCard: { minHeight: 142, padding: spacing.sm },
  info: { flex: 1, minWidth: 0, gap: 1 },
  hostInfo: { alignSelf: "stretch", justifyContent: "center", gap: 3 },
  hostV4Info: { flex: 1, minWidth: 0, paddingRight: 0, gap: 1 },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  featuredBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: "rgba(99,35,54,.72)" },
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
  hostAction: { position: "absolute", right: spacing.md, bottom: 26 },
  hostV4Action: { position: "relative", right: undefined, bottom: undefined, minWidth: 72, minHeight: 40, paddingHorizontal: 10, flexShrink: 0 },
  compactAction: { minWidth: 70, paddingHorizontal: spacing.sm, right: spacing.sm, bottom: spacing.sm },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.48 },
});
