import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const promotions = readFileSync("app/seller/promotions.tsx", "utf8");
const sellerHeader = readFileSync(
  "components/marketplace/SellerScreenHeader.tsx",
  "utf8",
);
const mediaGallery = readFileSync(
  "components/marketplace/product-detail/ProductMediaGallery.tsx",
  "utf8",
);

test("Promotions uses the visible seller header and deterministic back fallback", () => {
  assert.match(
    promotions,
    /<SellerScreenHeader\s+title="Promociones"\s+fallbackRoute="\/seller"\s*\/>/,
  );
  assert.match(sellerHeader, /router\.canGoBack\(\)/);
  assert.match(sellerHeader, /router\.back\(\)/);
  assert.match(sellerHeader, /router\.replace\(fallbackRoute as Href\)/);
  assert.match(sellerHeader, /backgroundColor:Colors\.bg/);
  assert.match(sellerHeader, /zIndex:10/);
  assert.match(sellerHeader, /backButton:[^\n]*zIndex:11/);
});

test("Product media teardown leaves native player disposal to useVideoPlayer", () => {
  assert.doesNotMatch(
    mediaGallery,
    /useEffect\s*\(\s*\(\)\s*=>\s*\(\)\s*=>[\s\S]*?player\.pause/,
  );
  assert.match(mediaGallery, /selected\?\.kind !== "video"\) player\.pause\(\)/);
  assert.match(mediaGallery, /useVideoPlayer\(/);
});
