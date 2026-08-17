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
}: {
  hostName: string;
  viewerCount: number;
  elapsed: string;
  onClose: () => void;
  commerceSummary?: string;
  hostV3?: boolean;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 370;
  return (
    <View style={[s.row, hostV3 && s.hostRow, compact && hostV3 && s.compactHostRow]} accessibilityLabel={`EN VIVO con ${hostName}`}>
      <View style={[s.avatar, hostV3 && s.hostAvatar]}>
        <OnSpaceText variant="labelStrong" color={hostV3 ? "textPrimary" : "textInverse"}>
          {hostName.charAt(0).toUpperCase()}
        </OnSpaceText>
      </View>
      <View style={[s.identity, hostV3 && s.hostIdentity]}>
        <OnSpaceText
          variant="labelStrong"
          color="textInverse"
          numberOfLines={1}
        >
          {hostName}
        </OnSpaceText>
        {commerceSummary ? (
          <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>
            {commerceSummary}
          </OnSpaceText>
        ) : null}
      </View>
      <View style={s.live}>
        <View style={s.dot} />
        <OnSpaceText variant="caption" color={hostV3 ? "textPrimary" : "textInverse"}>
          EN VIVO
        </OnSpaceText>
      </View>
      {hostV3 ? (
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
        style={[s.close, hostV3 && s.hostClose]}
      >
        <MaterialIcons name="close" size={21} color={hostV3 ? colors.textPrimary : colors.textInverse} />
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
  compactHostRow: { gap: 4, paddingHorizontal: 7 },
  hostAvatar: { width: 36, height: 36, borderRadius: 18 },
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
});
