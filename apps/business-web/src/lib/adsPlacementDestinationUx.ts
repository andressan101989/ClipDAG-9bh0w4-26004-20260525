import type { AdvertisingPlacementCapability } from "./adsManagerApi";

export const placementOrder = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"] as const;
export type AdvertisingPlacementCode = typeof placementOrder[number];
export type PlacementUxState = "available_for_setup" | "not_available_yet";

type PlacementSupport = {
  code: AdvertisingPlacementCode;
  label: string;
  description: string;
  state: PlacementUxState;
  selectable: boolean;
  status: string;
  productionDeliveryEnabled: boolean;
};

const placementSupport: Record<AdvertisingPlacementCode, PlacementSupport> = {
  social_feed: {
    code: "social_feed", label: "Social Feed", description: "Reach people while they browse their main feed.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
  clips: {
    code: "clips", label: "Clips", description: "Short-form video placement.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
  stories: {
    code: "stories", label: "Stories", description: "Full-screen story placement.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
  live: {
    code: "live", label: "Live", description: "Placement alongside live content.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
  marketplace_home: {
    code: "marketplace_home", label: "Marketplace Home", description: "Sponsored placement on Marketplace Home.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
  marketplace_search: {
    code: "marketplace_search", label: "Marketplace Search", description: "Sponsored placement in Marketplace Search.",
    state: "not_available_yet", selectable: false, status: "Not available", productionDeliveryEnabled: false,
  },
};

export type PlacementCard = PlacementSupport & { selectedPreviously: boolean; needsAttention: boolean };

export function placementCards(savedCodes: string[], capabilities: AdvertisingPlacementCapability[] = []): PlacementCard[] {
  const saved = new Set(savedCodes);
  const byCode = new Map(capabilities.map((item) => [item.code, item]));
  const known = placementOrder.map((code) => ({
    ...placementSupport[code],
    label: byCode.get(code)?.label ?? placementSupport[code].label,
    state: byCode.get(code)?.selectionEnabled && byCode.get(code)?.adapterReady ? "available_for_setup" as const : "not_available_yet" as const,
    selectable: Boolean(byCode.get(code)?.selectionEnabled && byCode.get(code)?.adapterReady),
    status: byCode.get(code)?.selectionEnabled && byCode.get(code)?.adapterReady ? "Available" : "Not available",
    productionDeliveryEnabled: byCode.get(code)?.productionDeliveryEnabled === true,
    selectedPreviously: saved.has(code),
    needsAttention: saved.has(code) && !(byCode.get(code)?.selectionEnabled && byCode.get(code)?.adapterReady),
  }));
  const unknown = savedCodes.filter((code) => !placementOrder.includes(code as AdvertisingPlacementCode)).map((code): PlacementCard => ({
    code: code as AdvertisingPlacementCode,
    label: "Unavailable placement",
    description: "This saved placement is not available for this Ads V2 release.",
    state: "not_available_yet",
    selectable: false,
    status: "Not available yet",
    productionDeliveryEnabled: false,
    selectedPreviously: true,
    needsAttention: true,
  }));
  return [...known, ...unknown];
}

export function isCurrentReleasePlacementSelection(codes: string[], capabilities: AdvertisingPlacementCapability[] = []) {
  const allowed = new Set(capabilities.filter((item) => item.selectionEnabled && item.adapterReady).map((item) => item.code));
  return codes.length > 0 && codes.every((code) => allowed.has(code as AdvertisingPlacementCode));
}

export type DestinationType = "external_url" | "nelyon_profile" | "nelyon_message" | "business_account" | "marketplace_product" | "marketplace_store";
type DestinationSupport = {
  type: DestinationType;
  label: string;
  description: string;
  safePicker: boolean;
  safeConsumer: boolean;
  selectable: boolean;
};

export const destinationSupport: Record<DestinationType, DestinationSupport> = {
  external_url: { type: "external_url", label: "External website", description: "Send people to a secure website.", safePicker: true, safeConsumer: true, selectable: true },
  nelyon_profile: { type: "nelyon_profile", label: "Nelyon profile", description: "Send people to your canonical Nelyon profile.", safePicker: true, safeConsumer: true, selectable: true },
  nelyon_message: { type: "nelyon_message", label: "Nelyon message", description: "Start a conversation with your canonical Nelyon identity.", safePicker: true, safeConsumer: true, selectable: true },
  business_account: { type: "business_account", label: "Business", description: "The mobile Business destination is not available yet.", safePicker: true, safeConsumer: false, selectable: false },
  marketplace_product: { type: "marketplace_product", label: "Marketplace product", description: "Attribute purchases of one eligible Marketplace product.", safePicker: true, safeConsumer: true, selectable: true },
  marketplace_store: { type: "marketplace_store", label: "Marketplace store", description: "Attribute eligible purchases from your Marketplace store.", safePicker: true, safeConsumer: true, selectable: true },
};

export const destinationOrder = ["external_url", "nelyon_profile", "nelyon_message", "business_account", "marketplace_product", "marketplace_store"] as const;

export function isApprovedAppStoreWebsite(input: string) {
  const validated = validateExternalWebsite(input);
  if (!validated.ok) return false;
  const parsed = new URL(validated.value);
  return (parsed.hostname === "apps.apple.com" || parsed.hostname === "play.google.com")
    && !parsed.username && !parsed.password && !parsed.port;
}

export function validateExternalWebsite(input: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim();
  if (!value || /\s/.test(value)) return { ok: false, message: "Enter a secure HTTPS website address." };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname) return { ok: false, message: "Enter a secure HTTPS website address." };
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, message: "Check the website address." };
  }
}

export function externalWebsiteSummary(value: string | null) {
  if (!value) return "Website address unavailable";
  try { return new URL(value).hostname; } catch { return "Website address unavailable"; }
}

export function destinationLabel(type: string) {
  return destinationSupport[type as DestinationType]?.label ?? "Saved destination";
}

export function isCurrentReleaseDestination(destination: { destinationType: string; externalUrl: string | null; targetProductId?: string | null; targetStoreId?: string | null } | null, objective?: string) {
  if (!destination) return false;
  if (objective === "marketplace_sales") {
    return (destination.destinationType === "marketplace_product" && Boolean(destination.targetProductId))
      || (destination.destinationType === "marketplace_store" && Boolean(destination.targetStoreId));
  }
  if (objective === "profile_visits") return destination.destinationType === "nelyon_profile";
  if (objective === "messages") return destination.destinationType === "nelyon_message";
  if (objective === "app_promotion") return destination.destinationType === "external_url" && isApprovedAppStoreWebsite(destination.externalUrl ?? "");
  return destination.destinationType === "external_url" && validateExternalWebsite(destination.externalUrl ?? "").ok;
}
