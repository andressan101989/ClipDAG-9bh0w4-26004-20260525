import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceSponsoredProductRoute,
  mixMarketplaceSponsoredProducts,
} from "../services/marketplaceSponsoredMix.ts";

const organic = (id) => ({ id, title: `Product ${id}` });
const sponsored = (productId, campaignId = `campaign-${productId}`) => ({
  product_id: productId,
  campaign_id: campaignId,
});

test("one matching product is rendered exactly once as sponsored", () => {
  const result = mixMarketplaceSponsoredProducts(
    [organic("x")],
    [sponsored("x")],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "sponsored");
  assert.equal(result[0].product.product_id, "x");
});

test("one product without a matching campaign remains organic", () => {
  const result = mixMarketplaceSponsoredProducts([organic("x")], []);

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "organic");
  assert.equal(result[0].product.id, "x");
});

test("small-catalog replacement never duplicates the promoted product", () => {
  const result = mixMarketplaceSponsoredProducts(
    [organic("x"), organic("y"), organic("z")],
    [sponsored("y")],
  );
  const yPlacements = result.filter((item) =>
    item.kind === "organic"
      ? item.product.id === "y"
      : item.product.product_id === "y",
  );

  assert.equal(result.length, 3);
  assert.equal(yPlacements.length, 1);
  assert.equal(yPlacements[0].kind, "sponsored");
});

test("large catalogs retain the existing insertion and duplicate rules", () => {
  const products = Array.from({ length: 9 }, (_, index) =>
    organic(String(index)),
  );
  const inserted = mixMarketplaceSponsoredProducts(products, [sponsored("ad")]);
  const suppressed = mixMarketplaceSponsoredProducts(products, [
    sponsored("0"),
  ]);

  assert.equal(inserted.length, 10);
  assert.equal(inserted[8].kind, "sponsored");
  assert.equal(inserted[8].product.product_id, "ad");
  assert.equal(inserted[9].kind, "organic");
  assert.equal(inserted[9].product.id, "8");
  assert.equal(suppressed.length, 9);
  assert.ok(suppressed.every((item) => item.kind === "organic"));
});

test("sponsored click route preserves Ads attribution parameters", () => {
  assert.deepEqual(
    marketplaceSponsoredProductRoute(sponsored("x", "campaign-x")),
    {
      id: "x",
      source: "ad",
      campaignId: "campaign-x",
      surface: "marketplace_home",
    },
  );
});
