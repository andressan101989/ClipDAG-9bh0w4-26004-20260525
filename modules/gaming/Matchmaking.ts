/**
 * modules/gaming/Matchmaking.ts — Opponent matching for mini-games
 *
 * Finds available opponents for a game session.
 * Uses polling (no WebSocket) with a Supabase matchmaking queue table.
 *
 * States: searching → found → timeout
 * Timeout: 30 seconds before cancelling the search.
 */

import { PollingManager } from '../realtime/PollingManager';
import { GameStore }      from '@/store/game.store';

export type MatchStatus = 'idle' | 'searching' | 'found' | 'timeout' | 'cancelled';

export interface MatchResult {
  gameId:   string;
  players:  string[];
  gameType: string;
}

export interface MatchmakingOptions {
  gameType:   string;
  wagerBdag?: number;
  locale?:    string;
  /** Max seconds to search before timeout. Default: 30. */
  timeout?:   number;
}

class MatchmakingImpl {
  private _status:   MatchStatus = 'idle';
  private _timer:    ReturnType<typeof setTimeout> | null = null;
  private _resolve:  ((r: MatchResult) => void)  | null = null;
  private _reject:   ((e: Error) => void)         | null = null;
  private _localUserId: string | null = null;

  get status(): MatchStatus { return this._status; }
  get isSearching(): boolean { return this._status === 'searching'; }

  /** Begin matchmaking. Resolves with a MatchResult or throws on timeout. */
  async findMatch(userId: string, options: MatchmakingOptions): Promise<MatchResult> {
    if (this._status === 'searching') throw new Error('Already searching');

    this._localUserId = userId;
    this._status = 'searching';
    GameStore.setState({ status: 'matchmaking' });

    const timeout = (options.timeout ?? 30) * 1000;

    return new Promise<MatchResult>((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;

      // Timeout guard
      this._timer = setTimeout(() => {
        this._status = 'timeout';
        this.cancel();
        reject(new Error('Matchmaking timeout — no opponent found'));
      }, timeout);

      // TODO: insert into matchmaking_queue table
      // Poll for a match
      PollingManager.register({
        key:         'matchmaking:poll',
        intervalMs:  2000,
        runImmediately: true,
        backgroundFactor: 0,
        fn:          async () => {
          const result = await this._checkForMatch(userId, options.gameType);
          if (result) {
            this._status = 'found';
            this._cleanupTimer();
            PollingManager.unregister('matchmaking:poll');
            this._resolve?.(result);
          }
        },
      });
    });
  }

  /** Cancel an active matchmaking search. */
  cancel(): void {
    this._cleanupTimer();
    PollingManager.unregister('matchmaking:poll');
    this._status = 'cancelled';
    GameStore.setState({ status: 'idle' });
    this._reject?.(new Error('Matchmaking cancelled'));
    this._resolve = null;
    this._reject  = null;
  }

  private _cleanupTimer(): void {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
  }

  private async _checkForMatch(userId: string, gameType: string): Promise<MatchResult | null> {
    // TODO: query matchmaking_queue table for a waiting opponent
    // For now returns null (stub)
    return null;
  }
}

export const Matchmaking = new MatchmakingImpl();
