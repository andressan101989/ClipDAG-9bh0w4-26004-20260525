import React from "react";
import { StyleSheet, View } from "react-native";
import {
  CommercePrice,
  LoadingButton,
  MetricCard,
  OnSpaceButton,
  OnSpaceText,
  StatusPill,
} from "@/components/design";
import { radii, spacing } from "@/design";

export function LiveReservationSummary({
  reference,
  total,
  balance,
  remaining,
  terminal,
  busy,
  payable,
  onPay,
  onCancel,
}: {
  reference: string;
  total: number;
  balance: number | null;
  remaining: number;
  terminal?: string | null;
  busy: boolean;
  payable: boolean;
  onPay: () => void;
  onCancel: () => void;
}) {
  const minutes = Math.floor(remaining / 60),
    seconds = String(remaining % 60).padStart(2, "0");
  return (
    <View style={styles.content}>
      <View style={styles.top}>
        <StatusPill label="Inventario asegurado" tone="success" />
        <OnSpaceText variant="headingMedium">Revisa y paga tu pedido</OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textMuted">
          Referencia {reference}
        </OnSpaceText>
      </View>
      <View style={styles.metrics}>
        <MetricCard label="Tiempo restante" value={`${minutes}:${seconds}`} />
        <MetricCard
          label="Saldo disponible"
          value={balance == null ? "—" : balance.toFixed(2)}
        />
      </View>
      <View style={styles.total}>
        <OnSpaceText variant="label" color="textSecondary">
          Total del pedido
        </OnSpaceText>
        <CommercePrice price={total} size="large" />
      </View>
      <View style={styles.escrow}>
        <OnSpaceText variant="labelStrong" color="commerceEscrow">
          Protección Marketplace
        </OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textSecondary">
          El pago queda retenido de forma segura hasta que confirmes la entrega.
        </OnSpaceText>
      </View>
      {terminal ? (
        <OnSpaceText variant="bodySmall" color="textDanger">
          {terminal}
        </OnSpaceText>
      ) : null}
      <LoadingButton
        label="Pagar ahora"
        variant="commerce"
        size="large"
        loading={busy}
        disabled={!payable}
        haptic="impact"
        onPress={onPay}
      />
      <View style={styles.actions}>
        <OnSpaceButton
          label="Cancelar compra pendiente"
          variant="ghost"
          size="small"
          disabled={busy || !payable}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  top: { gap: spacing.sm },
  metrics: { flexDirection: "row", gap: spacing.sm },
  total: { gap: spacing.xs },
  escrow: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: "rgba(125,184,255,.10)",
    borderWidth: 1,
    borderColor: "rgba(125,184,255,.24)",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});
