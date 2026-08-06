import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  BottomSheetSurface,
  ErrorState,
  IconButton,
  OnSpaceButton,
  OnSpaceText,
} from "@/components/design";
import { colors, spacing } from "@/design";
import {
  fetchMarketplaceProductDetail,
  MarketplaceReadError,
  type MarketplaceProductDetail,
} from "@/services/marketplaceService";
import {
  reconcileVariantSelection,
  resolveExactVariant,
  selectionForPreferredVariant,
  type MarketplaceVariantSelection,
} from "@/services/marketplaceVariantSelection";
import {
  createLiveCheckoutReservation,
  fetchLiveSessionProducts,
  fetchMyActiveLiveCheckout,
  LiveCheckoutReservationError,
  LiveCommerceError,
  type LiveSessionProduct,
} from "@/services/liveCommerceService";
import {
  liveReservationSignature,
  livePaymentGuard,
  reservationCommandFor,
  stageAfterVisibilityChange,
  type PendingReservationCommand,
} from "@/services/liveCommerceState";
import {
  fetchAuthoritativeBdagBalance,
  MarketplacePaymentError,
  payMarketplaceCheckout,
} from "@/services/marketplacePaymentService";
import {
  cancelCheckoutReservation,
  fetchMyActiveCheckout,
  fetchMyCheckout,
  normalizeShippingAddress,
  validateShippingAddress,
  type ShippingAddressInput,
} from "@/services/marketplaceOrderService";
import { LiveProductBagSheet } from "@/components/live/shop/LiveProductBagSheet";
import { LiveProductQuickView } from "@/components/live/shop/LiveProductQuickView";
import { LiveShippingForm } from "@/components/live/shop/LiveShippingForm";
import { LiveReservationSummary } from "@/components/live/shop/LiveReservationSummary";
import { LivePaymentConfirmation } from "@/components/live/shop/LivePaymentConfirmation";
import { LivePurchaseSuccess } from "@/components/live/shop/LivePurchaseSuccess";

export type LiveCheckoutStep =
  | "product"
  | "shipping"
  | "review"
  | "confirm_payment"
  | "processing"
  | "success"
  | "recoverable_error";
type Stage = "bag" | LiveCheckoutStep;
type Reservation = {
  id: string;
  reference: string;
  status: string;
  expiresAt: string;
  total: number;
  orderId: string | null;
};
const EMPTY_ADDRESS: ShippingAddressInput = {
  recipientName: "",
  line1: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
};
const stageTitle: Record<Stage, string> = {
  bag: "Productos del LIVE",
  product: "Vista rápida",
  shipping: "Entrega",
  review: "Revisar pedido",
  confirm_payment: "Confirmar pago",
  processing: "Procesando pago",
  success: "Compra realizada",
  recoverable_error: "Compra pendiente",
};

export interface LiveViewerCommerceProps {
  visible: boolean;
  sessionId: string;
  products: LiveSessionProduct[];
  initialProductId?: string | null;
  viewerId?: string | null;
  liveStatus?: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}
export function LiveViewerCommerce({
  visible,
  sessionId,
  products,
  initialProductId,
  viewerId,
  liveStatus,
  onClose,
  onRefresh,
}: LiveViewerCommerceProps) {
  const router = useRouter(),
    insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("bag"),
    [pin, setPin] = useState<LiveSessionProduct | null>(null),
    [detail, setDetail] = useState<MarketplaceProductDetail | null>(null),
    [selection, setSelection] = useState<MarketplaceVariantSelection>({}),
    [quantity, setQuantity] = useState(1),
    [address, setAddress] = useState<ShippingAddressInput>(EMPTY_ADDRESS),
    [addressErrors, setAddressErrors] = useState<
      Partial<Record<keyof ShippingAddressInput, string>>
    >({}),
    [reservation, setReservation] = useState<Reservation | null>(null),
    [otherCheckoutId, setOtherCheckoutId] = useState<string | null>(null),
    [balance, setBalance] = useState<number | null>(null),
    [successOrderId, setSuccessOrderId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(0),
    [feedback, setFeedback] = useState<string | null>(null);
  const pendingCommand = useRef<PendingReservationCommand | null>(null),
    paymentKey = useRef<string | null>(null),
    lock = useRef(false),
    previousVisible = useRef(false),
    openedProduct = useRef<string | null>(null);
  const fingerprint = (value: string | null | undefined) =>
    value ? value.replace(/-/g, "").slice(0, 8) : null;
  const variant = useMemo(
    () =>
      detail
        ? resolveExactVariant(detail.options, detail.variants, selection)
        : undefined,
    [detail, selection],
  );
  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchAuthoritativeBdagBalance());
    } catch {
      setFeedback(
        "No pudimos actualizar el saldo. El pago seguirá validándolo de forma segura.",
      );
    }
  }, []);
  const openProduct = useCallback(
    async (item: LiveSessionProduct) => {
      if (item.availability !== "available" || lock.current) return;
      lock.current = true;
      setBusy(true);
      setFeedback(null);
      try {
        await onRefresh();
        const current = (await fetchLiveSessionProducts(sessionId)).find(
          (value) => value.id === item.id,
        );
        if (!current || current.availability !== "available")
          throw new Error("unavailable");
        const next = await fetchMarketplaceProductDetail(item.productId);
        if (!next) throw new Error("unavailable");
        setPin(current);
        setDetail(next);
        setSelection(selectionForPreferredVariant(next.options, next.variants));
        setQuantity(1);
        pendingCommand.current = null;
        setStage("product");
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        setFeedback(error instanceof MarketplaceReadError&&error.code==='marketplace_read_permission'?"No pudimos consultar la tienda por una configuración de acceso. Inténtalo nuevamente.":error instanceof MarketplaceReadError&&error.code==='marketplace_read_transport'?"No pudimos conectar con la tienda. Revisa tu conexión.":"Este producto ya no puede comprarse desde el LIVE.");
        setStage("bag");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [onRefresh, sessionId],
  );
  useEffect(() => {
    const wasVisible = previousVisible.current;
    previousVisible.current = visible;
    if (!wasVisible && visible) {
      const next = stageAfterVisibilityChange(
        wasVisible,
        visible,
        stage === "bag" ? "shelf" : stage,
        !!reservation,
        stage === "success",
        "shelf",
      );
      setStage(next === "shelf" ? "bag" : (next as Stage));
      if (initialProductId && openedProduct.current !== initialProductId) {
        const product = products.find((item) => item.id === initialProductId);
        if (product) {
          openedProduct.current = initialProductId;
          void openProduct(product);
        }
      }
    }
    if (!visible) openedProduct.current = null;
  }, [initialProductId, openProduct, products, reservation, stage, visible]);
  useEffect(() => {
    if (!reservation || reservation.status !== "pending_payment") return;
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.floor((Date.parse(reservation.expiresAt) - Date.now()) / 1000),
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [reservation]);
  const choose = (optionId: string, valueId: string) => {
    if (!detail) return;
    const next = reconcileVariantSelection(
      detail.options,
      detail.variants,
      selection,
      optionId,
      valueId,
    );
    if (JSON.stringify(next) !== JSON.stringify(selection)) setQuantity(1);
    setSelection(next);
    pendingCommand.current = null;
  };
  const recoverActive = async () => {
    if (!pin) return;
    let active;
    try {
      active = await fetchMyActiveLiveCheckout(sessionId);
    } catch (error) {
      const code = error instanceof LiveCommerceError ? error.code : null;
      setFeedback(
        code === "live_commerce_transport"
          ? "No pudimos recuperar tu compra pendiente. Revisa tu conexión."
          : code === "live_commerce_auth_required"
            ? "Tu sesión expiró. Inicia sesión nuevamente."
            : "No pudimos verificar tu compra pendiente. Inténtalo nuevamente.",
      );
      setStage("recoverable_error");
      return;
    }
    if (active && active.pinId === pin.id) {
      setReservation({
        id: active.checkoutId,
        reference: active.reference,
        status: active.status,
        expiresAt: active.expiresAt,
        total: active.total,
        orderId: active.orderId,
      });
      paymentKey.current = randomUUID();
      await refreshBalance();
      setStage((current) => (current === "success" ? current : "review"));
      return;
    }
    try {
      const other = await fetchMyActiveCheckout();
      setOtherCheckoutId(other?.checkout.id ?? null);
      setFeedback(
        other
          ? "Ya tienes una compra pendiente. Continuaremos desde donde quedaste."
          : "No encontramos una compra pendiente para recuperar.",
      );
    } catch {
      setOtherCheckoutId(null);
      setFeedback(
        "No pudimos verificar tus compras pendientes. Inténtalo nuevamente.",
      );
    }
    setStage("recoverable_error");
  };
  const reserve = async () => {
    if (lock.current || !pin || !variant || variant.available_quantity < 1)
      return;
    const errors = validateShippingAddress(address) as Partial<
      Record<keyof ShippingAddressInput, string>
    >;
    setAddressErrors(errors);
    if (Object.keys(errors).length) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    if (__DEV__)
      console.log("[LiveCheckout] reservation_start", {
        sessionFingerprint: fingerprint(sessionId),
        productFingerprint: fingerprint(pin.productId),
        variantFingerprint: fingerprint(variant.id),
        quantity,
        countryCode: address.country.trim().toUpperCase().slice(0, 3),
        hasAddress: Boolean(address.line1.trim()),
      });
    try {
      if (__DEV__)
        console.log("[LiveCheckout] validation_start", {
          sessionFingerprint: fingerprint(sessionId),
          productFingerprint: fingerprint(pin.productId),
          variantFingerprint: fingerprint(variant.id),
          quantity,
        });
      if (liveStatus !== "live")
        throw new LiveCheckoutReservationError(
          "live_commerce_live_ended",
          "live_not_active",
        );
      const authoritativePin = (await fetchLiveSessionProducts(sessionId)).find(
          (item) => item.id === pin.id && item.availability === "available",
        );
      if (!authoritativePin)
        throw new LiveCheckoutReservationError(
          "live_commerce_pin_unavailable",
          "product_not_featured",
        );
      const fresh = await fetchMarketplaceProductDetail(pin.productId),
        freshVariant = fresh?.variants.find(
          (value) =>
            value.id === variant.id &&
            value.status === "active" &&
            value.available_quantity >= quantity,
        );
      if (!fresh || !freshVariant)
        throw new LiveCommerceError("live_commerce_product_unavailable");
      if (viewerId && fresh.product.seller_id === viewerId)
        throw new LiveCheckoutReservationError(
          "marketplace_own_product_forbidden",
          "own_product",
        );
      const normalized = normalizeShippingAddress(address),
        signature = liveReservationSignature(
          sessionId,
          pin.id,
          freshVariant.id,
          quantity,
          normalized,
        ),
        command = reservationCommandFor(
          signature,
          pendingCommand.current,
          randomUUID,
        );
      pendingCommand.current = command;
      if (__DEV__)
        console.log("[LiveCheckout] rpc_start", {
          sessionFingerprint: fingerprint(sessionId),
          productFingerprint: fingerprint(pin.productId),
          variantFingerprint: fingerprint(freshVariant.id),
          quantity,
          countryCode: normalized.country.toUpperCase().slice(0, 3),
          hasAddress: Boolean(normalized.line1),
          idempotencyFingerprint: fingerprint(command.idempotencyKey),
          operation: "create_live_marketplace_checkout_reservation",
        });
      const result = await createLiveCheckoutReservation(
        sessionId,
        pin.id,
        freshVariant.id,
        quantity,
        normalized,
        command.idempotencyKey,
      );
      if (__DEV__)
        console.log("[LiveCheckout] rpc_success", {
          checkoutPresent: Boolean(result.checkout.id),
          checkoutStatus: result.checkout.status,
          operation: "create_live_marketplace_checkout_reservation",
        });
      pendingCommand.current = null;
      paymentKey.current = randomUUID();
      setReservation({
        id: result.checkout.id,
        reference: result.checkout.reference,
        status: result.checkout.status,
        expiresAt: result.checkout.expiresAt,
        total: result.checkout.total,
        orderId: result.orders[0]?.id ?? null,
      });
      await refreshBalance();
      setStage("review");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      const code=error instanceof LiveCommerceError?error.code:error instanceof MarketplaceReadError?error.code:"live_commerce_unknown";
      const reservationCode = error instanceof LiveCheckoutReservationError
        ? error.reservationCode
        : null;
      if (__DEV__)
        console.warn("[LiveCheckout] rpc_failed", {
          code,
          businessCode: reservationCode,
          postgresCode: error instanceof LiveCommerceError ? error.postgresCode : null,
          operation: "create_live_marketplace_checkout_reservation",
        });
      if (code === "marketplace_active_checkout_exists") {
        pendingCommand.current = null;
        await recoverActive();
      } else if (code === "live_affiliate_offer_unavailable") {
        pendingCommand.current = null;
        setFeedback("La oferta de este creador ya no está disponible.");
        await onRefresh();
        setPin(null);
        setDetail(null);
        setStage("bag");
      } else if (code === "live_affiliate_self_purchase_forbidden") {
        pendingCommand.current = null;
        setFeedback(
          "No puedes generar una comisión comprando desde tu propio LIVE.",
        );
      } else if (reservationCode === "own_product") {
        pendingCommand.current = null;
        setFeedback("No puedes comprar tu propio producto.");
      } else if (reservationCode === "live_not_active") {
        pendingCommand.current = null;
        setFeedback("Este LIVE ya terminó. No se creó ninguna reserva.");
        await onRefresh();
      } else if (reservationCode === "product_not_featured") {
        pendingCommand.current = null;
        setFeedback("Este producto ya no está disponible en el LIVE.");
        await onRefresh();
      } else if (reservationCode === "variant_invalid") {
        pendingCommand.current = null;
        setFeedback("La variante seleccionada ya no está disponible.");
      } else if (reservationCode === "out_of_stock") {
        pendingCommand.current = null;
        setFeedback("Este producto se quedó sin inventario disponible.");
        await onRefresh();
      } else if (reservationCode === "shipping_unsupported") {
        pendingCommand.current = null;
        setFeedback("Este producto no se envía a la dirección seleccionada.");
      } else if (reservationCode === "shipping_configuration") {
        pendingCommand.current = null;
        setFeedback("El vendedor debe actualizar la configuración de envío.");
      } else if(code==='marketplace_read_permission'){
        pendingCommand.current=null;setFeedback('No pudimos verificar el producto por una configuración de acceso. No se creó ninguna reserva.');
      } else if(code==='marketplace_read_transport'){
        setFeedback('No pudimos conectar con la tienda. No se creó ninguna reserva.');
      } else {
        if (code !== "live_commerce_transport") pendingCommand.current = null;
        setFeedback(
          code === "live_commerce_live_ended"
            ? "Este LIVE terminó. Continúa desde tu reserva si ya creaste una."
            : "No se reservó inventario. Revisa tu conexión e inténtalo nuevamente.",
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reconcilePayment = async () => {
    if (!reservation) return false;
    const current = await fetchMyCheckout(reservation.id).catch(() => null);
    if (current?.checkout.status === "paid") {
      setSuccessOrderId(current.orders[0]?.id ?? reservation.orderId);
      setReservation({ ...reservation, status: "paid" });
      setStage("success");
      return true;
    }
    if (
      current?.checkout.status === "cancelled" ||
      current?.checkout.status === "expired"
    ) {
      setFeedback(
        current.checkout.status === "expired"
          ? "La reserva expiró."
          : "La reserva fue cancelada.",
      );
      setReservation({ ...reservation, status: current.checkout.status });
    }
    return false;
  };
  const pay = async () => {
    const guardCode = livePaymentGuard({
      locked: lock.current,
      checkoutStatus: reservation?.status ?? null,
      remaining,
    });
    if (__DEV__)
      console.log("[LiveCheckout] payment_confirm_pressed", {
        locked: lock.current,
        checkoutPresent: Boolean(reservation),
        checkoutStatus: reservation?.status ?? null,
      });
    if (guardCode === "locked" || guardCode === "missing_checkout" || !reservation) {
      if (__DEV__)
        console.warn("[LiveCheckout] payment_guard_blocked", {
          locked: lock.current,
          reservationPresent: Boolean(reservation),
          checkoutStatus: reservation?.status ?? null,
          remaining,
          busy,
        });
      setFeedback(
        !reservation
          ? "No encontramos la compra pendiente. Vuelve a revisar el producto."
          : "El pago ya se está procesando.",
      );
      return;
    }
    if (guardCode) {
      if (__DEV__)
        console.warn("[LiveCheckout] payment_guard_blocked", {
          locked: false,
          reservationPresent: true,
          checkoutStatus: reservation.status,
          remaining,
          busy,
        });
      await reconcilePayment();
      setFeedback(
        reservation.status === "expired" || remaining <= 0
          ? "Esta compra expiró. El inventario fue liberado."
          : reservation.status === "cancelled"
            ? "Esta compra fue cancelada."
            : "Esta compra ya no admite otro pago.",
      );
      setStage((current) => (current === "success" ? current : "review"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    setStage("processing");
    try {
      await refreshBalance();
      if (__DEV__)
        console.log("[LiveCheckout] payment_rpc_start", {
          checkoutFingerprint: reservation.id.slice(0, 8),
          idempotencyKeyPresent: Boolean(paymentKey.current),
        });
      const paid = await payMarketplaceCheckout(
        reservation.id,
        paymentKey.current ?? (paymentKey.current = randomUUID()),
      );
      setSuccessOrderId(paid.orders[0]?.id ?? reservation.orderId);
      setReservation({ ...reservation, status: "paid" });
      setStage("success");
      await refreshBalance();
      await onRefresh();
      if (__DEV__)
        console.log("[LiveCheckout] payment_rpc_success", {
          orderPresent: Boolean(paid.orders?.[0]?.id),
          checkoutStatus: "paid",
        });
    } catch (error) {
      const code =
        error instanceof MarketplacePaymentError
          ? error.code
          : "marketplace_payment_unknown";
      if (__DEV__)
        console.warn("[LiveCheckout] payment_rpc_failed", {
          code,
          stage: "payMarketplaceCheckout",
        });
      if (
        code === "marketplace_payment_transport" ||
        code === "marketplace_payment_already_processed"
      ) {
        const completed = await reconcilePayment();
        if (__DEV__)
          console.log("[LiveCheckout] payment_reconciliation", {
            recovered: completed,
          });
        if (!completed)
          setFeedback(
            "El pago está por confirmar. Puedes reintentar con la misma clave de forma segura.",
          );
      } else if (code === "marketplace_insufficient_bdag_balance")
        setFeedback("Saldo BDAG insuficiente para completar esta compra.");
      else if (code === "marketplace_payment_idempotency_conflict")
        setFeedback("Esta solicitud de pago cambió. Revisa el pedido antes de reintentar.");
      else if (code === "marketplace_checkout_integrity_error")
        setFeedback("El producto o inventario cambió. Revisa el pedido nuevamente.");
      else if (code === "marketplace_auth_required")
        setFeedback("Inicia sesión nuevamente para completar el pago.");
      else if (code === "marketplace_permission_denied")
        setFeedback("No tienes permiso para pagar esta compra.");
      else if (
        code === "marketplace_insufficient_inventory" ||
        code === "marketplace_product_unavailable"
      )
        setFeedback("El producto o la cantidad seleccionada ya no está disponible.");
      else if (
        code === "marketplace_checkout_expired" ||
        code === "marketplace_checkout_cancelled" ||
        code === "marketplace_checkout_not_payable"
      ) {
        await reconcilePayment();
        setFeedback("Esta reserva ya no puede pagarse.");
      } else
        setFeedback("No se realizó un segundo cobro. Inténtalo nuevamente.");
      await refreshBalance();
      setStage((current) => (current === "success" ? current : "review"));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const cancel = () => {
    if (!reservation || lock.current) return;
    Alert.alert(
      "Cancelar reserva",
      "Los productos reservados volverán al inventario disponible.",
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Cancelar reserva",
          style: "destructive",
          onPress: async () => {
            lock.current = true;
            setBusy(true);
            try {
              await cancelCheckoutReservation(reservation.id);
              setReservation(null);
              setFeedback(null);
              paymentKey.current = null;
              pendingCommand.current = null;
              setStage("bag");
              await onRefresh();
            } catch {
              setFeedback("No pudimos cancelar. La reserva no cambió.");
            } finally {
              lock.current = false;
              setBusy(false);
            }
          },
        },
      ],
    );
  };
  const statusText = !variant
    ? detail?.options.every((option) => selection[option.id])
      ? "Esta combinación no está disponible"
      : "Completa tus opciones"
    : variant.available_quantity < 1
      ? "Agotado"
      : null;
  if (stage === "bag")
    return (
      <LiveProductBagSheet
        visible={visible}
        products={products}
        loading={busy}
        error={feedback}
        onClose={onClose}
        onRefresh={() => {
          setFeedback(null);
          void onRefresh();
        }}
        onSelect={(item) => void openProduct(item)}
      />
    );
  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.scrim}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <BottomSheetSurface
            style={[
              styles.sheet,
              { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            ]}
          >
            <View style={styles.header}>
              <IconButton
                icon="arrow-back"
                label="Volver a productos"
                onPress={() => setStage("bag")}
              />
              <View style={styles.title}>
                <OnSpaceText variant="headingSmall">
                  {stageTitle[stage]}
                </OnSpaceText>
                <OnSpaceText variant="caption" color="textMuted">
                  Compra sin salir del LIVE
                </OnSpaceText>
              </View>
              <IconButton
                icon="close"
                label="Cerrar compra"
                onPress={onClose}
              />
            </View>
            {feedback && stage !== "success" ? (
              <View style={styles.feedback}>
                <OnSpaceText variant="bodySmall" color="textDanger">
                  {feedback}
                </OnSpaceText>
              </View>
            ) : null}
            <View style={styles.body}>
              {stage === "product" && detail && pin ? (
                <LiveProductQuickView
                  pin={pin}
                  detail={detail}
                  selection={selection}
                  quantity={quantity}
                  statusText={statusText}
                  busy={busy}
                  onSelect={choose}
                  onQuantity={(value) => {
                    setQuantity(Math.max(1, value));
                    pendingCommand.current = null;
                  }}
                  onContinue={() => setStage("shipping")}
                />
              ) : stage === "shipping" ? (
                <LiveShippingForm
                  value={address}
                  errors={addressErrors}
                  busy={busy}
                  onChange={(value) => {
                    setAddress(value);
                    setAddressErrors({});
                    pendingCommand.current = null;
                  }}
                  onSubmit={() => void reserve()}
                />
              ) : stage === "review" && reservation ? (
                <LiveReservationSummary
                  reference={reservation.reference}
                  total={reservation.total}
                  balance={balance}
                  remaining={remaining}
                  terminal={feedback}
                  busy={busy}
                  payable={
                    remaining > 0 && reservation.status === "pending_payment"
                  }
                  onPay={() => {
                    if (__DEV__)
                      console.log("[LiveCheckout] pay_review_pressed", {
                        checkoutPresent: Boolean(reservation),
                        checkoutStatus: reservation?.status ?? null,
                        remaining,
                      });
                    void refreshBalance();
                    setStage("confirm_payment");
                    if (__DEV__)
                      console.log("[LiveCheckout] payment_confirmation_opened", {
                        checkoutPresent: Boolean(reservation),
                      });
                  }}
                  onCancel={cancel}
                />
              ) : stage === "confirm_payment" && reservation ? (
                <LivePaymentConfirmation
                  total={reservation.total}
                  busy={busy}
                  onCancel={() => setStage("review")}
                  onConfirm={() => void pay()}
                />
              ) : stage === "processing" ? (
                <View style={styles.center} accessibilityLiveRegion="polite">
                  <OnSpaceText variant="headingMedium">
                    Procesando pago
                  </OnSpaceText>
                  <OnSpaceText
                    variant="body"
                    color="textSecondary"
                    style={styles.centerText}
                  >
                    Estamos confirmando tu pago BDAG. No cierres esta pantalla.
                  </OnSpaceText>
                </View>
              ) : stage === "recoverable_error" ? (
                <View style={styles.center}>
                  <OnSpaceText variant="headingMedium">
                    Tienes una compra pendiente
                  </OnSpaceText>
                  <OnSpaceText
                    variant="body"
                    color="textSecondary"
                    style={styles.centerText}
                  >
                    Finalízala o cancélala antes de crear una nueva.
                  </OnSpaceText>
                  <OnSpaceButton
                    label="Seguir viendo"
                    variant="commerce"
                    size="large"
                    onPress={onClose}
                  />
                  {otherCheckoutId ? (
                    <OnSpaceButton
                      label="Continuar pago"
                      variant="secondary"
                      onPress={() =>
                        router.push(
                          `/checkout/reservation/${otherCheckoutId}` as never,
                        )
                      }
                    />
                  ) : null}
                </View>
              ) : stage === "success" ? (
                <LivePurchaseSuccess
                  reference={reservation?.reference}
                  onContinue={onClose}
                  onViewOrder={
                    successOrderId
                      ? () => router.push(`/orders/${successOrderId}` as never)
                      : undefined
                  }
                />
              ) : (
                <ErrorState
                  body="No pudimos cargar este producto."
                  onRetry={() => setStage("bag")}
                />
              )}
            </View>
          </BottomSheetSurface>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  sheet: { height: "88%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  title: { flex: 1 },
  body: { flex: 1 },
  feedback: {
    padding: spacing.md,
    backgroundColor: "rgba(255,93,120,.10)",
    borderRadius: 14,
    marginBottom: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  centerText: { textAlign: "center" },
});
