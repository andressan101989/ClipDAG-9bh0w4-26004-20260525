import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd(), read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260811034000_marketplace_verified_reviews_branding.sql");
const product = read("app/product/[id].tsx"), gallery = read("components/marketplace/product-detail/ProductMediaGallery.tsx"), reviews = read("components/marketplace/product-detail/ProductReviewsSection.tsx"), reviewService = read("services/marketplaceReviewService.ts"), storeSettings = read("app/seller/store.tsx"), storePage = read("app/store/[id].tsx"), media = read("services/mediaService.ts"), proof = read("scripts/prove-marketplace-verified-reviews.mjs");
const mediaPurposes = read("supabase/functions/_shared/mediaPurposes.ts");

test("verified review authority derives immutable purchase identities from delivered commerce", () => {
  for (const table of ["marketplace_product_reviews", "marketplace_seller_reviews"]) assert(migration.includes(`create table public.${table}`));
  for (const token of ["v_actor uuid:=auth.uid()", "v_order.buyer_id<>v_actor", "v_order.status<>'delivered'", "v_order.delivered_at is null", "v_order.buyer_id=v_order.seller_id", "values(v_actor,v_item.product_id,v_item.seller_id,v_item.store_id,v_item.order_id,v_item.id", "values(v_actor,v_order.seller_id,v_order.store_id,v_order.id"] ) assert(migration.includes(token), token);
  assert.doesNotMatch(migration, /p_(buyer|product|seller|store)_id uuid,p_rating/);
  assert.equal((migration.match(/rating integer not null check \(rating between 1 and 5\)/g) ?? []).length, 2);
  assert.equal((migration.match(/char_length\(comment\) between 1 and 1000/g) ?? []).length, 2);
  assert.match(migration, /unique\(order_item_id\)/);
  assert.match(migration, /unique\(order_id\)/);
});

test("review tables are not directly writable and read projections are bounded, private, and moderation-aware", () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on public\.marketplace_product_reviews from public,anon,authenticated/);
  assert.match(migration, /revoke all on public\.marketplace_seller_reviews from public,anon,authenticated/);
  assert.match(migration, /p_limit is null or p_limit<1 or p_limit>50/g);
  assert.match(migration, /\(r\.created_at,r\.id\)<\(p_before_created_at,p_before_id\)/g);
  assert.match(migration, /where r\.product_id=p_product_id and r\.status='visible'/);
  assert.match(migration, /where r\.store_id=p_store_id and r\.status='visible'/);
  assert.doesNotMatch(migration.slice(migration.indexOf("search_marketplace_product_reviews")), /buyer_email|phone|shipping_address|payment_id|ledger/i);
  for (const fn of ["submit_my_marketplace_product_review", "submit_my_marketplace_seller_review", "search_marketplace_product_reviews", "search_marketplace_store_reviews", "get_marketplace_product_reputation", "get_marketplace_store_reputation"]) assert.match(migration, new RegExp(`create or replace function public\\.${fn}`));
  assert.equal((migration.match(/set search_path=pg_catalog,public/g) ?? []).length, 7);
});

test("product and seller aggregates remain distinct and reviews fail closed at the mobile boundary", () => {
  for (const token of ["product_aggregate", "seller_aggregate", "distribution", "average_rating", "review_count"]) assert(migration.includes(token), token);
  for (const parser of ["rpcUuid", "rpcBoundedInteger", "rpcBoolean", "rpcTimestamp", "rpcCursorPage", "rpcNullableNonnegative"]) assert(reviewService.includes(parser), parser);
  assert.match(reviewService, /rpcBoundedInteger\(row\.rating, 1, 5/);
  assert.match(reviewService, /rpcBoolean\(row\.verified_purchase/);
  assert.match(reviewService, /if \(.*verified_purchase.*!== true\)/s);
  assert.match(reviews, /kind === "product"\s*\?\s*reputation\.productAggregate\s*:\s*reputation\.sellerAggregate/);
  assert.match(reviews, /Califica este producto/); assert.match(reviews, /Califica al vendedor/);
  assert.match(reviews, /disabled=\{rating === 0 \|\| submitting\}/);
  assert.match(reviews, /Las reseñas están disponibles para compradores verificados/);
});

test("premium gallery uses native paging, synchronized thumbnails, fullscreen image paging, and truthful media", () => {
  assert.match(gallery, /FlatList/); assert.match(gallery, /pagingEnabled/g); assert.match(gallery, /onMomentumScrollEnd=\{selectFromScroll\}/); assert.match(gallery, /thumbnailRef\.current\?\.scrollToIndex/); assert.match(gallery, /onPress=\{\(\) => setFullscreen\(true\)\}/); assert.match(gallery, /<Modal[\s\S]*visible=\{fullscreen\}/); assert.match(gallery, /Ampliar imagen/); assert.match(gallery, /Cerrar imagen ampliada/); assert.match(gallery, /Imagen no disponible/);
  assert.doesNotMatch(gallery + product + storePage, /picsum\.photos|placeholder\.com|source\.unsplash/i);
  assert.match(gallery, /item\.kind === "video"/); assert.match(gallery, /nativeControls/);
});

test("store branding reuses canonical owned media authority and appears on public commerce surfaces", () => {
  for (const token of ["uploadMediaFromUri", '"store_logo"', '"store_banner"', "setStoreMedia", "logo_asset_id", "banner_asset_id"]) assert(storeSettings.includes(token), token);
  for (const token of ["store_logo", "store_banner", "IMAGE_PURPOSES"]) assert(media.includes(token), token);
  assert.match(mediaPurposes, /store_logo:\s*\{[\s\S]*?kind: "image"[\s\S]*?maxBytes: 10_000_000[\s\S]*?mimeTypes: IMAGES/);
  assert.match(storeSettings, /Subir logo|Cambiar logo/); assert.match(storeSettings, /Subir portada|Cambiar portada/);
  assert.match(product, /reputation\.store\.logoUrl/); assert.match(storePage, /store\.store\.logoUrl/);
  assert.match(product + storePage, /storeLogoFallback|logoFallback/);
  for (const token of ["foreign_asset_denied", "non_image_denied", "set_marketplace_store_media"]) assert(proof.includes(token), token);
});

test("Marketplace shopping removes direct seller contact while preserving store, support, and purchase navigation", () => {
  assert.doesNotMatch(product, /\/chat\/|Contactar (a |al )?vendedor|chat-bubble-outline|>Mensaje</i);
  assert.match(product, /pathname: "\/store\/\[id\]"/);
  assert.match(product, /ProductPurchaseBar/); assert.match(product, /handleAddToCart\(true\)/); assert.match(product, /router\.push\("\/checkout" as never\)/);
  assert.doesNotMatch(migration + reviewService, /service_role[^\n]*(key|secret)|atomic_ledger_transfer|ledger_(credit|debit)|seller_payout|creator_payout/i);
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
});

test("disposable proof exercises auth, ownership, bounds, aggregates, keyset pagination and zero residue", () => {
  for (const token of ["MARKETPLACE_REVIEW_PROOF_REQUIRES_DISPOSABLE_DATABASE", 'claims("anon")', 'claims("authenticated", ids.seller)', "review_counts", "next_cursor", "fixture_residue", "reconcile_marketplace_reviews"]) assert(proof.includes(token), token);
});
