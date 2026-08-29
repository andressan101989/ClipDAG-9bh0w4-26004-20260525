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

export type LiveBattleRuntimeContext = {
  liveSessionId: string | null;
  hostUserId: string | null;
  isCanonicalHost: boolean;
  isSessionLive: boolean;
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
  status: LiveBattleRuntimeStatus;
  battleId: string | null;
  version: number | null;
  errorCode: string | null;
  battle: LiveBattle | null;
};

export type LiveBattleRuntimeListener = (snapshot: LiveBattleRuntimeSnapshot) => void;

export type LiveBattleRuntimeRelay = {
  start: (battleId: string) => Promise<unknown>;
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
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

const RELAY_STATUSES = new Set(['countdown', 'active']);
const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'expired']);
const DEADLINE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const DEADLINE_CHECKPOINT_MS = {
  pending: 10_000,
  countdown: 1_000,
  active: 30_000,
} as const;
const DEADLINE_CLOCK_TOLERANCE_MS = 25;

const EMPTY_CONTEXT: LiveBattleRuntimeContext = {
  liveSessionId: null,
  hostUserId: null,
  isCanonicalHost: false,
  isSessionLive: false,
  engineReady: false,
  joined: false,
  isForeground: false,
};

function contextIsEligible(context: LiveBattleRuntimeContext): boolean {
  return isLiveBattleUuid(context.liveSessionId)
    && isLiveBattleUuid(context.hostUserId)
    && context.isCanonicalHost
    && context.isSessionLive
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
  private generation = 0;
  private refreshFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private relayBattleId: string | null = null;
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
  private readonly setTimer: NonNullable<LiveBattleRuntimeDependencies['setTimer']>;
  private readonly clearTimer: NonNullable<LiveBattleRuntimeDependencies['clearTimer']>;
  private relayUnsubscribe: (() => void) | null = null;
  private reconnectRetryFlight: Promise<void> | null = null;

  constructor(private readonly dependencies: LiveBattleRuntimeDependencies) {
    this.discover = dependencies.discover ?? getOpenLiveBattlesForSession;
    this.reconcile = dependencies.reconcile ?? getLiveBattleState;
    this.createSubscription = dependencies.subscribe ?? subscribeToLiveBattlesForSession;
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = dependencies.clearTimer ?? (timer => clearTimeout(timer));
    this.relayUnsubscribe = dependencies.relay.subscribe(relay => this.handleRelaySnapshot(relay));
  }

  private handleRelaySnapshot(relay: LiveBattleRelaySnapshot): void {
    if (this.disposed || !relay.battleId) return;
    const battle = this.snapshot.battle;
    if (!battle || battle.id !== relay.battleId || !RELAY_STATUSES.has(battle.status)) return;
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
        status: 'observing', battleId: battle.id, version: battle.version,
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
    this.snapshot = next;
    for (const listener of this.listeners) {
      try { listener(this.getSnapshot()); } catch { /* observers cannot alter authority */ }
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.refreshFlight) await this.refreshFlight;
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
    try {
      this.subscription = this.createSubscription(
        sessionId,
        signal => this.handleRealtimeSignal(signal),
        () => this.failClosed('live_battle_realtime_unavailable'),
      );
      this.publish({ status: 'observing', battleId: null, version: null, errorCode: null, battle: null });
    } catch {
      this.failClosed('live_battle_realtime_unavailable');
    }
  }

  private removeSubscription(): void {
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
    try {
      const candidates = await this.discover(sessionId);
      if (!this.isCurrent(generation)) return;
      if (candidates.length > 1) {
        await this.failClosed('live_battle_multiple_open');
        return;
      }
      if (candidates.length === 0) {
        const currentBattleId = this.snapshot.battleId;
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
    this.scheduleDeadline(battle, generation, reconciledByServer);
    if (!RELAY_STATUSES.has(battle.status) || battle.endedAt !== null) {
      await this.stopRelay('observing', battle.id, battle.version, battle);
      return;
    }
    if (this.relayBattleId === battle.id) {
      this.publish({
        status: 'relaying', battleId: battle.id, version: battle.version, errorCode: null, battle,
      });
      return;
    }

    if (this.relayBattleId && this.relayBattleId !== battle.id) {
      await this.stopRelay('observing');
      if (!this.isCurrent(generation)) return;
    }
    const attemptKey = `${battle.id}:${battle.version}`;
    if (this.attemptedRelayVersion === attemptKey) return;
    this.attemptedRelayVersion = attemptKey;
    this.relayOperationPossible = true;
    this.publish({
      status: 'observing', battleId: battle.id, version: battle.version,
      errorCode: null, battle,
    });
    try {
      await this.dependencies.relay.start(battle.id);
      if (!this.isCurrent(generation)) return;
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
    if (this.disposed || !this.isEligible() || !battle
      || !RELAY_STATUSES.has(battle.status) || battle.endedAt !== null) {
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
    this.relayOperationPossible = false;
    this.publish({ status: 'idle', battleId: null, version: null, errorCode: null, battle: null });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.handleEngineRelease();
    this.disposed = true;
    this.relayUnsubscribe?.();
    this.relayUnsubscribe = null;
    await this.dependencies.relay.dispose().catch(() => undefined);
    this.listeners.clear();
    this.snapshot = { status: 'disposed', battleId: null, version: null, errorCode: null, battle: null };
  }
}
