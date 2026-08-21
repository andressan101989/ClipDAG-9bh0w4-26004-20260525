import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  CommercePrice,
  LoadingButton,
  OnSpaceButton,
  OnSpaceText,
  ProductThumbnail,
  StatusPill,
} from "@/components/design";
import { colors, radii, spacing } from "@/design";
import type { ShippingAddressInput } from "@/services/marketplaceOrderService";
import { shippingCountryLabel } from "@/services/marketplaceShippingSetup";

function Heading({ number, title }: { number: number; title: string }) {
  return <View style={styles.heading}><View style={styles.step}><OnSpaceText variant="caption" color="brandHighlight">{number}</OnSpaceText></View><OnSpaceText variant="labelStrong">{title}</OnSpaceText></View>;
}

export function LiveReservationSummary({
  reference,
  total,
  subtotal,
  shippingAmount,
  balance,
  remaining,
  terminal,
  busy,
  payable,
  productTitle,
  storeName,
  imageUrl,
  quantity,
  unitPrice,
  address,
  shippingDaysMin,
  shippingDaysMax,
  onPay,
  onCancel,
}: {
  reference: string;
  total: number;
  subtotal: number;
  shippingAmount: number;
  balance: number | null;
  remaining: number;
  terminal?: string | null;
  busy: boolean;
  payable: boolean;
  productTitle: string;
  storeName: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  address: ShippingAddressInput;
  shippingDaysMin: number | null;
  shippingDaysMax: number | null;
  onPay: () => void;
  onCancel: () => void;
}) {
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.statusLine}>
        <StatusPill label={`Reservado ${minutes}:${seconds}`} tone="success" />
        <OnSpaceText variant="caption" color="textMuted">{reference}</OnSpaceText>
      </View>

      <View style={styles.card}>
        <Heading number={1} title="Producto" />
        <View style={styles.product}>
          <ProductThumbnail uri={imageUrl} size="medium" label={productTitle} />
          <View style={styles.grow}>
            <OnSpaceText variant="labelStrong" numberOfLines={2}>{productTitle}</OnSpaceText>
            <OnSpaceText variant="caption" color="textMuted" numberOfLines={1}>{storeName}</OnSpaceText>
            <OnSpaceText variant="caption" color="textSecondary">Cantidad {quantity} · {unitPrice.toFixed(2)} BDAG</OnSpaceText>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Heading number={2} title="Dirección de envío" />
        <OnSpaceText variant="labelStrong">{address.recipientName}</OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textSecondary">{address.line1}{address.line2 ? ` · ${address.line2}` : ""}</OnSpaceText>
        <OnSpaceText variant="bodySmall" color="textSecondary">{address.city}, {address.region} · {shippingCountryLabel(address.country)} · {address.postalCode}</OnSpaceText>
        <OnSpaceText variant="caption" color="textMuted">Toda la comunicación y actualizaciones del pedido se realizan dentro de la app.</OnSpaceText>
      </View>

      <View style={styles.card}>
        <Heading number={3} title="Método de envío" />
        <View style={styles.selectedRow} accessibilityRole="radio" accessibilityState={{ checked: true }}>
          <View style={styles.radio} />
          <View style={styles.grow}>
            <OnSpaceText variant="labelStrong">Envío disponible</OnSpaceText>
            <OnSpaceText variant="caption" color="textSecondary">
              {shippingDaysMin != null && shippingDaysMax != null
                ? `Entrega estimada en ${shippingDaysMin}–${shippingDaysMax} días`
                : "Opción confirmada por el servidor"}
            </OnSpaceText>
          </View>
          <OnSpaceText variant="labelStrong">{shippingAmount.toFixed(2)} BDAG</OnSpaceText>
        </View>
      </View>

      <View style={styles.card}>
        <Heading number={4} title="Método de pago" />
        <View style={styles.selectedRow} accessibilityRole="radio" accessibilityState={{ checked: true }} accessibilityLabel="Billetera BDAG">
          <View style={styles.wallet}><OnSpaceText variant="labelStrong">B</OnSpaceText></View>
          <View style={styles.grow}><OnSpaceText variant="labelStrong">Billetera BDAG</OnSpaceText><OnSpaceText variant="caption" color="textSecondary">Saldo disponible: {balance == null ? "—" : balance.toFixed(2)} BDAG</OnSpaceText></View>
          <View style={styles.radio} />
        </View>
      </View>

      <View style={styles.card}>
        <Heading number={5} title="Resumen del pedido" />
        <View style={styles.moneyRow}><OnSpaceText variant="bodySmall" color="textSecondary">Subtotal</OnSpaceText><OnSpaceText variant="bodySmall">{subtotal.toFixed(2)} BDAG</OnSpaceText></View>
        <View style={styles.moneyRow}><OnSpaceText variant="bodySmall" color="textSecondary">Envío</OnSpaceText><OnSpaceText variant="bodySmall">{shippingAmount.toFixed(2)} BDAG</OnSpaceText></View>
        <View style={styles.divider} />
        <View style={styles.moneyRow}><OnSpaceText variant="headingSmall">Total</OnSpaceText><CommercePrice price={total} size="large" /></View>
      </View>

      <View style={styles.escrow}><OnSpaceText variant="labelStrong" color="commerceEscrow">Protección Marketplace</OnSpaceText><OnSpaceText variant="bodySmall" color="textSecondary">El pago queda protegido hasta que el pedido avance en su proceso de entrega.</OnSpaceText></View>
      {terminal ? <OnSpaceText variant="bodySmall" color="textDanger">{terminal}</OnSpaceText> : null}
      <LoadingButton label={`Confirmar compra · ${total.toFixed(2)} BDAG`} variant="commerce" size="large" loading={busy} disabled={!payable} haptic="impact" onPress={onPay} />
      <OnSpaceButton label="Cancelar compra pendiente" variant="ghost" size="small" disabled={busy || !payable} onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxxl },
  statusLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.backgroundSecondary, borderWidth: 1, borderColor: colors.borderSubtle },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  step: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: "rgba(128,104,255,.12)" },
  product: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  selectedRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: "rgba(128,104,255,.10)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 5, borderColor: colors.brandPrimary },
  wallet: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  moneyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  escrow: { padding: spacing.lg, gap: spacing.xs, borderRadius: radii.lg, backgroundColor: "rgba(125,184,255,.10)", borderWidth: 1, borderColor: "rgba(125,184,255,.24)" },
});
