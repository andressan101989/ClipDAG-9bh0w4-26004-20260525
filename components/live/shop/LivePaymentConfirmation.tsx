import React from "react";
import { Modal, StyleSheet, View } from "react-native";
import {
  BottomSheetSurface,
  OnSpaceButton,
  OnSpaceText,
} from "@/components/design";
import { colors, spacing } from "@/design";
export function LivePaymentConfirmation({
  visible,
  total,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  total: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.scrim}>
        <BottomSheetSurface>
          <View style={styles.content}>
            <OnSpaceText variant="headingMedium">Pagar ahora</OnSpaceText>
            <OnSpaceText variant="body" color="textSecondary">
              Pagarás {total.toFixed(2)} BDAG. El pago quedará protegido en el
              escrow del Marketplace.
            </OnSpaceText>
            <OnSpaceButton
              label="Pagar ahora"
              variant="commerce"
              size="large"
              haptic="impact"
              onPress={onConfirm}
            />
            <OnSpaceButton label="Volver" variant="ghost" onPress={onCancel} />
          </View>
        </BottomSheetSurface>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  content: { gap: spacing.xl, paddingBottom: spacing.xxxl },
});
