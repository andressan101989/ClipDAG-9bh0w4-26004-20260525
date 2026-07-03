/**
 * services/agoraService.native.ts  — iOS + Android only
 *
 * Central, guarded access point for the react-native-agora native module.
 * Mirrors the require()-in-try/catch pattern already used for
 * react-native-webrtc (see app/videocall/[userId].tsx) so the app doesn't
 * crash on web / Expo Go, where the native module isn't available.
 *
 * Metro resolves this file over the plain agoraService.ts on iOS/Android;
 * the plain .ts file is the web-safe no-op stub.
 */
import { getSupabaseClient } from '@/template';

let AgoraModule: any = null;
try {
  AgoraModule = require('react-native-agora');
} catch {
  /* Expo Go / native module not linked */
}

export const isAgoraAvailable = (): boolean => !!AgoraModule?.createAgoraRtcEngine;

export const createAgoraRtcEngine: (() => any) | null = AgoraModule?.createAgoraRtcEngine ?? null;
export const RtcSurfaceView: any                      = AgoraModule?.RtcSurfaceView ?? null;
export const ChannelProfileType: any                  = AgoraModule?.ChannelProfileType ?? {};
export const ClientRoleType: any                      = AgoraModule?.ClientRoleType ?? {};
export const RenderModeType: any                      = AgoraModule?.RenderModeType ?? {};
export const VideoSourceType: any                     = AgoraModule?.VideoSourceType ?? {};

export function getAgoraAppId(): string {
  return process.env.EXPO_PUBLIC_AGORA_APP_ID ?? '';
}

// ── UUID v4 generator ────────────────────────────────────────────────────────
// Used for callId / roomId / streamId — the latter two are inserted as the
// `id` of uuid-typed Postgres columns, so the format must be valid UUID v4.
// Math.random() is sufficient here: these ids only need to be unique, not
// cryptographically unguessable.
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Deterministic string-uuid → uint32 mapping ──────────────────────────────
// Agora RTC uids are 32-bit integers. Our user ids are UUID strings, so we
// hash them into a stable, non-zero uint32 (0 is reserved for "auto-assign").
export function useridToAgoraUid(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return (hash % 2147483647) + 1;
}

// ── Token fetch ──────────────────────────────────────────────────────────────
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
