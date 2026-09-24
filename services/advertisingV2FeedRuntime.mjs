export const ADS_V2_VIEWABILITY_CONFIG = Object.freeze({
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 1000,
});

export function advertisingV2OpportunityForViewer(opportunity, viewerUserId) {
  return opportunity?.viewerUserId && opportunity.viewerUserId === viewerUserId ? opportunity : null;
}

export function mixSocialFeedAdvertisingV2(items, ad, eventKey) {
  if (!ad || !eventKey || items.some((item) => item.kind === "advertising_v2")) return items;
  const organicCount = items.reduce((count, item) => count + (item.kind === "organic" ? 1 : 0), 0);
  if (organicCount === 0) return items;
  const insertionOrganicCount = Math.min(4, organicCount);
  let seenOrganic = 0;
  const mixed = [];
  for (const item of items) {
    mixed.push(item);
    if (item.kind === "organic") {
      seenOrganic += 1;
      if (seenOrganic === insertionOrganicCount) mixed.push({ kind: "advertising_v2", ad, eventKey });
    }
  }
  return mixed;
}

export function createAdvertisingV2ImpressionController(recordImpression) {
  const attemptedEventKeys = new Set();
  const mediaReadyEventKeys = new Set();
  const visibleItems = new Map();
  const attempt = (item) => {
    if (!item || attemptedEventKeys.has(item.eventKey) || !mediaReadyEventKeys.has(item.eventKey)) return;
    const adId = item.ad?.ad_id ?? item.ad?.adId;
    if (!adId || !item.eventKey) return;
    attemptedEventKeys.add(item.eventKey);
    Promise.resolve(recordImpression(adId, item.eventKey)).catch(() => {});
  };
  const onViewableItemsChanged = ({ viewableItems }) => {
    visibleItems.clear();
    for (const token of viewableItems ?? []) {
      const item = token?.item;
      if (!token?.isViewable || item?.kind !== "advertising_v2" || !item.eventKey) continue;
      visibleItems.set(item.eventKey, item);
      attempt(item);
    }
  };
  onViewableItemsChanged.markMediaReady = (eventKey) => {
    if (!eventKey) return;
    mediaReadyEventKeys.add(eventKey);
    attempt(visibleItems.get(eventKey));
  };
  return onViewableItemsChanged;
}
