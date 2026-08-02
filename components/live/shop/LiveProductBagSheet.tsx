import React, { memo, useMemo } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  BottomSheetSurface,
  CommercePrice,
  EmptyState,
  ErrorState,
  IconButton,
  ProductAvailabilityBadge,
  ProductThumbnail,
  Skeleton,
} from "@/components/design";
import { OnSpaceText } from "@/components/design/OnSpaceText";
import { colors, motion, radii, spacing } from "@/design";
import type { LiveSessionProduct } from "@/services/liveCommerceService";

const ProductRow = memo(function ProductRow({
  item,
  onPress,
}: {
  item: LiveSessionProduct;
  onPress: () => void;
}) {
  const disabled = item.availability !== "available";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.minPrice.toFixed(2)} BDAG`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <ProductThumbnail uri={item.imageUrl} />
      <View style={styles.rowBody}>
        <View style={styles.titleLine}>
          <OnSpaceText
            variant="labelStrong"
            numberOfLines={2}
            style={styles.flex}
          >
            {item.title}
          </OnSpaceText>
          {item.isFeatured ? (
            <OnSpaceText variant="caption" color="brandHighlight">
              Destacado
            </OnSpaceText>
          ) : null}
        </View>
        <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
          {item.storeName} · {item.sellerName}
        </OnSpaceText>
        <CommercePrice
          price={item.minPrice}
          compareAtPrice={item.compareAtPrice}
        />
        <ProductAvailabilityBadge availability={item.availability} />
        {item.availability === "affiliate_offer_unavailable" ? (
          <OnSpaceText variant="caption" color="textWarning">
            La oferta de este creador ya no está disponible.
          </OnSpaceText>
        ) : null}
      </View>
    </Pressable>
  );
});

export function LiveProductBagSheet({
  visible,
  products,
  loading = false,
  refreshing = false,
  error,
  onClose,
  onRefresh,
  onSelect,
}: {
  visible: boolean;
  products: LiveSessionProduct[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (item: LiveSessionProduct) => void;
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const translateY = useSharedValue(0);
  const sorted = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          Number(b.isFeatured) - Number(a.isFeatured) ||
          a.position - b.position,
      ),
    [products],
  );
  const dragToClose = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .onUpdate((event) => {
          translateY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > 88 || event.velocityY > 900) {
            runOnJS(onClose)();
            translateY.value = 0;
          } else {
            translateY.value = reducedMotion
              ? 0
              : withSpring(0, motion.spring.subtle);
          }
        }),
    [onClose, reducedMotion, translateY],
  );
  const sheetMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable
          accessibilityLabel="Cerrar bolsa"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <GestureDetector gesture={dragToClose}>
          <Animated.View style={sheetMotion}>
            <BottomSheetSurface
              style={[
                styles.sheet,
                { paddingBottom: Math.max(insets.bottom, spacing.xl) },
              ]}
            >
              <View style={styles.header}>
                <View>
                  <OnSpaceText variant="headingMedium">
                    Productos del LIVE
                  </OnSpaceText>
                  <OnSpaceText variant="bodySmall" color="textMuted">
                    {products.length}{" "}
                    {products.length === 1 ? "producto" : "productos"}
                  </OnSpaceText>
                </View>
                <IconButton
                  icon="close"
                  label="Cerrar bolsa de productos"
                  onPress={onClose}
                />
              </View>

              {loading ? (
                <View style={styles.loading}>
                  {[0, 1, 2].map((value) => (
                    <View key={value} style={styles.skeletonRow}>
                      <Skeleton style={styles.skeletonImage} />
                      <View style={styles.flex}>
                        <Skeleton style={styles.skeletonTitle} />
                        <Skeleton style={styles.skeletonPrice} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : error ? (
                <ErrorState body={error} onRetry={onRefresh} />
              ) : (
                <FlatList
                  data={sorted}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <ProductRow item={item} onPress={() => onSelect(item)} />
                  )}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onRefresh}
                      tintColor={colors.brandHighlight}
                    />
                  }
                  ListEmptyComponent={
                    <EmptyState
                      title="La bolsa está vacía"
                      body="El anfitrión todavía no agregó productos a este LIVE."
                    />
                  }
                  contentContainerStyle={
                    sorted.length ? styles.list : styles.empty
                  }
                  initialNumToRender={8}
                  maxToRenderPerBatch={8}
                  windowSize={5}
                  removeClippedSubviews
                />
              )}
            </BottomSheetSurface>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  sheet: { maxHeight: "82%", minHeight: "54%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  list: { paddingBottom: spacing.xl },
  empty: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  rowBody: { flex: 1, gap: spacing.xs },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  flex: { flex: 1 },
  pressed: {
    backgroundColor: "rgba(255,255,255,.06)",
    transform: [{ scale: 0.99 }],
  },
  disabled: { opacity: 0.52 },
  loading: { gap: spacing.lg },
  skeletonRow: { flexDirection: "row", gap: spacing.md },
  skeletonImage: { width: 72, height: 72 },
  skeletonTitle: { height: 18, width: "80%", marginTop: spacing.xs },
  skeletonPrice: { height: 15, width: "38%", marginTop: spacing.md },
});
