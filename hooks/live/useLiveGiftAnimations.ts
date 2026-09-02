import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  isGiftPresentationEventFresh,
  type LiveGiftPresentationEvent,
} from '@/components/live/gifts/giftPresentationContract';
import {
  GIFT_COMBO_WINDOW_MS,
  GiftPresentationQueue,
  type GiftPresentationEntry,
} from '@/components/live/gifts/giftPresentationQueue';

const MAX_COMPACT_PRESENTATIONS = 8;
const REDUCED_MOTION_DURATION_MS = 1_200;

export function useLiveGiftAnimations(sessionId?: string | null) {
  const mountedRef = useRef(true);
  const queueRef = useRef(new GiftPresentationQueue());
  const activeRef = useRef<GiftPresentationEntry | null>(null);
  const compactRef = useRef<GiftPresentationEntry[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const reducedMotionRef = useRef(false);
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
      setManagedTimeout(playNext, 60);
    }, duration);
  }, [setActiveGift, setManagedTimeout]);

  const resetGiftAnimations = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
    queueRef.current.reset();
    activeRef.current = null;
    compactRef.current = [];
    if (mountedRef.current) {
      setActiveGiftState(null);
      setFloatingGifts([]);
    }
  }, []);

  const enqueueGift = useCallback((event: LiveGiftPresentationEvent) => {
    if (!mountedRef.current || !sessionId || event.sessionId !== sessionId) return false;
    if (!isGiftPresentationEventFresh(event)) return false;

    const result = queueRef.current.enqueue(event);
    if (!result.accepted) {
      if (result.reason === 'capacity' && event.costCoins >= 10_000) {
        console.warn('[LIVE-GIFT-PRESENTATION] legendary_capacity', event.eventId);
      }
      return false;
    }

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
      return true;
    }

    playNext();
    return true;
  }, [playNext, sessionId, setManagedTimeout]);

  useEffect(() => {
    resetGiftAnimations();
  }, [sessionId, resetGiftAnimations]);

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
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      queue.cancel();
      activeRef.current = null;
      compactRef.current = [];
    };
  }, []);

  return { activeGift, floatingGifts, reducedMotion, enqueueGift, resetGiftAnimations };
}
