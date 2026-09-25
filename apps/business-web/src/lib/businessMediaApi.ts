import { supabase, type BusinessSupabaseClient } from "./supabase";

export type BusinessMediaKind = "image" | "video";
export type BusinessMediaProvider = "r2" | "cloudflare_stream";
export type BusinessMediaSource = "media_asset" | "video_asset";
export type BusinessMediaCursor = { createdAt: string; source: BusinessMediaSource; assetId: string };

export type BusinessMediaItem = {
  assetId: string;
  assetSource: BusinessMediaSource;
  provider: BusinessMediaProvider;
  mediaKind: BusinessMediaKind;
  mimeType: string;
  status: string;
  purpose: string;
  visibility: "public";
  sizeBytes: number | null;
  createdAt: string;
  readyAt: string | null;
  previewUrl: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  usage: Array<"library" | "store" | "product">;
  usageCount: number;
  progress: number | null;
  errorCode: string | null;
};

export type BusinessMediaPage = { items: BusinessMediaItem[]; nextCursor: BusinessMediaCursor | null };
export type BusinessMediaFilters = {
  kind?: BusinessMediaKind;
  provider?: BusinessMediaProvider;
  status?: string;
  cursor?: BusinessMediaCursor;
  assetIds?: string[];
  limit?: number;
};
export type UploadProgress = { phase: "reserving" | "uploading" | "finalizing" | "processing"; percent: number };
export type BusinessMediaPresentationState = "ready" | "processing" | "expired" | "failed";

type JsonRecord = Record<string, unknown>;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const BUSINESS_IMAGE_MAX_BYTES = 25_000_000;
export const BUSINESS_VIDEO_MAX_BYTES = 200_000_000;
export const BUSINESS_MEDIA_UPLOAD_STALE_AFTER_MS = 5 * 60 * 1000;

export function businessMediaPresentationState(
  item: Pick<BusinessMediaItem, "provider" | "status" | "createdAt">,
  nowMs = Date.now(),
): BusinessMediaPresentationState {
  if (item.status === "ready") return "ready";
  if (["failed", "delete_pending", "deleted"].includes(item.status)) return "failed";
  if (item.provider === "r2" && ["pending", "uploading"].includes(item.status)) {
    const createdAtMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs >= BUSINESS_MEDIA_UPLOAD_STALE_AFTER_MS) return "expired";
  }
  return "processing";
}

function record(value: unknown, code: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonRecord;
}
function stringValue(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}
function optionalString(value: unknown) { return typeof value === "string" && value ? value : null; }

function parseItem(value: unknown): BusinessMediaItem {
  const row = record(value, "business_media_item_invalid");
  if (!Array.isArray(row.usage)) throw new Error("business_media_item_invalid");
  return {
    assetId: stringValue(row.asset_id, "business_media_item_invalid"),
    assetSource: stringValue(row.asset_source, "business_media_item_invalid") as BusinessMediaSource,
    provider: stringValue(row.provider, "business_media_item_invalid") as BusinessMediaProvider,
    mediaKind: stringValue(row.media_kind, "business_media_item_invalid") as BusinessMediaKind,
    mimeType: stringValue(row.mime_type, "business_media_item_invalid"),
    status: stringValue(row.status, "business_media_item_invalid"),
    purpose: stringValue(row.purpose, "business_media_item_invalid"),
    visibility: "public",
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    createdAt: stringValue(row.created_at, "business_media_item_invalid"),
    readyAt: optionalString(row.ready_at),
    previewUrl: optionalString(row.preview_url),
    playbackUrl: optionalString(row.playback_url),
    thumbnailUrl: optionalString(row.thumbnail_url),
    usage: row.usage.filter((item): item is "library" | "store" | "product" => item === "library" || item === "store" || item === "product"),
    usageCount: Number(row.usage_count ?? 0),
    progress: row.progress == null ? null : Number(row.progress),
    errorCode: optionalString(row.error_code),
  };
}

export async function searchBusinessMedia(
  businessOwnerId: string,
  filters: BusinessMediaFilters = {},
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessMediaPage> {
  const { data, error } = await client.rpc("search_my_business_media", {
    p_business_owner_id: businessOwnerId,
    p_kind: filters.kind ?? null,
    p_provider: filters.provider ?? null,
    p_status: filters.status ?? null,
    p_cursor_created_at: filters.cursor?.createdAt ?? null,
    p_cursor_source: filters.cursor?.source ?? null,
    p_cursor_id: filters.cursor?.assetId ?? null,
    p_asset_ids: filters.assetIds?.length ? filters.assetIds : null,
    p_limit: filters.limit ?? 24,
  });
  if (error) throw new Error(error.message || "No se pudo cargar la biblioteca");
  const payload = record(data, "business_media_response_invalid");
  if (!Array.isArray(payload.items)) throw new Error("business_media_response_invalid");
  const cursor = payload.next_cursor == null ? null : record(payload.next_cursor, "business_media_cursor_invalid");
  return {
    items: payload.items.map(parseItem),
    nextCursor: cursor ? {
      createdAt: stringValue(cursor.created_at, "business_media_cursor_invalid"),
      source: stringValue(cursor.source, "business_media_cursor_invalid") as BusinessMediaSource,
      assetId: stringValue(cursor.asset_id, "business_media_cursor_invalid"),
    } : null,
  };
}

export async function searchAllBusinessMedia(
  businessOwnerId: string,
  filters: BusinessMediaFilters = {},
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessMediaItem[]> {
  const items = new Map<string, BusinessMediaItem>();
  const seenCursors = new Set<string>();
  let cursor = filters.cursor;
  const limit = Math.min(50, Math.max(1, filters.limit ?? 50));
  while (true) {
    const page = await searchBusinessMedia(businessOwnerId, { ...filters, cursor, limit }, client);
    for (const item of page.items) items.set(item.assetId, item);
    if (!page.nextCursor) break;
    const cursorKey = `${page.nextCursor.createdAt}|${page.nextCursor.source}|${page.nextCursor.assetId}`;
    if (seenCursors.has(cursorKey)) throw new Error("business_media_cursor_repeated");
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }
  return [...items.values()];
}

function uploadRequest(
  url: string,
  method: "PUT" | "POST",
  body: Blob | FormData,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("upload_transport_failed"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`upload_failed_${request.status}`));
    };
    request.send(body);
  });
}

function edgePayload(value: unknown, code: string) {
  const response = record(value, code);
  return record(response.data, code);
}

function edgeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const status = (context as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function throwFinalizeError(error: unknown, fallback: string): never {
  const status = edgeErrorStatus(error);
  if (status === 409) throw new Error("media_finalize_rejected");
  if (status !== null && status >= 500) throw new Error("media_finalize_temporarily_unavailable");
  throw new Error(fallback);
}

function requireReadyFinalization(value: unknown, assetId: string) {
  const payload = edgePayload(value, "media_finalize_invalid");
  if (payload.assetId !== assetId || payload.status !== "ready") throw new Error("media_finalize_not_ready");
}

export async function uploadBusinessMedia(
  businessOwnerId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  client: BusinessSupabaseClient = supabase,
) {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size <= 0 || file.size > BUSINESS_IMAGE_MAX_BYTES) throw new Error("image_size_not_supported");
    onProgress?.({ phase: "reserving", percent: 0 });
    const reservation = await client.functions.invoke("create-media-upload", { body: {
      purpose: "business_library",
      visibility: "public",
      mime_type: file.type,
      size_bytes: file.size,
      file_name: file.name,
      business_owner_id: businessOwnerId,
    } });
    if (reservation.error) throw new Error(reservation.error.message || "media_reservation_failed");
    const contract = edgePayload(reservation.data, "media_reservation_invalid");
    const assetId = stringValue(contract.assetId, "media_reservation_invalid");
    const uploadUrl = stringValue(contract.uploadUrl, "media_reservation_invalid");
    const headers = record(contract.headers, "media_reservation_invalid") as Record<string, string>;
    const method = stringValue(contract.method, "media_reservation_invalid");
    if (method !== "PUT" || headers["Content-Type"] !== file.type || headers["If-None-Match"] !== "*") {
      throw new Error("media_reservation_invalid");
    }
    onProgress?.({ phase: "uploading", percent: 0 });
    await uploadRequest(uploadUrl, method, file, headers, (percent) => onProgress?.({ phase: "uploading", percent }));
    onProgress?.({ phase: "finalizing", percent: 100 });
    const finalized = await client.functions.invoke("finalize-media-upload", { body: { asset_id: assetId } });
    if (finalized.error) throwFinalizeError(finalized.error, "media_finalize_failed");
    requireReadyFinalization(finalized.data, assetId);
    const canonical = await searchBusinessMedia(businessOwnerId, { assetIds: [assetId], limit: 1 }, client);
    const item = canonical.items.find((candidate) => candidate.assetId === assetId);
    if (!item || item.status !== "ready") throw new Error("media_finalize_not_ready");
    return { assetId, kind: "image" as const, item };
  }

  if (VIDEO_TYPES.has(file.type)) {
    if (file.size <= 0 || file.size > BUSINESS_VIDEO_MAX_BYTES) throw new Error("video_size_not_supported");
    onProgress?.({ phase: "reserving", percent: 0 });
    const reservation = await client.functions.invoke("create-stream-upload", { body: {
      purpose: "business_library",
      mime_type: file.type,
      size_bytes: file.size,
      file_name: file.name,
      business_owner_id: businessOwnerId,
    } });
    if (reservation.error) throw new Error(reservation.error.message || "stream_reservation_failed");
    const contract = edgePayload(reservation.data, "stream_reservation_invalid");
    const assetId = stringValue(contract.assetId, "stream_reservation_invalid");
    const uploadUrl = stringValue(contract.uploadUrl, "stream_reservation_invalid");
    const body = new FormData();
    body.append(stringValue(contract.formField, "stream_reservation_invalid"), file);
    onProgress?.({ phase: "uploading", percent: 0 });
    await uploadRequest(uploadUrl, "POST", body, {}, (percent) => onProgress?.({ phase: "uploading", percent }));
    onProgress?.({ phase: "processing", percent: 100 });
    return { assetId, kind: "video" as const, item: null };
  }

  throw new Error("media_type_not_supported");
}

export async function uploadBusinessOperationalMedia(
  businessOwnerId: string,
  purpose: "return_label" | "dispute_evidence",
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  client: BusinessSupabaseClient = supabase,
) {
  const valid = purpose === "return_label"
    ? file.type === "application/pdf" && file.size > 0 && file.size <= 10_000_000
    : IMAGE_TYPES.has(file.type) && file.type !== "image/gif" && file.size > 0 && file.size <= 25_000_000;
  if (!valid) throw new Error(purpose === "return_label" ? "return_label_file_invalid" : "dispute_evidence_file_invalid");
  onProgress?.({ phase: "reserving", percent: 0 });
  const reservation = await client.functions.invoke("create-media-upload", { body: {
    purpose,
    visibility: "private",
    mime_type: file.type,
    size_bytes: file.size,
    file_name: file.name,
    business_owner_id: businessOwnerId,
  } });
  if (reservation.error) throw new Error(reservation.error.message || "operational_media_reservation_failed");
  const contract = edgePayload(reservation.data, "operational_media_reservation_invalid");
  const assetId = stringValue(contract.assetId, "operational_media_reservation_invalid");
  const method = stringValue(contract.method, "operational_media_reservation_invalid");
  const uploadUrl = stringValue(contract.uploadUrl, "operational_media_reservation_invalid");
  const headers = record(contract.headers, "operational_media_reservation_invalid") as Record<string, string>;
  if (method !== "PUT" || headers["Content-Type"] !== file.type || headers["If-None-Match"] !== "*") {
    throw new Error("operational_media_reservation_invalid");
  }
  onProgress?.({ phase: "uploading", percent: 0 });
  await uploadRequest(
    uploadUrl,
    method,
    file,
    headers,
    (percent) => onProgress?.({ phase: "uploading", percent }),
  );
  onProgress?.({ phase: "finalizing", percent: 100 });
  const finalized = await client.functions.invoke("finalize-media-upload", { body: { asset_id: assetId } });
  if (finalized.error) throwFinalizeError(finalized.error, "operational_media_finalize_failed");
  requireReadyFinalization(finalized.data, assetId);
  return assetId;
}

export async function setBusinessStoreMedia(
  storeId: string,
  logoAssetId: string | null,
  bannerAssetId: string | null,
  client: BusinessSupabaseClient = supabase,
) {
  const { error } = await client.rpc("set_marketplace_store_media", {
    p_store_id: storeId,
    p_logo_asset_id: logoAssetId,
    p_banner_asset_id: bannerAssetId,
  });
  if (error) throw new Error(error.message || "No se pudo actualizar la identidad visual");
}
