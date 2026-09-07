import { getSupabaseClient } from '@/template';
import { deleteMediaAsset, uploadMediaFromUri } from '@/services/mediaService';

export const CHAT_IMAGE_MAX_BYTES = 25_000_000;
export const CHAT_MEDIA_SIGNED_URL_TTL_SECONDS = 300;

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

export function getStandardChatImageAccess(assetId: string): Promise<ChatMediaAccess> {
  const existing = standardAccessFlights.get(assetId);
  if (existing) return existing;
  const flight = requestChatMediaAccess(assetId).then(access => {
    if (access.consumptionPolicy !== 'standard') throw new Error('chat_media_policy_invalid');
    return access;
  }).finally(() => standardAccessFlights.delete(assetId));
  standardAccessFlights.set(assetId, flight);
  return flight;
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
