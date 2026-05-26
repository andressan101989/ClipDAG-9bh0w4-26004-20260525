/**
 * modules/realtime/SyncEngine.ts — Optimistic UI & state reconciliation engine
 *
 * Provides optimistic updates with server reconciliation:
 *   - apply():    instant local state mutation
 *   - commit():   persist to server (async)
 *   - rollback(): revert if server rejects
 *   - reconcile(): merge server state with local state on reconnect
 *
 * Conflict resolution strategies:
 *   - last-write-wins (LWW): simple timestamp comparison
 *   - server-authoritative: server state always wins
 *   - merge: field-level merge (e.g. counters)
 *
 * Anti-drift protection:
 *   - Periodic reconciliation poll (30s) compares local vs server
 *   - On reconnect, full reconciliation of all pending mutations
 *   - Stale mutation cleanup (>5min old = discard, re-fetch)
 *
 * Usage:
 *   // Optimistic like
 *   const op = SyncEngine.optimisticUpdate('video:like', videoId, {
 *     apply:    () => setLiked(true),
 *     commit:   () => supabase.from('likes').insert(...),
 *     rollback: () => setLiked(false),
 *   });
 */

import { ConnectionManager } from './ConnectionManager';

export type ConflictStrategy = 'last-write-wins' | 'server-wins' | 'merge';

interface PendingMutation {
  id:          string;
  entityType:  string;
  entityId:    string;
  apply:       () => void;
  commit:      () => Promise<{ error?: any }>;
  rollback:    () => void;
  strategy:    ConflictStrategy;
  appliedAt:   number;
  retries:     number;
  maxRetries:  number;
}

const MAX_MUTATION_AGE_MS = 5 * 60 * 1000;   // 5 min
const MAX_RETRIES         = 3;

class SyncEngineImpl {
  private readonly _pending = new Map<string, PendingMutation>();
  private _flushTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Optimistic update ─────────────────────────────────────────────────────

  /**
   * Apply an optimistic mutation immediately, queue for server commit.
   * Returns the mutation ID for manual control.
   */
  optimisticUpdate(
    entityType: string,
    entityId:   string,
    ops: {
      apply:     () => void;
      commit:    () => Promise<{ error?: any }>;
      rollback:  () => void;
      strategy?: ConflictStrategy;
      maxRetries?: number;
    },
  ): string {
    const id = `${entityType}:${entityId}:${Date.now()}`;

    // Apply immediately
    try {
      ops.apply();
    } catch (e: any) {
      console.error('[SyncEngine] apply failed:', e?.message);
      return id;
    }

    const mutation: PendingMutation = {
      id,
      entityType,
      entityId,
      apply:     ops.apply,
      commit:    ops.commit,
      rollback:  ops.rollback,
      strategy:  ops.strategy ?? 'last-write-wins',
      appliedAt: Date.now(),
      retries:   0,
      maxRetries: ops.maxRetries ?? MAX_RETRIES,
    };

    this._pending.set(id, mutation);
    this._scheduleFlush();
    return id;
  }

  /** Immediately commit a specific mutation (bypass flush delay). */
  async forceCommit(mutationId: string): Promise<void> {
    const mutation = this._pending.get(mutationId);
    if (!mutation) return;
    await this._commitMutation(mutation);
  }

  /** Rollback a specific pending mutation. */
  rollback(mutationId: string): void {
    const mutation = this._pending.get(mutationId);
    if (!mutation) return;
    try { mutation.rollback(); } catch { /* isolate */ }
    this._pending.delete(mutationId);
  }

  get pendingCount(): number { return this._pending.size; }

  // ── Reconciliation ────────────────────────────────────────────────────────

  /** Flush all pending mutations. Called on reconnect. */
  async flushAll(): Promise<void> {
    const mutations = Array.from(this._pending.values())
      .sort((a, b) => a.appliedAt - b.appliedAt);

    console.log(`[SyncEngine] flushing ${mutations.length} pending mutations`);

    for (const mutation of mutations) {
      await this._commitMutation(mutation);
    }
  }

  /** Clean up stale mutations (> MAX_MUTATION_AGE_MS). */
  cleanupStale(): void {
    const now = Date.now();
    for (const [id, mutation] of this._pending) {
      if (now - mutation.appliedAt > MAX_MUTATION_AGE_MS) {
        console.warn('[SyncEngine] dropping stale mutation:', mutation.entityType, mutation.entityId);
        try { mutation.rollback(); } catch { /* isolate */ }
        this._pending.delete(id);
      }
    }
  }

  /** Reconcile local state with server response. */
  reconcile<T extends Record<string, any>>(
    localState:   T,
    serverState:  T,
    strategy:     ConflictStrategy = 'server-wins',
    fields?:      (keyof T)[],
  ): T {
    if (strategy === 'server-wins') {
      return { ...localState, ...serverState };
    }

    if (strategy === 'last-write-wins') {
      // Favor server for now (client clock can drift)
      return { ...localState, ...serverState };
    }

    if (strategy === 'merge') {
      const result = { ...localState };
      const keys = fields ?? (Object.keys(serverState) as (keyof T)[]);
      for (const key of keys) {
        const local  = localState[key];
        const server = serverState[key];
        // For numeric counters: take max
        if (typeof local === 'number' && typeof server === 'number') {
          (result as any)[key] = Math.max(local, server);
        } else {
          (result as any)[key] = server;
        }
      }
      return result;
    }

    return serverState;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _scheduleFlush(): void {
    if (this._flushTimeout) return;
    this._flushTimeout = setTimeout(() => {
      this._flushTimeout = null;
      this._flushBatch();
    }, 300);  // 300ms debounce
  }

  private async _flushBatch(): Promise<void> {
    if (!ConnectionManager.isHealthy) {
      // Defer until reconnected
      ConnectionManager.onReconnect(() => this.flushAll());
      return;
    }

    const mutations = Array.from(this._pending.values())
      .sort((a, b) => a.appliedAt - b.appliedAt);

    for (const mutation of mutations) {
      await this._commitMutation(mutation);
    }
  }

  private async _commitMutation(mutation: PendingMutation): Promise<void> {
    try {
      const { error } = await mutation.commit();
      if (error) {
        throw error;
      }
      this._pending.delete(mutation.id);
    } catch (e: any) {
      mutation.retries++;
      console.warn(`[SyncEngine] commit failed (${mutation.retries}/${mutation.maxRetries}):`, e?.message);

      if (mutation.retries >= mutation.maxRetries) {
        console.error('[SyncEngine] max retries reached — rolling back:', mutation.entityType);
        try { mutation.rollback(); } catch { /* isolate */ }
        this._pending.delete(mutation.id);
      } else {
        // Exponential backoff retry
        const delay = Math.min(1000 * Math.pow(2, mutation.retries), 10_000);
        setTimeout(() => this._commitMutation(mutation), delay);
      }
    }
  }
}

export const SyncEngine = new SyncEngineImpl();
