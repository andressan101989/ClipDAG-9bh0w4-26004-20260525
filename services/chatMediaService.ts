import { getSupabaseClient } from '@/template';
import { deleteMediaAsset, uploadMediaFromUri } from '@/services/mediaService';

export const CHAT_IMAGE_MAX_BYTES = 25_000_000;
export const CHAT_VIDEO_MAX_BYTES = 100_000_000;
export const CHAT_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
export const CHAT_VOICE_MAX_BYTES = 100_000_000;
export const CHAT_VOICE_MIME_TYPES = ['audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/mpeg', 'audio/wav'] as const;
export const CHAT_MEDIA_SIGNED_URL_TTL_SECONDS = 300;
export const CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_SAFETY_MS = 30_000;
export const CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_MAX_ENTRIES = 64;
export const CHAT_STANDARD_VOICE_ACCESS_CACHE_SAFETY_MS = CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_SAFETY_MS;
export const CHAT_STANDARD_VOICE_ACCESS_CACHE_MAX_ENTRIES = CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_MAX_ENTRIES;

type ChatMediaAccessResponse = {
  success?: boolean;
  data?: {
    assetId?: string;
    url?: string;
    expiresAt?: string;
    consumptionPolicy?: 'standard' | 'one_time';
    consumedAt?: string | null;
  };
  error?: string;
};

export type ChatMediaAccess = {
  assetId: string;
  url: string;
  expiresAt: string;
  consumptionPolicy: 'standard' | 'one_time';
  consumedAt: string | null;
};

const standardAccessFlights = new Map<string, Promise<ChatMediaAccess>>();
const standardPrivateMediaAccessCache = new Map<string, ChatMediaAccess>();

async function getAuthenticatedUserId(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.user.id ?? null;
}

function getStandardAccessKey(userId: string, assetId: string): string {
  return `${userId}:${assetId}`;
}

function readCachedStandardPrivateMediaAccess(cacheKey: string, now = Date.now()): ChatMediaAccess | null {
  const cached = standardPrivateMediaAccessCache.get(cacheKey);
  if (!cached) return null;
  const expiresAt = Date.parse(cached.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt - now <= CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_SAFETY_MS) {
    standardPrivateMediaAccessCache.delete(cacheKey);
    return null;
  }
  standardPrivateMediaAccessCache.delete(cacheKey);
  standardPrivateMediaAccessCache.set(cacheKey, cached);
  return cached;
}

function cacheStandardPrivateMediaAccess(cacheKey: string, access: ChatMediaAccess): void {
  standardPrivateMediaAccessCache.delete(cacheKey);
  standardPrivateMediaAccessCache.set(cacheKey, access);
  while (standardPrivateMediaAccessCache.size > CHAT_STANDARD_PRIVATE_MEDIA_ACCESS_CACHE_MAX_ENTRIES) {
    const oldestCacheKey = standardPrivateMediaAccessCache.keys().next().value;
    if (!oldestCacheKey) break;
    standardPrivateMediaAccessCache.delete(oldestCacheKey);
  }
}

export async function uploadPrivateChatImage(input: {
  uri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.sizeBytes != null && input.sizeBytes > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('chat_image_too_large');
  }
  const asset = await uploadMediaFromUri({
    ...input,
    purpose: 'chat_image',
    visibility: 'private',
  });
  if (asset.visibility !== 'private' || asset.mediaKind !== 'image' || asset.url) {
    throw new Error('chat_private_media_contract_invalid');
  }
  return asset.assetId;
}

export async function uploadPrivateChatVideo(input: {
  uri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (!CHAT_VIDEO_MIME_TYPES.includes(input.mimeType as typeof CHAT_VIDEO_MIME_TYPES[number])) {
    throw new Error('chat_video_mime_invalid');
  }
  if (input.sizeBytes != null && input.sizeBytes > CHAT_VIDEO_MAX_BYTES) {
    throw new Error('chat_video_too_large');
  }
  const asset = await uploadMediaFromUri({
    ...input,
    purpose: 'chat_video',
    visibility: 'private',
  });
  if (asset.visibility !== 'private' || asset.mediaKind !== 'video'
    || asset.purpose !== 'chat_video' || asset.url) {
    throw new Error('chat_private_video_contract_invalid');
  }
  return asset.assetId;
}

export async function uploadPrivateVoiceNote(input: {
  uri: string;
  mimeType: string;
  durationMs: number;
  fileName?: string;
  sizeBytes?: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (!CHAT_VOICE_MIME_TYPES.includes(input.mimeType as typeof CHAT_VOICE_MIME_TYPES[number])) {
    throw new Error('chat_voice_mime_invalid');
  }
  if (!Number.isInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 3_600_000) {
    throw new Error('chat_voice_duration_invalid');
  }
  if (input.sizeBytes != null && input.sizeBytes > CHAT_VOICE_MAX_BYTES) {
    throw new Error('chat_voice_too_large');
  }
  const asset = await uploadMediaFromUri({
    ...input,
    purpose: 'voice_note',
    visibility: 'private',
  });
  if (asset.visibility !== 'private' || asset.mediaKind !== 'audio'
    || asset.purpose !== 'voice_note' || asset.url) {
    throw new Error('chat_private_voice_contract_invalid');
  }
  return asset.assetId;
}

async function requestChatMediaAccess(assetId: string): Promise<ChatMediaAccess> {
  const { data, error } = await getSupabaseClient().functions.invoke<ChatMediaAccessResponse>(
    'get-media-url',
    { body: { asset_id: assetId } },
  );
  if (error || !data?.success || !data.data?.url || !data.data.expiresAt
    || !data.data.consumptionPolicy || data.data.assetId !== assetId) {
    throw new Error(data?.error ?? error?.message ?? 'chat_media_access_failed');
  }
  return {
    assetId,
    url: data.data.url,
    expiresAt: data.data.expiresAt,
    consumptionPolicy: data.data.consumptionPolicy,
    consumedAt: data.data.consumedAt ?? null,
  };
}

async function getStandardPrivateChatMediaAccess(assetId: string, policyError: string): Promise<ChatMediaAccess> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    const access = await requestChatMediaAccess(assetId);
    if (access.consumptionPolicy !== 'standard') throw new Error(policyError);
    return access;
  }
  const cacheKey = getStandardAccessKey(userId, assetId);
  const cached = readCachedStandardPrivateMediaAccess(cacheKey);
  if (cached) return Promise.resolve(cached);
  const existing = standardAccessFlights.get(cacheKey);
  if (existing) return existing;
  const flight = requestChatMediaAccess(assetId).then(access => {
    if (access.consumptionPolicy !== 'standard') throw new Error(policyError);
    cacheStandardPrivateMediaAccess(cacheKey, access);
    return access;
  }).finally(() => standardAccessFlights.delete(cacheKey));
  standardAccessFlights.set(cacheKey, flight);
  return flight;
}

export async function getStandardChatImageAccess(assetId: string): Promise<ChatMediaAccess> {
  return getStandardPrivateChatMediaAccess(assetId, 'chat_media_policy_invalid');
}

export async function getStandardChatVideoAccess(assetId: string): Promise<ChatMediaAccess> {
  return getStandardPrivateChatMediaAccess(assetId, 'chat_video_policy_invalid');
}

export async function getStandardChatVoiceAccess(assetId: string): Promise<ChatMediaAccess> {
  return getStandardPrivateChatMediaAccess(assetId, 'chat_voice_policy_invalid');
}

export async function openOneTimeChatImage(assetId: string): Promise<ChatMediaAccess> {
  const access = await requestChatMediaAccess(assetId);
  if (access.consumptionPolicy !== 'one_time' || !access.consumedAt) {
    throw new Error('chat_one_time_claim_missing');
  }
  return access;
}

export async function reconcileUnlinkedChatImage(assetId: string): Promise<void> {
  await deleteMediaAsset(assetId);
}
