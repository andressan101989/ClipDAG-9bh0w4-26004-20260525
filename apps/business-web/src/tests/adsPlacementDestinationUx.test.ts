import { describe, expect, it } from "vitest";
import {
  destinationSupport,
  externalWebsiteSummary,
  isCurrentReleaseDestination,
  isCurrentReleasePlacementSelection,
  placementCards,
  validateExternalWebsite,
} from "../lib/adsPlacementDestinationUx";

describe("Ads placement and destination presentation model", () => {
  it("offers only the wired Social Feed for a new Ads V2 selection", () => {
    const cards = placementCards([]);
    expect(cards.find((item) => item.code === "social_feed")).toMatchObject({ selectable: true, state: "available_for_setup" });
    expect(cards.find((item) => item.code === "clips")).toMatchObject({ selectable: false, state: "not_available_yet" });
    expect(cards.find((item) => item.code === "stories")).toMatchObject({ selectable: false, state: "not_available_yet" });
    expect(cards.find((item) => item.code === "live")).toMatchObject({ selectable: false, state: "not_available_yet" });
    expect(cards.find((item) => item.code === "marketplace_home")).toMatchObject({ selectable: false, state: "legacy_separate" });
    expect(cards.find((item) => item.code === "marketplace_search")).toMatchObject({ selectable: false, state: "legacy_separate" });
  });

  it("keeps every historical placement visible and marks unsupported selections for removal", () => {
    const saved = ["clips", "live", "marketplace_home", "marketplace_search", "social_feed", "stories"];
    const cards = placementCards(saved);
    expect(cards).toHaveLength(6);
    expect(cards.filter((item) => item.selectedPreviously && item.needsAttention)).toHaveLength(5);
    expect(isCurrentReleasePlacementSelection(saved)).toBe(false);
    expect(isCurrentReleasePlacementSelection(["social_feed"])).toBe(true);
  });

  it("fails destination types closed unless both a safe picker and consumer exist", () => {
    expect(destinationSupport.external_url).toMatchObject({ safePicker: true, safeConsumer: true, selectable: true });
    expect(destinationSupport.nelyon_profile).toMatchObject({ safePicker: false, safeConsumer: true, selectable: false });
    expect(destinationSupport.business_account).toMatchObject({ safePicker: true, safeConsumer: false, selectable: false });
    expect(destinationSupport.marketplace_product).toMatchObject({ safePicker: false, safeConsumer: true, selectable: false });
    expect(destinationSupport.marketplace_store).toMatchObject({ safePicker: false, safeConsumer: true, selectable: false });
  });

  it("validates secure website destinations and renders a human hostname", () => {
    expect(validateExternalWebsite("")).toEqual({ ok: false, message: "Enter a secure HTTPS website address." });
    expect(validateExternalWebsite("http://example.com").ok).toBe(false);
    expect(validateExternalWebsite("https://exa mple.com").ok).toBe(false);
    expect(validateExternalWebsite("  https://www.tlaservices.com/  ")).toEqual({ ok: true, value: "https://www.tlaservices.com/" });
    expect(externalWebsiteSummary("https://www.tlaservices.com/")).toBe("www.tlaservices.com");
    expect(isCurrentReleaseDestination({ destinationType: "external_url", externalUrl: "https://www.tlaservices.com/" })).toBe(true);
    expect(isCurrentReleaseDestination({ destinationType: "business_account", externalUrl: null })).toBe(false);
  });
});
