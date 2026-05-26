/**
 * modules/core/RetryStrategy.ts — Configurable retry with back-off
 *
 * Provides reusable retry primitives for:
 *   - API calls that may fail transiently
 *   - WebRTC reconnection
 *   - Upload retries
 *   - Session recovery after network interruption
 *
 * Strategies:
 *   - exponential:  delay = base × 2^(attempt-1) (default)
 *   - linear:       delay = base × attempt
 *   - fixed:        delay = base (constant)
 *   - fibonacci:    delay follows Fibonacci sequence
 *
 * Usage:
 *   const result = await retry(
 *     () => supabase.from('messages').select('*'),
 *     { maxAttempts: 3, strategy: 'exponential', baseMs: 1000 }
 *   );
 *
 *   // With circuit breaker:
 *   const cb = new CircuitBreaker('wallet-api', { threshold: 5, resetMs: 60_000 });
 *   const result = await cb.execute(() => walletApi.getBalance());
 */

export type RetryStrategyType = 'exponential' | 'linear' | 'fixed' | 'fibonacci';

export interface RetryOptions {
  maxAttempts:  number;
  baseMs:       number;
  maxDelayMs?:  number;
  strategy?:    RetryStrategyType;
  /** Return true to stop retrying regardless of maxAttempts. */
  shouldAbort?: (error: Error, attempt: number) => boolean;
  onAttempt?:   (attempt: number, error: Error) => void;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

/** Execute a function with configurable retry. Throws on permanent failure. */
export async function retry<T>(
  fn:       () => Promise<T>,
  options:  RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseMs,
    maxDelayMs    = 30_000,
    strategy      = 'exponential',
    shouldAbort,
    onAttempt,
  } = options;

  let lastError: Error = new Error('retry failed');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e instanceof Error ? e : new Error(String(e));

      onAttempt?.(attempt, lastError);

      if (attempt === maxAttempts) break;
      if (shouldAbort?.(lastError, attempt)) break;

      const delay = Math.min(computeDelay(strategy, baseMs, attempt), maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

function computeDelay(strategy: RetryStrategyType, baseMs: number, attempt: number): number {
  switch (strategy) {
    case 'exponential': return baseMs * Math.pow(2, attempt - 1);
    case 'linear':      return baseMs * attempt;
    case 'fixed':       return baseMs;
    case 'fibonacci':   return baseMs * fibonacci(attempt);
    default:            return baseMs;
  }
}

function fibonacci(n: number): number {
  if (n <= 1) return 1;
  let a = 1, b = 1;
  for (let i = 2; i < n; i++) { const t = a + b; a = b; b = t; }
  return b;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────
// Prevents cascading failures by stopping calls to a failing service temporarily.

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit. */
  threshold:  number;
  /** Time in ms to wait before trying half-open. Default: 60s. */
  resetMs?:   number;
  /** Called when circuit opens or closes. */
  onStateChange?: (state: CircuitState) => void;
}

export class CircuitBreaker {
  private _state:       CircuitState = 'closed';
  private _failures:    number       = 0;
  private _lastFailAt:  number       = 0;
  private readonly _options: Required<CircuitBreakerOptions>;

  constructor(
    public readonly name: string,
    options: CircuitBreakerOptions,
  ) {
    this._options = {
      resetMs:       60_000,
      onStateChange: () => {},
      ...options,
    };
  }

  get state(): CircuitState { return this._state; }
  get isOpen(): boolean     { return this._state === 'open'; }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === 'open') {
      const elapsed = Date.now() - this._lastFailAt;
      if (elapsed < this._options.resetMs) {
        throw new Error(`Circuit "${this.name}" is open — service unavailable`);
      }
      // Attempt half-open
      this._setState('half-open');
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (e: any) {
      this._onFailure();
      throw e;
    }
  }

  reset(): void {
    this._failures   = 0;
    this._setState('closed');
  }

  private _onSuccess(): void {
    this._failures = 0;
    if (this._state !== 'closed') this._setState('closed');
  }

  private _onFailure(): void {
    this._failures++;
    this._lastFailAt = Date.now();
    if (this._failures >= this._options.threshold) {
      this._setState('open');
      console.warn(`[CircuitBreaker] "${this.name}" opened after ${this._failures} failures`);
    }
  }

  private _setState(state: CircuitState): void {
    if (this._state === state) return;
    this._state = state;
    this._options.onStateChange(state);
  }
}
