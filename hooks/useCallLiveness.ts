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
};

export function useCallLiveness({
  callId, isCallee, callStatus, answerHandoff, joined, connected, terminal,
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
    const sendHeartbeat = () => {
      if (stopped || heartbeatFlightRef.current) return;
      const flight = heartbeatCall(callId);
      heartbeatFlightRef.current = flight;
      const settled = () => {
        if (heartbeatFlightRef.current === flight) heartbeatFlightRef.current = null;
      };
      void flight.then(settled, settled);
    };
    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') sendHeartbeat();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [callId, callStatus, connected, terminal]);
}
