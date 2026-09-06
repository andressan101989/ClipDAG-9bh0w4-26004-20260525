export type ChatConversationType = 'direct' | 'group';
export type ChatConversationStatus = 'active' | 'closed';
export type ChatMemberRole = 'owner' | 'admin' | 'member';
export type ChatMessageType = 'text' | 'image' | 'video' | 'premium_dm' | 'one_time_image' | 'voice' | 'system';
export type ChatDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ChatMessageRow = {
  id: string;
  conversation_id: string;
  client_message_id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  media_url: string | null;
  media_type: string;
  message_type: ChatMessageType;
  reply_to_message_id: string | null;
  media_asset_id: string | null;
  consumption_policy: 'standard' | 'one_time';
  audio_duration_ms: number | null;
  read: boolean;
  deleted_at: string | null;
  created_at: string;
};

export type ChatConversationPageRow = {
  conversation_id: string;
  conversation_type: ChatConversationType;
  conversation_status: ChatConversationStatus;
  last_activity_at: string;
  other_user_id: string;
  other_username: string | null;
  other_avatar_url: string | null;
  last_message: ChatMessageRow | null;
  unread_count: number;
};

export type ChatCursor = { createdAt: string; id: string };
export type ChatConversationCursor = { lastActivityAt: string; id: string };

export type ChatMessageReceiptRow = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
  legacy_delivered: boolean;
  legacy_read: boolean;
};
