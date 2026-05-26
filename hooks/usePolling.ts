/**
 * hooks/usePolling.ts — Thin hook wrapper around PollingManager
 *
 * Enforces architecture rule: app/ and components/ must not import
 * from @/modules/realtime directly.
 *
 * Screens import this hook; the hook owns the module boundary.
 */

import { useEffect, useRef } from 'react';
import { PollingManager } from '@/modules/realtime/PollingManager';

export interface PollingOptions {
  /** Unique key — must be stable across renders (e.g. `chat:${userId}`) */
  key: string;
  /** Poll interval in milliseconds */
  intervalMs: number;
  /** Async function that runs on each tick */
  fn: () => void | Promise<void>;
  /** If true, runs immediately on registration (default: false) */
  runImmediately?: boolean;
}

/**
 * Registers a polling job while the component is mounted.
 * Automatically unregisters on unmount.
 * Pauses when the app goes to background (via PollingManager).
 */
export function usePolling(options: PollingOptions): void {
  // Keep fn ref stable so callers don't need to memoize
  const fnRef = useRef(options.fn);
  fnRef.current = options.fn;

  useEffect(() => {
    const { key, intervalMs, runImmediately = false } = options;
    PollingManager.register({
      key,
      intervalMs,
      runImmediately,
      fn: () => fnRef.current(),
    });
    return () => { PollingManager.unregister(key); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.key, options.intervalMs]);
}
