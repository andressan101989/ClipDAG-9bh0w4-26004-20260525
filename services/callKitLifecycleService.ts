import { getCurrentCallDeviceId } from '@/services/callDeviceService';
import {
  getNativeStateStrict,
  reportCallConnected,
  reportCallEndedStrict,
  type CallKitEndReason,
  type NativeCallKitState,
} from '@/services/iosCallKitService';
import { getSupabaseClient } from '@/template';

type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended' | 'cancelled' | 'expired';
type TerminalCallStatus = Exclude<CallStatus, 'ringing' | 'accepted'>;

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  status: string;
  call_type: string | null;
  channel_name: string | null;
  expires_at: string | null;
  callee_device_id: string | null;
};

export type NativeLifecycleResult =
  | { kind: 'connected'; callId: string }
  | { kind: 'terminal'; callId: string; reason: Exclude<CallKitEndReason, 'localEnded'> }
  | { kind: 'retry'; callId: string; reason: 'backend' | 'device' | 'native' }
  | { kind: 'ignored'; callId?: string; reason: 'no_native_call' | 'different_call' | 'non_actionable' | 'invalid_call' };

function normalizeStatus(status: string): CallStatus | null {
  if (['ringing', 'accepted', 'rejected', 'missed', 'ended', 'cancelled', 'expired'].includes(status)) {
    return status as CallStatus;
  }
  return null;
}

function terminalReason(status: TerminalCallStatus): Exclude<CallKitEndReason, 'localEnded'> {
  switch (status) {
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'missed':
      return 'unanswered';
    case 'rejected':
      return 'rejected';
    case 'ended':
      return 'remoteEnded';
  }
}

function nativeMatchesCall(state: NativeCallKitState | null, callId: string): boolean {
  return Boolean(state?.hasReportedCall && state.currentCallId === callId);
}

async function fetchCall(callId: string): Promise<{ call: CallRow | null; error: boolean }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, status, call_type, channel_name, expires_at, callee_device_id')
      .eq('id', callId)
      .maybeSingle<CallRow>();
    return { call: data ?? null, error: Boolean(error) };
  } catch {
    return { call: null, error: true };
  }
}

export async function getReportedNativeCallId(): Promise<string | null> {
  const state = await getNativeStateStrict();
  if (!state.hasReportedCall || !state.currentCallId) return null;
  return state.currentCallId;
}

export async function closeNativeCallIfMatching(
  callId: string,
  reason: Exclude<CallKitEndReason, 'localEnded'>,
): Promise<boolean> {
  return reportCallEndedStrict(callId, reason);
}

export async function reconcileNativeCallLifecycle(
  callId: string,
  processed?: {
    connected?: boolean;
    terminalReasons?: Exclude<CallKitEndReason, 'localEnded'>[];
  },
): Promise<NativeLifecycleResult> {
  let state: NativeCallKitState;
  try {
    state = await getNativeStateStrict();
  } catch {
    return { kind: 'retry', callId, reason: 'native' };
  }
  if (!state.hasReportedCall || !state.currentCallId) {
    return { kind: 'ignored', reason: 'no_native_call' };
  }
  if (!nativeMatchesCall(state, callId)) {
    return { kind: 'ignored', callId, reason: 'different_call' };
  }

  const { call, error } = await fetchCall(callId);
  if (error) return { kind: 'retry', callId, reason: 'backend' };
  if (!call) {
    try {
      const ended = await closeNativeCallIfMatching(callId, 'failed');
      return ended
        ? { kind: 'terminal', callId, reason: 'failed' }
        : { kind: 'ignored', callId, reason: 'no_native_call' };
    } catch {
      return { kind: 'retry', callId, reason: 'native' };
    }
  }

  const status = normalizeStatus(call.status);
  if (!status) return { kind: 'ignored', callId, reason: 'invalid_call' };

  if (status === 'ringing') {
    return { kind: 'ignored', callId, reason: 'non_actionable' };
  }

  if (status === 'accepted') {
    const deviceId = await getCurrentCallDeviceId();
    if (!deviceId) return { kind: 'retry', callId, reason: 'device' };
    if (call.callee_device_id === deviceId) {
      if (processed?.connected) return { kind: 'ignored', callId, reason: 'non_actionable' };
      const connected = await reportCallConnected(callId);
      return connected ? { kind: 'connected', callId } : { kind: 'retry', callId, reason: 'native' };
    }
    if (call.callee_device_id) {
      if (processed?.terminalReasons?.includes('answeredElsewhere')) {
        return { kind: 'ignored', callId, reason: 'non_actionable' };
      }
      try {
        const ended = await closeNativeCallIfMatching(callId, 'answeredElsewhere');
        return ended
          ? { kind: 'terminal', callId, reason: 'answeredElsewhere' }
          : { kind: 'ignored', callId, reason: 'no_native_call' };
      } catch {
        return { kind: 'retry', callId, reason: 'native' };
      }
    }
    return { kind: 'retry', callId, reason: 'backend' };
  }

  const reason = terminalReason(status);
  if (processed?.terminalReasons?.includes(reason)) {
    return { kind: 'ignored', callId, reason: 'non_actionable' };
  }
  try {
    const ended = await closeNativeCallIfMatching(callId, reason);
    return ended
      ? { kind: 'terminal', callId, reason }
      : { kind: 'ignored', callId, reason: 'no_native_call' };
  } catch {
    return { kind: 'retry', callId, reason: 'native' };
  }
}
