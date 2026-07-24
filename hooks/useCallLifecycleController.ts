import { usePreventRemove } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelCall, endCall } from '@/services/callSessionService';
import { stopAllCallSoundsForCall } from '@/services/callRingtoneService';
import { requestEndCallIfManagedByCallKit } from '@/services/iosCallKitService';
import { useSafeCallScreenExit } from '@/hooks/useSafeCallScreenExit';

export type CallPhase = 'starting' | 'ringing' | 'connecting' | 'active' | 'rejected' | 'ended' | 'failed';
export type CallLifecycleEvent = 'starting' | 'start_failed' | 'ringing' | 'timeout' | 'rejected' | 'accepted' | 'connected';

type Params = {
  callId: string;
  initialCallId?: string;
  isCallee: boolean;
  screen: 'call' | 'video-call';
  terminalStatus: string | null;
  engineError: string | null;
};

export function useCallLifecycleController({
  callId, initialCallId = '', isCallee, screen, terminalStatus, engineError,
}: Params) {
  const [phase, setPhase] = useState<CallPhase>(isCallee ? 'connecting' : 'starting');
  const [duration, setDuration] = useState(0);
  const callIdRef = useRef(initialCallId);
  const mountedRef = useRef(true);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalRequestedRef = useRef(false);
  const terminalFlightRef = useRef<Promise<boolean> | null>(null);
  const cleanupCompletedRef = useRef(false);
  const cleanupFlightRef = useRef<Promise<void> | null>(null);
  const engineFailureClosingRef = useRef(false);
  const { exitCallScreenSafely, terminalConfirmedRef, exitInFlightRef, exitCompletedRef } =
    useSafeCallScreenExit(callId || initialCallId, screen);

  const transition = useCallback((event: CallLifecycleEvent) => {
    setPhase(current => {
      if (['ended', 'rejected', 'failed'].includes(current)) return current;
      switch (event) {
        case 'starting': return 'starting';
        case 'start_failed': return 'failed';
        case 'ringing': return 'ringing';
        case 'timeout': return current === 'ringing' ? 'ended' : current;
        case 'rejected': return 'rejected';
        case 'accepted': return current === 'ringing' ? 'connecting' : current;
        case 'connected': return 'active';
      }
    });
  }, []);

  useEffect(() => {
    if (callId) callIdRef.current = callId;
  }, [callId]);

  const closeBackendCall = useCallback((reason: 'user_ended' | 'disconnected' = 'user_ended') => {
    const activeCallId = callIdRef.current || callId;
    if (!activeCallId) return Promise.resolve(true);
    if (terminalFlightRef.current) return terminalFlightRef.current;
    const transition = (phase === 'ringing' || phase === 'starting') && !isCallee
      ? cancelCall(activeCallId).then(() => true)
      : endCall(activeCallId, reason).then(() => true);
    const flight = transition.catch(() => false);
    terminalFlightRef.current = flight;
    void flight.then(() => {
      if (terminalFlightRef.current === flight) terminalFlightRef.current = null;
    });
    return flight;
  }, [callId, isCallee, phase]);

  const requestTerminal = useCallback(async (reason: 'user_ended' | 'disconnected' = 'user_ended') => {
    if (terminalRequestedRef.current) return false;
    terminalRequestedRef.current = true;
    const activeCallId = callIdRef.current || callId;
    await stopAllCallSoundsForCall(activeCallId).catch(() => {});
    if (activeCallId) {
      // For a CallKit-managed call, CXEndCallAction is the sole backend
      // transition owner through IosCallKitActionHandler. Do not race it with
      // a second end_call RPC from the screen.
      const nativeOwnsTermination = await requestEndCallIfManagedByCallKit(activeCallId);
      if (nativeOwnsTermination) return true;
      const closed = await closeBackendCall(reason);
      if (!closed) {
        terminalRequestedRef.current = false;
        return false;
      }
    }
    setPhase(reason === 'disconnected' ? 'failed' : 'ended');
    return true;
  }, [callId, closeBackendCall]);

  useEffect(() => {
    if (!terminalStatus || !mountedRef.current) return;
    terminalRequestedRef.current = true;
    setPhase(terminalStatus === 'rejected' ? 'rejected' : 'ended');
  }, [terminalStatus]);

  useEffect(() => {
    if (!engineError || engineFailureClosingRef.current || terminalRequestedRef.current) return;
    engineFailureClosingRef.current = true;
    const flight = requestTerminal('disconnected');
    const onSettled = () => { engineFailureClosingRef.current = false; };
    void flight.then(onSettled, onSettled);
  }, [engineError, requestTerminal]);

  useEffect(() => {
    if (phase !== 'active') return;
    durationTimerRef.current = setInterval(() => setDuration(value => value + 1), 1000);
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (!['ended', 'rejected', 'failed'].includes(phase) || cleanupCompletedRef.current || cleanupFlightRef.current) return;
    terminalRequestedRef.current = true;
    terminalConfirmedRef.current = true;
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    ringTimeoutRef.current = null;
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    durationTimerRef.current = null;
    const activeCallId = callIdRef.current || callId;
    const flight = (async () => {
      await stopAllCallSoundsForCall(activeCallId).catch(() => {});
      if (mountedRef.current) await exitCallScreenSafely(`phase_${phase}`, true);
      cleanupCompletedRef.current = true;
    })();
    cleanupFlightRef.current = flight;
    const clearFlight = () => {
      if (cleanupFlightRef.current === flight) cleanupFlightRef.current = null;
    };
    void flight.then(clearFlight, clearFlight);
  }, [callId, exitCallScreenSafely, phase, terminalConfirmedRef]);

  usePreventRemove(!['ended', 'rejected', 'failed'].includes(phase), () => {
    if (exitCompletedRef.current || exitInFlightRef.current || terminalRequestedRef.current) return;
    void requestTerminal('user_ended');
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, []);

  return {
    phase, transition, duration, callIdRef, mountedRef, ringTimeoutRef,
    terminalRequestedRef, requestTerminal,
  };
}
