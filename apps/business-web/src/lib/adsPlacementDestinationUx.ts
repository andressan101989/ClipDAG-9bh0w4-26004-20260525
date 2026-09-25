export const placementOrder = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"] as const;
export type AdvertisingPlacementCode = typeof placementOrder[number];
export type PlacementUxState = "available_for_setup" | "not_available_yet" | "legacy_separate";

type PlacementSupport = {
  code: AdvertisingPlacementCode;
  label: string;
  description: string;
  state: PlacementUxState;
  selectable: boolean;
  status: string;
};

const placementSupport: Record<AdvertisingPlacementCode, PlacementSupport> = {
  social_feed: {
    code: "social_feed", label: "Social Feed", description: "Reach people while they browse their main feed.",
    state: "available_for_setup", selectable: true, status: "Available for setup · Delivery paused during pre-launch",
  },
  clips: {
    code: "clips", label: "Clips", description: "Short-form video placement.",
    state: "not_available_yet", selectable: false, status: "Not available yet",
  },
  stories: {
    code: "stories", label: "Stories", description: "Full-screen story placement.",
    state: "not_available_yet", selectable: false, status: "Not available yet",
  },
  live: {
    code: "live", label: "Live", description: "Placement alongside live content.",
    state: "not_available_yet", selectable: false, status: "Not available yet",
  },
  marketplace_home: {
    code: "marketplace_home", label: "Marketplace Home", description: "Marketplace promotions use a separate Marketplace advertising system.",
    state: "legacy_separate", selectable: false, status: "Separate Marketplace promotion",
  },
  marketplace_search: {
    code: "marketplace_search", label: "Marketplace Search", description: "Marketplace promotions use a separate Marketplace advertising system.",
    state: "legacy_separate", selectable: false, status: "Separate Marketplace promotion",
  },
};

export type PlacementCard = PlacementSupport & { selectedPreviously: boolean; needsAttention: boolean };

export function placementCards(savedCodes: string[]): PlacementCard[] {
  const saved = new Set(savedCodes);
  const known = placementOrder.map((code) => ({
    ...placementSupport[code],
    selectedPreviously: saved.has(code),
    needsAttention: saved.has(code) && !placementSupport[code].selectable,
  }));
  const unknown = savedCodes.filter((code) => !placementOrder.includes(code as AdvertisingPlacementCode)).map((code): PlacementCard => ({
    code: code as AdvertisingPlacementCode,
    label: "Unavailable placement",
    description: "This saved placement is not available for this Ads V2 release.",
    state: "not_available_yet",
    selectable: false,
    status: "Not available yet",
    selectedPreviously: true,
    needsAttention: true,
  }));
  return [...known, ...unknown];
}

export function isCurrentReleasePlacementSelection(codes: string[]) {
  return codes.length > 0 && codes.every((code) => code === "social_feed");
}

export type DestinationType = "external_url" | "nelyon_profile" | "business_account" | "marketplace_product" | "marketplace_store";
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
  nelyon_profile: { type: "nelyon_profile", label: "Nelyon profile", description: "A safe profile picker is not available yet.", safePicker: false, safeConsumer: true, selectable: false },
  business_account: { type: "business_account", label: "Business", description: "The mobile Business destination is not available yet.", safePicker: true, safeConsumer: false, selectable: false },
  marketplace_product: { type: "marketplace_product", label: "Marketplace product", description: "An Ads V2 product picker is not available yet.", safePicker: false, safeConsumer: true, selectable: false },
  marketplace_store: { type: "marketplace_store", label: "Marketplace store", description: "An Ads V2 store picker is not available yet.", safePicker: false, safeConsumer: true, selectable: false },
};

export const destinationOrder = ["external_url", "nelyon_profile", "business_account", "marketplace_product", "marketplace_store"] as const;

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

export function isCurrentReleaseDestination(destination: { destinationType: string; externalUrl: string | null } | null) {
  return destination?.destinationType === "external_url" && validateExternalWebsite(destination.externalUrl ?? "").ok;
}
