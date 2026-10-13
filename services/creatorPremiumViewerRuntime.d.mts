export type CreatorPremiumGrantErrorCode =
  | 'denied'
  | 'missing'
  | 'network'
  | 'unavailable'
  | 'invalid';

export type CreatorPremiumViewerStatus =
  | 'idle'
  | 'loading'
  | 'locked'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'expired'
  | 'revoked'
  | 'restricted'
  | 'error'
  | 'offline';

export type CreatorPremiumViewerGrant =
  | { kind: 'image'; contentId: string; url: string; expiresAt: string }
  | {
      kind: 'video';
      contentId: string;
      hlsUrl: string;
      dashUrl: string;
      thumbnailUrl: string;
      expiresAt: string;
    };

export interface CreatorPremiumViewerSnapshot {
  status: CreatorPremiumViewerStatus;
  reason: string | null;
  userId: string | null;
  contentId: string | null;
  generation: number;
  entitlementSource: 'owner' | 'purchase' | 'subscription' | 'none';
  entitlementExpiresAt: string | null;
  mediaKind: 'image' | 'video' | null;
  grant: CreatorPremiumViewerGrant | null;
}

export interface CreatorPremiumViewerDependencies {
  now?: () => number;
  getCurrentUserId(): Promise<string | null>;
  getEntitlement(contentId: string): Promise<{
    allowed: boolean;
    source: 'owner' | 'purchase' | 'subscription' | 'none';
    reason: string;
    expires_at: string | null;
  }>;
  getImageGrant(contentId: string): Promise<{
    contentId: string;
    url: string;
    expiresAt: string;
  }>;
  getVideoGrant(contentId: string): Promise<{
    contentId: string;
    hlsUrl: string;
    dashUrl: string;
    thumbnailUrl: string;
    expiresAt: string;
  }>;
}

export interface CreatorPremiumViewerController {
  open(input: { userId: string; contentId: string }): Promise<void>;
  revalidate(reason: 'focus' | 'foreground' | 'timer' | 'manual'): Promise<void>;
  invalidate(
    reason:
      | 'background'
      | 'logout'
      | 'identity_change'
      | 'content_change'
      | 'close'
      | 'security'
      | 'revalidate'
      | 'expired',
  ): void;
  getSnapshot(): CreatorPremiumViewerSnapshot;
  dispose(): void;
}

export class CreatorPremiumGrantError extends Error {
  readonly code: CreatorPremiumGrantErrorCode;
  readonly safeReason: string;
  constructor(code: CreatorPremiumGrantErrorCode, safeReason?: string);
}

export function classifyCreatorPremiumGrantError(error: unknown): CreatorPremiumGrantError;
export function rememberCreatorPremiumContentKind(
  userId: string,
  contentId: string,
  kind: 'image' | 'video',
): void;
export function getCreatorPremiumContentKindHint(
  userId: string,
  contentId: string,
): 'image' | 'video' | null;
export function clearCreatorPremiumContentKindHints(userId?: string): void;
export function createCreatorPremiumRenewalScheduler(dependencies: {
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
  onRenew(): void;
  onExpire?(): void;
}): {
  schedule(input: {
    focused: boolean;
    status: CreatorPremiumViewerStatus;
    grantExpiresAt: string | null;
    entitlementExpiresAt: string | null;
  }): void;
  cancel(): void;
};
export function createCreatorPremiumViewerController(
  dependencies: CreatorPremiumViewerDependencies,
  onSnapshot?: (snapshot: CreatorPremiumViewerSnapshot) => void,
): CreatorPremiumViewerController;
