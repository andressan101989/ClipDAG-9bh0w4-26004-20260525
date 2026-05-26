/**
 * modules/creator/editor/EditorController.ts — Post-capture video editor
 *
 * Manages the editing pipeline after a video is captured:
 *   - Trim (start/end point selection)
 *   - Crop (aspect ratio and region)
 *   - Text overlays (position, font, animation)
 *   - Sticker overlays (position, scale, rotation)
 *   - LUT color grading
 *   - Speed adjustment (0.5x, 1x, 2x, 3x)
 *   - Audio ducking (reduce music when voice detected)
 *   - Undo/redo stack (max 50 operations)
 *
 * Edit operations are non-destructive: recorded as a transform list,
 * applied to a preview render, and baked only on export.
 *
 * Coordinates with:
 *   - DraftManager: save/restore edit state
 *   - RenderCompositor: bake final output (heavy — runs async)
 *   - MediaStore: track editor state
 *   - ResourceManager: gpu_filter lease during preview
 *
 * CURRENT STATE: Architecture + types ready. FFmpeg baking TODO.
 */

import { EventBus }       from '../../core/EventBus';
import { ResourceManager } from '../../core/ResourceManager';

export type EditOpType =
  | 'trim'
  | 'crop'
  | 'text'
  | 'sticker'
  | 'lut'
  | 'speed'
  | 'audio_volume'
  | 'audio_duck';

export interface TextOverlay {
  id:        string;
  text:      string;
  x:         number;   // 0.0–1.0 normalized
  y:         number;
  fontSize:  number;
  color:     string;
  fontFamily: string;
  animation: 'none' | 'fade' | 'pop' | 'slide';
  startMs:   number;
  endMs:     number;
}

export interface StickerOverlay {
  id:     string;
  uri:    string;
  x:      number;
  y:      number;
  scale:  number;
  rotation: number;
  startMs: number;
  endMs:   number;
}

export interface EditOperation {
  id:        string;
  type:      EditOpType;
  appliedAt: number;
  params:    Record<string, any>;
}

export interface EditorState {
  sourceUri:       string;
  durationMs:      number;
  trimStartMs:     number;
  trimEndMs:       number;
  cropX:           number;
  cropY:           number;
  cropW:           number;
  cropH:           number;
  speed:           number;     // 1.0 = normal
  musicVolume:     number;     // 0.0–1.0
  voiceVolume:     number;
  lutId:           string | null;
  textOverlays:    TextOverlay[];
  stickerOverlays: StickerOverlay[];
  isDirty:         boolean;    // unsaved changes
}

class EditorControllerImpl {
  private _state:   EditorState | null = null;
  private _history: EditOperation[]    = [];
  private _redoStack: EditOperation[]  = [];
  private _release: (() => Promise<void>) | null = null;
  private readonly _subs = new Set<(s: EditorState) => void>();

  get isOpen(): boolean  { return this._state !== null; }
  get state(): EditorState | null { return this._state; }
  get canUndo(): boolean { return this._history.length > 0; }
  get canRedo(): boolean { return this._redoStack.length > 0; }

  // ── Session ───────────────────────────────────────────────────────────────

  async open(sourceUri: string, durationMs: number): Promise<void> {
    this._release = await ResourceManager.acquire('render_compositor', 'editor');

    this._state = {
      sourceUri,
      durationMs,
      trimStartMs:     0,
      trimEndMs:       durationMs,
      cropX: 0, cropY: 0, cropW: 1, cropH: 1,
      speed:           1.0,
      musicVolume:     0.8,
      voiceVolume:     1.0,
      lutId:           null,
      textOverlays:    [],
      stickerOverlays: [],
      isDirty:         false,
    };

    this._history   = [];
    this._redoStack = [];
    console.log('[EditorController] opened:', sourceUri);
    this._notify();
  }

  async close(): Promise<void> {
    await this._release?.();
    this._release = null;
    this._state   = null;
    this._history = [];
    this._redoStack = [];
    this._notify();
  }

  // ── Operations ────────────────────────────────────────────────────────────

  trim(startMs: number, endMs: number): void {
    this._apply({ type: 'trim', params: { startMs, endMs } });
    this._patch({ trimStartMs: startMs, trimEndMs: endMs });
  }

  crop(x: number, y: number, w: number, h: number): void {
    this._apply({ type: 'crop', params: { x, y, w, h } });
    this._patch({ cropX: x, cropY: y, cropW: w, cropH: h });
  }

  setSpeed(speed: number): void {
    const s = Math.max(0.1, Math.min(4.0, speed));
    this._apply({ type: 'speed', params: { speed: s } });
    this._patch({ speed: s });
  }

  setLUT(lutId: string | null): void {
    this._apply({ type: 'lut', params: { lutId } });
    this._patch({ lutId });
  }

  addText(overlay: Omit<TextOverlay, 'id'>): string {
    const id = `text_${Date.now()}`;
    const newOverlay = { ...overlay, id };
    this._apply({ type: 'text', params: { overlay: newOverlay, op: 'add' } });
    this._patch({ textOverlays: [...(this._state?.textOverlays ?? []), newOverlay] });
    return id;
  }

  removeText(id: string): void {
    this._apply({ type: 'text', params: { id, op: 'remove' } });
    this._patch({ textOverlays: this._state?.textOverlays.filter(t => t.id !== id) ?? [] });
  }

  addSticker(overlay: Omit<StickerOverlay, 'id'>): string {
    const id = `sticker_${Date.now()}`;
    const newOverlay = { ...overlay, id };
    this._apply({ type: 'sticker', params: { overlay: newOverlay, op: 'add' } });
    this._patch({ stickerOverlays: [...(this._state?.stickerOverlays ?? []), newOverlay] });
    return id;
  }

  setAudioVolume(musicVolume: number, voiceVolume: number): void {
    this._apply({ type: 'audio_volume', params: { musicVolume, voiceVolume } });
    this._patch({ musicVolume, voiceVolume });
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  undo(): void {
    const op = this._history.pop();
    if (!op) return;
    this._redoStack.push(op);
    console.log('[EditorController] undo:', op.type);
    // TODO: replay from scratch for true undo (complex — snapshot-based for now)
    this._notify();
  }

  redo(): void {
    const op = this._redoStack.pop();
    if (!op) return;
    this._history.push(op);
    console.log('[EditorController] redo:', op.type);
    this._notify();
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: (s: EditorState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _apply(op: Omit<EditOperation, 'id' | 'appliedAt'>): void {
    const record: EditOperation = { ...op, id: `op_${Date.now()}`, appliedAt: Date.now() };
    this._history.push(record);
    this._redoStack = [];  // clear redo on new op
    if (this._history.length > 50) this._history.shift();
  }

  private _patch(patch: Partial<EditorState>): void {
    if (!this._state) return;
    this._state = { ...this._state, ...patch, isDirty: true };
    this._notify();
  }

  private _notify(): void {
    if (!this._state) return;
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const EditorController = new EditorControllerImpl();
