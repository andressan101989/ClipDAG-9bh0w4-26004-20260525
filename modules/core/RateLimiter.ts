/**
 * modules/core/RateLimiter.ts — Client-side rate limiting & burst protection
 *
 * Prevents UI/backend overload from:
 *   - Rapid-fire user actions (double-taps, button spam)
 *   - Realtime event floods (socket message storms)
 *   - Polling bursts (multiple contexts polling same endpoint)
 *   - Upload queue storms (bulk file selection)
 *   - Gaming action floods (rapid input during games)
 *
 * Algorithms:
 *   TOKEN_BUCKET:  smooth rate, allows short bursts (default)
 *   FIXED_WINDOW:  N requests per time window (stricter)
 *   SLIDING_WINDOW: most accurate, prevents window boundary bursts
 *   DEBOUNCE:      collapses rapid calls into one (for search, typing)
 *   THROTTLE:      first call passes, subsequent blocked until window
 *
 * Usage:
 *   // Check before sending
 *   if (RateLimiter.check('like_action')) {
 *     sendLike(videoId);
 *   }
 *
 *   // Debounce search input
 *   RateLimiter.debounce('search', () => doSearch(query), 300);
 *
 *   // Configure custom limits
 *   RateLimiter.configure('message_send', { maxRequests: 5, windowMs: 1000 });
 */

export type RateLimitAlgorithm = 'token_bucket' | 'fixed_window' | 'sliding_window' | 'debounce' | 'throttle';

export interface RateLimitConfig {
  maxRequests:  number;     // max requests per window
  windowMs:     number;     // window size in ms
  algorithm?:   RateLimitAlgorithm;
  burstAllowed?: number;    // extra burst tokens (token_bucket only)
  onRejected?:  (key: string) => void;  // callback when rate limited
}

interface BucketState {
  tokens:      number;
  lastRefill:  number;
}

interface WindowState {
  timestamps: number[];    // sliding window
  count:      number;      // fixed window
  windowStart: number;
}

interface TimerState {
  timerId:     ReturnType<typeof setTimeout> | null;
  lastCall:    number;
}

// Default configurations for common operations
const DEFAULTS: Record<string, RateLimitConfig> = {
  like_action:      { maxRequests: 10, windowMs: 1_000,  algorithm: 'token_bucket' },
  comment_post:     { maxRequests: 3,  windowMs: 5_000,  algorithm: 'fixed_window' },
  message_send:     { maxRequests: 5,  windowMs: 1_000,  algorithm: 'token_bucket' },
  follow_action:    { maxRequests: 20, windowMs: 60_000, algorithm: 'sliding_window' },
  gift_send:        { maxRequests: 5,  windowMs: 5_000,  algorithm: 'fixed_window' },
  search_query:     { maxRequests: 1,  windowMs: 300,    algorithm: 'debounce' },
  upload_trigger:   { maxRequests: 3,  windowMs: 10_000, algorithm: 'token_bucket' },
  game_action:      { maxRequests: 30, windowMs: 1_000,  algorithm: 'token_bucket', burstAllowed: 10 },
  api_call:         { maxRequests: 50, windowMs: 1_000,  algorithm: 'sliding_window' },
  push_notification:{ maxRequests: 2,  windowMs: 5_000,  algorithm: 'fixed_window' },
};

class RateLimiterImpl {
  private readonly _configs  = new Map<string, RateLimitConfig>(Object.entries(DEFAULTS));
  private readonly _buckets  = new Map<string, BucketState>();
  private readonly _windows  = new Map<string, WindowState>();
  private readonly _timers   = new Map<string, TimerState>();
  private _rejectionCounts   = new Map<string, number>();

  // ── Configuration ─────────────────────────────────────────────────────────

  configure(key: string, config: RateLimitConfig): void {
    this._configs.set(key, config);
  }

  // ── Check API ─────────────────────────────────────────────────────────────

  /**
   * Returns true if the action is allowed, false if rate limited.
   */
  check(key: string): boolean {
    const config = this._configs.get(key) ?? { maxRequests: 10, windowMs: 1_000, algorithm: 'token_bucket' };

    let allowed: boolean;
    switch (config.algorithm ?? 'token_bucket') {
      case 'token_bucket':    allowed = this._checkTokenBucket(key, config);    break;
      case 'fixed_window':    allowed = this._checkFixedWindow(key, config);    break;
      case 'sliding_window':  allowed = this._checkSlidingWindow(key, config);  break;
      case 'throttle':        allowed = this._checkThrottle(key, config);       break;
      default:                allowed = this._checkTokenBucket(key, config);
    }

    if (!allowed) {
      const count = (this._rejectionCounts.get(key) ?? 0) + 1;
      this._rejectionCounts.set(key, count);
      config.onRejected?.(key);
      if (count % 10 === 1) {
        console.warn(`[RateLimiter] "${key}" rate limited (${count} rejections)`);
      }
    }

    return allowed;
  }

  /**
   * Debounce: delay fn execution until windowMs of silence.
   */
  debounce(key: string, fn: () => void, windowMs?: number): void {
    const config = this._configs.get(key) ?? { maxRequests: 1, windowMs: windowMs ?? 300 };
    const delay  = windowMs ?? config.windowMs;

    let state = this._timers.get(key);
    if (!state) { state = { timerId: null, lastCall: 0 }; this._timers.set(key, state); }

    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = setTimeout(() => {
      state!.timerId = null;
      state!.lastCall = Date.now();
      fn();
    }, delay);
  }

  /**
   * Cancel a pending debounce.
   */
  cancelDebounce(key: string): void {
    const state = this._timers.get(key);
    if (state?.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getRejectionCount(key: string): number {
    return this._rejectionCounts.get(key) ?? 0;
  }

  resetRejectionCount(key: string): void {
    this._rejectionCounts.delete(key);
  }

  getStats(): Record<string, { rejections: number; config: RateLimitConfig }> {
    const out: Record<string, any> = {};
    for (const [key, config] of this._configs) {
      out[key] = { rejections: this._rejectionCounts.get(key) ?? 0, config };
    }
    return out;
  }

  // ── Algorithms ────────────────────────────────────────────────────────────

  private _checkTokenBucket(key: string, config: RateLimitConfig): boolean {
    const now    = Date.now();
    const max    = config.maxRequests + (config.burstAllowed ?? 0);
    const refillRatePerMs = config.maxRequests / config.windowMs;

    let bucket = this._buckets.get(key);
    if (!bucket) {
      bucket = { tokens: max, lastRefill: now };
      this._buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(max, bucket.tokens + elapsed * refillRatePerMs);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  private _checkFixedWindow(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();

    let state = this._windows.get(key);
    if (!state) {
      state = { timestamps: [], count: 0, windowStart: now };
      this._windows.set(key, state);
    }

    if (now - state.windowStart > config.windowMs) {
      state.count      = 0;
      state.windowStart = now;
    }

    if (state.count < config.maxRequests) {
      state.count++;
      return true;
    }
    return false;
  }

  private _checkSlidingWindow(key: string, config: RateLimitConfig): boolean {
    const now      = Date.now();
    const cutoff   = now - config.windowMs;

    let state = this._windows.get(key);
    if (!state) {
      state = { timestamps: [], count: 0, windowStart: now };
      this._windows.set(key, state);
    }

    // Prune expired timestamps
    state.timestamps = state.timestamps.filter(t => t > cutoff);

    if (state.timestamps.length < config.maxRequests) {
      state.timestamps.push(now);
      return true;
    }
    return false;
  }

  private _checkThrottle(key: string, config: RateLimitConfig): boolean {
    const now   = Date.now();
    let state   = this._timers.get(key);
    if (!state) { state = { timerId: null, lastCall: 0 }; this._timers.set(key, state); }

    if (now - state.lastCall >= config.windowMs) {
      state.lastCall = now;
      return true;
    }
    return false;
  }
}

export const RateLimiter = new RateLimiterImpl();
