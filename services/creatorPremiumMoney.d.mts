export function normalizeCreatorPremiumPriceBdag(input: string): string;
export function formatCreatorPremiumBdag(
  value: string | null | undefined,
  options?: { empty?: string },
): string;
export function formatCreatorPremiumPriceInput(value: string | null | undefined): string;
export function resolveCreatorPremiumPriceSubmission(input: {
  displayValue: string;
  originalCanonical: string | null;
  edited: boolean;
}): string;
