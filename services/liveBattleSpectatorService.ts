import { getSupabaseClient } from '@/template';

export const LIVE_BATTLE_PUBLIC_STATUSES = [
  'countdown',
  'active',
  'completed',
  'cancelled',
] as const;

export type LiveBattlePublicStatus = typeof LIVE_BATTLE_PUBLIC_STATUSES[number];

export type LiveBattlePublicState = {
  sessionId: string;
  battleId: string;
  opponentSessionId: string;
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
};

type LiveBattlePublicStateRow = {
  session_id: unknown;
  battle_id: unknown;
  opponent_session_id: unknown;
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
};

export type LiveBattleSpectatorSubscription = {
  unsubscribe: () => Promise<void>;
};

export class LiveBattleSpectatorError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LiveBattleSpectatorError';
  }
}

const PUBLIC_STATUS_SET = new Set<string>(LIVE_BATTLE_PUBLIC_STATUSES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGORA_UID = 2_147_483_647;
const SELECT_COLUMNS = [
  'session_id',
  'battle_id',
  'opponent_session_id',
  'local_host_user_id',
  'opponent_host_user_id',
  'local_host_agora_uid',
  'opponent_host_agora_uid',
  'status',
  'version',
  'scheduled_start_at',
  'started_at',
  'scheduled_end_at',
  'ended_at',
  'updated_at',
].join(',');

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

function timestamp(value: unknown, field: string, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== 'string' || value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return value;
}

export function parseLiveBattlePublicState(value: unknown): LiveBattlePublicState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_response');
  }
  const row = value as LiveBattlePublicStateRow;
  const sessionId = requiredUuid(row.session_id, 'session_id');
  const opponentSessionId = requiredUuid(row.opponent_session_id, 'opponent_session_id');
  const localHostUserId = requiredUuid(row.local_host_user_id, 'local_host_user_id');
  const opponentHostUserId = requiredUuid(row.opponent_host_user_id, 'opponent_host_user_id');
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

  return {
    sessionId,
    battleId: requiredUuid(row.battle_id, 'battle_id'),
    opponentSessionId,
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
  };
}

export function reduceLiveBattlePublicState(
  current: LiveBattlePublicState | null,
  next: LiveBattlePublicState,
): LiveBattlePublicState | null {
  if (!current) return next;
  if (current.battleId === next.battleId) {
    return next.version > current.version ? next : current;
  }
  return Date.parse(next.updatedAt) > Date.parse(current.updatedAt) ? next : current;
}

function normalizeError(error: unknown): LiveBattleSpectatorError {
  if (error instanceof LiveBattleSpectatorError) return error;
  return new LiveBattleSpectatorError('live_battle_public_unavailable');
}

export async function getLiveBattlePublicState(
  sessionId: string,
): Promise<LiveBattlePublicState | null> {
  if (!isLiveBattleSpectatorUuid(sessionId)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_session_id');
  }
  const { data, error } = await getSupabaseClient()
    .from('live_battle_public_states')
    .select(SELECT_COLUMNS)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw normalizeError(error);
  if (!data) return null;
  const state = parseLiveBattlePublicState(data);
  if (state.sessionId !== sessionId) {
    throw new LiveBattleSpectatorError('live_battle_public_session_mismatch');
  }
  return state;
}

let channelSequence = 0;

export function subscribeToLiveBattlePublicState(
  sessionId: string,
  onChange: (state: LiveBattlePublicState | null) => void,
  onError?: (error: LiveBattleSpectatorError) => void,
): LiveBattleSpectatorSubscription {
  if (!isLiveBattleSpectatorUuid(sessionId)) {
    throw new LiveBattleSpectatorError('live_battle_public_invalid_session_id');
  }
  const client = getSupabaseClient();
  let current: LiveBattlePublicState | null = null;
  let disposed = false;
  let receivedRealtime = false;
  channelSequence += 1;

  const publish = (next: LiveBattlePublicState) => {
    const reduced = reduceLiveBattlePublicState(current, next);
    if (reduced === current) return;
    current = reduced;
    onChange(current);
  };

  const channel = client
    .channel(`live-battle-public:${sessionId}:${channelSequence}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'live_battle_public_states',
      filter: `session_id=eq.${sessionId}`,
    }, (payload: { eventType?: string; new?: unknown; old?: unknown }) => {
      if (disposed) return;
      receivedRealtime = true;
      try {
        if (payload.eventType === 'DELETE') {
          const removed = parseLiveBattlePublicState(payload.old);
          if (removed.sessionId !== sessionId) {
            throw new LiveBattleSpectatorError('live_battle_public_session_mismatch');
          }
          if (current?.battleId === removed.battleId && current.version <= removed.version) {
            current = null;
            onChange(null);
          }
          return;
        }
        const next = parseLiveBattlePublicState(payload.new);
        if (next.sessionId !== sessionId) {
          throw new LiveBattleSpectatorError('live_battle_public_session_mismatch');
        }
        publish(next);
      } catch (error) {
        onError?.(normalizeError(error));
      }
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new LiveBattleSpectatorError('live_battle_public_realtime_unavailable'));
      }
    });

  void getLiveBattlePublicState(sessionId)
    .then(snapshot => {
      if (disposed) return;
      if (snapshot) publish(snapshot);
      else if (!receivedRealtime && current === null) onChange(null);
    })
    .catch(error => {
      if (!disposed) onError?.(normalizeError(error));
    });

  let cleanup: Promise<void> | null = null;
  return {
    unsubscribe: () => {
      disposed = true;
      cleanup ??= client.removeChannel(channel).then(() => undefined);
      return cleanup;
    },
  };
}

export function isLiveBattleStageStatus(status: LiveBattlePublicStatus): boolean {
  return status === 'countdown' || status === 'active';
}
