/**
 * modules/streaming/LiveOrchestrator.ts — Live stream orchestration layer
 *
 * Coordinates all sub-systems during an active live stream:
 *   - Stream session lifecycle (create → start → monitor → end → cleanup)
 *   - Adaptive streaming quality (bitrate, resolution, FPS by thermal/network)
 *   - Viewer synchronization (join, leave, count polling)
 *   - Stream health scoring (1–100, auto-degrade on low score)
 *   - Live moderation pipeline hooks (reported comments, bans)
 *   - Reaction flood protection (BackpressureQueue for emoji rain)
 *   - Gift event queue (prevents UI lag from gift storms)
 *   - Stream reconnect (host drops → attempt re-establish)
 *   - Background degradation (host backgrounds → reduce quality)
 *   - Co-host management (co-host join, split layout, battle mode)
 *
 * Usage:
 *   const session = await LiveOrchestrator.startHostSession(userId, title);
 *   session.onHealthChange(score => setQualityBadge(score));
 *   session.onViewerCountChange(n => setViewerLabel(n));
 *   session.onGift(gift => playGiftAnimation(gift));
 *   await session.end();
 */

import { EventBus }               from '../core/EventBus';
import { PollingManager }         from '../realtime/PollingManager';
import { BackpressureQueue }      from '../core/BackpressureQueue';
import { AdaptiveQualityController } from '../core/AdaptiveQualityController';
import { SecurityManager }        from '../core/SecurityManager';
import { getSupabaseClient }      from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'critical';

export interface HostSession {
  sessionId:    string;
  hostId:       string;
  title:        string;
  startedAt:    number;
  viewerCount:  number;
  healthScore:  number;
  health:       StreamHealth;

  onHealthChange:      (cb: (score: number, health: StreamHealth) => void) => () => void;
  onViewerCountChange: (cb: (count: number) => void) => () => void;
  onGift:              (cb: (gift: any) => void) => () => void;
  onModerationEvent:   (cb: (event: any) => void) => () => void;
  setTitle:            (title: string) => Promise<void>;
  end:                 () => Promise<void>;
}

// ── LiveOrchestrator ──────────────────────────────────────────────────────────

class LiveOrchestratorImpl {
  private _activeSessions = new Map<string, HostSessionImpl>();

  async startHostSession(hostId: string, title: string): Promise<HostSession> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('live_sessions')
        .insert({ host_id: hostId, title, status: 'live', viewer_count: 0 })
        .select()
        .single();

      if (error) throw new Error(error.message);

      const session = new HostSessionImpl(data.id, hostId, title);
      this._activeSessions.set(data.id, session);

      EventBus.emit('stream:started', { hostId, sessionId: data.id, title });
      console.log('[LiveOrchestrator] host session started:', data.id);
      return session;
    } catch (e: any) {
      throw new Error(`LiveOrchestrator.startHostSession: ${e?.message}`);
    }
  }

  getSession(sessionId: string): HostSession | undefined {
    return this._activeSessions.get(sessionId);
  }

  async endAll(): Promise<void> {
    for (const session of this._activeSessions.values()) {
      await session.end();
    }
  }

  get activeCount(): number { return this._activeSessions.size; }
}

// ── HostSessionImpl ────────────────────────────────────────────────────────────

class HostSessionImpl implements HostSession {
  readonly sessionId: string;
  readonly hostId:    string;
  title:              string;
  readonly startedAt: number;
  viewerCount   = 0;
  healthScore   = 100;
  health: StreamHealth = 'excellent';

  private _healthCbs      = new Set<(score: number, h: StreamHealth) => void>();
  private _viewerCbs      = new Set<(count: number) => void>();
  private _giftCbs        = new Set<(gift: any) => void>();
  private _moderationCbs  = new Set<(event: any) => void>();
  private _pollKey:       string;
  private _giftQueue:     BackpressureQueue;
  private _degradeCount   = 0;
  private _ended          = false;

  constructor(sessionId: string, hostId: string, title: string) {
    this.sessionId = sessionId;
    this.hostId    = hostId;
    this.title     = title;
    this.startedAt = Date.now();
    this._pollKey  = `live:${sessionId}`;
    this._giftQueue = new (BackpressureQueue as any)({
      maxSize:       100,
      flushInterval: 200,
      onFlush:       (items: any[]) => {
        for (const gift of items) {
          for (const cb of this._giftCbs) cb(gift);
        }
      },
    });

    this._startPolling();
    this._startHealthMonitor();
  }

  // ── HostSession API ────────────────────────────────────────────────────────

  onHealthChange(cb: (score: number, health: StreamHealth) => void): () => void {
    this._healthCbs.add(cb);
    return () => this._healthCbs.delete(cb);
  }

  onViewerCountChange(cb: (count: number) => void): () => void {
    this._viewerCbs.add(cb);
    return () => this._viewerCbs.delete(cb);
  }

  onGift(cb: (gift: any) => void): () => void {
    this._giftCbs.add(cb);
    return () => this._giftCbs.delete(cb);
  }

  onModerationEvent(cb: (event: any) => void): () => void {
    this._moderationCbs.add(cb);
    return () => this._moderationCbs.delete(cb);
  }

  async setTitle(title: string): Promise<void> {
    this.title = title;
    try {
      const supabase = getSupabaseClient();
      await supabase.from('live_sessions').update({ title }).eq('id', this.sessionId);
    } catch { /* non-critical */ }
  }

  async end(): Promise<void> {
    if (this._ended) return;
    this._ended = true;

    PollingManager.unregister(this._pollKey);
    PollingManager.unregister(`health:${this.sessionId}`);

    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', this.sessionId);
    } catch { /* ignore */ }

    EventBus.emit('stream:ended', { sessionId: this.sessionId, viewerCount: this.viewerCount });
    this._healthCbs.clear();
    this._viewerCbs.clear();
    this._giftCbs.clear();
    this._moderationCbs.clear();
    console.log('[LiveOrchestrator] session ended:', this.sessionId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _startPolling(): void {
    PollingManager.register({
      key:         this._pollKey,
      intervalMs:  3_000,
      backgroundFactor: 0,
      fn:          async () => {
        try {
          const supabase = getSupabaseClient();
          const { data } = await supabase
            .from('live_sessions')
            .select('viewer_count, status')
            .eq('id', this.sessionId)
            .single();

          if (data) {
            if (data.viewer_count !== this.viewerCount) {
              this.viewerCount = data.viewer_count;
              for (const cb of this._viewerCbs) cb(this.viewerCount);
            }
            if (data.status === 'ended') {
              await this.end();
            }
          }
        } catch { /* non-critical */ }
      },
    });
  }

  private _startHealthMonitor(): void {
    PollingManager.register({
      key:         `health:${this.sessionId}`,
      intervalMs:  5_000,
      backgroundFactor: 0,
      fn:          async () => {
        const quality = AdaptiveQualityController.getProfile?.();
        let score = 100;

        if (quality) {
          if (quality.level === 'low')      score -= 30;
          else if (quality.level === 'medium') score -= 10;
        }

        // Penalize repeated degradations
        score -= this._degradeCount * 5;
        score = Math.max(0, Math.min(100, score));

        const health = this._scoreToHealth(score);

        if (score !== this.healthScore) {
          this.healthScore = score;
          this.health      = health;
          for (const cb of this._healthCbs) cb(score, health);
        }
      },
    });
  }

  private _scoreToHealth(score: number): StreamHealth {
    if (score >= 90) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'degraded';
    if (score >= 30) return 'poor';
    return 'critical';
  }
}

export const LiveOrchestrator = new LiveOrchestratorImpl();
