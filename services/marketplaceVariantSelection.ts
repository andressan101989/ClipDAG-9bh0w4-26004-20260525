import type { MarketplaceProductOption, MarketplaceVariant } from './marketplaceService';

export type MarketplaceVariantSelection = Record<string, string>;

export function variantMatchesSelection(
  variant: MarketplaceVariant,
  selectedValues: MarketplaceVariantSelection,
  ignoredOptionId?: string,
): boolean {
  return variant.status === 'active' && Object.entries(selectedValues).every(
    ([optionId, valueId]) => optionId === ignoredOptionId || !valueId || variant.option_value_ids.includes(valueId),
  );
}

export function isOptionValueSelectable(
  variants: MarketplaceVariant[], valueId: string,
  selectedValues: MarketplaceVariantSelection = {}, ignoredOptionId?: string,
): boolean {
  return variants.some(variant => variant.status === 'active'
    && variant.option_value_ids.includes(valueId)
    && variantMatchesSelection(variant, selectedValues, ignoredOptionId));
}

export function reconcileVariantSelection(
  options: MarketplaceProductOption[],
  variants: MarketplaceVariant[],
  previousSelection: MarketplaceVariantSelection,
  changedOptionId: string,
  changedValueId: string,
): MarketplaceVariantSelection {
  const candidates = variants.filter(
    variant => variant.status === 'active' && variant.option_value_ids.includes(changedValueId),
  );
  const otherSelections = options.filter(option => option.id !== changedOptionId && previousSelection[option.id]);
  const bestCandidate = candidates.reduce<MarketplaceVariant | undefined>((best, candidate) => {
    const preservedCount = otherSelections.filter(option =>
      candidate.option_value_ids.includes(previousSelection[option.id]),
    ).length;
    if (!best) return candidate;
    const bestPreservedCount = otherSelections.filter(option =>
      best.option_value_ids.includes(previousSelection[option.id]),
    ).length;
    return preservedCount > bestPreservedCount ? candidate : best;
  }, undefined);

  const next: MarketplaceVariantSelection = { [changedOptionId]: changedValueId };
  if (!bestCandidate) return next;
  for (const option of otherSelections) {
    const previousValueId = previousSelection[option.id];
    if (bestCandidate.option_value_ids.includes(previousValueId)) next[option.id] = previousValueId;
  }
  return next;
}

export function resolveExactVariant(
  options: MarketplaceProductOption[],
  variants: MarketplaceVariant[],
  selectedValues: MarketplaceVariantSelection,
): MarketplaceVariant | undefined {
  if (!options.every(option => Boolean(selectedValues[option.id]))) return undefined;
  return variants.find(variant =>
    variant.status === 'active'
    && variant.option_value_ids.length === options.length
    && options.every(option => variant.option_value_ids.includes(selectedValues[option.id])),
  );
}

export function selectionForPreferredVariant(
  options: MarketplaceProductOption[],
  variants: MarketplaceVariant[],
): MarketplaceVariantSelection {
  const preferred = variants.find(variant => variant.is_default && variant.status === 'active')
    ?? variants.find(variant => variant.status === 'active');
  if (!preferred) return {};
  return Object.fromEntries(options.flatMap(option => {
    const value = option.values.find(item => preferred.option_value_ids.includes(item.id));
    return value ? [[option.id, value.id]] : [];
  }));
}
