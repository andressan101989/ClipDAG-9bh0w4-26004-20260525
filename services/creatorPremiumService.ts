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
export const CREATOR_PREMIUM_VIDEO_MEDIA_AVAILABLE: boolean = true;
export const CREATOR_PREMIUM_VIEWER_AVAILABLE: boolean = true;
export const CREATOR_PREMIUM_FOUNDATION_MESSAGE =
  'El visor protegido está disponible para usuarios con acceso vigente. Las compras y suscripciones todavía no están habilitadas.';
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
  video_attached: boolean;
  video_media_ready: boolean;
  active_offer_version: number | null;
  price_bdag: string | null;
  mapped_plan_count: number;
  active_plan_count: number;
  submission_ready: boolean;
  submission_blocker: string | null;
}

export type CreatorPremiumPlanStatus = 'draft' | 'active' | 'retired';

export interface CreatorPremiumPlanItem {
  id: string;
  name: string;
  description: string;
  price_bdag: string;
  billing_period_days: number;
  version: number;
  status: CreatorPremiumPlanStatus;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  mapped_content_count: number;
  mapped_content_ids: string[];
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

const CREATOR_PREMIUM_PRICE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;

export function normalizeCreatorPremiumPriceBdag(input: string): string {
  const normalized = input.trim().replace(',', '.');
  if (!CREATOR_PREMIUM_PRICE_PATTERN.test(normalized)) {
    throw new Error('creator_premium_price_invalid');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const significantFraction = fraction.replace(/0+$/, '');
  if (whole === '0' && !significantFraction) {
    throw new Error('creator_premium_price_invalid');
  }
  return significantFraction ? `${whole}.${significantFraction}` : whole;
}

function firstRow<T>(data: T[] | T | null | undefined): T | undefined {
  return Array.isArray(data) ? data[0] : data ?? undefined;
}

export function creatorPremiumUnavailable(): CreatorPremiumUnavailableResult {
  return {
    success: false,
    error: CREATOR_PREMIUM_FOUNDATION_MESSAGE,
    code: CREATOR_PREMIUM_UNAVAILABLE_CODE,
  };
}

export async function getCurrentCreatorPremiumUserId(): Promise<string | null> {
  const { data, error } = await db().auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
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

export async function fetchMyCreatorPremiumContent(contentId: string): Promise<CreatorPremiumOwnerItem> {
  if (!contentId) throw new Error('creator_premium_content_invalid');
  const { data, error } = await db().rpc('get_my_creator_premium_content_v1', {
    p_content_id: contentId,
  });
  if (error) throw error;
  const item = firstRow(data) as CreatorPremiumOwnerItem | undefined;
  if (!item) throw new Error('creator_premium_content_not_found');
  return item;
}

export async function setMyCreatorPremiumOffer(input: {
  contentId: string;
  priceBdag: string;
  clientRequestId: string;
}) {
  const { data, error } = await db().rpc('set_my_creator_premium_offer_v1', {
    p_content_id: input.contentId,
    p_price_bdag: normalizeCreatorPremiumPriceBdag(input.priceBdag),
    p_client_request_id: input.clientRequestId,
  });
  if (error) throw error;
  return firstRow(data) as {
    content_id: string;
    version: number;
    price_bdag: string;
    currency: 'BDAG';
    status: 'active';
    replayed: boolean;
  } | undefined;
}

export async function createMyCreatorPremiumPlanDraft(input: {
  name: string;
  description?: string;
  priceBdag: string;
  billingPeriodDays: number;
  clientRequestId: string;
}) {
  const { data, error } = await db().rpc('create_my_creator_premium_plan_draft_v1', {
    p_name: input.name,
    p_description: input.description ?? '',
    p_price_bdag: normalizeCreatorPremiumPriceBdag(input.priceBdag),
    p_billing_period_days: input.billingPeriodDays,
    p_client_request_id: input.clientRequestId,
  });
  if (error) throw error;
  return firstRow(data) as CreatorPremiumPlanItem | undefined;
}

export async function updateMyCreatorPremiumPlanDraft(input: {
  planId: string;
  name: string;
  description?: string;
  priceBdag: string;
  billingPeriodDays: number;
}) {
  const { data, error } = await db().rpc('update_my_creator_premium_plan_draft_v1', {
    p_plan_id: input.planId,
    p_name: input.name,
    p_description: input.description ?? '',
    p_price_bdag: normalizeCreatorPremiumPriceBdag(input.priceBdag),
    p_billing_period_days: input.billingPeriodDays,
  });
  if (error) throw error;
  return firstRow(data) as CreatorPremiumPlanItem | undefined;
}

export async function setMyCreatorPremiumPlanContents(
  planId: string,
  contentIds: string[],
) {
  const uniqueContentIds = [...new Set(contentIds)];
  const { data, error } = await db().rpc('set_my_creator_premium_plan_contents_v1', {
    p_plan_id: planId,
    p_content_ids: uniqueContentIds,
  });
  if (error) throw error;
  return firstRow(data) as {
    id: string;
    mapped_content_count: number;
    mapped_content_ids: string[];
  } | undefined;
}

export async function cloneMyCreatorPremiumPlanVersion(
  planId: string,
  clientRequestId: string,
) {
  const { data, error } = await db().rpc('clone_my_creator_premium_plan_version_v1', {
    p_plan_id: planId,
    p_client_request_id: clientRequestId,
  });
  if (error) throw error;
  return firstRow(data) as CreatorPremiumPlanItem | undefined;
}

export async function activateMyCreatorPremiumPlan(planId: string) {
  const { data, error } = await db().rpc('activate_my_creator_premium_plan_v1', {
    p_plan_id: planId,
  });
  if (error) throw error;
  return firstRow(data) as {
    id: string;
    version: number;
    status: 'active';
    activated_at: string;
    mapped_content_count: number;
  } | undefined;
}

export async function retireMyCreatorPremiumPlan(planId: string) {
  const { data, error } = await db().rpc('retire_my_creator_premium_plan_v1', {
    p_plan_id: planId,
  });
  if (error) throw error;
  return firstRow(data) as {
    id: string;
    version: number;
    status: 'retired';
    retired_at: string;
  } | undefined;
}

export async function fetchMyCreatorPremiumPlans(
  options: { limit?: number; cursor?: CreatorPremiumCursor | null } = {},
): Promise<CreatorPremiumPage<CreatorPremiumPlanItem>> {
  const limit = safeLimit(options.limit ?? 50);
  const cursor = cursorParams(options.cursor);
  const { data, error } = await db().rpc('get_my_creator_premium_plans_v1', {
    p_limit: limit,
    p_cursor_created_at: cursor.timestamp,
    p_cursor_id: cursor.id,
  });
  if (error) throw error;
  return page((data ?? []) as CreatorPremiumPlanItem[], limit, row => row.created_at);
}

export async function submitMyCreatorPremiumContentForReview(contentId: string) {
  const { data, error } = await db().rpc('submit_my_creator_premium_content_for_review_v1', {
    p_content_id: contentId,
  });
  if (error) throw error;
  return firstRow(data) as {
    content_id: string;
    lifecycle_status: 'pending_review';
    submission_ready: true;
  } | undefined;
}

export async function deleteMyCreatorPremiumDraft(contentId: string) {
  const { data, error } = await db().rpc('delete_my_creator_premium_draft_v1', {
    p_content_id: contentId,
  });
  if (error) throw error;
  return firstRow(data) as {
    content_id: string;
    lifecycle_status: 'deleted';
    r2_assets_scheduled: number;
    video_assets_scheduled: number;
    cleanup_scheduled: boolean;
  } | undefined;
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

/**
 * Resolves public teaser projections for a bounded library page. The private
 * library RPC intentionally contains no media locator, so this helper joins it
 * client-side only with the canonical public catalog projection. Missing or
 * newly-denied catalog rows fail soft to a placeholder; they never trigger an
 * original-media request.
 */
export async function fetchCreatorPremiumLibraryTeasers(
  items: CreatorPremiumLibraryItem[],
): Promise<Record<string, string>> {
  const allowedContentIds = new Set(items.map(item => item.id));
  const creatorIds = [...new Set(items.map(item => item.creator_id))];
  const pages = await Promise.all(creatorIds.map(async creatorId => {
    try {
      return await fetchCreatorPremiumCatalog(creatorId, { limit: 100 });
    } catch {
      return null;
    }
  }));
  const teasers: Record<string, string> = {};
  for (const pageResult of pages) {
    for (const catalogItem of pageResult?.items ?? []) {
      if (
        allowedContentIds.has(catalogItem.id)
        && catalogItem.entitled
        && catalogItem.teaser_url.startsWith('https://')
      ) teasers[catalogItem.id] = catalogItem.teaser_url;
    }
  }
  return teasers;
}
