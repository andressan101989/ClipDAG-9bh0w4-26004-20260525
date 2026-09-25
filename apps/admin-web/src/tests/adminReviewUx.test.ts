import { describe, expect, it } from "vitest";
import type { AdsReviewItem } from "../lib/adminAdvertisingApi";
import { adminReviewMessage, reconcileAdminDecision, reviewReasonLabel } from "../lib/adminReviewUx";

const item = (overrides: Partial<AdsReviewItem> = {}): AdsReviewItem => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Ad", status: "draft", review_status: "rejected",
  submission_fingerprint: "fingerprint-one", submitted_at: "2026-09-25T00:00:00Z", reviewed_at: "2026-09-25T01:00:00Z",
  campaign: {}, ad_set: {}, creative: {}, destination: {},
  latest_decision: { event_type: "rejected", reason_code: "copy_invalid", note: "Internal detail", created_at: "2026-09-25T01:00:00Z" },
  ...overrides,
});

describe("Admin review UX authority mapping", () => {
  it("reconciles only an exact decision payload against the submitted fingerprint", () => {
    const intent = { adId: item().id, submissionFingerprint: "fingerprint-one", action: "reject" as const, reasonCode: "copy_invalid", note: "Internal detail" };
    expect(reconcileAdminDecision([item()], intent)).toEqual({ status: "applied_as_intended" });
    expect(reconcileAdminDecision([item({ submission_fingerprint: "fingerprint-two" })], intent)).toEqual({ status: "applied_differently" });
    expect(reconcileAdminDecision([item({ latest_decision: { ...item().latest_decision!, note: "Different detail" } })], intent)).toEqual({ status: "applied_differently" });
  });

  it("treats pending as not applied and another moderator decision as different", () => {
    const approve = { adId: item().id, submissionFingerprint: "fingerprint-one", action: "approve" as const, reasonCode: null, note: null };
    expect(reconcileAdminDecision([item({ review_status: "pending", latest_decision: null, reviewed_at: null })], approve)).toEqual({ status: "not_applied" });
    expect(reconcileAdminDecision([item()], approve)).toEqual({ status: "applied_differently" });
  });

  it("maps stable backend failures and reason codes to human language", () => {
    expect(adminReviewMessage(new Error("advertising_ad_submission_changed"))).toMatch(/changed after it was submitted/i);
    expect(adminReviewMessage(new Error("advertising_ad_not_pending"))).toMatch(/already reviewed/i);
    expect(reviewReasonLabel("unsafe_destination")).toBe("Unsafe destination");
  });
});
