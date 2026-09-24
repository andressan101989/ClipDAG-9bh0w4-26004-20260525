import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_6a_canary_safety_envelope.sql"));

test("PLR-6A creates one disabled private canary authority with hard caps", () => {
  assert.equal(migrations.length, 1);
  const sql = readFileSync(new URL(`supabase/migrations/${migrations[0]}`, root), "utf8");
  assert.match(sql, /create table private\.advertising_canary_policy/i);
  assert.match(sql, /policy_version[^;]+nelyon-ads-canary-v1/is);
  assert.match(sql, /canary_enabled[^;]+false/is);
  assert.match(sql, /max_budget_bdag[^;]+0\.01000000/is);
  assert.match(sql, /max_impressions[^;]+1/is);
  assert.match(sql, /placement_code\s*=\s*'social_feed'/i);
  assert.match(sql, /expires_at\s*<=\s*enabled_at\s*\+\s*interval\s*'60 minutes'/i);
  assert.doesNotMatch(sql, /check\s*\([^)]*(?:now|clock_timestamp)\s*\(/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table private\.advertising_canary_policy from public,\s*anon,\s*authenticated/i);
});

test("private canary helpers are client-denied and use fixed search paths", () => {
  const sql = readFileSync(new URL(`supabase/migrations/${migrations[0]}`, root), "utf8");
  for (const name of ["advertising_canary_campaign_allowed", "advertising_canary_delivery_allowed"]) {
    assert.match(sql, new RegExp(`create or replace function private\\.${name}`,'i'));
    assert.match(sql, new RegExp(`private\\.${name}[\\s\\S]+?security definer[\\s\\S]+?set search_path\\s*=\\s*''`,'i'));
    assert.match(sql, new RegExp(`revoke all on function private\\.${name}[\\s\\S]+?from public,\\s*anon,\\s*authenticated`,'i'));
  }
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.[^(]*canary/i);
});

test("lifecycle and finance preserve replay ordering before dormant canary gates", () => {
  const sql = readFileSync(new URL(`supabase/migrations/${migrations[0]}`, root), "utf8");
  for (const [name, replay, gate] of [
    ["activate_my_advertising_campaign_v2", "v_prior", "advertising_canary_campaign_allowed"],
    ["resume_my_advertising_campaign_v2", "v_prior", "advertising_canary_campaign_allowed"],
    ["fund_my_advertising_campaign_budget_v2", "v_prior", "advertising_canary_campaign_allowed"],
    ["spend_advertising_campaign_budget_v2", "v_prior", "advertising_canary_spend_disabled"],
    ["settle_advertising_campaign_budget_v2", "v_settlement", "advertising_canary_campaign_allowed"],
  ]) {
    const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
    const end = sql.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `${name} replacement missing`);
    const body = sql.slice(start, end);
    assert.ok(body.indexOf(replay) < body.indexOf(gate), `${name} checks replay before canary gate`);
  }
  assert.doesNotMatch(sql, /update\s+private\.advertising_(?:campaign_lifecycle_policy|finance_policy|delivery_policy)/i);
  assert.doesNotMatch(sql, /update\s+private\.advertising_placement_catalog/i);
});

test("delivery and impression add one fail-closed, concurrency-safe canary gate", () => {
  const sql = readFileSync(new URL(`supabase/migrations/${migrations[0]}`, root), "utf8");
  assert.match(sql, /create or replace function private\.advertising_delivery_preflight_at/i);
  assert.match(sql, /private\.advertising_canary_delivery_allowed/i);
  assert.match(sql, /advertising_canary_restriction/i);
  assert.match(sql, /create or replace function public\.record_advertising_impression_v2/i);
  assert.match(sql, /from private\.advertising_canary_policy[^;]+for update/is);
  assert.match(sql, /for update;[\s\S]*?where event_key=p_event_key;[\s\S]*?return pg_catalog\.to_jsonb\(v_prior\)/i);
  assert.match(sql, /event_type\s*=\s*'impression'/i);
  assert.match(sql, /occurred_at\s*>=\s*v_canary\.enabled_at/i);
  assert.match(sql, /advertising_canary_impression_limit_reached/i);
  const start = sql.toLowerCase().indexOf("create or replace function public.record_advertising_impression_v2");
  const end = sql.indexOf("$$;", start);
  assert.doesNotMatch(sql.slice(start, end), /spend_advertising_campaign_budget_v2\s*\(/i);
});
