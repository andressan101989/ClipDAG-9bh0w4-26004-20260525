import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from "@/constants/theme";
import {
  fetchMyAdCampaigns,
  type AdCampaign,
} from "@/services/marketplaceAdsService";
const tabs = [
  ["active", "Activas"],
  ["scheduled", "Programadas"],
  ["paused", "Pausadas"],
  ["terminal", "Finalizadas"],
  ["", "Todas"],
] as const;
export default function AdsDashboard() {
  const router = useRouter(),
    insets = useSafeAreaInsets(),
    [tab, setTab] = useState(""),
    [rows, setRows] = useState<AdCampaign[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setRows(await fetchMyAdCampaigns(tab || undefined));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Ads" fallbackRoute="/seller" />
      <View style={s.head}>
        <View>
          <Text style={s.title}>Impulsa tus productos</Text>
          <Text style={s.sub}>Campañas prepagadas con entrega elegible</Text>
        </View>
        <Pressable
          style={s.cta}
          onPress={() => router.push("/seller/ads/create" as never)}
        >
          <Text style={s.ctaText}>Crear campaña</Text>
        </Pressable>
      </View>
      <View style={s.tabs}>
        {tabs.map(([key, label]) => (
          <Pressable
            key={key}
            style={[s.chip, tab === key && s.chipOn]}
            onPress={() => setTab(key)}
          >
            <Text style={s.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : error ? (
        <Pressable onPress={() => void load()}>
          <Text style={s.empty}>
            No pudimos cargar las campañas. Reintentar
          </Text>
        </Pressable>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <Text style={s.empty}>Aún no tienes campañas en este estado.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={s.card}
              onPress={() => router.push(("/seller/ads/" + item.id) as never)}
            >
              <Text style={s.name}>{item.product_title}</Text>
              <Text style={s.meta}>
                {item.status} · {Number(item.spent).toFixed(2)} /{" "}
                {Number(item.budget).toFixed(2)} BDAG
              </Text>
              <Text style={s.meta}>
                {item.impressions} impresiones · {item.clicks} clics ·{" "}
                {item.orders} pedidos
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  head: { padding: Spacing.md, gap: Spacing.md },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  sub: { color: Colors.textSecondary },
  cta: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: Radius.md,
  },
  ctaText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: Spacing.md,
  },
  chip: {
    padding: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipText: { color: Colors.textPrimary, fontSize: FontSize.xs },
  list: { padding: Spacing.md, gap: Spacing.sm, flexGrow: 1 },
  card: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  name: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  meta: { color: Colors.textSecondary, marginTop: 5 },
  empty: { color: Colors.textSecondary, textAlign: "center", padding: 40 },
});
