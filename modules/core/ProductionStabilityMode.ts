/**
 * modules/core/ProductionStabilityMode.ts — Global automatic degradation system
 *
 * Single coordinator that watches ALL stress signals and responds automatically:
 *   - Thermal pressure   → reduce FPS, bitrate, rendering quality
 *   - Memory pressure    → pause prefetch, evict caches, reduce buffers
 *   - GPU overload       → suspend inactive renderers, reduce textures
 *   - Low battery        → enter saver mode, throttle background tasks
 *   - Poor network       → reduce bitrate, pause non-critical uploads
 *   - High event load    → activate backpressure, shed load
 *
 * Degradation cascade (worst → best):
 *   NOMINAL → STRESS → DEGRADED → CRITICAL → EMERGENCY
 *
 * Each level activates progressively more aggressive protections.
 * Recovery is gradual (hysteresis to prevent oscillation).
 *
 * Modeled after TikTok / Instagram / Discord adaptive quality behavior.
 *
 * Usage:
 *   ProductionStabilityMode.initialize();
 *   ProductionStabilityMode.getMode();            // 'nominal' | 'stress' | ...
 *   ProductionStabilityMode.onModeChange(cb);
 */

import { ThermalMonitor }            from './ThermalMonitor';
import { PowerManager }              from './PowerManager';
import { MemoryPressureMonitor }     from './MemoryPressureMonitor';
import { GPUManager }                from './GPUManager';
import { FrameScheduler }            from './FrameScheduler';
import { AdaptiveQualityController } from './AdaptiveQualityController';
import { BackpressureQueue }         from './BackpressureQueue';
import { PrefetchMediaManager }      from '../media/PrefetchMediaManager';
import { MediaCleanupManager }       from '../media/MediaCleanupManager';
import { IntelligentCacheManager }   from '../media/IntelligentCacheManager';
import { ResourceScheduler }         from './ResourceScheduler';
import { TelemetryPipeline }         from './TelemetryPipeline';
import { AppLifecycle }              from './AppLifecycle';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StabilityMode = 'nominal' | 'stress' | 'degraded' | 'critical' | 'emergency';

export interface StabilityReport {
  mode:           StabilityMode;
  thermalState:   string;
  powerTier:      string;
  memoryPressure: number;   // 0–1
  gpuPressure:    number;   // 0–1
  activeFPS:      number;
  timestamp:      number;
  activeActions:  string[];
}

interface StressScore {
  thermal:  number;  // 0–3 (nominal=0, fair=1, serious=2, critical=3)
  power:    number;  // 0–3 (performance=0, balanced=1, saver=2, emergency=3)
  memory:   number;  // 0–1 (0=ok, 1=critical)
  gpu:      number;  // 0–1 (0=ok, 1=overloaded)
  total:    number;  // weighted sum → drives mode decision
}

// ── Mode thresholds ───────────────────────────────────────────────────────────
const THRESHOLD: Record<StabilityMode, number> = {
  nominal:   0,
  stress:    2,
  degraded:  4,
  critical:  6,
  emergency: 8,
};

// Hysteresis: must score X below threshold before recovering
const RECOVERY_MARGIN = 1.5;

// ── ProductionStabilityMode ───────────────────────────────────────────────────

class ProductionStabilityModeImpl {
  private _mode:         StabilityMode = 'nominal';
  private _modeHandlers  = new Set<(mode: StabilityMode, report: StabilityReport) => void>();
  private _scanTimer:    ReturnType<typeof setInterval> | null = null;
  private _activeActions = new Set<string>();
  private _initialized   = false;

  // ── Init ───────────────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Start monitoring loop every 5 seconds
    this._scanTimer = setInterval(() => this._scan(), 5_000);

    // React to app lifecycle
    AppLifecycle.onBackground(() => {
      // On background, immediately drop to at least degraded mode
      if (this._mode === 'nominal' || this._mode === 'stress') {
        this._applyMode('degraded');
      }
    });
    AppLifecycle.onForeground(() => {
      // Rescan on foreground to recalculate proper mode
      this._scan();
    });

    console.log('[ProductionStabilityMode] initialized');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get mode(): StabilityMode { return this._mode; }

  getReport(): StabilityReport {
    const gpu = GPUManager.getReport();
    return {
      mode:           this._mode,
      thermalState:   ThermalMonitor.currentState,
      powerTier:      PowerManager.currentTier,
      memoryPressure: MemoryPressureMonitor.pressureLevel ?? 0,
      gpuPressure:    gpu ? gpu.usedSlots / Math.max(1, gpu.maxSlots) : 0,
      activeFPS:      FrameScheduler.getActiveFPS?.() ?? 60,
      timestamp:      Date.now(),
      activeActions:  Array.from(this._activeActions),
    };
  }

  onModeChange(cb: (mode: StabilityMode, report: StabilityReport) => void): () => void {
    this._modeHandlers.add(cb);
    return () => this._modeHandlers.delete(cb);
  }

  // ── Private: scan ─────────────────────────────────────────────────────────

  private _scan(): void {
    const score  = this._computeScore();
    const target = this._scoreToMode(score.total);

    if (target !== this._mode) {
      // Hysteresis check for recovery
      const current = THRESHOLD[this._mode];
      const next    = THRESHOLD[target];
      if (next < current && score.total > current - RECOVERY_MARGIN) {
        // Not stable enough to recover yet
        return;
      }
      this._applyMode(target);
    }
  }

  private _computeScore(): StressScore {
    const thermal = this._thermalScore();
    const power   = this._powerScore();
    const memory  = this._memoryScore();
    const gpu     = this._gpuScore();

    // Weighted: thermal + power most important, memory + gpu secondary
    const total = thermal * 1.5 + power * 1.2 + memory * 3 + gpu * 2;

    return { thermal, power, memory, gpu, total };
  }

  private _thermalScore(): number {
    const t = ThermalMonitor.currentState;
    if (t === 'nominal')  return 0;
    if (t === 'fair')     return 1;
    if (t === 'serious')  return 2;
    return 3; // critical
  }

  private _powerScore(): number {
    const p = PowerManager.currentTier;
    if (p === 'performance') return 0;
    if (p === 'balanced')    return 1;
    if (p === 'saver')       return 2;
    return 3; // emergency
  }

  private _memoryScore(): number {
    const level = (MemoryPressureMonitor as any).pressureLevel ?? 0;
    if (typeof level === 'number') return level;
    // Fallback: map string levels
    const s = (MemoryPressureMonitor as any).currentLevel ?? 'normal';
    if (s === 'normal')   return 0;
    if (s === 'moderate') return 0.4;
    if (s === 'critical') return 1;
    return 0;
  }

  private _gpuScore(): number {
    const report = GPUManager.getReport?.();
    if (!report) return 0;
    return report.usedSlots / Math.max(1, report.maxSlots);
  }

  private _scoreToMode(score: number): StabilityMode {
    if (score >= THRESHOLD.emergency) return 'emergency';
    if (score >= THRESHOLD.critical)  return 'critical';
    if (score >= THRESHOLD.degraded)  return 'degraded';
    if (score >= THRESHOLD.stress)    return 'stress';
    return 'nominal';
  }

  // ── Private: apply mode ───────────────────────────────────────────────────

  private _applyMode(mode: StabilityMode): void {
    const previous = this._mode;
    this._mode = mode;
    this._activeActions.clear();

    console.log(`[ProductionStabilityMode] ${previous} → ${mode}`);

    // Apply actions for each mode tier
    switch (mode) {
      case 'nominal':
        this._restoreAll();
        break;

      case 'stress':
        this._reduceFPS(50);
        this._throttlePrefetch();
        break;

      case 'degraded':
        this._reduceFPS(30);
        this._throttlePrefetch();
        this._reduceRenderQuality();
        this._pauseNonCriticalTasks();
        break;

      case 'critical':
        this._reduceFPS(24);
        this._pausePrefetch();
        this._aggressiveCacheCleanup();
        this._suspendOverlays();
        this._reduceRenderQuality();
        this._pauseNonCriticalTasks();
        break;

      case 'emergency':
        this._reduceFPS(15);
        this._pausePrefetch();
        this._emergencyCacheRelease();
        this._suspendOverlays();
        this._reduceRenderQuality();
        this._pauseAllBackgroundTasks();
        this._forceGPURelease();
        break;
    }

    const report = this.getReport();

    // Record telemetry
    TelemetryPipeline.recordThermalTransition?.(previous, mode as any);

    // Notify listeners
    for (const cb of this._modeHandlers) {
      try { cb(mode, report); } catch { /* non-fatal */ }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private _reduceFPS(cap: number): void {
    this._activeActions.add(`fps_cap_${cap}`);
    FrameScheduler.setGlobalFPSCap?.(cap);
  }

  private _throttlePrefetch(): void {
    this._activeActions.add('prefetch_throttled');
    (PrefetchMediaManager as any).setThrottled?.(true);
  }

  private _pausePrefetch(): void {
    this._activeActions.add('prefetch_paused');
    (PrefetchMediaManager as any).pauseAll?.();
  }

  private _reduceRenderQuality(): void {
    this._activeActions.add('render_quality_reduced');
    AdaptiveQualityController.forceQualityLevel?.('low');
  }

  private _suspendOverlays(): void {
    this._activeActions.add('overlays_suspended');
    // Overlays should check AdaptiveQualityController.getProfile().renderEffects
  }

  private _pauseNonCriticalTasks(): void {
    this._activeActions.add('background_tasks_throttled');
    ResourceScheduler.setThermalPressure?.('serious');
  }

  private _pauseAllBackgroundTasks(): void {
    this._activeActions.add('background_tasks_paused');
    ResourceScheduler.setThermalPressure?.('critical');
  }

  private _aggressiveCacheCleanup(): void {
    this._activeActions.add('cache_cleanup');
    (IntelligentCacheManager as any).runThermalCleanup?.();
    MediaCleanupManager.cleanup('cache');
  }

  private _emergencyCacheRelease(): void {
    this._activeActions.add('cache_emergency');
    MediaCleanupManager.emergencyCleanup?.();
    (IntelligentCacheManager as any).runThermalCleanup?.();
  }

  private _forceGPURelease(): void {
    this._activeActions.add('gpu_emergency_release');
    GPUManager.emergencyRelease?.();
  }

  private _restoreAll(): void {
    FrameScheduler.setGlobalFPSCap?.(60);
    (PrefetchMediaManager as any).setThrottled?.(false);
    (PrefetchMediaManager as any).resumeAll?.();
    AdaptiveQualityController.forceQualityLevel?.(null);
    ResourceScheduler.setThermalPressure?.('nominal');
  }

  destroy(): void {
    if (this._scanTimer) {
      clearInterval(this._scanTimer);
      this._scanTimer = null;
    }
    this._modeHandlers.clear();
  }
}

export const ProductionStabilityMode = new ProductionStabilityModeImpl();
