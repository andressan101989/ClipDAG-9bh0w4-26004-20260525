import { getSupabaseClient } from "@/template";
import {
  advertisingDestinationAction,
  fetchAdvertisingV2SocialFeedCandidateWithInvoker,
  parseAdvertisingDeliveryAdV2,
  recordAdvertisingV2SocialFeedImpressionWithInvoker,
} from "@/services/advertisingDeliveryClient.mjs";
import type {
  AdsV2EdgeInvoker,
  AdvertisingDeliveryAdV2,
  AdvertisingDestinationAction,
  AdvertisingDestinationType,
} from "@/services/advertisingDeliveryClient.mjs";

export {
  advertisingDestinationAction,
  parseAdvertisingDeliveryAdV2,
};
export type {
  AdvertisingDeliveryAdV2,
  AdvertisingDestinationAction,
  AdvertisingDestinationType,
};

const invokeAdsV2Delivery: AdsV2EdgeInvoker = (slug, options) =>
  getSupabaseClient().functions.invoke(slug, options);

export async function fetchAdvertisingV2SocialFeedCandidate(): Promise<AdvertisingDeliveryAdV2 | null> {
  return fetchAdvertisingV2SocialFeedCandidateWithInvoker(invokeAdsV2Delivery);
}

export async function recordAdvertisingV2SocialFeedImpression(adId: string, eventKey: string): Promise<string> {
  return recordAdvertisingV2SocialFeedImpressionWithInvoker(invokeAdsV2Delivery, adId, eventKey);
}
