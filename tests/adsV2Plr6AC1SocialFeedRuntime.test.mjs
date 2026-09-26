import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migrationNames = () => readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_6a_c1_social_feed_runtime_wiring.sql"));

test("defines one service-only fail-closed delivery render projection", () => {
  assert.equal(migrationNames().length, 1);
  const sql = read(`supabase/migrations/${migrationNames()[0]}`);
  assert.match(sql, /create or replace function public\.get_advertising_delivery_render_payload_v2\s*\(/i);
  assert.match(sql, /private\.advertising_delivery_preflight_at\s*\(/i);
  assert.match(sql, /production_deliverable/i);
  assert.match(sql, /ad\.creative_version_id\s*=\s*version\.id|version\.id\s*=\s*ad\.creative_version_id/i);
  assert.match(sql, /ad\.destination_id\s*=\s*destination\.id|destination\.id\s*=\s*ad\.destination_id/i);
  assert.match(sql, /media\.status\s*=\s*'ready'/i);
  assert.match(sql, /video\.status\s*=\s*'ready'/i);
  assert.match(sql, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on function public\.get_advertising_delivery_render_payload_v2[^;]+from public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant execute on function public\.get_advertising_delivery_render_payload_v2[^;]+to service_role/i);
  assert.doesNotMatch(sql, /owner_user_id|ledger_account|financial_transaction|moderator|review.*note/i);
});

test("adds an authenticated Ads V2 delivery adapter without finance authority", () => {
  const index = read("supabase/functions/ads-v2-delivery/index.ts");
  const contract = read("supabase/functions/ads-v2-delivery/contract.mjs");
  const config = read("supabase/config.toml");
  assert.match(config, /\[functions\.ads-v2-delivery\][\s\S]*verify_jwt\s*=\s*true/i);
  assert.match(index, /\.\.\/_shared\/mediaAuth\.ts/);
  assert.match(index, /authenticatedUser\s*\(/);
  assert.match(index, /admin\s*\(/);
  assert.match(contract, /fetch_advertising_delivery_candidates_v2/);
  assert.match(contract, /get_advertising_delivery_render_payload_v2/);
  assert.match(contract, /record_advertising_impression_v2/);
  assert.doesNotMatch(`${index}\n${contract}`, /spend_advertising_campaign_budget_v2|fund_my_advertising|settle_advertising/i);
  assert.doesNotMatch(`${index}\n${contract}`, /console\.(?:log|error)\([^)]*(?:token|secret|service_role)/i);
});

test("wires a separate Ads V2 feed lane and preserves Marketplace Legacy", () => {
  const feed = read("app/(tabs)/index.tsx");
  const client = read("services/advertisingDeliveryService.ts");
  const clientCore = read("services/advertisingDeliveryClient.mjs");
  const runtime = read("services/advertisingV2FeedRuntime.mjs");
  const card = read("components/advertising/AdvertisingFeedCardV2.tsx");
  const nativeVideo = read("components/advertising/AdvertisingFeedVideoV2.native.tsx");
  assert.match(feed, /fetchAdvertisingV2SocialFeedCandidate/);
  assert.match(feed, /AdvertisingFeedCardV2/);
  assert.match(feed, /fetchSponsoredProducts\('social_feed'\)/);
  assert.match(feed, /SponsoredFeedCard/);
  assert.match(clientCore, /invoke\(["']ads-v2-delivery["']/);
  assert.doesNotMatch(`${client}\n${clientCore}`, /\.rpc\s*\(|service_role|viewer_user_id/);
  assert.match(runtime, /itemVisiblePercentThreshold:\s*50/);
  assert.match(runtime, /QUALIFIED_VIEW_MILLISECONDS\s*=\s*1000/);
  assert.match(runtime, /markMediaReady/);
  assert.match(card, /Patrocinado/);
  assert.match(card, /AdvertisingFeedVideoV2/);
  assert.match(nativeVideo, /contentType:\s*["']hls["']/);
  assert.match(nativeVideo, /readyToPlay/);
  assert.match(feed, /viewerUserId:\s*string/);
  assert.match(feed, /advertisingV2OpportunityForViewer\(advertisingV2Opportunity,\s*user\?\.id\)/);
  assert.match(feed, /setAdvertisingV2Opportunity\(null\)/);
  assert.doesNotMatch(`${feed}\n${client}\n${clientCore}\n${runtime}\n${card}\n${nativeVideo}`, /spend_advertising_campaign_budget_v2/);
});

test("does not revive the orphan generic Ads service", () => {
  assert.ok(existsSync(new URL("services/adService.ts", root)));
  const changedRuntime = [
    read("app/(tabs)/index.tsx"),
    read("services/advertisingDeliveryService.ts"),
    read("services/advertisingV2FeedRuntime.mjs"),
  ].join("\n");
  assert.doesNotMatch(changedRuntime, /from ["']@\/services\/adService["']/);
});
