import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import {
  fetchSellerReturns,
  type MarketplaceSellerReturnPage,
  type MarketplaceSellerReturnSummary,
} from "@/services/marketplaceFulfillmentService";

const PAGE = 20;

/* eslint-disable react-hooks/exhaustive-deps -- focus refresh resets the canonical inbox */
export default function SellerReturns() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lock = useRef(false);
  const generation = useRef(0);
  const [items, setItems] = useState<MarketplaceSellerReturnSummary[]>([]);
  const [summary, setSummary] = useState({ attention: 0, requested: 0, approved: 0 });
  const [next, setNext] = useState<MarketplaceSellerReturnPage["nextCursor"]>(null);
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
        const page = await fetchSellerReturns({
          limit: PAGE,
          cursor: mode === "append" ? (next ?? undefined) : undefined,
        });
        if (token !== generation.current) return;
        setItems((current) =>
          mode === "append"
            ? [...new Map([...current, ...page.returns].map((item) => [item.id, item])).values()]
            : page.returns,
        );
        setSummary({
          attention: page.attentionCount,
          requested: page.requestedCount,
          approved: page.approvedCount,
        });
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
    [items.length, next],
  );

  useFocusEffect(
    useCallback(() => {
      generation.current++;
      setItems([]);
      setNext(null);
      void load();
    }, []),
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Devoluciones" fallbackRoute="/seller" />
      {loading ? (
        <ActivityIndicator style={styles.center} color={Colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={() => {
            if (next && !more) void load("append");
          }}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryNumber}>{summary.attention}</Text>
              <View style={styles.flex}>
                <Text style={styles.title}>
                  {summary.attention === 1
                    ? "Solicitud pendiente"
                    : "Solicitudes pendientes"}
                </Text>
                <Text style={styles.muted}>
                  {summary.requested} por decidir · {summary.approved} aceptadas
                </Text>
              </View>
            </View>
          }
          ListFooterComponent={more ? <ActivityIndicator color={Colors.primary} /> : null}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load()}
              tintColor={Colors.primary}
            />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialIcons
                name={error ? "error-outline" : "assignment-turned-in"}
                size={38}
                color={error ? Colors.error : Colors.accent}
              />
              <Text style={styles.title}>
                {error
                  ? "No pudimos cargar las devoluciones"
                  : "Sin solicitudes pendientes"}
              </Text>
              {error ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.retry}
                  onPress={() => void load()}
                >
                  <Text style={styles.retryText}>Reintentar</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <ReturnCard
              item={item}
              open={() => router.push(`/seller/orders/${item.orderId}` as never)}
            />
          )}
        />
      )}
    </View>
  );
}

function ReturnCard({
  item,
  open,
}: {
  item: MarketplaceSellerReturnSummary;
  open: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir solicitud de devolución del pedido ${item.orderNumber}. Decisión pendiente`}
      style={styles.card}
      onPress={open}
    >
      <View style={styles.cardHeader}>
        <View style={styles.alertDot} />
        <Text style={styles.order} numberOfLines={1}>
          {item.orderNumber}
        </Text>
        <Text style={styles.status}>Solicitada</Text>
      </View>
      <Text style={styles.reason}>El comprador solicitó devolver este pedido.</Text>
      <Text style={styles.pending}>Decisión pendiente</Text>
      <Text style={styles.muted}>
        Solicitada el {new Date(item.createdAt).toLocaleDateString()}
      </Text>
      <MaterialIcons
        name="chevron-right"
        size={22}
        color={Colors.textSecondary}
        style={styles.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  list: { padding: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  center: {
    flex: 1,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: "#FFB80044",
  },
  summaryNumber: {
    color: Colors.warning,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
  },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  muted: { color: Colors.textSecondary, fontSize: FontSize.xs },
  flex: { flex: 1 },
  card: {
    position: "relative",
    padding: Spacing.md,
    gap: 7,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 28 },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  order: { flex: 1, color: Colors.textPrimary, fontWeight: FontWeight.extrabold },
  status: { color: Colors.warning, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  reason: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  pending: { color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  chevron: { position: "absolute", right: 12, top: 42 },
  retry: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  retryText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
});
