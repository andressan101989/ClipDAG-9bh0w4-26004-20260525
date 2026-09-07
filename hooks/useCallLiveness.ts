import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  heartbeatCall,
  markCallHandoffCompleted,
  markCallJoined,
  markCallMediaConnected,
} from '@/services/callSessionService';

const HEARTBEAT_INTERVAL_MS = 30_000;

type Params = {
  callId: string;
  isCallee: boolean;
  callStatus: string | null;
  answerHandoff: string | undefined;
  joined: boolean;
  connected: boolean;
  terminal: boolean;
  pauseInBackground?: boolean;
};

export function useCallLiveness({
  callId, isCallee, callStatus, answerHandoff, joined, connected, terminal,
  pauseInBackground = false,
}: Params) {
  const handoffMarkedRef = useRef<string | null>(null);
  const joinMarkedRef = useRef<string | null>(null);
  const connectedMarkedRef = useRef<string | null>(null);
  const heartbeatFlightRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!callId || terminal || callStatus !== 'accepted' || !isCallee || answerHandoff !== 'accepted') return;
    if (handoffMarkedRef.current === callId) return;
    handoffMarkedRef.current = callId;
    void markCallHandoffCompleted(callId).catch(() => {
      if (handoffMarkedRef.current === callId) handoffMarkedRef.current = null;
    });
  }, [answerHandoff, callId, callStatus, isCallee, terminal]);

  useEffect(() => {
    if (!callId || terminal || callStatus !== 'accepted' || !joined) return;
    if (joinMarkedRef.current === callId) return;
    joinMarkedRef.current = callId;
    void markCallJoined(callId).catch(() => {
      if (joinMarkedRef.current === callId) joinMarkedRef.current = null;
    });
  }, [callId, callStatus, joined, terminal]);

  useEffect(() => {
    if (!callId || terminal || callStatus !== 'accepted' || !connected) return;
    if (connectedMarkedRef.current === callId) return;
    connectedMarkedRef.current = callId;
    void markCallMediaConnected(callId).catch(() => {
      if (connectedMarkedRef.current === callId) connectedMarkedRef.current = null;
    });
  }, [callId, callStatus, connected, terminal]);

  useEffect(() => {
    if (!callId || terminal || callStatus !== 'accepted' || !connected) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const sendHeartbeat = () => {
      if (stopped || heartbeatFlightRef.current) return;
      const flight = heartbeatCall(callId);
      heartbeatFlightRef.current = flight;
      const settled = () => {
        if (heartbeatFlightRef.current === flight) heartbeatFlightRef.current = null;
      };
      void flight.then(settled, settled);
    };
    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const startTimer = () => {
      if (stopped || timer) return;
      sendHeartbeat();
      timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    };
    if (!pauseInBackground || AppState.currentState === 'active') startTimer();
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (!pauseInBackground) {
        if (state === 'active') sendHeartbeat();
        return;
      }
      if (state === 'active') startTimer();
      else stopTimer();
    });
    return () => {
      stopped = true;
      stopTimer();
      appStateSubscription.remove();
    };
  }, [callId, callStatus, connected, pauseInBackground, terminal]);
}
