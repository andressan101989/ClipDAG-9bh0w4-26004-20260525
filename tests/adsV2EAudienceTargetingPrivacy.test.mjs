import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const matches = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("_ads_v2_e_audience_targeting_privacy.sql"),
);
assert.equal(matches.length, 1, "ADS-V2-E must have exactly one migration");
const sql = readFileSync(join(migrationsDir, matches[0]), "utf8");

test("creates one locked-down targeting policy with every prohibited dimension disabled", () => {
  assert.match(sql, /create table private\.advertising_targeting_policy/i);
  assert.match(sql, /policy_version text not null/i);
  assert.match(sql, /advertiser_minimum_age smallint not null default 18/i);
  assert.match(sql, /audience_minimum_age smallint not null default 18/i);
  for (const flag of [
    "minor_targeting_allowed",
    "interest_targeting_enabled",
    "behavioral_targeting_enabled",
    "custom_audiences_enabled",
    "lookalike_targeting_enabled",
    "sensitive_targeting_allowed",
    "precise_viewer_location_matching_enabled",
  ]) {
    assert.match(sql, new RegExp(`${flag} boolean not null default false`, "i"));
  }
  assert.match(sql, /'nelyon-ads-targeting-v1'/i);
});

test("creates one logical Audience per Ad Set and immutable versioned definitions", () => {
  assert.match(sql, /create table private\.advertising_audiences/i);
  assert.match(sql, /ad_set_id uuid not null[\s\S]*references private\.advertising_ad_sets\s*\(id\)/i);
  assert.match(sql, /unique\s*\(ad_set_id\)/i);
  assert.match(sql, /unique\s*\(ad_set_id,\s*creation_idempotency_key\)/i);
  assert.match(sql, /create table private\.advertising_audience_versions/i);
  assert.match(sql, /age_scope text not null[\s\S]*age_scope = 'adults_only'/i);
  assert.match(sql, /definition_fingerprint text not null/i);
  assert.match(sql, /unique\s*\(audience_id,\s*version_number\)/i);
  assert.match(sql, /unique\s*\(audience_id,\s*creation_idempotency_key\)/i);
  assert.match(sql, /advertising_audience_versions_immutable/i);
});

test("normalizes geography into typed country, region, city, and radius rows", () => {
  assert.match(sql, /create table private\.advertising_geo_targets/i);
  assert.match(sql, /match_mode text not null[\s\S]*'include'[\s\S]*'exclude'/i);
  assert.match(sql, /target_type text not null[\s\S]*'country'[\s\S]*'region'[\s\S]*'city'[\s\S]*'radius'/i);
  assert.match(sql, /country_code text not null/i);
  assert.match(sql, /latitude numeric/i);
  assert.match(sql, /longitude numeric/i);
  assert.match(sql, /radius_km numeric/i);
  assert.match(sql, /latitude between -90 and 90/i);
  assert.match(sql, /longitude between -180 and 180/i);
  assert.match(sql, /radius_km > 0 and radius_km <= 100/i);
  assert.match(sql, /advertising_geo_targets_shape_chk/i);
});

test("defines bounded language, timezone daypart, and frequency authorities", () => {
  assert.match(sql, /create table private\.advertising_language_targets/i);
  assert.match(sql, /language_tag text not null/i);
  assert.match(sql, /create table private\.advertising_daypart_windows/i);
  assert.match(sql, /weekday smallint not null[\s\S]*weekday between 1 and 7/i);
  assert.match(sql, /start_local time not null/i);
  assert.match(sql, /end_local time not null/i);
  assert.match(sql, /start_local < end_local/i);
  assert.match(sql, /pg_catalog\.pg_timezone_names/i);
  assert.match(sql, /create table private\.advertising_frequency_policies/i);
  assert.match(sql, /max_impressions integer not null[\s\S]*between 1 and 20/i);
  assert.match(sql, /window_hours integer not null[\s\S]*between 1 and 168/i);
});

test("strictly rejects unknown JSON keys and unsupported targeting dimensions", () => {
  assert.match(sql, /create or replace function private\.ads_normalize_audience_definition/i);
  assert.match(sql, /advertising_audience_definition_unknown_key/i);
  assert.match(sql, /advertising_audience_geography_unknown_key/i);
  assert.match(sql, /advertising_audience_language_unknown_key/i);
  assert.match(sql, /advertising_audience_daypart_unknown_key/i);
  assert.match(sql, /advertising_audience_frequency_unknown_key/i);
  for (const forbidden of ["interests", "behavioral", "custom_audience", "lookalike", "sensitive_targeting"])
    assert.doesNotMatch(sql, new RegExp(`p_definition\\s*->\\s*'${forbidden}'`, "i"));
});

test("validates adults-only policy without storing DOB or claiming granular adult ages", () => {
  assert.match(sql, /age_scope[\s\S]*adults_only/i);
  assert.match(sql, /private\.ads_actor_is_advertiser_age_eligible/i);
  assert.match(sql, /nelyon-ads-targeting-v1/i);
  assert.doesNotMatch(sql, /date_of_birth|raw_user_meta_data|birth_date/i);
  assert.doesNotMatch(sql, /18_24|25_34|35_44|45_64|65_plus/i);
});

test("creates atomic owner-only audience and version RPCs with safe concurrency", () => {
  assert.match(sql, /create or replace function public\.create_my_advertising_audience_draft\s*\(/i);
  assert.match(sql, /create or replace function public\.create_my_advertising_audience_version\s*\(/i);
  assert.match(sql, /private\.ads_require_owned_draft_campaign/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /on conflict\s*\(ad_set_id\)\s*do nothing/i);
  assert.match(sql, /coalesce\(max\(version_number\),\s*0\)\s*\+\s*1/i);
  assert.match(sql, /advertising_audience_idempotency_conflict/i);
  assert.match(sql, /advertising_audience_version_idempotency_conflict/i);
});

test("fingerprints a deterministic policy snapshot and normalized child definitions", () => {
  assert.match(sql, /create or replace function private\.ads_audience_definition_fingerprint/i);
  assert.match(sql, /extensions\.digest/i);
  assert.match(sql, /targeting_policy_version/i);
  assert.match(sql, /definition_fingerprint/i);
  assert.match(sql, /order by[\s\S]*(country_code|language_tag|weekday)/i);
});

test("returns only owner-readable canonical definitions and honest capability metadata", () => {
  assert.match(sql, /create or replace function public\.get_my_advertising_audience\s*\(/i);
  for (const capability of [
    "delivery_implemented",
    "interest_targeting",
    "behavioral_targeting",
    "custom_audiences",
    "lookalikes",
    "minor_targeting",
    "precise_viewer_location_matching",
  ]) assert.match(sql, new RegExp(`'${capability}',\\s*false`, "i"));
});

test("hardens every private targeting table and only grants authenticated RPC execution", () => {
  const tables = [
    "advertising_targeting_policy",
    "advertising_audiences",
    "advertising_audience_versions",
    "advertising_geo_targets",
    "advertising_language_targets",
    "advertising_daypart_windows",
    "advertising_frequency_policies",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.match(sql, /grant execute on function public\.create_my_advertising_audience_draft\(uuid,jsonb,uuid\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.create_my_advertising_audience_version\(uuid,jsonb,uuid\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.get_my_advertising_audience\(uuid\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/i);
});

test("uses empty search paths and keeps all internal helpers client-inaccessible", () => {
  const functions = sql.split(/create or replace function /i).slice(1);
  assert.ok(functions.length >= 8);
  for (const fn of functions) assert.match(fn.slice(0, fn.indexOf("$$") + 2), /set search_path = ''/i);
  assert.match(sql, /revoke execute on function private\.ads_normalize_audience_definition\(jsonb\) from public, anon, authenticated/i);
});

test("does not introduce viewer signals, prohibited targeting, delivery, placement, or finance", () => {
  assert.doesNotMatch(sql, /user_profiles\.location|user_profiles\.bio|user_profiles\.profession|user_profiles\.email/i);
  assert.doesNotMatch(sql, /from public\.(followers|following|messages|chat_messages|marketplace_orders|marketplace_order_items)/i);
  assert.doesNotMatch(sql, /create table (?:public|private)\.(?:interest|custom_audience|lookalike|ad_delivery|advertising_placement)/i);
  assert.doesNotMatch(sql, /financial_transactions|ledger_accounts|ledger_entries|wallet|escrow|stripe/i);
  assert.doesNotMatch(sql, /budget|\bspend\b|\bcpm\b|\bcpc\b|\bbid\b/i);
});

test("migration is one forward transaction and preserves B through D authority", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.equal((sql.match(/\bbegin;/gi) ?? []).length, 1);
  assert.equal((sql.match(/\bcommit;/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /drop table|drop function|alter table public\.marketplace_ad/i);
  assert.match(sql, /private\.advertising_ad_sets/i);
  assert.match(sql, /private\.advertising_ads/i);
});
