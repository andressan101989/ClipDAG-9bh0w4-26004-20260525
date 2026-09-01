export const LIVE_BATTLE_SERIES_FORMATS = ['single', 'best_of_5'] as const;

export type LiveBattleSeriesFormat = typeof LIVE_BATTLE_SERIES_FORMATS[number];

export const LIVE_BATTLE_SERIES_STATUSES = [
  'active',
  'awaiting_rematch',
  'rematch_pending',
  'completed',
  'cancelled',
] as const;

export type LiveBattleSeriesStatus = typeof LIVE_BATTLE_SERIES_STATUSES[number];

export const LIVE_BATTLE_REMATCH_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;

export type LiveBattleRematchStatus = typeof LIVE_BATTLE_REMATCH_STATUSES[number];
export type LiveBattleRematchDecision = 'accept' | 'reject';

export type LiveBattleSeriesProjection = {
  id: string;
  format: LiveBattleSeriesFormat;
  roundNumber: number;
  maxRounds: 1 | 5;
  winsRequired: 1 | 3;
  challengerWins: number;
  opponentWins: number;
  ties: number;
  roundsCompleted: number;
  status: LiveBattleSeriesStatus;
  championUserId: string | null;
  version: number;
  rematchRequestId: string | null;
  rematchRequestAfterBattleId: string | null;
  rematchRequestStatus: LiveBattleRematchStatus | null;
  rematchRequestedByUserId: string | null;
  rematchRequestExpiresAt: string | null;
  rematchWindowExpiresAt: string | null;
};

export type LiveBattleRematchRequest = {
  id: string;
  seriesId: string;
  afterBattleId: string;
  requestedByUserId: string;
  status: LiveBattleRematchStatus;
  expiresAt: string;
  respondedByUserId: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LiveBattleSeries = {
  id: string;
  format: LiveBattleSeriesFormat;
  maxRounds: 1 | 5;
  winsRequired: 1 | 3;
  status: LiveBattleSeriesStatus;
  challengerWins: number;
  opponentWins: number;
  ties: number;
  roundsCompleted: number;
  championUserId: string | null;
  rematchWindowExpiresAt: string | null;
  version: number;
  completedAt: string | null;
};

export class LiveBattleSeriesContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LiveBattleSeriesContractError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERIES_FORMAT_SET = new Set<string>(LIVE_BATTLE_SERIES_FORMATS);
const SERIES_STATUS_SET = new Set<string>(LIVE_BATTLE_SERIES_STATUSES);
const REMATCH_STATUS_SET = new Set<string>(LIVE_BATTLE_REMATCH_STATUSES);

export function isLiveBattleSeriesUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleSeriesContractError(code);
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, field: string): string {
  if (!isLiveBattleSeriesUuid(value)) {
    throw new LiveBattleSeriesContractError(`live_battle_series_invalid_${field}`);
  }
  return value;
}

function nullableUuid(value: unknown, field: string): string | null {
  return value === null ? null : uuid(value, field);
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new LiveBattleSeriesContractError(`live_battle_series_invalid_${field}`);
  }
  return parsed;
}

function timestamp(value: unknown, field: string, required: true): string;
function timestamp(value: unknown, field: string, required: false): string | null;
function timestamp(value: unknown, field: string, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) {
    throw new LiveBattleSeriesContractError(`live_battle_series_invalid_${field}`);
  }
  return value;
}

function format(value: unknown): LiveBattleSeriesFormat {
  if (typeof value !== 'string' || !SERIES_FORMAT_SET.has(value)) {
    throw new LiveBattleSeriesContractError('live_battle_series_invalid_format');
  }
  return value as LiveBattleSeriesFormat;
}

function seriesStatus(value: unknown): LiveBattleSeriesStatus {
  if (typeof value !== 'string' || !SERIES_STATUS_SET.has(value)) {
    throw new LiveBattleSeriesContractError('live_battle_series_invalid_status');
  }
  return value as LiveBattleSeriesStatus;
}

function rematchStatus(value: unknown): LiveBattleRematchStatus {
  if (typeof value !== 'string' || !REMATCH_STATUS_SET.has(value)) {
    throw new LiveBattleSeriesContractError('live_battle_series_invalid_rematch_status');
  }
  return value as LiveBattleRematchStatus;
}

function validateCounters(input: {
  format: LiveBattleSeriesFormat;
  maxRounds: number;
  winsRequired: number;
  challengerWins: number;
  opponentWins: number;
  ties: number;
  roundsCompleted: number;
}): asserts input is typeof input & { maxRounds: 1 | 5; winsRequired: 1 | 3 } {
  const limitsValid = input.format === 'single'
    ? input.maxRounds === 1 && input.winsRequired === 1
    : input.maxRounds === 5 && input.winsRequired === 3;
  if (
    !limitsValid
    || input.roundsCompleted > input.maxRounds
    || input.challengerWins + input.opponentWins + input.ties !== input.roundsCompleted
    || input.challengerWins > input.winsRequired
    || input.opponentWins > input.winsRequired
  ) {
    throw new LiveBattleSeriesContractError('live_battle_series_invalid_counters');
  }
}

export function parseLiveBattleRematchRequest(value: unknown): LiveBattleRematchRequest {
  const row = object(value, 'live_battle_rematch_invalid_response');
  const status = rematchStatus(row.status);
  const createdAt = timestamp(row.created_at, 'request_created_at', true);
  const updatedAt = timestamp(row.updated_at, 'request_updated_at', true);
  const expiresAt = timestamp(row.expires_at, 'request_expires_at', true);
  const respondedAt = timestamp(row.responded_at, 'request_responded_at', false);
  const respondedByUserId = nullableUuid(row.responded_by_user_id, 'request_responder');
  if (
    Date.parse(updatedAt) < Date.parse(createdAt)
    || Date.parse(expiresAt) <= Date.parse(createdAt)
    || (status === 'pending' && (respondedAt || respondedByUserId))
    || (status === 'accepted' || status === 'rejected') && (!respondedAt || !respondedByUserId)
    || (status === 'expired' && (!respondedAt || respondedByUserId))
    || (status === 'cancelled' && !respondedAt)
  ) {
    throw new LiveBattleSeriesContractError('live_battle_rematch_invalid_lifecycle');
  }
  return {
    id: uuid(row.id, 'request_id'),
    seriesId: uuid(row.series_id, 'request_series_id'),
    afterBattleId: uuid(row.after_battle_id, 'request_after_battle_id'),
    requestedByUserId: uuid(row.requested_by_user_id, 'request_requester'),
    status,
    expiresAt,
    respondedByUserId,
    respondedAt,
    createdAt,
    updatedAt,
  };
}

export function parseLiveBattleSeries(value: unknown): LiveBattleSeries {
  const row = object(value, 'live_battle_series_invalid_response');
  const parsedFormat = format(row.format);
  const maxRounds = integer(row.max_rounds, 'max_rounds', 1);
  const winsRequired = integer(row.wins_required, 'wins_required', 1);
  const challengerWins = integer(row.challenger_wins, 'challenger_wins');
  const opponentWins = integer(row.opponent_wins, 'opponent_wins');
  const ties = integer(row.ties, 'ties');
  const roundsCompleted = integer(row.rounds_completed, 'rounds_completed');
  validateCounters({
    format: parsedFormat,
    maxRounds,
    winsRequired,
    challengerWins,
    opponentWins,
    ties,
    roundsCompleted,
  });
  const status = seriesStatus(row.status);
  const championUserId = nullableUuid(row.champion_user_id, 'champion_user_id');
  const completedAt = timestamp(row.completed_at, 'completed_at', false);
  const rematchWindowExpiresAt = timestamp(
    row.rematch_window_expires_at,
    'rematch_window_expires_at',
    false,
  );
  if (
    (status === 'completed' || status === 'cancelled') !== (completedAt !== null)
    || ((status === 'awaiting_rematch' || status === 'rematch_pending') !== (rematchWindowExpiresAt !== null))
    || (status !== 'completed' && championUserId !== null)
    || (status === 'completed' && challengerWins === opponentWins && championUserId !== null)
    || (status === 'completed' && challengerWins !== opponentWins && championUserId === null)
  ) {
    throw new LiveBattleSeriesContractError('live_battle_series_invalid_lifecycle');
  }
  return {
    id: uuid(row.id, 'id'),
    format: parsedFormat,
    maxRounds: maxRounds as 1 | 5,
    winsRequired: winsRequired as 1 | 3,
    status,
    challengerWins,
    opponentWins,
    ties,
    roundsCompleted,
    championUserId,
    rematchWindowExpiresAt,
    version: integer(row.version, 'version', 1),
    completedAt,
  };
}
