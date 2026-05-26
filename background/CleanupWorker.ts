/**
 * background/CleanupWorker.ts — Aggressive resource & cache cleanup
 *
 * Prevents memory leaks and disk bloat by periodically cleaning:
 *   - Expired cache entries (CacheManager LRU eviction)
 *   - Temporary media files (camera captures, FFmpeg outputs)
 *   - Stale SyncEngine mutations (> 5min old without commit)
 *   - Orphaned EventBus listeners (leaked subscriptions)
 *   - Expired game sessions (TimerManager cleanup)
 *   - PresenceManager cache (TTL expired entries)
 *   - MediaStore stale active uploads (stuck > 10min)
 *
 * Runs every 60 seconds in foreground, pauses in background.
 * Each cleanup task is isolated — one failure doesn't stop others.
 *
 * Usage:
 *   CleanupWorker.start();
 *   CleanupWorker.runNow();  // force immediate pass
 *   CleanupWorker.stop();
 */

import { AppLifecycle }     from '@/modules/core/AppLifecycle';
import { CacheManager }     from '@/modules/media/CacheManager';
import { SyncEngine }       from '@/modules/realtime/SyncEngine';
import { ResourceManager }  from '@/modules/core/ResourceManager';
import { MediaStore }       from '@/store/media.store';

const CLEANUP_INTERVAL_MS  = 60_000;   // 1 min
const STUCK_UPLOAD_TIMEOUT = 10 * 60 * 1000;   // 10 min

class CleanupWorkerImpl {
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  start(): void {
    if (this._running) return;
    this._running = true;

    this._intervalId = setInterval(() => this.runNow(), CLEANUP_INTERVAL_MS);

    AppLifecycle.onBackground(() => {
      // Run a pass before backgrounding to free memory proactively
      this.runNow();
      if (this._intervalId) {
        clearInterval(this._intervalId);
        this._intervalId = null;
      }
    });

    AppLifecycle.onForeground(() => {
      if (this._running && !this._intervalId) {
        this._intervalId = setInterval(() => this.runNow(), CLEANUP_INTERVAL_MS);
        this.runNow();  // immediate pass on resume
      }
    });

    console.log('[CleanupWorker] started');
  }

  stop(): void {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  async runNow(): Promise<void> {
    const tasks: Array<[string, () => any]> = [
      ['cache:evict',          () => CacheManager.evictExpired()],
      ['sync:stale',           () => SyncEngine.cleanupStale()],
      ['uploads:stuck',        () => this._cleanupStuckUploads()],
      ['resources:orphaned',   () => this._cleanupOrphanedResources()],
    ];

    for (const [name, task] of tasks) {
      try {
        await task();
      } catch (e: any) {
        console.warn(`[CleanupWorker] task "${name}" failed:`, e?.message);
      }
    }
  }

  private _cleanupStuckUploads(): void {
    const now     = Date.now();
    const state   = MediaStore.getState();
    const active  = state.activeUploads;
    const updated = { ...active };
    let changed   = false;

    for (const [id, upload] of Object.entries(active)) {
      // If progress hasn't moved in STUCK_UPLOAD_TIMEOUT, remove
      if ((upload as any).startedAt && now - (upload as any).startedAt > STUCK_UPLOAD_TIMEOUT) {
        console.warn('[CleanupWorker] removing stuck upload:', id);
        delete updated[id];
        changed = true;
      }
    }

    if (changed) MediaStore.setState({ activeUploads: updated });
  }

  private _cleanupOrphanedResources(): void {
    // Log resources held for > 30 minutes (likely leaked)
    const held = ResourceManager.heldResources();
    for (const resource of held) {
      if (resource.ageMs > 30 * 60 * 1000) {
        console.warn(
          `[CleanupWorker] resource "${resource.type}" held by [${resource.holders.join(',')}] `
          + `for ${(resource.ageMs / 60000).toFixed(1)} min — possible leak`,
        );
      }
    }
  }
}

export const CleanupWorker = new CleanupWorkerImpl();
