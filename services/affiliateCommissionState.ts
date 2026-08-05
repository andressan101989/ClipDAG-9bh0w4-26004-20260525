export function creatorCommissionPercentToBps(value: string | number): number {
  const percent = typeof value === "number" ? value : Number(value.trim());
  const bps = Math.round(percent * 100);
  if (
    !Number.isFinite(percent) ||
    percent <= 0 ||
    percent > 30 ||
    Math.abs(percent * 100 - bps) > 1e-8 ||
    bps < 1 ||
    bps > 3000
  ) {
    throw new Error("live_affiliate_invalid_offer");
  }
  return bps;
}

export function creatorCommissionBpsToPercent(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3000) {
    throw new Error("live_affiliate_invalid_offer");
  }
  return (value / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
