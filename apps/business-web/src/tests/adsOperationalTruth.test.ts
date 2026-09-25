import { describe, expect, it } from "vitest";
import {
  ADS_OPERATIONAL_RUNTIME,
  deriveLifecyclePresentation,
  deriveReadinessPresentation,
  metricPresentation,
  validateBudgetDecimal,
} from "../../../../shared/adsOperationalTruth";

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
});
