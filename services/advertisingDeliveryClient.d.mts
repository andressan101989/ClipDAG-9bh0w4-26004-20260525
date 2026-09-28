export type AdvertisingDestinationType =
  | "external_url"
  | "nelyon_profile"
  | "nelyon_message"
  | "business_account"
  | "marketplace_product"
  | "marketplace_store";

export const ADVERTISING_V2_PLACEMENTS: readonly [
  "social_feed",
  "clips",
  "stories",
  "live",
  "marketplace_home",
  "marketplace_search",
];
export type AdvertisingPlacementCodeV2 = typeof ADVERTISING_V2_PLACEMENTS[number];

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
  | { kind: "route"; pathname: "/creator/[id]" | "/chat/[userId]" | "/product/[id]" | "/store/[id]"; id: string };

export type AdsV2EdgeInvoker = (
  slug: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

export function parseAdvertisingDeliveryAdV2(value: unknown): AdvertisingDeliveryAdV2;
export function fetchAdvertisingV2SocialFeedCandidateWithInvoker(
  invoke: AdsV2EdgeInvoker,
): Promise<AdvertisingDeliveryAdV2 | null>;
export function fetchAdvertisingV2CandidateWithInvoker(
  invoke: AdsV2EdgeInvoker,
  placement: AdvertisingPlacementCodeV2,
): Promise<AdvertisingDeliveryAdV2 | null>;
export function recordAdvertisingV2SocialFeedImpressionWithInvoker(
  invoke: AdsV2EdgeInvoker,
  adId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2ImpressionWithInvoker(
  invoke: AdsV2EdgeInvoker,
  placement: AdvertisingPlacementCodeV2,
  adId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2SocialFeedClickWithInvoker(
  invoke: AdsV2EdgeInvoker,
  impressionEventId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2SocialFeedDestinationOpenWithInvoker(
  invoke: AdsV2EdgeInvoker,
  impressionEventId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2ClickWithInvoker(
  invoke: AdsV2EdgeInvoker,
  impressionEventId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2DestinationOpenWithInvoker(
  invoke: AdsV2EdgeInvoker,
  impressionEventId: string,
  eventKey: string,
): Promise<string>;
export function recordAdvertisingV2VideoViewWithInvoker(
  invoke: AdsV2EdgeInvoker,
  impressionEventId: string,
  eventKey: string,
): Promise<string>;
export function advertisingDestinationAction(
  destination: AdvertisingDeliveryAdV2["destination"],
): AdvertisingDestinationAction | null;
export function advertisingDestinationRouteParams(
  action: AdvertisingDestinationAction,
  impressionEventId: string | null,
): { id: string } | { userId: string; advertisingImpressionEventId?: string } | null;
