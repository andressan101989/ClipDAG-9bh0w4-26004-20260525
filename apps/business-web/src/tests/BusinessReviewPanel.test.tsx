import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessReviewPanel } from "../components/ads/BusinessReviewPanel";
import type { AdvertisingAd, AdvertisingCreativeVersion, AdvertisingDestination } from "../lib/adsManagerApi";

vi.mock("../components/BusinessMedia", () => ({
  BusinessMediaPicker: () => null,
  BusinessMediaPreview: () => <div>Media preview</div>,
}));

const version: AdvertisingCreativeVersion = {
  id: "version-private-id",
  versionNumber: 1,
  format: "image",
  mediaAssetId: null,
  videoAssetId: null,
  primaryText: "Exact submitted copy",
  headline: "Exact submitted headline",
  description: "Exact submitted description",
  callToAction: "learn_more",
  contentFingerprint: "private-content-fingerprint",
  creationIdempotencyKey: "private-version-key",
  createdAt: "2026-09-25T00:00:00Z",
};
const destination: AdvertisingDestination = {
  id: "destination-private-id",
  destinationType: "external_url",
  externalUrl: "https://advertiser.example/landing",
  targetUserId: null,
  targetBusinessAccountId: null,
  targetProductId: null,
  targetStoreId: null,
  status: "draft",
  createdAt: "2026-09-25T00:00:00Z",
  updatedAt: "2026-09-25T00:00:00Z",
};

function ad(reviewStatus: AdvertisingAd["reviewStatus"], overrides: Partial<AdvertisingAd> = {}): AdvertisingAd {
  return {
    id: "ad-private-id",
    name: "Primary Ad",
    campaignId: "campaign-private-id",
    adSetId: "set-private-id",
    creativeVersionId: version.id,
    destinationId: destination.id,
    creationIdempotencyKey: "private-ad-key",
    status: "draft",
    reviewStatus,
    submittedAt: reviewStatus === "not_submitted" ? null : "2026-09-25T10:00:00Z",
    reviewedAt: ["approved", "rejected"].includes(reviewStatus) ? "2026-09-25T11:00:00Z" : null,
    latestRejectionReasonCode: null,
    latestRejectionMessage: null,
    ...overrides,
  };
}

describe("BusinessReviewPanel", () => {
  it("confirms and one-flights submission of the exact immutable ad", async () => {
    let resolve!: (value: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<BusinessReviewPanel ad={ad("not_submitted")} creativeName="Primary Creative" version={version} media={null} destination={destination} owner pending={false} onSubmit={onSubmit} onCreateRevised={vi.fn()} />);

    expect(screen.getAllByText("Ready for review")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(screen.getByRole("dialog", { name: "Submit this ad for review?" })).toBeInTheDocument();
    expect(screen.getByText(/later creative versions do not change this submitted ad/i)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm submission" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveAttribute("aria-busy", "true");
    resolve(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["pending", "In review"],
    ["approved", "Approved"],
  ])("renders %s as %s without another submit action", (status, label) => {
    render(<BusinessReviewPanel ad={ad(status)} creativeName="Primary Creative" version={version} media={null} destination={destination} owner pending={false} onSubmit={vi.fn()} onCreateRevised={vi.fn()} />);
    expect(screen.getAllByText(label)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  });

  it("keeps the internal note private and routes rejection recovery to a revised ad", () => {
    const onCreateRevised = vi.fn();
    render(<BusinessReviewPanel ad={ad("rejected", { latestRejectionReasonCode: "copy_invalid", latestRejectionMessage: "The ad copy could not be approved." })} creativeName="Primary Creative" version={version} media={null} destination={destination} owner pending={false} onSubmit={vi.fn()} onCreateRevised={onCreateRevised} />);

    expect(screen.getAllByText("Needs changes")).toHaveLength(2);
    expect(screen.getByText("The ad copy could not be approved.")).toBeInTheDocument();
    expect(screen.queryByText("Internal moderation detail XYZ")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resubmit/i })).not.toBeInTheDocument();
    const revised = screen.getByRole("button", { name: "Create revised ad" });
    fireEvent.click(revised);
    expect(onCreateRevised).toHaveBeenCalledTimes(1);
  });

  it("never renders submission fingerprints, UUID labels, raw enums, or review JSON", () => {
    const { container } = render(<BusinessReviewPanel ad={ad("pending")} creativeName="Primary Creative" version={version} media={null} destination={destination} owner pending={false} onSubmit={vi.fn()} onCreateRevised={vi.fn()} />);
    expect(container).not.toHaveTextContent("submission_fingerprint");
    expect(container).not.toHaveTextContent("creative_version_id");
    expect(container).not.toHaveTextContent("ad-private-id");
    expect(container.querySelector("pre")).toBeNull();
  });
});
