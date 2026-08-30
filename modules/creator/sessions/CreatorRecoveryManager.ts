/**
 * modules/creator/sessions/CreatorRecoveryManager.ts — Creator Studio crash recovery
 *
 * Ensures the Creator Studio can always recover from:
 *   - App crash during capture
 *   - App crash during editing
 *   - App crash during export
 *   - App crash during upload
 *   - Incoming call interruption
 *   - Low-memory interruption
 *   - Background kill by OS
 *
 * Strategy:
 *   - Continuous autosave to AsyncStorage every N seconds during editing
 *   - Export state persisted as a recovery checkpoint
 *   - On open, checks for unfinished sessions and offers recovery
 *   - Timeline state serialized and restored
 *   - Draft auto-preserved on every significant change
 *
 * Usage:
 *   CreatorRecoveryManager.startAutosave(sessionId);
 *   CreatorRecoveryManager.checkpoint('export', exportState);
 *   const pending = await CreatorRecoveryManager.getPendingRecovery();
 *   CreatorRecoveryManager.clearRecovery(sessionId);
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecoveryPhase =
  | 'capture' | 'editing' | 'paused' | 'export_ready' | 'exporting' | 'uploading';

export interface RecoveryCheckpoint {
  sessionId:     string;
  phase:         RecoveryPhase;
  capturedUri?:  string;
  durationMs?:   number;
  timelineJson?: string;     // serialized TimelineController state
  exportJobId?:  string;     // if export was interrupted
  uploadJobId?:  string;     // if upload was interrupted
  metadata?:     Record<string, unknown>;
  savedAt:       number;
}

const STORAGE_PREFIX = 'creator_recovery:';
const AUTOSAVE_INTERVAL_MS = 10_000;   // autosave every 10 seconds
const TRANSIENT_CHECKPOINT_KEYS = new Set(['savedAt', 'timestamp']);

export interface CreatorRecoveryStorage {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  getAllKeys(): Promise<readonly string[]>;
  removeItem(key: string): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

interface CreatorRecoveryLogger {
  log(...values: unknown[]): void;
  warn(...values: unknown[]): void;
}

type WriteWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

type QueuedCheckpointWrite = {
  signature: string;
  checkpoint: RecoveryCheckpoint;
  waiters: WriteWaiter[];
};

type SessionWriteState = {
  persistedSignature: string | null;
  active: QueuedCheckpointWrite | null;
  pending: QueuedCheckpointWrite | null;
};

function normalizePersistable(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('creator_recovery_non_serializable_checkpoint');
  }
  if (value instanceof Date) return value.toJSON();
  if (typeof value !== 'object') return undefined;
  if (ancestors.has(value)) {
    throw new TypeError('creator_recovery_circular_checkpoint');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => normalizePersistable(item, ancestors) ?? null);
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (TRANSIENT_CHECKPOINT_KEYS.has(key)) continue;
      const next = normalizePersistable((value as Record<string, unknown>)[key], ancestors);
      if (typeof next !== 'undefined') normalized[key] = next;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function persistableRecord(value: Record<string, unknown>): Record<string, unknown> {
  return normalizePersistable(value) as Record<string, unknown>;
}

export function createCreatorRecoverySignature(
  sessionId: string,
  phase: RecoveryPhase,
  data: Record<string, unknown>,
): string {
  return JSON.stringify({ sessionId, phase, data: persistableRecord(data) });
}

// ── CreatorRecoveryManager ────────────────────────────────────────────────────

export class CreatorRecoveryManagerImpl {
  private _autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private _currentSessionId: string | null = null;
  private _getTimelineFn: (() => string) | null = null;
  private _getCaptureFn:  (() => { uri?: string; durationMs?: number }) | null = null;
  private _getCheckpointFn: (() => {
    phase: RecoveryPhase;
    data: Record<string, unknown>;
  }) | null = null;
  private readonly _writeStates = new Map<string, SessionWriteState>();

  constructor(
    private readonly _storage: CreatorRecoveryStorage = AsyncStorage,
    private readonly _logger: CreatorRecoveryLogger = console,
    private readonly _now: () => number = Date.now,
  ) {}

  // ── Autosave ───────────────────────────────────────────────────────────────

  startAutosave(
    sessionId:   string,
    opts: {
      getTimeline?: () => string;
      getCapture?:  () => { uri?: string; durationMs?: number };
      getCheckpoint?: () => {
        phase: RecoveryPhase;
        data: Record<string, unknown>;
      };
    } = {},
  ): void {
    this._currentSessionId = sessionId;
    this._getTimelineFn    = opts.getTimeline ?? null;
    this._getCaptureFn     = opts.getCapture  ?? null;
    this._getCheckpointFn  = opts.getCheckpoint ?? null;

    if (this._autosaveTimer) clearInterval(this._autosaveTimer);

    this._autosaveTimer = setInterval(() => {
      this._autosave(sessionId).catch(() =>
        this._logger.warn('[CreatorRecovery] autosave error'),
      );
    }, AUTOSAVE_INTERVAL_MS);

    this._logger.log('[CreatorRecovery] autosave started for session:', sessionId);
  }

  stopAutosave(): void {
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    this._currentSessionId = null;
    this._getTimelineFn    = null;
    this._getCaptureFn     = null;
    this._getCheckpointFn  = null;
  }

  // ── Manual checkpoints ─────────────────────────────────────────────────────

  async checkpoint(sessionId: string, phase: RecoveryPhase, data: Partial<RecoveryCheckpoint>): Promise<void> {
    const persistibleData = persistableRecord(data as Record<string, unknown>);
    const checkpoint: RecoveryCheckpoint = {
      ...persistibleData,
      sessionId,
      phase,
      savedAt: this._now(),
    } as RecoveryCheckpoint;
    const signature = createCreatorRecoverySignature(sessionId, phase, persistibleData);
    await this._enqueueCheckpoint(sessionId, signature, checkpoint);
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  async getPendingRecovery(): Promise<RecoveryCheckpoint | null> {
    try {
      const keys = await this._storage.getAllKeys();
      const recoveryKeys = keys.filter(k => k.startsWith(STORAGE_PREFIX));

      if (recoveryKeys.length === 0) return null;

      // Get the most recent checkpoint
      const checkpoints: RecoveryCheckpoint[] = [];
      for (const key of recoveryKeys) {
        const raw = await this._storage.getItem(key);
        if (raw) {
          try { checkpoints.push(JSON.parse(raw)); } catch { /* ignore */ }
        }
      }

      if (checkpoints.length === 0) return null;

      // Return most recent
      checkpoints.sort((a, b) => b.savedAt - a.savedAt);
      const latest = checkpoints[0];

      // Only return if not too old (24 hours)
      if (this._now() - latest.savedAt > 24 * 60 * 60 * 1000) {
        await this.clearRecovery(latest.sessionId);
        return null;
      }

      this._logger.log('[CreatorRecovery] found pending recovery:', latest.sessionId, latest.phase);
      return latest;
    } catch {
      this._logger.warn('[CreatorRecovery] getPendingRecovery error');
      return null;
    }
  }

  async clearRecovery(sessionId: string): Promise<void> {
    try {
      await this._storage.removeItem(STORAGE_PREFIX + sessionId);
      this._writeStates.delete(sessionId);
      this._logger.log('[CreatorRecovery] cleared recovery for:', sessionId);
    } catch { /* ignore */ }
  }

  async clearAllRecoveries(): Promise<void> {
    try {
      const keys = await this._storage.getAllKeys();
      const recoveryKeys = keys.filter(k => k.startsWith(STORAGE_PREFIX));
      if (recoveryKeys.length > 0) {
        await this._storage.multiRemove(recoveryKeys);
        this._writeStates.clear();
        this._logger.log('[CreatorRecovery] cleared all recoveries');
      }
    } catch { /* ignore */ }
  }

  // ── Alias API used by creator-studio.tsx ──────────────────────────────────

  /** Save a checkpoint with arbitrary metadata. */
  async saveCheckpoint(
    sessionId: string,
    phase: RecoveryPhase,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const persistibleMetadata = persistableRecord(metadata);
    await this.checkpoint(sessionId, phase, {
      ...persistibleMetadata,
      metadata: persistibleMetadata,
    });
  }

  /** Retrieve the latest draft for a session (alias for getPendingRecovery filtered by sessionId). */
  async getLatestDraft(sessionId: string): Promise<RecoveryCheckpoint | null> {
    try {
      const raw = await this._storage.getItem(STORAGE_PREFIX + sessionId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RecoveryCheckpoint;
      if (this._now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
        await this.clearDraft(sessionId);
        return null;
      }
      if (!parsed.metadata) {
        const {
          sessionId: _sessionId,
          phase: _phase,
          savedAt: _savedAt,
          capturedUri: _capturedUri,
          durationMs: _durationMs,
          timelineJson: _timelineJson,
          exportJobId: _exportJobId,
          uploadJobId: _uploadJobId,
          ...legacyMetadata
        } = parsed;
        parsed.metadata = persistableRecord(legacyMetadata);
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Remove draft for a session. */
  async clearDraft(sessionId: string): Promise<void> {
    await this.clearRecovery(sessionId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _autosave(sessionId: string): Promise<void> {
    const supplied = this._getCheckpointFn?.();
    if (supplied) {
      await this.saveCheckpoint(sessionId, supplied.phase, supplied.data);
      return;
    }
    const capture  = this._getCaptureFn?.();
    const timeline = this._getTimelineFn?.();

    await this.checkpoint(sessionId, capture?.uri ? 'editing' : 'capture', {
      capturedUri:  capture?.uri,
      durationMs:   capture?.durationMs,
      timelineJson: timeline,
    });
  }

  private _writeState(sessionId: string): SessionWriteState {
    const existing = this._writeStates.get(sessionId);
    if (existing) return existing;
    const created: SessionWriteState = {
      persistedSignature: null,
      active: null,
      pending: null,
    };
    this._writeStates.set(sessionId, created);
    return created;
  }

  private _enqueueCheckpoint(
    sessionId: string,
    signature: string,
    checkpoint: RecoveryCheckpoint,
  ): Promise<void> {
    const state = this._writeState(sessionId);
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      if (!state.active && !state.pending && state.persistedSignature === signature) {
        resolve();
        return;
      }
      if (state.pending) {
        if (state.pending.signature === signature) {
          state.pending.waiters.push(waiter);
        } else {
          state.pending = {
            signature,
            checkpoint,
            waiters: [...state.pending.waiters, waiter],
          };
        }
      } else if (state.active?.signature === signature) {
        state.active.waiters.push(waiter);
      } else {
        state.pending = { signature, checkpoint, waiters: [waiter] };
      }
      this._drainCheckpointQueue(sessionId, state);
    });
  }

  private _drainCheckpointQueue(sessionId: string, state: SessionWriteState): void {
    if (state.active || !state.pending) return;
    if (state.pending.signature === state.persistedSignature) {
      const duplicate = state.pending;
      state.pending = null;
      duplicate.waiters.forEach(waiter => waiter.resolve());
      return;
    }

    const request = state.pending;
    state.pending = null;
    state.active = request;
    void this._storage
      .setItem(STORAGE_PREFIX + sessionId, JSON.stringify(request.checkpoint))
      .then(() => {
        state.persistedSignature = request.signature;
        this._logger.log(
          `[CreatorRecovery] checkpoint saved: ${request.checkpoint.phase} for ${sessionId}`,
        );
        request.waiters.forEach(waiter => waiter.resolve());
      })
      .catch(error => {
        this._logger.warn('[CreatorRecovery] checkpoint error');
        request.waiters.forEach(waiter => waiter.reject(error));
      })
      .finally(() => {
        state.active = null;
        this._drainCheckpointQueue(sessionId, state);
      });
  }
}

export const CreatorRecoveryManager = new CreatorRecoveryManagerImpl();
