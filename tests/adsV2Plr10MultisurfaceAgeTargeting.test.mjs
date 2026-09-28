import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVERTISING_V2_PLACEMENTS,
  fetchAdvertisingV2CandidateWithInvoker,
  recordAdvertisingV2ImpressionWithInvoker,
} from "../services/advertisingDeliveryClient.mjs";
import {
  composeAdvertisingV2StorySequence,
  mixLiveDiscoveryAdvertisingV2,
  mixPlacementAdvertisingV2,
  selectMarketplaceSponsoredAuthority,
} from "../services/advertisingV2FeedRuntime.mjs";
import { executeAdsV2DeliveryAction } from "../supabase/functions/ads-v2-delivery/contract.mjs";

const viewer = "10000000-0000-4000-8000-000000000001";
const adId = "20000000-0000-4000-8000-000000000001";
const eventKey = "30000000-0000-4000-8000-000000000001";
const impressionId = "40000000-0000-4000-8000-000000000001";
const placements = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"];

test("the generic client sends each canonical placement and rejects unknown placement codes", async () => {
  assert.deepEqual([...ADVERTISING_V2_PLACEMENTS], placements);
  for (const placement of placements) {
    const calls = [];
    const invoke = async (slug, options) => {
      calls.push({ slug, options });
      return { data: { success: true, placement, ads: [] }, error: null };
    };
    assert.equal(await fetchAdvertisingV2CandidateWithInvoker(invoke, placement), null);
    assert.deepEqual(calls, [{
      slug: "ads-v2-delivery",
      options: { body: { action: "candidates", placement } },
    }]);
  }
  await assert.rejects(
    () => fetchAdvertisingV2CandidateWithInvoker(async () => ({ data: null, error: null }), "unknown"),
    /ads_v2_placement_invalid/,
  );
});

test("the generic impression client binds the actual surface without viewer or campaign authority", async () => {
  for (const placement of placements) {
    const calls = [];
    const invoke = async (slug, options) => {
      calls.push({ slug, options });
      return { data: { success: true, placement, impression: { event_id: impressionId } }, error: null };
    };
    assert.equal(await recordAdvertisingV2ImpressionWithInvoker(invoke, placement, adId, eventKey), impressionId);
    assert.deepEqual(calls[0].options.body, { action: "impression", placement, ad_id: adId, event_key: eventKey });
    for (const forbidden of ["viewer_user_id", "campaign_id", "destination_id"]) {
      assert.equal(Object.hasOwn(calls[0].options.body, forbidden), false);
    }
  }
});

test("the single Edge accepts all six placements and derives the viewer for candidates and impressions", async () => {
  for (const placement of placements) {
    const calls = [];
    const rpc = async (name, args) => {
      calls.push({ name, args });
      if (name === "fetch_advertising_delivery_candidates_v2") return { data: [{ ad_id: adId }], error: null };
      if (name === "get_advertising_delivery_render_payload_v2") return { data: { ad_id: adId }, error: null };
      return { data: { id: impressionId }, error: null };
    };
    const candidate = await executeAdsV2DeliveryAction({ action: "candidates", placement }, viewer, rpc);
    assert.deepEqual(candidate, { success: true, placement, ads: [{ ad_id: adId }] });
    assert.deepEqual(calls[0], {
      name: "fetch_advertising_delivery_candidates_v2",
      args: { p_placement_code: placement, p_viewer_user_id: viewer, p_limit: 1, p_at_time: null },
    });
    calls.length = 0;
    const impression = await executeAdsV2DeliveryAction({ action: "impression", placement, ad_id: adId, event_key: eventKey }, viewer, rpc);
    assert.deepEqual(impression, { success: true, placement, impression: { event_id: impressionId } });
    assert.deepEqual(calls[0], {
      name: "record_advertising_impression_v2",
      args: { p_ad_id: adId, p_placement_code: placement, p_viewer_user_id: viewer, p_event_key: eventKey },
    });
  }
});

test("the Edge rejects unknown placements and all client context overrides", async () => {
  const rpc = async () => ({ data: [], error: null });
  await assert.rejects(() => executeAdsV2DeliveryAction({ action: "candidates", placement: "profile" }, viewer, rpc), /placement_invalid/);
  for (const body of [
    { action: "candidates", placement: "clips", campaign_id: adId },
    { action: "candidates", placement: "clips", ad_id: adId },
    { action: "impression", placement: "clips", ad_id: adId, event_key: eventKey, viewer_user_id: viewer },
    { action: "impression", placement: "clips", ad_id: adId, event_key: eventKey, campaign_id: adId },
  ]) {
    await assert.rejects(() => executeAdsV2DeliveryAction(body, viewer, rpc), /override_denied/);
  }
});

test("feed arbitration inserts social and clips at bounded non-adjacent organic intervals", () => {
  const organic = Array.from({ length: 20 }, (_, index) => ({ kind: "organic", id: `organic-${index + 1}` }));
  const opportunities = [
    { placement: "social_feed", ad: { ad_id: "social" }, eventKey: "social-key", afterOrganic: 4 },
    { placement: "clips", ad: { ad_id: "clips" }, eventKey: "clips-key", afterOrganic: 12 },
  ];
  const mixed = mixPlacementAdvertisingV2(organic, opportunities);
  assert.deepEqual(mixed.filter((item) => item.kind === "advertising_v2").map((item) => item.placement), ["social_feed", "clips"]);
  assert.equal(mixed[4].placement, "social_feed");
  assert.equal(mixed[13].placement, "clips");
  assert.equal(mixed.some((item, index) => item.kind === "advertising_v2" && mixed[index + 1]?.kind === "advertising_v2"), false);
});

test("Stories keeps sponsored units separate from organic view and reply semantics", () => {
  const organic = [{ id: "story-1", storyKind: "media" }, { id: "story-2", storyKind: "shared" }];
  const opportunity = { placement: "stories", ad: { ad_id: adId }, eventKey };
  const sequence = composeAdvertisingV2StorySequence(organic, opportunity);
  assert.deepEqual(sequence.slice(0, 2), organic.map((story) => ({ kind: "organic_story", story })));
  assert.deepEqual(sequence[2], { kind: "advertising_v2", ...opportunity });
  assert.equal("story" in sequence[2], false);
});

test("LIVE discovery inserts one sponsored unit without changing active-broadcast semantics", () => {
  const streams = Array.from({ length: 6 }, (_, index) => ({ id: `stream-${index + 1}` }));
  const opportunity = { placement: "live", ad: { ad_id: adId }, eventKey };
  const mixed = mixLiveDiscoveryAdvertisingV2(streams, opportunity);
  assert.equal(mixed.filter((item) => item.kind === "advertising_v2").length, 1);
  assert.deepEqual(mixed.filter((item) => item.kind === "live_stream").map((item) => item.stream.id), streams.map((item) => item.id));
});

test("Marketplace chooses exactly one sponsored authority per opportunity", () => {
  const v2 = { placement: "marketplace_home", ad: { ad_id: adId }, eventKey };
  const legacy = [{ campaign_id: "legacy-1", product_id: "product-1" }];
  assert.deepEqual(selectMarketplaceSponsoredAuthority(v2, legacy), { authority: "ads_v2", opportunity: v2, legacy: [] });
  assert.deepEqual(selectMarketplaceSponsoredAuthority(null, legacy), { authority: "legacy", opportunity: null, legacy });
});
