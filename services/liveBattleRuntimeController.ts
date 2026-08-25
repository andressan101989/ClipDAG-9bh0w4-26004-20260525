import {
  getLiveBattleState,
  getOpenLiveBattlesForSession,
  isLiveBattleUuid,
  subscribeToLiveBattlesForSession,
  type LiveBattle,
  type LiveBattleSessionSignal,
  type LiveBattleSubscription,
} from './liveBattleService';

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
};

export type LiveBattleRuntimeRelay = {
  start: (battleId: string) => Promise<unknown>;
  stop: () => Promise<unknown>;
  stopImmediately: () => void;
  dispose: () => Promise<void>;
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
};

const RELAY_STATUSES = new Set(['countdown', 'active']);

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
  return battle.endedAt === null && (
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
  };
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

  constructor(private readonly dependencies: LiveBattleRuntimeDependencies) {
    this.discover = dependencies.discover ?? getOpenLiveBattlesForSession;
    this.reconcile = dependencies.reconcile ?? getLiveBattleState;
    this.createSubscription = dependencies.subscribe ?? subscribeToLiveBattlesForSession;
  }

  getSnapshot(): LiveBattleRuntimeSnapshot {
    return { ...this.snapshot };
  }

  async waitForIdle(): Promise<void> {
    while (this.refreshFlight) await this.refreshFlight;
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
      this.snapshot = { status: 'observing', battleId: null, version: null, errorCode: null };
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
      await this.applyBattle(battle, generation);
    } catch {
      if (this.isCurrent(generation)) await this.failClosed('live_battle_reconcile_failed');
    }
  }

  private async applyBattle(battle: LiveBattle, generation: number): Promise<void> {
    if (!RELAY_STATUSES.has(battle.status)) {
      await this.stopRelay('observing', battle.id, battle.version);
      return;
    }
    if (this.relayBattleId === battle.id) {
      this.snapshot = {
        status: 'relaying', battleId: battle.id, version: battle.version, errorCode: null,
      };
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
    try {
      await this.dependencies.relay.start(battle.id);
      if (!this.isCurrent(generation)) return;
      this.relayBattleId = battle.id;
      this.snapshot = {
        status: 'relaying', battleId: battle.id, version: battle.version, errorCode: null,
      };
    } catch {
      if (!this.isCurrent(generation)) return;
      this.relayBattleId = null;
      this.relayOperationPossible = false;
      this.snapshot = {
        status: 'failed', battleId: battle.id, version: battle.version,
        errorCode: 'live_battle_relay_failed',
      };
    }
  }

  private async stopRelay(
    status: LiveBattleRuntimeStatus = 'idle',
    battleId: string | null = null,
    version: number | null = null,
  ): Promise<void> {
    this.attemptedRelayVersion = null;
    if (this.relayOperationPossible) {
      await this.dependencies.relay.stop().catch(() => undefined);
      this.relayBattleId = null;
      this.relayOperationPossible = false;
    }
    if (!this.disposed) this.snapshot = { status, battleId, version, errorCode: null };
  }

  private failClosed(errorCode: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.removeSubscription();
    this.snapshot = {
      status: 'failed', battleId: null, version: null, errorCode,
    };
    return this.stopRelay('failed').then(() => {
      if (!this.disposed) {
        this.snapshot = { status: 'failed', battleId: null, version: null, errorCode };
      }
    });
  }

  private invalidateAndStop(status: LiveBattleRuntimeStatus): void {
    this.generation += 1;
    this.refreshQueued = false;
    this.removeSubscription();
    void this.stopRelay(status);
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.removeSubscription();
    await this.stopRelay('idle');
  }

  handleEngineRelease(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.generation += 1;
    this.refreshQueued = false;
    this.removeSubscription();
    this.dependencies.relay.stopImmediately();
    this.relayBattleId = null;
    this.relayOperationPossible = false;
    this.snapshot = { status: 'idle', battleId: null, version: null, errorCode: null };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.handleEngineRelease();
    this.disposed = true;
    await this.dependencies.relay.dispose().catch(() => undefined);
    this.snapshot = { status: 'disposed', battleId: null, version: null, errorCode: null };
  }
}
