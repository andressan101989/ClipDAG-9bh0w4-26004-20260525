export const ADS_V2_VIEWABILITY_CONFIG: Readonly<{
  itemVisiblePercentThreshold: 50;
}>;

export type AdvertisingV2FeedItem<TAd> = {
  kind: "advertising_v2";
  ad: TAd;
  eventKey: string;
};

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
  recordImpression: (adId: string, eventKey: string) => Promise<unknown>,
  scheduler?: {
    setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  },
): ((payload: { viewableItems?: Array<{ isViewable?: boolean; item?: unknown }> }) => void) & {
  markMediaReady(eventKey: string): void;
  discard(eventKey: string): void;
  dispose(): void;
};
