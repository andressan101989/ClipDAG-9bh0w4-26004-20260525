import { getSupabaseClient } from "@/template";

export interface MarketplaceCreatorShowcaseProduct {
  showcaseItemId: string | null;
  creatorUserId?: string;
  productId: string;
  sellerId: string;
  storeId: string;
  title: string;
  storeName: string;
  sellerName?: string;
  imageUrl: string | null;
  minPrice: number;
  maxPrice: number;
  availableQuantity: number;
  commissionBps?: number;
  offerScope?: "public_creator" | "specific_creator";
  selected?: boolean;
  sortPosition?: number;
  updatedAt?: string;
}

export interface MarketplaceCreatorShowcaseManagementItem
  extends MarketplaceCreatorShowcaseProduct {
  showcaseItemId: string;
  status: "active" | "removed";
  selectedAt: string;
  removedAt: string | null;
  currentEligible: boolean;
  selectedEntitlementId: string;
  currentEntitlementId: string | null;
}

export interface MarketplaceCreatorShowcasePage<T> {
  items: T[];
  nextCursor: Record<string, string | number> | null;
  visible?: boolean;
}

export interface MarketplaceCreatorShowcaseAttribution {
  id: string;
  creatorUserId: string;
  productId: string;
  variantId: string | null;
  sourceSurface: "creator_showcase";
  sourceEntityId: string;
}

export class MarketplaceCreatorShowcaseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MarketplaceCreatorShowcaseError";
  }
}

const db = () => getSupabaseClient();
const value = (input: unknown) => (input && typeof input === "object" ? input as Record<string, unknown> : {});
const text = (input: unknown) => typeof input === "string" ? input : "";
const nullableText = (input: unknown) => typeof input === "string" ? input : null;
const number = (input: unknown) => Number.isFinite(Number(input)) ? Number(input) : 0;
const rpcError = (error: unknown): never => {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : "marketplace_creator_showcase_unknown";
  throw new MarketplaceCreatorShowcaseError(message.match(/marketplace_[a-z0-9_]+/)?.[0] ?? "marketplace_creator_showcase_unknown");
};

function mapProduct(input: unknown): MarketplaceCreatorShowcaseProduct {
  const row = value(input);
  return {
    showcaseItemId: nullableText(row.showcase_item_id),
    creatorUserId: nullableText(row.creator_user_id) ?? undefined,
    productId: text(row.product_id),
    sellerId: text(row.seller_id),
    storeId: text(row.store_id),
    title: text(row.title),
    storeName: text(row.store_name),
    sellerName: nullableText(row.seller_name) ?? undefined,
    imageUrl: nullableText(row.image_url),
    minPrice: number(row.min_price),
    maxPrice: number(row.max_price),
    availableQuantity: number(row.available_quantity),
    commissionBps: row.commission_bps == null ? undefined : number(row.commission_bps),
    offerScope: row.offer_scope === "specific_creator" ? "specific_creator" : row.offer_scope === "public_creator" ? "public_creator" : undefined,
    selected: row.selected === true,
    sortPosition: row.sort_position == null ? undefined : number(row.sort_position),
    updatedAt: nullableText(row.updated_at) ?? undefined,
  };
}

export async function fetchMyCreatorEligibleProducts(input: {
  search?: string;
  limit?: number;
  cursor?: { updatedAt: string; id: string } | null;
} = {}): Promise<MarketplaceCreatorShowcasePage<MarketplaceCreatorShowcaseProduct>> {
  const { data, error } = await db().rpc("get_my_marketplace_creator_eligible_products", {
    p_search: input.search?.trim() || null,
    p_limit: input.limit ?? 20,
    p_before_updated_at: input.cursor?.updatedAt ?? null,
    p_before_id: input.cursor?.id ?? null,
  });
  if (error) rpcError(error);
  const payload = value(data);
  const cursor = value(payload.next_cursor);
  return {
    items: Array.isArray(payload.items) ? payload.items.map(mapProduct) : [],
    nextCursor: cursor.updated_at && cursor.id
      ? { updatedAt: text(cursor.updated_at), id: text(cursor.id) }
      : null,
  };
}

export async function fetchMyCreatorShowcase(): Promise<MarketplaceCreatorShowcaseManagementItem[]> {
  const { data, error } = await db().rpc("get_my_marketplace_creator_showcase", {
    p_limit: 100,
    p_before_selected_at: null,
    p_before_id: null,
  });
  if (error) rpcError(error);
  const payload = value(data);
  return (Array.isArray(payload.items) ? payload.items : []).map((input) => {
    const row = value(input);
    return {
      ...mapProduct(row),
      showcaseItemId: text(row.id),
      status: row.status === "removed" ? "removed" : "active",
      selectedAt: text(row.selected_at),
      removedAt: nullableText(row.removed_at),
      currentEligible: row.current_eligible === true,
      selectedEntitlementId: text(row.selected_entitlement_id),
      currentEntitlementId: nullableText(row.current_entitlement_id),
      commissionBps: row.current_commission_bps == null ? undefined : number(row.current_commission_bps),
    };
  });
}

export async function fetchCreatorShowcase(
  creatorUserId: string,
  cursor?: { sortPosition: number; id: string } | null,
): Promise<MarketplaceCreatorShowcasePage<MarketplaceCreatorShowcaseProduct>> {
  const { data, error } = await db().rpc("get_marketplace_creator_showcase", {
    p_creator_user_id: creatorUserId,
    p_limit: 24,
    p_before_sort_position: cursor?.sortPosition ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (error) rpcError(error);
  const payload = value(data);
  const next = value(payload.next_cursor);
  return {
    items: Array.isArray(payload.items) ? payload.items.map(mapProduct) : [],
    nextCursor: next.sort_position != null && next.id
      ? { sortPosition: number(next.sort_position), id: text(next.id) }
      : null,
    visible: payload.visible !== false,
  };
}

export async function addMyCreatorShowcaseProduct(productId: string, idempotencyKey: string) {
  const { data, error } = await db().rpc("add_my_marketplace_creator_showcase_product", {
    p_product_id: productId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) rpcError(error);
  return value(data);
}

export async function removeMyCreatorShowcaseProduct(showcaseItemId: string, idempotencyKey: string) {
  const { data, error } = await db().rpc("remove_my_marketplace_creator_showcase_product", {
    p_showcase_item_id: showcaseItemId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) rpcError(error);
  return value(data);
}

export async function reorderMyCreatorShowcase(showcaseItemIds: string[], idempotencyKey: string) {
  const { data, error } = await db().rpc("reorder_my_marketplace_creator_showcase", {
    p_showcase_item_ids: showcaseItemIds,
    p_idempotency_key: idempotencyKey,
  });
  if (error) rpcError(error);
  return value(data);
}

export async function createCreatorShowcaseAttribution(
  showcaseItemId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<MarketplaceCreatorShowcaseAttribution> {
  const { data, error } = await db().rpc("create_marketplace_creator_showcase_attribution", {
    p_showcase_item_id: showcaseItemId,
    p_variant_id: variantId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) rpcError(error);
  const row = value(data);
  if (row.source_surface !== "creator_showcase") throw new MarketplaceCreatorShowcaseError("marketplace_creator_showcase_invalid_receipt");
  return {
    id: text(row.id),
    creatorUserId: text(row.creator_user_id),
    productId: text(row.product_id),
    variantId: nullableText(row.variant_id),
    sourceSurface: "creator_showcase",
    sourceEntityId: text(row.source_entity_id),
  };
}
