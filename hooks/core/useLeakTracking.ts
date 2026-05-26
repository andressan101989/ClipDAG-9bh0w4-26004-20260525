/**
 * hooks/core/useLeakTracking.ts — React hook for leak-safe resource tracking
 *
 * Tracks all resources registered in a component and auto-releases
 * everything on unmount. Wraps LeakDetector.track/release.
 *
 * Usage:
 *   function MyComponent() {
 *     const { track, releaseAll } = useLeakTracking('MyComponent');
 *     useEffect(() => {
 *       const token = track('listener', 'auth-listener');
 *       const unsub = EventBus.subscribe('auth', handler);
 *       return () => { unsub(); releaseAll(); };
 *     }, []);
 *   }
 */

import { useRef, useEffect, useCallback } from 'react';
import { LeakDetector, type LeakResourceType } from '@/modules/core/LeakDetector';

export function useLeakTracking(componentName: string): {
  track:      (type: LeakResourceType, key: string) => string;
  release:    (token: string) => void;
  releaseAll: () => void;
} {
  const tokens = useRef<string[]>([]);

  const track = useCallback((type: LeakResourceType, key: string): string => {
    const token = LeakDetector.track(type, key, componentName);
    tokens.current.push(token);
    return token;
  }, [componentName]);

  const release = useCallback((token: string): void => {
    LeakDetector.release(token);
    tokens.current = tokens.current.filter(t => t !== token);
  }, []);

  const releaseAll = useCallback((): void => {
    LeakDetector.releaseAll(tokens.current);
    tokens.current = [];
  }, []);

  // Auto-release on unmount
  useEffect(() => {
    return () => {
      if (tokens.current.length > 0) {
        console.warn(
          `[useLeakTracking] "${componentName}" unmounted with ${tokens.current.length} unreleased resources`
        );
        LeakDetector.releaseAll(tokens.current);
        tokens.current = [];
      }
    };
  }, [componentName]);

  return { track, release, releaseAll };
}
