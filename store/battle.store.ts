/**
 * store/battle.store.ts — Creator battle domain store
 *
 * Tracks real-time battle state: participants, votes, timer, BDAG stakes.
 * BattleManager writes; battle UI subscribes.
 */

import { EventBus } from '@/modules/core/EventBus';

export type BattleStatus =
  | 'idle'
  | 'pending_acceptance'
  | 'countdown'       // 3-2-1 before battle starts
  | 'active'          // battle in progress, votes accumulating
  | 'ending'          // final 10 seconds, results locked
  | 'ended'
  | 'cancelled';

export interface BattleParticipant {
  userId:    string;
  username:  string;
  avatarUrl?: string;
  votes:     number;
  dagStaked: number;
  isWinner?: boolean;
}

export interface BattleState {
  battleId?:      string;
  status:         BattleStatus;
  participants:   BattleParticipant[];
  totalDagPool:   number;     // sum of all stakes
  durationMs:     number;     // total battle length
  remainingMs:    number;     // countdown remaining
  startedAt?:     number;
  endedAt?:       number;
  winnerId?:      string;
  myVote?:        string;     // userId I voted for
  error?:         string;
}

const INITIAL: BattleState = {
  status:       'idle',
  participants: [],
  totalDagPool: 0,
  durationMs:   60_000,   // default 60s
  remainingMs:  60_000,
};

class BattleStoreImpl {
  private _state: BattleState = { ...INITIAL };
  private readonly _subs = new Set<(s: BattleState) => void>();
  private _timer: ReturnType<typeof setInterval> | null = null;

  getState():      BattleState { return this._state; }
  get isActive():  boolean     { return this._state.status === 'active'; }

  setState(patch: Partial<BattleState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  updateVotes(userId: string, votes: number): void {
    const participants = this._state.participants.map(p =>
      p.userId === userId ? { ...p, votes } : p
    );
    this.setState({ participants });
  }

  castVote(forUserId: string): void {
    if (this._state.myVote) return; // already voted
    this.setState({ myVote: forUserId });
    this.updateVotes(forUserId, (this._state.participants.find(p => p.userId === forUserId)?.votes ?? 0) + 1);
  }

  startCountdown(): void {
    this.setState({ status: 'countdown', remainingMs: this._state.durationMs });
    this._startTimer();
  }

  reset(): void {
    this._stopTimer();
    this._state = { ...INITIAL };
    this._notify();
  }

  subscribe(fn: (s: BattleState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _startTimer(): void {
    this._stopTimer();
    this._timer = setInterval(() => {
      const remaining = Math.max(0, this._state.remainingMs - 500);
      if (remaining === 0) {
        this._stopTimer();
        this.setState({ status: 'ended', endedAt: Date.now(), remainingMs: 0 });
        const winner = [...this._state.participants].sort((a, b) => b.votes - a.votes)[0];
        if (winner) EventBus.emit('battle:ended', { battleId: this._state.battleId ?? '', winnerId: winner.userId });
      } else {
        const status = remaining <= 10_000 ? 'ending' : 'active';
        this.setState({ remainingMs: remaining, status });
      }
    }, 500);
  }

  private _stopTimer(): void {
    if (this._timer !== null) { clearInterval(this._timer); this._timer = null; }
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const BattleStore = new BattleStoreImpl();

EventBus.on('battle:challenged', ({ battleId, challengerId }) =>
  BattleStore.setState({ battleId, status: 'pending_acceptance', participants: [] })
);
EventBus.on('battle:accepted',   ({ battleId }) =>
  BattleStore.startCountdown()
);
EventBus.on('battle:ended',      ({ winnerId }) =>
  BattleStore.setState({ status: 'ended', winnerId, endedAt: Date.now() })
);
