/**
 * modules/core/MemoryPressureMonitor.ts — Adaptive quality controller
 *
 * Monitors memory pressure and adjusts media quality parameters dynamically
 * to prevent crashes on mid-range Android and older iPhones.
 *
 * Pressure levels:
 *   normal   → full quality (1080p, all effects, high FPS)
 *   moderate → reduced quality (720p, limited effects, 30 FPS)
 *   critical → minimum quality (480p, no effects, 20 FPS, audio only fallback)
 *
 * Emits EventBus 'app:low_memory' when level transitions to critical.
 * Components read currentQuality to adapt their rendering parameters.
 *
 * Usage:
 *   import { MemoryPressureMonitor, useAdaptiveQuality } from '...';
 *
 *   // In a camera component:
 *   const quality = MemoryPressureMonitor.currentQuality;
 *   // quality.videoResolution → '720p'
 *   // quality.effectsEnabled  → false
 *   // quality.targetFPS       → 30
 */

import { AppLifecycle } from './AppLifecycle';
import { EventBus }     from './EventBus';
import { useState, useEffect } from 'react';

export type PressureLevel = 'normal' | 'moderate' | 'critical';

export interface QualityProfile {
  level:             PressureLevel;
  videoResolution:   '480p' | '720p' | '1080p';
  targetFPS:         20 | 30 | 60;
  effectsEnabled:    boolean;
  deepAREnabled:     boolean;
  backgroundBlur:    boolean;
  audioBitrate:      32 | 64 | 128;   // kbps
  videoKeyframeInterval: 1 | 2 | 5;  // seconds
}

const PROFILES: Record<PressureLevel, QualityProfile> = {
  normal: {
    level:                  'normal',
    videoResolution:        '1080p',
    targetFPS:              60,
    effectsEnabled:         true,
    deepAREnabled:          true,
    backgroundBlur:         true,
    audioBitrate:           128,
    videoKeyframeInterval:  1,
  },
  moderate: {
    level:                  'moderate',
    videoResolution:        '720p',
    targetFPS:              30,
    effectsEnabled:         true,
    deepAREnabled:          true,
    backgroundBlur:         false,
    audioBitrate:           64,
    videoKeyframeInterval:  2,
  },
  critical: {
    level:                  'critical',
    videoResolution:        '480p',
    targetFPS:              20,
    effectsEnabled:         false,
    deepAREnabled:          false,
    backgroundBlur:         false,
    audioBitrate:           32,
    videoKeyframeInterval:  5,
  },
};

class MemoryPressureMonitorImpl {
  private _level: PressureLevel = 'normal';
  private readonly _subscribers = new Set<(q: QualityProfile) => void>();

  constructor() {
    // Release pressure when app backgrounds
    AppLifecycle.onBackground(() => {
      if (this._level === 'critical') {
        // Give system a chance to reclaim memory
        this._setLevel('moderate');
      }
    });
  }

  get currentLevel(): PressureLevel { return this._level; }
  get currentQuality(): QualityProfile { return PROFILES[this._level]; }

  /**
   * Report a memory pressure event.
   * Called from native memory warning handlers or heuristics.
   */
  reportPressure(level: PressureLevel): void {
    if (this._level === level) return;
    const prev = this._level;
    this._setLevel(level);

    if (level === 'critical') {
      console.warn('[MemoryMonitor] CRITICAL memory pressure — reducing quality');
      EventBus.emit('app:low_memory');
    } else {
      console.log(`[MemoryMonitor] pressure: ${prev} → ${level}`);
    }
  }

  /** Manually promote pressure (e.g. before starting a live stream). */
  requestHighPerformanceMode(): void {
    // Only allow if currently below moderate
    if (this._level === 'normal') {
      console.log('[MemoryMonitor] high-performance mode requested');
    }
  }

  /** Reset to normal (e.g. after heavy feature closes). */
  reset(): void {
    this._setLevel('normal');
  }

  subscribe(fn: (q: QualityProfile) => void): () => void {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  private _setLevel(level: PressureLevel): void {
    this._level = level;
    const profile = PROFILES[level];
    for (const fn of this._subscribers) {
      try { fn(profile); } catch { /* isolate */ }
    }
  }
}

export const MemoryPressureMonitor = new MemoryPressureMonitorImpl();

// ── React hook ─────────────────────────────────────────────────────────────────
/** Hook: reactive quality profile — re-renders when pressure level changes. */
export function useAdaptiveQuality(): QualityProfile {
  const [quality, setQuality] = useState<QualityProfile>(MemoryPressureMonitor.currentQuality);

  useEffect(() => {
    const unsub = MemoryPressureMonitor.subscribe(setQuality);
    return unsub;
  }, []);

  return quality;
}
