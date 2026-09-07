import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { OnSpaceText } from "@/components/design";
import { colors, radii, shadows, spacing } from "@/design";

export function LiveSessionHeader({
  hostName,
  viewerCount,
  elapsed,
  onClose,
  commerceSummary,
  hostV3 = false,
  hostV4 = false,
  battleMode = false,
}: {
  hostName: string;
  viewerCount: number;
  elapsed: string;
  onClose: () => void;
  commerceSummary?: string;
  hostV3?: boolean;
  hostV4?: boolean;
  battleMode?: boolean;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 370;
  const premiumHost = hostV3 || hostV4;
  if (battleMode) {
    return (
      <View style={s.battleRow} accessibilityLabel={`EN VIVO con ${hostName}`}>
        <View style={s.battleLivePill}>
          <OnSpaceText variant="caption" color="textInverse" style={s.battlePillText}>EN VIVO</OnSpaceText>
        </View>
        <View style={s.battleMetricPill}>
          <MaterialIcons name="visibility" size={12} color={colors.textInverse} />
          <OnSpaceText variant="caption" color="textInverse" style={s.battlePillText}>
            {viewerCount.toLocaleString()}
          </OnSpaceText>
        </View>
        <View style={s.battleDurationPill}>
          <OnSpaceText variant="caption" color="textInverse" style={s.battlePillText}>{elapsed}</OnSpaceText>
        </View>
        <View style={s.battleSpacer} />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar LIVE"
          style={s.battleCloseTarget}
        >
          <View style={s.battleCloseCircle}>
            <MaterialIcons name="close" size={20} color={colors.textInverse} />
          </View>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[s.row, premiumHost && s.hostRow, hostV4 && s.hostV4Row, compact && premiumHost && s.compactHostRow]} accessibilityLabel={`EN VIVO con ${hostName}`}>
      <View style={[s.avatar, premiumHost && s.hostAvatar, hostV4 && s.hostV4Avatar]}>
        <OnSpaceText variant="labelStrong" color={premiumHost ? "textPrimary" : "textInverse"}>
          {hostName.charAt(0).toUpperCase()}
        </OnSpaceText>
      </View>
      <View style={[s.identity, premiumHost && s.hostIdentity]}>
        <OnSpaceText
          variant="labelStrong"
          color="textInverse"
          numberOfLines={1}
        >
          {hostName}
        </OnSpaceText>
        {hostV4 ? (
          <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
            Anfitrión
          </OnSpaceText>
        ) : null}
        {commerceSummary ? (
          <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
            {commerceSummary}
          </OnSpaceText>
        ) : null}
      </View>
      <View style={s.live}>
        <View style={s.dot} />
        <OnSpaceText variant="caption" color={premiumHost ? "textPrimary" : "textInverse"}>
          EN VIVO
        </OnSpaceText>
      </View>
      {premiumHost ? (
        <View style={s.hostMetrics}>
          <View style={s.metric}>
            <MaterialIcons name="visibility" size={12} color={colors.textPrimary} />
            <OnSpaceText variant="caption" color="textPrimary">{viewerCount.toLocaleString()}</OnSpaceText>
          </View>
          <View style={s.metric}>
            <MaterialIcons name="schedule" size={10} color={colors.textMuted} />
            <OnSpaceText variant="caption" color="textMuted">{elapsed}</OnSpaceText>
          </View>
        </View>
      ) : (
        <>
          <View style={s.metric}>
            <MaterialIcons name="visibility" size={14} color={colors.textInverse} />
            <OnSpaceText variant="caption" color="textInverse">{viewerCount.toLocaleString()}</OnSpaceText>
          </View>
          <View style={s.metric}>
            <MaterialIcons name="schedule" size={14} color={colors.textInverse} />
            <OnSpaceText variant="caption" color="textInverse">{elapsed}</OnSpaceText>
          </View>
        </>
      )}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cerrar LIVE"
        hitSlop={8}
        style={[s.close, premiumHost && s.hostClose]}
      >
        <MaterialIcons name="close" size={21} color={premiumHost ? colors.textPrimary : colors.textInverse} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(12,12,18,.72)",
    borderWidth: 1,
    borderColor: colors.borderElevated,
    ...shadows.floating,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
  },
  hostRow: { minHeight: 58, paddingHorizontal: 10, backgroundColor: "rgba(17,19,27,.94)", borderColor: "rgba(65,70,91,.72)" },
  hostV4Row: { borderRadius: 23, backgroundColor: "rgba(17,19,27,.92)", borderColor: "rgba(255,255,255,.14)" },
  compactHostRow: { gap: 4, paddingHorizontal: 7 },
  hostAvatar: { width: 36, height: 36, borderRadius: 18 },
  hostV4Avatar: { backgroundColor: "rgba(92,18,47,.92)", borderWidth: 1, borderColor: "rgba(255,61,141,.62)" },
  hostIdentity: { flexGrow: 1, flexBasis: 64 },
  identity: { flex: 1, minWidth: 0 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSecondary,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textInverse,
  },
  metric: { flexDirection: "row", alignItems: "center", gap: 3 },
  hostMetrics: { alignItems: "flex-start", justifyContent: "center", gap: 1 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.12)",
  },
  hostClose: { width: 36, height: 36, borderRadius: 18 },
  battleRow: {
    minHeight: 44,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "transparent",
  },
  battleLivePill: {
    width: 76,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(235,20,51,0.96)",
  },
  battleMetricPill: {
    minWidth: 72,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: "rgba(8,10,18,0.62)",
  },
  battleDurationPill: {
    minWidth: 64,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: "rgba(8,10,18,0.62)",
  },
  battlePillText: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  battleSpacer: { flex: 1 },
  battleCloseTarget: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  battleCloseCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,10,18,0.66)" },
});
