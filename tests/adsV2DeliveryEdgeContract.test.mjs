import assert from "node:assert/strict";
import test from "node:test";

const contractUrl = new URL("../supabase/functions/ads-v2-delivery/contract.mjs", import.meta.url);

test("candidates derive the viewer and clamp social_feed to one result", async () => {
  const { executeAdsV2DeliveryAction } = await import(contractUrl);
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "fetch_advertising_delivery_candidates_v2") return { data: [{ ad_id: "10000000-0000-4000-8000-000000000001" }], error: null };
    return { data: { ad_id: args.p_ad_id, advertiser: { business_account_id: "20000000-0000-4000-8000-000000000001", display_name: "Nelyon" }, creative: { format: "image", primary_text: "Hello", headline: null, description: null, call_to_action: "learn_more", media: { kind: "image", url: "https://example.test/ad.jpg", thumbnail_url: null } }, destination: { destination_type: "nelyon_profile", external_url: null, target_user_id: "30000000-0000-4000-8000-000000000001", target_business_account_id: null, target_product_id: null, target_store_id: null } }, error: null };
  };
  const result = await executeAdsV2DeliveryAction({ action: "candidates", placement: "social_feed", limit: 99 }, "40000000-0000-4000-8000-000000000001", rpc);
  assert.equal(result.ads.length, 1);
  assert.deepEqual(calls[0], ["fetch_advertising_delivery_candidates_v2", { p_placement_code: "social_feed", p_viewer_user_id: "40000000-0000-4000-8000-000000000001", p_limit: 1, p_at_time: null }]);
  assert.equal(calls[1][0], "get_advertising_delivery_render_payload_v2");
  assert.equal(JSON.stringify(result).includes("viewer_user_id"), false);
});

test("viewer overrides and non-social placements are denied", async () => {
  const { executeAdsV2DeliveryAction } = await import(contractUrl);
  const rpc = async () => ({ data: [], error: null });
  await assert.rejects(() => executeAdsV2DeliveryAction({ action: "candidates", placement: "social_feed", viewer_user_id: "50000000-0000-4000-8000-000000000001" }, "40000000-0000-4000-8000-000000000001", rpc), /viewer_override_denied/);
  await assert.rejects(() => executeAdsV2DeliveryAction({ action: "candidates", placement: "stories" }, "40000000-0000-4000-8000-000000000001", rpc), /placement_invalid/);
});

test("impression fixes viewer and placement and returns only the event id", async () => {
  const { executeAdsV2DeliveryAction } = await import(contractUrl);
  const calls = [];
  const rpc = async (name, args) => { calls.push([name, args]); return { data: { id: "60000000-0000-4000-8000-000000000001", viewer_user_id: args.p_viewer_user_id }, error: null }; };
  const body = { action: "impression", ad_id: "10000000-0000-4000-8000-000000000001", event_key: "70000000-0000-4000-8000-000000000001" };
  const result = await executeAdsV2DeliveryAction(body, "40000000-0000-4000-8000-000000000001", rpc);
  assert.deepEqual(calls, [["record_advertising_impression_v2", { p_ad_id: body.ad_id, p_placement_code: "social_feed", p_viewer_user_id: "40000000-0000-4000-8000-000000000001", p_event_key: body.event_key }]]);
  assert.deepEqual(result, { success: true, placement: "social_feed", impression: { event_id: "60000000-0000-4000-8000-000000000001" } });
});

test("request handler denies missing authentication before executing an action", async () => {
  const { handleAdsV2DeliveryRequest } = await import(contractUrl);
  let called = false;
  const result = await handleAdsV2DeliveryRequest(new Request("https://example.test", { method: "POST", body: "{}" }), async () => null, async () => { called = true; });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { success: false, error: "unauthorized" });
  assert.equal(called, false);
});

test("request handler rejects invalid JSON and non-POST methods without RPC calls", async () => {
  const { handleAdsV2DeliveryRequest } = await import(contractUrl);
  let calls = 0;
  const rpc = async () => { calls += 1; };
  const viewer = "40000000-0000-4000-8000-000000000001";
  const malformed = await handleAdsV2DeliveryRequest(new Request("https://example.test", { method: "POST", body: "{" }), async () => viewer, rpc);
  const method = await handleAdsV2DeliveryRequest(new Request("https://example.test", { method: "GET" }), async () => viewer, rpc);
  assert.deepEqual(malformed, { status: 400, body: { success: false, error: "request_invalid" } });
  assert.deepEqual(method, { status: 405, body: { success: false, error: "method_not_allowed" } });
  assert.equal(calls, 0);
});

test("empty or inconsistent candidates fail closed", async () => {
  const { executeAdsV2DeliveryAction } = await import(contractUrl);
  const viewer = "40000000-0000-4000-8000-000000000001";
  const empty = await executeAdsV2DeliveryAction({ action: "candidates", placement: "social_feed" }, viewer, async () => ({ data: [], error: null }));
  assert.deepEqual(empty, { success: true, placement: "social_feed", ads: [] });
  const inconsistent = await executeAdsV2DeliveryAction({ action: "candidates", placement: "social_feed" }, viewer, async (name) => name === "fetch_advertising_delivery_candidates_v2"
    ? { data: [{ ad_id: "10000000-0000-4000-8000-000000000001" }], error: null }
    : { data: { ad_id: "10000000-0000-4000-8000-000000000002" }, error: null });
  assert.deepEqual(inconsistent.ads, []);
});

test("impression denies viewer and placement overrides and preserves an exact retry key", async () => {
  const { executeAdsV2DeliveryAction } = await import(contractUrl);
  const viewer = "40000000-0000-4000-8000-000000000001";
  const body = { action: "impression", ad_id: "10000000-0000-4000-8000-000000000001", event_key: "70000000-0000-4000-8000-000000000001" };
  const calls = [];
  const rpc = async (name, args) => { calls.push([name, args]); return { data: { id: "60000000-0000-4000-8000-000000000001" }, error: null }; };
  await assert.rejects(() => executeAdsV2DeliveryAction({ ...body, placement: "social_feed" }, viewer, rpc), /placement_override_denied/);
  await assert.rejects(() => executeAdsV2DeliveryAction({ ...body, userId: viewer }, viewer, rpc), /viewer_override_denied/);
  await executeAdsV2DeliveryAction(body, viewer, rpc);
  await executeAdsV2DeliveryAction(body, viewer, rpc);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].p_event_key, body.event_key);
  assert.deepEqual(calls[1], calls[0]);
});

test("database failures return a stable delivery-unavailable response", async () => {
  const { handleAdsV2DeliveryRequest } = await import(contractUrl);
  const request = new Request("https://example.test", { method: "POST", body: JSON.stringify({ action: "candidates", placement: "social_feed" }) });
  const result = await handleAdsV2DeliveryRequest(request, async () => "40000000-0000-4000-8000-000000000001", async () => ({ data: null, error: { message: "private detail" } }));
  assert.deepEqual(result, { status: 503, body: { success: false, error: "delivery_unavailable" } });
});
