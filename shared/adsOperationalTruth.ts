export type ReadinessCategory = "user_action" | "platform" | "account" | "aggregate";

export type ReadinessAction = { label: string; href: string };
export type ReadinessItem = {
  code: string;
  category: ReadinessCategory;
  message: string;
  action: ReadinessAction | null;
};

type ReadinessContext = { fundingEnabled: boolean };

const readinessCatalog: Record<string, Omit<ReadinessItem, "code">> = {
  campaign_not_found: { category: "account", message: "This campaign could not be found.", action: null },
  business_inactive: { category: "account", message: "Your Business account needs attention.", action: null },
  ad_account_inactive: { category: "account", message: "Your Ad Account needs attention.", action: null },
  advertiser_adult_eligibility_required: { category: "user_action", message: "Complete age eligibility before this campaign can continue.", action: { label: "Complete age eligibility", href: "#age-eligibility" } },
  campaign_finance_not_funded: { category: "platform", message: "Campaign funding is not available during the current pre-launch phase.", action: null },
  campaign_budget_exhausted: { category: "account", message: "The funded budget has been used.", action: null },
  audience_version_missing: { category: "user_action", message: "Create an audience for the selected Ad Set.", action: { label: "Create audience", href: "#audience" } },
  audience_targeting_policy_stale: { category: "user_action", message: "Your audience settings need to be reviewed.", action: { label: "Review audience", href: "#audience" } },
  viewer_geo_authority_unavailable: { category: "user_action", message: "Review audience settings before continuing.", action: { label: "Review audience settings", href: "#audience" } },
  viewer_language_authority_unavailable: { category: "user_action", message: "Review audience settings before continuing.", action: { label: "Review audience settings", href: "#audience" } },
  placement_selection_missing: { category: "user_action", message: "Choose where this ad should appear.", action: { label: "Choose placements", href: "#placements" } },
  placement_v2_delivery_disabled: { category: "platform", message: "Ad delivery for the selected placement is not enabled yet.", action: null },
  ad_review_fingerprint_mismatch: { category: "user_action", message: "The submitted ad no longer matches its reviewed assembly.", action: { label: "Create a revised ad", href: "#ad" } },
  creative_media_unavailable: { category: "user_action", message: "The creative media is unavailable and needs to be updated.", action: { label: "Update creative", href: "#creative" } },
  no_operational_ad_set: { category: "aggregate", message: "No Ad Set is currently ready to deliver.", action: null },
  campaign_schedule_expired: { category: "user_action", message: "The Ad Set schedule has ended.", action: { label: "Update Ad Set schedule", href: "#ad-set" } },
};

function readinessItem(code: string, context: ReadinessContext): ReadinessItem {
  if (code === "campaign_finance_not_funded" && context.fundingEnabled) {
    return { code, category: "user_action", message: "Fund this campaign before activation.", action: { label: "Fund campaign", href: "#budget" } };
  }
  const known = readinessCatalog[code];
  if (known) return { code, ...known };
  return { code, category: "account", message: "Campaign readiness needs attention.", action: null };
}

export function deriveReadinessPresentation(blockers: readonly string[], context: ReadinessContext) {
  const mapped = [...new Set(blockers)].map((code) => readinessItem(code, context));
  const hasSpecific = mapped.some((item) => item.category !== "aggregate");
  const visible = mapped.filter((item) => item.category !== "aggregate" || !hasSpecific);
  return {
    mapped,
    visible,
    user: visible.filter((item) => item.category === "user_action"),
    platform: visible.filter((item) => item.category === "platform"),
    account: visible.filter((item) => item.category === "account"),
  };
}

export type BudgetValidation = { valid: true; canonical: string; error: null } | { valid: false; canonical: null; error: string };

export function validateBudgetDecimal(input: string): BudgetValidation {
  const value = input.trim();
  if (!value) return { valid: false, canonical: null, error: "Enter a valid budget amount." };
  const decimal = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!decimal) return { valid: false, canonical: null, error: "Enter a valid budget amount without signs or scientific notation." };
  if ((decimal[1]?.length ?? 0) > 8) return { valid: false, canonical: null, error: "Use no more than 8 decimal places." };
  if (BigInt(value.replace(".", "")) === 0n) return { valid: false, canonical: null, error: "Budget must be greater than zero." };
  return { valid: true, canonical: value, error: null };
}

export function sameBudgetDecimal(left: string | number, right: string | number) {
  const normalize = (value: string | number) => {
    const [whole, fraction = ""] = String(value).split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return normalize(left) === normalize(right);
}

type WorkflowStep = { key: string; status: string };
const setupActions: Record<string, { initial: string; attention: string; href: string }> = {
  ad_set: { initial: "Create Ad Set", attention: "Update Ad Set schedule", href: "#ad-set" },
  audience: { initial: "Create audience", attention: "Review audience", href: "#audience" },
  placements: { initial: "Choose placements", attention: "Review placements", href: "#placements" },
  destination: { initial: "Add destination", attention: "Review destination", href: "#destination" },
  creative: { initial: "Add Creative", attention: "Update Creative", href: "#creative" },
  ad: { initial: "Create Ad", attention: "Create revised Ad", href: "#ad" },
  review: { initial: "Submit for review", attention: "Create revised Ad", href: "#review" },
  budget: { initial: "Set budget", attention: "Review budget", href: "#budget" },
};

export function deriveWorkflowSetupActions(steps: readonly WorkflowStep[]): ReadinessAction[] {
  return steps.flatMap((step) => {
    const action = setupActions[step.key];
    if (!action || step.status === "complete" || step.status === "blocked" || (step.key === "review" && step.status === "in_progress")) return [];
    return [{ label: step.status === "not_started" ? action.initial : action.attention, href: action.href }];
  });
}

export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed" | "cancelled" | "archived";
type LifecycleContext = { structurallyReady: boolean; activationEnabled: boolean };
type LifecycleActionPresentation = { visible: boolean; enabled: boolean };

export function deriveLifecyclePresentation(status: CampaignStatus | string, context: LifecycleContext): Record<"activate" | "pause" | "resume" | "cancel", LifecycleActionPresentation> {
  const hidden = { visible: false, enabled: false };
  return {
    activate: status === "draft" ? { visible: true, enabled: context.structurallyReady && context.activationEnabled } : hidden,
    pause: status === "scheduled" || status === "active" ? { visible: true, enabled: true } : hidden,
    resume: status === "paused" ? { visible: true, enabled: context.structurallyReady && context.activationEnabled } : hidden,
    cancel: ["draft", "scheduled", "active", "paused"].includes(status) ? { visible: true, enabled: true } : hidden,
  };
}

export type AdsOperationalRuntime = {
  impressionRuntime: boolean;
  deliveryEnabled: boolean;
  interactionRuntime: boolean;
  conversionRuntime: boolean;
  attributionRuntime: boolean;
  billingRuntime: boolean;
  fundingEnabled: boolean;
};

export const ADS_OPERATIONAL_RUNTIME: Readonly<AdsOperationalRuntime> = Object.freeze({
  impressionRuntime: true,
  deliveryEnabled: false,
  interactionRuntime: false,
  conversionRuntime: false,
  attributionRuntime: false,
  billingRuntime: false,
  fundingEnabled: false,
});
export type MetricKey = "impressions" | "clicks" | "destination_opens" | "video_views" | "engagements" | "ctr" | "conversions" | "attributed_conversions" | "marketplace_purchase_value_bdag" | "spend" | "cpc" | "cpm" | "cpa";
export type MetricState = "measured" | "zero_no_delivery" | "not_available_yet" | "platform_disabled";
export type MetricPresentation = { state: MetricState; display: string; detail: string | null };

function measured(value: unknown): MetricPresentation {
  const numeric = Number(value);
  return { state: "measured", display: Number.isFinite(numeric) ? String(numeric) : "—", detail: null };
}

export function metricPresentation(metric: MetricKey, value: unknown, runtime: AdsOperationalRuntime, context: { impressions?: number } = {}): MetricPresentation {
  if (metric === "impressions") {
    if (!runtime.impressionRuntime) return { state: "not_available_yet", display: "Not available yet", detail: "Impression measurement is not available yet." };
    const result = measured(value);
    if (Number(value) === 0 && !runtime.deliveryEnabled) return { state: "zero_no_delivery", display: "0", detail: "No delivery yet" };
    return result;
  }
  if (["clicks", "destination_opens", "video_views", "engagements", "ctr"].includes(metric)) {
    if (!runtime.interactionRuntime) return { state: "not_available_yet", display: "Not available yet", detail: "Interaction measurement is not available yet." };
    if (metric === "ctr" && context.impressions === 0) return { state: "measured", display: "—", detail: "No impressions yet" };
    return measured(value);
  }
  if (metric === "conversions" && !runtime.conversionRuntime) return { state: "not_available_yet", display: "Not available yet", detail: "Conversion measurement is not available yet." };
  if (["attributed_conversions", "marketplace_purchase_value_bdag"].includes(metric) && !runtime.attributionRuntime) return { state: "not_available_yet", display: "Not available yet", detail: "Attribution measurement is not available yet." };
  if (["spend", "cpc", "cpm", "cpa"].includes(metric) && !runtime.billingRuntime) {
    return { state: "platform_disabled", display: metric === "spend" ? "Pre-launch" : "Not available yet", detail: "Ad billing is not active during pre-launch." };
  }
  return measured(value);
}
