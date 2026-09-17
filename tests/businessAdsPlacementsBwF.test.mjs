import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260917125517_business_ads_placements_delivery_bw_f.sql", import.meta.url),
  "utf8",
);
const edge = readFileSync(new URL("../supabase/functions/marketplace-ads/index.ts", import.meta.url), "utf8");
const feed = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

test("BW-F adds one child placement table without a parallel campaign or finance authority", () => {
  assert.equal((migration.match(/create table public\./gi) ?? []).length, 1);
  assert.match(migration, /create table public\.marketplace_ad_campaign_placements/);
  assert.doesNotMatch(migration, /create table public\.marketplace_ad_campaigns/);
  assert.doesNotMatch(migration, /insert into public\.(financial_transactions|ledger_entries|marketplace_ad_financial_events)/i);
});

test("placement authority is forced-RLS and exposes only the three canonical surfaces", () => {
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.marketplace_ad_campaign_placements from public, anon, authenticated/);
  for (const surface of ["marketplace_home", "marketplace_search", "social_feed"]) {
    assert.match(migration, new RegExp(`'${surface}'`));
  }
  assert.doesNotMatch(migration, /'reels'|'live'|'stories'/i);
});

test("the single delivery and event authorities enforce placement membership", () => {
  assert.match(migration, /create or replace function public\.fetch_marketplace_sponsored_products_v2/);
  assert.match(migration, /create or replace function public\.record_marketplace_ad_event/);
  assert.match(migration, /placement\.campaign_id = c\.id\s+and placement\.surface = p_surface/);
  assert.match(migration, /marketplace_ad_placement_not_enabled/);
  assert.doesNotMatch(migration, /fetch_social_feed_ads|record_social_feed_ad_event/);
});

test("Edge rejects invalid surfaces and Feed keeps sponsored items outside FeedContext", () => {
  assert.match(edge, /invalid_surface/);
  assert.match(edge, /parseSponsoredSurface/);
  assert.match(feed, /mixSocialFeedSponsoredProducts\(videos, sponsoredProducts\)/);
  assert.doesNotMatch(feed, /addVideo\([^)]*sponsored/i);
});
