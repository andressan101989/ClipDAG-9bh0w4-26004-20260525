/** Authenticated ephemeral presence backed by Supabase Realtime Presence. */
import * as Crypto from 'expo-crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { AppLifecycle } from '../core/AppLifecycle';
import { EventBus } from '../core/EventBus';

export type OnlineStatus = 'online' | 'away' | 'offline';
export type ActivityType = 'idle' | 'watching' | 'live_streaming' | 'gaming' | 'typing' | 'call';
export interface PresenceData { userId: string; status: OnlineStatus; activity: ActivityType | null; sessionType: string | null; updatedAt: number }
export interface WatchedUser { userId: string; presence: PresenceData | null }
export type PresenceStatus = OnlineStatus;
export type PresenceRecord = PresenceData;
type PresencePayload = { user_id?: string; online_at?: string };

class PresenceManagerImpl {
  private userId: string | null = null;
  private generation = 0;
  private appActive = AppLifecycle.isActive;
  private sessionKey = '';
  private selfChannel: RealtimeChannel | null = null;
  private selfOnline = false;
  private watchedChannels = new Map<string, RealtimeChannel>();
  private watchedData = new Map<string, PresenceData>();
  private watchedIds = new Set<string>();
  private changeHandlers = new Set<(users: WatchedUser[]) => void>();
  private directHandlers = new Map<string, Set<(presence: PresenceData) => void>>();
  private lifecycleUnsubs: (() => void)[] = [];
  private activity: ActivityType | null = null;
  private sessionType: string | null = null;

  initialize(userId: string): void {
    if (this.userId === userId) return;
    const generation = ++this.generation;
    void this.clearChannels(false).finally(() => {
      if (generation !== this.generation) return;
      this.userId = userId;
      this.sessionKey = `${userId}:${Crypto.randomUUID()}`;
      this.appActive = AppLifecycle.isActive;
      this.lifecycleUnsubs = [
        AppLifecycle.onBackground(() => this.handleBackground(generation)),
        AppLifecycle.onForeground(() => this.handleForeground(generation)),
      ];
      if (this.appActive) void this.openSelfChannel(generation).catch(() => { this.selfOnline = false; });
      this.reopenWatchers(generation);
    });
  }

  async destroy(): Promise<void> {
    this.generation += 1;
    await this.clearChannels();
  }

  private async clearChannels(clearConsumers = true): Promise<void> {
    this.lifecycleUnsubs.forEach(unsubscribe => unsubscribe());
    this.lifecycleUnsubs = [];
    const supabase = getSupabaseClient();
    const channels = [...this.watchedChannels.values()];
    this.watchedChannels.clear();
    if (this.selfChannel) {
      try { await this.selfChannel.untrack(); } catch { /* best effort */ }
      channels.push(this.selfChannel);
      this.selfChannel = null;
    }
    this.selfOnline = false;
    await Promise.all(channels.map(channel => supabase.removeChannel(channel).catch(() => undefined)));
    this.userId = null;
    this.watchedData.clear();
    if (clearConsumers) {
      this.watchedIds.clear();
      this.changeHandlers.clear();
      this.directHandlers.clear();
    }
    this.activity = null;
    this.sessionType = null;
  }

  get currentStatus(): OnlineStatus { return this.userId && this.appActive && this.selfOnline ? 'online' : 'offline'; }
  get currentActivity(): ActivityType | null { return this.activity; }

  async setStatus(status: OnlineStatus | 'in_battle', _metadata?: unknown): Promise<void> {
    if (status === 'offline' || status === 'away') await this.suspendSelfPresence();
    else if (this.userId && this.appActive) await this.openSelfChannel(this.generation);
  }
  async setActivity(activity: ActivityType | null): Promise<void> { this.activity = activity; }
  async registerSession(type: 'call' | 'live' | 'battle' | null): Promise<void> {
    this.sessionType = type;
    this.activity = type === 'call' ? 'call' : type === 'live' ? 'live_streaming' : type === 'battle' ? 'gaming' : null;
  }
  registerStreamSession(_sessionId: string): void { void this.registerSession('live'); }
  unregisterStreamSession(): void { void this.registerSession(null); }
  registerMultiplayerSession(_session: unknown): void { void this.registerSession('battle'); }
  unregisterMultiplayerSession(_roomId?: string): void { void this.registerSession(null); }

  watchUsers(userIds: string[]): void {
    userIds.filter(Boolean).forEach(id => this.watchedIds.add(id));
    if (this.userId && this.appActive) this.reopenWatchers(this.generation);
  }
  unwatchUsers(userIds: string[]): void {
    const supabase = getSupabaseClient();
    userIds.forEach(id => {
      this.watchedIds.delete(id);
      this.watchedData.delete(id);
      const channel = this.watchedChannels.get(id);
      if (channel) { this.watchedChannels.delete(id); void supabase.removeChannel(channel); }
    });
    this.notifyChange();
  }
  onPresenceChange(handler: (users: WatchedUser[]) => void): () => void {
    this.changeHandlers.add(handler); handler(this.snapshot());
    return () => this.changeHandlers.delete(handler);
  }
  subscribe(userId: string, handler: (presence: PresenceData) => void): () => void {
    let handlers = this.directHandlers.get(userId);
    if (!handlers) { handlers = new Set(); this.directHandlers.set(userId, handlers); }
    handlers.add(handler); this.watchUsers([userId]);
    handler(this.getPresence(userId) ?? this.offline(userId));
    return () => {
      const current = this.directHandlers.get(userId); current?.delete(handler);
      if (!current?.size) { this.directHandlers.delete(userId); this.unwatchUsers([userId]); }
    };
  }
  fetchPresence(userIds: string[]): void { this.watchUsers(userIds); }
  getPresence(userId: string): PresenceData | null { return this.watchedData.get(userId) ?? null; }
  isOnline(userId: string): boolean { return this.watchedData.get(userId)?.status === 'online'; }

  private async openSelfChannel(generation: number): Promise<void> {
    if (!this.userId || !this.appActive || generation !== this.generation || this.selfChannel) return;
    const supabase = getSupabaseClient();
    await supabase.realtime.setAuth();
    if (!this.userId || !this.appActive || generation !== this.generation) return;
    const channel = supabase.channel(`chat-presence:${this.userId}`, { config: { private: true, presence: { key: this.sessionKey } } });
    this.selfChannel = channel;
    channel.subscribe(status => {
      if (generation !== this.generation || channel !== this.selfChannel) return;
      if (status === 'SUBSCRIBED' && this.userId && this.appActive) {
        const trackedUserId = this.userId;
        void channel.track({ user_id: trackedUserId, online_at: new Date().toISOString() }).then(result => {
          if (result !== 'ok' || generation !== this.generation || channel !== this.selfChannel) return;
          this.selfOnline = true;
          EventBus.emit('presence:status_changed' as any, { userId: trackedUserId, status: 'online' });
        }).catch(() => { this.selfOnline = false; });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.selfOnline = false;
        EventBus.emit('presence:status_changed' as any, { userId: this.userId, status: 'offline' });
      }
    });
  }
  private reopenWatchers(generation: number): void {
    if (!this.userId || !this.appActive || generation !== this.generation) return;
    for (const id of this.watchedIds) void this.openWatcher(id, generation).catch(() => this.setWatchedPresence(id, false));
  }
  private async openWatcher(userId: string, generation: number): Promise<void> {
    if (this.watchedChannels.has(userId) || !this.appActive || generation !== this.generation) return;
    const supabase = getSupabaseClient();
    await supabase.realtime.setAuth();
    if (!this.userId || !this.appActive || generation !== this.generation || this.watchedChannels.has(userId)) return;
    const channel = supabase.channel(`chat-presence:${userId}`, { config: { private: true } });
    const sync = () => {
      if (generation !== this.generation || channel !== this.watchedChannels.get(userId)) return;
      const state = channel.presenceState<PresencePayload>();
      const online = Object.values(state).some(entries => entries.some(entry => entry.user_id === userId));
      this.setWatchedPresence(userId, online);
    };
    channel.on('presence', { event: 'sync' }, sync).on('presence', { event: 'join' }, sync).on('presence', { event: 'leave' }, sync)
      .subscribe(status => {
        if (generation !== this.generation || channel !== this.watchedChannels.get(userId)) return;
        if (status === 'SUBSCRIBED') sync();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.setWatchedPresence(userId, false);
      });
    this.watchedChannels.set(userId, channel);
  }
  private async suspendSelfPresence(): Promise<void> {
    if (!this.selfChannel) return;
    const channel = this.selfChannel; this.selfChannel = null;
    this.selfOnline = false;
    try { await channel.untrack(); } catch { /* best effort */ }
    await getSupabaseClient().removeChannel(channel).catch(() => undefined);
  }
  private handleBackground(generation: number): void {
    if (generation !== this.generation) return;
    this.appActive = false; void this.suspendSelfPresence();
    const supabase = getSupabaseClient();
    for (const [id, channel] of this.watchedChannels) {
      void supabase.removeChannel(channel); this.watchedChannels.delete(id); this.setWatchedPresence(id, false);
    }
  }
  private handleForeground(generation: number): void {
    if (generation !== this.generation) return;
    this.appActive = true;
    void this.openSelfChannel(generation).catch(() => { this.selfOnline = false; });
    this.reopenWatchers(generation);
  }
  private setWatchedPresence(userId: string, online: boolean): void {
    const next: PresenceData = online
      ? { userId, status: 'online', activity: null, sessionType: null, updatedAt: Date.now() }
      : this.offline(userId);
    const previous = this.watchedData.get(userId); this.watchedData.set(userId, next);
    if (previous?.status === next.status) return;
    EventBus.emit('presence:user_changed' as any, { userId, presence: next });
    this.directHandlers.get(userId)?.forEach(handler => handler(next)); this.notifyChange();
  }
  private offline(userId: string): PresenceData { return { userId, status: 'offline', activity: null, sessionType: null, updatedAt: 0 }; }
  private snapshot(): WatchedUser[] { return [...this.watchedIds].map(userId => ({ userId, presence: this.getPresence(userId) })); }
  private notifyChange(): void { const users = this.snapshot(); this.changeHandlers.forEach(handler => handler(users)); }
}

export const PresenceManager = new PresenceManagerImpl();
