import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  fetchSellerOrders,
  type MarketplaceOrderListItem,
  type MarketplaceOrderPage,
  type MarketplaceOrderStatus,
} from "@/services/marketplaceFulfillmentService";
import { formatBDAG, formatMetricCount } from "@/services/marketplaceSellerCenterCore.mjs";
import { StatusBadge } from "@/components/marketplace/OrderStatus";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import { formatOrderNumberForList } from "@/services/marketplaceOrderPresentation";

/* eslint-disable react-hooks/exhaustive-deps -- focus refresh keys only on the selected server status */
const PAGE = 20;
const COMPACT_BREAKPOINT = 390;
const ICON_ONLY_STATUS_BREAKPOINT = 350;

type OrderFilter = {
  accessibilityLabel: string;
  compactLabel: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  value: MarketplaceOrderStatus | null;
};

const filters: OrderFilter[] = [
  {
    accessibilityLabel: "Todos los pedidos",
    compactLabel: "Todos",
    icon: "grid-view",
    label: "Todos",
    value: null,
  },
  {
    accessibilityLabel: "Pedidos por preparar",
    compactLabel: "Prep.",
    icon: "inventory-2",
    label: "Por preparar",
    value: "confirmed",
  },
  {
    accessibilityLabel: "Pedidos en preparación",
    compactLabel: "Proceso",
    icon: "pending-actions",
    label: "En preparación",
    value: "processing",
  },
  {
    accessibilityLabel: "Pedidos enviados",
    compactLabel: "Envío",
    icon: "local-shipping",
    label: "Enviados",
    value: "shipped",
  },
  {
    accessibilityLabel: "Pedidos entregados",
    compactLabel: "OK",
    icon: "task-alt",
    label: "Entregados",
    value: "delivered",
  },
];

export default function SellerOrders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_BREAKPOINT;
  const iconOnlyStatus = width < ICON_ONLY_STATUS_BREAKPOINT;
  const lock = useRef(false);
  const generation = useRef(0);
  const [status, setStatus] = useState<MarketplaceOrderStatus | null>(null);
  const [items, setItems] = useState<MarketplaceOrderListItem[]>([]);
  const [next, setNext] = useState<MarketplaceOrderPage["nextCursor"]>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (mode: "replace" | "append" = "replace") => {
      if (mode === "append" && lock.current) return;
      if (mode === "append") lock.current = true;
      const token = ++generation.current;
      if (mode === "append") setMore(true);
      else if (items.length) setRefreshing(true);
      else setLoading(true);
      try {
        const page = await fetchSellerOrders({
          status,
          limit: PAGE,
          cursor: mode === "append" ? (next ?? undefined) : undefined,
        });
        if (token !== generation.current) return;
        setItems((old) =>
          mode === "append"
            ? [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()]
            : page.items,
        );
        setNext(page.nextCursor);
        setError(false);
      } catch {
        if (token === generation.current) setError(true);
      } finally {
        if (mode === "append") lock.current = false;
        setLoading(false);
        setRefreshing(false);
        setMore(false);
      }
    },
    [items.length, next, status],
  );

  useFocusEffect(
    useCallback(() => {
      generation.current++;
      setItems([]);
      setNext(null);
      void load();
    }, [status]),
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Pedidos" fallbackRoute="/seller" />
      <ScrollView
        accessibilityRole="tablist"
        contentContainerStyle={s.filters}
        directionalLockEnabled
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={s.filterRail}
      >
        {filters.map((filter) => {
          const selected = status === filter.value;
          return (
            <Pressable
              accessibilityLabel={filter.accessibilityLabel}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={filter.accessibilityLabel}
              onPress={() => {
                if (status !== filter.value) {
                  generation.current++;
                  setStatus(filter.value);
                }
              }}
              style={[s.chip, selected && s.on]}
            >
              <MaterialIcons
                name={filter.icon}
                size={compact ? 17 : 18}
                color={selected ? Colors.textOnBrand : Colors.textSecondary}
              />
              <Text style={[s.chipText, selected && s.chipTextOn]}>
                {compact ? filter.compactLabel : filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {loading ? (
        <ActivityIndicator style={s.center} color={Colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={() => {
            if (next && !more) void load("append");
          }}
          ListFooterComponent={more ? <ActivityIndicator color={Colors.primary} /> : null}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load()}
              tintColor={Colors.primary}
            />
          }
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.center}>
              <MaterialIcons name="receipt-long" size={36} color={Colors.textSubtle} />
              <Text style={s.emptyTitle}>
                {error ? "No pudimos cargar los pedidos" : "Aún no tienes pedidos"}
              </Text>
              {error ? (
                <Pressable accessibilityRole="button" style={s.retry} onPress={() => void load()}>
                  <Text style={s.retryText}>Reintentar</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver pedido ${item.orderNumber}${item.activeDispute ? item.activeDispute.status === "open" ? ". Este pedido tiene una disputa abierta" : ". Este pedido tiene una disputa en revisión" : ""}${item.activeReturnRequest ? ". Este pedido tiene una solicitud de devolución pendiente" : ""}`}
              style={[s.card, compact && s.cardCompact]}
              onPress={() => router.push(`/seller/orders/${item.id}` as never)}
            >
              {item.firstItemImage ? (
                <Image source={{ uri: item.firstItemImage }} style={[s.image, compact && s.imageCompact]} />
              ) : (
                <View style={[s.image, compact && s.imageCompact, s.imageEmpty]}>
                  <MaterialIcons name="inventory-2" size={compact ? 22 : 24} color={Colors.textSubtle} />
                </View>
              )}
              <View style={s.cardContent}>
                <View style={s.cardHeader}>
                  <Text style={s.orderNumber} numberOfLines={1} ellipsizeMode="middle">
                    {formatOrderNumberForList(item.orderNumber)}
                  </Text>
                  <View style={s.statusSlot}>
                    <StatusBadge
                      status={item.status}
                      compact={compact}
                      showLabel={!iconOnlyStatus}
                    />
                  </View>
                </View>
                <Text style={s.product} numberOfLines={1}>
                  {item.firstItemTitle ?? "Pedido Marketplace"}
                </Text>
                {item.activeDispute ? (
                  <View style={s.disputeAlert}>
                    <View style={s.disputeDot} />
                    <Text style={s.disputeText} numberOfLines={1}>
                      {item.activeDispute.status === "open" ? "Disputa abierta" : "Disputa en revisión"}
                      {item.activeDispute.sellerResponseSubmitted ? " · Respondida" : " · Respuesta pendiente"}
                    </Text>
                  </View>
                ) : null}
                {item.activeReturnRequest ? (
                  <View style={s.disputeAlert}>
                    <View style={s.disputeDot} />
                    <Text style={s.disputeText} numberOfLines={1}>
                      Solicitud de devolución · Decisión pendiente
                    </Text>
                  </View>
                ) : null}
                <Text style={s.muted} numberOfLines={1}>
                  {formatMetricCount(item.totalQuantity)} unidades ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </Text>
                <Text style={s.total} numberOfLines={1}>
                  Total · {formatBDAG(item.total)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  filterRail: { flexGrow: 0 },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
  },
  on: { backgroundColor: Colors.primary },
  chipText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  chipTextOn: { color: Colors.textOnBrand },
  list: { padding: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  card: {
    padding: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  cardCompact: { padding: 12, gap: Spacing.sm },
  image: {
    width: 72,
    height: 72,
    flexShrink: 0,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
  },
  imageCompact: { width: 64, height: 64 },
  imageEmpty: { alignItems: "center", justifyContent: "center" },
  cardContent: { flex: 1, minWidth: 0, gap: 5 },
  cardHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  orderNumber: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    color: Colors.textPrimary,
    fontWeight: FontWeight.extrabold,
    fontVariant: ["tabular-nums"],
  },
  statusSlot: { flexShrink: 0 },
  product: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  disputeAlert: { flexDirection: "row", alignItems: "center", gap: 6 },
  disputeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  disputeText: { flex: 1, color: Colors.warning, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  muted: { color: Colors.textSecondary, fontSize: FontSize.xs },
  total: { color: Colors.accent, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  emptyTitle: { color: Colors.textPrimary, fontWeight: FontWeight.extrabold },
  retry: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  retryText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
});
