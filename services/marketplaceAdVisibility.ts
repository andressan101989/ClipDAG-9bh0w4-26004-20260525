export const MARKETPLACE_AD_VISIBLE_RATIO = 0.5;
export const MARKETPLACE_AD_VISIBLE_MS = 500;

export type MarketplaceAdVisibilityDecision =
  | "wait"
  | "start_timer"
  | "cancel_timer"
  | "record"
  | "already_sent";

export function marketplaceAdVisibilityDecision(input: {
  visibleRatio: number;
  visibleSince: number | null;
  now: number;
  sent: boolean;
}): MarketplaceAdVisibilityDecision {
  if (input.sent) return "already_sent";
  if (input.visibleRatio < MARKETPLACE_AD_VISIBLE_RATIO)
    return input.visibleSince === null ? "wait" : "cancel_timer";
  if (input.visibleSince === null) return "start_timer";
  return input.now - input.visibleSince >= MARKETPLACE_AD_VISIBLE_MS
    ? "record"
    : "wait";
}
