/**
 * Canonical Creator Premium B1 metadata client.
 *
 * Supabase remains the authority. This module only calls narrow authenticated
 * RPCs and never reads private tables or requests Premium media/finance data.
 */
import { getSupabaseClient } from '@/template';

export const CREATOR_PREMIUM_FINANCE_AVAILABLE: boolean = false;
export const CREATOR_PREMIUM_MEDIA_AVAILABLE: boolean = false;
export const CREATOR_PREMIUM_IMAGE_MEDIA_AVAILABLE: boolean = true;
export const CREATOR_PREMIUM_FOUNDATION_MESSAGE =
  'Las imágenes exclusivas ya usan medios privados. Las compras, suscripciones y el visor protegido todavía no están disponibles.';
export const CREATOR_PREMIUM_UNAVAILABLE_CODE = 'creator_premium_b1_foundation_only';

export type CreatorPremiumContentKind = 'image' | 'video';
export type CreatorPremiumAccessMode = 'purchase' | 'subscription' | 'purchase_or_subscription';
export type CreatorPremiumLifecycle =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'quarantined'
  | 'removed'
  | 'deleted';
export type CreatorPremiumEntitlementSource = 'owner' | 'purchase' | 'subscription' | 'none';

export interface CreatorPremiumCursor {
  timestamp: string;
  id: string;
}

export interface CreatorPremiumCatalogItem {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  content_kind: CreatorPremiumContentKind;
  access_mode: CreatorPremiumAccessMode;
  published_at: string;
  created_at: string;
  entitled: boolean;
  entitlement_source: CreatorPremiumEntitlementSource;
  entitlement_expires_at: string | null;
  teaser_url: string;
}

export interface CreatorPremiumOwnerItem {
  id: string;
  title: string;
  description: string;
  content_kind: CreatorPremiumContentKind;
  access_mode: CreatorPremiumAccessMode;
  lifecycle_status: CreatorPremiumLifecycle;
  published_at: string | null;
  quarantined_at: string | null;
  removed_at: string | null;
  deleted_at: string | null;
  removal_reason: string | null;
  created_at: string;
  updated_at: string;
  teaser_url: string | null;
  teaser_attached: boolean;
  original_attached: boolean;
  image_media_ready: boolean;
}

export interface CreatorPremiumLibraryItem {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  content_kind: CreatorPremiumContentKind;
  access_mode: CreatorPremiumAccessMode;
  published_at: string;
  created_at: string;
  entitlement_source: Exclude<CreatorPremiumEntitlementSource, 'owner' | 'none'>;
  entitlement_expires_at: string | null;
}

export interface CreatorPremiumEntitlement {
  allowed: boolean;
  source: CreatorPremiumEntitlementSource;
  reason: string;
  expires_at: string | null;
}

export interface CreatorPremiumPage<T> {
  items: T[];
  nextCursor: CreatorPremiumCursor | null;
}

export interface CreatorPremiumUnavailableResult {
  success: false;
  error: string;
  code: typeof CREATOR_PREMIUM_UNAVAILABLE_CODE;
}

const db = () => getSupabaseClient();

function safeLimit(limit = 24): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('creator_premium_invalid_limit');
  }
  return limit;
}

function cursorParams(cursor?: CreatorPremiumCursor | null) {
  return {
    timestamp: cursor?.timestamp ?? null,
    id: cursor?.id ?? null,
  };
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  timestamp: (row: T) => string,
): CreatorPremiumPage<T> {
  const last = rows.length === limit ? rows[rows.length - 1] : undefined;
  return {
    items: rows,
    nextCursor: last ? { timestamp: timestamp(last), id: last.id } : null,
  };
}

export function creatorPremiumUnavailable(): CreatorPremiumUnavailableResult {
  return {
    success: false,
    error: CREATOR_PREMIUM_FOUNDATION_MESSAGE,
    code: CREATOR_PREMIUM_UNAVAILABLE_CODE,
  };
}

export async function fetchCreatorPremiumCatalog(
  creatorId: string,
  options: { limit?: number; cursor?: CreatorPremiumCursor | null } = {},
): Promise<CreatorPremiumPage<CreatorPremiumCatalogItem>> {
  if (!creatorId) throw new Error('creator_premium_invalid_creator');
  const limit = safeLimit(options.limit);
  const cursor = cursorParams(options.cursor);
  const { data, error } = await db().rpc('get_creator_premium_catalog_v1', {
    p_creator_id: creatorId,
    p_limit: limit,
    p_cursor_published_at: cursor.timestamp,
    p_cursor_id: cursor.id,
  });
  if (error) throw error;
  return page((data ?? []) as CreatorPremiumCatalogItem[], limit, row => row.published_at);
}

export async function createMyCreatorPremiumDraft(input: {
  title: string;
  description?: string;
  contentKind: CreatorPremiumContentKind;
  accessMode: CreatorPremiumAccessMode;
  clientRequestId: string;
}) {
  const { data, error } = await db().rpc('create_my_creator_premium_draft_v1', {
    p_title: input.title,
    p_description: input.description ?? '',
    p_content_kind: input.contentKind,
    p_access_mode: input.accessMode,
    p_client_request_id: input.clientRequestId,
  });
  if (error) throw error;
  return (data ?? [])[0] as {
    id: string;
    created: boolean;
    lifecycle_status: 'draft';
    created_at: string;
    updated_at: string;
  } | undefined;
}

export async function updateMyCreatorPremiumDraft(input: {
  contentId: string;
  title: string;
  description?: string;
  contentKind: CreatorPremiumContentKind;
  accessMode: CreatorPremiumAccessMode;
}) {
  const { data, error } = await db().rpc('update_my_creator_premium_draft_v1', {
    p_content_id: input.contentId,
    p_title: input.title,
    p_description: input.description ?? '',
    p_content_kind: input.contentKind,
    p_access_mode: input.accessMode,
  });
  if (error) throw error;
  return (data ?? [])[0] as {
    id: string;
    lifecycle_status: 'draft';
    created_at: string;
    updated_at: string;
  } | undefined;
}

export async function fetchMyCreatorPremiumContents(
  options: { limit?: number; cursor?: CreatorPremiumCursor | null } = {},
): Promise<CreatorPremiumPage<CreatorPremiumOwnerItem>> {
  const limit = safeLimit(options.limit);
  const cursor = cursorParams(options.cursor);
  const { data, error } = await db().rpc('get_my_creator_premium_contents_v1', {
    p_limit: limit,
    p_cursor_created_at: cursor.timestamp,
    p_cursor_id: cursor.id,
  });
  if (error) throw error;
  return page((data ?? []) as CreatorPremiumOwnerItem[], limit, row => row.created_at);
}

export async function getMyCreatorPremiumEntitlement(
  contentId: string,
): Promise<CreatorPremiumEntitlement> {
  if (!contentId) throw new Error('creator_premium_invalid_content');
  const { data, error } = await db().rpc('get_my_creator_premium_entitlement_v1', {
    p_content_id: contentId,
  });
  if (error) throw error;
  return ((data ?? [])[0] ?? {
    allowed: false,
    source: 'none',
    reason: 'content_not_found',
    expires_at: null,
  }) as CreatorPremiumEntitlement;
}

export async function fetchMyCreatorPremiumLibrary(
  options: { limit?: number; cursor?: CreatorPremiumCursor | null } = {},
): Promise<CreatorPremiumPage<CreatorPremiumLibraryItem>> {
  const limit = safeLimit(options.limit);
  const cursor = cursorParams(options.cursor);
  const { data, error } = await db().rpc('get_my_creator_premium_library_v1', {
    p_limit: limit,
    p_cursor_published_at: cursor.timestamp,
    p_cursor_id: cursor.id,
  });
  if (error) throw error;
  return page((data ?? []) as CreatorPremiumLibraryItem[], limit, row => row.published_at);
}
