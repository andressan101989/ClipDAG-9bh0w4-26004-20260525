export type LiveGiftCategory = 'basic' | 'premium' | 'legendary';

export type LiveGiftAnimationType =
  | 'floating'
  | 'center'
  | 'fullscreen'
  | 'entrance'
  | 'celebration';

export type LiveGiftDefinition = {
  id: string;
  name: string;
  priceBdag: number;
  icon: string;
  category: LiveGiftCategory;
  animationType: LiveGiftAnimationType;
  animationAsset?: string | null;
  durationMs: number;
  priority: number;
  enabled: boolean;
};

export type LiveGiftEvent = {
  eventId?: string | null;
  transactionId: string;
  sessionId: string;
  senderUserId?: string | null;
  senderUsername?: string | null;
  senderAvatarUrl?: string | null;
  giftId: string;
  giftName: string;
  icon: string;
  amountBdag: number;
  category: LiveGiftCategory;
  animationType: LiveGiftAnimationType;
  animationAsset?: string | null;
  durationMs: number;
  priority: number;
  createdAt: number;
};

export type LiveGiftSendResult = {
  success: boolean;
  error?: string;
  transaction_id?: string;
  gift_id?: string;
  gift_name?: string;
  emoji?: string;
  icon?: string;
  amount_coins?: number;
  amount_bdag?: number;
  creator_amount_coins?: number;
  new_sender_balance?: number;
  receiver_user_id?: string;
  recipient_user_id?: string;
  category?: LiveGiftCategory;
  animation_type?: LiveGiftAnimationType;
  animation_asset?: string | null;
  duration_ms?: number;
  priority?: number;
};
