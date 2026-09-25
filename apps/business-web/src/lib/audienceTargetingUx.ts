import type { AdvertisingAudienceDefinition, AdvertisingTargetingCapabilities } from "./adsManagerApi";

export const AUDIENCE_WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
] as const;

export type AudienceDaypartFormRow = {
  key: string;
  timezone: string;
  weekday: string;
  start: string;
  end: string;
};

export type AudienceFormState = {
  scheduleMode: "any_time" | "custom";
  dayparts: AudienceDaypartFormRow[];
  frequency: { enabled: boolean; maxImpressions: string; windowHours: string };
  suggestedTimezone: string;
};

export type AudienceFormValidation = {
  valid: boolean;
  fieldErrors: Record<string, string>;
};

function validTimeZone(value: string) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validClock(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function supportedTimeZones(preferred?: string) {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const supported = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  return [...new Set([preferred, "UTC", ...supported].filter((value): value is string => Boolean(value)))].sort();
}

export function audienceCapabilitiesAreSafe(capabilities: AdvertisingTargetingCapabilities | null) {
  return Boolean(capabilities
    && capabilities.policyVersion
    && capabilities.advertiserMinimumAge === 18
    && capabilities.audienceMinimumAge === 18
    && capabilities.ageScope === "adults_only"
    && capabilities.daypartTargetingEnabled
    && capabilities.frequencyTargetingEnabled
    && !capabilities.geoTargetingEnabled
    && !capabilities.languageTargetingEnabled
    && !capabilities.interestTargetingEnabled
    && !capabilities.behavioralTargetingEnabled
    && !capabilities.customAudiencesEnabled
    && !capabilities.lookalikeTargetingEnabled
    && !capabilities.sensitiveTargetingAllowed
    && !capabilities.preciseViewerLocationMatchingEnabled);
}

export function newAudienceDaypart(timezone: string, key = `schedule-${crypto.randomUUID()}`): AudienceDaypartFormRow {
  return { key, timezone, weekday: "1", start: "09:00", end: "17:00" };
}

export function createAudienceFormState(definition: AdvertisingAudienceDefinition | null, suggestedTimezone: string): AudienceFormState {
  return {
    scheduleMode: definition?.dayparts.length ? "custom" : "any_time",
    dayparts: definition?.dayparts.map((item, index) => ({
      key: `saved-${index}-${item.weekday}-${item.start}-${item.end}-${item.timezone}`,
      timezone: item.timezone,
      weekday: String(item.weekday),
      start: item.start,
      end: item.end,
    })) ?? [],
    frequency: definition?.frequency
      ? { enabled: true, maxImpressions: String(definition.frequency.max_impressions), windowHours: String(definition.frequency.window_hours) }
      : { enabled: false, maxImpressions: "1", windowHours: "24" },
    suggestedTimezone,
  };
}

export function serializeAudienceForm(form: AudienceFormState): AdvertisingAudienceDefinition {
  const dayparts = form.scheduleMode === "custom" ? form.dayparts.map((item) => ({
    timezone: item.timezone,
    weekday: Number(item.weekday),
    start: item.start,
    end: item.end,
  })).sort((left, right) => left.timezone.localeCompare(right.timezone)
    || left.weekday - right.weekday
    || left.start.localeCompare(right.start)
    || left.end.localeCompare(right.end)) : [];
  return {
    age_scope: "adults_only",
    geographies: [],
    languages: [],
    dayparts,
    frequency: form.frequency.enabled ? {
      max_impressions: Number(form.frequency.maxImpressions),
      window_hours: Number(form.frequency.windowHours),
    } : null,
  };
}

export function validateAudienceForm(form: AudienceFormState): AudienceFormValidation {
  const fieldErrors: Record<string, string> = {};
  if (form.scheduleMode === "custom") {
    if (form.dayparts.length === 0) fieldErrors.schedule = "Add at least one schedule window.";
    if (form.dayparts.length > 100) fieldErrors.schedule = "Use no more than 100 schedule windows.";
    form.dayparts.forEach((item, index) => {
      const prefix = `daypart.${item.key}`;
      if (!validTimeZone(item.timezone)) {
        fieldErrors[`${prefix}.timezone`] = "Choose a valid time zone.";
      }
      const weekday = Number(item.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) fieldErrors[`${prefix}.weekday`] = "Choose a day.";
      if (!validClock(item.start)) fieldErrors[`${prefix}.start`] = "Choose a start time.";
      if (!validClock(item.end)) fieldErrors[`${prefix}.end`] = "Choose an end time.";
      if (validClock(item.start) && validClock(item.end) && item.start >= item.end) {
        fieldErrors[`${prefix}.end`] = "Choose an end time later than the start time.";
      }
      if (index >= 100) fieldErrors.schedule = "Use no more than 100 schedule windows.";
    });
    const uniqueWindows = new Set(form.dayparts.map((item) => [item.timezone, item.weekday, item.start, item.end].join("\u0000")));
    if (uniqueWindows.size !== form.dayparts.length) fieldErrors.schedule = "Each schedule window must be unique.";
  }
  if (form.frequency.enabled) {
    const maxImpressions = Number(form.frequency.maxImpressions);
    const windowHours = Number(form.frequency.windowHours);
    if (!Number.isInteger(maxImpressions) || maxImpressions < 1 || maxImpressions > 20) {
      fieldErrors.maxImpressions = "Choose between 1 and 20 impressions.";
    }
    if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) {
      fieldErrors.windowHours = "Choose a time window between 1 and 168 hours.";
    }
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

function formatClock(value: string) {
  const [hourString, minute] = value.split(":");
  const hour = Number(hourString);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

export function formatAudienceSchedule(dayparts: AdvertisingAudienceDefinition["dayparts"]) {
  if (dayparts.length === 0) return [{ primary: "Any time", secondary: null }];
  return dayparts.map((item) => ({
    primary: `${AUDIENCE_WEEKDAYS[item.weekday - 1]?.label ?? "Unknown day"}, ${formatClock(item.start)}–${formatClock(item.end)}`,
    secondary: item.timezone,
  }));
}

export function formatFrequencyWindow(hours: number) {
  if (hours === 168) return "1 week";
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function formatAudienceFrequency(frequency: AdvertisingAudienceDefinition["frequency"]) {
  if (!frequency) return "No frequency limit configured";
  return `Up to ${frequency.max_impressions} ${frequency.max_impressions === 1 ? "impression" : "impressions"} every ${formatFrequencyWindow(frequency.window_hours)}`;
}
