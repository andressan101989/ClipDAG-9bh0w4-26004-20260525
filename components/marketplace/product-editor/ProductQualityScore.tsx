import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing } from "@/constants/theme";
import type { MarketplaceProductQuality } from "@/services/marketplaceProductQuality";
export function ProductQualityScore({
  quality,
}: {
  quality: MarketplaceProductQuality;
}) {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View>
          <Text style={s.label}>Calidad del producto</Text>
          <Text style={s.level}>{quality.level}</Text>
        </View>
        <Text style={s.score}>{quality.score}/100</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${quality.score}%` }]} />
      </View>
      {quality.suggestions.slice(0, 3).map((x) => (
        <Text key={x} style={s.tip}>
          • {x}
        </Text>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: Colors.textPrimary, fontWeight: "800", fontSize: 16 },
  level: { color: Colors.textSecondary },
  score: { fontSize: 24, fontWeight: "900", color: Colors.primaryLight },
  track: {
    height: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: Colors.border,
  },
  fill: { height: 8, backgroundColor: Colors.primary },
  tip: { color: Colors.textSecondary, fontSize: 13 },
});
