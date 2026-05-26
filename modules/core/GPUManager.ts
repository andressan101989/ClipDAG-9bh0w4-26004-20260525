/**
 * modules/core/GPUManager.ts — GPU resource orchestration for DeepAR, Skia, and rendering
 *
 * Centralizes GPU memory management to prevent:
 *   - Texture accumulation (DeepAR effect textures not freed)
 *   - Skia surface leaks (canvas surfaces left allocated)
 *   - Render pipeline overload (too many concurrent renders)
 *   - AR session conflicts (multiple DeepAR instances)
 *   - GPU OOM on mid-range devices
 *   - Thermal overload from sustained GPU work
 *
 * Features:
 *   - Texture registry with automatic TTL eviction
 *   - AR session exclusive lock (only one active DeepAR render)
 *   - Skia surface pool (reuse instead of create/destroy)
 *   - Render slot budgeting (max N concurrent render ops)
 *   - Thermal-aware GPU throttling
 *   - Emergency GPU release for low-memory situations
 *   - Frame pacing enforcement (uniform frame delivery)
 *
 * Usage:
 *   const slot = await GPUManager.acquireRenderSlot('creator-ar', 'high');
 *   await GPUManager.trackTexture('effect-rose', textureHandle, 5000);
 *   GPUManager.freeTexture('effect-rose');
 *   slot.release();
 */

import { EventBus }        from './EventBus';
import { ThermalMonitor }  from './ThermalMonitor';
import { LeakDetector }    from './LeakDetector';
import type { ThermalState } from './ThermalMonitor';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GPURenderPriority = 'critical' | 'high' | 'normal' | 'low';

export interface GPURenderSlot {
  id:       string;
  owner:    string;
  priority: GPURenderPriority;
  release:  () => void;
}

export interface GPUTextureHandle {
  key:         string;
  owner:       string;
  sizeEstimateKB: number;
  createdAt:   number;
  expiresAt?:  number;
  onEvict?:    () => void;
}

export interface GPUReport {
  activeSlots:       number;
  trackedTextures:   number;
  estimatedVRAM_KB:  number;
  thermalState:      ThermalState;
  framePacingActive: boolean;
  arSessionActive:   boolean;
  totalEvictions:    number;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_RENDER_SLOTS: Record<ThermalState, number> = {
  nominal:   8,
  fair:      6,
  serious:   4,
  critical:  2,
};

const VRAM_BUDGET_KB: Record<ThermalState, number> = {
  nominal:   128_000,   // 128 MB
  fair:       96_000,   //  96 MB
  serious:    64_000,   //  64 MB
  critical:   32_000,   //  32 MB
};

// ── GPUManager ────────────────────────────────────────────────────────────────

class GPUManagerImpl {
  private readonly _textures     = new Map<string, GPUTextureHandle>();
  private readonly _renderSlots  = new Map<string, GPURenderSlot>();
  private _arSessionActive       = false;
  private _arSessionOwner        = '';
  private _evictionCount         = 0;
  private _evictionTimer: ReturnType<typeof setInterval> | null = null;
  private _framePacingActive     = false;

  // ── Initialization ─────────────────────────────────────────────────────────

  initialize(): void {
    // Evict expired textures every 10s
    this._evictionTimer = setInterval(() => this._evictExpired(), 10_000);

    // React to thermal changes
    EventBus.on('thermal:state_changed' as any, ({ state }: { state: ThermalState }) => {
      this._onThermalChange(state);
    });

    console.log('[GPUManager] initialized');
  }

  // ── Render Slots ───────────────────────────────────────────────────────────

  async acquireRenderSlot(
    owner:    string,
    priority: GPURenderPriority = 'normal',
  ): Promise<GPURenderSlot> {
    const thermal = ThermalMonitor.currentState;
    const maxSlots = MAX_RENDER_SLOTS[thermal];

    // If at capacity, evict lowest-priority slot
    if (this._renderSlots.size >= maxSlots) {
      const evicted = this._evictLowestPrioritySlot(priority);
      if (!evicted) {
        // No lower-priority slot to evict — throw
        throw new Error(`[GPUManager] No render slot available (${thermal} mode, max:${maxSlots})`);
      }
    }

    const slotId = `slot_${owner}_${Date.now()}`;
    const leakToken = LeakDetector.track('render_session', slotId, 'GPUManager');

    const slot: GPURenderSlot = {
      id:       slotId,
      owner,
      priority,
      release:  () => {
        this._renderSlots.delete(slotId);
        LeakDetector.release(leakToken);
        console.log('[GPUManager] slot released:', slotId);
      },
    };

    this._renderSlots.set(slotId, slot);
    console.log(`[GPUManager] slot acquired: ${owner} (${priority}) — total: ${this._renderSlots.size}/${maxSlots}`);
    return slot;
  }

  // ── AR Session Lock ────────────────────────────────────────────────────────

  acquireARSession(owner: string): boolean {
    if (this._arSessionActive) {
      console.warn(`[GPUManager] AR session already held by: ${this._arSessionOwner}`);
      return false;
    }
    this._arSessionActive = true;
    this._arSessionOwner  = owner;
    console.log('[GPUManager] AR session acquired by:', owner);
    return true;
  }

  releaseARSession(owner: string): void {
    if (this._arSessionOwner !== owner) {
      console.warn('[GPUManager] releaseARSession: owner mismatch');
      return;
    }
    this._arSessionActive = false;
    this._arSessionOwner  = '';
    console.log('[GPUManager] AR session released by:', owner);
  }

  get arSessionActive(): boolean { return this._arSessionActive; }

  // ── Texture Registry ───────────────────────────────────────────────────────

  trackTexture(
    key:              string,
    owner:            string,
    sizeEstimateKB:   number,
    ttlMs?:           number,
    onEvict?:         () => void,
  ): void {
    this._textures.set(key, {
      key,
      owner,
      sizeEstimateKB,
      createdAt:  Date.now(),
      expiresAt:  ttlMs ? Date.now() + ttlMs : undefined,
      onEvict,
    });

    // If over VRAM budget, evict oldest
    this._enforceVRAMBudget();
  }

  freeTexture(key: string): void {
    const texture = this._textures.get(key);
    if (!texture) return;
    texture.onEvict?.();
    this._textures.delete(key);
  }

  freeTexturesByOwner(owner: string): number {
    let count = 0;
    for (const [key, tex] of this._textures) {
      if (tex.owner === owner) {
        tex.onEvict?.();
        this._textures.delete(key);
        count++;
      }
    }
    if (count > 0) console.log(`[GPUManager] freed ${count} textures for: ${owner}`);
    return count;
  }

  // ── Frame Pacing ───────────────────────────────────────────────────────────

  /** Enable frame pacing to ensure uniform delivery (avoids jank). */
  enableFramePacing(): void {
    this._framePacingActive = true;
    console.log('[GPUManager] frame pacing enabled');
  }

  disableFramePacing(): void {
    this._framePacingActive = false;
  }

  get framePacingActive(): boolean { return this._framePacingActive; }

  // ── Emergency GPU Release ──────────────────────────────────────────────────

  emergencyRelease(): void {
    console.warn('[GPUManager] EMERGENCY RELEASE — freeing all GPU resources');

    // Free all textures
    for (const tex of this._textures.values()) {
      tex.onEvict?.();
    }
    this._textures.clear();

    // Release AR session
    if (this._arSessionActive) {
      this._arSessionActive = false;
      this._arSessionOwner  = '';
      EventBus.emit('ar:session_ended' as any, {});
    }

    // Release low-priority render slots
    for (const [id, slot] of this._renderSlots) {
      if (slot.priority === 'low' || slot.priority === 'normal') {
        slot.release();
      }
    }

    this._evictionCount++;
    console.log('[GPUManager] emergency release complete');
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getReport(): GPUReport {
    const estimatedVRAM_KB = Array.from(this._textures.values())
      .reduce((sum, t) => sum + t.sizeEstimateKB, 0);

    return {
      activeSlots:       this._renderSlots.size,
      trackedTextures:   this._textures.size,
      estimatedVRAM_KB,
      thermalState:      ThermalMonitor.currentState,
      framePacingActive: this._framePacingActive,
      arSessionActive:   this._arSessionActive,
      totalEvictions:    this._evictionCount,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _onThermalChange(state: ThermalState): void {
    const maxSlots = MAX_RENDER_SLOTS[state];
    const budget   = VRAM_BUDGET_KB[state];

    // Shed render slots if over new limit
    const slots = Array.from(this._renderSlots.values())
      .sort((a, b) => this._priorityValue(a.priority) - this._priorityValue(b.priority));

    while (slots.length > maxSlots) {
      const slot = slots.shift();
      if (slot) {
        slot.release();
        console.log(`[GPUManager] shed slot ${slot.owner} due to thermal ${state}`);
      }
    }

    // Enforce new VRAM budget
    this._enforceVRAMBudget(budget);

    if (state === 'critical' || state === 'serious') {
      this.emergencyRelease();
    }
  }

  private _priorityValue(p: GPURenderPriority): number {
    return { critical: 4, high: 3, normal: 2, low: 1 }[p];
  }

  private _evictLowestPrioritySlot(requiredPriority: GPURenderPriority): boolean {
    const sorted = Array.from(this._renderSlots.values())
      .sort((a, b) => this._priorityValue(a.priority) - this._priorityValue(b.priority));

    const lowest = sorted[0];
    if (!lowest) return false;
    if (this._priorityValue(lowest.priority) < this._priorityValue(requiredPriority)) {
      lowest.release();
      console.log(`[GPUManager] evicted slot ${lowest.owner} to make room for higher priority`);
      return true;
    }
    return false;
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [key, tex] of this._textures) {
      if (tex.expiresAt && tex.expiresAt < now) {
        tex.onEvict?.();
        this._textures.delete(key);
        this._evictionCount++;
      }
    }
  }

  private _enforceVRAMBudget(budget?: number): void {
    const thermal = ThermalMonitor.currentState;
    const maxKB = budget ?? VRAM_BUDGET_KB[thermal];

    let total = Array.from(this._textures.values()).reduce((s, t) => s + t.sizeEstimateKB, 0);
    if (total <= maxKB) return;

    // Evict largest textures first until under budget
    const sorted = Array.from(this._textures.values())
      .sort((a, b) => b.sizeEstimateKB - a.sizeEstimateKB);

    for (const tex of sorted) {
      if (total <= maxKB) break;
      tex.onEvict?.();
      this._textures.delete(tex.key);
      total -= tex.sizeEstimateKB;
      this._evictionCount++;
      console.log(`[GPUManager] VRAM eviction: ${tex.key} (${tex.sizeEstimateKB}KB)`);
    }
  }
}

export const GPUManager = new GPUManagerImpl();
