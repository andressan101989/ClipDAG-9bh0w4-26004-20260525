import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { OnSpaceText } from "@/components/design";
import { colors, layout, radii, shadows } from "@/design";

export function LiveCommerceButton({
  count,
  onPress,
  disabled = false,
  label = "Abrir productos del LIVE",
  textLabel,
  compact = false,
}: {
  count: number;
  onPress: () => void;
  disabled?: boolean;
  label?: string;
  textLabel?: string;
  compact?: boolean;
}) {
  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${count} productos`}
      accessibilityState={{ disabled }}
      hitSlop={6}
    >
      <MaterialIcons name="shopping-bag" size={23} color={compact ? colors.textPrimary : colors.textInverse} />
      {textLabel && !compact ? (
        <OnSpaceText variant="caption" color="textInverse">
          {textLabel}
        </OnSpaceText>
      ) : null}
      {count > 0 ? (
        <View style={styles.badge}>
          <OnSpaceText
            variant="caption"
            color="textInverse"
            style={styles.count}
          >
            {count > 99 ? "99+" : count}
          </OnSpaceText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: layout.minimumTouchTarget + 8,
    paddingHorizontal: 10,
    height: layout.minimumTouchTarget + 8,
    borderRadius: radii.pill,
    backgroundColor: colors.backgroundGlass,
    borderWidth: 1,
    borderColor: colors.borderElevated,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    ...shadows.floating,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: colors.backgroundElevated,
  },
  compact: {
    minWidth: 46,
    width: 46,
    height: 46,
    paddingHorizontal: 0,
  },
  badge: {
    position: "absolute",
    right: -2,
    top: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.commerceAccent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.backgroundPrimary,
  },
  count: { fontWeight: "800" },
  disabled: { opacity: 0.45 },
});
