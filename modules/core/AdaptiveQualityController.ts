/**
 * modules/core/AdaptiveQualityController.ts — v2 Unified adaptive quality orchestrator
 *
 * Phase 4 additions:
 *   - forceQualityLevel(null) restores to thermal-derived level (was missing)
 *   - Removed rogue EventBus.emit('app:low_memory') on every tier change
 *   - forceLevel() alias kept for internal callers
 *   - forceQualityLevel() is the external API used by ProductionStabilityMode
 *   - _applyLevel() wraps all downstream calls in try/catch (no propagating throws)
 *   - getProfile() returns current profile (used by LiveOrchestrator health compute)
 */

import { ThermalMonitor, type ThermalState }  from './ThermalMonitor';
import { PowerManager, type PowerTier }        from './PowerManager';
import { MemoryPressureMonitor }               from './MemoryPressureMonitor';
import { FrameScheduler }                      from './FrameScheduler';
import { RenderIsolationManager }              from './RenderIsolationManager';
import { EventBus }                            from './EventBus';
import { AppLifecycle }                        from './AppLifecycle';

export type QualityLevel = 'full' | 'reduced' | 'minimal' | 'emergency';

export interface QualityProfile {
  level:            QualityLevel;
  maxFPS:           number;
  arEnabled:        boolean;
  skiaEnabled:      boolean;
  bitrateLabel:     string;
  prefetchEnabled:  boolean;
  prefetchAhead:    number;
  cacheMaxMB:       number;
  backgroundSyncOn: boolean;
  renderBatchMs:    number;
}

const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  full: {
    level: 'full', maxFPS: 60, arEnabled: true, skiaEnabled: true,
    bitrateLabel: '720p', prefetchEnabled: true, prefetchAhead: 5,
    cacheMaxMB: 100, backgroundSyncOn: true, renderBatchMs: 0,
  },
  reduced: {
    level: 'reduced', maxFPS: 30, arEnabled: true, skiaEnabled: true,
    bitrateLabel: '480p', prefetchEnabled: true, prefetchAhead: 2,
    cacheMaxMB: 60, backgroundSyncOn: true, renderBatchMs: 50,
  },
  minimal: {
    level: 'minimal', maxFPS: 20, arEnabled: false, skiaEnabled: false,
    bitrateLabel: '360p', prefetchEnabled: false, prefetchAhead: 0,
    cacheMaxMB: 30, backgroundSyncOn: false, renderBatchMs: 150,
  },
  emergency: {
    level: 'emergency', maxFPS: 10, arEnabled: false, skiaEnabled: false,
    bitrateLabel: '240p', prefetchEnabled: false, prefetchAhead: 0,
    cacheMaxMB: 10, backgroundSyncOn: false, renderBatchMs: 300,
  },
};

const THERMAL_TO_QUALITY: Record<ThermalState, QualityLevel> = {
  nominal:  'full',
  fair:     'reduced',
  serious:  'minimal',
  critical: 'emergency',
};

class AdaptiveQualityControllerImpl {
  private _currentLevel:     QualityLevel = 'full';
  private _overrideLevel:    QualityLevel | null = null;
  private _initialized       = false;
  private readonly _handlers = new Set<(profile: QualityProfile) => void>();

  // ── Initialization ────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    PowerManager.onTierChange(tier => this._onPowerTierChange(tier));

    EventBus.on('app:low_memory', () => {
      // Only escalate from this event if not already overridden
      if (!this._overrideLevel && this._currentLevel !== 'emergency') {
        console.warn('[AdaptiveQuality] emergency triggered by low memory event');
        this._applyLevel('emergency');
      }
    });

    AppLifecycle.onBackground(() => {
      if (this._currentLevel === 'full' || this._currentLevel === 'reduced') {
        this._applyLevel('minimal', false);
      }
    });

    AppLifecycle.onForeground(() => {
      if (!this._overrideLevel) {
        const thermal = ThermalMonitor.currentState;
        this._applyLevel(THERMAL_TO_QUALITY[thermal]);
      }
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

  /** Returns current profile (used by LiveOrchestrator health computation). */
  getProfile(): QualityProfile { return QUALITY_PROFILES[this._currentLevel]; }

  /** Force a quality level. Pass null to clear the override and restore thermal-driven level. */
  forceQualityLevel(level: QualityLevel | null): void {
    if (level === null) {
      this._overrideLevel = null;
      // Restore to thermal-driven level
      const thermal = ThermalMonitor.currentState;
      this._applyLevel(THERMAL_TO_QUALITY[thermal]);
      return;
    }
    this._overrideLevel = level;
    this._applyLevel(level);
  }

  /** Alias for backwards compat. */
  forceLevel(level: QualityLevel): void {
    this.forceQualityLevel(level);
  }

  // ── Downstream orchestration ──────────────────────────────────────────────

  private _onPowerTierChange(tier: PowerTier): void {
    // Only drive from power tier if no explicit override active
    if (this._overrideLevel) return;
    const levelMap: Record<PowerTier, QualityLevel> = {
      performance: 'full',
      balanced:    'reduced',
      saver:       'minimal',
      emergency:   'emergency',
    };
    this._applyLevel(levelMap[tier]);
  }

  private _applyLevel(level: QualityLevel, _notifyPower = true): void {
    if (this._currentLevel === level) return;
    const prev = this._currentLevel;
    this._currentLevel = level;
    const profile = QUALITY_PROFILES[level];
    console.log(`[AdaptiveQuality] ${prev} → ${level} (FPS:${profile.maxFPS} AR:${profile.arEnabled})`);

    // 1. FrameScheduler FPS cap
    const fsState: ThermalState =
      level === 'emergency' ? 'critical'
      : level === 'minimal' ? 'serious'
      : level === 'reduced' ? 'fair'
      : 'nominal';
    try { FrameScheduler.reportThermalState(fsState); } catch { /* ignore */ }

    // 2. Render isolation
    if (level === 'minimal' || level === 'emergency') {
      try { RenderIsolationManager.suspendAllCategories?.(['background', 'preview']); } catch { /* ignore */ }
    }
    if (level === 'emergency') {
      try { RenderIsolationManager.suspendAllCategories?.(['game', 'ar_effects']); } catch { /* ignore */ }
    }

    // 3. PrefetchMediaManager
    try {
      const { PrefetchMediaManager } = require('../media/PrefetchMediaManager');
      const pm: 'performance' | 'balanced' | 'saver' | 'emergency' =
        level === 'full'      ? 'performance'
        : level === 'reduced' ? 'balanced'
        : level === 'minimal' ? 'saver'
        : 'emergency';
      PrefetchMediaManager.setPowerMode?.(pm);
    } catch { /* may not be loaded */ }

    // 4. IntelligentCacheManager
    try {
      const { IntelligentCacheManager } = require('../media/IntelligentCacheManager');
      IntelligentCacheManager.setThermalState?.(fsState);
    } catch { /* may not be loaded */ }

    // 5. AdaptiveBitrateManager
    try {
      const { AdaptiveBitrateManager } = require('../media/AdaptiveBitrateManager');
      const abmTier =
        level === 'full'      ? 'performance'
        : level === 'reduced' ? 'balanced'
        : level === 'minimal' ? 'saver'
        : 'emergency';
      AdaptiveBitrateManager.onPowerTierChange?.(abmTier);
    } catch { /* may not be loaded */ }

    // 6. Notify React hooks
    for (const fn of this._handlers) {
      try { fn(profile); } catch { /* isolate */ }
    }
  }
}

export const AdaptiveQualityController = new AdaptiveQualityControllerImpl();
