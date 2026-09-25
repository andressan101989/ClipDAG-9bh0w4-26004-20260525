import { describe, expect, it } from "vitest";
import {
  ADS_CTA_OPTIONS,
  creativeFormErrors,
  findAdOperationResult,
  isCreativeMediaSelectable,
  latestCreativeOptions,
  latestCreativeVersion,
  normalizeCreativeDraft,
  sameCreativeContent,
} from "../lib/adsCreativeUx";
import type { BusinessMediaItem } from "../lib/businessMediaApi";

const image: BusinessMediaItem = {
  assetId: "image-1", assetSource: "media_asset", provider: "r2", mediaKind: "image",
  mimeType: "image/webp", status: "ready", purpose: "business_library", visibility: "public",
  sizeBytes: 10, createdAt: "2026-09-25T00:00:00Z", readyAt: "2026-09-25T00:00:01Z",
  previewUrl: "https://media.example/image.webp", playbackUrl: null, thumbnailUrl: null,
  usage: ["library"], usageCount: 0, progress: null, errorCode: null,
};

describe("Ads Creative UX helpers", () => {
  it("allows only ready canonical Business Library media", () => {
    expect(isCreativeMediaSelectable(image)).toBe(true);
    expect(isCreativeMediaSelectable({ ...image, purpose: "product" })).toBe(false);
    expect(isCreativeMediaSelectable({ ...image, status: "processing" })).toBe(false);
    expect(isCreativeMediaSelectable({ ...image, provider: "cloudflare_stream" })).toBe(false);
    expect(isCreativeMediaSelectable({ ...image, mediaKind: "video", assetSource: "video_asset", provider: "cloudflare_stream" })).toBe(true);
  });

  it("uses customer CTA labels without exposing enum codes", () => {
    expect(ADS_CTA_OPTIONS.map((item) => item.label)).toEqual([
      "Learn more", "Shop now", "Sign up", "Contact us", "Send message", "Download", "Visit profile", "No button",
    ]);
  });

  it("normalizes copy and derives image/video identity from selected media", () => {
    expect(normalizeCreativeDraft({ name: "  Launch  ", media: image, primaryText: " Copy ", headline: " ", description: " Details ", callToAction: "learn_more" })).toEqual({
      name: "Launch", format: "image", mediaAssetId: "image-1", videoAssetId: null,
      primaryText: "Copy", headline: null, description: "Details", callToAction: "learn_more",
    });
  });

  it("validates canonical name and copy limits before mutation", () => {
    expect(creativeFormErrors({ name: "A", media: null, primaryText: "", headline: "", description: "", callToAction: "learn_more" })).toMatchObject({ name: expect.any(String), media: expect.any(String) });
    expect(creativeFormErrors({ name: "Valid", media: image, primaryText: "x".repeat(2201), headline: "x".repeat(256), description: "x".repeat(501), callToAction: "learn_more" })).toMatchObject({ primaryText: expect.any(String), headline: expect.any(String), description: expect.any(String) });
    expect(creativeFormErrors({ name: "Valid", media: image, primaryText: "Copy", headline: "Headline", description: "Description", callToAction: "learn_more" })).toEqual({});
    expect(creativeFormErrors({ name: "Valid", media: image, primaryText: "Online = easy", headline: "Only = clear", description: "Description", callToAction: "learn_more" })).toEqual({});
    expect(creativeFormErrors({ name: "Valid", media: image, primaryText: "Safe", headline: "<script>alert(1)</script>", description: "javascript:bad", callToAction: "learn_more" })).toMatchObject({
      headline: "Remove unsupported HTML or script content from the ad text.",
      description: "Remove unsupported HTML or script content from the ad text.",
    });
  });

  it("selects the highest canonical version and detects semantic no-change", () => {
    const versions = [
      { id: "v2", versionNumber: 2, format: "image" as const, mediaAssetId: "image-1", videoAssetId: null, primaryText: "Current", headline: null, description: null, callToAction: "learn_more", contentFingerprint: "b", creationIdempotencyKey: "k2", createdAt: "2026-09-25T00:00:02Z" },
      { id: "v1", versionNumber: 1, format: "image" as const, mediaAssetId: "image-1", videoAssetId: null, primaryText: "Old", headline: null, description: null, callToAction: "learn_more", contentFingerprint: "a", creationIdempotencyKey: "k1", createdAt: "2026-09-25T00:00:01Z" },
    ];
    expect(latestCreativeVersion(versions)?.id).toBe("v2");
    expect(sameCreativeContent(versions[0], normalizeCreativeDraft({ name: "Creative", media: image, primaryText: " Current ", headline: "", description: "", callToAction: "learn_more" }))).toBe(true);
    expect(sameCreativeContent(versions[0], normalizeCreativeDraft({ name: "Creative", media: image, primaryText: "Changed", headline: "", description: "", callToAction: "learn_more" }))).toBe(false);
  });

  it("offers only latest Creative Versions whose canonical media remains selectable", () => {
    const version = { id: "v1", versionNumber: 1, format: "image" as const, mediaAssetId: image.assetId, videoAssetId: null, primaryText: "Copy", headline: null, description: null, callToAction: "learn_more", contentFingerprint: "a", creationIdempotencyKey: "k1", createdAt: "2026-09-25T00:00:01Z" };
    const creatives = [{ id: "c1", adAccountId: "a1", name: "Creative", status: "draft", versions: [version] }];
    expect(latestCreativeOptions(creatives, { [image.assetId]: image })).toHaveLength(1);
    expect(latestCreativeOptions(creatives, { [image.assetId]: { ...image, status: "processing" } })).toEqual([]);
    expect(latestCreativeOptions(creatives, {})).toEqual([]);
  });

  it("reconciles Ad creation only to the exact B1 operation key, even when an older identical Ad exists", () => {
    const payload = { adSetId: "set-1", creativeVersionId: "v1", destinationId: "d1", name: "Launch Ad" };
    const older = { id: "old", campaignId: "campaign-1", ...payload, creationIdempotencyKey: "old-key", status: "draft", reviewStatus: "not_submitted", submittedAt: null, reviewedAt: null, latestRejectionReasonCode: null, latestRejectionMessage: null };
    const applied = { ...older, id: "new", creationIdempotencyKey: "requested-key" };
    expect(findAdOperationResult([older], "requested-key", payload)).toBeNull();
    expect(findAdOperationResult([older, applied], "requested-key", payload)?.id).toBe("new");
  });
});
