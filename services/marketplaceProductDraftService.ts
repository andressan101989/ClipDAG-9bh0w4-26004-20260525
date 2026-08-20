import { getSupabaseClient } from "@/template";
import { parseMarketplaceProductEditorFlags } from "./marketplaceProductEditorFlagsCore.mjs";
import {
  rpcArray,
  rpcBoolean,
  rpcEnum,
  rpcNonnegative,
  rpcNonnegativeInteger,
  rpcNullableNonnegative,
  rpcNullableText,
  rpcNullableTimestamp,
  rpcNullableUuid,
  rpcObject,
  rpcString,
  rpcStringArray,
  rpcText,
  rpcTimestamp,
  rpcUuid,
} from "./marketplaceRuntimeValidation";
const db = () => getSupabaseClient();
export type ProductType = "physical" | "digital";
export type ProductEditorMediaState =
  | "local"
  | "uploading"
  | "ready"
  | "failed";
export interface ProductEditorMedia {
  clientKey: string;
  assetId: string;
  url: string;
  kind: "image" | "video";
  mimeType?: string;
  durationMs: number | null;
  position: number;
  isCover: boolean;
  state: ProductEditorMediaState;
  fileName?: string;
  sizeBytes?: number;
  pendingReplacement?: boolean;
}
export interface MarketplaceProductDraft {
  id: string;
  storeId: string;
  categoryId: string;
  title: string;
  description: string;
  price: number;
  brand: string;
  compareAtPrice: number | null;
  stock: number;
  tags: string[];
  shippingProfileId: string | null;
  productType: ProductType;
  status: string;
  publishedAt: string | null;
  savedAt: string | null;
  titleConfigured: boolean;
  priceConfigured: boolean;
  categoryConfigured: boolean;
  media: ProductEditorMedia[];
}
export interface SaveMarketplaceProductDraftInput
  extends Omit<
    MarketplaceProductDraft,
    "id" | "media" | "status" | "publishedAt" | "savedAt"
  > {
  id: string;
}

export function parseMarketplaceProductDraft(
  payload: unknown,
): MarketplaceProductDraft {
  const root = rpcObject(payload, "draft"),
    p = rpcObject(root.product, "draft.product"),
    media = rpcArray(root.media, "draft.media");
  const configured = parseMarketplaceProductEditorFlags(
      p.editor_state,
      p.published_at,
    ),
    price = rpcNonnegative(p.price, "draft.product.price"),
    stock = rpcNonnegativeInteger(p.stock, "draft.product.stock");
  if (price <= 0) throw new Error("marketplace_draft_values_invalid");
  return {
    id: rpcUuid(p.id, "draft.product.id"),
    storeId: rpcUuid(p.store_id, "draft.product.store_id"),
    categoryId: rpcUuid(p.category_id, "draft.product.category_id"),
    title: rpcString(p.title, "draft.product.title"),
    description: rpcText(p.description, "draft.product.description"),
    price,
    brand: rpcNullableText(p.brand, "draft.product.brand") ?? "",
    compareAtPrice: rpcNullableNonnegative(
      p.compare_at_price,
      "draft.product.compare_at_price",
    ),
    stock,
    tags: rpcStringArray(p.tags, "draft.product.tags"),
    shippingProfileId: rpcNullableUuid(
      p.shipping_profile_id,
      "draft.product.shipping_profile_id",
    ),
    productType: rpcEnum(
      p.product_type,
      ["physical", "digital"] as const,
      "draft.product.product_type",
    ),
    status: rpcEnum(
      p.status,
      ["active", "paused", "sold_out", "deleted"] as const,
      "draft.product.status",
    ),
    publishedAt: rpcNullableTimestamp(
      p.published_at,
      "draft.product.published_at",
    ),
    savedAt: rpcNullableTimestamp(
      p.editor_saved_at,
      "draft.product.editor_saved_at",
    ),
    ...configured,
    media: media
      .map((entry, index): ProductEditorMedia => {
        const path = `draft.media[${index}]`,
          m = rpcObject(entry, path),
          kind = rpcEnum(
            m.media_kind,
            ["image", "video"] as const,
            `${path}.media_kind`,
          ),
          duration =
            m.duration_ms === null
              ? null
              : rpcNonnegativeInteger(m.duration_ms, `${path}.duration_ms`);
        if (
          kind === "video" &&
          (!Number.isFinite(duration) || duration! <= 0 || duration! > 60000)
        )
          throw new Error("marketplace_product_video_invalid");
        return {
          clientKey: rpcUuid(m.asset_id, `${path}.asset_id`),
          assetId: rpcUuid(m.asset_id, `${path}.asset_id`),
          url: rpcString(m.url, `${path}.url`),
          kind,
          mimeType:
            rpcNullableText(m.mime_type ?? null, `${path}.mime_type`) ??
            undefined,
          durationMs: duration,
          position: rpcNonnegativeInteger(m.position, `${path}.position`),
          isCover: rpcBoolean(m.is_cover, `${path}.is_cover`),
          state: "ready" as const,
        };
      })
      .sort((a, b) => a.position - b.position),
  };
}
export async function createOrResumeMarketplaceProductDraft(
  storeId: string,
  categoryId: string,
  sessionKey: string,
): Promise<string> {
  const { data, error } = await db().rpc(
    "create_or_resume_marketplace_product_draft",
    {
      p_store_id: storeId,
      p_category_id: categoryId,
      p_editor_session_key: sessionKey,
    },
  );
  if (error) throw error;
  return rpcUuid(data, "draft.id");
}
export async function fetchMarketplaceProductDraft(
  id: string,
): Promise<MarketplaceProductDraft> {
  const { data, error } = await db().rpc("fetch_my_marketplace_product_draft", {
    p_product_id: id,
  });
  if (error) throw error;
  return parseMarketplaceProductDraft(data);
}
export async function saveMarketplaceProductDraft(
  input: SaveMarketplaceProductDraftInput,
): Promise<string> {
  const { data, error } = await db().rpc("save_my_marketplace_product_draft", {
    p_product_id: input.id,
    p_category_id: input.categoryId,
    p_title: input.title,
    p_description: input.description,
    p_price: input.price,
    p_brand: input.brand || null,
    p_compare_at_price: input.compareAtPrice,
    p_stock: input.stock,
    p_tags: input.tags,
    p_shipping_profile_id: input.shippingProfileId,
    p_product_type: input.productType,
    p_title_configured: input.titleConfigured,
    p_price_configured: input.priceConfigured,
    p_category_configured: input.categoryConfigured,
  });
  if (error) throw error;
  const row = rpcObject(data, "draft.save");
  return rpcTimestamp(row.saved_at, "draft.save.saved_at");
}
export async function persistMarketplaceProductMedia(
  productId: string,
  images: ProductEditorMedia[],
  coverAssetId: string | null,
  video: ProductEditorMedia | null,
): Promise<void> {
  if (images.length > 5) throw new Error("marketplace_product_image_limit");
  if (video && (!video.durationMs || video.durationMs > 60000))
    throw new Error("marketplace_product_video_invalid");
  const { error } = await db().rpc("set_my_marketplace_product_media_v2", {
    p_product_id: productId,
    p_image_asset_ids: images.map((x) => x.assetId),
    p_cover_asset_id: coverAssetId,
    p_video_asset_id: video?.assetId ?? null,
  });
  if (error) throw error;
}
