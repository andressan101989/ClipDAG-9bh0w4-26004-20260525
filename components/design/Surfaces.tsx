import React from "react";
import { Pressable, StyleSheet, View, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, layout, radii, shadows, spacing } from "@/design";

export const GlassSurface = ({ style, ...props }: ViewProps) => (
  <BlurView
    intensity={34}
    tint="dark"
    {...props}
    style={[styles.glass, style]}
  />
);
export const ElevatedSurface = ({ style, ...props }: ViewProps) => (
  <View {...props} style={[styles.elevated, style]} />
);
export const BottomSheetSurface = ({
  style,
  children,
  ...props
}: ViewProps) => (
  <View {...props} style={[styles.sheet, style]}>
    <View accessibilityElementsHidden style={styles.handle} />
    {children}
  </View>
);
export const Divider = () => <View style={styles.divider} />;
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <MaterialIcons name={icon} size={22} color={colors.textPrimary} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  glass: {
    backgroundColor: colors.backgroundGlass,
    borderWidth: 1,
    borderColor: colors.borderElevated,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  elevated: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.lg,
    ...shadows.elevated,
  },
  sheet: {
    width: "100%",
    maxWidth: layout.sheetMaxWidth,
    alignSelf: "center",
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    overflow: "hidden",
    ...shadows.floating,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.borderElevated,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
  },
  iconButton: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.08)",
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.42 },
});
