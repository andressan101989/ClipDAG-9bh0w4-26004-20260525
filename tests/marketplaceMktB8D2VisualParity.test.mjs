import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const product = read("app/product/[id].tsx");
const gallery = read(
  "components/marketplace/product-detail/ProductMediaGallery.tsx",
);
const purchase = read(
  "components/marketplace/product-detail/ProductPurchaseBar.tsx",
);
const reviews = read(
  "components/marketplace/product-detail/ProductReviewsSection.tsx",
);
const shipping = read(
  "components/marketplace/MarketplaceShippingQuoteCard.tsx",
);
const store = read("app/seller/store.tsx");

test("approved product mockup hierarchy is composed as one premium commerce surface", () => {
  for (const token of [
    'accessibilityLabel="OnSpace Marketplace"',
    "headerBrandName",
    "ProductMediaGallery",
    "categoryPill",
    "ProductRatingSummary",
    "pricingPanel",
    "MarketplaceShippingQuoteCard",
    "variantPanel",
    "sellerCard",
    "ProductReviewsSection",
    "ProductPurchaseBar",
  ])
    assert(product.includes(token), token);
  assert.match(
    product,
    /price:\s*\{[\s\S]*?color:\s*Colors\.primaryLight[\s\S]*?fontSize:\s*30/,
  );
  assert.match(
    product,
    /commerceCard:\s*\{[\s\S]*?marginHorizontal:\s*Spacing\.md,[\s\S]*?gap:\s*10/,
  );
  assert.doesNotMatch(
    product,
    /PERSONALIZA TU COMPRA|Contactar (a |al )?vendedor|\/chat\//i,
  );
});

test("approved gallery has swipe, visible arrows, zoom, count, synchronized rail, more tile, and dots", () => {
  for (const token of [
    "pagingEnabled",
    "onMomentumScrollEnd={selectFromScroll}",
    "Toca para ampliar",
    'accessibilityLabel="Ver elemento anterior"',
    'accessibilityLabel="Ver elemento siguiente"',
    'accessibilityLabel="Abrir imagen a pantalla completa"',
    "selectedIndex + 1",
    "thumbnailSelected",
    "hiddenThumbnailCount",
    "moreMedia",
    "dotSelected",
    "setFullscreen(true)",
  ])
    assert(gallery.includes(token), token);
  assert.match(gallery, /selectedIndex === 0/);
  assert.match(gallery, /selectedIndex === items\.length - 1/);
  assert.match(gallery, /onSelect\(entry\.sourceIndex\)/);
  assert.match(gallery, /Imagen no disponible/);
  assert.doesNotMatch(gallery, /picsum|placeholder\.com|unsplash/i);
});

test("approved compact variants, truthful shipping, store identity, and trust strip remain canonical", () => {
  for (const token of [
    "PRODUCT_COLOR_HEX",
    "optionHeading",
    "colorChip",
    "swatch",
    'accessibilityRole="radio"',
  ])
    assert(product.includes(token), token);
  assert.match(product, /accessibilityState=\{\{\s*selected,\s*disabled:\s*!enabled,?\s*\}\}/);
  assert.match(product, /reputation\.store\.logoUrl/);
  assert.match(product, /reputation\.sellerAggregate\.averageRating/);
  assert.match(product, /product\.total_sales > 0/);
  assert.match(product, /pathname: "\/store\/\[id\]"/);
  assert.match(product, /Compra protegida/);
  assert.match(shipping, /state\.quote\.estimatedDeliveryDaysMin/);
  assert.doesNotMatch(
    product + shipping,
    /1[\u2013-]2 d[ií]as|Tienda verificada|Producto verificado/,
  );
});

test("approved review composition keeps full labels, compact verified snippets, and separate actions", () => {
  for (const token of [
    "Ver todas (",
    "Reseñas del producto",
    "Valoración del vendedor",
    "Basado en",
    "reviewer.avatarUrl",
    "Compra verificada",
    "Escribe tu reseña",
    "Califica este producto",
    "Califica al vendedor",
    'openEditor("product")',
    'openEditor("seller")',
  ])
    assert(reviews.includes(token), token);
  assert.doesNotMatch(
    reviews,
    /distributionRow|styles\.distribution|REPUTACIÓN VERIFICADA/,
  );
  assert.match(
    reviews,
    /kind === "product"\s*\?\s*reputation\.productAggregate\s*:\s*reputation\.sellerAggregate/,
  );
});

test("sticky purchase bar matches quantity, primary cart, secondary buy, and secure strip without changing handlers", () => {
  for (const token of [
    "purchaseRow",
    "quantityCompact",
    "Agregar al carrito",
    "Comprar ahora",
    "Compra segura en",
    "OnSpace Marketplace",
  ])
    assert(purchase.includes(token), token);
  assert.match(product, /onAdd=\{\(\) => void handleAddToCart\(\)\}/);
  assert.match(product, /onBuy=\{\(\) => void handleAddToCart\(true\)\}/);
  assert.match(purchase, /onPress=\{onAdd\}/);
  assert.match(purchase, /onPress=\{onBuy\}/);
});

test("approved store configuration structure uses only canonical branding and reputation", () => {
  for (const token of [
    "Configuración de tienda",
    "OnSpace Marketplace",
    "Logo de la tienda",
    "Recomendaciones",
    "Formato: JPG, PNG o WebP",
    "Máx. 10 MB",
    "Información de la tienda",
    "Identidad visual",
    "Imagen de portada",
    "Cómo te ven los compradores",
    "Calificación de productos",
    "Calificación del vendedor",
    "Guardar cambios",
    "Tu información está segura",
  ])
    assert(store.includes(token), token);
  for (const authority of [
    "uploadMediaFromUri",
    "setStoreMedia",
    "store_logo",
    "store_banner",
    "fetchMarketplaceStoreReputation",
  ])
    assert(store.includes(authority), authority);
  assert.doesNotMatch(
    store,
    /Tienda verificada|Horarios de atención|Políticas de envío/,
  );
});

test("C2 store profile keeps editable canonical fields inside premium focused controls", () => {
  assert.match(store, /accessibilityLabel="Nombre de la tienda"/);
  assert.match(store, /value=\{name\}/);
  assert.match(store, /onChangeText=\{\(value\) => edit\("name", value\)\}/);
  assert.match(store, /focusedField === "name"/);
  assert.match(store, /styles\.storeFieldActive/);
  assert.match(store, /selectionColor=\{Colors\.primaryLight\}/);
  for (const token of [
    "Así te encontrarán los compradores",
    "URL pública de tu tienda",
    "Resume qué vendes y qué hace especial a tu tienda",
    "description.length",
  ])
    assert(store.includes(token), token);
});

test("C2 store mockup parity includes premium branding, reputation, and save states", () => {
  for (const token of [
    "profileRail",
    "logoPreviewShell",
    "logoEditBadge",
    "uploadGradient",
    "Fondo transparente recomendado",
    "bannerOverlay",
    "Vista previa",
    "metricsStacked",
    "metricStars",
    "Guardar cambios",
    "Guardando cambios…",
    "Cambios guardados correctamente.",
    "saveFeedbackError",
  ])
    assert(store.includes(token), token);
  assert.match(store, /onPress=\{\(\) => void pickBranding\("logo"\)\}/);
  assert.match(store, /onPress=\{\(\) => void pickBranding\("banner"\)\}/);
  assert.match(store, /onPress=\{\(\) => void save\(\)\}/);
  assert.match(store, /updateStore\(store\.id, name, slug, description\)/);
  assert.doesNotMatch(store, /getSupabaseClient|service_role|\.rpc\(/);
});

test("visual closure adds no migration or economic authority and keeps Build 22", () => {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(
    migrations.at(-1),
    "20260811034000_marketplace_verified_reviews_branding.sql",
  );
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
  const changed = product + gallery + purchase + reviews + shipping + store;
  assert.doesNotMatch(
    changed,
    /service_role|atomic_ledger_transfer|ledger_(credit|debit)|seller_payout|creator_payout/i,
  );
});
