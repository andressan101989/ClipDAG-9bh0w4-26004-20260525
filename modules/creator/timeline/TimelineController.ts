/**
 * modules/creator/timeline/TimelineController.ts — Stabilized timeline engine
 *
 * Production improvements:
 *   - Playhead uses requestAnimationFrame-style setInterval (100ms ticks)
 *     with elapsed-time correction to avoid drift on slow frames
 *   - addClip / removeClip / updateClip are pure operations (no side effects)
 *   - trimMainVideo recalculates total duration from all video clips
 *   - Zoom level drives UI width multiplier — exposed for scrollable timeline
 *   - exportEditList() returns sorted, validated clips (skips zero-duration)
 *   - Snapshot: serialize/deserialize for autosave to AsyncStorage
 *   - All notify calls are synchronous (no async callback loops)
 */

import { EventBus } from '../../core/EventBus';

export type TrackType = 'video' | 'audio' | 'music' | 'overlay' | 'effects' | 'voiceover';

export interface TimelineClip {
  id:           string;
  trackType:    TrackType;
  startMs:      number;
  endMs:        number;
  sourceOffset: number;
  uri:          string;
  volume?:      number;
  opacity?:     number;
  metadata?:    Record<string, any>;
}

export interface TimelineState {
  durationMs:     number;
  playheadMs:     number;
  isPlaying:      boolean;
  clips:          TimelineClip[];
  selectedClipId: string | null;
  zoomLevel:      number;
  isDirty:        boolean;
}

const PLAYBACK_TICK_MS = 100;

class TimelineControllerImpl {
  private _state: TimelineState = {
    durationMs:     0,
    playheadMs:     0,
    isPlaying:      false,
    clips:          [],
    selectedClipId: null,
    zoomLevel:      1.0,
    isDirty:        false,
  };

  private _playTimer:   ReturnType<typeof setInterval> | null = null;
  private _lastTickAt:  number = 0;
  private readonly _subs = new Set<(s: TimelineState) => void>();

  // ── Init / Reset ──────────────────────────────────────────────────────────

  initialize(videoDurationMs: number, videoUri: string): void {
    this.pause();
    this._state = {
      durationMs:     videoDurationMs,
      playheadMs:     0,
      isPlaying:      false,
      clips:          [{
        id:           'video_main',
        trackType:    'video',
        startMs:      0,
        endMs:        videoDurationMs,
        sourceOffset: 0,
        uri:          videoUri,
      }],
      selectedClipId: null,
      zoomLevel:      1.0,
      isDirty:        false,
    };
    this._notify();
    console.log('[TimelineController] initialized — duration:', videoDurationMs + 'ms');
  }

  reset(): void {
    this.pause();
    this._state = {
      ...this._state,
      clips:          [],
      playheadMs:     0,
      isDirty:        false,
      isPlaying:      false,
      durationMs:     0,
      selectedClipId: null,
    };
    this._notify();
  }

  // ── Playhead ──────────────────────────────────────────────────────────────

  seek(ms: number): void {
    const clamped = Math.max(0, Math.min(ms, this._state.durationMs));
    if (Math.abs(clamped - this._state.playheadMs) < 1) return; // no-op
    this._patch({ playheadMs: clamped });
  }

  play(): void {
    if (this._state.isPlaying) return;
    this._lastTickAt = Date.now();
    this._patch({ isPlaying: true });

    this._playTimer = setInterval(() => {
      const now     = Date.now();
      const elapsed = now - this._lastTickAt;
      this._lastTickAt = now;

      const next = this._state.playheadMs + elapsed;
      if (next >= this._state.durationMs) {
        this.pause();
        this.seek(0);
      } else {
        // Direct patch without triggering isDirty
        this._state = { ...this._state, playheadMs: next };
        this._notify();
      }
    }, PLAYBACK_TICK_MS);
  }

  pause(): void {
    if (!this._state.isPlaying && !this._playTimer) return;
    if (this._playTimer) { clearInterval(this._playTimer); this._playTimer = null; }
    this._patch({ isPlaying: false });
  }

  togglePlay(): void {
    this._state.isPlaying ? this.pause() : this.play();
  }

  // ── Clips ─────────────────────────────────────────────────────────────────

  addClip(clip: Omit<TimelineClip, 'id'>): string {
    const id      = `clip_${Date.now()}`;
    const newClip = { ...clip, id };
    const newDur  = Math.max(this._state.durationMs, clip.endMs);
    this._patch({ clips: [...this._state.clips, newClip], durationMs: newDur, isDirty: true });
    return id;
  }

  removeClip(id: string): void {
    const clips   = this._state.clips.filter(c => c.id !== id);
    const newDur  = this._recalcDuration(clips);
    this._patch({ clips, durationMs: newDur, isDirty: true });
  }

  updateClip(id: string, patch: Partial<TimelineClip>): void {
    const clips  = this._state.clips.map(c => c.id === id ? { ...c, ...patch } : c);
    const newDur = this._recalcDuration(clips);
    this._patch({ clips, durationMs: newDur, isDirty: true });
  }

  selectClip(id: string | null): void {
    this._patch({ selectedClipId: id });
  }

  // ── Trim ──────────────────────────────────────────────────────────────────

  trimMainVideo(startMs: number, endMs: number): void {
    const main = this._state.clips.find(c => c.id === 'video_main');
    if (!main) return;
    const clampedStart = Math.max(0, startMs);
    const clampedEnd   = Math.min(main.endMs, endMs);
    if (clampedStart >= clampedEnd) return;

    const updated = this._state.clips.map(c =>
      c.id === 'video_main' ? { ...c, startMs: clampedStart, endMs: clampedEnd } : c,
    );
    const newDur = this._recalcDuration(updated);
    this._patch({ clips: updated, durationMs: newDur, isDirty: true });

    // Constrain playhead within new range
    if (this._state.playheadMs < clampedStart) this.seek(clampedStart);
    if (this._state.playheadMs > clampedEnd)   this.seek(clampedEnd);
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────

  setZoom(level: number): void {
    this._patch({ zoomLevel: Math.max(0.1, Math.min(8.0, level)) });
  }

  /** Pixel-per-millisecond for UI rendering at current zoom. */
  get pixelsPerMs(): number {
    // Base: 100ms = 8px at zoom 1.0 → 0.08 px/ms
    return 0.08 * this._state.zoomLevel;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get state():       TimelineState { return this._state; }
  get playheadMs():  number        { return this._state.playheadMs; }
  get isPlaying():   boolean       { return this._state.isPlaying; }
  get durationMs():  number        { return this._state.durationMs; }
  get selectedClip(): TimelineClip | null {
    return this._state.clips.find(c => c.id === this._state.selectedClipId) ?? null;
  }

  getClipsByTrack(track: TrackType): TimelineClip[] {
    return this._state.clips.filter(c => c.trackType === track);
  }

  // ── Snapshot (serialization for autosave) ─────────────────────────────────

  serialize(): string {
    return JSON.stringify(this._state);
  }

  deserialize(json: string): boolean {
    try {
      const parsed: TimelineState = JSON.parse(json);
      this.pause();
      this._state = { ...parsed, isPlaying: false };
      this._notify();
      return true;
    } catch {
      return false;
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  exportEditList(): TimelineClip[] {
    return [...this._state.clips]
      .filter(c => (c.endMs - c.startMs) > 0)  // skip zero-duration
      .sort((a, b) => a.startMs - b.startMs);
  }

  /** Export for use with ExportManager / ffmpegService.exportFinal() */
  toExportClips(): Array<{ uri: string; trimStart: number; trimEnd: number; durationMs: number }> {
    return this.getClipsByTrack('video').map(c => {
      const dur     = c.endMs - c.startMs;
      return {
        uri:        c.uri,
        trimStart:  c.startMs / (c.endMs > 0 ? c.endMs : 1),
        trimEnd:    1.0,
        durationMs: dur,
      };
    });
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: (s: TimelineState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _patch(patch: Partial<TimelineState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  private _notify(): void {
    for (const fn of this._subs) { try { fn(this._state); } catch { /* isolate */ } }
  }

  private _recalcDuration(clips: TimelineClip[]): number {
    const videoClips = clips.filter(c => c.trackType === 'video');
    if (videoClips.length === 0) return 0;
    return Math.max(...videoClips.map(c => c.endMs));
  }
}

export const TimelineController = new TimelineControllerImpl();
