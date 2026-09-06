import { getSupabaseClient } from '@/template';
import {
  isLiveBattleSeriesUuid,
  parseLiveBattleRematchRequest,
  parseLiveBattleSeries,
  type LiveBattleRematchDecision,
  type LiveBattleRematchRequest,
  type LiveBattleSeries,
} from './liveBattleSeriesContract';
import {
  parseLiveBattle,
  type LiveBattle,
} from './liveBattleService';

export type LiveBattleSeriesErrorCode =
  | 'existing_request'
  | 'not_participant'
  | 'window_expired'
  | 'series_closed'
  | 'max_rounds'
  | 'already_responded'
  | 'stale_state'
  | 'network'
  | 'session_expired'
  | 'invalid_response'
  | 'unknown';

export class LiveBattleSeriesServiceError extends Error {
  constructor(public readonly code: LiveBattleSeriesErrorCode) {
    super(code);
    this.name = 'LiveBattleSeriesServiceError';
  }
}

export type LiveBattleRematchRound = LiveBattle & {
  seriesId: string;
  roundNumber: number;
};

export type LiveBattleRematchActionResult = {
  request: LiveBattleRematchRequest;
  battle: LiveBattleRematchRound | null;
  series: LiveBattleSeries;
};

const BACKEND_ERROR_MAP: Readonly<Record<string, LiveBattleSeriesErrorCode>> = {
  live_battle_rematch_auth_required: 'session_expired',
  live_battle_series_auth_required: 'session_expired',
  live_battle_rematch_not_participant: 'not_participant',
  live_battle_rematch_responder_not_counterpart: 'not_participant',
  live_battle_series_not_participant: 'not_participant',
  live_battle_rematch_window_expired: 'window_expired',
  live_battle_rematch_request_expired: 'window_expired',
  live_battle_rematch_series_not_open: 'series_closed',
  live_battle_rematch_request_not_pending: 'already_responded',
  live_battle_rematch_round_not_latest: 'stale_state',
  live_battle_rematch_round_not_completed: 'stale_state',
  live_battle_rematch_battle_not_found: 'stale_state',
  live_battle_rematch_request_not_found: 'stale_state',
  live_battle_series_not_found: 'stale_state',
  live_battle_series_not_between_rounds: 'stale_state',
  live_battle_series_leave_state_invalid: 'stale_state',
  live_battle_series_leave_busy: 'network',
  live_battle_rematch_sessions_not_live: 'session_expired',
};

export function safeLiveBattleSeriesErrorMessage(
  code: LiveBattleSeriesErrorCode | null,
): string | null {
  if (!code) return null;
  if (code === 'not_participant') return 'Solo los hosts de esta Battle pueden realizar esa acción.';
  if (code === 'window_expired') return 'La ventana de revancha terminó.';
  if (code === 'series_closed' || code === 'max_rounds') return 'La serie ya finalizó.';
  if (code === 'already_responded' || code === 'stale_state' || code === 'existing_request') {
    return 'El estado cambió. Se mostró la versión más reciente.';
  }
  if (code === 'session_expired') return 'La sesión LIVE ya no está disponible.';
  if (code === 'network') return 'Sin conexión. Inténtalo nuevamente.';
  return 'No se pudo completar la acción. El estado fue actualizado.';
}

function normalizeRpcError(error: unknown): LiveBattleSeriesServiceError {
  const candidate = error && typeof error === 'object'
    ? error as { message?: unknown; code?: unknown; details?: unknown }
    : null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const mapped = BACKEND_ERROR_MAP[message];
  if (mapped) return new LiveBattleSeriesServiceError(mapped);
  const looksLikeNetworkFailure = !candidate
    || candidate.code === undefined
    || /network|fetch|timeout|offline/i.test(message);
  return new LiveBattleSeriesServiceError(looksLikeNetworkFailure ? 'network' : 'unknown');
}

function row(value: unknown, code: LiveBattleSeriesErrorCode): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleSeriesServiceError(code);
  }
  return value as Record<string, unknown>;
}

function parseRematchRound(value: unknown): LiveBattleRematchRound {
  const raw = row(value, 'invalid_response');
  const battle = parseLiveBattle(raw);
  const seriesId = raw.series_id;
  const roundNumber = typeof raw.round_number === 'number'
    ? raw.round_number
    : Number(raw.round_number);
  if (
    !isLiveBattleSeriesUuid(battle.id)
    || !isLiveBattleSeriesUuid(battle.challengerUserId)
    || !isLiveBattleSeriesUuid(battle.opponentUserId)
    || !isLiveBattleSeriesUuid(battle.challengerSessionId)
    || !isLiveBattleSeriesUuid(battle.opponentSessionId)
    || !isLiveBattleSeriesUuid(seriesId)
    || !Number.isSafeInteger(roundNumber)
    || roundNumber < 1
    || roundNumber > 5
  ) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  return { ...battle, seriesId, roundNumber };
}

export function parseLiveBattleRematchActionResult(
  value: unknown,
): LiveBattleRematchActionResult {
  const envelope = row(value, 'invalid_response');
  let request: LiveBattleRematchRequest;
  let series: LiveBattleSeries;
  try {
    request = parseLiveBattleRematchRequest(envelope.request);
    series = parseLiveBattleSeries(envelope.series);
  } catch {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  const battle = envelope.battle === null ? null : parseRematchRound(envelope.battle);
  if (
    request.seriesId !== series.id
    || (request.status === 'accepted' && (!battle || battle.seriesId !== series.id))
    || (request.status !== 'accepted' && battle !== null)
    || (request.status === 'accepted' && series.status !== 'active')
    || (request.status === 'accepted' && battle?.status !== 'countdown')
    || (request.status === 'accepted' && battle?.roundNumber !== series.roundsCompleted + 1)
    || (request.status === 'rejected' && series.status !== 'completed')
  ) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  return { request, battle, series };
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw normalizeRpcError(error);
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

export async function requestLiveBattleRematch(input: {
  battleId: string;
  idempotencyKey: string;
}): Promise<LiveBattleRematchRequest> {
  if (!isLiveBattleSeriesUuid(input.battleId) || !isLiveBattleSeriesUuid(input.idempotencyKey)) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  try {
    const request = parseLiveBattleRematchRequest(await rpc(
      'request_live_battle_rematch',
      { p_battle_id: input.battleId, p_idempotency_key: input.idempotencyKey },
    ));
    if (request.afterBattleId !== input.battleId) {
      throw new LiveBattleSeriesServiceError('invalid_response');
    }
    if (request.status !== 'pending') {
      throw new LiveBattleSeriesServiceError('invalid_response');
    }
    return request;
  } catch (error) {
    if (error instanceof LiveBattleSeriesServiceError) throw error;
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
}

export async function respondLiveBattleRematch(input: {
  requestId: string;
  decision: LiveBattleRematchDecision;
}): Promise<LiveBattleRematchActionResult> {
  if (
    !isLiveBattleSeriesUuid(input.requestId)
    || (input.decision !== 'accept' && input.decision !== 'reject')
  ) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  const result = parseLiveBattleRematchActionResult(await rpc(
    'respond_live_battle_rematch',
    { p_request_id: input.requestId, p_decision: input.decision },
  ));
  if (result.request.id !== input.requestId) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  if (result.request.status !== (input.decision === 'accept' ? 'accepted' : 'rejected')) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  return result;
}

export async function leaveLiveBattleSeries(seriesId: string): Promise<LiveBattleSeries> {
  if (!isLiveBattleSeriesUuid(seriesId)) {
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
  try {
    const series = parseLiveBattleSeries(await rpc(
      'leave_live_battle_series',
      { p_series_id: seriesId },
    ));
    if (series.id !== seriesId) {
      throw new LiveBattleSeriesServiceError('invalid_response');
    }
    return series;
  } catch (error) {
    if (error instanceof LiveBattleSeriesServiceError) throw error;
    throw new LiveBattleSeriesServiceError('invalid_response');
  }
}
