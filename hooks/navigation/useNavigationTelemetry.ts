/**
 * hooks/navigation/useNavigationTelemetry.ts — Navigation tracing hook
 *
 * Automatically:
 *   - Records mount/unmount timing to TelemetryPipeline
 *   - Adds CrashIntelligence breadcrumbs for route navigation
 *   - Tracks time-to-interactive for each screen
 *   - Detects slow mounts (>300ms) and logs as warning
 *   - Cleans up screen resources on unmount via MediaCleanupManager
 *   - Suspends inactive screens' render surfaces (if registered)
 *
 * Usage:
 *   export default function FeedScreen() {
 *     useNavigationTelemetry('FeedScreen');
 *     ...
 *   }
 */

import { useEffect, useRef } from 'react';
import { TelemetryPipeline } from '@/modules/core/TelemetryPipeline';
import { CrashIntelligence } from '@/modules/core/CrashIntelligence';
import { MediaCleanupManager } from '@/modules/media/MediaCleanupManager';
import { Diagnostics }        from '@/modules/core/Diagnostics';

const SLOW_MOUNT_THRESHOLD_MS = 300;

export function useNavigationTelemetry(screenName: string) {
  const mountTime = useRef(performance.now());
  const readyTime = useRef<number | null>(null);

  useEffect(() => {
    const mounted = performance.now();
    mountTime.current = mounted;

    CrashIntelligence.addBreadcrumb('navigation', `Mounted: ${screenName}`);
    Diagnostics.recordScreenView?.(screenName);

    return () => {
      const unmounted   = performance.now();
      const lifetimeMs  = unmounted - mountTime.current;
      const mountMs     = (readyTime.current ?? unmounted) - mountTime.current;
      const loadMs      = readyTime.current ? readyTime.current - mountTime.current : 0;

      // Record nav timing
      TelemetryPipeline.recordNavTiming(screenName, mountMs, loadMs);

      // Detect slow mount
      if (mountMs > SLOW_MOUNT_THRESHOLD_MS) {
        console.warn(
          `[NavigationTelemetry] SLOW MOUNT: ${screenName} took ${mountMs.toFixed(0)}ms`,
        );
        CrashIntelligence.addBreadcrumb(
          'navigation',
          `Slow mount: ${screenName} (${mountMs.toFixed(0)}ms)`,
        );
      }

      CrashIntelligence.addBreadcrumb(
        'navigation',
        `Unmounted: ${screenName} (alive ${(lifetimeMs / 1000).toFixed(1)}s)`,
      );

      // Trigger screen-level media cleanup on unmount
      MediaCleanupManager.cleanup('screen');
    };
  }, [screenName]);

  /**
   * Call this when the screen has finished loading its primary content.
   * Provides accurate time-to-interactive measurement.
   */
  const markReady = () => {
    if (readyTime.current !== null) return;
    readyTime.current = performance.now();
    const tti = readyTime.current - mountTime.current;
    TelemetryPipeline.recordNavTiming(screenName, tti, tti);
    if (tti > SLOW_MOUNT_THRESHOLD_MS) {
      console.warn(`[NavigationTelemetry] SLOW TTI: ${screenName} ${tti.toFixed(0)}ms`);
    }
  };

  return { markReady };
}
