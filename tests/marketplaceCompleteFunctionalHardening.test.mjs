import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viewer = read("components/live/commerce/LiveViewerCommerce.tsx");
const shipping = read("components/live/shop/LiveShippingForm.tsx");
const review = read("components/live/shop/LiveReservationSummary.tsx");
const success = read("components/live/shop/LivePurchaseSuccess.tsx");
const payment = read("services/marketplacePaymentService.ts");
const liveService = read("services/liveCommerceService.ts");
const creation = read("app/create-product.tsx");

test("LIVE checkout exposes the complete in-session purchase state machine", () => {
  for (const step of ["product", "shipping", "review", "processing", "success", "recoverable_error"])
    assert.match(viewer, new RegExp(`\\| \\\"${step}\\\"|\\= \\\"${step}\\\"`));
  assert.match(viewer, /Compra sin salir del LIVE/);
  assert.match(viewer, /setStage\("processing"\)/);
  assert.match(viewer, /setStage\("success"\)/);
});

test("normal LIVE checkout presents review and payment rather than a reservation task", () => {
  assert.match(shipping, /label="Revisar pedido"/);
  assert.match(review, /Revisa y paga tu pedido/);
  assert.match(review, /label="Pagar ahora"/);
  assert.doesNotMatch(review, /Ver reserva/);
  assert.doesNotMatch(viewer, /onOpenReservation/);
});

test("payment processing is single-flight and retains one logical payment key", () => {
  assert.match(viewer, /livePaymentGuard/);
  assert.match(viewer, /payment_guard_blocked/);
  assert.match(viewer, /paymentKey\.current \?\? \(paymentKey\.current = randomUUID\(\)\)/);
  assert.match(payment, /marketplace_payment_idempotency_conflict/);
  assert.match(viewer, /fetchMyCheckout\(reservation\.id\)/);
});

test("successful purchase stays in LIVE and preserves authoritative server paths", () => {
  assert.match(success, /Compra realizada/);
  assert.match(success, /Continuar viendo el LIVE/);
  assert.match(viewer, /onContinue=\{onClose\}/);
  assert.match(viewer, /createLiveCheckoutReservation/);
  assert.match(viewer, /payMarketplaceCheckout/);
  assert.match(liveService, /create_live_marketplace_checkout_reservation/);
});

test("recoverable checkout remains available without becoming the normal path", () => {
  assert.match(viewer, /fetchMyActiveLiveCheckout\(sessionId\)/);
  assert.match(viewer, /fetchMyActiveCheckout\(\)/);
  assert.match(viewer, /Continuar pago/);
  assert.match(viewer, /cancelCheckoutReservation/);
});

test("publication requires media and safely converts creator percent to basis points", () => {
  assert.match(creation, /if \(!images\.length \|\| !imageAssetIds\.length\)/);
  assert.match(creation, /Foto requerida/);
  assert.match(creation, /creatorCommissionPercent > 30/);
  assert.match(creation, /commissionBps: Math\.round\(creatorCommissionPercent \* 100\)/);
  assert.match(creation, /offerScope: 'public_creator'/);
  assert.match(creation, /Permitir que otros creadores vendan este producto/);
});
