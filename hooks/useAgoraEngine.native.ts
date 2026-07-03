/**
 * hooks/useAgoraEngine.native.ts
 *
 * Shared Agora RTC engine lifecycle hook used by the 1:1 call, group call,
 * and live streaming screens. Handles: token fetch, engine init, join/leave,
 * remote user tracking, and local mute/camera/flip controls.
 *
 * iOS/Android only — Metro resolves this file over the plain useAgoraEngine.ts
 * on native platforms. The plain .ts file is a web-safe no-op stub, since
 * react-native-agora is not available on web.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAgoraRtcEngine, ChannelProfileType, ClientRoleType,
  isAgoraAvailable, fetchAgoraToken, getAgoraAppId,
} from '@/services/agoraService';

export type AgoraRole    = 'publisher' | 'subscriber';
export type AgoraProfile = 'communication' | 'live-broadcasting';

interface UseAgoraEngineParams {
  channelName: string | null;
  uid: number;
  role: AgoraRole;
  profile?: AgoraProfile;
}

export function useAgoraEngine({ channelName, uid, role, profile = 'communication' }: UseAgoraEngineParams) {
  const engineRef   = useRef<any>(null);
  const handlersRef = useRef<any>(null);
  const mountedRef  = useRef(true);

  const [joined,      setJoined]      = useState(false);
  const [joining,     setJoining]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [remoteUids,  setRemoteUids]  = useState<number[]>([]);
  const [isMuted,     setIsMuted]     = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(role === 'subscriber');
  const [isFront,     setIsFront]     = useState(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const cleanupEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) {
      try {
        if (handlersRef.current) engine.unregisterEventHandler(handlersRef.current);
        engine.leaveChannel();
        engine.release();
      } catch { /* ignore */ }
    }
    handlersRef.current = null;
  }, []);

  const leave = useCallback(async () => {
    cleanupEngine();
    if (mountedRef.current) {
      setJoined(false);
      setJoining(false);
      setRemoteUids([]);
    }
  }, [cleanupEngine]);

  const join = useCallback(async () => {
    if (!isAgoraAvailable() || !channelName || joining || joined) return;
    setJoining(true);
    setError(null);

    try {
      const { token, appId } = await fetchAgoraToken(channelName, uid, role);
      const resolvedAppId = appId || getAgoraAppId();

      const engine = createAgoraRtcEngine!();
      engineRef.current = engine;

      engine.initialize({
        appId: resolvedAppId,
        channelProfile: profile === 'live-broadcasting'
          ? ChannelProfileType.ChannelProfileLiveBroadcasting
          : ChannelProfileType.ChannelProfileCommunication,
      });

      const handlers = {
        onJoinChannelSuccess: () => {
          if (!mountedRef.current) return;
          setJoined(true);
          setJoining(false);
        },
        onUserJoined: (_conn: any, remoteUid: number) => {
          if (!mountedRef.current) return;
          setRemoteUids(prev => prev.includes(remoteUid) ? prev : [...prev, remoteUid]);
        },
        onUserOffline: (_conn: any, remoteUid: number) => {
          if (!mountedRef.current) return;
          setRemoteUids(prev => prev.filter(u => u !== remoteUid));
        },
        onError: (code: number, msg?: string) => {
          if (!mountedRef.current) return;
          setError(`Error Agora (${code}): ${msg ?? ''}`);
          setJoining(false);
        },
      };
      handlersRef.current = handlers;
      engine.registerEventHandler(handlers);

      engine.enableVideo();
      engine.enableAudio();

      if (profile === 'live-broadcasting') {
        engine.setClientRole(
          role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        );
      }
      if (role === 'subscriber') {
        engine.enableLocalVideo(false);
        engine.enableLocalAudio(false);
      }

      engine.joinChannel(token, channelName, uid, {
        clientRoleType: profile === 'live-broadcasting'
          ? (role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience)
          : undefined,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message ?? 'No se pudo conectar la llamada');
        setJoining(false);
      }
      cleanupEngine();
    }
  }, [channelName, uid, role, profile, joining, joined, cleanupEngine]);

  // Guaranteed cleanup on unmount
  useEffect(() => () => { cleanupEngine(); }, [cleanupEngine]);

  const toggleMute = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setIsMuted(prev => {
      const next = !prev;
      try { engine.muteLocalAudioStream(next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setIsCameraOff(prev => {
      const next = !prev;
      try { engine.muteLocalVideoStream(next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const switchCamera = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    try { engine.switchCamera(); } catch { /* ignore */ }
    setIsFront(prev => !prev);
  }, []);

  return {
    engineReady: isAgoraAvailable(),
    joined, joining, error,
    remoteUids,
    isMuted, isCameraOff, isFront,
    join, leave,
    toggleMute, toggleCamera, switchCamera,
  };
}
