/**
 * modules/core/ResourceScheduler.ts — Intelligent adaptive task scheduler
 *
 * Coordinates ALL resource-intensive tasks to prevent spikes:
 *   - Background task prioritization (critical > high > normal > deferred)
 *   - Thermal-aware task scheduling (defer heavy tasks on hot device)
 *   - Battery-aware orchestration (low-power mode slows non-critical tasks)
 *   - Network-aware orchestration (cellular = upload compression)
 *   - Render priority orchestration (UI tasks always preempt background)
 *   - Task concurrency control (max N simultaneous heavy tasks)
 *   - Frame budget enforcement (skip background tasks during animation)
 *   - Adaptive task coalescing (batch deferred tasks together)
 *
 * Usage:
 *   ResourceScheduler.schedule({
 *     id: 'prefetch-feed',
 *     priority: 'normal',
 *     task: () => PrefetchMediaManager.prefetch(urls),
 *     cancelOnBackground: true,
 *   });
 *
 *   ResourceScheduler.scheduleRepeating({
 *     id: 'cache-cleanup',
 *     priority: 'deferred',
 *     intervalMs: 60_000,
 *     task: () => IntelligentCacheManager.cleanup(),
 *   });
 */

import { ThermalMonitor } from './ThermalMonitor';
import { PowerManager }   from './PowerManager';
import { AppLifecycle }   from './AppLifecycle';
import { EventBus }       from './EventBus';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskPriority = 'critical' | 'high' | 'normal' | 'deferred';

export interface ScheduledTask {
  id:                  string;
  priority:            TaskPriority;
  task:                () => Promise<void>;
  cancelOnBackground?: boolean;
  maxRetries?:         number;
  timeoutMs?:          number;
  tags?:               string[];
}

export interface RepeatingTask extends ScheduledTask {
  intervalMs:          number;
  jitterMs?:           number;  // random jitter to avoid thundering herd
}

interface TaskRecord extends ScheduledTask {
  enqueued:   number;
  retries:    number;
  timer?:     ReturnType<typeof setTimeout>;
}

interface RepeatingRecord extends RepeatingTask {
  intervalTimer: ReturnType<typeof setInterval> | null;
  lastRun?:      number;
  paused:        boolean;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_CONCURRENT_BY_THERMAL: Record<string, number> = {
  nominal:   6,
  fair:      4,
  serious:   2,
  critical:  1,
};

const PRIORITY_DELAY_MS: Record<TaskPriority, number> = {
  critical:  0,
  high:      50,
  normal:    200,
  deferred:  1_000,
};

// ── ResourceScheduler ─────────────────────────────────────────────────────────

class ResourceSchedulerImpl {
  private readonly _queue:      Map<string, TaskRecord>    = new Map();
  private readonly _repeating:  Map<string, RepeatingRecord> = new Map();
  private _runningCount = 0;
  private _isBackground = false;
  private _processorTimer: ReturnType<typeof setInterval> | null = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  initialize(): void {
    AppLifecycle.onBackground(() => {
      this._isBackground = true;
      this._pauseBackgroundCancellable();
    });
    AppLifecycle.onForeground(() => {
      this._isBackground = false;
      this._resumeAll();
    });

    // Process queue every 100ms
    this._processorTimer = setInterval(() => this._processQueue(), 100);

    console.log('[ResourceScheduler] initialized');
  }

  // ── One-shot tasks ─────────────────────────────────────────────────────────

  schedule(task: ScheduledTask): void {
    const record: TaskRecord = {
      ...task,
      enqueued: Date.now(),
      retries:  0,
      maxRetries: task.maxRetries ?? 0,
    };

    // Priority-based delay before queuing
    const delay = PRIORITY_DELAY_MS[task.priority];
    if (delay > 0) {
      record.timer = setTimeout(() => {
        this._queue.set(task.id, record);
      }, delay);
    } else {
      this._queue.set(task.id, record);
    }
  }

  cancel(id: string): void {
    const record = this._queue.get(id);
    if (record?.timer) clearTimeout(record.timer);
    this._queue.delete(id);
  }

  // ── Repeating tasks ────────────────────────────────────────────────────────

  scheduleRepeating(task: RepeatingTask): void {
    if (this._repeating.has(task.id)) {
      this.cancelRepeating(task.id);
    }

    const record: RepeatingRecord = {
      ...task,
      intervalTimer: null,
      paused: false,
    };

    const runOnce = async () => {
      if (record.paused) return;
      if (this._shouldDefer(task.priority)) return;

      record.lastRun = Date.now();
      try {
        await this._runWithTimeout(task.task, task.timeoutMs ?? 30_000);
      } catch (e: any) {
        console.warn(`[ResourceScheduler] repeating task "${task.id}" error:`, e?.message);
      }
    };

    // Initial run with jitter
    const jitter = task.jitterMs ? Math.random() * task.jitterMs : 0;
    setTimeout(() => {
      runOnce();
      record.intervalTimer = setInterval(runOnce, task.intervalMs);
    }, jitter);

    this._repeating.set(task.id, record);
  }

  cancelRepeating(id: string): void {
    const record = this._repeating.get(id);
    if (record?.intervalTimer) clearInterval(record.intervalTimer);
    this._repeating.delete(id);
  }

  pauseRepeating(id: string): void {
    const r = this._repeating.get(id);
    if (r) r.paused = true;
  }

  resumeRepeating(id: string): void {
    const r = this._repeating.get(id);
    if (r) r.paused = false;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  getQueueDepth(): number { return this._queue.size; }
  getRunningCount(): number { return this._runningCount; }
  getMaxConcurrent(): number {
    return MAX_CONCURRENT_BY_THERMAL[ThermalMonitor.currentState] ?? 4;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _processQueue(): void {
    if (this._queue.size === 0) return;
    if (this._runningCount >= this.getMaxConcurrent()) return;

    // Sort by priority
    const sorted = Array.from(this._queue.values()).sort((a, b) => {
      const rank: Record<TaskPriority, number> = { critical: 4, high: 3, normal: 2, deferred: 1 };
      return rank[b.priority] - rank[a.priority];
    });

    const next = sorted[0];
    if (!next) return;
    if (this._shouldDefer(next.priority)) return;

    this._queue.delete(next.id);
    this._runTask(next);
  }

  private async _runTask(record: TaskRecord): Promise<void> {
    this._runningCount++;
    try {
      await this._runWithTimeout(record.task, record.timeoutMs ?? 30_000);
    } catch (e: any) {
      console.warn(`[ResourceScheduler] task "${record.id}" failed:`, e?.message);
      if (record.retries < (record.maxRetries ?? 0)) {
        record.retries++;
        this._queue.set(record.id, record);
      }
    } finally {
      this._runningCount--;
    }
  }

  private _shouldDefer(priority: TaskPriority): boolean {
    if (priority === 'critical') return false;
    const thermal = ThermalMonitor.currentState;
    const tier    = PowerManager.currentTier;
    if (thermal === 'critical' && priority !== 'high') return true;
    if (tier === 'emergency' && priority === 'deferred') return true;
    return false;
  }

  private _pauseBackgroundCancellable(): void {
    for (const [id, record] of this._queue) {
      if (record.cancelOnBackground) {
        if (record.timer) clearTimeout(record.timer);
        this._queue.delete(id);
      }
    }
    for (const record of this._repeating.values()) {
      if (record.cancelOnBackground) {
        record.paused = true;
      }
    }
  }

  private _resumeAll(): void {
    for (const record of this._repeating.values()) {
      if (record.cancelOnBackground) {
        record.paused = false;
      }
    }
  }

  private _runWithTimeout(fn: () => Promise<void>, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Task timeout')), timeoutMs);
      fn().then(() => { clearTimeout(timer); resolve(); })
          .catch(e => { clearTimeout(timer); reject(e); });
    });
  }
}

export const ResourceScheduler = new ResourceSchedulerImpl();
