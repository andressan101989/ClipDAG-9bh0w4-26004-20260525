import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20260922203641_ads_v2_f_generic_delivery_placement_registry.sql", import.meta.url), "utf8");

test("F creates one private placement registry and a disabled delivery policy", () => {
  assert.match(sql, /create table private\.advertising_placement_catalog/i);
  assert.match(sql, /create table private\.advertising_delivery_policy/i);
  for (const code of ["marketplace_home", "marketplace_search", "social_feed", "stories", "clips", "live"]) assert.match(sql, new RegExp(`'${code}'`));
  assert.match(sql, /global_v2_delivery_enabled[^;]+default false/is);
  assert.match(sql, /v2_delivery_enabled[^;]+default false/is);
  assert.doesNotMatch(sql, /update\s+private\.advertising_(?:delivery_policy|placement_catalog)\s+set[\s\S]*enabled\s*=\s*true/i);
});

test("placement selection is versioned, immutable and owner controlled", () => {
  for (const table of ["advertising_placement_selections", "advertising_placement_selection_versions", "advertising_placement_selection_items"]) assert.match(sql, new RegExp(`create table private\\.${table}`));
  assert.match(sql, /unique\s*\(ad_set_id\)/i);
  assert.match(sql, /unique\s*\(placement_selection_id, version_number\)/i);
  assert.match(sql, /advertising_placement_selection_definition_immutable/i);
  for (const fn of ["create_my_advertising_placement_selection_draft", "create_my_advertising_placement_selection_version", "get_my_advertising_placement_selection"]) assert.match(sql, new RegExp(`function public\\.${fn}`));
});

test("preflight fails closed for unavailable signals, activation and delivery switches", () => {
  assert.match(sql, /function private\.ads_delivery_viewer_is_adult/i);
  assert.match(sql, /function private\.advertising_delivery_preflight_at/i);
  for (const reason of [
    "global_delivery_disabled", "placement_v2_delivery_disabled", "campaign_activation_not_implemented",
    "viewer_geo_authority_unavailable", "viewer_language_authority_unavailable",
    "frequency_authority_unavailable", "outside_daypart", "viewer_adult_eligibility_required"
  ]) assert.match(sql, new RegExp(reason));
  assert.match(sql, /review_status[^;\n]*'approved'/i);
  assert.doesNotMatch(sql, /user_profiles\.location|inet_client_addr|request\.headers|current_setting\s*\(\s*'request\.headers'/i);
});

test("preview is read-only and service resolver is not client executable", () => {
  assert.match(sql, /function public\.preview_my_advertising_delivery/i);
  assert.match(sql, /function public\.fetch_advertising_delivery_candidates_v2/i);
  assert.match(sql, /revoke all on function public\.fetch_advertising_delivery_candidates_v2[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.fetch_advertising_delivery_candidates_v2[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.fetch_advertising_delivery_candidates_v2[\s\S]+to authenticated/i);
  assert.doesNotMatch(sql, /financial_transactions|ledger_entries|marketplace_ad_financial_events|record_marketplace_ad_event/i);
});

test("all F tables are private, force RLS, client denied, and helpers use empty search path", () => {
  for (const table of [
    "advertising_placement_catalog", "advertising_delivery_policy", "advertising_placement_selections",
    "advertising_placement_selection_versions", "advertising_placement_selection_items"
  ]) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.doesNotMatch(sql, /set search_path\s*=\s*(?:public|private|auth)/i);
});
