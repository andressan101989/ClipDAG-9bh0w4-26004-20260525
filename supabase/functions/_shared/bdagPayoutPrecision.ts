import { BDAG_PER_USD } from './bdagEconomics.ts';

export const BDAG_SCALE = BigInt(100_000_000);

export function parseBdagUnits(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * BDAG_SCALE + BigInt(fraction.padEnd(8, '0'));
}

export function formatBdagUnits(value: bigint): string {
  const whole = value / BDAG_SCALE;
  const fraction = (value % BDAG_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function bdagUnitsToStablecoinUnits(value: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('invalid_stablecoin_decimals');
  }
  const stablecoinScale = BigInt(10) ** BigInt(decimals);
  return (value * stablecoinScale) / (BigInt(BDAG_PER_USD) * BDAG_SCALE);
}

export function formatStablecoinUnits(value: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function bdagUnitsToUsdString(value: bigint): string {
  const scale = BDAG_SCALE * BigInt(BDAG_PER_USD);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(10, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
