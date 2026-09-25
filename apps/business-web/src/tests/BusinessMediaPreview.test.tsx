import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessMediaPreview } from "../components/BusinessMedia";
import type { BusinessMediaItem } from "../lib/businessMediaApi";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const base: BusinessMediaItem = {
  assetId: "asset-id",
  assetSource: "media_asset",
  provider: "r2",
  mediaKind: "image",
  mimeType: "image/jpeg",
  status: "ready",
  purpose: "business_library",
  visibility: "public",
  sizeBytes: 10,
  createdAt: "2026-09-16T00:00:00Z",
  readyAt: "2026-09-16T00:00:01Z",
  previewUrl: "https://media.example/image.jpg",
  playbackUrl: null,
  thumbnailUrl: null,
  usage: ["library"],
  usageCount: 1,
  progress: null,
  errorCode: null,
};

describe("Business Media previews", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders a ready R2 image as an image", () => {
    render(<BusinessMediaPreview item={base} />);
    expect(screen.getByRole("img", { name: "Asset de la biblioteca" })).toHaveAttribute("src", base.previewUrl);
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
  });

  it("connects a ready Stream HLS URL and preserves its poster", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const item: BusinessMediaItem = { ...base, assetSource: "video_asset", provider: "cloudflare_stream", mediaKind: "video", mimeType: "video/mp4", previewUrl: "https://media.example/poster.jpg", playbackUrl: "https://videodelivery.net/id/manifest/video.m3u8", thumbnailUrl: "https://media.example/poster.jpg" };
    render(<BusinessMediaPreview item={item} />);
    const video = screen.getByLabelText("Vista previa de video");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster", item.thumbnailUrl);
    expect(video).toHaveAttribute("src", item.playbackUrl);
  });

  it("renders explicit processing and failed states instead of an empty player", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T00:04:00Z"));
    const view = render(<BusinessMediaPreview item={{ ...base, status: "processing", readyAt: null, previewUrl: null }} />);
    expect(screen.getByText("Procesando")).toBeInTheDocument();
    view.rerender(<BusinessMediaPreview item={{ ...base, status: "failed", previewUrl: null }} />);
    expect(screen.getByText("No disponible")).toBeInTheDocument();
  });

  it("labels an upload older than the reservation window as expired and keeps it unavailable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T00:05:01Z"));
    render(<BusinessMediaPreview item={{ ...base, status: "uploading", readyAt: null, previewUrl: null }} locale="en" />);
    expect(screen.getByRole("status")).toHaveTextContent("Upload expired");
  });
});
