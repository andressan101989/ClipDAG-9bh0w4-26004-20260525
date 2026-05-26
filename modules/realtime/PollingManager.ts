/**
 * modules/realtime/PollingManager.ts — Centralized polling coordinator
 *
 * BACKGROUND: Supabase Realtime is NOT available on this backend.
 * All "live" updates use polling. This manager centralizes poll scheduling
 * to avoid N independent setInterval calls scattered across contexts —
 * which causes battery drain, CPU waste, and network storms on mobile.
 *
 * Features:
 *   - Single shared timer (minimum 2s resolution)
 *   - Adaptive intervals: slows down when app is in background
 *   - Deduplication: same key = replace old, don't stack
 *   - Visibility-aware: pauses when app backgrounds
 *   - Ordered execution: prevents concurrent same-key runs
 *   - Per-poller error isolation
 *
 * Usage:
 *   import { PollingManager } from '@/modules/realtime/PollingManager';
 *
 *   // Register a poll (replaces old if same key)
 *   PollingManager.register({
 *     key:          'messages',
 *     intervalMs:   4_000,
 *     fn:           fetchConversations,
 *     runImmediately: true,
 *   });
 *
 *   // Remove
 *   PollingManager.unregister('messages');
 *
 *   // Manually trigger all polls (e.g. after app foreground)
 *   PollingManager.runAll();
 */

import { AppLifecycle } from '../core/AppLifecycle';

export interface PollConfig {
  /** Unique key — re-registering the same key replaces the old config. */
  key:          string;
  /** How often to call fn when the app is in the foreground (ms). Min: 1000. */
  intervalMs:   number;
  /** Async function to poll. Errors are caught and logged. */
  fn:           () => Promise<void>;
  /**
   * If true, fn() is called immediately on registration.
   * Default: false.
   */
  runImmediately?: boolean;
  /**
   * Factor applied to intervalMs when app is in background.
   * Default: 0 (pause completely when backgrounded).
   * Set to 1 to poll at same rate in background (discouraged — battery drain).
   */
  backgroundFactor?: number;
}

interface PollState {
  config:     PollConfig;
  lastRunAt:  number;
  isRunning:  boolean;
}

class PollingManagerImpl {
  private readonly _polls = new Map<string, PollState>();
  private _timer: ReturnType<typeof setInterval> | null = null;
  private readonly TICK_MS = 1000; // master timer resolution

  constructor() {
    // Pause all polls when app goes to background
    AppLifecycle.onBackground(() => {
      if (IS_DEV) console.log('[PollingManager] backgrounded — pausing background-factor=0 polls');
    });

    // Resume polls when app returns to foreground
    AppLifecycle.onForeground(() => {
      if (IS_DEV) console.log('[PollingManager] foregrounded — resuming polls');
      this.runAll();
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register (or replace) a poll. */
  register(config: PollConfig): void {
    const state: PollState = {
      config: { backgroundFactor: 0, runImmediately: false, ...config },
      lastRunAt: 0,
      isRunning: false,
    };
    this._polls.set(config.key, state);
    this._ensureTimer();

    if (config.runImmediately) {
      this._runPoll(state);
    }
  }

  /** Remove a poll by key. */
  unregister(key: string): void {
    this._polls.delete(key);
    if (this._polls.size === 0) this._stopTimer();
  }

  /** Remove all polls. */
  unregisterAll(): void {
    this._polls.clear();
    this._stopTimer();
  }

  /** Force-run all registered polls immediately (ignores interval). */
  runAll(): void {
    for (const state of this._polls.values()) {
      this._runPoll(state);
    }
  }

  /** Force-run a single poll by key immediately. */
  runNow(key: string): void {
    const state = this._polls.get(key);
    if (state) this._runPoll(state);
  }

  /** Number of active polls (diagnostics). */
  get count(): number { return this._polls.size; }

  /** List registered poll keys (diagnostics). */
  get keys(): string[] { return Array.from(this._polls.keys()); }

  // ── Private ────────────────────────────────────────────────────────────────

  private _ensureTimer(): void {
    if (this._timer !== null) return;
    this._timer = setInterval(this._tick.bind(this), this.TICK_MS);
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _tick(): void {
    const now = Date.now();
    const isActive = AppLifecycle.isActive;

    for (const state of this._polls.values()) {
      if (state.isRunning) continue; // skip if already executing

      const { intervalMs, backgroundFactor = 0 } = state.config;

      // Determine effective interval based on app state
      const effectiveInterval = isActive
        ? intervalMs
        : intervalMs / (backgroundFactor > 0 ? backgroundFactor : Infinity);

      // If backgroundFactor=0 and app is backgrounded → skip
      if (!isActive && backgroundFactor === 0) continue;

      if (now - state.lastRunAt >= effectiveInterval) {
        this._runPoll(state);
      }
    }
  }

  private _runPoll(state: PollState): void {
    if (state.isRunning) return;
    state.isRunning = true;
    state.lastRunAt = Date.now();

    state.config.fn()
      .catch((e: any) => {
        if (IS_DEV) {
          console.warn(`[PollingManager] poll "${state.config.key}" error:`, e?.message ?? e);
        }
      })
      .finally(() => {
        state.isRunning = false;
      });
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production';

/** Singleton polling coordinator. Use instead of scattered setInterval calls. */
export const PollingManager = new PollingManagerImpl();
