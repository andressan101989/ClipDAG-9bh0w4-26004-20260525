import { getSupabaseClient } from '@/template';

export type LiveBattleRelayState =
  | 'idle'
  | 'authorizing'
  | 'connecting'
  | 'recovering'
  | 'running'
  | 'stopping'
  | 'failed';

export interface LiveBattleRelayEndpoint {
  liveSessionId: string;
  channel: string;
  uid: number;
  token: string;
  expiresAt?: string;
}

export interface LiveBattleRelayCredentials {
  appId: string;
  battleRelay: {
    battleId: string;
    source: LiveBattleRelayEndpoint;
    destination: LiveBattleRelayEndpoint;
    expiresIn: number;
    issuedAt?: string;
  };
}

export interface LiveBattleRelaySnapshot {
  state: LiveBattleRelayState;
  battleId: string | null;
  errorCode: string | null;
  relayCode: number | null;
}

export class LiveBattleRelayError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
    public readonly relayCode?: number,
  ) {
    super(code);
    this.name = 'LiveBattleRelayError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseEndpoint(value: unknown, kind: 'source' | 'destination'): LiveBattleRelayEndpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  const endpoint = value as Record<string, unknown>;
  const uidIsValid = kind === 'source'
    ? endpoint.uid === 0
    : Number.isSafeInteger(endpoint.uid) && Number(endpoint.uid) > 0;
  if (!requiredUuid(endpoint.liveSessionId)
    || endpoint.channel !== endpoint.liveSessionId
    || !uidIsValid
    || typeof endpoint.token !== 'string'
    || endpoint.token.length === 0) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  const expiresAt = endpoint.expiresAt === undefined
    ? null
    : typeof endpoint.expiresAt === 'string' && Number.isFinite(Date.parse(endpoint.expiresAt))
      ? endpoint.expiresAt
      : null;
  if (endpoint.expiresAt !== undefined && expiresAt === null) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  return expiresAt === null
    ? endpoint as unknown as LiveBattleRelayEndpoint
    : { ...(endpoint as unknown as LiveBattleRelayEndpoint), expiresAt };
}

export function parseLiveBattleRelayCredentials(
  value: unknown,
  expectedBattleId: string,
): LiveBattleRelayCredentials {
  if (!requiredUuid(expectedBattleId)
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  const response = value as Record<string, unknown>;
  const relayValue = response.battleRelay;
  if (typeof response.appId !== 'string' || response.appId.length === 0
    || !relayValue || typeof relayValue !== 'object' || Array.isArray(relayValue)) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  const relay = relayValue as Record<string, unknown>;
  const source = parseEndpoint(relay.source, 'source');
  const destination = parseEndpoint(relay.destination, 'destination');
  const issuedAt = relay.issuedAt === undefined
    ? null
    : typeof relay.issuedAt === 'string' && Number.isFinite(Date.parse(relay.issuedAt))
      ? relay.issuedAt
      : null;
  if (relay.battleId !== expectedBattleId
    || source.liveSessionId === destination.liveSessionId
    || source.channel === destination.channel
    || !Number.isSafeInteger(relay.expiresIn)
    || Number(relay.expiresIn) <= 0
    || Number(relay.expiresIn) > 360
    || (relay.issuedAt !== undefined && issuedAt === null)
    || ((source.expiresAt !== undefined || destination.expiresAt !== undefined) && issuedAt === null)
    || (issuedAt !== null && (
      source.expiresAt === undefined || destination.expiresAt === undefined
      || Date.parse(source.expiresAt) <= Date.parse(issuedAt)
      || Date.parse(destination.expiresAt) <= Date.parse(issuedAt)
    ))) {
    throw new LiveBattleRelayError('battle_relay_invalid_response');
  }
  return {
    appId: response.appId,
    battleRelay: {
      battleId: expectedBattleId,
      source,
      destination,
      expiresIn: Number(relay.expiresIn),
      ...(issuedAt === null ? {} : { issuedAt }),
    },
  };
}

async function normalizeRelayRequestError(error: unknown): Promise<LiveBattleRelayError> {
  const candidate = error && typeof error === 'object'
    ? error as { context?: { status?: unknown; json?: () => Promise<unknown> } }
    : null;
  const status = typeof candidate?.context?.status === 'number'
    ? candidate.context.status
    : undefined;
  let backendError = '';
  if (typeof candidate?.context?.json === 'function') {
    try {
      const body = await candidate.context.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const value = (body as Record<string, unknown>).error;
        if (typeof value === 'string') backendError = value;
      }
    } catch {
      // Keep the response sanitized when the body is unreadable.
    }
  }
  if (backendError === 'battle relay not found') {
    return new LiveBattleRelayError('battle_relay_not_found', status);
  }
  if (backendError === 'battle relay not authorized') {
    return new LiveBattleRelayError('battle_relay_not_authorized', status);
  }
  return new LiveBattleRelayError(`battle_relay_http_${status ?? 500}`, status);
}

export async function requestLiveBattleRelayCredentials(
  liveBattleId: string,
): Promise<LiveBattleRelayCredentials> {
  if (!requiredUuid(liveBattleId)) {
    throw new LiveBattleRelayError('battle_relay_invalid_battle_id');
  }
  const { data, error } = await getSupabaseClient().functions.invoke('agora-token', {
    body: { liveBattleId },
  });
  if (error) throw await normalizeRelayRequestError(error);
  return parseLiveBattleRelayCredentials(data, liveBattleId);
}
