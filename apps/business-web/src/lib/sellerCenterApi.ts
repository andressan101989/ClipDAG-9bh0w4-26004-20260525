import { supabase, type BusinessSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;
export type Cursor = { createdAt: string; id: string };
export type ProductCursor = { updatedAt: string; id: string };
export type Page<T, C = Cursor> = { items: T[]; nextCursor: C | null };
export type ProductPage = Page<ProductSummary, ProductCursor> & { categories: Row[] };

export type ProductSummary = {
  id: string; title: string; status: string; price: number; currency: string; variantCount: number;
  readinessReason: string | null; updatedAt: string; thumbnailUrl: string | null; availableStock: number | null;
};
export type ProductVariant = {
  id: string; sku: string; title: string | null; price: number; compareAtPrice: number | null; status: string;
  isDefault: boolean; imageAssetId: string | null; barcode: string | null; onHand: number | null;
  reserved: number | null; available: number | null; lowStockThreshold: number | null;
};
export type ProductDetail = {
  product: Row; media: Row[]; options: Row[]; variants: ProductVariant[]; categories: Row[];
};
export type ShippingRegion = Row & {
  id: string | null;
  country_code: string;
  region_code: string | null;
  shipping_price: number | string;
  free_shipping_threshold: number | string | null;
  transit_days_min: number;
  transit_days_max: number;
  status?: string;
};
export type ShippingProfile = Row & { id: string; name: string; store_id: string; regions: ShippingRegion[] };
export type OrderSummary = Row & { id: string; order_number: string; status: string; currency: string; total: number; created_at: string; items: Row[] };
export type ReturnShipment = Row & {
  status: string;
  return_label_asset_id?: string | null;
  label_sent_at?: string | null;
  tracking_number?: string | null;
  received_at?: string | null;
};
export type ReturnSummary = Row & {
  id: string;
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
  shipment?: ReturnShipment | null;
  refund_status?: string | null;
  refunded_at?: string | null;
  resolution_mode?: string | null;
};
export type DisputeSummary = Row & { id: string; order_id: string; order_number: string; status: string; created_at: string };

function row(value: unknown, code: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}
function text(value: unknown, code: string) { if (typeof value !== "string" || !value) throw new Error(code); return value; }
function rows(value: unknown, code: string) { if (!Array.isArray(value)) throw new Error(code); return value.map((item) => row(item, code)); }
function rpcError(error: { message?: string } | null, fallback: string) { if (error) throw new Error(error.message || fallback); }
function cursor(value: unknown, key: "created_at" | "updated_at"): Cursor | ProductCursor | null {
  if (value == null) return null;
  const parsed = row(value, "seller_center_cursor_invalid");
  return key === "updated_at"
    ? { updatedAt: text(parsed.updated_at, "seller_center_cursor_invalid"), id: text(parsed.id, "seller_center_cursor_invalid") }
    : { createdAt: text(parsed.created_at, "seller_center_cursor_invalid"), id: text(parsed.id, "seller_center_cursor_invalid") };
}

export async function searchProducts(ownerId: string, filters: { status?: string; query?: string; cursor?: ProductCursor; limit?: number } = {}, client: BusinessSupabaseClient = supabase): Promise<ProductPage> {
  const { data, error } = await client.rpc("search_my_business_products", { p_business_owner_id: ownerId, p_status: filters.status ?? null, p_query: filters.query?.trim() || null, p_cursor_updated_at: filters.cursor?.updatedAt ?? null, p_cursor_id: filters.cursor?.id ?? null, p_limit: filters.limit ?? 30 });
  rpcError(error, "No se pudo cargar el catálogo"); const payload = row(data, "business_products_invalid");
  return { items: rows(payload.items, "business_product_invalid").map((item) => ({ id: text(item.id, "business_product_invalid"), title: text(item.title, "business_product_invalid"), status: text(item.status, "business_product_invalid"), price: Number(item.price), currency: text(item.currency, "business_product_invalid"), variantCount: Number(item.variant_count ?? 0), readinessReason: typeof item.readiness_reason === "string" ? item.readiness_reason : null, updatedAt: text(item.updated_at, "business_product_invalid"), thumbnailUrl: typeof item.thumbnail_url === "string" ? item.thumbnail_url : null, availableStock: item.available_stock == null ? null : Number(item.available_stock) })), categories: rows(payload.categories, "business_categories_invalid"), nextCursor: cursor(payload.next_cursor, "updated_at") as ProductCursor | null };
}

export async function getProduct(ownerId: string, productId: string, client: BusinessSupabaseClient = supabase): Promise<ProductDetail> {
  const { data, error } = await client.rpc("get_my_business_product", { p_business_owner_id: ownerId, p_product_id: productId });
  rpcError(error, "No se pudo cargar el producto"); const payload = row(data, "business_product_detail_invalid");
  return { product: row(payload.product, "business_product_detail_invalid"), media: rows(payload.media, "business_product_media_invalid"), options: rows(payload.options, "business_product_options_invalid"), variants: rows(payload.variants, "business_product_variants_invalid").map((item) => ({ id: text(item.id, "business_variant_invalid"), sku: text(item.sku, "business_variant_invalid"), title: typeof item.title === "string" ? item.title : null, price: Number(item.price), compareAtPrice: item.compare_at_price == null ? null : Number(item.compare_at_price), status: text(item.status, "business_variant_invalid"), isDefault: item.is_default === true, imageAssetId: typeof item.image_asset_id === "string" ? item.image_asset_id : null, barcode: typeof item.barcode === "string" ? item.barcode : null, onHand: item.on_hand == null ? null : Number(item.on_hand), reserved: item.reserved == null ? null : Number(item.reserved), available: item.available == null ? null : Number(item.available), lowStockThreshold: item.low_stock_threshold == null ? null : Number(item.low_stock_threshold) })), categories: rows(payload.categories, "business_categories_invalid") };
}

export async function createProductDraft(storeId: string, categoryId: string, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("create_or_resume_marketplace_product_draft", { p_store_id: storeId, p_category_id: categoryId, p_editor_session_key: crypto.randomUUID() }); rpcError(error, "No se pudo crear el borrador"); return text(data, "product_draft_response_invalid");
}
export async function saveProductDraft(input: Row, client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("save_my_marketplace_product_draft", input); rpcError(error, "No se pudo guardar el producto");
}
export async function productAction(action: "publish" | "pause" | "delete", productId: string, client: BusinessSupabaseClient = supabase) {
  const names = { publish: "publish_my_marketplace_product_checked", pause: "pause_marketplace_product", delete: "soft_delete_marketplace_product" } as const;
  const { error } = await client.rpc(names[action], { p_product_id: productId }); rpcError(error, `No se pudo ${action === "publish" ? "publicar" : action === "pause" ? "pausar" : "eliminar"} el producto`);
}
export async function setProductMedia(productId: string, imageAssetIds: string[], coverAssetId: string | null, client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("set_my_marketplace_product_media_v2", { p_product_id: productId, p_image_asset_ids: imageAssetIds, p_cover_asset_id: coverAssetId, p_video_asset_id: null }); rpcError(error, "No se pudo actualizar la media");
}
export async function configureVariants(productId: string, options: unknown[], variants: unknown[], client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("configure_marketplace_product_variants", { p_product_id: productId, p_options_json: options, p_variants_json: variants, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudieron configurar las variantes");
}
export async function updateVariant(input: Row, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("update_marketplace_product_variant", input); rpcError(error, "No se pudo actualizar la variante"); }
export async function variantAction(action: "default" | "archive" | "restore", variantId: string, replacementId?: string | null, client: BusinessSupabaseClient = supabase) {
  const name = action === "default" ? "set_marketplace_default_variant" : action === "archive" ? "archive_marketplace_product_variant" : "restore_marketplace_product_variant";
  const args = action === "archive" ? { p_variant_id: variantId, p_replacement_default_id: replacementId ?? null } : { p_variant_id: variantId };
  const { error } = await client.rpc(name, args); rpcError(error, "No se pudo actualizar la variante");
}
export async function mutateInventory(kind: "set" | "adjust" | "threshold", variantId: string, value: number, client: BusinessSupabaseClient = supabase) {
  const name = kind === "set" ? "set_marketplace_variant_inventory" : kind === "adjust" ? "adjust_marketplace_variant_inventory" : "set_marketplace_variant_low_stock_threshold";
  const args = kind === "threshold" ? { p_variant_id: variantId, p_threshold: value } : kind === "set" ? { p_variant_id: variantId, p_new_on_hand: value, p_reason: "Business Web", p_idempotency_key: crypto.randomUUID() } : { p_variant_id: variantId, p_delta: value, p_reason: "Business Web", p_idempotency_key: crypto.randomUUID() };
  const { error } = await client.rpc(name, args); rpcError(error, "No se pudo actualizar el inventario");
}

export async function searchShippingProfiles(ownerId: string, pageCursor?: Cursor, client: BusinessSupabaseClient = supabase): Promise<Page<ShippingProfile>> { const { data, error } = await client.rpc("search_my_business_shipping_profiles", { p_business_owner_id: ownerId, p_cursor_created_at: pageCursor?.createdAt ?? null, p_cursor_id: pageCursor?.id ?? null, p_limit: 30 }); rpcError(error, "No se pudieron cargar los perfiles de envío"); const payload = row(data, "shipping_profiles_invalid"); return { items: rows(payload.items, "shipping_profile_invalid") as ShippingProfile[], nextCursor: cursor(payload.next_cursor, "created_at") as Cursor | null }; }
export async function upsertShippingProfile(input: Row, client: BusinessSupabaseClient = supabase) { const { data, error } = await client.rpc("upsert_my_marketplace_shipping_profile", input); rpcError(error, "No se pudo guardar el perfil de envío"); return text(data, "shipping_profile_response_invalid"); }
export async function assignShippingProfile(productId: string, profileId: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("set_my_marketplace_product_shipping_profile", { p_product_id: productId, p_profile_id: profileId }); rpcError(error, "No se pudo asignar el perfil de envío"); }

async function pagedRpc<T extends Row>(name: string, ownerId: string, args: Row, fallback: string, client: BusinessSupabaseClient): Promise<Page<T>> { const { data, error } = await client.rpc(name, { p_business_owner_id: ownerId, ...args }); rpcError(error, fallback); const payload = row(data, `${name}_invalid`); return { items: rows(payload.items, `${name}_item_invalid`) as T[], nextCursor: cursor(payload.next_cursor, "created_at") as Cursor | null }; }
export const searchOrders = (ownerId: string, filters: { status?: string; cursor?: Cursor } = {}, client: BusinessSupabaseClient = supabase) => pagedRpc<OrderSummary>("search_my_business_orders", ownerId, { p_status: filters.status ?? null, p_cursor_created_at: filters.cursor?.createdAt ?? null, p_cursor_id: filters.cursor?.id ?? null, p_limit: 30 }, "No se pudieron cargar los pedidos", client);
export async function getOrder(ownerId: string, orderId: string, client: BusinessSupabaseClient = supabase) { const { data, error } = await client.rpc("get_my_business_order", { p_business_owner_id: ownerId, p_order_id: orderId }); rpcError(error, "No se pudo cargar el pedido"); return row(data, "business_order_invalid"); }
export async function startOrderProcessing(orderId: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("seller_start_marketplace_order_processing", { p_order_id: orderId, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo iniciar el procesamiento"); }
export async function shipOrder(orderId: string, input: { carrier: string; service: string; tracking: string; url: string; note: string }, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("seller_ship_marketplace_order", { p_order_id: orderId, p_carrier_name: input.carrier, p_service_level: input.service || null, p_tracking_number: input.tracking, p_tracking_url: input.url || null, p_seller_note: input.note || null, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo marcar como enviado"); }
export const searchReturns = (ownerId: string, pageCursor?: Cursor, client: BusinessSupabaseClient = supabase) => pagedRpc<ReturnSummary>("search_my_business_returns", ownerId, { p_cursor_created_at: pageCursor?.createdAt ?? null, p_cursor_id: pageCursor?.id ?? null, p_limit: 30 }, "No se pudieron cargar las devoluciones", client);
export async function respondReturn(returnId: string, decision: "approve" | "reject", note: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("respond_to_marketplace_return", { p_return_id: returnId, p_decision: decision, p_seller_note: note || null, p_idempotency_key: crypto.randomUUID() }); rpcError(error, decision === "approve" ? "Esta acción financiera requiere al propietario" : "No se pudo responder la devolución"); }
export async function sendReturnLabel(returnId: string, assetId: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("send_marketplace_return_label", { p_return_id: returnId, p_label_asset_id: assetId, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo enviar la etiqueta"); }
export async function refundReturnWithoutShipment(returnId: string, note: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("refund_marketplace_return_without_shipment", { p_return_id: returnId, p_seller_note: note || null, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo completar el reembolso sin envío"); }
export async function confirmReturnReceived(returnId: string, note: string, client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("confirm_marketplace_return_received", { p_return_id: returnId, p_seller_note: note || null, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo confirmar la recepción"); }
export const searchDisputes = (ownerId: string, pageCursor?: Cursor, client: BusinessSupabaseClient = supabase) => pagedRpc<DisputeSummary>("search_my_business_disputes", ownerId, { p_cursor_created_at: pageCursor?.createdAt ?? null, p_cursor_id: pageCursor?.id ?? null, p_limit: 30 }, "No se pudieron cargar las disputas", client);
export async function respondDispute(disputeId: string, note: string, evidenceIds: string[], client: BusinessSupabaseClient = supabase) { const { error } = await client.rpc("respond_to_marketplace_dispute", { p_dispute_id: disputeId, p_seller_note: note || null, p_evidence_asset_ids: evidenceIds, p_idempotency_key: crypto.randomUUID() }); rpcError(error, "No se pudo responder la disputa"); }
