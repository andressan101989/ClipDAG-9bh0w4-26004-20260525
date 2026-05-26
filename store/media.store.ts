/**
 * store/media.store.ts — Media pipeline domain store
 *
 * Tracks upload queue states, recording session, and playback state.
 * UploadQueue + CameraController write here; media UI subscribes.
 */

import { EventBus } from '@/modules/core/EventBus';

export type UploadStatus  = 'queued' | 'uploading' | 'complete' | 'error' | 'cancelled';
export type RecordStatus  = 'idle' | 'preparing' | 'recording' | 'paused' | 'processing' | 'ready';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface UploadItem {
  id:        string;
  fileName:  string;
  status:    UploadStatus;
  progress:  number;    // 0–100
  url?:      string;
  error?:    string;
  bucket:    string;
  startedAt: number;
}

export interface RecordingSession {
  uri?:         string;
  durationMs:   number;
  sizeBytes?:   number;
  thumbnail?:   string;
  status:       RecordStatus;
  filterApplied?: string;
  musicTrack?:  string;
}

export interface MediaState {
  uploads:    UploadItem[];
  recording:  RecordingSession;
  isCamera:   boolean;    // camera surface active
  isMirrored: boolean;    // front cam
  flashOn:    boolean;
}

const INITIAL: MediaState = {
  uploads:   [],
  recording: { durationMs: 0, status: 'idle' },
  isCamera:  false,
  isMirrored: true,
  flashOn:   false,
};

class MediaStoreImpl {
  private _state: MediaState = { ...INITIAL };
  private readonly _subs = new Set<(s: MediaState) => void>();

  getState():         MediaState { return this._state; }
  get activeUploads():UploadItem[] { return this._state.uploads.filter(u => u.status === 'uploading' || u.status === 'queued'); }
  get isRecording():  boolean    { return this._state.recording.status === 'recording'; }

  setState(patch: Partial<MediaState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  upsertUpload(item: UploadItem): void {
    const list = this._state.uploads.filter(u => u.id !== item.id);
    // Keep max 20 upload history items
    const trimmed = list.length >= 20 ? list.slice(list.length - 19) : list;
    this.setState({ uploads: [...trimmed, item] });
  }

  setRecording(patch: Partial<RecordingSession>): void {
    this.setState({ recording: { ...this._state.recording, ...patch } });
  }

  reset(): void {
    this._state = { ...INITIAL };
    this._notify();
  }

  subscribe(fn: (s: MediaState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const MediaStore = new MediaStoreImpl();

// Sync upload events → MediaStore
EventBus.on('media:upload_progress', ({ uploadId, progress, fileName }) =>
  MediaStore.upsertUpload({
    id: uploadId, fileName, status: 'uploading', progress,
    bucket: '', startedAt: Date.now(),
  })
);
EventBus.on('media:upload_complete', ({ uploadId, url, bucket }) => {
  const existing = MediaStore.getState().uploads.find(u => u.id === uploadId);
  if (existing) {
    MediaStore.upsertUpload({ ...existing, status: 'complete', progress: 100, url });
  }
});
EventBus.on('media:upload_failed', ({ uploadId, error }) => {
  const existing = MediaStore.getState().uploads.find(u => u.id === uploadId);
  if (existing) {
    MediaStore.upsertUpload({ ...existing, status: 'error', error });
  }
});

// Sync recording events → MediaStore
EventBus.on('studio:recording_started', () => MediaStore.setRecording({ status: 'recording' }));
EventBus.on('studio:recording_ended',   ({ uri, durationMs }) =>
  MediaStore.setRecording({ status: 'ready', uri, durationMs })
);
