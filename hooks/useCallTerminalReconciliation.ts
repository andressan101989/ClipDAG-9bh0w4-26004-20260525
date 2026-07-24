import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getSupabaseClient } from '@/template';

export type TerminalCallStatus = 'ended' | 'cancelled' | 'rejected' | 'expired' | 'missed' | 'invalid';
export type ActiveCallStatus = 'ringing' | 'accepted';

const TERMINAL_STATUSES = new Set<TerminalCallStatus>([
  'ended', 'cancelled', 'rejected', 'expired', 'missed',
]);

function asTerminalStatus(status: unknown): TerminalCallStatus | null {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status as TerminalCallStatus)
    ? status as TerminalCallStatus
    : null;
}

export function useCallTerminalReconciliation(callId: string) {
  const [checkedCallId, setCheckedCallId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalCallStatus | null>(null);
  const [callStatus, setCallStatus] = useState<ActiveCallStatus | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const terminalRef = useRef<TerminalCallStatus | null>(null);
  const warningEmittedRef = useRef(false);

  useEffect(() => {
    setTerminalStatus(null);
    setCallStatus(null);
    terminalRef.current = null;
    warningEmittedRef.current = false;
    inFlightRef.current = null;
    if (!callId) return;

    let disposed = false;
    const supabase = getSupabaseClient();

    const acceptStatus = (status: unknown) => {
      if (status === 'ringing' || status === 'accepted') {
        if (!disposed) setCallStatus(status);
        return;
      }
      const terminal = asTerminalStatus(status);
      if (!terminal || disposed || terminalRef.current) return;
      terminalRef.current = terminal;
      setTerminalStatus(terminal);
    };

    const reconcile = () => {
      if (disposed || terminalRef.current) return Promise.resolve();
      if (inFlightRef.current) return inFlightRef.current;

      const flight = (async () => {
        const { data, error } = await supabase
          .from('calls')
          .select('status')
          .eq('id', callId)
          .maybeSingle<{ status: string }>();
        if (error) throw error;
        if (!disposed) {
          warningEmittedRef.current = false;
          if (!data) {
            terminalRef.current = 'invalid';
            setTerminalStatus('invalid');
          } else if (data.status === 'ringing' || data.status === 'accepted') {
            setCallStatus(data.status);
          } else {
            const terminal = asTerminalStatus(data.status);
            terminalRef.current = terminal ?? 'invalid';
            setTerminalStatus(terminal ?? 'invalid');
          }
          setCheckedCallId(callId);
        }
      })()
        .catch(() => {
          if (!disposed && !warningEmittedRef.current) {
            warningEmittedRef.current = true;
            console.warn('[CallTerminalReconciliation] status query failed', {
              callId: callId.slice(-8),
            });
          }
        })
        .finally(() => {
          if (inFlightRef.current === flight) inFlightRef.current = null;
        });
      inFlightRef.current = flight;
      return flight;
    };

    const channel = supabase.channel(`calls:screen-status:${callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}`,
      }, (payload: { new?: { status?: string } }) => {
        acceptStatus(payload.new?.status);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') reconcile();
      });

    reconcile();
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile();
    });
    const netInfoSub = NetInfo.addEventListener(state => {
      if (state.isConnected) reconcile();
    });

    return () => {
      disposed = true;
      appStateSub.remove();
      netInfoSub();
      channel.unsubscribe();
    };
  }, [callId]);

  return {
    statusChecked: !callId || checkedCallId === callId,
    terminalStatus,
    callStatus,
  };
}
