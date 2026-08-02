import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetSurface,
  CommercePrice,
  EmptyState,
  ErrorState,
  IconButton,
  OnSpaceButton,
  OnSpaceText,
  ProductAvailabilityBadge,
  ProductThumbnail,
  Skeleton,
  StatusPill,
} from "@/components/design";
import { colors, radii, spacing } from "@/design";
import {
  fetchMyLiveProductCandidates,
  featureLiveProduct,
  LiveCommerceError,
  pinLiveProduct,
  unpinLiveProduct,
  type LiveCandidateCursor,
  type LiveProductCandidate,
} from "@/services/liveCommerceService";

const PAGE_SIZE = 20;
const errorMessage = (error: unknown) => {
  const code =
    error instanceof LiveCommerceError ? error.code : "live_commerce_unknown";
  if (code === "live_commerce_host_not_eligible")
    return "Activa tu tienda y completa la aprobación de vendedor para administrar productos.";
  if (code === "live_commerce_pin_limit")
    return "Llegaste al límite de 20 productos en este LIVE.";
  if (
    code === "live_affiliate_not_authorized" ||
    code === "live_affiliate_offer_unavailable"
  )
    return "El vendedor pausó o retiró esta oferta.";
  if (
    code === "live_commerce_product_unavailable" ||
    code === "live_commerce_out_of_stock"
  )
    return "Este producto ya no está disponible.";
  if (code === "live_commerce_transport")
    return "Revisa tu conexión e inténtalo nuevamente.";
  return "No pudimos completar la acción.";
};
const HostProductRow = memo(function HostProductRow({
  item,
  busy,
  onAction,
}: {
  item: LiveProductCandidate;
  busy: boolean;
  onAction: (kind: "pin" | "unpin" | "feature") => void;
}) {
  return (
    <View style={styles.row}>
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
            <StatusPill label="En portada" tone="brand" />
          ) : null}
        </View>
        <CommercePrice price={item.minPrice} />
        <View style={styles.modeLine}>
          <StatusPill
            label={
              item.commerceMode === "affiliate_product"
                ? "Producto afiliado"
                : "Producto propio"
            }
            tone={
              item.commerceMode === "affiliate_product" ? "warning" : "neutral"
            }
          />
          {item.commerceMode === "affiliate_product" ? (
            <OnSpaceText variant="labelStrong" color="commerceSuccess">
              Comisión {(item.creatorCommissionBps / 100).toFixed(2)}%
            </OnSpaceText>
          ) : (
            <OnSpaceText variant="caption" color="textMuted">
              Sin comisión de creador
            </OnSpaceText>
          )}
        </View>
        <View style={styles.meta}>
          <ProductAvailabilityBadge
            availability={
              item.availableQuantity > 0 ? "available" : "out_of_stock"
            }
          />
          <OnSpaceText variant="caption" color="textMuted">
            {item.availableQuantity} disponibles
          </OnSpaceText>
        </View>
        <View style={styles.actions}>
          <OnSpaceButton
            label={item.isPinned ? "Quitar" : "Agregar"}
            variant={item.isPinned ? "ghost" : "commerce"}
            size="small"
            loading={busy}
            onPress={() => onAction(item.isPinned ? "unpin" : "pin")}
          />
          {item.isPinned && !item.isFeatured ? (
            <OnSpaceButton
              label="Destacar"
              variant="secondary"
              size="small"
              disabled={busy}
              onPress={() => onAction("feature")}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
});
export function LiveHostShopManager({
  visible,
  sessionId,
  onClose,
  onChanged,
}: {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets(),
    [items, setItems] = useState<LiveProductCandidate[]>([]),
    [cursor, setCursor] = useState<LiveCandidateCursor | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<string | null>(null),
    [busyIds, setBusyIds] = useState(new Set<string>()),
    inFlight = useRef(false);
  const merge = useCallback(
    (incoming: LiveProductCandidate[], replace: boolean) =>
      setItems((current) => {
        const map = new Map(
          (replace ? [] : current).map((item) => [item.productId, item]),
        );
        incoming.forEach((item) => map.set(item.productId, item));
        return [...map.values()];
      }),
    [],
  );
  const load = useCallback(
    async (mode: "initial" | "more" | "refresh") => {
      if (inFlight.current || (mode === "more" && !cursor)) return;
      inFlight.current = true;
      if (mode === "initial") setLoading(true);
      else if (mode === "more") setMore(true);
      else setRefreshing(true);
      setError(null);
      try {
        const page = await fetchMyLiveProductCandidates(
          sessionId,
          PAGE_SIZE,
          mode === "more" ? (cursor ?? undefined) : undefined,
        );
        merge(page.items, mode !== "more");
        setCursor(page.nextCursor);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        inFlight.current = false;
        setLoading(false);
        setMore(false);
        setRefreshing(false);
      }
    },
    [cursor, merge, sessionId],
  );
  useEffect(() => {
    if (visible) {
      setItems([]);
      setCursor(null);
      setQuery("");
      void load("initial");
    }
  }, [visible, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = async (
    item: LiveProductCandidate,
    kind: "pin" | "unpin" | "feature",
  ) => {
    if (busyIds.has(item.productId)) return;
    setBusyIds((current) => new Set(current).add(item.productId));
    setError(null);
    try {
      if (kind === "pin")
        await pinLiveProduct(sessionId, item.productId, null, randomUUID());
      else if (kind === "unpin" && item.pinId)
        await unpinLiveProduct(sessionId, item.pinId, randomUUID());
      else if (item.pinId)
        await featureLiveProduct(sessionId, item.pinId, randomUUID());
      await load("refresh");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(item.productId);
        return next;
      });
    }
  };
  const visibleItems = query.trim()
      ? items.filter((item) =>
          item.title
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
      : items,
    featured = items.find((item) => item.isFeatured),
    pinnedCount = items.filter((item) => item.isPinned).length;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <BottomSheetSurface
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.flex}>
              <OnSpaceText variant="headingMedium">Tienda del LIVE</OnSpaceText>
              <OnSpaceText variant="bodySmall" color="textMuted">
                {pinnedCount}/20 productos activos
              </OnSpaceText>
            </View>
            <IconButton
              icon="close"
              label="Cerrar administrador"
              onPress={onClose}
            />
          </View>
          {featured ? (
            <View style={styles.featured}>
              <ProductThumbnail uri={featured.imageUrl} size="small" />
              <View style={styles.flex}>
                <OnSpaceText variant="caption" color="brandHighlight">
                  Producto destacado
                </OnSpaceText>
                <OnSpaceText variant="labelStrong" numberOfLines={1}>
                  {featured.title}
                </OnSpaceText>
              </View>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Buscar productos"
            placeholder="Buscar productos"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            style={styles.search}
          />
          {error ? (
            <ErrorState
              title="Tienda no disponible"
              body={error}
              onRetry={() => void load("refresh")}
            />
          ) : loading ? (
            <View style={styles.loading}>
              {[0, 1, 2].map((value) => (
                <Skeleton key={value} style={styles.skeleton} />
              ))}
            </View>
          ) : (
            <FlatList
              data={visibleItems}
              keyExtractor={(item) => item.productId}
              renderItem={({ item }) => (
                <HostProductRow
                  item={item}
                  busy={busyIds.has(item.productId)}
                  onAction={(kind) => void mutate(item, kind)}
                />
              )}
              onEndReached={() => {
                if (cursor && !more) void load("more");
              }}
              onEndReachedThreshold={0.35}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void load("refresh")}
                  tintColor={colors.brandHighlight}
                />
              }
              ListEmptyComponent={
                <EmptyState
                  title="No hay productos elegibles"
                  body="Publica productos físicos con inventario para agregarlos al LIVE."
                />
              }
              ListFooterComponent={
                more ? (
                  <ActivityIndicator color={colors.brandHighlight} />
                ) : cursor ? null : visibleItems.length ? (
                  <OnSpaceText
                    variant="caption"
                    color="textMuted"
                    style={styles.end}
                  >
                    Llegaste al final
                  </OnSpaceText>
                ) : null
              }
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews
            />
          )}
        </BottomSheetSurface>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  sheet: { height: "84%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  flex: { flex: 1 },
  featured: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "rgba(128,104,255,.13)",
    marginBottom: spacing.md,
  },
  search: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.backgroundElevated,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  rowBody: { flex: 1, gap: spacing.xs },
  titleLine: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  meta: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  modeLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  loading: { gap: spacing.md },
  skeleton: { height: 96 },
  end: { textAlign: "center", padding: spacing.lg },
});
