/**
 * hooks/core/useCleanup.ts — Declarative cleanup utility for React hooks
 *
 * Simplifies the pattern of registering multiple cleanup functions
 * that all need to run on unmount, with optional AppLifecycle integration.
 *
 * Usage:
 *   const { add, addInterval, addTimeout } = useCleanup();
 *
 *   // Runs on unmount:
 *   add(() => subscription.unsubscribe());
 *
 *   // setInterval with auto-cleanup:
 *   addInterval(() => fetchData(), 5000);
 *
 *   // setTimeout with auto-cleanup:
 *   addTimeout(() => showToast(), 2000);
 */

import { useEffect, useRef, useCallback } from 'react';
import { PollingManager } from '@/modules/realtime/PollingManager';
import type { PollConfig } from '@/modules/realtime/PollingManager';

type CleanupFn = () => void;

export function useCleanup() {
  const cleanups = useRef<CleanupFn[]>([]);

  useEffect(() => {
    return () => {
      for (const fn of cleanups.current) {
        try { fn(); } catch { /* ignore */ }
      }
      cleanups.current = [];
    };
  }, []);

  /** Register any cleanup function. Runs on unmount. */
  const add = useCallback((fn: CleanupFn): void => {
    cleanups.current.push(fn);
  }, []);

  /**
   * Create a setInterval that auto-clears on unmount.
   * Returns the interval ID.
   */
  const addInterval = useCallback((fn: () => void, ms: number): ReturnType<typeof setInterval> => {
    const id = setInterval(fn, ms);
    cleanups.current.push(() => clearInterval(id));
    return id;
  }, []);

  /**
   * Create a setTimeout that auto-clears on unmount.
   * Returns the timeout ID.
   */
  const addTimeout = useCallback((fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = setTimeout(fn, ms);
    cleanups.current.push(() => clearTimeout(id));
    return id;
  }, []);

  /**
   * Register a PollingManager poll that auto-unregisters on unmount.
   * Preferred over addInterval for data-fetching.
   */
  const addPoll = useCallback((config: PollConfig): void => {
    PollingManager.register(config);
    cleanups.current.push(() => PollingManager.unregister(config.key));
  }, []);

  return { add, addInterval, addTimeout, addPoll };
}
