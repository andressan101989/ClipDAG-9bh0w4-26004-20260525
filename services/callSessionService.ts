import { getSupabaseClient } from '@/template';

export type CallType = 'audio' | 'video';
export type CallEndReason =
  | 'user_rejected'
  | 'caller_cancelled'
  | 'user_ended'
  | 'timeout'
  | 'disconnected'
  | 'busy'
  | 'answered_elsewhere'
  | 'system_cleanup';

export interface StartedCall {
  callId: string;
  callerId: string;
  calleeId: string;
  channelName: string;
  callType: CallType;
  status: string;
  expiresAt: string;
}

export interface AcceptedCall {
  callId: string;
  channelName: string;
  callType: CallType;
  status: string;
}

export interface CallTransitionResult {
  callId: string;
  status: string;
}

export interface DeviceDeactivationResult {
  deviceId: string;
  active: boolean;
}

export interface RegisterCallDeviceParams {
  installationId: string;
  platform: 'ios' | 'android';
  expoPushToken?: string | null;
  nativePushToken?: string | null;
  voipPushToken?: string | null;
  appVersion?: string | null;
  deviceModel?: string | null;
}

function firstRow<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function mapStartedCall(row: any): StartedCall {
  return {
    callId: row.call_id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    channelName: row.channel_name,
    callType: row.call_type === 'audio' ? 'audio' : 'video',
    status: row.status,
    expiresAt: row.expires_at,
  };
}

function mapAcceptedCall(row: any): AcceptedCall {
  return {
    callId: row.call_id,
    channelName: row.channel_name,
    callType: row.call_type === 'audio' ? 'audio' : 'video',
    status: row.status,
  };
}

function mapTransition(row: any): CallTransitionResult {
  return {
    callId: row.call_id,
    status: row.status,
  };
}

export async function startCall(params: {
  calleeId: string;
  callType: CallType;
  idempotencyKey: string;
  callerDeviceId?: string | null;
}): Promise<StartedCall> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('start_call', {
    p_callee_id: params.calleeId,
    p_call_type: params.callType,
    p_idempotency_key: params.idempotencyKey,
    p_caller_device_id: params.callerDeviceId ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo iniciar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id || !row?.channel_name) throw new Error('Respuesta invalida al iniciar llamada');
  return mapStartedCall(row);
}

export async function acceptCall(callId: string, calleeDeviceId?: string | null): Promise<AcceptedCall> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('accept_call', {
    p_call_id: callId,
    p_callee_device_id: calleeDeviceId ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo aceptar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id || !row?.channel_name) throw new Error('Respuesta invalida al aceptar llamada');
  if (row.status !== 'accepted') {
    const message =
      row.status === 'expired' ? 'La llamada expiró.' :
      row.status === 'cancelled' ? 'La llamada fue cancelada.' :
      row.status === 'rejected' ? 'La llamada fue rechazada.' :
      row.status === 'missed' ? 'La llamada fue perdida.' :
      row.status === 'ended' ? 'La llamada ya terminó.' :
      'La llamada ya no está disponible.';
    throw new Error(message);
  }
  return mapAcceptedCall(row);
}

export async function rejectCall(callId: string, reason: CallEndReason = 'user_rejected'): Promise<CallTransitionResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('reject_call', {
    p_call_id: callId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || 'No se pudo rechazar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id) throw new Error('Respuesta invalida al rechazar llamada');
  return mapTransition(row);
}

export async function cancelCall(callId: string): Promise<CallTransitionResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('cancel_call', { p_call_id: callId });
  if (error) throw new Error(error.message || 'No se pudo cancelar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id) throw new Error('Respuesta invalida al cancelar llamada');
  return mapTransition(row);
}

export async function timeoutCall(callId: string): Promise<CallTransitionResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('timeout_call', { p_call_id: callId });
  if (error) throw new Error(error.message || 'No se pudo expirar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id) throw new Error('Respuesta invalida al expirar llamada');
  return mapTransition(row);
}

export async function endCall(callId: string, reason: CallEndReason = 'user_ended'): Promise<CallTransitionResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('end_call', {
    p_call_id: callId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || 'No se pudo terminar la llamada');
  const row = firstRow<any>(data);
  if (!row?.call_id) throw new Error('Respuesta invalida al terminar llamada');
  return mapTransition(row);
}

export async function registerCallDevice(params: RegisterCallDeviceParams): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('register_call_device', {
    p_installation_id: params.installationId,
    p_platform: params.platform,
    p_expo_push_token: params.expoPushToken ?? null,
    p_native_push_token: params.nativePushToken ?? null,
    p_voip_push_token: params.voipPushToken ?? null,
    p_app_version: params.appVersion ?? null,
    p_device_model: params.deviceModel ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo registrar dispositivo');
  const row = firstRow<any>(data);
  if (!row?.device_id) throw new Error('Respuesta invalida al registrar dispositivo');
  return row.device_id;
}

export async function deactivateCallDevice(installationId: string): Promise<DeviceDeactivationResult | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('deactivate_call_device', {
    p_installation_id: installationId,
  });
  if (error) throw new Error(error.message || 'No se pudo desactivar dispositivo');
  const row = firstRow<any>(data);
  return row?.device_id ? { deviceId: row.device_id, active: Boolean(row.active) } : null;
}
