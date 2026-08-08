import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MARKETPLACE_SHIPPING_COUNTRIES,
  searchShippingCountries,
  shippingRegionsForCountry,
} from "../services/marketplaceShippingSetup.ts";
import {
  normalizeProductVideoDuration,
  parsePhotosAccess,
  validateProductVideoDuration,
} from "../services/marketplaceMediaPickerCore.ts";

const shipping = readFileSync("app/seller/shipping-profile.tsx", "utf8");
const editor = readFileSync(
  "app/seller/product-editor/[productId].tsx",
  "utf8",
);

test("shipping selectors expose the full authoritative ISO catalog without chip walls", () => {
  assert.equal(MARKETPLACE_SHIPPING_COUNTRIES.length, 249);
  assert.equal(searchShippingCountries("argentina")[0]?.code, "AR");
  assert.equal(
    MARKETPLACE_SHIPPING_COUNTRIES.find((x) => x.label === "Estados Unidos")
      ?.code,
    "US",
  );
  assert.equal(
    shippingRegionsForCountry("US").find((x) => x[1] === "Florida")?.[0],
    "FL",
  );
  assert.equal(
    shippingRegionsForCountry("CA").find((x) => x[1] === "Ontario")?.[0],
    "ON",
  );
  assert.equal(shippingRegionsForCountry("AR").length, 0);
  assert.doesNotMatch(shipping, /function Choices/);
  assert.match(shipping, /SearchableSelectField/);
});

test("product shipping methods are compact and configuration-required methods are secondary", () => {
  assert.match(editor, /SearchableSelectField[\s\S]{0,120}label="Método de envío"/);
  assert.match(editor, /configurationStatus\s*===\s*"explicit_ready"/);
  assert.match(editor, /métodos necesitan/);
  assert.match(editor, /saveQueue\.current\.edit\(\)/);
});

test("limited Photos access is explicit and expandable through the installed native API", () => {
  assert.equal(
    parsePhotosAccess({ granted: true, accessPrivileges: "limited" }),
    "limited",
  );
  assert.equal(
    parsePhotosAccess({ granted: true, accessPrivileges: "all" }),
    "all",
  );
  assert.equal(
    parsePhotosAccess({ granted: false, accessPrivileges: "none" }),
    "none",
  );
  assert.match(editor, /OnSpace solo puede ver algunos/);
  assert.match(editor, /Elegir más/);
  assert.match(
    readFileSync("services/marketplaceMediaPickerService.ts", "utf8"),
    /presentPermissionsPickerAsync/,
  );
  assert.match(editor, /mediaTypes: \["videos"\]/);
  assert.doesNotMatch(editor, /recent|Reciente/);
});

test("product-video picker duration is normalized in milliseconds at the 60-second boundary", () => {
  assert.equal(normalizeProductVideoDuration(59000), 59000);
  assert.equal(validateProductVideoDuration(59000).valid, true);
  assert.equal(validateProductVideoDuration(60000).valid, true);
  assert.equal(validateProductVideoDuration(61000).valid, false);
  assert.equal(validateProductVideoDuration(61000).tooLong, true);
  assert.match(editor, /normalizedDurationMs/);
  assert.match(editor, /durationMs: duration/);
  assert.match(editor, /El video del producto debe durar 60 segundos o menos/);
});
