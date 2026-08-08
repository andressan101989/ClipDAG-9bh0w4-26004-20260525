import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
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
