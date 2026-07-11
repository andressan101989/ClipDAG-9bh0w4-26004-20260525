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

// Diagnostic-only logging for the "stuck on Conectando..." investigation.
// Keep normal lifecycle events out of Metro's error channel.
function logAgora(event: string, data?: Record<string, unknown>) {
  console.log(`[AGORA-DEBUG] ${event}`, data ? JSON.stringify(data) : '');
}

interface UseAgoraEngineParams {
  channelName: string | null;
  uid: number;
  role: AgoraRole;
  profile?: AgoraProfile;
  // Set to false for audio-only calls (e.g. app/call/[userId].tsx) — skips
  // enableVideo()/enableLocalVideo()/startPreview() entirely so the camera
  // is never touched (no permission prompt, no capture pipeline). Defaults
  // to true to preserve existing video-call behavior.
  enableVideo?: boolean;
}

export function useAgoraEngine({ channelName, uid, role, profile = 'communication', enableVideo = true }: UseAgoraEngineParams) {
  const engineRef   = useRef<any>(null);
  const handlersRef = useRef<any>(null);
  const mountedRef  = useRef(true);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [joined,          setJoined]          = useState(false);
  const [joining,         setJoining]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [remoteUids,      setRemoteUids]      = useState<number[]>([]);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isCameraOff,     setIsCameraOff]     = useState(role === 'subscriber' || !enableVideo);
  const [isFront,         setIsFront]         = useState(true);
  const [localVideoReady, setLocalVideoReady] = useState(false);
  // Video calls default to speaker on, audio calls default to earpiece
  // (enableVideo doubles as the video/audio-call signal here).
  const [speakerOn,       setSpeakerOn]        = useState(enableVideo);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const cleanupEngine = useCallback(() => {
    clearJoinTimeout();
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
  }, [clearJoinTimeout]);

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
      if (role === 'publisher' && enableVideo) {
        try {
          engine.enableVideo();
          engine.enableLocalVideo(true);
          engine.startPreview();
          setLocalVideoReady(true);
        } catch { /* non-fatal — onJoinChannelSuccess retries this */ }
      }

      const handlers = {
        onJoinChannelSuccess: (connection: any) => {
          clearJoinTimeout();
          let connState: unknown = 'n/a';
          try { connState = engine.getConnectionState?.(); } catch { /* ignore */ }
          logAgora('onJoinChannelSuccess', {
            channelName, uid,
            connChannelId: connection?.channelId, connLocalUid: connection?.localUid,
            connectionState: connState,
          });
          if (!mountedRef.current) return;
          setJoined(true);
          setJoining(false);
          // Backup retry — deliberately does NOT call enableVideo() again
          // (see comment above). enableLocalVideo/startPreview are cheap to
          // repeat and cover devices where the pre-join call above was a
          // no-op because the capture pipeline wasn't ready yet.
          if (role === 'publisher' && enableVideo) {
            try {
              engine.enableLocalVideo(true);
              engine.muteLocalVideoStream(false);
              engine.startPreview();
              if (mountedRef.current) setLocalVideoReady(true);
            } catch { /* ignore */ }
          }
        },
        onConnectionStateChanged: (connection: any, state: any, reason: any) => {
          logAgora('onConnectionStateChanged', {
            channelName, uid,
            connChannelId: connection?.channelId,
            state, reason,
          });
        },
        onUserJoined: (_conn: any, remoteUid: number) => {
          logAgora('onUserJoined', { channelName, uid, remoteUid });
          if (!mountedRef.current) return;
          setRemoteUids(prev => prev.includes(remoteUid) ? prev : [...prev, remoteUid]);
        },
        onUserOffline: (_conn: any, remoteUid: number, reason: any) => {
          logAgora('onUserOffline', { channelName, uid, remoteUid, reason });
          if (!mountedRef.current) return;
          setRemoteUids(prev => prev.filter(u => u !== remoteUid));
        },
        onError: (code: number, msg?: string) => {
          clearJoinTimeout();
          console.error('[AGORA-DEBUG] onError', JSON.stringify({
            channelName, uid, code, message: msg ?? '(none)',
          }));
          if (!mountedRef.current) return;
          setError(`Error Agora (${code}): ${msg ?? ''}`);
          setJoined(false);
          setJoining(false);
        },
      };
      handlersRef.current = handlers;
      engine.registerEventHandler(handlers);

      engine.enableAudio();
      try { engine.setEnableSpeakerphone(enableVideo); } catch { /* ignore */ }

      if (profile === 'live-broadcasting') {
        engine.setClientRole(
          role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        );
      }
      if (role === 'subscriber') {
        engine.enableLocalVideo(false);
        engine.enableLocalAudio(false);
      } else if (!enableVideo) {
        // Audio-only publisher (e.g. voice call) — never touch the camera.
        try { engine.enableLocalVideo(false); } catch { /* ignore */ }
      }

      logAgora('pre-joinChannel', {
        channelName, uid, tokenLength: token?.length ?? 0, appId: resolvedAppId,
      });

      clearJoinTimeout();
      joinTimeoutRef.current = setTimeout(() => {
        logAgora('join timeout', {
          channelName, uid, tokenLength: token?.length ?? 0,
        });
        if (!mountedRef.current) return;
        setJoining(false);
        setError('Agora join timeout');
      }, 15_000);

      const joinResult = engine.joinChannel(token, channelName, uid, {
        clientRoleType: profile === 'live-broadcasting'
          ? (role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience)
          : undefined,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });

      logAgora('joinChannel return', {
        joinResult, channelName, uid, tokenLength: token?.length ?? 0,
      });

      if (typeof joinResult === 'number' && joinResult < 0) {
        clearJoinTimeout();
        logAgora('joinChannel failed immediately', {
          joinResult, channelName, uid, tokenLength: token?.length ?? 0,
        });
        if (mountedRef.current) {
          setJoining(false);
          setJoined(false);
          setError(`Agora joinChannel failed (${joinResult})`);
        }
      }
    } catch (e: any) {
      clearJoinTimeout();
      if (mountedRef.current) {
        setError(e?.message ?? 'No se pudo conectar la llamada');
        setJoined(false);
        setJoining(false);
      }
      cleanupEngine();
    }
  }, [channelName, uid, role, profile, enableVideo, joining, joined, cleanupEngine, clearJoinTimeout]);

  useEffect(() => () => { cleanupEngine(); }, [cleanupEngine]);

  const toggleSpeaker = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setSpeakerOn(prev => {
      const next = !prev;
      try { engine.setEnableSpeakerphone(next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const promoteToPublisher = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || profile !== 'live-broadcasting') return false;
    try {
      if (channelName) {
        const { token } = await fetchAgoraToken(channelName, uid, 'publisher');
        try { engine.renewToken(token); } catch { /* setClientRole may still work if the current token allows publishing */ }
      }
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableAudio();
      if (enableVideo) {
        engine.enableVideo();
        engine.enableLocalVideo(true);
        engine.muteLocalVideoStream(false);
        engine.startPreview();
      }
      engine.enableLocalAudio(true);
      engine.muteLocalAudioStream(false);
      if (mountedRef.current) {
        setIsMuted(false);
        setIsCameraOff(!enableVideo);
        setLocalVideoReady(enableVideo);
      }
      return true;
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message ?? 'No se pudo subir al streaming');
      return false;
    }
  }, [channelName, uid, profile, enableVideo]);

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

  const demoteToAudience = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || profile !== 'live-broadcasting') return false;
    try {
      try { engine.muteLocalAudioStream(true); } catch { /* ignore */ }
      try { engine.muteLocalVideoStream(true); } catch { /* ignore */ }
      try { engine.enableLocalVideo(false); } catch { /* ignore */ }
      try { engine.stopPreview?.(); } catch { /* ignore */ }
      try { engine.setClientRole(ClientRoleType.ClientRoleAudience); } catch { /* ignore */ }

      if (mountedRef.current) {
        setIsMuted(true);
        setIsCameraOff(true);
        setLocalVideoReady(false);
      }
      return true;
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message ?? 'No se pudo bajar del live');
      return false;
    }
  }, [profile]);

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
    isMuted, isCameraOff, isFront, speakerOn,
    localVideoReady,
    join, leave,
    toggleMute, toggleCamera, switchCamera, toggleSpeaker, promoteToPublisher, demoteToAudience,
  };
}
