import { getSupabaseClient } from "@/template";
import { marketplaceContentTypeForMedia as classifyContentMedia } from "./marketplaceCreatorContentTagCore.mjs";
import {
  rpcArray,
  rpcBoolean,
  rpcEnum,
  rpcNonnegative,
  rpcNonnegativeInteger,
  rpcNullableString,
  rpcNullableUuid,
  rpcObject,
  rpcString,
  rpcUuid,
} from "./marketplaceRuntimeValidation";

export type MarketplaceCreatorContentType = "feed" | "reel";

export interface MarketplaceCreatorContentTagProduct {
  tagId: string;
  contentType: MarketplaceCreatorContentType;
  productId: string;
  title: string;
  storeId: string;
  storeName: string;
  imageUrl: string | null;
  minPrice: number;
  maxPrice: number;
  availableQuantity: number;
  sortPosition: number;
}

export interface MarketplaceCreatorContentTagSummary {
  contentId: string;
  contentType: MarketplaceCreatorContentType;
  tagCount: number;
}

export class MarketplaceCreatorContentTagError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MarketplaceCreatorContentTagError";
  }
}

const db = () => getSupabaseClient();
const error = (input: unknown): never => {
  const message =
    input && typeof input === "object" && "message" in input
      ? String((input as { message: unknown }).message)
      : "marketplace_creator_content_tag_unknown";
  throw new MarketplaceCreatorContentTagError(
    message.match(/marketplace_[a-z0-9_]+/)?.[0] ??
      "marketplace_creator_content_tag_unknown",
  );
};

export function parseCreatorContentTagProduct(
  input: unknown,
): MarketplaceCreatorContentTagProduct {
  const row = rpcObject(input, "creator_content.product");
  return {
    tagId: rpcUuid(row.tag_id, "creator_content.product.tag_id"),
    contentType: rpcEnum(
      row.content_type,
      ["feed", "reel"] as const,
      "creator_content.product.content_type",
    ),
    productId: rpcUuid(row.product_id, "creator_content.product.product_id"),
    title: rpcString(row.title, "creator_content.product.title"),
    storeId: rpcUuid(row.store_id, "creator_content.product.store_id"),
    storeName: rpcString(row.store_name, "creator_content.product.store_name"),
    imageUrl: rpcNullableString(
      row.image_url,
      "creator_content.product.image_url",
    ),
    minPrice: rpcNonnegative(
      row.min_price,
      "creator_content.product.min_price",
    ),
    maxPrice: rpcNonnegative(
      row.max_price,
      "creator_content.product.max_price",
    ),
    availableQuantity: rpcNonnegativeInteger(
      row.available_quantity,
      "creator_content.product.available_quantity",
    ),
    sortPosition: rpcNonnegativeInteger(
      row.sort_position,
      "creator_content.product.sort_position",
    ),
  };
}

export const marketplaceContentTypeForMedia = (
  videoUrl: string,
  mediaUrls?: string[],
): MarketplaceCreatorContentType =>
  classifyContentMedia(videoUrl, mediaUrls) as MarketplaceCreatorContentType;

export async function setMyMarketplaceContentProductTags(input: {
  contentType: MarketplaceCreatorContentType;
  contentId: string;
  productIds: string[];
  idempotencyKey: string;
}) {
  const { data, error: rpcError } = await db().rpc(
    "set_my_marketplace_content_product_tags",
    {
      p_content_type: input.contentType,
      p_content_id: input.contentId,
      p_product_ids: input.productIds,
      p_idempotency_key: input.idempotencyKey,
    },
  );
  if (rpcError) error(rpcError);
  return rpcObject(data, "creator_content.set_receipt");
}

export async function fetchMarketplaceContentProductTags(
  contentType: MarketplaceCreatorContentType,
  contentId: string,
): Promise<{ items: MarketplaceCreatorContentTagProduct[]; visible: boolean }> {
  const { data, error: rpcError } = await db().rpc(
    "get_marketplace_content_product_tags",
    {
      p_content_type: contentType,
      p_content_id: contentId,
    },
  );
  if (rpcError) error(rpcError);
  const payload = rpcObject(data, "creator_content.tags");
  return {
    items: rpcArray(payload.items, "creator_content.tags.items").map(
      parseCreatorContentTagProduct,
    ),
    visible: rpcBoolean(payload.visible, "creator_content.tags.visible"),
  };
}

export async function fetchMarketplaceContentProductTagSummaries(
  contentIds: string[],
): Promise<MarketplaceCreatorContentTagSummary[]> {
  if (!contentIds.length) return [];
  const unique = [...new Set(contentIds)].slice(0, 50);
  const { data, error: rpcError } = await db().rpc(
    "get_marketplace_content_product_tag_summaries",
    {
      p_content_ids: unique,
    },
  );
  if (rpcError) error(rpcError);
  const payload = rpcObject(data, "creator_content.summaries");
  return rpcArray(payload.items, "creator_content.summaries.items").map(
    (input) => {
      const row = rpcObject(input, "creator_content.summaries.item");
      return {
        contentId: rpcUuid(
          row.content_id,
          "creator_content.summaries.content_id",
        ),
        contentType: rpcEnum(
          row.content_type,
          ["feed", "reel"] as const,
          "creator_content.summaries.content_type",
        ),
        tagCount: rpcNonnegativeInteger(
          row.tag_count,
          "creator_content.summaries.tag_count",
        ),
      };
    },
  );
}

export async function createCreatorContentAttribution(
  contentProductTagId: string,
  variantId: string,
  idempotencyKey: string,
) {
  const { data, error: rpcError } = await db().rpc(
    "create_marketplace_creator_content_attribution",
    {
      p_content_product_tag_id: contentProductTagId,
      p_variant_id: variantId,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (rpcError) error(rpcError);
  const row = rpcObject(data, "creator_content.attribution");
  if (row.source_surface !== "feed" && row.source_surface !== "reel") {
    throw new MarketplaceCreatorContentTagError(
      "marketplace_creator_content_attribution_invalid_receipt",
    );
  }
  return {
    id: rpcUuid(row.id, "creator_content.attribution.id"),
    creatorUserId: rpcUuid(
      row.creator_user_id,
      "creator_content.attribution.creator_user_id",
    ),
    productId: rpcUuid(
      row.product_id,
      "creator_content.attribution.product_id",
    ),
    variantId: rpcNullableUuid(
      row.variant_id,
      "creator_content.attribution.variant_id",
    ),
    sourceSurface: row.source_surface as MarketplaceCreatorContentType,
    sourceEntityId: rpcUuid(
      row.source_entity_id,
      "creator_content.attribution.source_entity_id",
    ),
  };
}
