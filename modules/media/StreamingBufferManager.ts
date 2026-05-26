/**
 * modules/media/StreamingBufferManager.ts — Streaming media buffer lifecycle
 *
 * Manages playback buffers for live streams and video feeds:
 *   - Buffer registration per stream session
 *   - Pre-roll detection (buffer enough before play)
 *   - Stall detection and recovery callbacks
 *   - Adaptive buffer size (network + power tier)
 *   - Buffer cleanup on unmount / background
 *   - Multi-stream buffer coordination (feed vs live vs story vs call)
 *
 * Usage:
 *   const buf = StreamingBufferManager.createBuffer('live', sessionId);
 *   buf.onStall(() => retryStream());
 *   buf.onReady(() => setPlaying(true));
 *   buf.destroy();
 */

import { PowerManager }   from '../core/PowerManager';
import { AppLifecycle }   from '../core/AppLifecycle';

export type StreamType = 'feed' | 'live' | 'story' | 'call';

export interface BufferConfig {
  preRollMs:    number;
  maxBufferMs:  number;
  stallTimeoutMs: number;
}

const BUFFER_CONFIGS: Record<StreamType, BufferConfig> = {
  feed:  { preRollMs: 2_000,  maxBufferMs: 30_000, stallTimeoutMs: 5_000  },
  live:  { preRollMs: 1_500,  maxBufferMs: 15_000, stallTimeoutMs: 3_000  },
  story: { preRollMs: 1_000,  maxBufferMs: 10_000, stallTimeoutMs: 4_000  },
  call:  { preRollMs: 500,    maxBufferMs: 5_000,  stallTimeoutMs: 2_000  },
};

const POWER_FACTOR: Record<string, number> = {
  performance: 1.0,
  balanced:    0.75,
  saver:       0.5,
  emergency:   0.25,
};

export interface StreamBuffer {
  id:          string;
  type:        StreamType;
  bufferedMs:  number;
  isReady:     boolean;
  isStalled:   boolean;
  onStall:     (cb: () => void) => void;
  onReady:     (cb: () => void) => void;
  onRecovery:  (cb: () => void) => void;
  addChunk:    (durationMs: number) => void;
  drain:       (durationMs: number) => void;
  destroy:     () => void;
}

class StreamBufferImpl implements StreamBuffer {
  readonly id:   string;
  readonly type: StreamType;

  bufferedMs  = 0;
  isReady     = false;
  isStalled   = false;

  private _stallCbs:    Set<() => void> = new Set();
  private _readyCbs:    Set<() => void> = new Set();
  private _recoveryCbs: Set<() => void> = new Set();
  private _stallTimer:  ReturnType<typeof setTimeout> | null = null;
  private _config:      BufferConfig;
  private _destroyed    = false;

  constructor(id: string, type: StreamType) {
    this.id   = id;
    this.type = type;

    const base   = BUFFER_CONFIGS[type];
    const factor = POWER_FACTOR[PowerManager.currentTier] ?? 1;
    this._config = {
      preRollMs:     base.preRollMs * factor,
      maxBufferMs:   base.maxBufferMs * factor,
      stallTimeoutMs: base.stallTimeoutMs,
    };
  }

  onStall(cb: () => void):    void { this._stallCbs.add(cb); }
  onReady(cb: () => void):    void { this._readyCbs.add(cb); }
  onRecovery(cb: () => void): void { this._recoveryCbs.add(cb); }

  addChunk(durationMs: number): void {
    if (this._destroyed) return;
    this.bufferedMs = Math.min(this.bufferedMs + durationMs, this._config.maxBufferMs);

    if (this.isStalled && this.bufferedMs >= this._config.preRollMs) {
      this.isStalled = false;
      this._clearStallTimer();
      for (const cb of this._recoveryCbs) cb();
    }

    if (!this.isReady && this.bufferedMs >= this._config.preRollMs) {
      this.isReady = true;
      for (const cb of this._readyCbs) cb();
    }
  }

  drain(durationMs: number): void {
    if (this._destroyed) return;
    this.bufferedMs = Math.max(0, this.bufferedMs - durationMs);

    if (this.isReady && this.bufferedMs <= 0) {
      this._startStallTimer();
    }
  }

  private _startStallTimer(): void {
    if (this._stallTimer) return;
    this._stallTimer = setTimeout(() => {
      if (this.bufferedMs <= 0) {
        this.isStalled = true;
        for (const cb of this._stallCbs) cb();
      }
    }, this._config.stallTimeoutMs);
  }

  private _clearStallTimer(): void {
    if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; }
  }

  destroy(): void {
    this._destroyed = true;
    this._clearStallTimer();
    this._stallCbs.clear();
    this._readyCbs.clear();
    this._recoveryCbs.clear();
    this.bufferedMs = 0;
  }
}

class StreamingBufferManagerImpl {
  private readonly _buffers = new Map<string, StreamBufferImpl>();

  constructor() {
    AppLifecycle.onBackground(() => {
      // Pause all non-call buffers on background
      for (const buf of this._buffers.values()) {
        if (buf.type !== 'call') buf.drain(buf.bufferedMs);
      }
    });
  }

  createBuffer(type: StreamType, sessionId: string): StreamBuffer {
    const id  = `${type}:${sessionId}`;
    const buf = new StreamBufferImpl(id, type);
    this._buffers.set(id, buf);
    return buf;
  }

  getBuffer(type: StreamType, sessionId: string): StreamBuffer | undefined {
    return this._buffers.get(`${type}:${sessionId}`);
  }

  destroyBuffer(type: StreamType, sessionId: string): void {
    const id  = `${type}:${sessionId}`;
    this._buffers.get(id)?.destroy();
    this._buffers.delete(id);
  }

  destroyAll(): void {
    for (const buf of this._buffers.values()) buf.destroy();
    this._buffers.clear();
  }

  get activeCount(): number { return this._buffers.size; }
}

export const StreamingBufferManager = new StreamingBufferManagerImpl();
