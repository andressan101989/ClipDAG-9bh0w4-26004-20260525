import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const edgeUrl = new URL("../supabase/functions/ads-v2-delivery/contract.mjs", import.meta.url);
const clientUrl = new URL("../services/advertisingDeliveryClient.mjs", import.meta.url);
const runtimeUrl = new URL("../services/advertisingV2FeedRuntime.mjs", import.meta.url);

const viewer = "10000000-0000-4000-8000-000000000001";
const impressionId = "20000000-0000-4000-8000-000000000001";
const interactionId = "30000000-0000-4000-8000-000000000001";
const destinationKey = "40000000-0000-4000-8000-000000000001";
const opportunityKey = "50000000-0000-4000-8000-000000000001";

const destinationBody = {
  action: "interaction",
  impression_event_id: impressionId,
  event_type: "destination_open",
  event_key: destinationKey,
};

test("Edge exposes destination_open through the existing viewer-bound interaction authority", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  const calls = [];
  const result = await executeAdsV2DeliveryAction(destinationBody, viewer, async (name, args) => {
    calls.push([name, args]);
    return { data: { id: interactionId }, error: null };
  });
  assert.deepEqual(calls, [["record_advertising_interaction_v2", {
    p_impression_event_id: impressionId,
    p_event_type: "destination_open",
    p_event_key: destinationKey,
    p_viewer_user_id: viewer,
  }]]);
  assert.deepEqual(result, { success: true, interaction: { event_id: interactionId } });
});

test("Edge still rejects viewer/context overrides and unsupported interaction types", async () => {
  const { executeAdsV2DeliveryAction } = await import(edgeUrl);
  const rpc = async () => ({ data: { id: interactionId }, error: null });
  for (const [key, value] of [
    ["viewer_user_id", viewer], ["campaign_id", viewer], ["ad_id", viewer],
    ["placement", "social_feed"], ["destination_id", viewer],
  ]) {
    await assert.rejects(
      () => executeAdsV2DeliveryAction({ ...destinationBody, [key]: value }, viewer, rpc),
      /override_denied/,
    );
  }
  await executeAdsV2DeliveryAction({ ...destinationBody, event_type: "video_view" }, viewer, rpc);
  await assert.rejects(
    () => executeAdsV2DeliveryAction({ ...destinationBody, event_type: "engagement" }, viewer, rpc),
    /interaction_type_invalid/,
  );
});

test("client sends destination_open without viewer, campaign, ad, placement, or destination authority", async () => {
  const client = await import(clientUrl);
  const calls = [];
  const result = await client.recordAdvertisingV2SocialFeedDestinationOpenWithInvoker(
    async (slug, options) => {
      calls.push([slug, options]);
      return { data: { success: true, interaction: { event_id: interactionId } }, error: null };
    },
    impressionId,
    destinationKey,
  );
  assert.equal(result, interactionId);
  assert.deepEqual(calls, [["ads-v2-delivery", { body: destinationBody }]]);
  assert.doesNotMatch(JSON.stringify(calls), /viewer|user_id|campaign|ad_id|placement|destination_id/i);
});

test("Marketplace destinations resolve only to the existing canonical Product and Store routes", async () => {
  const client = await import(clientUrl);
  const productId = "60000000-0000-4000-8000-000000000001";
  const storeId = "70000000-0000-4000-8000-000000000001";
  assert.deepEqual(client.advertisingDestinationAction({
    destination_type: "marketplace_product",
    target_product_id: productId,
  }), { kind: "route", pathname: "/product/[id]", id: productId });
  assert.deepEqual(client.advertisingDestinationAction({
    destination_type: "marketplace_store",
    target_store_id: storeId,
  }), { kind: "route", pathname: "/store/[id]", id: storeId });
  assert.equal(client.advertisingDestinationAction({ destination_type: "marketplace_product" }), null);
  assert.equal(client.advertisingDestinationAction({ destination_type: "marketplace_store" }), null);
});

test("destination controller is one-flight, idempotent after confirmation, and stable on retry", async () => {
  const runtime = await import(runtimeUrl);
  const calls = [];
  let attempt = 0;
  const controller = runtime.createAdvertisingV2DestinationOpenController(async (parent, key) => {
    calls.push([parent, key]);
    attempt += 1;
    if (attempt === 1) throw new Error("uncertain");
    return interactionId;
  }, () => destinationKey);
  await assert.rejects(() => controller.submit(opportunityKey, impressionId), /uncertain/);
  assert.equal(await controller.submit(opportunityKey, impressionId), interactionId);
  assert.equal(await controller.submit(opportunityKey, impressionId), interactionId);
  assert.deepEqual(calls, [[impressionId, destinationKey], [impressionId, destinationKey]]);
});

test("successful navigation dispatch records destination_open after navigation", async () => {
  const runtime = await import(runtimeUrl);
  const order = [];
  await runtime.navigateAdvertisingV2WithClick({
    opportunityKey,
    impressionEventId: impressionId,
    submitClick: async () => { order.push("click"); return interactionId; },
    navigate: async () => { order.push("navigate"); return true; },
    submitDestinationOpen: async () => { order.push("destination_open"); return interactionId; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["click", "navigate", "destination_open"]);
});

test("failed navigation records no destination_open and analytics never blocks navigation", async () => {
  const runtime = await import(runtimeUrl);
  let opened = 0;
  await runtime.navigateAdvertisingV2WithClick({
    opportunityKey,
    impressionEventId: impressionId,
    submitClick: async () => { throw new Error("offline"); },
    navigate: async () => false,
    submitDestinationOpen: async () => { opened += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 0);
});

test("navigation without a confirmed impression fabricates neither click nor destination_open", async () => {
  const runtime = await import(runtimeUrl);
  const analytics = [];
  let navigations = 0;
  await runtime.navigateAdvertisingV2WithClick({
    opportunityKey,
    impressionEventId: null,
    submitClick: async () => analytics.push("click"),
    navigate: async () => { navigations += 1; return true; },
    submitDestinationOpen: async () => analytics.push("destination_open"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(navigations, 1);
  assert.deepEqual(analytics, []);
});

test("PLR-8 migration establishes a cutover cursor, canonical reconciler, ACL, and one cron job", () => {
  const names = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((name) => name.endsWith("_ads_v2_plr_8_full_funnel_marketplace_attribution.sql"));
  assert.equal(names.length, 1);
  const sql = readFileSync(new URL(`../supabase/migrations/${names[0]}`, import.meta.url), "utf8");
  for (const token of [
    "marketplace_purchase_conversion_enabled",
    "marketplace_purchase_conversion_started_at",
    "marketplace_purchase_conversion_cursor_confirmed_at",
    "marketplace_purchase_conversion_cursor_order_item_id",
    "reconcile_advertising_marketplace_purchase_conversions_v2",
    "record_advertising_marketplace_purchase_conversion_v2",
    "line_total",
    "last_click_then_impression",
    "cron.schedule",
  ]) assert.match(sql, new RegExp(token, "i"), token);
  assert.match(sql, /confirmed_at\s*>=\s*v_policy\.marketplace_purchase_conversion_started_at/i);
  assert.match(sql, /revoke all on function public\.reconcile_advertising_marketplace_purchase_conversions_v2\(integer\)[\s\S]*from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.reconcile_advertising_marketplace_purchase_conversions_v2\(integer\)[\s\S]*to service_role/i);
  assert.match(sql, /marketplace_sales[\s\S]*(marketplace_product|marketplace_store)/i);
});

test("Business and release source expose Marketplace sales destinations, full-funnel metrics, and build 26", () => {
  const destination = readFileSync(new URL("../apps/business-web/src/components/ads/DestinationPanel.tsx", import.meta.url), "utf8");
  const analytics = readFileSync(new URL("../apps/business-web/src/components/ads/OperationalTruthPanels.tsx", import.meta.url), "utf8");
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  assert.match(destination, /marketplace_product/);
  assert.match(destination, /marketplace_store/);
  assert.match(destination, /Marketplace product/);
  assert.match(destination, /Marketplace store/);
  assert.match(analytics, /Conversion rate/);
  assert.match(analytics, /ROAS/);
  assert.match(analytics, /Attributed purchase value/);
  assert.equal(app.expo.ios.buildNumber, "26");
});
