import React, { useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Colors, Radius, Spacing } from "@/constants/theme";
import {
  fundMarketplaceReturnRefundHold,
  MarketplaceFulfillmentError,
  prepareMarketplaceReturnShipment,
  requestMarketplaceReturn,
  respondToMarketplaceReturn,
  shipMarketplaceReturn,
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
  if (code === "marketplace_return_approval_funding_required")
    return "La devolución todavía no puede aceptarse porque los fondos del reembolso no están asegurados.";
  if (code === "marketplace_return_refund_funding_insufficient_balance")
    return "No hay saldo suficiente para asegurar el reembolso completo. La devolución no fue aceptada y no se movió dinero.";
  if (code === "marketplace_return_refund_hold_active_review")
    return "Este pedido tiene una revisión financiera activa y no puede asegurar fondos de devolución.";
  if (code === "marketplace_return_destination_invalid_input")
    return "Revisa la dirección de devolución y completa todos los campos obligatorios.";
  if (code === "marketplace_return_tracking_invalid_input")
    return "Revisa el transportista, el número de seguimiento y usa una URL HTTPS segura.";
  if (code === "marketplace_return_shipment_not_eligible")
    return "Esta devolución todavía no está lista para avanzar al envío.";
  if (code === "marketplace_return_shipment_incompatible_review")
    return "Este pedido tiene una revisión incompatible activa.";
  if (code === "marketplace_return_destination_immutable")
    return "La dirección ya no puede cambiarse porque el comprador envió el producto.";
  if (code === "marketplace_return_already_shipped")
    return "El envío de devolución ya fue registrado. Actualiza el pedido para ver el estado.";
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
  const current = order.returnRequest;
  const shipment = current?.returnShipment;
  const [recipientName, setRecipientName] = useState(shipment?.destination.recipientName ?? "");
  const [line1, setLine1] = useState(shipment?.destination.line1 ?? "");
  const [line2, setLine2] = useState(shipment?.destination.line2 ?? "");
  const [city, setCity] = useState(shipment?.destination.city ?? "");
  const [region, setRegion] = useState(shipment?.destination.region ?? "");
  const [postalCode, setPostalCode] = useState(shipment?.destination.postalCode ?? "");
  const [country, setCountry] = useState(shipment?.destination.country ?? "US");
  const [phone, setPhone] = useState(shipment?.destination.phone ?? "");
  const [sellerInstructions, setSellerInstructions] = useState(shipment?.sellerInstructions ?? "");
  const [carrierName, setCarrierName] = useState("");
  const [serviceLevel, setServiceLevel] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [returnShippingNote, setReturnShippingNote] = useState("");
  const [busy, setBusy] = useState(false);
  const requestAttempt = useRef<Attempt | null>(null);
  const decisionAttempt = useRef<Attempt | null>(null);
  const fundingAttempt = useRef<Attempt | null>(null);
  const destinationAttempt = useRef<Attempt | null>(null);
  const shippingAttempt = useRef<Attempt | null>(null);
  const refundAmount = order.settlement?.grossAmount ?? order.allocation?.grossAmount;
  const refundAmountLabel = refundAmount == null ? "el importe completo" : `${refundAmount.toFixed(2)} BDAG`;

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
        ? `Al aceptar, ${refundAmountLabel} serán retenidos para garantizar el reembolso. El comprador todavía no recibirá el dinero.`
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

  const fundLegacyApproval = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const updated = await fundMarketplaceReturnRefundHold(
        order.order.id,
        current.id,
        attemptKey(fundingAttempt, current.id),
      );
      onUpdated(updated);
    } catch (error) {
      Alert.alert("No se pudieron asegurar los fondos", messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmLegacyFunding = () =>
    Alert.alert(
      "Asegurar fondos del reembolso",
      `Se retendrán ${refundAmountLabel} para garantizar esta devolución. El comprador todavía no recibirá el dinero.`,
      [
        { text: "Volver", style: "cancel" },
        { text: "Asegurar fondos", onPress: () => void fundLegacyApproval() },
      ],
    );

  const saveDestination = async () => {
    if (!current) return;
    const normalizedCountry = country.trim().toUpperCase();
    if (
      recipientName.trim().length < 2 ||
      line1.trim().length < 3 ||
      city.trim().length < 2 ||
      !region.trim() ||
      !postalCode.trim() ||
      !/^[A-Z]{2}$/.test(normalizedCountry)
    ) {
      Alert.alert("Revisa la dirección", "Completa una dirección de devolución válida.");
      return;
    }
    const payload = JSON.stringify({
      recipientName: recipientName.trim(), line1: line1.trim(), line2: line2.trim(),
      city: city.trim(), region: region.trim(), postalCode: postalCode.trim(),
      country: normalizedCountry, phone: phone.trim(), sellerInstructions: sellerInstructions.trim(),
    });
    setBusy(true);
    try {
      const updated = await prepareMarketplaceReturnShipment(
        order.order.id,
        current.id,
        {
          recipientName, line1, line2, city, region, postalCode,
          country: normalizedCountry, phone, sellerInstructions,
        },
        attemptKey(destinationAttempt, payload),
      );
      onUpdated(updated);
    } catch (error) {
      Alert.alert("No se pudo guardar la dirección", messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDestination = () =>
    Alert.alert(
      shipment ? "Actualizar dirección de devolución" : "Indicar dirección de devolución",
      "El comprador usará esta dirección para enviar el producto. Después del envío ya no podrá modificarse.",
      [
        { text: "Volver", style: "cancel" },
        { text: "Guardar dirección", onPress: () => void saveDestination() },
      ],
    );

  const registerReturnShipment = async () => {
    if (!current) return;
    if (carrierName.trim().length < 2 || trackingNumber.trim().length < 2) {
      Alert.alert("Revisa el seguimiento", "Indica transportista y número de seguimiento.");
      return;
    }
    if (trackingUrl.trim() && !/^https:\/\/[^\s]+$/i.test(trackingUrl.trim())) {
      Alert.alert("URL no válida", "La URL de seguimiento debe comenzar con https://.");
      return;
    }
    const payload = JSON.stringify({
      carrierName: carrierName.trim(), serviceLevel: serviceLevel.trim(),
      trackingNumber: trackingNumber.trim(), trackingUrl: trackingUrl.trim(),
      buyerNote: returnShippingNote.trim(),
    });
    setBusy(true);
    try {
      const updated = await shipMarketplaceReturn(
        order.order.id,
        current.id,
        { carrierName, serviceLevel, trackingNumber, trackingUrl, buyerNote: returnShippingNote },
        attemptKey(shippingAttempt, payload),
      );
      onUpdated(updated);
    } catch (error) {
      Alert.alert("No se pudo registrar el envío", messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmReturnShipment = () =>
    Alert.alert(
      "Marcar producto como enviado",
      "Confirma únicamente después de entregar el paquete al transportista. Los fondos seguirán protegidos hasta que el vendedor confirme la recepción.",
      [
        { text: "Volver", style: "cancel" },
        { text: "Confirmar envío", onPress: () => void registerReturnShipment() },
      ],
    );

  const stateCopy = marketplaceReturnStatusCopy(
    current?.status ?? "requested",
    Boolean(current?.refundHold),
    shipment?.status,
  );
  const destination = shipment?.destination;

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
              <Text style={styles.warning}>
                Al aceptar, {refundAmountLabel} serán retenidos para garantizar el reembolso.
              </Text>
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
            <>
              <Text style={styles.title}>
                {current.status === "approved" ? "Devolución aceptada" : "Devolución rechazada"}
              </Text>
              {current.status === "approved" ? (
                current.refundHold ? (
                  <Text style={styles.success}>Fondos del reembolso asegurados</Text>
                ) : (
                  <>
                    <Text style={styles.warning}>
                      Devolución aceptada, pero los fondos todavía no están asegurados.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Asegurar fondos del reembolso"
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      style={[styles.actionButton, styles.approveButton]}
                      onPress={confirmLegacyFunding}
                    >
                      <Text style={styles.primaryText}>
                        {busy ? "Asegurando…" : "Asegurar fondos del reembolso"}
                      </Text>
                    </Pressable>
                  </>
                )
              ) : null}
            </>
          ) : null}
          {role === "seller" && current.status === "approved" && current.refundHold ? (
            shipment?.status === "shipped" ? (
              <>
                <Text style={styles.title}>Producto de devolución en camino</Text>
                <Text style={styles.text}>
                  {shipment.carrierName} · {shipment.trackingNumber}
                </Text>
                {shipment.serviceLevel ? <Text style={styles.muted}>{shipment.serviceLevel}</Text> : null}
                {shipment.trackingUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    style={styles.secondaryButton}
                    onPress={() => void Linking.openURL(shipment.trackingUrl!)}
                  >
                    <Text style={styles.linkText}>Ver seguimiento</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.muted}>La confirmación de recepción estará disponible en la siguiente fase.</Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>
                  {shipment ? "Esperando que el comprador envíe el producto" : "Dirección de devolución pendiente"}
                </Text>
                {destination ? (
                  <View style={styles.destinationCard}>
                    <Text style={styles.label}>Dirección de devolución</Text>
                    <Text style={styles.text}>{destination.recipientName}</Text>
                    <Text style={styles.text}>{destination.line1}</Text>
                    {destination.line2 ? <Text style={styles.text}>{destination.line2}</Text> : null}
                    <Text style={styles.text}>
                      {destination.city}, {destination.region} {destination.postalCode}
                    </Text>
                    <Text style={styles.text}>{destination.country}</Text>
                    {shipment?.sellerInstructions ? (
                      <Text style={styles.muted}>{shipment.sellerInstructions}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text style={styles.label}>{shipment ? "Corregir dirección" : "Indicar dirección de devolución"}</Text>
                <TextInput accessibilityLabel="Nombre del destinatario" value={recipientName} onChangeText={setRecipientName} placeholder="Nombre del destinatario" placeholderTextColor={Colors.textSubtle} maxLength={120} style={styles.singleInput} />
                <TextInput accessibilityLabel="Dirección de devolución" value={line1} onChangeText={setLine1} placeholder="Dirección" placeholderTextColor={Colors.textSubtle} maxLength={200} style={styles.singleInput} />
                <TextInput accessibilityLabel="Complemento de dirección" value={line2} onChangeText={setLine2} placeholder="Apartamento o complemento (opcional)" placeholderTextColor={Colors.textSubtle} maxLength={200} style={styles.singleInput} />
                <View style={styles.fieldRow}>
                  <TextInput accessibilityLabel="Ciudad" value={city} onChangeText={setCity} placeholder="Ciudad" placeholderTextColor={Colors.textSubtle} maxLength={120} style={[styles.singleInput, styles.flexInput]} />
                  <TextInput accessibilityLabel="Región" value={region} onChangeText={setRegion} placeholder="Región" placeholderTextColor={Colors.textSubtle} maxLength={120} style={[styles.singleInput, styles.flexInput]} />
                </View>
                <View style={styles.fieldRow}>
                  <TextInput accessibilityLabel="Código postal" value={postalCode} onChangeText={setPostalCode} placeholder="Código postal" placeholderTextColor={Colors.textSubtle} maxLength={30} style={[styles.singleInput, styles.flexInput]} />
                  <TextInput accessibilityLabel="País" autoCapitalize="characters" value={country} onChangeText={setCountry} placeholder="US" placeholderTextColor={Colors.textSubtle} maxLength={2} style={[styles.singleInput, styles.countryInput]} />
                </View>
                <TextInput accessibilityLabel="Teléfono de devolución" value={phone} onChangeText={setPhone} placeholder="Teléfono (opcional)" placeholderTextColor={Colors.textSubtle} maxLength={40} style={styles.singleInput} />
                <TextInput accessibilityLabel="Instrucciones de devolución" value={sellerInstructions} onChangeText={setSellerInstructions} placeholder="Instrucciones opcionales" placeholderTextColor={Colors.textSubtle} maxLength={1000} multiline style={styles.input} />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.primaryButton} onPress={confirmDestination}>
                  <Text style={styles.primaryText}>{busy ? "Guardando…" : shipment ? "Actualizar dirección" : "Indicar dirección de devolución"}</Text>
                </Pressable>
              </>
            )
          ) : null}
          {role === "buyer" && current.status === "approved" && current.refundHold && shipment ? (
            shipment.status === "shipped" ? (
              <>
                <Text style={styles.success}>Tu reembolso continúa protegido.</Text>
                <Text style={styles.label}>Seguimiento de devolución</Text>
                <Text style={styles.text}>{shipment.carrierName} · {shipment.trackingNumber}</Text>
                {shipment.trackingUrl ? (
                  <Pressable accessibilityRole="link" style={styles.secondaryButton} onPress={() => void Linking.openURL(shipment.trackingUrl!)}>
                    <Text style={styles.linkText}>Ver seguimiento</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.label}>Envía el producto a:</Text>
                <View style={styles.destinationCard}>
                  <Text style={styles.text}>{destination?.recipientName}</Text>
                  <Text style={styles.text}>{destination?.line1}</Text>
                  {destination?.line2 ? <Text style={styles.text}>{destination.line2}</Text> : null}
                  <Text style={styles.text}>{destination?.city}, {destination?.region} {destination?.postalCode}</Text>
                  <Text style={styles.text}>{destination?.country}</Text>
                  {shipment.sellerInstructions ? <Text style={styles.muted}>{shipment.sellerInstructions}</Text> : null}
                </View>
                <TextInput accessibilityLabel="Transportista de devolución" value={carrierName} onChangeText={setCarrierName} placeholder="Transportista" placeholderTextColor={Colors.textSubtle} maxLength={100} style={styles.singleInput} />
                <TextInput accessibilityLabel="Número de seguimiento de devolución" value={trackingNumber} onChangeText={setTrackingNumber} placeholder="Número de seguimiento" placeholderTextColor={Colors.textSubtle} maxLength={120} style={styles.singleInput} />
                <TextInput accessibilityLabel="Servicio de devolución" value={serviceLevel} onChangeText={setServiceLevel} placeholder="Servicio (opcional)" placeholderTextColor={Colors.textSubtle} maxLength={100} style={styles.singleInput} />
                <TextInput accessibilityLabel="URL de seguimiento de devolución" autoCapitalize="none" value={trackingUrl} onChangeText={setTrackingUrl} placeholder="https://… (opcional)" placeholderTextColor={Colors.textSubtle} style={styles.singleInput} />
                <TextInput accessibilityLabel="Nota del envío de devolución" value={returnShippingNote} onChangeText={setReturnShippingNote} placeholder="Nota opcional" placeholderTextColor={Colors.textSubtle} maxLength={500} multiline style={styles.input} />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.primaryButton} onPress={confirmReturnShipment}>
                  <Text style={styles.primaryText}>{busy ? "Guardando…" : "Marcar producto como enviado"}</Text>
                </Pressable>
              </>
            )
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
  success: { color: Colors.accent, fontWeight: "800", lineHeight: 20 },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    padding: 12,
    textAlignVertical: "top",
  },
  singleInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    paddingHorizontal: 12,
  },
  fieldRow: { flexDirection: "row", gap: Spacing.sm },
  flexInput: { flex: 1 },
  countryInput: { width: 74 },
  destinationCard: {
    gap: 3,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
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
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  linkText: { color: Colors.primaryLight, fontWeight: "800" },
});
