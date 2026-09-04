export type BattleRelaySession = {
  id: string;
  host_id: string;
  status: string;
  ended_at: string | null;
};

type BattleRelayState = {
  id?: unknown;
  challenger_user_id?: unknown;
  opponent_user_id?: unknown;
  challenger_session_id?: unknown;
  opponent_session_id?: unknown;
  status?: unknown;
  ended_at?: unknown;
  scheduled_start_at?: unknown;
  scheduled_end_at?: unknown;
  series_id?: unknown;
  round_number?: unknown;
};

export type BattleRelayProjection = {
  battle_id?: unknown;
  session_id?: unknown;
  opponent_session_id?: unknown;
  local_host_user_id?: unknown;
  opponent_host_user_id?: unknown;
  series_id?: unknown;
  round_number?: unknown;
  series_format?: unknown;
  series_max_rounds?: unknown;
  series_wins_required?: unknown;
  challenger_series_wins?: unknown;
  opponent_series_wins?: unknown;
  series_rounds_completed?: unknown;
  series_status?: unknown;
  series_champion_user_id?: unknown;
  rematch_request_id?: unknown;
  rematch_request_after_battle_id?: unknown;
  rematch_request_status?: unknown;
  rematch_request_expires_at?: unknown;
  rematch_window_expires_at?: unknown;
};

export const BATTLE_DURATION_SEC = 300;
export const BATTLE_RELAY_TOKEN_GRACE_SEC = 15;
export const BATTLE_RELAY_TOKEN_MAX_SEC = 360;

export type AuthorizedBattleRelay = {
  battleId: string;
  participant: 'challenger' | 'opponent';
  sourceSessionId: string;
  destinationSessionId: string;
  expiresIn: number;
};

export class BattleRelayAuthorizationError extends Error {
  constructor(
    public readonly code: 'battle_relay_not_found' | 'battle_relay_not_authorized',
    public readonly status: 404 | 409,
  ) {
    super(code);
    this.name = 'BattleRelayAuthorizationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function requiredTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function calculateBattleRelayExpiresIn(
  battle: BattleRelayState,
  now: Date,
  projection: BattleRelayProjection | null = null,
): number {
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new BattleRelayAuthorizationError('battle_relay_not_authorized', 409);
  }

  let deadlineMilliseconds: number | null = null;
  if (battle.status === 'countdown') {
    const scheduledStart = requiredTimestamp(battle.scheduled_start_at);
    if (scheduledStart !== null) {
      deadlineMilliseconds = scheduledStart + BATTLE_DURATION_SEC * 1000;
    }
  } else if (battle.status === 'active') {
    deadlineMilliseconds = requiredTimestamp(battle.scheduled_end_at);
  } else if (battle.status === 'completed' && projection) {
    const rematchWindow = requiredTimestamp(projection.rematch_window_expires_at);
    const requestWindow = projection.series_status === 'rematch_pending'
      ? requiredTimestamp(projection.rematch_request_expires_at)
      : null;
    deadlineMilliseconds = rematchWindow !== null && requestWindow !== null
      ? Math.min(rematchWindow, requestWindow)
      : rematchWindow;
  }

  if (deadlineMilliseconds === null || deadlineMilliseconds <= nowMilliseconds) {
    throw new BattleRelayAuthorizationError('battle_relay_not_authorized', 409);
  }
  const remainingSeconds = Math.ceil((deadlineMilliseconds - nowMilliseconds) / 1000);
  const expiresIn = Math.min(
    BATTLE_RELAY_TOKEN_MAX_SEC,
    remainingSeconds + BATTLE_RELAY_TOKEN_GRACE_SEC,
  );
  if (expiresIn <= 0) {
    throw new BattleRelayAuthorizationError('battle_relay_not_authorized', 409);
  }
  return expiresIn;
}

/**
 * Resolves relay direction only from the reconciled Battle and authoritative
 * LIVE session rows. The request body never participates in this decision.
 */
export function authorizeBattleRelay(
  actorUserId: string,
  value: unknown,
  sessions: readonly BattleRelaySession[],
  now: Date = new Date(),
  projection: BattleRelayProjection | null = null,
): AuthorizedBattleRelay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BattleRelayAuthorizationError('battle_relay_not_found', 404);
  }

  const battle = value as BattleRelayState;
  const battleId = requiredUuid(battle.id);
  const challengerUserId = requiredUuid(battle.challenger_user_id);
  const opponentUserId = requiredUuid(battle.opponent_user_id);
  const challengerSessionId = requiredUuid(battle.challenger_session_id);
  const opponentSessionId = requiredUuid(battle.opponent_session_id);
  if (!battleId || !challengerUserId || !opponentUserId
    || !challengerSessionId || !opponentSessionId) {
    throw new BattleRelayAuthorizationError('battle_relay_not_found', 404);
  }
  if (actorUserId !== challengerUserId && actorUserId !== opponentUserId) {
    throw new BattleRelayAuthorizationError('battle_relay_not_found', 404);
  }
  const activeRound = (battle.status === 'countdown' || battle.status === 'active')
    && battle.ended_at === null;
  const seriesId = requiredUuid(battle.series_id);
  const roundNumber = Number(battle.round_number);
  const projectedBattleId = projection ? requiredUuid(projection.battle_id) : null;
  const projectedSeriesId = projection ? requiredUuid(projection.series_id) : null;
  const projectedSessionId = projection ? requiredUuid(projection.session_id) : null;
  const projectedOpponentSessionId = projection
    ? requiredUuid(projection.opponent_session_id)
    : null;
  const projectedLocalHostId = projection ? requiredUuid(projection.local_host_user_id) : null;
  const projectedOpponentHostId = projection
    ? requiredUuid(projection.opponent_host_user_id)
    : null;
  const projectedRoundNumber = Number(projection?.round_number);
  const projectedMaxRounds = Number(projection?.series_max_rounds);
  const projectedWinsRequired = Number(projection?.series_wins_required);
  const projectedChallengerWins = Number(projection?.challenger_series_wins);
  const projectedOpponentWins = Number(projection?.opponent_series_wins);
  const projectedRoundsCompleted = Number(projection?.series_rounds_completed);
  const projectionMatchesParticipants = new Set([
    projectedSessionId,
    projectedOpponentSessionId,
  ]).size === 2
    && [challengerSessionId, opponentSessionId].every(id => (
      id === projectedSessionId || id === projectedOpponentSessionId
    ))
    && [challengerUserId, opponentUserId].every(id => (
      id === projectedLocalHostId || id === projectedOpponentHostId
    ));
  const openPostRound = battle.status === 'completed'
    && battle.ended_at !== null
    && seriesId !== null
    && Number.isInteger(roundNumber)
    && projectedBattleId === battleId
    && projectedSeriesId === seriesId
    && projectedRoundNumber === roundNumber
    && projection?.series_format === 'best_of_5'
    && projectedMaxRounds === 5
    && projectedWinsRequired === 3
    && projectedRoundsCompleted === roundNumber
    && roundNumber < projectedMaxRounds
    && projectedChallengerWins < projectedWinsRequired
    && projectedOpponentWins < projectedWinsRequired
    && projection?.series_champion_user_id === null
    && projectionMatchesParticipants
    && (
      (
        projection?.series_status === 'awaiting_rematch'
        && projection.rematch_request_status === null
      )
      || (
        projection?.series_status === 'rematch_pending'
        && requiredUuid(projection.rematch_request_id) !== null
        && requiredUuid(projection.rematch_request_after_battle_id) === battleId
        && projection.rematch_request_status === 'pending'
      )
    );
  if ((!activeRound && !openPostRound) || challengerSessionId === opponentSessionId) {
    throw new BattleRelayAuthorizationError('battle_relay_not_authorized', 409);
  }

  const challengerSession = sessions.find(session => session.id === challengerSessionId);
  const opponentSession = sessions.find(session => session.id === opponentSessionId);
  const sessionsAreLive = sessions.length === 2
    && challengerSession?.host_id === challengerUserId
    && opponentSession?.host_id === opponentUserId
    && challengerSession.status === 'live'
    && opponentSession.status === 'live'
    && challengerSession.ended_at === null
    && opponentSession.ended_at === null;
  if (!sessionsAreLive) {
    throw new BattleRelayAuthorizationError('battle_relay_not_authorized', 409);
  }

  const expiresIn = calculateBattleRelayExpiresIn(battle, now, projection);
  const isChallenger = actorUserId === challengerUserId;
  return {
    battleId,
    participant: isChallenger ? 'challenger' : 'opponent',
    sourceSessionId: isChallenger ? challengerSessionId : opponentSessionId,
    destinationSessionId: isChallenger ? opponentSessionId : challengerSessionId,
    expiresIn,
  };
}
