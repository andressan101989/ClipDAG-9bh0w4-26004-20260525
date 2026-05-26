/**
 * store/game.store.ts — Gaming domain store
 *
 * Tracks active game session: state machine, scores, wagering, multiplayer sync.
 * GameEngine writes; game UI subscribes.
 */

import { EventBus } from '@/modules/core/EventBus';

export type GameStatus =
  | 'idle'
  | 'matchmaking'
  | 'loading'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'finishing'
  | 'ended';

export type WagerStatus = 'none' | 'pending' | 'locked' | 'settled';

export interface GamePlayer {
  userId:   string;
  username: string;
  score:    number;
  isReady:  boolean;
  isHost:   boolean;
  ping?:    number;  // ms
}

export interface GameWager {
  amount:   number;    // BDAG
  status:   WagerStatus;
  winnerId?: string;
}

export interface GameState {
  gameId?:       string;
  gameType?:     string;   // e.g. 'trivia', 'reflex', 'puzzle'
  status:        GameStatus;
  players:       GamePlayer[];
  localScore:    number;
  durationMs:    number;
  remainingMs:   number;
  roundNumber:   number;
  totalRounds:   number;
  wager:         GameWager;
  startedAt?:    number;
  endedAt?:      number;
  winnerId?:     string;
  // Generic payload for game-type-specific state
  payload?:      Record<string, any>;
  error?:        string;
}

const INITIAL: GameState = {
  status:      'idle',
  players:     [],
  localScore:  0,
  durationMs:  60_000,
  remainingMs: 60_000,
  roundNumber: 1,
  totalRounds: 1,
  wager:       { amount: 0, status: 'none' },
};

class GameStoreImpl {
  private _state: GameState = { ...INITIAL };
  private readonly _subs = new Set<(s: GameState) => void>();
  private _timer: ReturnType<typeof setInterval> | null = null;

  getState():       GameState { return this._state; }
  get isPlaying():  boolean   { return this._state.status === 'playing'; }
  get isMatchmaking(): boolean { return this._state.status === 'matchmaking'; }

  setState(patch: Partial<GameState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  updatePlayerScore(userId: string, score: number): void {
    const players = this._state.players.map(p =>
      p.userId === userId ? { ...p, score } : p
    );
    this.setState({ players });
  }

  addScore(delta: number): void {
    this.setState({ localScore: this._state.localScore + delta });
  }

  startTimer(): void {
    this._stopTimer();
    this._timer = setInterval(() => {
      const remaining = Math.max(0, this._state.remainingMs - 100);
      this.setState({ remainingMs: remaining });
      if (remaining === 0) {
        this._stopTimer();
        this.setState({ status: 'finishing', endedAt: Date.now() });
      }
    }, 100);
  }

  stopTimer(): void { this._stopTimer(); }

  reset(): void {
    this._stopTimer();
    this._state = { ...INITIAL };
    this._notify();
  }

  subscribe(fn: (s: GameState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
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

export const GameStore = new GameStoreImpl();
