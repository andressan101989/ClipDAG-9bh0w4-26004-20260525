export type AdsWorkflowStatus = "not_started" | "in_progress" | "complete" | "needs_attention" | "blocked";
export type AdsWorkflowStepKey = "campaign" | "ad_set" | "audience" | "placements" | "destination" | "creative" | "ad" | "review" | "budget" | "readiness";

export type AdsWorkflowInput = {
  campaign: { exists: boolean; status: string | null };
  adSet: { selected: boolean; count: number; status: string | null; scheduleValid: boolean };
  audience: { exists: boolean; valid: boolean; policyCurrent: boolean };
  placements: { exists: boolean; valid: boolean };
  destination: { selected: boolean; count: number; valid: boolean };
  creative: { exists: boolean; usable: boolean };
  ad: { selected: boolean; count: number; status: string | null; reviewStatus: string | null };
  finance: { exists: boolean; valid: boolean };
  readiness: { structurallyReady: boolean; activationEnabled: boolean; blockers: string[] };
};

export type AdsWorkflowStep = { key: AdsWorkflowStepKey; number: number; label: string; status: AdsWorkflowStatus };

const labels: Record<AdsWorkflowStepKey, string> = {
  campaign: "Campaign", ad_set: "Ad Set", audience: "Audience", placements: "Placements",
  destination: "Destination", creative: "Creative", ad: "Ad", review: "Review", budget: "Budget", readiness: "Readiness",
};

function childSelectionStatus(count: number, selected: boolean, valid: boolean): AdsWorkflowStatus {
  if (count === 0) return "not_started";
  if (!selected) return "blocked";
  return valid ? "complete" : "needs_attention";
}

export function deriveAdsWorkflow(input: AdsWorkflowInput) {
  const campaign: AdsWorkflowStatus = input.campaign.exists ? "complete" : "not_started";
  const adSet = childSelectionStatus(input.adSet.count, input.adSet.selected, input.adSet.status === "draft" && input.adSet.scheduleValid);
  const audience: AdsWorkflowStatus = !input.adSet.selected ? "blocked" : !input.audience.exists ? "not_started" : !input.audience.valid || !input.audience.policyCurrent ? "needs_attention" : "complete";
  const placements: AdsWorkflowStatus = !input.adSet.selected ? "blocked" : !input.placements.exists ? "not_started" : input.placements.valid ? "complete" : "needs_attention";
  const destination = childSelectionStatus(input.destination.count, input.destination.selected, input.destination.valid);
  const creative: AdsWorkflowStatus = !input.creative.exists ? "not_started" : input.creative.usable ? "complete" : "in_progress";
  const ad: AdsWorkflowStatus = !input.adSet.selected || !input.destination.selected || !input.destination.valid || !input.creative.usable ? "blocked" : childSelectionStatus(input.ad.count, input.ad.selected, input.ad.status === "draft");
  const review: AdsWorkflowStatus = !input.ad.selected ? "blocked" : (() => {
    if (["approved"].includes(input.ad.reviewStatus ?? "")) return "complete";
    if (["pending", "submitted", "in_review"].includes(input.ad.reviewStatus ?? "")) return "in_progress";
    if (["rejected", "needs_changes"].includes(input.ad.reviewStatus ?? "")) return "needs_attention";
    return "not_started";
  })();
  const budget: AdsWorkflowStatus = !input.finance.exists ? "not_started" : input.finance.valid ? "complete" : "needs_attention";
  const readiness: AdsWorkflowStatus = input.readiness.structurallyReady && input.readiness.activationEnabled ? "complete" : input.readiness.structurallyReady ? "blocked" : input.readiness.blockers.length > 0 ? "in_progress" : "in_progress";
  const statuses: Record<AdsWorkflowStepKey, AdsWorkflowStatus> = { campaign, ad_set: adSet, audience, placements, destination, creative, ad, review, budget, readiness };
  const order = Object.keys(labels) as AdsWorkflowStepKey[];
  const steps = order.map((key, index): AdsWorkflowStep => ({ key, number: index + 1, label: labels[key], status: statuses[key] }));
  const actions: Array<[AdsWorkflowStepKey, string]> = [
    ["campaign", "Create Campaign"], ["ad_set", input.adSet.count > 1 && !input.adSet.selected ? "Select an Ad Set" : "Create Ad Set"],
    ["audience", input.audience.exists ? "Update Audience" : "Complete Audience"], ["placements", "Review Placements"],
    ["destination", input.destination.count > 1 && !input.destination.selected ? "Choose Destination" : "Choose Destination"],
    ["creative", "Add Creative"], ["ad", "Create Ad"], ["review", "Submit for Review"], ["budget", "Set Budget"], ["readiness", "Review Readiness"],
  ];
  const first = actions.find(([key]) => statuses[key] !== "complete" && !(key === "review" && statuses.review === "in_progress")) ?? ["readiness", "Review Readiness"];
  return { steps, nextAction: { step: first[0] as AdsWorkflowStepKey, label: first[1] } };
}

export function resolveWorkspaceSelection<T extends { id: string }>(rows: T[], requestedId: string | null) {
  if (requestedId) {
    const selected = rows.find((row) => row.id === requestedId) ?? null;
    return selected
      ? { selected, canonicalId: selected.id, reason: "explicit" as const }
      : { selected: null, canonicalId: null, reason: "invalid" as const };
  }
  if (rows.length === 0) return { selected: null, canonicalId: null, reason: "empty" as const };
  if (rows.length === 1) return { selected: rows[0], canonicalId: rows[0].id, reason: "sole" as const };
  return { selected: null, canonicalId: null, reason: "selection_required" as const };
}
