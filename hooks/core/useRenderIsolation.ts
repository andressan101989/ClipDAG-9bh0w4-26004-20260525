/**
 * hooks/core/useRenderIsolation.ts — React hook for RenderIsolationManager
 *
 * Registers a render surface on mount, unregisters on unmount.
 * Returns shouldRender and frameComplete callbacks.
 *
 * Usage:
 *   const { shouldRender, frameComplete } = useRenderIsolation('deepar', 'ar_effects', 60);
 */

import { useEffect, useCallback } from 'react';
import { RenderIsolationManager, type RenderCategory } from '@/modules/core/RenderIsolationManager';

export function useRenderIsolation(
  id:       string,
  category: RenderCategory,
  fps:      number,
  scene     = 'default',
): {
  shouldRender:  () => boolean;
  frameComplete: (renderTimeMs: number) => void;
  setVisible:    (visible: boolean) => void;
} {
  useEffect(() => {
    RenderIsolationManager.registerSurface(id, category, fps, scene);
    return () => {
      RenderIsolationManager.unregisterSurface(id);
    };
  }, [id, category, fps, scene]);

  const shouldRender  = useCallback(() => RenderIsolationManager.shouldRender(id), [id]);
  const frameComplete = useCallback((ms: number) => RenderIsolationManager.frameComplete(id, ms), [id]);
  const setVisible    = useCallback((v: boolean) => RenderIsolationManager.setViewportVisible(id, v), [id]);

  return { shouldRender, frameComplete, setVisible };
}
