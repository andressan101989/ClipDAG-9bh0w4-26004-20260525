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

type JsonRecord = Record<string, unknown>;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const BUSINESS_IMAGE_MAX_BYTES = 25_000_000;
export const BUSINESS_VIDEO_MAX_BYTES = 200_000_000;

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
      if ((request.status >= 200 && request.status < 300) || (method === "PUT" && request.status === 412)) resolve();
      else reject(new Error(`upload_failed_${request.status}`));
    };
    request.send(body);
  });
}

function edgePayload(value: unknown, code: string) {
  const response = record(value, code);
  return record(response.data, code);
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
    onProgress?.({ phase: "uploading", percent: 0 });
    await uploadRequest(uploadUrl, "PUT", file, headers, (percent) => onProgress?.({ phase: "uploading", percent }));
    onProgress?.({ phase: "finalizing", percent: 100 });
    const finalized = await client.functions.invoke("finalize-media-upload", { body: { asset_id: assetId } });
    if (finalized.error) throw new Error(finalized.error.message || "media_finalize_failed");
    return { assetId, kind: "image" as const };
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
    return { assetId, kind: "video" as const };
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
  onProgress?.({ phase: "uploading", percent: 0 });
  await uploadRequest(
    stringValue(contract.uploadUrl, "operational_media_reservation_invalid"),
    "PUT",
    file,
    record(contract.headers, "operational_media_reservation_invalid") as Record<string, string>,
    (percent) => onProgress?.({ phase: "uploading", percent }),
  );
  onProgress?.({ phase: "finalizing", percent: 100 });
  const finalized = await client.functions.invoke("finalize-media-upload", { body: { asset_id: assetId } });
  if (finalized.error) throw new Error(finalized.error.message || "operational_media_finalize_failed");
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
