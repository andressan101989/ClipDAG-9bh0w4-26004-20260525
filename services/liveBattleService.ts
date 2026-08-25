import { getSupabaseClient } from '@/template';

export const LIVE_BATTLE_STATUSES = [
  'pending',
  'accepted',
  'countdown',
  'active',
  'completed',
  'rejected',
  'cancelled',
  'expired',
] as const;

export type LiveBattleStatus = typeof LIVE_BATTLE_STATUSES[number];
export type LiveBattleInviteDecision = 'accept' | 'reject';

export interface LiveBattle {
  id: string;
  challengerUserId: string;
  opponentUserId: string;
  challengerSessionId: string;
  opponentSessionId: string;
  status: LiveBattleStatus;
  inviteExpiresAt: string;
  acceptedAt: string | null;
  countdownStartedAt: string | null;
  scheduledStartAt: string | null;
  startedAt: string | null;
  scheduledEndAt: string | null;
  endedAt: string | null;
  lastTransitionActorId: string | null;
  lastTransitionReason: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type LiveBattleRow = {
  id: unknown;
  challenger_user_id: unknown;
  opponent_user_id: unknown;
  challenger_session_id: unknown;
  opponent_session_id: unknown;
  status: unknown;
  invite_expires_at: unknown;
  accepted_at: unknown;
  countdown_started_at: unknown;
  scheduled_start_at: unknown;
  started_at: unknown;
  scheduled_end_at: unknown;
  ended_at: unknown;
  last_transition_actor_id: unknown;
  last_transition_reason: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const STATUS_SET = new Set<string>(LIVE_BATTLE_STATUSES);
const NON_TERMINAL_STATUSES: LiveBattleStatus[] = ['pending', 'accepted', 'countdown', 'active'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_ERROR_CODES = new Set([
  'live_battle_auth_required',
  'live_battle_users_invalid',
  'live_battle_user_not_found',
  'live_battle_sessions_invalid',
  'live_battle_session_not_found',
  'live_battle_opponent_invalid',
  'live_battle_challenger_not_host',
  'live_battle_opponent_not_host',
  'live_battle_session_not_live',
  'live_battle_pair_busy',
  'live_battle_participant_busy',
  'live_battle_not_found',
  'live_battle_forbidden',
  'live_battle_response_forbidden',
  'live_battle_response_invalid',
  'live_battle_response_state_invalid',
  'live_battle_host_authority_changed',
  'live_battle_start_state_invalid',
  'live_battle_terminal',
  'live_battle_completion_too_early',
  'live_battle_complete_state_invalid',
  'live_battle_state_changed',
  'live_battle_transition_invalid',
]);

export class LiveBattleServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly postgresCode: string | null = null,
  ) {
    super(code);
    this.name = 'LiveBattleServiceError';
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LiveBattleServiceError(`live_battle_invalid_${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

export function parseLiveBattle(value: unknown): LiveBattle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleServiceError('live_battle_invalid_response');
  }
  const row = value as LiveBattleRow;
  const status = requiredString(row.status, 'status');
  if (!STATUS_SET.has(status)) throw new LiveBattleServiceError('live_battle_invalid_status');
  const version = typeof row.version === 'number' ? row.version : Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new LiveBattleServiceError('live_battle_invalid_version');
  }
  return {
    id: requiredString(row.id, 'id'),
    challengerUserId: requiredString(row.challenger_user_id, 'challenger_user_id'),
    opponentUserId: requiredString(row.opponent_user_id, 'opponent_user_id'),
    challengerSessionId: requiredString(row.challenger_session_id, 'challenger_session_id'),
    opponentSessionId: requiredString(row.opponent_session_id, 'opponent_session_id'),
    status: status as LiveBattleStatus,
    inviteExpiresAt: requiredString(row.invite_expires_at, 'invite_expires_at'),
    acceptedAt: optionalString(row.accepted_at, 'accepted_at'),
    countdownStartedAt: optionalString(row.countdown_started_at, 'countdown_started_at'),
    scheduledStartAt: optionalString(row.scheduled_start_at, 'scheduled_start_at'),
    startedAt: optionalString(row.started_at, 'started_at'),
    scheduledEndAt: optionalString(row.scheduled_end_at, 'scheduled_end_at'),
    endedAt: optionalString(row.ended_at, 'ended_at'),
    lastTransitionActorId: optionalString(row.last_transition_actor_id, 'last_transition_actor_id'),
    lastTransitionReason: requiredString(row.last_transition_reason, 'last_transition_reason'),
    version,
    createdAt: requiredString(row.created_at, 'created_at'),
    updatedAt: requiredString(row.updated_at, 'updated_at'),
  };
}

function normalizeRpcError(error: unknown): LiveBattleServiceError {
  const candidate = error && typeof error === 'object'
    ? error as { message?: unknown; code?: unknown }
    : null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const code = KNOWN_ERROR_CODES.has(message) ? message : 'live_battle_unknown';
  return new LiveBattleServiceError(
    code,
    typeof candidate?.code === 'string' ? candidate.code : null,
  );
}

async function battleRpc(name: string, parameters: Record<string, unknown>): Promise<LiveBattle> {
  const { data, error } = await getSupabaseClient().rpc(name, parameters);
  if (error) throw normalizeRpcError(error);
  return parseLiveBattle(Array.isArray(data) ? data[0] : data);
}

export function createLiveBattleInvite(input: {
  opponentUserId: string;
  challengerSessionId: string;
  opponentSessionId: string;
}): Promise<LiveBattle> {
  return battleRpc('create_live_battle_invite', {
    p_opponent_user_id: input.opponentUserId,
    p_challenger_session_id: input.challengerSessionId,
    p_opponent_session_id: input.opponentSessionId,
  });
}

export function respondLiveBattleInvite(
  battleId: string,
  decision: LiveBattleInviteDecision,
): Promise<LiveBattle> {
  return battleRpc('respond_live_battle_invite', {
    p_battle_id: battleId,
    p_accept: decision === 'accept',
  });
}

export const startLiveBattle = (battleId: string): Promise<LiveBattle> =>
  battleRpc('start_live_battle', { p_battle_id: battleId });

export const cancelLiveBattle = (battleId: string): Promise<LiveBattle> =>
  battleRpc('cancel_live_battle', { p_battle_id: battleId });

export const completeLiveBattle = (battleId: string): Promise<LiveBattle> =>
  battleRpc('complete_live_battle', { p_battle_id: battleId });

export const getLiveBattleState = (battleId: string): Promise<LiveBattle> =>
  battleRpc('get_live_battle_state', { p_battle_id: battleId });

export function isLiveBattleUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * RLS restricts this read to Battle participants. The session filter keeps
 * discovery scoped to the host's current LIVE and the RPC remains the
 * authority for every state consumed by the runtime.
 */
export async function getOpenLiveBattlesForSession(sessionId: string): Promise<LiveBattle[]> {
  if (!isLiveBattleUuid(sessionId)) {
    throw new LiveBattleServiceError('live_battle_invalid_session_id');
  }
  const { data, error } = await getSupabaseClient()
    .from('live_battles')
    .select('*')
    .in('status', NON_TERMINAL_STATUSES)
    .or(`challenger_session_id.eq.${sessionId},opponent_session_id.eq.${sessionId}`)
    .order('updated_at', { ascending: false })
    .limit(3);
  if (error) throw normalizeRpcError(error);
  return (data ?? []).map(parseLiveBattle);
}

export async function getMyOpenLiveBattle(): Promise<LiveBattle | null> {
  const client = getSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw normalizeRpcError(authError ?? { message: 'live_battle_auth_required' });
  const userId = authData.user.id;
  const { data, error } = await client
    .from('live_battles')
    .select('*')
    .in('status', NON_TERMINAL_STATUSES)
    .or(`challenger_user_id.eq.${userId},opponent_user_id.eq.${userId}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw normalizeRpcError(error);
  return data ? parseLiveBattle(data) : null;
}

export type LiveBattleSubscription = {
  unsubscribe: () => Promise<void>;
};

export type LiveBattleSessionSignal = {
  battleId: string;
  version: number;
};

let channelSequence = 0;

export function subscribeToLiveBattle(
  battleId: string,
  onChange: (battle: LiveBattle) => void,
  onError?: (error: LiveBattleServiceError) => void,
): LiveBattleSubscription {
  const client = getSupabaseClient();
  channelSequence += 1;
  const channel = client
    .channel(`live-battle:${battleId}:${channelSequence}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'live_battles',
      filter: `id=eq.${battleId}`,
    }, (payload: { new: unknown }) => {
      try {
        onChange(parseLiveBattle(payload.new));
      } catch (error) {
        onError?.(error instanceof LiveBattleServiceError
          ? error
          : new LiveBattleServiceError('live_battle_invalid_response'));
      }
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new LiveBattleServiceError('live_battle_realtime_unavailable'));
      }
    });

  let cleanup: Promise<void> | null = null;
  return {
    unsubscribe: () => {
      cleanup ??= client.removeChannel(channel).then(() => undefined);
      return cleanup;
    },
  };
}

export function subscribeToLiveBattlesForSession(
  sessionId: string,
  onSignal: (signal: LiveBattleSessionSignal) => void,
  onError?: (error: LiveBattleServiceError) => void,
): LiveBattleSubscription {
  if (!isLiveBattleUuid(sessionId)) {
    throw new LiveBattleServiceError('live_battle_invalid_session_id');
  }
  const client = getSupabaseClient();
  const columns = ['challenger_session_id', 'opponent_session_id'] as const;
  const channels = columns.map(column => {
    channelSequence += 1;
    return client
      .channel(`live-battle-session:${channelSequence}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'live_battles',
        filter: `${column}=eq.${sessionId}`,
      }, (payload: { new: unknown; old: unknown }) => {
        try {
          const candidate = payload.new && typeof payload.new === 'object'
            && !Array.isArray(payload.new) && Object.keys(payload.new).length > 0
            ? payload.new
            : payload.old;
          const battle = parseLiveBattle(candidate);
          if (battle.challengerSessionId !== sessionId && battle.opponentSessionId !== sessionId) {
            throw new LiveBattleServiceError('live_battle_invalid_response');
          }
          onSignal({ battleId: battle.id, version: battle.version });
        } catch (error) {
          onError?.(error instanceof LiveBattleServiceError
            ? error
            : new LiveBattleServiceError('live_battle_invalid_response'));
        }
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onError?.(new LiveBattleServiceError('live_battle_realtime_unavailable'));
        }
      });
  });

  let cleanup: Promise<void> | null = null;
  return {
    unsubscribe: () => {
      cleanup ??= Promise.all(channels.map(channel => client.removeChannel(channel)))
        .then(() => undefined);
      return cleanup;
    },
  };
}
