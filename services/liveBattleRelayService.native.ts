import {
  ChannelMediaRelayError,
  ChannelMediaRelayState,
  type ChannelMediaRelayConfiguration,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';
import {
  LiveBattleRelayError,
  type LiveBattleRelayCredentials,
  type LiveBattleRelaySnapshot,
  requestLiveBattleRelayCredentials,
} from './liveBattleRelayContract';

export type LiveBattleRelayListener = (snapshot: LiveBattleRelaySnapshot) => void;

type RelayEngine = Pick<
  IRtcEngine,
  'registerEventHandler'
  | 'unregisterEventHandler'
  | 'startOrUpdateChannelMediaRelay'
  | 'stopChannelMediaRelay'
>;

type RelayDependencies = {
  requestCredentials?: (battleId: string) => Promise<LiveBattleRelayCredentials>;
  logger?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
  onReconfigure?: () => void;
  onStopped?: () => void;
};

export const RELAY_CREDENTIAL_REUSE_MARGIN_MS = 10_000;
type ActiveTransport = {
  identity: string; authorizedAt: number; expiresAt: number;
};
// No tokens are retained or compared. The canonical session pair is part of identity.
function transportIdentity(credentials: LiveBattleRelayCredentials): string {
  const { source, destination } = credentials.battleRelay;
  return JSON.stringify([credentials.appId, source.liveSessionId, source.channel, source.uid,
    destination.liveSessionId, destination.channel, destination.uid]);
}

function shortId(value: string): string {
  return value.slice(-8);
}

function defaultRelayLogger(event: string, data: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(`[LIVE-BATTLE-RELAY] ${event}`, data);
}

function relayFailureCode(code: number): string {
  if (code === ChannelMediaRelayError.RelayErrorSrcTokenExpired
    || code === ChannelMediaRelayError.RelayErrorDestTokenExpired) {
    return 'battle_relay_token_expired';
  }
  if (code === ChannelMediaRelayError.RelayErrorFailedJoinSrc
    || code === ChannelMediaRelayError.RelayErrorFailedJoinDest) {
    return 'battle_relay_channel_join_failed';
  }
  if (code === ChannelMediaRelayError.RelayErrorServerNoResponse) {
    return 'battle_relay_service_unavailable';
  }
  if (code === ChannelMediaRelayError.RelayErrorServerConnectionLost) {
    return 'battle_relay_connection_lost';
  }
  if (code === ChannelMediaRelayError.RelayErrorFailedPacketReceivedFromSrc
    || code === ChannelMediaRelayError.RelayErrorFailedPacketSentToDest) {
    return 'battle_relay_transport_failed';
  }
  return 'battle_relay_agora_state_failure';
}

function configurationFrom(credentials: LiveBattleRelayCredentials): ChannelMediaRelayConfiguration {
  const relay = credentials.battleRelay;
  return {
    srcInfo: {
      channelName: relay.source.channel,
      uid: relay.source.uid,
      token: relay.source.token,
    },
    destInfos: [{
      channelName: relay.destination.channel,
      uid: relay.destination.uid,
      token: relay.destination.token,
    }],
    destCount: 1,
  };
}

export class LiveBattleRelayService {
  private snapshot: LiveBattleRelaySnapshot = {
    state: 'idle',
    battleId: null,
    errorCode: null,
    relayCode: null,
  };
  private readonly listeners = new Set<LiveBattleRelayListener>();
  private readonly requestCredentials: (battleId: string) => Promise<LiveBattleRelayCredentials>;
  private handler: IRtcEngineEventHandler | null = null;
  private activeBattleId: string | null = null;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private pendingStart: { battleId: string; promise: Promise<LiveBattleRelaySnapshot> } | null = null;
  private pendingRefresh: { battleId: string; promise: Promise<LiveBattleRelaySnapshot> } | null = null;
  private pendingStop: Promise<LiveBattleRelaySnapshot> | null = null;
  private preserveRunningDuringRefreshBattleId: string | null = null;
  private disposeFlight: Promise<void> | null = null;
  private disposed = false;
  private activeTransport: ActiveTransport | null = null;
  private nativeRunning = false;
  private readonly now: () => number;
  private readonly logger: (event: string, data: Record<string, unknown>) => void;

  constructor(
    private readonly engine: RelayEngine,
    private readonly dependencies: RelayDependencies = {},
  ) {
    this.requestCredentials = dependencies.requestCredentials ?? requestLiveBattleRelayCredentials;
    this.logger = dependencies.logger ?? defaultRelayLogger;
    this.now = dependencies.now ?? (() => performance.now());
  }

  getSnapshot(): LiveBattleRelaySnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: LiveBattleRelayListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getSnapshot());
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private publish(next: LiveBattleRelaySnapshot): LiveBattleRelaySnapshot {
    this.snapshot = next;
    for (const listener of this.listeners) {
      try { listener(this.getSnapshot()); } catch { /* one observer cannot break relay state */ }
    }
    return this.getSnapshot();
  }

  private setState(
    state: LiveBattleRelaySnapshot['state'],
    battleId: string | null,
    errorCode: string | null = null,
    relayCode: number | null = null,
  ): LiveBattleRelaySnapshot {
    if (state === 'failed' || state === 'idle' || state === 'stopping') this.invalidateTransport();
    return this.publish({ state, battleId, errorCode, relayCode });
  }

  setVisualContinuityHandlers(handlers: Pick<RelayDependencies, 'onReconfigure' | 'onStopped'>): void {
    if (this.disposed || this.activeBattleId) return;
    this.dependencies.onReconfigure = handlers.onReconfigure;
    this.dependencies.onStopped = handlers.onStopped;
  }

  private invalidateTransport(): void {
    this.activeTransport = null;
    this.nativeRunning = false;
    this.dependencies.onStopped?.();
  }

  private canReuse(credentials: LiveBattleRelayCredentials): boolean {
    const engine = this.engine as RelayEngine & { getConnectionState?: () => number };
    let connected = false;
    try { connected = engine.getConnectionState?.() === 3; } catch { /* fail closed */ }
    return connected && this.nativeRunning && this.activeTransport !== null
      && this.activeTransport.identity === transportIdentity(credentials)
      // Fresh server authorization supplies the required horizon, including the
      // canonical round/countdown or rematch window. Never guess a round length.
      && this.activeTransport.expiresAt >= this.now()
        + credentials.battleRelay.expiresIn * 1_000 + RELAY_CREDENTIAL_REUSE_MARGIN_MS;
  }

  private rememberTransport(credentials: LiveBattleRelayCredentials, authorizedAt: number): void {
    this.activeTransport = { identity: transportIdentity(credentials), authorizedAt,
      // Start at request time and subtract server whole-second rounding.
      expiresAt: authorizedAt + credentials.battleRelay.expiresIn * 1_000 - 1_000 };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private unregisterOwnHandler(): void {
    const handler = this.handler;
    this.handler = null;
    if (!handler) return;
    try { this.engine.unregisterEventHandler(handler); } catch { /* teardown is best-effort */ }
  }

  private installHandler(generation: number, battleId: string): void {
    this.unregisterOwnHandler();
    const handler: IRtcEngineEventHandler = {
      onConnectionStateChanged: (_connection, state) => {
        if (this.handler !== handler || this.disposed) return;
        // This existing relay listener only invalidates credentials; UID ownership
        // and connection recovery remain in the engine hook/runtime.
        if (state !== 3) this.invalidateTransport();
      },
      onChannelMediaRelayStateChanged: (state, code) => {
        if (this.disposed || this.handler !== handler) return;
        this.nativeRunning = state === ChannelMediaRelayState.RelayStateRunning
          && code === ChannelMediaRelayError.RelayOk;
        if (state === ChannelMediaRelayState.RelayStateFailure || code !== ChannelMediaRelayError.RelayOk) {
          this.invalidateTransport();
        }
        if (generation !== this.generation) return;
        this.logger('state', { battle: shortId(battleId), state, code });
        if (state === ChannelMediaRelayState.RelayStateIdle) {
          this.preserveRunningDuringRefreshBattleId = null;
          this.activeBattleId = null;
          this.setState('failed', battleId, 'battle_relay_stopped', code);
          this.unregisterOwnHandler();
        } else if (state === ChannelMediaRelayState.RelayStateConnecting) {
          if (this.preserveRunningDuringRefreshBattleId === battleId
            && this.snapshot.state === 'running') return;
          this.setState('connecting', battleId, null, code);
        } else if (state === ChannelMediaRelayState.RelayStateRunning
          && code === ChannelMediaRelayError.RelayOk) {
          this.preserveRunningDuringRefreshBattleId = null;
          this.setState('running', battleId, null, code);
        } else if (state === ChannelMediaRelayState.RelayStateFailure
          || code !== ChannelMediaRelayError.RelayOk) {
          this.preserveRunningDuringRefreshBattleId = null;
          this.setState('failed', battleId, relayFailureCode(code), code);
        }
      },
    };
    if (!this.engine.registerEventHandler(handler)) {
      throw new LiveBattleRelayError('battle_relay_listener_registration_failed');
    }
    this.handler = handler;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation || this.disposed) {
      throw new LiveBattleRelayError('battle_relay_operation_superseded');
    }
  }

  private async stopLocked(generation: number): Promise<LiveBattleRelaySnapshot> {
    this.assertCurrent(generation);
    if (!this.activeBattleId && !this.handler) {
      return this.setState('idle', null, null, null);
    }
    const battleId = this.activeBattleId ?? this.snapshot.battleId;
    this.preserveRunningDuringRefreshBattleId = null;
    this.setState('stopping', battleId);
    this.unregisterOwnHandler();
    const result = this.engine.stopChannelMediaRelay();
    this.logger('stop_result', { battle: battleId ? shortId(battleId) : null, result });
    if (result < 0) {
      throw new LiveBattleRelayError('battle_relay_agora_stop_failed', undefined, result);
    }
    this.assertCurrent(generation);
    this.activeBattleId = null;
    return this.setState('idle', null, null, null);
  }

  start(battleId: string): Promise<LiveBattleRelaySnapshot> {
    if (this.disposed) return Promise.reject(new LiveBattleRelayError('battle_relay_disposed'));
    if (this.pendingStart?.battleId === battleId) return this.pendingStart.promise;
    if (this.activeBattleId === battleId
      && (this.snapshot.state === 'connecting' || this.snapshot.state === 'running')) {
      return Promise.resolve(this.getSnapshot());
    }

    const generation = ++this.generation;
    this.preserveRunningDuringRefreshBattleId = null;
    const promise = this.enqueue(async () => {
      this.assertCurrent(generation);
      if (this.activeBattleId && this.activeBattleId !== battleId) {
        await this.stopLocked(generation);
      }
      this.setState('authorizing', battleId);
      this.logger('start_requested', { battle: shortId(battleId) });
      const authorizedAt = this.now();
      const credentials = await this.requestCredentials(battleId);
      this.assertCurrent(generation);
      this.logger('authorized', { battle: shortId(battleId) });
      this.installHandler(generation, battleId);
      this.activeBattleId = battleId;
      const relay = credentials.battleRelay;
      this.setState('connecting', battleId, null, null);
      this.logger('start', {
        battle: shortId(battleId),
        route: `${shortId(relay.source.liveSessionId)}->${shortId(relay.destination.liveSessionId)}`,
        sourceUid: relay.source.uid,
        destinationUid: relay.destination.uid,
      });
      this.rememberTransport(credentials, authorizedAt);
      const result = this.engine.startOrUpdateChannelMediaRelay(configurationFrom(credentials));
      this.logger('start_result', { battle: shortId(battleId), result });
      if (typeof result !== 'number' || result !== 0) {
        this.unregisterOwnHandler();
        this.activeBattleId = null;
        const relayCode = typeof result === 'number' ? result : -1;
        this.setState('failed', battleId, 'battle_relay_agora_start_failed', relayCode);
        throw new LiveBattleRelayError('battle_relay_agora_start_failed', undefined, relayCode);
      }
      return this.getSnapshot();
    }).catch(error => {
      if (generation === this.generation && !this.disposed) this.logger('start_failed', {
        battle: shortId(battleId), state: this.snapshot.state,
      });
      if (error instanceof LiveBattleRelayError
        && error.code !== 'battle_relay_operation_superseded'
        && generation === this.generation
        && this.snapshot.state !== 'failed') {
        this.setState('failed', battleId, error.code, error.relayCode ?? null);
      }
      throw error;
    });
    this.pendingStart = { battleId, promise };
    void promise.then(
      () => { if (this.pendingStart?.promise === promise) this.pendingStart = null; },
      () => { if (this.pendingStart?.promise === promise) this.pendingStart = null; },
    );
    return promise;
  }

  transition(battleId: string): Promise<LiveBattleRelaySnapshot> {
    if (this.disposed) return Promise.reject(new LiveBattleRelayError('battle_relay_disposed'));
    if (!this.activeBattleId) return this.start(battleId);
    if (this.pendingStart?.battleId === battleId) return this.pendingStart.promise;
    if (this.activeBattleId === battleId
      && (this.snapshot.state === 'connecting' || this.snapshot.state === 'running')) {
      return Promise.resolve(this.getSnapshot());
    }

    const generation = ++this.generation;
    this.preserveRunningDuringRefreshBattleId = null;
    const promise = this.enqueue(async () => {
      this.assertCurrent(generation);
      const wasRunning = this.nativeRunning;
      const previousBattleId = this.activeBattleId;
      const authorizedAt = this.now();
      const credentials = await this.requestCredentials(battleId);
      this.assertCurrent(generation);
      const reuse = this.canReuse(credentials);
      this.installHandler(generation, battleId);
      if (reuse) {
        this.activeBattleId = battleId;
        this.logger('transition_reused', { previousBattle: previousBattleId ? shortId(previousBattleId) : null,
          battle: shortId(battleId), route: `${shortId(credentials.battleRelay.source.liveSessionId)}->${shortId(credentials.battleRelay.destination.liveSessionId)}` });
        return this.setState('running', battleId);
      }
      const relay = credentials.battleRelay;
      const continuesRunning = wasRunning && this.nativeRunning;
      if (continuesRunning) this.dependencies.onReconfigure?.();
      this.nativeRunning = false;
      this.rememberTransport(credentials, authorizedAt);
      if (continuesRunning) this.preserveRunningDuringRefreshBattleId = battleId;
      this.setState(continuesRunning ? 'running' : 'connecting', battleId, null, null);
      this.logger('update', {
        battle: shortId(battleId),
        route: `${shortId(relay.source.liveSessionId)}->${shortId(relay.destination.liveSessionId)}`,
        sourceUid: relay.source.uid,
        destinationUid: relay.destination.uid,
      });
      const result = this.engine.startOrUpdateChannelMediaRelay(configurationFrom(credentials));
      this.logger('update_result', { battle: shortId(battleId), result });
      if (typeof result !== 'number' || result !== 0) {
        this.unregisterOwnHandler();
        try { this.engine.stopChannelMediaRelay(); } catch { /* fail closed */ }
        this.activeBattleId = null;
        const relayCode = typeof result === 'number' ? result : -1;
        this.setState('failed', battleId, 'battle_relay_agora_start_failed', relayCode);
        throw new LiveBattleRelayError('battle_relay_agora_start_failed', undefined, relayCode);
      }
      this.activeBattleId = battleId;
      return this.getSnapshot();
    }).catch(error => {
      if (generation === this.generation && this.activeBattleId && this.activeBattleId !== battleId) {
        this.unregisterOwnHandler();
        try { this.engine.stopChannelMediaRelay(); } catch { /* fail closed */ }
        this.activeBattleId = null;
      }
      if (generation === this.generation && !(error instanceof LiveBattleRelayError)) {
        this.setState('failed', battleId, 'battle_relay_agora_start_failed');
      }
      if (error instanceof LiveBattleRelayError
        && error.code !== 'battle_relay_operation_superseded'
        && generation === this.generation
        && this.snapshot.state !== 'failed') {
        this.setState('failed', battleId, error.code, error.relayCode ?? null);
      }
      throw error;
    });
    this.pendingStart = { battleId, promise };
    void promise.then(
      () => { if (this.pendingStart?.promise === promise) this.pendingStart = null; },
      () => { if (this.pendingStart?.promise === promise) this.pendingStart = null; },
    );
    return promise;
  }

  refreshCredentials(battleId: string): Promise<LiveBattleRelaySnapshot> {
    if (this.disposed) return Promise.reject(new LiveBattleRelayError('battle_relay_disposed'));
    if (this.pendingRefresh?.battleId === battleId) return this.pendingRefresh.promise;
    if (this.activeBattleId !== battleId
      || !this.handler
      || (this.snapshot.state !== 'connecting' && this.snapshot.state !== 'running')) {
      return Promise.reject(new LiveBattleRelayError('battle_relay_refresh_not_active'));
    }

    const generation = this.generation;
    const promise = this.enqueue(async () => {
      this.assertCurrent(generation);
      if (this.activeBattleId !== battleId || !this.handler) {
        throw new LiveBattleRelayError('battle_relay_refresh_not_active');
      }
      const preserveRunning = this.snapshot.state === 'running';
      const authorizedAt = this.now();
      const credentials = await this.requestCredentials(battleId);
      this.assertCurrent(generation);
      if (this.activeBattleId !== battleId) {
        throw new LiveBattleRelayError('battle_relay_operation_superseded');
      }
      if (this.canReuse(credentials)) {
        this.logger('refresh_reused', { battle: shortId(battleId) });
        return this.getSnapshot();
      }
      this.installHandler(generation, battleId);
      if (preserveRunning) this.preserveRunningDuringRefreshBattleId = battleId;
      if (this.nativeRunning) this.dependencies.onReconfigure?.();
      this.nativeRunning = false;
      this.rememberTransport(credentials, authorizedAt);
      const relay = credentials.battleRelay;
      this.logger('refresh', {
        battle: shortId(battleId),
        route: `${shortId(relay.source.liveSessionId)}->${shortId(relay.destination.liveSessionId)}`,
        sourceUid: relay.source.uid,
        destinationUid: relay.destination.uid,
      });
      const result = this.engine.startOrUpdateChannelMediaRelay(configurationFrom(credentials));
      this.logger('refresh_result', { battle: shortId(battleId), result });
      if (typeof result !== 'number' || result !== 0) {
        throw new LiveBattleRelayError(
          'battle_relay_credential_refresh_failed',
          undefined,
          typeof result === 'number' ? result : -1,
        );
      }
      return this.getSnapshot();
    }).catch(error => {
      if (generation !== this.generation || this.disposed) throw error;
      this.preserveRunningDuringRefreshBattleId = null;
      this.unregisterOwnHandler();
      if (this.activeBattleId === battleId) {
        try { this.engine.stopChannelMediaRelay(); } catch { /* fail closed */ }
      }
      this.activeBattleId = null;
      const relayCode = error instanceof LiveBattleRelayError ? error.relayCode ?? null : null;
      this.setState(
        'failed',
        battleId,
        'battle_relay_credential_refresh_failed',
        relayCode,
      );
      throw new LiveBattleRelayError(
        'battle_relay_credential_refresh_failed',
        undefined,
        relayCode ?? undefined,
      );
    });
    this.pendingRefresh = { battleId, promise };
    void promise.then(
      () => { if (this.pendingRefresh?.promise === promise) this.pendingRefresh = null; },
      () => { if (this.pendingRefresh?.promise === promise) this.pendingRefresh = null; },
    );
    return promise;
  }

  stop(): Promise<LiveBattleRelaySnapshot> {
    this.invalidateTransport();
    if (this.disposed) return Promise.resolve(this.getSnapshot());
    if (this.pendingStop) return this.pendingStop;
    const generation = ++this.generation;
    const promise = this.enqueue(() => this.stopLocked(generation)).catch(error => {
      if (error instanceof LiveBattleRelayError && generation === this.generation) {
        this.setState('failed', this.activeBattleId, error.code, error.relayCode ?? null);
      }
      throw error;
    });
    this.pendingStop = promise;
    void promise.then(
      () => { if (this.pendingStop === promise) this.pendingStop = null; },
      () => { if (this.pendingStop === promise) this.pendingStop = null; },
    );
    return promise;
  }

  /** Stops relay synchronously before the owning LIVE engine leaves/releases. */
  stopImmediately(): void {
    this.invalidateTransport();
    if (this.disposed) return;
    this.generation += 1;
    this.pendingStart = null;
    this.pendingRefresh = null;
    this.pendingStop = null;
    this.preserveRunningDuringRefreshBattleId = null;
    this.unregisterOwnHandler();
    if (this.activeBattleId) {
      try { this.engine.stopChannelMediaRelay(); } catch { /* LIVE teardown must continue */ }
    }
    this.activeBattleId = null;
    this.setState('idle', null, null, null);
  }

  dispose(): Promise<void> {
    this.invalidateTransport();
    if (this.disposeFlight) return this.disposeFlight;
    const generation = ++this.generation;
    this.disposed = true;
    this.disposeFlight = this.enqueue(async () => {
      try {
        if (this.activeBattleId || this.handler) {
          this.disposed = false;
          await this.stopLocked(generation);
          this.disposed = true;
        }
      } finally {
        this.unregisterOwnHandler();
        this.preserveRunningDuringRefreshBattleId = null;
        this.activeBattleId = null;
        this.listeners.clear();
        this.snapshot = {
          state: 'idle', battleId: null, errorCode: null, relayCode: null,
        };
        this.disposed = true;
      }
    });
    return this.disposeFlight;
  }
}

export { configurationFrom as buildLiveBattleRelayConfiguration };
export { relayFailureCode as classifyLiveBattleRelayFailure };
export type {
  LiveBattleRelayCredentials,
  LiveBattleRelaySnapshot,
  LiveBattleRelayState,
} from './liveBattleRelayContract';
