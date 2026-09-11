import { getSupabaseClient } from '@/template';

export type ReportReason =
  | 'spam'
  | 'inappropriate'
  | 'harassment'
  | 'violence'
  | 'hate_speech'
  | 'misinformation'
  | 'other';

export async function submitReport(
  reporterId: string,
  contentId: string,
  contentType: 'video' | 'comment' | 'user',
  reason: ReportReason,
  details?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('reports').insert({
      reporter_user_id:      reporterId,
      reported_content_id:   contentId,
      reported_content_type: contentType,
      reason,
      details:               details || null,
      status:                'pending',
    });
    if (error) {
      console.error('[Report] submitReport failed — Supabase error:', {
        message: error.message,
        code:    error.code,
        details: error.details,
        hint:    error.hint,
      });
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e: any) {
    console.error('[Report] submitReport threw:', e);
    return { success: false, error: e?.message || 'Error al reportar' };
  }
}

async function submitValidatedDomainReport(
  rpcName: 'report_story' | 'report_chat_message',
  targetKey: 'p_story_id' | 'p_message_id',
  targetId: string,
  reason: ReportReason,
  details?: string,
): Promise<{ success: boolean; reportId?: string; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc(rpcName, {
      [targetKey]: targetId,
      p_reason: reason,
      p_details: details?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, reportId: typeof data === 'string' ? data : undefined };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Error al reportar' };
  }
}

export function reportStory(storyId: string, reason: ReportReason, details?: string) {
  return submitValidatedDomainReport('report_story', 'p_story_id', storyId, reason, details);
}

export function reportChatMessage(messageId: string, reason: ReportReason, details?: string) {
  return submitValidatedDomainReport(
    'report_chat_message',
    'p_message_id',
    messageId,
    reason,
    details,
  );
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('blocked_users').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    if (error && !error.message.includes('duplicate') && !error.code?.includes('23505')) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Error al bloquear' };
  }
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Error al desbloquear' };
  }
}

export async function getBlockedUserIds(userId: string): Promise<string[]> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', userId);
    return (data || []).map((r: { blocked_id: string }) => r.blocked_id);
  } catch {
    return [];
  }
}
