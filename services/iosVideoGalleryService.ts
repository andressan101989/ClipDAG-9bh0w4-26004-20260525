import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

export const IOS_VIDEO_PAGE_SIZE = 50;
export const IOS_VIDEO_MAX_BYTES = 200_000_000;
export const IOS_VIDEO_MAX_DURATION_MS = 60_000;
export const IOS_VIDEO_HARD_MAX_DURATION_MS = 180_000;
export const IOS_VIDEO_MATERIALIZE_TIMEOUT_MS = 120_000;
const CACHE_PREFIX = 'clipdag-video-';

export type IosVideoResolutionStage =
  | 'availability'
  | 'materialize'
  | 'copy'
  | 'validation'
  | 'complete';
export type IosVideoResolutionCode =
  | 'download_failed'
  | 'materialize_timeout'
  | 'selection_cancelled'
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

export interface IosVideoResolutionTelemetry {
  stage: IosVideoResolutionStage;
  elapsedMs: number;
  networkAsset?: boolean;
  code?: IosVideoResolutionCode | 'availability_probe_failed';
}

export interface IosVideoResolutionOptions {
  maxDurationMs?: number;
  materializeTimeoutMs?: number;
  signal?: AbortSignal;
  onNetworkState?: (isNetworkAsset: boolean) => void;
  onTelemetry?: (event: IosVideoResolutionTelemetry) => void;
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
  options: IosVideoResolutionOptions = {},
): Promise<ResolvedIosVideo> {
  const {
    maxDurationMs = IOS_VIDEO_MAX_DURATION_MS,
    materializeTimeoutMs = IOS_VIDEO_MATERIALIZE_TIMEOUT_MS,
    signal,
    onNetworkState,
    onTelemetry,
  } = options;
  const startedAt = Date.now();
  let networkAsset: boolean | undefined;
  const report = (
    stage: IosVideoResolutionStage,
    detail: Omit<IosVideoResolutionTelemetry, 'stage' | 'elapsedMs'> = {},
  ) => onTelemetry?.({ stage, elapsedMs: Math.max(0, Date.now() - startedAt), ...detail });
  const failure = (code: IosVideoResolutionCode, stage: IosVideoResolutionStage) => {
    report(stage, { code, ...(networkAsset === undefined ? {} : { networkAsset }) });
    return new IosVideoResolutionError(code, stage);
  };

  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0
      || maxDurationMs > IOS_VIDEO_HARD_MAX_DURATION_MS) {
    throw failure('video_too_long', 'validation');
  }
  if (!Number.isFinite(materializeTimeoutMs) || materializeTimeoutMs <= 0) {
    throw failure('materialize_timeout', 'validation');
  }
  if (signal?.aborted) throw failure('selection_cancelled', 'materialize');

  try {
    const availability = await MediaLibrary.getAssetInfoAsync(asset.id, {
      shouldDownloadFromNetwork: false,
    });
    networkAsset = availability.isNetworkAsset === true;
    onNetworkState?.(networkAsset);
    report('availability', { networkAsset });
  } catch {
    // Availability is only a progress hint; the explicit network-enabled request is authoritative.
    report('availability', { code: 'availability_probe_failed' });
  }

  let info: MediaLibrary.AssetInfo;
  report('materialize', networkAsset === undefined ? {} : { networkAsset });
  try {
    const materialization = MediaLibrary.getAssetInfoAsync(asset.id, {
      shouldDownloadFromNetwork: true,
    });
    info = await new Promise<MediaLibrary.AssetInfo>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const resolveOnce = (value: MediaLibrary.AssetInfo) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const rejectOnce = (reason: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(reason);
      };
      const onAbort = () => rejectOnce(failure('selection_cancelled', 'materialize'));
      const timer = setTimeout(
        () => rejectOnce(failure('materialize_timeout', 'materialize')),
        materializeTimeoutMs,
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      materialization.then(resolveOnce, rejectOnce);
    });
  } catch (reason) {
    if (reason instanceof IosVideoResolutionError) throw reason;
    throw failure('download_failed', 'materialize');
  }

  if (signal?.aborted) throw failure('selection_cancelled', 'materialize');

  const originalName = info.filename || asset.filename;
  const extension = safeExtension(originalName);
  const mimeType = videoMimeFromFilename(originalName);
  if (!extension || !mimeType) {
    throw failure('unsupported_format', 'validation');
  }
  if (!info.localUri?.trim()) {
    throw failure('file_unavailable', 'validation');
  }

  const source = new File(info.localUri);
  if (!source.exists || source.size <= 0) {
    throw failure('file_unavailable', 'validation');
  }
  if (source.size > IOS_VIDEO_MAX_BYTES) {
    throw failure('video_too_large', 'validation');
  }

  const durationMs = mediaLibraryDurationToMs(info.duration ?? asset.duration);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > maxDurationMs) {
    throw failure('video_too_long', 'validation');
  }

  const destination = createUnusedDestination(extension);
  try {
    source.copy(destination);
  } catch {
    throw failure('file_unavailable', 'copy');
  }
  if (!destination.exists || destination.size <= 0) {
    if (destination.exists) destination.delete();
    throw failure('file_unavailable', 'copy');
  }
  if (destination.size > IOS_VIDEO_MAX_BYTES) {
    destination.delete();
    throw failure('video_too_large', 'validation');
  }
  if (signal?.aborted) {
    destination.delete();
    throw failure('selection_cancelled', 'copy');
  }

  report('complete', networkAsset === undefined ? {} : { networkAsset });
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
