import React from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { LoadingButton, OnSpaceText } from "@/components/design";
import { colors, radii, spacing } from "@/design";
import type { ShippingAddressInput } from "@/services/marketplaceOrderService";

const fields: [keyof ShippingAddressInput, string, string][] = [
  ["recipientName", "Persona que recibe", "Nombre completo"],
  ["line1", "Dirección", "Calle y número"],
  ["city", "Ciudad", "Ciudad"],
  ["region", "Estado o provincia", "Región"],
  ["postalCode", "Código postal", "Código postal"],
  ["country", "País", "País"],
  ["phone", "Teléfono", "Opcional"],
];
export function LiveShippingForm({
  value,
  errors = {},
  busy,
  onChange,
  onSubmit,
}: {
  value: ShippingAddressInput;
  errors?: Partial<Record<keyof ShippingAddressInput, string>>;
  busy: boolean;
  onChange: (value: ShippingAddressInput) => void;
  onSubmit: () => void;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View>
        <OnSpaceText variant="headingMedium">¿Dónde lo entregamos?</OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textSecondary">
          Tu dirección se protege dentro del pedido y no se comparte en el LIVE.
        </OnSpaceText>
      </View>
      {fields.map(([key, label, placeholder]) => (
        <View key={key} style={styles.field}>
          <OnSpaceText variant="label" color="textSecondary">
            {label}
          </OnSpaceText>
          <TextInput
            accessibilityLabel={label}
            value={value[key] ?? ""}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            onChangeText={(text) => onChange({ ...value, [key]: text })}
            style={[styles.input, errors[key] && styles.inputError]}
          />
          <OnSpaceText variant="caption" color="textDanger">
            {errors[key] ?? " "}
          </OnSpaceText>
        </View>
      ))}
      <LoadingButton
        label="Revisar pedido"
        variant="commerce"
        size="large"
        loading={busy}
        onPress={onSubmit}
      />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.jumbo },
  field: { gap: spacing.xs },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: spacing.lg,
    color: colors.textPrimary,
    fontSize: 16,
  },
  inputError: { borderColor: colors.textDanger },
});
