import { useCallback, useEffect, useRef, useState } from 'react';
import type { IRtcEngine } from 'react-native-agora';
import { LiveBattleRelayService } from '@/services/liveBattleRelayService';
import {
  cancelLiveBattle,
  createLiveBattleInvite,
  respondLiveBattleInvite,
  startLiveBattle,
  type LiveBattle,
  type LiveBattleInviteDecision,
} from '@/services/liveBattleService';
import {
  LiveBattleRuntimeController,
  type LiveBattleRuntimeContext,
  type LiveBattleRuntimeSnapshot,
} from '@/services/liveBattleRuntimeController';
import { leaveLiveBattleSeries } from '@/services/liveBattleSeriesService';
import {
  getLiveBattlePublicSnapshot,
  getLiveBattleRelaySessionPairAuthority,
  type LiveBattlePublicState,
  type LiveBattleServerClockAnchor,
} from '@/services/liveBattleSpectatorService';

type UseLiveBattleRelayRuntimeParams = LiveBattleRuntimeContext & {
  getEngine: () => unknown;
  registerBeforeEngineRelease: (listener: (engine: unknown) => void) => () => void;
  reconnectEpoch: number;
  publicBattleState: LiveBattlePublicState | null;
  publicClockAnchor: LiveBattleServerClockAnchor | null;
  reconcilePublicAuthority?: () => Promise<void>;
  confirmTerminalBattle?: (battleId: string) => void;
  beginRemoteVideoTransition?: (uid: number, durationMs?: number) => void;
  clearRemoteVideoTransition?: (uid?: number) => void;
};

export function useLiveBattleRelayRuntime({
  liveSessionId,
  hostUserId,
  isCanonicalHost,
  isSessionLive,
  isOpponentSessionLive,
  engineReady,
  joined,
  isForeground,
  getEngine,
  registerBeforeEngineRelease,
  reconnectEpoch,
  publicBattleState,
  publicClockAnchor,
  reconcilePublicAuthority,
  confirmTerminalBattle,
  beginRemoteVideoTransition,
  clearRemoteVideoTransition,
}: UseLiveBattleRelayRuntimeParams) {
  const controllerRef = useRef<LiveBattleRuntimeController | null>(null);
  const actionFlightRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const actionsEnabledRef = useRef(false);
  const mountedRef = useRef(true);
  const lastReconnectEpochRef = useRef(reconnectEpoch);
  const videoBridgeRef = useRef({ beginRemoteVideoTransition, clearRemoteVideoTransition, publicBattleState, confirmTerminalBattle,
    liveSessionId, lastOpponentUid: publicBattleState?.opponentHostAgoraUid });
  videoBridgeRef.current = { beginRemoteVideoTransition, clearRemoteVideoTransition, publicBattleState, confirmTerminalBattle,
    liveSessionId, lastOpponentUid: publicBattleState?.opponentHostAgoraUid
      ?? (videoBridgeRef.current.liveSessionId === liveSessionId ? videoBridgeRef.current.lastOpponentUid : undefined) };
  const [snapshot, setSnapshot] = useState<LiveBattleRuntimeSnapshot>({
    status: 'idle', battleId: null, version: null, errorCode: null, battle: null,
  });
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const engine = joined ? getEngine() as IRtcEngine | null : null;
  actionsEnabledRef.current = isCanonicalHost
    && isSessionLive
    && engineReady
    && joined
    && isForeground;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    const ownedSessionId = liveSessionId;
    let bridgeActive = true;
    let protectedUid: number | undefined;
    const relay = new LiveBattleRelayService(engine);
    relay.setVisualContinuityHandlers?.({
      onReconfigure: () => {
        if (!bridgeActive || !mountedRef.current) return;
        const bridge = videoBridgeRef.current;
        if (bridge.liveSessionId !== ownedSessionId) return;
        const uid = bridge.publicBattleState?.opponentHostAgoraUid;
        if (uid !== undefined) {
          protectedUid = uid;
          bridge.beginRemoteVideoTransition?.(uid);
        }
      },
      onRecoveryStart: () => {
        if (!bridgeActive || !mountedRef.current) return;
        const bridge = videoBridgeRef.current;
        if (bridge.liveSessionId !== ownedSessionId) return;
        const uid = bridge.publicBattleState?.opponentHostAgoraUid;
        if (uid !== undefined) {
          protectedUid = uid;
          bridge.beginRemoteVideoTransition?.(uid, 20_000);
        }
      },
      onStopped: () => {
        if (!bridgeActive) return;
        const bridge = videoBridgeRef.current;
        if (bridge.liveSessionId !== ownedSessionId) return;
        bridge.clearRemoteVideoTransition?.(protectedUid ?? bridge.lastOpponentUid);
        protectedUid = undefined;
      },
    });
    const controller = new LiveBattleRuntimeController({
      relay,
      leaveSeriesAfterRelayFailure: leaveLiveBattleSeries,
      onTerminalAuthority: battleId => {
        const bridge = videoBridgeRef.current;
        if (bridgeActive && mountedRef.current && bridge.liveSessionId === ownedSessionId) {
          bridge.confirmTerminalBattle?.(battleId);
        }
      },
      readPublicAuthority: getLiveBattlePublicSnapshot,
      validateSessionPair: getLiveBattleRelaySessionPairAuthority,
    });
    controllerRef.current = controller;
    const unsubscribeSnapshot = controller.subscribe(setSnapshot);
    const unregisterReleaseGuard = registerBeforeEngineRelease(() => {
      controller.handleEngineRelease();
    });

    return () => {
      const bridge = videoBridgeRef.current;
      if (bridge.liveSessionId === ownedSessionId) {
        bridge.clearRemoteVideoTransition?.(protectedUid ?? bridge.lastOpponentUid);
      }
      bridgeActive = false;
      actionGenerationRef.current += 1;
      actionFlightRef.current = false;
      unsubscribeSnapshot();
      unregisterReleaseGuard();
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose();
    };
  }, [engine, registerBeforeEngineRelease]);

  useEffect(() => {
    controllerRef.current?.updateContext({
      liveSessionId,
      hostUserId,
      isCanonicalHost,
      isSessionLive,
      isOpponentSessionLive,
      engineReady,
      joined,
      isForeground,
    });
  }, [
    engine,
    engineReady,
    hostUserId,
    isCanonicalHost,
    isForeground,
    isSessionLive,
    isOpponentSessionLive,
    joined,
    liveSessionId,
  ]);

  useEffect(() => {
    controllerRef.current?.updatePublicAuthority(publicBattleState, publicClockAnchor);
  }, [engine, publicBattleState, publicClockAnchor, liveSessionId, hostUserId,
    isCanonicalHost, isSessionLive, isOpponentSessionLive, engineReady, joined, isForeground]);

  useEffect(() => {
    if (reconnectEpoch <= lastReconnectEpochRef.current) return;
    lastReconnectEpochRef.current = reconnectEpoch;
    void controllerRef.current?.retryRelayAfterReconnect();
  }, [reconnectEpoch]);

  const stop = useCallback(async () => {
    await controllerRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!snapshot.battle || !mountedRef.current) return;
    // Refresh the same public authority used by Stage when the host RPC advances.
    // Lifecycle changes reuse the existing projection subscription.
    void reconcilePublicAuthority?.().catch(() => undefined);
  }, [snapshot.battleId, snapshot.version, snapshot.battle?.status, snapshot.status,
    snapshot.publicAuthorityKey, reconcilePublicAuthority]);

  const runAction = useCallback(async (
    operation: () => Promise<LiveBattle>,
  ): Promise<LiveBattle | null> => {
    if (actionFlightRef.current || !actionsEnabledRef.current) return null;
    const controller = controllerRef.current;
    if (!controller) return null;
    actionFlightRef.current = true;
    const generation = ++actionGenerationRef.current;
    if (mountedRef.current) {
      setActionPending(true);
      setActionError(null);
    }
    try {
      const battle = await operation();
      if (!mountedRef.current || generation !== actionGenerationRef.current) return null;
      await controller.applyAuthoritativeBattle(battle);
      return battle;
    } catch (error) {
      if (mountedRef.current && generation === actionGenerationRef.current) {
        const code = error && typeof error === 'object' && 'code' in error
          && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'live_battle_unknown';
        setActionError(code);
        await controller.reconcileNow().catch(() => undefined);
      }
      return null;
    } finally {
      if (generation === actionGenerationRef.current) {
        actionFlightRef.current = false;
        if (mountedRef.current) setActionPending(false);
      }
    }
  }, []);

  const invite = useCallback((input: {
    opponentUserId: string;
    challengerSessionId: string;
    opponentSessionId: string;
  }) => runAction(() => createLiveBattleInvite(input)), [runAction]);

  const respond = useCallback((battleId: string, decision: LiveBattleInviteDecision) =>
    runAction(() => respondLiveBattleInvite(battleId, decision)), [runAction]);

  const start = useCallback((battleId: string) =>
    runAction(() => startLiveBattle(battleId)), [runAction]);

  const cancel = useCallback((battleId: string) =>
    runAction(() => cancelLiveBattle(battleId)), [runAction]);

  const reconcile = useCallback(async () => {
    await controllerRef.current?.reconcileNow();
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);
  const dismissTerminalBattle = useCallback(() => {
    controllerRef.current?.dismissTerminalBattle();
  }, []);

  return {
    stop,
    supported: true as const,
    snapshot,
    actionPending,
    actionError,
    invite,
    respond,
    start,
    cancel,
    reconcile,
    clearActionError,
    dismissTerminalBattle,
  };
}
