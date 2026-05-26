/**
 * hooks/core/useEventBus.ts — React hook for EventBus subscriptions
 *
 * Automatically unsubscribes on component unmount.
 *
 * Usage:
 *   // Listen to a single event
 *   useEventBus('wallet:balance_updated', ({ balance }) => {
 *     setBalance(balance);
 *   });
 *
 *   // Listen and derive state
 *   const isConnected = useEventBusState(
 *     'wallet:connected',
 *     'wallet:disconnected',
 *     false,
 *     () => true,   // connected → true
 *     () => false,  // disconnected → false
 *   );
 */

import { useEffect, useRef } from 'react';
import { EventBus }          from '@/modules/core/EventBus';
import type { AppEventName, AppEvents } from '@/modules/core/EventBus';

type Listener<E extends AppEventName> =
  AppEvents[E] extends void
    ? () => void
    : (payload: AppEvents[E]) => void;

/**
 * Subscribe to an EventBus event for the lifetime of the component.
 * The listener ref is updated on every render so you can safely use
 * up-to-date state/props inside the callback without stale closures.
 */
export function useEventBus<E extends AppEventName>(
  event:    E,
  listener: Listener<E>,
): void {
  // Keep latest listener in a ref — avoids re-subscribing on every render
  const listenerRef = useRef<Listener<E>>(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const stable = ((...args: any[]) => (listenerRef.current as any)(...args)) as Listener<E>;
    return EventBus.on(event, stable);
  }, [event]); // Only re-subscribe if event name changes
}

/**
 * Emit an event from a component.
 * Returns a stable function that won't change between renders.
 */
export function useEmit<E extends AppEventName>(
  event: E,
): AppEvents[E] extends void ? () => void : (payload: AppEvents[E]) => void {
  return useRef((...args: any[]) => (EventBus.emit as any)(event, ...args)).current as any;
}
