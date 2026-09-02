import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  giftReplayCursorForEvent,
  isGiftPresentationEventFresh,
  liveGiftEventFromPayload,
  type GiftEnqueueOutcome,
  type GiftReplayCursor,
  type GiftReplayRow,
  type LiveGiftPresentationEvent,
  type LiveGiftRealtimeRow,
} from '@/components/live/gifts/giftPresentationContract';
import {
  GIFT_COMBO_WINDOW_MS,
  GiftPresentationQueue,
  type GiftPresentationEntry,
} from '@/components/live/gifts/giftPresentationQueue';
import {
  GIFT_REPLAY_MAX_AGE_MS,
  GiftPresentationReplayCoordinator,
} from '@/components/live/gifts/giftPresentationReplay';
import { getSupabaseClient } from '@/template';

const MAX_COMPACT_PRESENTATIONS = 8;
const REDUCED_MOTION_DURATION_MS = 1_200;

const outcome = (status: GiftEnqueueOutcome['status']): GiftEnqueueOutcome => Object.freeze({ status });

function safeReplayLog(
  marker: 'backpressure' | 'replay_start' | 'replay_accepted' | 'replay_complete' | 'replay_cancelled',
  eventCode?: string,
) {
  console.info(`[LIVE-GIFT-PRESENTATION] ${marker}`, eventCode ?? '');
}

function laterReplayCursor(current: GiftReplayCursor | null, event: LiveGiftPresentationEvent): GiftReplayCursor {
  const candidate = giftReplayCursorForEvent(event, false);
  if (!current) return candidate;
  const order = candidate.createdAt.localeCompare(current.createdAt)
    || candidate.eventId.localeCompare(current.eventId);
  return order > 0 ? candidate : current;
}

export function useLiveGiftAnimations(sessionId?: string | null) {
  const mountedRef = useRef(true);
  const queueRef = useRef(new GiftPresentationQueue());
  const activeRef = useRef<GiftPresentationEntry | null>(null);
  const compactRef = useRef<GiftPresentationEntry[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const reducedMotionRef = useRef(false);
  const replayRef = useRef<GiftPresentationReplayCoordinator | null>(null);
  const lastAcknowledgedCursorRef = useRef<GiftReplayCursor | null>(null);
  const realtimeSubscribedRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const enqueueRef = useRef<(event: LiveGiftPresentationEvent, replay?: boolean) => GiftEnqueueOutcome>(
    () => outcome('cancelled'),
  );
  const [activeGift, setActiveGiftState] = useState<GiftPresentationEntry | null>(null);
  const [floatingGifts, setFloatingGifts] = useState<GiftPresentationEntry[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  const setManagedTimeout = useCallback((fn: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, delayMs);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const setActiveGift = useCallback((entry: GiftPresentationEntry | null) => {
    activeRef.current = entry;
    if (mountedRef.current) setActiveGiftState(entry);
  }, []);

  const playNext = useCallback(() => {
    if (!mountedRef.current || activeRef.current) return;
    const next = queueRef.current.next();
    if (!next) return;
    setActiveGift(next);
    const duration = reducedMotionRef.current ? REDUCED_MOTION_DURATION_MS : next.animation.durationMs;
    setManagedTimeout(() => {
      if (!mountedRef.current) return;
      queueRef.current.complete(next.event.eventId);
      setActiveGift(null);
      void replayRef.current?.notifyCapacityAvailable();
      setManagedTimeout(playNext, 60);
    }, duration);
  }, [setActiveGift, setManagedTimeout]);

  const enqueueGiftInternal = useCallback((event: LiveGiftPresentationEvent, fromReplay = false): GiftEnqueueOutcome => {
    if (!mountedRef.current) return outcome('cancelled');
    if (!sessionId || event.sessionId !== sessionId) return outcome('wrong_session');
    if (!fromReplay && !isGiftPresentationEventFresh(event)) {
      lastAcknowledgedCursorRef.current = laterReplayCursor(lastAcknowledgedCursorRef.current, event);
      return outcome('stale');
    }

    const result = queueRef.current.enqueue(event);
    if (!result.accepted) {
      if (result.reason === 'duplicate') {
        lastAcknowledgedCursorRef.current = laterReplayCursor(lastAcknowledgedCursorRef.current, event);
        return outcome('duplicate');
      }
      if (result.reason === 'cancelled') return outcome('cancelled');
      if (result.reason === 'capacity') {
        if (!fromReplay && event.costCoins >= 10_000) {
          replayRef.current?.request(giftReplayCursorForEvent(event, true));
        }
        return outcome('backpressure');
      }
      return outcome('stale');
    }

    lastAcknowledgedCursorRef.current = laterReplayCursor(lastAcknowledgedCursorRef.current, event);
    if (result.entry.animation.compact) {
      queueRef.current.removePending(result.entry.event.eventId);
      const existingIndex = compactRef.current.findIndex(item =>
        item.event.giftId === event.giftId
        && item.event.senderUserId === event.senderUserId
        && item.event.receiverUserId === event.receiverUserId
        && event.createdAt >= item.event.createdAt
        && event.createdAt - item.event.createdAt <= GIFT_COMBO_WINDOW_MS,
      );
      const compactEntry = existingIndex >= 0
        ? Object.freeze({
            ...compactRef.current[existingIndex],
            comboCount: compactRef.current[existingIndex].comboCount + 1,
          })
        : result.entry;
      compactRef.current = existingIndex >= 0
        ? compactRef.current.map((item, index) => index === existingIndex ? compactEntry : item)
        : [compactEntry, ...compactRef.current].slice(0, MAX_COMPACT_PRESENTATIONS);
      if (mountedRef.current) setFloatingGifts([...compactRef.current]);

      const eventId = compactEntry.event.eventId;
      const duration = reducedMotionRef.current ? REDUCED_MOTION_DURATION_MS : compactEntry.animation.durationMs;
      setManagedTimeout(() => {
        if (!mountedRef.current) return;
        compactRef.current = compactRef.current.filter(item => item.event.eventId !== eventId);
        setFloatingGifts([...compactRef.current]);
      }, duration);
      return outcome(existingIndex >= 0 ? 'combined' : 'accepted');
    }

    playNext();
    return outcome('accepted');
  }, [playNext, sessionId, setManagedTimeout]);
  enqueueRef.current = enqueueGiftInternal;

  const enqueueGift = useCallback(
    (event: LiveGiftPresentationEvent) => enqueueRef.current(event, false),
    [],
  );

  const resetGiftAnimations = useCallback(() => {
    replayRef.current?.cancel();
    replayRef.current = null;
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
    queueRef.current.reset();
    activeRef.current = null;
    compactRef.current = [];
    lastAcknowledgedCursorRef.current = null;
    realtimeSubscribedRef.current = false;
    if (mountedRef.current) {
      setActiveGiftState(null);
      setFloatingGifts([]);
    }
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    resetGiftAnimations();
    if (!sessionId) return;

    const replaySessionId = sessionId;
    const fetchPage = async (cursor: GiftReplayCursor, limit: number): Promise<readonly GiftReplayRow[]> => {
      if (!mountedRef.current || sessionIdRef.current !== replaySessionId) return [];
      const lowerBound = new Date(Date.now() - GIFT_REPLAY_MAX_AGE_MS).toISOString();
      if (cursor.createdAt < lowerBound) return [];
      const escapedId = cursor.eventId.replace(/[^0-9a-f-]/gi, '');
      const idOperator = cursor.inclusive ? 'gte' : 'gt';
      const { data, error } = await getSupabaseClient()
        .from('live_control_events')
        .select('id,session_id,actor_user_id,event_type,payload,created_at')
        .eq('session_id', replaySessionId)
        .eq('event_type', 'reaction')
        .contains('payload', { gift_real: true })
        .or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${idOperator}.${escapedId})`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as LiveGiftRealtimeRow[]).flatMap(row => {
        const event = liveGiftEventFromPayload(row, replaySessionId);
        if (!event || typeof row.id !== 'string' || typeof row.created_at !== 'string') return [];
        return [{
          cursor: Object.freeze({ createdAt: row.created_at, eventId: row.id, inclusive: false }),
          event,
        }];
      });
    };

    replayRef.current = new GiftPresentationReplayCoordinator({
      fetchPage,
      enqueue: row => enqueueRef.current(row.event, true),
      logger: safeReplayLog,
    });
    return () => {
      replayRef.current?.cancel();
      replayRef.current = null;
    };
  }, [resetGiftAnimations, sessionId]);

  const notifyGiftRealtimeSubscribed = useCallback(() => {
    if (!realtimeSubscribedRef.current) {
      realtimeSubscribedRef.current = true;
      return;
    }
    void replayRef.current?.notifyReconnect(lastAcknowledgedCursorRef.current);
  }, []);

  useEffect(() => {
    let subscribed = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!subscribed || !mountedRef.current) return;
      reducedMotionRef.current = value;
      setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      reducedMotionRef.current = value;
      if (mountedRef.current) setReducedMotion(value);
    });
    return () => {
      subscribed = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    const queue = queueRef.current;
    return () => {
      mountedRef.current = false;
      replayRef.current?.cancel();
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      queue.cancel();
      activeRef.current = null;
      compactRef.current = [];
    };
  }, []);

  return {
    activeGift,
    floatingGifts,
    reducedMotion,
    enqueueGift,
    notifyGiftRealtimeSubscribed,
    resetGiftAnimations,
  };
}
