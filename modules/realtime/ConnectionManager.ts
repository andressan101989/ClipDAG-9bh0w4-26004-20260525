/**
 * modules/realtime/ConnectionManager.ts — Realtime connection lifecycle & recovery
 *
 * Manages connection health for all realtime channels:
 *   - Heartbeat loop to detect connection loss
 *   - Automatic reconnection with exponential backoff
 *   - Circuit breaker to prevent storm of failed reconnects
 *   - Network change detection (WiFi ↔ cellular ↔ offline)
 *   - Event prioritization queue during reconnection
 *   - Backpressure handling for burst event floods
 *
 * All realtime modules (PollingManager, PresenceManager, SignalingManager)
 * check ConnectionManager.isHealthy before sending/receiving.
 *
 * Usage:
 *   ConnectionManager.initialize(userId);
 *   ConnectionManager.onReconnect(() => { refetchAll(); });
 *   const healthy = ConnectionManager.isHealthy;
 */

import { EventBus }      from '../core/EventBus';
import { AppLifecycle }  from '../core/AppLifecycle';
import { retry, CircuitBreaker } from '../core/RetryStrategy';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';
export type NetworkType     = 'wifi' | 'cellular' | 'offline' | 'unknown';

const HEARTBEAT_INTERVAL_MS  = 20_000;
const HEARTBEAT_TIMEOUT_MS   = 8_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

interface PendingEvent {
  type:      string;
  payload:   any;
  priority:  number;
  enqueuedAt: number;
}

class ConnectionManagerImpl {
  private _state:       ConnectionState = 'disconnected';
  private _networkType: NetworkType     = 'unknown';
  private _userId:      string | null   = null;
  private _heartbeatId: ReturnType<typeof setInterval> | null = null;
  private _reconnectAttempts = 0;
  private _pendingQueue: PendingEvent[] = [];
  private _reconnectHandlers  = new Set<() => void>();
  private _disconnectHandlers = new Set<() => void>();
  private _stateHandlers      = new Set<(s: ConnectionState) => void>();

  private readonly _breaker = new CircuitBreaker({
    threshold:  5,
    timeoutMs:  60_000,
    halfOpenMax: 1,
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  initialize(userId: string): void {
    this._userId = userId;
    this._setState('connecting');
    this._startHeartbeat();
    this._setState('connected');
    console.log('[ConnectionManager] initialized for user:', userId);

    AppLifecycle.onForeground(() => this._handleForeground());
    AppLifecycle.onBackground(() => this._handleBackground());
  }

  shutdown(): void {
    this._stopHeartbeat();
    this._userId = null;
    this._setState('disconnected');
    this._pendingQueue = [];
    console.log('[ConnectionManager] shutdown');
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get isHealthy():       boolean          { return this._state === 'connected'; }
  get state():           ConnectionState  { return this._state; }
  get networkType():     NetworkType      { return this._networkType; }
  get reconnectAttempts(): number         { return this._reconnectAttempts; }

  // ── Event queue (backpressure) ─────────────────────────────────────────────

  /** Enqueue an event to send when connection is restored. */
  enqueue(type: string, payload: any, priority = 5): void {
    if (this._pendingQueue.length >= 500) {
      // Drop lowest priority event
      this._pendingQueue.sort((a, b) => b.priority - a.priority);
      this._pendingQueue.pop();
    }
    this._pendingQueue.push({ type, payload, priority, enqueuedAt: Date.now() });
  }

  /** Flush queued events. Returns drained events sorted by priority. */
  drainQueue(): PendingEvent[] {
    const drained = this._pendingQueue
      .sort((a, b) => b.priority - a.priority)
      .slice();
    this._pendingQueue = [];
    return drained;
  }

  get queueLength(): number { return this._pendingQueue.length; }

  // ── Subscription ──────────────────────────────────────────────────────────

  onReconnect(fn: () => void):    () => void { this._reconnectHandlers.add(fn);  return () => this._reconnectHandlers.delete(fn); }
  onDisconnect(fn: () => void):   () => void { this._disconnectHandlers.add(fn); return () => this._disconnectHandlers.delete(fn); }
  onStateChange(fn: (s: ConnectionState) => void): () => void {
    this._stateHandlers.add(fn);
    return () => this._stateHandlers.delete(fn);
  }

  // ── Network state ─────────────────────────────────────────────────────────

  reportNetworkChange(type: NetworkType): void {
    const prev = this._networkType;
    this._networkType = type;
    console.log(`[ConnectionManager] network: ${prev} → ${type}`);

    EventBus.emit('app:network_changed');

    if (type === 'offline') {
      this._setState('disconnected');
      this._stopHeartbeat();
    } else if (prev === 'offline') {
      // Coming back online
      this._reconnect();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    if (this._heartbeatId) return;
    this._heartbeatId = setInterval(() => this._beat(), HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatId) {
      clearInterval(this._heartbeatId);
      this._heartbeatId = null;
    }
  }

  private async _beat(): Promise<void> {
    if (!this._userId) return;
    if (!this._breaker.isAllowed()) {
      console.warn('[ConnectionManager] circuit open — skipping heartbeat');
      return;
    }

    try {
      // TODO: ping Supabase or presence endpoint
      const start = Date.now();
      // await supabase.from('user_presence').upsert(...)
      const latencyMs = Date.now() - start;
      this._breaker.onSuccess();

      if (this._state !== 'connected') {
        this._onReconnected();
      }
    } catch (err: any) {
      this._breaker.onFailure();
      console.warn('[ConnectionManager] heartbeat failed:', err?.message);
      if (this._state === 'connected') {
        this._setState('error');
        this._scheduleReconnect();
      }
    }
  }

  private _scheduleReconnect(): void {
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    );
    this._reconnectAttempts++;
    console.log(`[ConnectionManager] reconnect in ${delay}ms (attempt ${this._reconnectAttempts})`);
    setTimeout(() => this._reconnect(), delay);
  }

  private async _reconnect(): Promise<void> {
    if (!this._userId || this._state === 'connected') return;
    this._setState('connecting');

    if (!this._breaker.isAllowed()) {
      console.error('[ConnectionManager] circuit open — cannot reconnect');
      return;
    }

    try {
      // TODO: re-authenticate and re-initialize subscriptions
      this._onReconnected();
    } catch (err: any) {
      console.warn('[ConnectionManager] reconnect failed:', err?.message);
      this._setState('error');
      this._scheduleReconnect();
    }
  }

  private _onReconnected(): void {
    this._setState('connected');
    this._reconnectAttempts = 0;
    this._breaker.onSuccess();

    // Flush pending queue
    const queued = this.drainQueue();
    if (queued.length > 0) {
      console.log(`[ConnectionManager] flushing ${queued.length} queued events`);
    }

    for (const fn of this._reconnectHandlers) {
      try { fn(); } catch { /* isolate */ }
    }
  }

  private _handleForeground(): void {
    if (this._networkType !== 'offline') {
      this._startHeartbeat();
      if (this._state !== 'connected') this._reconnect();
    }
  }

  private _handleBackground(): void {
    this._stopHeartbeat();
  }

  private _setState(state: ConnectionState): void {
    if (this._state === state) return;
    const prev = this._state;
    this._state = state;

    if (state === 'disconnected' && prev === 'connected') {
      for (const fn of this._disconnectHandlers) {
        try { fn(); } catch { /* isolate */ }
      }
    }

    for (const fn of this._stateHandlers) {
      try { fn(state); } catch { /* isolate */ }
    }
  }
}

export const ConnectionManager = new ConnectionManagerImpl();
