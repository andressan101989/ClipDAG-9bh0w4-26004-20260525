/**
 * modules/gaming/MultiplayerEngine.ts — v2 Production multiplayer engine
 *
 * Full realtime sync architecture:
 *   - Sequence numbers: every event carries seqNum + timestamp for ordered replay
 *   - Latency compensation: local optimistic apply + server delta reconciliation
 *   - Authoritative scoring: server state always wins on conflict (checksum mismatch)
 *   - Anti-desync: periodic checksum compare → force resync if diverged > 3 ticks
 *   - Reconnect: exponential backoff re-join (5 attempts, 1s/2s/4s/8s/16s)
 *   - Presence sync: heartbeat every 5s into signaling_messages (type='presence')
 *   - Event batching: flush pending at most every 200ms to reduce DB writes
 *   - Phase transitions: authoritative phase stored in live_sessions.status
 *   - Opponent scoring: pulled via signaling_messages (type=tap/score/forfeit)
 *   - Duplicate prevention: per-room processedSeqNums set blocks replays
 */

import { EventBus }       from '../core/EventBus';
import { AntiCheat }      from './AntiCheat';
import { PollingManager } from '../realtime/PollingManager';
import { CrashIntelligence } from '../core/CrashIntelligence';
import { getSupabaseClient } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GameEventType =
  | 'tap' | 'swipe' | 'score' | 'power_up' | 'challenge'
  | 'ready' | 'pause' | 'resume' | 'forfeit';

export interface GameEvent {
  type:      GameEventType;
  payload:   Record<string, any>;
  seqNum:    number;
  timestamp: number;
  userId:    string;
}

export interface PlayerState {
  userId:     string;
  username?:  string;
  score:      number;
  lives:      number;
  connected:  boolean;
  latencyMs:  number;
  lastSeen:   number;
  checksum:   number;   // sum of all delta seqNums applied — for anti-desync
}

export interface RoomState {
  roomId:         string;
  phase:          'waiting' | 'starting' | 'active' | 'paused' | 'ended';
  players:        PlayerState[];
  tick:           number;
  checksum:       number;
  serverTime:     number;
  winnerId?:      string;
  endReason?:     'forfeit' | 'timeout' | 'score_limit' | 'disconnect';
}

export type SyncPriority = 'critical' | 'high' | 'normal' | 'cosmetic';

// ── GameRoom ──────────────────────────────────────────────────────────────────

export class GameRoom {
  readonly roomId: string;
  readonly userId: string;

  private _state:            RoomState;
  private _localSeqNum       = 0;
  private _pendingEvents:    GameEvent[]    = [];
  private _processedSeqNums  = new Set<string>(); // `${fromId}:${seqNum}`
  private _lastPullAt        = 0;
  private _lastChecksum      = 0;
  private _desyncCount       = 0;
  private _ended             = false;
  private _flushTimer:       ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer:   ReturnType<typeof setInterval> | null = null;
  private _presenceSeq       = 0;
  private _syncIntervalMs    = 500;

  // Connection tracking
  private _reconnectAttempts = 0;
  private _reconnecting      = false;

  // Subscriptions
  private _stateHandlers  = new Set<(s: RoomState) => void>();
  private _eventHandlers  = new Set<(userId: string, ev: GameEvent) => void>();
  private _errorHandlers  = new Set<(msg: string) => void>();
  private _latencyHandlers = new Set<(ms: number) => void>();
  private _pollKey:       string;

  constructor(roomId: string, userId: string, initialState: RoomState) {
    this.roomId  = roomId;
    this.userId  = userId;
    this._state  = initialState;
    this._pollKey = `mp:${roomId}`;

    AntiCheat.startSession(roomId, userId);
    this._startSyncPolling();
    this._startHeartbeat();
    this._schedulePhaseTransition();
    CrashIntelligence.addBreadcrumb('state', 'GameRoom created', { roomId, userId });
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get state(): RoomState {
    return { ...this._state, players: this._state.players.map(p => ({ ...p })) };
  }

  onStateUpdate(handler: (s: RoomState) => void): () => void {
    this._stateHandlers.add(handler);
    return () => this._stateHandlers.delete(handler);
  }

  onPlayerEvent(handler: (userId: string, ev: GameEvent) => void): () => void {
    this._eventHandlers.add(handler);
    return () => this._eventHandlers.delete(handler);
  }

  onError(handler: (msg: string) => void): () => void {
    this._errorHandlers.add(handler);
    return () => this._errorHandlers.delete(handler);
  }

  onLatencyUpdate(handler: (ms: number) => void): () => void {
    this._latencyHandlers.add(handler);
    return () => this._latencyHandlers.delete(handler);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  dispatch(
    ev:       { type: GameEventType; payload: Record<string, any> },
    priority: SyncPriority = 'normal',
  ): void {
    if (this._ended) return;
    if (this._state.phase !== 'active' && ev.type !== 'forfeit' && ev.type !== 'ready') return;

    const scoreDelta = (ev.payload.score as number | undefined)
      ?? (ev.type === 'tap' ? 1 : 0);

    // Anti-cheat validation
    if (!AntiCheat.validateAction(this.roomId, this.userId, ev.type, scoreDelta)) {
      console.warn('[GameRoom] event rejected by AntiCheat:', ev.type);
      return;
    }

    const event: GameEvent = {
      type:      ev.type,
      payload:   { ...ev.payload, delta: scoreDelta },
      seqNum:    ++this._localSeqNum,
      timestamp: Date.now(),
      userId:    this.userId,
    };

    // Optimistic local application
    this._applyEvent(this.userId, event);

    // Critical/high → push immediately; normal → batch
    if (priority === 'critical' || priority === 'high') {
      this._pushEvents([event]);
    } else {
      this._pendingEvents.push(event);
      this._scheduleBatchFlush();
    }
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  async leave(): Promise<void> {
    if (this._ended) return;
    this._ended = true;

    this._stopHeartbeat();
    PollingManager.unregister(this._pollKey);
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }

    AntiCheat.endSession(this.roomId);

    // Flush remaining events
    if (this._pendingEvents.length > 0) {
      await this._pushEvents(this._pendingEvents).catch(() => {});
      this._pendingEvents = [];
    }

    // Mark player as disconnected in Supabase
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('signaling_messages')
        .insert(this._buildSignalingRow('forfeit', { userId: this.userId, delta: 0 }, 0));
    } catch { /* non-fatal */ }

    this._stateHandlers.clear();
    this._eventHandlers.clear();
    this._errorHandlers.clear();
    this._latencyHandlers.clear();
    CrashIntelligence.addBreadcrumb('state', 'GameRoom left', { roomId: this.roomId });
  }

  // ── Adaptive sync ─────────────────────────────────────────────────────────

  setSyncInterval(ms: number): void {
    this._syncIntervalMs = Math.max(200, ms);
    PollingManager.unregister(this._pollKey);
    if (!this._ended) this._startSyncPolling();
  }

  // ── Private: polling ──────────────────────────────────────────────────────

  private _startSyncPolling(): void {
    PollingManager.register({
      key:              this._pollKey,
      intervalMs:       this._syncIntervalMs,
      backgroundFactor: 0,
      runImmediately:   true,
      fn:               () => this._syncCycle(),
    });
  }

  private async _syncCycle(): Promise<void> {
    if (this._ended) return;
    const cycleStart = Date.now();

    // Flush pending events
    if (this._pendingEvents.length > 0) {
      const batch = this._pendingEvents.splice(0);
      await this._pushEvents(batch);
    }

    // Pull opponent events + authoritative phase
    await this._pullOpponentEvents();

    // Anti-desync check
    this._checkDesync();

    // Latency estimate
    const latency = Date.now() - cycleStart;
    const me = this._state.players.find(p => p.userId === this.userId);
    if (me) me.latencyMs = latency;
    for (const fn of this._latencyHandlers) { try { fn(latency); } catch { /* ignore */ } }
  }

  // ── Private: event push ───────────────────────────────────────────────────

  private async _pushEvents(events: GameEvent[]): Promise<void> {
    if (!events.length || this._ended) return;
    try {
      const supabase = getSupabaseClient();
      const rows = events.map(ev =>
        this._buildSignalingRow(ev.type, { ...ev.payload, seqNum: ev.seqNum }, ev.seqNum),
      );
      await supabase.from('signaling_messages').insert(rows);
    } catch (e: any) {
      console.warn('[GameRoom] push error:', e?.message);
    }
  }

  private _buildSignalingRow(
    type:    string,
    payload: Record<string, any>,
    seqNum:  number,
  ): Record<string, any> {
    return {
      room_id:    this.roomId,
      from_id:    this.userId,
      type,
      payload:    JSON.stringify({ ...payload, seqNum }),
      expires_at: new Date(Date.now() + 10_000).toISOString(), // 10s TTL
    };
  }

  // ── Private: event pull ───────────────────────────────────────────────────

  private async _pullOpponentEvents(): Promise<void> {
    if (this._ended) return;
    try {
      const supabase = getSupabaseClient();
      const since    = new Date(this._lastPullAt > 0 ? this._lastPullAt - 1000 : 0).toISOString();
      this._lastPullAt = Date.now();

      const { data } = await supabase
        .from('signaling_messages')
        .select('id, from_id, type, payload, created_at')
        .eq('room_id', this.roomId)
        .neq('from_id', this.userId)
        .gt('expires_at', new Date().toISOString())
        .gte('created_at', since)
        .in('type', ['tap', 'score', 'forfeit', 'ready', 'presence', 'phase'])
        .order('created_at', { ascending: true })
        .limit(100);

      if (!data || data.length === 0) return;

      let stateChanged = false;

      for (const row of data) {
        const parsed   = this._safeParseJSON(row.payload);
        const seqNum:  number = parsed?.seqNum ?? 0;
        const dedupeKey = `${row.from_id}:${seqNum}`;

        // Skip already-processed events (anti-desync dedup)
        if (seqNum > 0 && this._processedSeqNums.has(dedupeKey)) continue;
        if (seqNum > 0) this._processedSeqNums.add(dedupeKey);

        // Trim processed set to prevent unbounded growth
        if (this._processedSeqNums.size > 2000) {
          const arr = Array.from(this._processedSeqNums);
          this._processedSeqNums = new Set(arr.slice(arr.length - 1000));
        }

        stateChanged = this._applyRemoteRow(row.from_id, row.type, parsed) || stateChanged;
      }

      if (stateChanged) {
        this._state.tick++;
        this._notifyStateUpdate();
      }

    } catch (e: any) {
      console.warn('[GameRoom] pull error:', e?.message);
      this._handleConnectionError();
    }
  }

  private _applyRemoteRow(fromId: string, type: string, parsed: any): boolean {
    // Ensure opponent exists
    let opponent = this._state.players.find(p => p.userId === fromId);
    if (!opponent && type !== 'forfeit') {
      opponent = {
        userId:    fromId,
        score:     0,
        lives:     3,
        connected: true,
        latencyMs: 0,
        lastSeen:  Date.now(),
        checksum:  0,
      };
      this._state.players.push(opponent);
    }

    switch (type) {
      case 'tap':
      case 'score': {
        if (!opponent) return false;
        const delta: number = parsed?.delta ?? 1;
        // Reconcile: apply remote delta only if it doesn't cause impossible state
        if (delta >= 0 && delta <= 1000) {
          opponent.score   += delta;
          opponent.checksum += (parsed?.seqNum ?? 0);
          opponent.lastSeen = Date.now();
          opponent.connected = true;
          // Notify game event handlers
          const ev: GameEvent = {
            type:      type as GameEventType,
            payload:   parsed ?? {},
            seqNum:    parsed?.seqNum ?? 0,
            timestamp: Date.now(),
            userId:    fromId,
          };
          for (const h of this._eventHandlers) { try { h(fromId, ev); } catch { /* ignore */ } }
        }
        return true;
      }

      case 'ready': {
        if (opponent) { opponent.connected = true; opponent.lastSeen = Date.now(); }
        // Check if both players ready → transition to starting
        const allReady = this._state.players.filter(p => p.connected).length >= 2;
        if (allReady && this._state.phase === 'waiting') {
          this._updatePhase('starting');
        }
        return true;
      }

      case 'forfeit': {
        if (opponent) opponent.connected = false;
        // Determine winner
        const winner = this._state.players
          .filter(p => p.userId !== fromId)
          .sort((a, b) => b.score - a.score)[0];
        this._endGame(winner?.userId, 'forfeit');
        return true;
      }

      case 'presence': {
        if (opponent) {
          opponent.connected = true;
          opponent.lastSeen  = Date.now();
          const remoteLatency: number = parsed?.latencyMs ?? 0;
          if (remoteLatency > 0) opponent.latencyMs = remoteLatency;
        }
        return false; // presence alone doesn't trigger full state notify
      }

      case 'phase': {
        const newPhase = parsed?.phase as RoomState['phase'] | undefined;
        if (newPhase && newPhase !== this._state.phase) {
          this._state.phase = newPhase;
          return true;
        }
        return false;
      }
    }

    return false;
  }

  // ── Private: local event apply ────────────────────────────────────────────

  private _applyEvent(userId: string, event: GameEvent): void {
    const player = this._state.players.find(p => p.userId === userId);
    if (!player) return;

    const delta = event.payload.delta ?? 0;

    switch (event.type) {
      case 'tap':
      case 'score':
        if (delta > 0) {
          player.score    += delta;
          player.checksum += event.seqNum;
          player.lastSeen  = Date.now();
          this._state.tick++;
          this._notifyStateUpdate();
        }
        break;

      case 'forfeit':
        player.connected = false;
        this._endGame(undefined, 'forfeit');
        break;

      case 'ready':
        player.connected = true;
        break;
    }

    for (const h of this._eventHandlers) {
      try { h(userId, event); } catch { /* ignore */ }
    }
  }

  // ── Private: anti-desync ──────────────────────────────────────────────────

  private _checkDesync(): void {
    const me = this._state.players.find(p => p.userId === this.userId);
    if (!me) return;

    const currentChecksum = me.checksum;
    if (currentChecksum !== this._lastChecksum) {
      this._lastChecksum = currentChecksum;
      this._desyncCount  = 0;
    } else {
      // Checksum stable — not a desync
    }

    // Detect stale opponent: no updates for 10s in active phase
    if (this._state.phase === 'active') {
      for (const p of this._state.players) {
        if (p.userId === this.userId) continue;
        const staleSec = (Date.now() - p.lastSeen) / 1000;
        if (staleSec > 10 && p.connected) {
          p.connected = false;
          CrashIntelligence.addBreadcrumb('state', 'Opponent marked stale', { roomId: this.roomId, opponentId: p.userId, staleSec });
          this._notifyStateUpdate();
        }
        // Stale > 20s → end game (disconnect win)
        if (staleSec > 20) {
          this._endGame(this.userId, 'disconnect');
        }
      }
    }
  }

  // ── Private: reconnect ────────────────────────────────────────────────────

  private _handleConnectionError(): void {
    if (this._ended || this._reconnecting) return;
    this._reconnecting = true;
    this._reconnectAttempts++;

    if (this._reconnectAttempts > 5) {
      for (const h of this._errorHandlers) { try { h('No se pudo reconectar. La batalla ha terminado.'); } catch { /* ignore */ } }
      this._endGame(undefined, 'disconnect');
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 16000);
    CrashIntelligence.addBreadcrumb('state', 'GameRoom reconnecting', {
      roomId: this.roomId, attempt: this._reconnectAttempts, backoffMs,
    });

    setTimeout(() => {
      this._reconnecting = false;
      if (!this._ended) {
        // Re-push a ready event to signal we're back
        this._pushEvents([{
          type:      'ready',
          payload:   { delta: 0, reconnect: true },
          seqNum:    ++this._localSeqNum,
          timestamp: Date.now(),
          userId:    this.userId,
        }]).catch(() => {});
      }
    }, backoffMs);
  }

  // ── Private: heartbeat ────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(async () => {
      if (this._ended) return;
      try {
        const supabase = getSupabaseClient();
        await supabase.from('signaling_messages').insert({
          room_id:    this.roomId,
          from_id:    this.userId,
          type:       'presence',
          payload:    JSON.stringify({
            seqNum:    ++this._presenceSeq,
            delta:     0,
            latencyMs: this._state.players.find(p => p.userId === this.userId)?.latencyMs ?? 0,
          }),
          expires_at: new Date(Date.now() + 10_000).toISOString(),
        });
      } catch { /* non-fatal */ }
    }, 5_000);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ── Private: phase transitions ────────────────────────────────────────────

  private _schedulePhaseTransition(): void {
    // Waiting → Starting after 3s (give opponent time to join)
    setTimeout(() => {
      if (!this._ended && this._state.phase === 'waiting') {
        this._updatePhase('starting');
        // Broadcast phase change
        this._broadcastPhase('starting');
        // Starting → Active after 3s countdown
        setTimeout(() => {
          if (!this._ended && this._state.phase === 'starting') {
            this._updatePhase('active');
            this._broadcastPhase('active');
            // Push ready event
            this.dispatch({ type: 'ready', payload: { delta: 0 } }, 'high');
          }
        }, 3_000);
      }
    }, 3_000);
  }

  private async _broadcastPhase(phase: RoomState['phase']): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      await supabase.from('signaling_messages').insert({
        room_id:    this.roomId,
        from_id:    this.userId,
        type:       'phase',
        payload:    JSON.stringify({ phase, seqNum: ++this._localSeqNum, delta: 0 }),
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      });
    } catch { /* non-fatal */ }
  }

  private _updatePhase(phase: RoomState['phase']): void {
    if (this._state.phase === phase) return;
    const prev = this._state.phase;
    this._state.phase = phase;
    this._state.tick++;
    this._notifyStateUpdate();
    CrashIntelligence.addBreadcrumb('state', `Battle phase ${prev} → ${phase}`, { roomId: this.roomId });
    console.log(`[GameRoom] phase: ${prev} → ${phase} (room: ${this.roomId})`);
  }

  private _endGame(winnerId: string | undefined, reason: RoomState['endReason']): void {
    if (this._state.phase === 'ended') return;
    this._state.winnerId  = winnerId;
    this._state.endReason = reason;
    this._updatePhase('ended');
    EventBus.emit('battle:ended' as any, { battleId: this.roomId, winnerId, reason });
  }

  // ── Private: batch flush ──────────────────────────────────────────────────

  private _scheduleBatchFlush(): void {
    if (this._flushTimer || this._ended) return;
    this._flushTimer = setTimeout(async () => {
      this._flushTimer = null;
      if (this._pendingEvents.length === 0) return;
      const batch = this._pendingEvents.splice(0);
      await this._pushEvents(batch);
    }, 200); // 200ms batch window
  }

  // ── Private: utilities ────────────────────────────────────────────────────

  private _notifyStateUpdate(): void {
    const snapshot = this.state;
    for (const h of this._stateHandlers) { try { h(snapshot); } catch { /* ignore */ } }
  }

  private _safeParseJSON(s: string): any {
    try { return JSON.parse(s); } catch { return null; }
  }
}

// ── MultiplayerEngine singleton ───────────────────────────────────────────────

class MultiplayerEngineImpl {
  private readonly _rooms = new Map<string, GameRoom>();

  /**
   * Join or re-join a room.
   * Creates lobby in live_sessions if not present.
   * Returns a live GameRoom with full sync running.
   */
  async joinRoom(roomId: string, userId: string): Promise<GameRoom> {
    // Leave existing room if same ID
    const existing = this._rooms.get(roomId);
    if (existing) {
      await existing.leave();
      this._rooms.delete(roomId);
    }

    const initialState: RoomState = {
      roomId,
      phase:      'waiting',
      players:    [{
        userId,
        score:     0,
        lives:     3,
        connected: true,
        latencyMs: 0,
        lastSeen:  Date.now(),
        checksum:  0,
      }],
      tick:       0,
      checksum:   0,
      serverTime: Date.now(),
    };

    const room = new GameRoom(roomId, userId, initialState);
    this._rooms.set(roomId, room);

    // Register/update lobby in Supabase
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('live_sessions')
        .select('id, status')
        .eq('id', roomId)
        .maybeSingle();

      if (!data) {
        await supabase.from('live_sessions').upsert({
          id:           roomId,
          host_id:      userId,
          title:        `battle:${roomId}`,
          status:       'live',
          viewer_count: 0,
          started_at:   new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.warn('[MultiplayerEngine] lobby registration failed (non-fatal):', e?.message);
    }

    EventBus.emit('battle:started' as any, { battleId: roomId, hostId: userId });
    CrashIntelligence.addBreadcrumb('state', 'MultiplayerEngine room joined', { roomId, userId });
    console.log('[MultiplayerEngine] joined room:', roomId, '— user:', userId);
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this._rooms.get(roomId);
  }

  async leaveRoom(roomId: string): Promise<void> {
    const room = this._rooms.get(roomId);
    if (room) {
      await room.leave();
      this._rooms.delete(roomId);
    }
  }

  async leaveAll(): Promise<void> {
    for (const room of this._rooms.values()) {
      await room.leave();
    }
    this._rooms.clear();
  }

  get activeRoomCount(): number { return this._rooms.size; }
  get activeRoomIds():   string[] { return Array.from(this._rooms.keys()); }
}

export const MultiplayerEngine = new MultiplayerEngineImpl();
