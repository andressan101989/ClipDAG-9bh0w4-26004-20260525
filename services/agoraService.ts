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

export async function fetchAgoraToken(
  resource: { callId: string } | { groupRoomId: string },
): Promise<AgoraTokenResponse> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('agora-token', {
    body: resource,
  });
  if (error) throw new Error(error.message || 'No se pudo obtener el token de Agora');
  if (!data?.token || !data?.channel || !Number.isInteger(data?.uid) || data.uid <= 0) {
    throw new Error('Respuesta invalida del servidor de tokens');
  }
  return data as AgoraTokenResponse;
}
