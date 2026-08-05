import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { livePaymentGuard, reservationCommandFor } from "../services/liveCommerceState.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viewer = read("components/live/commerce/LiveViewerCommerce.tsx");
const confirmation = read("components/live/shop/LivePaymentConfirmation.tsx");
const payment = read("services/marketplacePaymentService.ts");

test("payment guard permits only one live pending checkout with time remaining", () => {
  assert.equal(livePaymentGuard({locked:false,checkoutStatus:"pending_payment",remaining:30}),null);
  assert.equal(livePaymentGuard({locked:true,checkoutStatus:"pending_payment",remaining:30}),"locked");
  assert.equal(livePaymentGuard({locked:false,checkoutStatus:null,remaining:30}),"missing_checkout");
  assert.equal(livePaymentGuard({locked:false,checkoutStatus:"paid",remaining:30}),"checkout_not_payable");
  assert.equal(livePaymentGuard({locked:false,checkoutStatus:"pending_payment",remaining:0}),"checkout_expired");
});

test("logical checkout retry retains its idempotency key", () => {
  let calls=0;
  const uuid=()=>`key-${++calls}`;
  const first=reservationCommandFor("same",null,uuid);
  const retry=reservationCommandFor("same",first,uuid);
  const changed=reservationCommandFor("changed",retry,uuid);
  assert.equal(retry.idempotencyKey,first.idempotencyKey);
  assert.notEqual(changed.idempotencyKey,first.idempotencyKey);
});

test("payment confirmation is rendered in the existing checkout sheet", () => {
  assert.doesNotMatch(confirmation,/\bModal\b/);
  assert.doesNotMatch(confirmation,/BottomSheetSurface/);
  assert.match(confirmation,/Confirmar y pagar/);
  assert.match(confirmation,/onPress=\{onConfirm\}/);
  assert.match(viewer,/\| "confirm_payment"/);
  assert.match(viewer,/stage === "confirm_payment"/);
  assert.match(viewer,/onConfirm=\{\(\) => void pay\(\)\}/);
});

test("live payment chain logs each safe stage and reaches the authoritative gateway", () => {
  for(const marker of ["pay_review_pressed","payment_confirmation_opened","payment_confirm_pressed","payment_rpc_start","payment_rpc_success","payment_rpc_failed","payment_reconciliation"])
    assert.match(viewer,new RegExp(marker));
  assert.match(viewer,/payMarketplaceCheckout\(/);
  assert.match(payment,/functions\.invoke\(\s*"bdag-ledger"/);
  assert.match(payment,/action: "marketplace_checkout_pay"/);
  assert.match(payment,/checkout_id: checkoutId/);
  assert.match(payment,/idempotency_key: idempotencyKey/);
});

test("success remains inside LIVE and failures return to a recoverable state", () => {
  assert.match(viewer,/setStage\("success"\)/);
  assert.match(viewer,/current === "success" \? current : "review"/);
  assert.match(viewer,/onContinue=\{onClose\}/);
  assert.doesNotMatch(viewer,/router\.(push|replace)\([^\n]*processing/);
});
