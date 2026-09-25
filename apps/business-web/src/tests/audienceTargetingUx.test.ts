import { describe, expect, it } from "vitest";
import type { AdvertisingAudienceDefinition, AdvertisingTargetingCapabilities } from "../lib/adsManagerApi";
import {
  audienceCapabilitiesAreSafe,
  createAudienceFormState,
  formatAudienceFrequency,
  formatAudienceSchedule,
  formatFrequencyWindow,
  serializeAudienceForm,
  validateAudienceForm,
} from "../lib/audienceTargetingUx";

const realAudience: AdvertisingAudienceDefinition = {
  age_scope: "adults_only",
  geographies: [],
  languages: [],
  dayparts: [{ timezone: "America/Caracas", weekday: 2, start: "13:00", end: "18:00" }],
  frequency: { max_impressions: 20, window_hours: 24 },
};

describe("Audience targeting UX serialization", () => {
  it("round-trips the real Audience fixture without semantic drift", () => {
    const form = createAudienceFormState(realAudience, "America/New_York");

    expect(form.scheduleMode).toBe("custom");
    expect(form.dayparts).toEqual([
      expect.objectContaining({ timezone: "America/Caracas", weekday: "2", start: "13:00", end: "18:00" }),
    ]);
    expect(form.frequency).toEqual({ enabled: true, maxImpressions: "20", windowHours: "24" });
    expect(serializeAudienceForm(form)).toEqual(realAudience);
    expect(formatAudienceSchedule(realAudience.dayparts)).toEqual([
      { primary: "Tuesday, 1:00 PM–6:00 PM", secondary: "America/Caracas" },
    ]);
    expect(formatAudienceFrequency(realAudience.frequency)).toBe("Up to 20 impressions every 1 day");
  });

  it("represents any-time delivery with an empty canonical daypart array", () => {
    const form = createAudienceFormState({ ...realAudience, dayparts: [] }, "America/New_York");
    expect(form.scheduleMode).toBe("any_time");
    expect(form.dayparts).toEqual([]);
    expect(serializeAudienceForm(form).dayparts).toEqual([]);
    expect(formatAudienceSchedule([])).toEqual([{ primary: "Any time", secondary: null }]);
  });

  it("preserves every canonical schedule window and supports intentional removal", () => {
    const definition: AdvertisingAudienceDefinition = {
      ...realAudience,
      dayparts: [
        { timezone: "America/New_York", weekday: 1, start: "09:00", end: "12:00" },
        { timezone: "America/Caracas", weekday: 3, start: "13:00", end: "17:00" },
        { timezone: "Europe/Madrid", weekday: 5, start: "18:00", end: "21:00" },
      ],
    };
    const form = createAudienceFormState(definition, "Asia/Tokyo");
    expect(serializeAudienceForm(form).dayparts).toEqual([
      definition.dayparts[1], definition.dayparts[0], definition.dayparts[2],
    ]);
    form.dayparts.splice(1, 1);
    expect(serializeAudienceForm(form).dayparts).toEqual([definition.dayparts[0], definition.dayparts[2]]);
  });

  it("sorts canonical schedule windows before fingerprinting and rejects exact duplicates", () => {
    const form = createAudienceFormState({ ...realAudience, dayparts: [
      { timezone: "Europe/Madrid", weekday: 5, start: "18:00", end: "21:00" },
      { timezone: "America/Caracas", weekday: 2, start: "13:00", end: "18:00" },
    ] }, "UTC");
    expect(serializeAudienceForm(form).dayparts.map((item) => item.timezone)).toEqual(["America/Caracas", "Europe/Madrid"]);
    form.dayparts.push({ ...form.dayparts[0], key: "duplicate" });
    expect(validateAudienceForm(form)).toEqual(expect.objectContaining({ valid: false, fieldErrors: expect.objectContaining({ schedule: "Each schedule window must be unique." }) }));
  });

  it("accepts only the complete launch-safe capability invariant", () => {
    const safe: AdvertisingTargetingCapabilities = {
      policyVersion: "nelyon-ads-targeting-v2", advertiserMinimumAge: 18, audienceMinimumAge: 18, ageScope: "adults_only",
      geoTargetingEnabled: false, languageTargetingEnabled: false, daypartTargetingEnabled: true, frequencyTargetingEnabled: true,
      interestTargetingEnabled: false, behavioralTargetingEnabled: false, customAudiencesEnabled: false, lookalikeTargetingEnabled: false,
      sensitiveTargetingAllowed: false, preciseViewerLocationMatchingEnabled: false,
    };
    expect(audienceCapabilitiesAreSafe(safe)).toBe(true);
    expect(audienceCapabilitiesAreSafe({ ...safe, frequencyTargetingEnabled: false })).toBe(false);
    expect(audienceCapabilitiesAreSafe({ ...safe, languageTargetingEnabled: true })).toBe(false);
    expect(audienceCapabilitiesAreSafe({ ...safe, sensitiveTargetingAllowed: true })).toBe(false);
  });

  it.each([
    [24, "1 day"],
    [48, "2 days"],
    [168, "1 week"],
    [36, "36 hours"],
    [1, "1 hour"],
  ])("humanizes %i hours without rounding", (hours, label) => {
    expect(formatFrequencyWindow(hours)).toBe(label);
  });

  it("suggests the browser timezone only for a newly added schedule", () => {
    const form = createAudienceFormState(null, "America/New_York");
    expect(form.scheduleMode).toBe("any_time");
    expect(form.suggestedTimezone).toBe("America/New_York");
    expect(form.dayparts).toEqual([]);
  });

  it.each([
    ["invalid timezone", { timezone: "Mars/Olympus", weekday: "2", start: "09:00", end: "10:00" }],
    ["invalid weekday", { timezone: "UTC", weekday: "8", start: "09:00", end: "10:00" }],
    ["equal times", { timezone: "UTC", weekday: "2", start: "09:00", end: "09:00" }],
    ["reversed times", { timezone: "UTC", weekday: "2", start: "10:00", end: "09:00" }],
    ["missing start", { timezone: "UTC", weekday: "2", start: "", end: "10:00" }],
    ["missing end", { timezone: "UTC", weekday: "2", start: "09:00", end: "" }],
  ])("rejects %s before a backend request", (_label, row) => {
    const form = createAudienceFormState(null, "UTC");
    form.scheduleMode = "custom";
    form.dayparts = [{ key: "test", ...row }];
    expect(validateAudienceForm(form).valid).toBe(false);
  });

  it.each([
    ["0", "24"],
    ["21", "24"],
    ["1", "0"],
    ["1", "169"],
    ["NaN", "24"],
  ])("rejects invalid frequency %s/%s", (maxImpressions, windowHours) => {
    const form = createAudienceFormState(null, "UTC");
    form.frequency = { enabled: true, maxImpressions, windowHours };
    expect(validateAudienceForm(form).valid).toBe(false);
  });

  it.each([
    ["1", "1"],
    ["20", "168"],
  ])("accepts frequency boundary %s/%s", (maxImpressions, windowHours) => {
    const form = createAudienceFormState(null, "UTC");
    form.frequency = { enabled: true, maxImpressions, windowHours };
    expect(validateAudienceForm(form).valid).toBe(true);
  });
});
