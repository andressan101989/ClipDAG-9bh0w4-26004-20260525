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
  if ((battle.status !== 'countdown' && battle.status !== 'active')
    || battle.ended_at !== null
    || challengerSessionId === opponentSessionId) {
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

  const expiresIn = calculateBattleRelayExpiresIn(battle, now);
  const isChallenger = actorUserId === challengerUserId;
  return {
    battleId,
    participant: isChallenger ? 'challenger' : 'opponent',
    sourceSessionId: isChallenger ? challengerSessionId : opponentSessionId,
    destinationSessionId: isChallenger ? opponentSessionId : challengerSessionId,
    expiresIn,
  };
}
