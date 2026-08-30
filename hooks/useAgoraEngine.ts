/**
 * hooks/useAgoraEngine.ts  — Web stub
 *
 * No-op implementation of useAgoraEngine for web builds.
 * Metro resolves .native.ts first on iOS/Android, so this file is
 * only loaded on web where react-native-agora is not available.
 */

export type AgoraRole    = 'publisher' | 'subscriber';
export type AgoraProfile = 'communication' | 'live-broadcasting';
export type LiveRequestedRole = 'host' | 'viewer' | 'cohost';

interface UseAgoraEngineParams {
  channelName: string | null;
  uid: number;
  role: AgoraRole;
  profile?: AgoraProfile;
  enableVideo?: boolean;
  callId?: string;
  liveSessionId?: string;
  liveRequestedRole?: LiveRequestedRole;
}

export function useAgoraEngine(_params: UseAgoraEngineParams) {
  return {
    engineReady: false,
    joined:      false,
    joining:     false,
    error:       'Agora is not available on web',
    errorCode:   null as string | null,
    remoteUids:  [] as number[],
    reconnectEpoch: 0,
    isMuted:     false,
    isCameraOff: false,
    isFront:     true,
    speakerOn:   false,
    localVideoReady: false,
    getEngine:   () => null,
    registerBeforeEngineRelease: (_listener: (engine: unknown) => void) => () => undefined,
    join:        async () => {},
    leave:       async () => {},
    toggleMute:  () => {},
    toggleCamera: () => {},
    switchCamera: () => {},
    toggleSpeaker: () => {},
    promoteToPublisher: async () => false,
  };
}
