/** CHAT-only ephemeral presence over private Supabase Realtime channels. */
import * as Crypto from 'expo-crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { AppLifecycle } from '@/modules/core/AppLifecycle';

export type ChatPresenceStatus = 'online' | 'offline';
export type ChatPresence = { userId: string; status: ChatPresenceStatus };
export type WatchedChatUser = { userId: string; presence: ChatPresence | null };
type PresencePayload = { user_id?: string; online_at?: string };

export class ChatPresenceServiceImpl {
  private userId: string | null = null;
  private generation = 0;
  private appActive = AppLifecycle.isActive;
  private sessionKey = '';
  private selfChannel: RealtimeChannel | null = null;
  private selfOnline = false;
  private watchedChannels = new Map<string, RealtimeChannel>();
  private watchedData = new Map<string, ChatPresence>();
  private watchedIds = new Set<string>();
  private changeHandlers = new Set<(users: WatchedChatUser[]) => void>();
  private lifecycleUnsubs: (() => void)[] = [];

  initialize(userId: string): void {
    if (this.userId === userId) return;
    const generation = ++this.generation;
    void this.clearChannels(false);
    this.userId = userId;
    this.sessionKey = `${userId}:${Crypto.randomUUID()}`;
    this.appActive = AppLifecycle.isActive;
    this.lifecycleUnsubs = [
      AppLifecycle.onBackground(() => this.handleBackground(generation)),
      AppLifecycle.onForeground(() => this.handleForeground(generation)),
    ];
    if (this.appActive) void this.openSelfChannel(generation).catch(() => { this.selfOnline = false; });
    this.reopenWatchers(generation);
  }

  async destroy(): Promise<void> {
    this.generation += 1;
    await this.clearChannels(true);
  }

  get currentStatus(): ChatPresenceStatus {
    return this.userId && this.appActive && this.selfOnline ? 'online' : 'offline';
  }

  watchUsers(userIds: string[]): void {
    userIds.filter(Boolean).forEach(userId => this.watchedIds.add(userId));
    if (this.userId && this.appActive) this.reopenWatchers(this.generation);
  }

  unwatchUsers(userIds: string[]): void {
    const supabase = getSupabaseClient();
    userIds.forEach(userId => {
      this.watchedIds.delete(userId);
      this.watchedData.delete(userId);
      const channel = this.watchedChannels.get(userId);
      if (channel) {
        this.watchedChannels.delete(userId);
        void supabase.removeChannel(channel).catch(() => undefined);
      }
    });
    this.notifyChange();
  }

  onPresenceChange(handler: (users: WatchedChatUser[]) => void): () => void {
    this.changeHandlers.add(handler);
    handler(this.snapshot());
    return () => this.changeHandlers.delete(handler);
  }

  getPresence(userId: string): ChatPresence | null {
    return this.watchedData.get(userId) ?? null;
  }

  private clearChannels(clearConsumers: boolean): Promise<unknown[]> {
    this.lifecycleUnsubs.forEach(unsubscribe => unsubscribe());
    this.lifecycleUnsubs = [];
    const supabase = getSupabaseClient();
    const selfChannel = this.selfChannel;
    const channels = [...this.watchedChannels.values()];
    this.selfChannel = null;
    this.watchedChannels.clear();
    this.selfOnline = false;
    this.userId = null;
    this.watchedData.clear();
    if (clearConsumers) {
      this.watchedIds.clear();
      this.changeHandlers.clear();
    }
    const removals: Promise<unknown>[] = channels.map(channel => supabase.removeChannel(channel).catch(() => undefined));
    if (selfChannel) {
      removals.push(selfChannel.untrack().catch(() => undefined)
        .then(() => supabase.removeChannel(selfChannel).catch(() => undefined)));
    }
    return Promise.all(removals);
  }

  private async openSelfChannel(generation: number): Promise<void> {
    if (!this.userId || !this.appActive || generation !== this.generation || this.selfChannel) return;
    const supabase = getSupabaseClient();
    await supabase.realtime.setAuth();
    if (!this.userId || !this.appActive || generation !== this.generation || this.selfChannel) return;
    const channel = supabase.channel(`chat-presence:${this.userId}`, {
      config: { private: true, presence: { key: this.sessionKey } },
    });
    this.selfChannel = channel;
    channel.subscribe(status => {
      if (generation !== this.generation || channel !== this.selfChannel) return;
      if (status === 'SUBSCRIBED' && this.userId && this.appActive) {
        const trackedUserId = this.userId;
        void channel.track({ user_id: trackedUserId, online_at: new Date().toISOString() }).then(result => {
          if (result !== 'ok' || generation !== this.generation || channel !== this.selfChannel) return;
          this.selfOnline = true;
        }).catch(() => { this.selfOnline = false; });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.selfOnline = false;
      }
    });
  }

  private reopenWatchers(generation: number): void {
    if (!this.userId || !this.appActive || generation !== this.generation) return;
    for (const userId of this.watchedIds) {
      void this.openWatcher(userId, generation).catch(() => this.setWatchedPresence(userId, false));
    }
  }

  private async openWatcher(userId: string, generation: number): Promise<void> {
    if (!this.watchedIds.has(userId) || this.watchedChannels.has(userId)
      || !this.appActive || generation !== this.generation) return;
    const supabase = getSupabaseClient();
    await supabase.realtime.setAuth();
    if (!this.userId || !this.watchedIds.has(userId) || !this.appActive
      || generation !== this.generation || this.watchedChannels.has(userId)) return;
    const channel = supabase.channel(`chat-presence:${userId}`, { config: { private: true } });
    const sync = () => {
      if (generation !== this.generation || channel !== this.watchedChannels.get(userId)) return;
      const state = channel.presenceState<PresencePayload>();
      const online = Object.values(state).some(entries => entries.some(entry => entry.user_id === userId));
      this.setWatchedPresence(userId, online);
    };
    channel.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(status => {
        if (generation !== this.generation || channel !== this.watchedChannels.get(userId)) return;
        if (status === 'SUBSCRIBED') sync();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.setWatchedPresence(userId, false);
        }
      });
    this.watchedChannels.set(userId, channel);
  }

  private handleBackground(generation: number): void {
    if (generation !== this.generation) return;
    this.appActive = false;
    const supabase = getSupabaseClient();
    const selfChannel = this.selfChannel;
    this.selfChannel = null;
    this.selfOnline = false;
    if (selfChannel) {
      void selfChannel.untrack().catch(() => undefined)
        .then(() => supabase.removeChannel(selfChannel).catch(() => undefined));
    }
    for (const [userId, channel] of this.watchedChannels) {
      this.watchedChannels.delete(userId);
      void supabase.removeChannel(channel).catch(() => undefined);
      this.setWatchedPresence(userId, false);
    }
  }

  private handleForeground(generation: number): void {
    if (generation !== this.generation) return;
    this.appActive = true;
    void this.openSelfChannel(generation).catch(() => { this.selfOnline = false; });
    this.reopenWatchers(generation);
  }

  private setWatchedPresence(userId: string, online: boolean): void {
    const next: ChatPresence = { userId, status: online ? 'online' : 'offline' };
    const previous = this.watchedData.get(userId);
    this.watchedData.set(userId, next);
    if (previous?.status !== next.status) this.notifyChange();
  }

  private snapshot(): WatchedChatUser[] {
    return [...this.watchedIds].map(userId => ({ userId, presence: this.getPresence(userId) }));
  }

  private notifyChange(): void {
    const users = this.snapshot();
    this.changeHandlers.forEach(handler => handler(users));
  }
}

export const ChatPresenceService = new ChatPresenceServiceImpl();
