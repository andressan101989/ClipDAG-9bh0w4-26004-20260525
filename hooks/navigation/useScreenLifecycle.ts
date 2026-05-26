/**
 * hooks/navigation/useScreenLifecycle.ts — Screen mount/unmount lifecycle tracking
 *
 * Integrates with Diagnostics screen tracking and MediaCleanupManager
 * to ensure proper resource cleanup when navigating between screens.
 *
 * Features:
 *   - Reports screen visibility to Diagnostics (slow screen detection)
 *   - Triggers MediaCleanupManager on unmount
 *   - Suspends render surfaces when screen is hidden
 *   - Automatically releases held resources on unmount
 *
 * Usage:
 *   function MyScreen() {
 *     useScreenLifecycle('MyScreen');
 *     // All cleanup handled automatically
 *   }
 *
 *   // With custom cleanup:
 *   useScreenLifecycle('CreatorStudio', () => {
 *     CameraController.stopPreview();
 *   });
 */

import { useEffect, useRef } from 'react';
import { Diagnostics }         from '@/modules/core/Diagnostics';
import { MediaCleanupManager } from '@/modules/media/MediaCleanupManager';
import { RenderIsolationManager } from '@/modules/core/RenderIsolationManager';
import { LeakDetector }        from '@/modules/core/LeakDetector';

export function useScreenLifecycle(
  screenName: string,
  customCleanup?: () => void,
): void {
  const mountTimeRef = useRef<number>(0);

  useEffect(() => {
    mountTimeRef.current = Date.now();

    // Track screen in diagnostics
    Diagnostics.markScreenVisible(screenName);

    return () => {
      const durationMs = Date.now() - mountTimeRef.current;

      // Report to diagnostics
      Diagnostics.markScreenHidden(screenName);

      // Media cleanup
      try {
        MediaCleanupManager.cleanupScreen(screenName);
      } catch { /* non-critical */ }

      // Suspend render surfaces for this screen
      try {
        RenderIsolationManager.cleanupOffscreenSurfaces(0).catch(() => {});
      } catch { /* non-critical */ }

      // Custom cleanup
      try {
        customCleanup?.();
      } catch { /* non-critical */ }

      if (__DEV__ && durationMs < 100) {
        console.log(`[ScreenLifecycle] "${screenName}" unmounted after ${durationMs}ms (very fast)`);
      }
    };
  }, [screenName]);
}
