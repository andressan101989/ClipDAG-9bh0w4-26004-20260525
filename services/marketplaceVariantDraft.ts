export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_OPTION_VALUES = 20;
export const MAX_PRODUCT_VARIANTS = 100;

export interface VariantDraftOption {
  name: string;
  valuesText: string;
}

export interface ParsedVariantOption {
  name: string;
  values: string[];
}

export interface CreationVariantDraft {
  key: string;
  optionValues: string[];
  sku: string;
  price: string;
  compareAtPrice: string;
  onHand: string;
  threshold: string;
  imageAssetId: string | null;
  active: boolean;
  isDefault: boolean;
}

export class VariantDraftValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'VariantDraftValidationError';
  }
}

const normalizeComparable = (value: string) => value.trim().toLocaleLowerCase('es');

export function parseVariantOptions(options: VariantDraftOption[]): ParsedVariantOption[] {
  if (options.length < 1) {
    throw new VariantDraftValidationError('options_required', 'Agrega al menos una opción.');
  }
  if (options.length > MAX_PRODUCT_OPTIONS) {
    throw new VariantDraftValidationError('too_many_options', 'Puedes agregar hasta tres opciones.');
  }
  const names = new Set<string>();
  return options.map((option, optionIndex) => {
    const name = option.name.trim();
    if (!name) {
      throw new VariantDraftValidationError('empty_option_name', `Escribe el nombre de la opción ${optionIndex + 1}.`);
    }
    const normalizedName = normalizeComparable(name);
    if (names.has(normalizedName)) {
      throw new VariantDraftValidationError('duplicate_option_name', 'Los nombres de las opciones no pueden repetirse.');
    }
    names.add(normalizedName);
    const rawValues = option.valuesText.split(',').map(value => value.trim());
    if (rawValues.some(value => !value)) {
      throw new VariantDraftValidationError('empty_option_value', `Elimina los valores vacíos de ${name}.`);
    }
    if (rawValues.length < 1) {
      throw new VariantDraftValidationError('values_required', `Agrega valores para ${name}.`);
    }
    if (rawValues.length > MAX_OPTION_VALUES) {
      throw new VariantDraftValidationError('too_many_values', `${name} admite hasta 20 valores.`);
    }
    const values = new Set<string>();
    rawValues.forEach(value => {
      const normalizedValue = normalizeComparable(value);
      if (values.has(normalizedValue)) {
        throw new VariantDraftValidationError('duplicate_option_value', `No repitas valores en ${name}.`);
      }
      values.add(normalizedValue);
    });
    return { name, values: rawValues };
  });
}

export function estimateVariantCount(options: VariantDraftOption[]): number {
  try {
    return parseVariantOptions(options).reduce((total, option) => total * option.values.length, 1);
  } catch {
    return 0;
  }
}

export function cartesianVariantValues(groups: string[][]): string[][] {
  return groups.reduce<string[][]>(
    (result, group) => result.flatMap(prefix => group.map(value => [...prefix, value])),
    [[]],
  );
}

function skuPart(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function generateVariantSku(prefix: string, values: string[], index: number): string {
  const safePrefix = skuPart(prefix) || 'PRODUCTO';
  const safeValues = values.map(skuPart).filter(Boolean).join('-') || `OPCION-${index + 1}`;
  const suffix = `-${String(index + 1).padStart(2, '0')}`;
  return `${safePrefix}-${safeValues}`.slice(0, 64 - suffix.length).replace(/[-._]+$/g, '') + suffix;
}

export function generateCreationVariants(
  options: VariantDraftOption[],
  input: { price: string; stock: string; skuPrefix: string },
): CreationVariantDraft[] {
  const parsed = parseVariantOptions(options);
  const combinations = cartesianVariantValues(parsed.map(option => option.values));
  if (combinations.length > MAX_PRODUCT_VARIANTS) {
    throw new VariantDraftValidationError('too_many_variants', 'La combinación supera el máximo de 100 variantes.');
  }
  return combinations.map((optionValues, index) => ({
    key: optionValues.map(normalizeComparable).join('\u001f'),
    optionValues,
    sku: generateVariantSku(input.skuPrefix, optionValues, index),
    price: input.price,
    compareAtPrice: '',
    onHand: input.stock,
    threshold: '0',
    imageAssetId: null,
    active: true,
    isDefault: index === 0,
  }));
}

export function validateCreationVariants(variants: CreationVariantDraft[]): void {
  if (variants.length < 1 || variants.length > MAX_PRODUCT_VARIANTS) {
    throw new VariantDraftValidationError('invalid_variant_count', 'Genera entre 1 y 100 variantes.');
  }
  if (variants.filter(item => item.isDefault).length !== 1) {
    throw new VariantDraftValidationError('default_required', 'Selecciona exactamente una variante predeterminada.');
  }
  const skus = new Set<string>();
  for (const variant of variants) {
    const normalizedSku = skuPart(variant.sku);
    if (!normalizedSku || normalizedSku.length > 64) {
      throw new VariantDraftValidationError('invalid_sku', 'Cada variante necesita un SKU válido de hasta 64 caracteres.');
    }
    if (skus.has(normalizedSku)) {
      throw new VariantDraftValidationError('duplicate_sku', 'Los SKU generados o escritos deben ser únicos.');
    }
    skus.add(normalizedSku);
    if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(variant.price) || Number(variant.price) <= 0) {
      throw new VariantDraftValidationError('invalid_price', 'Cada variante necesita un precio BDAG válido.');
    }
    if (variant.compareAtPrice && (
      !/^\d{1,12}(?:\.\d{1,8})?$/.test(variant.compareAtPrice)
      || Number(variant.compareAtPrice) < Number(variant.price)
    )) {
      throw new VariantDraftValidationError('invalid_compare_at_price', 'El precio anterior no puede ser menor al precio actual.');
    }
    const stock = Number(variant.onHand);
    const threshold = Number(variant.threshold || 0);
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000_000) {
      throw new VariantDraftValidationError('invalid_stock', 'El inventario inicial debe estar entre 0 y 1,000,000,000.');
    }
    if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 1_000_000_000) {
      throw new VariantDraftValidationError('invalid_threshold', 'El umbral debe estar entre 0 y 1,000,000,000.');
    }
  }
}
