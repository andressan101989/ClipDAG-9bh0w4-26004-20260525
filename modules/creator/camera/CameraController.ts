/**
 * modules/creator/camera/CameraController.ts — Camera lifecycle manager
 *
 * Controls exclusive camera access via ResourceManager.
 * Owns camera state (facing, zoom, flash, resolution).
 * Drives MediaStore.recording state.
 *
 * Separation of concerns:
 *   - CameraController: state + lifecycle logic
 *   - CameraCore.tsx:   rendering surface (consumes CameraController state)
 *   - DeepAR:           texture pipeline (controlled by EffectsController)
 */

import { ResourceManager }  from '../../core/ResourceManager';
import { MemoryPressureMonitor } from '../../core/MemoryPressureMonitor';
import { EventBus }         from '../../core/EventBus';
import { MediaStore }       from '@/store/media.store';

export type CameraFacing   = 'front' | 'back';
export type FlashMode      = 'off' | 'on' | 'auto' | 'torch';
export type RecordQuality  = '480p' | '720p' | '1080p' | '4k';

export interface CameraConfig {
  facing:    CameraFacing;
  flash:     FlashMode;
  zoom:      number;      // 0.0 – 1.0
  quality:   RecordQuality;
  fps:       20 | 30 | 60;
  enableAR:  boolean;
}

const DEFAULT_CONFIG: CameraConfig = {
  facing:   'front',
  flash:    'off',
  zoom:     0,
  quality:  '720p',
  fps:      30,
  enableAR: false,
};

class CameraControllerImpl {
  private _config: CameraConfig = { ...DEFAULT_CONFIG };
  private _isActive = false;
  private _release: (() => void) | null = null;
  private readonly _subs = new Set<(c: CameraConfig) => void>();

  get config():   CameraConfig { return this._config; }
  get isActive(): boolean      { return this._isActive; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async activate(holder: string): Promise<void> {
    if (this._isActive) return;

    // Adapt quality to current memory pressure
    const quality = MemoryPressureMonitor.currentQuality;
    this._config = {
      ...this._config,
      quality:  quality.videoResolution,
      fps:      quality.targetFPS,
      enableAR: quality.deepAREnabled,
    };

    this._release = await ResourceManager.acquire('camera', holder);
    this._isActive = true;
    MediaStore.setState({ isCamera: true });
    console.log('[CameraController] activated by:', holder, '| quality:', this._config.quality);
    this._notify();
  }

  async deactivate(): Promise<void> {
    if (!this._isActive) return;
    this._isActive = false;
    this._release?.();
    this._release = null;
    MediaStore.setState({ isCamera: false });
    console.log('[CameraController] deactivated');
    this._notify();
  }

  // ── Config updates ─────────────────────────────────────────────────────────

  setFacing(facing: CameraFacing): void {
    this._config = { ...this._config, facing };
    MediaStore.setState({ isMirrored: facing === 'front' });
    this._notify();
  }

  setFlash(flash: FlashMode): void {
    this._config = { ...this._config, flash };
    MediaStore.setState({ flashOn: flash === 'on' || flash === 'torch' });
    this._notify();
  }

  setZoom(zoom: number): void {
    this._config = { ...this._config, zoom: Math.max(0, Math.min(1, zoom)) };
    this._notify();
  }

  toggleFacing(): void {
    this.setFacing(this._config.facing === 'front' ? 'back' : 'front');
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  startRecording(): void {
    if (!this._isActive) {
      console.warn('[CameraController] startRecording() called while inactive');
      return;
    }
    MediaStore.setRecording({ status: 'recording', durationMs: 0 });
    EventBus.emit('studio:recording_started');
  }

  stopRecording(uri: string, durationMs: number): void {
    MediaStore.setRecording({ status: 'processing', uri, durationMs });
    EventBus.emit('studio:recording_ended', { uri, durationMs });
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: (c: CameraConfig) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._config); } catch { /* isolate */ }
    }
  }
}

export const CameraController = new CameraControllerImpl();
