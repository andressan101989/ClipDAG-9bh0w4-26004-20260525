const PRICE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;

function groupedWhole(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function decimalParts(value) {
  if (value === null || value === undefined || typeof value !== 'string') return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  return {
    negative: match[1] === '-',
    whole: match[2].replace(/^0+(?=\d)/, ''),
    fraction: match[3] ?? '',
  };
}

function roundedMinorUnits(parts) {
  let minorUnits = BigInt(parts.whole) * 100n + BigInt((parts.fraction + '00').slice(0, 2));
  if ((parts.fraction[2] ?? '0') >= '5') minorUnits += 1n;
  return minorUnits;
}

export function normalizeCreatorPremiumPriceBdag(input) {
  const normalized = input.trim().replace(',', '.');
  if (!PRICE_PATTERN.test(normalized)) throw new Error('creator_premium_price_invalid');
  const [whole, fraction = ''] = normalized.split('.');
  const significantFraction = fraction.replace(/0+$/, '');
  if (whole === '0' && !significantFraction) throw new Error('creator_premium_price_invalid');
  return significantFraction ? `${whole}.${significantFraction}` : whole;
}

export function formatCreatorPremiumBdag(value, options = {}) {
  const empty = typeof options.empty === 'string' ? options.empty : 'Sin precio';
  if (value === null || value === undefined) return empty;
  const parts = decimalParts(value);
  if (!parts) return '— BDAG';
  const minorUnits = roundedMinorUnits(parts);
  const displayWhole = (minorUnits / 100n).toString();
  const displayFraction = (minorUnits % 100n).toString().padStart(2, '0');
  const sign = parts.negative && minorUnits !== 0n ? '-' : '';
  return `${sign}${groupedWhole(displayWhole)},${displayFraction} BDAG`;
}

export function formatCreatorPremiumPriceInput(value) {
  const parts = decimalParts(value);
  if (!parts || parts.negative) return '';
  const minorUnits = roundedMinorUnits(parts);
  return `${minorUnits / 100n},${(minorUnits % 100n).toString().padStart(2, '0')}`;
}

export function resolveCreatorPremiumPriceSubmission({ displayValue, originalCanonical, edited }) {
  if (!edited && typeof originalCanonical === 'string') {
    normalizeCreatorPremiumPriceBdag(originalCanonical);
    return originalCanonical.trim();
  }
  return normalizeCreatorPremiumPriceBdag(displayValue);
}
