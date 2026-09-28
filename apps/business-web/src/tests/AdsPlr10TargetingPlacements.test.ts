import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AdvertisingAudienceDefinition,
  AdvertisingPlacementCapability,
  AdvertisingTargetingCapabilities,
} from "../lib/adsManagerApi";
import {
  audienceCapabilitiesAreSafe,
  createAudienceFormState,
  formatAudienceAgeRange,
  serializeAudienceForm,
  validateAudienceForm,
} from "../lib/audienceTargetingUx";
import { isCurrentReleasePlacementSelection, placementCards } from "../lib/adsPlacementDestinationUx";

const capabilities: AdvertisingTargetingCapabilities = {
  policyVersion: "nelyon-ads-targeting-v3",
  advertiserMinimumAge: 18,
  audienceMinimumAge: 13,
  audienceMaximumAge: 120,
  ageScope: "age_range",
  geoTargetingEnabled: false,
  languageTargetingEnabled: false,
  daypartTargetingEnabled: true,
  frequencyTargetingEnabled: true,
  interestTargetingEnabled: false,
  behavioralTargetingEnabled: false,
  customAudiencesEnabled: false,
  lookalikeTargetingEnabled: false,
  sensitiveTargetingAllowed: false,
  preciseViewerLocationMatchingEnabled: false,
};

const baseDefinition: AdvertisingAudienceDefinition = {
  age_scope: "age_range",
  min_age: 18,
  max_age: 35,
  geographies: [],
  languages: [],
  dayparts: [],
  frequency: null,
};

const placements = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"] as const;
const placementCapabilities: AdvertisingPlacementCapability[] = placements.map((code) => ({
  code,
  label: code,
  surfaceFamily: code.startsWith("marketplace") ? "marketplace" : code === "live" ? "live" : "social",
  selectionEnabled: true,
  adapterReady: true,
  productionDeliveryEnabled: false,
}));

describe("PLR-10 configurable age targeting", () => {
  it("round-trips 18–35 through the canonical Business definition", () => {
    const form = createAudienceFormState(baseDefinition, "UTC", capabilities);
    expect(form.minimumAge).toBe("18");
    expect(form.maximumAge).toBe("35");
    expect(form.noUpperAgeLimit).toBe(false);
    expect(serializeAudienceForm(form)).toEqual(baseDefinition);
    expect(formatAudienceAgeRange(baseDefinition)).toBe("Ages 18–35");
    expect(validateAudienceForm(form, capabilities)).toEqual({ valid: true, fieldErrors: {} });
  });

  it("represents 65+ with a null canonical upper bound", () => {
    const definition = { ...baseDefinition, min_age: 65, max_age: null };
    const form = createAudienceFormState(definition, "UTC", capabilities);
    expect(form.noUpperAgeLimit).toBe(true);
    expect(serializeAudienceForm(form)).toEqual(definition);
    expect(formatAudienceAgeRange(definition)).toBe("Ages 65+");
  });

  it.each([
    ["12", "17", false, "minimumAge"],
    ["18", "17", false, "maximumAge"],
    ["18", "121", false, "maximumAge"],
    ["13", "17", false, null],
  ])("validates age range %s–%s against server capabilities", (minimumAge, maximumAge, noUpperAgeLimit, errorField) => {
    const form = createAudienceFormState(baseDefinition, "UTC", capabilities);
    Object.assign(form, { minimumAge, maximumAge, noUpperAgeLimit });
    const result = validateAudienceForm(form, capabilities);
    expect(result.valid).toBe(errorField === null);
    if (errorField) expect(result.fieldErrors).toHaveProperty(errorField);
  });

  it("accepts only the server-backed v3 safe capability envelope", () => {
    expect(audienceCapabilitiesAreSafe(capabilities)).toBe(true);
    expect(audienceCapabilitiesAreSafe({ ...capabilities, audienceMinimumAge: 12 })).toBe(false);
    expect(audienceCapabilitiesAreSafe({ ...capabilities, audienceMaximumAge: 121 })).toBe(false);
    expect(audienceCapabilitiesAreSafe({ ...capabilities, sensitiveTargetingAllowed: true })).toBe(false);
  });
});

describe("PLR-10 placement capability truth", () => {
  it("allows all six adapters for setup while keeping production delivery disabled", () => {
    const cards = placementCards([], placementCapabilities);
    expect(cards.map((card) => card.code)).toEqual(placements);
    expect(cards.every((card) => card.selectable)).toBe(true);
    expect(cards.every((card) => card.status === "Available")).toBe(true);
    expect(cards.every((card) => card.productionDeliveryEnabled === false)).toBe(true);
    expect(isCurrentReleasePlacementSelection([...placements], placementCapabilities)).toBe(true);
  });

  it("fails closed when a server adapter is not ready", () => {
    const unavailable = placementCapabilities.map((item) => item.code === "stories" ? { ...item, adapterReady: false } : item);
    const stories = placementCards(["stories"], unavailable).find((item) => item.code === "stories");
    expect(stories).toEqual(expect.objectContaining({ selectable: false, needsAttention: true, status: "Not available" }));
    expect(isCurrentReleasePlacementSelection(["stories"], unavailable)).toBe(false);
  });
});

describe("PLR-10 responsive targeting layout", () => {
  it("keeps desktop age controls compact and stacks them below 620px for 390px/430px viewports", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/business.css"), "utf8");
    expect(css).toMatch(/\.audience-age-range\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    expect(css).toMatch(/@media \(max-width:\s*620px\)[\s\S]*\.audience-age-range\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });
});
