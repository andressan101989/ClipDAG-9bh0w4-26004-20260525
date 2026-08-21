import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { randomUUID } from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  cancelCheckoutReservation,
  expireMarketplaceCheckoutReservations,
  fetchMyCheckout,
  type CreateCheckoutReservationResult,
} from "@/services/marketplaceOrderService";
import {
  fetchAuthoritativeBdagBalance,
  MarketplacePaymentError,
  payMarketplaceCheckout,
} from "@/services/marketplacePaymentService";
import { shippingCountryLabel } from "@/services/marketplaceShippingSetup";

function SectionHeading({ number, title }: { number: number; title: string }) {
  return <View style={styles.sectionHeading}><View style={styles.step}><Text style={styles.stepText}>{number}</Text></View><Text style={styles.sectionTitle}>{title}</Text></View>;
}

export default function ReservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<CreateCheckoutReservationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [remaining, setRemaining] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const expiryLock = useRef(false);
  const paymentLock = useRef(false);
  const paymentKey = useRef(randomUUID());
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [checkout, currentBalance] = await Promise.all([
        fetchMyCheckout(id),
        fetchAuthoritativeBdagBalance(),
      ]);
      setData(checkout);
      setBalance(currentBalance);
    } catch {
      Alert.alert("Reserva no disponible", "No pudimos cargar esta reserva.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((new Date(data?.checkout.expiresAt ?? 0).getTime() - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0 && data?.checkout.status === "pending_payment" && !expiryLock.current) {
        expiryLock.current = true;
        void expireMarketplaceCheckoutReservations().then(load).finally(() => { expiryLock.current = false; });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data?.checkout.expiresAt, data?.checkout.status, load]);
  const cancel = () => Alert.alert("Cancelar reserva", "Los productos reservados volverán al inventario disponible.", [
    { text: "Mantener reserva", style: "cancel" },
    { text: "Cancelar reserva", style: "destructive", onPress: async () => {
      if (!id) return;
      const result = await cancelCheckoutReservation(id);
      setData(result);
      Alert.alert("Reserva cancelada", "El inventario reservado volvió a estar disponible.");
    } },
  ]);
  const submitPayment = async () => {
    if (!id || paymentLock.current) return;
    paymentLock.current = true;
    setPaying(true);
    try {
      const receipt = await payMarketplaceCheckout(id, paymentKey.current);
      await load();
      setBalance(receipt.buyer.newBdagBalance);
      Alert.alert("Pago confirmado", "Pedido confirmado");
    } catch (error) {
      const code = error instanceof MarketplacePaymentError ? error.code : "marketplace_payment_unknown";
      if (code === "marketplace_checkout_expired") Alert.alert("La reserva expiró", "Los productos regresaron al inventario. Agrégalos nuevamente al carrito para continuar.");
      else if (code === "marketplace_checkout_cancelled" || code === "marketplace_checkout_not_payable") Alert.alert("Reserva cancelada", "Esta reserva ya no puede pagarse.");
      else if (code === "marketplace_insufficient_bdag_balance") Alert.alert("Saldo BDAG insuficiente", `Necesitas ${data?.checkout.total.toFixed(2)} BDAG y tienes ${(balance ?? 0).toFixed(2)} BDAG disponibles.`, [
        { text: "Cerrar", style: "cancel" },
        { text: "Agregar saldo", onPress: () => router.push("/(tabs)/wallet" as never) },
      ]);
      else if (code === "marketplace_payment_transport") {
        Alert.alert("No pudimos confirmar el estado del pago", "Verificaremos el pedido antes de intentar nuevamente.");
        await load();
      } else Alert.alert("No se pudo confirmar el pago", "El pedido necesita ser revisado antes de cobrarlo. No se descontó BDAG.");
    } finally {
      paymentLock.current = false;
      setPaying(false);
    }
  };
  const confirmPayment = () => Alert.alert(
    "Confirmar compra",
    `Se descontarán ${data?.checkout.total.toFixed(2)} BDAG de tu saldo para confirmar este pedido.\n\nEl pago quedará protegido mientras se procesa la entrega.`,
    [
      { text: "Volver", style: "cancel" },
      { text: `Pagar ${data?.checkout.total.toFixed(2)} BDAG`, onPress: () => void submitPayment() },
    ],
  );

  if (loading || !data)
    return <View style={[styles.root, styles.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Cargando reserva…</Text></View>;
  const pending = data.checkout.status === "pending_payment";
  const paid = data.checkout.status === "paid";
  const expired = data.checkout.status === "expired";
  const cancelled = data.checkout.status === "cancelled";
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable style={styles.icon} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver"><MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.headerTitle}>Checkout · OnSpace SHOP</Text><Text style={styles.reference}>{data.checkout.reference}</Text></View>
        <View style={[styles.badge, (expired || cancelled) && styles.badgeTerminal]}><Text style={styles.badgeText}>{paid ? "Pagado" : pending ? countdown : expired ? "Expirada" : "Cancelada"}</Text></View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        {paid ? <View style={styles.hero}><MaterialIcons name="verified" size={36} color={Colors.success} /><Text style={styles.heroTitle}>Compra confirmada</Text><Text style={styles.total}>{data.payment?.grossAmount.toFixed(2)} BDAG</Text><Text style={styles.muted}>Tus pedidos ya están disponibles en Mis pedidos.</Text></View> : null}
        {!pending && !paid ? <View style={styles.hero}><MaterialIcons name={expired ? "schedule" : "cancel"} size={32} color={Colors.secondary} /><Text style={styles.heroTitle}>{expired ? "Reserva expirada" : "Reserva cancelada"}</Text><Text style={styles.muted}>Los productos regresaron al inventario disponible.</Text></View> : null}

        <View style={styles.card}>
          <SectionHeading number={1} title="Producto" />
          {data.orders.flatMap((order) => order.items).map((item) => (
            <View key={item.id} style={styles.productRow}>
              <Image source={item.imageUrl ? { uri: item.imageUrl } : undefined} style={styles.productImage} contentFit="cover" accessibilityLabel={item.productTitle} />
              <View style={styles.productCopy}><Text style={styles.textStrong} numberOfLines={2}>{item.productTitle}</Text><Text style={styles.options}>{item.options.map((option) => option.value).join(" · ")}</Text><Text style={styles.mutedLeft}>Cantidad {item.quantity}</Text></View>
              <Text style={styles.price}>{item.lineTotal.toFixed(2)} BDAG</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <SectionHeading number={2} title="Dirección de envío" />
          <Text style={styles.textStrong}>{data.shippingAddress.recipientName}</Text>
          <Text style={styles.mutedLeft}>{data.shippingAddress.city}, {data.shippingAddress.region} · {shippingCountryLabel(data.shippingAddress.country)}</Text>
          <Text style={styles.inAppNote}>Toda la comunicación y actualizaciones del pedido se realizan dentro de la app.</Text>
        </View>

        <View style={styles.card}>
          <SectionHeading number={3} title="Método de envío" />
          {data.orders.flatMap((order) => order.frozenShipping).map((shipping) => (
            <View key={shipping.shippingQuoteFingerprint} style={styles.shippingRow} accessibilityRole="radio" accessibilityState={{ checked: true }}>
              <MaterialIcons name="check-circle" size={20} color={Colors.primaryLight} />
              <View style={styles.productCopy}><Text style={styles.textStrong}>Envío estándar</Text><Text style={styles.mutedLeft}>Entrega estimada en {shipping.processingDaysMin + shipping.transitDaysMin}–{shipping.processingDaysMax + shipping.transitDaysMax} días</Text></View>
              <Text style={styles.price}>{shipping.shippingAmount.toFixed(2)} BDAG</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <SectionHeading number={4} title="Método de pago" />
          <View style={styles.walletRow} accessibilityRole="radio" accessibilityState={{ checked: true }} accessibilityLabel="Billetera BDAG">
            <View style={styles.walletIcon}><Text style={styles.walletIconText}>B</Text></View>
            <View style={styles.productCopy}><Text style={styles.textStrong}>Billetera BDAG</Text><Text style={styles.mutedLeft}>Saldo disponible: {balance?.toFixed(2) ?? "—"} BDAG</Text></View>
            <MaterialIcons name="check-circle" size={22} color={Colors.primaryLight} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionHeading number={5} title="Resumen del pedido" />
          <View style={styles.totalRow}><Text style={styles.summaryLabel}>Subtotal</Text><Text style={styles.summaryValue}>{data.checkout.subtotal.toFixed(2)} BDAG</Text></View>
          <View style={styles.totalRow}><Text style={styles.summaryLabel}>Envío</Text><Text style={styles.summaryValue}>{data.checkout.shippingAmount.toFixed(2)} BDAG</Text></View>
          <View style={styles.divider} />
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>{data.checkout.total.toFixed(2)} BDAG</Text></View>
        </View>

        {paid ? data.orders.map((order) => <Pressable key={order.id} style={styles.secondary} onPress={() => router.push(`/orders/${order.id}` as never)} accessibilityRole="button" accessibilityLabel={`Ver pedido ${order.orderNumber}`}><Text style={styles.secondaryText}>Ver pedido · {order.orderNumber}</Text></Pressable>) : null}
        {pending ? <>
          <Pressable style={[styles.primary, (paying || remaining <= 0) && styles.disabled]} disabled={paying || remaining <= 0} onPress={confirmPayment} accessibilityRole="button" accessibilityLabel="Confirmar compra con BDAG" accessibilityState={{ disabled: paying || remaining <= 0 }}>
            <LinearGradient colors={Colors.gradientBrand as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryGradient}>{paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmar compra · {data.checkout.total.toFixed(2)} BDAG</Text>}</LinearGradient>
          </Pressable>
          <Text style={styles.helper}>Pago protegido por el Marketplace hasta que el pedido avance en la entrega.</Text>
          <Pressable style={styles.cancel} onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancelar reserva"><Text style={styles.cancelText}>Cancelar reserva</Text></Pressable>
        </> : !paid ? <View style={styles.actions}><Pressable style={styles.secondary} onPress={() => router.replace("/(tabs)/shop" as never)}><Text style={styles.secondaryText}>Volver al Marketplace</Text></Pressable><Pressable style={styles.secondary} onPress={() => router.push("/cart" as never)}><Text style={styles.secondaryText}>Ver carrito</Text></Pressable></View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07080C" },
  center: { alignItems: "center", justifyContent: "center", gap: Spacing.md },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  reference: { color: Colors.textSubtle, fontSize: FontSize.xs },
  badge: { backgroundColor: Colors.accentDim, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  badgeTerminal: { backgroundColor: Colors.secondaryDim },
  badgeText: { color: Colors.textPrimary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  content: { padding: Spacing.md, gap: Spacing.md },
  hero: { alignItems: "center", gap: Spacing.sm, padding: Spacing.lg },
  heroTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  card: { backgroundColor: "#101219", borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: "#2B2E3A" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  step: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary },
  stepText: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  sectionTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  productRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, minWidth: 0 },
  productImage: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  productCopy: { flex: 1, minWidth: 0, gap: 3 },
  textStrong: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  options: { color: Colors.primaryLight, fontSize: FontSize.sm },
  muted: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: "center" },
  mutedLeft: { color: Colors.textSecondary, fontSize: FontSize.sm },
  inAppNote: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  price: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold, textAlign: "right" },
  shippingRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, padding: Spacing.sm },
  walletRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.lg, backgroundColor: Colors.primaryDim, padding: Spacing.md },
  walletIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primary },
  walletIconText: { color: "#fff", fontWeight: FontWeight.extrabold, fontSize: FontSize.lg },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.md },
  summaryLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  summaryValue: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  divider: { height: 1, backgroundColor: Colors.borderSubtle },
  totalLabel: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  total: { color: Colors.primaryLight, fontSize: FontSize.xl, fontWeight: FontWeight.extrabold },
  primary: { minHeight: 56, borderRadius: Radius.lg, overflow: "hidden" },
  primaryGradient: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.md },
  primaryText: { color: "#fff", fontWeight: FontWeight.bold, fontSize: FontSize.md },
  disabled: { opacity: 0.45 },
  helper: { color: Colors.textSubtle, textAlign: "center", fontSize: FontSize.xs },
  cancel: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  cancelText: { color: Colors.secondary, fontWeight: FontWeight.bold },
  actions: { flexDirection: "row", gap: Spacing.sm },
  secondary: { flex: 1, minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.sm },
  secondaryText: { color: Colors.primaryLight, fontWeight: FontWeight.bold, textAlign: "center" },
});
