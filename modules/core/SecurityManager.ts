/**
 * modules/core/SecurityManager.ts — Security & abuse protection layer v2
 *
 * FIXES vs v1:
 *   - _escalateRestriction: escalation map is now actually applied (was using
 *     the `level` param directly, bypassing the staircase progression).
 *     Now always progresses: none → rate_limited → blocked, never jumps.
 *   - Added _violationCounts per user:action for automatic graduated blocking:
 *     3 rate_limit violations → blocked for that action.
 *   - Added timed auto-unblock: rate_limited users are automatically pardoned
 *     after 5 minutes; blocked users after 30 minutes (soft client-side block).
 *   - Critical threat level now always results in a hard block.
 */

import { EventBus }    from './EventBus';
import { RateLimiter } from './RateLimiter';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SecurityAction =
  | 'like' | 'comment' | 'follow' | 'message_send'
  | 'gift_send' | 'stream_join' | 'game_action'
  | 'payment' | 'upload' | 'search';

export type ThreatLevel = 'info' | 'warn' | 'critical';

export interface SecurityEvent {
  userId:      string;
  action:      SecurityAction | string;
  threatLevel: ThreatLevel;
  details:     string;
  timestamp:   number;
}

export type UserRestriction = 'none' | 'rate_limited' | 'blocked';

// ── Rate limit config per action ──────────────────────────────────────────────

const ACTION_LIMITS: Record<SecurityAction, { maxPerSec: number; maxPerMin: number }> = {
  like:         { maxPerSec: 5,   maxPerMin: 100 },
  comment:      { maxPerSec: 2,   maxPerMin: 30  },
  follow:       { maxPerSec: 3,   maxPerMin: 50  },
  message_send: { maxPerSec: 3,   maxPerMin: 60  },
  gift_send:    { maxPerSec: 2,   maxPerMin: 20  },
  stream_join:  { maxPerSec: 1,   maxPerMin: 10  },
  game_action:  { maxPerSec: 20,  maxPerMin: 600 },
  payment:      { maxPerSec: 1,   maxPerMin: 5   },
  upload:       { maxPerSec: 1,   maxPerMin: 10  },
  search:       { maxPerSec: 3,   maxPerMin: 60  },
};

// Auto-pardon durations
const RATE_LIMIT_TTL_MS = 5  * 60 * 1000;   // 5 minutes
const BLOCK_TTL_MS      = 30 * 60 * 1000;   // 30 minutes
const MAX_RATE_VIOLATIONS_BEFORE_BLOCK = 3;

// ── SecurityManager ───────────────────────────────────────────────────────────

class SecurityManagerImpl {
  private readonly _restrictions  = new Map<string, { level: UserRestriction; since: number }>();
  private readonly _violationLog: SecurityEvent[] = [];
  private readonly _actionHistory = new Map<string, number[]>();    // `userId:action` → timestamps
  private readonly _violationCounts = new Map<string, number>();    // `userId:action` → consecutive violations

  // ── Action validation ─────────────────────────────────────────────────────

  checkAction(action: SecurityAction, userId: string): boolean {
    // Auto-pardon stale restrictions
    this._maybePardon(userId);

    const restriction = this._restrictions.get(userId)?.level ?? 'none';

    if (restriction === 'blocked') {
      this._log(userId, action, 'warn', 'User is blocked — action denied');
      return false;
    }

    if (restriction === 'rate_limited') {
      // rate_limited users are still blocked on all actions until pardoned
      this._log(userId, action, 'info', 'User is rate_limited — action throttled');
      return false;
    }

    const limits = ACTION_LIMITS[action];
    if (!limits) return true;

    const key = `${userId}:${action}`;
    const now  = Date.now();
    const history = this._actionHistory.get(key) ?? [];

    const recentSec = history.filter(t => now - t < 1_000);
    const recentMin = history.filter(t => now - t < 60_000);

    const exceeded = recentSec.length >= limits.maxPerSec || recentMin.length >= limits.maxPerMin;

    if (exceeded) {
      const reason = recentSec.length >= limits.maxPerSec
        ? `Rate: ${recentSec.length}/sec > ${limits.maxPerSec}`
        : `Rate: ${recentMin.length}/min > ${limits.maxPerMin}`;
      this._log(userId, action, 'warn', reason);

      // Increment violation counter for this user:action
      const vKey = `${userId}:${action}`;
      const violations = (this._violationCounts.get(vKey) ?? 0) + 1;
      this._violationCounts.set(vKey, violations);

      if (violations >= MAX_RATE_VIOLATIONS_BEFORE_BLOCK) {
        this._applyRestriction(userId, 'blocked');
        this._log(userId, action, 'critical', `Auto-blocked after ${violations} violations`);
      } else {
        this._applyRestriction(userId, 'rate_limited');
      }

      return false;
    }

    // Action allowed — record timestamp, reset violation counter
    recentMin.push(now);
    this._actionHistory.set(key, recentMin.filter(t => now - t < 60_000));
    this._violationCounts.delete(`${userId}:${action}`);

    return true;
  }

  // ── Explicit reporting ────────────────────────────────────────────────────

  reportSuspicious(
    userId:      string,
    category:    string,
    details:     string,
    threatLevel: ThreatLevel = 'warn',
  ): void {
    this._log(userId, category, threatLevel, details);

    if (threatLevel === 'critical') {
      this._applyRestriction(userId, 'blocked');
    } else if (threatLevel === 'warn') {
      const current = this._restrictions.get(userId)?.level ?? 'none';
      if (current === 'none') {
        this._applyRestriction(userId, 'rate_limited');
      }
    }
  }

  // ── Manual restriction control ────────────────────────────────────────────

  blockUser(userId: string, reason: string): void {
    this._applyRestriction(userId, 'blocked');
    this._log(userId, 'system', 'critical', `Hard blocked: ${reason}`);
    console.warn(`[SecurityManager] BLOCKED: ${userId} — ${reason}`);
  }

  unblockUser(userId: string): void {
    this._restrictions.delete(userId);
    console.log('[SecurityManager] unblocked:', userId);
  }

  getRestriction(userId: string): UserRestriction {
    this._maybePardon(userId);
    return this._restrictions.get(userId)?.level ?? 'none';
  }

  isBlocked(userId: string): boolean {
    return this.getRestriction(userId) === 'blocked';
  }

  // ── Violation log ─────────────────────────────────────────────────────────

  getRecentViolations(last = 50): SecurityEvent[] {
    return this._violationLog.slice(-last);
  }

  getViolationsForUser(userId: string): SecurityEvent[] {
    return this._violationLog.filter(e => e.userId === userId);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _log(
    userId:      string,
    action:      string,
    threatLevel: ThreatLevel,
    details:     string,
  ): void {
    const event: SecurityEvent = { userId, action, threatLevel, details, timestamp: Date.now() };
    this._violationLog.push(event);
    if (this._violationLog.length > 500) this._violationLog.shift();
    if (threatLevel !== 'info') {
      console.warn(`[SecurityManager] ${threatLevel.toUpperCase()} ${userId} ${action}: ${details}`);
    }
  }

  /**
   * Apply a restriction following the strict staircase:
   *   none → rate_limited → blocked
   * Never downgrades an existing restriction.
   */
  private _applyRestriction(userId: string, newLevel: UserRestriction): void {
    const STAIRCASE: Record<UserRestriction, number> = { none: 0, rate_limited: 1, blocked: 2 };
    const current = this._restrictions.get(userId);
    const currentRank = current ? STAIRCASE[current.level] : 0;
    const newRank     = STAIRCASE[newLevel];

    // Only escalate — never downgrade
    if (newRank > currentRank) {
      this._restrictions.set(userId, { level: newLevel, since: Date.now() });
      console.warn(`[SecurityManager] ${userId} escalated to: ${newLevel}`);
    }
  }

  /**
   * Auto-pardon a user if their restriction TTL has expired.
   * rate_limited → pardoned after 5 min.
   * blocked      → pardoned after 30 min.
   */
  private _maybePardon(userId: string): void {
    const rec = this._restrictions.get(userId);
    if (!rec || rec.level === 'none') return;

    const age = Date.now() - rec.since;
    const ttl = rec.level === 'blocked' ? BLOCK_TTL_MS : RATE_LIMIT_TTL_MS;

    if (age >= ttl) {
      this._restrictions.delete(userId);
      console.log(`[SecurityManager] auto-pardoned: ${userId} (was ${rec.level} for ${(age / 1000).toFixed(0)}s)`);
    }
  }
}

export const SecurityManager = new SecurityManagerImpl();
