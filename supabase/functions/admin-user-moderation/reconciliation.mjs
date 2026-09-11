export function normalizeBannedUntil(value) {
  if (value === null || value === undefined || value === "") {
    return { valid: true, value: null };
  }
  if (typeof value !== "string") return { valid: false, value: null };
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { valid: false, value: null };
  return { valid: true, value: new Date(timestamp).toISOString() };
}

export function requestedStateIsSatisfied(action, bannedUntil, nowMs = Date.now()) {
  const normalized = normalizeBannedUntil(bannedUntil);
  if (!normalized.valid) return false;
  if (action === "suspend") {
    return normalized.value !== null && Date.parse(normalized.value) > nowMs;
  }
  if (action === "restore") {
    return normalized.value === null || Date.parse(normalized.value) <= nowMs;
  }
  return false;
}

export function safeProviderCode(error) {
  const candidate = String(error?.code || "auth_admin_error")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "_")
    .slice(0, 120);
  return candidate || "auth_admin_error";
}

function retryable(error) {
  return { kind: "retryable", error };
}

async function finalizeOutcome(finalize, result, bannedUntilAfter, providerErrorCode) {
  try {
    const receipt = await finalize({ result, bannedUntilAfter, providerErrorCode });
    if (result === "succeeded") return { kind: "succeeded", receipt };
    return {
      kind: "failed",
      error: providerErrorCode === "auth_state_changed" ? "auth_state_changed" : "auth_admin_failed",
      providerErrorCode,
      receipt,
    };
  } catch {
    return retryable("finalize_unavailable");
  }
}

export async function reconcileUserModeration({
  prepared,
  action,
  nowMs = Date.now(),
  readAuthState,
  updateAuthState,
  finalize,
}) {
  if (prepared?.status === "succeeded") {
    return { kind: "succeeded", receipt: prepared };
  }
  if (prepared?.status === "failed") {
    return {
      kind: "failed",
      error: "command_failed",
      providerErrorCode: prepared.provider_error_code || null,
      receipt: prepared,
    };
  }
  if (prepared?.status !== "pending" || (action !== "suspend" && action !== "restore")) {
    return { kind: "failed", error: "command_state_invalid", providerErrorCode: null, receipt: null };
  }

  const original = normalizeBannedUntil(prepared.auth_banned_until_before);
  if (!original.valid) return retryable("command_state_unavailable");

  let current;
  try {
    current = normalizeBannedUntil(await readAuthState());
  } catch {
    return retryable("auth_state_unavailable");
  }
  if (!current.valid) return retryable("auth_state_unavailable");

  // Provider state is authoritative. This closes a prior invocation whose Auth
  // mutation succeeded but whose database finalize call was unavailable.
  if (requestedStateIsSatisfied(action, current.value, nowMs)) {
    return finalizeOutcome(finalize, "succeeded", current.value, null);
  }

  if (current.value !== original.value) {
    return finalizeOutcome(finalize, "failed", current.value, "auth_state_changed");
  }

  let updateErrorCode = null;
  let updated = { valid: false, value: null };
  try {
    updated = normalizeBannedUntil(await updateAuthState());
    if (!updated.valid) updateErrorCode = "auth_admin_response_invalid";
  } catch (error) {
    updateErrorCode = safeProviderCode(error);
  }

  if (updated.valid && requestedStateIsSatisfied(action, updated.value, nowMs)) {
    return finalizeOutcome(finalize, "succeeded", updated.value, null);
  }

  let authoritative;
  try {
    authoritative = normalizeBannedUntil(await readAuthState());
  } catch {
    return retryable("auth_state_unavailable");
  }
  if (!authoritative.valid) return retryable("auth_state_unavailable");

  if (requestedStateIsSatisfied(action, authoritative.value, nowMs)) {
    return finalizeOutcome(finalize, "succeeded", authoritative.value, null);
  }

  const failureCode = updateErrorCode
    || (authoritative.value !== original.value ? "auth_state_changed" : "auth_state_not_applied");
  return finalizeOutcome(finalize, "failed", authoritative.value, failureCode);
}
