import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Colors, Radius, Spacing } from "@/constants/theme";
export function EditorCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      {children}
    </View>
  );
}
export function EditorField({
  label,
  value,
  onChange,
  multiline = false,
  keyboardType = "default",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  hint?: string;
}) {
  return (
    <View style={s.field}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[s.input, multiline && s.multiline]}
        placeholderTextColor={Colors.textSubtle}
      />
    </View>
  );
}
export function Choice({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, selected && s.selected, disabled && s.disabled]}
    >
      <Text style={[s.choiceText, selected && s.selectedText]}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  card: {
    padding: Spacing.md,
    gap: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { fontSize: 19, fontWeight: "800", color: Colors.textPrimary },
  field: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: Colors.textPrimary, fontWeight: "700" },
  hint: { color: Colors.textSubtle, fontSize: 12 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    color: Colors.textPrimary,
    backgroundColor: Colors.bg,
  },
  multiline: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  disabled: { opacity: 0.4 },
  choiceText: { color: Colors.textSecondary, fontWeight: "600" },
  selectedText: { color: "#fff" },
});
