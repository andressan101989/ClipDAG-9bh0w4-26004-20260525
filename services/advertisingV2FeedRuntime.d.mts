import type { AdvertisingPlacementCodeV2 } from "./advertisingDeliveryClient.mjs";

export const ADS_V2_VIEWABILITY_CONFIG: Readonly<{
  itemVisiblePercentThreshold: 50;
}>;

export type AdvertisingV2FeedItem<TAd> = {
  kind: "advertising_v2";
  placement: AdvertisingPlacementCodeV2;
  ad: TAd;
  eventKey: string;
};

export type AdvertisingV2PlacementOpportunity<TAd> = {
  placement: AdvertisingPlacementCodeV2;
  ad: TAd;
  eventKey: string;
  afterOrganic: number;
};

export function mixPlacementAdvertisingV2<TItem, TAd>(
  items: TItem[],
  opportunities: AdvertisingV2PlacementOpportunity<TAd>[],
): Array<TItem | AdvertisingV2FeedItem<TAd>>;

export function composeAdvertisingV2StorySequence<TStory, TAd>(
  stories: TStory[],
  opportunity: Omit<AdvertisingV2PlacementOpportunity<TAd>, "afterOrganic"> | null,
): Array<{ kind: "organic_story"; story: TStory } | (AdvertisingV2FeedItem<TAd> & { placement: AdvertisingPlacementCodeV2 })>;

export function mixLiveDiscoveryAdvertisingV2<TStream, TAd>(
  streams: TStream[],
  opportunity: Omit<AdvertisingV2PlacementOpportunity<TAd>, "afterOrganic"> | null,
): Array<{ kind: "live_stream"; stream: TStream } | (AdvertisingV2FeedItem<TAd> & { placement: AdvertisingPlacementCodeV2 })>;

export function selectMarketplaceSponsoredAuthority<TAd, TLegacy>(
  opportunity: Omit<AdvertisingV2PlacementOpportunity<TAd>, "afterOrganic"> | null,
  legacy: TLegacy[],
): { authority: "ads_v2" | "legacy"; opportunity: Omit<AdvertisingV2PlacementOpportunity<TAd>, "afterOrganic"> | null; legacy: TLegacy[] };

export type AdvertisingV2Opportunity<TAd> = {
  viewerUserId: string;
  ad: TAd;
  eventKey: string;
};

export function advertisingV2OpportunityForViewer<TOpportunity extends { viewerUserId: string }>(
  opportunity: TOpportunity | null,
  viewerUserId: string | null | undefined,
): TOpportunity | null;

export function loadAdvertisingV2Opportunity<TAd>(
  viewerUserId: string | null | undefined,
  fetchCandidate: () => Promise<TAd | null>,
  createEventKey: () => string,
): Promise<AdvertisingV2Opportunity<TAd> | null>;

export function mixSocialFeedAdvertisingV2<TItem extends { kind: string }, TAd>(
  items: readonly TItem[],
  ad: TAd | null,
  eventKey: string | null,
): Array<TItem | AdvertisingV2FeedItem<TAd>>;

export function createAdvertisingV2ImpressionController(
  recordImpression: (adId: string, eventKey: string, placement: AdvertisingPlacementCodeV2) => Promise<unknown>,
  scheduler?: {
    setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  },
): ((payload: { viewableItems?: Array<{ isViewable?: boolean; item?: unknown }> }) => void) & {
  markMediaReady(eventKey: string): void;
  confirmedImpressionId(eventKey: string): string | null;
  discard(eventKey: string): void;
  dispose(): void;
};

export type AdvertisingV2ClickController = {
  submit(opportunityKey: string, impressionEventId: string): Promise<string | null>;
  discard(opportunityKey: string): void;
  dispose(): void;
};

export type AdvertisingV2DestinationOpenController = AdvertisingV2ClickController;

export function createAdvertisingV2ClickController(
  recordClick: (impressionEventId: string, eventKey: string) => Promise<string>,
  createEventKey: () => string,
): AdvertisingV2ClickController;

export function createAdvertisingV2DestinationOpenController(
  recordDestinationOpen: (impressionEventId: string, eventKey: string) => Promise<string>,
  createEventKey: () => string,
): AdvertisingV2DestinationOpenController;

export function navigateAdvertisingV2WithClick(input: {
  opportunityKey: string;
  impressionEventId: string | null;
  submitClick: (opportunityKey: string, impressionEventId: string) => Promise<unknown>;
  submitDestinationOpen?: (opportunityKey: string, impressionEventId: string) => Promise<unknown>;
  navigate: () => void | boolean | Promise<void | boolean>;
  scheduler?: {
    setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  };
}): Promise<void>;
