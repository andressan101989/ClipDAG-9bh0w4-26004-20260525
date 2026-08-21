import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { randomUUID } from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckoutShippingAddressForm } from "@/components/marketplace/CheckoutShippingAddressForm";
import {
  MarketplaceShippingQuoteCard,
  type MarketplaceShippingQuoteState,
} from "@/components/marketplace/MarketplaceShippingQuoteCard";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import { useAuth } from "@/hooks/useAuth";
import { useMarketplaceCart } from "@/hooks/useMarketplaceCart";
import {
  createCheckoutReservation,
  createCreatorCheckoutReservation,
  expireMarketplaceCheckoutReservations,
  fetchMyActiveCheckout,
  MarketplaceOrderServiceError,
  normalizeShippingAddress,
  validateShippingAddress,
  type ShippingAddressInput,
} from "@/services/marketplaceOrderService";
import {
  marketplaceCheckoutAnalyticsTargets,
  marketplaceCommerceEventKey,
  recordCheckoutStarted,
} from "@/services/marketplaceAnalyticsService";

const emptyAddress: ShippingAddressInput = {
  recipientName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
  phone: undefined,
};

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.step}><Text style={styles.stepText}>{number}</Text></View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function MarketplaceCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const cart = useMarketplaceCart();
  const { refreshCart } = cart;
  const [address, setAddress] = useState<ShippingAddressInput>(emptyAddress);
  const [errors, setErrors] = useState<Partial<Record<keyof ShippingAddressInput, string>>>({});
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteStates, setQuoteStates] = useState<Record<string, MarketplaceShippingQuoteState>>({});
  const submitLockRef = useRef(false);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const analyticsInstanceRef = useRef(marketplaceCommerceEventKey("checkout"));
  const analyticsRecordedRef = useRef(false);
  const availableItems = useMemo(
    () => cart.items.filter((item) => item.availability === "available"),
    [cart.items],
  );
  const subtotal = useMemo(
    () => availableItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [availableItems],
  );
  const shippingReady =
    availableItems.length > 0 &&
    availableItems.every((item) => quoteStates[item.key]?.status === "ready");

  useEffect(() => {
    if (!ready || !user || !availableItems.length || analyticsRecordedRef.current) return;
    analyticsRecordedRef.current = true;
    const targets = marketplaceCheckoutAnalyticsTargets(availableItems);
    const metadata = { item_count: availableItems.length, store_count: targets.length };
    for (const target of targets)
      void recordCheckoutStarted({
        productId: target.productId,
        metadata,
        idempotencyKey: `${analyticsInstanceRef.current}:${target.sellerId}`,
      });
  }, [availableItems, ready, user]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!user) {
          setReady(true);
          return;
        }
        await expireMarketplaceCheckoutReservations().catch(() => {});
        await refreshCart();
        if (active) setReady(true);
      })();
      return () => { active = false; };
    }, [refreshCart, user]),
  );

  const updateAddress = (next: ShippingAddressInput) => {
    if (next.country !== address.country || next.region !== address.region) setQuoteStates({});
    setAddress({ ...next, phone: undefined });
    setErrors({});
  };

  const submit = async () => {
    if (submitLockRef.current || !user) return;
    const normalized = normalizeShippingAddress(address);
    const nextErrors = validateShippingAddress(normalized);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !availableItems.length) return;
    if (!shippingReady) {
      Alert.alert("Envío pendiente", "Verifica que todos los productos se envíen a la dirección seleccionada.");
      return;
    }
    const requestItems = availableItems.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      attributionId: item.attributionId,
    }));
    const signature = JSON.stringify({ items: requestItems, address: normalized });
    if (!idempotencyRef.current || idempotencyRef.current.signature !== signature)
      idempotencyRef.current = { signature, key: randomUUID() };
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const hasCreatorAttribution = requestItems.some((item) => Boolean(item.attributionId));
      const result = await (hasCreatorAttribution
        ? createCreatorCheckoutReservation
        : createCheckoutReservation)(requestItems, normalized, idempotencyRef.current.key);
      const authoritative = new Map(
        result.orders.flatMap((order) => order.items).map((item) => [item.variantId, item.unitPrice]),
      );
      const priceChanged = availableItems.some(
        (item) => authoritative.has(item.variantId) && authoritative.get(item.variantId) !== item.unitPrice,
      );
      const continueToReservation = () => {
        cart.removeItems(availableItems.map((item) => item.key));
        idempotencyRef.current = null;
        router.replace({ pathname: "/checkout/reservation/[id]", params: { id: result.checkout.id } } as never);
      };
      if (priceChanged)
        Alert.alert("El precio de este producto cambió", "Revisa el total final actualizado antes de pagar.", [
          { text: "Revisar total", onPress: continueToReservation },
        ]);
      else continueToReservation();
    } catch (error) {
      const code = error instanceof MarketplaceOrderServiceError ? error.code : "marketplace_order_unknown";
      if (code === "marketplace_insufficient_inventory") {
        await cart.refreshCart();
        Alert.alert("Cambió el inventario", "Uno o más productos ya no tienen la cantidad solicitada. Actualizamos tu carrito.");
        idempotencyRef.current = null;
      } else if (code === "marketplace_active_checkout_exists") {
        const active = await fetchMyActiveCheckout().catch(() => null);
        Alert.alert("Ya tienes una reserva activa", "Finaliza o cancela tu reserva antes de crear otra.", active ? [
          { text: "Cerrar", style: "cancel" },
          { text: "Ver reserva", onPress: () => router.replace({ pathname: "/checkout/reservation/[id]", params: { id: active.checkout.id } } as never) },
        ] : undefined);
      } else if (code === "marketplace_idempotency_conflict") {
        Alert.alert("No se pudo reutilizar esta solicitud", "Actualiza el checkout e inténtalo nuevamente.");
        idempotencyRef.current = null;
      } else {
        const active = await fetchMyActiveCheckout().catch(() => null);
        if (active)
          router.replace({ pathname: "/checkout/reservation/[id]", params: { id: active.checkout.id } } as never);
        else if(code==='marketplace_order_transport')
          Alert.alert("No pudimos confirmar la reserva", "Verifica tu conexión e inténtalo nuevamente con la misma solicitud.");
        else Alert.alert("No se pudo crear la reserva", "Ocurrió un error al validar la reserva. Inténtalo nuevamente.");
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  if (!ready)
    return <View style={[styles.root, styles.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Verificando carrito…</Text></View>;
  if (!user)
    return <View style={[styles.root, styles.center, { paddingTop: insets.top, paddingHorizontal: Spacing.xl }]}><MaterialIcons name="lock" size={48} color={Colors.primary} /><Text style={styles.title}>Inicia sesión</Text><Text style={styles.muted}>Inicia sesión para reservar los productos de tu carrito.</Text><Pressable style={styles.primary} onPress={() => router.push("/login" as never)} accessibilityRole="button"><Text style={styles.primaryText}>Iniciar sesión</Text></Pressable></View>;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable style={styles.icon} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver">
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Checkout · OnSpace SHOP</Text>
          <Text style={styles.headerSubtitle}>Compra segura</Text>
        </View>
        <MaterialIcons name="verified-user" size={22} color={Colors.accent} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {!availableItems.length ? (
          <View style={styles.card}><Text style={styles.title}>No hay productos disponibles</Text><Text style={styles.muted}>Vuelve al carrito para revisar productos agotados o eliminados.</Text></View>
        ) : (
          <>
            <View style={styles.card}>
              <SectionHeading number={1} title="Producto" />
              {availableItems.map((item) => (
                <View key={item.key} style={styles.productRow}>
                  <Image source={item.imageUrl ? { uri: item.imageUrl } : undefined} style={styles.productImage} contentFit="cover" accessibilityLabel={item.title} />
                  <View style={styles.productCopy}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.storeLabel} numberOfLines={1}>{item.sellerUsername ? `@${item.sellerUsername}` : "OnSpace Shop"}</Text>
                    <Text style={styles.options} numberOfLines={1}>{item.options.map((option) => option.value).join(" · ")}</Text>
                    <Text style={styles.itemMeta}>Cantidad {item.quantity}</Text>
                  </View>
                  <Text style={styles.linePrice}>{(item.unitPrice * item.quantity).toFixed(2)} BDAG</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <SectionHeading number={2} title="Dirección de envío" />
              <CheckoutShippingAddressForm value={address} errors={errors} onChange={updateAddress} />
            </View>

            <View style={styles.card}>
              <SectionHeading number={3} title="Método de envío" />
              {availableItems.map((item) => (
                <MarketplaceShippingQuoteCard
                  key={item.key}
                  productId={item.productId}
                  quantity={item.quantity}
                  countryCode={address.country}
                  regionCode={address.region}
                  selectionMode
                  onChange={(state) => setQuoteStates((current) => ({ ...current, [item.key]: state }))}
                />
              ))}
              <Text style={styles.notice}>La reserva congela la opción y el total de envío confirmados por el servidor.</Text>
            </View>

            <View style={styles.card}>
              <SectionHeading number={4} title="Método de pago" />
              <View style={styles.walletRow} accessibilityRole="radio" accessibilityState={{ checked: true }} accessibilityLabel="Billetera BDAG">
                <View style={styles.walletIcon}><Text style={styles.walletIconText}>B</Text></View>
                <View style={styles.productCopy}><Text style={styles.itemTitle}>Billetera BDAG</Text><Text style={styles.itemMeta}>El saldo se verifica de forma segura al reservar.</Text></View>
                <MaterialIcons name="check-circle" size={22} color={Colors.primaryLight} />
              </View>
            </View>

            <View style={styles.card}>
              <SectionHeading number={5} title="Resumen del pedido" />
              <View style={styles.totalRow}><Text style={styles.summaryLabel}>Subtotal</Text><Text style={styles.summaryValue}>{subtotal.toFixed(2)} BDAG</Text></View>
              <View style={styles.totalRow}><Text style={styles.summaryLabel}>Envío</Text><Text style={styles.summaryPending}>Se confirma al reservar</Text></View>
              <View style={styles.divider} />
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.summaryPending}>Total seguro en el siguiente paso</Text></View>
            </View>

            <Pressable
              style={[styles.primary, (submitting || !shippingReady) && styles.disabled]}
              onPress={() => void submit()}
              disabled={submitting || !shippingReady}
              accessibilityRole="button"
              accessibilityLabel="Continuar y reservar inventario"
              accessibilityState={{ disabled: submitting || !shippingReady }}
            >
              <LinearGradient colors={Colors.gradientBrand as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryGradient}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Continuar y reservar inventario</Text>}
              </LinearGradient>
            </Pressable>
            <Text style={styles.helper}>No se descontará BDAG hasta que confirmes el total autoritativo.</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07080C" },
  center: { alignItems: "center", justifyContent: "center", gap: Spacing.md },
  header: { minHeight: 68, flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, paddingBottom: 4 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSubtitle: { color: Colors.accent, fontSize: FontSize.xs, marginTop: 2 },
  content: { padding: Spacing.md, gap: Spacing.md },
  card: { backgroundColor: "#101219", borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: "#2B2E3A" },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  step: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary },
  stepText: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  muted: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: "center" },
  productRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, minWidth: 0 },
  productImage: { width: 68, height: 68, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  productCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  storeLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  options: { color: Colors.primaryLight, fontSize: FontSize.sm },
  itemMeta: { color: Colors.textSubtle, fontSize: FontSize.xs },
  linePrice: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold, maxWidth: 88, textAlign: "right" },
  notice: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  walletRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.primaryDim, padding: Spacing.md },
  walletIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primary },
  walletIconText: { color: "#fff", fontWeight: FontWeight.extrabold, fontSize: FontSize.lg },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.md },
  summaryLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  summaryValue: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  summaryPending: { flexShrink: 1, color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: "right" },
  divider: { height: 1, backgroundColor: Colors.borderSubtle },
  totalLabel: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  primary: { minHeight: 56, borderRadius: Radius.lg, overflow: "hidden" },
  primaryGradient: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.lg },
  primaryText: { color: "#fff", fontWeight: FontWeight.bold, fontSize: FontSize.md },
  disabled: { opacity: 0.5 },
  helper: { color: Colors.textSubtle, textAlign: "center", fontSize: FontSize.xs },
});
