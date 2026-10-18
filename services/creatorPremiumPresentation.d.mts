export type CreatorPremiumPresentationTone = 'purple' | 'green' | 'amber';

export type CreatorPremiumLifecyclePresentation = Readonly<{
  state: 'draft' | 'not_requested' | 'processing' | 'failed'
    | 'legacy_reverification_required' | 'awaiting_policy' | 'approved'
    | 'rejected' | 'restricted' | 'published' | 'removed' | 'deleted';
  label: string;
  copy: string;
  tone: CreatorPremiumPresentationTone;
  polling: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canDelete: boolean;
}>;

export type CreatorPremiumLifecycleActions = Readonly<{
  editable: boolean;
  canSubmit: boolean;
  canDelete: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canReopen: boolean;
}>;

export type CreatorPremiumVideoPickerAsset = Readonly<{
  uri: string;
  mimeType: string | null | undefined;
  fileName: string;
  sizeBytes: number;
  durationMs?: number | null;
}>;

export const CREATOR_PREMIUM_VIDEO_MIME_TYPES: readonly string[];
export const CREATOR_PREMIUM_VIDEO_MAX_BYTES: number;
export const CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS: number;
export function formatCreatorPremiumBdag(
  value: string | null | undefined,
  options?: { empty?: string },
): string;
export function normalizeCreatorPremiumVideoPickerAsset(
  asset: CreatorPremiumVideoPickerAsset | null | undefined,
): Readonly<{ uri: string; mimeType: string; fileName: string; sizeBytes: number }> | null;
export function prepareCreatorPremiumVideoPickerAsset(
  asset: (Omit<CreatorPremiumVideoPickerAsset, 'mimeType' | 'fileName' | 'sizeBytes'> & {
    mimeType?: string | null;
    fileName?: string | null;
    sizeBytes?: number | null;
  }) | null | undefined,
  options?: { sizeForUri?: (uri: string) => number },
): Readonly<{ uri: string; mimeType: string; fileName: string; sizeBytes: number }> | null;
export function selectCreatorPremiumVideoFromPhotos<TAsset, TFile>(dependencies: {
  requestPermission: () => Promise<{ granted?: boolean }>;
  launchPicker: () => Promise<{ canceled?: boolean; assets?: readonly TAsset[] | null }>;
  prepareAsset: (asset: TAsset) => TFile | Promise<TFile>;
}): Promise<
  | Readonly<{ status: 'permission_required' }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'selected'; file: TFile }>
  | Readonly<{ status: 'failed'; code: string; message: string }>
>;
export function creatorPremiumLifecyclePresentation(input?: {
  lifecycle_status?: string | null;
  verification_status?: string | null;
  verification_error_code?: string | null;
  review_reason?: string | null;
  removal_reason?: string | null;
}): CreatorPremiumLifecyclePresentation;
export function creatorPremiumLifecycleActions(input?: {
  lifecycle_status?: string | null;
  verification_status?: string | null;
  verification_error_code?: string | null;
  review_reason?: string | null;
  removal_reason?: string | null;
}): CreatorPremiumLifecycleActions;
export function creatorPremiumPolicyBlocksRetry(errorCode?: string | null): boolean;

