/**
 * modules/media/MediaCleanupManager.ts — Aggressive media resource cleanup
 *
 * Ensures all media resources are released on:
 *   - Navigation away from screens (camera, AR, effects)
 *   - App backgrounding (all active streams)
 *   - Low memory warnings (cached thumbnails, AR textures)
 *   - Session end (calls, live streams)
 *   - Component unmount (video players, audio players)
 *
 * Prevents:
 *   - Camera hardware lock persisting after navigator.pop()
 *   - Audio session not released after DM playback
 *   - AR textures accumulating across creator studio open/close cycles
 *   - Temporary upload files not deleted after upload success/failure
 *   - Thumbnail cache bloating memory during long sessions
 *
 * Usage:
 *   // Register cleanup for a screen
 *   const cleanup = MediaCleanupManager.registerScreenCleanup('CreatorStudio', async () => {
 *     await deeparService.destroy();
 *     await cameraSession.release();
 *   });
 *   // Call on unmount:
 *   cleanup();
 *
 *   // Force cleanup of a category:
 *   await MediaCleanupManager.cleanupCategory('ar_textures');
 */

import { AppLifecycle } from '../core/AppLifecycle';
import { EventBus }     from '../core/EventBus';

export type CleanupCategory =
  | 'camera'
  | 'microphone'
  | 'ar_textures'
  | 'video_players'
  | 'audio_players'
  | 'temp_files'
  | 'thumbnails'
  | 'effects_cache'
  | 'recording_buffers'
  | 'stream_buffers';

interface CleanupHandler {
  id:       string;
  screen:   string;
  category: CleanupCategory;
  fn:       () => Promise<void>;
  priority: number;   // lower = runs first
}

class MediaCleanupManagerImpl {
  private readonly _handlers = new Map<string, CleanupHandler>();
  private _counter = 0;

  constructor() {
    // Cleanup on background
    AppLifecycle.onBackground(async () => {
      await this._runCategory('camera',            'background');
      await this._runCategory('microphone',        'background');
      await this._runCategory('recording_buffers', 'background');
      await this._runCategory('stream_buffers',    'background');
    });

    // Cleanup on low memory
    EventBus.on('app:low_memory', async () => {
      await this._runCategory('thumbnails',    'low_memory');
      await this._runCategory('effects_cache', 'low_memory');
      await this._runCategory('ar_textures',   'low_memory');
    });
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a cleanup handler for a screen.
   * Returns a function that unregisters and calls the cleanup.
   */
  registerScreenCleanup(
    screen:   string,
    fn:       () => Promise<void>,
    category: CleanupCategory = 'camera',
    priority  = 10,
  ): () => void {
    const id = `cleanup_${++this._counter}_${screen}`;
    this._handlers.set(id, { id, screen, category, fn, priority });

    return async () => {
      this._handlers.delete(id);
      try { await fn(); } catch (e: any) {
        console.warn(`[MediaCleanup] "${screen}" cleanup error:`, e?.message);
      }
    };
  }

  /**
   * Register a category-level cleanup (not tied to a specific screen).
   */
  registerCategoryCleanup(
    category: CleanupCategory,
    fn:       () => Promise<void>,
    priority  = 5,
  ): () => void {
    const id = `cleanup_${++this._counter}_${category}`;
    this._handlers.set(id, { id, screen: '_global', category, fn, priority });
    return () => this._handlers.delete(id);
  }

  // ── Cleanup execution ─────────────────────────────────────────────────────

  /** Force cleanup of all handlers registered for a screen. */
  async cleanupScreen(screen: string): Promise<void> {
    const handlers = Array.from(this._handlers.values())
      .filter(h => h.screen === screen)
      .sort((a, b) => a.priority - b.priority);

    for (const h of handlers) {
      this._handlers.delete(h.id);
      try { await h.fn(); } catch (e: any) {
        console.warn(`[MediaCleanup] screen "${screen}" handler error:`, e?.message);
      }
    }

    if (handlers.length > 0) {
      console.log(`[MediaCleanup] cleaned up ${handlers.length} handlers for "${screen}"`);
    }
  }

  /** Force cleanup of all handlers in a category. */
  async cleanupCategory(category: CleanupCategory): Promise<void> {
    await this._runCategory(category, 'manual');
  }

  /** Clean up ALL registered handlers (app shutdown). */
  async cleanupAll(): Promise<void> {
    const all = Array.from(this._handlers.values()).sort((a, b) => a.priority - b.priority);
    for (const h of all) {
      this._handlers.delete(h.id);
      try { await h.fn(); } catch { /* isolate */ }
    }
    console.log('[MediaCleanup] all handlers cleaned');
  }

  // ── Temp file cleanup ─────────────────────────────────────────────────────

  /**
   * Delete a temp file after upload/processing.
   * Safe to call even if file doesn't exist.
   */
  async deleteTempFile(uri: string): Promise<void> {
    try {
      const fs = require('expo-file-system');
      const exists = await fs.getInfoAsync(uri);
      if (exists?.exists) {
        await fs.deleteAsync(uri, { idempotent: true });
      }
    } catch { /* ignore */ }
  }

  /**
   * Clean up all files in a temp directory.
   */
  async cleanTempDir(dirPath: string): Promise<number> {
    try {
      const fs = require('expo-file-system');
      const info = await fs.getInfoAsync(dirPath);
      if (!info?.exists) return 0;

      const files = await fs.readDirectoryAsync(dirPath);
      let cleaned = 0;
      for (const file of files) {
        await fs.deleteAsync(`${dirPath}/${file}`, { idempotent: true }).catch(() => {});
        cleaned++;
      }
      console.log(`[MediaCleanup] cleaned ${cleaned} temp files from ${dirPath}`);
      return cleaned;
    } catch {
      return 0;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get handlerCount(): number { return this._handlers.size; }

  getHandlersByCategory(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const h of this._handlers.values()) {
      out[h.category] = (out[h.category] ?? 0) + 1;
    }
    return out;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _runCategory(category: CleanupCategory, reason: string): Promise<void> {
    const handlers = Array.from(this._handlers.values())
      .filter(h => h.category === category)
      .sort((a, b) => a.priority - b.priority);

    if (handlers.length === 0) return;

    await Promise.all(handlers.map(async h => {
      try { await h.fn(); } catch (e: any) {
        console.warn(`[MediaCleanup] category "${category}" (${reason}) error:`, e?.message);
      }
    }));

    console.log(`[MediaCleanup] ran ${handlers.length} "${category}" handlers (reason: ${reason})`);
  }
}

export const MediaCleanupManager = new MediaCleanupManagerImpl();
