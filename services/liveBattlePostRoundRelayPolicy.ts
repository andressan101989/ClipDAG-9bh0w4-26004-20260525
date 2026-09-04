import type { LiveBattle } from './liveBattleService';
import type {
  LiveBattlePublicState,
  LiveBattleRelaySessionPairAuthority,
  LiveBattleServerClockAnchor,
} from './liveBattleSpectatorService';

export const LIVE_BATTLE_RELAY_DECISIONS = [
  'relaying_active_round',
  'holding_for_rematch',
  'transitioning_to_next_round',
  'stop_terminal',
] as const;

export type LiveBattleRelayDecision = typeof LIVE_BATTLE_RELAY_DECISIONS[number];

export type LiveBattleRelayPolicyInput = {
  battle: LiveBattle;
  projection: LiveBattlePublicState | null;
  clockAnchor: LiveBattleServerClockAnchor | null;
  serverNowMs: number | null;
  relayBattleId: string | null;
  relaySeriesId: string | null;
  relayRoundNumber: number | null;
  sessionPair: LiveBattleRelaySessionPairAuthority | null;
  localSessionId: string | null;
  localHostUserId: string | null;
  eligible: boolean;
};

function pairIsCanonical(input: LiveBattleRelayPolicyInput): boolean {
  const { projection, sessionPair } = input;
  if (!projection || !sessionPair) return false;
  return sessionPair.localSessionLive
    && sessionPair.opponentSessionLive
    && sessionPair.localSessionId === projection.sessionId
    && sessionPair.opponentSessionId === projection.opponentSessionId
    && sessionPair.localHostUserId === projection.localHostUserId
    && sessionPair.opponentHostUserId === projection.opponentHostUserId
    && input.localSessionId === projection.sessionId
    && input.localHostUserId === projection.localHostUserId;
}

export function resolveLiveBattleRelayPolicy(
  input: LiveBattleRelayPolicyInput,
): LiveBattleRelayDecision {
  const { battle, projection, serverNowMs } = input;
  if (!input.eligible || !pairIsCanonical(input)) return 'stop_terminal';
  if (projection?.battleId !== battle.id) return 'stop_terminal';

  if ((battle.status === 'countdown' || battle.status === 'active') && battle.endedAt === null) {
    const series = projection.series;
    const advancesSameSeries = input.relayBattleId !== null
      && input.relayBattleId !== battle.id
      && input.relaySeriesId !== null
      && series?.id === input.relaySeriesId
      && input.relayRoundNumber !== null
      && series.roundNumber === input.relayRoundNumber + 1;
    return advancesSameSeries
      ? 'transitioning_to_next_round'
      : 'relaying_active_round';
  }

  if (battle.status !== 'completed' || battle.endedAt === null) return 'stop_terminal';
  const series = projection.series;
  if (
    !series
    || series.format !== 'best_of_5'
    || (series.status !== 'awaiting_rematch' && series.status !== 'rematch_pending')
    || series.championUserId !== null
    || series.roundNumber !== series.roundsCompleted
    || series.roundNumber >= series.maxRounds
    || series.challengerWins >= series.winsRequired
    || series.opponentWins >= series.winsRequired
    || series.rematchWindowExpiresAt === null
    || serverNowMs === null
  ) return 'stop_terminal';

  const windowDeadline = Date.parse(series.rematchWindowExpiresAt);
  if (!Number.isFinite(windowDeadline) || serverNowMs >= windowDeadline) {
    return 'stop_terminal';
  }
  if (series.status === 'awaiting_rematch') {
    return series.rematchRequestStatus === null
      ? 'holding_for_rematch'
      : 'stop_terminal';
  }
  const requestDeadline = series.rematchRequestExpiresAt === null
    ? Number.NaN
    : Date.parse(series.rematchRequestExpiresAt);
  return series.rematchRequestStatus === 'pending'
    && series.rematchRequestId !== null
    && series.rematchRequestAfterBattleId === battle.id
    && Number.isFinite(requestDeadline)
    && serverNowMs < requestDeadline
    ? 'holding_for_rematch'
    : 'stop_terminal';
}

export function getLiveBattleRelayDecisionDeadline(
  state: LiveBattlePublicState,
): string | null {
  const series = state.series;
  if (!series) return null;
  if (series.status === 'rematch_pending' && series.rematchRequestStatus === 'pending') {
    return series.rematchRequestExpiresAt ?? series.rematchWindowExpiresAt;
  }
  if (series.status === 'awaiting_rematch') return series.rematchWindowExpiresAt;
  return null;
}
