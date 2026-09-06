import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  subscribeToLiveBattlePublicState,
  isLiveBattleStageStatus,
  getLiveBattlePostRoundDeadline,
  type LiveBattlePublicState,
  type LiveBattleServerClockAnchor,
} from '@/services/liveBattleSpectatorService';
import {
  getLiveBattlePublicProfiles,
  type LiveBattlePublicProfile,
} from '@/services/liveBattleService';
import {
  leaveLiveBattleSeries,
  requestLiveBattleRematch,
  respondLiveBattleRematch,
  safeLiveBattleSeriesErrorMessage,
  LiveBattleSeriesServiceError,
  type LiveBattleSeriesErrorCode,
} from '@/services/liveBattleSeriesService';
import {
  canLeaveLiveBattleSeries,
  deriveLiveBattleSeriesClientState,
  isCanonicalRematchTransitionCandidate,
  isLiveBattleSeriesParticipant,
  LiveBattleSeriesSingleFlight,
  LiveBattleSeriesTransitionGate,
  shouldClearLiveBattleSeriesError,
  type LiveBattleSeriesActionPhase,
} from '@/services/liveBattleSeriesState';

type LiveBattleSeriesLogEvent =
  | 'hydrate' | 'realtime' | 'request_start' | 'request_result'
  | 'accept_start' | 'accept_result' | 'reject_start' | 'reject_result'
  | 'transition' | 'terminal' | 'error';

function redactedId(value: string | null | undefined): string | null {
  return value ? `${value.slice(0, 8)}…` : null;
}

function logSeries(event: LiveBattleSeriesLogEvent, data: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(`[LIVE-BATTLE-SERIES] ${event}`, data);
}

function seriesErrorCode(error: unknown): LiveBattleSeriesErrorCode {
  return error instanceof LiveBattleSeriesServiceError ? error.code : 'unknown';
}

export function useLiveBattleSpectatorState(
  sessionId: string | null | undefined,
  enabled: boolean,
  actorUserId: string | null | undefined = null,
  runtimeManaged = false,
) {
  const terminalBattleIdRef = useRef<string | null>(null);
  const terminalSessionRef = useRef(sessionId);
  const [terminalBattleId, setTerminalBattleId] = useState<string | null>(null);
  const latestServerEpochRef = useRef<number | null>(null);
  const decisionReadKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const reconcileRef = useRef<() => Promise<void>>(async () => undefined);
  const stateRef = useRef<LiveBattlePublicState | null>(null);
  const firstProjectionRef = useRef(true);
  const transitionGateRef = useRef(new LiveBattleSeriesTransitionGate());
  const idempotencyRef = useRef<{ battleId: string; key: string } | null>(null);
  const singleFlightRef = useRef(new LiveBattleSeriesSingleFlight());
  const leaveSingleFlightRef = useRef(new LiveBattleSeriesSingleFlight());
  const [state, setState] = useState<LiveBattlePublicState | null>(null);
  const [clockAnchor, setClockAnchor] = useState<LiveBattleServerClockAnchor | null>(null);
  const [profiles, setProfiles] = useState<Map<string, LiveBattlePublicProfile>>(new Map());
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [seriesError, setSeriesError] = useState<LiveBattleSeriesErrorCode | null>(null);
  const [actionPhase, setActionPhase] = useState<LiveBattleSeriesActionPhase>('idle');
  const [pendingTransitionBattleId, setPendingTransitionBattleId] = useState<string | null>(null);
  const [transitionBattleId, setTransitionBattleId] = useState<string | null>(null);

  const confirmTerminalBattle = useCallback((battleId: string) => {
    if ((stateRef.current && stateRef.current.battleId !== battleId)
      || terminalBattleIdRef.current === battleId) return;
    terminalBattleIdRef.current = battleId;
    setTerminalBattleId(battleId);
    logSeries('terminal', { battleId: redactedId(battleId), reason: 'validated_authority' });
  }, []);
  const confirmServerDeadline = useCallback((current: LiveBattlePublicState | null, serverEpoch: number | null) => {
    if (!current || current.status !== 'completed' || serverEpoch === null) return;
    const deadline = getLiveBattlePostRoundDeadline(current);
    if (deadline && Number.isFinite(Date.parse(deadline)) && serverEpoch >= Date.parse(deadline)) {
      confirmTerminalBattle(current.battleId);
    }
  }, [confirmTerminalBattle]);

  useEffect(() => {
    const generation = ++generationRef.current;
    stateRef.current = null;
    if (terminalSessionRef.current !== sessionId) {
      terminalSessionRef.current = sessionId;
      terminalBattleIdRef.current = null;
      setTerminalBattleId(null);
    }
    latestServerEpochRef.current = null;
    decisionReadKeyRef.current = null;
    firstProjectionRef.current = true;
    transitionGateRef.current = new LiveBattleSeriesTransitionGate();
    idempotencyRef.current = null;
    singleFlightRef.current = new LiveBattleSeriesSingleFlight();
    leaveSingleFlightRef.current = new LiveBattleSeriesSingleFlight();
    setState(null);
    setClockAnchor(null);
    setProfiles(new Map());
    setErrorCode(null);
    setSeriesError(null);
    setActionPhase('idle');
    setPendingTransitionBattleId(null);
    setTransitionBattleId(null);
    reconcileRef.current = async () => undefined;
    if (!enabled || !sessionId) return;

    let subscription;
    try {
      subscription = subscribeToLiveBattlePublicState(
        sessionId,
        next => {
          if (generation !== generationRef.current) return;
          const previous = stateRef.current;
          const event = firstProjectionRef.current ? 'hydrate' : 'realtime';
          firstProjectionRef.current = false;
          stateRef.current = next;
          if (next && next.battleId !== terminalBattleIdRef.current
            && (next.status === 'countdown' || next.status === 'active')) {
            terminalBattleIdRef.current = null;
            setTerminalBattleId(null);
          }
          setState(next);
          if (next && !isLiveBattleStageStatus(next.status, next)) confirmTerminalBattle(next.battleId);
          confirmServerDeadline(next, latestServerEpochRef.current);
          setErrorCode(null);
          if (shouldClearLiveBattleSeriesError(previous, next)) setSeriesError(null);
          logSeries(event, {
            battleId: redactedId(next?.battleId),
            seriesId: redactedId(next?.series?.id),
            status: next?.series?.status ?? null,
          });
          if (previous && next && previous.battleId !== next.battleId) {
            setPendingTransitionBattleId(null);
            idempotencyRef.current = null;
          }
          if (
            previous?.series
            && next?.series
            && transitionGateRef.current.accept(previous, {
              sourceBattleId: previous.battleId,
              seriesId: next.series.id,
              battleId: next.battleId,
              roundNumber: next.series.roundNumber,
            })
          ) {
            setTransitionBattleId(next.battleId);
            logSeries('transition', {
              battleId: redactedId(next.battleId),
              seriesId: redactedId(next.series?.id),
              round: next.series?.roundNumber ?? null,
            });
          }
          if (next?.series?.status === 'completed' || next?.series?.status === 'cancelled') {
            logSeries('terminal', {
              seriesId: redactedId(next.series.id),
              status: next.series.status,
            });
          }
        },
        error => {
          if (generation !== generationRef.current) return;
          setErrorCode(error.code);
          logSeries('error', { code: error.code });
        },
        anchor => {
          if (generation !== generationRef.current) return;
          // The render clock adds half RTT. Terminal authority uses the server's
          // actual response timestamp, without that client-side estimate.
          const serverEpoch = anchor && Number.isFinite(anchor.roundTripMs) && anchor.roundTripMs >= 0
            ? anchor.serverEpochMsAtAnchor - anchor.roundTripMs / 2 : null;
          latestServerEpochRef.current = serverEpoch;
          setClockAnchor(anchor);
          confirmServerDeadline(stateRef.current, serverEpoch);
        },
      );
      reconcileRef.current = subscription.reconcile;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'live_battle_public_unavailable';
      setErrorCode(code);
      logSeries('error', { code });
      return;
    }

    let previousAppState: AppStateStatus = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      const returningToForeground = previousAppState !== 'active' && nextAppState === 'active';
      previousAppState = nextAppState;
      if (returningToForeground && generation === generationRef.current) {
        void subscription.reconcile();
      }
    });
    let wasConnected: boolean | null = null;
    const networkSubscription = NetInfo.addEventListener(network => {
      const connected = network.isConnected === true && network.isInternetReachable !== false;
      const reconnected = wasConnected === false && connected;
      wasConnected = connected;
      if (reconnected && generation === generationRef.current) {
        void subscription.reconcile();
      }
    });

    return () => {
      generationRef.current += 1;
      stateRef.current = null;
      reconcileRef.current = async () => undefined;
      appStateSubscription.remove();
      networkSubscription();
      void subscription.unsubscribe().catch(() => undefined);
    };
  }, [enabled, sessionId]);

  useEffect(() => {
    if (!state) {
      setProfiles(new Map());
      return;
    }
    const generation = generationRef.current;
    void getLiveBattlePublicProfiles([state.localHostUserId, state.opponentHostUserId])
      .then(rows => {
        if (generation === generationRef.current) {
          setProfiles(new Map(rows.map(row => [row.userId, row])));
        }
      })
      .catch(() => {
        if (generation === generationRef.current) setProfiles(new Map());
      });
  }, [state]);

  const reconcile = useCallback(() => reconcileRef.current(), []);

  const checkDecisionDeadline = useCallback((estimatedServerNow: number | null) => {
    // Reuse the Stage clock. Its estimate can request one fresh snapshot per
    // authority anchor, but only the returned server timestamp can close Stage.
    const current = stateRef.current;
    if (runtimeManaged || !current || current.battleId === terminalBattleIdRef.current
      || estimatedServerNow === null || !Number.isFinite(estimatedServerNow)) return;
    const deadline = getLiveBattlePostRoundDeadline(current);
    if (!deadline || !Number.isFinite(Date.parse(deadline)) || estimatedServerNow < Date.parse(deadline)) return;
    const key = `${current.battleId}:${current.series?.version}:${deadline}:${latestServerEpochRef.current}`;
    if (decisionReadKeyRef.current === key) return;
    decisionReadKeyRef.current = key;
    void reconcileRef.current().catch(() => undefined);
  }, [runtimeManaged]);

  const runAction = useCallback(<T,>(
    phase: Exclude<LiveBattleSeriesActionPhase, 'idle' | 'leaving'>,
    startEvent: 'request_start' | 'accept_start' | 'reject_start',
    resultEvent: 'request_result' | 'accept_result' | 'reject_result',
    operation: () => Promise<T>,
  ): Promise<T> | null => {
    const generation = generationRef.current;
    const flight = singleFlightRef.current.run(async () => {
      if (generation === generationRef.current) {
        setActionPhase(phase);
      }
      logSeries(startEvent, { battleId: redactedId(stateRef.current?.battleId) });
      try {
        const result = await operation();
        logSeries(resultEvent, { result: 'canonical_response' });
        return result;
      } catch (error) {
        const code = seriesErrorCode(error);
        if (generation === generationRef.current) setSeriesError(code);
        logSeries('error', { event: resultEvent, code });
        throw error;
      } finally {
        try {
          await reconcileRef.current();
        } finally {
          if (generation === generationRef.current) setActionPhase('idle');
        }
      }
    });
    return flight as Promise<T> | null;
  }, []);

  const requestRematch = useCallback((): Promise<unknown> | null => {
    const current = stateRef.current;
    if (!current?.series || !isLiveBattleSeriesParticipant(current, actorUserId)) return null;
    if (
      current.series.status !== 'awaiting_rematch'
      || current.series.rematchRequestId !== null
      || current.series.rematchRequestAfterBattleId !== null
      || current.series.rematchRequestStatus !== null
      || current.series.rematchWindowExpiresAt === null
    ) {
      return null;
    }
    if (!idempotencyRef.current || idempotencyRef.current.battleId !== current.battleId) {
      idempotencyRef.current = { battleId: current.battleId, key: randomUUID() };
    }
    const input = idempotencyRef.current;
    return runAction(
      'requesting',
      'request_start',
      'request_result',
      () => requestLiveBattleRematch({ battleId: input.battleId, idempotencyKey: input.key }),
    );
  }, [actorUserId, runAction]);

  const respondRematch = useCallback((decision: 'accept' | 'reject'): Promise<unknown> | null => {
    const current = stateRef.current;
    const generation = generationRef.current;
    const requestId = current?.series?.rematchRequestId;
    if (
      !current?.series || !requestId || current.series.rematchRequestStatus !== 'pending'
      || current.series.rematchRequestAfterBattleId !== current.battleId
      || current.series.rematchRequestedByUserId === actorUserId
      || !isLiveBattleSeriesParticipant(current, actorUserId)
    ) return null;
    return runAction(
      decision === 'accept' ? 'accepting' : 'rejecting',
      decision === 'accept' ? 'accept_start' : 'reject_start',
      decision === 'accept' ? 'accept_result' : 'reject_result',
      async () => {
        const result = await respondLiveBattleRematch({ requestId, decision });
        if (decision === 'accept' && result.battle) {
          const candidate = {
            sourceBattleId: result.request.afterBattleId,
            seriesId: result.series.id,
            battleId: result.battle.id,
            roundNumber: result.battle.roundNumber,
          };
          if (!isCanonicalRematchTransitionCandidate(current, candidate)) {
            throw new LiveBattleSeriesServiceError('invalid_response');
          }
          const latest = stateRef.current;
          if (
            generation === generationRef.current
            && transitionGateRef.current.accept(latest, candidate)
          ) {
            setPendingTransitionBattleId(result.battle.id);
            setTransitionBattleId(result.battle.id);
            idempotencyRef.current = null;
            logSeries('transition', {
              battleId: redactedId(result.battle.id),
              seriesId: redactedId(result.series.id),
              round: result.battle.roundNumber,
            });
          }
        }
        return result;
      },
    );
  }, [actorUserId, runAction]);

  const acceptRematch = useCallback(() => respondRematch('accept'), [respondRematch]);
  const rejectRematch = useCallback(() => respondRematch('reject'), [respondRematch]);
  const leaveSeries = useCallback((): Promise<unknown> | null => {
    const current = stateRef.current;
    const seriesId = current?.series?.id;
    if (!seriesId || !canLeaveLiveBattleSeries(current, actorUserId)) return null;
    const generation = generationRef.current;
    return leaveSingleFlightRef.current.run(async () => {
      if (generation === generationRef.current) setActionPhase('leaving');
      try {
        return await leaveLiveBattleSeries(seriesId);
      } catch (error) {
        const code = seriesErrorCode(error);
        if (generation === generationRef.current) setSeriesError(code);
        logSeries('error', { event: 'terminal', code });
        throw error;
      } finally {
        await reconcileRef.current();
        if (generation === generationRef.current) setActionPhase('idle');
      }
    });
  }, [actorUserId]);

  const clientState = useMemo(() => deriveLiveBattleSeriesClientState(
    state,
    actorUserId,
    actionPhase,
    pendingTransitionBattleId,
    seriesError !== null,
  ), [actionPhase, actorUserId, pendingTransitionBattleId, seriesError, state]);

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    console.info('[LIVE-BATTLE-RUNTIME] rematch_available', {
      session: sessionId?.slice(-8) ?? null, battle: state?.battleId.slice(-8) ?? null,
      status: state?.status ?? null, version: state?.version ?? null,
      clientState, available: clientState === 'available',
      participant: isLiveBattleSeriesParticipant(state, actorUserId),
    });
  }, [sessionId, state?.battleId, state?.status, state?.version, clientState, actorUserId]);

  return {
    state, clockAnchor, errorCode, reconcile, terminalBattleId, confirmTerminalBattle, checkDecisionDeadline,
    localHostProfile: state ? profiles.get(state.localHostUserId) ?? null : null,
    opponentHostProfile: state ? profiles.get(state.opponentHostUserId) ?? null : null,
    clientState,
    seriesActionPending: actionPhase !== 'idle',
    seriesErrorCode: seriesError,
    seriesErrorMessage: safeLiveBattleSeriesErrorMessage(seriesError),
    transitionBattleId,
    requestRematch, acceptRematch, rejectRematch, leaveSeries,
  };
}
