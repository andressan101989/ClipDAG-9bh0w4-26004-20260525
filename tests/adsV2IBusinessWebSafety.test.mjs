import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../apps/business-web/src/lib/adsManagerApi.ts", import.meta.url), "utf8");
const pages = readFileSync(new URL("../apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", import.meta.url), "utf8");
const placements = readFileSync(new URL("../apps/business-web/src/components/ads/PlacementSelectionPanel.tsx", import.meta.url), "utf8");
const operationalTruth = readFileSync(new URL("../apps/business-web/src/components/ads/OperationalTruthPanels.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../apps/business-web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../apps/business-web/src/styles/business.css", import.meta.url), "utf8");

test("Business Ads V2 exposes the canonical routes and keeps launch controls absent", () => {
  for (const route of ["campaigns", "campaigns/new", "campaigns/:campaignId", "marketplace"]) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  }
  assert.match(app, /path=["']new["'][^>]+<BusinessAdsRoute create/);
  assert.match(app, /path=["']:campaignId["'][^>]+<BusinessAdsRoute detail/);
  assert.doesNotMatch(pages, /fund_my_advertising_campaign_budget_v2|spend_advertising_campaign_budget_v2|settle_advertising_campaign_budget_v2|fetch_advertising_delivery_candidates_v2|record_advertising_(?:impression|interaction)/);
  assert.match(operationalTruth, /Campaign activation is not available during pre-launch/);
  assert.match(operationalTruth, /Funding is not available during the current pre-launch phase/);
  assert.match(placements, /Delivery is currently paused during pre-launch/);
});

test("Business Ads V2 uses RPCs and does not create browser-side authority", () => {
  assert.doesNotMatch(`${api}\n${pages}`, /service_role|\.from\(["']private\.|user_age_eligibility|localStorage/);
  assert.match(api, /get_my_advertiser_accounts/);
  assert.match(api, /get_my_advertising_campaign/);
  assert.match(api, /get_my_advertising_creative_workspace/);
  assert.match(api, /get_my_advertising_event_summary/);
  assert.match(pages, /Advertising creation requires verified adult eligibility|advertisingUserMessage/);
});

test("Ads V2 layout has explicit tablet and narrow responsive behavior", () => {
  assert.match(css, /@media \(max-width: 1020px\)[\s\S]*\.ads-v2-checklist/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ads-v2-account-bar/);
  assert.match(css, /\.seller-table-wrap \{[^}]*overflow-x: auto/);
  assert.match(css, /\.ads-v2-workspace \{[^}]*min-width: 0/);
});
