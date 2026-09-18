import { describe, expect, it } from "vitest";
import type { BusinessCapability } from "../lib/businessApi";
import {
  TEAM_PRESETS,
  deriveTeamPreset,
  isProtectedTeamCapability,
} from "../lib/businessTeamPresets";

describe("Business Team presets", () => {
  it("defines the exact conservative Viewer preset", () => {
    expect(TEAM_PRESETS.viewer).toEqual([
      "business.home.read",
      "business.store.read",
      "business.catalog.read",
      "business.inventory.read",
      "business.orders.read",
      "business.returns.read",
      "business.disputes.read",
      "business.media.read",
      "business.analytics.read",
    ]);
  });

  it("keeps Finance and Manager sensitive grants explicit", () => {
    expect(TEAM_PRESETS.finance).toEqual([
      "business.home.read",
      "business.analytics.read",
      "business.finance.read",
      "business.payouts.read",
    ]);
    expect(TEAM_PRESETS.manager).not.toContain("business.team.manage");
    expect(TEAM_PRESETS.manager).not.toContain("business.settings.manage");
    expect(TEAM_PRESETS.manager).not.toContain("business.finance.read");
    expect(TEAM_PRESETS.manager).not.toContain("business.payouts.read");
    expect(TEAM_PRESETS.manager).not.toContain("business.payouts.manage");
    expect(Object.values(TEAM_PRESETS).every((preset) => !(preset as readonly BusinessCapability[]).includes("business.payouts.manage"))).toBe(true);
  });

  it.each([
    ["business.team.manage", true],
    ["business.settings.manage", true],
    ["business.finance.read", true],
    ["business.payouts.read", true],
    ["business.payouts.manage", true],
    ["business.ads.manage", false],
  ] as const)("classifies %s protected=%s", (capability, expected) => {
    expect(isProtectedTeamCapability(capability)).toBe(expected);
  });

  it("derives a preset only for an exact capability set", () => {
    expect(deriveTeamPreset([...TEAM_PRESETS.marketing].reverse())).toBe("marketing");
    expect(deriveTeamPreset([...TEAM_PRESETS.marketing, "business.team.read"])).toBe("custom");
    expect(deriveTeamPreset(TEAM_PRESETS.marketing.filter((code) => code !== "business.ads.manage"))).toBe("custom");
    expect(deriveTeamPreset([] as BusinessCapability[])).toBe("custom");
  });
});
