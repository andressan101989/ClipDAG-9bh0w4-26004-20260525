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
  | 'capture' | 'editing' | 'export_ready' | 'exporting' | 'uploading';

export interface RecoveryCheckpoint {
  sessionId:     string;
  phase:         RecoveryPhase;
  capturedUri?:  string;
  durationMs?:   number;
  timelineJson?: string;     // serialized TimelineController state
  exportJobId?:  string;     // if export was interrupted
  uploadJobId?:  string;     // if upload was interrupted
  savedAt:       number;
}

const STORAGE_PREFIX = 'creator_recovery:';
const AUTOSAVE_INTERVAL_MS = 10_000;   // autosave every 10 seconds

// ── CreatorRecoveryManager ────────────────────────────────────────────────────

class CreatorRecoveryManagerImpl {
  private _autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private _currentSessionId: string | null = null;
  private _getTimelineFn: (() => string) | null = null;
  private _getCaptureFn:  (() => { uri?: string; durationMs?: number }) | null = null;

  // ── Autosave ───────────────────────────────────────────────────────────────

  startAutosave(
    sessionId:   string,
    opts: {
      getTimeline?: () => string;
      getCapture?:  () => { uri?: string; durationMs?: number };
    } = {},
  ): void {
    this._currentSessionId = sessionId;
    this._getTimelineFn    = opts.getTimeline ?? null;
    this._getCaptureFn     = opts.getCapture  ?? null;

    if (this._autosaveTimer) clearInterval(this._autosaveTimer);

    this._autosaveTimer = setInterval(() => {
      this._autosave(sessionId).catch(e =>
        console.warn('[CreatorRecovery] autosave error:', e?.message),
      );
    }, AUTOSAVE_INTERVAL_MS);

    console.log('[CreatorRecovery] autosave started for session:', sessionId);
  }

  stopAutosave(): void {
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    this._currentSessionId = null;
    this._getTimelineFn    = null;
    this._getCaptureFn     = null;
  }

  // ── Manual checkpoints ─────────────────────────────────────────────────────

  async checkpoint(sessionId: string, phase: RecoveryPhase, data: Partial<RecoveryCheckpoint>): Promise<void> {
    const checkpoint: RecoveryCheckpoint = {
      sessionId,
      phase,
      savedAt: Date.now(),
      ...data,
    };
    try {
      await AsyncStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(checkpoint));
      console.log(`[CreatorRecovery] checkpoint saved: ${phase} for ${sessionId}`);
    } catch (e: any) {
      console.warn('[CreatorRecovery] checkpoint error:', e?.message);
    }
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  async getPendingRecovery(): Promise<RecoveryCheckpoint | null> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const recoveryKeys = keys.filter(k => k.startsWith(STORAGE_PREFIX));

      if (recoveryKeys.length === 0) return null;

      // Get the most recent checkpoint
      const checkpoints: RecoveryCheckpoint[] = [];
      for (const key of recoveryKeys) {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          try { checkpoints.push(JSON.parse(raw)); } catch { /* ignore */ }
        }
      }

      if (checkpoints.length === 0) return null;

      // Return most recent
      checkpoints.sort((a, b) => b.savedAt - a.savedAt);
      const latest = checkpoints[0];

      // Only return if not too old (24 hours)
      if (Date.now() - latest.savedAt > 24 * 60 * 60 * 1000) {
        await this.clearRecovery(latest.sessionId);
        return null;
      }

      console.log('[CreatorRecovery] found pending recovery:', latest.sessionId, latest.phase);
      return latest;
    } catch (e: any) {
      console.warn('[CreatorRecovery] getPendingRecovery error:', e?.message);
      return null;
    }
  }

  async clearRecovery(sessionId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_PREFIX + sessionId);
      console.log('[CreatorRecovery] cleared recovery for:', sessionId);
    } catch { /* ignore */ }
  }

  async clearAllRecoveries(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const recoveryKeys = keys.filter(k => k.startsWith(STORAGE_PREFIX));
      if (recoveryKeys.length > 0) {
        await AsyncStorage.multiRemove(recoveryKeys);
        console.log('[CreatorRecovery] cleared all recoveries');
      }
    } catch { /* ignore */ }
  }

  // ── Alias API used by creator-studio.tsx ──────────────────────────────────

  /** Save a checkpoint with arbitrary metadata. */
  async saveCheckpoint(
    sessionId: string,
    phase: RecoveryPhase,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    await this.checkpoint(sessionId, phase, { sessionId, phase, savedAt: Date.now(), ...metadata } as any);
  }

  /** Retrieve the latest draft for a session (alias for getPendingRecovery filtered by sessionId). */
  async getLatestDraft(sessionId: string): Promise<(RecoveryCheckpoint & { metadata?: Record<string, any> }) | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + sessionId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RecoveryCheckpoint & { metadata?: Record<string, any> };
      if (Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
        await this.clearDraft(sessionId);
        return null;
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
    const capture  = this._getCaptureFn?.();
    const timeline = this._getTimelineFn?.();

    const checkpoint: RecoveryCheckpoint = {
      sessionId,
      phase:        capture?.uri ? 'editing' : 'capture',
      capturedUri:  capture?.uri,
      durationMs:   capture?.durationMs,
      timelineJson: timeline,
      savedAt:      Date.now(),
    };

    await AsyncStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(checkpoint));
  }
}

export const CreatorRecoveryManager = new CreatorRecoveryManagerImpl();
