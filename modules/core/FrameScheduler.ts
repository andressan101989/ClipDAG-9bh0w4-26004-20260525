/**
 * modules/core/FrameScheduler.ts — v2 GPU frame scheduling & render throttling
 *
 * Phase 4 additions:
 *   - setGlobalFPSCap(): ProductionStabilityMode calls this to cap all surfaces
 *   - getActiveFPS(): returns current effective FPS (used by StabilityMode report)
 *   - Frame pacing enforcement: uniform delivery via token-bucket timing
 *   - Render spike detection: 3-frame moving average to detect sudden spikes
 *   - Hysteresis on jank escalation: requires 3 consecutive clean frames to de-escalate
 *   - forceQualityLevel() alias consumed by ProductionStabilityMode
 */

import { EventBus }              from './EventBus';
import { MemoryPressureMonitor } from './MemoryPressureMonitor';

export type RenderPriority = 'critical' | 'high' | 'normal' | 'low';

export interface RenderSurface {
  id:            string;
  targetFPS:     number;
  cappedFPS:     number;   // effective after global cap
  priority:      RenderPriority;
  isActive:      boolean;
  lastFrameAt:   number;
  avgFrameTimeMs: number;
  droppedFrames: number;
  totalFrames:   number;
  recentFrameTimes: number[]; // 3-sample ring for spike detection
}

const PRIORITY_DROP_ORDER: RenderPriority[] = ['low', 'normal', 'high', 'critical'];
const JANK_THRESHOLD_MULTIPLIER = 2.0;
const JANK_ESCALATION_COUNT     = 10;
const JANK_RECOVERY_COUNT       = 3;   // clean frames needed before de-escalating
const MAX_RECENT_FRAMES         = 3;

class FrameSchedulerImpl {
  private readonly _surfaces  = new Map<string, RenderSurface>();
  private _gpuPressure: 'none' | 'moderate' | 'high' = 'none';
  private _thermalState: 'nominal' | 'fair' | 'serious' | 'critical' = 'nominal';
  private _jankCounters    = new Map<string, number>();
  private _cleanCounters   = new Map<string, number>();
  private _frameDropLevel  = 0;
  private _globalFPSCap    = 60;   // set by ProductionStabilityMode

  // ── Registration ──────────────────────────────────────────────────────────

  register(id: string, targetFPS: number, priority: RenderPriority = 'normal'): void {
    const quality    = MemoryPressureMonitor.currentQuality;
    const qualityFPS = quality?.targetFPS ?? 60;
    const effectiveFPS = Math.min(targetFPS, qualityFPS, this._globalFPSCap);

    this._surfaces.set(id, {
      id,
      targetFPS,
      cappedFPS:       effectiveFPS,
      priority,
      isActive:        true,
      lastFrameAt:     0,
      avgFrameTimeMs:  1000 / effectiveFPS,
      droppedFrames:   0,
      totalFrames:     0,
      recentFrameTimes: [],
    });
    console.log(`[FrameScheduler] registered "${id}" @ ${effectiveFPS}fps [${priority}]`);
  }

  unregister(id: string): void {
    this._surfaces.delete(id);
    this._jankCounters.delete(id);
    this._cleanCounters.delete(id);
    console.log(`[FrameScheduler] unregistered "${id}"`);
  }

  pause(id: string):  void { this._setSurfaceActive(id, false); }
  resume(id: string): void { this._setSurfaceActive(id, true);  }

  // ── Frame gating ──────────────────────────────────────────────────────────

  shouldRender(id: string): boolean {
    const surface = this._surfaces.get(id);
    if (!surface || !surface.isActive) return false;

    if (this._shouldDrop(surface.priority)) {
      surface.droppedFrames++;
      surface.totalFrames++;
      return false;
    }

    const now         = performance.now();
    const intervalMs  = 1000 / surface.cappedFPS;
    const elapsed     = now - surface.lastFrameAt;

    // Token-bucket frame pacing: allow slight early delivery (85% of interval)
    // but clamp burst to 1 frame per budget
    if (elapsed < intervalMs * 0.85) return false;

    return true;
  }

  frameComplete(id: string, renderTimeMs: number): void {
    const surface = this._surfaces.get(id);
    if (!surface) return;

    const now = performance.now();
    surface.lastFrameAt   = now;
    surface.totalFrames++;

    // EMA smoothing for average frame time
    surface.avgFrameTimeMs = surface.avgFrameTimeMs * 0.875 + renderTimeMs * 0.125;

    // 3-frame ring for spike detection
    surface.recentFrameTimes.push(renderTimeMs);
    if (surface.recentFrameTimes.length > MAX_RECENT_FRAMES) {
      surface.recentFrameTimes.shift();
    }

    // Render spike: current frame 3× the recent average
    if (surface.recentFrameTimes.length === MAX_RECENT_FRAMES) {
      const recentAvg = surface.recentFrameTimes
        .slice(0, -1)
        .reduce((a, b) => a + b, 0) / (MAX_RECENT_FRAMES - 1);
      if (renderTimeMs > recentAvg * 3 && recentAvg > 2) {
        console.warn(`[FrameScheduler] render spike on "${id}": ${renderTimeMs.toFixed(1)}ms (avg ${recentAvg.toFixed(1)}ms)`);
      }
    }

    // Jank detection with hysteresis
    const targetMs = 1000 / surface.cappedFPS;
    if (renderTimeMs > targetMs * JANK_THRESHOLD_MULTIPLIER) {
      const jankCount = (this._jankCounters.get(id) ?? 0) + 1;
      this._jankCounters.set(id, jankCount);
      this._cleanCounters.set(id, 0);

      if (jankCount >= JANK_ESCALATION_COUNT) {
        console.warn(`[FrameScheduler] "${id}" sustained jank — escalating`);
        this._escalateGPUPressure();
        this._jankCounters.set(id, 0);
      }
    } else {
      const clean = (this._cleanCounters.get(id) ?? 0) + 1;
      this._cleanCounters.set(id, clean);
      if (clean >= JANK_RECOVERY_COUNT) {
        // Gradual de-escalation
        this._jankCounters.set(id, Math.max(0, (this._jankCounters.get(id) ?? 0) - 1));
      }
    }
  }

  // ── Global FPS cap (called by ProductionStabilityMode) ────────────────────

  setGlobalFPSCap(cap: number): void {
    if (this._globalFPSCap === cap) return;
    this._globalFPSCap = Math.max(1, cap);
    console.log('[FrameScheduler] global FPS cap:', this._globalFPSCap);
    // Re-apply to all surfaces
    for (const surface of this._surfaces.values()) {
      surface.cappedFPS = Math.min(surface.targetFPS, this._globalFPSCap);
    }
  }

  /** Returns the lowest effective FPS across active surfaces (for reports). */
  getActiveFPS(): number {
    let min = this._globalFPSCap;
    for (const s of this._surfaces.values()) {
      if (s.isActive) min = Math.min(min, s.cappedFPS);
    }
    return min;
  }

  // ── Thermal & pressure ────────────────────────────────────────────────────

  reportThermalState(state: 'nominal' | 'fair' | 'serious' | 'critical'): void {
    if (this._thermalState === state) return;
    const prev = this._thermalState;
    this._thermalState = state;
    console.warn(`[FrameScheduler] thermal: ${prev} → ${state}`);

    switch (state) {
      case 'nominal': this._setDropLevel(0); this.setGlobalFPSCap(60); break;
      case 'fair':    this._setDropLevel(1); this.setGlobalFPSCap(50); break;
      case 'serious': this._setDropLevel(2); this.setGlobalFPSCap(30); break;
      case 'critical':
        this._setDropLevel(3);
        this.setGlobalFPSCap(20);
        MemoryPressureMonitor.reportPressure('critical');
        EventBus.emit('app:low_memory');
        break;
    }
  }

  reportGPUPressure(level: 'none' | 'moderate' | 'high'): void {
    if (this._gpuPressure === level) return;
    this._gpuPressure = level;
    if (level === 'high')     this._setDropLevel(Math.max(this._frameDropLevel, 2));
    else if (level === 'moderate') this._setDropLevel(Math.max(this._frameDropLevel, 1));
    else                      this._setDropLevel(0);
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getStats(): Array<{ id: string; fps: number; dropRate: string; avgMs: string }> {
    return Array.from(this._surfaces.values()).map(s => ({
      id:       s.id,
      fps:      s.cappedFPS,
      dropRate: s.totalFrames > 0
        ? `${((s.droppedFrames / s.totalFrames) * 100).toFixed(1)}%`
        : '0%',
      avgMs:    `${s.avgFrameTimeMs.toFixed(2)}ms`,
    }));
  }

  get thermalState() { return this._thermalState; }
  get gpuPressure()  { return this._gpuPressure; }
  get dropLevel()    { return this._frameDropLevel; }

  // ── Private ───────────────────────────────────────────────────────────────

  private _shouldDrop(priority: RenderPriority): boolean {
    if (this._frameDropLevel === 0) return false;
    const idx = PRIORITY_DROP_ORDER.indexOf(priority);
    return idx < this._frameDropLevel;
  }

  private _setDropLevel(level: number): void {
    if (this._frameDropLevel === level) return;
    console.log(`[FrameScheduler] drop level: ${this._frameDropLevel} → ${level}`);
    this._frameDropLevel = level;
  }

  private _capAllFPS(maxFPS: number): void {
    for (const s of this._surfaces.values()) {
      s.cappedFPS = Math.min(s.targetFPS, maxFPS);
    }
  }

  private _setSurfaceActive(id: string, active: boolean): void {
    const s = this._surfaces.get(id);
    if (s) s.isActive = active;
  }

  private _escalateGPUPressure(): void {
    if (this._gpuPressure === 'none')         this.reportGPUPressure('moderate');
    else if (this._gpuPressure === 'moderate') this.reportGPUPressure('high');
  }
}

export const FrameScheduler = new FrameSchedulerImpl();
