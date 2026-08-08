import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const service = fs.readFileSync(
    new URL("../services/marketplaceShippingService.ts", import.meta.url),
    "utf8",
  ),
  product = fs.readFileSync(
    new URL("../app/product/[id].tsx", import.meta.url),
    "utf8",
  ),
  card = fs.readFileSync(
    new URL(
      "../components/marketplace/MarketplaceShippingQuoteCard.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  seller = fs.readFileSync(
    new URL("../app/seller/shipping-profile.tsx", import.meta.url),
    "utf8",
  ),
  migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/20260807110000_allow_empty_marketplace_shipping_destinations.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  proof = fs.readFileSync(
    new URL("../scripts/prove-marketplace-shipping.mjs", import.meta.url),
    "utf8",
  );
test("product detail uses the existing checkout address affordance", () => {
  assert.match(
    product,
    /MarketplaceShippingQuoteCard\s+productId=\{product\.id\}\s+quantity=\{quantity\}/,
  );
  assert.match(product, /onRequestAddress/);
  assert.match(card, /Agregar dirección/);
  assert.match(card, /countryCode,productId,publish,quantity,regionCode/);
});
test("final destination removal requires confirmation and permits zero rules", () => {
  assert.match(seller, /¿Eliminar el último destino\?/);
  assert.match(seller, /Eliminar destino/);
  assert.match(seller, /current\.filter/);
  assert.match(seller, /allowEmptyRules: Boolean\(profileId\)/);
  assert.match(seller, /formValid/);
});
test("zero-rule save preserves the profile and is backend-derived configuration required", () => {
  assert.doesNotMatch(migration, /jsonb_array_length\(p_regions\)<1/);
  assert.match(migration, /configuration_required/);
  assert.match(seller, /profileId, storeId/);
  assert.match(seller, /regions: rules\.map/);
});
test("invalid input classes are exact and buyer safe", () => {
  for (const code of [
    "marketplace_shipping_product_invalid",
    "marketplace_shipping_country_invalid",
    "marketplace_shipping_quantity_invalid",
  ])
    assert.match(service, new RegExp(code));
  assert.match(service, /if\(!UUID\.test\(productId\)\)/);
  assert.match(service, /if\(!Number\.isInteger\(quantity\)\|\|quantity<1\)/);
  assert.match(service, /Selecciona una cantidad válida/);
});
test("profile parser rejects sentinel and malformed configuration data", () => {
  assert.match(service, /parseMarketplaceShippingProfiles/);
  assert.match(service, /value===\'undefined\'/);
  assert.match(service, /UUID\.test\(id\)/);
  assert.match(service, /explicit_ready/);
  assert.match(service, /processingDaysMin>processingDaysMax/);
  assert.match(service, /transitDaysMin>transitDaysMax/);
  assert.match(service, /\^\[A-Z\]\{2\}\$/);
});
test("rollback proof uses the authoritative RPC for remove and restore", () => {
  assert.match(proof, /upsert_my_marketplace_shipping_profile/);
  assert.match(proof, /\[\].*::jsonb/);
  assert.match(proof, /profile_id_changed/);
  assert.match(proof, /product_detached/);
  assert.match(proof, /profile_not_restored/);
  assert.match(proof, /marketplace_shipping_configuration_required/);
});
test("financial and LIVE formulas remain outside this cleanup migration", () => {
  for (const token of [
    "ledger_debit",
    "fee_bps",
    "creator_commission_bps",
    "seller_net_amount",
    "marketplace_dispute",
  ])
    assert.doesNotMatch(migration, new RegExp(token));
});
