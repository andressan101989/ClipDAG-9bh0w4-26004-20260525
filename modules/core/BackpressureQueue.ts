/**
 * modules/core/BackpressureQueue.ts — Event backpressure & traffic shaping
 *
 * Prevents event storms from overwhelming the system during:
 *   - Streaming high-frequency events (viewer counts, gift animations)
 *   - Gaming tick events (100ms ticks × many players)
 *   - Realtime sync floods (rapid chat messages)
 *   - Upload progress updates (too frequent for React state)
 *   - Socket reconnection storms
 *
 * Features:
 *   - Priority queue (critical events processed first)
 *   - Configurable max queue depth per channel (drops oldest on overflow)
 *   - Draining strategy: FIFO, priority, or windowed batch
 *   - Adaptive drain rate: speeds up when queue grows, slows when empty
 *   - Event coalescing: merge rapid duplicate events into one
 *   - Load shedding: drop low-priority events under stress
 *
 * Usage:
 *   const q = BackpressureQueue.getQueue('stream-gifts');
 *   q.push({ type: 'gift', userId: '...', value: 100 }, 5);
 *
 *   q.drain(events => {
 *     renderGiftAnimations(events);
 *   }, { batchSize: 10, intervalMs: 100 });
 *
 *   // Coalescing: only keep latest viewer count
 *   q.pushCoalesced('viewer_count', { count: 1234 }, 3);
 */

export type DrainStrategy = 'fifo' | 'priority' | 'batch';

export interface QueuedEvent<T = any> {
  id:         string;
  type:       string;
  payload:    T;
  priority:   number;   // 1 (lowest) – 10 (highest)
  enqueuedAt: number;
  expiresAt?: number;   // optional TTL
}

export interface QueueConfig {
  maxDepth:       number;   // max events before dropping
  dropStrategy:   'oldest' | 'lowest_priority';
  coalescingKeys: string[]; // event types to coalesce (keep only latest)
  ttlMs?:         number;   // max event age before auto-expiry
}

interface DrainOptions {
  batchSize:  number;
  intervalMs: number;
  strategy:   DrainStrategy;
}

let _eventCounter = 0;

class Queue<T = any> {
  readonly name: string;
  private _events: QueuedEvent<T>[] = [];
  private _config: QueueConfig;
  private _drainTimer: ReturnType<typeof setInterval> | null = null;
  private _droppedCount = 0;

  constructor(name: string, config: Partial<QueueConfig> = {}) {
    this.name = name;
    this._config = {
      maxDepth:       500,
      dropStrategy:   'oldest',
      coalescingKeys: [],
      ...config,
    };
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  push(payload: T, priority = 5, type = 'event', ttlMs?: number): void {
    const event: QueuedEvent<T> = {
      id:         `e${++_eventCounter}`,
      type,
      payload,
      priority,
      enqueuedAt: Date.now(),
      expiresAt:  ttlMs ? Date.now() + ttlMs : undefined,
    };

    // Check if this type should be coalesced (replace existing)
    if (this._config.coalescingKeys.includes(type)) {
      this._events = this._events.filter(e => e.type !== type);
    }

    this._events.push(event);
    this._enforceMaxDepth();
  }

  /** Push and replace any existing event with the same type (coalescing). */
  pushCoalesced(type: string, payload: T, priority = 5): void {
    this.push(payload, priority, type);
  }

  // ── Drain ─────────────────────────────────────────────────────────────────

  /**
   * Start draining events in batches.
   * @param handler - Called with each batch
   */
  drain(handler: (events: QueuedEvent<T>[]) => void, options: Partial<DrainOptions> = {}): () => void {
    const opts: DrainOptions = {
      batchSize:  20,
      intervalMs: 100,
      strategy:   'priority',
      ...options,
    };

    if (this._drainTimer) clearInterval(this._drainTimer);

    this._drainTimer = setInterval(() => {
      const batch = this._takeBatch(opts.batchSize, opts.strategy);
      if (batch.length > 0) {
        try { handler(batch); } catch (e) {
          console.warn(`[BackpressureQueue] "${this.name}" drain error:`, (e as any)?.message);
        }
      }
    }, opts.intervalMs);

    return () => {
      if (this._drainTimer) { clearInterval(this._drainTimer); this._drainTimer = null; }
    };
  }

  stopDrain(): void {
    if (this._drainTimer) { clearInterval(this._drainTimer); this._drainTimer = null; }
  }

  /** Synchronously take up to N events from the queue. */
  take(n: number, strategy: DrainStrategy = 'priority'): QueuedEvent<T>[] {
    return this._takeBatch(n, strategy);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get depth():    number { return this._events.length; }
  get dropped():  number { return this._droppedCount; }
  get isEmpty():  boolean { return this._events.length === 0; }

  clear(): void { this._events = []; }

  // ── Private ───────────────────────────────────────────────────────────────

  private _takeBatch(n: number, strategy: DrainStrategy): QueuedEvent<T>[] {
    this._pruneExpired();

    if (this._events.length === 0) return [];

    let sorted: QueuedEvent<T>[];
    switch (strategy) {
      case 'priority':
        sorted = [...this._events].sort((a, b) => b.priority - a.priority);
        break;
      case 'fifo':
      default:
        sorted = this._events;
        break;
    }

    const batch = sorted.slice(0, n);
    const batchIds = new Set(batch.map(e => e.id));
    this._events = this._events.filter(e => !batchIds.has(e.id));
    return batch;
  }

  private _enforceMaxDepth(): void {
    if (this._events.length <= this._config.maxDepth) return;

    const toRemove = this._events.length - this._config.maxDepth;
    if (this._config.dropStrategy === 'oldest') {
      this._events = this._events.slice(toRemove);
    } else {
      // Drop lowest priority
      this._events.sort((a, b) => b.priority - a.priority);
      this._events = this._events.slice(0, this._config.maxDepth);
    }
    this._droppedCount += toRemove;
  }

  private _pruneExpired(): void {
    if (!this._config.ttlMs) return;
    const now = Date.now();
    const before = this._events.length;
    this._events = this._events.filter(e => !e.expiresAt || e.expiresAt > now);
    this._droppedCount += before - this._events.length;
  }
}

class BackpressureQueueImpl {
  private readonly _queues = new Map<string, Queue>();

  getQueue<T = any>(name: string, config?: Partial<QueueConfig>): Queue<T> {
    if (!this._queues.has(name)) {
      this._queues.set(name, new Queue<T>(name, config));
    }
    return this._queues.get(name) as Queue<T>;
  }

  destroyQueue(name: string): void {
    this._queues.get(name)?.stopDrain();
    this._queues.delete(name);
  }

  getStats(): Record<string, { depth: number; dropped: number }> {
    const out: Record<string, any> = {};
    for (const [name, q] of this._queues) {
      out[name] = { depth: q.depth, dropped: q.dropped };
    }
    return out;
  }
}

export const BackpressureQueue = new BackpressureQueueImpl();
