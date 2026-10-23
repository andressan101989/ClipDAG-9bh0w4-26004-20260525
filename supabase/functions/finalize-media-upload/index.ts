import { businessActorHasAnyCapability } from "../_shared/businessMediaAuth.ts";
import { authenticatedUser, admin, corsHeaders, json } from "../_shared/mediaAuth.ts";
import {
  PREMIUM_ORIGINAL_CACHE_CONTROL,
  premiumOriginalHasRequiredCacheControl,
} from "../_shared/premiumR2Security.ts";
import {
  headObject,
  isR2NotFound,
  isR2Transient,
  publicUrl,
} from "../_shared/r2.ts";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ObjectMismatchCode =
  | "object_size_mismatch"
  | "object_content_type_mismatch"
  | "object_size_and_content_type_mismatch"
  | "premium_original_cache_control_mismatch";

export function classifyObjectMismatch(
  expectedSize: number,
  actualSize: number,
  expectedContentType: string,
  actualContentType: string,
): ObjectMismatchCode | null {
  const sizeMismatch = actualSize !== expectedSize;
  const contentTypeMismatch = actualContentType !== expectedContentType;
  if (sizeMismatch && contentTypeMismatch)
    return "object_size_and_content_type_mismatch";
  if (sizeMismatch) return "object_size_mismatch";
  if (contentTypeMismatch) return "object_content_type_mismatch";
  return null;
}

export function objectMismatchDiagnostic(
  expectedSize: number,
  actualSize: number,
  expectedContentType: string,
  actualContentType: string,
) {
  const mismatchCode = classifyObjectMismatch(
    expectedSize,
    actualSize,
    expectedContentType,
    actualContentType,
  );
  if (!mismatchCode) return null;
  return {
    error: "object_mismatch",
    mismatch_code: mismatchCode,
    details: [
      `expected_size=${expectedSize}`,
      `actual_size=${actualSize}`,
      `expected_type=${expectedContentType}`,
      `actual_type=${actualContentType}`,
    ].join(";"),
  };
}

export function premiumOriginalCacheControlMismatchDiagnostic(
  purpose: unknown,
  actualCacheControl: unknown,
) {
  if (
    purpose !== "creator_premium_original_image" ||
    premiumOriginalHasRequiredCacheControl(actualCacheControl)
  ) return null;
  const actualState =
    typeof actualCacheControl === "string" && actualCacheControl.trim()
      ? "invalid"
      : "missing";
  return {
    error: "object_mismatch",
    mismatch_code: "premium_original_cache_control_mismatch" as const,
    details: [
      `expected_cache_control=${PREMIUM_ORIGINAL_CACHE_CONTROL}`,
      `actual_cache_control=${actualState}`,
    ].join(";"),
  };
}

async function headWithRetry(bucket: string, key: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await headObject(bucket, key);
    } catch (error) {
      if (isR2NotFound(error)) throw error;
      lastError = error;
      if (!isR2Transient(error) && attempt === 2) throw error;
      if (attempt < 2) await wait(150 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function scheduleCleanup(
  db: ReturnType<typeof admin>,
  assetId: string,
  ownerId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("schedule_media_asset_deletion", {
    p_asset_id: assetId,
    p_owner_id: ownerId,
  });
  return !error && ["scheduled", "deleted"].includes(String(data));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await authenticatedUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const { asset_id, duration_ms } = await req.json().catch(() => ({}));
  const db = admin();
  const durationMs = duration_ms == null ? null : Number(duration_ms);
  // MKT-B1 validates duration metadata supplied by the official picker/upload
  // flow. This function does not decode or probe the video bitstream. Physical
  // duration inspection belongs to a future media probing/transcoding phase.
  const { data: a } = await db
    .from("media_assets")
    .select("*")
    .eq("id", asset_id)
    .maybeSingle();
  if (!a) return json({ error: "not_found" }, 404);
  if (a.owner_id !== user.id) {
    const capability = a.purpose === "business_library"
      ? "business.media.manage"
      : a.purpose === "return_label"
        ? "business.returns.manage"
        : a.purpose === "dispute_evidence"
          ? "business.disputes.respond"
          : null;
    const allowed = capability
      && await businessActorHasAnyCapability(req, String(a.owner_id), [capability]);
    if (!allowed) return json({ error: "business_media_capability_required" }, 403);
  }
  if (a.status === "ready") {
    if (a.visibility === "public" && !a.public_url)
      return json({ error: "public_url_missing" }, 409);
    return json({
      success: true,
      data: {
        assetId: a.id,
        provider: "r2",
        mediaKind: a.media_kind,
        purpose: a.purpose,
        visibility: a.visibility,
        status: "ready",
        ...(a.visibility === "public" ? { url: a.public_url } : {}),
      },
    });
  }
  if (!["pending", "uploading"].includes(a.status))
    return json({ error: "invalid_status" }, 409);
  try {
    const head = await headWithRetry(a.bucket_name, a.object_key);
    const expectedSize = Number(a.size_bytes);
    const actualSize = Number(head.ContentLength);
    const expectedContentType = String(a.mime_type ?? "");
    const actualContentType = String(head.ContentType ?? "");
    const sizeMismatch = Number(head.ContentLength) !== Number(a.size_bytes);
    const contentTypeMismatch = head.ContentType !== a.mime_type;
    const contentMismatchDiagnostic =
      sizeMismatch || contentTypeMismatch
        ? objectMismatchDiagnostic(
            expectedSize,
            actualSize,
            expectedContentType,
            actualContentType,
          )
        : null;
    const mismatchDiagnostic = contentMismatchDiagnostic ??
      premiumOriginalCacheControlMismatchDiagnostic(
        a.purpose,
        head.CacheControl,
      );
    if (mismatchDiagnostic) {
      console.warn("[finalize-media-upload] object mismatch", {
        mismatchCode: mismatchDiagnostic.mismatch_code,
        expectedSize,
        actualSize,
        expectedContentType,
        actualContentType,
      });
      if (!await scheduleCleanup(db, String(a.id), String(a.owner_id))) {
        return json({ error: "media_finalize_stale" }, 409);
      }
      return json(mismatchDiagnostic, 409);
    }
    if (
      a.purpose === "product_video" &&
      (durationMs == null ||
        !Number.isSafeInteger(durationMs) ||
        durationMs <= 0 ||
        durationMs > 60000)
    ) {
      if (!await scheduleCleanup(db, String(a.id), String(a.owner_id))) {
        return json({ error: "media_finalize_stale" }, 409);
      }
      return json({ error: "invalid_video_duration" }, 400);
    }
    const resolvedPublicUrl =
      a.visibility === "public" ? publicUrl(a.object_key) : null;
    const { data: readyRow, error: readyError } = await db
      .from("media_assets")
      .update({
        status: "ready",
        etag: String(head.ETag ?? "").replaceAll('"', ""),
        public_url: resolvedPublicUrl,
        duration_ms: a.purpose === "product_video" ? durationMs : a.duration_ms,
        ready_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", a.id)
      .in("status", ["pending", "uploading"])
      .select("id").maybeSingle();
    if (readyError) return json({ error: "finalize_state_failed" }, 503);
    if (readyRow?.id !== a.id) return json({ error: "media_finalize_stale" }, 409);
    return json({
      success: true,
      data: {
        assetId: a.id,
        provider: "r2",
        mediaKind: a.media_kind,
        purpose: a.purpose,
        visibility: a.visibility,
        status: "ready",
        ...(resolvedPublicUrl ? { url: resolvedPublicUrl } : {}),
      },
    });
  } catch (error) {
    if (isR2NotFound(error)) {
      const { data: failedRow, error: failedError } = await db
        .from("media_assets")
        .update({
          status: "failed",
          error_code: "object_missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id)
        .in("status", ["pending", "uploading"])
        .select("id").maybeSingle();
      if (failedError) return json({ error: "finalize_state_failed" }, 503);
      if (failedRow?.id !== a.id) return json({ error: "media_finalize_stale" }, 409);
      return json({ error: "object_missing" }, 409);
    }
    await db
      .from("media_assets")
      .update({
        error_code: "head_temporarily_unavailable",
        updated_at: new Date().toISOString(),
      })
      .eq("id", a.id)
      .in("status", ["pending", "uploading"]);
    return json({ error: "head_temporarily_unavailable" }, 503);
  }
});
