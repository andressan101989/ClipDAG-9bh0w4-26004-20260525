import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const shop = read("app/(tabs)/shop.tsx");
const creator = read("app/creator/[id].tsx");
const product = read("app/product/[id].tsx");
const gallery = read("components/marketplace/product-detail/ProductMediaGallery.tsx");
const purchaseBar = read("components/marketplace/product-detail/ProductPurchaseBar.tsx");
const marketplaceService = read("services/marketplaceService.ts");

test("Marketplace main is a shop-only product route without the old mixed tabs", () => {
  for (const token of ["Tienda", "Buscar productos o tiendas", "PRODUCT_CATEGORIES", "fetchProducts", "productGrid", "ProductCard", "SponsoredCard"])
    assert(shop.includes(token), token);
  for (const removed of ["SHOP_TABS", 'key: "discover"', 'key: "exclusive"', "CreatorCard", "PlanCard", "ExclusiveCard", "fetchFeaturedCreators", "searchCreators", "fetchSubscriptionPlans", "fetchExclusiveContent"])
    assert(!shop.includes(removed), removed);
  assert(!shop.includes(">Descubrir<"));
  assert(!shop.includes(">Exclusivo<"));
  assert.match(shop, /fetchProducts\(\{ category: category \|\| undefined, search: search\.trim\(\) \|\| undefined, limit: 30 \}\)/);
});

test("Creator profiles own the accessible Contenido and Exclusivo information architecture", () => {
  assert.match(creator, /key: 'videos',[^\n]+label: 'Contenido'/);
  assert.match(creator, /key: 'exclusive',[^\n]+label: 'Exclusivo'/);
  assert.match(creator, /profileTab === 'exclusive'/);
  assert.match(creator, /fetchCreatorExclusiveContent/);
  assert.match(creator, /accessibilityRole="tab"/);
  assert.match(creator, /accessibilityState=\{\{ selected: profileTab === t\.key \}\}/);
});

test("Product detail exposes premium gallery and stronger commercial hierarchy", () => {
  for (const token of ["ProductMediaGallery", "commerceCard", "pricingPanel", "variantPanel", "benefitsRow", "MarketplaceShippingQuoteCard", "sellerCard"])
    assert(product.includes(token), token);
  assert.match(gallery, /aspectRatio: 1/);
  assert.match(gallery, /thumbnail:\s*\{ width: 66, height: 66/);
  assert.match(gallery, /selectedIndex \+ 1/);
  for (const label of ["Volver", "Compartir producto", "Guardar producto", "Carrito"])
    assert(product.includes(label), label);
});

test("Organic and sponsored cards use truthful neutral missing-media states", () => {
  const organic = shop.slice(shop.indexOf("const ProductCard"), shop.indexOf("const SponsoredCard"));
  const sponsored = shop.slice(shop.indexOf("const SponsoredCard"), shop.indexOf("export default function ShopScreen"));
  assert.doesNotMatch(shop, /picsum\.photos|placeholder\.com|source\.unsplash/i);
  assert.match(shop, /const ProductMediaFallback/);
  assert.match(shop, /Imagen no disponible/);
  assert.match(shop, /image-not-supported/);
  assert.match(organic, /product\.images\?\.\[0\] \?\? null/);
  assert.match(organic, /image \? \([\s\S]*<Image[\s\S]*<ProductMediaFallback/);
  assert.match(sponsored, /item\.images\?\.\[0\] \?\? null/);
  assert.match(sponsored, /image \? \([\s\S]*<Image[\s\S]*<ProductMediaFallback/);
  assert.match(sponsored, /sponsoredBadge/);
  assert.match(sponsored, />Patrocinado</);
  assert.match(gallery, /Imagen no disponible/);
  for (const token of ["recordAdEvent", 'eventType: "impression"', 'eventType: "click"', "marketplaceSponsoredProductRoute"])
    assert(shop.includes(token), token);
  assert.match(product, /handleAddToCart\(true\)/);
  assert.match(product, /router\.push\("\/checkout" as never\)/);
});

test("Sticky CTA preserves quantity, cart, and existing checkout continuation", () => {
  for (const token of ["Precio por unidad", "Agregar al carrito", "Comprar ahora", 'accessibilityLabel="Aumentar cantidad"', 'accessibilityLabel="Reducir cantidad"'])
    assert(purchaseBar.includes(token), token);
  assert.match(product, /onAdd=\{\(\) => void handleAddToCart\(\)\}/);
  assert.match(product, /onBuy=\{\(\) => void handleAddToCart\(true\)\}/);
  assert.match(product, /addToCartLockRef\.current/);
  assert.match(product, /variantId: selectedVariant\.id/);
  assert.match(product, /router\.push\("\/checkout" as never\)/);
});

test("Shop and product layouts retain narrow-width and accessibility contracts", () => {
  assert.match(shop, /useWindowDimensions\(\)/);
  assert.match(shop, /Math\.max\(136, \(viewportWidth - Spacing\.md \* 2 - Spacing\.sm\) \/ 2\)/);
  assert.match(shop, /headerCopy: \{ flex: 1, minWidth: 0/);
  assert.match(shop, /heroCopy: \{ flex: 1, minWidth: 0/);
  assert.match(shop, /searchInput: \{ flex: 1, minWidth: 0/);
  assert.match(purchaseBar, /actions: \{ flexDirection: "row"/);
  assert.match(purchaseBar, /minHeight: 52/);
  assert.match(product, /accessibilityRole="radio"/);
  assert.match(product, /accessibilityState=\{\{ selected, disabled: !enabled \}\}/);
});

test("Refinement preserves hardened commerce contracts and creates no later-phase authority", () => {
  for (const token of ["physical", "digital", "rpcText(row.description"])
    assert(marketplaceService.includes(token), token);
  assert.match(marketplaceService, /product_type:\s*rpcEnum\([\s\S]*?row\.product_type[\s\S]*?\["physical", "digital"\]/);
  const changed = shop + creator + product + gallery + purchaseBar;
  assert.doesNotMatch(changed, /service_role|atomic_ledger_transfer|ledger_(credit|debit)|spend_marketplace_ad_budget|release_marketplace_ad_unused_budget|B8D-3|B8D-4|LIVE Battles/i);
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(migrations.includes("20260811033000_marketplace_production_hardening.sql"));
  assert.equal(migrations.at(-1), "20260811034000_marketplace_verified_reviews_branding.sql");
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
});
