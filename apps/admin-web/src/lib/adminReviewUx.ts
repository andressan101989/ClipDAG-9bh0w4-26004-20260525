import type { AdsReviewItem } from "./adminAdvertisingApi";
import type { AdminReviewIntent, AdminReviewReconciliation } from "./adminReviewCoordinator";

export const reviewReasonOptions = [
  ["policy_violation", "Policy violation"],
  ["misleading", "Misleading content"],
  ["unsafe_destination", "Unsafe destination"],
  ["prohibited_content", "Prohibited content"],
  ["restricted_content", "Restricted content"],
  ["media_invalid", "Media issue"],
  ["copy_invalid", "Ad copy issue"],
  ["other", "Other"],
] as const;

const ctaLabels: Record<string, string> = {
  learn_more: "Learn more", shop_now: "Shop now", sign_up: "Sign up", contact_us: "Contact us",
  send_message: "Send message", download: "Download", visit_profile: "Visit profile", none: "No button",
};

export function reviewReasonLabel(code: string | null | undefined) {
  return reviewReasonOptions.find(([value]) => value === code)?.[1] ?? "Review decision";
}

export function reviewStatusLabel(status: string) {
  return status === "pending" ? "Pending" : status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Not submitted";
}

export function reviewCtaLabel(value: unknown) {
  return typeof value === "string" ? ctaLabels[value] ?? "Action button" : "No button";
}

export function adminReviewMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (message.includes("advertising_ad_submission_changed")) return "This ad changed after it was submitted. Refresh before reviewing it.";
  if (message.includes("advertising_ad_not_pending")) return "This ad was already reviewed. We loaded the latest decision.";
  if (message.includes("advertising_ad_review_idempotency_conflict")) return "This review was completed with different details. Refresh the item.";
  if (message.includes("advertising_ad_review_other_note_required")) return "Add an internal note when the reason is Other.";
  if (message.includes("advertising_ad_review_reason_invalid")) return "Choose a valid rejection reason.";
  if (message.includes("42501") || /access|forbidden|permission/i.test(message)) return "You do not have permission to review this ad.";
  return message || "The review could not be completed.";
}

export function reconcileAdminDecision(items: AdsReviewItem[], intent: AdminReviewIntent): AdminReviewReconciliation {
  const item = items.find((candidate) => candidate.id === intent.adId);
  if (!item || item.review_status === "pending") return { status: "not_applied" };
  const expectedStatus = intent.action === "approve" ? "approved" : "rejected";
  const decision = item.latest_decision;
  if (item.submission_fingerprint !== intent.submissionFingerprint || item.review_status !== expectedStatus || !decision) return { status: "applied_differently" };
  const reasonMatches = (decision.reason_code ?? null) === (intent.reasonCode ?? null);
  const noteMatches = (decision.note ?? null) === (intent.note ?? null);
  return reasonMatches && noteMatches ? { status: "applied_as_intended" } : { status: "applied_differently" };
}
