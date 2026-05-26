/**
 * modules/creator/timeline/TimelineController.ts — Video editing timeline
 *
 * Manages the multi-track editing timeline for Creator Studio:
 *   - Video track (primary capture or imported)
 *   - Audio track (original audio, music, voiceover)
 *   - Overlay track (text, stickers, graphics)
 *   - Effects track (LUT, AR effects, transitions)
 *
 * Timeline model:
 *   - Playhead position (current preview position, 0 → duration)
 *   - Clip segments (each with start/end/offset)
 *   - Layer order (z-index for overlays)
 *   - Keyframes (per-clip animation curves, future)
 *
 * Coordinates with:
 *   - EditorController (trim, speed ops → reflected in timeline)
 *   - RenderCompositor (bake exports from timeline state)
 *   - FiltersController (effect segments tied to time ranges)
 *   - TimerManager (playback timer for preview)
 */

import { TimerManager } from '../../gaming/TimerManager';
import { EventBus }     from '../../core/EventBus';

export type TrackType = 'video' | 'audio' | 'music' | 'overlay' | 'effects' | 'voiceover';

export interface TimelineClip {
  id:           string;
  trackType:    TrackType;
  startMs:      number;   // position on timeline
  endMs:        number;
  sourceOffset: number;   // offset within source file
  uri:          string;
  volume?:      number;   // audio tracks
  opacity?:     number;   // overlay tracks
  metadata?:    Record<string, any>;
}

export interface TimelineState {
  durationMs:   number;
  playheadMs:   number;
  isPlaying:    boolean;
  clips:        TimelineClip[];
  selectedClipId: string | null;
  zoomLevel:    number;     // 1.0 = full timeline, 0.5 = zoomed in 2×
  isDirty:      boolean;
}

class TimelineControllerImpl {
  private _state: TimelineState = {
    durationMs:    0,
    playheadMs:    0,
    isPlaying:     false,
    clips:         [],
    selectedClipId: null,
    zoomLevel:     1.0,
    isDirty:       false,
  };

  private _playTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _subs = new Set<(s: TimelineState) => void>();

  // ── Initialization ────────────────────────────────────────────────────────

  initialize(videoDurationMs: number, videoUri: string): void {
    this._state = {
      durationMs:    videoDurationMs,
      playheadMs:    0,
      isPlaying:     false,
      clips:         [
        {
          id:           'video_main',
          trackType:    'video',
          startMs:      0,
          endMs:        videoDurationMs,
          sourceOffset: 0,
          uri:          videoUri,
        },
      ],
      selectedClipId: null,
      zoomLevel:     1.0,
      isDirty:       false,
    };
    this._notify();
    console.log(`[TimelineController] initialized — duration: ${videoDurationMs}ms`);
  }

  reset(): void {
    this.pause();
    this._state = { ...this._state, clips: [], playheadMs: 0, isDirty: false, isPlaying: false };
    this._notify();
  }

  // ── Playhead ──────────────────────────────────────────────────────────────

  seek(ms: number): void {
    this._patch({ playheadMs: Math.max(0, Math.min(ms, this._state.durationMs)) });
  }

  play(): void {
    if (this._state.isPlaying) return;
    this._patch({ isPlaying: true });
    this._playTimer = setInterval(() => {
      const next = this._state.playheadMs + 100;
      if (next >= this._state.durationMs) {
        this.pause();
        this.seek(0);
      } else {
        this.seek(next);
      }
    }, 100);
  }

  pause(): void {
    if (!this._state.isPlaying) return;
    if (this._playTimer) { clearInterval(this._playTimer); this._playTimer = null; }
    this._patch({ isPlaying: false });
  }

  togglePlay(): void {
    this._state.isPlaying ? this.pause() : this.play();
  }

  // ── Clips ─────────────────────────────────────────────────────────────────

  addClip(clip: Omit<TimelineClip, 'id'>): string {
    const id = `clip_${Date.now()}`;
    const newClip = { ...clip, id };
    const maxEnd  = Math.max(this._state.durationMs, clip.endMs);
    this._patch({ clips: [...this._state.clips, newClip], durationMs: maxEnd, isDirty: true });
    return id;
  }

  removeClip(id: string): void {
    const clips = this._state.clips.filter(c => c.id !== id);
    this._patch({ clips, isDirty: true });
  }

  updateClip(id: string, patch: Partial<TimelineClip>): void {
    const clips = this._state.clips.map(c => c.id === id ? { ...c, ...patch } : c);
    this._patch({ clips, isDirty: true });
  }

  selectClip(id: string | null): void {
    this._patch({ selectedClipId: id });
  }

  // ── Trim ──────────────────────────────────────────────────────────────────

  trimMainVideo(startMs: number, endMs: number): void {
    const main = this._state.clips.find(c => c.id === 'video_main');
    if (main) {
      this.updateClip('video_main', { startMs, endMs });
      this._patch({ durationMs: endMs - startMs });
    }
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────

  setZoom(level: number): void {
    this._patch({ zoomLevel: Math.max(0.1, Math.min(4.0, level)) });
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get state():       TimelineState  { return this._state; }
  get playheadMs():  number         { return this._state.playheadMs; }
  get isPlaying():   boolean        { return this._state.isPlaying; }
  get durationMs():  number         { return this._state.durationMs; }
  get selectedClip(): TimelineClip | null {
    return this._state.clips.find(c => c.id === this._state.selectedClipId) ?? null;
  }

  getClipsByTrack(track: TrackType): TimelineClip[] {
    return this._state.clips.filter(c => c.trackType === track);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /** Export timeline state as a flat edit list for RenderCompositor. */
  exportEditList(): TimelineClip[] {
    return [...this._state.clips].sort((a, b) => a.startMs - b.startMs);
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
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const TimelineController = new TimelineControllerImpl();
