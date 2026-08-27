import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const shop = read("app/(tabs)/shop.tsx");
const tabs = read("app/(tabs)/_layout.tsx");
const marketplace = read("services/marketplaceService.ts");
const reviews = read("services/marketplaceReviewService.ts");
const saves = read("contexts/ShopContext.tsx");

test("active Shop route implements the authoritative premium hierarchy", () => {
  for (const token of [
    "O N S P A C E",
    "Tienda",
    "Compra productos físicos y digitales",
    "Buscar productos",
    "FeaturedHero",
    "categoryOptions",
    "filterRail",
    "Productos para ti",
    "ProductCard",
    "SponsoredCard",
    "ProductSkeleton",
  ])
    assert(shop.includes(token), token);

  const header = shop.indexOf("O N S P A C E");
  const search = shop.indexOf('placeholder="Buscar productos"');
  const hero = shop.indexOf("<FeaturedHero");
  const categories = shop.indexOf("categoryOptions.map");
  const products = shop.indexOf("<Text style={styles.catalogTitle}");
  assert(
    header < search &&
      search < hero &&
      hero < categories &&
      categories < products,
  );
  assert.match(shop, /<FlatList[\s\S]*?numColumns=\{2\}/);
  assert.match(shop, /aspectRatio:\s*171\s*\/\s*142/);
});

test("wallet, cart, search, categories, seller and detail navigation stay canonical", () => {
  assert.match(shop, /const balance = walletData\?\.balance \?\? 0/);
  assert.match(shop, /\{totalQuantity > 0 \?/);
  assert.match(shop, /totalQuantity > 99 \? "99\+" : totalQuantity/);
  assert.match(
    shop,
    /setTimeout\(\(\) => setSearchQuery\(search\.trim\(\)\), 250\)/,
  );
  assert.match(
    shop,
    /fetchProducts\(\{[\s\S]*?category: category \|\| undefined,[\s\S]*?search: searchQuery \|\| undefined,[\s\S]*?limit: MARKETPLACE_PAGE_LIMIT/,
  );
  assert.match(shop, /fetchCategories\(\)/);
  assert.match(shop, /router\.push\("\/seller" as never\)/);
  assert.match(shop, /pathname: "\/product\/\[id\]"/);
  assert.match(shop, /router\.push\("\/cart" as never\)/);
  assert.match(marketplace, /p_search:\s*opts\?\.search \?\? null/);
});

test("Shop exposes only truthful catalog filters", () => {
  const filterRail = shop.slice(
    shop.indexOf('<View style={styles.filterRail}>'),
    shop.indexOf('<View style={styles.catalogHeader}>'),
  );

  assert.doesNotMatch(shop, /\bRecientes\b/);
  assert.doesNotMatch(filterRail, /name="schedule"/);
  assert.doesNotMatch(
    filterRail,
    /MÃ¡s recientes|Relevancia|MÃ¡s vendidos|Precio|Ordenar/,
  );
  assert.match(shop, /categoryOptions\.map/);
  assert.match(shop, /fetchCategories\(\)/);
  assert.match(
    shop,
    /fetchProducts\(\{[\s\S]*?category: category \|\| undefined,[\s\S]*?search: searchQuery \|\| undefined,[\s\S]*?limit: MARKETPLACE_PAGE_LIMIT/,
  );
  assert.match(
    shop,
    /setTimeout\(\(\) => setSearchQuery\(search\.trim\(\)\), 250\)/,
  );
  assert.match(
    shop,
    /const hasActiveFilter = Boolean\(searchQuery \|\| category\)/,
  );
  assert.match(filterRail, /\{hasActiveFilter \? \([\s\S]*?Limpiar[\s\S]*?\) : null\}/);
  assert.match(
    shop,
    /const clearFilters = useCallback\(\(\) => \{[\s\S]*?setSearch\(""\);[\s\S]*?setSearchQuery\(""\);[\s\S]*?setCategory\(""\);[\s\S]*?\}, \[\]\);/,
  );
});

test("grid renders only real Marketplace products, media and honest fallbacks", () => {
  assert.match(shop, /mixMarketplaceSponsoredProducts\(products, sponsored\)/);
  assert.match(shop, /product\.images\?\.\[0\] \?\? null/);
  assert.match(shop, /item\.images\?\.\[0\] \?\? null/);
  assert.match(shop, /Imagen no disponible/);
  assert.doesNotMatch(
    shop,
    /picsum|placeholder\.com|unsplash|Hoodie OnSpace|Galaxia Infinita|Nova Pro|Nebulon/i,
  );
  assert.doesNotMatch(shop, /63 BDAG|40% OFF|4\.8|4\.9/);
});

test("ratings, offers, sponsorship and favorites require existing authorities", () => {
  assert.match(shop, /fetchMarketplaceProductReputation\(id\)/);
  assert.match(
    shop,
    /aggregate\.reviewCount > 0 && aggregate\.averageRating !== null/,
  );
  assert.match(
    shop,
    /product\.compare_at_price != null &&[\s\S]*?product\.compare_at_price > product\.price/,
  );
  assert.match(shop, /fetchSponsoredProducts\([\s\S]*?"marketplace_home"/);
  assert.match(shop, /item\.sponsored|SponsoredCard|sponsoredBadge/);
  assert.match(shop, /toggleSaveProduct/);
  assert.match(shop, /isSavedProduct/);
  assert.match(saves, /persistSave\(userId, id, !saved\)/);
  assert.match(reviews, /get_marketplace_product_reputation/);
  assert.doesNotMatch(shop, /averageRating:\s*5|reviewCount:\s*[1-9]\d*/);
});

test("loading, empty state, bounded query and existing bottom navigation remain scalable", () => {
  for (const token of [
    "SKELETONS",
    "No hay productos aquí",
    "Explora otra categoría o vuelve pronto.",
    "Ver todo",
    "initialNumToRender={6}",
    "maxToRenderPerBatch={8}",
    "windowSize={7}",
    "MARKETPLACE_PAGE_LIMIT = 30",
  ])
    assert(shop.includes(token), token);
  for (const token of [
    "index",
    "search",
    "upload",
    "shop",
    "profile",
    "uploadGrad",
  ])
    assert(tabs.includes(token), token);
  assert.match(tabs, /name="shop"/);
});

test("Figma Shop implementation preserves Build 22 across later authorized migrations", () => {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(
    migrations.at(-1),
    "20260827012913_live_battles_lb4_f3_f2_snapshot_contract.sql",
  );
  assert.ok(migrations.includes("20260822221008_marketplace_post_settlement_delivery_ack_r2a_f1.sql"));
  assert.ok(migrations.includes("20260822165852_marketplace_post_settlement_returns_r2a.sql"));
  assert.ok(migrations.includes("20260822154610_marketplace_seller_dispute_awareness_r1c_f1c1.sql"));
  assert.ok(migrations.includes("20260822040000_marketplace_admin_release_readback_r1c_f1b.sql"));
  assert.ok(migrations.includes("20260822030000_marketplace_admin_settlement_reconciliation_r1c_f1a.sql"));
  assert.ok(migrations.includes("20260822020000_marketplace_post_reject_release_r1c_f1.sql"));
  assert.ok(migrations.includes("20260822010000_marketplace_admin_dispute_evidence_r1c.sql"));
  assert.ok(migrations.includes("20260820010000_fix_marketplace_checkout_order_image_snapshot.sql"));
  assert.ok(migrations.includes("20260821010000_marketplace_buyer_dispute_evidence_r1a.sql"));
  assert.ok(migrations.includes("20260821020000_marketplace_seller_dispute_defense_r1b.sql"));
  assert.ok(migrations.includes("20260817011718_harden_buyer_financial_exposure.sql"));
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
  assert.doesNotMatch(
    shop,
    /service_role|atomic_ledger_transfer|ledger_(credit|debit)|seller_payout|creator_payout|B8D-3/i,
  );
});
