/**
 * modules/core/ResourceManager.ts — Native resource lifecycle controller
 *
 * Tracks and releases GPU/camera/audio/stream resources to prevent:
 *   - Metal CALayer leaks (DeepAR, live camera)
 *   - Audio session conflicts (calls vs background music)
 *   - Memory pressure from retained video textures
 *   - Concurrent camera access crashes (one consumer at a time)
 *
 * Design:
 *   - Each resource has a named "slot" with an exclusive holder
 *   - Requesting a slot from a new holder forces release from old holder
 *   - AppLifecycle background event triggers automatic release of
 *     camera + GPU resources to prevent background battery drain
 *
 * Usage:
 *   const release = await ResourceManager.acquire('camera', 'creator-studio');
 *   // ... use camera ...
 *   release(); // or ResourceManager.release('camera')
 */

import { AppLifecycle } from './AppLifecycle';
import { EventBus }     from './EventBus';

export type ResourceType =
  | 'camera'          // Physical camera sensor
  | 'microphone'      // Audio input
  | 'gpu_filter'      // GPU/Metal shader pipeline (DeepAR, Skia effects)
  | 'audio_session'   // AVAudioSession (iOS) / AudioFocus (Android)
  | 'webrtc_peer'     // WebRTC peer connection
  | 'media_recorder'  // Video/audio recording session
  | 'screen_capture'; // Screen share / broadcast

export interface ResourceLease {
  type:       ResourceType;
  holder:     string;
  acquiredAt: number;
  release:    () => void;
}

type ReleaseCallback = () => void | Promise<void>;

class ResourceManagerImpl {
  private readonly _leases = new Map<ResourceType, ResourceLease>();
  private readonly _onRelease = new Map<ResourceType, ReleaseCallback[]>();

  constructor() {
    // Release camera + GPU when app backgrounds (critical for battery and memory)
    AppLifecycle.onBackground(async () => {
      await this.release('camera');
      await this.release('gpu_filter');
      await this.release('media_recorder');
      console.log('[ResourceManager] background — camera/GPU released');
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Acquire exclusive access to a resource.
   * If another holder owns it, their release callback is called first.
   *
   * @returns A release function. Call it when done with the resource.
   */
  async acquire(type: ResourceType, holder: string): Promise<ReleaseCallback> {
    const existing = this._leases.get(type);
    if (existing && existing.holder !== holder) {
      console.log(`[ResourceManager] ${type}: "${existing.holder}" → "${holder}" (forced release)`);
      await this._forceRelease(type);
    }

    const releaseThisLease = async () => {
      const lease = this._leases.get(type);
      if (lease?.holder === holder) {
        await this._forceRelease(type);
      }
    };

    const lease: ResourceLease = {
      type,
      holder,
      acquiredAt: Date.now(),
      release: releaseThisLease,
    };
    this._leases.set(type, lease);
    console.log(`[ResourceManager] ${type}: acquired by "${holder}"`);

    return releaseThisLease;
  }

  /** Check if a resource is currently held. */
  isHeld(type: ResourceType): boolean {
    return this._leases.has(type);
  }

  /** Get the current holder of a resource. */
  getHolder(type: ResourceType): string | null {
    return this._leases.get(type)?.holder ?? null;
  }

  /** Release a resource (by type). No-op if not held. */
  async release(type: ResourceType): Promise<void> {
    if (this._leases.has(type)) {
      await this._forceRelease(type);
    }
  }

  /** Release ALL resources (e.g. on logout or app reset). */
  async releaseAll(): Promise<void> {
    for (const type of this._leases.keys()) {
      await this._forceRelease(type);
    }
    console.log('[ResourceManager] all resources released');
  }

  /**
   * Register a teardown callback for a resource type.
   * Called automatically when the resource is released.
   * Multiple callbacks supported (called in order).
   */
  onRelease(type: ResourceType, cb: ReleaseCallback): () => void {
    const cbs = this._onRelease.get(type) ?? [];
    cbs.push(cb);
    this._onRelease.set(type, cbs);
    return () => {
      const list = this._onRelease.get(type) ?? [];
      this._onRelease.set(type, list.filter(c => c !== cb));
    };
  }

  /** Diagnostics: list currently held resources. */
  heldResources(): Array<{ type: ResourceType; holder: string; ageMs: number }> {
    const now = Date.now();
    return Array.from(this._leases.values()).map(l => ({
      type:   l.type,
      holder: l.holder,
      ageMs:  now - l.acquiredAt,
    }));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _forceRelease(type: ResourceType): Promise<void> {
    const lease = this._leases.get(type);
    if (!lease) return;

    this._leases.delete(type);

    const callbacks = this._onRelease.get(type) ?? [];
    for (const cb of callbacks) {
      try { await cb(); } catch (e: any) {
        console.warn(`[ResourceManager] release callback error for ${type}:`, e?.message);
      }
    }

    console.log(`[ResourceManager] ${type}: released (was held by "${lease.holder}")`);
  }
}

export const ResourceManager = new ResourceManagerImpl();
