import { getSupabaseClient } from "@/template";
import {
  ADVERTISING_V2_PLACEMENTS,
  advertisingDestinationAction,
  advertisingDestinationRouteParams,
  fetchAdvertisingV2CandidateWithInvoker,
  fetchAdvertisingV2SocialFeedCandidateWithInvoker,
  parseAdvertisingDeliveryAdV2,
  recordAdvertisingV2SocialFeedImpressionWithInvoker,
  recordAdvertisingV2ImpressionWithInvoker,
  recordAdvertisingV2ClickWithInvoker,
  recordAdvertisingV2DestinationOpenWithInvoker,
  recordAdvertisingV2VideoViewWithInvoker,
} from "@/services/advertisingDeliveryClient.mjs";
import type {
  AdsV2EdgeInvoker,
  AdvertisingDeliveryAdV2,
  AdvertisingDestinationAction,
  AdvertisingDestinationType,
  AdvertisingPlacementCodeV2,
} from "@/services/advertisingDeliveryClient.mjs";

export {
  ADVERTISING_V2_PLACEMENTS,
  advertisingDestinationAction,
  advertisingDestinationRouteParams,
  parseAdvertisingDeliveryAdV2,
};
export type {
  AdvertisingDeliveryAdV2,
  AdvertisingDestinationAction,
  AdvertisingDestinationType,
  AdvertisingPlacementCodeV2,
};

const invokeAdsV2Delivery: AdsV2EdgeInvoker = (slug, options) =>
  getSupabaseClient().functions.invoke(slug, options);

export async function fetchAdvertisingV2SocialFeedCandidate(): Promise<AdvertisingDeliveryAdV2 | null> {
  return fetchAdvertisingV2SocialFeedCandidateWithInvoker(invokeAdsV2Delivery);
}

export async function fetchAdvertisingV2Candidate(placement: AdvertisingPlacementCodeV2): Promise<AdvertisingDeliveryAdV2 | null> {
  return fetchAdvertisingV2CandidateWithInvoker(invokeAdsV2Delivery, placement);
}

export async function recordAdvertisingV2SocialFeedImpression(adId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2SocialFeedImpressionWithInvoker(invokeAdsV2Delivery, adId, eventKey);
}

export async function recordAdvertisingV2Impression(placement: AdvertisingPlacementCodeV2, adId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2ImpressionWithInvoker(invokeAdsV2Delivery, placement, adId, eventKey);
}

export async function recordAdvertisingV2SocialFeedClick(impressionEventId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2Click(impressionEventId, eventKey);
}

export async function recordAdvertisingV2SocialFeedDestinationOpen(impressionEventId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2DestinationOpen(impressionEventId, eventKey);
}

export async function recordAdvertisingV2Click(impressionEventId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2ClickWithInvoker(invokeAdsV2Delivery, impressionEventId, eventKey);
}

export async function recordAdvertisingV2DestinationOpen(impressionEventId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2DestinationOpenWithInvoker(invokeAdsV2Delivery, impressionEventId, eventKey);
}

export async function recordAdvertisingV2VideoView(impressionEventId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2VideoViewWithInvoker(invokeAdsV2Delivery, impressionEventId, eventKey);
}
