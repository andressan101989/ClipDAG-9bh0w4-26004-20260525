/**
 * services/agoraService.native.ts  — iOS + Android only
 *
 * Central access point for the react-native-agora native module.
 * The .native.ts suffix ensures this file is NEVER bundled for web.
 */
import { getSupabaseClient } from '@/template';
import {
  createAgoraRtcEngine as _createEngine,
  RtcSurfaceView as _RtcSurfaceView,
  ChannelProfileType as _ChannelProfileType,
  ClientRoleType as _ClientRoleType,
  RenderModeType as _RenderModeType,
  VideoSourceType as _VideoSourceType,
} from 'react-native-agora';

export const isAgoraAvailable = (): boolean => true;

export const createAgoraRtcEngine = _createEngine;
export const RtcSurfaceView       = _RtcSurfaceView;
export const ChannelProfileType   = _ChannelProfileType;
export const ClientRoleType       = _ClientRoleType;
export const RenderModeType       = _RenderModeType;
export const VideoSourceType      = _VideoSourceType;

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
}

export async function fetchAgoraToken(
  channelName: string,
  uid: number,
  role: 'publisher' | 'subscriber' = 'publisher',
): Promise<AgoraTokenResponse> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('agora-token', {
    body: { channelName, uid, role },
  });
  if (error) throw new Error(error.message || 'No se pudo obtener el token de Agora');
  if (!data?.token) throw new Error('Respuesta invalida del servidor de tokens');
  return data as AgoraTokenResponse;
}
