/**
 * modules/core/LeakDetector.ts — Runtime memory leak detection & cleanup audit
 *
 * Tracks all registered async resources and flags uncleaned ones:
 *   - Event listeners (EventBus subscriptions)
 *   - Polling intervals (PollingManager keys)
 *   - Timers (setTimeout / setInterval)
 *   - RTC sessions (WebRTC peer connections)
 *   - Media streams (camera, microphone, playback)
 *   - WebSocket connections
 *   - Animation loops
 *   - Supabase subscriptions
 *
 * Every resource should be registered on creation and unregistered on cleanup.
 * LeakDetector periodically scans for stale registrations and logs warnings.
 *
 * Usage:
 *   const token = LeakDetector.track('timer', 'feed-poll', 'FeedContext');
 *   // ... later in cleanup:
 *   LeakDetector.release(token);
 *
 *   // In useEffect:
 *   useEffect(() => {
 *     const t = LeakDetector.track('listener', 'auth-change', 'MyComponent');
 *     return () => LeakDetector.release(t);
 *   }, []);
 */

export type LeakResourceType =
  | 'timer'
  | 'interval'
  | 'listener'
  | 'subscription'
  | 'rtc_session'
  | 'media_stream'
  | 'websocket'
  | 'animation'
  | 'camera'
  | 'upload'
  | 'polling'
  | 'render_surface'
  | 'gpu_resource';

export interface LeakRecord {
  token:     string;
  type:      LeakResourceType;
  key:       string;          // descriptive name
  owner:     string;          // component/service that registered it
  createdAt: number;
  stackHint: string;          // first line of stack for debugging
}

export interface LeakReport {
  generatedAt:   number;
  totalTracked:  number;
  staleCount:    number;
  byType:        Record<string, number>;
  staleRecords:  LeakRecord[];
  oldestRecord?: LeakRecord;
}

// Resources alive longer than these thresholds without cleanup are flagged
const STALE_THRESHOLDS_MS: Partial<Record<LeakResourceType, number>> = {
  timer:          30_000,
  interval:       120_000,
  listener:       300_000,   // 5 min — long-lived but should outlive component
  subscription:   300_000,
  rtc_session:    3_600_000, // 1 hour — very long calls
  media_stream:   60_000,
  websocket:      300_000,
  animation:      60_000,
  camera:         120_000,
  upload:         600_000,   // 10 min — large file uploads
  polling:        300_000,
  render_surface: 120_000,
  gpu_resource:   120_000,
};

let _tokenCounter = 0;

class LeakDetectorImpl {
  private readonly _records = new Map<string, LeakRecord>();
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  startMonitoring(intervalMs = 60_000): void {
    if (this._intervalId) return;
    this._intervalId = setInterval(() => this._scan(), intervalMs);
    console.log('[LeakDetector] monitoring started');
  }

  stopMonitoring(): void {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
  }

  // ── Tracking API ──────────────────────────────────────────────────────────

  /**
   * Register a resource. Returns a token to pass to release().
   */
  track(type: LeakResourceType, key: string, owner: string): string {
    const token = `leak_${++_tokenCounter}_${type}`;
    const stackHint = this._getStackHint();
    this._records.set(token, {
      token, type, key, owner,
      createdAt: Date.now(),
      stackHint,
    });
    return token;
  }

  /**
   * Unregister a resource. Call in cleanup functions.
   */
  release(token: string): void {
    this._records.delete(token);
  }

  /**
   * Convenience: release multiple tokens at once.
   */
  releaseAll(tokens: string[]): void {
    for (const t of tokens) this.release(t);
  }

  // ── Inspection ────────────────────────────────────────────────────────────

  /** Current count of tracked resources. */
  get trackedCount(): number { return this._records.size; }

  /** Generate a leak report. */
  getReport(): LeakReport {
    const now     = Date.now();
    const records = Array.from(this._records.values());
    const stale   = records.filter(r => this._isStale(r, now));

    const byType: Record<string, number> = {};
    for (const r of records) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
    }

    const oldest = records.sort((a, b) => a.createdAt - b.createdAt)[0];

    return {
      generatedAt:   now,
      totalTracked:  records.length,
      staleCount:    stale.length,
      byType,
      staleRecords:  stale,
      oldestRecord:  oldest,
    };
  }

  /** Check if a specific token is still tracked (not yet released). */
  isTracked(token: string): boolean {
    return this._records.has(token);
  }

  /** Get all records owned by a component/service. */
  getByOwner(owner: string): LeakRecord[] {
    return Array.from(this._records.values()).filter(r => r.owner === owner);
  }

  /** Force-release all records owned by an owner (emergency cleanup). */
  releaseOwner(owner: string): number {
    let count = 0;
    for (const [token, rec] of this._records) {
      if (rec.owner === owner) {
        this._records.delete(token);
        count++;
      }
    }
    if (count > 0) {
      console.warn(`[LeakDetector] force-released ${count} records for owner "${owner}"`);
    }
    return count;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _scan(): void {
    const now    = Date.now();
    const stale  = Array.from(this._records.values()).filter(r => this._isStale(r, now));

    if (stale.length > 0) {
      console.warn(
        `[LeakDetector] ${stale.length} potentially leaked resources:\n` +
        stale.map(r =>
          `  [${r.type}] "${r.key}" (owner: ${r.owner}, age: ${Math.round((now - r.createdAt) / 1000)}s)`
        ).join('\n')
      );
    }
  }

  private _isStale(record: LeakRecord, now: number): boolean {
    const threshold = STALE_THRESHOLDS_MS[record.type] ?? 300_000;
    return (now - record.createdAt) > threshold;
  }

  private _getStackHint(): string {
    try {
      const stack = new Error().stack ?? '';
      const lines = stack.split('\n').filter(l => !l.includes('LeakDetector'));
      return lines[1]?.trim() ?? '';
    } catch {
      return '';
    }
  }
}

export const LeakDetector = new LeakDetectorImpl();
