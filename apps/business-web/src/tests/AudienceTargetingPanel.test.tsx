import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudienceTargetingPanel } from "../components/ads/AudienceTargetingPanel";
import type { AdvertisingAudienceDefinition, AdvertisingTargetingCapabilities } from "../lib/adsManagerApi";

const capabilities: AdvertisingTargetingCapabilities = {
  policyVersion: "nelyon-ads-targeting-v2",
  advertiserMinimumAge: 18,
  audienceMinimumAge: 18,
  ageScope: "adults_only",
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

const definition: AdvertisingAudienceDefinition = {
  age_scope: "adults_only",
  geographies: [],
  languages: [],
  dayparts: [{ timezone: "America/Caracas", weekday: 2, start: "13:00", end: "18:00" }],
  frequency: { max_impressions: 20, window_hours: 24 },
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof AudienceTargetingPanel>> = {}) {
  const props: React.ComponentProps<typeof AudienceTargetingPanel> = {
    audienceIdentity: "audience-1",
    definition,
    exists: true,
    stale: false,
    capabilities,
    capabilitiesUnavailable: false,
    owner: true,
    pending: false,
    onSave: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { ...render(<AudienceTargetingPanel {...props} />), props };
}

describe("AudienceTargetingPanel", () => {
  it("renders a customer summary without JSON, UUIDs, policy names, or internal fields", () => {
    const { container } = renderPanel();

    expect(screen.getByText("Adults 18+")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, 1:00 PM–6:00 PM")).toBeInTheDocument();
    expect(screen.getByText("America/Caracas")).toBeInTheDocument();
    expect(screen.getByText("Up to 20 impressions every 1 day")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/adults_only|targeting_policy_version|max_impressions|window_hours|definition_fingerprint|creation_idempotency_key|nelyon-ads-targeting|advertising_audience_/);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("uses selection-first schedule controls and preserves the existing timezone", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));

    expect(screen.getByRole("radio", { name: "Any time" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom schedule" })).toBeChecked();
    expect(screen.getByLabelText("Day")).toHaveValue("2");
    expect(screen.getByLabelText("Start time")).toHaveValue("13:00");
    expect(screen.getByLabelText("End time")).toHaveValue("18:00");
    expect(screen.getByLabelText(/^Time zone/)).toHaveValue("America/Caracas");
    expect(screen.getByLabelText("Maximum impressions")).toHaveValue("20");
    expect(screen.getByLabelText("Time window")).toHaveValue("24");
    expect(screen.getByRole("option", { name: "1 day" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1 week" })).toBeInTheDocument();
  });

  it("adds and removes multiple schedule windows without losing retained rows", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderPanel({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    fireEvent.click(screen.getByRole("button", { name: "Add schedule window" }));
    expect(screen.getAllByRole("group", { name: /Schedule window/ })).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("End time")[1], { target: { value: "18:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dayparts: [definition.dayparts[0], expect.objectContaining({ end: "18:30" })] })));
  });

  it("preserves custom windows when the user temporarily selects Any time", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    fireEvent.click(screen.getByRole("radio", { name: "Any time" }));
    fireEvent.click(screen.getByRole("radio", { name: "Custom schedule" }));
    expect(screen.getByLabelText(/^Time zone/)).toHaveValue("America/Caracas");
    expect(screen.getByLabelText("Start time")).toHaveValue("13:00");
  });

  it("preserves a dirty editor across an equivalent canonical workspace refresh", () => {
    const { rerender, props } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    fireEvent.change(screen.getByLabelText("Maximum impressions"), { target: { value: "3" } });

    rerender(<AudienceTargetingPanel {...props} definition={{ ...definition, dayparts: definition.dayparts.map((item) => ({ ...item })), frequency: { ...definition.frequency! } }} />);

    expect(screen.getByLabelText("Maximum impressions")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("fails closed for a present but unsafe capabilities response", () => {
    renderPanel({ capabilities: { ...capabilities, daypartTargetingEnabled: false, geoTargetingEnabled: true } });
    expect(screen.getByText("Targeting settings are temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit audience" })).toBeDisabled();
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
  });

  it("disables no-change saves and does not create redundant versions", () => {
    const onSave = vi.fn();
    renderPanel({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("No changes to save.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows disabled capability cards and never renders targeting inputs for them", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    for (const label of ["Location", "Language", "Interests", "Behavioral targeting", "Custom audiences", "Lookalike audiences"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Not available yet")).toHaveLength(6);
    expect(screen.queryByLabelText(/country|language tag|interest/i)).not.toBeInTheDocument();
    expect(screen.getByText("Nelyon does not use sensitive targeting or precise viewer location for this audience.")).toBeInTheDocument();
  });

  it("fails closed when capabilities are unavailable while retaining the readable summary", () => {
    renderPanel({ capabilities: null, capabilitiesUnavailable: true });
    expect(screen.getByText("Tuesday, 1:00 PM–6:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Targeting settings are temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit audience" })).toBeDisabled();
  });

  it("presents a stale audience in human language and opens review without policy internals", () => {
    const { container } = renderPanel({ stale: true });
    expect(screen.getByText("Your audience settings need to be reviewed before this campaign can continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review audience" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("nelyon-ads-targeting-v1");
  });

  it("blocks invalid schedule submission with field-associated messages", () => {
    const onSave = vi.fn();
    renderPanel({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Choose an end time later than the start time.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps frequency optional and humanizes exact values", () => {
    renderPanel({ definition: { ...definition, frequency: null } });
    expect(screen.getByText("No frequency limit configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit audience" }));
    expect(screen.getByRole("checkbox", { name: "Limit frequency" })).not.toBeChecked();
  });
});
