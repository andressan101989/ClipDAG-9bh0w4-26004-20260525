/**
 * modules/core/ResourceManager.ts — Central hardware & session resource controller
 *
 * Single authority for ALL heavy resources in the app. Prevents:
 *   - Concurrent camera/mic access crashes
 *   - Metal CALayer leaks (DeepAR, live camera)
 *   - Audio session conflicts (calls vs background music vs stream)
 *   - WebRTC peer connection leaks
 *   - GPU pipeline accumulation (Skia, DeepAR, recording sessions)
 *   - Background resource drain (battery + thermal)
 *
 * Resource model:
 *   - Each resource has EXCLUSIVE or SHARED ownership mode
 *   - EXCLUSIVE: only one holder at a time; new acquire forces release
 *   - SHARED: multiple holders allowed (e.g. read-only media buffers)
 *   - Priority levels: CRITICAL > HIGH > NORMAL > LOW
 *     Lower-priority holders are pre-empted by higher-priority ones
 *
 * Lifecycle hooks:
 *   - Background event → release camera/GPU/mic/AR immediately
 *   - Low memory event → release all non-critical resources
 *   - Emergency mode → release everything except active call
 *
 * Usage:
 *   const release = await ResourceManager.acquire('camera', 'creator-studio');
 *   // ... use camera ...
 *   release();  // or ResourceManager.release('camera')
 *
 *   ResourceManager.onRelease('camera', async () => {
 *     await cameraRef.current?.stopPreview();
 *   });
 */

import { AppLifecycle } from './AppLifecycle';
import { EventBus }     from './EventBus';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ResourceType =
  | 'camera'            // Physical camera sensor
  | 'microphone'        // Audio input
  | 'gpu_filter'        // GPU/Metal shader pipeline (DeepAR, Skia)
  | 'audio_session'     // AVAudioSession (iOS) / AudioFocus (Android)
  | 'audio_playback'    // Background music / sound effects playback
  | 'webrtc_peer'       // WebRTC peer connection slot
  | 'media_recorder'    // Video/audio capture session
  | 'ar_session'        // DeepAR / ARKit session
  | 'screen_capture'    // Screen share / broadcast extension
  | 'stream_publish'    // Outbound live stream pipeline
  | 'stream_subscribe'  // Inbound live stream playback
  | 'background_upload' // Active upload pipeline (bandwidth-heavy)
  | 'render_compositor' // Offline render compositor (CPU/GPU intensive)
  | 'game_session'      // Active mini-game loop
  | 'media_buffer';     // Large in-memory media buffer (SHARED mode)

type OwnershipMode = 'exclusive' | 'shared';
type Priority      = 'critical' | 'high' | 'normal' | 'low';

const RESOURCE_CONFIG: Record<ResourceType, { mode: OwnershipMode; priority: Priority; releaseOnBackground: boolean }> = {
  camera:            { mode: 'exclusive', priority: 'high',     releaseOnBackground: true  },
  microphone:        { mode: 'exclusive', priority: 'high',     releaseOnBackground: false },
  gpu_filter:        { mode: 'exclusive', priority: 'high',     releaseOnBackground: true  },
  audio_session:     { mode: 'exclusive', priority: 'high',     releaseOnBackground: false },
  audio_playback:    { mode: 'exclusive', priority: 'normal',   releaseOnBackground: false },
  webrtc_peer:       { mode: 'exclusive', priority: 'critical', releaseOnBackground: false },
  media_recorder:    { mode: 'exclusive', priority: 'high',     releaseOnBackground: true  },
  ar_session:        { mode: 'exclusive', priority: 'high',     releaseOnBackground: true  },
  screen_capture:    { mode: 'exclusive', priority: 'high',     releaseOnBackground: true  },
  stream_publish:    { mode: 'exclusive', priority: 'critical', releaseOnBackground: false },
  stream_subscribe:  { mode: 'shared',   priority: 'normal',   releaseOnBackground: true  },
  background_upload: { mode: 'shared',   priority: 'low',      releaseOnBackground: false },
  render_compositor: { mode: 'exclusive', priority: 'normal',   releaseOnBackground: true  },
  game_session:      { mode: 'exclusive', priority: 'high',     releaseOnBackground: false },
  media_buffer:      { mode: 'shared',   priority: 'low',      releaseOnBackground: true  },
};

const PRIORITY_ORDER: Record<Priority, number> = { critical: 4, high: 3, normal: 2, low: 1 };

export interface ResourceLease {
  type:       ResourceType;
  holder:     string;
  priority:   Priority;
  acquiredAt: number;
  release:    () => Promise<void>;
}

type ReleaseCallback = () => void | Promise<void>;

interface LeaseEntry {
  leases:     Map<string, ResourceLease>;  // shared: multiple holders; exclusive: one
  releaseCallbacks: Map<string, ReleaseCallback[]>;
}

// ── Implementation ─────────────────────────────────────────────────────────────

class ResourceManagerImpl {
  private readonly _resources = new Map<ResourceType, LeaseEntry>();
  private readonly _globalReleaseCallbacks = new Map<ResourceType, ReleaseCallback[]>();
  private _emergencyMode = false;

  constructor() {
    this._initEntry();

    // Release backgroundable resources when app goes to background
    AppLifecycle.onBackground(async () => {
      const types = (Object.keys(RESOURCE_CONFIG) as ResourceType[])
        .filter(t => RESOURCE_CONFIG[t].releaseOnBackground);
      for (const type of types) {
        await this._releaseAll(type, 'background');
      }
      console.log('[ResourceManager] background cleanup complete');
    });

    // Low-memory: release all non-critical resources
    EventBus.on('app:low_memory', async () => {
      console.warn('[ResourceManager] LOW MEMORY — releasing non-critical resources');
      const types = (Object.keys(RESOURCE_CONFIG) as ResourceType[])
        .filter(t => RESOURCE_CONFIG[t].priority !== 'critical');
      for (const type of types) {
        await this._releaseAll(type, 'low_memory');
      }
    });
  }

  // ── Acquire ──────────────────────────────────────────────────────────────────

  /**
   * Acquire access to a resource.
   * Exclusive resources: forces release of lower/equal priority holders.
   * Shared resources: adds holder to the set.
   *
   * @returns Async release function — MUST be called when done.
   */
  async acquire(
    type:     ResourceType,
    holder:   string,
    priority: Priority = 'normal',
  ): Promise<() => Promise<void>> {
    const config = RESOURCE_CONFIG[type];
    const entry  = this._getEntry(type);

    if (config.mode === 'exclusive') {
      const existing = entry.leases.size > 0
        ? Array.from(entry.leases.values())[0]
        : null;

      if (existing && existing.holder !== holder) {
        const existingPriority = PRIORITY_ORDER[existing.priority];
        const newPriority      = PRIORITY_ORDER[priority];

        if (newPriority >= existingPriority) {
          console.log(`[ResourceManager] ${type}: "${existing.holder}"(${existing.priority}) → "${holder}"(${priority}) — forced preempt`);
          await this._releaseHolder(type, existing.holder, 'preempted');
        } else {
          console.warn(`[ResourceManager] ${type}: "${holder}"(${priority}) DENIED — "${existing.holder}"(${existing.priority}) has higher priority`);
          throw new Error(`Resource "${type}" held by higher-priority holder "${existing.holder}"`);
        }
      }

      if (existing?.holder === holder) {
        // Re-entrant acquire — update priority
        (existing as any).priority = priority;
        return existing.release;
      }
    } else {
      // Shared: check if this holder already has it
      if (entry.leases.has(holder)) {
        return entry.leases.get(holder)!.release;
      }
    }

    const release = async () => {
      await this._releaseHolder(type, holder, 'manual');
    };

    const lease: ResourceLease = {
      type,
      holder,
      priority,
      acquiredAt: Date.now(),
      release,
    };

    entry.leases.set(holder, lease);
    console.log(`[ResourceManager] ${type}: acquired by "${holder}" [${priority}]`);
    return release;
  }

  // ── Release ───────────────────────────────────────────────────────────────────

  /** Release a specific holder's lease on a resource. */
  async release(type: ResourceType, holder?: string): Promise<void> {
    if (holder) {
      await this._releaseHolder(type, holder, 'manual');
    } else {
      await this._releaseAll(type, 'manual');
    }
  }

  /** Release ALL resources — use on logout or app reset. */
  async releaseAll(reason = 'app_reset'): Promise<void> {
    for (const type of (Object.keys(RESOURCE_CONFIG) as ResourceType[])) {
      await this._releaseAll(type, reason);
    }
    console.log(`[ResourceManager] ALL resources released (reason: ${reason})`);
  }

  /** Emergency release: drop everything except active WebRTC call. */
  async emergencyRelease(): Promise<void> {
    if (this._emergencyMode) return;
    this._emergencyMode = true;
    console.error('[ResourceManager] EMERGENCY RELEASE triggered');

    const types = (Object.keys(RESOURCE_CONFIG) as ResourceType[])
      .filter(t => t !== 'webrtc_peer');

    for (const type of types) {
      await this._releaseAll(type, 'emergency');
    }
    this._emergencyMode = false;
  }

  // ── Teardown callbacks ────────────────────────────────────────────────────────

  /**
   * Register a teardown callback for a resource type.
   * Called on every release, for every holder.
   * Use for hardware cleanup (stopPreview, releaseTexture, etc.)
   */
  onRelease(type: ResourceType, cb: ReleaseCallback): () => void {
    const cbs = this._globalReleaseCallbacks.get(type) ?? [];
    cbs.push(cb);
    this._globalReleaseCallbacks.set(type, cbs);
    return () => {
      const list = this._globalReleaseCallbacks.get(type) ?? [];
      this._globalReleaseCallbacks.set(type, list.filter(c => c !== cb));
    };
  }

  /**
   * Register a holder-specific teardown callback.
   * Called only when this specific holder releases.
   */
  onHolderRelease(type: ResourceType, holder: string, cb: ReleaseCallback): void {
    const entry = this._getEntry(type);
    const cbs = entry.releaseCallbacks.get(holder) ?? [];
    cbs.push(cb);
    entry.releaseCallbacks.set(holder, cbs);
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  isHeld(type: ResourceType): boolean {
    return (this._resources.get(type)?.leases.size ?? 0) > 0;
  }

  getHolder(type: ResourceType): string | null {
    const entry = this._resources.get(type);
    if (!entry || entry.leases.size === 0) return null;
    return Array.from(entry.leases.values())[0].holder;
  }

  getHolders(type: ResourceType): string[] {
    return Array.from(this._resources.get(type)?.leases.keys() ?? []);
  }

  heldResources(): Array<{ type: ResourceType; holders: string[]; priority: Priority; ageMs: number }> {
    const now = Date.now();
    return (Object.keys(RESOURCE_CONFIG) as ResourceType[])
      .filter(t => this.isHeld(t))
      .map(t => {
        const leases = Array.from(this._resources.get(t)!.leases.values());
        return {
          type:     t,
          holders:  leases.map(l => l.holder),
          priority: leases[0].priority,
          ageMs:    now - leases[0].acquiredAt,
        };
      });
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _initEntry(): void {
    for (const type of Object.keys(RESOURCE_CONFIG) as ResourceType[]) {
      this._resources.set(type, { leases: new Map(), releaseCallbacks: new Map() });
    }
  }

  private _getEntry(type: ResourceType): LeaseEntry {
    if (!this._resources.has(type)) {
      this._resources.set(type, { leases: new Map(), releaseCallbacks: new Map() });
    }
    return this._resources.get(type)!;
  }

  private async _releaseHolder(type: ResourceType, holder: string, reason: string): Promise<void> {
    const entry = this._resources.get(type);
    if (!entry || !entry.leases.has(holder)) return;

    entry.leases.delete(holder);

    // Run holder-specific callbacks
    const holderCbs = entry.releaseCallbacks.get(holder) ?? [];
    for (const cb of holderCbs) {
      try { await cb(); } catch (e: any) {
        console.warn(`[ResourceManager] ${type}:"${holder}" release callback error:`, e?.message);
      }
    }
    entry.releaseCallbacks.delete(holder);

    // Run global type callbacks (only when last holder releases for exclusive)
    const config = RESOURCE_CONFIG[type];
    const isLastHolder = entry.leases.size === 0;
    if (config.mode === 'exclusive' || isLastHolder) {
      const globalCbs = this._globalReleaseCallbacks.get(type) ?? [];
      for (const cb of globalCbs) {
        try { await cb(); } catch (e: any) {
          console.warn(`[ResourceManager] ${type} global release callback error:`, e?.message);
        }
      }
    }

    console.log(`[ResourceManager] ${type}: released by "${holder}" [${reason}]`);
  }

  private async _releaseAll(type: ResourceType, reason: string): Promise<void> {
    const entry = this._resources.get(type);
    if (!entry || entry.leases.size === 0) return;
    const holders = Array.from(entry.leases.keys());
    for (const holder of holders) {
      await this._releaseHolder(type, holder, reason);
    }
  }
}

export const ResourceManager = new ResourceManagerImpl();
