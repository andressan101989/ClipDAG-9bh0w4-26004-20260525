import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutUp,
  useReducedMotion,
} from "react-native-reanimated";
import { MetricCard, OnSpaceText, ToastCard } from "@/components/design";
import { spacing } from "@/design";

export interface LivePurchaseToastData {
  id: string;
  buyerDisplayName: string;
  buyerAvatarUrl?: string | null;
  productTitle: string;
  quantity: number;
  grossAmount: number;
  creatorCommission?: number;
  commerceMode?: "own_product" | "affiliate_product";
}
export function LiveShopStatsPill({
  orders,
  gross,
}: {
  orders: number;
  gross: number;
}) {
  return (
    <View style={styles.pill}>
      <OnSpaceText variant="caption">
        {orders} pedidos · {gross.toFixed(2)} BDAG
      </OnSpaceText>
    </View>
  );
}
export const LiveCommissionMetric = ({ value }: { value: number }) => (
  <MetricCard label="Comisión estimada" value={`${value.toFixed(2)} BDAG`} />
);
export const LiveSalesMetric = ({ value }: { value: number }) => (
  <MetricCard label="Ventas" value={`${value.toFixed(2)} BDAG`} />
);
export function LivePurchaseToast({
  purchase,
}: {
  purchase: LivePurchaseToastData;
}) {
  return (
    <ToastCard
      title={`${purchase.buyerDisplayName} compró`}
      body={`${purchase.quantity} × ${purchase.productTitle} · ${purchase.grossAmount.toFixed(2)} BDAG${purchase.creatorCommission ? ` · comisión ${purchase.creatorCommission.toFixed(2)}` : ""}`}
    />
  );
}
export function LivePurchaseToastQueue({
  purchases,
  autoDismissMs = 3400,
}: {
  purchases: LivePurchaseToastData[];
  autoDismissMs?: number;
}) {
  const [active, setActive] = useState<LivePurchaseToastData | null>(null),
    shown = useRef(new Set<string>()),
    reduced = useReducedMotion();
  useEffect(() => {
    if (active) return;
    const next = purchases.find((item) => !shown.current.has(item.id));
    if (!next) return;
    shown.current.add(next.id);
    setActive(next);
    const timer = setTimeout(() => setActive(null), autoDismissMs);
    return () => clearTimeout(timer);
  }, [active, autoDismissMs, purchases]);
  return active ? (
    <Animated.View
      entering={reduced ? undefined : FadeInDown}
      exiting={reduced ? undefined : FadeOutUp}
      style={styles.toast}
    >
      <LivePurchaseToast purchase={active} />
    </Animated.View>
  ) : null;
}
export function LiveShopHudPreview({
  purchase,
}: {
  purchase?: LivePurchaseToastData;
}) {
  if (!__DEV__ || !purchase) return null;
  return <LivePurchaseToast purchase={purchase} />;
}
const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: "rgba(14,14,20,.72)",
  },
  toast: {
    position: "absolute",
    top: 116,
    left: spacing.xl,
    right: spacing.xl,
    zIndex: 20,
  },
});
