/**
 * modules/realtime/SessionRecovery.ts — Realtime session recovery orchestration
 *
 * When a call/stream/game session is interrupted (network loss, app background,
 * crash), this module coordinates the recovery sequence:
 *
 *   Phase 1 — Detect: ConnectionManager marks disconnected
 *   Phase 2 — Preserve: snapshot current session state before teardown
 *   Phase 3 — Reconnect: ConnectionManager reconnects with backoff
 *   Phase 4 — Restore: re-subscribe to channels, reconcile missed events
 *   Phase 5 — Notify: signal session owners via EventBus
 *
 * Recovery types:
 *   CALL: re-establish WebRTC signaling channel, reconnect peers
 *   STREAM: reconnect to live session, catch up on missed chat/gifts
 *   GAME: reconnect to game session, sync missed score events
 *   PRESENCE: refresh own heartbeat, re-fetch friends' presence
 *   MESSAGES: poll for missed messages since last received ID
 *
 * Max recovery window: 90 seconds (after which session is marked ended).
 *
 * Usage:
 *   SessionRecovery.registerSession('call', callId, { userId, peerId });
 *   SessionRecovery.unregisterSession(callId);
 *   SessionRecovery.onRecovered(callId, snapshot => restoreCallUI(snapshot));
 */

import { ConnectionManager }  from './ConnectionManager';
import { EventBus }           from '../core/EventBus';
import { AppLifecycle }       from '../core/AppLifecycle';

export type RecoverableSessionType = 'call' | 'stream' | 'game' | 'presence' | 'messages';

export interface SessionSnapshot {
  sessionId:    string;
  type:         RecoverableSessionType;
  state:        Record<string, any>;
  lastEventAt:  number;
  disconnectedAt: number;
}

interface RecoveryRecord {
  sessionId:   string;
  type:        RecoverableSessionType;
  initialState: Record<string, any>;
  snapshot:    SessionSnapshot | null;
  maxRecoveryMs: number;
  recoveredHandlers: Set<(snapshot: SessionSnapshot) => void>;
  failedHandlers:    Set<(reason: string) => void>;
}

const DEFAULT_MAX_RECOVERY_MS = 90_000;  // 90 seconds

class SessionRecoveryImpl {
  private readonly _sessions = new Map<string, RecoveryRecord>();
  private _isRecovering      = false;

  constructor() {
    ConnectionManager.onReconnect(() => this._handleReconnect());
    ConnectionManager.onDisconnect(() => this._handleDisconnect());
    AppLifecycle.onForeground(() => {
      if (!ConnectionManager.isHealthy) return;
      this._handleReconnect();
    });
  }

  // ── Session registration ──────────────────────────────────────────────────

  registerSession(
    type:         RecoverableSessionType,
    sessionId:    string,
    initialState: Record<string, any> = {},
    maxRecoveryMs = DEFAULT_MAX_RECOVERY_MS,
  ): void {
    this._sessions.set(sessionId, {
      sessionId,
      type,
      initialState,
      snapshot:     null,
      maxRecoveryMs,
      recoveredHandlers: new Set(),
      failedHandlers:    new Set(),
    });
    console.log(`[SessionRecovery] registered ${type} session "${sessionId}"`);
  }

  unregisterSession(sessionId: string): void {
    this._sessions.delete(sessionId);
  }

  /** Update the in-progress snapshot (call periodically with latest state). */
  updateSnapshot(sessionId: string, state: Record<string, any>): void {
    const rec = this._sessions.get(sessionId);
    if (!rec) return;
    rec.snapshot = {
      sessionId,
      type:           rec.type,
      state,
      lastEventAt:    Date.now(),
      disconnectedAt: 0,
    };
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  onRecovered(sessionId: string, fn: (snapshot: SessionSnapshot) => void): () => void {
    const rec = this._sessions.get(sessionId);
    if (!rec) return () => {};
    rec.recoveredHandlers.add(fn);
    return () => rec.recoveredHandlers.delete(fn);
  }

  onFailed(sessionId: string, fn: (reason: string) => void): () => void {
    const rec = this._sessions.get(sessionId);
    if (!rec) return () => {};
    rec.failedHandlers.add(fn);
    return () => rec.failedHandlers.delete(fn);
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get activeSessions(): string[] { return Array.from(this._sessions.keys()); }
  get isRecovering():   boolean  { return this._isRecovering; }

  // ── Private ───────────────────────────────────────────────────────────────

  private _handleDisconnect(): void {
    const now = Date.now();
    for (const rec of this._sessions.values()) {
      if (rec.snapshot) {
        rec.snapshot.disconnectedAt = now;
      } else {
        rec.snapshot = {
          sessionId:     rec.sessionId,
          type:          rec.type,
          state:         rec.initialState,
          lastEventAt:   now,
          disconnectedAt: now,
        };
      }
    }

    if (this._sessions.size > 0) {
      console.log(`[SessionRecovery] disconnect — ${this._sessions.size} sessions pending recovery`);
    }
  }

  private async _handleReconnect(): Promise<void> {
    if (this._isRecovering || this._sessions.size === 0) return;
    this._isRecovering = true;

    const now = Date.now();
    const toRecover = Array.from(this._sessions.values());

    await Promise.all(toRecover.map(async rec => {
      const snapshot = rec.snapshot;
      if (!snapshot) return;

      const elapsed = now - snapshot.disconnectedAt;

      if (elapsed > rec.maxRecoveryMs) {
        console.warn(`[SessionRecovery] session "${rec.sessionId}" recovery window expired (${elapsed}ms > ${rec.maxRecoveryMs}ms)`);
        for (const fn of rec.failedHandlers) {
          try { fn('recovery_window_expired'); } catch { /* isolate */ }
        }
        this._sessions.delete(rec.sessionId);
        return;
      }

      console.log(`[SessionRecovery] recovering ${rec.type} session "${rec.sessionId}" (offline ${elapsed}ms)`);

      try {
        await this._recoverSession(rec, snapshot);
        for (const fn of rec.recoveredHandlers) {
          try { fn(snapshot); } catch { /* isolate */ }
        }
        console.log(`[SessionRecovery] "${rec.sessionId}" recovered`);
      } catch (e: any) {
        console.error(`[SessionRecovery] "${rec.sessionId}" recovery failed:`, e?.message);
        for (const fn of rec.failedHandlers) {
          try { fn(e?.message ?? 'recovery_failed'); } catch { /* isolate */ }
        }
      }
    }));

    this._isRecovering = false;
  }

  private async _recoverSession(rec: RecoveryRecord, snapshot: SessionSnapshot): Promise<void> {
    switch (rec.type) {
      case 'presence':
        EventBus.emit('notification:received', { type: 'presence_recovery', id: rec.sessionId });
        break;
      case 'messages':
        EventBus.emit('notification:received', { type: 'messages', id: rec.sessionId });
        break;
      case 'call':
        EventBus.emit('notification:received', { type: 'call_recovery', id: rec.sessionId });
        break;
      case 'stream':
        EventBus.emit('notification:received', { type: 'stream_recovery', id: rec.sessionId });
        break;
      case 'game':
        EventBus.emit('notification:received', { type: 'game_recovery', id: rec.sessionId });
        break;
    }

    // Allow 1 second for downstream handlers to process
    await new Promise(r => setTimeout(r, 1_000));
  }
}

export const SessionRecovery = new SessionRecoveryImpl();
