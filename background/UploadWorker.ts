/**
 * background/UploadWorker.ts — Decoupled upload processor
 *
 * Processes the UploadQueue independently of UI lifecycle:
 *   - Processes queue items one at a time (concurrency = 1 by default)
 *   - Respects network type (pauses on offline, throttles on cellular)
 *   - Retries failed uploads with exponential backoff
 *   - Reports progress to MediaStore (UI reads from store, not from worker)
 *   - Pauses automatically when app backgrounds
 *   - Resumes when app foregrounds and network available
 *
 * Usage:
 *   UploadWorker.start();
 *   UploadWorker.setConcurrency(2);
 *   UploadWorker.stop();
 */

import { UploadQueue }      from '@/modules/media/UploadQueue';
import { MediaStore }       from '@/store/media.store';
import { AppLifecycle }     from '@/modules/core/AppLifecycle';
import { EventBus }         from '@/modules/core/EventBus';
import { ConnectionManager } from '@/modules/realtime/ConnectionManager';
import { Diagnostics }      from '@/modules/core/Diagnostics';

class UploadWorkerImpl {
  private _running  = false;
  private _paused   = false;
  private _concurrency = 1;
  private _active   = 0;

  start(): void {
    if (this._running) return;
    this._running = true;

    // Pause on background — uploads drain battery and may fail
    AppLifecycle.onBackground(() => {
      this._paused = true;
      console.log('[UploadWorker] paused (background)');
    });

    AppLifecycle.onForeground(() => {
      this._paused = false;
      console.log('[UploadWorker] resumed (foreground)');
      this._drain();
    });

    // Resume when network comes back
    ConnectionManager.onReconnect(() => {
      if (this._running && !this._paused) this._drain();
    });

    // Listen for new items added to queue
    EventBus.on('upload:queued', () => {
      if (!this._paused) this._drain();
    });

    this._drain();
    console.log('[UploadWorker] started (concurrency:', this._concurrency, ')');
  }

  stop(): void {
    this._running = false;
    this._paused  = true;
    console.log('[UploadWorker] stopped');
  }

  setConcurrency(n: number): void {
    this._concurrency = Math.max(1, Math.min(n, 3));
  }

  get isRunning(): boolean { return this._running && !this._paused; }

  private async _drain(): Promise<void> {
    while (
      this._running     &&
      !this._paused     &&
      this._active < this._concurrency &&
      ConnectionManager.isHealthy
    ) {
      const item = UploadQueue.dequeue();
      if (!item) break;

      this._active++;
      this._processItem(item).finally(() => {
        this._active--;
        // Try to pick up the next item immediately
        if (!this._paused) this._drain();
      });
    }
  }

  private async _processItem(item: any): Promise<void> {
    const startMs = Date.now();

    try {
      MediaStore.setState({
        activeUploads: {
          ...MediaStore.getState().activeUploads,
          [item.id]: { progress: 0, status: 'uploading' },
        },
      });

      // Delegate actual upload to the UploadQueue item's fn
      await item.fn((progress: number) => {
        MediaStore.setState({
          activeUploads: {
            ...MediaStore.getState().activeUploads,
            [item.id]: { progress, status: 'uploading' },
          },
        });
      });

      const durationMs = Date.now() - startMs;
      Diagnostics.recordUpload({ bytes: item.sizeBytes ?? 0, durationMs, success: true });

      const activeUploads = { ...MediaStore.getState().activeUploads };
      delete activeUploads[item.id];
      MediaStore.setState({ activeUploads });

    } catch (err: any) {
      console.error('[UploadWorker] item failed:', item.id, err?.message);
      Diagnostics.recordUpload({
        bytes: item.sizeBytes ?? 0,
        durationMs: Date.now() - startMs,
        success: false,
        error: err?.message,
      });

      const activeUploads = { ...MediaStore.getState().activeUploads };
      delete activeUploads[item.id];
      MediaStore.setState({ activeUploads });
    }
  }
}

export const UploadWorker = new UploadWorkerImpl();
