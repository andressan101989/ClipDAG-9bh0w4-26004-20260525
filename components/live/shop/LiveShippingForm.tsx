import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LoadingButton, OnSpaceText } from "@/components/design";
import { CheckoutShippingAddressForm } from "@/components/marketplace/CheckoutShippingAddressForm";
import { spacing } from "@/design";
import type { ShippingAddressInput } from "@/services/marketplaceOrderService";
export function LiveShippingForm({
  value,
  errors = {},
  busy,
  onChange,
  onSubmit,
  shippingMethod,
}: {
  value: ShippingAddressInput;
  errors?: Partial<Record<keyof ShippingAddressInput, string>>;
  busy: boolean;
  onChange: (value: ShippingAddressInput) => void;
  onSubmit: () => void;
  shippingMethod?: React.ReactNode;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View>
        <OnSpaceText variant="headingMedium">Dirección de envío</OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textSecondary">
          Tus datos de entrega se protegen dentro del pedido y no se muestran en el LIVE.
        </OnSpaceText>
      </View>
      <CheckoutShippingAddressForm value={value} errors={errors} onChange={onChange} />
      {shippingMethod ? (
        <View style={styles.shippingSection}>
          <OnSpaceText variant="headingSmall">Método de envío</OnSpaceText>
          {shippingMethod}
        </View>
      ) : null}
      <LoadingButton
        label="Continuar al método de envío"
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
  shippingSection: { gap: spacing.sm },
});
