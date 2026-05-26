/**
 * modules/gaming/AntiCheat.ts — Client-side anti-cheat validation
 *
 * Detects and prevents common mobile game cheating patterns:
 *   - Action flooding (too many actions per second)
 *   - Score anomalies (impossible score deltas)
 *   - Time manipulation (system clock changes)
 *   - Replay attacks (duplicate action signatures)
 *   - Bot patterns (inhuman timing regularity)
 *
 * Design philosophy:
 *   - All final validation happens server-side via Edge Function
 *   - Client-side checks are first-line defense (UX + bandwidth reduction)
 *   - Violations are flagged, not silently dropped — server decides punishment
 *   - Action timestamps use monotonic performance.now() to defeat clock manipulation
 *
 * Usage:
 *   AntiCheat.startSession(gameId, userId);
 *   const ok = AntiCheat.validateAction(userId, 'tap', score);
 *   AntiCheat.endSession(gameId);
 */

import { EventBus } from '../core/EventBus';

export type CheatViolation =
  | 'action_flood'
  | 'impossible_score'
  | 'time_manipulation'
  | 'replay_attack'
  | 'bot_pattern'
  | 'session_expired';

export interface ActionRecord {
  userId:   string;
  action:   string;
  score:    number;
  perf:     number;    // performance.now() timestamp
  wall:     number;    // Date.now() timestamp
  hash:     string;    // simple action hash for replay detection
}

export interface ViolationRecord {
  gameId:    string;
  userId:    string;
  type:      CheatViolation;
  details:   string;
  timestamp: number;
  severity:  'warn' | 'kick' | 'ban';
}

const MAX_ACTIONS_PER_SEC = 20;
const MAX_SCORE_PER_ACTION = 1000;
const BOT_REGULARITY_THRESHOLD = 0.05;  // <5% std dev in timing = bot suspect
const REPLAY_WINDOW_MS = 60_000;

interface SessionState {
  gameId:      string;
  userId:      string;
  startPerf:   number;
  actions:     ActionRecord[];
  violations:  ViolationRecord[];
  actionHashes: Set<string>;
  recentActionPerfs: number[];
}

class AntiCheatImpl {
  private readonly _sessions = new Map<string, SessionState>();   // gameId → state

  // ── Session lifecycle ─────────────────────────────────────────────────────

  startSession(gameId: string, userId: string): void {
    this._sessions.set(gameId, {
      gameId,
      userId,
      startPerf:   performance.now(),
      actions:     [],
      violations:  [],
      actionHashes: new Set(),
      recentActionPerfs: [],
    });
  }

  endSession(gameId: string): ViolationRecord[] {
    const session = this._sessions.get(gameId);
    if (!session) return [];
    const violations = [...session.violations];
    this._sessions.delete(gameId);
    return violations;
  }

  // ── Action validation ─────────────────────────────────────────────────────

  /**
   * Validate an action before applying it.
   * Returns true if action is valid, false if it should be rejected.
   */
  validateAction(gameId: string, userId: string, action: string, scoreDelta: number): boolean {
    const session = this._sessions.get(gameId);
    if (!session) {
      this._flag(null, userId, gameId, 'session_expired', 'No active session', 'warn');
      return false;
    }

    const perf = performance.now();
    const wall = Date.now();
    const hash = this._hashAction(userId, action, perf);

    // ── Replay detection ──────────────────────────────────────────────────
    if (session.actionHashes.has(hash)) {
      this._flag(session, userId, gameId, 'replay_attack', `Duplicate action hash: ${hash}`, 'kick');
      return false;
    }

    // ── Action flood ──────────────────────────────────────────────────────
    const recentCount = session.recentActionPerfs
      .filter(t => perf - t < 1000).length;

    if (recentCount >= MAX_ACTIONS_PER_SEC) {
      this._flag(session, userId, gameId, 'action_flood',
        `${recentCount + 1} actions in last second`, 'warn');
      return false;
    }

    // ── Impossible score ──────────────────────────────────────────────────
    if (Math.abs(scoreDelta) > MAX_SCORE_PER_ACTION) {
      this._flag(session, userId, gameId, 'impossible_score',
        `Score delta ${scoreDelta} exceeds max ${MAX_SCORE_PER_ACTION}`, 'kick');
      return false;
    }

    // ── Bot pattern detection ─────────────────────────────────────────────
    if (session.recentActionPerfs.length >= 10) {
      const recent = session.recentActionPerfs.slice(-10);
      const intervals = recent.slice(1).map((t, i) => t - recent[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const stddev = Math.sqrt(
        intervals.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / intervals.length,
      );
      const cv = avg > 0 ? stddev / avg : 0;
      if (cv < BOT_REGULARITY_THRESHOLD) {
        this._flag(session, userId, gameId, 'bot_pattern',
          `Action timing CV=${cv.toFixed(3)} (bot suspect)`, 'warn');
      }
    }

    // Record valid action
    const record: ActionRecord = { userId, action, score: scoreDelta, perf, wall, hash };
    session.actions.push(record);
    session.actionHashes.add(hash);
    session.recentActionPerfs.push(perf);

    // Cleanup old hashes outside replay window
    if (session.actions.length % 50 === 0) {
      this._cleanupStaleHashes(session);
    }

    return true;
  }

  getViolations(gameId: string): ViolationRecord[] {
    return this._sessions.get(gameId)?.violations ?? [];
  }

  hasKickViolation(gameId: string): boolean {
    return (this._sessions.get(gameId)?.violations ?? [])
      .some(v => v.severity === 'kick' || v.severity === 'ban');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _flag(
    session: SessionState | null,
    userId:   string,
    gameId:   string,
    type:     CheatViolation,
    details:  string,
    severity: ViolationRecord['severity'],
  ): void {
    const rec: ViolationRecord = {
      gameId, userId, type, details, severity,
      timestamp: Date.now(),
    };
    console.warn(`[AntiCheat] ${severity.toUpperCase()} ${type} — user:${userId} — ${details}`);
    if (session) session.violations.push(rec);

    if (severity === 'kick') {
      EventBus.emit('battle:ended', { battleId: gameId, winnerId: '' });
    }
  }

  private _hashAction(userId: string, action: string, perf: number): string {
    // Simple non-cryptographic hash for replay detection
    const str = `${userId}:${action}:${perf.toFixed(0)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  private _cleanupStaleHashes(session: SessionState): void {
    const cutoff = performance.now() - REPLAY_WINDOW_MS;
    const recent = session.actions.filter(a => a.perf > cutoff);
    session.actionHashes = new Set(recent.map(a => a.hash));
  }
}

export const AntiCheat = new AntiCheatImpl();
