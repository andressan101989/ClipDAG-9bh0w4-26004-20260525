import { getSupabaseClient } from '@/template';

export type LiveEndReason =
  | 'host_ended'
  | 'host_disconnected'
  | 'stale_heartbeat'
  | 'replaced_by_new_live'
  | 'recovered_on_startup'
  | 'admin_cleanup';

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

export async function closeStaleLiveSessions() {
  const { data, error } = await supabase().rpc('close_stale_live_sessions');

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function recoverHostLiveSessions() {
  const { data, error } = await supabase().rpc('recover_host_live_sessions');

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
