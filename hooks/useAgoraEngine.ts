/**
 * hooks/useAgoraEngine.ts  — Web stub
 *
 * No-op implementation of useAgoraEngine for web builds.
 * Metro resolves .native.ts first on iOS/Android, so this file is
 * only loaded on web where react-native-agora is not available.
 */

export type AgoraRole    = 'publisher' | 'subscriber';
export type AgoraProfile = 'communication' | 'live-broadcasting';

interface UseAgoraEngineParams {
  channelName: string | null;
  uid: number;
  role: AgoraRole;
  profile?: AgoraProfile;
  enableVideo?: boolean;
  callId?: string;
}

export function useAgoraEngine(_params: UseAgoraEngineParams) {
  return {
    engineReady: false,
    joined:      false,
    joining:     false,
    error:       'Agora is not available on web',
    remoteUids:  [] as number[],
    isMuted:     false,
    isCameraOff: false,
    isFront:     true,
    speakerOn:   false,
    localVideoReady: false,
    join:        async () => {},
    leave:       async () => {},
    toggleMute:  () => {},
    toggleCamera: () => {},
    switchCamera: () => {},
    toggleSpeaker: () => {},
    promoteToPublisher: async () => false,
  };
}
