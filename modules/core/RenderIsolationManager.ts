/**
 * modules/core/RenderIsolationManager.ts — Advanced render isolation & viewport control
 *
 * Extends FrameScheduler with higher-level rendering policies:
 *   - Render priority queues (camera > AR > UI > background)
 *   - Viewport-aware rendering (suspend offscreen renderers)
 *   - Inactive renderer suspension (auto-pause hidden surfaces)
 *   - Render batching (coalesce low-priority updates into batches)
 *   - Frame budget enforcement (total budget across all surfaces)
 *   - Scene suspension (pause entire render graph during heavy ops)
 *   - Offscreen cleanup (release GPU memory from invisible surfaces)
 *
 * Architecture:
 *   FrameScheduler (per-surface FPS/throttle)
 *     └── RenderIsolationManager (cross-surface policy & budgets)
 *         └── ThermalMonitor (thermal → quality tier)
 *         └── ResourceManager (GPU resource leases)
 *
 * Usage:
 *   RenderIsolationManager.registerSurface('deepar', 'camera', 60);
 *   RenderIsolationManager.setViewportVisible('deepar', true);
 *   const budget = RenderIsolationManager.getRenderBudgetMs('deepar');
 *   RenderIsolationManager.suspendScene('creator-studio');
 *   RenderIsolationManager.resumeScene('creator-studio');
 */

import { FrameScheduler, type RenderPriority } from './FrameScheduler';
import { ResourceManager }                      from './ResourceManager';
import { EventBus }                             from './EventBus';
import { AppLifecycle }                         from './AppLifecycle';

export type RenderCategory =
  | 'camera'       // live camera preview — highest priority, 6ms budget
  | 'ar_effects'   // DeepAR / Skia overlays — 5ms, drops under pressure
  | 'video'        // video playback surfaces — 4ms
  | 'ui_anim'      // React Native Reanimated animations — 3ms
  | 'game'         // game canvas surfaces — 4ms, suspendable
  | 'background'   // background decorative renders — 2ms, first to drop
  | 'preview';     // editor previews — 2ms, runs on demand only

interface SurfaceRecord {
  id:             string;
  category:       RenderCategory;
  targetFPS:      number;
  isViewportVisible: boolean;
  isSuspended:    boolean;
  lastActiveAt:   number;
  batchPending:   boolean;
  batchTimer:     ReturnType<typeof setTimeout> | null;
  scene:          string;           // logical scene grouping
}

// Per-category frame budget in milliseconds (at 60fps = 16.67ms total)
const CATEGORY_BUDGET_MS: Record<RenderCategory, number> = {
  camera:     6.0,
  ar_effects: 5.0,
  video:      4.0,
  game:       4.0,
  ui_anim:    3.0,
  preview:    2.0,
  background: 2.0,
};

// Priority mapping for FrameScheduler
const CATEGORY_PRIORITY: Record<RenderCategory, RenderPriority> = {
  camera:     'critical',
  ar_effects: 'high',
  video:      'high',
  game:       'high',
  ui_anim:    'normal',
  preview:    'low',
  background: 'low',
};

// Auto-suspend after N ms of viewport invisibility
const AUTO_SUSPEND_MS = 2_000;

class RenderIsolationManagerImpl {
  private readonly _surfaces = new Map<string, SurfaceRecord>();
  private readonly _scenes   = new Map<string, Set<string>>(); // scene → surfaceIds
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up auto-suspended surfaces every 5s
    this._cleanupInterval = setInterval(() => this._autoSuspendCheck(), 5_000);

    AppLifecycle.onBackground(() => this.suspendAllCategories(['background', 'preview', 'game']));
    AppLifecycle.onForeground(() => this._resumeAllSuspended());
  }

  // ── Registration ──────────────────────────────────────────────────────────

  registerSurface(
    id:        string,
    category:  RenderCategory,
    targetFPS: number,
    scene      = 'default',
  ): void {
    const record: SurfaceRecord = {
      id,
      category,
      targetFPS,
      isViewportVisible: true,
      isSuspended:       false,
      lastActiveAt:      Date.now(),
      batchPending:      false,
      batchTimer:        null,
      scene,
    };
    this._surfaces.set(id, record);

    // Register with FrameScheduler
    FrameScheduler.register(id, targetFPS, CATEGORY_PRIORITY[category]);

    // Track scene membership
    if (!this._scenes.has(scene)) this._scenes.set(scene, new Set());
    this._scenes.get(scene)!.add(id);

    console.log(`[RenderIsolation] registered "${id}" [${category}] @ ${targetFPS}fps scene:${scene}`);
  }

  unregisterSurface(id: string): void {
    const rec = this._surfaces.get(id);
    if (!rec) return;

    if (rec.batchTimer) clearTimeout(rec.batchTimer);
    FrameScheduler.unregister(id);
    this._scenes.get(rec.scene)?.delete(id);
    this._surfaces.delete(id);
    console.log(`[RenderIsolation] unregistered "${id}"`);
  }

  // ── Viewport control ──────────────────────────────────────────────────────

  /** Call when a render surface enters/leaves the viewport. */
  setViewportVisible(id: string, visible: boolean): void {
    const rec = this._surfaces.get(id);
    if (!rec) return;

    rec.isViewportVisible = visible;
    rec.lastActiveAt = Date.now();

    if (visible) {
      if (rec.isSuspended) this._resumeSurface(id);
      FrameScheduler.resume(id);
    } else {
      // Don't immediately suspend — wait AUTO_SUSPEND_MS in case it comes back
      FrameScheduler.pause(id);
    }
  }

  // ── Render budget ─────────────────────────────────────────────────────────

  /** Returns the frame budget in ms for a surface's category. */
  getRenderBudgetMs(id: string): number {
    const rec = this._surfaces.get(id);
    if (!rec) return 2;
    return CATEGORY_BUDGET_MS[rec.category];
  }

  /** Check if a surface should render this frame (delegates to FrameScheduler). */
  shouldRender(id: string): boolean {
    const rec = this._surfaces.get(id);
    if (!rec || rec.isSuspended || !rec.isViewportVisible) return false;
    return FrameScheduler.shouldRender(id);
  }

  /** Report completed frame render time. */
  frameComplete(id: string, renderTimeMs: number): void {
    const rec = this._surfaces.get(id);
    if (rec) rec.lastActiveAt = Date.now();
    FrameScheduler.frameComplete(id, renderTimeMs);
  }

  // ── Batch rendering (for low-priority surfaces) ───────────────────────────

  /**
   * Request a render for a low-priority surface.
   * Coalesces multiple requests into a single frame within the batch window.
   * @param batchWindowMs - Max time to wait before forcing render (default 100ms)
   */
  requestBatchRender(id: string, onRender: () => void, batchWindowMs = 100): void {
    const rec = this._surfaces.get(id);
    if (!rec) { onRender(); return; }

    if (rec.category !== 'background' && rec.category !== 'preview') {
      // High-priority surfaces render immediately
      onRender();
      return;
    }

    if (rec.batchPending) return; // already queued

    rec.batchPending = true;
    rec.batchTimer   = setTimeout(() => {
      rec.batchPending = false;
      rec.batchTimer   = null;
      if (!rec.isSuspended && rec.isViewportVisible) {
        onRender();
      }
    }, batchWindowMs);
  }

  // ── Scene suspension ──────────────────────────────────────────────────────

  /** Suspend all surfaces in a logical scene (e.g. when navigating away). */
  suspendScene(scene: string): void {
    const ids = this._scenes.get(scene);
    if (!ids) return;
    for (const id of ids) this._suspendSurface(id);
    console.log(`[RenderIsolation] scene "${scene}" suspended (${ids.size} surfaces)`);
  }

  /** Resume all surfaces in a scene. */
  resumeScene(scene: string): void {
    const ids = this._scenes.get(scene);
    if (!ids) return;
    for (const id of ids) this._resumeSurface(id);
    console.log(`[RenderIsolation] scene "${scene}" resumed`);
  }

  /** Suspend all surfaces belonging to given categories. */
  suspendAllCategories(categories: RenderCategory[]): void {
    for (const [id, rec] of this._surfaces) {
      if (categories.includes(rec.category)) this._suspendSurface(id);
    }
  }

  // ── Offscreen cleanup ─────────────────────────────────────────────────────

  /**
   * Release GPU memory for surfaces that have been invisible for longer than
   * threshold. Used after navigation to reclaim GPU texture memory.
   */
  async cleanupOffscreenSurfaces(thresholdMs = 10_000): Promise<number> {
    const now = Date.now();
    let released = 0;
    for (const [id, rec] of this._surfaces) {
      if (!rec.isViewportVisible && (now - rec.lastActiveAt) > thresholdMs) {
        await ResourceManager.releaseByHolder(id).catch(() => {});
        released++;
      }
    }
    if (released > 0) {
      console.log(`[RenderIsolation] released GPU resources for ${released} offscreen surfaces`);
    }
    return released;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getActiveSurfaces(): Array<{
    id: string; category: RenderCategory; fps: number; suspended: boolean; visible: boolean;
  }> {
    return Array.from(this._surfaces.values()).map(r => ({
      id:        r.id,
      category:  r.category,
      fps:       r.targetFPS,
      suspended: r.isSuspended,
      visible:   r.isViewportVisible,
    }));
  }

  getTotalBudgetUsedMs(): number {
    return Array.from(this._surfaces.values())
      .filter(r => !r.isSuspended && r.isViewportVisible)
      .reduce((sum, r) => sum + CATEGORY_BUDGET_MS[r.category], 0);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _suspendSurface(id: string): void {
    const rec = this._surfaces.get(id);
    if (!rec || rec.isSuspended) return;
    rec.isSuspended = true;
    FrameScheduler.pause(id);
  }

  private _resumeSurface(id: string): void {
    const rec = this._surfaces.get(id);
    if (!rec || !rec.isSuspended) return;
    rec.isSuspended = false;
    if (rec.isViewportVisible) FrameScheduler.resume(id);
  }

  private _resumeAllSuspended(): void {
    for (const [id, rec] of this._surfaces) {
      if (rec.isSuspended) this._resumeSurface(id);
    }
  }

  private _autoSuspendCheck(): void {
    const now = Date.now();
    for (const [id, rec] of this._surfaces) {
      if (
        !rec.isViewportVisible &&
        !rec.isSuspended &&
        (now - rec.lastActiveAt) > AUTO_SUSPEND_MS
      ) {
        this._suspendSurface(id);
        console.log(`[RenderIsolation] auto-suspended "${id}" (${AUTO_SUSPEND_MS}ms invisible)`);
      }
    }
  }
}

export const RenderIsolationManager = new RenderIsolationManagerImpl();
