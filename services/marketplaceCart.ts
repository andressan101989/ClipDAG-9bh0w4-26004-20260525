import type { MarketplaceProductDetail } from "./marketplaceService";

export const MAX_MARKETPLACE_CART_LINES = 100;

export interface MarketplaceCartOptionSelection {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
}

export type MarketplaceCartAvailability =
  | "available"
  | "out_of_stock"
  | "variant_unavailable"
  | "product_unavailable";

export interface MarketplaceCartItem {
  key: string;
  productId: string;
  variantId: string;
  sellerId: string;
  storeId: string;
  title: string;
  sellerUsername: string | null;
  sku: string | null;
  imageUrl: string | null;
  options: MarketplaceCartOptionSelection[];
  currency: "BDAG";
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  availableQuantitySnapshot: number;
  productUpdatedAt: string | null;
  availability: MarketplaceCartAvailability;
  addedAt: string;
  updatedAt: string;
  adCampaignId?: string;
  adTouchId?: string;
}

export type AddMarketplaceCartItemInput = Omit<
  MarketplaceCartItem,
  "key" | "addedAt" | "updatedAt" | "availability"
>;

export type CartMutationResult =
  | { ok: true; status: "added" | "merged"; item: MarketplaceCartItem }
  | {
      ok: true;
      status: "quantity_adjusted";
      item: MarketplaceCartItem;
      requested: number;
      applied: number;
    }
  | {
      ok: false;
      code:
        | "invalid_quantity"
        | "unavailable"
        | "cart_limit_reached"
        | "invalid_item"
        | "not_found";
    };

export const marketplaceCartKey = (productId: string, variantId: string) =>
  `${productId}:${variantId}`;
const positiveInteger = (value: number) => Number.isInteger(value) && value > 0;
const nonnegativeInteger = (value: number) =>
  Number.isInteger(value) && value >= 0;
const safePrice = (value: number) => Number.isFinite(value) && value > 0;
export const isPublicMarketplaceImageUrl = (value: string | null): boolean =>
  value === null ||
  (/^https:\/\//i.test(value) &&
    !/[?&](?:token|access_token|signature|expires|x-amz-[^=]*)=/i.test(value));

export function addMarketplaceCartItem(
  items: MarketplaceCartItem[],
  input: AddMarketplaceCartItemInput,
  now = new Date().toISOString(),
): { items: MarketplaceCartItem[]; result: CartMutationResult } {
  if (
    !input.productId ||
    !input.variantId ||
    !input.sellerId ||
    !input.storeId ||
    input.currency !== "BDAG" ||
    !positiveInteger(input.quantity) ||
    !positiveInteger(input.availableQuantitySnapshot) ||
    !safePrice(input.unitPrice) ||
    (input.compareAtPrice !== null && !safePrice(input.compareAtPrice)) ||
    typeof input.title !== "string" ||
    !input.title ||
    !Array.isArray(input.options) ||
    !input.options.every((option) =>
      Boolean(
        option.optionId && option.optionName && option.valueId && option.value,
      ),
    ) ||
    !isPublicMarketplaceImageUrl(input.imageUrl)
  )
    return { items, result: { ok: false, code: "invalid_item" } };
  const key = marketplaceCartKey(input.productId, input.variantId);
  const index = items.findIndex((item) => item.key === key);
  if (index < 0 && items.length >= MAX_MARKETPLACE_CART_LINES)
    return { items, result: { ok: false, code: "cart_limit_reached" } };
  const requested = (index >= 0 ? items[index].quantity : 0) + input.quantity;
  const applied = Math.min(requested, input.availableQuantitySnapshot);
  const item: MarketplaceCartItem = {
    ...input,
    key,
    quantity: applied,
    availability: "available",
    addedAt: index >= 0 ? items[index].addedAt : now,
    updatedAt: now,
  };
  const next =
    index >= 0
      ? items.map((current, itemIndex) =>
          itemIndex === index ? item : current,
        )
      : [...items, item];
  if (applied < requested)
    return {
      items: next,
      result: {
        ok: true,
        status: "quantity_adjusted",
        item,
        requested,
        applied,
      },
    };
  return {
    items: next,
    result: { ok: true, status: index >= 0 ? "merged" : "added", item },
  };
}

export function setMarketplaceCartQuantity(
  items: MarketplaceCartItem[],
  key: string,
  quantity: number,
  now = new Date().toISOString(),
): { items: MarketplaceCartItem[]; result: CartMutationResult } {
  if (!positiveInteger(quantity))
    return { items, result: { ok: false, code: "invalid_quantity" } };
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return { items, result: { ok: false, code: "not_found" } };
  const current = items[index];
  if (current.availability !== "available")
    return { items, result: { ok: false, code: "unavailable" } };
  const applied = Math.min(quantity, current.availableQuantitySnapshot);
  const item = { ...current, quantity: applied, updatedAt: now };
  const next = items.map((value, itemIndex) =>
    itemIndex === index ? item : value,
  );
  return applied < quantity
    ? {
        items: next,
        result: {
          ok: true,
          status: "quantity_adjusted",
          item,
          requested: quantity,
          applied,
        },
      }
    : { items: next, result: { ok: true, status: "merged", item } };
}

export function marketplaceCartTotals(items: MarketplaceCartItem[]) {
  const totalQuantity = items.reduce(
    (sum, item) => sum + (positiveInteger(item.quantity) ? item.quantity : 0),
    0,
  );
  const available = items.filter((item) => item.availability === "available");
  const subtotal = available.reduce((sum, item) => {
    if (!safePrice(item.unitPrice) || !positiveInteger(item.quantity))
      return sum;
    const line = item.unitPrice * item.quantity;
    return Number.isFinite(line) && line >= 0 ? sum + line : sum;
  }, 0);
  return {
    totalQuantity,
    distinctItemCount: items.length,
    availableItemCount: available.length,
    subtotal,
  };
}

export interface MarketplaceCartRevalidationResult {
  items: MarketplaceCartItem[];
  complete: boolean;
  adjustedItemCount: number;
  priceChangedKeys: string[];
  unavailableItemCount: number;
}

export async function revalidateMarketplaceCartItems(
  items: MarketplaceCartItem[],
  fetchDetail: (productId: string) => Promise<MarketplaceProductDetail | null>,
): Promise<MarketplaceCartRevalidationResult> {
  const details = new Map<string, MarketplaceProductDetail | null>();
  const failedProducts = new Set<string>();
  for (const productId of [...new Set(items.map((item) => item.productId))]) {
    try {
      details.set(productId, await fetchDetail(productId));
    } catch {
      failedProducts.add(productId);
    }
  }
  let adjustedItemCount = 0;
  const priceChangedKeys: string[] = [];
  const refreshed = items.map((item) => {
    if (failedProducts.has(item.productId)) return item;
    const detail = details.get(item.productId);
    const now = new Date().toISOString();
    if (!detail || detail.product.status !== "active")
      return {
        ...item,
        availability: "product_unavailable" as const,
        updatedAt: now,
      };
    const variant = detail.variants.find(
      (value) => value.id === item.variantId,
    );
    if (!variant || variant.status !== "active")
      return {
        ...item,
        availability: "variant_unavailable" as const,
        updatedAt: now,
      };
    if (variant.price !== item.unitPrice) priceChangedKeys.push(item.key);
    if (variant.available_quantity <= 0)
      return {
        ...item,
        availability: "out_of_stock" as const,
        availableQuantitySnapshot: 0,
        unitPrice: variant.price,
        compareAtPrice: variant.compare_at_price,
        updatedAt: now,
      };
    const quantity = Math.min(item.quantity, variant.available_quantity);
    if (quantity !== item.quantity) adjustedItemCount += 1;
    const options = detail.options.flatMap((option) => {
      const value = option.values.find((candidate) =>
        variant.option_value_ids.includes(candidate.id),
      );
      return value
        ? [
            {
              optionId: option.id,
              optionName: option.name,
              valueId: value.id,
              value: value.value,
            },
          ]
        : [];
    });
    const serverImage =
      variant.image_url && isPublicMarketplaceImageUrl(variant.image_url)
        ? variant.image_url
        : item.imageUrl;
    return {
      ...item,
      title: detail.product.title,
      sellerId: detail.product.seller_id,
      storeId: detail.product.store_id,
      sellerUsername: detail.product.seller?.username ?? null,
      sku: variant.sku,
      imageUrl: serverImage,
      options,
      currency: "BDAG" as const,
      unitPrice: variant.price,
      compareAtPrice: variant.compare_at_price,
      quantity,
      availableQuantitySnapshot: variant.available_quantity,
      productUpdatedAt: detail.product.updated_at,
      availability: "available" as const,
      updatedAt: now,
    };
  });
  return {
    items: refreshed,
    complete: failedProducts.size === 0,
    adjustedItemCount,
    priceChangedKeys,
    unavailableItemCount: refreshed.filter(
      (item) => item.availability !== "available",
    ).length,
  };
}

export function isMarketplaceCartItem(
  value: unknown,
): value is MarketplaceCartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MarketplaceCartItem>;
  const validAvailability = [
    "available",
    "out_of_stock",
    "variant_unavailable",
    "product_unavailable",
  ].includes(item.availability ?? "");
  const validImage =
    item.imageUrl === null ||
    (typeof item.imageUrl === "string" &&
      isPublicMarketplaceImageUrl(item.imageUrl));
  return (
    typeof item.productId === "string" &&
    Boolean(item.productId) &&
    typeof item.variantId === "string" &&
    Boolean(item.variantId) &&
    item.key === marketplaceCartKey(item.productId, item.variantId) &&
    typeof item.sellerId === "string" &&
    Boolean(item.sellerId) &&
    typeof item.storeId === "string" &&
    Boolean(item.storeId) &&
    typeof item.title === "string" &&
    item.currency === "BDAG" &&
    safePrice(item.unitPrice ?? NaN) &&
    (item.compareAtPrice === null || safePrice(item.compareAtPrice ?? NaN)) &&
    positiveInteger(item.quantity ?? NaN) &&
    nonnegativeInteger(item.availableQuantitySnapshot ?? NaN) &&
    validAvailability &&
    validImage &&
    Array.isArray(item.options) &&
    item.options.every((option) =>
      Boolean(
        option &&
          option.optionId &&
          option.optionName &&
          option.valueId &&
          option.value,
      ),
    ) &&
    (item.sellerUsername === null || typeof item.sellerUsername === "string") &&
    (item.sku === null || typeof item.sku === "string") &&
    (item.productUpdatedAt === null ||
      typeof item.productUpdatedAt === "string") &&
    typeof item.addedAt === "string" &&
    typeof item.updatedAt === "string"
  );
}
