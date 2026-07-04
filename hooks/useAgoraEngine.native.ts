/**
 * hooks/useAgoraEngine.native.ts  — iOS + Android only
 *
 * Full Agora RTC engine lifecycle hook. The .native.ts suffix keeps this
 * file out of web bundles entirely.
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

  const [joined,          setJoined]          = useState(false);
  const [joining,         setJoining]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [remoteUids,      setRemoteUids]      = useState<number[]>([]);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isCameraOff,     setIsCameraOff]     = useState(role === 'subscriber');
  const [isFront,         setIsFront]         = useState(true);
  const [localVideoReady, setLocalVideoReady] = useState(false);

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
      setLocalVideoReady(false);
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

      // Fix: black local video on join. enableVideo() must run exactly once,
      // before joinChannel() — calling it again after the channel is joined
      // resets the video module instead of confirming it, which is what
      // caused the intermittent black screen. enableLocalVideo(true) +
      // startPreview() are safe to re-run (see onJoinChannelSuccess below)
      // and are what actually (re)start frame capture.
      if (role === 'publisher') {
        try {
          engine.enableVideo();
          engine.enableLocalVideo(true);
          engine.startPreview();
          setLocalVideoReady(true);
        } catch { /* non-fatal — onJoinChannelSuccess retries this */ }
      }

      const handlers = {
        onJoinChannelSuccess: () => {
          if (!mountedRef.current) return;
          setJoined(true);
          setJoining(false);
          // Backup retry — deliberately does NOT call enableVideo() again
          // (see comment above). enableLocalVideo/startPreview are cheap to
          // repeat and cover devices where the pre-join call above was a
          // no-op because the capture pipeline wasn't ready yet.
          if (role === 'publisher') {
            try {
              engine.enableLocalVideo(true);
              engine.muteLocalVideoStream(false);
              engine.startPreview();
              if (mountedRef.current) setLocalVideoReady(true);
            } catch { /* ignore */ }
          }
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
      try {
        engine.muteLocalVideoStream(next);
        // Turning the camera back ON — muteLocalVideoStream(false) alone
        // doesn't reliably resume frames once capture has been muted for a
        // while; re-enable and restart the capture pipeline explicitly.
        if (prev) {
          engine.enableLocalVideo(true);
          engine.startPreview();
        }
      } catch { /* ignore */ }
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
    localVideoReady,
    join, leave,
    toggleMute, toggleCamera, switchCamera,
  };
}
