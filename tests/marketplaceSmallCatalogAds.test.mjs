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

test("production mode does not force a matching small-catalog product to sponsored", () => {
  const result = mixMarketplaceSponsoredProducts(
    [organic("x")],
    [sponsored("x")],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "organic");
  assert.equal(result[0].product.id, "x");
});

test("production insertion occurs at index eight", () => {
  const products = Array.from({ length: 9 }, (_, index) =>
    organic(String(index)),
  );
  const inserted = mixMarketplaceSponsoredProducts(products, [sponsored("ad")]);

  assert.equal(inserted.length, 10);
  assert.equal(inserted[8].kind, "sponsored");
  assert.equal(inserted[8].product.product_id, "ad");
  assert.equal(inserted[9].kind, "organic");
  assert.equal(inserted[9].product.id, "8");
});

test("production insertion suppresses products already in the organic batch", () => {
  const products = Array.from({ length: 9 }, (_, index) =>
    organic(String(index)),
  );
  const suppressed = mixMarketplaceSponsoredProducts(products, [
    sponsored("0"),
  ]);

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
