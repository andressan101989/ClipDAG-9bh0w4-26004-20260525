import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MARKETPLACE_SHIPPING_COUNTRIES,
  searchShippingCountries,
  shippingCountryLabel,
} from "../services/marketplaceShippingSetup.ts";

const shop = readFileSync("app/checkout.tsx", "utf8");
const reservation = readFileSync("app/checkout/reservation/[id].tsx", "utf8");
const live = readFileSync("components/live/commerce/LiveViewerCommerce.tsx", "utf8");
const liveAddress = readFileSync("components/live/shop/LiveShippingForm.tsx", "utf8");
const liveSummary = readFileSync("components/live/shop/LiveReservationSummary.tsx", "utf8");
const addressForm = readFileSync("components/marketplace/CheckoutShippingAddressForm.tsx", "utf8");
const selector = readFileSync("components/marketplace/SearchableSelectField.tsx", "utf8");
const orderService = readFileSync("services/marketplaceOrderService.ts", "utf8");
const paymentService = readFileSync("services/marketplacePaymentService.ts", "utf8");

test("checkout country authority shows localized names while retaining ISO values", () => {
  for (const [code, label] of [
    ["US", "Estados Unidos"],
    ["DO", "República Dominicana"],
    ["MX", "México"],
    ["ES", "España"],
    ["VE", "Venezuela"],
  ]) {
    assert.equal(shippingCountryLabel(code), label);
    assert.equal(MARKETPLACE_SHIPPING_COUNTRIES.find((country) => country.code === code)?.label, label);
  }
  assert.equal(searchShippingCountries("república dominicana")[0]?.code, "DO");
  assert.equal(searchShippingCountries("estados unidos")[0]?.code, "US");
  assert.equal(MARKETPLACE_SHIPPING_COUNTRIES.some(({ label }) => /^[A-Z]{2}$/.test(label)), false);
  assert.match(addressForm, /value=\{value\.country\}[\s\S]*value: code, label/);
  assert.match(selector, /selected\?\.label/);
  assert.match(selector, /accessibilityLabel=\{`\$\{label\}: \$\{selected\?\.label/);
});

test("SHOP and LIVE collect delivery data without contact fields", () => {
  for (const source of [shop, liveAddress, addressForm]) {
    assert.doesNotMatch(source, /Correo electrónico|E-?mail|Teléfono|Contacto/i);
  }
  assert.match(addressForm, /Nombre completo/);
  assert.match(addressForm, /Apto \/ suite \/ etc\./);
  assert.match(addressForm, /Toda la comunicación y actualizaciones del pedido/);
  assert.match(orderService, /phone\?:string/);
  assert.match(orderService, /phone:input\.phone\?\.trim\(\)\|\|undefined/);
  assert.match(orderService, /phone:address\.phone\?\?null/);
});

test("both checkout presentations follow the approved section order", () => {
  const ordered = (source) => [
    "Producto",
    "Dirección de envío",
    "Método de envío",
    "Método de pago",
    "Resumen del pedido",
  ].map((label) => source.indexOf(label));
  for (const source of [shop, reservation, liveSummary]) {
    const positions = ordered(source);
    assert.equal(positions.every((value) => value >= 0), true);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  }
  assert.match(shop, /Checkout · OnSpace SHOP/);
  assert.match(live, /Checkout · EN VIVO/);
  assert.match(shop, /automaticallyAdjustKeyboardInsets/);
  assert.match(liveAddress, /automaticallyAdjustKeyboardInsets/);
});

test("buyer summaries show only authoritative subtotal shipping and total", () => {
  for (const source of [reservation, liveSummary]) {
    assert.match(source, /Subtotal/);
    assert.match(source, /Envío/);
    assert.match(source, /Total/);
    assert.doesNotMatch(source, /Comisión de plataforma|Platform fee|Service fee/i);
  }
  assert.match(reservation, /data\.checkout\.subtotal/);
  assert.match(reservation, /data\.checkout\.shippingAmount/);
  assert.match(reservation, /data\.checkout\.total/);
  assert.match(live, /subtotal:\s*result\.checkout\.subtotal/);
  assert.match(live, /shippingAmount:\s*result\.checkout\.shippingAmount/);
});

test("reservation and payment authorities remain unchanged", () => {
  assert.match(shop, /createCreatorCheckoutReservation/);
  assert.match(shop, /createCheckoutReservation/);
  assert.match(shop, /idempotencyRef/);
  assert.match(live, /createLiveCheckoutReservation/);
  assert.match(live, /reservationCommandFor/);
  assert.match(live, /payMarketplaceCheckout/);
  assert.match(reservation, /fetchAuthoritativeBdagBalance/);
  assert.match(reservation, /payMarketplaceCheckout/);
  assert.match(paymentService, /platformFeeAmount/);
  assert.doesNotMatch(shop + live + reservation, /create_checkout_v2|new_wallet|cardPayment/);
});
