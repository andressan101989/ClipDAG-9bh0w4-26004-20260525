/**
 * modules/core/FrameScheduler.ts — GPU frame scheduling & render throttling
 *
 * Prevents thermal throttling, GPU overload, and FPS drops by:
 *   - Enforcing per-surface FPS caps
 *   - Prioritizing render work (camera > UI > background effects)
 *   - Dropping low-priority frames when GPU is under pressure
 *   - Coordinating DeepAR, Skia, and video decoder frame budgets
 *   - Detecting render jank and escalating to MemoryPressureMonitor
 *
 * Frame budget model (at 60 FPS, 16.67ms per frame):
 *   camera preview:   6ms   (highest priority — user-visible)
 *   AR effects:       5ms   (high priority — drops to 0 under pressure)
 *   UI animations:    3ms   (normal priority — can defer)
 *   background tasks: 2ms   (low priority — first to drop)
 *
 * Usage:
 *   // Register a render surface
 *   const id = FrameScheduler.register('deepar', 60, 'high');
 *
 *   // Check if this frame should render
 *   if (FrameScheduler.shouldRender('deepar')) {
 *     // ... render frame
 *     FrameScheduler.frameComplete('deepar', renderTimeMs);
 *   }
 *
 *   // Unregister when surface unmounts
 *   FrameScheduler.unregister('deepar');
 */

import { EventBus }              from './EventBus';
import { MemoryPressureMonitor } from './MemoryPressureMonitor';

export type RenderPriority = 'critical' | 'high' | 'normal' | 'low';

export interface RenderSurface {
  id:            string;
  targetFPS:     number;
  priority:      RenderPriority;
  isActive:      boolean;
  lastFrameAt:   number;
  avgFrameTimeMs: number;
  droppedFrames: number;
  totalFrames:   number;
}

const PRIORITY_DROP_ORDER: RenderPriority[] = ['low', 'normal', 'high', 'critical'];
const JANK_THRESHOLD_MULTIPLIER = 2.0;   // frame time > 2× target = jank
const JANK_ESCALATION_COUNT     = 10;    // N consecutive janky frames → escalate

class FrameSchedulerImpl {
  private readonly _surfaces  = new Map<string, RenderSurface>();
  private _gpuPressure: 'none' | 'moderate' | 'high' = 'none';
  private _thermalState: 'nominal' | 'fair' | 'serious' | 'critical' = 'nominal';
  private _jankCounters = new Map<string, number>();
  private _frameDropLevel = 0;  // 0 = drop nothing, 1 = drop low, 2 = drop low+normal

  // ── Registration ──────────────────────────────────────────────────────────

  register(id: string, targetFPS: number, priority: RenderPriority = 'normal'): void {
    const quality = MemoryPressureMonitor.currentQuality;
    const actualFPS = Math.min(targetFPS, quality.targetFPS);

    this._surfaces.set(id, {
      id,
      targetFPS:       actualFPS,
      priority,
      isActive:        true,
      lastFrameAt:     0,
      avgFrameTimeMs:  1000 / actualFPS,
      droppedFrames:   0,
      totalFrames:     0,
    });

    console.log(`[FrameScheduler] registered surface "${id}" @ ${actualFPS}fps [${priority}]`);
  }

  unregister(id: string): void {
    this._surfaces.delete(id);
    this._jankCounters.delete(id);
    console.log(`[FrameScheduler] unregistered surface "${id}"`);
  }

  pause(id: string):  void { this._setSurfaceActive(id, false); }
  resume(id: string): void { this._setSurfaceActive(id, true);  }

  // ── Frame gating ──────────────────────────────────────────────────────────

  /**
   * Returns true if this surface should render this frame.
   * Call at the start of each render cycle.
   */
  shouldRender(id: string): boolean {
    const surface = this._surfaces.get(id);
    if (!surface || !surface.isActive) return false;

    // Drop based on pressure level
    if (this._shouldDrop(surface.priority)) {
      surface.droppedFrames++;
      surface.totalFrames++;
      return false;
    }

    const now = performance.now();
    const intervalMs = 1000 / surface.targetFPS;
    if (now - surface.lastFrameAt < intervalMs * 0.85) {
      // Too soon — throttle
      return false;
    }

    return true;
  }

  /**
   * Call after rendering a frame to track timing.
   * @param renderTimeMs How long the frame took to render.
   */
  frameComplete(id: string, renderTimeMs: number): void {
    const surface = this._surfaces.get(id);
    if (!surface) return;

    surface.lastFrameAt   = performance.now();
    surface.totalFrames++;
    surface.avgFrameTimeMs = surface.avgFrameTimeMs * 0.9 + renderTimeMs * 0.1;

    // Jank detection
    const targetMs = 1000 / surface.targetFPS;
    if (renderTimeMs > targetMs * JANK_THRESHOLD_MULTIPLIER) {
      const count = (this._jankCounters.get(id) ?? 0) + 1;
      this._jankCounters.set(id, count);

      if (count >= JANK_ESCALATION_COUNT) {
        console.warn(`[FrameScheduler] "${id}" sustained jank (${count} frames) — escalating`);
        this._escalateGPUPressure();
        this._jankCounters.set(id, 0);
      }
    } else {
      this._jankCounters.set(id, 0);
    }
  }

  // ── Thermal & pressure ────────────────────────────────────────────────────

  /** Call when iOS/Android thermal state changes. */
  reportThermalState(state: 'nominal' | 'fair' | 'serious' | 'critical'): void {
    if (this._thermalState === state) return;
    const prev = this._thermalState;
    this._thermalState = state;
    console.warn(`[FrameScheduler] thermal: ${prev} → ${state}`);

    switch (state) {
      case 'nominal': this._setDropLevel(0); break;
      case 'fair':    this._setDropLevel(1); break;
      case 'serious': this._setDropLevel(2); this._capAllFPS(30); break;
      case 'critical':
        this._setDropLevel(3);
        this._capAllFPS(20);
        MemoryPressureMonitor.reportPressure('critical');
        EventBus.emit('app:low_memory');
        break;
    }
  }

  reportGPUPressure(level: 'none' | 'moderate' | 'high'): void {
    if (this._gpuPressure === level) return;
    this._gpuPressure = level;
    if (level === 'high') {
      this._setDropLevel(Math.max(this._frameDropLevel, 2));
    } else if (level === 'moderate') {
      this._setDropLevel(Math.max(this._frameDropLevel, 1));
    } else {
      this._setDropLevel(0);
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getStats(): Array<{ id: string; fps: number; dropRate: string; avgMs: string }> {
    return Array.from(this._surfaces.values()).map(s => ({
      id:       s.id,
      fps:      s.targetFPS,
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
    const priorityIndex = PRIORITY_DROP_ORDER.indexOf(priority);
    return priorityIndex < this._frameDropLevel;
  }

  private _setDropLevel(level: number): void {
    if (this._frameDropLevel === level) return;
    console.log(`[FrameScheduler] drop level: ${this._frameDropLevel} → ${level}`);
    this._frameDropLevel = level;
  }

  private _capAllFPS(maxFPS: number): void {
    for (const surface of this._surfaces.values()) {
      if (surface.targetFPS > maxFPS) {
        console.log(`[FrameScheduler] cap "${surface.id}": ${surface.targetFPS} → ${maxFPS} fps`);
        surface.targetFPS = maxFPS;
      }
    }
  }

  private _setSurfaceActive(id: string, active: boolean): void {
    const s = this._surfaces.get(id);
    if (s) s.isActive = active;
  }

  private _escalateGPUPressure(): void {
    if (this._gpuPressure === 'none')     this.reportGPUPressure('moderate');
    else if (this._gpuPressure === 'moderate') this.reportGPUPressure('high');
  }
}

export const FrameScheduler = new FrameSchedulerImpl();
