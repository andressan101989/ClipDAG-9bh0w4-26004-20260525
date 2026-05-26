/**
 * modules/media/UploadQueue.ts — Background upload queue
 *
 * Features:
 *   - Concurrent upload limit (default: 2) — prevents network saturation
 *   - Automatic retry with exponential back-off (max 3 attempts)
 *   - Per-upload progress + state tracking
 *   - Cancellation support
 *   - EventBus integration: emits media:upload_* events
 *   - Platform-safe: handles both base64 (mobile) and blob (web) paths
 *
 * Usage:
 *   import { UploadQueue } from '@/modules/media/UploadQueue';
 *
 *   const uploadId = UploadQueue.enqueue({
 *     uri:      localFileUri,
 *     bucket:   'images',
 *     path:     `${userId}/photo_${Date.now()}.jpg`,
 *     mimeType: 'image/jpeg',
 *   });
 *
 *   // Listen for progress
 *   EventBus.on('media:upload_progress', ({ uploadId, progress }) => {
 *     setProgress(progress);
 *   });
 *
 *   // Listen for completion
 *   EventBus.on('media:upload_complete', ({ uploadId, url }) => {
 *     saveUrlToDatabase(url);
 *   });
 */

import { getSupabaseClient } from '@/template';
import { EventBus }           from '../core/EventBus';

// ── Types ─────────────────────────────────────────────────────────────────────
export type UploadStatus = 'queued' | 'uploading' | 'complete' | 'error' | 'cancelled';

export interface UploadJob {
  id:        string;
  uri:       string;
  bucket:    string;
  path:      string;
  mimeType:  string;
  base64?:   string | null;
  metadata?: Record<string, string>;
  onProgress?: (progress: number) => void;
  onComplete?: (url: string)       => void;
  onError?:    (error: string)     => void;
}

export interface UploadState {
  id:        string;
  status:    UploadStatus;
  progress:  number;       // 0–100
  url?:      string;
  error?:    string;
  attempts:  number;
  fileName:  string;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const MAX_CONCURRENT = 2;
const MAX_RETRIES    = 3;
const RETRY_BASE_MS  = 1500;

// ── Implementation ─────────────────────────────────────────────────────────────
class UploadQueueImpl {
  private readonly _queue:   UploadJob[]   = [];
  private readonly _states   = new Map<string, UploadState>();
  private _activeCount = 0;
  private _idCounter   = 0;

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Add an upload job to the queue.
   * Returns the upload ID — use to track progress via EventBus.
   */
  enqueue(job: Omit<UploadJob, 'id'>): string {
    const id = `upload_${++this._idCounter}_${Date.now()}`;
    const fullJob: UploadJob = { ...job, id };
    const state: UploadState = {
      id,
      status:   'queued',
      progress: 0,
      attempts: 0,
      fileName: job.path.split('/').pop() ?? job.path,
    };
    this._states.set(id, state);
    this._queue.push(fullJob);
    this._drain();
    return id;
  }

  /** Cancel a pending or uploading job. */
  cancel(id: string): void {
    const idx = this._queue.findIndex(j => j.id === id);
    if (idx !== -1) this._queue.splice(idx, 1);
    const state = this._states.get(id);
    if (state && state.status !== 'complete') {
      this._updateState(id, { status: 'cancelled' });
    }
  }

  /** Get current state for an upload. */
  getState(id: string): UploadState | undefined {
    return this._states.get(id);
  }

  /** All upload states. */
  get all(): UploadState[] {
    return Array.from(this._states.values());
  }

  /** Active + queued jobs count. */
  get pendingCount(): number {
    return this._queue.length + this._activeCount;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _drain(): void {
    while (this._activeCount < MAX_CONCURRENT && this._queue.length > 0) {
      const job = this._queue.shift()!;
      const state = this._states.get(job.id);
      if (!state || state.status === 'cancelled') continue;
      this._activeCount++;
      this._processJob(job).finally(() => {
        this._activeCount--;
        this._drain();
      });
    }
  }

  private async _processJob(job: UploadJob, attempt = 1): Promise<void> {
    this._updateState(job.id, { status: 'uploading', attempts: attempt, progress: 0 });
    EventBus.emit('media:upload_progress', { uploadId: job.id, progress: 0, fileName: job.path.split('/').pop() ?? '' });

    try {
      const supabase = getSupabaseClient();
      let fileData: Uint8Array;

      // ── Prepare file bytes ─────────────────────────────────────────────────
      if (job.base64) {
        fileData = this._base64ToUint8Array(job.base64);
      } else if (job.uri.startsWith('http://') || job.uri.startsWith('https://')) {
        const resp = await fetch(job.uri);
        const buf  = await resp.arrayBuffer();
        fileData   = new Uint8Array(buf);
      } else {
        // Local file URI (React Native file:// path)
        const resp = await fetch(job.uri);
        const buf  = await resp.arrayBuffer();
        fileData   = new Uint8Array(buf);
      }

      this._updateState(job.id, { progress: 50 });
      EventBus.emit('media:upload_progress', { uploadId: job.id, progress: 50, fileName: job.path.split('/').pop() ?? '' });

      // ── Upload to Supabase Storage ─────────────────────────────────────────
      const { error } = await supabase.storage
        .from(job.bucket)
        .upload(job.path, fileData, {
          contentType: job.mimeType,
          upsert:      true,
          ...(job.metadata ? { metadata: job.metadata } : {}),
        });

      if (error) throw new Error(error.message);

      const { data: { publicUrl } } = supabase.storage
        .from(job.bucket)
        .getPublicUrl(job.path);

      this._updateState(job.id, { status: 'complete', progress: 100, url: publicUrl });
      EventBus.emit('media:upload_complete', { uploadId: job.id, url: publicUrl, bucket: job.bucket });
      job.onComplete?.(publicUrl);

    } catch (e: any) {
      const errorMsg = e?.message ?? 'Upload failed';

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[UploadQueue] job "${job.id}" failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms:`, errorMsg);
        await new Promise(r => setTimeout(r, delay));
        await this._processJob(job, attempt + 1);
      } else {
        this._updateState(job.id, { status: 'error', error: errorMsg });
        EventBus.emit('media:upload_failed', { uploadId: job.id, error: errorMsg });
        job.onError?.(errorMsg);
        console.error(`[UploadQueue] job "${job.id}" permanently failed:`, errorMsg);
      }
    }
  }

  private _updateState(id: string, patch: Partial<UploadState>): void {
    const prev = this._states.get(id);
    if (!prev) return;
    this._states.set(id, { ...prev, ...patch });
    const state = this._states.get(id)!;
    state.onProgress = undefined; // prevent circular ref in state
    if (patch.progress !== undefined) {
      prev.onProgress?.(patch.progress);
    }
  }

  private _base64ToUint8Array(base64: string): Uint8Array {
    try {
      const binary = atob(base64.replace(/^data:[^;]+;base64,/, ''));
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      // Fallback manual decoder
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const lk: Record<string, number> = {};
      for (let i = 0; i < chars.length; i++) lk[chars[i]] = i;
      const b64 = base64.replace(/[^A-Za-z0-9+/]/g, '');
      let bufLen = (b64.length * 3) >> 2;
      if (b64[b64.length - 1] === '=') bufLen--;
      if (b64[b64.length - 2] === '=') bufLen--;
      const out = new Uint8Array(bufLen);
      let p = 0;
      for (let i = 0; i < b64.length; i += 4) {
        const a = lk[b64[i]] ?? 0, b2 = lk[b64[i+1]] ?? 0;
        const c = lk[b64[i+2]] ?? 0, d2 = lk[b64[i+3]] ?? 0;
        out[p++] = (a << 2) | (b2 >> 4);
        if (p < bufLen) out[p++] = ((b2 & 15) << 4) | (c >> 2);
        if (p < bufLen) out[p++] = ((c & 3) << 6) | d2;
      }
      return out;
    }
  }
}

export const UploadQueue = new UploadQueueImpl();
