import { describe, expect, it } from "vitest";
import {
  deriveAdsWorkflow,
  resolveWorkspaceSelection,
  type AdsWorkflowInput,
} from "../lib/adsWorkflowState";

const base: AdsWorkflowInput = {
  campaign: { exists: true, status: "draft" },
  adSet: { selected: true, count: 1, status: "draft", scheduleValid: true },
  audience: { exists: true, valid: true, policyCurrent: true },
  placements: { exists: true, valid: true },
  destination: { selected: true, count: 1, valid: true },
  creative: { exists: false, usable: false },
  ad: { selected: false, count: 0, status: null, reviewStatus: null },
  finance: { exists: false, valid: false },
  readiness: { structurallyReady: false, activationEnabled: false, blockers: [] },
};

describe("Ads draft workflow state", () => {
  it("derives the current production partial draft without recommending activation", () => {
    const workflow = deriveAdsWorkflow(base);
    expect(workflow.steps.map((step) => [step.key, step.status])).toEqual([
      ["campaign", "complete"],
      ["ad_set", "complete"],
      ["audience", "complete"],
      ["placements", "complete"],
      ["destination", "complete"],
      ["creative", "not_started"],
      ["ad", "blocked"],
      ["review", "blocked"],
      ["budget", "not_started"],
      ["readiness", "in_progress"],
    ]);
    expect(workflow.nextAction).toEqual({ step: "creative", label: "Add Creative" });
    expect(workflow.nextAction.label).not.toMatch(/activate/i);
  });

  it("covers every canonical status deterministically", () => {
    const workflow = deriveAdsWorkflow({
      ...base,
      adSet: { selected: true, count: 1, status: "draft", scheduleValid: false },
      audience: { exists: true, valid: true, policyCurrent: false },
      destination: { selected: false, count: 2, valid: false },
      creative: { exists: true, usable: false },
      ad: { selected: true, count: 1, status: "draft", reviewStatus: "pending" },
      finance: { exists: true, valid: true },
      readiness: { structurallyReady: false, activationEnabled: false, blockers: ["platform_locked"] },
    });
    expect(new Set(workflow.steps.map((step) => step.status))).toEqual(new Set([
      "complete", "needs_attention", "blocked", "in_progress",
    ]));
    expect(deriveAdsWorkflow({ ...base, campaign: { exists: false, status: null } }).steps[0].status).toBe("not_started");
  });

  it("requires explicit selection for multiple children and never chooses row one", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(resolveWorkspaceSelection(rows, null)).toEqual({ selected: null, canonicalId: null, reason: "selection_required" });
    expect(resolveWorkspaceSelection(rows, "b")).toEqual({ selected: rows[1], canonicalId: "b", reason: "explicit" });
    expect(resolveWorkspaceSelection(rows, "foreign")).toEqual({ selected: null, canonicalId: null, reason: "invalid" });
  });

  it("auto-selects a sole child without creating a database mutation", () => {
    const only = { id: "only" };
    expect(resolveWorkspaceSelection([only], null)).toEqual({ selected: only, canonicalId: "only", reason: "sole" });
    expect(resolveWorkspaceSelection([], null)).toEqual({ selected: null, canonicalId: null, reason: "empty" });
  });

  it("recommends the next customer action while review is already pending", () => {
    const workflow = deriveAdsWorkflow({
      ...base,
      creative: { exists: true, usable: true },
      ad: { selected: true, count: 1, status: "draft", reviewStatus: "pending" },
    });
    expect(workflow.nextAction).toEqual({ step: "budget", label: "Set Budget" });
  });
});
