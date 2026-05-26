/**
 * modules/creator/sessions/CreatorSessionManager.ts — Creator Studio session lifecycle
 *
 * Manages the full lifecycle of a Creator Studio session from open to close:
 *   - Initializes all required sub-controllers in the correct order
 *   - Coordinates cleanup when the user exits without publishing
 *   - Tracks unsaved changes and prompts before exit
 *   - Handles interruptions (calls, notifications, background)
 *   - Manages resource leases for the session duration
 *
 * Session states:
 *   idle       → no session open
 *   capturing  → live camera preview active
 *   editing    → editing captured video
 *   exporting  → rendering + uploading
 *   done       → published, waiting for navigation
 *
 * Usage:
 *   const session = await CreatorSessionManager.open();
 *   session.startCapture();
 *   session.captureComplete(videoUri);
 *   session.startEditing();
 *   await session.publish(options);
 *   session.close();
 */

import { CameraController }    from '../camera/CameraController';
import { EditorController }    from '../editor/EditorController';
import { FiltersController }   from '../filters/FiltersController';
import { TimelineController }  from '../timeline/TimelineController';
import { ExportManager }       from '../exports/ExportManager';
import { MediaSessionManager } from '../../media/MediaSessionManager';
import { MediaCleanupManager } from '../../media/MediaCleanupManager';
import { RenderIsolationManager } from '../../core/RenderIsolationManager';
import { ResourceManager }     from '../../core/ResourceManager';
import { AppLifecycle }        from '../../core/AppLifecycle';
import { EventBus }            from '../../core/EventBus';

export type CreatorPhase = 'idle' | 'capturing' | 'editing' | 'exporting' | 'done';

export interface CreatorSession {
  id:               string;
  phase:            CreatorPhase;
  capturedUri?:     string;
  durationMs?:      number;
  hasUnsavedChanges: boolean;
  openedAt:         number;
  startCapture:     () => Promise<void>;
  captureComplete:  (uri: string, durationMs: number) => Promise<void>;
  startEditing:     () => Promise<void>;
  publish:          (options: any) => Promise<{ videoId?: string; error?: string }>;
  close:            () => Promise<void>;
}

class CreatorSessionManagerImpl {
  private _session: CreatorSession | null = null;
  private _resourceRelease: (() => Promise<void>) | null = null;
  private _screenCleanup: (() => void) | null = null;
  private _bgUnsub: (() => void) | null = null;

  get currentSession(): CreatorSession | null { return this._session; }
  get isOpen():         boolean               { return this._session !== null; }

  async open(): Promise<CreatorSession> {
    if (this._session) {
      console.warn('[CreatorSession] session already open');
      return this._session;
    }

    const sessionId = `cs_${Date.now()}`;
    console.log('[CreatorSession] opening session:', sessionId);

    // Acquire GPU resource for session duration
    this._resourceRelease = await ResourceManager.acquire('render_compositor', 'creator-session', 'high');

    // Register render surfaces
    RenderIsolationManager.registerSurface('creator-camera',  'camera',     60, 'creator-studio');
    RenderIsolationManager.registerSurface('creator-preview', 'preview',    30, 'creator-studio');
    RenderIsolationManager.registerSurface('creator-effects', 'ar_effects', 30, 'creator-studio');

    // Register cleanup for screen navigation
    this._screenCleanup = MediaCleanupManager.registerScreenCleanup(
      'CreatorStudio',
      () => this._cleanupResources(),
      'camera',
      1,
    );

    // Pause on background
    this._bgUnsub = AppLifecycle.onBackground(() => {
      if (this._session?.phase === 'capturing') {
        CameraController.pausePreview?.();
      }
    });

    const session: CreatorSession = {
      id:               sessionId,
      phase:            'idle',
      hasUnsavedChanges: false,
      openedAt:         Date.now(),

      startCapture: async () => {
        session.phase = 'capturing';
        await FiltersController.loadCatalog();
        console.log('[CreatorSession] capture started');
      },

      captureComplete: async (uri: string, durationMs: number) => {
        session.phase       = 'editing';
        session.capturedUri = uri;
        session.durationMs  = durationMs;
        console.log('[CreatorSession] capture complete:', uri, durationMs + 'ms');
      },

      startEditing: async () => {
        if (!session.capturedUri || !session.durationMs) {
          throw new Error('No capture available');
        }
        await EditorController.open(session.capturedUri, session.durationMs);
        TimelineController.initialize(session.durationMs, session.capturedUri);
        session.phase = 'editing';
        session.hasUnsavedChanges = true;
      },

      publish: async (options: any) => {
        session.phase = 'exporting';
        try {
          const job = await ExportManager.startExport(TimelineController.state, options);
          const result = await new Promise<{ videoId?: string; error?: string }>((resolve) => {
            job.onComplete(videoId => resolve({ videoId }));
            job.onError(error => resolve({ error }));
          });
          if (!result.error) {
            session.phase = 'done';
            session.hasUnsavedChanges = false;
          }
          return result;
        } catch (e: any) {
          session.phase = 'editing';
          return { error: e?.message ?? 'Export failed' };
        }
      },

      close: async () => {
        await this._cleanup();
      },
    };

    this._session = session;
    return session;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _cleanup(): Promise<void> {
    if (!this._session) return;
    console.log('[CreatorSession] closing session:', this._session.id);

    this._screenCleanup?.();
    this._bgUnsub?.();
    this._bgUnsub = null;

    await this._cleanupResources();
    this._session = null;
  }

  private async _cleanupResources(): Promise<void> {
    await EditorController.close().catch(() => {});
    await FiltersController.cleanup().catch(() => {});
    TimelineController.reset();
    RenderIsolationManager.suspendScene('creator-studio');
    await this._resourceRelease?.().catch(() => {});
    this._resourceRelease = null;
    console.log('[CreatorSession] resources released');
  }
}

export const CreatorSessionManager = new CreatorSessionManagerImpl();
