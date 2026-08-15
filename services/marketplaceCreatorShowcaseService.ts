import { getSupabaseClient } from "@/template";
import {
  rpcArray,
  rpcBoundedInteger,
  rpcBoolean,
  rpcEnum,
  rpcNonnegative,
  rpcNonnegativeInteger,
  rpcNullableString,
  rpcNullableTimestamp,
  rpcNullableUuid,
  rpcObject,
  rpcString,
  rpcTimestamp,
  rpcUuid,
} from "./marketplaceRuntimeValidation";

export interface MarketplaceCreatorShowcaseProduct {
  showcaseItemId: string | null;
  creatorUserId?: string;
  productId: string;
  sellerId?: string;
  storeId?: string;
  title: string;
  storeName: string;
  sellerName?: string;
  imageUrl: string | null;
  minPrice: number;
  maxPrice?: number;
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
  productId: string;
  title: string;
  storeName: string;
  imageUrl: string | null;
  minPrice: number;
  availableQuantity: number;
  sortPosition: number;
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
const rpcError = (error: unknown): never => {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "marketplace_creator_showcase_unknown";
  throw new MarketplaceCreatorShowcaseError(
    message.match(/marketplace_[a-z0-9_]+/)?.[0] ??
      "marketplace_creator_showcase_unknown",
  );
};

export function parseCreatorShowcaseProduct(
  input: unknown,
): MarketplaceCreatorShowcaseProduct {
  const row = rpcObject(input, "creator_showcase.product");
  return {
    showcaseItemId:
      row.showcase_item_id == null
        ? null
        : rpcUuid(
            row.showcase_item_id,
            "creator_showcase.product.showcase_item_id",
          ),
    creatorUserId:
      row.creator_user_id == null
        ? undefined
        : rpcUuid(
            row.creator_user_id,
            "creator_showcase.product.creator_user_id",
          ),
    productId: rpcUuid(row.product_id, "creator_showcase.product.product_id"),
    sellerId: rpcUuid(row.seller_id, "creator_showcase.product.seller_id"),
    storeId: rpcUuid(row.store_id, "creator_showcase.product.store_id"),
    title: rpcString(row.title, "creator_showcase.product.title"),
    storeName: rpcString(row.store_name, "creator_showcase.product.store_name"),
    sellerName:
      rpcNullableString(
        row.seller_name,
        "creator_showcase.product.seller_name",
      ) ?? undefined,
    imageUrl: rpcNullableString(
      row.image_url,
      "creator_showcase.product.image_url",
    ),
    minPrice: rpcNonnegative(
      row.min_price,
      "creator_showcase.product.min_price",
    ),
    maxPrice: rpcNonnegative(
      row.max_price,
      "creator_showcase.product.max_price",
    ),
    availableQuantity: rpcNonnegativeInteger(
      row.available_quantity,
      "creator_showcase.product.available_quantity",
    ),
    commissionBps:
      row.commission_bps == null
        ? undefined
        : rpcBoundedInteger(
            row.commission_bps,
            1,
            3000,
            "creator_showcase.product.commission_bps",
          ),
    offerScope:
      row.offer_scope == null
        ? undefined
        : rpcEnum(
            row.offer_scope,
            ["public_creator", "specific_creator"] as const,
            "creator_showcase.product.offer_scope",
          ),
    selected:
      row.selected == null
        ? undefined
        : rpcBoolean(row.selected, "creator_showcase.product.selected"),
    sortPosition:
      row.sort_position == null
        ? undefined
        : rpcNonnegativeInteger(
            row.sort_position,
            "creator_showcase.product.sort_position",
          ),
    updatedAt:
      row.updated_at == null
        ? undefined
        : rpcTimestamp(row.updated_at, "creator_showcase.product.updated_at"),
  };
}

export async function fetchMyCreatorEligibleProducts(
  input: {
    search?: string;
    limit?: number;
    cursor?: { updatedAt: string; id: string } | null;
  } = {},
): Promise<MarketplaceCreatorShowcasePage<MarketplaceCreatorShowcaseProduct>> {
  const { data, error } = await db().rpc(
    "get_my_marketplace_creator_eligible_products",
    {
      p_search: input.search?.trim() || null,
      p_limit: input.limit ?? 20,
      p_before_updated_at: input.cursor?.updatedAt ?? null,
      p_before_id: input.cursor?.id ?? null,
    },
  );
  if (error) rpcError(error);
  const payload = rpcObject(data, "creator_showcase.eligible"),
    cursor =
      payload.next_cursor === null
        ? null
        : rpcObject(
            payload.next_cursor,
            "creator_showcase.eligible.next_cursor",
          );
  return {
    items: rpcArray(payload.items, "creator_showcase.eligible.items").map(
      parseCreatorShowcaseProduct,
    ),
    nextCursor: cursor
      ? {
          updatedAt: rpcTimestamp(
            cursor.updated_at,
            "creator_showcase.eligible.next_cursor.updated_at",
          ),
          id: rpcUuid(cursor.id, "creator_showcase.eligible.next_cursor.id"),
        }
      : null,
  };
}

export async function fetchMyCreatorShowcase(): Promise<
  MarketplaceCreatorShowcaseManagementItem[]
> {
  const { data, error } = await db().rpc(
    "get_my_marketplace_creator_showcase",
    {
      p_limit: 100,
      p_before_selected_at: null,
      p_before_id: null,
    },
  );
  if (error) rpcError(error);
  const payload = rpcObject(data, "creator_showcase.management");
  return rpcArray(payload.items, "creator_showcase.management.items").map(
    (input) => {
      const row = rpcObject(input, "creator_showcase.management.item");
      return {
        showcaseItemId: rpcUuid(row.id, "creator_showcase.management.id"),
        productId: rpcUuid(
          row.product_id,
          "creator_showcase.management.product_id",
        ),
        title: rpcString(row.title, "creator_showcase.management.title"),
        storeName: rpcString(
          row.store_name,
          "creator_showcase.management.store_name",
        ),
        imageUrl: rpcNullableString(
          row.image_url,
          "creator_showcase.management.image_url",
        ),
        minPrice: rpcNonnegative(
          row.min_price,
          "creator_showcase.management.min_price",
        ),
        availableQuantity: rpcNonnegativeInteger(
          row.available_quantity,
          "creator_showcase.management.available_quantity",
        ),
        sortPosition: rpcNonnegativeInteger(
          row.sort_position,
          "creator_showcase.management.sort_position",
        ),
        status: rpcEnum(
          row.status,
          ["active", "removed"] as const,
          "creator_showcase.management.status",
        ),
        selectedAt: rpcTimestamp(
          row.selected_at,
          "creator_showcase.management.selected_at",
        ),
        removedAt: rpcNullableTimestamp(
          row.removed_at,
          "creator_showcase.management.removed_at",
        ),
        currentEligible: rpcBoolean(
          row.current_eligible,
          "creator_showcase.management.current_eligible",
        ),
        selectedEntitlementId: rpcUuid(
          row.selected_entitlement_id,
          "creator_showcase.management.selected_entitlement_id",
        ),
        currentEntitlementId: rpcNullableUuid(
          row.current_entitlement_id,
          "creator_showcase.management.current_entitlement_id",
        ),
        commissionBps:
          row.current_commission_bps == null
            ? undefined
            : rpcBoundedInteger(
                row.current_commission_bps,
                1,
                3000,
                "creator_showcase.management.current_commission_bps",
              ),
      };
    },
  );
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
  const payload = rpcObject(data, "creator_showcase.public"),
    next =
      payload.next_cursor === null
        ? null
        : rpcObject(payload.next_cursor, "creator_showcase.public.next_cursor");
  return {
    items: rpcArray(payload.items, "creator_showcase.public.items").map(
      parseCreatorShowcaseProduct,
    ),
    nextCursor: next
      ? {
          sortPosition: rpcNonnegativeInteger(
            next.sort_position,
            "creator_showcase.public.next_cursor.sort_position",
          ),
          id: rpcUuid(next.id, "creator_showcase.public.next_cursor.id"),
        }
      : null,
    visible: rpcBoolean(payload.visible, "creator_showcase.public.visible"),
  };
}

export async function addMyCreatorShowcaseProduct(
  productId: string,
  idempotencyKey: string,
) {
  const { data, error } = await db().rpc(
    "add_my_marketplace_creator_showcase_product",
    {
      p_product_id: productId,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) rpcError(error);
  return rpcObject(data, "creator_showcase.add_receipt");
}

export async function removeMyCreatorShowcaseProduct(
  showcaseItemId: string,
  idempotencyKey: string,
) {
  const { data, error } = await db().rpc(
    "remove_my_marketplace_creator_showcase_product",
    {
      p_showcase_item_id: showcaseItemId,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) rpcError(error);
  return rpcObject(data, "creator_showcase.remove_receipt");
}

export async function reorderMyCreatorShowcase(
  showcaseItemIds: string[],
  idempotencyKey: string,
) {
  const { data, error } = await db().rpc(
    "reorder_my_marketplace_creator_showcase",
    {
      p_showcase_item_ids: showcaseItemIds,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) rpcError(error);
  return rpcObject(data, "creator_showcase.reorder_receipt");
}

export async function createCreatorShowcaseAttribution(
  showcaseItemId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<MarketplaceCreatorShowcaseAttribution> {
  const { data, error } = await db().rpc(
    "create_marketplace_creator_showcase_attribution",
    {
      p_showcase_item_id: showcaseItemId,
      p_variant_id: variantId,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) rpcError(error);
  const row = rpcObject(data, "creator_showcase.attribution");
  if (row.source_surface !== "creator_showcase")
    throw new MarketplaceCreatorShowcaseError(
      "marketplace_creator_showcase_invalid_receipt",
    );
  return {
    id: rpcUuid(row.id, "creator_showcase.attribution.id"),
    creatorUserId: rpcUuid(
      row.creator_user_id,
      "creator_showcase.attribution.creator_user_id",
    ),
    productId: rpcUuid(
      row.product_id,
      "creator_showcase.attribution.product_id",
    ),
    variantId: rpcNullableUuid(
      row.variant_id,
      "creator_showcase.attribution.variant_id",
    ),
    sourceSurface: "creator_showcase",
    sourceEntityId: rpcUuid(
      row.source_entity_id,
      "creator_showcase.attribution.source_entity_id",
    ),
  };
}
