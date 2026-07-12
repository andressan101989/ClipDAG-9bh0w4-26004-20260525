import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveGiftAnimationType, LiveGiftCategory, LiveGiftEvent } from '@/types/liveGifts';

const MAX_SEEN = 100;
const MAX_QUEUE = 20;
const MAX_FLOATING = 10;
const MAX_EVENT_AGE_MS = 15_000;
const MIN_DURATION_MS = 800;
const MAX_DURATION_MS = 15_000;

const VALID_CATEGORIES = new Set<LiveGiftCategory>(['basic', 'premium', 'legendary']);
const VALID_ANIMATION_TYPES = new Set<LiveGiftAnimationType>(['floating', 'center', 'fullscreen', 'entrance', 'celebration']);

function clampDuration(value: number) {
  if (!Number.isFinite(value)) return 1800;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(value)));
}

function normalizeGiftEvent(event: LiveGiftEvent, currentSessionId?: string | null): LiveGiftEvent | null {
  if (!event.transactionId) return null;
  if (!event.sessionId || (currentSessionId && event.sessionId !== currentSessionId)) return null;
  if (!Number.isFinite(event.createdAt) || Date.now() - event.createdAt > MAX_EVENT_AGE_MS) return null;
  if (!Number.isFinite(event.amountBdag) || event.amountBdag <= 0) return null;

  const category = VALID_CATEGORIES.has(event.category) ? event.category : 'basic';
  const animationType = VALID_ANIMATION_TYPES.has(event.animationType) ? event.animationType : 'floating';

  return {
    ...event,
    category,
    animationType,
    amountBdag: Number(event.amountBdag),
    durationMs: clampDuration(Number(event.durationMs)),
    priority: Number.isFinite(event.priority) ? Math.max(0, Math.round(event.priority)) : 0,
    icon: event.icon || '\uD83C\uDF81',
    giftName: event.giftName || event.giftId || 'Regalo',
  };
}

export function useLiveGiftAnimations(sessionId?: string | null) {
  const mountedRef = useRef(true);
  const seenRef = useRef<string[]>([]);
  const activeRef = useRef<LiveGiftEvent | null>(null);
  const queueRef = useRef<LiveGiftEvent[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [activeGift, setActiveGiftState] = useState<LiveGiftEvent | null>(null);
  const [floatingGifts, setFloatingGifts] = useState<LiveGiftEvent[]>([]);

  const setManagedTimeout = useCallback((fn: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, delayMs);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const setActiveGift = useCallback((gift: LiveGiftEvent | null) => {
    activeRef.current = gift;
    if (mountedRef.current) setActiveGiftState(gift);
  }, []);

  const resetGiftAnimations = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
    queueRef.current = [];
    seenRef.current = [];
    activeRef.current = null;
    if (mountedRef.current) {
      setActiveGiftState(null);
      setFloatingGifts([]);
    }
  }, []);

  const markSeen = useCallback((key: string) => {
    if (seenRef.current.includes(key)) return false;
    seenRef.current = [key, ...seenRef.current].slice(0, MAX_SEEN);
    return true;
  }, []);

  const playNext = useCallback(() => {
    if (!mountedRef.current || activeRef.current || queueRef.current.length === 0) return;
    const sorted = [...queueRef.current].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    const [next, ...rest] = sorted;
    queueRef.current = rest;
    setActiveGift(next);

    setManagedTimeout(() => {
      if (!mountedRef.current) return;
      setActiveGift(null);
      setManagedTimeout(playNext, 80);
    }, next.durationMs);
  }, [setActiveGift, setManagedTimeout]);

  const enqueueGift = useCallback((incoming: LiveGiftEvent) => {
    const event = normalizeGiftEvent(incoming, sessionId);
    if (!event) return false;
    if (!markSeen(event.transactionId)) return false;

    if (event.animationType === 'floating' && event.priority < 20) {
      setFloatingGifts(prev => [event, ...prev].slice(0, MAX_FLOATING));
      setManagedTimeout(() => {
        if (!mountedRef.current) return;
        setFloatingGifts(prev => prev.filter(item => item.transactionId !== event.transactionId));
      }, event.durationMs);
      return true;
    }

    queueRef.current = [event, ...queueRef.current]
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, MAX_QUEUE);
    playNext();
    return true;
  }, [markSeen, playNext, sessionId, setManagedTimeout]);

  useEffect(() => {
    if (!activeGift) playNext();
  }, [activeGift, playNext]);

  useEffect(() => {
    resetGiftAnimations();
  }, [sessionId, resetGiftAnimations]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      queueRef.current = [];
      seenRef.current = [];
      activeRef.current = null;
    };
  }, []);

  return { activeGift, floatingGifts, enqueueGift, resetGiftAnimations };
}
