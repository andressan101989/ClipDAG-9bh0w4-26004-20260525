/**
 * modules/battle/BattleManager.ts — Creator Battle system (stub v1)
 *
 * Battle mode: two creators go live simultaneously.
 * Viewers vote via gifts — total BDAG received determines winner.
 * Real-time score sync via polling (no WebSocket).
 *
 * Future:
 *   - Split-screen video layout (dual StreamManager sessions)
 *   - Real-time leaderboard via PollingManager
 *   - Wagering system integration (useWallet + BDAG escrow)
 *   - Tournament brackets
 */

import { EventBus }     from '../core/EventBus';
import { PollingManager } from '../realtime/PollingManager';
import { getSupabaseClient } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────
export type BattleStatus = 'pending' | 'active' | 'ended' | 'cancelled';

export interface BattleScore {
  userId:    string;
  username:  string;
  avatar:    string;
  dagScore:  number;
  votes:     number;
}

export interface Battle {
  battleId:      string;
  challengerId:  string;
  targetId:      string;
  status:        BattleStatus;
  durationMs:    number;        // default: 60000 (1 min)
  startsAt?:     number;
  endsAt?:       number;
  scores:        [BattleScore, BattleScore];
  winnerId?:     string;
}

// ── Stub implementation ────────────────────────────────────────────────────────
class BattleManagerImpl {
  private _activeBattle: Battle | null = null;

  get activeBattle(): Battle | null { return this._activeBattle; }
  get isInBattle(): boolean { return this._activeBattle?.status === 'active'; }

  /** Issue a battle challenge to another creator. */
  async challenge(
    challengerId: string,
    targetId:     string,
    durationMs:   number = 60_000,
  ): Promise<{ battleId: string } | { error: string }> {
    console.warn('[BattleManager] Battle system — stub. Full implementation pending live stream integration.');
    // TODO: Insert into a battles table, notify targetId via notifications
    const battleId = `battle_${Date.now()}`;
    EventBus.emit('battle:challenged', { challengerId, targetId, battleId });
    return { battleId };
  }

  /** Accept an incoming battle challenge. */
  async accept(battleId: string): Promise<void> {
    EventBus.emit('battle:accepted', { battleId });
    // TODO: Start two simultaneous live sessions, begin scoring
  }

  /** End a battle and determine winner. */
  async end(battleId: string): Promise<void> {
    if (!this._activeBattle || this._activeBattle.battleId !== battleId) return;
    const winner = this._activeBattle.scores[0].dagScore >= this._activeBattle.scores[1].dagScore
      ? this._activeBattle.scores[0].userId
      : this._activeBattle.scores[1].userId;

    EventBus.emit('battle:ended', { battleId, winnerId: winner });
    PollingManager.unregister(`battle_score_${battleId}`);
    this._activeBattle = null;
  }

  /** Start polling battle scores while active. */
  startScorePolling(battleId: string): void {
    PollingManager.register({
      key:        `battle_score_${battleId}`,
      intervalMs: 2_000,
      fn:         async () => {
        try {
          const supabase = getSupabaseClient();
          // TODO: fetch battle scores from DB and update _activeBattle.scores
        } catch { /* ignore */ }
      },
    });
  }
}

export const BattleManager = new BattleManagerImpl();
