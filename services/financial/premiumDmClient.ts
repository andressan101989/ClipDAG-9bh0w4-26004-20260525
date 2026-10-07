/**
 * Legacy Premium DM compatibility surface.
 *
 * CREATOR-PREMIUM-B1 intentionally has no Premium DM financial authority.
 * These exports remain so historical callers fail honestly and locally rather
 * than querying absent tables or invoking the undeployed bdag-economy worker.
 */
import { creatorPremiumUnavailable } from '@/services/creatorPremiumService';

export async function getPremiumDmConfig(_creatorId: string) {
  return null;
}

export async function updatePremiumDmConfig(_params: {
  enabled: boolean;
  priceBdag: number;
  welcomeMessage?: string;
}) {
  return creatorPremiumUnavailable();
}

export async function sendPremiumDM(_params: {
  recipientId: string;
  messageText: string;
  amountBdag: number;
}): Promise<{
  success: false;
  error: string;
  code: 'creator_premium_b1_foundation_only';
  messageId?: never;
  paymentId?: never;
  isFree?: never;
}> {
  return creatorPremiumUnavailable();
}

export async function releasePremiumDMPayment(_paymentId: string): Promise<{
  success: false;
  error: string;
  code: 'creator_premium_b1_foundation_only';
  released?: never;
}> {
  return creatorPremiumUnavailable();
}

export async function fetchPremiumDmInbox(_creatorId: string) {
  return [];
}
