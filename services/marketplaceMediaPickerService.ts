import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { createVideoPlayer } from "expo-video";
import { parsePhotosAccess } from "./marketplaceMediaPickerCore";
export {
  formatProductVideoDuration,
  normalizeProductVideoDuration,
  parsePhotosAccess,
  validateProductVideoDuration,
} from "./marketplaceMediaPickerCore";
export async function requestMarketplacePhotosAccess() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return { permission, access: parsePhotosAccess(permission) };
}
export async function expandMarketplacePhotosAccess() {
  await MediaLibrary.presentPermissionsPickerAsync([
    MediaLibrary.MediaType.photo,
    MediaLibrary.MediaType.video,
  ]);
}
export async function materializeMarketplacePhotoAsset(
  assetId: string | null | undefined,
  fallbackUri: string,
) {
  if (!assetId) return fallbackUri;
  const info = await MediaLibrary.getAssetInfoAsync(assetId, {
    shouldDownloadFromNetwork: true,
  });
  if (!info.localUri) throw new Error("icloud_video_unavailable");
  return info.localUri;
}
export async function inspectLocalVideoDurationMs(uri: string) {
  const player = createVideoPlayer(uri);
  try {
    return await new Promise<number>((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (Number.isFinite(player.duration) && player.duration > 0) {
          clearInterval(timer);
          resolve(Math.round(player.duration * 1000));
        } else if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error("video_duration_unavailable"));
        }
      }, 100);
    });
  } finally {
    player.release();
  }
}
