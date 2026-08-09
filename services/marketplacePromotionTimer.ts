export const MAX_PROMOTION_TIMER_MS=2_147_000_000;

export function marketplacePromotionRefreshDelay(expiresAt:number,now=Date.now()){
  return Math.min(MAX_PROMOTION_TIMER_MS,Math.max(50,expiresAt-now+50));
}
