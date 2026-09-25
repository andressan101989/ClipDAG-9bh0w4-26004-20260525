import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdAssemblyPanel, CreativePanel } from "../components/ads/CreativeAdPanels";
import type { AdvertisingCreative, AdvertisingDestination } from "../lib/adsManagerApi";
import type { BusinessMediaItem } from "../lib/businessMediaApi";

const media: BusinessMediaItem = {
  assetId: "media-secret-id", assetSource: "media_asset", provider: "r2", mediaKind: "image",
  mimeType: "image/webp", status: "ready", purpose: "business_library", visibility: "public",
  sizeBytes: 10, createdAt: "2026-09-25T00:00:00Z", readyAt: "2026-09-25T00:00:01Z",
  previewUrl: "https://media.example/image.webp", playbackUrl: null, thumbnailUrl: null,
  usage: ["library"], usageCount: 0, progress: null, errorCode: null,
};

vi.mock("../components/BusinessMedia", () => ({
  BusinessMediaPreview: ({ item }: { item: BusinessMediaItem }) => <div aria-label="Media preview">{item.mediaKind}</div>,
  BusinessMediaPicker: ({ open, onSelect, onClose }: { open: boolean; onSelect: (item: BusinessMediaItem) => void; onClose: () => void }) => open ? <div role="dialog" aria-label="Business Media"><button type="button" onClick={() => onSelect(media)}>Choose ready image</button><button type="button" onClick={onClose}>Close</button></div> : null,
}));

const creative: AdvertisingCreative = {
  id: "creative-secret-id", adAccountId: "account-1", name: "Launch creative", status: "draft",
  versions: [
    { id: "version-secret-v1", versionNumber: 1, format: "image", mediaAssetId: media.assetId, videoAssetId: null, primaryText: "Old copy", headline: "Old headline", description: null, callToAction: "learn_more", contentFingerprint: "a", creationIdempotencyKey: "key-v1", createdAt: "2026-09-25T00:00:01Z" },
    { id: "version-secret-v2", versionNumber: 2, format: "image", mediaAssetId: media.assetId, videoAssetId: null, primaryText: "Current copy", headline: "Current headline", description: "Details", callToAction: "shop_now", contentFingerprint: "b", creationIdempotencyKey: "key-v2", createdAt: "2026-09-25T00:00:02Z" },
  ],
};

const destination: AdvertisingDestination = {
  id: "destination-secret-id", destinationType: "external_url", externalUrl: "https://www.tlaservices.com/",
  targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null,
  status: "draft", createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z",
};

describe("CreativePanel", () => {
  it("creates from visual Business Media, derives format, and never exposes raw IDs", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const { container } = render(<CreativePanel creatives={[]} mediaById={{}} owner businessOwnerId="owner-1" pending={false} onCreate={onCreate} onCreateVersion={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Creative name/ }), { target: { value: "Launch creative" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose from Media Library" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose ready image" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Primary text/ }), { target: { value: "Fresh copy" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Call to action/ }), { target: { value: "shop_now" } });
    expect(screen.getByRole("option", { name: "Shop now" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save creative" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ format: "image", mediaAssetId: media.assetId, videoAssetId: null, callToAction: "shop_now" })));
    expect(container.textContent).not.toMatch(/media-secret-id|creative-secret-id|media_asset_id|content_fingerprint|shop_now/);
  });

  it("edits by immutable version, blocks no-change save, and one-flights a delayed save", async () => {
    let resolve!: (value: boolean) => void;
    const onCreateVersion = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<CreativePanel creatives={[creative]} mediaById={{ [media.assetId]: media }} owner businessOwnerId="owner-1" pending={false} onCreate={vi.fn()} onCreateVersion={onCreateVersion} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit creative" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Primary text/ }), { target: { value: "Changed copy" } });
    const save = screen.getByRole("button", { name: "Save changes" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onCreateVersion).toHaveBeenCalledTimes(1);
    expect(onCreateVersion).toHaveBeenCalledWith("creative-secret-id", expect.objectContaining({ primaryText: "Changed copy" }));
    resolve(true);
    await waitFor(() => expect(screen.getByText("Creative updated.")).toBeInTheDocument());
  });

  it("preserves draft copy when canonical media metadata arrives during editing", async () => {
    const props = { creatives: [creative], owner: true, businessOwnerId: "owner-1", pending: false, onCreate: vi.fn(), onCreateVersion: vi.fn().mockResolvedValue(true) };
    const { rerender } = render(<CreativePanel {...props} mediaById={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit creative" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Primary text/ }), { target: { value: "Unsaved customer copy" } });
    rerender(<CreativePanel {...props} mediaById={{ [media.assetId]: media }} />);
    expect(screen.getByRole("textbox", { name: /Primary text/ })).toHaveValue("Unsaved customer copy");
    expect(screen.getByText("Image selected")).toBeInTheDocument();
  });

  it("does not dispatch a Creative mutation for a non-owner even if the form is submitted directly", () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const { container } = render(<CreativePanel creatives={[]} mediaById={{}} owner={false} pending={false} onCreate={onCreate} onCreateVersion={vi.fn()} />);
    fireEvent.submit(container.querySelector("form")!);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does not allow Creative selection to discard a draft while the composer is open", () => {
    const second = { ...creative, id: "creative-2", name: "Second creative", versions: creative.versions.map((version) => ({ ...version, id: `${version.id}-second`, creationIdempotencyKey: `${version.creationIdempotencyKey}-second` })) };
    render(<CreativePanel creatives={[creative, second]} mediaById={{ [media.assetId]: media }} owner pending={false} onCreate={vi.fn()} onCreateVersion={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Launch creative/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit creative" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Primary text/ }), { target: { value: "Unsaved customer copy" } });
    expect(screen.getByRole("radio", { name: /Second creative/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Primary text/ })).toHaveValue("Unsaved customer copy");
  });
});

describe("AdAssemblyPanel", () => {
  it("assembles from latest Creative and human Destination without first-row IDs", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const { container } = render(<AdAssemblyPanel adSetId="set-1" creatives={[creative]} ads={[]} selectedAdId={null} destinations={[destination]} selectedDestinationId={destination.id} mediaById={{ [media.assetId]: media }} owner pending={false} onSelectAd={vi.fn()} onSelectDestination={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Ad name/ }), { target: { value: "Launch ad" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ad" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ creativeVersionId: "version-secret-v2", destinationId: destination.id, name: "Launch ad" })));
    expect(screen.getAllByText("www.tlaservices.com")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/version-secret|destination-secret|creative_version_id|destination_id/);
  });

  it("renders an existing Ad against its exact pinned historical Creative Version", () => {
    render(<AdAssemblyPanel adSetId="set-1" creatives={[creative]} ads={[{ id: "ad-1", name: "Pinned ad", campaignId: "campaign-1", adSetId: "set-1", creativeVersionId: "version-secret-v1", destinationId: destination.id, creationIdempotencyKey: "ad-key", status: "draft", reviewStatus: "not_submitted", submittedAt: null, reviewedAt: null, latestRejectionReasonCode: null, latestRejectionMessage: null }]} selectedAdId="ad-1" destinations={[destination]} selectedDestinationId={destination.id} mediaById={{ [media.assetId]: media }} owner pending={false} onSelectAd={vi.fn()} onSelectDestination={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText("Old headline")).toBeInTheDocument();
    expect(screen.queryByText("Current headline")).not.toBeInTheDocument();
    expect(screen.getByText(/Existing ads keep the creative version/)).toBeInTheDocument();
  });

  it("does not offer a Creative Version whose media is no longer ready", () => {
    render(<AdAssemblyPanel adSetId="set-1" creatives={[creative]} ads={[]} selectedAdId={null} destinations={[destination]} selectedDestinationId={destination.id} mediaById={{ [media.assetId]: { ...media, status: "processing" } }} owner pending={false} onSelectAd={vi.fn()} onSelectDestination={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText("Create a Creative first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create ad" })).toBeDisabled();
  });
});
