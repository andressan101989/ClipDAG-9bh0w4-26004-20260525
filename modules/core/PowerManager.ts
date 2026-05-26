/**
 * modules/core/PowerManager.ts — Battery & thermal power optimization
 *
 * Coordinates all power-consuming subsystems to prevent:
 *   - Battery drain (aggressive background processing)
 *   - Thermal throttling (sustained high CPU/GPU load)
 *   - Device overheating (DeepAR + streaming + gaming simultaneously)
 *   - User-visible stutters caused by iOS/Android thermal throttle
 *
 * Power tiers (automatically selected based on thermal + battery):
 *   PERFORMANCE: full quality, 60fps, all features active
 *   BALANCED:    30fps cap, AR effects reduced, background work reduced
 *   SAVER:       20fps cap, AR disabled, background work minimal
 *   EMERGENCY:   10fps cap, camera-only, all non-essential features off
 *
 * Coordinates with:
 *   ThermalMonitor → triggers tier changes
 *   FrameScheduler → applies FPS caps
 *   MemoryPressureMonitor → reduces asset quality
 *   ResourceManager → forces resource releases
 *   BackgroundWorkers → pauses or reduces intervals
 *
 * Usage:
 *   PowerManager.initialize();
 *   const tier = PowerManager.currentTier;
 *   PowerManager.onTierChange(t => updateQualityUI(t));
 *   PowerManager.requestHighPerformance('deepar');  // request performance tier
 *   PowerManager.releaseHighPerformance('deepar');  // release when done
 */

import { FrameScheduler }        from './FrameScheduler';
import { MemoryPressureMonitor } from './MemoryPressureMonitor';
import { ResourceManager }       from './ResourceManager';
import { AppLifecycle }          from './AppLifecycle';
import { EventBus }              from './EventBus';

export type PowerTier = 'performance' | 'balanced' | 'saver' | 'emergency';
export type ThermalLevel = 'nominal' | 'fair' | 'serious' | 'critical';

interface PowerTierConfig {
  maxFPS:            number;
  arEnabled:         boolean;
  skiaEffects:       boolean;
  backgroundSync:    boolean;
  prefetchEnabled:   boolean;
  cacheAggressively: boolean;
  videoQuality:      'high' | 'medium' | 'low';
  networkBatchMs:    number;   // batch network requests to reduce radio wake-ups
}

const TIER_CONFIGS: Record<PowerTier, PowerTierConfig> = {
  performance: {
    maxFPS:            60,
    arEnabled:         true,
    skiaEffects:       true,
    backgroundSync:    true,
    prefetchEnabled:   true,
    cacheAggressively: true,
    videoQuality:      'high',
    networkBatchMs:    0,
  },
  balanced: {
    maxFPS:            30,
    arEnabled:         true,
    skiaEffects:       true,
    backgroundSync:    true,
    prefetchEnabled:   false,
    cacheAggressively: false,
    videoQuality:      'medium',
    networkBatchMs:    500,
  },
  saver: {
    maxFPS:            20,
    arEnabled:         false,
    skiaEffects:       false,
    backgroundSync:    false,
    prefetchEnabled:   false,
    cacheAggressively: false,
    videoQuality:      'low',
    networkBatchMs:    2_000,
  },
  emergency: {
    maxFPS:            10,
    arEnabled:         false,
    skiaEffects:       false,
    backgroundSync:    false,
    prefetchEnabled:   false,
    cacheAggressively: false,
    videoQuality:      'low',
    networkBatchMs:    5_000,
  },
};

class PowerManagerImpl {
  private _tier:           PowerTier        = 'performance';
  private _thermalLevel:   ThermalLevel     = 'nominal';
  private _isBackground    = false;
  private _highPerfHolders = new Set<string>();
  private readonly _handlers = new Set<(tier: PowerTier) => void>();
  private _initialized     = false;

  // ── Init ──────────────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    AppLifecycle.onBackground(() => {
      this._isBackground = true;
      this._applyBackgroundPolicy();
    });

    AppLifecycle.onForeground(() => {
      this._isBackground = false;
      this._recalculate();
    });

    console.log('[PowerManager] initialized — tier: performance');
  }

  // ── Thermal integration ───────────────────────────────────────────────────

  /** Called by ThermalMonitor when device thermal state changes. */
  onThermalChange(level: ThermalLevel): void {
    if (this._thermalLevel === level) return;
    this._thermalLevel = level;
    this._recalculate();
  }

  // ── High-performance requests ─────────────────────────────────────────────

  /**
   * Request performance tier for a specific feature (DeepAR, gaming, etc.).
   * Prevents downgrade while any holder is active.
   */
  requestHighPerformance(holder: string): void {
    this._highPerfHolders.add(holder);
    console.log(`[PowerManager] high-perf requested by "${holder}"`);
    if (this._tier !== 'performance' && this._thermalLevel === 'nominal') {
      this._applyTier('performance');
    }
  }

  /** Release high-performance request. Allows downgrade if thermal warrants. */
  releaseHighPerformance(holder: string): void {
    this._highPerfHolders.delete(holder);
    console.log(`[PowerManager] high-perf released by "${holder}"`);
    this._recalculate();
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  onTierChange(fn: (tier: PowerTier) => void): () => void {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get currentTier():   PowerTier       { return this._tier; }
  get currentConfig(): PowerTierConfig { return TIER_CONFIGS[this._tier]; }
  get isLowPower():    boolean         { return this._tier === 'saver' || this._tier === 'emergency'; }

  /** Check if a feature is enabled at current power tier. */
  isFeatureEnabled(feature: keyof PowerTierConfig): boolean {
    return !!TIER_CONFIGS[this._tier][feature];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _recalculate(): void {
    if (this._isBackground) {
      this._applyBackgroundPolicy();
      return;
    }

    let target: PowerTier = 'performance';

    // Thermal drives primary decision
    switch (this._thermalLevel) {
      case 'nominal':   target = 'performance'; break;
      case 'fair':      target = 'balanced';    break;
      case 'serious':   target = 'saver';       break;
      case 'critical':  target = 'emergency';   break;
    }

    // High-perf holders can prevent downgrade to balanced but not saver/emergency
    if (this._highPerfHolders.size > 0 && target === 'balanced') {
      target = 'performance';
    }

    this._applyTier(target);
  }

  private _applyBackgroundPolicy(): void {
    // Always saver in background regardless of thermal
    this._applyTier('saver');
  }

  private _applyTier(tier: PowerTier): void {
    if (this._tier === tier) return;
    const prev = this._tier;
    this._tier = tier;
    const config = TIER_CONFIGS[tier];

    console.log(`[PowerManager] tier: ${prev} → ${tier} (FPS:${config.maxFPS}, AR:${config.arEnabled})`);

    // Apply FPS cap via FrameScheduler thermal reporting
    // We map tier to FrameScheduler's thermal state for consistency
    const fsState = tier === 'emergency' ? 'critical'
      : tier === 'saver'    ? 'serious'
      : tier === 'balanced' ? 'fair'
      : 'nominal';
    FrameScheduler.reportThermalState(fsState as any);

    // Apply memory quality reduction
    if (tier === 'saver' || tier === 'emergency') {
      MemoryPressureMonitor.reportPressure('moderate');
    } else {
      MemoryPressureMonitor.reset();
    }

    // Emergency: force release all non-critical resources
    if (tier === 'emergency') {
      ResourceManager.emergencyRelease();
      EventBus.emit('app:low_memory');
    }

    // Notify subscribers
    for (const fn of this._handlers) {
      try { fn(tier); } catch { /* isolate */ }
    }
  }
}

export const PowerManager = new PowerManagerImpl();
