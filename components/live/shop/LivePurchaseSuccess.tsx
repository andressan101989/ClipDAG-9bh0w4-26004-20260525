import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, useReducedMotion } from "react-native-reanimated";
import { OnSpaceButton, OnSpaceText } from "@/components/design";
import { colors, radii, spacing } from "@/design";
export function LivePurchaseSuccess({
  reference,
  onContinue,
  onViewOrder,
}: {
  reference?: string;
  onContinue: () => void;
  onViewOrder?: () => void;
}) {
  const reduced = useReducedMotion();
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);
  return (
    <Animated.View
      entering={reduced ? undefined : FadeInUp.springify().damping(20)}
      style={styles.content}
    >
      <View style={styles.icon}>
        <MaterialIcons name="check" size={42} color={colors.textInverse} />
      </View>
      <OnSpaceText variant="headingLarge" style={styles.center}>
        Compra realizada
      </OnSpaceText>
      <OnSpaceText variant="body" color="textSecondary" style={styles.center}>
        Tu pago quedó protegido y el vendedor preparará el pedido.
      </OnSpaceText>
      {reference ? (
        <OnSpaceText variant="caption" color="textMuted">
          Pedido {reference}
        </OnSpaceText>
      ) : null}
      <OnSpaceButton
        label="Continuar viendo el LIVE"
        variant="commerce"
        size="large"
        onPress={onContinue}
      />
      {onViewOrder ? (
        <OnSpaceButton
          label="Ver pedido"
          variant="secondary"
          onPress={onViewOrder}
        />
      ) : null}
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xxl,
  },
  icon: {
    width: 86,
    height: 86,
    borderRadius: radii.pill,
    backgroundColor: colors.commerceSuccess,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
});
