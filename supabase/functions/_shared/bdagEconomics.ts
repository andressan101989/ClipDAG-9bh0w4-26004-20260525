export const BDAG_PER_USD = 100;
export const STRIPE_MINIMUM_USD_CENTS = 50;
export const STRIPE_MAXIMUM_USD_CENTS = 99_999_999;

export function usdCentsToBdag(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("invalid_usd_cents");
  return (cents * BDAG_PER_USD) / 100;
}
