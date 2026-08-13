import { getSupabaseClient } from "@/template";
import { marketplaceContentTypeForMedia as classifyContentMedia } from "./marketplaceCreatorContentTagCore.mjs";

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
const object = (input: unknown) => input && typeof input === "object" ? input as Record<string, unknown> : {};
const string = (input: unknown) => typeof input === "string" ? input : "";
const number = (input: unknown) => Number.isFinite(Number(input)) ? Number(input) : 0;
const error = (input: unknown): never => {
  const message = input && typeof input === "object" && "message" in input
    ? String((input as { message: unknown }).message)
    : "marketplace_creator_content_tag_unknown";
  throw new MarketplaceCreatorContentTagError(
    message.match(/marketplace_[a-z0-9_]+/)?.[0] ?? "marketplace_creator_content_tag_unknown",
  );
};

function mapProduct(input: unknown): MarketplaceCreatorContentTagProduct {
  const row = object(input);
  return {
    tagId: string(row.tag_id),
    contentType: row.content_type === "reel" ? "reel" : "feed",
    productId: string(row.product_id),
    title: string(row.title),
    storeId: string(row.store_id),
    storeName: string(row.store_name),
    imageUrl: typeof row.image_url === "string" ? row.image_url : null,
    minPrice: number(row.min_price),
    maxPrice: number(row.max_price),
    availableQuantity: number(row.available_quantity),
    sortPosition: number(row.sort_position),
  };
}

export const marketplaceContentTypeForMedia = (
  videoUrl: string,
  mediaUrls?: string[],
): MarketplaceCreatorContentType => classifyContentMedia(videoUrl, mediaUrls) as MarketplaceCreatorContentType;

export async function setMyMarketplaceContentProductTags(input: {
  contentType: MarketplaceCreatorContentType;
  contentId: string;
  productIds: string[];
  idempotencyKey: string;
}) {
  const { data, error: rpcError } = await db().rpc("set_my_marketplace_content_product_tags", {
    p_content_type: input.contentType,
    p_content_id: input.contentId,
    p_product_ids: input.productIds,
    p_idempotency_key: input.idempotencyKey,
  });
  if (rpcError) error(rpcError);
  return object(data);
}

export async function fetchMarketplaceContentProductTags(
  contentType: MarketplaceCreatorContentType,
  contentId: string,
): Promise<{ items: MarketplaceCreatorContentTagProduct[]; visible: boolean }> {
  const { data, error: rpcError } = await db().rpc("get_marketplace_content_product_tags", {
    p_content_type: contentType,
    p_content_id: contentId,
  });
  if (rpcError) error(rpcError);
  const payload = object(data);
  return {
    items: Array.isArray(payload.items) ? payload.items.map(mapProduct) : [],
    visible: payload.visible !== false,
  };
}

export async function fetchMarketplaceContentProductTagSummaries(
  contentIds: string[],
): Promise<MarketplaceCreatorContentTagSummary[]> {
  if (!contentIds.length) return [];
  const unique = [...new Set(contentIds)].slice(0, 50);
  const { data, error: rpcError } = await db().rpc("get_marketplace_content_product_tag_summaries", {
    p_content_ids: unique,
  });
  if (rpcError) error(rpcError);
  const payload = object(data);
  return (Array.isArray(payload.items) ? payload.items : []).map((input) => {
    const row = object(input);
    return {
      contentId: string(row.content_id),
      contentType: row.content_type === "reel" ? "reel" : "feed",
      tagCount: number(row.tag_count),
    };
  });
}

export async function createCreatorContentAttribution(
  contentProductTagId: string,
  variantId: string,
  idempotencyKey: string,
) {
  const { data, error: rpcError } = await db().rpc("create_marketplace_creator_content_attribution", {
    p_content_product_tag_id: contentProductTagId,
    p_variant_id: variantId,
    p_idempotency_key: idempotencyKey,
  });
  if (rpcError) error(rpcError);
  const row = object(data);
  if (row.source_surface !== "feed" && row.source_surface !== "reel") {
    throw new MarketplaceCreatorContentTagError("marketplace_creator_content_attribution_invalid_receipt");
  }
  return {
    id: string(row.id),
    creatorUserId: string(row.creator_user_id),
    productId: string(row.product_id),
    variantId: typeof row.variant_id === "string" ? row.variant_id : null,
    sourceSurface: row.source_surface as MarketplaceCreatorContentType,
    sourceEntityId: string(row.source_entity_id),
  };
}
