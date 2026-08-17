import React, { memo, useEffect } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  useReducedMotion,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { OnSpaceText } from "@/components/design/OnSpaceText";
import { colors, layout, motion, radii, shadows, spacing } from "@/design";
import type { LiveSessionProduct } from "@/services/liveCommerceService";
import { LiveFeaturedProductCard } from "@/components/live/commerce/LiveFeaturedProductCard";

interface LiveProductRailProps {
  product: LiveSessionProduct;
  productCount: number;
  bottom: number;
  keyboardVisible?: boolean;
  mode?: "viewer" | "host";
  onBuy: () => void;
  onOpenBag: () => void;
}
export const LiveProductRail = memo(function LiveProductRail({
  product,
  productCount,
  bottom,
  keyboardVisible = false,
  mode = "viewer",
  onBuy,
  onOpenBag,
}: LiveProductRailProps) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion(),
    scale = useSharedValue(reduced ? 1 : 0.94);
  useEffect(() => {
    scale.value = reduced ? 1 : withSpring(1, motion.spring.subtle);
  }, [product.id, reduced, scale]);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  if (keyboardVisible) return null;
  return (
    <Animated.View
      accessibilityLabel="Producto destacado del LIVE"
      entering={reduced ? undefined : FadeIn.duration(motion.duration.fast)}
      style={[styles.container, mode === "host" && styles.hostContainer, { bottom, minHeight: mode === "host" ? (width < 370 ? 142 : 164) : undefined }, animated]}
    >
      <LiveFeaturedProductCard product={product} mode={mode} onAction={onBuy} />
      {mode === "viewer" ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir bolsa con ${productCount} productos`}
        onPress={() => {
          void Haptics.selectionAsync();
          onOpenBag();
        }}
        style={({ pressed }) => [styles.bag, pressed && styles.pressed]}
      >
        <MaterialIcons
          name="shopping-bag"
          size={21}
          color={colors.textPrimary}
        />
        <View style={styles.count}>
          <OnSpaceText variant="caption">{productCount}</OnSpaceText>
        </View>
      </Pressable> : null}
    </Animated.View>
  );
});
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 12,
    minHeight: layout.productRailHeight,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "stretch",
  },
  hostContainer: {
    left: 18,
    right: 18,
    minHeight: 164,
  },
  product: {
    flex: 1,
    minWidth: 0,
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
  details: { flex: 1, minWidth: 0, justifyContent: "center", gap: 1 },
  buy: {
    minWidth: 76,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.commerceAccent,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.commerce,
  },
  bag: {
    width: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundGlass,
    borderWidth: 1,
    borderColor: colors.borderElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    position: "absolute",
    top: 7,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
});
