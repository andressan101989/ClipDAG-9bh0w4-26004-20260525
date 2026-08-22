import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getSupabaseClient } from "@/template";

export type MediaPurpose =
  | "avatar"
  | "post_image"
  | "carousel_image"
  | "thumbnail"
  | "product_image"
  | "product_video"
  | "store_logo"
  | "store_banner"
  | "chat_image"
  | "chat_audio"
  | "voice_note"
  | "music_audio"
  | "document"
  | "attachment"
  | "dispute_evidence"
  | "live_cover";
export type MediaVisibility = "public" | "private";
export interface UploadMediaInput {
  uri: string;
  purpose: MediaPurpose;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  visibility: MediaVisibility;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface MediaAssetDescriptor {
  assetId: string;
  provider: "r2";
  mediaKind: "image" | "audio" | "document" | "video";
  purpose: MediaPurpose;
  visibility: MediaVisibility;
  status: "ready";
  url?: string;
}
type CreateResponse = {
  success: boolean;
  data?: {
    assetId: string;
    uploadUrl: string;
    method: "PUT";
    headers: { "Content-Type": string };
    expiresAt: string;
  };
  error?: string;
};
export type MediaClientStage =
  | "MEDIA_INPUT"
  | "MEDIA_NORMALIZE_IMAGE"
  | "MEDIA_CREATE_UPLOAD_RECORD"
  | "MEDIA_R2_PUT"
  | "MEDIA_FINALIZE"
  | "MEDIA_DELETE"
  | "MEDIA_UNKNOWN";
type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  httpStatus?: unknown;
};
type FunctionErrorLike = ErrorLike & {
  context?: {
    status?: number;
    clone?: () => { json?: () => Promise<unknown> };
    json?: () => Promise<unknown>;
  };
};
export interface SafeMediaError {
  name: string;
  stage: string;
  code: string;
  message: string;
  details?: string;
  hint?: string;
  mimeType?: string;
  httpStatus?: number;
  operationId: string;
  attempts?: number;
}
export interface NormalizedUploadMedia {
  uri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
}

const supabase = getSupabaseClient();
const rejectLocalUrl = (value: string) =>
  /^(file|ph|content):\/\//i.test(value);
const DIRECT_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const IMAGE_PURPOSES = new Set<MediaPurpose>([
  "avatar",
  "post_image",
  "carousel_image",
  "thumbnail",
  "product_image",
  "store_logo",
  "store_banner",
  "chat_image",
  "dispute_evidence",
  "live_cover",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TEXT_LIMIT = 240;

export function createMediaOperationId(prefix = "media"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function safeText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
    .slice(0, SAFE_TEXT_LIMIT);
}
function numericStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
export class MediaClientError extends Error {
  stage: string;
  code: string;
  details?: string;
  hint?: string;
  mimeType?: string;
  httpStatus?: number;
  operationId: string;
  attempts?: number;
  constructor(input: Omit<SafeMediaError, "name">) {
    super(input.message);
    this.name = "MediaClientError";
    this.stage = input.stage;
    this.code = input.code;
    this.details = input.details;
    this.hint = input.hint;
    this.mimeType = input.mimeType;
    this.httpStatus = input.httpStatus;
    this.operationId = input.operationId;
    this.attempts = input.attempts;
  }
}
export class MediaEntityRpcError extends MediaClientError {
  constructor(input: Omit<SafeMediaError, "name">) {
    super(input);
    this.name = "MediaEntityRpcError";
  }
}
export function getSafeMediaError(
  error: unknown,
  fallbackStage: MediaClientStage | string = "MEDIA_UNKNOWN",
  context: Partial<Pick<SafeMediaError, "mimeType" | "operationId">> = {},
): SafeMediaError {
  const source = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const existing = error instanceof MediaClientError ? error : undefined;
  const message =
    safeText(existing?.message ?? source.message) ?? "media_operation_failed";
  const abort =
    source.name === "AbortError" || message.toLowerCase().includes("abort");
  return {
    name: safeText(existing?.name ?? source.name) ?? "MediaClientError",
    stage: existing?.stage ?? fallbackStage,
    code:
      existing?.code ??
      safeText(source.code) ??
      (abort ? "aborted" : "media_operation_failed"),
    message,
    details: safeText(existing?.details ?? source.details),
    hint: safeText(existing?.hint ?? source.hint),
    mimeType: existing?.mimeType ?? context.mimeType,
    httpStatus:
      existing?.httpStatus ??
      numericStatus(source.httpStatus) ??
      numericStatus(source.status),
    operationId:
      existing?.operationId ?? context.operationId ?? createMediaOperationId(),
    attempts: existing?.attempts,
  };
}
function asMediaClientError(
  error: unknown,
  stage: MediaClientStage,
  context: Partial<SafeMediaError>,
): MediaClientError {
  const safe = getSafeMediaError(error, stage, context);
  return new MediaClientError(safe);
}
async function normalizeFunctionInvokeError(
  error: unknown,
  dataError?: unknown,
): Promise<unknown> {
  if (!error) return { message: dataError, code: dataError };
  const source = error as FunctionErrorLike;
  let responseBody: unknown;
  try {
    const readable = source.context?.clone?.() ?? source.context;
    responseBody = await readable?.json?.();
  } catch {
    /* The response body is optional diagnostic context. */
  }
  const body =
    responseBody && typeof responseBody === "object"
      ? (responseBody as Record<string, unknown>)
      : {};
  const responseCode = body.error ?? body.code ?? dataError;
  return {
    name: source.name,
    message: responseCode ?? source.message,
    code: responseCode ?? source.code,
    details: body.details ?? source.details,
    hint: body.hint ?? source.hint,
    status: source.context?.status ?? source.status,
  };
}
export function shouldNormalizeImageForR2(
  mimeType: string | undefined,
  uri: string,
  fileName?: string,
): boolean {
  const mime = (mimeType ?? "").trim().toLowerCase();
  const candidate = (fileName || uri).split(/[?#]/)[0].toLowerCase();
  if (/\.(heic|heif)$/.test(candidate)) return true;
  if (DIRECT_IMAGE_MIMES.has(mime)) return false;
  if (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf"
  )
    return false;
  return (
    mime === "image/heic" ||
    mime === "image/heif" ||
    mime === "application/octet-stream" ||
    mime === "" ||
    mime.startsWith("image/")
  );
}
export async function normalizeImageForR2Upload(
  input: Pick<
    UploadMediaInput,
    "uri" | "mimeType" | "fileName" | "sizeBytes" | "purpose"
  >,
  convert: typeof manipulateAsync = manipulateAsync,
): Promise<NormalizedUploadMedia> {
  if (!IMAGE_PURPOSES.has(input.purpose)) return { ...input };
  if (!shouldNormalizeImageForR2(input.mimeType, input.uri, input.fileName))
    return { ...input };
  const operationId = createMediaOperationId("normalize");
  try {
    const result = await convert(input.uri, [], {
      compress: 0.9,
      format: SaveFormat.JPEG,
    });
    const convertedFile = new File(result.uri);
    const base = (input.fileName || "image").replace(/\.[^.]+$/, "");
    return {
      uri: result.uri,
      mimeType: "image/jpeg",
      fileName: `${base}.jpg`,
      sizeBytes: convertedFile.size,
    };
  } catch {
    throw new MediaClientError({
      stage: "MEDIA_NORMALIZE_IMAGE",
      code: "image_normalization_failed",
      message: "image_normalization_failed",
      mimeType: input.mimeType,
      operationId,
    });
  }
}
export function extractRpcUuid(data: unknown, functionName: string): string {
  let candidate: unknown = data;
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1)
      throw new MediaEntityRpcError({
        stage: "CAROUSEL_CLIENT_RESPONSE",
        code: "invalid_rpc_result",
        message: `invalid ${functionName} response array`,
        operationId: createMediaOperationId("rpc"),
      });
    candidate = candidate[0];
  }
  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    candidate = record[functionName] ?? record.id;
  }
  if (typeof candidate !== "string" || !UUID_PATTERN.test(candidate)) {
    throw new MediaEntityRpcError({
      stage: "CAROUSEL_CLIENT_RESPONSE",
      code: "invalid_rpc_result",
      message: `invalid ${functionName} response type`,
      operationId: createMediaOperationId("rpc"),
    });
  }
  return candidate;
}
export function isRetryableAuthRpcError(error: unknown): boolean {
  const source = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const text =
    `${safeText(source.code) ?? ""} ${safeText(source.message) ?? ""}`.toLowerCase();
  return (
    source.code === "42501" ||
    text.includes("unauthorized") ||
    text.includes("invalid jwt") ||
    text.includes("jwt expired") ||
    numericStatus(source.status) === 401
  );
}
export async function invokeRpcWithSingleAuthRefresh<T>(
  invoke: () => PromiseLike<{ data: T; error: unknown }>,
  refresh: () => PromiseLike<{ error: unknown }>,
): Promise<{ data: T; error: unknown }> {
  let result = await invoke();
  if (!result.error || !isRetryableAuthRpcError(result.error)) return result;
  const refreshed = await refresh();
  if (refreshed.error) return { data: result.data, error: refreshed.error };
  result = await invoke();
  return result;
}
export function validateCommonLinkedEntityRows(
  assetIds: string[],
  links: {
    asset_id: unknown;
    entity_id: unknown;
    position: unknown;
    slot: unknown;
  }[],
): string | null {
  if (
    assetIds.length < 2 ||
    new Set(assetIds).size !== assetIds.length ||
    links.length !== assetIds.length
  )
    return null;
  const requested = new Set(assetIds);
  if (
    links.some(
      (link) =>
        typeof link.asset_id !== "string" ||
        !requested.has(link.asset_id) ||
        link.slot !== "media",
    )
  )
    return null;
  const entityIds = new Set(
    links
      .map((link) => link.entity_id)
      .filter((value): value is string => typeof value === "string"),
  );
  if (entityIds.size !== 1) return null;
  const positions = links
    .map((link) => Number(link.position))
    .sort((a, b) => a - b);
  return positions.some((position, index) => position !== index)
    ? null
    : [...entityIds][0];
}

const R2_PUT_RETRY_DELAYS_MS = [500, 1500] as const;
const R2_RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
type R2PutResponse = Awaited<ReturnType<typeof expoFetch>>;
type R2PutFetcher = (
  url: string,
  init: {
    method: "PUT";
    headers: { "Content-Type": string };
    body: File;
    signal: AbortSignal;
  },
) => Promise<R2PutResponse>;
interface R2PutRetryInput {
  file: File;
  uploadUrl: string;
  headers: { "Content-Type": string };
  signal: AbortSignal;
  operationId: string;
  mimeType: string;
  fetcher?: R2PutFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
}
function classifyTransientTransportError(error: unknown): string | null {
  const source = (error && typeof error === "object" ? error : {}) as ErrorLike;
  if (source.name === "AbortError") return null;
  const text =
    `${safeText(source.code) ?? ""} ${safeText(source.message) ?? ""}`.toLowerCase();
  if (text.includes("network connection was lost"))
    return "network_connection_lost";
  if (text.includes("network request failed")) return "network_request_failed";
  if (text.includes("fetch failed")) return "fetch_failed";
  if (text.includes("connection reset") || text.includes("econnreset"))
    return "connection_reset";
  if (text.includes("etimedout")) return "network_timeout";
  if (text.includes("temporarily unavailable"))
    return "temporarily_unavailable";
  return null;
}
export async function putFileToR2WithRetry(
  input: R2PutRetryInput,
): Promise<R2PutResponse> {
  const fetcher = input.fetcher ?? (expoFetch as R2PutFetcher);
  const sleep =
    input.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = R2_PUT_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal.aborted) {
      throw new MediaClientError({
        stage: "MEDIA_R2_PUT",
        code: "aborted",
        message: "upload_aborted",
        mimeType: input.mimeType,
        operationId: input.operationId,
        attempts: attempt - 1,
      });
    }
    let response: R2PutResponse | undefined;
    let transientCode: string | null = null;
    try {
      response = await fetcher(input.uploadUrl, {
        method: "PUT",
        headers: input.headers,
        body: input.file,
        signal: input.signal,
      });
      if (response.ok) return response;
      if (R2_RETRYABLE_HTTP_STATUSES.has(response.status)) {
        transientCode = `media_upload_http_${response.status}`;
      } else {
        throw new MediaClientError({
          stage: "MEDIA_R2_PUT",
          code: `media_upload_http_${response.status}`,
          message: "media_upload_failed",
          mimeType: input.mimeType,
          httpStatus: response.status,
          operationId: input.operationId,
          attempts: attempt,
        });
      }
    } catch (error) {
      if (error instanceof MediaClientError) throw error;
      transientCode = classifyTransientTransportError(error);
      if (!transientCode) {
        throw asMediaClientError(error, "MEDIA_R2_PUT", {
          mimeType: input.mimeType,
          operationId: input.operationId,
        });
      }
    }
    const retrying = attempt < maxAttempts && !input.signal.aborted;
    console.warn("[MediaService] R2 PUT transient failure", {
      operationId: input.operationId,
      attempt,
      maxAttempts,
      stage: "MEDIA_R2_PUT",
      code: transientCode,
      httpStatus: response?.status,
      retrying,
    });
    if (!retrying) {
      throw new MediaClientError({
        stage: "MEDIA_R2_PUT",
        code: transientCode ?? "media_operation_failed",
        message: "r2_put_retries_exhausted",
        mimeType: input.mimeType,
        httpStatus: response?.status,
        operationId: input.operationId,
        attempts: attempt,
      });
    }
    await sleep(R2_PUT_RETRY_DELAYS_MS[attempt - 1]);
  }
  throw new MediaClientError({
    stage: "MEDIA_R2_PUT",
    code: "media_operation_failed",
    message: "r2_put_retries_exhausted",
    mimeType: input.mimeType,
    operationId: input.operationId,
    attempts: 3,
  });
}

export async function createMediaUpload(
  input: UploadMediaInput,
  operationId = createMediaOperationId(),
) {
  try {
    const file = new File(input.uri);
    const size = input.sizeBytes ?? file.size;
    const { data, error } = await supabase.functions.invoke<CreateResponse>(
      "create-media-upload",
      {
        body: {
          purpose: input.purpose,
          mime_type: input.mimeType,
          size_bytes: size,
          file_name: input.fileName ?? file.name,
          visibility: input.visibility,
        },
      },
    );
    if (error || !data?.success || !data.data) {
      const responseError = await normalizeFunctionInvokeError(
        error,
        data?.error,
      );
      throw asMediaClientError(responseError, "MEDIA_CREATE_UPLOAD_RECORD", {
        mimeType: input.mimeType,
        operationId,
      });
    }
    return { file, contract: data.data };
  } catch (error) {
    throw asMediaClientError(error, "MEDIA_CREATE_UPLOAD_RECORD", {
      mimeType: input.mimeType,
      operationId,
    });
  }
}
export async function finalizeMediaUpload(
  assetId: string,
  operationId = createMediaOperationId(),
  durationMs?: number,
): Promise<MediaAssetDescriptor> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "finalize-media-upload",
      { body: { asset_id: assetId, duration_ms: durationMs } },
    );
    if (error || !data?.success || !data.data)
      throw await normalizeFunctionInvokeError(error, data?.error);
    if (data.data.url && rejectLocalUrl(data.data.url))
      throw {
        message: "invalid_persisted_media_url",
        code: "invalid_persisted_media_url",
      };
    return data.data as MediaAssetDescriptor;
  } catch (error) {
    throw asMediaClientError(error, "MEDIA_FINALIZE", { operationId });
  }
}
export async function uploadMediaFromUri(
  input: UploadMediaInput,
): Promise<MediaAssetDescriptor> {
  const operationId = createMediaOperationId("upload");
  if (!input.uri)
    throw new MediaClientError({
      stage: "MEDIA_INPUT",
      code: "invalid_media_input",
      message: "invalid_media_input",
      mimeType: input.mimeType,
      operationId,
    });
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 120_000,
  );
  try {
    const normalized = IMAGE_PURPOSES.has(input.purpose)
      ? await normalizeImageForR2Upload(input)
      : {
          uri: input.uri,
          mimeType: input.mimeType,
          fileName: input.fileName ?? new File(input.uri).name,
          sizeBytes: input.sizeBytes ?? new File(input.uri).size,
        };
    const normalizedInput = { ...input, ...normalized };
    const { file, contract } = await createMediaUpload(
      normalizedInput,
      operationId,
    );
    await putFileToR2WithRetry({
      file,
      uploadUrl: contract.uploadUrl,
      headers: contract.headers,
      signal: controller.signal,
      operationId,
      mimeType: normalized.mimeType,
    });
    return await finalizeMediaUpload(
      contract.assetId,
      operationId,
      input.durationMs,
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}
export async function getMediaUrl(assetId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("get-media-url", {
    body: { asset_id: assetId },
  });
  if (error || !data?.success || !data.data?.url)
    throw new Error(data?.error ?? error?.message ?? "media_url_failed");
  return data.data.url;
}
export async function deleteMediaAsset(assetId: string): Promise<void> {
  const operationId = createMediaOperationId("delete");
  try {
    const { data, error } = await supabase.functions.invoke(
      "delete-media-asset",
      { body: { asset_id: assetId } },
    );
    if (error || !data?.success)
      throw await normalizeFunctionInvokeError(error, data?.error);
  } catch (error) {
    throw asMediaClientError(error, "MEDIA_DELETE", { operationId });
  }
}
export async function setProfileAvatarWithMedia(
  assetId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("set_profile_avatar_with_media", {
    p_asset_id: assetId,
  });
  if (error || typeof data !== "string" || !data.startsWith("https://")) {
    throw new Error(error?.message ?? "avatar_update_failed");
  }
  return data;
}
export type LinkableMediaEntity =
  | "user_profile"
  | "video_post"
  | "story"
  | "shop_product";

export async function linkMediaAsset(
  assetId: string,
  entityType: LinkableMediaEntity,
  entityId: string,
  slot: string,
  position = 0,
): Promise<void> {
  const { error } = await supabase.rpc("link_media_asset", {
    p_asset_id: assetId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_slot: slot,
    p_position: position,
  });
  if (error) throw new Error(error.message);
}
export async function getLinkedMediaAssetIds(
  entityType: LinkableMediaEntity,
  entityId: string,
  slot?: string,
): Promise<string[]> {
  let query = supabase
    .from("media_asset_links")
    .select("asset_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (slot) query = query.eq("slot", slot);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.asset_id as string);
}
export async function findCommonLinkedEntityForAssets(
  assetIds: string[],
  entityType: "video_post",
): Promise<string | null> {
  if (assetIds.length < 2 || new Set(assetIds).size !== assetIds.length)
    return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;
  const { data: links, error } = await supabase
    .from("media_asset_links")
    .select("asset_id,entity_id,position,slot")
    .in("asset_id", assetIds)
    .eq("entity_type", entityType)
    .eq("slot", "media");
  if (error || !links) return null;
  const entityId = validateCommonLinkedEntityRows(assetIds, links);
  if (!entityId) return null;
  const { data: entity, error: entityError } = await supabase
    .from("videos")
    .select("id")
    .eq("id", entityId)
    .eq("user_id", userId)
    .maybeSingle();
  return entityError || !entity ? null : entityId;
}
