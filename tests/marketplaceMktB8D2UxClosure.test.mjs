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
  const showcase = read("app/creator-showcase.tsx");
  for (const token of ["Remove from showcase", 'text: "Cancel"', 'text: "Remove product"', 'style: "destructive"'])
    assert(showcase.includes(token), `showcase ${token}`);
});

test("B8D-2 changes no production migration, authority, build, or later phase", () => {
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.at(-1), "20260811033000_marketplace_production_hardening.sql");
  assert.equal(String(JSON.parse(read("app.json")).expo.ios.buildNumber), "22");
  assert(!existsSync(join(root, "docs/audits/MKT-B8D-3")));
  const changedUx = shell + dialog + operation + mobileUi;
  assert.doesNotMatch(changedUx, /service_role|ledger_(credit|debit)|spend_marketplace_ad_budget|B8D-3|B8D-4/);
});
