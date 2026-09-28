import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  advertisingDestinationAction,
  recordAdvertisingV2VideoViewWithInvoker,
} from "../services/advertisingDeliveryClient.mjs";
import {
  createAdvertisingV2VideoQualificationController,
  createAdvertisingV2VideoViewController,
  navigateAdvertisingV2WithClick,
} from "../services/advertisingV2FeedRuntime.mjs";
import { executeAdsV2DeliveryAction } from "../supabase/functions/ads-v2-delivery/contract.mjs";

const root = new URL("../", import.meta.url);
const migrationNames = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_11_objective_runtime_measurement.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`supabase/migrations/${migrationNames[0]}`, root), "utf8")
  : "";
const businessApi = readFileSync(new URL("apps/business-web/src/lib/adsManagerApi.ts", root), "utf8");
const businessPage = readFileSync(new URL("apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", root), "utf8");
const destinationPanel = readFileSync(new URL("apps/business-web/src/components/ads/DestinationPanel.tsx", root), "utf8");
const analyticsPanel = readFileSync(new URL("apps/business-web/src/components/ads/OperationalTruthPanels.tsx", root), "utf8");
const chatScreen = readFileSync(new URL("app/chat/[userId].tsx", root), "utf8");
const videoNative = readFileSync(new URL("components/advertising/AdvertisingFeedVideoV2.native.tsx", root), "utf8");

const viewer = "10000000-0000-4000-8000-000000000001";
const impression = "20000000-0000-4000-8000-000000000001";
const eventKey = "30000000-0000-4000-8000-000000000001";
const interaction = "40000000-0000-4000-8000-000000000001";

test("PLR-11 has one forward objective-runtime migration and the exact ten-objective matrix", () => {
  assert.equal(migrationNames.length, 1);
  for (const row of [
    ["awareness", "impression", "impressions"],
    ["reach", "impression", "unique_reach"],
    ["traffic", "click", "clicks"],
    ["engagement", "click", "qualified_interactions"],
    ["video_views", "impression", "video_views"],
    ["profile_visits", "click", "profile_visits"],
    ["messages", "click", "message_starts"],
    ["app_promotion", "click", "app_store_opens"],
    ["marketplace_sales", "click", "attributed_conversions"],
  ]) {
    assert.match(migration, new RegExp(`'${row[0]}'[\\s\\S]{0,180}'${row[1]}'[\\s\\S]{0,180}'${row[2]}'`, "i"));
  }
  assert.match(migration, /'website_conversions'[\s\S]{0,180}'not_available'[\s\S]{0,180}false[\s\S]{0,180}null/i);
  assert.match(migration, /billing_runtime_ready and billable_event_type in \('impression','click'\)/i);
  assert.doesNotMatch(migration, /'supported',true,true,true,(?:true|false),'(?:video_view|destination_open|engagement|conversion)'/i);
});

test("destination and conversion authority are extended in place and remain server validated", () => {
  assert.match(migration, /drop constraint advertising_destinations_type_chk/i);
  assert.match(migration, /'nelyon_message'/i);
  assert.match(migration, /advertising_app_store_url_valid/i);
  assert.match(migration, /apps\[\.\]apple\[\.\]com/i);
  assert.match(migration, /play\[\.\]google\[\.\]com/i);
  assert.match(migration, /record_advertising_interaction_v2\s*\(/i);
  assert.match(migration, /profile_visit/i);
  assert.match(migration, /record_advertising_message_start_conversion_v2/i);
  assert.match(migration, /public[.]messages/i);
  assert.match(migration, /sender_id=v_actor/i);
  assert.match(migration, /viewer_user_id=v_actor/i);
  assert.match(migration, /recipient_id[\s\S]{0,160}target_user_id/i);
  assert.doesNotMatch(migration, /message[^\n]*(?:text|content)[^\n]*advertising_(?:conversions|attributions)/i);
});

test("canonical analytics expose objective-aware reach, video, profile, message and store-open truth", () => {
  for (const token of [
    "unique_reach", "video_views", "profile_visits", "message_starts",
    "app_store_opens", "objective_results", "objective_result_status",
  ]) assert.match(migration, new RegExp(token, "i"));
  assert.match(migration, /count\s*\(\s*distinct[\s\S]{0,120}viewer_user_id/i);
  assert.match(migration, /'website_conversions','not_available',false,false,false,false,null,null/i);
  assert.match(migration, /when v_primary_metric is null then 'not_applicable'/i);
});

test("Edge accepts video_view only through the parent-impression interaction contract", async () => {
  const calls = [];
  const result = await executeAdsV2DeliveryAction({
    action: "interaction",
    impression_event_id: impression,
    event_type: "video_view",
    event_key: eventKey,
  }, viewer, async (name, args) => {
    calls.push({ name, args });
    return { data: { id: interaction }, error: null };
  });
  assert.deepEqual(result, { success: true, interaction: { event_id: interaction } });
  assert.deepEqual(calls, [{
    name: "record_advertising_interaction_v2",
    args: {
      p_impression_event_id: impression,
      p_event_type: "video_view",
      p_event_key: eventKey,
      p_viewer_user_id: viewer,
    },
  }]);
  await assert.rejects(
    () => executeAdsV2DeliveryAction({ action: "interaction", impression_event_id: impression, event_type: "engagement", event_key: eventKey }, viewer, async () => ({ data: null, error: null })),
    /interaction_type_invalid/,
  );
});

test("client video_view contains no viewer, Campaign, Ad, placement or destination override", async () => {
  const calls = [];
  const value = await recordAdvertisingV2VideoViewWithInvoker(async (slug, options) => {
    calls.push({ slug, options });
    return { data: { success: true, interaction: { event_id: interaction } }, error: null };
  }, impression, eventKey);
  assert.equal(value, interaction);
  assert.deepEqual(calls[0], {
    slug: "ads-v2-delivery",
    options: { body: { action: "interaction", impression_event_id: impression, event_type: "video_view", event_key: eventKey } },
  });
});

test("video-view controller uses one stable key, one flight and confirmed-parent binding", async () => {
  const calls = [];
  const controller = createAdvertisingV2VideoViewController(async (parent, key) => {
    calls.push({ parent, key });
    return interaction;
  }, () => eventKey);
  const first = controller.submit("opportunity", impression);
  const second = controller.submit("opportunity", impression);
  assert.equal(first, second);
  assert.equal(await first, interaction);
  assert.equal(await controller.submit("opportunity", impression), interaction);
  assert.deepEqual(calls, [{ parent: impression, key: eventKey }]);
  await assert.rejects(() => controller.submit("opportunity", viewer), /ads_v2_video_view_parent_conflict/);
});

test("qualified video measurement requires ready, playing and >=50%-visible cumulative playback", () => {
  let qualified = 0;
  const controller = createAdvertisingV2VideoQualificationController(() => { qualified += 1; });
  controller.setReady(true);
  controller.setActive(true);
  controller.observeTime(0);
  controller.observeTime(1);
  assert.equal(qualified, 0, "not playing");
  controller.setPlaying(true);
  controller.setActive(false);
  controller.observeTime(1.25);
  controller.observeTime(2.25);
  assert.equal(qualified, 0, "below 50% visible");
  controller.setActive(true);
  controller.observeTime(3);
  controller.observeTime(4);
  controller.observeTime(5);
  assert.equal(qualified, 1, "two qualified seconds");
  controller.setActive(false);
  controller.setActive(true);
  controller.observeTime(5.5);
  controller.observeTime(6.5);
  assert.equal(qualified, 1, "reentry remains deduplicated");
});

test("short video completion qualifies once only while ready, playing and visible", () => {
  let qualified = 0;
  const controller = createAdvertisingV2VideoQualificationController(() => { qualified += 1; });
  controller.setDuration(1.5);
  controller.complete();
  assert.equal(qualified, 0);
  controller.setReady(true);
  controller.setPlaying(true);
  controller.setActive(true);
  controller.complete();
  controller.complete();
  assert.equal(qualified, 1);
});

test("destination-open analytics wait asynchronously for the click attempt without blocking navigation", async () => {
  const order = [];
  let releaseClick;
  const click = new Promise((resolve) => { releaseClick = resolve; });
  const operation = navigateAdvertisingV2WithClick({
    opportunityKey: "opportunity",
    impressionEventId: impression,
    submitClick: async () => { order.push("click-start"); await click; order.push("click-finish"); },
    navigate: async () => { order.push("navigate"); return true; },
    submitDestinationOpen: async () => { order.push("destination-open"); },
    scheduler: { setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {} },
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order.slice(0, 2), ["click-start", "navigate"]);
  releaseClick();
  await operation;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["click-start", "navigate", "click-finish", "destination-open"]);
});

test("message destinations use the canonical Chat route and preserve impression evidence", () => {
  const action = advertisingDestinationAction({
    destination_type: "nelyon_message",
    external_url: null,
    target_user_id: viewer,
    target_business_account_id: null,
    target_product_id: null,
    target_store_id: null,
  });
  assert.deepEqual(action, { kind: "route", pathname: "/chat/[userId]", id: viewer });
  assert.match(chatScreen, /advertisingImpressionEventId/);
  assert.match(chatScreen, /recordAdvertisingMessageStartConversion/);
  assert.match(readFileSync(new URL("services/chatService.ts", root), "utf8"), /conversion_id/);
});

test("native video qualification requires readiness, actual playback and two qualified seconds or short completion", () => {
  assert.match(videoNative, /playingChange/);
  assert.match(videoNative, /timeUpdate/);
  assert.match(videoNative, /playToEnd/);
  assert.match(videoNative, /isActive/);
  assert.match(videoNative, /readyToPlay/);
});

test("Business consumes objective metadata and exposes truthful objective destinations and analytics", () => {
  assert.match(businessApi, /primaryMetric/);
  assert.match(businessApi, /availabilityReason/);
  assert.match(businessPage, /Website conversion tracking is not configured yet/i);
  assert.match(destinationPanel, /nelyon_profile/);
  assert.match(destinationPanel, /nelyon_message/);
  assert.match(destinationPanel, /apps[.]apple[.]com/);
  assert.match(destinationPanel, /play[.]google[.]com/);
  assert.match(destinationPanel, /installs not measured/i);
  for (const label of ["Unique reach", "Profile visits", "Message starts", "App-store opens", "Objective results"]) {
    assert.match(analyticsPanel, new RegExp(label, "i"));
  }
});
