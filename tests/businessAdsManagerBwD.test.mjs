import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260917052006_business_ads_manager_web_bw_d.sql", "utf8");
const api = readFileSync("apps/business-web/src/lib/adsManagerApi.ts", "utf8");
const app = readFileSync("apps/business-web/src/App.tsx", "utf8");
const layout = readFileSync("apps/business-web/src/layout/BusinessLayout.tsx", "utf8");

test("BW-D reuses canonical Ads tables and creates no parallel authority", () => {
  assert.equal((migration.match(/create\s+or\s+replace\s+function/gi) ?? []).length, 6);
  assert.doesNotMatch(migration, /create\s+table|alter\s+table|create\s+policy|create\s+(?:unique\s+)?index/i);
  for (const table of [
    "marketplace_ad_campaigns",
    "marketplace_ad_events",
    "marketplace_ad_finalizations",
    "marketplace_order_ad_attribution",
  ]) assert.match(migration, new RegExp(`public\\.${table}`));
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.(?:activate_marketplace_ad_campaign|spend_marketplace_ad_budget|release_marketplace_ad_unused_budget|finalize_marketplace_ad_campaign_delivery)/i);
});

test("business Ads reads are bounded, capability scoped and cursor paginated", () => {
  for (const name of [
    "search_my_business_ad_campaigns",
    "get_my_business_ad_campaign",
    "search_my_business_ad_eligible_products",
  ]) assert.match(migration, new RegExp(`function public\\.${name}\\(`, "i"));
  assert.match(migration, /private\.business_actor_has_capability\(p_business_owner_id, 'business\.ads\.read'\)/);
  assert.match(migration, /private\.business_actor_has_capability\(p_business_owner_id, 'business\.ads\.manage'\)/);
  assert.match(migration, /order by c\.created_at desc, c\.id desc/);
  assert.match(migration, /limit v_limit \+ 1/);
  assert.match(migration, /where n\.rn = v_limit/);
  assert.match(migration, /public\.marketplace_ad_product_is_eligible\(p_business_owner_id, p\.id, p\.store_id\)/);
  assert.doesNotMatch(migration, /financial_transaction_id|ledger_account_id|idempotency_key'\s*,/i);
});

test("draft pause and resume derive business ownership and move no money", () => {
  assert.match(migration, /v_owner_id := v_product\.seller_id/);
  assert.match(migration, /private\.business_require_capability\(v_owner_id, 'business\.ads\.manage'\)/);
  assert.match(migration, /values \(\s*v_owner_id, v_product\.store_id, v_product\.id/);
  assert.equal((migration.match(/private\.business_require_capability\(v_campaign\.seller_id, 'business\.ads\.manage'\)/g) ?? []).length, 2);
  assert.match(migration, /v_campaign\.status not in \('active', 'scheduled'\)/);
  assert.match(migration, /v_campaign\.status <> 'paused'/);
  assert.match(migration, /v_campaign\.spent_bdag \+ v_campaign\.released_bdag >= v_campaign\.total_budget_bdag/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(?:financial_transactions|ledger_entries|marketplace_ad_financial_events)/i);
});

test("BW-D functions use hardened ACL and empty search paths", () => {
  assert.equal((migration.match(/security definer/gi) ?? []).length, 6);
  assert.equal((migration.match(/set search_path = ''/gi) ?? []).length, 6);
  assert.equal((migration.match(/revoke all on function [^;]+ from public, anon, authenticated;/gi) ?? []).length, 6);
  assert.equal((migration.match(/grant execute on function [^;]+ to authenticated, service_role;/gi) ?? []).length, 6);
  assert.doesNotMatch(migration, /grant execute[^;]+to anon/i);
});

test("Business Web exposes only canonical Ads actions", () => {
  for (const rpc of [
    "search_my_business_ad_campaigns",
    "get_my_business_ad_campaign",
    "search_my_business_ad_eligible_products",
    "fetch_marketplace_ad_config",
    "create_marketplace_ad_campaign_draft",
    "activate_marketplace_ad_campaign",
    "pause_marketplace_ad_campaign",
    "resume_marketplace_ad_campaign",
  ]) assert.match(api, new RegExp(`client\\.rpc\\(\"${rpc}\"`));
  assert.doesNotMatch(api, /client\.rpc\("(?:spend_marketplace_ad_budget|release_marketplace_ad_unused_budget|finalize_marketplace_ad_campaign_delivery)"/);
  assert.match(app, /path="ads"/);
  assert.match(app, /path="ads\/new"/);
  assert.match(app, /path="ads\/:campaignId"/);
  assert.match(layout, /business\.ads\.read/);
  assert.match(layout, /business\.ads\.manage/);
  assert.doesNotMatch(api + app + layout, /service_role|serviceRoleKey|SUPABASE_SERVICE_ROLE/i);
});
