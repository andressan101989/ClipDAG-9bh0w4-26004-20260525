import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const shell = read("apps/admin-web/src/layout/AdminShell.tsx");
const dialog = read("apps/admin-web/src/components/ConfirmDialog.tsx");
const operation = read("apps/admin-web/src/components/OperationConfirm.tsx");
const adminCss = read("apps/admin-web/src/styles/admin.css");
const operationCss = read("apps/admin-web/src/styles/operations.css");
const adminTests = read("apps/admin-web/src/tests/adminUx.test.tsx") + read("apps/admin-web/src/tests/operationsClosure.test.tsx");
const mobileUi = read("components/marketplace/SellerCenterUI.tsx");
const showcase = read("app/creator-showcase.tsx");

test("B8D-006 provides a bounded responsive navigation without losing routes", () => {
  for (const path of ["orders", "disputes", "sellers", "products", "creator-commerce", "promotions", "ads", "health", "activity"])
    assert(shell.includes(`/marketplace/${path}`), path);
  for (const token of ["aria-controls", "aria-expanded", "nav-toggle", "is-open"])
    assert(shell.includes(token), token);
  assert.match(adminCss, /@media\(max-width:720px\).*\.sidebar nav\.is-open\{display:grid\}/s);
  assert.match(adminCss, /max-height:min\(62vh,480px\);overflow-y:auto/);
  assert.match(adminTests, /keeps every Marketplace route reachable/);
});

test("B8D-007 keeps critical operational headers readable through one responsive table contract", () => {
  const pages = [
    "MarketplaceOrdersPage.tsx", "MarketplaceDisputesPage.tsx", "MarketplaceSellersPage.tsx", "MarketplaceProductsPage.tsx",
    "MarketplaceIntelligencePages.tsx",
  ];
  pages.forEach((file) => assert(read(`apps/admin-web/src/pages/${file}`).includes("table-panel"), file));
  for (const token of ["overflow-x:auto", "min-width:860px", "scrollbar-gutter:stable", ".table-head{display:grid"])
    assert(adminCss.includes(token), token);
  assert.match(adminCss, /@media\(max-width:1050px\)\{\.table-head,\.table-row\{/);
});

test("B8D-008 uses an accessible app dialog and preserves privileged-action safety", () => {
  for (const token of ['role="dialog"', 'aria-modal="true"', "aria-labelledby", "aria-describedby", 'event.key === "Escape"', 'event.key !== "Tab"'])
    assert(dialog.includes(token), token);
  assert(!operation.includes("window.confirm"));
  for (const token of ["maxReasonLength", "running.current", "crypto.randomUUID", "retry.current?.fingerprint", "disabled={pending}"])
    assert(operation.includes(token), token);
  for (const phrase of ["opens an accessible dialog without mutation", "confirms exactly once", "disables repeat submission"])
    assert(adminTests.includes(phrase), phrase);
  assert.match(operationCss, /dialog-backdrop/);
  assert.match(operationCss, /@media\(max-width:480px\)/);
});

test("mobile polish remains responsive and preserves seller continuation", () => {
  assert(mobileUi.includes("useWindowDimensions"));
  assert(mobileUi.includes("width<=360&&s.metricCompact"));
  assert(mobileUi.includes("minimumFontScale={.68}"));
  assert(mobileUi.includes("minHeight:44"));
  const products = read("app/seller/products.tsx"), promotions = read("app/seller/promotions.tsx"), editor = read("app/seller/product-editor/[productId].tsx");
  for (const token of ["onEndReached", "sellerProductsHasMore", "fetchMoreMyProducts"])
    assert(products.includes(token), `products ${token}`);
  assert(promotions.includes("loadMorePromotions"));
  assert(promotions.includes("loadMoreProducts"));
  assert(editor.includes("loadMoreShippingProfiles"));
  for (const token of ["Quitar del escaparate", 'text: "Cancelar"', 'text: "Quitar producto"', 'style: "destructive"'])
    assert(showcase.includes(token), `showcase ${token}`);
});

test("Creator Showcase closes the mobile touch, accessibility, language, and narrow-card gaps", () => {
  assert.match(showcase, /action:\{width:44,height:44,/);
  assert.match(showcase, /productTap:\{flex:1,minWidth:0,/);
  assert.match(showcase, /copy:\{flex:1,minWidth:0,/);
  assert.match(showcase, /actions:\{gap:2,flexShrink:0\}/);
  assert.doesNotMatch(showcase, /horizontal=\{true\}|horizontal\s*\/?>/);

  for (const contract of [
    'disabled={index === 0 || busy} onPress={() => void move(management, -1)} accessibilityRole="button" accessibilityLabel={`Mover ${item.title} hacia arriba`} accessibilityState={{ disabled: index === 0 || busy }}',
    'disabled={index === active.length - 1 || busy} onPress={() => void move(management, 1)} accessibilityRole="button" accessibilityLabel={`Mover ${item.title} hacia abajo`} accessibilityState={{ disabled: index === active.length - 1 || busy }}',
    'disabled={busy} onPress={() => void remove(management)} accessibilityRole="button" accessibilityLabel={`Quitar ${item.title} del escaparate`} accessibilityState={{ disabled: busy }}',
  ]) assert(showcase.includes(contract), contract);

  for (const phrase of [
    "Escaparate de Creator", "Mi escaparate", "Disponibles", "Buscar productos o tiendas",
    "Cargando productos…", "No pudimos cargar tu escaparate", "Tu escaparate está vacío",
    "No hay productos elegibles", "Explorar productos disponibles", "% de comisión",
  ]) assert(showcase.includes(phrase), phrase);
  for (const english of [
    '"Back"', '"Creator Showcase"', '"My showcase"', '"Available"', '"Search products or stores"',
    '"Loading products..."', '"Could not load your showcase"', '"Try again"', '"Your showcase is empty"',
    '"No eligible products"', '"Browse available products"', '"Product unavailable"',
    '"Remove from showcase"', '"Cancel"', '"Remove product"', '"Could not remove product"',
    '"Could not reorder showcase"',
  ]) assert(!showcase.includes(english), english);

  const removeFlow = showcase.slice(showcase.indexOf("const remove ="), showcase.indexOf("const move ="));
  assert(removeFlow.indexOf("Alert.alert(") < removeFlow.indexOf("removeMyCreatorShowcaseProduct("));
  assert(removeFlow.indexOf("onPress: () =>") < removeFlow.indexOf("removeMyCreatorShowcaseProduct("));
  for (const call of [
    "addMyCreatorShowcaseProduct(product.productId, randomUUID())",
    "removeMyCreatorShowcaseProduct(item.showcaseItemId, randomUUID())",
    "reorderMyCreatorShowcase(next.map((value) => value.showcaseItemId), randomUUID())",
  ]) assert(showcase.includes(call), call);
  assert.doesNotMatch(showcase, /seller_payout|creator_payout|platform_fee|ledger_|commission_bps\s*[+\-*/=]/i);
});

test("B8D-2R-F1 remains intact after the authorized C5 migration", () => {
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.at(-1), "20260824014644_live_lb1_fix_agora_uid_lint.sql");
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
  assert(!existsSync(join(root, "docs/audits/MKT-B8D-3")));
  const changedUx = shell + dialog + operation + mobileUi;
  assert.doesNotMatch(changedUx, /service_role|ledger_(credit|debit)|spend_marketplace_ad_budget|B8D-3|B8D-4/);
});
