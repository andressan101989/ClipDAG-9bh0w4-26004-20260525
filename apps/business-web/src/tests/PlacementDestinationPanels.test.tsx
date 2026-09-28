import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DestinationPanel } from "../components/ads/DestinationPanel";
import { PlacementSelectionPanel } from "../components/ads/PlacementSelectionPanel";
import type { AdvertisingPlacementCapability } from "../lib/adsManagerApi";

const six = ["clips", "live", "marketplace_home", "marketplace_search", "social_feed", "stories"];
const labels: Record<string, string> = {
  clips: "Clips",
  live: "Live",
  marketplace_home: "Marketplace Home",
  marketplace_search: "Marketplace Search",
  social_feed: "Social Feed",
  stories: "Stories",
};
const plr10Capabilities: AdvertisingPlacementCapability[] = six.map((code) => ({
  code: code as AdvertisingPlacementCapability["code"],
  label: labels[code],
  surfaceFamily: code.startsWith("marketplace") ? "marketplace" : code === "live" ? "live" : "social",
  selectionEnabled: true,
  adapterReady: true,
  productionDeliveryEnabled: false,
}));
const historicalSocialOnlyCapabilities = plr10Capabilities.map((capability) => ({
  ...capability,
  selectionEnabled: capability.code === "social_feed",
  adapterReady: capability.code === "social_feed",
}));

describe("PlacementSelectionPanel", () => {
  it("shows the historical six-placement selection as attention without writing", () => {
    const save = vi.fn();
    render(<PlacementSelectionPanel savedCodes={six} hasSelection owner pending={false} supportAvailable capabilities={historicalSocialOnlyCapabilities} onSave={save} />);
    expect(screen.getByText("Selected previously — not available for this Ads V2 release")).toBeInTheDocument();
    expect(screen.getAllByText(/Needs attention|Separate Marketplace promotion/).length).toBe(5);
    expect(screen.getByText("Delivery availability is controlled by current server policy.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("repairs a historical selection to social_feed and cannot re-add unsupported placements", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<PlacementSelectionPanel savedCodes={six} hasSelection owner pending={false} supportAvailable capabilities={historicalSocialOnlyCapabilities} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Review placements" }));
    for (const label of ["Clips", "Live", "Marketplace Home", "Marketplace Search", "Stories"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^${label}`) }));
      expect(screen.getByRole("checkbox", { name: new RegExp(`^${label}`) })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Create updated placement version" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(["social_feed"]));
  });

  it("requires one available placement and fails closed when support is unavailable", () => {
    const save = vi.fn();
    const { rerender } = render(<PlacementSelectionPanel savedCodes={[]} hasSelection={false} owner pending={false} supportAvailable capabilities={plr10Capabilities} onSave={save} />);
    expect(screen.getByRole("button", { name: "Save placements" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Social Feed/ }));
    expect(screen.getByRole("button", { name: "Save placements" })).toBeEnabled();
    rerender(<PlacementSelectionPanel savedCodes={["social_feed"]} hasSelection owner pending={false} supportAvailable={false} capabilities={plr10Capabilities} onSave={save} />);
    expect(screen.getByText("Placement settings are temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit placements" })).toBeDisabled();
  });

  it("denies a direct placement form submit for a non-owner", () => {
    const save = vi.fn();
    render(<PlacementSelectionPanel savedCodes={[]} hasSelection={false} owner={false} pending={false} supportAvailable capabilities={plr10Capabilities} onSave={save} />);
    const checkbox = screen.getByRole("checkbox", { name: /^Social Feed/ });
    expect(checkbox).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Save placements" }).closest("form")!);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("DestinationPanel", () => {
  const product = { id: "product-1", title: "Canonical product", status: "active", price: 10, currency: "BDAG", variantCount: 1, readinessReason: null, updatedAt: "2026-09-27T00:00:00Z", thumbnailUrl: null, availableStock: 2 };
  const store = { id: "store-1", sellerId: "owner-1", name: "Canonical store", slug: "canonical-store", description: null, logoAssetId: null, bannerAssetId: null, status: "active" as const, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" };

  it("renders the real external destination without technical identifiers", () => {
    render(<DestinationPanel destination={{ id: "uuid-hidden", destinationType: "external_url", externalUrl: "https://www.tlaservices.com/", targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null, status: "draft", createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" }} referencedByAd={false} owner pending={false} onSave={vi.fn()} />);
    expect(screen.getByText("External website")).toBeInTheDocument();
    expect(screen.getByText("www.tlaservices.com")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("uuid-hidden");
    expect(document.body.textContent).not.toContain("external_url");
    expect(document.body.textContent).not.toContain("Canonical target ID");
  });

  it("offers only External website and validates HTTPS before save", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DestinationPanel destination={null} referencedByAd={false} owner pending={false} onSave={save} />);
    expect(screen.getByRole("radio", { name: /External website/ })).toBeEnabled();
    for (const label of ["Nelyon profile", "Business", "Marketplace product", "Marketplace store"]) expect(screen.getByRole("radio", { name: new RegExp(label) })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Website URL"), { target: { value: "http://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create destination" }));
    expect(await screen.findByText("Enter a secure HTTPS website address.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Website URL"), { target: { value: "https://example.com/" } });
    fireEvent.click(screen.getByRole("button", { name: "Create destination" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: "external_url", externalUrl: "https://example.com/", targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null })));
  });

  it("offers canonical product and store targets for marketplace_sales and excludes external URL", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DestinationPanel destination={null} referencedByAd={false} owner pending={false} objective="marketplace_sales" products={[product]} store={store} onSave={save} />);
    expect(screen.getByRole("radio", { name: /External website/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Marketplace product/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Marketplace store/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Marketplace product"), { target: { value: product.id } });
    fireEvent.click(screen.getByRole("button", { name: "Create destination" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      type: "marketplace_product", externalUrl: null, targetUserId: null,
      targetBusinessAccountId: null, targetProductId: product.id, targetStoreId: null,
    }));
  });

  it("disables editing when the destination is referenced by an Ad", () => {
    render(<DestinationPanel destination={{ id: "destination-1", destinationType: "external_url", externalUrl: "https://example.com/", targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null, status: "draft", createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" }} referencedByAd owner pending={false} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Edit destination" })).toBeDisabled();
    expect(screen.getByText("This destination is already attached to an ad and can't be changed here.")).toBeInTheDocument();
  });

  it("lets an unreferenced unsupported draft be repaired to an External website", () => {
    render(<DestinationPanel destination={{ id: "destination-2", destinationType: "business_account", externalUrl: null, targetUserId: null, targetBusinessAccountId: "business-hidden", targetProductId: null, targetStoreId: null, status: "draft", createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" }} referencedByAd={false} owner pending={false} onSave={vi.fn()} />);
    expect(screen.getByText("This saved destination is not available for this Ads V2 release. Replace it with an External website to continue.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("business-hidden");
    fireEvent.click(screen.getByRole("button", { name: "Edit destination" }));
    expect(screen.getByRole("radio", { name: /External website/ })).toBeChecked();
    expect(screen.getByLabelText("Website URL")).toHaveValue("");
  });

  it("denies direct destination form submits when unchanged or unauthorized", () => {
    const save = vi.fn();
    const destination = { id: "destination-3", destinationType: "external_url", externalUrl: "https://example.com/", targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null, status: "draft", createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" };
    const { rerender } = render(<DestinationPanel destination={destination} referencedByAd={false} owner pending={false} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit destination" }));
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
    expect(save).not.toHaveBeenCalled();
    rerender(<DestinationPanel destination={null} referencedByAd={false} owner={false} pending={false} onSave={save} />);
    fireEvent.change(screen.getByLabelText("Website URL"), { target: { value: "https://new.example/" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create destination" }).closest("form")!);
    expect(save).not.toHaveBeenCalled();
  });
});
