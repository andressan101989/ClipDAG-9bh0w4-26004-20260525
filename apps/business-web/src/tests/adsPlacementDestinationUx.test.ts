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
  const capabilities = ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"].map((code) => ({
    code: code as "social_feed" | "clips" | "stories" | "live" | "marketplace_home" | "marketplace_search",
    label: code,
    surfaceFamily: "test",
    selectionEnabled: true,
    adapterReady: true,
    productionDeliveryEnabled: false,
  }));

  it("offers every server-confirmed PLR-10 adapter without claiming production delivery", () => {
    const cards = placementCards([], capabilities);
    expect(cards).toHaveLength(6);
    expect(cards.every((item) => item.selectable && item.state === "available_for_setup")).toBe(true);
    expect(cards.every((item) => item.productionDeliveryEnabled === false)).toBe(true);
  });

  it("keeps every historical registered placement valid under the canonical capability projection", () => {
    const saved = ["clips", "live", "marketplace_home", "marketplace_search", "social_feed", "stories"];
    const cards = placementCards(saved, capabilities);
    expect(cards).toHaveLength(6);
    expect(cards.filter((item) => item.selectedPreviously && item.needsAttention)).toHaveLength(0);
    expect(isCurrentReleasePlacementSelection(saved, capabilities)).toBe(true);
    expect(isCurrentReleasePlacementSelection(["social_feed"], capabilities)).toBe(true);
  });

  it("offers only destination types with both a safe picker and consumer", () => {
    expect(destinationSupport.external_url).toMatchObject({ safePicker: true, safeConsumer: true, selectable: true });
    expect(destinationSupport.nelyon_profile).toMatchObject({ safePicker: false, safeConsumer: true, selectable: false });
    expect(destinationSupport.business_account).toMatchObject({ safePicker: true, safeConsumer: false, selectable: false });
    expect(destinationSupport.marketplace_product).toMatchObject({ safePicker: true, safeConsumer: true, selectable: true });
    expect(destinationSupport.marketplace_store).toMatchObject({ safePicker: true, safeConsumer: true, selectable: true });
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
