import { getSupabaseClient } from '@/template';
import type { LiveBattleSeriesProjection } from './liveBattleSeriesContract';

export const LIVE_BATTLE_PUBLIC_STATUSES = [
  'countdown',
  'active',
  'completed',
  'cancelled',
] as const;

export type LiveBattlePublicStatus = typeof LIVE_BATTLE_PUBLIC_STATUSES[number];

export const LIVE_BATTLE_PUBLIC_OUTCOMES = [
  'pending',
  'challenger',
  'opponent',
  'tie',
  'cancelled',
] as const;

export type LiveBattlePublicOutcome = typeof LIVE_BATTLE_PUBLIC_OUTCOMES[number];

export type LiveBattlePowerSide = 'challenger' | 'opponent';
export type LiveBattleLocalSide = LiveBattlePowerSide;
export type LiveBattlePowerBoostKind = 'rose_x2' | 'glove_x3';

export type LiveBattlePowerWindow = {
  startsAt: string;
  expiresAt: string;
};

export type LiveBattlePublicState = {
  sessionId: string;
  battleId: string;
  opponentSessionId: string;
  localBattleSide: LiveBattleLocalSide;
  localHostUserId: string;
  opponentHostUserId: string;
  localHostAgoraUid: number;
  opponentHostAgoraUid: number;
  status: LiveBattlePublicStatus;
  version: number;
  scheduledStartAt: string | null;
  startedAt: string | null;
  scheduledEndAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  challengerScore: number;
  opponentScore: number;
  scoreVersion: number;
  outcome: LiveBattlePublicOutcome;
  winnerUserId: string | null;
  scoreUpdatedAt: string;
  projectionVersion: number;
  boostRuleVersion: number;
  roseTargetUnits: number;
  challengerRoseProgressUnits: number;
  opponentRoseProgressUnits: number;
  challengerRoseActivationsRemaining: number;
  opponentRoseActivationsRemaining: number;
  challengerGloveUsesRemaining: number;
  opponentGloveUsesRemaining: number;
  challengerX2Window: LiveBattlePowerWindow | null;
  opponentX2Window: LiveBattlePowerWindow | null;
  challengerX3Window: LiveBattlePowerWindow | null;
  opponentX3Window: LiveBattlePowerWindow | null;
  powerVersion: number;
  powerUpdatedAt: string;
  serverClockAt: string;
  series: LiveBattleSeriesProjection | null;
};

export type LiveBattleServerClockAnchor = {
  serverEpochMsAtAnchor: number;
  monotonicMsAtAnchor: number;
  roundTripMs: number;
  projectionServerClockAt?: string;
};

export type LiveBattlePublicSnapshot = {
  serverNow: string;
  state: LiveBattlePublicState | null;
  clockAnchor: LiveBattleServerClockAnchor | null;
};

export type LiveBattleRelaySessionPairAuthority = {
  localSessionId: string;
  opponentSessionId: string;
  localHostUserId: string;
  opponentHostUserId: string;
  localSessionLive: boolean;
  opponentSessionLive: boolean;
};

type LiveBattlePublicStateRow = {
  session_id: unknown;
  battle_id: unknown;
  opponent_session_id: unknown;
  local_battle_side: unknown;
  local_host_user_id: unknown;
  opponent_host_user_id: unknown;
  local_host_agora_uid: unknown;
  opponent_host_agora_uid: unknown;
  status: unknown;
  version: unknown;
  scheduled_start_at: unknown;
  started_at: unknown;
  scheduled_end_at: unknown;
  ended_at: unknown;
  updated_at: unknown;
  challenger_score: unknown;
  opponent_score: unknown;
  score_version: unknown;
  outcome: unknown;
  winner_user_id: unknown;
  score_updated_at: unknown;
  projection_version: unknown;
  boost_rule_version: unknown;
  rose_target_units: unknown;
  challenger_rose_progress_units: unknown;
  opponent_rose_progress_units: unknown;
  challenger_rose_activations_remaining: unknown;
  opponent_rose_activations_remaining: unknown;
  challenger_glove_uses_remaining: unknown;
  opponent_glove_uses_remaining: unknown;
  challenger_x2_starts_at: unknown;
  challenger_x2_expires_at: unknown;
  opponent_x2_starts_at: unknown;
  opponent_x2_expires_at: unknown;
  challenger_x3_starts_at: unknown;
  challenger_x3_expires_at: unknown;
  opponent_x3_starts_at: unknown;
  opponent_x3_expires_at: unknown;
  power_version: unknown;
  power_updated_at: unknown;
  server_clock_at: unknown;
  series_id?: unknown;
  series_format?: unknown;
  round_number?: unknown;
  series_max_rounds?: unknown;
  series_wins_required?: unknown;
  challenger_series_wins?: unknown;
  opponent_series_wins?: unknown;
  series_ties?: unknown;
  series_rounds_completed?: unknown;
  series_status?: unknown;
  series_champion_user_id?: unknown;
  series_version?: unknown;
  rematch_request_id?: unknown;
  rematch_request_after_battle_id?: unknown;
  rematch_request_status?: unknown;
  rematch_requested_by_user_id?: unknown;
  rematch_request_expires_at?: unknown;
  rematch_window_expires_at?: unknown;
};

export type LiveBattleSpectatorSubscription = {
  reconcile: () => Promise<void>;
  unsubscribe: () => Promise<void>;
};

export class LiveBattleSpectatorError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LiveBattleSpectatorError';
  }
}

const PUBLIC_STATUS_SET = new Set<string>(LIVE_BATTLE_PUBLIC_STATUSES);
const PUBLIC_OUTCOME_SET = new Set<string>(LIVE_BATTLE_PUBLIC_OUTCOMES);
const SERIES_FORMAT_SET = new Set<string>(['single', 'best_of_5']);
const SERIES_STATUS_SET = new Set<string>([
  'active',
  'awaiting_rematch',
  'rematch_pending',
  'completed',
  'cancelled',
]);
const REMATCH_STATUS_SET = new Set<string>([
  'pending',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGORA_UID = 2_147_483_647;

type MonotonicNow = () => number | null;

export function isLiveBattleSpectatorUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function requiredUuid(value: unknown, field: string): string {
  if (!isLiveBattleSpectatorUuid(value)) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return value;
}

function requiredAgoraUid(value: unknown, field: string): number {
  const uid = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > MAX_AGORA_UID) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return uid;
}

function requiredVersion(value: unknown): number {
  const version = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_version');
  }
  return version;
}

function nonnegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return parsed;
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredUuid(value, field);
}

function timestamp(value: unknown, field: string, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== 'string' || value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return value;
}

function powerWindow(
  startsAtValue: unknown,
  expiresAtValue: unknown,
  field: string,
): LiveBattlePowerWindow | null {
  if (startsAtValue === null && expiresAtValue === null) return null;
  if (startsAtValue === null || expiresAtValue === null) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_' + field);
  }
  const startsAt = timestamp(startsAtValue, field + '_starts_at', true) as string;
  const expiresAt = timestamp(expiresAtValue, field + '_expires_at', true) as string;
  if (Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_' + field);
  }
  return { startsAt, expiresAt };
}

export function parseLiveBattleSeriesProjection(
  row: LiveBattlePublicStateRow,
  battleId: string,
  participantIds: readonly string[],
): LiveBattleSeriesProjection | null {
  const values = [
    row.series_id,
    row.series_format,
    row.round_number,
    row.series_max_rounds,
    row.series_wins_required,
    row.challenger_series_wins,
    row.opponent_series_wins,
    row.series_ties,
    row.series_rounds_completed,
    row.series_status,
    row.series_champion_user_id,
    row.series_version,
    row.rematch_request_id,
    row.rematch_request_after_battle_id,
    row.rematch_request_status,
    row.rematch_requested_by_user_id,
    row.rematch_request_expires_at,
    row.rematch_window_expires_at,
  ];
  if (values.every(value => value === undefined)) return null;

  const seriesId = requiredUuid(row.series_id, 'series_id');
  if (typeof row.series_format !== 'string' || !SERIES_FORMAT_SET.has(row.series_format)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_series_format');
  }
  if (typeof row.series_status !== 'string' || !SERIES_STATUS_SET.has(row.series_status)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_series_status');
  }
  const format = row.series_format as LiveBattleSeriesProjection['format'];
  const status = row.series_status as LiveBattleSeriesProjection['status'];
  const roundNumber = nonnegativeSafeInteger(row.round_number, 'round_number');
  const maxRounds = nonnegativeSafeInteger(row.series_max_rounds, 'series_max_rounds');
  const winsRequired = nonnegativeSafeInteger(row.series_wins_required, 'series_wins_required');
  const challengerWins = nonnegativeSafeInteger(
    row.challenger_series_wins,
    'challenger_series_wins',
  );
  const opponentWins = nonnegativeSafeInteger(
    row.opponent_series_wins,
    'opponent_series_wins',
  );
  const ties = nonnegativeSafeInteger(row.series_ties, 'series_ties');
  const roundsCompleted = nonnegativeSafeInteger(
    row.series_rounds_completed,
    'series_rounds_completed',
  );
  const championUserId = nullableUuid(
    row.series_champion_user_id,
    'series_champion_user_id',
  );
  const rematchRequestId = nullableUuid(row.rematch_request_id, 'rematch_request_id');
  const rematchRequestAfterBattleId = nullableUuid(
    row.rematch_request_after_battle_id,
    'rematch_request_after_battle_id',
  );
  const rematchRequestStatus = row.rematch_request_status === null
    ? null
    : typeof row.rematch_request_status === 'string'
      && REMATCH_STATUS_SET.has(row.rematch_request_status)
      ? row.rematch_request_status as LiveBattleSeriesProjection['rematchRequestStatus']
      : (() => {
          throw new LiveBattleSpectatorError('live_battle_public_invalid_rematch_request_status');
        })();
  const rematchRequestedByUserId = nullableUuid(
    row.rematch_requested_by_user_id,
    'rematch_requested_by_user_id',
  );
  const rematchRequestExpiresAt = timestamp(
    row.rematch_request_expires_at,
    'rematch_request_expires_at',
    false,
  );
  const rematchWindowExpiresAt = timestamp(
    row.rematch_window_expires_at,
    'rematch_window_expires_at',
    false,
  );
  const requestValues = [
    rematchRequestId,
    rematchRequestAfterBattleId,
    rematchRequestStatus,
    rematchRequestedByUserId,
    rematchRequestExpiresAt,
  ];
  const hasRequest = requestValues.every(value => value !== null);
  const hasPartialRequest = requestValues.some(value => value !== null) && !hasRequest;
  const requestIsCurrent = hasRequest && rematchRequestAfterBattleId === battleId;
  const expectedFormat = format === 'single'
    ? { maxRounds: 1, winsRequired: 1 }
    : { maxRounds: 5, winsRequired: 3 };
  const terminal = status === 'completed' || status === 'cancelled';

  if (
    roundNumber < 1 ||
    roundNumber > maxRounds ||
    maxRounds !== expectedFormat.maxRounds ||
    winsRequired !== expectedFormat.winsRequired ||
    challengerWins > winsRequired ||
    opponentWins > winsRequired ||
    challengerWins + opponentWins + ties !== roundsCompleted ||
    roundsCompleted > maxRounds ||
    (championUserId !== null && !participantIds.includes(championUserId)) ||
    (!terminal && championUserId !== null) ||
    hasPartialRequest ||
    (rematchRequestedByUserId !== null && !participantIds.includes(rematchRequestedByUserId)) ||
    ((status === 'awaiting_rematch' || status === 'rematch_pending')
      !== (rematchWindowExpiresAt !== null))
  ) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_series');
  }

  return {
    id: seriesId,
    format,
    roundNumber,
    maxRounds: maxRounds as 1 | 5,
    winsRequired: winsRequired as 1 | 3,
    challengerWins,
    opponentWins,
    ties,
    roundsCompleted,
    status,
    championUserId,
    version: requiredVersion(row.series_version),
    rematchRequestId: requestIsCurrent ? rematchRequestId : null,
    rematchRequestAfterBattleId: requestIsCurrent ? rematchRequestAfterBattleId : null,
    rematchRequestStatus: requestIsCurrent ? rematchRequestStatus : null,
    rematchRequestedByUserId: requestIsCurrent ? rematchRequestedByUserId : null,
    rematchRequestExpiresAt: requestIsCurrent ? rematchRequestExpiresAt : null,
    rematchWindowExpiresAt,
  };
}

export function readLiveBattleMonotonicNow(): number | null {
  const value = globalThis.performance?.now?.();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createLiveBattleServerClockAnchor(
  serverNow: string,
  requestStartedAt: number | null,
  responseReceivedAt: number | null,
  projectionServerClockAt: string | null = null,
): LiveBattleServerClockAnchor | null {
  const serverEpochMs = Date.parse(serverNow);
  if (
    !Number.isFinite(serverEpochMs) ||
    requestStartedAt === null ||
    responseReceivedAt === null ||
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(responseReceivedAt) ||
    responseReceivedAt < requestStartedAt
  ) return null;
  const roundTripMs = responseReceivedAt - requestStartedAt;
  const anchor: LiveBattleServerClockAnchor = {
    serverEpochMsAtAnchor: serverEpochMs + roundTripMs / 2,
    monotonicMsAtAnchor: responseReceivedAt,
    roundTripMs,
  };
  if (projectionServerClockAt !== null) {
    anchor.projectionServerClockAt = projectionServerClockAt;
  }
  return anchor;
}

export function estimateLiveBattleServerNow(
  anchor: LiveBattleServerClockAnchor | null,
  monotonicNow: number | null = readLiveBattleMonotonicNow(),
): number | null {
  if (
    !anchor ||
    monotonicNow === null ||
    !Number.isFinite(monotonicNow) ||
    monotonicNow < anchor.monotonicMsAtAnchor
  ) return null;
  return anchor.serverEpochMsAtAnchor + monotonicNow - anchor.monotonicMsAtAnchor;
}

export type LiveBattlePowerVisualState = {
  multiplier: 1 | 2 | 3;
  activeBoost: LiveBattlePowerBoostKind | null;
  remainingMs: number;
};

export type LiveBattleLocalCompetitiveState = {
  localSide: LiveBattleLocalSide;
  rivalSide: LiveBattlePowerSide;
  localScore: number;
  rivalScore: number;
  localRoseProgressUnits: number;
  rivalRoseProgressUnits: number;
  localRoseActivationsRemaining: number;
  rivalRoseActivationsRemaining: number;
  localGloveUsesRemaining: number;
  rivalGloveUsesRemaining: number;
  localResult: 'pending' | 'won' | 'lost' | 'tie' | 'cancelled';
};

export function deriveLiveBattleLocalCompetitiveState(
  state: LiveBattlePublicState,
): LiveBattleLocalCompetitiveState {
  const localIsChallenger = state.localBattleSide === 'challenger';
  const winningSide = state.outcome === 'challenger' || state.outcome === 'opponent'
    ? state.outcome
    : null;
  const localResult = state.outcome === 'pending'
    ? 'pending'
    : state.outcome === 'tie'
      ? 'tie'
      : state.outcome === 'cancelled'
        ? 'cancelled'
        : winningSide === state.localBattleSide ? 'won' : 'lost';
  return {
    localSide: state.localBattleSide,
    rivalSide: localIsChallenger ? 'opponent' : 'challenger',
    localScore: localIsChallenger ? state.challengerScore : state.opponentScore,
    rivalScore: localIsChallenger ? state.opponentScore : state.challengerScore,
    localRoseProgressUnits: localIsChallenger
      ? state.challengerRoseProgressUnits
      : state.opponentRoseProgressUnits,
    rivalRoseProgressUnits: localIsChallenger
      ? state.opponentRoseProgressUnits
      : state.challengerRoseProgressUnits,
    localRoseActivationsRemaining: localIsChallenger
      ? state.challengerRoseActivationsRemaining
      : state.opponentRoseActivationsRemaining,
    rivalRoseActivationsRemaining: localIsChallenger
      ? state.opponentRoseActivationsRemaining
      : state.challengerRoseActivationsRemaining,
    localGloveUsesRemaining: localIsChallenger
      ? state.challengerGloveUsesRemaining
      : state.opponentGloveUsesRemaining,
    rivalGloveUsesRemaining: localIsChallenger
      ? state.opponentGloveUsesRemaining
      : state.challengerGloveUsesRemaining,
    localResult,
  };
}

export function deriveLiveBattlePowerVisualState(
  state: LiveBattlePublicState,
  side: LiveBattlePowerSide,
  anchor: LiveBattleServerClockAnchor | null,
  monotonicNow: number | null = readLiveBattleMonotonicNow(),
): LiveBattlePowerVisualState {
  const serverNow = estimateLiveBattleServerNow(anchor, monotonicNow);
  const deadline = state.scheduledEndAt === null
    ? null
    : Date.parse(state.scheduledEndAt);
  if (
    state.status !== 'active' ||
    serverNow === null ||
    deadline === null ||
    !Number.isFinite(deadline) ||
    serverNow >= deadline
  ) {
    return { multiplier: 1, activeBoost: null, remainingMs: 0 };
  }

  const x2 = side === 'challenger'
    ? state.challengerX2Window
    : state.opponentX2Window;
  const x3 = side === 'challenger'
    ? state.challengerX3Window
    : state.opponentX3Window;
  const active = (
    window: LiveBattlePowerWindow | null,
  ): { active: boolean; remainingMs: number } => {
    if (!window) return { active: false, remainingMs: 0 };
    const startsAt = Date.parse(window.startsAt);
    const expiresAt = Math.min(Date.parse(window.expiresAt), deadline);
    return {
      active: startsAt <= serverNow && serverNow < expiresAt,
      remainingMs: Math.max(0, expiresAt - serverNow),
    };
  };
  const x3State = active(x3);
  if (x3State.active) {
    return {
      multiplier: 3,
      activeBoost: 'glove_x3',
      remainingMs: x3State.remainingMs,
    };
  }
  const x2State = active(x2);
  if (x2State.active) {
    return {
      multiplier: 2,
      activeBoost: 'rose_x2',
      remainingMs: x2State.remainingMs,
    };
  }
  return { multiplier: 1, activeBoost: null, remainingMs: 0 };
}

export function parseLiveBattlePublicState(value: unknown): LiveBattlePublicState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_response');
  }
  const row = value as LiveBattlePublicStateRow;
  const sessionId = requiredUuid(row.session_id, 'session_id');
  const opponentSessionId = requiredUuid(row.opponent_session_id, 'opponent_session_id');
  if (row.local_battle_side !== 'challenger' && row.local_battle_side !== 'opponent') {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_local_battle_side');
  }
  const localBattleSide = row.local_battle_side;
  const localHostUserId = requiredUuid(row.local_host_user_id, 'local_host_user_id');
  const opponentHostUserId = requiredUuid(row.opponent_host_user_id, 'opponent_host_user_id');
  const battleId = requiredUuid(row.battle_id, 'battle_id');
  if (sessionId === opponentSessionId) {
    throw new LiveBattleSpectatorError('live_battle_public_same_session');
  }
  if (localHostUserId === opponentHostUserId) {
    throw new LiveBattleSpectatorError('live_battle_public_same_host');
  }
  if (typeof row.status !== 'string' || !PUBLIC_STATUS_SET.has(row.status)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_status');
  }

  const status = row.status as LiveBattlePublicStatus;
  const scheduledStartAt = timestamp(row.scheduled_start_at, 'scheduled_start_at', true);
  const startedAt = timestamp(row.started_at, 'started_at', status === 'active' || status === 'completed');
  const scheduledEndAt = timestamp(row.scheduled_end_at, 'scheduled_end_at', status === 'active' || status === 'completed');
  const endedAt = timestamp(row.ended_at, 'ended_at', status === 'completed' || status === 'cancelled');
  if ((status === 'countdown' || status === 'active') && endedAt !== null) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_ended_at');
  }

  if (typeof row.outcome !== 'string' || !PUBLIC_OUTCOME_SET.has(row.outcome)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_outcome');
  }
  const outcome = row.outcome as LiveBattlePublicOutcome;
  const challengerScore = nonnegativeSafeInteger(row.challenger_score, 'challenger_score');
  const opponentScore = nonnegativeSafeInteger(row.opponent_score, 'opponent_score');
  const winnerUserId = nullableUuid(row.winner_user_id, 'winner_user_id');
  if (
    (outcome === 'pending' && winnerUserId !== null) ||
    (outcome === 'challenger' && (winnerUserId === null || challengerScore <= opponentScore)) ||
    (outcome === 'opponent' && (winnerUserId === null || opponentScore <= challengerScore)) ||
    (outcome === 'tie' && (winnerUserId !== null || challengerScore !== opponentScore)) ||
    (outcome === 'cancelled' && winnerUserId !== null) ||
    (winnerUserId !== null && winnerUserId !== localHostUserId && winnerUserId !== opponentHostUserId) ||
    ((status === 'countdown' || status === 'active') && outcome !== 'pending') ||
    (status === 'completed' && !['challenger', 'opponent', 'tie'].includes(outcome)) ||
    (status === 'cancelled' && outcome !== 'cancelled')
  ) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_result');
  }

  const boostRuleVersion = requiredVersion(row.boost_rule_version);
  const roseTargetUnits = nonnegativeSafeInteger(
    row.rose_target_units,
    'rose_target_units',
  );
  const challengerRoseProgressUnits = nonnegativeSafeInteger(
    row.challenger_rose_progress_units,
    'challenger_rose_progress_units',
  );
  const opponentRoseProgressUnits = nonnegativeSafeInteger(
    row.opponent_rose_progress_units,
    'opponent_rose_progress_units',
  );
  const challengerRoseActivationsRemaining = nonnegativeSafeInteger(
    row.challenger_rose_activations_remaining,
    'challenger_rose_activations_remaining',
  );
  const opponentRoseActivationsRemaining = nonnegativeSafeInteger(
    row.opponent_rose_activations_remaining,
    'opponent_rose_activations_remaining',
  );
  const challengerGloveUsesRemaining = nonnegativeSafeInteger(
    row.challenger_glove_uses_remaining,
    'challenger_glove_uses_remaining',
  );
  const opponentGloveUsesRemaining = nonnegativeSafeInteger(
    row.opponent_glove_uses_remaining,
    'opponent_glove_uses_remaining',
  );
  const challengerX2Window = powerWindow(
    row.challenger_x2_starts_at,
    row.challenger_x2_expires_at,
    'challenger_x2',
  );
  const opponentX2Window = powerWindow(
    row.opponent_x2_starts_at,
    row.opponent_x2_expires_at,
    'opponent_x2',
  );
  const challengerX3Window = powerWindow(
    row.challenger_x3_starts_at,
    row.challenger_x3_expires_at,
    'challenger_x3',
  );
  const opponentX3Window = powerWindow(
    row.opponent_x3_starts_at,
    row.opponent_x3_expires_at,
    'opponent_x3',
  );
  const allPowerWindows = [
    challengerX2Window,
    opponentX2Window,
    challengerX3Window,
    opponentX3Window,
  ];
  if (
    challengerRoseProgressUnits > roseTargetUnits ||
    opponentRoseProgressUnits > roseTargetUnits ||
    (
      scheduledEndAt !== null &&
      allPowerWindows.some(window => (
        window !== null &&
        Date.parse(window.expiresAt) > Date.parse(scheduledEndAt)
      ))
    ) ||
    (
      boostRuleVersion === 1 &&
      (
        roseTargetUnits !== 0 ||
        challengerRoseProgressUnits !== 0 ||
        opponentRoseProgressUnits !== 0 ||
        challengerRoseActivationsRemaining !== 0 ||
        opponentRoseActivationsRemaining !== 0 ||
        challengerGloveUsesRemaining !== 0 ||
        opponentGloveUsesRemaining !== 0 ||
        allPowerWindows.some(window => window !== null)
      )
    ) ||
    (
      (status === 'completed' || status === 'cancelled') &&
      (challengerGloveUsesRemaining !== 0 || opponentGloveUsesRemaining !== 0)
    )
  ) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_power_state');
  }

  let series: LiveBattleSeriesProjection | null;
  try {
    series = parseLiveBattleSeriesProjection(
      row,
      battleId,
      [localHostUserId, opponentHostUserId],
    );
  } catch {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_series');
  }

  return {
    sessionId,
    battleId,
    opponentSessionId,
    localBattleSide,
    localHostUserId,
    opponentHostUserId,
    localHostAgoraUid: requiredAgoraUid(row.local_host_agora_uid, 'local_host_agora_uid'),
    opponentHostAgoraUid: requiredAgoraUid(row.opponent_host_agora_uid, 'opponent_host_agora_uid'),
    status,
    version: requiredVersion(row.version),
    scheduledStartAt,
    startedAt,
    scheduledEndAt,
    endedAt,
    updatedAt: timestamp(row.updated_at, 'updated_at', true) as string,
    challengerScore,
    opponentScore,
    scoreVersion: nonnegativeSafeInteger(row.score_version, 'score_version'),
    outcome,
    winnerUserId,
    scoreUpdatedAt: timestamp(row.score_updated_at, 'score_updated_at', true) as string,
    projectionVersion: requiredVersion(row.projection_version),
    boostRuleVersion,
    roseTargetUnits,
    challengerRoseProgressUnits,
    opponentRoseProgressUnits,
    challengerRoseActivationsRemaining,
    opponentRoseActivationsRemaining,
    challengerGloveUsesRemaining,
    opponentGloveUsesRemaining,
    challengerX2Window,
    opponentX2Window,
    challengerX3Window,
    opponentX3Window,
    powerVersion: nonnegativeSafeInteger(row.power_version, 'power_version'),
    powerUpdatedAt: timestamp(row.power_updated_at, 'power_updated_at', true) as string,
    serverClockAt: timestamp(row.server_clock_at, 'server_clock_at', true) as string,
    series,
  };
}

export function parseLiveBattlePublicSnapshotEnvelope(value: unknown): {
  serverNow: string;
  state: LiveBattlePublicState | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_snapshot');
  }
  const envelope = value as { server_now?: unknown; state?: unknown };
  const serverNow = timestamp(envelope.server_now, 'server_now', true) as string;
  if (envelope.state === null) return { serverNow, state: null };
  if (envelope.state === undefined) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_snapshot');
  }
  return { serverNow, state: parseLiveBattlePublicState(envelope.state) };
}

export function reduceLiveBattlePublicState(
  current: LiveBattlePublicState | null,
  next: LiveBattlePublicState,
): LiveBattlePublicState | null {
  if (!current) return next;
  if (current.battleId === next.battleId) {
    return next.projectionVersion > current.projectionVersion ? next : current;
  }
  return Date.parse(next.updatedAt) > Date.parse(current.updatedAt) ? next : current;
}

function normalizeError(error: unknown): LiveBattleSpectatorError {
  if (error instanceof LiveBattleSpectatorError) return error;
  return new LiveBattleSpectatorError('live_battle_public_unavailable');
}

export async function getLiveBattlePublicSnapshot(
  sessionId: string,
  monotonicNow: MonotonicNow = readLiveBattleMonotonicNow,
): Promise<LiveBattlePublicSnapshot> {
  if (!isLiveBattleSpectatorUuid(sessionId)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_session_id');
  }
  const requestStartedAt = monotonicNow();
  const { data, error } = await getSupabaseClient().rpc(
    'get_live_battle_public_snapshot',
    { p_session_id: sessionId },
  );
  const responseReceivedAt = monotonicNow();
  if (error) throw normalizeError(error);
  const envelope = parseLiveBattlePublicSnapshotEnvelope(data);
  if (envelope.state && envelope.state.sessionId !== sessionId) {
    throw new LiveBattleSpectatorError('live_battle_public_session_mismatch');
  }
  return {
    ...envelope,
    clockAnchor: createLiveBattleServerClockAnchor(
      envelope.serverNow,
      requestStartedAt,
      responseReceivedAt,
      envelope.state?.serverClockAt ?? null,
    ),
  };
}

export async function getLiveBattleRelaySessionPairAuthority(
  state: LiveBattlePublicState,
): Promise<LiveBattleRelaySessionPairAuthority> {
  const { data, error } = await getSupabaseClient()
    .from('live_sessions')
    .select('id, host_id, status, ended_at')
    .in('id', [state.sessionId, state.opponentSessionId])
    .returns<Array<{
      id: string;
      host_id: string;
      status: string;
      ended_at: string | null;
    }>>();
  if (error) throw new LiveBattleSpectatorError('live_battle_session_pair_unavailable');
  const local = (data ?? []).find(session => session.id === state.sessionId);
  const opponent = (data ?? []).find(session => session.id === state.opponentSessionId);
  return {
    localSessionId: state.sessionId,
    opponentSessionId: state.opponentSessionId,
    localHostUserId: state.localHostUserId,
    opponentHostUserId: state.opponentHostUserId,
    localSessionLive: (data ?? []).length === 2
      && local?.host_id === state.localHostUserId
      && local.status === 'live'
      && local.ended_at === null,
    opponentSessionLive: (data ?? []).length === 2
      && opponent?.host_id === state.opponentHostUserId
      && opponent.status === 'live'
      && opponent.ended_at === null,
  };
}

let channelSequence = 0;

export function subscribeToLiveBattlePublicState(
  sessionId: string,
  onChange: (state: LiveBattlePublicState | null) => void,
  onError?: (error: LiveBattleSpectatorError) => void,
  onClockAnchor?: (anchor: LiveBattleServerClockAnchor | null) => void,
  monotonicNow: MonotonicNow = readLiveBattleMonotonicNow,
): LiveBattleSpectatorSubscription {
  if (!isLiveBattleSpectatorUuid(sessionId)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_session_id');
  }
  const client = getSupabaseClient();
  let current: LiveBattlePublicState | null = null;
  let disposed = false;
  let mutationSequence = 0;
  let snapshotSequence = 0;
  channelSequence += 1;

  const publish = (next: LiveBattlePublicState) => {
    const reduced = reduceLiveBattlePublicState(current, next);
    if (reduced === current) return;
    current = reduced;
    onChange(current);
  };

  const reconcile = async () => {
    const requestSequence = ++snapshotSequence;
    const mutationAtStart = mutationSequence;
    try {
      const snapshot = await getLiveBattlePublicSnapshot(sessionId, monotonicNow);
      if (disposed || requestSequence !== snapshotSequence) return;
      onClockAnchor?.(snapshot.clockAnchor);
      if (snapshot.state) {
        publish(snapshot.state);
        return;
      }
      if (mutationAtStart !== mutationSequence) return;
      if (current !== null) {
        current = null;
        mutationSequence += 1;
      }
      onChange(null);
    } catch (error) {
      if (!disposed && requestSequence === snapshotSequence) {
        onError?.(normalizeError(error));
      }
    }
  };

  const handleMutation = () => {
    if (disposed) return;
    mutationSequence += 1;
    void reconcile();
  };

  const handleDelete = (payload: { old?: unknown }) => {
    if (disposed) return;
    const old = payload.old;
    if (!old || typeof old !== 'object' || Array.isArray(old)) {
      onError?.(new LiveBattleSpectatorError('live_battle_public_invalid_delete_key'));
      return;
    }
    const removedSessionId = (old as { session_id?: unknown }).session_id;
    if (!isLiveBattleSpectatorUuid(removedSessionId)) {
      onError?.(new LiveBattleSpectatorError('live_battle_public_invalid_delete_key'));
      return;
    }
    if (removedSessionId !== sessionId) return;
    handleMutation();
  };

  const channel = client
    .channel(`live-battle-public:${sessionId}:${channelSequence}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'live_battle_public_states',
      filter: `session_id=eq.${sessionId}`,
    }, handleMutation)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'live_battle_public_states',
      filter: `session_id=eq.${sessionId}`,
    }, handleMutation)
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'live_battle_public_states',
    }, handleDelete)
    .subscribe(status => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        void reconcile();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new LiveBattleSpectatorError('live_battle_public_realtime_unavailable'));
      }
    });

  let cleanup: Promise<void> | null = null;
  return {
    reconcile,
    unsubscribe: () => {
      disposed = true;
      snapshotSequence += 1;
      cleanup ??= client.removeChannel(channel).then(() => undefined);
      return cleanup;
    },
  };
}

export function isLiveBattleStageStatus(status: LiveBattlePublicStatus, state?: LiveBattlePublicState): boolean {
  // Only confirmed projection authority closes the Stage, never a local clock.
  // Keep the one-argument status predicate compatible with existing consumers.
  if (state) {
    if (status === 'cancelled') return false;
    const series = state.series;
    if (series?.status === 'completed' || series?.status === 'cancelled') return false;
    if (series?.rematchRequestStatus === 'rejected'
      || series?.rematchRequestStatus === 'expired'
      || series?.rematchRequestStatus === 'cancelled') return false;
  }
  return status === 'countdown' || status === 'active'
    || status === 'completed' || status === 'cancelled';
}
