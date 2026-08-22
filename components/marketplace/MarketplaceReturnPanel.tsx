import React, { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Colors, Radius, Spacing } from "@/constants/theme";
import {
  MarketplaceFulfillmentError,
  requestMarketplaceReturn,
  respondToMarketplaceReturn,
  type MarketplaceOrderDetail,
} from "@/services/marketplaceFulfillmentService";
import { marketplaceReturnStatusCopy } from "@/services/marketplaceOrderPresentation";

type Attempt = { payload: string; key: string };

const attemptKey = (attempt: React.MutableRefObject<Attempt | null>, payload: string) => {
  if (attempt.current?.payload !== payload)
    attempt.current = { payload, key: randomUUID() };
  return attempt.current.key;
};

const messageFor = (error: unknown) => {
  const code = error instanceof MarketplaceFulfillmentError ? error.code : "";
  if (code === "marketplace_return_not_eligible")
    return "El pedido todavía no cumple las condiciones para solicitar una devolución.";
  if (code === "marketplace_return_active_dispute")
    return "Este pedido todavía tiene una disputa protegida activa.";
  if (code === "marketplace_return_already_requested")
    return "Ya existe una solicitud de devolución para este pedido.";
  if (code === "marketplace_return_already_decided")
    return "La solicitud ya fue decidida. Actualiza el pedido para ver el estado.";
  if (code === "marketplace_fulfillment_outcome_unknown")
    return "No pudimos confirmar el resultado. Actualiza el pedido antes de volver a intentarlo.";
  return "No pudimos completar la operación. Revisa los datos e inténtalo nuevamente.";
};

export function MarketplaceReturnPanel({
  role,
  order,
  onUpdated,
}: {
  role: "buyer" | "seller";
  order: MarketplaceOrderDetail;
  onUpdated: (value: MarketplaceOrderDetail) => void;
}) {
  const [buyerNote, setBuyerNote] = useState("");
  const [sellerNote, setSellerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const requestAttempt = useRef<Attempt | null>(null);
  const decisionAttempt = useRef<Attempt | null>(null);
  const current = order.returnRequest;

  if (role === "buyer" && !current && !order.returnEligible) return null;
  if (role === "seller" && !current) return null;

  const runBuyerRequest = async () => {
    const normalized = buyerNote.trim();
    if (normalized.length < 3) {
      Alert.alert("Explica el motivo", "Escribe al menos 3 caracteres.");
      return;
    }
    const payload = normalized;
    setBusy(true);
    try {
      const updated = await requestMarketplaceReturn(
        order.order.id,
        normalized,
        attemptKey(requestAttempt, payload),
      );
      onUpdated(updated);
    } catch (error) {
      Alert.alert("No se pudo solicitar la devolución", messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmBuyerRequest = () =>
    Alert.alert(
      "Solicitar devolución",
      "La devolución queda sujeta a la aprobación del vendedor.",
      [
        { text: "Volver", style: "cancel" },
        { text: "Enviar solicitud", onPress: () => void runBuyerRequest() },
      ],
    );

  const decide = async (decision: "approve" | "reject") => {
    if (!current) return;
    const normalized = sellerNote.trim();
    const payload = `${decision}:${normalized}`;
    setBusy(true);
    try {
      const updated = await respondToMarketplaceReturn(
        order.order.id,
        current.id,
        decision,
        normalized,
        attemptKey(decisionAttempt, payload),
      );
      onUpdated(updated);
    } catch (error) {
      Alert.alert("No se pudo guardar la decisión", messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDecision = (decision: "approve" | "reject") =>
    Alert.alert(
      decision === "approve" ? "Aceptar devolución" : "Rechazar devolución",
      decision === "approve"
        ? "Aceptar autoriza al comprador a devolver el producto. Todavía no se realizará ningún reembolso."
        : "El comprador será informado de que la devolución fue rechazada.",
      [
        { text: "Volver", style: "cancel" },
        {
          text: decision === "approve" ? "Aceptar" : "Rechazar",
          style: decision === "reject" ? "destructive" : "default",
          onPress: () => void decide(decision),
        },
      ],
    );

  const stateCopy = marketplaceReturnStatusCopy(current?.status ?? "requested");

  return (
    <View style={styles.card} accessibilityLabel="Solicitud de devolución">
      <Text style={styles.eyebrow}>SOLICITUD DE DEVOLUCIÓN</Text>
      {role === "buyer" && !current ? (
        <>
          <Text style={styles.text}>La devolución queda sujeta a la aprobación del vendedor.</Text>
          <TextInput
            accessibilityLabel="Motivo de la devolución"
            value={buyerNote}
            onChangeText={setBuyerNote}
            placeholder="Explica por qué deseas devolver el pedido"
            placeholderTextColor={Colors.textSubtle}
            maxLength={1000}
            multiline
            style={styles.input}
          />
          <Text style={styles.counter}>{buyerNote.length} / 1000</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Solicitar devolución"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={styles.primaryButton}
            onPress={confirmBuyerRequest}
          >
            <Text style={styles.primaryText}>{busy ? "Enviando…" : "Solicitar devolución"}</Text>
          </Pressable>
        </>
      ) : current ? (
        <>
          <Text style={styles.title}>{role === "buyer" ? stateCopy.title : "Solicitud de devolución"}</Text>
          {role === "buyer" ? <Text style={styles.muted}>{stateCopy.body}</Text> : null}
          <Text style={styles.label}>Motivo del comprador</Text>
          <Text style={styles.text}>{current.buyerNote}</Text>
          {role === "seller" ? (
            <Text style={styles.warning}>Los fondos de este pedido ya fueron liberados.</Text>
          ) : null}
          {current.sellerNote ? (
            <>
              <Text style={styles.label}>Respuesta del vendedor</Text>
              <Text style={styles.text}>{current.sellerNote}</Text>
            </>
          ) : null}
          {role === "seller" && current.status === "requested" ? (
            <>
              <TextInput
                accessibilityLabel="Nota para el comprador"
                value={sellerNote}
                onChangeText={setSellerNote}
                placeholder="Aclaración opcional"
                placeholderTextColor={Colors.textSubtle}
                maxLength={1000}
                multiline
                style={styles.input}
              />
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Aceptar devolución"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  style={[styles.actionButton, styles.approveButton]}
                  onPress={() => confirmDecision("approve")}
                >
                  <Text style={styles.primaryText}>Aceptar devolución</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Rechazar devolución"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  style={[styles.actionButton, styles.rejectButton]}
                  onPress={() => confirmDecision("reject")}
                >
                  <Text style={styles.primaryText}>Rechazar devolución</Text>
                </Pressable>
              </View>
            </>
          ) : null}
          {role === "seller" && current.status !== "requested" ? (
            <Text style={styles.title}>
              {current.status === "approved" ? "Devolución aceptada" : "Devolución rechazada"}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  eyebrow: { color: Colors.textSubtle, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: "800" },
  label: { color: Colors.textSecondary, fontSize: 13, fontWeight: "700", marginTop: 4 },
  text: { color: Colors.textPrimary, lineHeight: 20 },
  muted: { color: Colors.textSecondary, lineHeight: 20 },
  warning: { color: Colors.warning, fontWeight: "700", lineHeight: 20 },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    padding: 12,
    textAlignVertical: "top",
  },
  counter: { color: Colors.textSubtle, fontSize: 12, textAlign: "right" },
  actions: { gap: Spacing.sm },
  actionButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  approveButton: { backgroundColor: Colors.primary },
  rejectButton: { backgroundColor: Colors.error },
  primaryButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  primaryText: { color: Colors.textOnBrand, fontWeight: "800" },
});
