/**
 * modules/streaming/StreamSessionManager.ts — Professional streaming session manager
 *
 * Manages full live-stream lifecycle:
 *   - StreamSessionManager: session creation, viewer sync, health
 *   - LiveOrchestrator:     quality adaptation, overlay, moderation
 *   - StreamHealthMonitor:  bitrate, stall, reconnect tracking
 *
 * Features:
 *   - Adaptive bitrate adjustment based on network + thermal
 *   - Viewer synchronization via polling
 *   - Stream recovery on network interruption
 *   - Live reactions backpressure queue
 *   - Host + viewer lifecycle coordination
 *   - Cleanup on background / app kill
 *
 * Usage:
 *   const session = await StreamSessionManager.startHostSession(userId, title);
 *   StreamSessionManager.onHealthUpdate(s => updateStreamBadge(s));
 *   session.end();
 */

import { EventBus }            from '../core/EventBus';
import { PollingManager }      from '../realtime/PollingManager';
import { AdaptiveBitrateManager } from '../media/AdaptiveBitrateManager';
import { BackpressureQueue }   from '../core/BackpressureQueue';
import { AppLifecycle }        from '../core/AppLifecycle';
import { LeakDetector }        from '../core/LeakDetector';
import { getSupabaseClient }   from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamPhase =
  | 'idle' | 'starting' | 'live' | 'recovering' | 'ending' | 'ended';

export type StreamRole = 'host' | 'viewer';

export interface StreamHealth {
  phase:          StreamPhase;
  viewerCount:    number;
  bitrateKbps:    number;
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
  stallCount:     number;
  uptimeMs:       number;
  lastUpdated:    number;
}

export interface StreamReaction {
  userId:    string;
  username:  string;
  type:      'like' | 'fire' | 'gift' | 'comment';
  payload?:  string;
  timestamp: number;
}

interface ActiveSession {
  sessionId:   string;
  role:        StreamRole;
  phase:       StreamPhase;
  startedAt:   number;
  health:      StreamHealth;
  leakToken:   string;
  stopPolling: () => void;
}

// ── StreamHealthMonitor ───────────────────────────────────────────────────────

class StreamHealthMonitorImpl {
  private _history: StreamHealth[] = [];
  private _handlers = new Set<(h: StreamHealth) => void>();

  record(health: StreamHealth): void {
    this._history.push({ ...health });
    if (this._history.length > 100) this._history.shift();
    for (const h of this._handlers) {
      try { h(health); } catch { /* isolate */ }
    }
  }

  onUpdate(handler: (h: StreamHealth) => void): () => void {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }

  getHistory(last = 20): StreamHealth[] {
    return this._history.slice(-last);
  }

  getAverageQuality(): StreamHealth['networkQuality'] {
    if (this._history.length === 0) return 'good';
    const poor = this._history.filter(h => h.networkQuality === 'poor').length;
    const fair = this._history.filter(h => h.networkQuality === 'fair').length;
    if (poor / this._history.length > 0.3) return 'poor';
    if (fair / this._history.length > 0.4) return 'fair';
    return 'good';
  }

  clear(): void { this._history = []; }
}

export const StreamHealthMonitor = new StreamHealthMonitorImpl();

// ── LiveOrchestrator ──────────────────────────────────────────────────────────

class LiveOrchestratorImpl {
  private _moderationBlocked = new Set<string>();
  private _reactionQueue = BackpressureQueue.getQueue<StreamReaction>('live-reactions', {
    maxDepth:       200,
    dropStrategy:   'oldest',
    coalescingKeys: [],
  });

  /** Adapt stream quality based on current conditions. */
  adaptQuality(networkQuality: StreamHealth['networkQuality']): void {
    const targetBitrate = {
      excellent: 2500,
      good:      1500,
      fair:      800,
      poor:      400,
    }[networkQuality];

    AdaptiveBitrateManager.adaptStream(`live-host`, networkQuality === 'poor' ? 'down' : 'up');
    console.log('[LiveOrchestrator] quality adapted → target:', targetBitrate, 'kbps');
  }

  /** Push a live reaction through backpressure queue. */
  pushReaction(reaction: Omit<StreamReaction, 'timestamp'>): void {
    this._reactionQueue.push({ ...reaction, timestamp: Date.now() }, 5, reaction.type);
  }

  /** Drain reactions for animation rendering. */
  drainReactions(handler: (reactions: StreamReaction[]) => void): () => void {
    return this._reactionQueue.drain(events => {
      handler(events.map(e => e.payload));
    }, { batchSize: 20, intervalMs: 100, strategy: 'fifo' });
  }

  /** Block a user from sending reactions/comments. */
  blockUser(userId: string): void {
    this._moderationBlocked.add(userId);
    console.log('[LiveOrchestrator] blocked user:', userId);
  }

  unblockUser(userId: string): void {
    this._moderationBlocked.delete(userId);
  }

  isBlocked(userId: string): boolean {
    return this._moderationBlocked.has(userId);
  }

  reset(): void {
    this._moderationBlocked.clear();
    this._reactionQueue.clear();
  }
}

export const LiveOrchestrator = new LiveOrchestratorImpl();

// ── StreamSessionManager ──────────────────────────────────────────────────────

class StreamSessionManagerImpl {
  private _session: ActiveSession | null = null;

  get currentSession():  ActiveSession | null { return this._session; }
  get isActive():        boolean              { return this._session !== null; }
  get currentPhase():    StreamPhase          { return this._session?.phase ?? 'idle'; }

  onHealthUpdate = StreamHealthMonitor.onUpdate.bind(StreamHealthMonitor);

  // ── Host API ───────────────────────────────────────────────────────────────

  async startHostSession(userId: string, title: string): Promise<{
    sessionId: string;
    error?: never;
  } | { error: string }> {
    if (this._session) {
      return { error: 'Session already active' };
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('live_sessions')
        .insert({ host_id: userId, title, status: 'live', viewer_count: 0 })
        .select()
        .single();

      if (error) return { error: error.message };

      const session = this._buildSession(data.id, 'host');
      this._session = session;

      // Start viewer count polling
      const stopPoll = this._startViewerCountPoll(data.id);
      session.stopPolling = stopPoll;

      // Pause on background
      AppLifecycle.onBackground(() => {
        if (this._session?.phase === 'live') {
          console.log('[StreamSessionManager] host went to background — pausing stream');
          this._setPhase('recovering');
        }
      });
      AppLifecycle.onForeground(() => {
        if (this._session?.phase === 'recovering') {
          console.log('[StreamSessionManager] host returned — resuming stream');
          this._setPhase('live');
        }
      });

      EventBus.emit('stream:started', { hostId: userId, sessionId: data.id, title });
      console.log('[StreamSessionManager] host session started:', data.id);
      return { sessionId: data.id };

    } catch (e: any) {
      return { error: e?.message ?? 'Failed to start stream' };
    }
  }

  async endHostSession(): Promise<void> {
    if (!this._session || this._session.role !== 'host') return;
    const { sessionId } = this._session;
    this._setPhase('ending');

    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', sessionId);
    } catch (e: any) {
      console.warn('[StreamSessionManager] end error:', e?.message);
    }

    const viewerCount = this._session.health.viewerCount;
    this._cleanup();
    EventBus.emit('stream:ended', { sessionId, viewerCount });
    console.log('[StreamSessionManager] host session ended:', sessionId);
  }

  // ── Viewer API ─────────────────────────────────────────────────────────────

  async joinViewerSession(sessionId: string, userId: string): Promise<void> {
    if (this._session?.sessionId === sessionId) return;

    const session = this._buildSession(sessionId, 'viewer');
    this._session = session;

    // Poll for stream health (viewer perspective)
    const stopPoll = this._startStreamHealthPoll(sessionId);
    session.stopPolling = stopPoll;

    EventBus.emit('stream:viewer_joined', { sessionId, userId });
    console.log('[StreamSessionManager] viewer joined:', sessionId);
  }

  async leaveViewerSession(): Promise<void> {
    if (!this._session || this._session.role !== 'viewer') return;
    const { sessionId } = this._session;
    this._cleanup();
    console.log('[StreamSessionManager] viewer left:', sessionId);
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  async recoverSession(): Promise<boolean> {
    if (!this._session) return false;
    console.log('[StreamSessionManager] attempting recovery...');
    this._setPhase('recovering');

    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('live_sessions')
        .select('status')
        .eq('id', this._session.sessionId)
        .single();

      if (data?.status === 'live') {
        this._setPhase('live');
        console.log('[StreamSessionManager] recovery successful');
        return true;
      }
    } catch { /* ignore */ }

    this._setPhase('ended');
    this._cleanup();
    return false;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private _cleanup(): void {
    if (!this._session) return;
    this._session.stopPolling();
    this._setPhase('ended');
    LeakDetector.release(this._session.leakToken);
    LiveOrchestrator.reset();
    StreamHealthMonitor.clear();
    this._session = null;
    PollingManager.unregister('stream:viewer-count');
    PollingManager.unregister('stream:health');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _buildSession(sessionId: string, role: StreamRole): ActiveSession {
    return {
      sessionId,
      role,
      phase: 'live',
      startedAt: Date.now(),
      leakToken: LeakDetector.track('socket', `stream:${sessionId}`, 'StreamSessionManager'),
      stopPolling: () => {},
      health: {
        phase:          'live',
        viewerCount:    0,
        bitrateKbps:    1500,
        networkQuality: 'good',
        stallCount:     0,
        uptimeMs:       0,
        lastUpdated:    Date.now(),
      },
    };
  }

  private _startViewerCountPoll(sessionId: string): () => void {
    PollingManager.register({
      key:           'stream:viewer-count',
      intervalMs:    5_000,
      backgroundFactor: 0,
      fn: async () => {
        if (!this._session) return;
        try {
          const supabase = getSupabaseClient();
          const { data } = await supabase
            .from('live_sessions')
            .select('viewer_count')
            .eq('id', sessionId)
            .single();
          if (data && this._session) {
            this._session.health.viewerCount = data.viewer_count;
            this._session.health.uptimeMs = Date.now() - this._session.startedAt;
            this._session.health.lastUpdated = Date.now();
            StreamHealthMonitor.record(this._session.health);
          }
        } catch { /* ignore */ }
      },
    });
    return () => PollingManager.unregister('stream:viewer-count');
  }

  private _startStreamHealthPoll(sessionId: string): () => void {
    PollingManager.register({
      key:           'stream:health',
      intervalMs:    3_000,
      backgroundFactor: 0,
      fn: async () => {
        if (!this._session) return;
        try {
          const supabase = getSupabaseClient();
          const { data } = await supabase
            .from('live_sessions')
            .select('status, viewer_count')
            .eq('id', sessionId)
            .single();
          if (!data || data.status !== 'live') {
            this._cleanup();
            EventBus.emit('stream:ended', { sessionId, viewerCount: 0 });
            return;
          }
          if (this._session) {
            this._session.health.viewerCount = data.viewer_count;
            this._session.health.uptimeMs = Date.now() - this._session.startedAt;
            this._session.health.lastUpdated = Date.now();
            StreamHealthMonitor.record(this._session.health);
          }
        } catch { /* ignore */ }
      },
    });
    return () => PollingManager.unregister('stream:health');
  }

  private _setPhase(phase: StreamPhase): void {
    if (!this._session) return;
    this._session.phase = phase;
    this._session.health.phase = phase;
    if (this._session.phase === 'live' || this._session.phase === 'recovering') {
      StreamHealthMonitor.record(this._session.health);
    }
  }
}

export const StreamSessionManager = new StreamSessionManagerImpl();
