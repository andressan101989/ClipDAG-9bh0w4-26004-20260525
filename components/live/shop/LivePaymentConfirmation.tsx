import React from "react";
import { StyleSheet, View } from "react-native";
import { CommercePrice, OnSpaceButton, OnSpaceText } from "@/components/design";
import { spacing } from "@/design";

export interface LivePaymentConfirmationProps {
  total: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LivePaymentConfirmation({
  total,
  busy = false,
  onCancel,
  onConfirm,
}: LivePaymentConfirmationProps) {
  return (
    <View style={styles.content}>
      <OnSpaceText variant="headingMedium">Confirmar pago</OnSpaceText>
      <View style={styles.total}>
        <OnSpaceText variant="label" color="textSecondary">
          Total
        </OnSpaceText>
        <CommercePrice price={total} size="large" />
      </View>
      <OnSpaceText variant="body" color="textSecondary">
        El pago BDAG quedará protegido en el escrow del Marketplace mientras el
        vendedor prepara y entrega el pedido.
      </OnSpaceText>
      <OnSpaceButton
        label="Confirmar y pagar"
        variant="commerce"
        size="large"
        loading={busy}
        disabled={busy}
        haptic="impact"
        onPress={onConfirm}
      />
      <OnSpaceButton
        label="Volver"
        variant="ghost"
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.xl, paddingBottom: spacing.xxxl },
  total: { gap: spacing.xs },
});
