/**
 * modules/gaming/GameEngine.ts — Game session lifecycle manager
 *
 * Manages mini-game sessions: matchmaking, state sync, scoring, and wagering.
 * Designed to be game-type-agnostic — each game type (trivia, reflex, puzzle)
 * provides its own logic via a GameAdapter interface.
 *
 * Architecture:
 *   GameEngine (orchestrator)
 *     └── GameAdapter (game-type plugin)
 *     └── Matchmaking (find opponents)
 *     └── GameStore (reactive state)
 *     └── PollingManager (sync during game)
 *     └── SyncEngine (score commits)
 *
 * CURRENT STATE: Stub infrastructure with full type definitions.
 */

import { GameStore }    from '@/store/game.store';
import { EventBus }     from '../core/EventBus';
import { PollingManager } from '../realtime/PollingManager';

export interface GameAdapter {
  gameType:   string;
  /** Called when game starts. Returns initial payload. */
  onStart:    (players: string[]) => Record<string, any>;
  /** Called on each tick (100ms). Returns updated payload. */
  onTick?:    (payload: Record<string, any>, elapsedMs: number) => Record<string, any>;
  /** Called when player performs an action. */
  onAction:   (userId: string, action: string, data?: any) => { score: number; payload?: Record<string, any> };
  /** Called when game ends. Returns final scores. */
  onEnd:      (payload: Record<string, any>) => Record<string, number>;
}

class GameEngineImpl {
  private _adapter:   GameAdapter | null = null;
  private _gameId:    string | null = null;

  get isActive(): boolean { return GameStore.isPlaying; }

  /** Register a game type adapter. */
  registerAdapter(adapter: GameAdapter): void {
    this._adapter = adapter;
    console.log('[GameEngine] adapter registered:', adapter.gameType);
  }

  /** Start a game session. */
  async startGame(
    gameId:     string,
    gameType:   string,
    players:    string[],
    durationMs: number,
    wagerBdag:  number,
  ): Promise<{ error?: string }> {
    if (!this._adapter || this._adapter.gameType !== gameType) {
      return { error: `No adapter registered for gameType "${gameType}"` };
    }

    this._gameId = gameId;

    const initialPayload = this._adapter.onStart(players);

    GameStore.setState({
      gameId,
      gameType,
      status:      'countdown',
      durationMs,
      remainingMs: durationMs,
      players:     players.map((userId, i) => ({
        userId, username: userId, score: 0, isReady: true, isHost: i === 0,
      })),
      wager:       { amount: wagerBdag, status: wagerBdag > 0 ? 'locked' : 'none' },
      payload:     initialPayload,
      startedAt:   Date.now(),
    });

    // 3-second countdown then start
    await new Promise(r => setTimeout(r, 3000));
    GameStore.setState({ status: 'playing' });
    GameStore.startTimer();

    // Register polling for multiplayer state sync
    PollingManager.register({
      key:         `game:sync:${gameId}`,
      intervalMs:  500,
      backgroundFactor: 0,
      fn:          async () => { /* TODO: sync remote player scores */ },
    });

    return {};
  }

  /** Player performs an action. */
  handleAction(userId: string, action: string, data?: any): void {
    if (!this._adapter || !this._gameId) return;
    const result = this._adapter.onAction(userId, action, data);
    GameStore.updatePlayerScore(userId, result.score);
    if (result.payload) GameStore.setState({ payload: result.payload });
  }

  /** End the current game. */
  async endGame(): Promise<void> {
    if (!this._gameId) return;

    const state = GameStore.getState();
    if (this._adapter) {
      const finalScores = this._adapter.onEnd(state.payload ?? {});
      const winnerId = Object.entries(finalScores).sort((a, b) => b[1] - a[1])[0]?.[0];
      GameStore.setState({ status: 'ended', winnerId, endedAt: Date.now() });
    }

    PollingManager.unregister(`game:sync:${this._gameId}`);
    GameStore.stopTimer();

    // Settle wager
    if (state.wager.status === 'locked') {
      // TODO: call Edge Function to settle wager
      GameStore.setState({ wager: { ...state.wager, status: 'settled' } });
    }

    this._gameId = null;
  }

  /** Abandon game (user leaves mid-game). */
  async abandonGame(): Promise<void> {
    GameStore.setState({ status: 'ended' });
    await this.endGame();
    GameStore.reset();
  }
}

export const GameEngine = new GameEngineImpl();
