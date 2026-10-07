/**
 * services/premiumDmService.ts
 *
 * Premium DM: configure, send (escrow), release, refund.
 */
import { creatorPremiumUnavailable } from '@/services/creatorPremiumService';

export interface PremiumDMConfig {
  user_id: string;
  enabled: boolean;
  price_bdag: number;
  welcome_message: string;
  total_earned: number;
  messages_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface PremiumDMPayment {
  id: string;
  message_id: string;
  sender_id: string;
  recipient_id: string;
  amount_bdag: number;
  platform_fee: number;
  creator_earning: number;
  status: 'held' | 'released' | 'refunded' | 'expired';
  responded_at?: string;
  expires_at: string;
  created_at: string;
  sender?: { username: string; avatar_url: string | null };
  message_text?: string;
}

/** Premium DM remains outside B1 and cannot perform a network mutation. */
export async function configurePremiumDm(opts: {
  enabled: boolean; priceBdag: number; welcomeMessage?: string;
}): Promise<{ success: boolean; error?: string }> {
  void opts;
  return creatorPremiumUnavailable();
}

/** Get Premium DM config for any user */
export async function getPremiumDMConfig(userId: string): Promise<PremiumDMConfig | null> {
  void userId;
  return null;
}

/** Send a premium DM — BDAG held in escrow until creator responds */
export async function sendPremiumDM(opts: {
  recipientId: string; amountBdag: number; messageText: string;
}): Promise<{
  success: boolean; error?: string;
  is_free_dm?: boolean; new_balance?: number; message_id?: string;
}> {
  void opts;
  return creatorPremiumUnavailable();
}

/** Release Premium DM escrow (creator confirms reply) */
export async function releasePremiumDM(creatorId: string, messageId: string): Promise<{
  success: boolean; error?: string; creator_earned?: number; new_balance?: number;
}> {
  void creatorId;
  void messageId;
  return creatorPremiumUnavailable();
}

/** Fetch pending premium DM payments for creator inbox */
export async function fetchPendingPremiumDMs(creatorId: string): Promise<PremiumDMPayment[]> {
  void creatorId;
  return [];
}

/** Fetch all premium DM history for a user (sent or received) */
export async function fetchPremiumDMHistory(userId: string): Promise<PremiumDMPayment[]> {
  void userId;
  return [];
}
