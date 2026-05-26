/**
 * modules/core/PerformanceMonitor.ts — Render + operation timing
 *
 * Lightweight performance monitor for tracking:
 *   - Render times (via mark/measure pattern)
 *   - Async operation durations
 *   - Memory warnings (native callback)
 *   - Frame budget violations (>16ms threshold)
 *
 * All measurements are stored in a ring buffer and can be read
 * from the in-app debug panel or exported as a JSON report.
 *
 * Usage:
 *   import { Perf } from '@/modules/core/PerformanceMonitor';
 *
 *   const end = Perf.start('feed-load');
 *   await loadFeed();
 *   end(); // logs duration automatically
 *
 *   // Or: manual measure
 *   Perf.record('deepar-filter-apply', 240, 'studio');
 */

export interface PerfEntry {
  label:     string;
  module?:   string;
  durationMs: number;
  timestamp: number;
  slow:      boolean; // > SLOW_THRESHOLD_MS
}

// ── Config ─────────────────────────────────────────────────────────────────────
const SLOW_THRESHOLD_MS  = 300;  // warn if operation takes longer
const RENDER_THRESHOLD_MS = 16;  // 1 frame budget
const BUFFER_SIZE         = 200;

const IS_DEV = process.env.NODE_ENV !== 'production';

class PerformanceMonitorImpl {
  private readonly _buffer: PerfEntry[] = [];
  private readonly _inProgress = new Map<string, number>();

  /** Start timing an operation. Returns a stop function that records the duration. */
  start(label: string, module?: string): () => void {
    const t0 = Date.now();
    const key = `${module ?? ''}:${label}:${t0}`;
    this._inProgress.set(key, t0);
    return () => {
      const durationMs = Date.now() - t0;
      this._inProgress.delete(key);
      this.record(label, durationMs, module);
    };
  }

  /** Manually record a measurement. */
  record(label: string, durationMs: number, module?: string): void {
    const slow = durationMs > SLOW_THRESHOLD_MS;
    const entry: PerfEntry = {
      label, module, durationMs,
      timestamp: Date.now(),
      slow,
    };

    if (this._buffer.length >= BUFFER_SIZE) this._buffer.shift();
    this._buffer.push(entry);

    if (!IS_DEV) return;
    if (slow) {
      console.warn(`[Perf] ⚠ SLOW ${module ? `[${module}] ` : ''}${label}: ${durationMs}ms`);
    } else if (durationMs > RENDER_THRESHOLD_MS) {
      console.debug(`[Perf] ${module ? `[${module}] ` : ''}${label}: ${durationMs}ms`);
    }
  }

  /** Wrap an async function with automatic timing. */
  async measure<T>(label: string, fn: () => Promise<T>, module?: string): Promise<T> {
    const stop = this.start(label, module);
    try {
      return await fn();
    } finally {
      stop();
    }
  }

  /** Recent measurements (last N entries). */
  getRecent(n = 50): PerfEntry[] {
    return this._buffer.slice(-n);
  }

  /** Slow operations only. */
  getSlow(n = 20): PerfEntry[] {
    return this._buffer.filter(e => e.slow).slice(-n);
  }

  /** Average duration for a label. */
  average(label: string): number {
    const entries = this._buffer.filter(e => e.label === label);
    if (entries.length === 0) return 0;
    return entries.reduce((s, e) => s + e.durationMs, 0) / entries.length;
  }

  /** Clear the buffer. */
  clear(): void {
    this._buffer.length = 0;
  }

  /** JSON report for copy-paste into issues. */
  report(): object {
    const slow = this.getSlow(20);
    const byModule: Record<string, { count: number; avgMs: number; maxMs: number }> = {};

    for (const e of this._buffer) {
      const key = e.module ?? 'global';
      if (!byModule[key]) byModule[key] = { count: 0, avgMs: 0, maxMs: 0 };
      byModule[key].count++;
      byModule[key].avgMs = Math.round(
        (byModule[key].avgMs * (byModule[key].count - 1) + e.durationMs) / byModule[key].count
      );
      byModule[key].maxMs = Math.max(byModule[key].maxMs, e.durationMs);
    }

    return {
      totalRecorded: this._buffer.length,
      slowOps:       slow.length,
      byModule,
      slowDetails:   slow.map(e => ({ label: e.label, module: e.module, durationMs: e.durationMs })),
    };
  }
}

export const Perf = new PerformanceMonitorImpl();
