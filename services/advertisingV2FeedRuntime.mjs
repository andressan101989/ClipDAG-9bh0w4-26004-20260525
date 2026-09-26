export const ADS_V2_VIEWABILITY_CONFIG = Object.freeze({
  itemVisiblePercentThreshold: 50,
});

const QUALIFIED_VIEW_MILLISECONDS = 1000;

export function advertisingV2OpportunityForViewer(opportunity, viewerUserId) {
  return opportunity?.viewerUserId && opportunity.viewerUserId === viewerUserId ? opportunity : null;
}

export async function loadAdvertisingV2Opportunity(viewerUserId, fetchCandidate, createEventKey) {
  if (!viewerUserId) return null;
  try {
    const ad = await fetchCandidate();
    return ad ? { viewerUserId, ad, eventKey: createEventKey() } : null;
  } catch {
    return null;
  }
}

export function mixSocialFeedAdvertisingV2(items, ad, eventKey) {
  if (!ad || !eventKey || items.some((item) => item.kind === "advertising_v2")) return items;
  const organicCount = items.reduce((count, item) => count + (item.kind === "organic" ? 1 : 0), 0);
  if (organicCount === 0) return items;

  const insertionOrganicCount = Math.min(4, organicCount);
  let seenOrganic = 0;
  let insertionIndex = items.length;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "organic") continue;
    seenOrganic += 1;
    if (seenOrganic === insertionOrganicCount) {
      insertionIndex = index + 1;
      break;
    }
  }

  const mixed = [...items];
  const advertisingItem = { kind: "advertising_v2", ad, eventKey };
  if (mixed[insertionIndex]?.kind === "sponsored") {
    mixed.splice(insertionIndex, 1, advertisingItem);
  } else {
    mixed.splice(insertionIndex, 0, advertisingItem);
  }
  return mixed;
}

export function createAdvertisingV2ImpressionController(recordImpression, scheduler = {}) {
  const setTimer = scheduler.setTimeout ?? globalThis.setTimeout;
  const clearTimer = scheduler.clearTimeout ?? globalThis.clearTimeout;
  const states = new Map();

  const stateFor = (eventKey) => {
    if (!states.has(eventKey)) {
      states.set(eventKey, {
        eventKey,
        item: null,
        mediaReady: false,
        visible: false,
        phase: "idle",
        timer: null,
      });
    }
    return states.get(eventKey);
  };

  const cancelQualification = (state) => {
    if (state.timer !== null) clearTimer(state.timer);
    state.timer = null;
    if (state.phase === "qualifying") state.phase = "idle";
  };

  const submit = (state) => {
    state.timer = null;
    if (!state.visible || !state.mediaReady || state.phase !== "qualifying") {
      if (state.phase === "qualifying") state.phase = "idle";
      return;
    }
    const adId = state.item?.ad?.ad_id ?? state.item?.ad?.adId;
    if (!adId) {
      state.phase = "idle";
      return;
    }
    state.phase = "submitting";
    Promise.resolve(recordImpression(adId, state.eventKey)).then(
      () => { state.phase = "confirmed"; },
      () => { state.phase = state.visible ? "waiting_for_reentry" : "idle"; },
    );
  };

  const startQualification = (state) => {
    if (!state.visible || !state.mediaReady || state.phase !== "idle") return;
    state.phase = "qualifying";
    state.timer = setTimer(() => submit(state), QUALIFIED_VIEW_MILLISECONDS);
  };

  const onViewableItemsChanged = ({ viewableItems }) => {
    const visibleEventKeys = new Set();
    for (const token of viewableItems ?? []) {
      const item = token?.item;
      if (!token?.isViewable || item?.kind !== "advertising_v2" || !item.eventKey) continue;
      visibleEventKeys.add(item.eventKey);
      const state = stateFor(item.eventKey);
      const reentered = !state.visible;
      state.item = item;
      state.visible = true;
      if (reentered && state.phase === "waiting_for_reentry") state.phase = "idle";
      startQualification(state);
    }

    for (const state of states.values()) {
      if (!state.visible || visibleEventKeys.has(state.eventKey)) continue;
      state.visible = false;
      cancelQualification(state);
      if (state.phase === "waiting_for_reentry") state.phase = "idle";
    }
  };

  onViewableItemsChanged.markMediaReady = (eventKey) => {
    if (!eventKey) return;
    const state = stateFor(eventKey);
    state.mediaReady = true;
    startQualification(state);
  };
  onViewableItemsChanged.discard = (eventKey) => {
    const state = states.get(eventKey);
    if (state) cancelQualification(state);
    states.delete(eventKey);
  };
  onViewableItemsChanged.dispose = () => {
    for (const state of states.values()) cancelQualification(state);
    states.clear();
  };
  return onViewableItemsChanged;
}
