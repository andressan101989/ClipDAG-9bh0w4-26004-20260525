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
  LiveCommerceError,
  type LiveSessionProduct,
} from "@/services/liveCommerceService";
import {
  liveReservationSignature,
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

type Stage =
  | "bag"
  | "product"
  | "shipping"
  | "reservation"
  | "active_other"
  | "success";
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
  reservation: "Reserva",
  active_other: "Reserva activa",
  success: "Compra confirmada",
};

export interface LiveViewerCommerceProps {
  visible: boolean;
  sessionId: string;
  products: LiveSessionProduct[];
  initialProductId?: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}
export function LiveViewerCommerce({
  visible,
  sessionId,
  products,
  initialProductId,
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
    [feedback, setFeedback] = useState<string | null>(null),
    [paymentConfirmVisible, setPaymentConfirmVisible] = useState(false);
  const pendingCommand = useRef<PendingReservationCommand | null>(null),
    paymentKey = useRef<string | null>(null),
    lock = useRef(false),
    previousVisible = useRef(false),
    openedProduct = useRef<string | null>(null);
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
    const active = await fetchMyActiveLiveCheckout(sessionId).catch(() => null);
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
      setStage("reservation");
      return;
    }
    const other = await fetchMyActiveCheckout().catch(() => null);
    setOtherCheckoutId(other?.checkout.id ?? null);
    setStage("active_other");
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
    try {
      const fresh = await fetchMarketplaceProductDetail(pin.productId),
        freshVariant = fresh?.variants.find(
          (value) =>
            value.id === variant.id &&
            value.status === "active" &&
            value.available_quantity >= quantity,
        );
      if (!fresh || !freshVariant)
        throw new LiveCommerceError("live_commerce_product_unavailable");
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
      const result = await createLiveCheckoutReservation(
        sessionId,
        pin.id,
        freshVariant.id,
        quantity,
        normalized,
        command.idempotencyKey,
      );
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
      setStage("reservation");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      const code=error instanceof LiveCommerceError?error.code:error instanceof MarketplaceReadError?error.code:"live_commerce_unknown";
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
    if (lock.current || !reservation) return;
    setPaymentConfirmVisible(false);
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await refreshBalance();
      const paid = await payMarketplaceCheckout(
        reservation.id,
        paymentKey.current ?? (paymentKey.current = randomUUID()),
      );
      setSuccessOrderId(paid.orders[0]?.id ?? reservation.orderId);
      setReservation({ ...reservation, status: "paid" });
      setStage("success");
      await refreshBalance();
    } catch (error) {
      const code =
        error instanceof MarketplacePaymentError
          ? error.code
          : "marketplace_payment_unknown";
      if (
        code === "marketplace_payment_transport" ||
        code === "marketplace_payment_already_processed"
      ) {
        const completed = await reconcilePayment();
        if (!completed)
          setFeedback(
            "El pago está por confirmar. Puedes reintentar con la misma clave de forma segura.",
          );
      } else if (code === "marketplace_insufficient_bdag_balance")
        setFeedback("Saldo BDAG insuficiente para completar esta compra.");
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
              ) : stage === "reservation" && reservation ? (
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
                    void refreshBalance();
                    setPaymentConfirmVisible(true);
                  }}
                  onCancel={cancel}
                  onOpenReservation={() =>
                    router.push(
                      `/checkout/reservation/${reservation.id}` as never,
                    )
                  }
                />
              ) : stage === "active_other" ? (
                <View style={styles.center}>
                  <OnSpaceText variant="headingMedium">
                    Ya tienes una reserva activa
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
                      label="Ver reserva"
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
      {reservation ? (
        <LivePaymentConfirmation
          visible={paymentConfirmVisible}
          total={reservation.total}
          onCancel={() => setPaymentConfirmVisible(false)}
          onConfirm={() => void pay()}
        />
      ) : null}
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
