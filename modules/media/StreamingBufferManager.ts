/**
 * modules/media/StreamingBufferManager.ts — Streaming buffer lifecycle management
 *
 * Controls playback buffers for all video streams (feed, live, stories):
 *   - Adaptive buffer sizing based on network conditions
 *   - Pre-roll buffer management (fill before play)
 *   - Stall detection and recovery
 *   - Multi-stream buffer coordination (active + preloaded)
 *   - Memory-aware buffer eviction (release inactive buffers)
 *   - Power-aware buffer limits (reduce on battery saver)
 *
 * Buffer States:
 *   EMPTY:      no data buffered
 *   FILLING:    initial pre-roll in progress
 *   READY:      enough buffer to start playback
 *   PLAYING:    actively being consumed
 *   STALLED:    underrun — playback paused waiting for data
 *   DRAINING:   near end of content, no more segments
 *   RELEASED:   memory freed
 *
 * Usage:
 *   const buf = StreamingBufferManager.createBuffer(videoId, 'feed');
 *   buf.setPlaybackPosition(currentTimeMs);
 *   buf.onStall(() => showLoadingSpinner());
 *   buf.onReady(() => startPlayback());
 *   StreamingBufferManager.releaseBuffer(videoId);
 */

import { AppLifecycle }  from '../core/AppLifecycle';
import { EventBus }      from '../core/EventBus';

export type BufferState = 'empty' | 'filling' | 'ready' | 'playing' | 'stalled' | 'draining' | 'released';
export type StreamType  = 'feed' | 'live' | 'story' | 'call' | 'preview';

interface BufferConfig {
  preRollMs:         number;   // milliseconds of video to buffer before play
  maxBufferMs:       number;   // max buffer window ahead of playback
  stallThresholdMs:  number;   // trigger stall when remaining < this
  targetRebufferMs:  number;   // how much to fill after a stall
}

const DEFAULT_CONFIGS: Record<StreamType, BufferConfig> = {
  feed:    { preRollMs: 1_500, maxBufferMs: 10_000, stallThresholdMs: 300,   targetRebufferMs: 2_000 },
  live:    { preRollMs: 800,   maxBufferMs: 4_000,  stallThresholdMs: 200,   targetRebufferMs: 1_000 },
  story:   { preRollMs: 1_000, maxBufferMs: 6_000,  stallThresholdMs: 200,   targetRebufferMs: 1_500 },
  call:    { preRollMs: 400,   maxBufferMs: 2_000,  stallThresholdMs: 100,   targetRebufferMs: 500   },
  preview: { preRollMs: 500,   maxBufferMs: 3_000,  stallThresholdMs: 100,   targetRebufferMs: 800   },
};

// Buffer size multipliers per power tier
const POWER_MULTIPLIER: Record<string, number> = {
  performance: 1.0,
  balanced:    0.7,
  saver:       0.4,
  emergency:   0.2,
};

export interface StreamBuffer {
  videoId:          string;
  type:             StreamType;
  state:            BufferState;
  bufferedMs:       number;    // how much is buffered ahead
  playbackPosMs:    number;
  stallCount:       number;
  totalStallTimeMs: number;
  setPlaybackPosition: (posMs: number) => void;
  reportSegmentLoaded: (durationMs: number, loadTimeMs: number) => void;
  onReady:     (fn: () => void) => () => void;
  onStall:     (fn: () => void) => () => void;
  onRecovered: (fn: () => void) => () => void;
  onDraining:  (fn: () => void) => () => void;
  release:     () => void;
}

class StreamingBufferManagerImpl {
  private readonly _buffers = new Map<string, StreamBuffer>();
  private _powerTier = 'performance';

  constructor() {
    AppLifecycle.onBackground(() => this._releaseNonCriticalBuffers());
    EventBus.on('app:low_memory', () => this._emergencyRelease());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Create a buffer tracker for a video stream.
   * Does not allocate native memory — tracks JS-side buffer state.
   */
  createBuffer(videoId: string, type: StreamType): StreamBuffer {
    if (this._buffers.has(videoId)) {
      return this._buffers.get(videoId)!;
    }

    const multiplier = POWER_MULTIPLIER[this._powerTier] ?? 1;
    const baseConfig = DEFAULT_CONFIGS[type];
    const config: BufferConfig = {
      preRollMs:        baseConfig.preRollMs        * multiplier,
      maxBufferMs:      baseConfig.maxBufferMs       * multiplier,
      stallThresholdMs: baseConfig.stallThresholdMs,
      targetRebufferMs: baseConfig.targetRebufferMs * multiplier,
    };

    const readyHandlers     = new Set<() => void>();
    const stallHandlers     = new Set<() => void>();
    const recoveredHandlers = new Set<() => void>();
    const drainingHandlers  = new Set<() => void>();

    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const buffer: StreamBuffer = {
      videoId,
      type,
      state:            'empty',
      bufferedMs:       0,
      playbackPosMs:    0,
      stallCount:       0,
      totalStallTimeMs: 0,

      setPlaybackPosition: (posMs: number) => {
        const consumed = posMs - buffer.playbackPosMs;
        buffer.playbackPosMs = posMs;
        buffer.bufferedMs = Math.max(0, buffer.bufferedMs - consumed);
        buffer.state = 'playing';

        // Stall check
        if (buffer.bufferedMs < config.stallThresholdMs && buffer.state === 'playing') {
          buffer.state = 'stalled';
          buffer.stallCount++;
          const stallStart = Date.now();
          stallTimer = setTimeout(() => {
            buffer.totalStallTimeMs += Date.now() - stallStart;
          }, 0);
          for (const fn of stallHandlers) { try { fn(); } catch {} }
          console.warn(`[StreamBuffer] ${videoId} stalled (buffer: ${buffer.bufferedMs.toFixed(0)}ms)`);
        }
      },

      reportSegmentLoaded: (durationMs: number, loadTimeMs: number) => {
        buffer.bufferedMs += durationMs;
        const wasStalled = buffer.state === 'stalled' || buffer.state === 'filling' || buffer.state === 'empty';

        if (buffer.bufferedMs >= config.maxBufferMs) {
          buffer.bufferedMs = config.maxBufferMs; // cap
        }

        if (wasStalled && buffer.bufferedMs >= (buffer.state === 'empty' ? config.preRollMs : config.targetRebufferMs)) {
          const prev = buffer.state;
          buffer.state = 'ready';

          if (prev === 'stalled') {
            for (const fn of recoveredHandlers) { try { fn(); } catch {} }
            console.log(`[StreamBuffer] ${videoId} recovered (buffer: ${buffer.bufferedMs.toFixed(0)}ms)`);
          } else if (prev === 'empty' || prev === 'filling') {
            for (const fn of readyHandlers) { try { fn(); } catch {} }
            console.log(`[StreamBuffer] ${videoId} ready for playback`);
          }
        }
      },

      onReady:     (fn) => { readyHandlers.add(fn);     return () => readyHandlers.delete(fn); },
      onStall:     (fn) => { stallHandlers.add(fn);     return () => stallHandlers.delete(fn); },
      onRecovered: (fn) => { recoveredHandlers.add(fn); return () => recoveredHandlers.delete(fn); },
      onDraining:  (fn) => { drainingHandlers.add(fn);  return () => drainingHandlers.delete(fn); },

      release: () => {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
        readyHandlers.clear();
        stallHandlers.clear();
        recoveredHandlers.clear();
        drainingHandlers.clear();
        buffer.state = 'released';
        this._buffers.delete(videoId);
        console.log(`[StreamBuffer] ${videoId} released`);
      },
    };

    buffer.state = 'filling';
    this._buffers.set(videoId, buffer);
    return buffer;
  }

  releaseBuffer(videoId: string): void {
    this._buffers.get(videoId)?.release();
  }

  onPowerTierChange(tier: string): void {
    this._powerTier = tier;
    // Existing buffers keep their config; only new buffers use new multiplier
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get activeBufferCount(): number { return this._buffers.size; }

  getStats(): Array<{ videoId: string; type: StreamType; state: BufferState; bufferedMs: number; stallCount: number }> {
    return Array.from(this._buffers.values()).map(b => ({
      videoId:   b.videoId,
      type:      b.type,
      state:     b.state,
      bufferedMs: b.bufferedMs,
      stallCount: b.stallCount,
    }));
  }

  getTotalStallRate(): number {
    const all = Array.from(this._buffers.values());
    if (all.length === 0) return 0;
    const totalStalls = all.reduce((s, b) => s + b.stallCount, 0);
    return totalStalls / all.length;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _releaseNonCriticalBuffers(): void {
    for (const [id, buf] of this._buffers) {
      if (buf.type !== 'call' && buf.state !== 'playing') {
        buf.release();
        console.log(`[StreamBuffer] background cleanup: released ${id}`);
      }
    }
  }

  private _emergencyRelease(): void {
    console.warn('[StreamBuffer] emergency release — clearing all buffers');
    for (const buf of this._buffers.values()) {
      if (buf.type !== 'call') buf.release();
    }
  }
}

export const StreamingBufferManager = new StreamingBufferManagerImpl();
