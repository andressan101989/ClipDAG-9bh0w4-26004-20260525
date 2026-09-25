import { describe, expect, it } from "vitest";
import { isAdsDraftStaleError, presentAdsError } from "../../../../shared/adsErrorPresentation";

describe("Ads V2 error presentation taxonomy", () => {
  it.each([
    [new Error("JWT expired"), "auth_required", "Sign in again"],
    [{ code: "42501", message: "permission denied for table advertising_ads" }, "access_denied", "permission"],
    [{ code: "P0002", message: "advertising_campaign_not_found" }, "not_found", "no longer available"],
    [new Error("advertising_ad_set_draft_stale"), "stale_conflict", "another session"],
    [new Error("advertising_destination_draft_stale"), "stale_conflict", "another session"],
    [new Error("advertising_ad_review_idempotency_conflict"), "stale_conflict", "different details"],
    [new Error("advertising_adult_eligibility_required"), "prerequisite_missing", "adult eligibility"],
    [new Error("advertising_destination_in_use"), "prerequisite_missing", "already attached"],
    [new Error("age_eligibility_invalid_date_of_birth"), "validation", "valid date of birth"],
    [new Error("advertising_ad_review_other_note_required"), "validation", "internal note"],
    [new Error("advertising_ad_review_reason_invalid"), "validation", "valid rejection reason"],
    [new Error("advertising_ad_submission_changed"), "stale_conflict", "changed after"],
    [new Error("advertising_ad_not_pending"), "stale_conflict", "already reviewed"],
    [new Error("advertising_ad_already_pending"), "prerequisite_missing", "already in review"],
    [new Error("advertising_ad_already_approved"), "prerequisite_missing", "already approved"],
    [new Error("advertising_campaign_activation_disabled"), "platform_prelaunch", "pre-launch"],
    [new Error("advertising_campaign_not_operationally_ready"), "prerequisite_missing", "setup"],
  ])("maps %o to %s without exposing internals", (cause, kind, copy) => {
    const result = presentAdsError(cause, { operation: "mutation" });
    expect(result.kind).toBe(kind);
    expect(result.message).toMatch(new RegExp(copy, "i"));
    expect(result.message).not.toMatch(/advertising_|42501|P0002|table /i);
  });

  it("classifies retryable network and timeout reads while preserving safe data", () => {
    expect(presentAdsError(new TypeError("Failed to fetch"), { operation: "read" })).toMatchObject({ kind: "network", retryable: true, preserveData: true });
    const timeout = new Error("request timeout"); timeout.name = "AbortError";
    expect(presentAdsError(timeout, { operation: "read" })).toMatchObject({ kind: "timeout", retryable: true, preserveData: true });
  });

  it("treats an uncertain mutation as reconciliation instead of a read retry", () => {
    expect(presentAdsError({ kind: "uncertain", message: "network reset" }, { operation: "mutation" })).toMatchObject({
      kind: "mutation_uncertain",
      retryable: false,
      preserveData: true,
    });
    expect(presentAdsError(new TypeError("Failed to fetch"), { operation: "mutation" })).toMatchObject({ kind: "mutation_uncertain", retryable: false, preserveData: true });
    const timeout = new Error("request timeout"); timeout.name = "AbortError";
    expect(presentAdsError(timeout, { operation: "moderation" })).toMatchObject({ kind: "mutation_uncertain", retryable: false, preserveData: true });
  });

  it("centralizes the draft stale classifier used for canonical refresh", () => {
    expect(isAdsDraftStaleError(new Error("advertising_ad_set_draft_stale"))).toBe(true);
    expect(isAdsDraftStaleError({ code: "P0001", message: "advertising_destination_draft_stale" })).toBe(true);
    expect(isAdsDraftStaleError(new Error("advertising_ad_review_idempotency_conflict"))).toBe(false);
  });

  it("never leaks SQLSTATE, RPC names, table names, UUIDs, or stack details for unknown failures", () => {
    const cause = new Error("SQLSTATE XX000 public.create_my_advertising_ad_draft advertising_ads 42c5a99b-f430-438f-b64f-fe171f9fe2ab stack trace");
    const result = presentAdsError(cause, { operation: "mutation" });
    expect(result.kind).toBe("internal");
    expect(result.message).toBe("We couldn't complete this action. Try again.");
    expect(result.message).not.toMatch(/XX000|create_my|advertising_ads|42c5a99b|stack/i);
  });

  it("uses a privacy-safe unavailable message for an unknown detail read", () => {
    const result = presentAdsError(new Error("secret backend response"), { operation: "read", resource: "campaign" });
    expect(result.message).toBe("We couldn't load this campaign. Try again.");
    expect(result.retryable).toBe(true);
  });
});
