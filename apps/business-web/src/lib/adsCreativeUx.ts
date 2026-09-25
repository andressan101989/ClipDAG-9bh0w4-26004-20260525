import type { AdvertisingAd, AdvertisingCreative, AdvertisingCreativeVersion } from "./adsManagerApi";
import type { BusinessMediaItem } from "./businessMediaApi";

export const ADS_CTA_OPTIONS = [
  { value: "learn_more", label: "Learn more" },
  { value: "shop_now", label: "Shop now" },
  { value: "sign_up", label: "Sign up" },
  { value: "contact_us", label: "Contact us" },
  { value: "send_message", label: "Send message" },
  { value: "download", label: "Download" },
  { value: "visit_profile", label: "Visit profile" },
  { value: "none", label: "No button" },
] as const;

export type CreativeDraftInput = {
  name: string;
  media: BusinessMediaItem | null;
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
};

export type NormalizedCreativeDraft = {
  name: string;
  format: "image" | "video";
  mediaAssetId: string | null;
  videoAssetId: string | null;
  primaryText: string | null;
  headline: string | null;
  description: string | null;
  callToAction: string;
};

export type CreativeFormErrors = Partial<Record<"name" | "media" | "primaryText" | "headline" | "description" | "callToAction", string>>;

const ACTIVE_CONTENT_TAG = /<\s*(script|iframe|object|embed|form|input|button|style|link|meta)(?:\s|>)/i;
const JAVASCRIPT_URL = /javascript\s*:/i;

function hasActiveContent(value: string) {
  return ACTIVE_CONTENT_TAG.test(value) || JAVASCRIPT_URL.test(value);
}

export function isCreativeMediaSelectable(item: BusinessMediaItem) {
  if (item.purpose !== "business_library" || item.status !== "ready") return false;
  return item.mediaKind === "image"
    ? item.assetSource === "media_asset" && item.provider === "r2"
    : item.mediaKind === "video" && item.assetSource === "video_asset" && item.provider === "cloudflare_stream";
}

const optional = (value: string) => value.trim() || null;

export function normalizeCreativeDraft(input: CreativeDraftInput): NormalizedCreativeDraft {
  const format = input.media?.mediaKind ?? "image";
  return {
    name: input.name.trim(),
    format,
    mediaAssetId: format === "image" ? input.media?.assetId ?? null : null,
    videoAssetId: format === "video" ? input.media?.assetId ?? null : null,
    primaryText: optional(input.primaryText),
    headline: optional(input.headline),
    description: optional(input.description),
    callToAction: input.callToAction,
  };
}

export function creativeFormErrors(input: CreativeDraftInput): CreativeFormErrors {
  const errors: CreativeFormErrors = {};
  const normalized = normalizeCreativeDraft(input);
  if (normalized.name.length < 2 || normalized.name.length > 120) errors.name = "Use 2 to 120 characters.";
  if (!input.media || !isCreativeMediaSelectable(input.media)) errors.media = "Choose ready media from your Business Library.";
  if (normalized.primaryText && normalized.primaryText.length > 2200) errors.primaryText = "Primary text must be 2,200 characters or fewer.";
  if (normalized.headline && normalized.headline.length > 255) errors.headline = "Headline must be 255 characters or fewer.";
  if (normalized.description && normalized.description.length > 500) errors.description = "Description must be 500 characters or fewer.";
  if (![...ADS_CTA_OPTIONS].some((item) => item.value === normalized.callToAction)) errors.callToAction = "Choose a supported call to action.";
  for (const field of ["primaryText", "headline", "description"] as const) {
    const value = normalized[field];
    if (value && hasActiveContent(value)) {
      errors[field] = "Remove unsupported HTML or script content from the ad text.";
    }
  }
  return errors;
}

export function latestCreativeVersion(versions: AdvertisingCreativeVersion[]) {
  return versions.reduce<AdvertisingCreativeVersion | null>((latest, version) => (
    !latest || version.versionNumber > latest.versionNumber ? version : latest
  ), null);
}

export function latestCreativeOptions(creatives: AdvertisingCreative[], mediaById: Record<string, BusinessMediaItem>) {
  return creatives.flatMap((creative) => {
    const version = latestCreativeVersion(creative.versions);
    const mediaId = version?.mediaAssetId ?? version?.videoAssetId;
    const media = mediaId ? mediaById[mediaId] : null;
    const mediaMatchesVersion = version?.format === "image"
      ? media?.mediaKind === "image" && version.mediaAssetId === media.assetId && version.videoAssetId === null
      : version?.format === "video" && media?.mediaKind === "video" && version.videoAssetId === media.assetId && version.mediaAssetId === null;
    return version && media && mediaMatchesVersion && isCreativeMediaSelectable(media) ? [{ creative, version }] : [];
  });
}

export function sameCreativeContent(version: AdvertisingCreativeVersion, draft: NormalizedCreativeDraft) {
  return version.format === draft.format
    && version.mediaAssetId === draft.mediaAssetId
    && version.videoAssetId === draft.videoAssetId
    && version.primaryText === draft.primaryText
    && version.headline === draft.headline
    && version.description === draft.description
    && version.callToAction === draft.callToAction;
}

export function ctaLabel(value: string) {
  return ADS_CTA_OPTIONS.find((item) => item.value === value)?.label ?? "Call to action";
}

export function findAdOperationResult(
  ads: AdvertisingAd[],
  idempotencyKey: string,
  payload: Pick<AdvertisingAd, "adSetId" | "creativeVersionId" | "destinationId" | "name">,
) {
  return ads.find((ad) => ad.creationIdempotencyKey === idempotencyKey
    && ad.adSetId === payload.adSetId
    && ad.creativeVersionId === payload.creativeVersionId
    && ad.destinationId === payload.destinationId
    && ad.name === payload.name) ?? null;
}
