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
  canRetire: boolean;
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

export function visibleCreatorPremiumContents<T extends { lifecycle_status?: string | null }>(items: T[]): T[];
export function collectCreatorPremiumPlanPages<
  TPlan extends { id: string },
  TCursor extends { timestamp?: string; id?: string },
>(
  fetchPage: (options: { limit: number; cursor: TCursor | null }) => Promise<{
    items: TPlan[];
    nextCursor: TCursor | null;
  }>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<TPlan[]>;
export function formatCreatorPremiumBdag(
  value: string | null | undefined,
  options?: { empty?: string },
): string;
export function formatCreatorPremiumPriceInput(value: string | null | undefined): string;
export function resolveCreatorPremiumPriceSubmission(input: {
  displayValue: string;
  originalCanonical: string | null;
  edited: boolean;
}): string;
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

