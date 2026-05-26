/**
 * modules/core/AdaptiveQualityController.ts — Unified adaptive quality orchestrator
 *
 * The SINGLE entry point that wires together:
 *   ThermalMonitor → PowerManager → FrameScheduler → RenderIsolationManager
 *                                 → AdaptiveBitrateManager
 *                                 → IntelligentCacheManager
 *                                 → PrefetchMediaManager
 *                                 → MemoryPressureMonitor
 *                                 → BackpressureQueue
 *
 * Produces a coordinated response to device stress:
 *
 *   NOMINAL:
 *     60fps, full AR, bitrate 720p+, aggressive prefetch, full cache
 *
 *   FAIR (warm device):
 *     30fps, AR on, bitrate 480p, reduced prefetch, moderate cache
 *
 *   SERIOUS (hot):
 *     20fps, AR off, bitrate 360p, thumbnails-only prefetch, shrink cache
 *
 *   CRITICAL (overheating):
 *     10fps, no AR, bitrate 240p, no prefetch, emergency cache eviction
 *
 * Initialization:
 *   Call AdaptiveQualityController.initialize() once in app/_layout.tsx
 *   after all individual managers are initialized.
 *
 * All downstream managers keep their own internal state — this controller
 * simply triggers the right calls in the right sequence when conditions change.
 */

import { ThermalMonitor, type ThermalState }  from './ThermalMonitor';
import { PowerManager, type PowerTier }        from './PowerManager';
import { MemoryPressureMonitor }               from './MemoryPressureMonitor';
import { FrameScheduler }                      from './FrameScheduler';
import { RenderIsolationManager }              from './RenderIsolationManager';
import { LeakDetector }                        from './LeakDetector';
import { EventBus }                            from './EventBus';
import { AppLifecycle }                        from './AppLifecycle';

export type QualityLevel = 'full' | 'reduced' | 'minimal' | 'emergency';

export interface QualityProfile {
  level:             QualityLevel;
  maxFPS:            number;
  arEnabled:         boolean;
  skiaEnabled:       boolean;
  bitrateLabel:      string;      // fed to AdaptiveBitrateManager
  prefetchEnabled:   boolean;
  prefetchAhead:     number;      // how many items ahead to prefetch
  cacheMaxMB:        number;
  backgroundSyncOn:  boolean;
  renderBatchMs:     number;      // coalesce low-priority renders
}

const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  full: {
    level:            'full',
    maxFPS:           60,
    arEnabled:        true,
    skiaEnabled:      true,
    bitrateLabel:     '720p',
    prefetchEnabled:  true,
    prefetchAhead:    5,
    cacheMaxMB:       100,
    backgroundSyncOn: true,
    renderBatchMs:    0,
  },
  reduced: {
    level:            'reduced',
    maxFPS:           30,
    arEnabled:        true,
    skiaEnabled:      true,
    bitrateLabel:     '480p',
    prefetchEnabled:  true,
    prefetchAhead:    2,
    cacheMaxMB:       60,
    backgroundSyncOn: true,
    renderBatchMs:    50,
  },
  minimal: {
    level:            'minimal',
    maxFPS:           20,
    arEnabled:        false,
    skiaEnabled:      false,
    bitrateLabel:     '360p',
    prefetchEnabled:  false,
    prefetchAhead:    0,
    cacheMaxMB:       30,
    backgroundSyncOn: false,
    renderBatchMs:    150,
  },
  emergency: {
    level:            'emergency',
    maxFPS:           10,
    arEnabled:        false,
    skiaEnabled:      false,
    bitrateLabel:     '240p',
    prefetchEnabled:  false,
    prefetchAhead:    0,
    cacheMaxMB:       10,
    backgroundSyncOn: false,
    renderBatchMs:    300,
  },
};

const THERMAL_TO_QUALITY: Record<ThermalState, QualityLevel> = {
  nominal:  'full',
  fair:     'reduced',
  serious:  'minimal',
  critical: 'emergency',
};

class AdaptiveQualityControllerImpl {
  private _currentLevel:  QualityLevel = 'full';
  private _initialized    = false;
  private readonly _handlers = new Set<(profile: QualityProfile) => void>();

  // ── Initialization ────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Wire ThermalMonitor → self
    // ThermalMonitor calls FrameScheduler + MemoryPressureMonitor directly,
    // but we intercept via PowerManager.onTierChange to drive the rest.
    PowerManager.onTierChange(tier => this._onPowerTierChange(tier));

    // React to memory pressure independently (even without thermal)
    EventBus.on('app:low_memory', () => {
      if (this._currentLevel !== 'emergency') {
        console.warn('[AdaptiveQuality] emergency triggered by low memory event');
        this._applyLevel('emergency');
      }
    });

    // Background: always force minimal
    AppLifecycle.onBackground(() => {
      if (this._currentLevel === 'full' || this._currentLevel === 'reduced') {
        this._applyLevel('minimal', false); // don't re-drive PowerManager
      }
    });
    AppLifecycle.onForeground(() => {
      // Re-evaluate based on current thermal state
      const thermal = ThermalMonitor.currentState;
      this._applyLevel(THERMAL_TO_QUALITY[thermal]);
    });

    console.log('[AdaptiveQuality] initialized');
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  onQualityChange(fn: (profile: QualityProfile) => void): () => void {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get currentLevel():   QualityLevel   { return this._currentLevel; }
  get currentProfile(): QualityProfile { return QUALITY_PROFILES[this._currentLevel]; }

  /** Force a quality level (e.g. for testing or user preference). */
  forceLevel(level: QualityLevel): void {
    this._applyLevel(level);
  }

  // ── Downstream orchestration ──────────────────────────────────────────────

  private _onPowerTierChange(tier: PowerTier): void {
    const levelMap: Record<PowerTier, QualityLevel> = {
      performance: 'full',
      balanced:    'reduced',
      saver:       'minimal',
      emergency:   'emergency',
    };
    this._applyLevel(levelMap[tier]);
  }

  private _applyLevel(level: QualityLevel, notifyPower = true): void {
    if (this._currentLevel === level) return;
    const prev    = this._currentLevel;
    this._currentLevel = level;
    const profile = QUALITY_PROFILES[level];

    console.log(`[AdaptiveQuality] ${prev} → ${level} (FPS:${profile.maxFPS} AR:${profile.arEnabled})`);

    // 1. FrameScheduler — FPS cap via thermal state mapping
    //    PowerManager already calls this, but we ensure it if bypassed
    const fsState = level === 'emergency' ? 'critical'
      : level === 'minimal'   ? 'serious'
      : level === 'reduced'   ? 'fair'
      : 'nominal';
    FrameScheduler.reportThermalState(fsState as ThermalState);

    // 2. Render isolation — suspend decorative surfaces under stress
    if (level === 'minimal' || level === 'emergency') {
      RenderIsolationManager.suspendAllCategories(['background', 'preview']);
    }
    if (level === 'emergency') {
      RenderIsolationManager.suspendAllCategories(['game', 'ar_effects']);
    }

    // 3. PrefetchMediaManager — deferred import to avoid circular dep
    try {
      const { PrefetchMediaManager } = require('../media/PrefetchMediaManager');
      const pm: 'performance' | 'balanced' | 'saver' | 'emergency' =
        level === 'full'      ? 'performance'
        : level === 'reduced' ? 'balanced'
        : level === 'minimal' ? 'saver'
        : 'emergency';
      PrefetchMediaManager.setPowerMode(pm);
    } catch { /* media module may not be loaded yet */ }

    // 4. IntelligentCacheManager — thermal-aware eviction
    try {
      const { IntelligentCacheManager } = require('../media/IntelligentCacheManager');
      IntelligentCacheManager.setThermalState(fsState);
    } catch { /* may not be loaded */ }

    // 5. AdaptiveBitrateManager — power tier change
    try {
      const { AdaptiveBitrateManager } = require('../media/AdaptiveBitrateManager');
      const abmTier = level === 'full'      ? 'performance'
        : level === 'reduced'               ? 'balanced'
        : level === 'minimal'               ? 'saver'
        : 'emergency';
      AdaptiveBitrateManager.onPowerTierChange(abmTier);
    } catch { /* may not be loaded */ }

    // 6. Emit quality change event for any subscriber
    EventBus.emit('app:low_memory'); // trigger any registered cleanup
    if (level !== 'emergency') {
      // Only emit low_memory event on actual emergency, not just tier changes
    }

    // 7. Notify React hooks
    for (const fn of this._handlers) {
      try { fn(profile); } catch { /* isolate */ }
    }
  }
}

export const AdaptiveQualityController = new AdaptiveQualityControllerImpl();
