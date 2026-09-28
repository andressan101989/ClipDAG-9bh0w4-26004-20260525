import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("supabase/migrations/", root));
const names = migrations.filter((name) => name.endsWith("_ads_v2_plr_12_production_pricing_v1.sql"));

test("PLR-12 has one forward-only pricing migration", () => {
  assert.equal(names.length, 1);
});

const sql = names.length === 1
  ? readFileSync(new URL(`supabase/migrations/${names[0]}`, root), "utf8")
  : "";
const economics = readFileSync(new URL("supabase/functions/_shared/bdagEconomics.ts", root), "utf8");
const businessApi = readFileSync(new URL("apps/business-web/src/lib/adsManagerApi.ts", root), "utf8");
const businessPanel = readFileSync(new URL("apps/business-web/src/components/ads/OperationalTruthPanels.tsx", root), "utf8");
const adminPage = readFileSync(new URL("apps/admin-web/src/pages/AdminAdvertisingPages.tsx", root), "utf8");

test("Pricing V1 snapshots the canonical 100 BDAG per USD economics", () => {
  assert.match(economics, /BDAG_PER_USD\s*=\s*100\b/);
  for (const [objective, event, rate] of [
    ["awareness", "impression", "0.30000000"],
    ["reach", "impression", "0.30000000"],
    ["video_views", "impression", "0.36000000"],
    ["traffic", "click", "36.00000000"],
    ["engagement", "click", "36.00000000"],
    ["profile_visits", "click", "40.00000000"],
    ["messages", "click", "50.00000000"],
    ["app_promotion", "click", "50.00000000"],
    ["marketplace_sales", "click", "45.00000000"],
  ]) {
    assert.match(sql, new RegExp(`'${objective}'\\s*,\\s*'${event}'\\s*,\\s*${rate.replaceAll(".", "\\.")}`));
  }
  assert.match(sql, /nelyon-ads-pricing-v1/);
  assert.match(sql, /bdag_per_usd_snapshot[\s\S]*100/i);
});

test("bootstrap is prospective, global-only, complete, and system-audited", () => {
  assert.match(sql, /launch_mode[\s\S]{0,100}<>\s*'DISARMED'/i);
  assert.match(sql, /status\s*=\s*'OPEN'/i);
  assert.match(sql, /advertising_event_billing_materializations/i);
  assert.match(sql, /date_trunc\('minute'\s*,\s*v_published_at\)\s*\+\s*interval\s*'10 minutes'/i);
  assert.match(sql, /cross join[\s\S]*advertising_placement_catalog/i);
  assert.match(sql, /'global'[\s\S]*'published'/i);
  assert.match(sql, /advertising\.pricing_v1\.bootstrap/i);
  assert.match(sql, /actor_kind[\s\S]*system_workflow/i);
  assert.match(sql, /published_rate_count[\s\S]*54/i);
  assert.doesNotMatch(sql, /canary_campaign/i);
  assert.match(sql, /website_conversions[\s\S]*billing_runtime_ready\s*=\s*false/i);
});

test("server projections expose multi-placement pricing truth", () => {
  assert.match(sql, /create or replace function public\.get_my_advertising_campaign_billing_v2/i);
  assert.match(sql, /placement_rates/i);
  assert.match(sql, /advertising_placement_selection_items/i);
  assert.match(sql, /create or replace function public\.get_admin_advertising_billing_health/i);
  assert.match(sql, /production_rate_coverage_by_placement/i);
  for (const placement of ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"]) {
    assert.match(sql, new RegExp(`'${placement}'`));
  }
  assert.doesNotMatch(sql, /v_coverage\s*:=\s*private\.advertising_rate_coverage_at\('PRODUCTION',null,'social_feed'/i);
});

test("Business and Admin consume server pricing truth without a frontend calculator", () => {
  assert.match(businessApi, /placementRates/);
  assert.match(businessApi, /placement_rates/);
  assert.match(businessPanel, /Rates by placement/);
  assert.match(adminPage, /Coverage by placement/);
  assert.match(adminPage, /Rate placement/);
  assert.doesNotMatch(businessApi, /BDAG_PER_USD|rateBdag\s*\*\s*100/);
});
