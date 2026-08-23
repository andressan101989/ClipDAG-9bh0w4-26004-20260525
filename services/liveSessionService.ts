import { getSupabaseClient } from '@/template';

export type LiveEndReason =
  | 'host_ended'
  | 'host_disconnected'
  | 'stale_heartbeat'
  | 'replaced_by_new_live'
  | 'recovered_on_startup'
  | 'admin_cleanup';

export type LiveHostControlAction =
  | 'mute'
  | 'unmute'
  | 'lock_mic'
  | 'unlock_mic'
  | 'grant_floor'
  | 'revoke_floor'
  | 'timer_start'
  | 'timer_stop'
  | 'remove_cohost';

const supabase = () => getSupabaseClient();

export async function startLiveSession(sessionId: string, title: string) {
  const { data, error } = await supabase().rpc('start_live_session', {
    p_session_id: sessionId,
    p_title: title,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function heartbeatLiveSession(sessionId: string) {
  const { data, error } = await supabase().rpc('heartbeat_live_session', {
    p_session_id: sessionId,
  });

  if (error) throw error;
  return data;
}

export async function markLiveSessionDisconnected(sessionId: string) {
  const { data, error } = await supabase().rpc('mark_live_session_disconnected', {
    p_session_id: sessionId,
  });

  if (error) throw error;
  return data;
}

export async function endLiveSession(sessionId: string, reason: LiveEndReason = 'host_ended') {
  const { data, error } = await supabase().rpc('end_live_session', {
    p_session_id: sessionId,
    p_reason: reason,
  });

  if (error) throw error;
  return data;
}

export async function recoverHostLiveSessions() {
  const { data, error } = await supabase().rpc('recover_host_live_sessions');

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function liveRpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await supabase().rpc(name, parameters);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export const setLiveParticipantPresence = (sessionId: string, present: boolean) =>
  liveRpc('live_set_participant_presence', { p_session_id: sessionId, p_present: present });

export const requestToJoinLive = (sessionId: string) =>
  liveRpc('live_request_to_join', { p_session_id: sessionId });

export const inviteLiveParticipant = (sessionId: string, targetUserId: string) =>
  liveRpc('live_host_invite_participant', { p_session_id: sessionId, p_target_user_id: targetUserId });

export const respondToLiveHostInvite = (sessionId: string, inviteId: string, accept: boolean) =>
  liveRpc('live_respond_to_host_invite', {
    p_session_id: sessionId,
    p_invite_id: inviteId,
    p_accept: accept,
  });

export const decideLiveJoinRequest = (sessionId: string, targetUserId: string, approve: boolean) =>
  liveRpc('live_host_decide_join_request', {
    p_session_id: sessionId,
    p_target_user_id: targetUserId,
    p_approve: approve,
  });

export const controlLiveParticipant = (
  sessionId: string,
  targetUserId: string,
  action: LiveHostControlAction,
  durationSeconds: 60 | 120 | null = null,
) => liveRpc('live_host_control_participant', {
  p_session_id: sessionId,
  p_target_user_id: targetUserId,
  p_action: action,
  p_duration_seconds: durationSeconds,
});

export const enforceLiveParticipantTimer = (sessionId: string, targetUserId: string) =>
  liveRpc('live_enforce_participant_timer', { p_session_id: sessionId, p_target_user_id: targetUserId });

export const emitLiveReaction = (sessionId: string, emoji: string) =>
  liveRpc('live_emit_reaction', { p_session_id: sessionId, p_emoji: emoji });

export const sendLiveMessage = (sessionId: string, message: string) =>
  liveRpc('live_send_message', { p_session_id: sessionId, p_message: message });

export const updateLiveSessionTitle = (sessionId: string, title: string) =>
  liveRpc('live_update_session_title', { p_session_id: sessionId, p_title: title });
