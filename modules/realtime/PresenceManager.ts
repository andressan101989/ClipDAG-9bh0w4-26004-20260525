/**
 * modules/realtime/PresenceManager.ts — Real Supabase presence system
 *
 * Uses user_profiles.updated_at / a lightweight `user_presence` approach:
 *   - Heartbeat: upserts a presence row every 15s while app is active
 *   - isOnline: checks cache for TTL < 35s
 *   - Batch fetch: queries Supabase for a list of userIds
 *   - Background: pauses heartbeat to save battery (backgroundFactor: 0)
 *   - Cleanup: stopHeartbeat() removes polling + marks user offline
 *
 * Presence table (apply migration if not present):
 *   user_presence (
 *     user_id    uuid primary key references user_profiles(id) on delete cascade,
 *     status     text not null default 'online',
 *     activity   text,
 *     updated_at timestamptz not null default now()
 *   )
 *
 * Falls back gracefully if table doesn't exist — no crashes.
 */

import { getSupabaseClient } from '@/template';
import { AppLifecycle }       from '../core/AppLifecycle';
import { PollingManager }     from './PollingManager';

export type PresenceStatus = 'online' | 'away' | 'in_call' | 'streaming' | 'offline';

export interface PresenceRecord {
  userId:    string;
  status:    PresenceStatus;
  activity?: string;
  updatedAt: number;   // epoch ms
}

const OFFLINE_TTL_MS = 35_000;
const HEARTBEAT_MS   = 15_000;
const TABLE = 'user_presence';

// ── PresenceManager ───────────────────────────────────────────────────────────

class PresenceManagerImpl {
  private readonly _cache       = new Map<string, PresenceRecord>();
  private readonly _subscribers = new Map<string, Set<(status: PresenceStatus) => void>>();
  private _localUserId:  string | null      = null;
  private _localStatus:  PresenceStatus     = 'online';
  private _localActivity?: string;
  private _heartbeatActive = false;
  private _tableExists     = true;   // assume true until proven otherwise

  // ── Public API ─────────────────────────────────────────────────────────────

  startHeartbeat(userId: string, initialStatus: PresenceStatus = 'online'): void {
    this._localUserId  = userId;
    this._localStatus  = initialStatus;
    if (this._heartbeatActive) return;
    this._heartbeatActive = true;

    PollingManager.register({
      key:              'presence:heartbeat',
      intervalMs:       HEARTBEAT_MS,
      runImmediately:   true,
      backgroundFactor: 0,   // pause in background — saves battery
      fn:               () => this._sendHeartbeat(),
    });

    // Re-send heartbeat on foreground
    AppLifecycle.onForeground(() => {
      if (this._localUserId) this._sendHeartbeat();
    });

    console.log('[PresenceManager] heartbeat started for:', userId);
  }

  stopHeartbeat(): void {
    if (!this._heartbeatActive) return;
    this._heartbeatActive = false;

    // Mark offline before stopping
    if (this._localUserId) {
      this._setOffline(this._localUserId);
    }

    this._localUserId = null;
    PollingManager.unregister('presence:heartbeat');
    console.log('[PresenceManager] heartbeat stopped');
  }

  setStatus(status: PresenceStatus, activity?: string): void {
    this._localStatus   = status;
    this._localActivity = activity;
    if (this._heartbeatActive) this._sendHeartbeat();
  }

  isOnline(userId: string): boolean {
    const rec = this._cache.get(userId);
    if (!rec) return false;
    return rec.status !== 'offline' && (Date.now() - rec.updatedAt) < OFFLINE_TTL_MS;
  }

  getPresence(userId: string): PresenceRecord | null {
    return this._cache.get(userId) ?? null;
  }

  updatePresence(record: PresenceRecord): void {
    const prev = this._cache.get(record.userId);
    this._cache.set(record.userId, record);
    if (prev?.status !== record.status) {
      const handlers = this._subscribers.get(record.userId);
      if (handlers) {
        for (const fn of handlers) {
          try { fn(record.status); } catch { /* isolate */ }
        }
      }
    }
  }

  subscribe(userId: string, fn: (status: PresenceStatus) => void): () => void {
    if (!this._subscribers.has(userId)) {
      this._subscribers.set(userId, new Set());
    }
    this._subscribers.get(userId)!.add(fn);
    return () => this._subscribers.get(userId)?.delete(fn);
  }

  /** Batch-fetch presence for a list of user IDs and update cache. */
  async fetchPresence(userIds: string[]): Promise<void> {
    if (!this._tableExists || userIds.length === 0) {
      this._expireStale();
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from(TABLE)
        .select('user_id, status, activity, updated_at')
        .in('user_id', userIds);

      if (error) {
        if (error.message?.includes('does not exist')) {
          this._tableExists = false;   // table not yet migrated — skip future calls
          console.warn('[PresenceManager] user_presence table not found — falling back to TTL expiry only');
        }
        this._expireStale();
        return;
      }

      const now = Date.now();
      for (const row of (data ?? [])) {
        const updatedAt = new Date(row.updated_at).getTime();
        const status: PresenceStatus =
          (now - updatedAt) > OFFLINE_TTL_MS ? 'offline' : (row.status as PresenceStatus);
        this.updatePresence({
          userId:    row.user_id,
          status,
          activity:  row.activity ?? undefined,
          updatedAt,
        });
      }

      this._expireStale();
    } catch (e: any) {
      console.warn('[PresenceManager] fetchPresence error:', e?.message);
      this._expireStale();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _sendHeartbeat(): Promise<void> {
    const uid = this._localUserId;
    if (!uid) return;

    // Update local cache immediately
    this.updatePresence({
      userId:    uid,
      status:    this._localStatus,
      activity:  this._localActivity,
      updatedAt: Date.now(),
    });

    if (!this._tableExists) return;

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from(TABLE).upsert({
        user_id:    uid,
        status:     this._localStatus,
        activity:   this._localActivity ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (error) {
        if (error.message?.includes('does not exist')) {
          this._tableExists = false;
          console.warn('[PresenceManager] user_presence table not found — heartbeat will update cache only');
        } else {
          console.warn('[PresenceManager] heartbeat upsert error:', error.message);
        }
      }
    } catch (e: any) {
      console.warn('[PresenceManager] heartbeat exception:', e?.message);
    }
  }

  private async _setOffline(uid: string): Promise<void> {
    this.updatePresence({ userId: uid, status: 'offline', updatedAt: Date.now() });
    if (!this._tableExists) return;
    try {
      const supabase = getSupabaseClient();
      await supabase.from(TABLE).upsert({
        user_id:    uid,
        status:     'offline',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch { /* non-critical */ }
  }

  private _expireStale(): void {
    const now = Date.now();
    for (const [userId, rec] of this._cache.entries()) {
      if (rec.status !== 'offline' && (now - rec.updatedAt) > OFFLINE_TTL_MS) {
        this.updatePresence({ ...rec, status: 'offline', updatedAt: now });
      }
    }
  }
}

export const PresenceManager = new PresenceManagerImpl();
