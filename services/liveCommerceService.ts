import { getSupabaseClient } from "@/template";
import {
  normalizeShippingAddress,
  parseMarketplaceCheckoutReservation,
  type CreateCheckoutReservationResult,
  type ShippingAddressInput,
} from "./marketplaceOrderService";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_QUERY =
  /[?&](token|access_token|signature|expires|x-amz-[^=&#]*)=/i;
export const isSafeLiveCommerceImage = (value: unknown): value is string =>
  typeof value === "string" &&
  /^https:\/\/[^\s]+$/i.test(value) &&
  !PRIVATE_QUERY.test(value);
export type LiveProductAvailability =
  | "available"
  | "out_of_stock"
  | "product_unavailable"
  | "affiliate_offer_unavailable"
  | "live_ended";
export type LiveProductReadinessReason =
  | "ready"
  | "seller_not_approved"
  | "store_not_active"
  | "product_not_active"
  | "product_not_approved"
  | "product_deleted"
  | "unsupported_product_type"
  | "unsupported_currency"
  | "shipping_incomplete"
  | "no_active_variant"
  | "inventory_not_configured"
  | "out_of_stock"
  | "affiliate_offer_unavailable"
  | "affiliate_offer_replaced";
export interface LiveSessionProduct {
  id: string;
  productId: string;
  storeId: string;
  storeName: string;
  sellerName: string;
  title: string;
  description: string;
  imageUrl: string | null;
  minPrice: number;
  maxPrice: number;
  compareAtPrice: number | null;
  activeVariantCount: number;
  availableQuantity: number;
  featuredVariantId: string | null;
  isFeatured: boolean;
  position: number;
  soldCount: number;
  commerceMode: "own_product" | "affiliate_product";
  availability: LiveProductAvailability;
}
export interface LiveProductCandidate {
  productId: string;
  storeId: string;
  storeName: string;
  sellerName: string;
  title: string;
  imageUrl: string | null;
  minPrice: number;
  maxPrice: number;
  activeVariantCount: number;
  availableQuantity: number;
  pinId: string | null;
  isPinned: boolean;
  isFeatured: boolean;
  commerceMode: "own_product" | "affiliate_product";
  creatorCommissionBps: number;
  candidateAvailability:
    | "available"
    | "out_of_stock"
    | "product_unavailable"
    | "affiliate_offer_unavailable"
    | "affiliate_offer_replaced";
  readinessReasonCode: LiveProductReadinessReason;
  pinOfferValid: boolean;
  pinnedCreatorCommissionBps: number | null;
  currentOfferCommissionBps: number | null;
  currentOfferId: string | null;
  pinnedOfferId: string | null;
  requiresRepin: boolean;
  updatedAt: string;
}
export interface LivePurchaseEvent {
  id: string;
  buyerDisplayName: string;
  productTitle: string;
  quantity: number;
  grossAmount: number;
  creatorCommissionAmount: number;
  creatorCommissionStatus: "none" | "held" | "released";
  createdAt: string;
}
export interface LiveShopStats {
  ordersCount: number;
  grossSales: number;
  creatorCommissionHeld: number;
  creatorCommissionReleased: number;
  unitsSold: number;
}
export interface LiveAffiliateOfferInput {
  productId: string;
  offerScope: "public_creator" | "specific_creator";
  creatorId: string | null;
  commissionBps: number;
  status: "active" | "paused" | "removed";
  startsAt: string | null;
  endsAt: string | null;
  idempotencyKey: string;
}
export interface LiveAffiliateOffer {
  productId: string;
  offerScope: "public_creator";
  commissionBps: number;
  status: "active" | "paused" | "removed";
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
}
export interface LiveCandidateCursor {
  updatedAt: string;
  id: string;
}
export interface LiveCandidatePage {
  items: LiveProductCandidate[];
  nextCursor: LiveCandidateCursor | null;
}
export interface ActiveLiveCheckout {
  checkoutId: string;
  reference: string;
  status: "pending_payment";
  expiresAt: string;
  total: number;
  currency: "BDAG";
  orderId: string;
  sessionId: string;
  pinId: string;
  items: {
    productId: string;
    variantId: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    imageUrl: string | null;
  }[];
}
export interface LiveCreatorAttributionReceipt {
  id: string | null;
  commerceMode: "own_product" | "affiliate_product";
  creatorUserId: string | null;
  productId: string;
  variantId: string;
  sourceSurface: "live";
  sourceEntityId: string;
}
export type LiveCommerceErrorCode =
  | "marketplace_auth_required"
  | "marketplace_creator_live_attribution_invalid_input"
  | "marketplace_creator_live_source_unavailable"
  | "marketplace_creator_entitlement_ineligible"
  | "marketplace_creator_entitlement_product_ineligible"
  | "marketplace_creator_attribution_variant_mismatch"
  | "marketplace_creator_attribution_idempotency_conflict"
  | "live_commerce_auth_required"
  | "live_commerce_host_not_eligible"
  | "live_commerce_product_unavailable"
  | "live_commerce_out_of_stock"
  | "live_commerce_invalid_variant"
  | "live_commerce_pin_limit"
  | "live_commerce_pin_not_found"
  | "live_commerce_live_ended"
  | "live_commerce_pin_unavailable"
  | "live_affiliate_not_authorized"
  | "live_affiliate_invalid_offer"
  | "live_affiliate_offer_unavailable"
  | "live_affiliate_offer_idempotency_conflict"
  | "live_affiliate_self_purchase_forbidden"
  | "live_commerce_invalid_input"
  | "live_commerce_invalid_cursor"
  | "live_commerce_idempotency_conflict"
  | "marketplace_active_checkout_exists"
  | "marketplace_idempotency_conflict"
  | "marketplace_own_product_forbidden"
  | "marketplace_insufficient_inventory"
  | "marketplace_invalid_shipping_address"
  | "marketplace_shipping_destination_unsupported"
  | "marketplace_shipping_profile_missing"
  | "marketplace_shipping_profile_inactive"
  | "marketplace_shipping_configuration_required"
  | "marketplace_shipping_country_invalid"
  | "marketplace_shipping_region_invalid"
  | "marketplace_shipping_rule_ambiguous"
  | "marketplace_shipping_price_invalid"
  | "marketplace_shipping_quote_stale"
  | "marketplace_product_not_ready_shipping_incomplete"
  | `live_product_readiness_${LiveProductReadinessReason}`
  | `marketplace_product_not_ready_${LiveProductReadinessReason}`
  | "marketplace_product_not_ready"
  | "live_commerce_transport"
  | "live_commerce_unknown";
const READINESS_REASONS: LiveProductReadinessReason[] = [
  "ready", "seller_not_approved", "store_not_active", "product_not_active",
  "product_not_approved", "product_deleted", "unsupported_product_type",
  "unsupported_currency", "shipping_incomplete", "no_active_variant",
  "inventory_not_configured", "out_of_stock", "affiliate_offer_unavailable",
  "affiliate_offer_replaced",
];
const CODES: LiveCommerceErrorCode[] = [
  "marketplace_auth_required",
  "marketplace_creator_live_attribution_invalid_input",
  "marketplace_creator_live_source_unavailable",
  "marketplace_creator_entitlement_ineligible",
  "marketplace_creator_entitlement_product_ineligible",
  "marketplace_creator_attribution_variant_mismatch",
  "marketplace_creator_attribution_idempotency_conflict",
  "live_commerce_auth_required",
  "live_commerce_host_not_eligible",
  "live_commerce_product_unavailable",
  "live_commerce_out_of_stock",
  "live_commerce_invalid_variant",
  "live_commerce_pin_limit",
  "live_commerce_pin_not_found",
  "live_commerce_live_ended",
  "live_commerce_pin_unavailable",
  "live_affiliate_not_authorized",
  "live_affiliate_invalid_offer",
  "live_affiliate_offer_unavailable",
  "live_affiliate_offer_idempotency_conflict",
  "live_affiliate_self_purchase_forbidden",
  "live_commerce_invalid_input",
  "live_commerce_invalid_cursor",
  "live_commerce_idempotency_conflict",
  "marketplace_active_checkout_exists",
  "marketplace_idempotency_conflict",
  "marketplace_own_product_forbidden",
  "marketplace_insufficient_inventory",
  "marketplace_invalid_shipping_address",
  "marketplace_shipping_destination_unsupported",
  "marketplace_shipping_profile_missing",
  "marketplace_shipping_profile_inactive",
  "marketplace_shipping_configuration_required",
  "marketplace_shipping_country_invalid",
  "marketplace_shipping_region_invalid",
  "marketplace_shipping_rule_ambiguous",
  "marketplace_shipping_price_invalid",
  "marketplace_shipping_quote_stale",
  "marketplace_product_not_ready_shipping_incomplete",
  "marketplace_product_not_ready",
  ...READINESS_REASONS.flatMap((reason) => [
    `live_product_readiness_${reason}` as LiveCommerceErrorCode,
    `marketplace_product_not_ready_${reason}` as LiveCommerceErrorCode,
  ]),
];
export const readinessReasonFromErrorCode = (
  code: LiveCommerceErrorCode,
): LiveProductReadinessReason | null => {
  const prefix = code.startsWith("live_product_readiness_")
    ? "live_product_readiness_"
    : code.startsWith("marketplace_product_not_ready_")
      ? "marketplace_product_not_ready_"
      : null;
  if (!prefix) return null;
  const reason = code.slice(prefix.length) as LiveProductReadinessReason;
  return READINESS_REASONS.includes(reason) ? reason : null;
};
export class LiveCommerceError extends Error {
  constructor(
    public code: LiveCommerceErrorCode,
    public postgresCode: string | null = null,
  ) {
    super(code);
    this.name = "LiveCommerceError";
  }
}
export type LiveCheckoutReservationErrorCode =
  | "own_product"
  | "live_not_active"
  | "product_not_featured"
  | "product_unavailable"
  | "variant_invalid"
  | "out_of_stock"
  | "quantity_invalid"
  | "shipping_unsupported"
  | "shipping_configuration"
  | "active_checkout_exists"
  | "authentication_required"
  | "permission"
  | "network"
  | "request";
const RESERVATION_CODES: Partial<
  Record<LiveCommerceErrorCode, LiveCheckoutReservationErrorCode>
> = {
  marketplace_own_product_forbidden: "own_product",
  live_affiliate_self_purchase_forbidden: "own_product",
  live_commerce_live_ended: "live_not_active",
  live_commerce_pin_unavailable: "product_not_featured",
  live_affiliate_offer_unavailable: "product_unavailable",
  live_commerce_product_unavailable: "product_unavailable",
  marketplace_product_not_ready: "product_unavailable",
  live_commerce_invalid_variant: "variant_invalid",
  marketplace_insufficient_inventory: "out_of_stock",
  live_commerce_out_of_stock: "out_of_stock",
  live_commerce_invalid_input: "quantity_invalid",
  marketplace_invalid_shipping_address: "shipping_unsupported",
  marketplace_shipping_destination_unsupported: "shipping_unsupported",
  marketplace_shipping_profile_missing: "shipping_configuration",
  marketplace_shipping_profile_inactive: "shipping_configuration",
  marketplace_shipping_configuration_required: "shipping_configuration",
  marketplace_shipping_country_invalid: "shipping_unsupported",
  marketplace_shipping_region_invalid: "shipping_unsupported",
  marketplace_shipping_rule_ambiguous: "shipping_configuration",
  marketplace_shipping_price_invalid: "shipping_configuration",
  marketplace_shipping_quote_stale: "request",
  marketplace_product_not_ready_shipping_incomplete: "shipping_configuration",
  marketplace_active_checkout_exists: "active_checkout_exists",
  live_commerce_auth_required: "authentication_required",
  live_commerce_transport: "network",
};
export class LiveCheckoutReservationError extends LiveCommerceError {
  constructor(
    code: LiveCommerceErrorCode,
    public reservationCode: LiveCheckoutReservationErrorCode,
    postgresCode: string | null = null,
  ) {
    super(code, postgresCode);
    this.name = "LiveCheckoutReservationError";
  }
}
const db = () => getSupabaseClient();
const finite = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new LiveCommerceError("live_commerce_unknown");
  return n;
};
const validUuid = (value: unknown) =>
  typeof value === "string" && UUID.test(value);
const uuid = (value: string) => {
  if (!validUuid(value))
    throw new LiveCommerceError("live_commerce_invalid_input");
  return value;
};
const safeErrorText = (error: unknown) => {
  if (!error || typeof error !== "object") return "";
  const e = error as Record<string, unknown>;
  return [e.message, e.details, e.hint, e.context, e.body]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
};
export const extractLiveCommerceBusinessCode = (error: unknown) => {
  const message = safeErrorText(error);
  return CODES.find((code) => message === code || message.includes(code)) ?? null;
};
const rpcError = (rpc: string, error: unknown): never => {
  const e = error as { code?: unknown };
  const message = safeErrorText(error);
  const business = CODES.find(
    (code) => message === code || message.includes(code),
  );
  const transport =
    !e?.code &&
    /network request failed|failed to fetch|fetch failed|networkerror|timeout|connection/i.test(
      message,
    );
  const postgresCode = typeof e?.code === "string" ? e.code.slice(0, 40) : null;
  if (__DEV__) {
    const log = business ? console.warn : console.error;
    log("[LiveCommerce] request failed", {
      rpc,
      postgresCode,
      businessCode: business,
      kind: business ? "business" : transport ? "transport" : "unknown",
    });
  }
  const code = business ??
    (transport ? "live_commerce_transport" : "live_commerce_unknown");
  throw new LiveCommerceError(code, postgresCode);
};
const product = (raw: unknown): LiveSessionProduct => {
  const r = raw as Record<string, unknown>,
    availability = String(r.availability) as LiveProductAvailability,
    commerceMode =
      r.commerce_mode === "affiliate_product"
        ? "affiliate_product"
        : "own_product";
  if (
    !validUuid(r.id) ||
    !validUuid(r.product_id) ||
    ![
      "available",
      "out_of_stock",
      "product_unavailable",
      "affiliate_offer_unavailable",
      "live_ended",
    ].includes(availability)
  )
    throw new LiveCommerceError("live_commerce_unknown");
  return {
    id: String(r.id),
    productId: String(r.product_id),
    storeId: String(r.store_id),
    storeName: String(r.store_name),
    sellerName: String(r.seller_name),
    title: String(r.title),
    description: String(r.description ?? ""),
    imageUrl: isSafeLiveCommerceImage(r.image_url) ? r.image_url : null,
    minPrice: finite(r.min_price),
    maxPrice: finite(r.max_price),
    compareAtPrice:
      r.compare_at_price == null ? null : finite(r.compare_at_price),
    activeVariantCount: finite(r.active_variant_count),
    availableQuantity: finite(r.available_quantity),
    featuredVariantId: validUuid(r.featured_variant_id)
      ? String(r.featured_variant_id)
      : null,
    isFeatured: r.is_featured === true && availability === "available",
    position: finite(r.position),
    soldCount: finite(r.sold_count ?? 0),
    commerceMode,
    availability,
  };
};
export async function fetchLiveSessionProducts(sessionId: string) {
  const rpc = "fetch_live_session_products",
    { data, error } = await db().rpc(rpc, { p_session_id: uuid(sessionId) });
  if (error) rpcError(rpc, error);
  if (!Array.isArray(data))
    throw new LiveCommerceError("live_commerce_unknown");
  return data.map(product);
}
export async function fetchMyLiveProductCandidates(
  sessionId: string,
  limit = 20,
  cursor?: LiveCandidateCursor,
): Promise<LiveCandidatePage> {
  const effective = Math.min(Math.max(Math.trunc(limit), 1), 50);
  if (
    cursor &&
    (!validUuid(cursor.id) || !Number.isFinite(Date.parse(cursor.updatedAt)))
  )
    throw new LiveCommerceError("live_commerce_invalid_cursor");
  const rpc = "fetch_my_live_product_candidates",
    { data, error } = await db().rpc(rpc, {
      p_session_id: uuid(sessionId),
      p_limit: effective,
      p_before_updated_at: cursor?.updatedAt ?? null,
      p_before_id: cursor?.id ?? null,
    });
  if (error) rpcError(rpc, error);
  return parseLiveProductCandidatePage(data);
}
export function parseLiveProductCandidatePage(
  data: { items?: unknown; next_cursor?: unknown } | null,
): LiveCandidatePage {
  if (!data || !Array.isArray(data.items))
    throw new LiveCommerceError("live_commerce_unknown");
  const items = data.items.map((raw: unknown) => {
    const r = raw as Record<string, unknown>,
      commerceMode = r.commerce_mode as LiveProductCandidate["commerceMode"],
      candidateAvailability = r.candidate_availability,
      readinessReasonCode = String(r.readiness_reason_code),
      nullableBps = (value: unknown) => {
        if (value == null) return null;
        const parsed = finite(value);
        if (!Number.isInteger(parsed) || parsed > 3000)
          throw new LiveCommerceError("live_commerce_unknown");
        return parsed;
      },
      nullableUuid = (value: unknown) => {
        if (value == null) return null;
        if (!validUuid(value))
          throw new LiveCommerceError("live_commerce_unknown");
        return String(value);
      };
    if (
      !validUuid(r.product_id) ||
      !validUuid(r.store_id) ||
      typeof r.store_name !== "string" ||
      typeof r.seller_name !== "string" ||
      typeof r.title !== "string" ||
      !Number.isFinite(Date.parse(String(r.updated_at))) ||
      (commerceMode !== "own_product" &&
        commerceMode !== "affiliate_product") ||
      ![
        "available",
        "out_of_stock",
        "product_unavailable",
        "affiliate_offer_unavailable",
        "affiliate_offer_replaced",
      ].includes(String(candidateAvailability)) ||
      !READINESS_REASONS.includes(
        readinessReasonCode as LiveProductReadinessReason,
      ) ||
      typeof r.pin_offer_valid !== "boolean" ||
      typeof r.requires_repin !== "boolean"
    )
      throw new LiveCommerceError("live_commerce_unknown");
    const creatorCommissionBps = finite(r.creator_commission_bps);
    if (!Number.isInteger(creatorCommissionBps) || creatorCommissionBps > 3000)
      throw new LiveCommerceError("live_commerce_unknown");
    return {
      productId: String(r.product_id),
      storeId: String(r.store_id),
      storeName: String(r.store_name),
      sellerName: String(r.seller_name),
      title: String(r.title),
      imageUrl: isSafeLiveCommerceImage(r.image_url) ? r.image_url : null,
      minPrice: finite(r.min_price),
      maxPrice: finite(r.max_price),
      activeVariantCount: finite(r.active_variant_count),
      availableQuantity: finite(r.available_quantity),
      pinId: validUuid(r.pin_id) ? String(r.pin_id) : null,
      isPinned: r.is_pinned === true,
      isFeatured: r.is_featured === true,
      commerceMode,
      creatorCommissionBps,
      candidateAvailability:
        candidateAvailability as LiveProductCandidate["candidateAvailability"],
      readinessReasonCode:
        readinessReasonCode as LiveProductReadinessReason,
      pinOfferValid: r.pin_offer_valid,
      pinnedCreatorCommissionBps: nullableBps(r.pinned_creator_commission_bps),
      currentOfferCommissionBps: nullableBps(r.current_offer_commission_bps),
      currentOfferId: nullableUuid(r.current_offer_id),
      pinnedOfferId: nullableUuid(r.pinned_offer_id),
      requiresRepin: r.requires_repin,
      updatedAt: String(r.updated_at),
    };
  });
  const rawCursor = data.next_cursor as Record<string, unknown> | null;
  if (
    rawCursor &&
    (!validUuid(rawCursor.id) ||
      !Number.isFinite(Date.parse(String(rawCursor.updated_at))))
  )
    throw new LiveCommerceError("live_commerce_unknown");
  return {
    items,
    nextCursor: rawCursor
      ? { updatedAt: String(rawCursor.updated_at), id: String(rawCursor.id) }
      : null,
  };
}
export async function fetchMyLivePurchaseEvents(
  sessionId: string,
  limit = 50,
): Promise<LivePurchaseEvent[]> {
  const rpc = "fetch_my_live_purchase_events",
    { data, error } = await db().rpc(rpc, {
      p_session_id: uuid(sessionId),
      p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
    });
  if (error) rpcError(rpc, error);
  if (!Array.isArray(data))
    throw new LiveCommerceError("live_commerce_unknown");
  return data.map((raw) => {
    const r = raw as Record<string, unknown>,
      status = String(r.creator_commission_status);
    if (
      !validUuid(r.id) ||
      !["none", "held", "released"].includes(status) ||
      !Number.isFinite(Date.parse(String(r.created_at)))
    )
      throw new LiveCommerceError("live_commerce_unknown");
    return {
      id: String(r.id),
      buyerDisplayName: String(r.buyer_display_name),
      productTitle: String(r.product_title),
      quantity: finite(r.quantity),
      grossAmount: finite(r.gross_amount),
      creatorCommissionAmount: finite(r.creator_commission_amount),
      creatorCommissionStatus:
        status as LivePurchaseEvent["creatorCommissionStatus"],
      createdAt: String(r.created_at),
    };
  });
}
export async function fetchMyLiveShopStats(
  sessionId: string,
): Promise<LiveShopStats> {
  const rpc = "fetch_my_live_shop_stats",
    { data, error } = await db().rpc(rpc, { p_session_id: uuid(sessionId) });
  if (error) rpcError(rpc, error);
  if (!data || typeof data !== "object")
    throw new LiveCommerceError("live_commerce_unknown");
  const r = data as Record<string, unknown>;
  return {
    ordersCount: finite(r.orders_count),
    grossSales: finite(r.gross_sales),
    creatorCommissionHeld: finite(r.creator_commission_held),
    creatorCommissionReleased: finite(r.creator_commission_released),
    unitsSold: finite(r.units_sold),
  };
}
export async function upsertMyLiveAffiliateOffer(
  input: LiveAffiliateOfferInput,
) {
  if (
    !Number.isInteger(input.commissionBps) ||
    input.commissionBps < 1 ||
    input.commissionBps > 3000
  )
    throw new LiveCommerceError("live_affiliate_invalid_offer");
  return command("upsert_my_live_affiliate_offer", {
    p_product_id: uuid(input.productId),
    p_offer_scope: input.offerScope,
    p_creator_id: input.creatorId ? uuid(input.creatorId) : null,
    p_commission_bps: input.commissionBps,
    p_status: input.status,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_idempotency_key: uuid(input.idempotencyKey),
  });
}
export async function fetchMyLiveAffiliateOffer(
  productId: string,
): Promise<LiveAffiliateOffer | null> {
  const rpc = "fetch_my_live_affiliate_offer";
  const { data, error } = await db().rpc(rpc, { p_product_id: uuid(productId) });
  if (error) rpcError(rpc, error);
  if (data == null) return null;
  if (typeof data !== "object") throw new LiveCommerceError("live_commerce_unknown");
  const row = data as Record<string, unknown>;
  const status = String(row.status);
  if (!(["active", "paused", "removed"] as string[]).includes(status)) {
    throw new LiveCommerceError("live_commerce_unknown");
  }
  return {
    productId: uuid(String(row.product_id)),
    offerScope: "public_creator",
    commissionBps: finite(row.commission_bps),
    status: status as LiveAffiliateOffer["status"],
    startsAt: row.starts_at == null ? null : String(row.starts_at),
    endsAt: row.ends_at == null ? null : String(row.ends_at),
    updatedAt: String(row.updated_at),
  };
}
async function command(rpc: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(rpc, args);
  if (error) rpcError(rpc, error);
  return data;
}
export const pinLiveProduct = (
  sessionId: string,
  productId: string,
  featuredVariantId: string | null,
  idempotencyKey: string,
) =>
  command("pin_live_session_product", {
    p_session_id: uuid(sessionId),
    p_product_id: uuid(productId),
    p_featured_variant_id: featuredVariantId ? uuid(featuredVariantId) : null,
    p_idempotency_key: uuid(idempotencyKey),
  });
export const unpinLiveProduct = (
  sessionId: string,
  pinId: string,
  idempotencyKey: string,
) =>
  command("unpin_live_session_product", {
    p_session_id: uuid(sessionId),
    p_live_session_product_id: uuid(pinId),
    p_idempotency_key: uuid(idempotencyKey),
  });
export const featureLiveProduct = (
  sessionId: string,
  pinId: string,
  idempotencyKey: string,
) =>
  command("feature_live_session_product", {
    p_session_id: uuid(sessionId),
    p_live_session_product_id: uuid(pinId),
    p_idempotency_key: uuid(idempotencyKey),
  });
export async function createLiveCheckoutReservation(
  sessionId: string,
  pinId: string,
  variantId: string,
  quantity: number,
  address: ShippingAddressInput,
  idempotencyKey: string,
): Promise<CreateCheckoutReservationResult> {
  if (!Number.isInteger(quantity) || quantity < 1)
    throw new LiveCommerceError("live_commerce_invalid_input");
  const a = normalizeShippingAddress(address),
    rpc = "create_live_marketplace_checkout_reservation";
  const { data, error } = await db().rpc(rpc, {
      p_session_id: uuid(sessionId),
      p_live_session_product_id: uuid(pinId),
      p_variant_id: uuid(variantId),
      p_quantity: quantity,
      p_shipping_address: {
        recipient_name: a.recipientName,
        line1: a.line1,
        line2: a.line2 ?? null,
        city: a.city,
        region: a.region,
        postal_code: a.postalCode,
        country: a.country,
        phone: a.phone ?? null,
      },
      p_idempotency_key: uuid(idempotencyKey),
    });
  if (error) {
    try {
      rpcError(rpc, error);
    } catch (caught) {
      if (caught instanceof LiveCommerceError) {
        throw new LiveCheckoutReservationError(
          caught.code,
          RESERVATION_CODES[caught.code] ??
            (caught.postgresCode === "42501" ? "permission" : "request"),
          caught.postgresCode,
        );
      }
      throw caught;
    }
  }
  return parseMarketplaceCheckoutReservation(data);
}

export async function createLiveCreatorAttribution(
  pinId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<LiveCreatorAttributionReceipt> {
  const rpc = "create_marketplace_creator_live_attribution";
  const { data, error } = await db().rpc(rpc, {
    p_live_session_product_id: uuid(pinId),
    p_variant_id: uuid(variantId),
    p_idempotency_key: uuid(idempotencyKey),
  });
  if (error) rpcError(rpc, error);
  if (!data || typeof data !== "object")
    throw new LiveCommerceError("live_commerce_unknown");
  const row = data as Record<string, unknown>;
  const commerceMode = row.commerce_mode;
  if (
    (commerceMode !== "own_product" && commerceMode !== "affiliate_product") ||
    row.source_surface !== "live" ||
    !validUuid(row.product_id) ||
    !validUuid(row.variant_id) ||
    !validUuid(row.source_entity_id) ||
    (commerceMode === "affiliate_product" &&
      (!validUuid(row.id) || !validUuid(row.creator_user_id))) ||
    (commerceMode === "own_product" &&
      (row.id !== null || row.creator_user_id !== null))
  )
    throw new LiveCommerceError("live_commerce_unknown");
  return {
    id: row.id === null ? null : String(row.id),
    commerceMode,
    creatorUserId:
      row.creator_user_id === null ? null : String(row.creator_user_id),
    productId: String(row.product_id),
    variantId: String(row.variant_id),
    sourceSurface: "live",
    sourceEntityId: String(row.source_entity_id),
  };
}
export async function fetchMyActiveLiveCheckout(
  sessionId: string,
): Promise<ActiveLiveCheckout | null> {
  const rpc = "fetch_my_active_live_checkout",
    { data, error } = await db().rpc(rpc, { p_session_id: uuid(sessionId) });
  if (error) rpcError(rpc, error);
  if (data == null) return null;
  const r = data as Record<string, unknown>;
  if (
    !validUuid(r.checkout_id) ||
    !validUuid(r.order_id) ||
    !validUuid(r.pin_id) ||
    r.currency !== "BDAG" ||
    r.status !== "pending_payment" ||
    !Array.isArray(r.items)
  )
    throw new LiveCommerceError("live_commerce_unknown");
  return {
    checkoutId: String(r.checkout_id),
    reference: String(r.reference),
    status: "pending_payment",
    expiresAt: String(r.expires_at),
    total: finite(r.total),
    currency: "BDAG",
    orderId: String(r.order_id),
    sessionId: String(r.session_id),
    pinId: String(r.pin_id),
    items: r.items.map((raw) => {
      const i = raw as Record<string, unknown>;
      return {
        productId: String(i.product_id),
        variantId: String(i.variant_id),
        title: String(i.title),
        variantTitle: i.variant_title == null ? null : String(i.variant_title),
        quantity: finite(i.quantity),
        unitPrice: finite(i.unit_price),
        lineTotal: finite(i.line_total),
        imageUrl: isSafeLiveCommerceImage(i.image_url) ? i.image_url : null,
      };
    }),
  };
}
