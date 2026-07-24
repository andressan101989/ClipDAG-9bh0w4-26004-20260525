import type { CallKitAnswerEvent, CallKitEndEvent, CallKitEndReason } from '@/services/iosCallKitService';
import {
  acceptCall,
  endCall,
  rejectCall,
  type AcceptedCall,
  type CallEndReason,
  type CallTransitionResult,
} from '@/services/callSessionService';
import { getSupabaseClient } from '@/template';

type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended' | 'cancelled' | 'expired';
type TerminalCallStatus = Exclude<CallStatus, 'ringing' | 'accepted'>;
type CallType = 'audio' | 'video';

const acceptFlights = new Map<string, Promise<AcceptedCall>>();
const rejectFlights = new Map<string, Promise<CallTransitionResult>>();
const endFlights = new Map<string, Promise<CallTransitionResult>>();

export type CallKitReconcileResult =
  | {
      kind: 'accepted';
      eventId: string;
      call: ReconciledCall;
      accepted: AcceptedCall;
      caller: CallerProfile;
    }
  | {
      kind: 'terminal';
      eventId: string;
      callId: string;
      reportReason?: Exclude<CallKitEndReason, 'localEnded'>;
    }
  | {
      kind: 'retry';
      eventId: string;
      callId?: string;
      reason: 'network' | 'session' | 'device' | 'backend';
    }
  | {
      kind: 'invalid';
      eventId: string;
      callId?: string;
      reportReason?: Exclude<CallKitEndReason, 'localEnded'>;
    };

export interface ReconciledCall {
  id: string;
  callerId: string;
  calleeId: string;
  channelName: string;
  status: CallStatus;
  callType: CallType;
  expiresAt: string | null;
  calleeDeviceId: string | null;
}

export interface CallerProfile {
  displayName: string;
  avatarUrl: string;
}

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  channel_name: string | null;
  status: string;
  call_type: string | null;
  expires_at: string | null;
  callee_device_id: string | null;
};

type CallerProfileRow = {
  username: string | null;
  display_name?: string | null;
  avatar_url: string | null;
};

function validEvent(event: CallKitAnswerEvent | CallKitEndEvent): boolean {
  return Boolean(event.eventId && event.callId && event.callUuid);
}

function normalizeCall(row: CallRow): ReconciledCall | null {
  if (!row.id || !row.caller_id || !row.callee_id || !row.channel_name) return null;
  if (!['ringing', 'accepted', 'rejected', 'missed', 'ended', 'cancelled', 'expired'].includes(row.status)) return null;
  return {
    id: row.id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    channelName: row.channel_name,
    status: row.status as CallStatus,
    callType: row.call_type === 'audio' ? 'audio' : 'video',
    expiresAt: row.expires_at,
    calleeDeviceId: row.callee_device_id,
  };
}

function reportReasonForTerminalStatus(status: TerminalCallStatus): Exclude<CallKitEndReason, 'localEnded'> {
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

function normalizeDeviceId(deviceId: string | null): string | null {
  const trimmed = deviceId?.trim();
  return trimmed ? trimmed : null;
}

function acceptCallSingleFlight(callId: string, deviceId: string): Promise<AcceptedCall> {
  const existing = acceptFlights.get(callId);
  if (existing) return existing;

  const flight = acceptCall(callId, deviceId).finally(() => {
    acceptFlights.delete(callId);
  });
  acceptFlights.set(callId, flight);
  return flight;
}

async function acceptedForCurrentDevice(
  eventId: string,
  call: ReconciledCall,
  accepted: AcceptedCall,
  deviceId: string,
): Promise<CallKitReconcileResult> {
  if (call.calleeDeviceId === deviceId) {
    const caller = await fetchCallerProfile(call.callerId);
    return { kind: 'accepted', eventId, call, accepted, caller };
  }
  if (call.calleeDeviceId) {
    return { kind: 'terminal', eventId, callId: call.id, reportReason: 'answeredElsewhere' };
  }
  return { kind: 'retry', eventId, callId: call.id, reason: 'backend' };
}

export function rejectCallSingleFlight(callId: string, reason: CallEndReason): Promise<CallTransitionResult> {
  const existing = rejectFlights.get(callId);
  if (existing) return existing;

  const flight = rejectCall(callId, reason).finally(() => {
    rejectFlights.delete(callId);
  });
  rejectFlights.set(callId, flight);
  return flight;
}

function endCallSingleFlight(callId: string, reason: CallEndReason): Promise<CallTransitionResult> {
  const existing = endFlights.get(callId);
  if (existing) return existing;

  const flight = endCall(callId, reason).finally(() => {
    endFlights.delete(callId);
  });
  endFlights.set(callId, flight);
  return flight;
}

async function fetchCall(callId: string): Promise<{ call: ReconciledCall | null; error: boolean }> {
  let data: CallRow | null = null;
  let hasError = false;
  try {
    const supabase = getSupabaseClient();
    const response = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, channel_name, status, call_type, expires_at, callee_device_id')
      .eq('id', callId)
      .maybeSingle<CallRow>();
    data = response.data;
    hasError = Boolean(response.error);
  } catch {
    hasError = true;
  }

  if (hasError) return { call: null, error: true };
  return { call: data ? normalizeCall(data) : null, error: false };
}

async function fetchCallerProfile(callerId: string): Promise<CallerProfile> {
  let data: CallerProfileRow | null = null;
  try {
    const supabase = getSupabaseClient();
    const response = await supabase
      .from('user_profiles')
      .select('username, display_name, avatar_url')
      .eq('id', callerId)
      .maybeSingle<CallerProfileRow>();
    data = response.data;
  } catch {
    data = null;
  }

  return {
    displayName: data?.display_name || data?.username || 'Usuario',
    avatarUrl: data?.avatar_url || '',
  };
}

export async function reconcileAnswerCallKitEvent(params: {
  event: CallKitAnswerEvent;
  userId: string;
  deviceId: string | null;
}): Promise<CallKitReconcileResult> {
  const { event, userId, deviceId } = params;
  if (!validEvent(event)) return { kind: 'invalid', eventId: event.eventId, callId: event.callId, reportReason: 'failed' };
  return reconcileIncomingCallAcceptance({
    eventId: event.eventId,
    callId: event.callId,
    userId,
    deviceId,
  });
}

export async function reconcileIncomingCallAcceptance(params: {
  eventId: string;
  callId: string;
  userId: string;
  deviceId: string | null;
}): Promise<CallKitReconcileResult> {
  const { eventId, callId, userId } = params;
  const deviceId = normalizeDeviceId(params.deviceId);
  const initial = await fetchCall(callId);
  if (initial.error) return { kind: 'retry', eventId, callId, reason: 'network' };
  const call = initial.call;
  if (!call || call.calleeId !== userId) {
    return { kind: 'invalid', eventId, callId, reportReason: 'failed' };
  }
  if (!deviceId) return { kind: 'retry', eventId, callId: call.id, reason: 'device' };

  if (call.status === 'ringing') {
    try {
      const accepted = await acceptCallSingleFlight(call.id, deviceId);
      const latest = await fetchCall(call.id);
      if (latest.error) return { kind: 'retry', eventId, callId: call.id, reason: 'backend' };
      if (!latest.call) return { kind: 'invalid', eventId, callId: call.id, reportReason: 'failed' };
      if (latest.call.status === 'ringing') return { kind: 'retry', eventId, callId: call.id, reason: 'backend' };
      if (latest.call.status === 'accepted') {
        return acceptedForCurrentDevice(eventId, latest.call, accepted, deviceId);
      }
      return {
        kind: 'terminal',
        eventId,
        callId: latest.call.id,
        reportReason: reportReasonForTerminalStatus(latest.call.status),
      };
    } catch {
      const latest = await fetchCall(call.id);
      if (latest.error) return { kind: 'retry', eventId, callId: call.id, reason: 'backend' };
      if (!latest.call) return { kind: 'invalid', eventId, callId: call.id, reportReason: 'failed' };
      if (latest.call.status === 'ringing') {
        return { kind: 'retry', eventId, callId: call.id, reason: 'backend' };
      }
      if (latest.call.status === 'accepted') {
        return acceptedForCurrentDevice(eventId, latest.call, {
          callId: latest.call.id,
          channelName: latest.call.channelName,
          callType: latest.call.callType,
          status: latest.call.status,
        }, deviceId);
      }
      return {
        kind: 'terminal',
        eventId,
        callId: latest.call.id,
        reportReason: reportReasonForTerminalStatus(latest.call.status),
      };
    }
  }

  if (call.status === 'accepted') {
    return acceptedForCurrentDevice(eventId, call, {
      callId: call.id,
      channelName: call.channelName,
      callType: call.callType,
      status: call.status,
    }, deviceId);
  }

  return { kind: 'terminal', eventId, callId: call.id, reportReason: reportReasonForTerminalStatus(call.status) };
}

async function reconcileAcceptedEndAfterFailure(
  eventId: string,
  callId: string,
): Promise<CallKitReconcileResult> {
  try {
    await endCallSingleFlight(callId, 'user_ended');
    return { kind: 'terminal', eventId, callId };
  } catch {
    const latest = await fetchCall(callId);
    if (latest.error) return { kind: 'retry', eventId, callId, reason: 'backend' };
    if (!latest.call) return { kind: 'invalid', eventId, callId };
    if (latest.call.status === 'accepted') {
      return { kind: 'retry', eventId, callId, reason: 'backend' };
    }
    if (latest.call.status === 'ringing') {
      return { kind: 'retry', eventId, callId, reason: 'backend' };
    }
    return { kind: 'terminal', eventId, callId };
  }
}

export async function reconcileEndCallKitEvent(params: {
  event: CallKitEndEvent;
  userId: string;
}): Promise<CallKitReconcileResult> {
  const { event, userId } = params;
  if (!validEvent(event)) return { kind: 'invalid', eventId: event.eventId, callId: event.callId };

  const initial = await fetchCall(event.callId);
  if (initial.error) return { kind: 'retry', eventId: event.eventId, callId: event.callId, reason: 'network' };
  const call = initial.call;
  if (!call || (call.calleeId !== userId && call.callerId !== userId)) {
    return { kind: 'invalid', eventId: event.eventId, callId: event.callId };
  }

  if (call.status === 'ringing') {
    if (call.calleeId !== userId) return { kind: 'invalid', eventId: event.eventId, callId: call.id };
    try {
      await rejectCallSingleFlight(call.id, 'user_rejected');
      return { kind: 'terminal', eventId: event.eventId, callId: call.id };
    } catch {
      const latest = await fetchCall(call.id);
      if (latest.error) return { kind: 'retry', eventId: event.eventId, callId: call.id, reason: 'backend' };
      if (!latest.call) return { kind: 'invalid', eventId: event.eventId, callId: call.id };
      if (latest.call?.status === 'ringing') {
        return { kind: 'retry', eventId: event.eventId, callId: call.id, reason: 'backend' };
      }
      if (latest.call.status === 'accepted') {
        return reconcileAcceptedEndAfterFailure(event.eventId, call.id);
      }
      return { kind: 'terminal', eventId: event.eventId, callId: call.id };
    }
  }

  if (call.status === 'accepted') {
    return reconcileAcceptedEndAfterFailure(event.eventId, call.id);
  }

  return { kind: 'terminal', eventId: event.eventId, callId: call.id };
}
