import { getSupabaseClient } from "@/template";
import { parseMarketplaceProductEditorFlags } from "./marketplaceProductEditorFlagsCore.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  savedAt: string | null;
  titleConfigured: boolean;
  priceConfigured: boolean;
  categoryConfigured: boolean;
  media: ProductEditorMedia[];
}
export interface SaveMarketplaceProductDraftInput
  extends Omit<MarketplaceProductDraft, "id" | "media" | "status" | "savedAt"> {
  id: string;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("marketplace_draft_response_invalid");
  return value as Record<string, unknown>;
};
const text = (value: unknown, name: string) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value === "undefined" ||
    value === "null"
  )
    throw new Error(`marketplace_draft_${name}_invalid`);
  return value;
};
const uuid = (value: unknown, name: string) => {
  const result = text(value, name);
  if (!UUID.test(result)) throw new Error(`marketplace_draft_${name}_invalid`);
  return result;
};
export function parseMarketplaceProductDraft(
  payload: unknown,
): MarketplaceProductDraft {
  const root = object(payload),
    p = object(root.product),
    media = Array.isArray(root.media) ? root.media : [];
  const configured = parseMarketplaceProductEditorFlags(
      p.editor_state,
      p.published_at,
    ),
    price = Number(p.price),
    stock = Number(p.stock);
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  )
    throw new Error("marketplace_draft_values_invalid");
  return {
    id: uuid(p.id, "id"),
    storeId: uuid(p.store_id, "store"),
    categoryId: uuid(p.category_id, "category"),
    title: text(p.title, "title"),
    description: typeof p.description === "string" ? p.description : "",
    price,
    brand: typeof p.brand === "string" ? p.brand : "",
    compareAtPrice:
      p.compare_at_price == null ? null : Number(p.compare_at_price),
    stock,
    tags: Array.isArray(p.tags)
      ? p.tags.filter((x): x is string => typeof x === "string")
      : [],
    shippingProfileId:
      p.shipping_profile_id == null
        ? null
        : uuid(p.shipping_profile_id, "shipping_profile"),
    productType: p.product_type === "digital" ? "digital" : "physical",
    status: text(p.status, "status"),
    savedAt: typeof p.editor_saved_at === "string" ? p.editor_saved_at : null,
    ...configured,
    media: media
      .map((entry, index): ProductEditorMedia => {
        const m = object(entry),
          kind: "image" | "video" =
            m.media_kind === "video" ? "video" : "image";
        const duration = m.duration_ms == null ? null : Number(m.duration_ms);
        if (
          kind === "video" &&
          (!Number.isFinite(duration) || duration! <= 0 || duration! > 60000)
        )
          throw new Error("marketplace_product_video_invalid");
        return {
          clientKey: uuid(m.asset_id, "media"),
          assetId: uuid(m.asset_id, "media"),
          url: text(m.url, "media_url"),
          kind,
          mimeType: typeof m.mime_type === "string" ? m.mime_type : undefined,
          durationMs: duration,
          position: Number(m.position ?? index),
          isCover: m.is_cover === true,
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
  return uuid(data, "id");
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
  const row = object(data);
  return text(row.saved_at, "saved_at");
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
