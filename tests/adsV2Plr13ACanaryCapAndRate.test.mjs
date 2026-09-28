import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("supabase/migrations/", root));
const names = migrations.filter((name) => name.endsWith("_ads_v2_plr_13a_canary_cap_and_rate.sql"));

test("PLR-13A-C1 has exactly one forward-only canary preparation migration", () => {
  assert.equal(names.length, 1);
});

const sql = names.length === 1
  ? readFileSync(new URL(`supabase/migrations/${names[0]}`, root), "utf8")
  : "";

test("the canonical canary budget stays hard-capped at exactly 0.30 BDAG", () => {
  assert.match(sql, /drop constraint advertising_canary_policy_budget_chk/i);
  assert.match(sql, /add constraint advertising_canary_policy_budget_chk[\s\S]*max_budget_bdag\s*<=\s*0\.30000000/i);
  assert.doesNotMatch(sql, /max_budget_bdag\s*<=\s*1(?:\.0+)?\b/i);
  assert.match(sql, /nelyon-ads-canary-v1[\s\S]*nelyon-ads-canary-v2/i);
});

test("the bootstrap inserts exactly one campaign-scoped rate matching Pricing V1", () => {
  assert.match(sql, /b2ec6689-ece3-4f5b-bc91-ebfc4cf8970d/i);
  assert.match(sql, /7013f89c-9daf-4ef4-9b50-287ae1a6b24b/i);
  assert.match(sql, /'awareness'\s*,\s*'impression'\s*,\s*'social_feed'/i);
  assert.match(sql, /0\.30000000::numeric\(20,8\)/i);
  assert.match(sql, /'BDAG'\s*,\s*'canary_campaign'\s*,\s*v_campaign_id\s*,\s*'published'/i);
  assert.match(sql, /advertising\.plr13\.canary_policy_rate\.bootstrap/i);
  assert.match(sql, /'system_workflow'/i);
  assert.match(sql, /nelyon-ads-pricing-v1/i);
});

test("the migration is fail-closed and does not mutate financial authorities", () => {
  for (const guard of [
    "advertising_plr13_requires_disarmed_control_plane",
    "advertising_plr13_open_window_present",
    "advertising_plr13_materialization_present",
    "advertising_plr13_campaign_invalid",
    "advertising_plr13_finance_invalid",
    "advertising_plr13_placement_invalid",
    "advertising_plr13_ad_invalid",
    "advertising_plr13_global_rate_invalid",
    "advertising_plr13_existing_canary_rate",
    "advertising_plr13_campaign_evidence_present",
  ]) {
    assert.match(sql, new RegExp(guard));
  }
  assert.doesNotMatch(sql, /create or replace function public\.(?:fund_my_advertising_campaign_budget_v2|spend_advertising_campaign_budget_v2|settle_advertising_campaign_budget_v2)/i);
  assert.doesNotMatch(sql, /insert\s+into\s+(?:public\.)?(?:financial_transactions|ledger_entries)/i);
});
