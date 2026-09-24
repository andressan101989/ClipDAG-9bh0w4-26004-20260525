import assert from "node:assert/strict";
import test from "node:test";

const runtimeUrl = new URL("../services/advertisingV2FeedRuntime.mjs", import.meta.url);
const organic = (id) => ({ kind: "organic", video: { id }, organicIndex: Number(id) });
const legacy = (id) => ({ kind: "sponsored", product: { campaign_id: id }, position: 4 });
const ad = { ad_id: "10000000-0000-4000-8000-000000000001" };

test("never reuses a viewer-specific opportunity after auth switch or logout", async () => {
  const { advertisingV2OpportunityForViewer } = await import(runtimeUrl);
  const opportunity = { viewerUserId: "20000000-0000-4000-8000-000000000001", ad, eventKey: "70000000-0000-4000-8000-000000000001" };
  assert.equal(advertisingV2OpportunityForViewer(opportunity, opportunity.viewerUserId), opportunity);
  assert.equal(advertisingV2OpportunityForViewer(opportunity, "20000000-0000-4000-8000-000000000002"), null);
  assert.equal(advertisingV2OpportunityForViewer(opportunity, null), null);
  assert.equal(advertisingV2OpportunityForViewer(null, opportunity.viewerUserId), null);
});

test("inserts one V2 item after the fourth organic item without removing Legacy", async () => {
  const { mixSocialFeedAdvertisingV2 } = await import(runtimeUrl);
  const items = [organic("1"), organic("2"), organic("3"), organic("4"), legacy("legacy"), organic("5")];
  const mixed = mixSocialFeedAdvertisingV2(items, ad, "70000000-0000-4000-8000-000000000001");
  assert.deepEqual(mixed.map((item) => item.kind), ["organic", "organic", "organic", "organic", "advertising_v2", "sponsored", "organic"]);
  assert.equal(mixed.filter((item) => item.kind === "advertising_v2").length, 1);
  assert.equal(mixed.filter((item) => item.kind === "sponsored").length, 1);
});

test("appends after available organic items when fewer than four and never before the first", async () => {
  const { mixSocialFeedAdvertisingV2 } = await import(runtimeUrl);
  assert.deepEqual(mixSocialFeedAdvertisingV2([], ad, "70000000-0000-4000-8000-000000000001"), []);
  assert.deepEqual(mixSocialFeedAdvertisingV2([organic("1"), organic("2")], ad, "70000000-0000-4000-8000-000000000001").map((item) => item.kind), ["organic", "organic", "advertising_v2"]);
});

test("does not duplicate a V2 slot during pagination", async () => {
  const { mixSocialFeedAdvertisingV2 } = await import(runtimeUrl);
  const first = mixSocialFeedAdvertisingV2([organic("1"), organic("2"), organic("3"), organic("4")], ad, "70000000-0000-4000-8000-000000000001");
  const paginated = mixSocialFeedAdvertisingV2([...first, organic("5"), organic("6")], ad, "70000000-0000-4000-8000-000000000001");
  assert.equal(paginated.filter((item) => item.kind === "advertising_v2").length, 1);
});

test("uses 50 percent and 1000ms viewability and records one impression per mount", async () => {
  const { ADS_V2_VIEWABILITY_CONFIG, createAdvertisingV2ImpressionController } = await import(runtimeUrl);
  assert.deepEqual(ADS_V2_VIEWABILITY_CONFIG, { itemVisiblePercentThreshold: 50, minimumViewTime: 1000 });
  const calls = [];
  const controller = createAdvertisingV2ImpressionController(async (...args) => { calls.push(args); });
  const item = { kind: "advertising_v2", ad, eventKey: "70000000-0000-4000-8000-000000000001" };
  controller({ viewableItems: [{ isViewable: false, item }] });
  controller({ viewableItems: [{ isViewable: true, item }] });
  assert.equal(calls.length, 0);
  controller.markMediaReady(item.eventKey);
  controller({ viewableItems: [{ isViewable: true, item }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [[ad.ad_id, item.eventKey]]);
});

test("impression failure is contained and never retried in the same mount", async () => {
  const { createAdvertisingV2ImpressionController } = await import(runtimeUrl);
  let calls = 0;
  const controller = createAdvertisingV2ImpressionController(async () => { calls += 1; throw new Error("network"); });
  const item = { kind: "advertising_v2", ad, eventKey: "70000000-0000-4000-8000-000000000001" };
  controller.markMediaReady(item.eventKey);
  controller({ viewableItems: [{ isViewable: true, item }] });
  controller({ viewableItems: [{ isViewable: true, item }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("media readiness without current viewability does not record", async () => {
  const { createAdvertisingV2ImpressionController } = await import(runtimeUrl);
  let calls = 0;
  const controller = createAdvertisingV2ImpressionController(async () => { calls += 1; });
  const item = { kind: "advertising_v2", ad, eventKey: "70000000-0000-4000-8000-000000000001" };
  controller.markMediaReady(item.eventKey);
  controller({ viewableItems: [{ isViewable: false, item }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
