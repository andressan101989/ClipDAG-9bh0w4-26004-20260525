import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADS_V2_VIEWABILITY_CONFIG,
  advertisingV2OpportunityForViewer,
  createAdvertisingV2ImpressionController,
  loadAdvertisingV2Opportunity,
  mixSocialFeedAdvertisingV2,
} from "../services/advertisingV2FeedRuntime.mjs";
import {
  mixSocialFeedSponsoredProducts,
  socialFeedSponsoredProductRoute,
} from "../services/marketplaceSponsoredMix.ts";

const clientUrl = new URL("../services/advertisingDeliveryClient.mjs", import.meta.url);
const deliveryClient = () => import(clientUrl);

const AD_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_KEY = "70000000-0000-4000-8000-000000000001";
const VIEWER_ID = "20000000-0000-4000-8000-000000000001";

const validAd = {
  ad_id: AD_ID,
  advertiser: {
    business_account_id: "30000000-0000-4000-8000-000000000001",
    display_name: "Nelyon Motors",
  },
  creative: {
    format: "image",
    primary_text: "Drive forward",
    headline: "Future motion",
    description: "A complete projected description",
    call_to_action: "learn_more",
    media: {
      kind: "image",
      url: "https://cdn.example.com/ad.jpg",
      thumbnail_url: null,
    },
  },
  destination: {
    destination_type: "external_url",
    external_url: "https://example.com/tesla",
    target_user_id: null,
    target_business_account_id: null,
    target_product_id: null,
    target_store_id: null,
  },
};

const organic = (id) => ({ kind: "organic", video: { id }, organicIndex: Number(id) });
const legacy = (id, position = 4) => ({
  kind: "sponsored",
  product: { campaign_id: id, product_id: `product-${id}` },
  position,
});
const adsV2Item = (eventKey = EVENT_KEY) => ({
  kind: "advertising_v2",
  ad: validAd,
  eventKey,
});

function successfulCandidateInvoker(ads = [validAd]) {
  const calls = [];
  return {
    calls,
    invoke: async (...args) => {
      calls.push(args);
      return { data: { success: true, placement: "social_feed", ads }, error: null };
    },
  };
}

function successfulImpressionInvoker() {
  const calls = [];
  return {
    calls,
    invoke: async (...args) => {
      calls.push(args);
      return { data: { success: true, impression: { event_id: EVENT_KEY } }, error: null };
    },
  };
}

class FakeClock {
  #now = 0;
  #nextId = 1;
  #timers = new Map();

  setTimeout = (callback, delay) => {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + delay, callback });
    return id;
  };

  clearTimeout = (id) => {
    this.#timers.delete(id);
  };

  tick(milliseconds) {
    const target = this.#now + milliseconds;
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.#timers.delete(next[0]);
      this.#now = next[1].at;
      next[1].callback();
    }
    this.#now = target;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const visible = (controller, item) => controller({ viewableItems: [{ isViewable: true, item }] });
const hidden = (controller) => controller({ viewableItems: [] });

function impressionHarness(recordImpression = async () => EVENT_KEY) {
  const clock = new FakeClock();
  const calls = [];
  const controller = createAdvertisingV2ImpressionController(
    async (...args) => {
      calls.push(args);
      return recordImpression(...args);
    },
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  );
  return { calls, clock, controller };
}

// A. DELIVERY CLIENT
test("A1 invokes the exact ads-v2-delivery Edge slug", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const transport = successfulCandidateInvoker();
  await fetchAdvertisingV2SocialFeedCandidateWithInvoker(transport.invoke);
  assert.equal(transport.calls[0][0], "ads-v2-delivery");
});

test("A2 candidates request sends the exact candidates action", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const transport = successfulCandidateInvoker();
  await fetchAdvertisingV2SocialFeedCandidateWithInvoker(transport.invoke);
  assert.equal(transport.calls[0][1].body.action, "candidates");
});

test("A3 candidates request sends social_feed", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const transport = successfulCandidateInvoker();
  await fetchAdvertisingV2SocialFeedCandidateWithInvoker(transport.invoke);
  assert.equal(transport.calls[0][1].body.placement, "social_feed");
});

test("A4 candidates request never sends a viewer override", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const transport = successfulCandidateInvoker();
  await fetchAdvertisingV2SocialFeedCandidateWithInvoker(transport.invoke);
  const serialized = JSON.stringify(transport.calls[0][1].body);
  assert.doesNotMatch(serialized, /viewer|user_id|userId/i);
});

test("A5 candidates request never sends a client limit", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const transport = successfulCandidateInvoker();
  await fetchAdvertisingV2SocialFeedCandidateWithInvoker(transport.invoke);
  assert.equal(Object.hasOwn(transport.calls[0][1].body, "limit"), false);
});

test("A6 candidates response retains at most one valid ad", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const second = { ...validAd, ad_id: "10000000-0000-4000-8000-000000000002" };
  const result = await fetchAdvertisingV2SocialFeedCandidateWithInvoker(
    successfulCandidateInvoker([validAd, second]).invoke,
  );
  assert.equal(result.ad_id, AD_ID);
});

test("A7 empty candidates are safe", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  assert.equal(await fetchAdvertisingV2SocialFeedCandidateWithInvoker(successfulCandidateInvoker([]).invoke), null);
});

test("A8 a 401 leaves the Feed without an Ads V2 opportunity", async () => {
  const result = await loadAdvertisingV2Opportunity(
    VIEWER_ID,
    async () => { throw Object.assign(new Error("unauthorized"), { status: 401 }); },
    () => EVENT_KEY,
  );
  assert.equal(result, null);
});

test("A9 a network failure leaves the Feed unchanged", async () => {
  const result = await loadAdvertisingV2Opportunity(
    VIEWER_ID,
    async () => { throw new Error("network"); },
    () => EVENT_KEY,
  );
  const base = [organic("1"), organic("2"), organic("3"), organic("4")];
  assert.equal(result, null);
  assert.equal(mixSocialFeedAdvertisingV2(base, result?.ad, result?.eventKey), base);
});

test("A10 malformed candidates fail closed", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const malformed = async () => ({ data: { success: true, placement: "social_feed", ads: [{ ad_id: "bad" }] }, error: null });
  await assert.rejects(() => fetchAdvertisingV2SocialFeedCandidateWithInvoker(malformed), /ads_v2_payload_invalid/);
});

// B. IMPRESSION CLIENT
test("B11 impression request sends the exact impression action", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.equal(transport.calls[0][1].body.action, "impression");
});

test("B12 impression request sends the ad id", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.equal(transport.calls[0][1].body.ad_id, AD_ID);
});

test("B13 impression request sends one stable UUID event key", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.deepEqual(Object.keys(transport.calls[0][1].body).sort(), ["action", "ad_id", "event_key"]);
  assert.equal(transport.calls[0][1].body.event_key, EVENT_KEY);
});

test("B14 impression request never sends placement", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.equal(Object.hasOwn(transport.calls[0][1].body, "placement"), false);
});

test("B15 impression request never sends viewer identity", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.doesNotMatch(JSON.stringify(transport.calls[0][1].body), /viewer|user_id|userId/i);
});

test("B16 an uncertain retry reuses the same event key", async () => {
  let attempts = 0;
  const { calls, clock, controller } = impressionHarness(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("uncertain");
    return EVENT_KEY;
  });
  const item = adsV2Item();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, item);
  clock.tick(1000);
  await flush();
  hidden(controller);
  visible(controller, item);
  clock.tick(1000);
  await flush();
  assert.deepEqual(calls, [[AD_ID, EVENT_KEY], [AD_ID, EVENT_KEY]]);
});

test("B17 the Ads V2 client emits no click or conversion request", async () => {
  const { recordAdvertisingV2SocialFeedImpressionWithInvoker } = await deliveryClient();
  const transport = successfulImpressionInvoker();
  await recordAdvertisingV2SocialFeedImpressionWithInvoker(transport.invoke, AD_ID, EVENT_KEY);
  assert.deepEqual(transport.calls.map(([, options]) => options.body.action), ["impression"]);
});

// C. FEED INSERTION
test("C18 no Ads V2 candidate leaves the existing Feed unchanged", () => {
  const base = [organic("1"), organic("2"), organic("3"), organic("4"), legacy("legacy-a")];
  assert.equal(mixSocialFeedAdvertisingV2(base, null, null), base);
});

test("C19 Ads V2 consumes the first sponsored slot after four organic items", () => {
  const base = [organic("1"), organic("2"), organic("3"), organic("4"), legacy("legacy-a"), organic("5")];
  assert.deepEqual(
    mixSocialFeedAdvertisingV2(base, validAd, EVENT_KEY).map((item) => item.kind),
    ["organic", "organic", "organic", "organic", "advertising_v2", "organic"],
  );
});

test("C20 fewer than four organic items append Ads V2 after available organic", () => {
  assert.deepEqual(
    mixSocialFeedAdvertisingV2([organic("1"), organic("2")], validAd, EVENT_KEY).map((item) => item.kind),
    ["organic", "organic", "advertising_v2"],
  );
});

test("C21 a Feed mount retains at most one Ads V2 item", () => {
  const once = mixSocialFeedAdvertisingV2([organic("1"), organic("2"), organic("3"), organic("4")], validAd, EVENT_KEY);
  const twice = mixSocialFeedAdvertisingV2(once, { ...validAd, ad_id: "10000000-0000-4000-8000-000000000002" }, "70000000-0000-4000-8000-000000000002");
  assert.equal(twice.filter((item) => item.kind === "advertising_v2").length, 1);
  assert.equal(twice.find((item) => item.kind === "advertising_v2").ad.ad_id, AD_ID);
});

test("C22 pagination does not duplicate or move the Ads V2 opportunity", () => {
  const first = mixSocialFeedAdvertisingV2([organic("1"), organic("2"), organic("3"), organic("4")], validAd, EVENT_KEY);
  const firstIndex = first.findIndex((item) => item.kind === "advertising_v2");
  const paginated = mixSocialFeedAdvertisingV2([...first, organic("5"), organic("6")], validAd, EVENT_KEY);
  assert.equal(paginated.filter((item) => item.kind === "advertising_v2").length, 1);
  assert.equal(paginated.findIndex((item) => item.kind === "advertising_v2"), firstIndex);
});

test("C23 arbitration never creates adjacent advertising cards", () => {
  const legacyFeed = mixSocialFeedSponsoredProducts(
    Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1) })),
    [
      { campaign_id: "legacy-a", product_id: "product-a" },
      { campaign_id: "legacy-b", product_id: "product-b" },
      { campaign_id: "legacy-c", product_id: "product-c" },
    ],
  );
  const mixed = mixSocialFeedAdvertisingV2(legacyFeed, validAd, EVENT_KEY);
  assert.equal(mixed.some((item, index) => item.kind !== "organic" && mixed[index + 1]?.kind !== "organic"), false);
});

test("C24 Marketplace Legacy still fills later sponsored slots", () => {
  const legacyFeed = mixSocialFeedSponsoredProducts(
    Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1) })),
    [
      { campaign_id: "legacy-a", product_id: "product-a" },
      { campaign_id: "legacy-b", product_id: "product-b" },
      { campaign_id: "legacy-c", product_id: "product-c" },
    ],
  );
  const mixed = mixSocialFeedAdvertisingV2(legacyFeed, validAd, EVENT_KEY);
  assert.deepEqual(
    mixed.filter((item) => item.kind === "sponsored").map((item) => item.product.campaign_id),
    ["legacy-b", "legacy-c"],
  );
});

test("C25 Ads V2 owns the first sponsored opportunity", () => {
  const mixed = mixSocialFeedAdvertisingV2(
    [organic("1"), organic("2"), organic("3"), organic("4"), legacy("legacy-a")],
    validAd,
    EVENT_KEY,
  );
  assert.equal(mixed.find((item) => item.kind !== "organic").kind, "advertising_v2");
});

test("C26 Ads V2 arbitration does not increase existing sponsored density", () => {
  const base = [organic("1"), organic("2"), organic("3"), organic("4"), legacy("legacy-a"), organic("5")];
  const before = base.filter((item) => item.kind !== "organic").length;
  const after = mixSocialFeedAdvertisingV2(base, validAd, EVENT_KEY).filter((item) => item.kind !== "organic").length;
  assert.equal(after, before);
});

// D. VIEWABILITY
test("D27 candidate fetch alone never records an impression", async () => {
  const { calls } = impressionHarness();
  await flush();
  assert.equal(calls.length, 0);
});

test("D28 Feed mount alone never records an impression", async () => {
  const { calls, clock, controller } = impressionHarness();
  visible(controller, adsV2Item());
  clock.tick(5000);
  await flush();
  assert.equal(calls.length, 0);
});

test("D29 rendering the typed item never records an impression", async () => {
  const { calls } = impressionHarness();
  const item = adsV2Item();
  assert.equal(item.kind, "advertising_v2");
  await flush();
  assert.equal(calls.length, 0);
});

test("D30 media readiness alone never records an impression", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  clock.tick(5000);
  await flush();
  assert.equal(calls.length, 0);
});

test("D31 below-threshold viewability never records an impression", async () => {
  assert.deepEqual(ADS_V2_VIEWABILITY_CONFIG, { itemVisiblePercentThreshold: 50 });
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  controller({ viewableItems: [{ isViewable: false, item: adsV2Item() }] });
  clock.tick(5000);
  await flush();
  assert.equal(calls.length, 0);
});

test("D32 qualified visibility shorter than 1000ms never records", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(999);
  hidden(controller);
  clock.tick(1);
  await flush();
  assert.equal(calls.length, 0);
});

test("D33 50 percent for 1000ms with ready media records exactly once", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(1000);
  await flush();
  assert.deepEqual(calls, [[AD_ID, EVENT_KEY]]);
});

test("D34 visibility loss cancels a pending qualification", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(600);
  hidden(controller);
  clock.tick(1000);
  await flush();
  assert.equal(calls.length, 0);
});

test("D35 repeated visible callbacks do not duplicate qualification", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(500);
  visible(controller, adsV2Item());
  clock.tick(500);
  await flush();
  assert.deepEqual(calls, [[AD_ID, EVENT_KEY]]);
});

test("D36 viewport re-entry after confirmation never duplicates", async () => {
  const { calls, clock, controller } = impressionHarness();
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(1000);
  await flush();
  hidden(controller);
  visible(controller, adsV2Item());
  clock.tick(5000);
  await flush();
  assert.equal(calls.length, 1);
});

test("D37 uncertain transport waits for re-entry and keeps the same key", async () => {
  let attempts = 0;
  const { calls, clock, controller } = impressionHarness(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("uncertain");
    return EVENT_KEY;
  });
  controller.markMediaReady(EVENT_KEY);
  visible(controller, adsV2Item());
  clock.tick(1000);
  await flush();
  visible(controller, adsV2Item());
  clock.tick(5000);
  await flush();
  assert.equal(calls.length, 1);
  hidden(controller);
  visible(controller, adsV2Item());
  clock.tick(1000);
  await flush();
  assert.deepEqual(calls.map((call) => call[1]), [EVENT_KEY, EVENT_KEY]);
});

test("D38 media becoming ready while visible starts a fresh full qualification", async () => {
  const { calls, clock, controller } = impressionHarness();
  visible(controller, adsV2Item());
  clock.tick(900);
  controller.markMediaReady(EVENT_KEY);
  clock.tick(999);
  assert.equal(calls.length, 0);
  clock.tick(1);
  await flush();
  assert.deepEqual(calls, [[AD_ID, EVENT_KEY]]);

  const nativeVideo = readFileSync(
    new URL("../components/advertising/AdvertisingFeedVideoV2.native.tsx", import.meta.url),
    "utf8",
  );
  const webVideo = readFileSync(
    new URL("../components/advertising/AdvertisingFeedVideoV2.tsx", import.meta.url),
    "utf8",
  );
  assert.match(nativeVideo, /status\s*===\s*["']readyToPlay["']/);
  assert.doesNotMatch(nativeVideo, /<Image[^>]+onLoad=\{onReady\}/s);
  assert.doesNotMatch(webVideo, /<Image[^>]+onLoad=\{onReady\}/s);
});

// E. REGRESSIONS
test("E39 arbitration preserves organic object identity and order", () => {
  const organics = [organic("1"), organic("2"), organic("3"), organic("4"), organic("5")];
  const mixed = mixSocialFeedAdvertisingV2(organics, validAd, EVENT_KEY);
  assert.deepEqual(mixed.filter((item) => item.kind === "organic"), organics);
});

test("E40 organic active indexes remain attached to the same videos", () => {
  const organics = [organic("1"), organic("2"), organic("3"), organic("4"), organic("5")];
  const mixed = mixSocialFeedAdvertisingV2(organics, validAd, EVENT_KEY);
  assert.deepEqual(
    mixed.filter((item) => item.kind === "organic").map((item) => [item.video.id, item.organicIndex]),
    [["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5]],
  );
});

test("E41 Marketplace Legacy attribution data remains intact", () => {
  const product = { campaign_id: "legacy-b", product_id: "product-b" };
  assert.deepEqual(socialFeedSponsoredProductRoute(product), {
    id: "product-b",
    source: "ad",
    campaignId: "legacy-b",
    sourceSurface: "social_feed",
  });
});

test("E42 unauthenticated Feed resolves without Ads V2", async () => {
  let fetched = false;
  const opportunity = await loadAdvertisingV2Opportunity(
    null,
    async () => { fetched = true; return validAd; },
    () => EVENT_KEY,
  );
  assert.equal(opportunity, null);
  assert.equal(fetched, false);
  assert.equal(advertisingV2OpportunityForViewer(opportunity, null), null);
});

test("E43 disabled or empty delivery produces no Ads V2 item", async () => {
  const { fetchAdvertisingV2SocialFeedCandidateWithInvoker } = await deliveryClient();
  const candidate = await fetchAdvertisingV2SocialFeedCandidateWithInvoker(successfulCandidateInvoker([]).invoke);
  const base = [organic("1"), organic("2"), organic("3"), organic("4")];
  assert.equal(candidate, null);
  assert.equal(mixSocialFeedAdvertisingV2(base, candidate, EVENT_KEY), base);
});
