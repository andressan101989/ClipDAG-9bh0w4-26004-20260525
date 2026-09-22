import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const matches = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("_ads_v2_d_creative_moderation_foundation.sql"),
);
assert.equal(matches.length, 1, "ADS-V2-D must have exactly one migration");
const sql = readFileSync(join(migrationsDir, matches[0]), "utf8");

test("creates one logical Creative authority with database idempotency", () => {
  assert.match(sql, /create table private\.advertising_creatives/i);
  assert.match(sql, /ad_account_id uuid not null[\s\S]*references private\.ad_accounts\s*\(id\)/i);
  assert.match(sql, /status text not null default 'draft'/i);
  assert.match(sql, /unique\s*\(ad_account_id,\s*creation_idempotency_key\)/i);
  assert.match(sql, /advertising_creatives_archive_state_chk/i);
});

test("creates immutable, versioned image and video content", () => {
  const tableStart = sql.search(/create table private\.advertising_creative_versions/i);
  const tableEnd = sql.indexOf("create index advertising_creative_versions", tableStart);
  const table = sql.slice(tableStart, tableEnd);
  assert.match(sql, /create table private\.advertising_creative_versions/i);
  assert.match(sql, /version_number integer not null/i);
  assert.match(sql, /format text not null/i);
  assert.match(sql, /media_asset_id uuid[\s\S]*references public\.media_assets\s*\(id\)/i);
  assert.match(sql, /video_asset_id uuid[\s\S]*references public\.video_assets\s*\(id\)/i);
  assert.match(sql, /advertising_creative_versions_media_xor_chk/i);
  assert.match(sql, /content_fingerprint text not null/i);
  assert.match(sql, /unique\s*\(creative_id,\s*version_number\)/i);
  assert.doesNotMatch(table, /updated_at/i);
  assert.match(sql, /advertising_creative_versions_immutable/i);
  assert.match(sql, /advertising_creative_version_immutable/i);
});

test("reuses canonical Business Media without copying binaries or URLs", () => {
  const start = sql.search(/create or replace function private\.ads_validate_creative_payload/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /public\.media_assets/i);
  assert.match(body, /public\.video_assets/i);
  assert.match(body, /owner_id = p_actor/i);
  assert.match(body, /status = 'ready'/i);
  assert.match(body, /deleted_at is null/i);
  assert.match(body, /purpose = 'business_library'/i);
  assert.match(body, /provider = 'r2'/i);
  assert.match(body, /provider = 'cloudflare_stream'/i);
  assert.doesNotMatch(sql, /create table (?:public|private)\.(?:ad_media_assets|ad_video_assets)/i);
});

test("validates copy and computes immutable content fingerprint server-side", () => {
  assert.match(sql, /primary_text text[\s\S]*char_length\(primary_text\) between 1 and 2200/i);
  assert.match(sql, /headline text[\s\S]*char_length\(headline\) between 1 and 255/i);
  assert.match(sql, /description text[\s\S]*char_length\(description\) between 1 and 500/i);
  assert.match(sql, /call_to_action text not null default 'learn_more'/i);
  assert.match(sql, /private\.ads_content_fingerprint/i);
  assert.match(sql, /extensions\.digest/i);
});

test("creates atomic Creative version one and concurrency-safe later versions", () => {
  assert.match(sql, /create or replace function public\.create_my_advertising_creative\s*\(/i);
  assert.match(sql, /create or replace function public\.create_my_advertising_creative_version\s*\(/i);
  assert.match(sql, /private\.ads_actor_is_advertiser_age_eligible/i);
  assert.match(sql, /for update[\s\S]*coalesce\(max\(version_number\),\s*0\)\s*\+\s*1/i);
  assert.match(sql, /on conflict\s*\(ad_account_id,\s*creation_idempotency_key\)\s*do nothing/i);
  assert.match(sql, /advertising_creative_idempotency_conflict/i);
});

test("creates draft Ads with explicit review states and same-authority guard", () => {
  assert.match(sql, /create table private\.advertising_ads/i);
  assert.match(sql, /ad_set_id uuid not null[\s\S]*creative_version_id uuid not null[\s\S]*destination_id uuid not null/i);
  assert.match(sql, /review_status text not null default 'not_submitted'/i);
  for (const state of ["not_submitted", "pending", "approved", "rejected"]) {
    assert.match(sql, new RegExp(`'${state}'`, "i"));
  }
  assert.match(sql, /unique\s*\(ad_set_id,\s*creation_idempotency_key\)/i);
  assert.match(sql, /create trigger advertising_ads_same_authority/i);
  assert.match(sql, /advertising_ad_same_authority_invalid/i);
});

test("creates Ads only through the owned active adult draft path", () => {
  assert.match(sql, /create or replace function public\.create_my_advertising_ad_draft\s*\(/i);
  const start = sql.search(/create or replace function public\.create_my_advertising_ad_draft/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /private\.ads_actor_is_advertiser_age_eligible/i);
  assert.match(body, /private\.ads_require_owned_draft_campaign/i);
  assert.match(body, /ad_set\.status = 'draft'/i);
  assert.match(body, /destination\.status = 'draft'/i);
  assert.match(body, /creative\.status = 'draft'/i);
  assert.match(body, /'not_submitted'/i);
});

test("submits an exact server-fingerprinted assembly and preserves review identity", () => {
  assert.match(sql, /create or replace function private\.ads_ad_submission_fingerprint\s*\(/i);
  assert.match(sql, /creative_content_fingerprint/i);
  assert.match(sql, /destination_type/i);
  assert.match(sql, /objective/i);
  assert.match(sql, /create or replace function public\.submit_my_advertising_ad_for_review\s*\(/i);
  assert.match(sql, /review_status = 'pending'/i);
  assert.match(sql, /event_type[\s\S]*'submitted'/i);
  assert.match(sql, /advertising_ad_already_approved/i);
});

test("uses canonical Admin capabilities for read and moderation", () => {
  assert.match(sql, /create or replace function public\.search_admin_advertising_ads\s*\(/i);
  assert.match(sql, /public\.admin_require_capability\('content\.items\.read'\)/i);
  assert.match(sql, /create or replace function public\.admin_review_advertising_ad\s*\(/i);
  assert.match(sql, /public\.admin_require_capability\('content\.items\.moderate'\)/i);
  assert.match(sql, /p_action[\s\S]*'approve'[\s\S]*'reject'/i);
  assert.match(sql, /advertising_ad_submission_changed/i);
});

test("keeps append-only review history and requires bounded rejection reasons", () => {
  assert.match(sql, /create table private\.advertising_ad_review_events/i);
  assert.match(sql, /event_type text not null/i);
  assert.match(sql, /unique\s*\(ad_id,\s*idempotency_key\)/i);
  assert.match(sql, /advertising_ad_review_events_immutable/i);
  for (const reason of ["policy_violation", "misleading", "unsafe_destination", "prohibited_content", "restricted_content", "media_invalid", "copy_invalid", "other"]) {
    assert.match(sql, new RegExp(`'${reason}'`, "i"));
  }
  assert.match(sql, /reason_code is distinct from 'other' or note is not null/i);
});

test("advertiser projection never returns internal moderation note", () => {
  assert.match(sql, /create or replace function public\.get_my_advertising_creative_workspace\s*\(\)/i);
  const start = sql.search(/create or replace function public\.get_my_advertising_creative_workspace/i);
  const end = sql.indexOf("create or replace function", start + 40);
  const body = sql.slice(start, end < 0 ? sql.length : end);
  assert.match(body, /latest_rejection_reason_code/i);
  assert.match(body, /latest_rejection_message/i);
  assert.doesNotMatch(body, /'note'|internal_note/i);
});

test("hardens every new private table and exposes RPCs only to authenticated", () => {
  for (const table of ["advertising_creatives", "advertising_creative_versions", "advertising_ads", "advertising_ad_review_events"]) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_deny_clients[\\s\\S]*to anon, authenticated[\\s\\S]*using \\(false\\) with check \\(false\\)`, "i"));
    assert.match(sql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, "i"));
  }
  for (const fn of ["create_my_advertising_creative", "create_my_advertising_creative_version", "create_my_advertising_ad_draft", "submit_my_advertising_ad_for_review", "admin_review_advertising_ad", "search_admin_advertising_ads", "get_my_advertising_creative_workspace"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}`, "i"));
  }
});

test("all functions use an empty search path and internal helpers are not client executable", () => {
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.ok(functions.length >= 14);
  for (const fn of functions) assert.match(fn, /set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on function private\.ads_validate_creative_payload[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(sql, /revoke all on function private\.ads_ad_submission_fingerprint[\s\S]*from public, anon, authenticated, service_role/i);
});

test("does not duplicate scanners, Media, delivery, targeting, activation or finance", () => {
  assert.doesNotMatch(sql, /create table (?:public|private)\.(?:ads_ai_scans|ads_safety_rules|ads_visual_scanner|ads_text_scanner)/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) private\.content_safety_/i);
  assert.doesNotMatch(sql, /create or replace function public\.activate_.*advertising/i);
  assert.doesNotMatch(sql, /create table[\s\S]*\b(?:audience|targeting|placement|delivery|budget|wallet|ledger|escrow)\b/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from|alter table) public\.(?:financial_transactions|ledger_accounts|ledger_entries|marketplace_ad_|marketplace_order_ad_attribution)/i);
  assert.doesNotMatch(sql, /bdag-economy/i);
});

test("migration is one forward transaction and starts from B/C", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /ads_v2_c_foundation_required/i);
  assert.match(sql, /commit;\s*$/i);
});
