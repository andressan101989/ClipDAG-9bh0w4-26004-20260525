/**
 * modules/sessions/SessionOrchestrator.ts — Global session lifecycle coordinator
 *
 * Single authority for ALL active sessions across the entire app:
 *   - Creator studio sessions
 *   - Live stream sessions (host & viewer)
 *   - RTC call sessions
 *   - Game sessions
 *   - Upload sessions
 *   - Media playback sessions
 *
 * Responsibilities:
 *   - Conflict resolution (calls interrupt streams, etc.)
 *   - Recovery orchestration after interruption
 *   - Migration when resource contention detected
 *   - Global cleanup on app background/kill
 *   - Session inventory for debug panel
 *   - Priority-based interruption handling
 *
 * Priority order (highest wins resource):
 *   call > creator_capture > stream_host > game > stream_viewer > upload > media
 *
 * Usage:
 *   SessionOrchestrator.registerSession('call', callSessionId, handlers);
 *   SessionOrchestrator.onConflict('call', 'stream', (winner) => { ... });
 *   SessionOrchestrator.getActiveSessions();
 */

import { EventBus }   from '../core/EventBus';
import { AppLifecycle } from '../core/AppLifecycle';
import { LeakDetector } from '../core/LeakDetector';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionType =
  | 'call'
  | 'creator_capture'
  | 'stream_host'
  | 'game'
  | 'stream_viewer'
  | 'upload'
  | 'media';

export type SessionStatus = 'active' | 'paused' | 'recovering' | 'ended';

export interface SessionHandlers {
  onPause:   () => Promise<void>;
  onResume:  () => Promise<void>;
  onEnd:     () => Promise<void>;
  onRecover: () => Promise<boolean>;
}

export interface SessionRecord {
  id:         string;
  type:       SessionType;
  status:     SessionStatus;
  startedAt:  number;
  pausedAt?:  number;
  leakToken:  string;
  handlers:   SessionHandlers;
  metadata:   Record<string, any>;
}

// Priority map (higher = more important)
const PRIORITY: Record<SessionType, number> = {
  call:            10,
  creator_capture:  8,
  stream_host:      7,
  game:             6,
  stream_viewer:    4,
  upload:           2,
  media:            1,
};

// Which session types conflict (hold both at once)
const CONFLICTS: Partial<Record<SessionType, SessionType[]>> = {
  call:            ['creator_capture', 'stream_host'],
  creator_capture: ['call', 'stream_host'],
  stream_host:     ['call', 'creator_capture'],
};

// ── SessionOrchestrator ───────────────────────────────────────────────────────

class SessionOrchestratorImpl {
  private readonly _sessions    = new Map<string, SessionRecord>();
  private readonly _conflictHandlers = new Map<string, (winner: SessionType, loser: SessionType) => void>();
  private readonly _recoveryQueue: string[] = [];   // sessionIds pending recovery

  constructor() {
    // On background: pause non-critical sessions
    AppLifecycle.onBackground(() => this._onBackground());
    // On foreground: attempt recovery queue
    AppLifecycle.onForeground(() => this._onForeground());
  }

  // ── Registration ───────────────────────────────────────────────────────────

  registerSession(
    type:     SessionType,
    id:       string,
    handlers: SessionHandlers,
    metadata: Record<string, any> = {},
  ): SessionRecord {
    // Handle conflicts
    this._resolveConflicts(type, id);

    const leakToken = LeakDetector.track('socket', `session:${type}:${id}`, 'SessionOrchestrator');

    const record: SessionRecord = {
      id,
      type,
      status:    'active',
      startedAt: Date.now(),
      leakToken,
      handlers,
      metadata,
    };

    this._sessions.set(id, record);
    console.log(`[SessionOrchestrator] registered ${type} session: ${id}`);
    return record;
  }

  unregisterSession(id: string): void {
    const session = this._sessions.get(id);
    if (!session) return;
    LeakDetector.release(session.leakToken);
    this._sessions.delete(id);
    console.log(`[SessionOrchestrator] unregistered session: ${id}`);
  }

  // ── Session control ────────────────────────────────────────────────────────

  async pauseSession(id: string): Promise<void> {
    const session = this._sessions.get(id);
    if (!session || session.status !== 'active') return;
    session.status   = 'paused';
    session.pausedAt = Date.now();
    await session.handlers.onPause().catch(e =>
      console.warn(`[SessionOrchestrator] pause error ${id}:`, e?.message),
    );
  }

  async resumeSession(id: string): Promise<void> {
    const session = this._sessions.get(id);
    if (!session || session.status !== 'paused') return;
    session.status   = 'active';
    session.pausedAt = undefined;
    await session.handlers.onResume().catch(e =>
      console.warn(`[SessionOrchestrator] resume error ${id}:`, e?.message),
    );
  }

  async endSession(id: string): Promise<void> {
    const session = this._sessions.get(id);
    if (!session) return;
    session.status = 'ended';
    await session.handlers.onEnd().catch(e =>
      console.warn(`[SessionOrchestrator] end error ${id}:`, e?.message),
    );
    this.unregisterSession(id);
  }

  async recoverSession(id: string): Promise<boolean> {
    const session = this._sessions.get(id);
    if (!session) return false;
    session.status = 'recovering';
    try {
      const recovered = await session.handlers.onRecover();
      session.status = recovered ? 'active' : 'ended';
      if (!recovered) this.unregisterSession(id);
      return recovered;
    } catch {
      session.status = 'ended';
      this.unregisterSession(id);
      return false;
    }
  }

  // ── Conflict handling ──────────────────────────────────────────────────────

  onConflict(
    typeA:   SessionType,
    typeB:   SessionType,
    handler: (winner: SessionType, loser: SessionType) => void,
  ): () => void {
    const key = [typeA, typeB].sort().join(':');
    this._conflictHandlers.set(key, handler);
    return () => this._conflictHandlers.delete(key);
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  getActiveSessions(): SessionRecord[] {
    return Array.from(this._sessions.values())
      .filter(s => s.status === 'active' || s.status === 'recovering');
  }

  getSessionsByType(type: SessionType): SessionRecord[] {
    return Array.from(this._sessions.values()).filter(s => s.type === type);
  }

  hasActiveSession(type: SessionType): boolean {
    return this.getSessionsByType(type).some(s => s.status === 'active');
  }

  getInventory(): Array<{ id: string; type: SessionType; status: SessionStatus; uptimeSec: number }> {
    return Array.from(this._sessions.values()).map(s => ({
      id:         s.id,
      type:       s.type,
      status:     s.status,
      uptimeSec:  Math.floor((Date.now() - s.startedAt) / 1000),
    }));
  }

  // ── Background / Foreground ────────────────────────────────────────────────

  private async _onBackground(): Promise<void> {
    console.log('[SessionOrchestrator] app backgrounded — pausing low-priority sessions');
    const toPause = Array.from(this._sessions.values())
      .filter(s => s.status === 'active' && PRIORITY[s.type] <= PRIORITY.stream_viewer);

    for (const session of toPause) {
      await this.pauseSession(session.id);
      this._recoveryQueue.push(session.id);
    }
  }

  private async _onForeground(): Promise<void> {
    if (this._recoveryQueue.length === 0) return;
    console.log('[SessionOrchestrator] app foregrounded — recovering sessions');
    const ids = [...this._recoveryQueue];
    this._recoveryQueue.length = 0;
    for (const id of ids) {
      const session = this._sessions.get(id);
      if (session?.status === 'paused') {
        await this.resumeSession(id);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _resolveConflicts(newType: SessionType, newId: string): Promise<void> {
    const conflicting = CONFLICTS[newType] ?? [];

    for (const conflictType of conflicting) {
      const existing = this.getSessionsByType(conflictType)
        .filter(s => s.status === 'active');

      for (const session of existing) {
        const winner = PRIORITY[newType] >= PRIORITY[conflictType] ? newType : conflictType;
        const loser  = winner === newType ? conflictType : newType;
        console.log(`[SessionOrchestrator] conflict: ${winner} wins over ${loser}`);

        // Notify conflict handler
        const key = [newType, conflictType].sort().join(':');
        this._conflictHandlers.get(key)?.(winner, loser);

        // Pause the losing session
        if (loser === conflictType) {
          await this.pauseSession(session.id);
          this._recoveryQueue.push(session.id);
        }
      }
    }
  }
}

export const SessionOrchestrator = new SessionOrchestratorImpl();
