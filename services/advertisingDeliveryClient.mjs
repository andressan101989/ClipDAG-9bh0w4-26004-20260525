const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESTINATION_TYPES = new Set([
  "external_url",
  "nelyon_profile",
  "business_account",
  "marketplace_product",
  "marketplace_store",
]);
const CALLS_TO_ACTION = new Set([
  "learn_more",
  "shop_now",
  "sign_up",
  "contact_us",
  "send_message",
  "download",
  "visit_profile",
  "none",
]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const uuid = (value, path) => {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`ads_v2_payload_invalid:${path}`);
  }
  return value;
};

const nullableUuid = (value, path) => value === null ? null : uuid(value, path);

const nullableText = (value, path) => {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`ads_v2_payload_invalid:${path}`);
  return value;
};

const urlWithProtocols = (value, protocols, path) => {
  if (typeof value !== "string") throw new Error(`ads_v2_payload_invalid:${path}`);
  try {
    const parsed = new URL(value);
    if (!protocols.has(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(`ads_v2_payload_invalid:${path}`);
  }
  return value;
};

const httpsUrl = (value, path) => urlWithProtocols(value, new Set(["https:"]), path);
const externalUrl = (value, path) => urlWithProtocols(value, new Set(["http:", "https:"]), path);

export function parseAdvertisingDeliveryAdV2(value) {
  if (!isObject(value)
    || !isObject(value.advertiser)
    || !isObject(value.creative)
    || !isObject(value.creative.media)
    || !isObject(value.destination)) {
    throw new Error("ads_v2_payload_invalid:ad");
  }

  const format = value.creative.format;
  const mediaKind = value.creative.media.kind;
  if ((format !== "image" && format !== "video") || mediaKind !== format) {
    throw new Error("ads_v2_payload_invalid:creative.format");
  }

  const callToAction = value.creative.call_to_action;
  if (typeof callToAction !== "string" || !CALLS_TO_ACTION.has(callToAction)) {
    throw new Error("ads_v2_payload_invalid:creative.call_to_action");
  }

  const destinationType = value.destination.destination_type;
  if (typeof destinationType !== "string" || !DESTINATION_TYPES.has(destinationType)) {
    throw new Error("ads_v2_payload_invalid:destination.type");
  }

  const displayName = value.advertiser.display_name;
  if (typeof displayName !== "string" || !displayName.trim()) {
    throw new Error("ads_v2_payload_invalid:advertiser.display_name");
  }

  return {
    ad_id: uuid(value.ad_id, "ad_id"),
    advertiser: {
      business_account_id: uuid(value.advertiser.business_account_id, "advertiser.business_account_id"),
      display_name: displayName,
    },
    creative: {
      format,
      primary_text: nullableText(value.creative.primary_text, "creative.primary_text"),
      headline: nullableText(value.creative.headline, "creative.headline"),
      description: nullableText(value.creative.description, "creative.description"),
      call_to_action: callToAction,
      media: {
        kind: format,
        url: httpsUrl(value.creative.media.url, "creative.media.url"),
        thumbnail_url: value.creative.media.thumbnail_url === null
          ? null
          : httpsUrl(value.creative.media.thumbnail_url, "creative.media.thumbnail_url"),
      },
    },
    destination: {
      destination_type: destinationType,
      external_url: value.destination.external_url === null
        ? null
        : externalUrl(value.destination.external_url, "destination.external_url"),
      target_user_id: nullableUuid(value.destination.target_user_id, "destination.target_user_id"),
      target_business_account_id: nullableUuid(
        value.destination.target_business_account_id,
        "destination.target_business_account_id",
      ),
      target_product_id: nullableUuid(value.destination.target_product_id, "destination.target_product_id"),
      target_store_id: nullableUuid(value.destination.target_store_id, "destination.target_store_id"),
    },
  };
}

export async function fetchAdvertisingV2SocialFeedCandidateWithInvoker(invoke) {
  const { data, error } = await invoke("ads-v2-delivery", {
    body: { action: "candidates", placement: "social_feed" },
  });
  if (error) throw error;
  if (!isObject(data)
    || data.success !== true
    || data.placement !== "social_feed"
    || !Array.isArray(data.ads)) {
    throw new Error("ads_v2_payload_invalid:response");
  }
  return data.ads.length > 0 ? parseAdvertisingDeliveryAdV2(data.ads[0]) : null;
}

export async function recordAdvertisingV2SocialFeedImpressionWithInvoker(invoke, adId, eventKey) {
  const canonicalAdId = uuid(adId, "impression.ad_id");
  const canonicalEventKey = uuid(eventKey, "impression.event_key");
  const { data, error } = await invoke("ads-v2-delivery", {
    body: {
      action: "impression",
      ad_id: canonicalAdId,
      event_key: canonicalEventKey,
    },
  });
  if (error) throw error;
  if (!isObject(data) || data.success !== true || !isObject(data.impression)) {
    throw new Error("ads_v2_payload_invalid:impression");
  }
  return uuid(data.impression.event_id, "impression.event_id");
}

export function advertisingDestinationAction(destination) {
  if (destination.destination_type === "external_url" && destination.external_url) {
    try {
      return { kind: "external", url: externalUrl(destination.external_url, "destination.external_url") };
    } catch {
      return null;
    }
  }
  if (destination.destination_type === "nelyon_profile" && destination.target_user_id) {
    return { kind: "route", pathname: "/creator/[id]", id: destination.target_user_id };
  }
  if (destination.destination_type === "marketplace_product" && destination.target_product_id) {
    return { kind: "route", pathname: "/product/[id]", id: destination.target_product_id };
  }
  if (destination.destination_type === "marketplace_store" && destination.target_store_id) {
    return { kind: "route", pathname: "/store/[id]", id: destination.target_store_id };
  }
  return null;
}
