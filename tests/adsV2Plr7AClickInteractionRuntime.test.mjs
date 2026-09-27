import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const edgeUrl = new URL("../supabase/functions/ads-v2-delivery/contract.mjs", import.meta.url);
const clientUrl = new URL("../services/advertisingDeliveryClient.mjs", import.meta.url);
const runtimeUrl = new URL("../services/advertisingV2FeedRuntime.mjs", import.meta.url);

const viewer = "10000000-0000-4000-8000-000000000001";
const impressionId = "20000000-0000-4000-8000-000000000001";
const interactionId = "30000000-0000-4000-8000-000000000001";
const impressionKey = "40000000-0000-4000-8000-000000000001";
const clickKey = "50000000-0000-4000-8000-000000000001";
const adId = "60000000-0000-4000-8000-000000000001";

const interactionBody = {
  action: "interaction",
  impression_event_id: impressionId,
  event_type: "click",
  event_key: clickKey,
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeClock {
  now = 0;
  next = 1;
  timers = new Map();
  setTimeout = (callback, delay) => {
    const id = this.next++;
    this.timers.set(id, { callback, due: this.now + delay });
    return id;
  };
  clearTimeout = (id) => { this.timers.delete(id); };
  tick(milliseconds) {
    this.now += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.due <= this.now)
      .sort((left, right) => left[1].due - right[1].due);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("Edge records click through the viewer-bound canonical interaction RPC", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  const calls = [];
  const result = await executeAdsV2DeliveryAction(interactionBody, viewer, async (name, args) => {
    calls.push([name, args]);
    return { data: { id: interactionId }, error: null };
  });
  assert.deepEqual(calls, [["record_advertising_interaction_v2", {
    p_impression_event_id: impressionId,
    p_event_type: "click",
    p_event_key: clickKey,
    p_viewer_user_id: viewer,
  }]]);
  assert.deepEqual(result, { success: true, interaction: { event_id: interactionId } });
});

test("Edge rejects all client-supplied Ads authority overrides", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  const rpc = async () => ({ data: { id: interactionId }, error: null });
  const overrides = [
    ["viewer_user_id", viewer], ["viewerUserId", viewer], ["user_id", viewer],
    ["userId", viewer], ["p_viewer_user_id", viewer], ["campaign_id", adId],
    ["campaignId", adId], ["ad_id", adId], ["adId", adId],
    ["placement", "social_feed"], ["destination_id", adId], ["destinationId", adId],
  ];
  for (const [key, value] of overrides) {
    await assert.rejects(
      () => executeAdsV2DeliveryAction({ ...interactionBody, [key]: value }, viewer, rpc),
      /override_denied/,
      key,
    );
  }
});

test("Edge keeps video_view and engagement outside the interaction runtime", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  const rpc = async () => ({ data: { id: interactionId }, error: null });
  for (const eventType of ["video_view", "engagement"]) {
    await assert.rejects(
      () => executeAdsV2DeliveryAction({ ...interactionBody, event_type: eventType }, viewer, rpc),
      /interaction_type_invalid/,
      eventType,
    );
  }
});

test("Edge rejects malformed interaction identifiers and fails closed on RPC errors", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  await assert.rejects(
    () => executeAdsV2DeliveryAction({ ...interactionBody, impression_event_id: "bad" }, viewer, async () => ({ data: null, error: null })),
    /interaction_invalid/,
  );
  await assert.rejects(
    () => executeAdsV2DeliveryAction({ ...interactionBody, event_key: "bad" }, viewer, async () => ({ data: null, error: null })),
    /interaction_invalid/,
  );
  await assert.rejects(
    () => executeAdsV2DeliveryAction(interactionBody, viewer, async () => ({ data: null, error: { message: "private" } })),
    /delivery_unavailable/,
  );
});

test("client sends the exact click interaction envelope without viewer or placement", async () => {
  const client = await import(clientUrl);
  assert.equal(typeof client.recordAdvertisingV2SocialFeedClickWithInvoker, "function");
  const calls = [];
  const result = await client.recordAdvertisingV2SocialFeedClickWithInvoker(async (slug, options) => {
    calls.push([slug, options]);
    return { data: { success: true, interaction: { event_id: interactionId } }, error: null };
  }, impressionId, clickKey);
  assert.equal(result, interactionId);
  assert.deepEqual(calls, [["ads-v2-delivery", { body: interactionBody }]]);
  assert.doesNotMatch(JSON.stringify(calls), /viewer|user_id|campaign|ad_id|placement|destination/i);
});

test("confirmed impression ID remains available for its card opportunity", async () => {
  const runtime = await import(runtimeUrl);
  const clock = new FakeClock();
  const controller = runtime.createAdvertisingV2ImpressionController(
    async () => impressionId,
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  );
  controller.markMediaReady(impressionKey);
  controller({ viewableItems: [{ isViewable: true, item: { kind: "advertising_v2", eventKey: impressionKey, ad: { ad_id: adId } } }] });
  clock.tick(1000);
  await flush();
  assert.equal(controller.confirmedImpressionId(impressionKey), impressionId);
});

test("click controller is one-flight and stable across an uncertain retry", async () => {
  const runtime = await import(runtimeUrl);
  assert.equal(typeof runtime.createAdvertisingV2ClickController, "function");
  const calls = [];
  let attempt = 0;
  const controller = runtime.createAdvertisingV2ClickController(async (parent, key) => {
    calls.push([parent, key]);
    attempt += 1;
    if (attempt === 1) throw new Error("uncertain");
    return interactionId;
  }, () => clickKey);
  await assert.rejects(() => controller.submit(impressionKey, impressionId), /uncertain/);
  assert.equal(await controller.submit(impressionKey, impressionId), interactionId);
  assert.equal(await controller.submit(impressionKey, impressionId), interactionId);
  assert.deepEqual(calls, [[impressionId, clickKey], [impressionId, clickKey]]);
});

test("click controller coalesces simultaneous CTA submissions", async () => {
  const runtime = await import(runtimeUrl);
  const pending = deferred();
  let calls = 0;
  const controller = runtime.createAdvertisingV2ClickController(() => {
    calls += 1;
    return pending.promise;
  }, () => clickKey);
  const first = controller.submit(impressionKey, impressionId);
  const second = controller.submit(impressionKey, impressionId);
  await flush();
  assert.equal(calls, 1);
  pending.resolve(interactionId);
  assert.deepEqual(await Promise.all([first, second]), [interactionId, interactionId]);
});

test("CTA without confirmed impression navigates without fabricating analytics", async () => {
  const runtime = await import(runtimeUrl);
  let analytics = 0;
  let navigations = 0;
  await runtime.navigateAdvertisingV2WithClick({
    opportunityKey: impressionKey,
    impressionEventId: null,
    submitClick: async () => { analytics += 1; },
    navigate: () => { navigations += 1; },
  });
  assert.equal(analytics, 0);
  assert.equal(navigations, 1);
});

test("analytics failure never blocks CTA navigation", async () => {
  const runtime = await import(runtimeUrl);
  let navigations = 0;
  await runtime.navigateAdvertisingV2WithClick({
    opportunityKey: impressionKey,
    impressionEventId: impressionId,
    submitClick: async () => { throw new Error("offline"); },
    navigate: () => { navigations += 1; },
  });
  assert.equal(navigations, 1);
});

test("CTA waits at most 500ms for unresolved analytics", async () => {
  const runtime = await import(runtimeUrl);
  const clock = new FakeClock();
  let navigations = 0;
  const navigation = runtime.navigateAdvertisingV2WithClick({
    opportunityKey: impressionKey,
    impressionEventId: impressionId,
    submitClick: () => new Promise(() => {}),
    navigate: () => { navigations += 1; },
    scheduler: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  });
  clock.tick(499);
  await flush();
  assert.equal(navigations, 0);
  clock.tick(1);
  await navigation;
  assert.equal(navigations, 1);
});

test("safe destination behavior remains limited to http and https", async () => {
  const { advertisingDestinationAction } = await import(clientUrl);
  assert.deepEqual(
    advertisingDestinationAction({ destination_type: "external_url", external_url: "https://example.test", target_user_id: null, target_business_account_id: null, target_product_id: null, target_store_id: null }),
    { kind: "external", url: "https://example.test" },
  );
  assert.equal(
    advertisingDestinationAction({ destination_type: "external_url", external_url: "javascript:alert(1)", target_user_id: null, target_business_account_id: null, target_product_id: null, target_store_id: null }),
    null,
  );
});

test("Home Feed CTA uses the confirmed impression and canonical click controller", () => {
  const feed = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(feed, /recordAdvertisingV2SocialFeedClick/);
  assert.match(feed, /createAdvertisingV2ClickController/);
  assert.match(feed, /confirmedImpressionId\(item\.eventKey\)/);
  assert.match(feed, /navigateAdvertisingV2WithClick/);
  assert.match(feed, /openAdvertisingDestination\(item\)/);
});
