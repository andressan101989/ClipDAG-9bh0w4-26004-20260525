import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Colors, FontSize, Radius, Spacing } from "@/constants/theme";
import type { ShippingAddressInput } from "@/services/marketplaceOrderService";
import {
  MARKETPLACE_SHIPPING_COUNTRIES,
  shippingRegionsForCountry,
} from "@/services/marketplaceShippingSetup";
import { SearchableSelectField } from "./SearchableSelectField";

const textFields: {
  key: keyof Pick<
    ShippingAddressInput,
    "recipientName" | "line1" | "line2" | "city" | "postalCode"
  >;
  label: string;
  placeholder: string;
  optional?: boolean;
}[] = [
  { key: "recipientName", label: "Nombre completo", placeholder: "Nombre de quien recibe" },
  { key: "line1", label: "Dirección", placeholder: "Calle y número" },
  { key: "line2", label: "Apto / suite / etc.", placeholder: "Opcional", optional: true },
  { key: "city", label: "Ciudad", placeholder: "Ciudad" },
  { key: "postalCode", label: "Código postal", placeholder: "Código postal" },
];

export function CheckoutShippingAddressForm({
  value,
  errors = {},
  onChange,
}: {
  value: ShippingAddressInput;
  errors?: Partial<Record<keyof ShippingAddressInput, string>>;
  onChange: (value: ShippingAddressInput) => void;
}) {
  const regions = shippingRegionsForCountry(value.country);
  const update = (key: keyof ShippingAddressInput, next: string) =>
    onChange({ ...value, [key]: next });

  return (
    <View style={styles.content}>
      <View style={styles.noteRow}>
        <Text style={styles.noteIcon}>●</Text>
        <Text style={styles.note}>
          Toda la comunicación y actualizaciones del pedido se realizan dentro de la app.
        </Text>
      </View>
      <SearchableSelectField
        label="País o región"
        value={value.country}
        options={MARKETPLACE_SHIPPING_COUNTRIES.map(({ code, label }) => ({ value: code, label }))}
        searchLabel="Buscar país por nombre"
        onChange={(country) => onChange({ ...value, country, region: "" })}
      />
      {errors.country ? <Text style={styles.error}>{errors.country}</Text> : null}
      {textFields.slice(0, 4).map(({ key, label, placeholder, optional }) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}{optional ? " · Opcional" : ""}</Text>
          <TextInput
            accessibilityLabel={label}
            value={value[key] ?? ""}
            placeholder={placeholder}
            placeholderTextColor={Colors.textSubtle}
            onChangeText={(text) => update(key, text)}
            style={[styles.input, errors[key] && styles.inputError]}
          />
          {errors[key] ? <Text style={styles.error}>{errors[key]}</Text> : null}
        </View>
      ))}
      {regions.length ? (
        <View style={styles.field}>
          <SearchableSelectField
            label={value.country === "US" ? "Estado" : "Provincia"}
            value={value.region}
            options={regions.map(([regionValue, label]) => ({ value: regionValue, label }))}
            searchLabel={value.country === "US" ? "Buscar estado" : "Buscar provincia"}
            onChange={(region) => update("region", region)}
          />
          {errors.region ? <Text style={styles.error}>{errors.region}</Text> : null}
        </View>
      ) : (
        <View style={styles.field}>
          <Text style={styles.label}>Estado / Provincia</Text>
          <TextInput
            accessibilityLabel="Estado o provincia"
            value={value.region}
            placeholder="Estado, provincia o región"
            placeholderTextColor={Colors.textSubtle}
            onChangeText={(text) => update("region", text)}
            style={[styles.input, errors.region && styles.inputError]}
          />
          {errors.region ? <Text style={styles.error}>{errors.region}</Text> : null}
        </View>
      )}
      {textFields.slice(4).map(({ key, label, placeholder }) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={value[key] ?? ""}
            placeholder={placeholder}
            placeholderTextColor={Colors.textSubtle}
            onChangeText={(text) => update(key, text)}
            style={[styles.input, errors[key] && styles.inputError]}
          />
          {errors[key] ? <Text style={styles.error}>{errors[key]}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md },
  noteRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start" },
  noteIcon: { color: Colors.primaryLight, fontSize: 12, lineHeight: 20 },
  note: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
  field: { gap: Spacing.xs },
  label: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: "600" },
  input: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    color: Colors.textPrimary,
    fontSize: 16,
  },
  inputError: { borderColor: Colors.error },
  error: { color: Colors.error, fontSize: FontSize.xs },
});
