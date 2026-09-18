import type { BusinessCapability } from "./businessApi";

export const PROTECTED_TEAM_CAPABILITIES = [
  "business.team.manage",
  "business.settings.manage",
  "business.finance.read",
  "business.payouts.read",
  "business.payouts.manage",
] as const satisfies readonly BusinessCapability[];

export const TEAM_PRESETS = {
  viewer: [
    "business.home.read",
    "business.store.read",
    "business.catalog.read",
    "business.inventory.read",
    "business.orders.read",
    "business.returns.read",
    "business.disputes.read",
    "business.media.read",
    "business.analytics.read",
  ],
  operations: [
    "business.home.read",
    "business.store.read",
    "business.catalog.read",
    "business.catalog.manage",
    "business.inventory.read",
    "business.inventory.manage",
    "business.orders.read",
    "business.orders.fulfill",
    "business.returns.read",
    "business.returns.manage",
    "business.disputes.read",
    "business.disputes.respond",
    "business.media.read",
  ],
  marketing: [
    "business.home.read",
    "business.store.read",
    "business.catalog.read",
    "business.media.read",
    "business.media.manage",
    "business.ads.read",
    "business.ads.manage",
    "business.analytics.read",
  ],
  finance: [
    "business.home.read",
    "business.analytics.read",
    "business.finance.read",
    "business.payouts.read",
  ],
  manager: [
    "business.home.read",
    "business.store.read",
    "business.catalog.read",
    "business.catalog.manage",
    "business.inventory.read",
    "business.inventory.manage",
    "business.orders.read",
    "business.orders.fulfill",
    "business.returns.read",
    "business.returns.manage",
    "business.disputes.read",
    "business.disputes.respond",
    "business.media.read",
    "business.ads.read",
    "business.ads.manage",
    "business.analytics.read",
    "business.team.read",
  ],
} as const satisfies Record<string, readonly BusinessCapability[]>;

export type TeamPreset = keyof typeof TEAM_PRESETS | "custom";

export const TEAM_PRESET_LABELS: Record<TeamPreset, string> = {
  viewer: "Viewer",
  operations: "Operations",
  marketing: "Marketing",
  finance: "Finance",
  manager: "Manager",
  custom: "Custom",
};

const protectedSet = new Set<BusinessCapability>(PROTECTED_TEAM_CAPABILITIES);

export function isProtectedTeamCapability(code: BusinessCapability) {
  return protectedSet.has(code);
}

export function deriveTeamPreset(capabilities: readonly BusinessCapability[]): TeamPreset {
  const normalized = [...new Set(capabilities)].sort();
  for (const [preset, codes] of Object.entries(TEAM_PRESETS) as [keyof typeof TEAM_PRESETS, readonly BusinessCapability[]][]) {
    const candidate = [...codes].sort();
    if (candidate.length === normalized.length && candidate.every((code, index) => code === normalized[index])) {
      return preset;
    }
  }
  return "custom";
}
