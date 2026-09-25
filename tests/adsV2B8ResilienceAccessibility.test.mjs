import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("B8 uses one shared error taxonomy in Business and Admin", () => {
  const shared = read("shared/adsErrorPresentation.ts");
  const business = read("apps/business-web/src/lib/adsErrorPresentation.ts");
  const admin = read("apps/admin-web/src/lib/adsErrorPresentation.ts");
  assert.match(shared, /mutation_uncertain/);
  assert.match(shared, /access_denied/);
  assert.match(shared, /platform_prelaunch/);
  assert.match(business, /shared\/adsErrorPresentation/);
  assert.match(admin, /shared\/adsErrorPresentation/);
});

test("unknown Ads failures cannot become raw customer copy", () => {
  const business = read("apps/business-web/src/lib/adsManagerApi.ts");
  const admin = read("apps/admin-web/src/lib/adminReviewUx.ts");
  assert.match(business, /presentAdsError/);
  assert.match(admin, /presentAdsError/);
  assert.doesNotMatch(business, /cause\.message\s*\|\|/);
  assert.doesNotMatch(admin, /cause\.message\s*\|\|/);
});

test("Business keeps canonical workspace data and isolates Analytics refresh failure", () => {
  const page = read("apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx");
  assert.match(page, /previous\?\.analytics \?\? null/);
  assert.match(page, /panelErrors: \{ analytics:/);
  assert.match(page, /Refreshing the canonical campaign state/);
  assert.match(page, /getAdvertisingCampaignActivationReadiness/);
});

test("Admin keeps same-query data and announces stale refresh state", () => {
  const page = read("apps/admin-web/src/pages/AdminAdvertisingPages.tsx");
  assert.match(page, /if\(changed\)setData\(null\)/);
  assert.match(page, /Showing the last loaded data/);
  assert.match(page, /Refreshing the latest data/);
  assert.match(page, /Showing the last loaded review queue/);
});

test("Business and Admin dialogs provide modal, busy, focus trap, and focus return contracts", () => {
  for (const path of ["apps/business-web/src/components/BusinessConfirmDialog.tsx", "apps/admin-web/src/components/ConfirmDialog.tsx"]) {
    const source = read(path);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-busy=\{pending\}/);
    assert.match(source, /event\.key !== "Tab"/);
    assert.match(source, /returnFocusRef\.current\?\.focus\(\)/);
  }
});

test("responsive contracts cover 320, phone, tablet, and narrow desktop widths", () => {
  const business = read("apps/business-web/src/styles/business.css");
  const admin = read("apps/admin-web/src/styles/admin.css");
  assert.match(business, /min-width: 320px/);
  assert.match(business, /max-width: 420px/);
  assert.match(business, /max-width: 760px/);
  assert.match(business, /max-width: 1020px/);
  assert.match(business, /overflow-wrap: anywhere/);
  assert.match(admin, /min-width:320px/);
  assert.match(admin, /max-width:420px/);
  assert.match(admin, /max-width:768px/);
  assert.match(admin, /max-width:1050px/);
  assert.match(admin, /overflow-x:auto/);
});

test("existing Business and Admin mutation coordinators remain the only mutation paths", () => {
  const business = read("apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx");
  const admin = read("apps/admin-web/src/pages/AdminAdvertisingPages.tsx");
  assert.match(business, /useAdsMutationCoordinator/);
  assert.match(business, /adsMutationCoordinator/);
  assert.match(admin, /adminReviewCoordinator\.run/);
});
