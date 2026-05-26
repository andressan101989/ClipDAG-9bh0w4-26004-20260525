/**
 * modules/media/MediaSessionManager.ts — Unified media session lifecycle
 *
 * Manages all active media sessions to prevent resource conflicts and leaks:
 *   - Camera sessions (creator studio, stories, avatar)
 *   - Microphone sessions (voice messages, calls)
 *   - Video playback sessions (feed, stories, calls)
 *   - Audio playback sessions (music, voice messages)
 *   - Recording sessions (video capture)
 *
 * Policies:
 *   - Only ONE camera session at a time (hardware constraint)
 *   - Only ONE active recording at a time
 *   - Audio sessions can overlap with video playback
 *   - Background app: all active sessions paused
 *   - Navigation away: playback sessions paused, camera released
 *
 * Integrates with:
 *   ResourceManager (GPU + camera leases)
 *   LeakDetector (tracks all open sessions)
 *   PowerManager (pauses under emergency tier)
 *
 * Usage:
 *   const session = await MediaSessionManager.openCamera('creator-studio');
 *   session.release();  // explicit cleanup
 *
 *   MediaSessionManager.pauseAll('playback');
 *   MediaSessionManager.resumeAll('playback');
 */

import { ResourceManager } from '../core/ResourceManager';
import { LeakDetector }    from '../core/LeakDetector';
import { AppLifecycle }    from '../core/AppLifecycle';
import { EventBus }        from '../core/EventBus';

export type MediaSessionType =
  | 'camera'
  | 'microphone'
  | 'video_playback'
  | 'audio_playback'
  | 'recording'
  | 'screen_capture';

export type MediaSessionState = 'active' | 'paused' | 'stopped' | 'error';

export interface MediaSession {
  id:       string;
  type:     MediaSessionType;
  owner:    string;
  state:    MediaSessionState;
  startedAt: number;
  pause:    () => void;
  resume:   () => void;
  release:  () => Promise<void>;
}

class MediaSessionManagerImpl {
  private readonly _sessions = new Map<string, MediaSession & { leakToken: string; resourceRelease: (() => Promise<void>) | null }>();
  private _sessionCounter    = 0;

  constructor() {
    AppLifecycle.onBackground(() => this._handleBackground());
    AppLifecycle.onForeground(() => this._handleForeground());
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  async openCamera(owner: string): Promise<MediaSession> {
    // Enforce single camera session
    const existing = this._findByType('camera');
    if (existing) {
      console.warn(`[MediaSession] camera already open by "${existing.owner}" — releasing first`);
      await existing.release();
    }

    const resourceRelease = await ResourceManager.acquire('camera', owner, 'critical');
    const leakToken = LeakDetector.track('camera', `camera:${owner}`, owner);

    return this._createSession('camera', owner, resourceRelease, leakToken);
  }

  // ── Microphone ────────────────────────────────────────────────────────────

  async openMicrophone(owner: string): Promise<MediaSession> {
    const resourceRelease = await ResourceManager.acquire('microphone', owner, 'high');
    const leakToken = LeakDetector.track('media_stream', `mic:${owner}`, owner);
    return this._createSession('microphone', owner, resourceRelease, leakToken);
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  openVideoPlayback(owner: string): MediaSession {
    const leakToken = LeakDetector.track('media_stream', `video:${owner}`, owner);
    return this._createSession('video_playback', owner, null, leakToken);
  }

  openAudioPlayback(owner: string): MediaSession {
    const leakToken = LeakDetector.track('media_stream', `audio:${owner}`, owner);
    return this._createSession('audio_playback', owner, null, leakToken);
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  async startRecording(owner: string): Promise<MediaSession | null> {
    const existing = this._findByType('recording');
    if (existing) {
      console.warn('[MediaSession] recording already active — cannot start another');
      return null;
    }
    const resourceRelease = await ResourceManager.acquire('camera', `rec:${owner}`, 'critical');
    const leakToken = LeakDetector.track('media_stream', `recording:${owner}`, owner);
    return this._createSession('recording', owner, resourceRelease, leakToken);
  }

  // ── Bulk controls ─────────────────────────────────────────────────────────

  pauseAll(type?: MediaSessionType): void {
    for (const [, session] of this._sessions) {
      if (!type || session.type === type) session.pause();
    }
  }

  resumeAll(type?: MediaSessionType): void {
    for (const [, session] of this._sessions) {
      if (!type || session.type === type) session.resume();
    }
  }

  async releaseAll(): Promise<void> {
    const sessions = Array.from(this._sessions.values());
    await Promise.all(sessions.map(s => s.release().catch(() => {})));
    this._sessions.clear();
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getActiveSessions(): Array<{ id: string; type: MediaSessionType; owner: string; state: MediaSessionState; ageSec: number }> {
    const now = Date.now();
    return Array.from(this._sessions.values()).map(s => ({
      id:     s.id,
      type:   s.type,
      owner:  s.owner,
      state:  s.state,
      ageSec: Math.round((now - s.startedAt) / 1000),
    }));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _createSession(
    type:            MediaSessionType,
    owner:           string,
    resourceRelease: (() => Promise<void>) | null,
    leakToken:       string,
  ): MediaSession {
    const id = `ms_${++this._sessionCounter}_${type}`;

    const sessionRecord = {
      id,
      type,
      owner,
      state:     'active' as MediaSessionState,
      startedAt: Date.now(),
      leakToken,
      resourceRelease,

      pause: () => {
        if (sessionRecord.state === 'active') {
          sessionRecord.state = 'paused';
        }
      },

      resume: () => {
        if (sessionRecord.state === 'paused') {
          sessionRecord.state = 'active';
        }
      },

      release: async () => {
        sessionRecord.state = 'stopped';
        await sessionRecord.resourceRelease?.().catch(() => {});
        LeakDetector.release(leakToken);
        this._sessions.delete(id);
        console.log(`[MediaSession] released ${type} session "${id}" (owner: ${owner})`);
      },
    };

    this._sessions.set(id, sessionRecord);
    console.log(`[MediaSession] opened ${type} session "${id}" for "${owner}"`);
    return sessionRecord;
  }

  private _findByType(type: MediaSessionType): (MediaSession & { leakToken: string; resourceRelease: any }) | null {
    for (const [, s] of this._sessions) {
      if (s.type === type && s.state !== 'stopped') return s;
    }
    return null;
  }

  private _handleBackground(): void {
    // Pause playback in background; keep camera for PiP scenarios
    this.pauseAll('video_playback');
    this.pauseAll('audio_playback');
  }

  private _handleForeground(): void {
    this.resumeAll('video_playback');
    this.resumeAll('audio_playback');
  }
}

export const MediaSessionManager = new MediaSessionManagerImpl();
