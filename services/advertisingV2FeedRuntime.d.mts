export const ADS_V2_VIEWABILITY_CONFIG: Readonly<{
  itemVisiblePercentThreshold: 50;
  minimumViewTime: 1000;
}>;

export type AdvertisingV2FeedItem<TAd> = {
  kind: "advertising_v2";
  ad: TAd;
  eventKey: string;
};

export function advertisingV2OpportunityForViewer<TOpportunity extends { viewerUserId: string }>(
  opportunity: TOpportunity | null,
  viewerUserId: string | null | undefined,
): TOpportunity | null;

export function mixSocialFeedAdvertisingV2<TItem extends { kind: string }, TAd>(
  items: readonly TItem[],
  ad: TAd | null,
  eventKey: string | null,
): Array<TItem | AdvertisingV2FeedItem<TAd>>;

export function createAdvertisingV2ImpressionController(
  recordImpression: (adId: string, eventKey: string) => Promise<unknown>,
): ((payload: { viewableItems?: Array<{ isViewable?: boolean; item?: unknown }> }) => void) & {
  markMediaReady(eventKey: string): void;
};
