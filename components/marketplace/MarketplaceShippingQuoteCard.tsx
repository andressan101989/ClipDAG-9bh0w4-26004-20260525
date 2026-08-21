import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Radius, Spacing } from "@/constants/theme";
import {
  marketplaceShippingMessage,
  MarketplaceShippingError,
  quoteMarketplaceShipping,
  type MarketplaceShippingQuote,
} from "@/services/marketplaceShippingService";
import { shippingCountryLabel } from "@/services/marketplaceShippingSetup";

export type MarketplaceShippingQuoteState = {
  status: "idle" | "loading" | "ready" | "error";
  quote: MarketplaceShippingQuote | null;
  message: string | null;
};
export function MarketplaceShippingQuoteCard({
  productId,
  quantity,
  countryCode,
  regionCode,
  onChange,
  onRequestAddress,
  selectionMode = false,
}: {
  productId: string;
  quantity: number;
  countryCode?: string | null;
  regionCode?: string | null;
  onChange?: (state: MarketplaceShippingQuoteState) => void;
  onRequestAddress?: () => void;
  selectionMode?: boolean;
}) {
  const [state, setState] = useState<MarketplaceShippingQuoteState>({
      status: "idle",
      quote: null,
      message: null,
    }),
    onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const publish = useCallback((next: MarketplaceShippingQuoteState) => {
    setState(next);
    onChangeRef.current?.(next);
  }, []);
  const load = useCallback(async () => {
    if (!countryCode) {
      publish({
        status: "idle",
        quote: null,
        message: "Selecciona o agrega una dirección para calcular el envío.",
      });
      return;
    }
    publish({ status: "loading", quote: null, message: null });
    try {
      const quote = await quoteMarketplaceShipping(
        productId,
        countryCode,
        regionCode ?? null,
        quantity,
      );
      publish({ status: "ready", quote, message: null });
    } catch (error) {
      const code =
        error instanceof MarketplaceShippingError
          ? error.code
          : "marketplace_shipping_unknown";
      publish({
        status: "error",
        quote: null,
        message: marketplaceShippingMessage(code),
      });
    }
  }, [countryCode, productId, publish, quantity, regionCode]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View
      style={[styles.card, selectionMode && styles.selectionCard]}
      accessibilityRole={selectionMode ? "radio" : undefined}
      accessibilityState={selectionMode ? { checked: state.status === "ready" } : undefined}
      accessibilityLabel="Método de envío"
    >
      {selectionMode ? (
        <View style={[styles.radio, state.status === "ready" && styles.radioSelected]} />
      ) : null}
      <MaterialCommunityIcons
        name="truck-fast-outline"
        size={20}
        color={state.status === "ready" ? Colors.success : Colors.textSecondary}
      />
      <View style={styles.copy}>
        {state.status === "loading" ? (
          <View style={styles.row}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.text}>Calculando envío…</Text>
          </View>
        ) : null}
        {state.status === "idle" || state.status === "error" ? (
          <Text style={state.status === "error" ? styles.error : styles.text}>
            {state.message}
          </Text>
        ) : null}
        {state.quote ? (
          <>
            <Text style={styles.ready}>
              Envío disponible{" "}
              <Text style={styles.text}>
                · Entrega estimada en {state.quote.estimatedDeliveryDaysMin}–
                {state.quote.estimatedDeliveryDaysMax} días
              </Text>
            </Text>
            <Text style={styles.destination}>
              {state.quote.shippingAmount.toFixed(2)} BDAG ·{" "}
              {shippingCountryLabel(state.quote.countryCode ?? "")}
              {state.quote.regionCode ? ` / ${state.quote.regionCode}` : ""}
            </Text>
          </>
        ) : null}
      </View>
      {state.status === "idle" && onRequestAddress ? (
        <Pressable
          onPress={onRequestAddress}
          style={styles.retry}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Agregar dirección</Text>
        </Pressable>
      ) : null}
      {state.status === "error" ? (
        <Pressable
          onPress={() => void load()}
          style={styles.retry}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: Spacing.sm,
  },
  selectionCard: {
    minHeight: 72,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.textSubtle,
  },
  radioSelected: {
    borderWidth: 5,
    borderColor: Colors.primary,
  },
  copy: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  text: { color: Colors.textSecondary, fontSize: 12 },
  ready: { color: Colors.success, fontSize: 12, fontWeight: "700" },
  destination: { color: Colors.textSubtle, fontSize: 10, marginTop: 3 },
  error: { color: Colors.error, fontSize: 12 },
  retry: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { color: Colors.primaryLight, fontWeight: "700", fontSize: 12 },
});
