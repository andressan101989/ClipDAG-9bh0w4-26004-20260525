/**
 * modules/core/EventBus.ts — App-wide typed event bus
 *
 * Lightweight pub/sub system for cross-module communication.
 * Replaces direct context imports between unrelated modules
 * and enables decoupled realtime event distribution.
 *
 * Usage:
 *   import { EventBus } from '@/modules/core/EventBus';
 *
 *   // Subscribe
 *   const unsub = EventBus.on('wallet:balance_updated', ({ balance }) => {
 *     setBalance(balance);
 *   });
 *
 *   // Publish
 *   EventBus.emit('wallet:balance_updated', { balance: 1234 });
 *
 *   // Cleanup
 *   unsub();
 *
 * All event types are declared in AppEvents below.
 * Add new event types here — TypeScript will enforce the payload shape.
 */

// ── Event catalogue ───────────────────────────────────────────────────────────
// Format: 'domain:action' — keep names explicit and unique per domain.
export interface AppEvents {
  // Auth
  'auth:login':               { userId: string };
  'auth:logout':              void;
  'auth:profile_updated':     { userId: string; field: string };

  // Wallet / BDAG
  'wallet:balance_updated':   { balance: number; userId: string };
  'wallet:deposit_confirmed': { txHash: string; amount: number; userId: string };
  'wallet:withdrawal_sent':   { txHash: string; amount: number; userId: string };
  'wallet:connected':         { address: string; chainId: number };
  'wallet:disconnected':      void;

  // Feed
  'feed:video_liked':         { videoId: string; userId: string };
  'feed:video_uploaded':      { videoId: string; userId: string };
  'feed:comment_added':       { videoId: string; commentId: string };

  // Chat / Messages
  'chat:message_received':    { senderId: string; recipientId: string; messageId: string };
  'chat:message_read':        { partnerId: string };
  'chat:typing':              { userId: string; partnerId: string };

  // Notifications
  'notification:received':    { type: string; id: string };
  'notification:all_read':    void;

  // Calls (voice/video — future)
  'call:incoming':            { callerId: string; callType: 'voice' | 'video'; roomId: string };
  'call:accepted':            { callId: string; roomId: string };
  'call:ended':               { callId: string; duration: number };
  'call:rejected':            { callId: string };

  // Live streaming (future)
  'stream:started':           { hostId: string; sessionId: string; title: string };
  'stream:ended':             { sessionId: string; viewerCount: number };
  'stream:viewer_joined':     { sessionId: string; userId: string };
  'stream:gift_received':     { sessionId: string; giftType: string; senderId: string };

  // Battle (future)
  'battle:challenged':        { challengerId: string; targetId: string; battleId: string };
  'battle:accepted':          { battleId: string };
  'battle:ended':             { battleId: string; winnerId: string };

  // Media
  'media:upload_progress':    { uploadId: string; progress: number; fileName: string };
  'media:upload_complete':    { uploadId: string; url: string; bucket: string };
  'media:upload_failed':      { uploadId: string; error: string };

  // DeepAR / Studio
  'studio:deepar_ready':      { apiVersion?: string };
  'studio:filter_applied':    { filterId: string; filterName: string };
  'studio:recording_started': void;
  'studio:recording_ended':   { uri: string; durationMs: number };

  // App lifecycle
  'app:foreground':           void;
  'app:background':           void;
  'app:low_memory':           void;
  'app:network_changed':      void;
}

export type AppEventName = keyof AppEvents;
export type AppEventPayload<E extends AppEventName> = AppEvents[E];

// ── Listener types ────────────────────────────────────────────────────────────
type Listener<E extends AppEventName> =
  AppEvents[E] extends void
    ? () => void
    : (payload: AppEvents[E]) => void;

type ListenerEntry = {
  id:       number;
  listener: (...args: any[]) => void;
  once:     boolean;
};

// ── Implementation ────────────────────────────────────────────────────────────
class EventBusImpl {
  private readonly _listeners = new Map<string, ListenerEntry[]>();
  private _idCounter = 0;

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<E extends AppEventName>(event: E, listener: Listener<E>): () => void {
    const id = ++this._idCounter;
    const entries = this._listeners.get(event) ?? [];
    entries.push({ id, listener: listener as (...args: any[]) => void, once: false });
    this._listeners.set(event, entries);
    return () => this._off(event, id);
  }

  /** Subscribe once — auto-removes after first call. */
  once<E extends AppEventName>(event: E, listener: Listener<E>): () => void {
    const id = ++this._idCounter;
    const entries = this._listeners.get(event) ?? [];
    entries.push({ id, listener: listener as (...args: any[]) => void, once: true });
    this._listeners.set(event, entries);
    return () => this._off(event, id);
  }

  /** Emit an event. Synchronous — all listeners called in registration order. */
  emit<E extends AppEventName>(
    event: E,
    ...args: AppEvents[E] extends void ? [] : [AppEvents[E]]
  ): void {
    const entries = this._listeners.get(event);
    if (!entries || entries.length === 0) return;

    const toRemove: number[] = [];
    for (const entry of [...entries]) {
      try {
        entry.listener(...args);
      } catch (e: any) {
        console.warn(`[EventBus] listener error on "${event}":`, e?.message ?? e);
      }
      if (entry.once) toRemove.push(entry.id);
    }
    if (toRemove.length > 0) {
      this._listeners.set(event, entries.filter(e => !toRemove.includes(e.id)));
    }
  }

  /** Remove all listeners for an event (or all events if no arg). */
  off(event?: AppEventName): void {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /** Number of active listeners (for diagnostics). */
  get listenerCount(): number {
    let total = 0;
    for (const entries of this._listeners.values()) total += entries.length;
    return total;
  }

  /** Debug: log all registered events and their listener counts. */
  debug(): void {
    console.log('[EventBus] Registered events:');
    for (const [event, entries] of this._listeners.entries()) {
      console.log(`  ${event}: ${entries.length} listener(s)`);
    }
    console.log(`[EventBus] Total listeners: ${this.listenerCount}`);
  }

  private _off(event: string, id: number): void {
    const entries = this._listeners.get(event);
    if (!entries) return;
    this._listeners.set(event, entries.filter(e => e.id !== id));
  }
}

/** Singleton app-wide event bus. Import from anywhere — no React context required. */
export const EventBus = new EventBusImpl();
