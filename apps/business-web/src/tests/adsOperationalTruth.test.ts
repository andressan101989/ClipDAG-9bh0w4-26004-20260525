import { describe, expect, it } from "vitest";
import {
  ADS_OPERATIONAL_RUNTIME,
  businessMetricPresentation,
  deriveBusinessAdsRuntime,
  deriveBusinessReadinessPresentation,
  deriveBusinessStatusSummary,
  deriveLifecyclePresentation,
  deriveReadinessPresentation,
  metricPresentation,
  validateBudgetDecimal,
} from "../lib/adsOperationalTruth";

describe("Ads operational truth presentation", () => {
  it("maps every canonical readiness blocker without exposing raw codes", () => {
    const blockers = [
      "campaign_not_found", "business_inactive", "ad_account_inactive",
      "advertiser_adult_eligibility_required", "campaign_finance_not_funded",
      "campaign_budget_exhausted", "audience_version_missing",
      "audience_targeting_policy_stale", "viewer_geo_authority_unavailable",
      "viewer_language_authority_unavailable", "placement_selection_missing",
      "placement_v2_delivery_disabled", "ad_review_fingerprint_mismatch",
      "creative_media_unavailable", "no_operational_ad_set", "campaign_schedule_expired",
    ];
    const result = deriveReadinessPresentation(blockers, { fundingEnabled: false });

    expect(result.mapped).toHaveLength(blockers.length);
    expect(result.mapped.every((item) => !item.message.includes(item.code))).toBe(true);
    expect(result.platform.map((item) => item.code)).toContain("campaign_finance_not_funded");
    expect(result.platform.map((item) => item.code)).toContain("placement_v2_delivery_disabled");
    expect(result.account.map((item) => item.code)).toEqual(expect.arrayContaining(["business_inactive", "ad_account_inactive"]));
    expect(result.user.map((item) => item.code)).toEqual(expect.arrayContaining(["audience_version_missing", "campaign_schedule_expired"]));
    expect(result.visible.some((item) => item.code === "no_operational_ad_set")).toBe(false);
  });

  it("treats unfunded finance as actionable only when canonical funding is available", () => {
    const locked = deriveReadinessPresentation(["campaign_finance_not_funded"], { fundingEnabled: false });
    const available = deriveReadinessPresentation(["campaign_finance_not_funded"], { fundingEnabled: true });
    expect(locked.platform[0]?.action).toBeNull();
    expect(available.user[0]?.action?.label).toBe("Fund campaign");
  });

  it.each([
    ["0.01000000", true], ["1", true], ["1.12345678", true],
    ["0", false], ["-1", false], ["1.123456789", false],
    ["NaN", false], ["1e-2", false], ["", false],
  ])("validates exact BDAG decimal %s", (value, valid) => {
    const result = validateBudgetDecimal(value);
    expect(result.valid).toBe(valid);
    if (valid) expect(result.canonical).toBe(value);
  });

  it("keeps lifecycle actions aligned to canonical states and policy", () => {
    expect(deriveLifecyclePresentation("draft", { structurallyReady: true, activationEnabled: false }).activate).toEqual({ visible: true, enabled: false });
    expect(deriveLifecyclePresentation("draft", { structurallyReady: true, activationEnabled: true }).activate).toEqual({ visible: true, enabled: true });
    expect(deriveLifecyclePresentation("active", { structurallyReady: false, activationEnabled: false }).pause).toEqual({ visible: true, enabled: true });
    expect(deriveLifecyclePresentation("paused", { structurallyReady: true, activationEnabled: false }).resume).toEqual({ visible: true, enabled: false });
    for (const status of ["completed", "cancelled", "archived"] as const) {
      const result = deriveLifecyclePresentation(status, { structurallyReady: true, activationEnabled: true });
      expect(result.activate.visible || result.pause.visible || result.resume.visible || result.cancel.visible).toBe(false);
    }
  });

  it("distinguishes measured zero, no delivery, unavailable runtime, and pre-launch billing", () => {
    expect(metricPresentation("impressions", 0, ADS_OPERATIONAL_RUNTIME)).toMatchObject({ state: "zero_no_delivery", display: "0" });
    for (const metric of ["clicks", "destination_opens", "video_views", "engagements", "ctr", "conversions", "attributed_conversions", "marketplace_purchase_value_bdag"] as const) {
      expect(metricPresentation(metric, 0, ADS_OPERATIONAL_RUNTIME).state).toBe("not_available_yet");
    }
    expect(metricPresentation("spend", 0, ADS_OPERATIONAL_RUNTIME).state).toBe("platform_disabled");
  });

  it("supports future producers without inventing CTR when there are no impressions", () => {
    const future = { ...ADS_OPERATIONAL_RUNTIME, deliveryEnabled: true, interactionRuntime: true, conversionRuntime: true, attributionRuntime: true, billingRuntime: true };
    expect(metricPresentation("clicks", 7, future)).toMatchObject({ state: "measured", display: "7" });
    expect(metricPresentation("ctr", 0, future, { impressions: 0 })).toMatchObject({ state: "measured", display: "—", detail: "No impressions yet" });
    expect(metricPresentation("conversions", 3, future)).toMatchObject({ state: "measured", display: "3" });
  });

  it("derives Business runtime truth without claiming unsupported interaction producers", () => {
    const runtime = deriveBusinessAdsRuntime({ deliveryEnabled: true, fundingEnabled: true, spendEnabled: false });

    expect(runtime).toMatchObject({ deliveryEnabled: true, fundingEnabled: true, billingRuntime: false });
    expect(businessMetricPresentation("clicks", 2, runtime)).toEqual({ state: "measured", display: "2", detail: null });
    expect(businessMetricPresentation("ctr", 0, runtime, { impressions: 0 })).toEqual({ state: "measured", display: "—", detail: "No impressions yet" });
    expect(businessMetricPresentation("destination_opens", 7, runtime)).toEqual({ state: "measured", display: "7", detail: null });
    expect(businessMetricPresentation("conversions", 3, runtime)).toEqual({ state: "measured", display: "3", detail: null });
    expect(businessMetricPresentation("attributed_conversions", 2, runtime)).toEqual({ state: "measured", display: "2", detail: null });
    for (const metric of ["video_views", "engagements"] as const) {
      expect(businessMetricPresentation(metric, 7, runtime).state).toBe("not_available_yet");
    }
  });

  it("does not infer a Business billing runtime from a policy switch alone", () => {
    const runtime = deriveBusinessAdsRuntime({ deliveryEnabled: true, fundingEnabled: true, spendEnabled: true });

    expect(runtime.billingRuntime).toBe(false);
    expect(businessMetricPresentation("spend", 4, runtime).state).toBe("platform_disabled");
    expect(businessMetricPresentation("cpc", 2, runtime).state).toBe("platform_disabled");
  });

  it("maps locked readiness to neutral canonical platform truth", () => {
    const locked = deriveBusinessReadinessPresentation(
      ["campaign_finance_not_funded", "placement_v2_delivery_disabled"],
      { fundingAvailable: false },
    );

    expect(locked.platform.map((item) => item.message)).toEqual([
      "Campaign funding is currently unavailable.",
      "The selected placement is currently unavailable for Ads V2 delivery.",
    ]);
    expect(locked.platform.every((item) => !item.message.toLowerCase().includes("pre-launch"))).toBe(true);
  });

  it.each([
    ["draft", true, false, false, "Setup complete", "Campaign activation is currently unavailable."],
    ["draft", true, true, false, "Setup complete", "Fund the campaign before activation."],
    ["draft", true, true, true, "Ready to activate", "All canonical readiness checks pass."],
    ["active", true, false, true, "Campaign active", "Delivery follows the current policy and placement state."],
    ["paused", true, true, true, "Campaign paused", "Resume is available while canonical activation readiness remains satisfied."],
    ["cancelled", true, false, false, "Campaign cancelled", "This campaign is terminal and cannot be resumed."],
  ])("presents %s operational status from canonical lifecycle and readiness", (status, structurallyReady, activationEnabled, financeReady, title, detail) => {
    expect(deriveBusinessStatusSummary({ status, structurallyReady, activationEnabled, financeReady })).toEqual({ title, detail });
  });
});
