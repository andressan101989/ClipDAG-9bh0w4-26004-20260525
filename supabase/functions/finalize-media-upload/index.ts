import { authenticatedUser, admin, json } from "../_shared/mediaAuth.ts";
import {
  deleteObject,
  headObject,
  isR2NotFound,
  isR2Transient,
  publicUrl,
} from "../_shared/r2.ts";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
Deno.serve(async (req) => {
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
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!a) return json({ error: "not_found" }, 404);
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
    if (
      Number(head.ContentLength) !== Number(a.size_bytes) ||
      head.ContentType !== a.mime_type
    ) {
      await db
        .from("media_assets")
        .update({
          status: "delete_pending",
          error_code: "object_mismatch",
          next_cleanup_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id);
      try {
        await deleteObject(a.bucket_name, a.object_key);
        await db
          .from("media_assets")
          .update({
            status: "deleted",
            deleted_at: new Date().toISOString(),
            next_cleanup_attempt_at: null,
            cleanup_attempts: Number(a.cleanup_attempts ?? 0) + 1,
            last_cleanup_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", a.id)
          .eq("status", "delete_pending");
      } catch {
        await db
          .from("media_assets")
          .update({ error_code: "object_mismatch_delete_retry" })
          .eq("id", a.id);
      }
      return json({ error: "object_mismatch" }, 409);
    }
    if (
      a.purpose === "product_video" &&
      (!Number.isSafeInteger(durationMs) ||
        durationMs <= 0 ||
        durationMs > 60000)
    ) {
      await db
        .from("media_assets")
        .update({
          status: "failed",
          error_code: "invalid_video_duration",
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id);
      return json({ error: "invalid_video_duration" }, 400);
    }
    const resolvedPublicUrl =
      a.visibility === "public" ? publicUrl(a.object_key) : null;
    const { error: readyError } = await db
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
      .in("status", ["pending", "uploading"]);
    if (readyError) return json({ error: "finalize_state_failed" }, 503);
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
      await db
        .from("media_assets")
        .update({
          status: "failed",
          error_code: "object_missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id);
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
