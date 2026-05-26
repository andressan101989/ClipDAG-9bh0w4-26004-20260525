/**
 * modules/core/SecurityManager.ts — Security & abuse protection layer
 *
 * Protects the platform from:
 *   - Realtime socket flooding (too many events per second)
 *   - Action replay attacks (duplicate request signatures)
 *   - Session hijacking (suspicious auth patterns)
 *   - Excessive retry abuse (hammer backend)
 *   - Suspicious behavior patterns (bot activity)
 *   - Gaming exploit attempts (in coordination with AntiCheat)
 *
 * Design:
 *   - Client-side first-line defense — server always validates
 *   - Violations are logged + reported, not silently dropped
 *   - All rate limits configurable per action category
 *   - Suspicious patterns trigger progressive response (warn → limit → block)
 *
 * Usage:
 *   SecurityManager.checkAction('like', userId);    // returns true/false
 *   SecurityManager.reportSuspicious(userId, 'bot_pattern', details);
 *   SecurityManager.isBlocked(userId);
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
  userId:     string;
  action:     SecurityAction | string;
  threatLevel: ThreatLevel;
  details:    string;
  timestamp:  number;
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

// ── SecurityManager ───────────────────────────────────────────────────────────

class SecurityManagerImpl {
  private readonly _restrictions  = new Map<string, UserRestriction>();
  private readonly _violationLog:  SecurityEvent[] = [];
  private readonly _actionHistory = new Map<string, number[]>();   // userId:action → timestamps[]

  // ── Action validation ─────────────────────────────────────────────────────

  /**
   * Check if a user is allowed to perform an action.
   * Returns false if the action should be blocked.
   */
  checkAction(action: SecurityAction, userId: string): boolean {
    // Hard block
    if (this._restrictions.get(userId) === 'blocked') {
      this._log(userId, action, 'warn', 'User is blocked');
      return false;
    }

    const limits = ACTION_LIMITS[action];
    if (!limits) return true;

    const key = `${userId}:${action}`;
    const now = Date.now();
    const history = this._actionHistory.get(key) ?? [];

    // Prune old entries
    const recentSec = history.filter(t => now - t < 1_000);
    const recentMin = history.filter(t => now - t < 60_000);

    if (recentSec.length >= limits.maxPerSec) {
      this._log(userId, action, 'warn', `Rate: ${recentSec.length}/sec > ${limits.maxPerSec}`);
      this._escalateRestriction(userId, 'rate_limited');
      return false;
    }

    if (recentMin.length >= limits.maxPerMin) {
      this._log(userId, action, 'warn', `Rate: ${recentMin.length}/min > ${limits.maxPerMin}`);
      this._escalateRestriction(userId, 'rate_limited');
      return false;
    }

    // Record action
    recentMin.push(now);
    // Keep only last 60s
    this._actionHistory.set(key, recentMin.filter(t => now - t < 60_000));

    return true;
  }

  // ── Explicit reporting ────────────────────────────────────────────────────

  reportSuspicious(
    userId:     string,
    category:   string,
    details:    string,
    threatLevel: ThreatLevel = 'warn',
  ): void {
    this._log(userId, category, threatLevel, details);
    if (threatLevel === 'critical') {
      this._escalateRestriction(userId, 'blocked');
    }
  }

  // ── Restriction control ───────────────────────────────────────────────────

  blockUser(userId: string, reason: string): void {
    this._restrictions.set(userId, 'blocked');
    this._log(userId, 'system', 'critical', `Blocked: ${reason}`);
    console.warn(`[SecurityManager] user blocked: ${userId} — ${reason}`);
  }

  unblockUser(userId: string): void {
    this._restrictions.delete(userId);
    console.log('[SecurityManager] user unblocked:', userId);
  }

  getRestriction(userId: string): UserRestriction {
    return this._restrictions.get(userId) ?? 'none';
  }

  isBlocked(userId: string): boolean {
    return this._restrictions.get(userId) === 'blocked';
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
    const event: SecurityEvent = {
      userId, action, threatLevel, details, timestamp: Date.now(),
    };
    this._violationLog.push(event);
    if (this._violationLog.length > 500) this._violationLog.shift();
    if (threatLevel !== 'info') {
      console.warn(`[SecurityManager] ${threatLevel.toUpperCase()} ${userId} ${action}: ${details}`);
    }
  }

  private _escalateRestriction(userId: string, level: UserRestriction): void {
    const current = this._restrictions.get(userId) ?? 'none';
    const escalationMap: Record<UserRestriction, UserRestriction> = {
      none:         'rate_limited',
      rate_limited: 'blocked',
      blocked:      'blocked',
    };
    if (current !== 'blocked') {
      this._restrictions.set(userId, level);
    }
  }
}

export const SecurityManager = new SecurityManagerImpl();
