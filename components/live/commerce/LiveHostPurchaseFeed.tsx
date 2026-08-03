import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  LivePurchaseToastQueue,
  type LivePurchaseToastData,
} from "@/components/live/shop/LiveShopHud";
import { LiveHostSalesSummary } from "@/components/live/commerce/LiveHostSalesSummary";
import { spacing } from "@/design";
import {
  fetchMyLivePurchaseEvents,
  fetchMyLiveShopStats,
  type LivePurchaseEvent,
  type LiveShopStats,
} from "@/services/liveCommerceService";
import { getSupabaseClient } from "@/template";

const POLL_INTERVAL_MS = 5_000;
const EMPTY_STATS: LiveShopStats = {
  ordersCount: 0,
  grossSales: 0,
  creatorCommissionHeld: 0,
  creatorCommissionReleased: 0,
  unitsSold: 0,
};

function toastData(event: LivePurchaseEvent): LivePurchaseToastData {
  return {
    id: event.id,
    buyerDisplayName: event.buyerDisplayName,
    productTitle: event.productTitle,
    quantity: event.quantity,
    grossAmount: event.grossAmount,
    creatorCommission: event.creatorCommissionAmount,
    commerceMode:
      event.creatorCommissionAmount > 0 ? "affiliate_product" : "own_product",
  };
}

export function LiveHostPurchaseFeed({ sessionId }: { sessionId: string }) {
  const insets = useSafeAreaInsets();
  const [purchases, setPurchases] = useState<LivePurchaseToastData[]>([]);
  const [stats, setStats] = useState<LiveShopStats>(EMPTY_STATS);
  const [statsError, setStatsError] = useState(false);
  const seen = useRef(new Set<string>());
  const hydrated = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextEvents, nextStats] = await Promise.all([
        fetchMyLivePurchaseEvents(sessionId),
        fetchMyLiveShopStats(sessionId),
      ]);
      if (hydrated.current) {
        const fresh = nextEvents
          .filter((event) => !seen.current.has(event.id))
          .reverse();
        fresh.forEach((event) => seen.current.add(event.id));
        if (fresh.length) {
          setPurchases((current) =>
            [...current, ...fresh.map(toastData)].slice(-12),
          );
        }
      } else {
        nextEvents.forEach((event) => seen.current.add(event.id));
        hydrated.current = true;
      }
      setStats(nextStats);
      setStatsError(false);
    } catch {
      setStatsError(true);
      // Controlled polling retries without exposing purchase or financial data.
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const database = getSupabaseClient();
    const channel = database
      .channel(`live-host-purchases:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_commerce_host_purchase_events",
          filter: `session_id=eq.${sessionId}`,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });

    return () => {
      clearInterval(poll);
      appState.remove();
      void database.removeChannel(channel);
    };
  }, [refresh, sessionId]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.summary, { top: insets.top + 70 }]}>
        <LiveHostSalesSummary stats={stats} error={statsError} />
      </View>
      <LivePurchaseToastQueue purchases={purchases} />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    position: "absolute",
    right: spacing.md,
    zIndex: 12,
    minWidth: 190,
  },
});
