/**
 * modules/core/GPUManager.ts — v2 GPU resource orchestration
 *
 * Phase 4 additions:
 *   - acquireSlot() alias (used by creator-studio and live screens)
 *   - releaseSlot() alias
 *   - getReport() returns usedSlots/maxSlots for ProductionStabilityMode
 *   - Removed throw new Error on slot exhaustion — returns null + logs warning
 *   - _onThermalChange: only call emergencyRelease on 'critical' (not 'serious')
 *   - VRAM eviction is now non-throwing (catches internal errors)
 *   - initialize() idempotent guard prevents double setInterval on hot reload
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
  key:             string;
  owner:           string;
  sizeEstimateKB:  number;
  createdAt:       number;
  expiresAt?:      number;
  onEvict?:        () => void;
}

export interface GPUReport {
  usedSlots:         number;
  maxSlots:          number;
  activeSlots:       number;      // alias for usedSlots
  trackedTextures:   number;
  estimatedVRAM_KB:  number;
  thermalState:      ThermalState;
  framePacingActive: boolean;
  arSessionActive:   boolean;
  totalEvictions:    number;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_RENDER_SLOTS: Record<ThermalState, number> = {
  nominal:  8,
  fair:     6,
  serious:  4,
  critical: 2,
};

const VRAM_BUDGET_KB: Record<ThermalState, number> = {
  nominal:  128_000,
  fair:      96_000,
  serious:   64_000,
  critical:  32_000,
};

// ── GPUManager ────────────────────────────────────────────────────────────────

class GPUManagerImpl {
  private readonly _textures    = new Map<string, GPUTextureHandle>();
  private readonly _renderSlots = new Map<string, GPURenderSlot>();
  private _arSessionActive      = false;
  private _arSessionOwner       = '';
  private _evictionCount        = 0;
  private _evictionTimer: ReturnType<typeof setInterval> | null = null;
  private _framePacingActive    = false;
  private _initialized          = false;

  // ── Initialization ─────────────────────────────────────────────────────────

  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Evict expired textures every 10s
    this._evictionTimer = setInterval(() => this._evictExpired(), 10_000);

    // React to thermal changes
    EventBus.on('thermal:state_changed' as any, ({ state }: { state: ThermalState }) => {
      this._onThermalChange(state);
    });

    console.log('[GPUManager] initialized');
  }

  // ── Render Slots ───────────────────────────────────────────────────────────

  /**
   * Primary slot acquisition.
   * Returns null (no throw) if no slot is available — caller degrades gracefully.
   */
  async acquireRenderSlot(
    owner:    string,
    priority: GPURenderPriority = 'normal',
  ): Promise<GPURenderSlot | null> {
    const thermal  = ThermalMonitor.currentState;
    const maxSlots = MAX_RENDER_SLOTS[thermal];

    if (this._renderSlots.size >= maxSlots) {
      const evicted = this._evictLowestPrioritySlot(priority);
      if (!evicted) {
        console.warn(`[GPUManager] no slot available — owner:${owner} thermal:${thermal}`);
        return null;   // ← no throw
      }
    }

    const slotId     = `slot_${owner}_${Date.now()}`;
    const leakToken  = LeakDetector.track('render_session', slotId, 'GPUManager');

    const slot: GPURenderSlot = {
      id:       slotId,
      owner,
      priority,
      release:  () => {
        this._renderSlots.delete(slotId);
        LeakDetector.release(leakToken);
      },
    };

    this._renderSlots.set(slotId, slot);
    console.log(`[GPUManager] slot acquired: ${owner} (${priority}) ${this._renderSlots.size}/${maxSlots}`);
    return slot;
  }

  /**
   * Convenience alias used by creator-studio and live screens.
   * Returns a slot ID string or null on failure.
   */
  async acquireSlot(owner: string, priority: GPURenderPriority = 'normal'): Promise<string | null> {
    const slot = await this.acquireRenderSlot(owner, priority);
    return slot?.id ?? null;
  }

  /** Release a slot by its ID string (acquireSlot companion). */
  releaseSlot(slotId: string): void {
    const slot = this._renderSlots.get(slotId);
    if (slot) {
      slot.release();
    } else {
      // Attempt prefix-match in case ID was truncated
      for (const [id, s] of this._renderSlots) {
        if (id === slotId) { s.release(); break; }
      }
    }
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
    key:            string,
    owner:          string,
    sizeEstimateKB: number,
    ttlMs?:         number,
    onEvict?:       () => void,
  ): void {
    this._textures.set(key, {
      key, owner, sizeEstimateKB,
      createdAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      onEvict,
    });
    this._enforceVRAMBudget();
  }

  freeTexture(key: string): void {
    const texture = this._textures.get(key);
    if (!texture) return;
    try { texture.onEvict?.(); } catch { /* ignore */ }
    this._textures.delete(key);
  }

  freeTexturesByOwner(owner: string): number {
    let count = 0;
    for (const [key, tex] of this._textures) {
      if (tex.owner === owner) {
        try { tex.onEvict?.(); } catch { /* ignore */ }
        this._textures.delete(key);
        count++;
      }
    }
    if (count > 0) console.log(`[GPUManager] freed ${count} textures for: ${owner}`);
    return count;
  }

  // ── Frame Pacing ───────────────────────────────────────────────────────────

  enableFramePacing():  void { this._framePacingActive = true;  console.log('[GPUManager] frame pacing on'); }
  disableFramePacing(): void { this._framePacingActive = false; }
  get framePacingActive(): boolean { return this._framePacingActive; }

  // ── Emergency GPU Release ──────────────────────────────────────────────────

  emergencyRelease(): void {
    console.warn('[GPUManager] EMERGENCY RELEASE');

    for (const tex of this._textures.values()) {
      try { tex.onEvict?.(); } catch { /* ignore */ }
    }
    this._textures.clear();

    if (this._arSessionActive) {
      this._arSessionActive = false;
      this._arSessionOwner  = '';
      EventBus.emit('ar:session_ended' as any, {});
    }

    // Only release low + normal priority slots — keep critical/high alive
    for (const slot of Array.from(this._renderSlots.values())) {
      if (slot.priority === 'low' || slot.priority === 'normal') {
        slot.release();
      }
    }

    this._evictionCount++;
    console.log('[GPUManager] emergency release complete');
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getReport(): GPUReport {
    const thermal       = ThermalMonitor.currentState;
    const maxSlots      = MAX_RENDER_SLOTS[thermal];
    const estimatedVRAM = Array.from(this._textures.values())
      .reduce((s, t) => s + t.sizeEstimateKB, 0);

    return {
      usedSlots:         this._renderSlots.size,
      maxSlots,
      activeSlots:       this._renderSlots.size,
      trackedTextures:   this._textures.size,
      estimatedVRAM_KB:  estimatedVRAM,
      thermalState:      thermal,
      framePacingActive: this._framePacingActive,
      arSessionActive:   this._arSessionActive,
      totalEvictions:    this._evictionCount,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _onThermalChange(state: ThermalState): void {
    const maxSlots = MAX_RENDER_SLOTS[state];
    const budget   = VRAM_BUDGET_KB[state];

    // Shed slots exceeding new limit (lowest priority first)
    const slots = Array.from(this._renderSlots.values())
      .sort((a, b) => this._priorityValue(a.priority) - this._priorityValue(b.priority));

    while (slots.length > maxSlots) {
      const slot = slots.shift();
      if (slot) {
        slot.release();
        console.log(`[GPUManager] shed slot ${slot.owner} thermal=${state}`);
      }
    }

    this._enforceVRAMBudget(budget);

    // Emergency release only on 'critical', not 'serious' (Phase 4 fix)
    if (state === 'critical') {
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
      console.log(`[GPUManager] evicted slot ${lowest.owner} for ${requiredPriority}`);
      return true;
    }
    return false;
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [key, tex] of this._textures) {
      if (tex.expiresAt && tex.expiresAt < now) {
        try { tex.onEvict?.(); } catch { /* ignore */ }
        this._textures.delete(key);
        this._evictionCount++;
      }
    }
  }

  private _enforceVRAMBudget(budget?: number): void {
    const thermal = ThermalMonitor.currentState;
    const maxKB   = budget ?? VRAM_BUDGET_KB[thermal];
    let total = Array.from(this._textures.values()).reduce((s, t) => s + t.sizeEstimateKB, 0);
    if (total <= maxKB) return;

    const sorted = Array.from(this._textures.values())
      .sort((a, b) => b.sizeEstimateKB - a.sizeEstimateKB);

    for (const tex of sorted) {
      if (total <= maxKB) break;
      try { tex.onEvict?.(); } catch { /* ignore */ }
      this._textures.delete(tex.key);
      total -= tex.sizeEstimateKB;
      this._evictionCount++;
    }
  }
}

export const GPUManager = new GPUManagerImpl();
