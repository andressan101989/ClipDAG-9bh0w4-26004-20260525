import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const matches = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("_ads_v2_c_general_campaign_authority.sql"),
);
assert.equal(matches.length, 1, "ADS-V2-C must have exactly one migration");
const sql = readFileSync(join(migrationsDir, matches[0]), "utf8");

test("creates one private draft-only general campaign authority", () => {
  assert.match(sql, /create table private\.advertising_campaigns/i);
  assert.match(sql, /ad_account_id uuid not null[\s\S]*references private\.ad_accounts\s*\(id\)/i);
  assert.match(sql, /objective text not null/i);
  assert.match(sql, /status text not null default 'draft'/i);
  assert.match(sql, /advertising_campaigns_objective_chk[\s\S]*awareness[\s\S]*marketplace_sales/i);
  assert.match(sql, /advertising_campaigns_status_chk[\s\S]*draft[\s\S]*archived/i);
  assert.doesNotMatch(sql, /create table (?:public|private)\.ad_campaigns/i);
  assert.doesNotMatch(sql, /\b(?:budget|spent|wallet|ledger_account|escrow|balance)\b/i);
});

test("campaign retries are database-idempotent", () => {
  assert.match(sql, /creation_idempotency_key uuid not null/i);
  assert.match(sql, /unique\s*\(ad_account_id,\s*creation_idempotency_key\)/i);
  assert.match(sql, /on conflict\s*\(ad_account_id,\s*creation_idempotency_key\)\s*do nothing/i);
});

test("creates draft-only Ad Sets with bounded schedule and idempotency", () => {
  assert.match(sql, /create table private\.advertising_ad_sets/i);
  assert.match(sql, /campaign_id uuid not null[\s\S]*references private\.advertising_campaigns\s*\(id\)/i);
  assert.match(sql, /advertising_ad_sets_status_chk[\s\S]*draft[\s\S]*archived/i);
  assert.match(sql, /advertising_ad_sets_schedule_chk[\s\S]*starts_at is null[\s\S]*ends_at is null[\s\S]*starts_at < ends_at/i);
  assert.match(sql, /unique\s*\(campaign_id,\s*creation_idempotency_key\)/i);
});

test("creates typed destinations with an exact XOR contract", () => {
  assert.match(sql, /create table private\.advertising_destinations/i);
  for (const type of ["external_url", "nelyon_profile", "business_account", "marketplace_product", "marketplace_store"]) {
    assert.match(sql, new RegExp(`'${type}'`, "i"));
  }
  assert.match(sql, /external_url text/i);
  assert.match(sql, /target_user_id uuid[\s\S]*references public\.user_profiles\s*\(id\)/i);
  assert.match(sql, /target_business_account_id uuid[\s\S]*references private\.business_accounts\s*\(id\)/i);
  assert.match(sql, /target_product_id uuid[\s\S]*references public\.products\s*\(id\)/i);
  assert.match(sql, /target_store_id uuid[\s\S]*references public\.marketplace_stores\s*\(id\)/i);
  assert.match(sql, /advertising_destinations_target_xor_chk/i);
  assert.match(sql, /\^https:\/\//i);
  assert.doesNotMatch(sql, /destination_data jsonb|target jsonb/i);
});

test("Ads age helper uses canonical private eligibility and fails closed", () => {
  assert.match(sql, /create or replace function private\.ads_actor_is_advertiser_age_eligible\s*\(/i);
  const start = sql.search(/create or replace function private\.ads_actor_is_advertiser_age_eligible/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /private\.user_age_eligibility/i);
  assert.match(body, /private\.age_eligibility_policy/i);
  assert.match(body, /e\.status = 'eligible'/i);
  assert.match(body, /e\.age_band = 'age_18_plus'/i);
  assert.match(body, /e\.policy_version = p\.policy_version/i);
  assert.match(body, /p\.creator_exclusive_minimum_age = 18/i);
  assert.match(body, /e\.evaluated_at is not null/i);
  assert.doesNotMatch(body, /date_of_birth|raw_user_meta_data|jwt/i);
});

test("campaign creation is authenticated, adult, active-owner and draft-only", () => {
  assert.match(sql, /create or replace function public\.create_my_advertising_campaign_draft\s*\(/i);
  const start = sql.search(/create or replace function public\.create_my_advertising_campaign_draft/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /private\.ads_actor_is_advertiser_age_eligible/i);
  assert.match(body, /private\.business_accounts/i);
  assert.match(body, /private\.ad_accounts/i);
  assert.match(body, /b\.owner_user_id = v_actor/i);
  assert.match(body, /b\.status = 'active'/i);
  assert.match(body, /a\.status = 'active'/i);
  assert.match(body, /'draft'/i);
  assert.doesNotMatch(body, /marketplace_sellers|marketplace_stores|\bproducts\b/i);
});

test("Ad Set and destination writes require an owned draft campaign", () => {
  assert.match(sql, /create or replace function private\.ads_require_owned_draft_campaign\s*\(/i);
  assert.match(sql, /create or replace function public\.create_my_advertising_ad_set_draft\s*\(/i);
  assert.match(sql, /create or replace function public\.create_my_advertising_destination_draft\s*\(/i);
  assert.match(sql, /campaign\.status = 'draft'/i);
});

test("Marketplace destinations require the canonical seller link and ownership", () => {
  const start = sql.search(/create or replace function public\.create_my_advertising_destination_draft/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /private\.business_account_marketplace_links/i);
  assert.match(body, /public\.marketplace_sellers/i);
  assert.match(body, /public\.products/i);
  assert.match(body, /public\.marketplace_stores/i);
  assert.match(body, /p\.seller_id = l\.marketplace_seller_user_id/i);
  assert.match(body, /s\.seller_id = l\.marketplace_seller_user_id/i);
});

test("compatibility reads label both authorities without operational copying", () => {
  assert.match(sql, /create or replace function public\.get_my_advertising_campaigns\s*\(\)/i);
  assert.match(sql, /create or replace function public\.get_my_advertising_campaign\s*\(/i);
  assert.match(sql, /'authority',\s*'ads_v2'/i);
  assert.match(sql, /'write_authority',\s*'ads_v2'/i);
  assert.match(sql, /'authority',\s*'marketplace_legacy'/i);
  assert.match(sql, /'write_authority',\s*'marketplace_legacy'/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.marketplace_ad_campaigns/i);
});

test("hardens every new private table and grants only authenticated RPC access", () => {
  for (const table of ["advertising_campaigns", "advertising_ad_sets", "advertising_destinations"]) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_deny_clients[\\s\\S]*to anon, authenticated[\\s\\S]*using \\(false\\) with check \\(false\\)`, "i"));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, "i"));
  }
  for (const signature of [
    "public\\.create_my_advertising_campaign_draft",
    "public\\.create_my_advertising_ad_set_draft",
    "public\\.create_my_advertising_destination_draft",
    "public\\.get_my_advertising_campaigns",
    "public\\.get_my_advertising_campaign",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature}[\\s\\S]*from public, anon, authenticated`, "i"));
  }
});

test("every new function fixes an empty search path", () => {
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.ok(functions.length >= 9);
  for (const fn of functions) assert.match(fn, /set search_path\s*=\s*''/i);
});

test("creates no activation, targeting, creative, delivery or finance authority", () => {
  assert.doesNotMatch(sql, /create or replace function public\.activate_.*advertising/i);
  assert.doesNotMatch(sql, /create table[\s\S]*\b(?:creative|audience|targeting|placement|delivery|conversion|attribution)\b/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.(?:financial_transactions|ledger_accounts|ledger_entries|marketplace_ad_)/i);
  assert.doesNotMatch(sql, /create table[\s\S]*\b(?:wallet|ledger|escrow)\b/i);
  assert.doesNotMatch(sql, /bdag-economy/i);
});

test("leaves ADS-V2-B and legacy Business contracts unchanged", () => {
  assert.doesNotMatch(sql, /create table private\.(?:business_accounts|ad_accounts|business_account_marketplace_links)/i);
  assert.doesNotMatch(sql, /create or replace function public\.(?:create_my_business_account|get_my_advertiser_accounts|get_my_business_access)/i);
  assert.doesNotMatch(sql, /create or replace function private\.business_effective_capabilities/i);
});

test("migration is one forward transaction", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
});
