import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("services/liveCommerceService.ts", "utf8");
const viewer = readFileSync(
  "components/live/commerce/LiveViewerCommerce.tsx",
  "utf8",
);
const watch = readFileSync("app/live/watch/[streamId].tsx", "utf8");

test("LIVE reservation keeps session, pin, product, and variant identifiers distinct", () => {
  assert.match(service, /p_session_id:\s*uuid\(sessionId\)/);
  assert.match(service, /p_live_session_product_id:\s*uuid\(pinId\)/);
  assert.match(service, /p_variant_id:\s*uuid\(variantId\)/);
  assert.match(viewer, /sessionId,\s*pin\.id,\s*freshVariant\.id/s);
});

test("recognized P0001 tokens become typed reservation errors", () => {
  assert.match(service, /extractLiveCommerceBusinessCode/);
  assert.match(service, /class LiveCheckoutReservationError/);
  for (const code of [
    "own_product",
    "live_not_active",
    "product_not_featured",
    "variant_invalid",
    "out_of_stock",
    "shipping_unsupported",
    "active_checkout_exists",
  ]) assert.match(service, new RegExp(`\\"${code}\\"`));
});

test("expected business rejection warns without opening LogBox", () => {
  assert.match(service, /const log = business \? console\.warn : console\.error/);
  assert.match(service, /businessCode: business/);
  assert.doesNotMatch(viewer, /setFeedback\([^)]*P0001/);
});

test("reservation refetches the authoritative pin before the RPC", () => {
  assert.match(viewer, /if \(liveStatus !== \"live\"\)/);
  assert.match(viewer, /authoritativePin = \(await fetchLiveSessionProducts\(sessionId\)\)/);
  assert.match(viewer, /item\.id === pin\.id && item\.availability === \"available\"/);
});

test("self-purchase is blocked before the reservation RPC", () => {
  assert.match(watch, /viewerId=\{user\?\.id \?\? null\}/);
  assert.match(viewer, /fresh\.product\.seller_id === viewerId/);
  assert.match(viewer, /No puedes comprar tu propio producto\./);
});

test("reservation stages emit sanitized fingerprints and no address fields", () => {
  for (const stage of [
    "reservation_start",
    "validation_start",
    "rpc_start",
    "rpc_success",
    "rpc_failed",
  ]) assert.match(viewer, new RegExp(`\\[LiveCheckout\\] ${stage}`));
  assert.doesNotMatch(viewer, /streetAddress:|recipientName: address|phone: address/);
});

test("active checkout recovery no longer converts read errors to none", () => {
  assert.doesNotMatch(viewer, /fetchMyActiveLiveCheckout\(sessionId\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(viewer, /fetchMyActiveCheckout\(\)\.catch\(\(\) => null\)/);
  assert.match(viewer, /Ya tienes una compra pendiente\. Continuaremos desde donde quedaste\./);
});

test("valid reservation reaches review without invoking payment", () => {
  const reservationBlock = viewer.slice(
    viewer.indexOf("const reserve = async"),
    viewer.indexOf("const reconcilePayment = async"),
  );
  assert.match(reservationBlock, /setStage\(\"review\"\)/);
  assert.doesNotMatch(reservationBlock, /payMarketplaceCheckout\(/);
});
