const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AdsV2DeliveryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const hasViewerOverride = (body) => [
  "viewer_user_id", "viewerUserId", "user_id", "userId", "p_viewer_user_id",
].some((key) => Object.prototype.hasOwnProperty.call(body, key));

const validUuid = (value) => typeof value === "string" && UUID.test(value);

async function checkedRpc(rpc, name, args) {
  const result = await rpc(name, args);
  if (result?.error) throw new AdsV2DeliveryError("delivery_unavailable", 503);
  return result?.data;
}

export async function executeAdsV2DeliveryAction(body, viewerUserId, rpc) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdsV2DeliveryError("request_invalid");
  }
  if (!validUuid(viewerUserId)) throw new AdsV2DeliveryError("unauthorized", 401);
  if (hasViewerOverride(body)) throw new AdsV2DeliveryError("viewer_override_denied", 403);

  if (body.action === "candidates") {
    if (body.placement !== "social_feed") throw new AdsV2DeliveryError("placement_invalid");
    const candidates = await checkedRpc(rpc, "fetch_advertising_delivery_candidates_v2", {
      p_placement_code: "social_feed",
      p_viewer_user_id: viewerUserId,
      p_limit: 1,
      p_at_time: null,
    });
    const ads = [];
    for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 1) : []) {
      if (!validUuid(candidate?.ad_id)) continue;
      const payload = await checkedRpc(rpc, "get_advertising_delivery_render_payload_v2", {
        p_ad_id: candidate.ad_id,
        p_placement_code: "social_feed",
        p_viewer_user_id: viewerUserId,
      });
      if (payload && typeof payload === "object" && payload.ad_id === candidate.ad_id) ads.push(payload);
    }
    return { success: true, placement: "social_feed", ads };
  }

  if (body.action === "impression") {
    if (Object.prototype.hasOwnProperty.call(body, "placement")) {
      throw new AdsV2DeliveryError("placement_override_denied", 403);
    }
    if (!validUuid(body.ad_id) || !validUuid(body.event_key)) {
      throw new AdsV2DeliveryError("impression_invalid");
    }
    const event = await checkedRpc(rpc, "record_advertising_impression_v2", {
      p_ad_id: body.ad_id,
      p_placement_code: "social_feed",
      p_viewer_user_id: viewerUserId,
      p_event_key: body.event_key,
    });
    if (!validUuid(event?.id)) throw new AdsV2DeliveryError("delivery_unavailable", 503);
    return { success: true, placement: "social_feed", impression: { event_id: event.id } };
  }

  throw new AdsV2DeliveryError("action_invalid");
}

export async function handleAdsV2DeliveryRequest(request, authenticate, rpc) {
  if (request.method !== "POST") return { status: 405, body: { success: false, error: "method_not_allowed" } };
  const viewerUserId = await authenticate(request);
  if (!viewerUserId) return { status: 401, body: { success: false, error: "unauthorized" } };
  let body;
  try { body = await request.json(); }
  catch { return { status: 400, body: { success: false, error: "request_invalid" } }; }
  try {
    return { status: 200, body: await executeAdsV2DeliveryAction(body, viewerUserId, rpc) };
  } catch (error) {
    if (error instanceof AdsV2DeliveryError) {
      return { status: error.status, body: { success: false, error: error.code } };
    }
    return { status: 503, body: { success: false, error: "delivery_unavailable" } };
  }
}
