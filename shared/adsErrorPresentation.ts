export type AdsErrorKind =
  | "auth_required"
  | "access_denied"
  | "validation"
  | "stale_conflict"
  | "prerequisite_missing"
  | "capability_disabled"
  | "platform_prelaunch"
  | "not_found"
  | "network"
  | "timeout"
  | "mutation_uncertain"
  | "permanent_rejection"
  | "internal";

export type AdsErrorPresentation = {
  kind: AdsErrorKind;
  message: string;
  retryable: boolean;
  preserveData: boolean;
};

type ErrorOptions = { operation: "read" | "mutation" | "moderation"; resource?: string };
type ErrorShape = { code?: unknown; message?: unknown; name?: unknown; status?: unknown; kind?: unknown };

function errorShape(cause: unknown): ErrorShape {
  if (cause instanceof Error) return { name: cause.name, message: cause.message, code: (cause as Error & { code?: unknown }).code };
  return cause !== null && typeof cause === "object" ? cause as ErrorShape : { message: String(cause ?? "") };
}

function result(kind: AdsErrorKind, message: string, retryable = false, preserveData = false): AdsErrorPresentation {
  return { kind, message, retryable, preserveData };
}

export function isAdsDraftStaleError(cause: unknown): boolean {
  const shape = errorShape(cause);
  const signal = `${typeof shape.code === "string" ? shape.code : ""} ${typeof shape.message === "string" ? shape.message : ""}`.toLowerCase();
  return /advertising_(ad_set|destination)_draft_stale/.test(signal);
}

export function presentAdsError(cause: unknown, options: ErrorOptions): AdsErrorPresentation {
  const shape = errorShape(cause);
  const message = typeof shape.message === "string" ? shape.message : "";
  const code = typeof shape.code === "string" ? shape.code : "";
  const name = typeof shape.name === "string" ? shape.name : "";
  const signal = `${code} ${name} ${message}`.toLowerCase();
  const read = options.operation === "read";
  const resource = options.resource?.trim() || "information";

  if (shape.kind === "uncertain") return result("mutation_uncertain", "We couldn't confirm the result yet. Checking the saved state is required before trying again.", false, true);
  if (name === "AbortError" || /\b(timeout|timed out|deadline exceeded)\b/.test(signal)) {
    return read
      ? result("timeout", `Loading this ${resource} took too long. Try again.`, true, true)
      : result("mutation_uncertain", "We couldn't confirm the result yet. We will check the saved state before another attempt.", false, true);
  }
  if (cause instanceof TypeError || /failed to fetch|network|econn|connection reset|offline|load failed/.test(signal)) {
    return read
      ? result("network", `We couldn't load this ${resource}. Check your connection and try again.`, true, true)
      : result("mutation_uncertain", "We couldn't confirm the result yet. We will check the saved state before another attempt.", false, true);
  }
  if (/jwt|pgrst301|auth required|not authenticated|unauthenticated/.test(signal) || shape.status === 401) return result("auth_required", "Sign in again to continue.");
  if (code === "42501" || shape.status === 403 || /access_denied|permission denied|forbidden|insufficient privilege/.test(signal)) return result("access_denied", "You do not have permission to complete this action.");
  if (code === "P0002" || /not_found|not found|no rows/.test(signal)) return result("not_found", `This ${resource} is no longer available or you do not have access to it.`);

  if (/advertising_ad_set_draft_stale|advertising_destination_draft_stale/.test(signal)) return result("stale_conflict", "This draft changed in another session. Refresh to load the latest version.", true, true);
  if (/advertising_ad_submission_changed/.test(signal)) return result("stale_conflict", "This ad changed after it was submitted. Refresh before trying again.", true, true);
  if (/advertising_ad_not_pending/.test(signal)) return result("stale_conflict", "This ad was already reviewed. We loaded the latest decision.", true, true);
  if (/advertising_ad_review_idempotency_conflict/.test(signal)) return result("stale_conflict", "This review was completed with different details. Refresh the item.", true, true);
  if (/idempotency_conflict/.test(signal)) return result("stale_conflict", "This action was already completed with different details. Refresh the saved state before continuing.", true, true);

  if (/advertising_adult_eligibility_required/.test(signal)) return result("prerequisite_missing", "Advertising creation requires verified adult eligibility.");
  if (/advertising_destination_in_use/.test(signal)) return result("prerequisite_missing", "This destination is already attached to an ad and can't be changed here.");
  if (/advertising_ad_already_pending/.test(signal)) return result("prerequisite_missing", "This ad is already in review.");
  if (/advertising_ad_already_approved/.test(signal)) return result("prerequisite_missing", "This ad is already approved.");
  if (/advertising_campaign_not_operationally_ready|prerequisite/.test(signal)) return result("prerequisite_missing", "Complete the required campaign setup before continuing.");

  if (/upload_transport_failed|upload_failed_\d+|media_reservation_(invalid|failed)/.test(signal)) {
    return result("permanent_rejection", "Upload failed. Please try again.");
  }
  if (/media_finalize_(rejected|temporarily_unavailable|not_ready|failed|invalid)|object_missing|head_temporarily_unavailable/.test(signal)) {
    return result("permanent_rejection", "We couldn't finish processing this file. Upload the file again.");
  }

  if (/age_eligibility_invalid_date_of_birth/.test(signal)) return result("validation", "Enter a valid date of birth.");
  if (/advertising_ad_review_other_note_required/.test(signal)) return result("validation", "Add an internal note when the reason is Other.");
  if (/advertising_ad_review_reason_invalid/.test(signal)) return result("validation", "Choose a valid rejection reason.");
  if (/validation|invalid|23514|22023/.test(signal)) return result("validation", "Check the highlighted information and try again.");

  if (/activation_disabled|funding_disabled|spend_disabled|settlement_disabled|global_delivery_disabled|v2_delivery_disabled/.test(signal)) {
    return result("platform_prelaunch", "This action is unavailable during the current pre-launch phase.");
  }
  if (/capability_disabled|not_enabled/.test(signal)) return result("capability_disabled", "This capability is not available yet.");
  if (/cancelled|completed|immutable|permanent_rejection|invalid_state/.test(signal)) return result("permanent_rejection", "The current saved state does not allow this action. Refresh to see the latest status.", true, true);

  if (read) return result("internal", `We couldn't load this ${resource}. Try again.`, true, true);
  return result("internal", "We couldn't complete this action. Try again.", false, true);
}
