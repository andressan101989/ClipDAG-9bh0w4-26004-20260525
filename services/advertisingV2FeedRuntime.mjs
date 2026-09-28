export const ADS_V2_VIEWABILITY_CONFIG = Object.freeze({
  itemVisiblePercentThreshold: 50,
});

const QUALIFIED_VIEW_MILLISECONDS = 1000;
const CLICK_NAVIGATION_WAIT_MILLISECONDS = 500;

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

export function mixPlacementAdvertisingV2(items, opportunities) {
  let mixed = [...items];
  const ordered = (opportunities ?? [])
    .filter((opportunity) => opportunity?.ad && opportunity?.eventKey && opportunity?.placement)
    .sort((left, right) => left.afterOrganic - right.afterOrganic);

  for (const opportunity of ordered) {
    if (mixed.some((item) => item.kind === "advertising_v2" && item.placement === opportunity.placement)) continue;
    const organicCount = mixed.reduce((count, item) => count + (item.kind === "organic" ? 1 : 0), 0);
    if (organicCount === 0) continue;
    const insertionOrganicCount = Math.min(Math.max(1, opportunity.afterOrganic), organicCount);
    let seenOrganic = 0;
    let insertionIndex = mixed.length;
    for (let index = 0; index < mixed.length; index += 1) {
      if (mixed[index].kind !== "organic") continue;
      seenOrganic += 1;
      if (seenOrganic === insertionOrganicCount) {
        insertionIndex = index + 1;
        break;
      }
    }
    const advertisingItem = {
      kind: "advertising_v2",
      placement: opportunity.placement,
      ad: opportunity.ad,
      eventKey: opportunity.eventKey,
    };
    if (mixed[insertionIndex]?.kind === "sponsored") mixed.splice(insertionIndex, 1, advertisingItem);
    else mixed.splice(insertionIndex, 0, advertisingItem);
  }
  return mixed;
}

export function mixSocialFeedAdvertisingV2(items, ad, eventKey) {
  if (!ad || !eventKey || items.some((item) => item.kind === "advertising_v2")) return items;
  return mixPlacementAdvertisingV2(items, [{
    placement: "social_feed",
    ad,
    eventKey,
    afterOrganic: 4,
  }]);
}

export function composeAdvertisingV2StorySequence(stories, opportunity) {
  const organic = (stories ?? []).map((story) => ({ kind: "organic_story", story }));
  if (!opportunity?.ad || !opportunity?.eventKey || opportunity.placement !== "stories") return organic;
  return [...organic, { kind: "advertising_v2", ...opportunity }];
}

export function mixLiveDiscoveryAdvertisingV2(streams, opportunity) {
  const items = (streams ?? []).map((stream) => ({ kind: "live_stream", stream }));
  if (!opportunity?.ad || !opportunity?.eventKey || opportunity.placement !== "live") return items;
  const insertionIndex = Math.min(4, items.length);
  items.splice(insertionIndex, 0, { kind: "advertising_v2", ...opportunity });
  return items;
}

export function selectMarketplaceSponsoredAuthority(opportunity, legacy) {
  if (opportunity?.ad && opportunity?.eventKey
    && (opportunity.placement === "marketplace_home" || opportunity.placement === "marketplace_search")) {
    return { authority: "ads_v2", opportunity, legacy: [] };
  }
  return { authority: "legacy", opportunity: null, legacy: legacy ?? [] };
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
        impressionEventId: null,
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
    Promise.resolve(recordImpression(adId, state.eventKey, state.item?.placement ?? "social_feed")).then(
      (impressionEventId) => {
        state.impressionEventId = impressionEventId ?? null;
        state.phase = "confirmed";
      },
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
  onViewableItemsChanged.confirmedImpressionId = (eventKey) => {
    const state = states.get(eventKey);
    return state?.phase === "confirmed" ? state.impressionEventId : null;
  };
  return onViewableItemsChanged;
}

function createAdvertisingV2InteractionController(recordInteraction, createEventKey, parentConflictCode) {
  const states = new Map();

  const submit = (opportunityKey, impressionEventId) => {
    if (!opportunityKey || !impressionEventId) return Promise.resolve(null);
    let state = states.get(opportunityKey);
    if (!state) {
      state = {
        impressionEventId,
        eventKey: createEventKey(),
        phase: "idle",
        interactionEventId: null,
        inFlight: null,
      };
      states.set(opportunityKey, state);
    }
    if (state.impressionEventId !== impressionEventId) {
      return Promise.reject(new Error(parentConflictCode));
    }
    if (state.phase === "confirmed") return Promise.resolve(state.interactionEventId);
    if (state.inFlight) return state.inFlight;

    state.phase = "submitting";
    state.inFlight = Promise.resolve()
      .then(() => recordInteraction(state.impressionEventId, state.eventKey))
      .then(
        (interactionEventId) => {
          state.phase = "confirmed";
          state.interactionEventId = interactionEventId;
          state.inFlight = null;
          return interactionEventId;
        },
        (error) => {
          state.phase = "idle";
          state.inFlight = null;
          throw error;
        },
      );
    return state.inFlight;
  };

  return {
    submit,
    discard(opportunityKey) { states.delete(opportunityKey); },
    dispose() { states.clear(); },
  };
}

export function createAdvertisingV2ClickController(recordClick, createEventKey) {
  return createAdvertisingV2InteractionController(recordClick, createEventKey, "ads_v2_click_parent_conflict");
}

export function createAdvertisingV2DestinationOpenController(recordDestinationOpen, createEventKey) {
  return createAdvertisingV2InteractionController(recordDestinationOpen, createEventKey, "ads_v2_destination_open_parent_conflict");
}

export function createAdvertisingV2VideoViewController(recordVideoView, createEventKey) {
  return createAdvertisingV2InteractionController(recordVideoView, createEventKey, "ads_v2_video_view_parent_conflict");
}

export function createAdvertisingV2VideoQualificationController(onQualified, requiredSeconds = 2) {
  if (typeof onQualified !== "function" || !Number.isFinite(requiredSeconds) || requiredSeconds <= 0) {
    throw new Error("ads_v2_video_qualification_invalid");
  }
  let ready = false;
  let active = false;
  let playing = false;
  let hasPlayed = false;
  let duration = null;
  let lastTime = null;
  let qualifiedSeconds = 0;
  let emitted = false;
  const clearSample = () => { lastTime = null; };
  const emit = () => {
    if (emitted) return;
    emitted = true;
    onQualified();
  };
  return {
    setReady(value) { ready = value === true; if (!ready) clearSample(); },
    setActive(value) { active = value === true; if (!active) clearSample(); },
    setPlaying(value) {
      playing = value === true;
      if (playing) hasPlayed = true;
      else clearSample();
    },
    setDuration(value) { duration = Number.isFinite(value) && value > 0 ? Number(value) : null; },
    observeTime(value) {
      const current = Number(value);
      if (!Number.isFinite(current)) return;
      if (!ready || !active || !playing) { clearSample(); return; }
      const previous = lastTime;
      lastTime = current;
      if (previous === null) return;
      const delta = current - previous;
      if (delta <= 0 || delta > 1) return;
      qualifiedSeconds += delta;
      if (qualifiedSeconds >= requiredSeconds) emit();
    },
    complete() {
      if (ready && active && hasPlayed && duration !== null && duration < requiredSeconds) emit();
    },
    reset() {
      ready = false;
      active = false;
      playing = false;
      hasPlayed = false;
      duration = null;
      lastTime = null;
      qualifiedSeconds = 0;
      emitted = false;
    },
  };
}

export async function navigateAdvertisingV2WithClick({
  opportunityKey,
  impressionEventId,
  submitClick,
  submitDestinationOpen,
  navigate,
  scheduler = {},
}) {
  if (!impressionEventId) {
    await Promise.resolve().then(() => navigate()).catch(() => false);
    return;
  }
  const setTimer = scheduler.setTimeout ?? globalThis.setTimeout;
  const clearTimer = scheduler.clearTimeout ?? globalThis.clearTimeout;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimer(resolve, CLICK_NAVIGATION_WAIT_MILLISECONDS);
  });
  const analytics = Promise.resolve()
    .then(() => submitClick(opportunityKey, impressionEventId))
    .catch(() => null);
  try {
    await Promise.race([analytics, timeout]);
  } finally {
    if (timer !== null) clearTimer(timer);
    const opened = await Promise.resolve().then(() => navigate()).then((result) => result !== false, () => false);
    if (opened && submitDestinationOpen) {
      void Promise.resolve()
        .then(() => analytics)
        .then(() => submitDestinationOpen(opportunityKey, impressionEventId))
        .catch(() => null);
    }
  }
}
