import {
  ADS_OPERATIONAL_RUNTIME,
  deriveReadinessPresentation,
  metricPresentation,
  serverMetricPresentation,
  type AdsOperationalRuntime,
  type MetricKey,
} from "../../../../shared/adsOperationalTruth";

export * from "../../../../shared/adsOperationalTruth";

export type BusinessAdsRuntime = AdsOperationalRuntime & { clickRuntime: boolean };

export function deriveBusinessAdsRuntime(input: { deliveryEnabled: boolean; fundingEnabled: boolean; spendEnabled: boolean }): BusinessAdsRuntime {
  return {
    ...ADS_OPERATIONAL_RUNTIME,
    deliveryEnabled: input.deliveryEnabled,
    fundingEnabled: input.fundingEnabled,
    // The policy switch is not runtime capability evidence. PLR-9 billing
    // truth is supplied by the canonical server projection instead.
    billingRuntime: false,
    clickRuntime: true,
    interactionRuntime: true,
    conversionRuntime: true,
    attributionRuntime: true,
  };
}

export function businessServerMetricPresentation(
  value: unknown,
  status: "available" | "no_data" | "not_applicable",
  options: { suffix?: string; detail?: string } = {},
) {
  return serverMetricPresentation(value, status, options);
}

export function businessMetricPresentation(
  metric: MetricKey,
  value: unknown,
  runtime: BusinessAdsRuntime,
  context: { impressions?: number } = {},
) {
  const supportedInteraction = metric === "clicks" || metric === "destination_opens" || metric === "ctr";
  const presentation = metricPresentation(
    metric,
    value,
    ["video_views", "engagements"].includes(metric)
      ? { ...runtime, interactionRuntime: false }
      : supportedInteraction ? { ...runtime, interactionRuntime: runtime.clickRuntime } : runtime,
    context,
  );
  return presentation.state === "platform_disabled"
    ? { ...presentation, detail: "Ad billing is currently unavailable." }
    : presentation;
}

export function deriveBusinessReadinessPresentation(blockers: readonly string[], context: { fundingAvailable: boolean }) {
  const presentation = deriveReadinessPresentation(blockers, { fundingEnabled: context.fundingAvailable });
  const remap = (item: (typeof presentation.mapped)[number]) => {
    if (item.code === "campaign_finance_not_funded" && !context.fundingAvailable) {
      return { ...item, message: "Campaign funding is currently unavailable." };
    }
    if (item.code === "placement_v2_delivery_disabled") {
      return { ...item, message: "The selected placement is currently unavailable for Ads V2 delivery." };
    }
    return item;
  };
  const mapped = presentation.mapped.map(remap);
  const visibleCodes = new Set(presentation.visible.map((item) => item.code));
  const visible = mapped.filter((item) => visibleCodes.has(item.code));
  return {
    mapped,
    visible,
    user: visible.filter((item) => item.category === "user_action"),
    platform: visible.filter((item) => item.category === "platform"),
    account: visible.filter((item) => item.category === "account"),
  };
}

export function deriveBusinessStatusSummary(input: { status: string; structurallyReady: boolean; activationEnabled: boolean; financeReady: boolean }) {
  if (input.status === "cancelled" || input.status === "completed" || input.status === "archived") {
    return { title: `Campaign ${input.status}`, detail: "This campaign is terminal and cannot be resumed." };
  }
  if (input.status === "active" || input.status === "scheduled") {
    return { title: input.status === "active" ? "Campaign active" : "Campaign scheduled", detail: "Delivery follows the current policy and placement state." };
  }
  if (input.status === "paused") {
    return {
      title: "Campaign paused",
      detail: input.activationEnabled && input.structurallyReady
        ? "Resume is available while canonical activation readiness remains satisfied."
        : "Resume is currently unavailable until canonical readiness and activation authority allow it.",
    };
  }
  if (!input.structurallyReady) {
    return { title: "Not ready yet", detail: "Complete the available setup actions and review the canonical blockers below." };
  }
  if (!input.activationEnabled) {
    return { title: "Setup complete", detail: "Campaign activation is currently unavailable." };
  }
  if (!input.financeReady) {
    return { title: "Setup complete", detail: "Fund the campaign before activation." };
  }
  return { title: "Ready to activate", detail: "All canonical readiness checks pass." };
}
