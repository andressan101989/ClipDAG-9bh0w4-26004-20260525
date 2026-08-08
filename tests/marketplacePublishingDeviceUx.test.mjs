import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CA_PROVINCES,
  MARKETPLACE_SHIPPING_COUNTRIES,
  US_STATES,
  shippingRegionsForCountry,
  shippingSetupError,
  validateShippingSetup,
} from "../services/marketplaceShippingSetup.ts";
import {
  generateCreationVariants,
  generateVariantSku,
  validateCreationVariants,
} from "../services/marketplaceVariantDraft.ts";

const editor = readFileSync("app/seller/product-editor/[productId].tsx", "utf8");
const shipping = readFileSync("app/seller/shipping-profile.tsx", "utf8");
const variants = readFileSync("app/seller/product/[id]/variants.tsx", "utf8");

test("friendly shipping choices preserve authoritative country and region codes", () => {
  assert.equal(MARKETPLACE_SHIPPING_COUNTRIES.find((x) => x.label === "Estados Unidos")?.code, "US");
  assert.equal(US_STATES.find((x) => x[1] === "Florida")?.[0], "FL");
  assert.equal(CA_PROVINCES.find((x) => x[1] === "Ontario")?.[0], "ON");
  assert.equal(shippingRegionsForCountry("GB").length, 0);
  assert.match(shipping, /regionCode: null/);
});

test("shipping validation names every visible blocker", () => {
  const errors = validateShippingSetup({
    name: "",
    shipsFromCountry: "",
    processingDaysMin: "",
    processingDaysMax: "",
    returnPolicy: "",
    rules: [],
  });
  assert.ok(errors.some((x) => x.includes("país desde donde envías")));
  assert.ok(errors.some((x) => x.includes("Selecciona un destino")));
  assert.ok(errors.some((x) => x.includes("política de devoluciones")));
  assert.match(shipping, /Falta completar:/);
});

test("shipping RPC tokens become safe seller messages and safe DEV logs", () => {
  assert.match(shippingSetupError({ message: "marketplace_shipping_region_invalid", code: "22023" }).message, /estado o provincia/);
  assert.match(shippingSetupError({ message: "marketplace_store_inactive" }).message, /Activa tu tienda/);
  assert.match(shipping, /\[MarketplaceShippingSetup\]/);
});

test("returning from setup refreshes and auto-selects an explicit-ready profile", () => {
  assert.match(editor, /useFocusEffect/);
  assert.match(editor, /shipping_refresh_start/);
  assert.match(editor, /configurationStatus === "explicit_ready"/);
  assert.match(editor, /setShippingProfileId\(selected\)/);
  assert.match(editor, /setMessage\("Envío configurado"\)/);
});

test("guided variants produce six unique combinations and one automatic default", () => {
  const generated = generateCreationVariants(
    [
      { name: "Color", valuesText: "Negro, Blanco" },
      { name: "Talla", valuesText: "S, M, L" },
    ],
    { price: "25", stock: "10", skuPrefix: "Runner" },
  );
  validateCreationVariants(generated);
  assert.equal(generated.length, 6);
  assert.equal(generated.filter((x) => x.isDefault).length, 1);
  assert.equal(new Set(generated.map((x) => x.sku)).size, 6);
  assert.ok(generated.every((x) => x.price === "25" && x.onHand === "10"));
  assert.match(generateVariantSku("Runner", ["Negro", "M"], 0), /^RUNNER-NEGRO-M-/);
});

test("variant UX is simple first while advanced authority remains available", () => {
  assert.match(variants, /¿Tu producto tiene opciones como talla o color\?/);
  assert.match(variants, /Opciones avanzadas/);
  assert.match(variants, /SKU \(código interno\)/);
  assert.match(variants, /Corrección rápida/);
  assert.match(variants, /setVariantInventory/);
  assert.match(variants, /setDefaultVariant/);
  assert.match(variants, /archiveVariant/);
});

test("Product Publishing picker handles PhotoKit rejection and uses current media API", () => {
  assert.doesNotMatch(editor, /ImagePicker\.MediaTypeOptions/);
  assert.match(editor, /mediaTypes: \["images"\]/);
  assert.match(editor, /mediaTypes: \["videos"\]/);
  assert.match(editor, /\[ProductMediaPicker\]/);
  assert.match(editor, /No pudimos abrir esta foto/);
  assert.match(editor, /No pudimos abrir este video/);
  assert.match(editor, /try \{[\s\S]*requestMediaLibraryPermissionsAsync[\s\S]*launchImageLibraryAsync/);
  assert.match(editor, /state: "failed"/);
});
