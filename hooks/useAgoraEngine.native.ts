/**
 * hooks/useAgoraEngine.native.ts  — iOS + Android only
 *
 * Full Agora RTC engine lifecycle hook. The .native.ts suffix keeps this
 * file out of web bundles entirely.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  createAgoraRtcEngine, ChannelProfileType, ClientRoleType,
  isAgoraAvailable, fetchAgoraToken, getAgoraAppId, AudioSessionOperationRestriction,
  ConnectionStateType,
} from '@/services/agoraService';
import type { AgoraTokenResource, LiveRequestedRole } from '@/services/agoraService';
import { applyPendingAgoraCallMute, registerActiveCallAudioController } from '@/services/callAudioControlService';
import { getNativeStateStrict, onAudioSessionActivated, setCallKitSpeakerEnabled } from '@/services/iosCallKitService';

export type AgoraRole    = 'publisher' | 'subscriber';
export type AgoraProfile = 'communication' | 'live-broadcasting';

// Diagnostic-only logging for the "stuck on Conectando..." investigation.
// Keep normal lifecycle events out of Metro's error channel.
function logAgora(event: string, data?: Record<string, unknown>) {
  if (event.startsWith('video:')) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(`[LIVE-BATTLE-VIDEO] ${event.slice(6)}`, data);
    return;
  }
  console.log(`[AGORA-DEBUG] ${event}`, data ? JSON.stringify(data) : '');
}

function shortJoinKey(channelName: string, uid: number): string {
  return `${channelName.slice(-8)}:${uid}`;
}

function shortStoredJoinKey(joinKey: string | null): string | null {
  if (!joinKey) return null;
  const separator = joinKey.lastIndexOf(':');
  return separator < 0
    ? joinKey.slice(-20)
    : shortJoinKey(joinKey.slice(0, separator), Number(joinKey.slice(separator + 1)));
}

// Invalid-token means the active connection cannot be trusted. Token expiry
// (109) and other SDK notifications remain recoverable warnings here; this
// hook must not terminate an established backend call for a warning.
const ACTIVE_CONNECTION_FATAL_ERROR_CODES = new Set([110]);

// Observed relay reconfiguration takes <1 s. Bound retention to 1.5 s,
// including 0.5 s scheduling tolerance; never conceal a lasting disconnect.
export const REMOTE_VIDEO_TRANSITION_GRACE_MS = 1_500;

type RemoteVideoAuthority = { scopeKey: string; remoteUid: number };
function logVideo(event: string, uid: number, scope?: string, reason?: string): void {
  logAgora(`video:${event}`, {
    uid, scope: scope?.slice(-8) ?? null, reason, durationMs: REMOTE_VIDEO_TRANSITION_GRACE_MS,
  });
}

export function classifyAgoraError(code: number, joined: boolean): 'join_fatal' | 'connection_fatal' | 'connection_warning' {
  if (!joined) return 'join_fatal';
  return ACTIVE_CONNECTION_FATAL_ERROR_CODES.has(code) ? 'connection_fatal' : 'connection_warning';
}

interface UseAgoraEngineParams {
  remoteVideoAuthority?: RemoteVideoAuthority | null;
  channelName: string | null;
  uid: number;
  role: AgoraRole;
  profile?: AgoraProfile;
  // Set to false for audio-only calls (e.g. app/call/[userId].tsx) — skips
  // enableVideo()/enableLocalVideo()/startPreview() entirely so the camera
  // is never touched (no permission prompt, no capture pipeline). Defaults
  // to true to preserve existing video-call behavior.
  enableVideo?: boolean;
  callId?: string;
  liveSessionId?: string;
  liveRequestedRole?: LiveRequestedRole;
}

type CallKitAudioCoordination = {
  managedByCallKit: boolean;
  audioSessionActive: boolean;
};

const unmanagedCallKitAudio: CallKitAudioCoordination = {
  managedByCallKit: false,
  audioSessionActive: false,
};

async function waitForMatchingCallKitAudio(callId?: string): Promise<CallKitAudioCoordination> {
  if (Platform.OS !== 'ios' || !callId) return unmanagedCallKitAudio;

  let managedByCallKit = false;
  try {
    const state = await getNativeStateStrict();
    if (!state.hasReportedCall || state.currentCallId !== callId) return unmanagedCallKitAudio;
    managedByCallKit = true;
    if (state.audioSessionActive) {
      return { managedByCallKit: true, audioSessionActive: true };
    }
    logAgora('audio_gate_waiting', { callId: callId.slice(-8) });
  } catch {
    // A cold bridge may recover through the native activation event below.
  }

  return await new Promise(resolve => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { remove: () => void } | null = null;
    const finish = (result: CallKitAudioCoordination) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      subscription?.remove();
      resolve(result);
    };
    try {
      subscription = onAudioSessionActivated(event => {
        if (event.callId === callId && event.payload.active) {
          managedByCallKit = true;
          finish({ managedByCallKit: true, audioSessionActive: true });
        }
      });
    } catch {
      // The second strict read below can still prove ownership.
    }
    timer = setTimeout(() => {
      logAgora('audio_gate_timeout', { callId: callId.slice(-8), managedByCallKit });
      finish({ managedByCallKit, audioSessionActive: false });
    }, 5_000);
    // Close the read/subscribe race if didActivate fired between the first
    // native-state read and listener registration.
    getNativeStateStrict()
      .then(state => {
        if (state.hasReportedCall && state.currentCallId === callId) {
          managedByCallKit = true;
          if (state.audioSessionActive) {
            finish({ managedByCallKit: true, audioSessionActive: true });
          }
        }
      })
      .catch(() => {});
  });
}

export function useAgoraEngine({
  channelName,
  uid,
  role,
  profile = 'communication',
  enableVideo = true,
  callId,
  liveSessionId,
  liveRequestedRole,
  remoteVideoAuthority,
}: UseAgoraEngineParams) {
  const engineRef   = useRef<any>(null);
  const beforeReleaseListenersRef = useRef(new Set<(engine: any) => void>());
  const handlersRef = useRef<any>(null);
  const mountedRef  = useRef(true);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callKitAudioRestrictedRef = useRef(false);
  const attemptedJoinKeyRef = useRef<string | null>(null);
  const joinedKeyRef = useRef<string | null>(null);
  const joinFlightRef = useRef<Promise<void> | null>(null);
  const joinFlightGenerationRef = useRef<number | null>(null);
  const joinGenerationRef = useRef(0);
  const configuredJoinKeyRef = useRef<string | null>(null);
  const joinConfigRef = useRef({
    channelName, uid, role, profile, enableVideo, callId, liveSessionId, liveRequestedRole, remoteVideoAuthority,
  });
  joinConfigRef.current = {
    channelName, uid, role, profile, enableVideo, callId, liveSessionId, liveRequestedRole, remoteVideoAuthority,
  };
  const joinKey = channelName ? `${channelName}:${uid}` : null;

  const [joined,          setJoined]          = useState(false);
  const [joining,         setJoining]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [errorCode,       setErrorCode]       = useState<string | null>(null);
  const [remoteUids,      setRemoteUids]      = useState<number[]>([]);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isCameraOff,     setIsCameraOff]     = useState(role === 'subscriber' || !enableVideo);
  const [isFront,         setIsFront]         = useState(true);
  const [localVideoReady, setLocalVideoReady] = useState(false);
  // Video calls default to speaker on, audio calls default to earpiece
  // (enableVideo doubles as the video/audio-call signal here).
  const [speakerOn,       setSpeakerOn]        = useState(enableVideo);
  const speakerOnRef = useRef(enableVideo);
  const reconnectingRef = useRef(false);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  const remoteVideoTransitionRef = useRef<{
    uid: number; deadline: number; pendingRemoval: boolean;
    timer: ReturnType<typeof setTimeout> | null; generation: number;
  } | null>(null);
  const clearRemoteVideoTransition = useCallback((removeUid?: number) => {
    const transition = remoteVideoTransitionRef.current;
    remoteVideoTransitionRef.current = null;
    if (transition?.timer) clearTimeout(transition.timer);
    if (transition) logVideo('transition_clear', transition.uid, joinConfigRef.current.remoteVideoAuthority?.scopeKey);
    if (mountedRef.current && removeUid !== undefined) {
      setRemoteUids(prev => prev.filter(uid => uid !== removeUid));
    }
  }, []);
  const beginRemoteVideoTransition = useCallback((remoteUid: number) => {
    if (!mountedRef.current || !joinedKeyRef.current || reconnectingRef.current) return;
    // A repeated signal cannot extend an existing bounded window.
    if (remoteVideoTransitionRef.current?.uid === remoteUid) return;
    const previous = remoteVideoTransitionRef.current;
    clearRemoteVideoTransition(previous?.pendingRemoval ? previous.uid : undefined);
    const transition = {
      uid: remoteUid, deadline: performance.now() + REMOTE_VIDEO_TRANSITION_GRACE_MS,
      pendingRemoval: false, timer: null as ReturnType<typeof setTimeout> | null,
      generation: joinGenerationRef.current,
    };
    remoteVideoTransitionRef.current = transition;
    logVideo('transition_begin', remoteUid, joinConfigRef.current.remoteVideoAuthority?.scopeKey);
    transition.timer = setTimeout(() => {
      if (remoteVideoTransitionRef.current !== transition) return;
      remoteVideoTransitionRef.current = null;
      logVideo('transition_expired', remoteUid, joinConfigRef.current.remoteVideoAuthority?.scopeKey);
      if (mountedRef.current && transition.generation === joinGenerationRef.current
        && transition.pendingRemoval) setRemoteUids(prev => prev.filter(uid => uid !== remoteUid));
    }, REMOTE_VIDEO_TRANSITION_GRACE_MS);
  }, [clearRemoteVideoTransition]);

  const previousVideoAuthorityRef = useRef(remoteVideoAuthority);
  useEffect(() => {
    const previous = previousVideoAuthorityRef.current;
    previousVideoAuthorityRef.current = remoteVideoAuthority;
    if (previous?.scopeKey === remoteVideoAuthority?.scopeKey
      && previous?.remoteUid === remoteVideoAuthority?.remoteUid) return;
    const pending = remoteVideoTransitionRef.current?.pendingRemoval;
    const samePeer = previous && remoteVideoAuthority && previous.remoteUid === remoteVideoAuthority.remoteUid;
    clearRemoteVideoTransition(samePeer ? undefined : previous?.remoteUid);
    // A new authorized round resets the old timer without dropping the same surface.
    if (samePeer && pending) {
      beginRemoteVideoTransition(remoteVideoAuthority.remoteUid);
      if (remoteVideoTransitionRef.current) remoteVideoTransitionRef.current.pendingRemoval = true;
    }
  }, [remoteVideoAuthority?.scopeKey, remoteVideoAuthority?.remoteUid, beginRemoteVideoTransition, clearRemoteVideoTransition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearRemoteVideoTransition(); };
  }, []);

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const releaseEngine = useCallback((engine: any, ownedHandlers?: any) => {
    if (!engine) return;
    const ownsCurrentEngine = engineRef.current === engine;
    const handlers = ownedHandlers ?? (ownsCurrentEngine ? handlersRef.current : null);
    try {
      if (ownsCurrentEngine) {
        clearRemoteVideoTransition(remoteVideoTransitionRef.current?.uid);
        for (const listener of beforeReleaseListenersRef.current) {
          try { listener(engine); } catch { /* one guard cannot block LIVE teardown */ }
        }
      }
      if (handlers) {
        try { engine.unregisterEventHandler(handlers); } catch { /* continue teardown */ }
      }
      try {
        engine.leaveChannel();
      } finally {
        engine.release();
      }
    } catch { /* ignore */ }
    finally {
      if (ownsCurrentEngine) {
        engineRef.current = null;
        handlersRef.current = null;
        callKitAudioRestrictedRef.current = false;
      }
    }
  }, []);

  const cleanupEngine = useCallback(() => {
    joinGenerationRef.current += 1;
    reconnectingRef.current = false;
    clearJoinTimeout();
    const engine = engineRef.current;
    const activeKey = attemptedJoinKeyRef.current;
    logAgora('cleanup', { joinKey: shortStoredJoinKey(activeKey) });
    if (engine) releaseEngine(engine);
    else {
      handlersRef.current = null;
      callKitAudioRestrictedRef.current = false;
    }
    joinFlightRef.current = null;
    joinFlightGenerationRef.current = null;
    attemptedJoinKeyRef.current = null;
    joinedKeyRef.current = null;
  }, [clearJoinTimeout, releaseEngine]);

  const leave = useCallback(async () => {
    logAgora('leave requested', {
      joinKey: shortStoredJoinKey(attemptedJoinKeyRef.current),
    });
    cleanupEngine();
    if (mountedRef.current) {
      setJoined(false);
      setJoining(false);
      setRemoteUids([]);
      setLocalVideoReady(false);
    }
  }, [cleanupEngine]);

  const join = useCallback(async () => {
    const config = joinConfigRef.current;
    const currentJoinKey = config.channelName ? `${config.channelName}:${config.uid}` : null;
    if (!isAgoraAvailable() || !config.channelName || !currentJoinKey) return;
    const safeJoinKey = shortJoinKey(config.channelName, config.uid);
    if (joinedKeyRef.current === currentJoinKey) {
      logAgora('join single-flight ignored', { joinKey: safeJoinKey, reason: 'joined' });
      return;
    }
    if (attemptedJoinKeyRef.current === currentJoinKey || joinFlightRef.current) {
      logAgora('join single-flight ignored', { joinKey: safeJoinKey, reason: 'in_progress' });
      return;
    }

    const generation = joinGenerationRef.current + 1;
    joinGenerationRef.current = generation;
    attemptedJoinKeyRef.current = currentJoinKey;
    joinedKeyRef.current = null;
    setJoining(true);
    setError(null);
    setErrorCode(null);

    let attemptEngine: any = null;
    let attemptHandlers: any = null;
    const isCurrentAttempt = () => {
      const latest = joinConfigRef.current;
      const latestKey = latest.channelName ? `${latest.channelName}:${latest.uid}` : null;
      return mountedRef.current
        && joinGenerationRef.current === generation
        && attemptedJoinKeyRef.current === currentJoinKey
        && latestKey === currentJoinKey;
    };
    const isCurrentConnection = () => {
      const latest = joinConfigRef.current;
      const latestKey = latest.channelName ? `${latest.channelName}:${latest.uid}` : null;
      return mountedRef.current
        && joinGenerationRef.current === generation
        && joinedKeyRef.current === currentJoinKey
        && engineRef.current === attemptEngine
        && latestKey === currentJoinKey;
    };
    const failCurrentAttempt = (message: string, code?: string) => {
      if (!isCurrentAttempt()) {
        if (attemptEngine && engineRef.current !== attemptEngine) releaseEngine(attemptEngine, attemptHandlers);
        return;
      }
      joinGenerationRef.current += 1;
      clearJoinTimeout();
      if (attemptEngine) releaseEngine(attemptEngine, attemptHandlers);
      attemptedJoinKeyRef.current = null;
      joinedKeyRef.current = null;
      if (joinFlightGenerationRef.current === generation) {
        joinFlightRef.current = null;
        joinFlightGenerationRef.current = null;
      }
      if (mountedRef.current) {
        setJoining(false);
        setJoined(false);
        setError(message);
        setErrorCode(code ?? null);
      }
    };

    const flight = (async () => {
    try {
      if (config.callId && config.liveSessionId) {
        throw new Error('No pudimos conectar la llamada. Inténtalo nuevamente.');
      }
      let resource: AgoraTokenResource;
      if (config.callId) {
        resource = { callId: config.callId };
      } else if (config.liveSessionId && config.liveRequestedRole) {
        resource = {
          liveSessionId: config.liveSessionId,
          requestedRole: config.liveRequestedRole,
        };
      } else if (config.liveSessionId) {
        throw new Error('No pudimos conectar el LIVE. Inténtalo nuevamente.');
      } else {
        resource = { groupRoomId: config.channelName! };
      }
      const { token, appId, channel, uid: authorizedUid } = await fetchAgoraToken(resource);
      if (!isCurrentAttempt()) return;
      if (channel !== config.channelName || authorizedUid !== config.uid) {
        throw new Error('La identidad autorizada de Agora no coincide con la llamada');
      }
      const resolvedAppId = appId || getAgoraAppId();
      const callKitAudio = await waitForMatchingCallKitAudio(config.callId);
      if (!isCurrentAttempt()) return;

      const engine = createAgoraRtcEngine!();
      attemptEngine = engine;
      if (!isCurrentAttempt()) {
        releaseEngine(engine);
        return;
      }
      engineRef.current = engine;

      engine.initialize({
        appId: resolvedAppId,
        channelProfile: config.profile === 'live-broadcasting'
          ? ChannelProfileType.ChannelProfileLiveBroadcasting
          : ChannelProfileType.ChannelProfileCommunication,
      });
      if (!isCurrentAttempt()) {
        releaseEngine(engine);
        return;
      }
      if (callKitAudio.managedByCallKit) {
        const restrictionResult = engine.setAudioSessionOperationRestriction(
          AudioSessionOperationRestriction.AudioSessionOperationRestrictionConfigureSession
            | AudioSessionOperationRestriction.AudioSessionOperationRestrictionDeactivateSession,
        );
        if (typeof restrictionResult === 'number' && restrictionResult < 0) {
          throw new Error(`Agora audio-session restriction failed (${restrictionResult})`);
        }
        callKitAudioRestrictedRef.current = true;
      }

      // Fix: black local video on join. enableVideo() must run exactly once,
      // before joinChannel() — calling it again after the channel is joined
      // resets the video module instead of confirming it, which is what
      // caused the intermittent black screen. enableLocalVideo(true) +
      // startPreview() are safe to re-run (see onJoinChannelSuccess below)
      // and are what actually (re)start frame capture.
      if (config.role === 'publisher' && config.enableVideo) {
        try {
          engine.enableVideo();
          engine.enableLocalVideo(true);
          engine.startPreview();
          setLocalVideoReady(true);
        } catch { /* non-fatal — onJoinChannelSuccess retries this */ }
      }

      const handlers = {
        onJoinChannelSuccess: (connection: any) => {
          if (!isCurrentAttempt() || engineRef.current !== engine) return;
          clearJoinTimeout();
          let connState: unknown = 'n/a';
          try { connState = engine.getConnectionState?.(); } catch { /* ignore */ }
          joinedKeyRef.current = currentJoinKey;
          attemptedJoinKeyRef.current = null;
          logAgora('join success', {
            joinKey: safeJoinKey,
            connLocalUid: connection?.localUid,
            connectionState: connState,
          });
          if (!mountedRef.current) return;
          setJoined(true);
          setJoining(false);
          // Backup retry — deliberately does NOT call enableVideo() again
          // (see comment above). enableLocalVideo/startPreview are cheap to
          // repeat and cover devices where the pre-join call above was a
          // no-op because the capture pipeline wasn't ready yet.
          if (config.role === 'publisher' && config.enableVideo) {
            try {
              engine.enableLocalVideo(true);
              engine.muteLocalVideoStream(false);
              engine.startPreview();
              if (mountedRef.current) setLocalVideoReady(true);
            } catch { /* ignore */ }
          }
        },
        onConnectionStateChanged: (connection: any, state: any, reason: any) => {
          if (!isCurrentAttempt() && !isCurrentConnection()) return;
          logAgora('onConnectionStateChanged', {
            joinKey: safeJoinKey,
            state, reason,
          });
          if (state === ConnectionStateType.ConnectionStateReconnecting) {
            clearRemoteVideoTransition(remoteVideoTransitionRef.current?.uid);
            reconnectingRef.current = true;
          } else if (state === ConnectionStateType.ConnectionStateConnected) {
            if (reconnectingRef.current && mountedRef.current) {
              reconnectingRef.current = false;
              setReconnectEpoch(value => value + 1);
            }
          } else if (state === ConnectionStateType.ConnectionStateDisconnected
            || state === ConnectionStateType.ConnectionStateFailed) {
            reconnectingRef.current = false;
          }
        },
        onUserJoined: (_conn: any, remoteUid: number) => {
          logAgora('onUserJoined', { joinKey: safeJoinKey, remoteUid });
          if (!isCurrentConnection()) return;
          if (remoteVideoTransitionRef.current?.uid === remoteUid) {
            logVideo('transition_join_cancel', remoteUid, joinConfigRef.current.remoteVideoAuthority?.scopeKey);
            clearRemoteVideoTransition();
          }
          setRemoteUids(prev => prev.includes(remoteUid) ? prev : [...prev, remoteUid]);
        },
        onUserOffline: (_conn: any, remoteUid: number, reason: any) => {
          logAgora('onUserOffline', { joinKey: safeJoinKey, remoteUid, reason });
          if (!isCurrentConnection()) return;
          const transition = remoteVideoTransitionRef.current;
          if (reason === 0 && transition?.uid === remoteUid && performance.now() < transition.deadline) {
            transition.pendingRemoval = true;
            logAgora('video:offline_deferred', { uid: remoteUid, reason: 'local_reconfigure' });
            return;
          }
          if (transition?.uid === remoteUid) clearRemoteVideoTransition();
          // Incoming relay events belong to the other host's SDK operation. They
          // need not overlap our outgoing refresh. Start the bounded grace at
          // the incoming offline edge for this authoritative, visible peer only.
          const authority = joinConfigRef.current.remoteVideoAuthority;
          if (reason === 0 && authority?.remoteUid === remoteUid) {
            beginRemoteVideoTransition(remoteUid);
            const incoming = remoteVideoTransitionRef.current;
            if (incoming?.uid === remoteUid) {
              incoming.pendingRemoval = true;
              logVideo('offline_deferred', remoteUid, authority.scopeKey, 'incoming_peer');
              return;
            }
          }
          setRemoteUids(prev => prev.filter(u => u !== remoteUid));
        },
        onError: (code: number, msg?: string) => {
          const duringJoin = isCurrentAttempt() && engineRef.current === engine;
          const duringConnection = isCurrentConnection() && engineRef.current === engine;
          if (!duringJoin && !duringConnection) return;
          const classification = classifyAgoraError(code, duringConnection);
          console.error('[AGORA-DEBUG] onError', JSON.stringify({
            joinKey: safeJoinKey, code, message: msg ?? '(none)', classification,
          }));
          if (classification === 'join_fatal') {
            clearJoinTimeout();
            failCurrentAttempt(`Error Agora (${code}): ${msg ?? ''}`);
          } else if (classification === 'connection_fatal' && mountedRef.current) {
            // The existing screen lifecycle observes engineError and performs
            // the authoritative backend/native terminal transition.
            setError(`Error Agora (${code}): ${msg ?? ''}`);
          }
        },
      };
      attemptHandlers = handlers;
      handlersRef.current = handlers;
      engine.registerEventHandler(handlers);

      engine.enableAudio();
      if (config.callId) applyPendingAgoraCallMute(config.callId);
      if (callKitAudio.managedByCallKit && config.callId) {
        console.log('[CallAudioRoute] request', { requestedSpeaker: speakerOnRef.current });
        const route = await setCallKitSpeakerEnabled(config.callId, speakerOnRef.current);
        console.log(route.applied ? '[CallAudioRoute] applied' : '[CallAudioRoute] failed', {
          requestedSpeaker: route.requestedSpeaker,
          beforeOutputs: route.beforeOutputs,
          afterOutputs: route.afterOutputs,
          applied: route.applied,
          callMatches: route.callMatches,
          audioSessionActive: route.audioSessionActive,
          errorCode: route.errorCode,
        });
      } else {
        try { engine.setEnableSpeakerphone(speakerOnRef.current); } catch { /* ignore */ }
      }

      if (config.profile === 'live-broadcasting') {
        engine.setClientRole(
          config.role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        );
      }
      if (config.role === 'subscriber') {
        engine.enableLocalVideo(false);
        engine.enableLocalAudio(false);
      } else if (!config.enableVideo) {
        // Audio-only publisher (e.g. voice call) — never touch the camera.
        try { engine.enableLocalVideo(false); } catch { /* ignore */ }
      }

      if (!isCurrentAttempt()) {
        releaseEngine(engine);
        return;
      }
      logAgora('native join requested', { joinKey: safeJoinKey });

      clearJoinTimeout();
      joinTimeoutRef.current = setTimeout(() => {
        if (!isCurrentAttempt()) return;
        logAgora('join timeout', { joinKey: safeJoinKey });
        failCurrentAttempt('Agora join timeout');
      }, 15_000);

      const joinResult = engine.joinChannel(token, config.channelName, config.uid, {
        clientRoleType: config.profile === 'live-broadcasting'
          ? (config.role === 'publisher' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience)
          : undefined,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });

      logAgora('joinChannel return', {
        joinResult, joinKey: safeJoinKey,
      });

      if (typeof joinResult === 'number' && joinResult < 0) {
        logAgora('joinChannel failed immediately', {
          joinResult, joinKey: safeJoinKey,
        });
        failCurrentAttempt(`Agora joinChannel failed (${joinResult})`);
      }
    } catch (e: any) {
      failCurrentAttempt(e?.message ?? 'No se pudo conectar la llamada', e?.code);
    }
    })().finally(() => {
      if (joinFlightRef.current === flight && joinFlightGenerationRef.current === generation) {
        joinFlightRef.current = null;
        joinFlightGenerationRef.current = null;
      }
    });
    joinFlightRef.current = flight;
    joinFlightGenerationRef.current = generation;
    await flight;
  }, [clearJoinTimeout, releaseEngine]);

  useEffect(() => {
    if (configuredJoinKeyRef.current && configuredJoinKeyRef.current !== joinKey) {
      cleanupEngine();
    }
    configuredJoinKeyRef.current = joinKey;
  }, [cleanupEngine, joinKey]);

  useEffect(() => () => { cleanupEngine(); }, [cleanupEngine]);

  const applySpeakerphone = useCallback(async (enabled: boolean) => {
    const engine = engineRef.current;
    if (!engine) return false;
    if (callKitAudioRestrictedRef.current && callId) {
      console.log('[CallAudioRoute] request', { requestedSpeaker: enabled });
      const route = await setCallKitSpeakerEnabled(callId, enabled);
      console.log(route.applied ? '[CallAudioRoute] applied' : '[CallAudioRoute] failed', {
        requestedSpeaker: route.requestedSpeaker,
        beforeOutputs: route.beforeOutputs,
        afterOutputs: route.afterOutputs,
        applied: route.applied,
        callMatches: route.callMatches,
        audioSessionActive: route.audioSessionActive,
        errorCode: route.errorCode,
      });
      if (!route.applied || engineRef.current !== engine) return false;
      speakerOnRef.current = enabled;
      if (mountedRef.current) setSpeakerOn(enabled);
      return true;
    }
    try {
      const result = engine.setEnableSpeakerphone(enabled);
      if (typeof result === 'number' && result < 0) return false;
      speakerOnRef.current = enabled;
      if (mountedRef.current) setSpeakerOn(enabled);
      return true;
    } catch {
      return false;
    }
  }, [callId]);

  const toggleSpeaker = useCallback(() => {
    void applySpeakerphone(!speakerOnRef.current);
  }, [applySpeakerphone]);

  const promoteToPublisher = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || profile !== 'live-broadcasting') return false;
    try {
      if (channelName) {
        const resource: AgoraTokenResource = liveSessionId
          ? { liveSessionId, requestedRole: 'cohost' }
          : callId
            ? { callId }
            : { groupRoomId: channelName };
        const { token, channel, uid: authorizedUid } = await fetchAgoraToken(resource);
        if (channel !== channelName || authorizedUid !== uid) return false;
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
      if (mountedRef.current) {
        setError(e?.message ?? 'No se pudo subir al streaming');
        setErrorCode(e?.code ?? null);
      }
      return false;
    }
  }, [callId, channelName, uid, profile, enableVideo, liveSessionId]);

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

  useEffect(() => {
    if (!callId) return;
    return registerActiveCallAudioController({
      callId,
      setMuted: muted => {
        const engine = engineRef.current;
        if (!engine) return false;
        try {
          const result = engine.muteLocalAudioStream(muted);
          if (typeof result === 'number' && result < 0) return false;
          if (mountedRef.current) setIsMuted(muted);
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [callId]);

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

  const getEngine = useCallback(() => engineRef.current, []);

  const registerBeforeEngineRelease = useCallback((listener: (engine: any) => void) => {
    beforeReleaseListenersRef.current.add(listener);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      beforeReleaseListenersRef.current.delete(listener);
    };
  }, []);

  return {
    engineReady: isAgoraAvailable(),
    joined, joining, error, errorCode,
    remoteUids,
    isMuted, isCameraOff, isFront, speakerOn,
    localVideoReady,
    reconnectEpoch,
    getEngine, registerBeforeEngineRelease,
    beginRemoteVideoTransition, clearRemoteVideoTransition,
    join, leave,
    toggleMute, toggleCamera, switchCamera, toggleSpeaker, promoteToPublisher, demoteToAudience,
  };
}
