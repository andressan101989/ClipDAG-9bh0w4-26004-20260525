import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
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
  fetchMyAdCampaignDetail,
  pauseAdCampaign,
  resumeAdCampaign,
  type AdCampaign,
} from "@/services/marketplaceAdsService";
export default function AdDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    insets = useSafeAreaInsets(),
    [row, setRow] = useState<AdCampaign | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => setRow(await fetchMyAdCampaignDetail(id)),
    [id],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const toggle = async () => {
    if (!row) return;
    setBusy(true);
    try {
      if (row.status === "paused") await resumeAdCampaign(row.id);
      else await pauseAdCampaign(row.id);
      await load();
    } finally {
      setBusy(false);
    }
  };
  if (!row)
    return (
      <View style={[s.page, { paddingTop: insets.top }]}>
        <SellerScreenHeader title="Campaña" fallbackRoute="/seller/ads" />
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  const ctr = row.impressions ? (row.clicks / row.impressions) * 100 : 0,
    roas = row.spent ? row.gmv / row.spent : null;
  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Campaña" fallbackRoute="/seller/ads" />
      <View style={s.body}>
        <Text style={s.title}>{row.product_title}</Text>
        <Text style={s.status}>{row.status}</Text>
        <Text style={s.money}>
          {Number(row.spent).toFixed(2)} / {Number(row.budget).toFixed(2)} BDAG
        </Text>
        <Text style={s.meta}>
          Disponible: {Number(row.remaining).toFixed(2)} BDAG · Entrega
          elegible: {Math.floor(row.eligible_elapsed_seconds / 60)} min
        </Text>
        <View style={s.grid}>
          {[
            ["Impresiones", row.impressions],
            ["Clics", row.clicks],
            ["Visitas", row.product_views],
            ["Carritos", row.cart_adds],
            ["Pedidos", row.orders],
            ["GMV", Number(row.gmv).toFixed(2)],
            ["CTR", ctr.toFixed(2) + "%"],
            ["ROAS", roas == null ? "—" : roas.toFixed(2)],
          ].map(([k, v]) => (
            <View key={String(k)} style={s.metric}>
              <Text style={s.value}>{v}</Text>
              <Text style={s.label}>{k}</Text>
            </View>
          ))}
        </View>
        {["active", "scheduled", "paused"].includes(row.status) ? (
          <Pressable
            disabled={busy}
            style={s.button}
            onPress={() => void toggle()}
          >
            <Text style={s.buttonText}>
              {row.status === "paused" ? "Reanudar" : "Pausar"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  body: { padding: Spacing.md, gap: Spacing.md },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  status: { color: Colors.primaryLight, fontWeight: FontWeight.bold },
  money: {
    color: Colors.textPrimary,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
  },
  meta: { color: Colors.textSecondary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: {
    width: "47%",
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  value: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  label: { color: Colors.textSecondary },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  buttonText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
});
