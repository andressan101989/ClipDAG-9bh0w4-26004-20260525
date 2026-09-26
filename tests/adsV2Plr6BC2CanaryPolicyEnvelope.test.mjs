import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationNames = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_6b_c2_canary_policy_envelope.sql"));
const sql = migrationNames.length === 1
  ? readFileSync(new URL(`supabase/migrations/${migrationNames[0]}`, root), "utf8")
  : "";

test("C2 is one forward-only migration that advances only the three launch policy versions", () => {
  assert.equal(migrationNames.length, 1);
  assert.match(sql, /update\s+private\.advertising_finance_policy[\s\S]*policy_version\s*=\s*'nelyon-ads-finance-v2'/i);
  assert.match(sql, /update\s+private\.advertising_campaign_lifecycle_policy[\s\S]*policy_version\s*=\s*'nelyon-ads-campaign-lifecycle-v2'/i);
  assert.match(sql, /update\s+private\.advertising_delivery_policy[\s\S]*policy_version\s*=\s*'nelyon-ads-delivery-v3'/i);
  assert.doesNotMatch(sql, /update\s+private\.advertising_canary_policy[\s\S]*policy_version/i);
  assert.doesNotMatch(sql, /33b34e6a|tesla el carro|fund_my_advertising_campaign_budget_v2\s*\(|activate_my_advertising_campaign_v2\s*\(|record_advertising_impression_v2\s*\(/i);
});

test("C2 retains historical checks and adds exact Finance V2, Lifecycle V2 and Delivery V3 row safety", () => {
  for (const historical of [
    "advertising_finance_policy_v1_safe_chk",
    "advertising_campaign_lifecycle_policy_v1_safe_chk",
    "advertising_delivery_policy_v2_fail_closed_chk",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`drop\\s+constraint(?:\\s+if\\s+exists)?\\s+${historical}`, "i"));
  }
  assert.match(sql, /add\s+constraint\s+advertising_finance_policy_v2_safe_chk[\s\S]*policy_version\s*<>\s*'nelyon-ads-finance-v2'[\s\S]*currency\s*=\s*'BDAG'[\s\S]*not\s+spend_enabled[\s\S]*shared_escrow_account_type\s*=\s*'marketplace_ads_escrow'[\s\S]*shared_revenue_account_type\s*=\s*'marketplace_ads_revenue'[\s\S]*spend_requires_billable_event/is);
  assert.match(sql, /add\s+constraint\s+advertising_campaign_lifecycle_policy_v2_safe_chk[\s\S]*policy_version\s*<>\s*'nelyon-ads-campaign-lifecycle-v2'[\s\S]*not\s+automatic_transitions_enabled/is);
  assert.match(sql, /add\s+constraint\s+advertising_delivery_policy_v3_safe_chk[\s\S]*policy_version\s*<>\s*'nelyon-ads-delivery-v3'[\s\S]*require_authenticated_viewer[\s\S]*require_adult_viewer[\s\S]*require_approved_ad[\s\S]*not\s+geo_matching_enabled[\s\S]*not\s+language_matching_enabled[\s\S]*frequency_enforcement_enabled/is);
});

test("C2 defines one private invoker-rights invariant with a locked search path", () => {
  const functions = [...sql.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)/gi)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(functions, ["private.advertising_assert_canary_launch_envelope"]);
  const start = sql.toLowerCase().indexOf("create or replace function private.advertising_assert_canary_launch_envelope");
  const end = sql.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start);
  const body = sql.slice(start, end + 3);
  assert.match(body, /returns\s+trigger/i);
  assert.match(body, /set\s+search_path\s*=\s*''/i);
  assert.doesNotMatch(body, /security\s+definer/i);
  assert.match(body, /advertising_canary_launch_envelope_violation/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+private\.advertising_assert_canary_launch_envelope\(\)\s+from\s+public,\s*anon,\s*authenticated,\s*service_role/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\./i);
});

test("C2 attaches the same deferred constraint invariant to all five canonical policy tables", () => {
  const triggerMatches = [...sql.matchAll(/create\s+constraint\s+trigger\s+(\w+)[\s\S]*?on\s+private\.(\w+)[\s\S]*?deferrable\s+initially\s+deferred[\s\S]*?execute\s+function\s+private\.advertising_assert_canary_launch_envelope\(\)/gi)];
  assert.equal(triggerMatches.length, 5);
  assert.deepEqual(triggerMatches.map((match) => match[2]).sort(), [
    "advertising_campaign_lifecycle_policy",
    "advertising_canary_policy",
    "advertising_delivery_policy",
    "advertising_finance_policy",
    "advertising_placement_catalog",
  ]);
  for (const match of triggerMatches) assert.match(match[0], /after\s+insert\s+or\s+update\s+or\s+delete/i);
});

test("C2 deployment itself leaves every operational launch switch disabled", () => {
  assert.match(sql, /update\s+private\.advertising_finance_policy\s+set[\s\S]*funding_enabled\s*=\s*false[\s\S]*spend_enabled\s*=\s*false[\s\S]*settlement_enabled\s*=\s*false[\s\S]*where\s+singleton/is);
  assert.match(sql, /update\s+private\.advertising_campaign_lifecycle_policy\s+set[\s\S]*activation_enabled\s*=\s*false[\s\S]*automatic_transitions_enabled\s*=\s*false[\s\S]*where\s+singleton/is);
  assert.match(sql, /update\s+private\.advertising_delivery_policy\s+set[\s\S]*global_v2_delivery_enabled\s*=\s*false[\s\S]*where\s+singleton/is);
  assert.match(sql, /update\s+private\.advertising_placement_catalog\s+set\s+v2_delivery_enabled\s*=\s*false/i);
  assert.doesNotMatch(sql, /set[\s\S]{0,160}(?:funding_enabled|activation_enabled|global_v2_delivery_enabled|v2_delivery_enabled)\s*=\s*true/i);
});
