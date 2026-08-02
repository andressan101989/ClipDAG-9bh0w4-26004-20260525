import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { OnSpaceText } from "@/components/design";
import { colors, radii, spacing } from "@/design";
import type { MarketplaceProductDetail } from "@/services/marketplaceService";
import {
  isOptionValueSelectable,
  type MarketplaceVariantSelection,
} from "@/services/marketplaceVariantSelection";

export function LiveVariantSelector({
  detail,
  selection,
  onSelect,
}: {
  detail: MarketplaceProductDetail;
  selection: MarketplaceVariantSelection;
  onSelect: (optionId: string, valueId: string) => void;
}) {
  return (
    <View style={styles.container}>
      {detail.options.map((option) => (
        <View key={option.id} style={styles.option}>
          <OnSpaceText variant="labelStrong">{option.name}</OnSpaceText>
          <View style={styles.values}>
            {option.values.map((value) => {
              const disabled = !isOptionValueSelectable(
                  detail.variants,
                  value.id,
                  selection,
                  option.id,
                ),
                selected = selection[option.id] === value.id;
              return (
                <Pressable
                  key={value.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.name}: ${value.value}`}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onSelect(option.id, value.id);
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.selected,
                    disabled && styles.disabled,
                    pressed && !disabled && styles.pressed,
                  ]}
                >
                  <OnSpaceText
                    variant="label"
                    color={disabled ? "textMuted" : "textPrimary"}
                  >
                    {value.value}
                  </OnSpaceText>
                  {selected ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  option: { gap: spacing.sm },
  values: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderElevated,
    backgroundColor: colors.backgroundElevated,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  selected: {
    borderColor: colors.brandHighlight,
    backgroundColor: "rgba(128,104,255,.20)",
  },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandHighlight,
  },
});
