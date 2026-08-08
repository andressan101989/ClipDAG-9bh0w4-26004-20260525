export type MarketplacePhotosAccess = "all" | "limited" | "none";
export const parsePhotosAccess = (permission: {
  granted: boolean;
  accessPrivileges?: "all" | "limited" | "none" | null;
}): MarketplacePhotosAccess =>
  !permission.granted
    ? "none"
    : permission.accessPrivileges === "limited"
      ? "limited"
      : "all";
// expo-image-picker's installed contract reports ImagePickerAsset.duration in milliseconds.
export function normalizeProductVideoDuration(raw: number | null | undefined) {
  return Number.isFinite(raw) && Number(raw) > 0
    ? Math.round(Number(raw))
    : null;
}
export function validateProductVideoDuration(raw: number | null | undefined) {
  const durationMs = normalizeProductVideoDuration(raw);
  return {
    durationMs,
    valid: durationMs !== null && durationMs <= 60_000,
    tooLong: durationMs !== null && durationMs > 60_000,
  };
}
export function formatProductVideoDuration(durationMs: number) {
  const seconds = Math.ceil(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
