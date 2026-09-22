import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const matches = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("_ads_v2_b_advertiser_identity_foundation.sql"),
);
assert.equal(matches.length, 1, "ADS-V2-B must have exactly one migration");
const sql = readFileSync(join(migrationsDir, matches[0]), "utf8");

test("creates one private Business Account authority", () => {
  assert.match(sql, /create table private\.business_accounts/i);
  assert.match(sql, /owner_user_id uuid not null[\s\S]*references public\.user_profiles\s*\(id\)/i);
  assert.match(sql, /display_name text not null/i);
  assert.match(sql, /status text not null default 'active'/i);
  assert.match(sql, /origin text not null/i);
  assert.match(sql, /creation_idempotency_key uuid/i);
  assert.doesNotMatch(sql, /unique\s*\(owner_user_id\)/i);
});

test("allows multiple Businesses per owner while protecting retry idempotency", () => {
  assert.match(sql, /business_accounts_owner_idempotency_uidx[\s\S]*owner_user_id\s*,\s*creation_idempotency_key[\s\S]*where creation_idempotency_key is not null/i);
  assert.match(sql, /on conflict\s*\(owner_user_id,\s*creation_idempotency_key\)[\s\S]*where creation_idempotency_key is not null[\s\S]*do nothing/i);
});

test("creates an optional one-seller-to-one-Business compatibility link", () => {
  assert.match(sql, /create table private\.business_account_marketplace_links/i);
  assert.match(sql, /business_account_id uuid not null[\s\S]*references private\.business_accounts\s*\(id\)/i);
  assert.match(sql, /marketplace_seller_user_id uuid not null[\s\S]*references public\.marketplace_sellers\s*\(user_id\)/i);
  assert.match(sql, /unique\s*\(marketplace_seller_user_id\)/i);
});

test("creates non-financial Ad Accounts with one default per Business", () => {
  assert.match(sql, /create table private\.ad_accounts/i);
  assert.match(sql, /business_account_id uuid not null[\s\S]*references private\.business_accounts\s*\(id\)/i);
  assert.match(sql, /billing_currency text not null default 'BDAG'/i);
  assert.match(sql, /created_by uuid not null[\s\S]*references public\.user_profiles\s*\(id\)/i);
  assert.match(sql, /ad_accounts_one_default_per_business_uidx[\s\S]*business_account_id[\s\S]*where is_default/i);
  assert.match(sql, /ad_accounts_created_by_idx[\s\S]*created_by/i);
  assert.doesNotMatch(sql, /ledger_account_id|escrow_id/i);
});

test("hardens all private authorities with FORCE RLS and deny-client policies", () => {
  for (const table of ["business_accounts", "business_account_marketplace_links", "ad_accounts"]) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_deny_clients[\\s\\S]*to anon, authenticated[\\s\\S]*using \\(false\\) with check \\(false\\)`, "i"));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, "i"));
  }
});

test("self-service creation is authenticated, atomic and seller independent", () => {
  assert.match(sql, /create or replace function public\.create_my_business_account\s*\(/i);
  const start = sql.search(/create or replace function public\.create_my_business_account/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /business_auth_required/i);
  assert.match(body, /advertiser_self_service/i);
  assert.match(body, /insert into private\.business_accounts/i);
  assert.match(body, /insert into private\.ad_accounts/i);
  assert.doesNotMatch(body, /marketplace_sellers|marketplace_stores|\bproducts\b/i);
});

test("read RPC is owner-safe and supports capability-scoped legacy members", () => {
  assert.match(sql, /create or replace function public\.get_my_advertiser_accounts\s*\(\)/i);
  const start = sql.search(/create or replace function public\.get_my_advertiser_accounts/i);
  const body = sql.slice(start);
  assert.match(body, /b\.owner_user_id = v_actor/i);
  assert.match(body, /private\.business_memberships/i);
  assert.match(body, /private\.business_membership_capabilities/i);
  assert.match(body, /business\.ads\.(read|manage)/i);
  assert.match(body, /marketplace_seller_user_id/i);
  assert.match(body, /billing_currency/i);
});

test("public RPC grants exclude anon and PUBLIC", () => {
  for (const signature of [
    "public\\.create_my_business_account\\(text, uuid\\)",
    "public\\.get_my_advertiser_accounts\\(\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature} from public, anon`, "i"));
    assert.match(sql, new RegExp(`grant execute on function ${signature} to authenticated`, "i"));
  }
});

test("every new function fixes an empty search path", () => {
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.ok(functions.length >= 5);
  for (const fn of functions) assert.match(fn, /set search_path\s*=\s*''/i);
});

test("approved seller provisioning and backfill are idempotent", () => {
  assert.match(sql, /private\.provision_marketplace_seller_business_account/i);
  assert.match(sql, /new\.status = 'approved'/i);
  assert.match(sql, /create trigger marketplace_sellers_provision_business_account/i);
  assert.match(sql, /from public\.marketplace_sellers[\s\S]*where status = 'approved'/i);
  assert.match(sql, /on conflict\s*\(marketplace_seller_user_id\) do nothing/i);
  assert.match(sql, /on conflict\s*\(business_account_id\)[\s\S]*where is_default[\s\S]*do nothing/i);
});

test("migration proves backfill and default-account invariants", () => {
  assert.match(sql, /advertiser_identity_link_count_mismatch/i);
  assert.match(sql, /advertiser_identity_default_account_mismatch/i);
  assert.match(sql, /advertiser_identity_duplicate_seller_link/i);
});

test("does not migrate or duplicate legacy Team authority", () => {
  assert.doesNotMatch(sql, /create table private\.business_account_(memberships|invitations)/i);
  assert.doesNotMatch(sql, /alter table private\.business_(memberships|membership_capabilities|invitations|invitation_capabilities|team_audit_events)/i);
  assert.doesNotMatch(sql, /create or replace function private\.business_(effective_capabilities|actor_has_capability|require_capability)/i);
  assert.doesNotMatch(sql, /create or replace function public\.get_my_business_access/i);
});

test("does not create Campaign V2 or revive legacy Ads authority", () => {
  assert.doesNotMatch(sql, /create table (?:public|private)\.(?:ad_campaigns|campaigns|ad_sets|creatives|audiences)/i);
  assert.doesNotMatch(sql, /bdag-economy|marketplace-ads/i);
});

test("does not touch Marketplace Ads delivery, events or attribution", () => {
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.marketplace_ad_/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.marketplace_order_ad_attribution/i);
});

test("does not touch finance or create monetary authority", () => {
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.(?:financial_transactions|ledger_accounts|ledger_entries)/i);
  assert.doesNotMatch(sql, /create table[\s\S]*(?:wallet|ledger|escrow)/i);
  assert.doesNotMatch(sql, /ledger_(?:debit|credit)|move_money|stripe/i);
});

test("migration is one forward transaction", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
});
