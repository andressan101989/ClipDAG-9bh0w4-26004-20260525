/**
 * services/agoraService.ts  — Web stub
 *
 * react-native-agora uses native-only codegenNativeComponent which cannot be
 * bundled for web. This stub exports the same surface as agoraService.native.ts
 * but with no-op implementations so web builds never import the native module.
 *
 * Metro resolves .native.ts on iOS/Android before .ts, so this file is only
 * loaded on web.
 */
import { getSupabaseClient } from '@/template';

export const isAgoraAvailable = (): boolean => false;

export const createAgoraRtcEngine: (() => any) | null = null;
export const RtcSurfaceView: any                      = null;
export const ChannelProfileType: any                  = {};
export const ClientRoleType: any                      = {};
export const RenderModeType: any                      = {};
export const VideoSourceType: any                     = {};
export const AudioSessionOperationRestriction: any    = {};
export const ConnectionStateType: any                 = {};

export function getAgoraAppId(): string {
  return process.env.EXPO_PUBLIC_AGORA_APP_ID ?? '';
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useridToAgoraUid(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return (hash % 2147483647) + 1;
}

export interface AgoraTokenResponse {
  token: string;
  appId: string;
  channel: string;
  uid: number;
}

export type LiveRequestedRole = 'host' | 'viewer' | 'cohost';

export type AgoraTokenResource =
  | { callId: string }
  | { groupRoomId: string }
  | { liveSessionId: string; requestedRole: LiveRequestedRole };

export type AgoraTokenErrorCode =
  | `token_http_${number}`
  | 'token_live_session_missing'
  | 'token_live_not_joinable'
  | 'token_cohost_not_authorized';

export class AgoraTokenRequestError extends Error {
  readonly code: AgoraTokenErrorCode;
  readonly status?: number;

  constructor(message: string, code: AgoraTokenErrorCode, status?: number) {
    super(message);
    this.name = 'AgoraTokenRequestError';
    this.code = code;
    this.status = status;
  }
}

function assertSingleAgoraResource(resource: AgoraTokenResource): void {
  const value = resource as Record<string, unknown>;
  const resourceCount = ['callId', 'groupRoomId', 'liveSessionId']
    .filter(key => typeof value[key] === 'string' && value[key] !== '').length;
  if (resourceCount !== 1) {
    throw new AgoraTokenRequestError(
      'No pudimos conectar la llamada. Inténtalo nuevamente.',
      'token_http_400',
      400,
    );
  }
}

async function toAgoraTokenRequestError(
  error: any,
  resource: AgoraTokenResource,
): Promise<AgoraTokenRequestError> {
  const context = error?.context;
  const status = typeof context?.status === 'number' ? context.status : undefined;
  let backendError = '';
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.error === 'string') backendError = body.error;
    } catch {
      // An unreadable response remains a sanitized HTTP error.
    }
  }

  if (backendError === 'live session not found') {
    return new AgoraTokenRequestError('Este LIVE ya no está disponible.', 'token_live_session_missing', status);
  }
  if (backendError === 'live session is not joinable') {
    return new AgoraTokenRequestError('Este LIVE ya no está disponible.', 'token_live_not_joinable', status);
  }
  if (backendError === 'cohost is not authorized' || backendError === 'cohost is not active') {
    return new AgoraTokenRequestError(
      'No tienes autorización para transmitir como invitado.',
      'token_cohost_not_authorized',
      status,
    );
  }
  return new AgoraTokenRequestError(
    'liveSessionId' in resource
      ? 'No pudimos conectar el LIVE. Inténtalo nuevamente.'
      : 'No pudimos conectar la llamada. Inténtalo nuevamente.',
    `token_http_${status ?? 500}`,
    status,
  );
}

export async function fetchAgoraToken(
  resource: AgoraTokenResource,
): Promise<AgoraTokenResponse> {
  assertSingleAgoraResource(resource);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('agora-token', {
    body: resource,
  });
  if (error) throw await toAgoraTokenRequestError(error, resource);
  if (!data?.token || !data?.channel || !Number.isInteger(data?.uid) || data.uid <= 0) {
    throw new Error('Respuesta invalida del servidor de tokens');
  }
  return data as AgoraTokenResponse;
}
