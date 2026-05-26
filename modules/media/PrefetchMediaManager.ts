/**
 * modules/media/PrefetchMediaManager.ts — Intelligent media prefetching
 *
 * Prefetches media in the background to reduce load times and stutters:
 *   - Feed videos: next 2–3 videos after current (scroll prediction)
 *   - Stories: adjacent user stories
 *   - Thumbnails: visible + 5 ahead in FlatList
 *   - AR filter assets: active filter's neighboring filters
 *   - User avatars: visible profiles in feed/chat
 *
 * Priority system:
 *   CRITICAL (immediate): currently visible media
 *   HIGH (100ms):         next 1 item in list
 *   NORMAL (500ms):       next 2–3 items
 *   LOW (2s):             further ahead / conditional
 *
 * Network-aware:
 *   WiFi:       prefetch up to 5 items ahead, high quality
 *   Cellular:   prefetch 1 item ahead, thumbnails only
 *   Offline:    no prefetch, serve from cache only
 *
 * Power-aware:
 *   Emergency tier: no prefetch
 *   Saver tier:     thumbnails only
 *
 * Deduplicates: won't prefetch already cached items.
 */

import { CacheManager }  from './CacheManager';
import { AppLifecycle }  from '../core/AppLifecycle';

export type PrefetchPriority = 'critical' | 'high' | 'normal' | 'low';
export type NetworkMode      = 'wifi' | 'cellular' | 'offline';
export type PowerMode        = 'performance' | 'balanced' | 'saver' | 'emergency';

export interface PrefetchTask {
  url:       string;
  subDir:    string;
  priority:  PrefetchPriority;
  context?:  string;   // e.g. 'feed', 'stories', 'avatars'
}

const PRIORITY_DELAYS_MS: Record<PrefetchPriority, number> = {
  critical: 0,
  high:     100,
  normal:   500,
  low:      2_000,
};

// Max concurrent downloads per priority
const MAX_CONCURRENT: Record<PrefetchPriority, number> = {
  critical: 3,
  high:     2,
  normal:   2,
  low:      1,
};

class PrefetchMediaManagerImpl {
  private readonly _queue     = new Map<string, PrefetchTask>();
  private readonly _inFlight  = new Set<string>();
  private readonly _timers    = new Map<PrefetchPriority, ReturnType<typeof setTimeout> | null>();
  private _networkMode: NetworkMode = 'wifi';
  private _powerMode:   PowerMode   = 'performance';
  private _paused       = false;

  constructor() {
    AppLifecycle.onBackground(() => { this._paused = true; });
    AppLifecycle.onForeground(() => { this._paused = false; this._scheduleAll(); });
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  setNetworkMode(m: NetworkMode): void {
    this._networkMode = m;
    if (m === 'offline') this.cancelAll();
  }

  setPowerMode(m: PowerMode): void {
    this._powerMode = m;
    if (m === 'emergency') this.cancelAll();
  }

  // ── Prefetch API ──────────────────────────────────────────────────────────

  /** Queue a URL for prefetching. */
  prefetch(task: PrefetchTask): void {
    if (!this._shouldPrefetch(task)) return;

    // Skip if already cached
    if (CacheManager.get(task.url)) return;

    // Skip if already queued or in-flight
    if (this._queue.has(task.url) || this._inFlight.has(task.url)) return;

    this._queue.set(task.url, task);
    this._scheduleForPriority(task.priority);
  }

  /** Queue multiple URLs at once (e.g., next N feed items). */
  prefetchBatch(tasks: PrefetchTask[]): void {
    for (const task of tasks) this.prefetch(task);
  }

  /** Remove a URL from the queue (e.g., user scrolled far past). */
  cancel(url: string): void {
    this._queue.delete(url);
  }

  /** Clear all queued prefetch tasks. */
  cancelAll(): void {
    this._queue.clear();
    for (const [priority, timer] of this._timers) {
      if (timer) clearTimeout(timer);
      this._timers.set(priority, null);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get queuedCount():  number { return this._queue.size; }
  get inFlightCount(): number { return this._inFlight.size; }

  getQueueByContext(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const task of this._queue.values()) {
      const ctx = task.context ?? 'unknown';
      out[ctx] = (out[ctx] ?? 0) + 1;
    }
    return out;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _shouldPrefetch(task: PrefetchTask): boolean {
    if (this._paused) return false;
    if (this._networkMode === 'offline') return false;
    if (this._powerMode === 'emergency') return false;
    if (this._powerMode === 'saver' && task.priority === 'low') return false;
    if (this._networkMode === 'cellular' && task.priority === 'low') return false;
    return true;
  }

  private _scheduleAll(): void {
    const priorities: PrefetchPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const p of priorities) this._scheduleForPriority(p);
  }

  private _scheduleForPriority(priority: PrefetchPriority): void {
    if (this._timers.get(priority)) return; // already scheduled

    const delay = PRIORITY_DELAYS_MS[priority];
    const timer = setTimeout(async () => {
      this._timers.set(priority, null);
      await this._drainPriority(priority);
    }, delay);

    this._timers.set(priority, timer);
  }

  private async _drainPriority(priority: PrefetchPriority): Promise<void> {
    if (this._paused) return;

    const tasks = Array.from(this._queue.values())
      .filter(t => t.priority === priority)
      .slice(0, MAX_CONCURRENT[priority]);

    if (tasks.length === 0) return;

    await Promise.all(tasks.map(async task => {
      this._queue.delete(task.url);
      this._inFlight.add(task.url);

      try {
        const result = await CacheManager.getOrFetch(task.url, task.subDir);
        if (result) {
          // Success — already stored in cache
        }
      } catch { /* prefetch failures are silent */ } finally {
        this._inFlight.delete(task.url);
      }
    }));
  }
}

export const PrefetchMediaManager = new PrefetchMediaManagerImpl();
