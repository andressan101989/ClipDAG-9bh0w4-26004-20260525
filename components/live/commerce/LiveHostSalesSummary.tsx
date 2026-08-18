import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { BottomSheetSurface, OnSpaceText } from "@/components/design";
import { colors, radii, shadows, spacing } from "@/design";
import type { LiveShopStats } from "@/services/liveCommerceService";

export function LiveHostSalesSummary({
  stats,
  error = false,
}: {
  stats: LiveShopStats;
  error?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir estadísticas de ventas"
        onPress={() => setExpanded(true)}
        style={s.pill}
      >
        <MaterialIcons
          name="insights"
          size={17}
          color={colors.commerceAccent}
        />
        <OnSpaceText variant="caption" color="textPrimary" numberOfLines={1}>
          Ventas {stats.ordersCount} · {stats.grossSales.toFixed(2)} BDAG
        </OnSpaceText>
        <MaterialIcons
          name="expand-more"
          size={18}
          color={colors.textPrimary}
        />
      </Pressable>
      <Modal
        visible={expanded}
        transparent
        animationType="slide"
        onRequestClose={() => setExpanded(false)}
      >
        <Pressable
          style={s.scrim}
          onPress={() => setExpanded(false)}
          accessibilityLabel="Cerrar estadísticas"
        />
        <BottomSheetSurface style={s.sheet}>
          <View style={s.heading}>
            <OnSpaceText variant="headingMedium">Resumen de ventas</OnSpaceText>
            <Pressable
              onPress={() => setExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel="Cerrar estadísticas"
              style={s.close}
            >
              <MaterialIcons
                name="close"
                size={22}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>
          {error ? (
            <OnSpaceText color="textDanger">
              No pudimos actualizar las estadísticas.
            </OnSpaceText>
          ) : null}
          <Metric label="Pedidos" value={`${stats.ordersCount}`} />
          <Metric label="Unidades vendidas" value={`${stats.unitsSold}`} />
          <Metric
            label="Ventas brutas"
            value={`${stats.grossSales.toFixed(2)} BDAG`}
          />
          <Metric
            label="Comisión de creador retenida"
            value={`${stats.creatorCommissionHeld.toFixed(2)} BDAG`}
            secondary
          />
          <Metric
            label="Comisión de creador liberada"
            value={`${stats.creatorCommissionReleased.toFixed(2)} BDAG`}
            secondary
          />
        </BottomSheetSurface>
      </Modal>
    </>
  );
}
function Metric({
  label,
  value,
  secondary = false,
}: {
  label: string;
  value: string;
  secondary?: boolean;
}) {
  return (
    <View style={s.metric}>
      <OnSpaceText color={secondary ? "textMuted" : "textSecondary"}>
        {label}
      </OnSpaceText>
      <OnSpaceText variant="labelStrong">{value}</OnSpaceText>
    </View>
  );
}
const s = StyleSheet.create({
  pill: {
    zIndex: 13,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(12,12,18,.78)",
    borderWidth: 1,
    borderColor: colors.borderElevated,
    ...shadows.floating,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,.56)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  metric: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});
