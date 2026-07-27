import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

export const IOS_VIDEO_PAGE_SIZE = 50;
export const IOS_VIDEO_MAX_BYTES = 200_000_000;
export const IOS_VIDEO_MAX_DURATION_MS = 60_000;
const CACHE_PREFIX = 'clipdag-video-';

export type IosVideoResolutionStage = 'download' | 'copy' | 'validation';
export type IosVideoResolutionCode =
  | 'download_failed'
  | 'file_unavailable'
  | 'video_too_large'
  | 'video_too_long'
  | 'unsupported_format';

export class IosVideoResolutionError extends Error {
  constructor(
    public readonly code: IosVideoResolutionCode,
    public readonly stage: IosVideoResolutionStage,
  ) {
    super(code);
    this.name = 'IosVideoResolutionError';
  }
}

export interface ResolvedIosVideo {
  uri: string;
  mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm';
  fileName: string;
  fileSize: number;
  durationMs: number;
  width: number;
  height: number;
  ownedCacheUri: string;
}

export function mediaLibraryDurationToMs(durationSeconds: number): number {
  return Math.round(durationSeconds * 1000);
}

export function videoMimeFromFilename(
  filename: string,
): ResolvedIosVideo['mimeType'] | null {
  const extension = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'webm') return 'video/webm';
  return null;
}

export function mergeUniqueAssets(
  current: MediaLibrary.Asset[],
  incoming: MediaLibrary.Asset[],
): MediaLibrary.Asset[] {
  const seen = new Set(current.map(asset => asset.id));
  return [...current, ...incoming.filter(asset => !seen.has(asset.id) && seen.add(asset.id))];
}

export function iosVideoQuery(after?: string): MediaLibrary.AssetsOptions {
  return {
    first: IOS_VIDEO_PAGE_SIZE,
    ...(after ? { after } : {}),
    mediaType: [MediaLibrary.MediaType.video],
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
  };
}

function safeExtension(filename: string): 'mp4' | 'mov' | 'webm' | null {
  const match = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1];
  return extension === 'mp4' || extension === 'mov' || extension === 'webm'
    ? extension
    : null;
}

function createUnusedDestination(extension: 'mp4' | 'mov' | 'webm'): File {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const random = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const destination = new File(Paths.cache, `${CACHE_PREFIX}${random}.${extension}`);
    if (!destination.exists) return destination;
  }
  throw new IosVideoResolutionError('file_unavailable', 'copy');
}

export async function resolveIosVideoAsset(
  asset: MediaLibrary.Asset,
  onNetworkState?: (isNetworkAsset: boolean) => void,
): Promise<ResolvedIosVideo> {
  try {
    const availability = await MediaLibrary.getAssetInfoAsync(asset.id, {
      shouldDownloadFromNetwork: false,
    });
    onNetworkState?.(availability.isNetworkAsset === true);
  } catch {
    // Availability is only a progress hint; the explicit network-enabled request is authoritative.
  }

  let info: MediaLibrary.AssetInfo;
  try {
    info = await MediaLibrary.getAssetInfoAsync(asset.id, {
      shouldDownloadFromNetwork: true,
    });
  } catch {
    throw new IosVideoResolutionError('download_failed', 'download');
  }

  const originalName = info.filename || asset.filename;
  const extension = safeExtension(originalName);
  const mimeType = videoMimeFromFilename(originalName);
  if (!extension || !mimeType) {
    throw new IosVideoResolutionError('unsupported_format', 'validation');
  }
  if (!info.localUri?.trim()) {
    throw new IosVideoResolutionError('file_unavailable', 'validation');
  }

  const source = new File(info.localUri);
  if (!source.exists || source.size <= 0) {
    throw new IosVideoResolutionError('file_unavailable', 'validation');
  }
  if (source.size > IOS_VIDEO_MAX_BYTES) {
    throw new IosVideoResolutionError('video_too_large', 'validation');
  }

  const durationMs = mediaLibraryDurationToMs(info.duration ?? asset.duration);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > IOS_VIDEO_MAX_DURATION_MS) {
    throw new IosVideoResolutionError('video_too_long', 'validation');
  }

  const destination = createUnusedDestination(extension);
  try {
    source.copy(destination);
  } catch {
    throw new IosVideoResolutionError('file_unavailable', 'copy');
  }
  if (!destination.exists || destination.size <= 0) {
    if (destination.exists) destination.delete();
    throw new IosVideoResolutionError('file_unavailable', 'copy');
  }
  if (destination.size > IOS_VIDEO_MAX_BYTES) {
    destination.delete();
    throw new IosVideoResolutionError('video_too_large', 'validation');
  }

  return {
    uri: destination.uri,
    mimeType,
    fileName: `${CACHE_PREFIX}upload.${extension}`,
    fileSize: destination.size,
    durationMs,
    width: info.width || asset.width,
    height: info.height || asset.height,
    ownedCacheUri: destination.uri,
  };
}

export function deleteOwnedIosVideoCache(uri?: string | null): void {
  if (!uri) return;
  const cacheRoot = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
  if (!uri.startsWith(`${cacheRoot}${CACHE_PREFIX}`)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
