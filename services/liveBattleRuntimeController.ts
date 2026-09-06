import {
  getLiveBattleState,
  getOpenLiveBattlesForSession,
  isLiveBattleUuid,
  subscribeToLiveBattlesForSession,
  type LiveBattle,
  type LiveBattleSessionSignal,
  type LiveBattleSubscription,
} from './liveBattleService';
import type { LiveBattleRelaySnapshot } from './liveBattleRelayContract';
import {
  getLiveBattleRelayDecisionDeadline,
  resolveLiveBattleRelayPolicy,
  type LiveBattleRelayDecision,
} from './liveBattlePostRoundRelayPolicy';
import type {
  LiveBattlePublicSnapshot,
  LiveBattlePublicState,
  LiveBattleRelaySessionPairAuthority,
  LiveBattleServerClockAnchor,
} from './liveBattleSpectatorService';

export type LiveBattleRuntimeContext = {
  liveSessionId: string | null;
  hostUserId: string | null;
  isCanonicalHost: boolean;
  isSessionLive: boolean;
  isOpponentSessionLive?: boolean;
  engineReady: boolean;
  joined: boolean;
  isForeground: boolean;
};

export type LiveBattleRuntimeStatus =
  | 'idle'
  | 'observing'
  | 'relaying'
  | 'failed'
  | 'disposed';

export type LiveBattleRuntimeSnapshot = {
  publicAuthorityKey?: string;
  status: LiveBattleRuntimeStatus;
  battleId: string | null;
  version: number | null;
  errorCode: string | null;
  battle: LiveBattle | null;
};

export type LiveBattleRuntimeListener = (snapshot: LiveBattleRuntimeSnapshot) => void;

export type LiveBattleRuntimeRelay = {
  start: (battleId: string) => Promise<unknown>;
  refreshCredentials: (battleId: string) => Promise<unknown>;
  transition: (battleId: string) => Promise<unknown>;
  stop: () => Promise<unknown>;
  stopImmediately: () => void;
  dispose: () => Promise<void>;
  getSnapshot: () => LiveBattleRelaySnapshot;
  subscribe: (listener: (snapshot: LiveBattleRelaySnapshot) => void) => () => void;
};

export type LiveBattleRuntimeDependencies = {
  discover?: (sessionId: string) => Promise<LiveBattle[]>;
  reconcile?: (battleId: string) => Promise<LiveBattle>;
  subscribe?: (
    sessionId: string,
    onSignal: (signal: LiveBattleSessionSignal) => void,
    onError: () => void,
  ) => LiveBattleSubscription;
  relay: LiveBattleRuntimeRelay;
  onTerminalAuthority?: (battleId: string) => void;
  readPublicAuthority?: (sessionId: string) => Promise<LiveBattlePublicSnapshot>;
  validateSessionPair?: (
    state: LiveBattlePublicState,
  ) => Promise<LiveBattleRelaySessionPairAuthority>;
  now?: () => number;
  monotonicNow?: () => number | null;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

type LiveBattleAuthorityRead =
  | {
      status: 'validated';
      state: LiveBattlePublicState;
      sessionPair: LiveBattleRelaySessionPairAuthority;
      serverNowMs: number;
    }
  | { status: 'invalid' }
  | { status: 'unavailable' };

const RELAY_STATUSES = new Set(['countdown', 'active']);
const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'expired']);
const DEADLINE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const DEADLINE_CHECKPOINT_MS = {
  pending: 10_000,
  countdown: 1_000,
  active: 30_000,
} as const;
const DEADLINE_CLOCK_TOLERANCE_MS = 25;
let runtimeSequence = 0;

const EMPTY_CONTEXT: LiveBattleRuntimeContext = {
  liveSessionId: null,
  hostUserId: null,
  isCanonicalHost: false,
  isSessionLive: false,
  isOpponentSessionLive: true,
  engineReady: false,
  joined: false,
  isForeground: false,
};

function contextIsEligible(context: LiveBattleRuntimeContext): boolean {
  return isLiveBattleUuid(context.liveSessionId)
    && isLiveBattleUuid(context.hostUserId)
    && context.isCanonicalHost
    && context.isSessionLive
    && context.isOpponentSessionLive !== false
    && context.engineReady
    && context.joined
    && context.isForeground;
}

function battleBelongsToHostSession(
  battle: LiveBattle,
  context: LiveBattleRuntimeContext,
): boolean {
  return (
    (battle.challengerSessionId === context.liveSessionId
      && battle.challengerUserId === context.hostUserId)
    || (battle.opponentSessionId === context.liveSessionId
      && battle.opponentUserId === context.hostUserId)
  );
}

export class LiveBattleRuntimeController {
  private readonly runtimeId = ++runtimeSequence;
  private readonly discover: (sessionId: string) => Promise<LiveBattle[]>;
  private readonly reconcile: (battleId: string) => Promise<LiveBattle>;
  private readonly createSubscription: NonNullable<LiveBattleRuntimeDependencies['subscribe']>;
  private context = EMPTY_CONTEXT;
  private snapshot: LiveBattleRuntimeSnapshot = {
    status: 'idle',
    battleId: null,
    version: null,
    errorCode: null,
    battle: null,
  };
  private readonly listeners = new Set<LiveBattleRuntimeListener>();
  private subscription: LiveBattleSubscription | null = null;
  private subscriptionGeneration = 0;
  private generation = 0;
  private refreshFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private relayBattleId: string | null = null;
  private relaySeriesId: string | null = null;
  private relayRoundNumber: number | null = null;
  private relayDecision: LiveBattleRelayDecision = 'stop_terminal';
  private publicState: LiveBattlePublicState | null = null;
  private publicClockAnchor: LiveBattleServerClockAnchor | null = null;
  private authorityServerNowMs: number | null = null;
  private postRoundCredentialRefreshKey: string | null = null;
  private lastValidatedPostRoundAuthority: {
    battleId: string;
    key: string;
    deadlineMs: number;
  } | null = null;
  private postRoundAuthorityRetryUsed = false;
  private relayOperationPossible = false;
  private attemptedRelayVersion: string | null = null;
  private readonly observedVersions = new Map<string, number>();
  private suspended = false;
  private disposed = false;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledDeadlineKey: string | null = null;
  private deadlineWakeKey: string | null = null;
  private deadlineBackoffStep = 0;
  private deadlineBackoffReason: 'none' | 'deadline' | 'error' = 'none';
  private readonly now: () => number;
  private readonly monotonicNow: () => number | null;
  private readonly setTimer: NonNullable<LiveBattleRuntimeDependencies['setTimer']>;
  private readonly clearTimer: NonNullable<LiveBattleRuntimeDependencies['clearTimer']>;
  private relayUnsubscribe: (() => void) | null = null;
  private reconnectRetryFlight: Promise<void> | null = null;

  constructor(private readonly dependencies: LiveBattleRuntimeDependencies) {
    this.discover = dependencies.discover ?? getOpenLiveBattlesForSession;
    this.reconcile = dependencies.reconcile ?? getLiveBattleState;
    this.createSubscription = dependencies.subscribe ?? subscribeToLiveBattlesForSession;
    this.now = dependencies.now ?? Date.now;
    this.monotonicNow = dependencies.monotonicNow ?? (() => {
      const value = globalThis.performance?.now?.();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = dependencies.clearTimer ?? (timer => clearTimeout(timer));
    this.relayUnsubscribe = dependencies.relay.subscribe(relay => this.handleRelaySnapshot(relay));
    this.trace('controller_created');
  }

  private trace(event: string): void {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    const battle = this.snapshot.battle;
    console.info(`[LIVE-BATTLE-RUNTIME] ${event}`, {
      controller: this.runtimeId, session: this.context.liveSessionId?.slice(-8) ?? null,
      battle: battle?.id.slice(-8) ?? null, status: battle?.status ?? null,
      version: battle?.version ?? null, runtimeStatus: this.snapshot.status,
      validSession: isLiveBattleUuid(this.context.liveSessionId),
      validHost: isLiveBattleUuid(this.context.hostUserId),
      canonicalHost: this.context.isCanonicalHost, sessionLive: this.context.isSessionLive,
      opponentSessionLive: this.context.isOpponentSessionLive !== false,
      engineReady: this.context.engineReady, joined: this.context.joined,
      foreground: this.context.isForeground, suspended: this.suspended,
      eligible: this.isEligible(), decision: this.relayDecision,
    });
  }

  private handleRelaySnapshot(relay: LiveBattleRelaySnapshot): void {
    if (this.disposed || !relay.battleId) return;
    const battle = this.snapshot.battle;
    if (!battle || battle.id !== relay.battleId || this.relayDecision === 'stop_terminal') return;
    if (relay.state === 'running') {
      this.relayBattleId = relay.battleId;
      this.publish({
        status: 'relaying', battleId: battle.id, version: battle.version,
        errorCode: null, battle,
      });
      return;
    }
    if (relay.state === 'failed') {
      this.relayBattleId = null;
      this.publish({
        status: 'failed', battleId: battle.id, version: battle.version,
        errorCode: 'live_battle_relay_failed', battle,
      });
      return;
    }
    if (relay.state === 'authorizing' || relay.state === 'connecting') {
      this.publish({
        status: this.relayDecision === 'transitioning_to_next_round' ? 'relaying' : 'observing',
        battleId: battle.id, version: battle.version,
        errorCode: null, battle,
      });
    }
  }

  getSnapshot(): LiveBattleRuntimeSnapshot {
    return { ...this.snapshot, battle: this.snapshot.battle ? { ...this.snapshot.battle } : null };
  }

  subscribe(listener: LiveBattleRuntimeListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getSnapshot());
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  private publish(next: LiveBattleRuntimeSnapshot): void {
    const previous = this.snapshot;
    if (this.publicState?.battleId === next.battleId) {
      const series = this.publicState.series;
      next = { ...next, publicAuthorityKey: JSON.stringify([
        this.publicState.projectionVersion, series?.version, series?.status,
        series?.rematchRequestStatus, series?.rematchWindowExpiresAt, series?.rematchRequestExpiresAt,
      ]) };
    }
    this.snapshot = next;
    if (previous.battleId !== next.battleId || previous.version !== next.version
      || previous.status !== next.status) this.trace('reconcile_result');
    for (const listener of this.listeners) {
      try { listener(this.getSnapshot()); } catch { /* observers cannot alter authority */ }
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.refreshFlight) await this.refreshFlight;
  }

  updatePublicAuthority(
    state: LiveBattlePublicState | null,
    clockAnchor: LiveBattleServerClockAnchor | null,
  ): void {
    if (this.disposed) return;
    if (typeof __DEV__ !== 'undefined' && __DEV__ && (this.publicState?.battleId !== state?.battleId
      || this.publicState?.projectionVersion !== state?.projectionVersion)) {
      console.info('[LIVE-BATTLE-RUNTIME] public_authority', {
        controller: this.runtimeId, battle: state?.battleId.slice(-8) ?? null,
        session: state?.sessionId.slice(-8) ?? null, opponentSession: state?.opponentSessionId.slice(-8) ?? null,
        status: state?.status ?? null, version: state?.version ?? null,
        projectionVersion: state?.projectionVersion ?? null,
      });
    }
    this.publicState = state;
    this.publicClockAnchor = clockAnchor;
    if (state && state.battleId === this.relayBattleId) {
      this.captureRelaySeriesAuthority(state.battleId);
    }
    const battle = this.snapshot.battle;
    if (!contextIsEligible(this.context)) return;
    if (state && (state.sessionId !== this.context.liveSessionId
      || state.localHostUserId !== this.context.hostUserId)) {
      void this.failClosed('live_battle_host_authority_changed');
      return;
    }
    const seriesStatus = state?.series?.status ?? null;
    const shouldReevaluate = Boolean(state && (!battle || this.suspended
      || state.battleId !== battle.id || state.version > battle.version
      || state.status !== battle.status))
      || battle?.status === 'completed'
      || battle?.status === 'cancelled'
      || (battle !== null && state?.battleId !== battle.id)
      || seriesStatus === 'completed'
      || seriesStatus === 'cancelled';
    // A projection is a reconciliation signal, never a substitute for the host RPC.
    if (shouldReevaluate) void this.reconcileNow();
  }

  async reconcileNow(): Promise<void> {
    if (this.disposed || !contextIsEligible(this.context)) return;
    if (this.suspended) {
      this.suspended = false;
      this.generation += 1;
      this.refreshQueued = false;
      this.replaceSubscription(this.context.liveSessionId as string);
    }
    this.clearDeadlineTimer();
    this.scheduledDeadlineKey = null;
    this.requestRefresh();
    await this.waitForIdle();
  }

  async applyAuthoritativeBattle(battle: LiveBattle): Promise<void> {
    if (this.disposed || !this.isEligible()) return;
    const generation = this.generation;
    if (!battleBelongsToHostSession(battle, this.context)) {
      await this.failClosed('live_battle_host_authority_changed');
      return;
    }
    const observed = this.observedVersions.get(battle.id) ?? 0;
    if (battle.version < observed) {
      this.requestRefresh();
      await this.waitForIdle();
      return;
    }
    this.observedVersions.set(battle.id, battle.version);
    await this.applyBattle(battle, generation);
  }

  dismissTerminalBattle(): void {
    const battle = this.snapshot.battle;
    if (this.disposed || !battle || !TERMINAL_STATUSES.has(battle.status)) return;
    this.resetDeadlineScheduler();
    this.publish({ status: 'observing', battleId: null, version: null, errorCode: null, battle: null });
  }

  updateContext(context: LiveBattleRuntimeContext): void {
    if (this.disposed) return;
    const previous = this.context;
    this.context = context;
    if (JSON.stringify(previous) !== JSON.stringify(context)) this.trace('context');
    if (contextIsEligible(previous) !== contextIsEligible(context)) this.trace('eligibility_changed');
    if (!contextIsEligible(context)) {
      this.suspended = true;
      this.invalidateAndStop('idle');
      return;
    }

    const authorityChanged = previous.liveSessionId !== context.liveSessionId
      || previous.hostUserId !== context.hostUserId
      || !contextIsEligible(previous);
    if (authorityChanged) {
      this.suspended = false;
      this.generation += 1;
      this.refreshQueued = false;
      this.observedVersions.clear();
      this.attemptedRelayVersion = null;
      this.publicState = null;
      this.publicClockAnchor = null;
      this.authorityServerNowMs = null;
      this.postRoundCredentialRefreshKey = null;
      this.lastValidatedPostRoundAuthority = null;
      this.postRoundAuthorityRetryUsed = false;
      this.relaySeriesId = null;
      this.relayRoundNumber = null;
      this.relayDecision = 'stop_terminal';
      this.resetDeadlineScheduler();
      this.replaceSubscription(context.liveSessionId as string);
      this.requestRefresh();
      return;
    }

    if (this.suspended) return;

    if (!this.subscription) {
      this.replaceSubscription(context.liveSessionId as string);
      this.requestRefresh();
    }
  }

  private replaceSubscription(sessionId: string): void {
    this.removeSubscription();
    const subscriptionGeneration = this.subscriptionGeneration;
    try {
      this.subscription = this.createSubscription(
        sessionId,
        signal => {
          if (subscriptionGeneration === this.subscriptionGeneration) this.handleRealtimeSignal(signal);
        },
        () => {
          if (subscriptionGeneration === this.subscriptionGeneration) void this.failClosed('live_battle_realtime_unavailable');
        },
      );
      this.publish({ status: 'observing', battleId: null, version: null, errorCode: null, battle: null });
    } catch {
      this.failClosed('live_battle_realtime_unavailable');
    }
  }

  private removeSubscription(): void {
    this.subscriptionGeneration += 1;
    const subscription = this.subscription;
    this.subscription = null;
    if (subscription) void subscription.unsubscribe().catch(() => undefined);
  }

  private handleRealtimeSignal(signal: LiveBattleSessionSignal): void {
    if (this.disposed || !this.isEligible()) return;
    if (!isLiveBattleUuid(signal.battleId) || !Number.isSafeInteger(signal.version)) {
      this.failClosed('live_battle_invalid_response');
      return;
    }
    const observed = this.observedVersions.get(signal.battleId) ?? 0;
    if (signal.version <= observed) return;
    this.observedVersions.set(signal.battleId, signal.version);
    this.trace('realtime_signal');
    this.requestRefresh();
  }

  private requestRefresh(): void {
    if (this.disposed || !this.isEligible()) return;
    this.refreshQueued = true;
    if (this.refreshFlight) return;
    const generation = this.generation;
    this.refreshFlight = (async () => {
      while (this.refreshQueued && generation === this.generation && !this.disposed) {
        this.refreshQueued = false;
        await this.refreshOnce(generation);
      }
    })().finally(() => {
      this.refreshFlight = null;
      if (this.refreshQueued && !this.disposed) this.requestRefresh();
    });
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed
      && generation === this.generation
      && this.isEligible();
  }

  private isEligible(): boolean {
    return !this.suspended && contextIsEligible(this.context);
  }

  private async refreshOnce(generation: number): Promise<void> {
    const sessionId = this.context.liveSessionId;
    if (!sessionId) return;
    this.trace('reconcile_start');
    try {
      const candidates = await this.discover(sessionId);
      if (!this.isCurrent(generation)) return;
      if (candidates.length > 1) {
        await this.failClosed('live_battle_multiple_open');
        return;
      }
      if (candidates.length === 0) {
        const currentBattleId = this.publicState?.sessionId === sessionId
          ? this.publicState.battleId : this.snapshot.battleId;
        if (currentBattleId && isLiveBattleUuid(currentBattleId)) {
          const current = await this.reconcile(currentBattleId);
          if (!this.isCurrent(generation)) return;
          if (!battleBelongsToHostSession(current, this.context)) {
            await this.failClosed('live_battle_host_authority_changed');
            return;
          }
          await this.applyBattle(current, generation, true);
          return;
        }
        this.resetDeadlineScheduler();
        await this.stopRelay('observing');
        return;
      }

      const battle = await this.reconcile(candidates[0].id);
      if (!this.isCurrent(generation)) return;
      if (!battleBelongsToHostSession(battle, this.context)) {
        await this.failClosed('live_battle_host_authority_changed');
        return;
      }

      const observedVersion = this.observedVersions.get(battle.id) ?? 0;
      if (battle.version < observedVersion) return;
      this.observedVersions.set(battle.id, battle.version);
      await this.applyBattle(battle, generation, true);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const candidate = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : null;
      if (
        candidate?.code === 'live_battle_not_found'
        && candidate.message === 'live_battle_not_found'
      ) {
        this.resetDeadlineScheduler();
        await this.stopRelay('observing');
        return;
      }
      this.handleReconcileFailure(generation);
    }
  }

  private async applyBattle(
    battle: LiveBattle,
    generation: number,
    reconciledByServer = false,
  ): Promise<void> {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[LIVE-BATTLE-RUNTIME] authoritative_battle', {
      controller: this.runtimeId, battle: battle.id.slice(-8), status: battle.status,
      version: battle.version, challengerSession: battle.challengerSessionId.slice(-8),
      opponentSession: battle.opponentSessionId.slice(-8), reconciledByServer,
    });
    this.scheduleDeadline(battle, generation, reconciledByServer);
    if (battle.status === 'completed' && battle.endedAt !== null) {
      await this.applyCompletedBattle(battle, generation);
      return;
    }
    if (!RELAY_STATUSES.has(battle.status) || battle.endedAt !== null) {
      if (TERMINAL_STATUSES.has(battle.status)) this.dependencies.onTerminalAuthority?.(battle.id);
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    if (this.relayBattleId === battle.id) {
      this.captureRelaySeriesAuthority(battle.id);
      this.relayDecision = 'relaying_active_round';
      this.postRoundCredentialRefreshKey = null;
      this.lastValidatedPostRoundAuthority = null;
      this.postRoundAuthorityRetryUsed = false;
      this.publish({
        status: 'relaying', battleId: battle.id, version: battle.version, errorCode: null, battle,
      });
      return;
    }

    if (this.relayBattleId && this.relayBattleId !== battle.id) {
      const decision = await this.resolveAuthorityDecision(battle, generation);
      if (!this.isCurrent(generation)) return;
      if (decision === 'transitioning_to_next_round') {
        await this.transitionRelay(battle, generation);
        return;
      }
      await this.stopRelay('observing');
      if (!this.isCurrent(generation)) return;
    }
    const attemptKey = `${battle.id}:${battle.version}`;
    if (this.attemptedRelayVersion === attemptKey) return;
    this.attemptedRelayVersion = attemptKey;
    this.relayOperationPossible = true;
    this.relayDecision = 'relaying_active_round';
    this.publish({
      status: 'observing', battleId: battle.id, version: battle.version,
      errorCode: null, battle,
    });
    try {
      this.trace('relay_start_requested');
      await this.dependencies.relay.start(battle.id);
      if (!this.isCurrent(generation)) return;
      this.captureRelaySeriesAuthority(battle.id);
      const relay = this.dependencies.relay.getSnapshot();
      if (relay.battleId === battle.id && relay.state === 'running') {
        this.handleRelaySnapshot(relay);
      }
    } catch {
      if (!this.isCurrent(generation)) return;
      this.relayBattleId = null;
      this.relayOperationPossible = false;
      this.publish({
        status: 'failed', battleId: battle.id, version: battle.version,
        errorCode: 'live_battle_relay_failed', battle,
      });
    }
  }

  private estimateServerNow(): number | null {
    const anchor = this.publicClockAnchor;
    const monotonicNow = this.monotonicNow();
    if (
      !anchor
      || monotonicNow === null
      || !Number.isFinite(monotonicNow)
      || monotonicNow < anchor.monotonicMsAtAnchor
    ) return null;
    return anchor.serverEpochMsAtAnchor + monotonicNow - anchor.monotonicMsAtAnchor;
  }

  private captureRelaySeriesAuthority(battleId: string): void {
    const state = this.publicState;
    if (!state || state.battleId !== battleId || !state.series) return;
    this.relaySeriesId = state.series.id;
    this.relayRoundNumber = state.series.roundNumber;
  }

  private async readAuthority(
    battle: LiveBattle,
    generation: number,
  ): Promise<LiveBattleAuthorityRead> {
    const sessionId = this.context.liveSessionId;
    const readPublicAuthority = this.dependencies.readPublicAuthority;
    const validateSessionPair = this.dependencies.validateSessionPair;
    if (!sessionId || !readPublicAuthority || !validateSessionPair) return { status: 'invalid' };
    try {
      const snapshot = await readPublicAuthority(sessionId);
      if (!this.isCurrent(generation)) return { status: 'invalid' };
      if (!snapshot.state) return { status: 'invalid' };
      this.publicState = snapshot.state;
      this.publicClockAnchor = snapshot.clockAnchor;
      const sessionPair = await validateSessionPair(snapshot.state);
      if (!this.isCurrent(generation)) return { status: 'invalid' };
      const serverNowMs = Date.parse(snapshot.serverNow);
      if (!Number.isFinite(serverNowMs) || snapshot.state.battleId !== battle.id) {
        return { status: 'invalid' };
      }
      this.authorityServerNowMs = serverNowMs;
      return { status: 'validated', state: snapshot.state, sessionPair, serverNowMs };
    } catch {
      return { status: 'unavailable' };
    }
  }

  private async resolveAuthorityDecision(
    battle: LiveBattle,
    generation: number,
  ): Promise<LiveBattleRelayDecision> {
    const authority = await this.readAuthority(battle, generation);
    if (authority.status !== 'validated') return 'stop_terminal';
    return resolveLiveBattleRelayPolicy({
      battle,
      projection: authority.state,
      clockAnchor: this.publicClockAnchor,
      serverNowMs: authority.serverNowMs,
      relayBattleId: this.relayBattleId,
      relaySeriesId: this.relaySeriesId,
      relayRoundNumber: this.relayRoundNumber,
      sessionPair: authority.sessionPair,
      localSessionId: this.context.liveSessionId,
      localHostUserId: this.context.hostUserId,
      eligible: this.isEligible(),
    });
  }

  private async applyCompletedBattle(
    battle: LiveBattle,
    generation: number,
  ): Promise<void> {
    const authority = await this.readAuthority(battle, generation);
    if (!this.isCurrent(generation)) return;
    if (authority.status === 'unavailable') {
      if (this.holdForOneBoundedAuthorityRetry(battle, generation)) return;
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    if (authority.status !== 'validated') {
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    const decision = resolveLiveBattleRelayPolicy({
      battle,
      projection: authority.state,
      clockAnchor: this.publicClockAnchor,
      serverNowMs: authority.serverNowMs,
      relayBattleId: this.relayBattleId,
      relaySeriesId: this.relaySeriesId,
      relayRoundNumber: this.relayRoundNumber,
      sessionPair: authority.sessionPair,
      localSessionId: this.context.liveSessionId,
      localHostUserId: this.context.hostUserId,
      eligible: this.isEligible(),
    });
    if (decision !== 'holding_for_rematch') {
      // This is a validated server decision, unlike transport failure or a local
      // deadline tick. Publish UI suppression before the relay clears its peer.
      this.dependencies.onTerminalAuthority?.(battle.id);
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    const deadlineText = getLiveBattleRelayDecisionDeadline(authority.state);
    const deadlineMs = deadlineText ? Date.parse(deadlineText) : Number.NaN;
    if (!deadlineText || !Number.isFinite(deadlineMs) || authority.serverNowMs >= deadlineMs) {
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    const refreshKey = `${battle.id}:${battle.version}:${deadlineText}`;
    this.lastValidatedPostRoundAuthority = { battleId: battle.id, key: refreshKey, deadlineMs };
    this.postRoundAuthorityRetryUsed = false;
    this.relayDecision = decision;
    this.trace('post_round');
    this.captureRelaySeriesAuthority(battle.id);
    this.schedulePostRoundDeadline(battle, generation);
    if (this.relayBattleId !== battle.id) {
      const attemptKey = `${battle.id}:${battle.version}:post-round`;
      if (this.attemptedRelayVersion !== attemptKey) {
        this.attemptedRelayVersion = attemptKey;
        this.relayOperationPossible = true;
        try {
          this.trace('relay_start_requested');
          await this.dependencies.relay.start(battle.id);
          if (!this.isCurrent(generation)) return;
          this.relayBattleId = battle.id;
          this.postRoundCredentialRefreshKey = refreshKey;
        } catch {
          if (!this.isCurrent(generation)) return;
          this.relayBattleId = null;
          this.relayOperationPossible = false;
          this.publish({
            status: 'failed', battleId: battle.id, version: battle.version,
            errorCode: 'live_battle_relay_failed', battle,
          });
          return;
        }
      }
    } else if (this.postRoundCredentialRefreshKey !== refreshKey) {
      this.postRoundCredentialRefreshKey = refreshKey;
      this.publish({
        status: 'relaying', battleId: battle.id, version: battle.version,
        errorCode: null, battle,
      });
      try {
        await this.dependencies.relay.refreshCredentials(battle.id);
        if (!this.isCurrent(generation)) return;
      } catch {
        if (!this.isCurrent(generation)) return;
        if (this.postRoundCredentialRefreshKey === refreshKey) {
          this.postRoundCredentialRefreshKey = null;
        }
        this.resetDeadlineScheduler();
        await this.dependencies.relay.stop().catch(() => undefined);
        this.relayBattleId = null;
        this.relaySeriesId = null;
        this.relayRoundNumber = null;
        this.relayDecision = 'stop_terminal';
        this.relayOperationPossible = false;
        this.lastValidatedPostRoundAuthority = null;
        this.publish({
          status: 'failed', battleId: battle.id, version: battle.version,
          errorCode: 'live_battle_relay_credential_refresh_failed', battle,
        });
        return;
      }
    }
    this.publish({
      status: 'relaying', battleId: battle.id, version: battle.version,
      errorCode: null, battle,
    });
  }

  private holdForOneBoundedAuthorityRetry(
    battle: LiveBattle,
    generation: number,
  ): boolean {
    const validated = this.lastValidatedPostRoundAuthority;
    const serverNow = this.estimateServerNow();
    if (
      !validated
      || validated.battleId !== battle.id
      || this.postRoundCredentialRefreshKey !== validated.key
      || this.postRoundAuthorityRetryUsed
      || serverNow === null
      || serverNow >= validated.deadlineMs
      || this.relayBattleId !== battle.id
    ) return false;
    this.postRoundAuthorityRetryUsed = true;
    this.relayDecision = 'holding_for_rematch';
    this.publish({
      status: 'relaying', battleId: battle.id, version: battle.version,
      errorCode: null, battle,
    });
    this.clearDeadlineTimer();
    const retryKey = `post-round-authority-retry:${validated.key}`;
    this.scheduledDeadlineKey = retryKey;
    let timer: ReturnType<typeof setTimeout>;
    timer = this.setTimer(() => {
      if (this.deadlineTimer !== timer) return;
      this.deadlineTimer = null;
      this.scheduledDeadlineKey = null;
      if (!this.isCurrent(generation) || this.snapshot.battleId !== battle.id) return;
      this.requestRefresh();
    }, Math.max(0, Math.min(1_000, validated.deadlineMs - serverNow)));
    this.deadlineTimer = timer;
    return true;
  }

  private async transitionRelay(
    battle: LiveBattle,
    generation: number,
  ): Promise<void> {
    const attemptKey = `${battle.id}:${battle.version}:transition`;
    if (this.attemptedRelayVersion === attemptKey) return;
    this.attemptedRelayVersion = attemptKey;
    this.relayOperationPossible = true;
    this.relayDecision = 'transitioning_to_next_round';
    this.publish({
      status: 'relaying', battleId: battle.id, version: battle.version,
      errorCode: null, battle,
    });
    try {
      await this.dependencies.relay.transition(battle.id);
      if (!this.isCurrent(generation)) return;
      this.relayBattleId = battle.id;
      this.captureRelaySeriesAuthority(battle.id);
      this.relayDecision = 'relaying_active_round';
      this.postRoundCredentialRefreshKey = null;
      this.lastValidatedPostRoundAuthority = null;
      this.postRoundAuthorityRetryUsed = false;
      const relay = this.dependencies.relay.getSnapshot();
      if (relay.battleId === battle.id && relay.state === 'running') {
        this.handleRelaySnapshot(relay);
      }
    } catch {
      if (!this.isCurrent(generation)) return;
      this.relayBattleId = null;
      this.relayOperationPossible = false;
      this.relayDecision = 'stop_terminal';
      this.publish({
        status: 'failed', battleId: battle.id, version: battle.version,
        errorCode: 'live_battle_relay_failed', battle,
      });
    }
  }

  private schedulePostRoundDeadline(battle: LiveBattle, generation: number): void {
    const state = this.publicState;
    if (!state || state.battleId !== battle.id) return;
    const timestamp = getLiveBattleRelayDecisionDeadline(state);
    const serverNow = this.estimateServerNow() ?? this.authorityServerNowMs;
    if (!timestamp || serverNow === null) {
      this.clearDeadlineTimer();
      this.scheduledDeadlineKey = null;
      return;
    }
    const deadline = Date.parse(timestamp);
    if (!Number.isFinite(deadline)) return;
    const deadlineKey = `post-round:${battle.id}:${state.series?.version ?? 0}:${timestamp}`;
    if (this.scheduledDeadlineKey === deadlineKey) return;
    this.clearDeadlineTimer();
    this.scheduledDeadlineKey = deadlineKey;
    let timer: ReturnType<typeof setTimeout>;
    timer = this.setTimer(() => {
      if (this.deadlineTimer !== timer) return;
      this.deadlineTimer = null;
      this.scheduledDeadlineKey = null;
      if (!this.isCurrent(generation) || this.snapshot.battleId !== battle.id) return;
      this.requestRefresh();
    }, Math.max(0, deadline - serverNow + DEADLINE_CLOCK_TOLERANCE_MS));
    this.deadlineTimer = timer;
  }

  private clearDeadlineTimer(): void {
    if (!this.deadlineTimer) return;
    this.clearTimer(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  private resetDeadlineScheduler(): void {
    this.clearDeadlineTimer();
    this.scheduledDeadlineKey = null;
    this.deadlineWakeKey = null;
    this.deadlineBackoffStep = 0;
    this.deadlineBackoffReason = 'none';
  }

  private getDeadlineTimestamp(battle: LiveBattle): string | null {
    return battle.status === 'pending'
      ? battle.inviteExpiresAt
      : battle.status === 'countdown'
        ? battle.scheduledStartAt
        : battle.status === 'active'
          ? battle.scheduledEndAt
          : null;
  }

  private getBackoffDelay(): number {
    const index = Math.max(
      0,
      Math.min(this.deadlineBackoffStep - 1, DEADLINE_RETRY_DELAYS_MS.length - 1),
    );
    return DEADLINE_RETRY_DELAYS_MS[index];
  }

  private getDeadlineCheckpointDelay(battle: LiveBattle): number | null {
    return battle.status === 'pending'
      ? DEADLINE_CHECKPOINT_MS.pending
      : battle.status === 'countdown'
        ? DEADLINE_CHECKPOINT_MS.countdown
        : battle.status === 'active'
          ? DEADLINE_CHECKPOINT_MS.active
          : null;
  }

  private scheduleDeadline(
    battle: LiveBattle,
    generation: number,
    reconciledByServer = false,
  ): void {
    const timestamp = this.getDeadlineTimestamp(battle);
    const deadlineKey = `${battle.id}:${battle.version}:${battle.status}:${timestamp ?? ''}`;
    if (this.deadlineWakeKey !== deadlineKey) {
      this.deadlineWakeKey = deadlineKey;
      this.deadlineBackoffStep = 0;
      this.deadlineBackoffReason = 'none';
    }
    if (!timestamp) {
      this.clearDeadlineTimer();
      this.scheduledDeadlineKey = null;
      return;
    }
    const deadline = Date.parse(timestamp);
    if (!Number.isFinite(deadline)) {
      this.clearDeadlineTimer();
      this.scheduledDeadlineKey = null;
      return;
    }
    const remaining = deadline - this.now() + DEADLINE_CLOCK_TOLERANCE_MS;
    let returnedToCheckpointMode = false;
    if (reconciledByServer) {
      if (remaining <= 0) {
        this.deadlineBackoffReason = 'deadline';
        this.deadlineBackoffStep = Math.max(1, this.deadlineBackoffStep);
      } else if (this.deadlineBackoffReason !== 'none') {
        this.deadlineBackoffReason = 'none';
        this.deadlineBackoffStep = 0;
        returnedToCheckpointMode = true;
      }
    }
    if (returnedToCheckpointMode && this.scheduledDeadlineKey === deadlineKey) {
      this.clearDeadlineTimer();
      this.scheduledDeadlineKey = null;
    }
    if (this.scheduledDeadlineKey === deadlineKey) return;
    this.clearDeadlineTimer();
    this.scheduledDeadlineKey = deadlineKey;
    const checkpointDelay = this.getDeadlineCheckpointDelay(battle);
    if (checkpointDelay === null) return;
    const delay = this.deadlineBackoffStep > 0
      ? this.getBackoffDelay()
      : Math.max(0, Math.min(remaining, checkpointDelay));
    const battleId = battle.id;
    const version = battle.version;
    let timer: ReturnType<typeof setTimeout>;
    timer = this.setTimer(() => {
      if (this.deadlineTimer !== timer) return;
      this.deadlineTimer = null;
      if (!this.isCurrent(generation)) return;
      if (this.snapshot.battleId !== battleId || this.snapshot.version !== version) return;
      this.scheduledDeadlineKey = null;
      const deadlineReached = deadline - this.now() + DEADLINE_CLOCK_TOLERANCE_MS <= 0;
      if (deadlineReached || this.deadlineBackoffStep > 0) {
        if (deadlineReached) this.deadlineBackoffReason = 'deadline';
        this.deadlineBackoffStep = Math.min(
          this.deadlineBackoffStep + 1,
          DEADLINE_RETRY_DELAYS_MS.length,
        );
      }
      this.requestRefresh();
    }, delay);
    this.deadlineTimer = timer;
  }

  private scheduleRefreshRetry(generation: number): void {
    const battle = this.snapshot.battle;
    if (battle && TERMINAL_STATUSES.has(battle.status)) {
      this.resetDeadlineScheduler();
      return;
    }
    const deadline = battle ? this.getDeadlineTimestamp(battle) : null;
    if (battle && deadline && battleBelongsToHostSession(battle, this.context)) {
      const deadlineKey = `${battle.id}:${battle.version}:${battle.status}:${deadline}`;
      if (this.deadlineWakeKey !== deadlineKey) {
        this.deadlineWakeKey = deadlineKey;
        this.deadlineBackoffStep = 0;
        this.deadlineBackoffReason = 'none';
      }
      if (this.deadlineBackoffReason === 'none') this.deadlineBackoffReason = 'error';
      this.deadlineBackoffStep = Math.max(1, this.deadlineBackoffStep);
      this.clearDeadlineTimer();
      this.scheduledDeadlineKey = null;
      this.scheduleDeadline(battle, generation);
      return;
    }

    const retryKey = `refresh:${this.context.liveSessionId ?? ''}`;
    if (this.deadlineWakeKey !== retryKey) {
      this.deadlineWakeKey = retryKey;
      this.deadlineBackoffStep = 1;
      this.deadlineBackoffReason = 'error';
    } else {
      this.deadlineBackoffReason = 'error';
      this.deadlineBackoffStep = Math.max(1, this.deadlineBackoffStep);
    }
    this.clearDeadlineTimer();
    this.scheduledDeadlineKey = retryKey;
    let timer: ReturnType<typeof setTimeout>;
    timer = this.setTimer(() => {
      if (this.deadlineTimer !== timer) return;
      this.deadlineTimer = null;
      if (!this.isCurrent(generation) || this.deadlineWakeKey !== retryKey) return;
      this.scheduledDeadlineKey = null;
      this.deadlineBackoffStep = Math.min(
        this.deadlineBackoffStep + 1,
        DEADLINE_RETRY_DELAYS_MS.length,
      );
      this.requestRefresh();
    }, this.getBackoffDelay());
    this.deadlineTimer = timer;
  }

  private handleReconcileFailure(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.trace('reconcile_failed');
    const battle = this.snapshot.battle;
    this.publish({
      status: 'failed',
      battleId: battle?.id ?? null,
      version: battle?.version ?? null,
      errorCode: 'live_battle_reconcile_failed',
      battle,
    });
    this.scheduleRefreshRetry(generation);
  }

  private async stopRelay(
    status: LiveBattleRuntimeStatus = 'idle',
    battleId: string | null = null,
    version: number | null = null,
    battle: LiveBattle | null = null,
  ): Promise<void> {
    this.attemptedRelayVersion = null;
    if (this.relayOperationPossible) {
      await this.dependencies.relay.stop().catch(() => undefined);
      this.relayBattleId = null;
      this.relayOperationPossible = false;
    }
    this.relaySeriesId = null;
    this.relayRoundNumber = null;
    this.relayDecision = 'stop_terminal';
    this.postRoundCredentialRefreshKey = null;
    this.lastValidatedPostRoundAuthority = null;
    this.postRoundAuthorityRetryUsed = false;
    if (!this.disposed) this.publish({ status, battleId, version, errorCode: null, battle });
  }

  private failClosed(errorCode: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.resetDeadlineScheduler();
    this.removeSubscription();
    this.publish({ status: 'failed', battleId: null, version: null, errorCode, battle: null });
    return this.stopRelay('failed').then(() => {
      if (!this.disposed) {
        this.publish({ status: 'failed', battleId: null, version: null, errorCode, battle: null });
      }
    });
  }

  private invalidateAndStop(status: LiveBattleRuntimeStatus): void {
    this.generation += 1;
    this.refreshQueued = false;
    this.resetDeadlineScheduler();
    this.removeSubscription();
    void this.stopRelay(status);
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.resetDeadlineScheduler();
    this.removeSubscription();
    await this.stopRelay('idle');
  }

  retryRelayAfterReconnect(): Promise<void> {
    if (this.reconnectRetryFlight) return this.reconnectRetryFlight;
    const battle = this.snapshot.battle;
    const relayMayRestart = battle
      && (
        (RELAY_STATUSES.has(battle.status) && battle.endedAt === null)
        || (battle.status === 'completed' && this.relayDecision === 'holding_for_rematch')
      );
    if (this.disposed || !this.isEligible() || !battle || !relayMayRestart) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.reconnectRetryFlight = (async () => {
      await this.stopRelay('observing', battle.id, battle.version, battle);
      if (!this.isCurrent(generation)) return;
      this.requestRefresh();
      await this.waitForIdle();
    })().finally(() => {
      this.reconnectRetryFlight = null;
    });
    return this.reconnectRetryFlight;
  }

  handleEngineRelease(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.resetDeadlineScheduler();
    this.removeSubscription();
    this.dependencies.relay.stopImmediately();
    this.relayBattleId = null;
    this.relaySeriesId = null;
    this.relayRoundNumber = null;
    this.relayDecision = 'stop_terminal';
    this.postRoundCredentialRefreshKey = null;
    this.lastValidatedPostRoundAuthority = null;
    this.postRoundAuthorityRetryUsed = false;
    this.relayOperationPossible = false;
    this.publish({ status: 'idle', battleId: null, version: null, errorCode: null, battle: null });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.trace('controller_disposed');
    this.handleEngineRelease();
    this.disposed = true;
    this.relayUnsubscribe?.();
    this.relayUnsubscribe = null;
    await this.dependencies.relay.dispose().catch(() => undefined);
    this.listeners.clear();
    this.snapshot = { status: 'disposed', battleId: null, version: null, errorCode: null, battle: null };
  }
}
