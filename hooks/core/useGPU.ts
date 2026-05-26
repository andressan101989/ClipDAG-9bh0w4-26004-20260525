/**
 * hooks/core/useGPU.ts — React hook for GPU resource management
 *
 * Wraps GPUManager for use in React components:
 *   - Acquire/release render slots safely with cleanup on unmount
 *   - Track textures that are auto-freed on unmount
 *   - AR session lock management
 *   - Subscribe to GPU report for diagnostic display
 *
 * Usage:
 *   function AREffectsLayer() {
 *     const { acquireSlot, trackTexture, freeTexture, arLock } = useGPU('AREffects');
 *     useEffect(() => {
 *       acquireSlot('high').then(slot => { ... });
 *       const ok = arLock.acquire();
 *       return () => { arLock.release(); };
 *     }, []);
 *   }
 */

import { useRef, useEffect, useCallback } from 'react';
import { GPUManager } from '@/modules/core/GPUManager';
import type { GPURenderSlot, GPURenderPriority } from '@/modules/core/GPUManager';

export function useGPU(componentName: string) {
  const slots    = useRef<GPURenderSlot[]>([]);
  const textures = useRef<string[]>([]);
  const hasARLock = useRef(false);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      for (const slot of slots.current) {
        try { slot.release(); } catch { /* ignore */ }
      }
      slots.current = [];

      for (const key of textures.current) {
        try { GPUManager.freeTexture(key); } catch { /* ignore */ }
      }
      textures.current = [];

      if (hasARLock.current) {
        GPUManager.releaseARSession(componentName);
        hasARLock.current = false;
      }
    };
  }, [componentName]);

  const acquireSlot = useCallback(async (priority: GPURenderPriority = 'normal'): Promise<GPURenderSlot> => {
    const slot = await GPUManager.acquireRenderSlot(componentName, priority);
    slots.current.push(slot);
    return slot;
  }, [componentName]);

  const releaseSlot = useCallback((slot: GPURenderSlot): void => {
    slot.release();
    slots.current = slots.current.filter(s => s.id !== slot.id);
  }, []);

  const trackTexture = useCallback((
    key:            string,
    sizeEstimateKB: number,
    ttlMs?:         number,
    onEvict?:       () => void,
  ): void => {
    GPUManager.trackTexture(key, componentName, sizeEstimateKB, ttlMs, onEvict);
    textures.current.push(key);
  }, [componentName]);

  const freeTexture = useCallback((key: string): void => {
    GPUManager.freeTexture(key);
    textures.current = textures.current.filter(k => k !== key);
  }, []);

  const arLock = {
    acquire: useCallback((): boolean => {
      const ok = GPUManager.acquireARSession(componentName);
      if (ok) hasARLock.current = true;
      return ok;
    }, [componentName]),
    release: useCallback((): void => {
      if (hasARLock.current) {
        GPUManager.releaseARSession(componentName);
        hasARLock.current = false;
      }
    }, [componentName]),
    active: hasARLock.current,
  };

  return { acquireSlot, releaseSlot, trackTexture, freeTexture, arLock };
}
