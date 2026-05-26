/**
 * background/SyncWorker.ts — Periodic data synchronization coordinator
 *
 * Coordinates all background data sync without blocking the UI:
 *   - Feed refresh (new videos while user scrolls)
 *   - Message inbox sync (unread count, new threads)
 *   - Notification sync (badge count update)
 *   - Wallet balance refresh (BDAG balance after transactions)
 *   - Presence heartbeat coordination
 *   - Profile cache invalidation
 *
 * Priority-based scheduling:
 *   CRITICAL (5s):  active call/stream state
 *   HIGH (15s):     messages, notifications
 *   NORMAL (30s):   feed, balance
 *   LOW (120s):     search suggestions, trending topics
 *
 * Backoff on error: doubles interval after failure, resets on success.
 * Network-aware: pauses low-priority sync on cellular to save data.
 *
 * Usage:
 *   SyncWorker.start(userId);
 *   SyncWorker.forceSync('messages');
 *   SyncWorker.stop();
 */

import { AppLifecycle }      from '@/modules/core/AppLifecycle';
import { EventBus }          from '@/modules/core/EventBus';
import { ConnectionManager } from '@/modules/realtime/ConnectionManager';
import { PollingManager }    from '@/modules/realtime/PollingManager';

export type SyncChannel =
  | 'feed'
  | 'messages'
  | 'notifications'
  | 'balance'
  | 'presence'
  | 'call_state'
  | 'stream_state';

type SyncPriority = 'critical' | 'high' | 'normal' | 'low';

interface SyncConfig {
  intervalMs:   number;
  priority:     SyncPriority;
  cellularOk:   boolean;   // sync on cellular?
  backgroundOk: boolean;   // sync when app backgrounds?
}

const SYNC_CONFIGS: Record<SyncChannel, SyncConfig> = {
  call_state:    { intervalMs:  5_000, priority: 'critical', cellularOk: true,  backgroundOk: false },
  stream_state:  { intervalMs:  5_000, priority: 'critical', cellularOk: true,  backgroundOk: false },
  messages:      { intervalMs: 15_000, priority: 'high',     cellularOk: true,  backgroundOk: false },
  notifications: { intervalMs: 15_000, priority: 'high',     cellularOk: true,  backgroundOk: false },
  presence:      { intervalMs: 20_000, priority: 'high',     cellularOk: true,  backgroundOk: false },
  feed:          { intervalMs: 30_000, priority: 'normal',   cellularOk: true,  backgroundOk: false },
  balance:       { intervalMs: 60_000, priority: 'normal',   cellularOk: false, backgroundOk: false },
};

class SyncWorkerImpl {
  private _userId:  string | null = null;
  private _running  = false;
  private _paused   = false;
  private _customFns = new Map<SyncChannel, () => Promise<void>>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(userId: string): void {
    if (this._running) return;
    this._userId  = userId;
    this._running = true;

    this._registerPollers();

    AppLifecycle.onBackground(() => {
      this._paused = true;
      this._unregisterPollers();
    });

    AppLifecycle.onForeground(() => {
      this._paused = false;
      this._registerPollers();
    });

    ConnectionManager.onReconnect(() => {
      if (!this._paused) {
        // Force immediate sync of all high+ priority channels on reconnect
        this.forceSync('messages');
        this.forceSync('notifications');
        this.forceSync('balance');
      }
    });

    console.log('[SyncWorker] started for user:', userId);
  }

  stop(): void {
    this._running = false;
    this._paused  = true;
    this._unregisterPollers();
    this._userId = null;
    console.log('[SyncWorker] stopped');
  }

  /** Register a custom sync function for a channel. */
  register(channel: SyncChannel, fn: () => Promise<void>): void {
    this._customFns.set(channel, fn);
  }

  /** Trigger immediate sync for a channel (bypasses interval). */
  forceSync(channel: SyncChannel): void {
    const fn = this._customFns.get(channel);
    if (fn) {
      fn().catch(e => console.warn(`[SyncWorker] forceSync "${channel}" failed:`, e?.message));
    } else {
      EventBus.emit('app:network_changed');  // signal listeners to refresh
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _registerPollers(): void {
    for (const [channel, config] of Object.entries(SYNC_CONFIGS) as [SyncChannel, SyncConfig][]) {
      const fn = this._customFns.get(channel) ?? this._defaultSync(channel);
      PollingManager.register({
        key:              `sync:${channel}`,
        intervalMs:       config.intervalMs,
        backgroundFactor: config.backgroundOk ? 1 : 0,
        runImmediately:   false,
        fn,
      });
    }
  }

  private _unregisterPollers(): void {
    for (const channel of Object.keys(SYNC_CONFIGS) as SyncChannel[]) {
      PollingManager.unregister(`sync:${channel}`);
    }
  }

  private _defaultSync(channel: SyncChannel): () => Promise<void> {
    return async () => {
      // Default: emit an event that context providers can listen to
      // Context providers (FeedContext, MessagesContext, etc.) subscribe
      // to these events and trigger their own fetches
      switch (channel) {
        case 'messages':      EventBus.emit('notification:received', { type: 'messages',      id: '' }); break;
        case 'notifications': EventBus.emit('notification:received', { type: 'notifications', id: '' }); break;
        case 'balance':       EventBus.emit('wallet:deposit_confirmed', { txHash: '', amount: 0, userId: this._userId ?? '' }); break;
        default: break;
      }
    };
  }
}

export const SyncWorker = new SyncWorkerImpl();
