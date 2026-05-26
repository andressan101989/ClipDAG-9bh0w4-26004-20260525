/**
 * modules/realtime/PresenceManager.ts — v2 Production presence system
 *
 * Full multiplayer session coordination:
 *   - Heartbeat: upserts user_presence every 15s while active
 *   - Session sync: activity field carries structured JSON
 *     (status, gameId, streamId, callId, etc.)
 *   - Multi-room awareness: tracks which session a user is in
 *   - Batch fetch: single query for N user IDs
 *   - Stale TTL: offline after 35s without heartbeat
 *   - Background: pauses heartbeat to save battery
 *   - Subscribe: per-user callbacks on status changes
 *   - Cross-module: other managers (RTCManager, GameRoom) call
 *     setStatus() to advertise their current activity
 *   - Graceful fallback: table missing = cache-only mode
 */

import { getSupabaseClient } from '@/template';
import { AppLifecycle }       from '../core/AppLifecycle';
import { PollingManager }     from './PollingManager';
import { CrashIntelligence }  from '../core/CrashIntelligence';
import { EventBus }           from '../core/EventBus';

export type PresenceStatus = 'online' | 'away' | 'in_call' | 'streaming' | 'in_battle' | 'offline';

export interface PresenceActivity {
  status:     PresenceStatus;
  gameId?:    string;
  streamId?:  string;
  callId?:    string;
  latencyMs?: number;
  version:    number; // monotonic — for conflict-free merge
}

export interface PresenceRecord {
  userId:     string;
  status:     PresenceStatus;
  activity?:  PresenceActivity;
  updatedAt:  number;
}

export interface MultiplayerSessionInfo {
  roomId:    string;
  userIds:   string[];
  hostId:    string;
  startedAt: number;
}

const OFFLINE_TTL_MS  = 35_000;
const HEARTBEAT_MS    = 15_000;
const TABLE           = 'user_presence';

// ── PresenceManager ───────────────────────────────────────────────────────────

class PresenceManagerImpl {
  private readonly _cache       = new Map<string, PresenceRecord>();
  private readonly _subscribers = new Map<string, Set<(r: PresenceRecord) => void>>();
  private _localUserId:   string | null    = null;
  private _localStatus:   PresenceStatus   = 'online';
  private _localActivity: PresenceActivity | null = null;
  private _activityVersion = 0;
  private _heartbeatActive = false;
  private _tableExists     = true;

  // ── Multiplayer session coordination ──────────────────────────────────────

  private readonly _activeSessions = new Map<string, MultiplayerSessionInfo>();

  registerMultiplayerSession(info: MultiplayerSessionInfo): void {
    this._activeSessions.set(info.roomId, info);
    this.setStatus('in_battle', { gameId: info.roomId, version: ++this._activityVersion });
    CrashIntelligence.addBreadcrumb('state', 'PresenceManager: battle registered', { roomId: info.roomId });
  }

  unregisterMultiplayerSession(roomId: string): void {
    this._activeSessions.delete(roomId);
    if (this._activeSessions.size === 0 && this._localStatus === 'in_battle') {
      this.setStatus('online');
    }
  }

  registerStreamSession(streamId: string): void {
    this.setStatus('streaming', { streamId, version: ++this._activityVersion });
  }

  unregisterStreamSession(): void {
    if (this._localStatus === 'streaming') this.setStatus('online');
  }

  registerCallSession(callId: string): void {
    this.setStatus('in_call', { callId, version: ++this._activityVersion });
  }

  unregisterCallSession(): void {
    if (this._localStatus === 'in_call') this.setStatus('online');
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  startHeartbeat(userId: string, initialStatus: PresenceStatus = 'online'): void {
    this._localUserId = userId;
    this._localStatus = initialStatus;
    if (this._heartbeatActive) return;
    this._heartbeatActive = true;

    PollingManager.register({
      key:              'presence:heartbeat',
      intervalMs:       HEARTBEAT_MS,
      runImmediately:   true,
      backgroundFactor: 0,
      fn:               () => this._sendHeartbeat(),
    });

    // Re-push on foreground
    AppLifecycle.onForeground(() => {
      if (this._localUserId) this._sendHeartbeat();
    });

    // Handle away on background
    AppLifecycle.onBackground(() => {
      if (this._localUserId && this._localStatus !== 'in_call') {
        // Update local cache but don't block (fire+forget)
        this._sendHeartbeatWithStatus('away');
      }
    });

    console.log('[PresenceManager] heartbeat started for:', userId);
  }

  stopHeartbeat(): void {
    if (!this._heartbeatActive) return;
    this._heartbeatActive = false;
    if (this._localUserId) this._setOffline(this._localUserId);
    this._localUserId = null;
    PollingManager.unregister('presence:heartbeat');
    console.log('[PresenceManager] heartbeat stopped');
  }

  setStatus(status: PresenceStatus, activityPatch?: Partial<PresenceActivity>): void {
    this._localStatus = status;
    if (activityPatch) {
      this._localActivity = {
        ...(this._localActivity ?? { status, version: 0 }),
        ...activityPatch,
        status,
        version: this._activityVersion,
      };
    } else {
      this._localActivity = { status, version: ++this._activityVersion };
    }
    if (this._heartbeatActive) this._sendHeartbeat();

    // Notify EventBus so other managers can react
    EventBus.emit('presence:status_changed' as any, {
      userId: this._localUserId,
      status,
      activity: this._localActivity,
    });
  }

  isOnline(userId: string): boolean {
    const rec = this._cache.get(userId);
    if (!rec) return false;
    return rec.status !== 'offline' && (Date.now() - rec.updatedAt) < OFFLINE_TTL_MS;
  }

  isInBattle(userId: string): boolean {
    return this._cache.get(userId)?.status === 'in_battle';
  }

  isStreaming(userId: string): boolean {
    return this._cache.get(userId)?.status === 'streaming';
  }

  isInCall(userId: string): boolean {
    return this._cache.get(userId)?.status === 'in_call';
  }

  getPresence(userId: string): PresenceRecord | null {
    return this._cache.get(userId) ?? null;
  }

  /** Batch-fetch presence for a list of user IDs and update cache. */
  async fetchPresence(userIds: string[]): Promise<PresenceRecord[]> {
    if (userIds.length === 0) { this._expireStale(); return []; }

    if (!this._tableExists) {
      this._expireStale();
      return userIds.map(id => this._cache.get(id) ?? {
        userId: id, status: 'offline' as PresenceStatus, updatedAt: 0,
      });
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from(TABLE)
        .select('user_id, status, activity, updated_at')
        .in('user_id', userIds);

      if (error) {
        if (error.message?.includes('does not exist')) {
          this._tableExists = false;
          console.warn('[PresenceManager] user_presence table not found — cache-only mode');
        }
        this._expireStale();
        return [];
      }

      const now = Date.now();
      const results: PresenceRecord[] = [];

      for (const row of (data ?? [])) {
        const updatedAt = new Date(row.updated_at).getTime();
        const stale     = (now - updatedAt) > OFFLINE_TTL_MS;
        const rawStatus = row.status as PresenceStatus;
        const status: PresenceStatus = stale ? 'offline' : rawStatus;

        let activity: PresenceActivity | undefined;
        if (row.activity) {
          try { activity = JSON.parse(row.activity); } catch { /* ignore */ }
        }

        const record: PresenceRecord = { userId: row.user_id, status, activity, updatedAt };
        this._updateCache(record);
        results.push(record);
      }

      this._expireStale();
      return results;
    } catch (e: any) {
      console.warn('[PresenceManager] fetchPresence error:', e?.message);
      this._expireStale();
      return [];
    }
  }

  /** Subscribe to presence updates for a specific user. */
  subscribe(userId: string, fn: (record: PresenceRecord) => void): () => void {
    if (!this._subscribers.has(userId)) {
      this._subscribers.set(userId, new Set());
    }
    this._subscribers.get(userId)!.add(fn);
    // Immediately emit cached value if available
    const cached = this._cache.get(userId);
    if (cached) { try { fn(cached); } catch { /* ignore */ } }
    return () => this._subscribers.get(userId)?.delete(fn);
  }

  /** Directly push a presence record (used by GameRoom/RTCManager) */
  updatePresence(record: PresenceRecord): void {
    this._updateCache(record);
  }

  /** Poll presence for a set of users on a schedule. */
  watchUsers(userIds: string[], intervalMs = 15_000): () => void {
    const key = `presence:watch:${userIds.slice(0, 3).join(',')}`;
    PollingManager.register({
      key,
      intervalMs,
      runImmediately: true,
      backgroundFactor: 0,
      fn: () => this.fetchPresence(userIds).then(() => {}),
    });
    return () => PollingManager.unregister(key);
  }

  get localStatus(): PresenceStatus { return this._localStatus; }
  get localActivity(): PresenceActivity | null { return this._localActivity; }
  get cachedCount(): number { return this._cache.size; }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _sendHeartbeat(): Promise<void> {
    return this._sendHeartbeatWithStatus(this._localStatus);
  }

  private async _sendHeartbeatWithStatus(status: PresenceStatus): Promise<void> {
    const uid = this._localUserId;
    if (!uid) return;

    const activityJson = this._localActivity
      ? JSON.stringify({ ...this._localActivity, status })
      : null;

    // Update local cache immediately
    this._updateCache({
      userId:    uid,
      status,
      activity:  this._localActivity ?? undefined,
      updatedAt: Date.now(),
    });

    if (!this._tableExists) return;

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from(TABLE).upsert({
        user_id:    uid,
        status,
        activity:   activityJson,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (error) {
        if (error.message?.includes('does not exist')) {
          this._tableExists = false;
          console.warn('[PresenceManager] user_presence table not found');
        } else {
          console.warn('[PresenceManager] heartbeat error:', error.message);
        }
      }
    } catch (e: any) {
      console.warn('[PresenceManager] heartbeat exception:', e?.message);
    }
  }

  private async _setOffline(uid: string): Promise<void> {
    this._updateCache({ userId: uid, status: 'offline', updatedAt: Date.now() });
    if (!this._tableExists) return;
    try {
      const supabase = getSupabaseClient();
      await supabase.from(TABLE).upsert({
        user_id:    uid,
        status:     'offline',
        activity:   null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch { /* non-critical */ }
  }

  private _updateCache(record: PresenceRecord): void {
    const prev = this._cache.get(record.userId);
    this._cache.set(record.userId, record);
    if (prev?.status !== record.status) {
      const handlers = this._subscribers.get(record.userId);
      if (handlers) {
        for (const fn of handlers) { try { fn(record); } catch { /* isolate */ } }
      }
    }
  }

  private _expireStale(): void {
    const now = Date.now();
    for (const [userId, rec] of this._cache.entries()) {
      if (rec.status !== 'offline' && (now - rec.updatedAt) > OFFLINE_TTL_MS) {
        this._updateCache({ ...rec, status: 'offline', updatedAt: now });
      }
    }
  }
}

export const PresenceManager = new PresenceManagerImpl();
