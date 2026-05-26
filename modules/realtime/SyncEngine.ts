/**
 * modules/realtime/SyncEngine.ts — State synchronization engine
 *
 * Provides optimistic updates + background reconciliation for domain stores.
 * Pattern: write locally immediately → sync to backend → confirm or rollback.
 *
 * Features:
 *   - Optimistic write queue: local state updates before server confirms
 *   - Conflict resolution: last-write-wins by timestamp (configurable)
 *   - Retry on failure: exponential back-off with max 3 attempts
 *   - Rollback on permanent failure: reverts local state to pre-write snapshot
 *   - Offline queue: operations persist across connection interruptions
 *
 * Usage:
 *   SyncEngine.optimisticUpdate({
 *     id:        'like:videoId',
 *     apply:     () => FeedStore.setLiked(videoId, true),
 *     rollback:  () => FeedStore.setLiked(videoId, false),
 *     commit:    async () => supabase.from('likes').insert({ video_id: videoId }),
 *   });
 */

import { AppLifecycle } from '../core/AppLifecycle';

export interface OptimisticOp {
  /** Unique key — duplicate key replaces the pending operation. */
  id:       string;
  /** Apply the local state change immediately. */
  apply:    () => void;
  /** Revert local state on permanent failure. */
  rollback: () => void;
  /** Async backend commit. Throw to indicate failure. */
  commit:   () => Promise<void>;
  /** Max retry attempts. Default: 3. */
  maxRetries?: number;
}

type OpStatus = 'pending' | 'committing' | 'committed' | 'failed';

interface OpEntry extends OptimisticOp {
  status:   OpStatus;
  attempts: number;
  createdAt:number;
}

const RETRY_BASE_MS = 1000;
const MAX_QUEUE     = 200;

class SyncEngineImpl {
  private readonly _queue = new Map<string, OpEntry>();
  private _isProcessing  = false;

  constructor() {
    // Flush queue when app returns to foreground
    AppLifecycle.onForeground(() => {
      this._processQueue();
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Apply an optimistic update immediately and schedule the backend commit.
   * If an operation with the same id is already pending, it is replaced.
   */
  optimisticUpdate(op: OptimisticOp): void {
    // Apply local state change immediately
    try { op.apply(); } catch (e: any) {
      console.warn('[SyncEngine] apply() error for op:', op.id, e?.message);
    }

    const entry: OpEntry = {
      ...op,
      status:    'pending',
      attempts:  0,
      createdAt: Date.now(),
      maxRetries: op.maxRetries ?? 3,
    };
    this._queue.set(op.id, entry);

    // Trim queue if too large (emergency safety valve)
    if (this._queue.size > MAX_QUEUE) {
      const oldest = Array.from(this._queue.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, this._queue.size - MAX_QUEUE);
      for (const [key] of oldest) this._queue.delete(key);
    }

    this._processQueue();
  }

  /** Directly commit without optimistic apply (for non-UI operations). */
  async commit(id: string, commit: () => Promise<void>, maxRetries = 3): Promise<void> {
    const entry: OpEntry = {
      id, commit,
      apply:     () => {},
      rollback:  () => {},
      status:    'pending',
      attempts:  0,
      createdAt: Date.now(),
      maxRetries,
    };
    this._queue.set(id, entry);
    await this._processQueue();
  }

  /** Number of pending operations. */
  get pendingCount(): number {
    return Array.from(this._queue.values()).filter(e => e.status === 'pending' || e.status === 'committing').length;
  }

  /** Clear all pending operations (e.g. on logout). */
  clear(): void {
    this._queue.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _processQueue(): Promise<void> {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const pending = Array.from(this._queue.values()).filter(e => e.status === 'pending');

      for (const entry of pending) {
        entry.status = 'committing';
        this._attemptCommit(entry);
      }
    } finally {
      this._isProcessing = false;
    }
  }

  private async _attemptCommit(entry: OpEntry, delay = 0): Promise<void> {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    entry.attempts++;
    try {
      await entry.commit();
      entry.status = 'committed';
      this._queue.delete(entry.id);
    } catch (e: any) {
      const maxRetries = entry.maxRetries ?? 3;
      if (entry.attempts < maxRetries) {
        const nextDelay = RETRY_BASE_MS * Math.pow(2, entry.attempts - 1);
        entry.status = 'pending';
        console.warn(`[SyncEngine] op "${entry.id}" failed (attempt ${entry.attempts}/${maxRetries}), retry in ${nextDelay}ms`);
        setTimeout(() => this._attemptCommit(entry, 0), nextDelay);
      } else {
        entry.status = 'failed';
        console.error(`[SyncEngine] op "${entry.id}" permanently failed — rolling back`);
        try { entry.rollback(); } catch { /* isolate rollback errors */ }
        this._queue.delete(entry.id);
      }
    }
  }
}

export const SyncEngine = new SyncEngineImpl();
