import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@/template';
import type {
  ChatConversationCursor,
  ChatConversationPageRow,
  ChatCursor,
  ChatMessageRow,
  ChatMessageWithReceiptRow,
  ChatMessageReceiptRow,
  ChatMessageType,
  ChatGroupMemberRow,
  ChatReceiptDetailRow,
} from '@/services/chatContract';

const PAGE_SIZE = 50;
const INBOX_PAGE_SIZE = 30;

function client() {
  return getSupabaseClient();
}

function assertData<T>(data: T | null, error: { message?: string } | null): T {
  if (error) throw new Error(error.message || 'chat_request_failed');
  if (data === null) throw new Error('chat_response_missing');
  return data;
}

export function createChatClientMessageId(): string {
  return Crypto.randomUUID();
}

export async function getOrCreateDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await client().rpc('chat_get_or_create_direct', {
    p_other_user_id: otherUserId,
  });
  const row = assertData(data as { id?: string } | null, error);
  if (!row.id) throw new Error('chat_conversation_id_missing');
  return row.id;
}

export async function createChatGroup(groupId: string, groupName: string, memberIds: string[]): Promise<string> {
  const { data, error } = await client().rpc('chat_create_group', { p_group_id: groupId, p_group_name: groupName, p_member_ids: memberIds });
  const row = assertData(data as { id?: string } | null, error);
  if (!row.id) throw new Error('chat_group_id_missing');
  return row.id;
}

export async function updateChatGroupName(conversationId: string, groupName: string): Promise<void> {
  const { error } = await client().rpc('chat_update_group_name', { p_conversation_id: conversationId, p_group_name: groupName });
  if (error) throw new Error(error.message || 'chat_group_update_failed');
}
export async function addChatGroupMembers(conversationId: string, userIds: string[]): Promise<number> {
  const { data, error } = await client().rpc('chat_add_group_members', { p_conversation_id: conversationId, p_user_ids: userIds });
  return Number(assertData(data as number | null, error));
}
export async function removeChatGroupMember(conversationId: string, userId: string): Promise<void> {
  const { error } = await client().rpc('chat_remove_group_member', { p_conversation_id: conversationId, p_user_id: userId });
  if (error) throw new Error(error.message || 'chat_group_remove_failed');
}
export async function setChatGroupAdmin(conversationId: string, userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await client().rpc('chat_set_group_admin', { p_conversation_id: conversationId, p_user_id: userId, p_is_admin: isAdmin });
  if (error) throw new Error(error.message || 'chat_group_role_failed');
}
export async function transferChatGroupOwnership(conversationId: string, userId: string): Promise<void> {
  const { error } = await client().rpc('chat_transfer_group_ownership', { p_conversation_id: conversationId, p_new_owner_id: userId });
  if (error) throw new Error(error.message || 'chat_group_transfer_failed');
}
export async function leaveChatGroup(conversationId: string): Promise<void> {
  const { error } = await client().rpc('chat_leave_group', { p_conversation_id: conversationId });
  if (error) throw new Error(error.message || 'chat_group_leave_failed');
}
export async function fetchChatGroupMembers(conversationId: string): Promise<ChatGroupMemberRow[]> {
  const { data, error } = await client().rpc('chat_get_members', { p_conversation_id: conversationId });
  return assertData((data ?? null) as ChatGroupMemberRow[] | null, error);
}
export async function fetchChatMessageReceipts(messageId: string): Promise<ChatReceiptDetailRow[]> {
  const { data, error } = await client().rpc('chat_get_message_receipts', { p_message_id: messageId });
  return assertData((data ?? null) as ChatReceiptDetailRow[] | null, error);
}

export async function sendChatMessage(input: {
  conversationId: string;
  clientMessageId: string;
  text: string;
  messageType: Extract<ChatMessageType, 'text' | 'image' | 'video' | 'one_time_image' | 'voice'>;
  mediaUrl?: string;
  mediaAssetId?: string;
  replyToMessageId?: string;
  audioDurationMs?: number;
  audioWaveform?: number[];
}): Promise<ChatMessageRow> {
  const { data, error } = await client().rpc('chat_send_message', {
    p_conversation_id: input.conversationId,
    p_client_message_id: input.clientMessageId,
    p_text: input.text,
    p_message_type: input.messageType,
    p_media_url: input.mediaUrl ?? null,
    p_media_asset_id: input.mediaAssetId ?? null,
    p_reply_to_message_id: input.replyToMessageId ?? null,
    p_audio_duration_ms: input.audioDurationMs ?? null,
    p_audio_waveform: input.audioWaveform ?? null,
  });
  return assertData(data as ChatMessageRow | null, error);
}

export async function fetchChatConversations(
  cursor?: ChatConversationCursor,
): Promise<ChatConversationPageRow[]> {
  const { data, error } = await client().rpc('chat_get_conversations', {
    p_limit: INBOX_PAGE_SIZE,
    p_before_activity_at: cursor?.lastActivityAt ?? null,
    p_before_id: cursor?.id ?? null,
  });
  return assertData((data ?? null) as ChatConversationPageRow[] | null, error);
}

export async function fetchRecentChatMessages(
  conversationId: string,
  cursor?: ChatCursor,
): Promise<ChatMessageWithReceiptRow[]> {
  const { data, error } = await client().rpc('chat_get_recent_messages_v3', {
    p_conversation_id: conversationId,
    p_limit: PAGE_SIZE,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  });
  return assertData((data ?? null) as ChatMessageWithReceiptRow[] | null, error);
}

export async function acknowledgePendingChatDeliveries(limit = 100): Promise<number> {
  const { data, error } = await client().rpc('chat_acknowledge_pending_deliveries', { p_limit: limit });
  return Number(assertData(data as number | null, error));
}

export async function acknowledgeChatReads(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const { data, error } = await client().rpc('chat_acknowledge_read_batch', { p_message_ids: messageIds });
  return Number(assertData(data as number | null, error));
}

export async function fetchChatUserProfile(userId: string): Promise<{
  username: string | null;
  avatar_url: string | null;
} | null> {
  const { data, error } = await client()
    .from('user_profiles')
    .select('username, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'chat_profile_failed');
  return data;
}

export async function acknowledgeChatDelivery(messageId: string): Promise<void> {
  const { error } = await client().rpc('chat_acknowledge_delivery', { p_message_id: messageId });
  if (error) throw new Error(error.message || 'chat_delivery_failed');
}

export async function acknowledgeChatRead(messageId: string): Promise<void> {
  const { error } = await client().rpc('chat_acknowledge_read', { p_message_id: messageId });
  if (error) throw new Error(error.message || 'chat_read_failed');
}

export async function markChatConversationRead(conversationId: string): Promise<void> {
  const { error } = await client().rpc('chat_mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message || 'chat_mark_conversation_read_failed');
}

export function subscribeToChatChanges(input: {
  userId: string;
  onMessage: (row: ChatMessageRow) => void;
  onReceipt: (row: ChatMessageReceiptRow) => void;
  onReconcile: () => void;
  onSubscribed?: () => void;
}): () => void {
  const supabase = client();
  let active = true;
  const channel = supabase
    .channel(`chat-v2:${input.userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (active) input.onMessage(payload.new as ChatMessageRow);
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_message_receipts',
    }, payload => {
      if (!active) return;
      input.onReceipt(payload.new as ChatMessageReceiptRow);
      input.onReconcile();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_conversations' }, () => {
      if (active) input.onReconcile();
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_conversation_members', filter: `user_id=eq.${input.userId}`,
    }, () => { if (active) input.onReconcile(); })
    .subscribe(status => {
      if (active && status === 'SUBSCRIBED') {
        input.onSubscribed?.();
        input.onReconcile();
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
