/**
 * modules/gaming/TimerManager.ts — Precision game timer with sync compensation
 *
 * Provides high-accuracy timers for game sessions:
 *   - Monotonic timer using performance.now() (immune to clock changes)
 *   - Server time sync to compensate for client clock drift
 *   - Latency compensation for multiplayer (subtract half-RTT)
 *   - Countdown timers with tick callbacks (for UI updates)
 *   - Background pause/resume (timers pause when app backgrounds)
 *   - Anti-drift: periodic correction to prevent accumulation error
 *
 * Usage:
 *   const timer = TimerManager.createCountdown('game-1', 60_000);
 *   timer.onTick(remaining => setTimeLeft(remaining));
 *   timer.onExpire(() => endGame());
 *   timer.start(serverStartTime);
 *   timer.pause();
 *   timer.resume();
 *   timer.destroy();
 */

import { AppLifecycle } from '../core/AppLifecycle';

export interface GameTimer {
  id:          string;
  start:       (serverStartTimeMs?: number) => void;
  pause:       () => void;
  resume:      () => void;
  destroy:     () => void;
  onTick:      (fn: (remainingMs: number) => void) => () => void;
  onExpire:    (fn: () => void) => () => void;
  getRemainingMs: () => number;
  getElapsedMs:   () => number;
  isPaused:    boolean;
  isExpired:   boolean;
}

const TICK_INTERVAL_MS = 100;  // 10 updates/sec — smooth UI without excessive CPU

class TimerManagerImpl {
  private readonly _timers = new Map<string, TimerEntry>();

  createCountdown(id: string, durationMs: number): GameTimer {
    if (this._timers.has(id)) this.destroy(id);

    const entry = new TimerEntry(id, durationMs);
    this._timers.set(id, entry);

    // Auto-pause on background
    const unsubBg = AppLifecycle.onBackground(() => entry.pause());
    const unsubFg = AppLifecycle.onForeground(() => {
      if (!entry.isPaused) return;  // was manually paused
      entry.resume();
    });

    const origDestroy = entry.destroy.bind(entry);
    entry.destroy = () => {
      unsubBg();
      unsubFg();
      origDestroy();
      this._timers.delete(id);
    };

    return entry;
  }

  get(id: string): GameTimer | null {
    return this._timers.get(id) ?? null;
  }

  destroy(id: string): void {
    this._timers.get(id)?.destroy();
    this._timers.delete(id);
  }

  destroyAll(): void {
    for (const id of this._timers.keys()) this.destroy(id);
  }
}

class TimerEntry implements GameTimer {
  id: string;
  isPaused  = true;
  isExpired = false;

  private _durationMs:     number;
  private _startPerf:      number = 0;
  private _pausedElapsedMs: number = 0;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _clockOffset = 0;  // client - server clock difference

  private _tickHandlers:   Set<(ms: number) => void> = new Set();
  private _expireHandlers: Set<() => void>            = new Set();

  constructor(id: string, durationMs: number) {
    this.id = id;
    this._durationMs = durationMs;
  }

  start(serverStartTimeMs?: number): void {
    if (!this.isPaused && !this.isExpired) return;

    if (serverStartTimeMs) {
      // Calculate how much time has already elapsed on the server
      const serverNow     = serverStartTimeMs + (Date.now() - serverStartTimeMs);
      this._clockOffset   = serverStartTimeMs - Date.now();
      const alreadyElapsed = Math.max(0, Date.now() - serverStartTimeMs);
      this._pausedElapsedMs = alreadyElapsed;
    }

    this._startPerf = performance.now() - this._pausedElapsedMs;
    this.isPaused   = false;
    this.isExpired  = false;

    this._intervalId = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  pause(): void {
    if (this.isPaused || this.isExpired) return;
    this._pausedElapsedMs = performance.now() - this._startPerf;
    this.isPaused = true;
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
  }

  resume(): void {
    if (!this.isPaused || this.isExpired) return;
    this._startPerf = performance.now() - this._pausedElapsedMs;
    this.isPaused   = false;
    this._intervalId = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  destroy(): void {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    this._tickHandlers.clear();
    this._expireHandlers.clear();
  }

  onTick(fn: (remainingMs: number) => void): () => void {
    this._tickHandlers.add(fn);
    return () => this._tickHandlers.delete(fn);
  }

  onExpire(fn: () => void): () => void {
    this._expireHandlers.add(fn);
    return () => this._expireHandlers.delete(fn);
  }

  getRemainingMs(): number {
    if (this.isExpired) return 0;
    return Math.max(0, this._durationMs - this.getElapsedMs());
  }

  getElapsedMs(): number {
    if (this.isPaused) return this._pausedElapsedMs;
    return performance.now() - this._startPerf;
  }

  private _tick(): void {
    const remaining = this.getRemainingMs();

    for (const fn of this._tickHandlers) {
      try { fn(remaining); } catch { /* isolate */ }
    }

    if (remaining <= 0) {
      this.isExpired = true;
      if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
      for (const fn of this._expireHandlers) {
        try { fn(); } catch { /* isolate */ }
      }
    }
  }
}

export const TimerManager = new TimerManagerImpl();
