import { getSupabaseClient } from "@/template";

export type AdvertisingDestinationType =
  | "external_url"
  | "nelyon_profile"
  | "business_account"
  | "marketplace_product"
  | "marketplace_store";

export type AdvertisingDeliveryAdV2 = {
  ad_id: string;
  advertiser: { business_account_id: string; display_name: string };
  creative: {
    format: "image" | "video";
    primary_text: string | null;
    headline: string | null;
    description: string | null;
    call_to_action: "learn_more" | "shop_now" | "sign_up" | "contact_us" | "send_message" | "download" | "visit_profile" | "none";
    media: { kind: "image" | "video"; url: string; thumbnail_url: string | null };
  };
  destination: {
    destination_type: AdvertisingDestinationType;
    external_url: string | null;
    target_user_id: string | null;
    target_business_account_id: string | null;
    target_product_id: string | null;
    target_store_id: string | null;
  };
};

export type AdvertisingDestinationAction =
  | { kind: "external"; url: string }
  | { kind: "route"; pathname: "/creator/[id]" | "/product/[id]" | "/store/[id]"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown, path: string) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`ads_v2_payload_invalid:${path}`);
  return value;
};
const nullableUuid = (value: unknown, path: string) => value === null ? null : uuid(value, path);
const nullableText = (value: unknown, path: string) => {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`ads_v2_payload_invalid:${path}`);
  return value;
};
const httpsUrl = (value: unknown, path: string) => {
  if (typeof value !== "string") throw new Error(`ads_v2_payload_invalid:${path}`);
  try { if (new URL(value).protocol !== "https:") throw new Error(); }
  catch { throw new Error(`ads_v2_payload_invalid:${path}`); }
  return value;
};

const destinationTypes = new Set<AdvertisingDestinationType>(["external_url", "nelyon_profile", "business_account", "marketplace_product", "marketplace_store"]);
const callsToAction = new Set<AdvertisingDeliveryAdV2["creative"]["call_to_action"]>(["learn_more", "shop_now", "sign_up", "contact_us", "send_message", "download", "visit_profile", "none"]);

export function parseAdvertisingDeliveryAdV2(value: unknown): AdvertisingDeliveryAdV2 {
  if (!isObject(value) || !isObject(value.advertiser) || !isObject(value.creative) || !isObject(value.destination) || !isObject(value.creative.media)) {
    throw new Error("ads_v2_payload_invalid:ad");
  }
  const format = value.creative.format;
  const mediaKind = value.creative.media.kind;
  if ((format !== "image" && format !== "video") || mediaKind !== format) throw new Error("ads_v2_payload_invalid:creative.format");
  const normalizedFormat = format as AdvertisingDeliveryAdV2["creative"]["format"];
  const callToAction = value.creative.call_to_action;
  if (typeof callToAction !== "string" || !callsToAction.has(callToAction as AdvertisingDeliveryAdV2["creative"]["call_to_action"])) throw new Error("ads_v2_payload_invalid:creative.call_to_action");
  const destinationType = value.destination.destination_type;
  if (typeof destinationType !== "string" || !destinationTypes.has(destinationType as AdvertisingDestinationType)) throw new Error("ads_v2_payload_invalid:destination.type");
  const displayName = value.advertiser.display_name;
  if (typeof displayName !== "string" || !displayName.trim()) throw new Error("ads_v2_payload_invalid:advertiser.display_name");
  return {
    ad_id: uuid(value.ad_id, "ad_id"),
    advertiser: { business_account_id: uuid(value.advertiser.business_account_id, "advertiser.business_account_id"), display_name: displayName },
    creative: {
      format: normalizedFormat,
      primary_text: nullableText(value.creative.primary_text, "creative.primary_text"),
      headline: nullableText(value.creative.headline, "creative.headline"),
      description: nullableText(value.creative.description, "creative.description"),
      call_to_action: callToAction as AdvertisingDeliveryAdV2["creative"]["call_to_action"],
      media: {
        kind: normalizedFormat,
        url: httpsUrl(value.creative.media.url, "creative.media.url"),
        thumbnail_url: value.creative.media.thumbnail_url === null ? null : httpsUrl(value.creative.media.thumbnail_url, "creative.media.thumbnail_url"),
      },
    },
    destination: {
      destination_type: destinationType as AdvertisingDestinationType,
      external_url: value.destination.external_url === null ? null : httpsUrl(value.destination.external_url, "destination.external_url"),
      target_user_id: nullableUuid(value.destination.target_user_id, "destination.target_user_id"),
      target_business_account_id: nullableUuid(value.destination.target_business_account_id, "destination.target_business_account_id"),
      target_product_id: nullableUuid(value.destination.target_product_id, "destination.target_product_id"),
      target_store_id: nullableUuid(value.destination.target_store_id, "destination.target_store_id"),
    },
  };
}

export async function fetchAdvertisingV2SocialFeedCandidate(): Promise<AdvertisingDeliveryAdV2 | null> {
  const { data, error } = await getSupabaseClient().functions.invoke("ads-v2-delivery", {
    body: { action: "candidates", placement: "social_feed", limit: 1 },
  });
  if (error) throw error;
  if (!isObject(data) || data.success !== true || data.placement !== "social_feed" || !Array.isArray(data.ads)) throw new Error("ads_v2_payload_invalid:response");
  return data.ads.length ? parseAdvertisingDeliveryAdV2(data.ads[0]) : null;
}

export async function recordAdvertisingV2SocialFeedImpression(adId: string, eventKey: string): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke("ads-v2-delivery", {
    body: { action: "impression", ad_id: adId, event_key: eventKey },
  });
  if (error) throw error;
  if (!isObject(data) || data.success !== true || !isObject(data.impression)) throw new Error("ads_v2_payload_invalid:impression");
  return uuid(data.impression.event_id, "impression.event_id");
}

export function advertisingDestinationAction(destination: AdvertisingDeliveryAdV2["destination"]): AdvertisingDestinationAction | null {
  if (destination.destination_type === "external_url" && destination.external_url) return { kind: "external", url: destination.external_url };
  if (destination.destination_type === "nelyon_profile" && destination.target_user_id) return { kind: "route", pathname: "/creator/[id]", id: destination.target_user_id };
  if (destination.destination_type === "marketplace_product" && destination.target_product_id) return { kind: "route", pathname: "/product/[id]", id: destination.target_product_id };
  if (destination.destination_type === "marketplace_store" && destination.target_store_id) return { kind: "route", pathname: "/store/[id]", id: destination.target_store_id };
  return null;
}
