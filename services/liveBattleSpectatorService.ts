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

export type LiveBattleServerClockAnchor = {
  serverEpochMsAtAnchor: number;
  monotonicMsAtAnchor: number;
  roundTripMs: number;
};

export type LiveBattlePublicSnapshot = {
  serverNow: string;
  state: LiveBattlePublicState | null;
  clockAnchor: LiveBattleServerClockAnchor | null;
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

function timestamp(value: unknown, field: string, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== 'string' || value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new LiveBattleSpectatorError(`live_battle_public_invalid_${field}`);
  }
  return value;
}

export function readLiveBattleMonotonicNow(): number | null {
  const value = globalThis.performance?.now?.();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createLiveBattleServerClockAnchor(
  serverNow: string,
  requestStartedAt: number | null,
  responseReceivedAt: number | null,
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
  return {
    serverEpochMsAtAnchor: serverEpochMs + roundTripMs / 2,
    monotonicMsAtAnchor: responseReceivedAt,
    roundTripMs,
  };
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
    return next.version > current.version ? next : current;
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
    ),
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

  const handleUpsert = (payload: { new?: unknown }) => {
    if (disposed) return;
    mutationSequence += 1;
    try {
      const next = parseLiveBattlePublicState(payload.new);
      if (next.sessionId !== sessionId) {
        throw new LiveBattleSpectatorError('live_battle_public_session_mismatch');
      }
      publish(next);
    } catch (error) {
      onError?.(normalizeError(error));
    }
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
    mutationSequence += 1;
    void reconcile();
  };

  const channel = client
    .channel(`live-battle-public:${sessionId}:${channelSequence}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'live_battle_public_states',
      filter: `session_id=eq.${sessionId}`,
    }, handleUpsert)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'live_battle_public_states',
      filter: `session_id=eq.${sessionId}`,
    }, handleUpsert)
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'live_battle_public_states',
    }, handleDelete)
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new LiveBattleSpectatorError('live_battle_public_realtime_unavailable'));
      }
    });

  void reconcile();

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

export function isLiveBattleStageStatus(status: LiveBattlePublicStatus): boolean {
  return status === 'countdown' || status === 'active';
}
