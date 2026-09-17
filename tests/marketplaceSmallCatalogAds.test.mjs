import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceSponsoredProductRoute,
  mixMarketplaceSponsoredProducts,
  mixSocialFeedSponsoredProducts,
  socialFeedSponsoredProductRoute,
} from "../services/marketplaceSponsoredMix.ts";

const organic = (id) => ({ id, title: `Product ${id}` });
const sponsored = (productId, campaignId = `campaign-${productId}`) => ({
  product_id: productId,
  campaign_id: campaignId,
});

test("social feed inserts after 4 organic items, then every 8, capped at 3", () => {
  const videos = Array.from({ length: 30 }, (_, index) => ({ id: `video-${index}` }));
  const ads = Array.from({ length: 5 }, (_, index) => sponsored(`ad-${index}`));
  const mixed = mixSocialFeedSponsoredProducts(videos, ads);
  const adIndexes = mixed.flatMap((item, index) => item.kind === "sponsored" ? [index] : []);

  assert.deepEqual(adIndexes, [4, 13, 22]);
  assert.equal(mixed.filter((item) => item.kind === "sponsored").length, 3);
  assert.ok(mixed.every((item, index) => item.kind !== "sponsored" || mixed[index - 1]?.kind !== "sponsored"));
});

test("social feed remains organic when there are fewer than four videos or no candidates", () => {
  assert.equal(mixSocialFeedSponsoredProducts([{ id: "1" }, { id: "2" }, { id: "3" }], [sponsored("ad")]).length, 3);
  assert.equal(mixSocialFeedSponsoredProducts(Array.from({ length: 12 }, (_, id) => ({ id })), []).length, 12);
});

test("social feed de-duplicates campaigns and preserves bounded attribution context", () => {
  const videos = Array.from({ length: 20 }, (_, index) => ({ id: `video-${index}` }));
  const duplicate = sponsored("product-a", "campaign-a");
  const mixed = mixSocialFeedSponsoredProducts(videos, [duplicate, duplicate, sponsored("product-b", "campaign-b")]);
  assert.deepEqual(mixed.filter((item) => item.kind === "sponsored").map((item) => item.product.campaign_id), ["campaign-a", "campaign-b"]);
  assert.deepEqual(socialFeedSponsoredProductRoute(duplicate), {
    id: "product-a",
    source: "ad",
    campaignId: "campaign-a",
    sourceSurface: "social_feed",
  });
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
