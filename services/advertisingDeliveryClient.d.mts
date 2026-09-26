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

export type AdsV2EdgeInvoker = (
  slug: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

export function parseAdvertisingDeliveryAdV2(value: unknown): AdvertisingDeliveryAdV2;
export function fetchAdvertisingV2SocialFeedCandidateWithInvoker(
  invoke: AdsV2EdgeInvoker,
): Promise<AdvertisingDeliveryAdV2 | null>;
export function recordAdvertisingV2SocialFeedImpressionWithInvoker(
  invoke: AdsV2EdgeInvoker,
  adId: string,
  eventKey: string,
): Promise<string>;
export function advertisingDestinationAction(
  destination: AdvertisingDeliveryAdV2["destination"],
): AdvertisingDestinationAction | null;
