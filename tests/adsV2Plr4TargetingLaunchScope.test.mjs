import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const matches = readdirSync(migrations).filter((name) =>
  name.endsWith("_ads_v2_plr_4_targeting_launch_scope.sql"),
);

test("PLR-4 consists of exactly one targeting launch-scope migration", () => {
  assert.equal(matches.length, 1, "exactly one PLR-4 migration must exist");
});

const sql = matches.length === 1 ? readFileSync(new URL(matches[0], migrations), "utf8") : "";

function body(schema, name) {
  const marker = `create or replace function ${schema}.${name}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${schema}.${name} missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${schema}.${name} body terminator missing`);
  return sql.slice(start, end + 3).toLowerCase();
}

test("targeting policy v2 locks the first-launch capabilities", () => {
  for (const column of [
    "geo_targeting_enabled",
    "language_targeting_enabled",
    "daypart_targeting_enabled",
    "frequency_targeting_enabled",
  ]) assert.match(sql, new RegExp(`add column ${column} boolean`, "i"));
  assert.match(sql, /nelyon-ads-targeting-v2/i);
  assert.match(sql, /not geo_targeting_enabled/i);
  assert.match(sql, /not language_targeting_enabled/i);
  assert.match(sql, /daypart_targeting_enabled/i);
  assert.match(sql, /frequency_targeting_enabled/i);
  assert.doesNotMatch(sql, /geo_targeting_enabled\s*=\s*true|language_targeting_enabled\s*=\s*true/i);
});

test("canonical normalizer rejects unsupported launch dimensions and preserves safe ones", () => {
  const normalizer = body("private", "ads_normalize_audience_definition");
  assert.match(normalizer, /advertising_audience_geo_targeting_not_enabled/);
  assert.match(normalizer, /advertising_audience_language_targeting_not_enabled/);
  assert.match(normalizer, /advertising_audience_daypart_targeting_not_enabled/);
  assert.match(normalizer, /advertising_audience_frequency_targeting_not_enabled/);
  assert.match(normalizer, /pg_catalog\.pg_timezone_names/);
  assert.match(normalizer, /v_max_impressions not between 1 and 20/);
  assert.match(normalizer, /v_window_hours not between 1 and 168/);
  assert.match(normalizer, /'targeting_policy_version', v_policy\.policy_version/);
  assert.match(normalizer, /advertising_audience_definition_unknown_key/);
});

test("authenticated self capability projection exposes policy, never viewer data", () => {
  const capability = body("public", "get_my_advertising_targeting_capabilities");
  assert.match(capability, /auth\.uid\(\)/);
  assert.match(capability, /advertising_auth_required/);
  for (const key of [
    "geo_targeting_enabled", "language_targeting_enabled",
    "daypart_targeting_enabled", "frequency_targeting_enabled",
  ]) assert.match(capability, new RegExp(key));
  assert.doesNotMatch(capability, /viewer_user_id|user_profiles|shipping|accept-language|ip_address|gps/i);
  assert.match(sql, /grant execute on function public\.get_my_advertising_targeting_capabilities\(\) to authenticated/i);
  assert.match(sql, /revoke all on function public\.get_my_advertising_targeting_capabilities\(\) from public,anon/i);
});

test("campaign readiness fails closed for stale policy and persisted geo-language rows", () => {
  const readiness = body("private", "advertising_campaign_operational_readiness_at");
  assert.match(readiness, /audience_targeting_policy_stale/);
  assert.match(readiness, /viewer_geo_authority_unavailable/);
  assert.match(readiness, /viewer_language_authority_unavailable/);
  assert.match(readiness, /advertising_targeting_policy/);
  assert.match(readiness, /targeting_policy_version/);
});

test("delivery preflight enforces current audience policy without pseudo-signals", () => {
  const preflight = body("private", "advertising_delivery_preflight_at");
  assert.match(preflight, /audience_targeting_policy_stale/);
  assert.match(preflight, /viewer_geo_authority_unavailable/);
  assert.match(preflight, /viewer_language_authority_unavailable/);
  assert.match(preflight, /advertising_targeting_policy/);
  assert.doesNotMatch(preflight, /user_profiles\.location|shipping_address|accept-language|device_locale|ip_address|gps/i);
  assert.match(preflight, /global_delivery_disabled/);
});

test("Admin health reports capability flags without making geo-language global blockers", () => {
  const health = body("public", "get_admin_advertising_health");
  for (const key of [
    "geo_targeting_enabled", "language_targeting_enabled",
    "daypart_targeting_enabled", "frequency_targeting_enabled",
  ]) assert.match(health, new RegExp(key));
  assert.match(health, /geo_matching_disabled/);
  assert.match(health, /language_matching_disabled/);
  assert.doesNotMatch(health, /array_append\(v_blockers,'geo_/);
  assert.doesNotMatch(health, /array_append\(v_blockers,'language_/);
  assert.match(health, /'production_delivery_ready',false/);
});

test("migration does not create viewer signal authorities or enable launch gates", () => {
  assert.doesNotMatch(sql, /create table (private|public)\.(ads_geo_profiles|ads_language_profiles|viewer_targeting_policy|advertising_launch_targeting_policy)/i);
  assert.doesNotMatch(sql, /global_v2_delivery_enabled\s*=\s*true|activation_enabled\s*=\s*true|automatic_transitions_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /funding_enabled\s*=\s*true|spend_enabled\s*=\s*true|settlement_enabled\s*=\s*true/i);
});
