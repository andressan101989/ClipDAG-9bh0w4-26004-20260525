import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors, layout, motion, opacity, radii, spacing } from "@/design";
import { OnSpaceText } from "./OnSpaceText";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "commerce"
  | "glass";
export type ButtonSize = "small" | "medium" | "large";
export interface OnSpaceButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
  haptic?: "selection" | "impact" | "none";
  leftAccessory?: React.ReactNode;
}

export function OnSpaceButton({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
  haptic = "selection",
  leftAccessory,
}: OnSpaceButtonProps) {
  const [pressed, setPressed] = useState(false),
    blocked = disabled || loading;
  const handlePress = () => {
    if (blocked) return;
    if (haptic === "selection") void Haptics.selectionAsync();
    else if (haptic === "impact")
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.base,
        styles[size],
        styles[variant],
        blocked && styles.disabled,
        pressed && !blocked && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === "secondary" || variant === "ghost"
              ? colors.textPrimary
              : colors.textInverse
          }
        />
      ) : (
        <View style={styles.content}>
          {leftAccessory}
          <OnSpaceText
            variant="labelStrong"
            color={
              variant === "secondary" ||
              variant === "ghost" ||
              variant === "glass" ||
              variant === "destructive"
                ? "textPrimary"
                : "textInverse"
            }
            numberOfLines={1}
          >
            {label}
          </OnSpaceText>
        </View>
      )}
    </Pressable>
  );
}
export const LoadingButton = OnSpaceButton;
const styles = StyleSheet.create({
  base: {
    minHeight: layout.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  small: { minHeight: 44, paddingHorizontal: spacing.lg },
  medium: { minHeight: 50, paddingHorizontal: spacing.xl },
  large: { minHeight: 56, paddingHorizontal: spacing.xxl },
  primary: { backgroundColor: colors.brandHighlight },
  secondary: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.borderElevated,
  },
  ghost: { backgroundColor: colors.transparent },
  destructive: { backgroundColor: "#A82E48" },
  commerce: { backgroundColor: colors.commerceAccent },
  glass: {
    backgroundColor: colors.backgroundGlass,
    borderWidth: 1,
    borderColor: colors.borderElevated,
  },
  disabled: { opacity: opacity.disabled },
  pressed: {
    transform: [{ scale: motion.pressedScale }],
    opacity: opacity.pressed,
  },
});
