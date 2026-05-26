/**
 * modules/streaming/LiveOrchestrator.ts — v2 Real streaming pipeline
 *
 * Phase 4 cleanup:
 *   - startHostSession: removed naked throw — returns typed error object instead
 *   - PresenceManager.setStatus: removed undefined second arg (typed correctly)
 *   - _giftQueue construction: graceful init, no throw if BackpressureQueue unavailable
 *   - _startThermalWatcher: stores unsub correctly (was overwriting null)
 *   - end(): calls _thermalUnsub safely, double-end guard
 *   - _attemptRecovery(): exponential backoff capped at 16s, no unhandled throw
 *   - Reaction map: reset on end to free memory
 *   - Cleanup: guaranteed even if Supabase throws
 *   - PresenceManager.registerStreamSession / unregisterStreamSession used correctly
 */

import { EventBus }               from '../core/EventBus';
import { PollingManager }         from '../realtime/PollingManager';
import { BackpressureQueue }      from '../core/BackpressureQueue';
import { AdaptiveQualityController } from '../core/AdaptiveQualityController';
import { SecurityManager }        from '../core/SecurityManager';
import { CrashIntelligence }      from '../core/CrashIntelligence';
import { ThermalMonitor }         from '../core/ThermalMonitor';
import { PresenceManager }        from '../realtime/PresenceManager';
import { getSupabaseClient }      from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamHealth     = 'excellent' | 'good' | 'degraded' | 'poor' | 'critical';
export type StreamQualityTier = 'hd' | 'sd' | 'ld';

export interface StreamQualityProfile {
  tier:        StreamQualityTier;
  bitrateKbps: number;
  fps:         number;
  width:       number;
  height:      number;
}

export const QUALITY_PROFILES: Record<StreamQualityTier, StreamQualityProfile> = {
  hd: { tier: 'hd', bitrateKbps: 2500, fps: 30, width: 1280, height: 720 },
  sd: { tier: 'sd', bitrateKbps: 1200, fps: 24, width: 854,  height: 480 },
  ld: { tier: 'ld', bitrateKbps: 500,  fps: 15, width: 640,  height: 360 },
};

export interface HostSession {
  sessionId:    string;
  hostId:       string;
  title:        string;
  startedAt:    number;
  viewerCount:  number;
  healthScore:  number;
  health:       StreamHealth;
  qualityTier:  StreamQualityTier;

  onHealthChange:      (cb: (score: number, health: StreamHealth) => void) => () => void;
  onViewerCountChange: (cb: (count: number) => void) => () => void;
  onGift:              (cb: (gift: any) => void) => () => void;
  onModerationEvent:   (cb: (event: any) => void) => () => void;
  onQualityChange:     (cb: (profile: StreamQualityProfile) => void) => () => void;
  onRecovery:          (cb: (attempt: number) => void) => () => void;
  setTitle:            (title: string) => Promise<void>;
  addReaction:         (userId: string, type: string) => boolean;
  end:                 () => Promise<void>;
}

export interface StartSessionResult {
  session: HostSession | null;
  error:   string | null;
}

// ── LiveOrchestrator ──────────────────────────────────────────────────────────

class LiveOrchestratorImpl {
  private _activeSessions = new Map<string, HostSessionImpl>();

  /**
   * Start a host live session.
   * Returns { session, error } — never throws.
   */
  async startHostSession(hostId: string, title: string): Promise<StartSessionResult> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('live_sessions')
        .insert({ host_id: hostId, title, status: 'live', viewer_count: 0 })
        .select()
        .single();

      if (error || !data) {
        const msg = error?.message ?? 'Failed to create session';
        console.warn('[LiveOrchestrator] startHostSession error:', msg);
        return { session: null, error: msg };
      }

      PresenceManager.registerStreamSession(data.id);

      const session = new HostSessionImpl(data.id, hostId, title);
      this._activeSessions.set(data.id, session);

      CrashIntelligence.addBreadcrumb('state', 'Live session started', { sessionId: data.id, hostId });
      EventBus.emit('stream:started' as any, { hostId, sessionId: data.id, title });
      console.log('[LiveOrchestrator] host session started:', data.id);
      return { session, error: null };
    } catch (e: any) {
      const msg = e?.message ?? 'Unknown error starting stream';
      console.warn('[LiveOrchestrator] startHostSession exception:', msg);
      return { session: null, error: msg };
    }
  }

  getSession(sessionId: string): HostSession | undefined {
    return this._activeSessions.get(sessionId);
  }

  async endAll(): Promise<void> {
    for (const session of this._activeSessions.values()) {
      await session.end();
    }
    this._activeSessions.clear();
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
  health:       StreamHealth      = 'excellent';
  qualityTier:  StreamQualityTier = 'hd';

  private _healthCbs      = new Set<(score: number, h: StreamHealth) => void>();
  private _viewerCbs      = new Set<(count: number) => void>();
  private _giftCbs        = new Set<(gift: any) => void>();
  private _moderationCbs  = new Set<(event: any) => void>();
  private _qualityCbs     = new Set<(profile: StreamQualityProfile) => void>();
  private _recoveryCbs    = new Set<(attempt: number) => void>();

  private _pollKey:       string;
  private _giftQueue:     any = null;
  private _degradeCount   = 0;
  private _ended          = false;
  private _recoveryCount  = 0;
  private readonly _maxRecovery = 3;
  private _thermalUnsub:  (() => void) | null = null;

  private _reactionCounts = new Map<string, { count: number; reset: number }>();
  private readonly REACTION_LIMIT = 5;

  constructor(sessionId: string, hostId: string, title: string) {
    this.sessionId = sessionId;
    this.hostId    = hostId;
    this.title     = title;
    this.startedAt = Date.now();
    this._pollKey  = `live:${sessionId}`;

    // Gift queue — flush every 200ms, max 100 items
    try {
      this._giftQueue = new (BackpressureQueue as any)({
        maxSize:       100,
        flushInterval: 200,
        onFlush:       (items: any[]) => {
          for (const gift of items) {
            for (const cb of this._giftCbs) { try { cb(gift); } catch { /* isolate */ } }
          }
        },
      });
    } catch { /* BackpressureQueue may not be in all builds */ }

    this._startPolling();
    this._startHealthMonitor();
    this._startThermalWatcher();
  }

  // ── HostSession API ────────────────────────────────────────────────────────

  onHealthChange(cb: (s: number, h: StreamHealth) => void): () => void {
    this._healthCbs.add(cb);
    return () => this._healthCbs.delete(cb);
  }
  onViewerCountChange(cb: (n: number) => void): () => void {
    this._viewerCbs.add(cb);
    return () => this._viewerCbs.delete(cb);
  }
  onGift(cb: (g: any) => void): () => void {
    this._giftCbs.add(cb);
    return () => this._giftCbs.delete(cb);
  }
  onModerationEvent(cb: (e: any) => void): () => void {
    this._moderationCbs.add(cb);
    return () => this._moderationCbs.delete(cb);
  }
  onQualityChange(cb: (p: StreamQualityProfile) => void): () => void {
    this._qualityCbs.add(cb);
    return () => this._qualityCbs.delete(cb);
  }
  onRecovery(cb: (attempt: number) => void): () => void {
    this._recoveryCbs.add(cb);
    return () => this._recoveryCbs.delete(cb);
  }

  addReaction(userId: string, type: string): boolean {
    const now   = Date.now();
    const entry = this._reactionCounts.get(userId);
    if (entry) {
      if (now < entry.reset) {
        if (entry.count >= this.REACTION_LIMIT) return false;
        entry.count++;
      } else {
        entry.count = 1;
        entry.reset = now + 1000;
      }
    } else {
      this._reactionCounts.set(userId, { count: 1, reset: now + 1000 });
    }
    EventBus.emit('stream:reaction' as any, { sessionId: this.sessionId, userId, type });
    return true;
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

    // Unregister polls
    PollingManager.unregister(this._pollKey);
    PollingManager.unregister(`health:${this.sessionId}`);

    // Cleanup thermal watcher
    if (this._thermalUnsub) {
      try { this._thermalUnsub(); } catch { /* ignore */ }
      this._thermalUnsub = null;
    }

    // Update Supabase session
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', this.sessionId);
    } catch { /* non-critical — session may already be deleted */ }

    // Reset presence
    try {
      PresenceManager.unregisterStreamSession();
    } catch { /* ignore */ }

    CrashIntelligence.addBreadcrumb('state', 'Live session ended', { sessionId: this.sessionId });
    EventBus.emit('stream:ended' as any, { sessionId: this.sessionId, viewerCount: this.viewerCount });

    // Clear all callbacks and state
    this._healthCbs.clear();
    this._viewerCbs.clear();
    this._giftCbs.clear();
    this._moderationCbs.clear();
    this._qualityCbs.clear();
    this._recoveryCbs.clear();
    this._reactionCounts.clear();
    console.log('[LiveOrchestrator] session ended:', this.sessionId);
  }

  // ── Private: polling ───────────────────────────────────────────────────────

  private _startPolling(): void {
    PollingManager.register({
      key:              this._pollKey,
      intervalMs:       3_000,
      backgroundFactor: 0,
      fn:               () => this._pollSession(),
    });
  }

  private async _pollSession(): Promise<void> {
    if (this._ended) return;
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('live_sessions')
        .select('viewer_count, status')
        .eq('id', this.sessionId)
        .single();

      if (error) {
        this._attemptRecovery();
        return;
      }

      if (data) {
        if (data.viewer_count !== this.viewerCount) {
          this.viewerCount = data.viewer_count ?? 0;
          for (const cb of this._viewerCbs) { try { cb(this.viewerCount); } catch { /* isolate */ } }
        }
        if (data.status === 'ended') {
          await this.end();
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Private: health monitor ────────────────────────────────────────────────

  private _startHealthMonitor(): void {
    PollingManager.register({
      key:              `health:${this.sessionId}`,
      intervalMs:       5_000,
      backgroundFactor: 0,
      fn:               () => this._computeHealth(),
    });
  }

  private async _computeHealth(): Promise<void> {
    if (this._ended) return;

    let score = 100;

    // Thermal penalty
    const thermal = ThermalMonitor.currentState;
    if (thermal === 'critical')  score -= 40;
    else if (thermal === 'serious') score -= 20;
    else if (thermal === 'fair')    score -= 5;

    // Quality level penalty
    try {
      const profile = AdaptiveQualityController.getProfile?.();
      if (profile?.level === 'emergency') score -= 30;
      else if (profile?.level === 'minimal')   score -= 25;
      else if (profile?.level === 'reduced')   score -= 10;
    } catch { /* ignore */ }

    score -= this._degradeCount * 3;
    score  = Math.max(0, Math.min(100, score));

    // Auto quality downgrade
    const newTier: StreamQualityTier = score >= 80 ? 'hd' : score >= 50 ? 'sd' : 'ld';
    if (newTier !== this.qualityTier) {
      this.qualityTier = newTier;
      this._degradeCount++;
      for (const cb of this._qualityCbs) { try { cb(QUALITY_PROFILES[newTier]); } catch { /* isolate */ } }
      console.log('[LiveOrchestrator] quality →', newTier, 'score:', score);
    }

    const health = this._scoreToHealth(score);
    if (score !== this.healthScore || health !== this.health) {
      this.healthScore = score;
      this.health      = health;
      for (const cb of this._healthCbs) { try { cb(score, health); } catch { /* isolate */ } }
    }
  }

  // ── Private: thermal watcher ──────────────────────────────────────────────

  private _startThermalWatcher(): void {
    // Stored as unsub function so end() can clean it up
    this._thermalUnsub = EventBus.on('thermal:state_changed' as any, (evt: any) => {
      if (this._ended) return;
      const state = evt?.state ?? ThermalMonitor.currentState;
      if (state === 'critical' && this.qualityTier !== 'ld') {
        this.qualityTier = 'ld';
        for (const cb of this._qualityCbs) { try { cb(QUALITY_PROFILES.ld); } catch { /* isolate */ } }
        console.warn('[LiveOrchestrator] thermal critical → forced LD');
      } else if (state === 'nominal' && this.qualityTier === 'ld' && this._degradeCount === 0) {
        this.qualityTier = 'hd';
        for (const cb of this._qualityCbs) { try { cb(QUALITY_PROFILES.hd); } catch { /* isolate */ } }
        console.log('[LiveOrchestrator] thermal nominal → restored HD');
      }
    });
  }

  // ── Private: stream recovery ───────────────────────────────────────────────

  private _attemptRecovery(): void {
    if (this._ended || this._recoveryCount >= this._maxRecovery) return;
    this._recoveryCount++;
    for (const cb of this._recoveryCbs) { try { cb(this._recoveryCount); } catch { /* isolate */ } }
    console.warn('[LiveOrchestrator] stream recovery attempt:', this._recoveryCount);

    const delayMs = Math.min(2000 * Math.pow(2, this._recoveryCount - 1), 16_000);

    setTimeout(async () => {
      if (this._ended) return;
      try {
        const supabase = getSupabaseClient();
        await supabase.from('live_sessions').upsert({
          id:           this.sessionId,
          host_id:      this.hostId,
          title:        this.title,
          status:       'live',
          viewer_count: this.viewerCount,
        });
        this._recoveryCount = 0;
        console.log('[LiveOrchestrator] session recovered:', this.sessionId);
      } catch (e: any) {
        console.warn('[LiveOrchestrator] recovery failed:', e?.message);
      }
    }, delayMs);
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
