/**
 * modules/realtime/PresenceManager.ts — v3 Production
 *
 * Real implementation:
 *   - Online/offline sync via Supabase user_presence table
 *   - Realtime activity broadcast (typing, watching, live, gaming)
 *   - Session coordination: registers active session types
 *   - watchUsers: polls multiple user presences at configurable interval
 *   - AppLifecycle: marks user away on background, online on foreground
 *   - Guaranteed cleanup on destroy()
 *   - No throw — all errors handled gracefully
 */

import { EventBus }    from '../core/EventBus';
import { AppLifecycle }from '../core/AppLifecycle';

export type OnlineStatus = 'online' | 'away' | 'offline';
export type ActivityType = 'idle' | 'watching' | 'live_streaming' | 'gaming' | 'typing' | 'call';

export interface PresenceData {
  userId:     string;
  status:     OnlineStatus;
  activity:   ActivityType | null;
  sessionType:string | null;  // 'call' | 'live' | 'battle' | null
  updatedAt:  number;
}

export interface WatchedUser {
  userId:  string;
  presence:PresenceData | null;
}

const POLL_INTERVAL_DEFAULT_MS = 15_000;
const AWAY_TIMEOUT_MS          = 5_000;   // ms after background before marking away
const OFFLINE_TIMEOUT_MS       = 30_000;  // ms after background before marking offline

class PresenceManagerImpl {
  private _userId:       string | null = null;
  private _status:       OnlineStatus  = 'offline';
  private _activity:     ActivityType | null = null;
  private _sessionType:  string | null = null;
  private _watchedIds:   Set<string>   = new Set();
  private _watchedData:  Map<string, PresenceData> = new Map();
  private _pollTimer:    ReturnType<typeof setInterval> | null = null;
  private _awayTimer:    ReturnType<typeof setTimeout>  | null = null;
  private _offlineTimer: ReturnType<typeof setTimeout>  | null = null;
  private _pollInterval  = POLL_INTERVAL_DEFAULT_MS;
  private _changeHandlers= new Set<(users: WatchedUser[]) => void>();
  private _unsubs:       Array<() => void> = [];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  initialize(userId: string): void {
    this._userId = userId;
    this._status = 'online';

    // Background/foreground lifecycle
    this._unsubs.push(
      AppLifecycle.onBackground(() => {
        this._clearAwayTimer();
        // Mark away after short delay
        this._awayTimer = setTimeout(() => {
          if (this._status === 'online') this.setStatus('away');
        }, AWAY_TIMEOUT_MS);
        // Mark offline after longer delay
        this._offlineTimer = setTimeout(() => {
          this.setStatus('offline');
          this._stopPolling();
        }, OFFLINE_TIMEOUT_MS);
      }),
      AppLifecycle.onForeground(() => {
        this._clearAwayTimer();
        this._clearOfflineTimer();
        this.setStatus('online');
        if (this._watchedIds.size > 0) this._startPolling();
      }),
    );

    // Broadcast online immediately
    this._upsertPresence('online', null).catch(() => {});
    console.log('[PresenceManager] initialized:', userId);
  }

  async destroy(): Promise<void> {
    this._clearAwayTimer();
    this._clearOfflineTimer();
    this._stopPolling();
    for (const fn of this._unsubs) { try { fn(); } catch { /* ignore */ } }
    this._unsubs = [];

    if (this._userId) {
      await this._upsertPresence('offline', null).catch(() => {});
    }
    this._userId    = null;
    this._status    = 'offline';
    this._watchedIds.clear();
    this._watchedData.clear();
    this._changeHandlers.clear();
    console.log('[PresenceManager] destroyed');
  }

  // ── Status & Activity ─────────────────────────────────────────────────────

  get currentStatus(): OnlineStatus         { return this._status; }
  get currentActivity(): ActivityType | null{ return this._activity; }

  async setStatus(status: OnlineStatus): Promise<void> {
    if (this._status === status || !this._userId) return;
    this._status = status;
    await this._upsertPresence(status, this._activity).catch(() => {});
    EventBus.emit('presence:status_changed' as any, { userId: this._userId, status });
  }

  async setActivity(activity: ActivityType | null): Promise<void> {
    if (!this._userId) return;
    this._activity = activity;
    await this._upsertPresence(this._status, activity).catch(() => {});
  }

  async registerSession(type: 'call' | 'live' | 'battle' | null): Promise<void> {
    this._sessionType = type;
    const activity: ActivityType | null =
      type === 'call'   ? 'call'
      : type === 'live'   ? 'live_streaming'
      : type === 'battle' ? 'gaming'
      : null;
    await this.setActivity(activity);
  }

  // ── Watch users ───────────────────────────────────────────────────────────

  watchUsers(userIds: string[], intervalMs = POLL_INTERVAL_DEFAULT_MS): void {
    for (const id of userIds) this._watchedIds.add(id);
    this._pollInterval = intervalMs;
    if (this._watchedIds.size > 0) {
      this._startPolling();
      this._pollOnce().catch(() => {});
    }
  }

  unwatchUsers(userIds: string[]): void {
    for (const id of userIds) {
      this._watchedIds.delete(id);
      this._watchedData.delete(id);
    }
    if (this._watchedIds.size === 0) this._stopPolling();
  }

  onPresenceChange(fn: (users: WatchedUser[]) => void): () => void {
    this._changeHandlers.add(fn);
    return () => this._changeHandlers.delete(fn);
  }

  getPresence(userId: string): PresenceData | null {
    return this._watchedData.get(userId) ?? null;
  }

  isOnline(userId: string): boolean {
    const p = this._watchedData.get(userId);
    return p?.status === 'online';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _upsertPresence(
    status:   OnlineStatus,
    activity: ActivityType | null,
  ): Promise<void> {
    if (!this._userId) return;
    try {
      const { getSupabaseClient } = require('../../template');
      const supabase = getSupabaseClient();
      await supabase.from('user_presence').upsert({
        user_id:    this._userId,
        status,
        activity:   activity ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch (e: any) {
      console.warn('[PresenceManager] upsert error:', e?.message);
    }
  }

  private async _pollOnce(): Promise<void> {
    if (this._watchedIds.size === 0) return;
    try {
      const { getSupabaseClient } = require('../../template');
      const supabase = getSupabaseClient();
      const ids = Array.from(this._watchedIds);
      const { data } = await supabase
        .from('user_presence')
        .select('user_id, status, activity, updated_at')
        .in('user_id', ids);

      if (!data) return;
      const now = Date.now();

      for (const row of data) {
        const updatedAt = new Date(row.updated_at).getTime();
        // Mark offline if not updated in 2 minutes
        const effectiveStatus: OnlineStatus =
          now - updatedAt > 120_000 ? 'offline' : (row.status as OnlineStatus) ?? 'offline';

        const prev = this._watchedData.get(row.user_id);
        const next: PresenceData = {
          userId:      row.user_id,
          status:      effectiveStatus,
          activity:    (row.activity as ActivityType) ?? null,
          sessionType: null,
          updatedAt,
        };
        this._watchedData.set(row.user_id, next);

        if (!prev || prev.status !== next.status || prev.activity !== next.activity) {
          EventBus.emit('presence:user_changed' as any, { userId: row.user_id, presence: next });
        }
      }

      // Users not in response are offline
      for (const id of ids) {
        if (!data.find((r: any) => r.user_id === id)) {
          const prev = this._watchedData.get(id);
          if (!prev || prev.status !== 'offline') {
            const offline: PresenceData = {
              userId: id, status: 'offline', activity: null,
              sessionType: null, updatedAt: 0,
            };
            this._watchedData.set(id, offline);
            EventBus.emit('presence:user_changed' as any, { userId: id, presence: offline });
          }
        }
      }

      this._notifyChange();
    } catch (e: any) {
      console.warn('[PresenceManager] poll error:', e?.message);
    }
  }

  private _startPolling(): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._pollOnce().catch(() => {}), this._pollInterval);
  }

  private _stopPolling(): void {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  private _clearAwayTimer(): void {
    if (this._awayTimer) { clearTimeout(this._awayTimer); this._awayTimer = null; }
  }

  private _clearOfflineTimer(): void {
    if (this._offlineTimer) { clearTimeout(this._offlineTimer); this._offlineTimer = null; }
  }

  private _notifyChange(): void {
    const users: WatchedUser[] = Array.from(this._watchedIds).map(id => ({
      userId:   id,
      presence: this._watchedData.get(id) ?? null,
    }));
    for (const fn of this._changeHandlers) { try { fn(users); } catch { /* isolate */ } }
  }
}

export const PresenceManager = new PresenceManagerImpl();
