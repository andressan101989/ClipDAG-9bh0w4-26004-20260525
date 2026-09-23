import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const matches = readdirSync(migrations).filter((name) => name.endsWith("_ads_v2_j_admin_analytics_production_closure.sql"));
assert.equal(matches.length, 1, "exactly one ADS-V2-J migration must exist");
const sql = readFileSync(new URL(matches[0], migrations), "utf8");

function body(name) {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${name} body terminator missing`);
  return sql.slice(start, end + 3);
}

test("J adds one sensitive Ads V2 read capability to only Platform and Super Admin", () => {
  assert.match(sql, /'advertising\.ads\.read'\s*,\s*'advertising'\s*,\s*'read'/i);
  assert.match(sql, /Read Ads V2 administration and aggregate analytics projections\./);
  assert.match(sql, /'advertising\.ads\.read'[\s\S]*true/i);
  assert.match(sql, /'SUPER_ADMIN'\s*,\s*'advertising\.ads\.read'/i);
  assert.match(sql, /'PLATFORM_ADMIN'\s*,\s*'advertising\.ads\.read'/i);
  for (const role of ["MARKETPLACE_ADMIN", "MODERATOR", "FINANCE_AUDITOR"])
    assert.doesNotMatch(sql, new RegExp(`'${role}'\\s*,\\s*'advertising\\.ads\\.read'`, "i"));
  assert.match(sql, /role_code\s+not\s+in\s*\(\s*'SUPER_ADMIN'\s*,\s*'PLATFORM_ADMIN'\s*\)/i);
  assert.doesNotMatch(sql, /advertising\.ads\.manage/i);
});

test("admin campaign search is bounded, validated, keyset paginated and privacy safe", () => {
  const fn = body("search_admin_advertising_campaigns");
  assert.match(fn, /admin_require_capability\('advertising\.ads\.read'\)/i);
  assert.match(fn, /least\(greatest\(coalesce\(p_limit,\s*50\),\s*1\),\s*100\)/i);
  assert.match(fn, /limit\s+v_limit\s*\+\s*1/i);
  assert.match(fn, /count\(\*\)\s+from\s+page\)\s*>\s*v_limit/i);
  assert.match(fn, /p_cursor_created_at/i);
  assert.match(fn, /p_cursor_id/i);
  assert.match(fn, /advertising_campaign_objective_invalid/i);
  assert.match(fn, /advertising_campaign_status_invalid/i);
  assert.match(fn, /'authority'\s*,\s*'ads_v2'/i);
  assert.doesNotMatch(fn, /owner_email|viewer_user_id|financial_transaction_id|funding_source_account_id/i);
});

test("campaign detail returns hierarchy and safe aggregates without raw identities", () => {
  const fn = body("get_admin_advertising_campaign_detail");
  assert.match(fn, /admin_require_capability\('advertising\.ads\.read'\)/i);
  for (const authority of ["advertising_ad_sets", "advertising_audiences", "advertising_placement_selections", "advertising_destinations", "advertising_ads", "advertising_creative_versions", "advertising_campaign_finance"])
    assert.match(fn, new RegExp(`private\\.${authority}`, "i"));
  assert.match(fn, /'reason_code'/i);
  assert.doesNotMatch(fn, /'note'\s*,|viewer_user_id|event_key|conversion_key|financial_transaction_id|funding_source_account_id|owner_user_id/i);
});

test("overview uses the established ranges and aggregates only Ads V2", () => {
  const fn = body("get_admin_advertising_overview");
  assert.match(fn, /admin_require_capability\('advertising\.ads\.read'\)/i);
  for (const range of ["7d", "30d", "90d", "all"]) assert.match(fn, new RegExp(`'${range}'`));
  assert.match(fn, /p_range\s+is\s+null\s+or\s+p_range\s+not\s+in/i);
  assert.match(fn, /case[\s\S]*when[\s\S]*impressions[\s\S]*=\s*0[\s\S]*then\s*0/i);
  assert.match(fn, /'authority'\s*,\s*'ads_v2'/i);
  assert.doesNotMatch(fn, /marketplace_ad_events|viewer_user_id/i);
});

test("health remains fail closed and reports explicit pre-launch blockers", () => {
  const fn = body("get_admin_advertising_health");
  assert.match(fn, /admin_require_capability\('advertising\.ads\.read'\)/i);
  assert.match(fn, /'production_delivery_ready'\s*,\s*false/i);
  assert.match(fn, /age_band\s*=\s*'age_18_plus'/i);
  assert.match(fn, /policy_version\s*=\s*policy\.policy_version/i);
  assert.match(fn, /advertiser_eligibility_operational'\s*,\s*v_adult_eligible_rows\s*>\s*0/i);
  assert.match(fn, /if\s+v_adult_eligible_rows\s*=\s*0\s+then[\s\S]*age_authority_unavailable/i);
  for (const blocker of [
    "age_authority_unavailable", "campaign_activation_not_implemented",
    "finance_idempotency_preactivation_hardening_required", "finance_funding_disabled",
    "finance_spend_disabled", "finance_settlement_disabled", "global_delivery_disabled",
    "no_v2_placement_enabled"
  ]) assert.match(fn, new RegExp(blocker));
  assert.match(fn, /geo_matching_disabled/i);
  assert.match(fn, /language_matching_disabled/i);
});

test("canonical moderation projection exposes the exact reviewable media and destination assembly", () => {
  const fn = body("search_admin_advertising_ads");
  assert.match(fn, /admin_require_capability\('content\.items\.read'\)/i);
  assert.match(fn, /'preview_url'/i);
  assert.match(fn, /'playback_url'/i);
  assert.match(fn, /media\.public_url/i);
  assert.match(fn, /pub-d146e3d06d274db4871f5b6020fd850f\\\.r2\\\.dev/i);
  assert.match(fn, /video\.hls_url/i);
  assert.match(fn, /'headline'/i);
  assert.match(fn, /'description'/i);
  assert.match(fn, /'call_to_action'/i);
  assert.match(fn, /'external_url'/i);
  assert.match(fn, /'target_product_id'/i);
  assert.match(sql, /revoke all on function public\.search_admin_advertising_ads\(text,integer\)[\s\S]+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.search_admin_advertising_ads\(text,integer\)[\s\S]+to authenticated/i);
});

test("finance health is a read wrapper with the independent finance gate", () => {
  const fn = body("get_admin_advertising_finance_health");
  assert.match(fn, /admin_require_capability\('finance\.reconciliation\.read'\)/i);
  assert.match(fn, /public\.reconcile_advertising_finance\(\)/i);
  assert.match(fn, /public\.reconcile_marketplace_ad_finance\(\)/i);
  assert.match(fn, /public\.reconcile_marketplace_ad_finalization\(\)/i);
  assert.doesNotMatch(fn, /ledger_accounts|financial_transactions|funding_source_account_id/i);
});

test("all new admin RPCs are authenticated-only hardened SECURITY DEFINER reads", () => {
  for (const fn of [
    "search_admin_advertising_campaigns", "get_admin_advertising_campaign_detail",
    "get_admin_advertising_overview", "get_admin_advertising_health",
    "get_admin_advertising_finance_health"
  ]) {
    const definition = body(fn);
    assert.match(definition, /stable[\s\S]*security definer[\s\S]*set search_path = ''/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]+from public, anon, authenticated, service_role`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]+to authenticated`, "i"));
  }
});

test("J introduces no operational mutation, activation, policy enablement, or analytics table", () => {
  assert.doesNotMatch(sql, /create table|create materialized view/i);
  assert.doesNotMatch(sql, /global_v2_delivery_enabled\s*=\s*true|v2_delivery_enabled\s*=\s*true|funding_enabled\s*=\s*true|spend_enabled\s*=\s*true|settlement_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /create[^\n]*function[^\n]*(activate|fund_my|spend_advertising|settle_advertising)/i);
  assert.doesNotMatch(sql, /insert into private\.user_age_eligibility|insert into private\.advertising_(campaigns|ads|events|conversions|attributions|campaign_finance)/i);
});

test("Admin Web integrates one canonical Advertising workspace and reuses moderation", () => {
  const app = readFileSync(new URL("../apps/admin-web/src/App.tsx", import.meta.url), "utf8");
  const nav = readFileSync(new URL("../apps/admin-web/src/layout/adminNavigation.ts", import.meta.url), "utf8");
  const apiPath = new URL("../apps/admin-web/src/lib/adminAdvertisingApi.ts", import.meta.url);
  const pagesPath = new URL("../apps/admin-web/src/pages/AdminAdvertisingPages.tsx", import.meta.url);
  assert.ok(existsSync(apiPath));
  assert.ok(existsSync(pagesPath));
  const api = readFileSync(apiPath, "utf8");
  const pages = readFileSync(pagesPath, "utf8");
  for (const route of ["/advertising", "/advertising/campaigns", "/advertising/campaigns/:campaignId", "/advertising/review", "/advertising/analytics", "/advertising/health", "/advertising/finance-health"])
    assert.match(app, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(nav, /group:"advertising"/);
  assert.match(nav, /capability:"advertising\.ads\.read"/);
  assert.match(api, /search_admin_advertising_ads/);
  assert.match(api, /admin_review_advertising_ad/);
  assert.match(pages, /ADS V2 PRE-LAUNCH/);
  assert.match(pages, /Delivery disabled/);
  assert.match(pages, /Funding disabled/);
  assert.doesNotMatch(api, /fund_my_advertising|spend_advertising|settle_advertising|fetch_advertising_delivery_candidates|service_role/i);
  assert.doesNotMatch(pages, /Enable delivery|Activate campaign|Launch campaign/i);
});
