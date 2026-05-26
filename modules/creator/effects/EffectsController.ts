/**
 * modules/creator/effects/EffectsController.ts — AR effect pipeline manager
 *
 * Manages the effects layer above the camera feed:
 *   - DeepAR AR filters (face tracking, 3D overlays)
 *   - Skia shader effects (color grading, LUTs, blur, vignette)
 *   - Beauty filters (smoothing, skin tone, eye enhance)
 *
 * Coordinates with:
 *   - ResourceManager: exclusive gpu_filter lease
 *   - MemoryPressureMonitor: disables effects under critical memory
 *   - CameraController: knows active camera config (AR requires front cam)
 *   - deeparService: DeepAR SDK initialization and filter switching
 *
 * Design: lazy — SDK is never loaded until user explicitly enables an effect.
 */

import { ResourceManager }       from '../../core/ResourceManager';
import { MemoryPressureMonitor } from '../../core/MemoryPressureMonitor';
import { EventBus }              from '../../core/EventBus';

export type EffectType   = 'deepar' | 'skia' | 'beauty' | 'lut' | 'none';

export interface EffectTrack {
  id:        string;
  type:      EffectType;
  name:      string;
  isActive:  boolean;
  intensity: number;    // 0.0–1.0
  params?:   Record<string, any>;
}

class EffectsControllerImpl {
  private _tracks:    EffectTrack[] = [];
  private _isActive   = false;
  private _release:   (() => void) | null = null;
  private readonly _subs = new Set<(tracks: EffectTrack[]) => void>();

  get tracks():   EffectTrack[] { return this._tracks; }
  get isActive(): boolean       { return this._isActive; }
  get activeTrack(): EffectTrack | null {
    return this._tracks.find(t => t.isActive) ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async activate(holder: string): Promise<void> {
    if (this._isActive) return;

    const quality = MemoryPressureMonitor.currentQuality;
    if (!quality.effectsEnabled) {
      console.warn('[EffectsController] effects disabled due to memory pressure');
      return;
    }

    this._release = await ResourceManager.acquire('gpu_filter', holder);
    this._isActive = true;
    console.log('[EffectsController] GPU filter pipeline activated');
    this._notify();
  }

  async deactivate(): Promise<void> {
    if (!this._isActive) return;
    // Deactivate all tracks
    this._tracks = this._tracks.map(t => ({ ...t, isActive: false }));
    this._isActive = false;
    this._release?.();
    this._release = null;
    console.log('[EffectsController] GPU filter pipeline deactivated');
    this._notify();
  }

  // ── Track management ───────────────────────────────────────────────────────

  /** Enable a specific effect. Deactivates any conflicting same-type track. */
  async applyEffect(track: Omit<EffectTrack, 'isActive'>): Promise<void> {
    if (!this._isActive) await this.activate('effects-controller');

    // Deactivate existing same-type track
    this._tracks = this._tracks.map(t =>
      t.type === track.type ? { ...t, isActive: false } : t
    );

    const existing = this._tracks.find(t => t.id === track.id);
    if (existing) {
      this._tracks = this._tracks.map(t =>
        t.id === track.id ? { ...t, ...track, isActive: true } : t
      );
    } else {
      this._tracks = [...this._tracks, { ...track, isActive: true }];
    }

    EventBus.emit('studio:filter_applied', { filterId: track.id, filterName: track.name });
    this._notify();
  }

  removeEffect(id: string): void {
    this._tracks = this._tracks.filter(t => t.id !== id);
    this._notify();
  }

  clearAllEffects(): void {
    this._tracks = [];
    this._notify();
    if (this._isActive) this.deactivate();
  }

  setIntensity(id: string, intensity: number): void {
    this._tracks = this._tracks.map(t =>
      t.id === id ? { ...t, intensity: Math.max(0, Math.min(1, intensity)) } : t
    );
    this._notify();
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: (tracks: EffectTrack[]) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._tracks); } catch { /* isolate */ }
    }
  }
}

export const EffectsController = new EffectsControllerImpl();
