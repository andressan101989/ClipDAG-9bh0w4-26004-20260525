import React, { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radii, spacing } from "@/design";
import { OnSpaceButton } from "./OnSpaceButton";
import { OnSpaceText } from "./OnSpaceText";

export function Badge({
  label,
  tone = "brand",
}: {
  label: string;
  tone?: "brand" | "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <View style={[styles.badge, styles[`${tone}Badge`]]}>
      <OnSpaceText variant="caption" color="textPrimary">
        {label}
      </OnSpaceText>
    </View>
  );
}
export const StatusPill = Badge;
export function Skeleton({ style }: { style?: ViewStyle }) {
  const reduced = useReducedMotion(),
    opacity = useSharedValue(0.4);
  useEffect(() => {
    if (!reduced)
      opacity.value = withRepeat(withTiming(0.88, { duration: 850 }), -1, true);
  }, [opacity, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      accessibilityLabel="Cargando"
      style={[styles.skeleton, animated, style]}
    />
  );
}
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.state}>
      <MaterialIcons name="shopping-bag" size={34} color={colors.textMuted} />
      <OnSpaceText variant="headingSmall">{title}</OnSpaceText>
      <OnSpaceText
        variant="bodySmall"
        color="textSecondary"
        style={styles.center}
      >
        {body}
      </OnSpaceText>
      {actionLabel && onAction ? (
        <OnSpaceButton
          label={actionLabel}
          variant="secondary"
          size="small"
          onPress={onAction}
        />
      ) : null}
    </View>
  );
}
export function ErrorState({
  title = "No pudimos cargar",
  body,
  onRetry,
}: {
  title?: string;
  body: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.state}>
      <MaterialIcons name="error-outline" size={34} color={colors.textDanger} />
      <OnSpaceText variant="headingSmall">{title}</OnSpaceText>
      <OnSpaceText
        variant="bodySmall"
        color="textSecondary"
        style={styles.center}
      >
        {body}
      </OnSpaceText>
      <OnSpaceButton
        label="Reintentar"
        variant="secondary"
        size="small"
        onPress={onRetry}
      />
    </View>
  );
}
export function ToastCard({
  title,
  body,
  tone = "success",
}: {
  title: string;
  body: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.toast, styles[`${tone}Toast`]]}
    >
      <OnSpaceText variant="labelStrong">{title}</OnSpaceText>
      <OnSpaceText variant="bodySmall" color="textSecondary">
        {body}
      </OnSpaceText>
    </View>
  );
}
export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <OnSpaceText variant="metric">{value}</OnSpaceText>
      <OnSpaceText variant="caption" color="textMuted">
        {label}
      </OnSpaceText>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  brandBadge: { backgroundColor: "rgba(128,104,255,.30)" },
  successBadge: { backgroundColor: "rgba(77,219,162,.22)" },
  warningBadge: { backgroundColor: "rgba(255,212,119,.22)" },
  dangerBadge: { backgroundColor: "rgba(255,93,120,.22)" },
  neutralBadge: { backgroundColor: "rgba(255,255,255,.10)" },
  skeleton: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: radii.md,
  },
  state: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xxl,
  },
  center: { textAlign: "center" },
  toast: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: colors.backgroundGlass,
  },
  successToast: { borderColor: "rgba(77,219,162,.42)" },
  warningToast: { borderColor: "rgba(255,212,119,.42)" },
  dangerToast: { borderColor: "rgba(255,93,120,.42)" },
  metric: {
    minWidth: 108,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundElevated,
    gap: spacing.xs,
  },
});
