/**
 * modules/realtime/ConnectionManager.ts — v2 Production
 *
 * Real implementation:
 *   - Real ping via Supabase user_presence upsert with latency measurement
 *   - Network health score based on RTT + consecutive failures
 *   - Reconnect validation: confirms connection before declaring healthy
 *   - Realtime connectivity check via lightweight presence upsert
 *   - Circuit breaker prevents reconnect storms
 *   - Background/foreground lifecycle handled
 *   - No throw — all errors handled gracefully
 */

import { EventBus }          from '../core/EventBus';
import { AppLifecycle }      from '../core/AppLifecycle';
import { getSupabaseClient } from '../../template';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';
export type NetworkType     = 'wifi' | 'cellular' | 'offline' | 'unknown';

export interface ConnectionHealth {
  state:            ConnectionState;
  networkType:      NetworkType;
  latencyMs:        number;
  consecutiveFails: number;
  lastSuccessAt:    number;
  reconnectCount:   number;
  queueLength:      number;
  score:            number;   // 0–100: 100 = perfect, 0 = no connectivity
}

const HEARTBEAT_INTERVAL_MS   = 20_000;
const HEARTBEAT_FAST_INTERVAL = 5_000;  // after failure, ping faster
const HEARTBEAT_TIMEOUT_MS    = 8_000;
const MAX_RECONNECT_DELAY_MS  = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_QUEUE_SIZE          = 500;
const CIRCUIT_OPEN_AFTER      = 5;
const CIRCUIT_RESET_AFTER_MS  = 60_000;

interface PendingEvent {
  type:      string;
  payload:   any;
  priority:  number;
  enqueuedAt: number;
}

class ConnectionManagerImpl {
  private _state:            ConnectionState = 'disconnected';
  private _networkType:      NetworkType     = 'unknown';
  private _userId:           string | null   = null;
  private _heartbeatId:      ReturnType<typeof setInterval>  | null = null;
  private _reconnectTimer:   ReturnType<typeof setTimeout>   | null = null;
  private _reconnectCount    = 0;
  private _consecutiveFails  = 0;
  private _circuitOpenAt:    number | null   = null;
  private _lastSuccessAt     = 0;
  private _latencyMs         = 0;
  private _pendingQueue:     PendingEvent[]  = [];
  private _reconnectHandlers  = new Set<() => void>();
  private _disconnectHandlers = new Set<() => void>();
  private _stateHandlers      = new Set<(s: ConnectionState) => void>();
  private _healthHandlers     = new Set<(h: ConnectionHealth) => void>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  // Injected Supabase client — set in initialize() to avoid circular require() at module load time
  private _supabase: ReturnType<typeof getSupabaseClient> | null = null;

  initialize(userId: string): void {
    this._userId   = userId;
    this._supabase = getSupabaseClient();
    this._setState('connecting');
    this._startHeartbeat(HEARTBEAT_INTERVAL_MS);
    this._beat();   // immediate ping to confirm connection

    AppLifecycle.onForeground(() => this._handleForeground());
    AppLifecycle.onBackground(() => this._handleBackground());
    console.log('[ConnectionManager] initialized:', userId);
  }

  shutdown(): void {
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._userId   = null;
    this._supabase = null;
    this._setState('disconnected');
    this._pendingQueue = [];
    console.log('[ConnectionManager] shutdown');
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get isHealthy():        boolean         { return this._state === 'connected'; }
  get state():            ConnectionState { return this._state; }
  get networkType():      NetworkType     { return this._networkType; }
  get reconnectAttempts():number          { return this._reconnectCount; }
  get latencyMs():        number          { return this._latencyMs; }

  getHealth(): ConnectionHealth {
    return {
      state:            this._state,
      networkType:      this._networkType,
      latencyMs:        this._latencyMs,
      consecutiveFails: this._consecutiveFails,
      lastSuccessAt:    this._lastSuccessAt,
      reconnectCount:   this._reconnectCount,
      queueLength:      this._pendingQueue.length,
      score:            this._computeScore(),
    };
  }

  // ── Event queue ───────────────────────────────────────────────────────────

  enqueue(type: string, payload: any, priority = 5): void {
    if (this._pendingQueue.length >= MAX_QUEUE_SIZE) {
      this._pendingQueue.sort((a, b) => b.priority - a.priority);
      this._pendingQueue.pop();
    }
    this._pendingQueue.push({ type, payload, priority, enqueuedAt: Date.now() });
  }

  drainQueue(): PendingEvent[] {
    const drained = [...this._pendingQueue].sort((a, b) => b.priority - a.priority);
    this._pendingQueue = [];
    return drained;
  }

  get queueLength(): number { return this._pendingQueue.length; }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  onReconnect(fn: () => void):    () => void {
    this._reconnectHandlers.add(fn); return () => this._reconnectHandlers.delete(fn);
  }
  onDisconnect(fn: () => void):   () => void {
    this._disconnectHandlers.add(fn); return () => this._disconnectHandlers.delete(fn);
  }
  onStateChange(fn: (s: ConnectionState) => void): () => void {
    this._stateHandlers.add(fn); return () => this._stateHandlers.delete(fn);
  }
  onHealthChange(fn: (h: ConnectionHealth) => void): () => void {
    this._healthHandlers.add(fn); return () => this._healthHandlers.delete(fn);
  }

  // ── Network state ─────────────────────────────────────────────────────────

  reportNetworkChange(type: NetworkType): void {
    const prev = this._networkType;
    this._networkType = type;
    EventBus.emit('app:network_changed', { type });

    if (type === 'offline') {
      this._stopHeartbeat();
      this._setState('disconnected');
    } else if (prev === 'offline') {
      this._scheduleReconnect(0);
    }
  }

  // ── Real ping ─────────────────────────────────────────────────────────────

  private async _beat(): Promise<void> {
    if (!this._userId || !this._supabase) return;
    if (this._isCircuitOpen()) {
      console.warn('[ConnectionManager] circuit open — skipping beat');
      return;
    }

    const pingStart = Date.now();
    try {
      const supabase = this._supabase;

      // Upsert presence — lightweight write proves DB connectivity
      const { error } = await Promise.race([
        supabase.from('user_presence').upsert({
          user_id:    this._userId,
          status:     'online',
          activity:   null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        new Promise<{ error: Error }>(resolve =>
          setTimeout(() => resolve({ error: new Error('ping timeout') }), HEARTBEAT_TIMEOUT_MS),
        ),
      ]);

      if (error) throw error;

      const latency = Date.now() - pingStart;
      this._latencyMs = latency;
      this._lastSuccessAt = Date.now();
      this._consecutiveFails = 0;
      this._circuitOpenAt = null;

      if (this._state !== 'connected') {
        this._onReconnected();
      }
      this._notifyHealth();
    } catch (err: any) {
      this._consecutiveFails++;
      console.warn(`[ConnectionManager] beat failed (${this._consecutiveFails}):`, err?.message);

      if (this._consecutiveFails >= CIRCUIT_OPEN_AFTER) {
        this._circuitOpenAt = Date.now();
      }

      if (this._state === 'connected') {
        this._setState('error');
        this._stopHeartbeat();
        this._scheduleReconnect(BASE_RECONNECT_DELAY_MS);
        for (const fn of this._disconnectHandlers) {
          try { fn(); } catch { /* isolate */ }
        }
      }
      this._notifyHealth();
    }
  }

  private async _reconnect(): Promise<void> {
    if (!this._userId || this._state === 'connected') return;
    if (this._isCircuitOpen()) {
      // Reset circuit after timeout and retry
      const age = Date.now() - (this._circuitOpenAt ?? 0);
      if (age < CIRCUIT_RESET_AFTER_MS) {
        this._scheduleReconnect(CIRCUIT_RESET_AFTER_MS - age);
        return;
      }
      this._circuitOpenAt    = null;
      this._consecutiveFails = 0;
    }

    this._setState('connecting');
    this._reconnectCount++;
    console.log(`[ConnectionManager] reconnect attempt #${this._reconnectCount}`);

    // Ping immediately to validate
    await this._beat();

    if (this._state === 'connected') {
      // Start normal interval heartbeat again
      this._startHeartbeat(HEARTBEAT_INTERVAL_MS);
    } else {
      // Still failed — schedule next retry with backoff
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, Math.min(this._reconnectCount - 1, 8)),
        MAX_RECONNECT_DELAY_MS,
      );
      this._scheduleReconnect(delay);
    }
  }

  private _onReconnected(): void {
    this._setState('connected');
    this._reconnectCount = 0;

    const queued = this.drainQueue();
    if (queued.length > 0) {
      console.log(`[ConnectionManager] flushing ${queued.length} queued events`);
      for (const evt of queued) {
        try { EventBus.emit(evt.type as any, evt.payload); } catch { /* isolate */ }
      }
    }

    for (const fn of this._reconnectHandlers) {
      try { fn(); } catch { /* isolate */ }
    }
    this._notifyHealth();
  }

  private _scheduleReconnect(delayMs: number): void {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._reconnect(), delayMs);
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private _startHeartbeat(intervalMs: number): void {
    this._stopHeartbeat();
    this._heartbeatId = setInterval(() => this._beat(), intervalMs);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatId) { clearInterval(this._heartbeatId); this._heartbeatId = null; }
  }

  // ── Lifecycle handlers ────────────────────────────────────────────────────

  private _handleForeground(): void {
    if (this._networkType !== 'offline') {
      if (this._state !== 'connected') {
        this._scheduleReconnect(0);
      } else {
        this._startHeartbeat(HEARTBEAT_INTERVAL_MS);
        this._beat();
      }
    }
  }

  private _handleBackground(): void {
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }

  // ── Circuit breaker ───────────────────────────────────────────────────────

  private _isCircuitOpen(): boolean {
    if (!this._circuitOpenAt) return false;
    const age = Date.now() - this._circuitOpenAt;
    if (age >= CIRCUIT_RESET_AFTER_MS) {
      this._circuitOpenAt    = null;
      this._consecutiveFails = 0;
      return false;
    }
    return true;
  }

  // ── Health score ─────────────────────────────────────────────────────────

  private _computeScore(): number {
    if (this._state === 'disconnected') return 0;
    if (this._networkType === 'offline')  return 0;
    let score = 100;
    // Latency penalty
    if      (this._latencyMs > 500) score -= 40;
    else if (this._latencyMs > 200) score -= 20;
    else if (this._latencyMs > 100) score -= 10;
    // Failures penalty
    score -= Math.min(this._consecutiveFails * 15, 60);
    return Math.max(0, score);
  }

  private _notifyHealth(): void {
    const h = this.getHealth();
    for (const fn of this._healthHandlers) { try { fn(h); } catch { /* isolate */ } }
  }

  // ── State ─────────────────────────────────────────────────────────────────

  private _setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const fn of this._stateHandlers) { try { fn(state); } catch { /* isolate */ } }
    EventBus.emit('connection:state_changed' as any, { state });
  }
}

export const ConnectionManager = new ConnectionManagerImpl();
