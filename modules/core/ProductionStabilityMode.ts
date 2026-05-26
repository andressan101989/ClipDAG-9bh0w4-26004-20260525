/**
 * modules/core/ProductionStabilityMode.ts — v2 Global adaptive degradation system
 *
 * Phase 4 additions:
 *   - Removed EventBus.emit('app:low_memory') on every level change (was spamming memory cleanup)
 *   - FrameScheduler.setGlobalFPSCap is now the canonical FPS limiter
 *   - _forceGPURelease uses GPUManager.emergencyRelease (no throw path)
 *   - getReport() reads GPUManager.getReport().usedSlots / .maxSlots correctly
 *   - forceQualityLevel() signature matches AdaptiveQualityController call (null = restore)
 *   - destroy() clears the scan timer and handlers (prevents hot-reload leaks)
 *   - _restoreAll() also re-emits quality restoration to AdaptiveQualityController
 *   - Recovery hysteresis: 3 consecutive below-threshold scans before upgrading
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
  memoryPressure: number;
  gpuPressure:    number;
  activeFPS:      number;
  timestamp:      number;
  activeActions:  string[];
}

interface StressScore {
  thermal: number;
  power:   number;
  memory:  number;
  gpu:     number;
  total:   number;
}

// ── Mode thresholds ───────────────────────────────────────────────────────────

const THRESHOLD: Record<StabilityMode, number> = {
  nominal:   0,
  stress:    2,
  degraded:  4,
  critical:  6,
  emergency: 8,
};

// Hysteresis: require 3 consecutive below-threshold scans before recovering
const RECOVERY_SCAN_COUNT = 3;

// ── ProductionStabilityMode ───────────────────────────────────────────────────

class ProductionStabilityModeImpl {
  private _mode:          StabilityMode = 'nominal';
  private _modeHandlers   = new Set<(mode: StabilityMode, report: StabilityReport) => void>();
  private _scanTimer:     ReturnType<typeof setInterval> | null = null;
  private _activeActions  = new Set<string>();
  private _initialized    = false;
  private _belowThresholdCount = 0;  // consecutive scans below threshold for hysteresis

  // ── Init ───────────────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    this._scanTimer = setInterval(() => this._scan(), 5_000);

    AppLifecycle.onBackground(() => {
      if (this._mode === 'nominal' || this._mode === 'stress') {
        this._applyMode('degraded');
      }
    });

    AppLifecycle.onForeground(() => {
      this._belowThresholdCount = 0;
      this._scan();
    });

    console.log('[ProductionStabilityMode] initialized');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get mode():         StabilityMode { return this._mode; }
  get currentMode():  StabilityMode { return this._mode; }

  get currentScore(): number {
    const s = this._computeScore();
    return Math.min(100, (s.total / THRESHOLD.emergency) * 100);
  }

  get canRenderEffects(): boolean {
    return this._mode === 'nominal' || this._mode === 'stress';
  }
  get canPrefetch(): boolean {
    return this._mode === 'nominal' || this._mode === 'stress';
  }
  get canRenderOverlays(): boolean {
    return this._mode !== 'critical' && this._mode !== 'emergency';
  }

  getReport(): StabilityReport {
    const gpu = GPUManager.getReport();
    return {
      mode:           this._mode,
      thermalState:   ThermalMonitor.currentState,
      powerTier:      PowerManager.currentTier,
      memoryPressure: (MemoryPressureMonitor as any).pressureLevel ?? 0,
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

  destroy(): void {
    if (this._scanTimer) { clearInterval(this._scanTimer); this._scanTimer = null; }
    this._modeHandlers.clear();
    this._initialized = false;
  }

  // ── Private: scan ─────────────────────────────────────────────────────────

  private _scan(): void {
    const score  = this._computeScore();
    const target = this._scoreToMode(score.total);

    if (target === this._mode) {
      // No change — reset hysteresis only if at nominal
      if (target === 'nominal') this._belowThresholdCount = 0;
      return;
    }

    const currentThreshold = THRESHOLD[this._mode];
    const targetThreshold  = THRESHOLD[target];

    if (targetThreshold < currentThreshold) {
      // Attempting recovery — require RECOVERY_SCAN_COUNT consecutive below-threshold
      this._belowThresholdCount++;
      if (this._belowThresholdCount < RECOVERY_SCAN_COUNT) return;
      this._belowThresholdCount = 0;
    } else {
      // Degrading — apply immediately
      this._belowThresholdCount = 0;
    }

    this._applyMode(target);
  }

  private _computeScore(): StressScore {
    const thermal = this._thermalScore();
    const power   = this._powerScore();
    const memory  = this._memoryScore();
    const gpu     = this._gpuScore();
    const total   = thermal * 1.5 + power * 1.2 + memory * 3 + gpu * 2;
    return { thermal, power, memory, gpu, total };
  }

  private _thermalScore(): number {
    const t = ThermalMonitor.currentState;
    if (t === 'nominal') return 0;
    if (t === 'fair')    return 1;
    if (t === 'serious') return 2;
    return 3;
  }

  private _powerScore(): number {
    const p = PowerManager.currentTier;
    if (p === 'performance') return 0;
    if (p === 'balanced')    return 1;
    if (p === 'saver')       return 2;
    return 3;
  }

  private _memoryScore(): number {
    const level = (MemoryPressureMonitor as any).pressureLevel;
    if (typeof level === 'number') return level;
    const s = (MemoryPressureMonitor as any).currentLevel ?? 'normal';
    if (s === 'normal')   return 0;
    if (s === 'moderate') return 0.4;
    if (s === 'critical') return 1;
    return 0;
  }

  private _gpuScore(): number {
    const report = GPUManager.getReport?.();
    if (!report || report.maxSlots === 0) return 0;
    return report.usedSlots / report.maxSlots;
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

    switch (mode) {
      case 'nominal':   this._restoreAll();          break;
      case 'stress':    this._applyStress();         break;
      case 'degraded':  this._applyDegraded();       break;
      case 'critical':  this._applyCritical();       break;
      case 'emergency': this._applyEmergency();      break;
    }

    const report = this.getReport();
    TelemetryPipeline.recordThermalTransition?.(previous, mode as any);

    for (const cb of this._modeHandlers) {
      try { cb(mode, report); } catch { /* non-fatal */ }
    }
  }

  // ── Actions per tier ─────────────────────────────────────────────────────

  private _applyStress(): void {
    this._activeActions.add('fps_cap_50');
    FrameScheduler.setGlobalFPSCap(50);
    this._activeActions.add('prefetch_throttled');
    try { (PrefetchMediaManager as any).setThrottled?.(true); } catch { /* ignore */ }
  }

  private _applyDegraded(): void {
    this._activeActions.add('fps_cap_30');
    FrameScheduler.setGlobalFPSCap(30);
    this._activeActions.add('prefetch_throttled');
    try { (PrefetchMediaManager as any).setThrottled?.(true); } catch { /* ignore */ }
    this._activeActions.add('render_quality_reduced');
    try { AdaptiveQualityController.forceQualityLevel?.('minimal'); } catch { /* ignore */ }
    this._activeActions.add('background_tasks_throttled');
    try { ResourceScheduler.setThermalPressure?.('serious'); } catch { /* ignore */ }
  }

  private _applyCritical(): void {
    this._activeActions.add('fps_cap_24');
    FrameScheduler.setGlobalFPSCap(24);
    this._activeActions.add('prefetch_paused');
    try { (PrefetchMediaManager as any).pauseAll?.(); } catch { /* ignore */ }
    this._activeActions.add('cache_cleanup');
    try { (IntelligentCacheManager as any).runThermalCleanup?.(); } catch { /* ignore */ }
    try { MediaCleanupManager.cleanup?.('cache'); } catch { /* ignore */ }
    this._activeActions.add('render_quality_reduced');
    try { AdaptiveQualityController.forceQualityLevel?.('minimal'); } catch { /* ignore */ }
    this._activeActions.add('background_tasks_throttled');
    try { ResourceScheduler.setThermalPressure?.('serious'); } catch { /* ignore */ }
  }

  private _applyEmergency(): void {
    this._activeActions.add('fps_cap_15');
    FrameScheduler.setGlobalFPSCap(15);
    this._activeActions.add('prefetch_paused');
    try { (PrefetchMediaManager as any).pauseAll?.(); } catch { /* ignore */ }
    this._activeActions.add('cache_emergency');
    try { MediaCleanupManager.emergencyCleanup?.(); } catch { /* ignore */ }
    try { (IntelligentCacheManager as any).runThermalCleanup?.(); } catch { /* ignore */ }
    this._activeActions.add('render_quality_emergency');
    try { AdaptiveQualityController.forceQualityLevel?.('emergency'); } catch { /* ignore */ }
    this._activeActions.add('background_tasks_paused');
    try { ResourceScheduler.setThermalPressure?.('critical'); } catch { /* ignore */ }
    this._activeActions.add('gpu_emergency_release');
    try { GPUManager.emergencyRelease?.(); } catch { /* ignore */ }
  }

  private _restoreAll(): void {
    FrameScheduler.setGlobalFPSCap(60);
    try { (PrefetchMediaManager as any).setThrottled?.(false); } catch { /* ignore */ }
    try { (PrefetchMediaManager as any).resumeAll?.(); } catch { /* ignore */ }
    try { AdaptiveQualityController.forceQualityLevel?.(null); } catch { /* ignore */ }
    try { ResourceScheduler.setThermalPressure?.('nominal'); } catch { /* ignore */ }
  }
}

export const ProductionStabilityMode = new ProductionStabilityModeImpl();
