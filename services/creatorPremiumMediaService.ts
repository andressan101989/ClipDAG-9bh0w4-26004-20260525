/**
 * Creator Premium B2 image-media coordination.
 *
 * The server remains authoritative for ownership, age, media binding, and
 * entitlement. Signed original grants are returned to the caller only and are
 * never persisted by this service.
 */
import {
  deleteMediaAsset,
  getSafeMediaError,
  uploadMediaFromUri,
  type UploadMediaInput,
} from '@/services/mediaService';
import { getSupabaseClient } from '@/template';

type PremiumImageInput = Pick<
  UploadMediaInput,
  'uri' | 'mimeType' | 'fileName' | 'sizeBytes' | 'signal' | 'timeoutMs'
>;

export interface UploadCreatorPremiumImagePairInput {
  contentId: string;
  teaser: PremiumImageInput;
  original: PremiumImageInput;
}

export interface CreatorPremiumImageMediaState {
  content_id: string;
  content_kind: 'image';
  lifecycle_status: string;
  teaser_url: string | null;
  teaser_attached: boolean;
  original_attached: boolean;
  media_ready: boolean;
}

export interface CreatorPremiumImagePairResult {
  contentId: string;
  teaserUrl: string;
  teaserAttached: boolean;
  originalAttached: boolean;
  mediaReady: boolean;
  replayed: boolean;
  replacementCleanupScheduled: boolean;
}

export interface CreatorPremiumOriginalImageGrant {
  url: string;
  expiresAt: string;
}

export interface CreatorPremiumCleanupFailure {
  role: 'teaser' | 'original';
  code: string;
}

export class CreatorPremiumMediaError extends Error {
  cleanupFailures: CreatorPremiumCleanupFailure[];

  constructor(message: string, cleanupFailures: CreatorPremiumCleanupFailure[] = []) {
    super(message);
    this.name = 'CreatorPremiumMediaError';
    this.cleanupFailures = cleanupFailures;
  }
}

const db = () => getSupabaseClient();

function firstRow<T>(data: T[] | T | null | undefined): T | undefined {
  return Array.isArray(data) ? data[0] : data ?? undefined;
}

function safeFailureCode(error: unknown): string {
  return getSafeMediaError(error).code;
}

async function cleanupUploads(
  assets: { role: CreatorPremiumCleanupFailure['role']; assetId: string }[],
): Promise<CreatorPremiumCleanupFailure[]> {
  const failures: CreatorPremiumCleanupFailure[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.assetId)) continue;
    seen.add(asset.assetId);
    try {
      await deleteMediaAsset(asset.assetId);
    } catch (error) {
      failures.push({ role: asset.role, code: safeFailureCode(error) });
    }
  }
  return failures;
}

function mediaError(error: unknown, cleanupFailures: CreatorPremiumCleanupFailure[]) {
  const message =
    error && typeof error === 'object' && 'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'creator_premium_media_failed';
  return new CreatorPremiumMediaError(message, cleanupFailures);
}

export async function uploadCreatorPremiumImagePair(
  input: UploadCreatorPremiumImagePairInput,
): Promise<CreatorPremiumImagePairResult> {
  if (!input.contentId) throw new CreatorPremiumMediaError('creator_premium_invalid_content');

  const teaser = await uploadMediaFromUri({
    ...input.teaser,
    purpose: 'creator_premium_teaser_image',
    visibility: 'public',
    premiumContentId: input.contentId,
  });

  let original;
  try {
    original = await uploadMediaFromUri({
      ...input.original,
      purpose: 'creator_premium_original_image',
      visibility: 'private',
      premiumContentId: input.contentId,
    });
  } catch (error) {
    const cleanupFailures = await cleanupUploads([
      { role: 'teaser', assetId: teaser.assetId },
    ]);
    throw mediaError(error, cleanupFailures);
  }

  if (teaser.assetId === original.assetId) {
    const cleanupFailures = await cleanupUploads([
      { role: 'teaser', assetId: teaser.assetId },
    ]);
    throw new CreatorPremiumMediaError(
      'creator_premium_image_assets_must_differ',
      cleanupFailures,
    );
  }

  const { data, error } = await db().rpc('set_my_creator_premium_image_media_v1', {
    p_content_id: input.contentId,
    p_teaser_asset_id: teaser.assetId,
    p_original_asset_id: original.assetId,
  });
  if (error) {
    const cleanupFailures = await cleanupUploads([
      { role: 'teaser', assetId: teaser.assetId },
      { role: 'original', assetId: original.assetId },
    ]);
    throw mediaError(error, cleanupFailures);
  }

  const result = firstRow(data) as Record<string, unknown> | undefined;
  if (!result || result.media_ready !== true || typeof result.teaser_url !== 'string') {
    const cleanupFailures = await cleanupUploads([
      { role: 'teaser', assetId: teaser.assetId },
      { role: 'original', assetId: original.assetId },
    ]);
    throw new CreatorPremiumMediaError(
      'creator_premium_invalid_media_binding',
      cleanupFailures,
    );
  }

  return {
    contentId: String(result.content_id),
    teaserUrl: result.teaser_url,
    teaserAttached: result.teaser_attached === true,
    originalAttached: result.original_attached === true,
    mediaReady: true,
    replayed: result.replayed === true,
    replacementCleanupScheduled: result.replacement_cleanup_scheduled === true,
  };
}

export async function fetchMyCreatorPremiumImageMedia(
  contentId: string,
): Promise<CreatorPremiumImageMediaState> {
  if (!contentId) throw new CreatorPremiumMediaError('creator_premium_invalid_content');
  const { data, error } = await db().rpc('get_my_creator_premium_image_media_v1', {
    p_content_id: contentId,
  });
  if (error) throw mediaError(error, []);
  const state = firstRow(data) as CreatorPremiumImageMediaState | undefined;
  if (!state) throw new CreatorPremiumMediaError('creator_premium_media_not_found');
  return state;
}

export async function getCreatorPremiumOriginalImageGrant(
  contentId: string,
): Promise<CreatorPremiumOriginalImageGrant> {
  if (!contentId) throw new CreatorPremiumMediaError('creator_premium_invalid_content');
  const { data, error } = await db().functions.invoke('get-media-url', {
    body: { premium_content_id: contentId },
  });
  const grant = data?.data;
  const expiresAt = typeof grant?.expiresAt === 'string' ? Date.parse(grant.expiresAt) : NaN;
  let parsed: URL;
  try {
    parsed = new URL(grant?.url ?? '');
  } catch {
    throw new CreatorPremiumMediaError('invalid_premium_image_grant');
  }
  if (
    error ||
    data?.success !== true ||
    grant?.contentId !== contentId ||
    parsed.protocol !== 'https:' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new CreatorPremiumMediaError('invalid_premium_image_grant');
  }
  return { url: parsed.toString(), expiresAt: grant.expiresAt };
}
