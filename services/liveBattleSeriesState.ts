import type {
  LiveBattleSeriesProjection,
} from './liveBattleSeriesContract';

export const LIVE_BATTLE_SERIES_CLIENT_STATES = [
  'loading',
  'round_active',
  'round_finished',
  'available',
  'requesting',
  'outgoing_pending',
  'incoming_pending',
  'accepting',
  'rejected',
  'expired',
  'transitioning',
  'series_completed',
  'series_abandoned',
  'error',
] as const;

export type LiveBattleSeriesClientState =
  typeof LIVE_BATTLE_SERIES_CLIENT_STATES[number];

export type LiveBattleSeriesActionPhase =
  | 'idle'
  | 'requesting'
  | 'accepting'
  | 'rejecting'
  | 'leaving';

export type LiveBattleSeriesStateInput = {
  battleId: string;
  status: 'countdown' | 'active' | 'completed' | 'cancelled';
  localHostUserId: string;
  opponentHostUserId: string;
  series: LiveBattleSeriesProjection | null;
};

export function hasCurrentLiveBattleRematchRequest(
  state: LiveBattleSeriesStateInput | null,
): boolean {
  const series = state?.series;
  return Boolean(
    state
    && series?.rematchRequestId
    && series.rematchRequestAfterBattleId === state.battleId
    && series.rematchRequestStatus
    && series.rematchRequestedByUserId
    && series.rematchRequestExpiresAt,
  );
}

export function isLiveBattleSeriesParticipant(
  state: LiveBattleSeriesStateInput | null,
  actorUserId: string | null | undefined,
): boolean {
  return Boolean(
    state
    && actorUserId
    && (actorUserId === state.localHostUserId || actorUserId === state.opponentHostUserId),
  );
}

export function deriveLiveBattleSeriesClientState(
  state: LiveBattleSeriesStateInput | null,
  actorUserId: string | null | undefined,
  actionPhase: LiveBattleSeriesActionPhase,
  pendingTransitionBattleId: string | null,
  hasError: boolean,
): LiveBattleSeriesClientState {
  if (!state || !state.series) return hasError ? 'error' : 'loading';
  if (pendingTransitionBattleId && pendingTransitionBattleId !== state.battleId) {
    return 'transitioning';
  }
  if (actionPhase === 'requesting') return 'requesting';
  if (actionPhase === 'accepting') return 'accepting';

  const { series } = state;
  const hasCurrentRequest = hasCurrentLiveBattleRematchRequest(state);
  const requestStatus = hasCurrentRequest ? series.rematchRequestStatus : null;
  if (series.status === 'cancelled') return 'series_abandoned';
  if (requestStatus === 'cancelled' && series.status === 'completed') {
    return 'series_abandoned';
  }
  if (requestStatus === 'rejected') return 'rejected';
  if (requestStatus === 'expired') return 'expired';
  if (series.status === 'completed') return 'series_completed';

  if (requestStatus === 'pending') {
    return series.rematchRequestedByUserId === actorUserId
      ? 'outgoing_pending'
      : isLiveBattleSeriesParticipant(state, actorUserId)
        ? 'incoming_pending'
        : 'round_finished';
  }
  if (
    state.status === 'completed'
    && series.status === 'awaiting_rematch'
    && !hasCurrentRequest
    && series.rematchWindowExpiresAt !== null
  ) {
    return isLiveBattleSeriesParticipant(state, actorUserId)
      ? 'available'
      : 'round_finished';
  }
  if (state.status === 'countdown' || state.status === 'active') {
    return 'round_active';
  }
  return 'round_finished';
}

export function shouldClearLiveBattleSeriesError(
  previous: LiveBattleSeriesStateInput | null,
  next: LiveBattleSeriesStateInput | null,
): boolean {
  if (!next?.series) return false;
  if (!previous) return true;
  if (previous.battleId === next.battleId) {
    return previous.series === null || previous.series.id === next.series.id;
  }
  return isCanonicalNextLiveBattle(previous, next);
}

export function isLiveBattleSeriesTerminal(
  state: LiveBattleSeriesStateInput | null,
): boolean {
  return state?.series?.status === 'completed' || state?.series?.status === 'cancelled';
}

export function canLeaveLiveBattleSeries(
  state: LiveBattleSeriesStateInput | null,
  actorUserId: string | null | undefined,
): boolean {
  return isLiveBattleSeriesParticipant(state, actorUserId)
    && !isLiveBattleSeriesTerminal(state);
}

export const LIVE_BATTLE_SERIES_LEAVE_TIMEOUT_MS = 1_500;

export type LiveBattleSeriesHostLeaveResult =
  | 'skipped'
  | 'completed'
  | 'rejected'
  | 'timed_out';

export async function leaveLiveBattleSeriesBeforeHostEnd(input: {
  reason: string;
  leaveSeries: () => Promise<unknown> | null;
  timeoutMs?: number;
  onFailure?: (code: 'rejected' | 'timed_out') => void;
}): Promise<LiveBattleSeriesHostLeaveResult> {
  if (input.reason !== 'host_ended') return 'skipped';
  const flight = input.leaveSeries();
  if (!flight) return 'skipped';

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const result = await Promise.race<LiveBattleSeriesHostLeaveResult>([
    Promise.resolve(flight).then(
      () => 'completed' as const,
      () => 'rejected' as const,
    ),
    new Promise<'timed_out'>(resolve => {
      timeout = setTimeout(
        () => resolve('timed_out'),
        Math.max(1, input.timeoutMs ?? LIVE_BATTLE_SERIES_LEAVE_TIMEOUT_MS),
      );
    }),
  ]);
  if (timeout !== null) clearTimeout(timeout);
  if (result === 'rejected' || result === 'timed_out') input.onFailure?.(result);
  return result;
}

export type LiveBattleSeriesTransitionCandidate = {
  sourceBattleId: string;
  seriesId: string;
  battleId: string;
  roundNumber: number;
};

export function isCanonicalRematchTransitionCandidate(
  current: LiveBattleSeriesStateInput | null,
  candidate: LiveBattleSeriesTransitionCandidate,
): boolean {
  return Boolean(
    current?.series
    && candidate.sourceBattleId === current.battleId
    && candidate.seriesId === current.series.id
    && candidate.battleId !== current.battleId
    && candidate.roundNumber === current.series.roundNumber + 1
    && candidate.roundNumber <= current.series.maxRounds,
  );
}

export class LiveBattleSeriesTransitionGate {
  private readonly battleIds = new Set<string>();

  accept(
    current: LiveBattleSeriesStateInput | null,
    candidate: LiveBattleSeriesTransitionCandidate,
  ): boolean {
    if (
      this.battleIds.has(candidate.battleId)
      || !isCanonicalRematchTransitionCandidate(current, candidate)
    ) return false;
    this.battleIds.add(candidate.battleId);
    return true;
  }
}

export function isCanonicalNextLiveBattle(
  previous: LiveBattleSeriesStateInput | null,
  next: LiveBattleSeriesStateInput | null,
): boolean {
  if (!previous?.series || !next?.series) return false;
  return previous.series.id === next.series.id
    && previous.battleId !== next.battleId
    && next.series.roundNumber === previous.series.roundNumber + 1
    && next.series.roundNumber <= next.series.maxRounds;
}

export class LiveBattleSeriesSingleFlight {
  private flight: Promise<unknown> | null = null;

  get pending(): boolean {
    return this.flight !== null;
  }

  run<T>(operation: () => Promise<T>): Promise<T> | null {
    if (this.flight) return null;
    const flight = Promise.resolve().then(operation);
    this.flight = flight;
    void flight.finally(() => {
      if (this.flight === flight) this.flight = null;
    }).catch(() => undefined);
    return flight;
  }
}
