/**
 * modules/core/CrashManager.ts — Centralized error collection & recovery
 *
 * Catches unhandled JS errors and promise rejections before they crash the app.
 * Provides structured error reporting, session recovery, and user-visible fallbacks.
 *
 * Features:
 *   - Global unhandledRejection + ErrorUtils handlers
 *   - Error deduplication (same error within 10s = one record)
 *   - Severity classification: warning / error / fatal
 *   - Local ring buffer of last 50 errors (for diagnostics / support)
 *   - Retry strategy registry (per-feature recovery callbacks)
 *   - Upload to backend (future: crash reporting edge function)
 *
 * Usage:
 *   CrashManager.initialize();   // Call once in _layout.tsx
 *
 *   // Register a recovery callback for a feature
 *   CrashManager.registerRecovery('creator-studio', async () => {
 *     await CreatorModule.reset();
 *   });
 *
 *   // Report a handled error
 *   CrashManager.report(error, { module: 'wallet', severity: 'warning' });
 */

import { AppLifecycle } from './AppLifecycle';
import { EventBus }     from './EventBus';

export type Severity = 'debug' | 'warning' | 'error' | 'fatal';

export interface CrashRecord {
  id:         string;
  message:    string;
  stack?:     string;
  module?:    string;
  severity:   Severity;
  timestamp:  number;
  count:      number;   // dedup counter
}

type RecoveryFn = () => Promise<void>;

const MAX_RECORDS   = 50;
const DEDUP_WINDOW  = 10_000;   // ms — same error within 10s = update count

class CrashManagerImpl {
  private readonly _records: CrashRecord[] = [];
  private readonly _recoveries = new Map<string, RecoveryFn>();
  private _initialized = false;
  private _idCounter   = 0;

  // ── Init ───────────────────────────────────────────────────────────────────

  /** Call once in _layout.tsx after AppLifecycle.initialize(). */
  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Catch unhandled promise rejections
    const origHandler = (global as any).onunhandledrejection;
    (global as any).onunhandledrejection = (event: any) => {
      const err = event?.reason;
      this.report(err instanceof Error ? err : new Error(String(err)), {
        module:   'global:promise',
        severity: 'error',
      });
      origHandler?.(event);
    };

    // Catch React Native's global error handler
    const ErrorUtils = (global as any).ErrorUtils;
    if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === 'function') {
      const origGlobal = ErrorUtils.getGlobalHandler?.();
      ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
        this.report(error, {
          module:   'global:RN',
          severity: isFatal ? 'fatal' : 'error',
        });
        origGlobal?.(error, isFatal);
      });
    }

    console.log('[CrashManager] initialized');
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  report(error: Error | string, options?: { module?: string; severity?: Severity }): void {
    const message  = error instanceof Error ? error.message : String(error);
    const stack    = error instanceof Error ? error.stack   : undefined;
    const module   = options?.module   ?? 'unknown';
    const severity = options?.severity ?? 'error';
    const now      = Date.now();

    // Deduplication
    const existing = this._records.find(r =>
      r.message === message && r.module === module && (now - r.timestamp) < DEDUP_WINDOW
    );
    if (existing) {
      existing.count++;
      return;
    }

    const record: CrashRecord = {
      id:        `crash_${++this._idCounter}`,
      message,
      stack,
      module,
      severity,
      timestamp: now,
      count:     1,
    };

    this._records.push(record);
    if (this._records.length > MAX_RECORDS) this._records.splice(0, 1);

    // Log to console with severity
    const prefix = `[CrashManager][${severity.toUpperCase()}][${module}]`;
    if (severity === 'fatal' || severity === 'error') {
      console.error(prefix, message);
      if (stack) console.error(stack);
    } else if (severity === 'warning') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }

    // Emit low_memory for fatal (use as generic "app distress" signal)
    if (severity === 'fatal') {
      EventBus.emit('app:low_memory');
    }

    // Attempt recovery if registered
    this._tryRecover(module);
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  /** Register a recovery callback for a module. */
  registerRecovery(module: string, fn: RecoveryFn): () => void {
    this._recoveries.set(module, fn);
    return () => this._recoveries.delete(module);
  }

  private _tryRecover(module: string): void {
    const fn = this._recoveries.get(module);
    if (!fn) return;
    fn().catch(e => {
      console.warn(`[CrashManager] recovery for "${module}" failed:`, e?.message ?? e);
    });
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Last N error records. */
  getRecords(limit = 20): CrashRecord[] {
    return this._records.slice(-limit).reverse();
  }

  /** Clear error log. */
  clearRecords(): void {
    this._records.splice(0, this._records.length);
  }

  /** Summary for support/bug report. */
  getSummary(): string {
    const recent = this.getRecords(10);
    return recent.map(r =>
      `[${r.severity}][${r.module}] ${r.message} (×${r.count}) @${new Date(r.timestamp).toISOString()}`
    ).join('\n');
  }
}

export const CrashManager = new CrashManagerImpl();
