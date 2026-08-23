import { supabase } from "./supabase";
import type { AdminRange, Money } from "./adminApi";

export type IntelligenceCursor = { created_at: string; id: string };
export type CreatorCursor = { activity_at: string; creator_id: string };
export type ValidatedRecord = Record<string, unknown>;
export type IntelligencePage = {
  items: ValidatedRecord[];
  nextCursor: IntelligenceCursor | null;
  pageSize: number;
};

const fail = (path: string): never => {
  throw new Error(`Respuesta de inteligencia inválida: ${path}`);
};
const obj = (value: unknown, path: string): ValidatedRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ValidatedRecord)
    : fail(path);
const arr = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path);
const str = (value: unknown, path: string): string =>
  typeof value === "string" ? value : fail(path);
const nullableStr = (value: unknown, path: string) =>
  value === null ? null : str(value, path);
const num = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(path);
const int = (value: unknown, path: string): number => {
  const parsed = num(value, path);
  return Number.isInteger(parsed) ? parsed : fail(path);
};
const bool = (value: unknown, path: string): boolean =>
  typeof value === "boolean" ? value : fail(path);
const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T => {
  const parsed = str(value, path);
  return allowed.includes(parsed as T) ? (parsed as T) : fail(path);
};
const surfaces = [
  "creator_showcase",
  "feed",
  "reel",
  "direct_creator_link",
  "live",
] as const;
const surface = (value: unknown, path: string) =>
  enumValue(value, surfaces, path);
const promotionTypes = [
  "percentage",
  "fixed_amount",
  "promotional_price",
] as const;
const promotionStates = ["scheduled", "active", "ended", "cancelled"] as const;
const promotionStatuses = ["enabled", "ended", "cancelled"] as const;
const adStatuses = [
  "draft",
  "scheduled",
  "active",
  "paused",
  "exhausted",
  "completed",
  "cancelled",
] as const;
const adEligibilityReasons = [
  "unfunded",
  "paused",
  "scheduled",
  "expired",
  "budget_exhausted",
  "terminal",
  "seller_restricted",
  "store_inactive",
  "product_inactive",
  "moderation",
  "product_unpublished",
  "unsupported_product",
  "no_variant",
  "out_of_stock",
  "eligible",
] as const;
const adFinancialEventTypes = ["fund", "spend", "release"] as const;
const adEventTypes = [
  "impression",
  "click",
  "product_view",
  "add_to_cart",
  "purchase",
] as const;
const uuid = (value: unknown, path: string): string => {
  const parsed = str(value, path);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    parsed,
  )
    ? parsed
    : fail(path);
};
const nullableUuid = (value: unknown, path: string) =>
  value === null ? null : uuid(value, path);
const timestamp = (value: unknown, path: string): string => {
  const parsed = str(value, path);
  return Number.isNaN(Date.parse(parsed)) ? fail(path) : parsed;
};
const nullableTimestamp = (value: unknown, path: string) =>
  value === null ? null : timestamp(value, path);
const nullableEnumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
) => (value === null ? null : enumValue(value, allowed, path));
const money = (value: unknown, path: string): Money =>
  (typeof value === "string" || typeof value === "number") &&
  /^-?\d+(\.\d+)?$/.test(String(value))
    ? value
    : fail(path);
const nullableMoney = (value: unknown, path: string) =>
  value === null ? null : money(value, path);
const range = (value: unknown): AdminRange =>
  ["7d", "30d", "90d", "all"].includes(String(value))
    ? (value as AdminRange)
    : fail("range");
const metadata = (value: unknown, path: string) => obj(value, path);
const validateCursor = (
  value: unknown,
  path: string,
): IntelligenceCursor | null => {
  if (value === null) return null;
  const row = obj(value, path);
  return {
    created_at: timestamp(row.created_at, `${path}.created_at`),
    id: uuid(row.id, `${path}.id`),
  };
};
async function rpc(name: string, args: ValidatedRecord = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.message || "No se pudo consultar inteligencia de Marketplace",
    );
  return data as unknown;
}

const validateCreatorSummary = (
  value: unknown,
  path: string,
  includeActiveCreators: boolean,
) => {
  const row = obj(value, path);
  if (includeActiveCreators)
    int(row.active_creators, `${path}.active_creators`);
  else int(row.orders, `${path}.orders`);
  int(row.units, `${path}.units`);
  int(row.product_opens, `${path}.product_opens`);
  int(row.add_to_cart, `${path}.add_to_cart`);
  if (includeActiveCreators)
    int(row.attributed_orders, `${path}.attributed_orders`);
  for (const key of [
    "attributed_gmv",
    "commission_generated",
    "commission_released",
    "commission_reversed",
    "commission_net",
  ]) {
    money(row[key], `${path}.${key}`);
  }
  return row;
};
const validateSurface = (value: unknown, path: string) => {
  const row = obj(value, path);
  surface(row.source_surface, `${path}.source_surface`);
  for (const key of ["orders", "units"] as const)
    int(row[key], `${path}.${key}`);
  int(row.product_opens, `${path}.product_opens`);
  int(row.add_to_cart, `${path}.add_to_cart`);
  for (const key of [
    "attributed_gmv",
    "commission_generated",
    "commission_released",
    "commission_reversed",
    "commission_net",
  ] as const)
    money(row[key], `${path}.${key}`);
  return row;
};
export function validateCreatorOverview(value: unknown) {
  const root = obj(value, "creator_overview");
  range(root.range);
  timestamp(root.generated_at, "generated_at");
  enumValue(root.timezone, ["UTC"] as const, "timezone");
  validateCreatorSummary(root.summary, "summary", true);
  arr(root.surface_breakdown, "surface_breakdown").forEach((entry, index) =>
    validateSurface(entry, `surface_breakdown[${index}]`),
  );
  return root;
}
export async function getCreatorOverview(selected: AdminRange) {
  return validateCreatorOverview(
    await rpc("get_marketplace_admin_creator_commerce_overview", {
      p_range: selected,
    }),
  );
}

const validateCreatorRow = (value: unknown, path: string) => {
  const row = obj(value, path);
  uuid(row.creator_id, `${path}.creator_id`);
  nullableStr(row.username, `${path}.username`);
  nullableStr(row.display_name, `${path}.display_name`);
  int(row.orders, `${path}.orders`);
  for (const key of [
    "attributed_gmv",
    "commission_generated",
    "commission_released",
    "commission_reversed",
    "commission_net",
  ] as const)
    money(row[key], `${path}.${key}`);
  surface(row.top_surface, `${path}.top_surface`);
  timestamp(row.last_activity_at, `${path}.last_activity_at`);
  return row;
};
export function validateCreatorPage(value: unknown) {
  const root = obj(value, "creator_page");
  range(root.range);
  const items = arr(root.creators, "creators").map((entry, index) =>
    validateCreatorRow(entry, `creators[${index}]`),
  );
  int(root.page_size, "page_size");
  let next: CreatorCursor | null = null;
  if (root.next_cursor !== null) {
    const cursor = obj(root.next_cursor, "next_cursor");
    next = {
      activity_at: timestamp(cursor.activity_at, "next_cursor.activity_at"),
      creator_id: uuid(cursor.creator_id, "next_cursor.creator_id"),
    };
  }
  return {
    items,
    nextCursor: next,
    pageSize: int(root.page_size, "page_size"),
  };
}
export async function searchCreators(input: {
  query?: string;
  range: AdminRange;
  cursor?: CreatorCursor;
  limit?: number;
}) {
  return validateCreatorPage(
    await rpc("search_marketplace_admin_creators_v2", {
      p_query: input.query || null,
      p_range: input.range,
      p_cursor_activity_at: input.cursor?.activity_at || null,
      p_cursor_creator_id: input.cursor?.creator_id || null,
      p_limit: input.limit ?? 50,
    }),
  );
}

export function validateCreatorDetail(value: unknown) {
  const root = obj(value, "creator_detail"),
    creator = obj(root.creator, "creator");
  uuid(creator.id, "creator.id");
  nullableStr(creator.username, "creator.username");
  nullableStr(creator.display_name, "creator.display_name");
  range(root.range);
  timestamp(root.generated_at, "generated_at");
  enumValue(root.timezone, ["UTC"] as const, "timezone");
  validateCreatorSummary(root.summary, "summary", false);
  arr(root.surface_breakdown, "surface_breakdown").forEach((entry, index) =>
    validateSurface(entry, `surface_breakdown[${index}]`),
  );
  arr(root.top_products, "top_products").forEach((entry, index) => {
    const row = obj(entry, `top_products[${index}]`);
    uuid(row.product_id, `top_products[${index}].product_id`);
    str(row.title, `top_products[${index}].title`);
    nullableStr(row.image_url, `top_products[${index}].image_url`);
    int(row.orders, `top_products[${index}].orders`);
    int(row.units, `top_products[${index}].units`);
    for (const key of [
      "attributed_gmv",
      "commission_generated",
      "commission_released",
      "commission_reversed",
    ] as const)
      money(row[key], `top_products[${index}].${key}`);
  });
  arr(root.item_trace, "item_trace").forEach((entry, index) => {
    const row = obj(entry, `item_trace[${index}]`);
    for (const key of [
      "creator_user_id",
      "source_entity_id",
      "product_id",
      "order_id",
      "order_item_id",
    ] as const)
      uuid(row[key], `item_trace[${index}].${key}`);
    surface(row.source_surface, `item_trace[${index}].source_surface`);
    str(row.product_title, `item_trace[${index}].product_title`);
    int(row.quantity, `item_trace[${index}].quantity`);
    const historicalBps = int(
      row.historical_bps,
      `item_trace[${index}].historical_bps`,
    );
    if (historicalBps < 1 || historicalBps > 3000)
      fail(`item_trace[${index}].historical_bps`);
    for (const key of [
      "attributed_gmv",
      "commission_generated",
      "commission_released",
      "commission_reversed",
    ] as const)
      money(row[key], `item_trace[${index}].${key}`);
    timestamp(row.paid_at, `item_trace[${index}].paid_at`);
    nullableTimestamp(row.released_at, `item_trace[${index}].released_at`);
    nullableTimestamp(row.reversed_at, `item_trace[${index}].reversed_at`);
  });
  return root;
}
export async function getCreatorDetail(id: string, selected: AdminRange) {
  uuid(id, "creatorId");
  return validateCreatorDetail(
    await rpc("get_marketplace_admin_creator_detail", {
      p_creator_id: id,
      p_range: selected,
    }),
  );
}

const validateEffectivePrice = (value: unknown, path: string) => {
  const price = obj(value, path);
  money(price.base_price, `${path}.base_price`);
  money(price.effective_price, `${path}.effective_price`);
  nullableUuid(price.promotion_id, `${path}.promotion_id`);
  if (price.promotion_type === null) {
    nullableStr(price.promotion_type, `${path}.promotion_type`);
  } else enumValue(price.promotion_type, promotionTypes, `${path}.promotion_type`);
  money(price.discount_amount, `${path}.discount_amount`);
  nullableMoney(price.discount_percentage, `${path}.discount_percentage`);
  nullableTimestamp(price.promotion_ends_at, `${path}.promotion_ends_at`);
  return price;
};
const validatePromotion = (value: unknown, path: string) => {
  const row = obj(value, path);
  for (const key of ["id", "seller_id", "store_id", "product_id"] as const)
    uuid(row[key], `${path}.${key}`);
  nullableUuid(row.variant_id, `${path}.variant_id`);
  for (const key of ["seller_name", "store_name", "product_title"] as const)
    str(row[key], `${path}.${key}`);
  enumValue(row.promotion_type, promotionTypes, `${path}.promotion_type`);
  enumValue(row.state, promotionStates, `${path}.state`);
  nullableStr(row.variant_title, `${path}.variant_title`);
  money(row.configured_value, `${path}.configured_value`);
  timestamp(row.starts_at, `${path}.starts_at`);
  timestamp(row.ends_at, `${path}.ends_at`);
  timestamp(row.created_at, `${path}.created_at`);
  int(row.historical_orders, `${path}.historical_orders`);
  int(row.historical_units, `${path}.historical_units`);
  if (row.current_price !== null)
    validateEffectivePrice(row.current_price, `${path}.current_price`);
  return row;
};
export function validatePromotionPage(value: unknown) {
  const root = obj(value, "promotion_page");
  return {
    items: arr(root.promotions, "promotions").map((entry, index) =>
      validatePromotion(entry, `promotions[${index}]`),
    ),
    nextCursor: validateCursor(root.next_cursor, "next_cursor"),
    pageSize: int(root.page_size, "page_size"),
  };
}
export async function searchPromotions(input: {
  query?: string;
  state?: string;
  cursor?: IntelligenceCursor;
  limit?: number;
}) {
  return validatePromotionPage(
    await rpc("search_marketplace_admin_promotions", {
      p_query: input.query || null,
      p_state: input.state || null,
      p_cursor_created_at: input.cursor?.created_at || null,
      p_cursor_id: input.cursor?.id || null,
      p_limit: input.limit ?? 50,
    }),
  );
}
export function validatePromotionDetail(value: unknown) {
  const root = obj(value, "promotion_detail"),
    promotion = obj(root.promotion, "promotion");
  uuid(promotion.id, "promotion.id");
  for (const key of [
    "seller_id",
    "store_id",
    "product_id",
    "created_by",
  ] as const)
    uuid(promotion[key], `promotion.${key}`);
  nullableUuid(promotion.variant_id, "promotion.variant_id");
  const promotionType = enumValue(
    promotion.promotion_type,
    promotionTypes,
    "promotion.promotion_type",
  );
  enumValue(promotion.status, promotionStatuses, "promotion.status");
  if (promotionType === "percentage")
    money(promotion.percentage_off, "promotion.percentage_off");
  else if (promotionType === "fixed_amount")
    money(promotion.fixed_amount_bdag, "promotion.fixed_amount_bdag");
  else money(promotion.promotional_price_bdag, "promotion.promotional_price_bdag");
  timestamp(promotion.starts_at, "promotion.starts_at");
  timestamp(promotion.ends_at, "promotion.ends_at");
  timestamp(promotion.created_at, "promotion.created_at");
  const seller = obj(root.seller, "seller"),
    store = obj(root.store, "store"),
    product = obj(root.product, "product");
  uuid(seller.id, "seller.id");
  uuid(store.id, "store.id");
  uuid(product.id, "product.id");
  nullableStr(seller.username, "seller.username");
  nullableStr(seller.display_name, "seller.display_name");
  str(store.name, "store.name");
  str(store.slug, "store.slug");
  str(store.status, "store.status");
  str(product.title, "product.title");
  str(product.status, "product.status");
  str(product.moderation_status, "product.moderation_status");
  if (root.variant !== null) {
    const variant = obj(root.variant, "variant");
    uuid(variant.id, "variant.id");
    nullableStr(variant.title, "variant.title");
    str(variant.sku, "variant.sku");
    money(variant.price, "variant.price");
    str(variant.status, "variant.status");
  }
  if (root.current_price !== null)
    validateEffectivePrice(root.current_price, "current_price");
  arr(root.historical_usage, "historical_usage").forEach((entry, index) => {
    const row = obj(entry, `historical_usage[${index}]`);
    uuid(row.order_id, `historical_usage[${index}].order_id`);
    uuid(row.order_item_id, `historical_usage[${index}].order_item_id`);
    int(row.quantity, `historical_usage[${index}].quantity`);
    for (const key of [
      "base_unit_price",
      "discount_amount",
      "unit_price",
      "line_total",
    ] as const)
      money(row[key], `historical_usage[${index}].${key}`);
  });
  return root;
}
export async function getPromotionDetail(id: string) {
  uuid(id, "promotionId");
  return validatePromotionDetail(
    await rpc("get_marketplace_admin_promotion_detail", { p_promotion_id: id }),
  );
}

const validateAd = (value: unknown, path: string) => {
  const row = obj(value, path);
  for (const key of ["id", "seller_id", "store_id", "product_id"] as const)
    uuid(row[key], `${path}.${key}`);
  nullableStr(row.name, `${path}.name`);
  for (const key of ["seller_name", "store_name", "product_title"] as const)
    str(row[key], `${path}.${key}`);
  enumValue(row.status, adStatuses, `${path}.status`);
  bool(row.eligibility_state, `${path}.eligibility_state`);
  nullableEnumValue(
    row.eligibility_reason,
    adEligibilityReasons,
    `${path}.eligibility_reason`,
  );
  timestamp(row.starts_at, `${path}.starts_at`);
  timestamp(row.ends_at, `${path}.ends_at`);
  for (const key of [
    "total_budget",
    "spent",
    "released",
    "remaining_reserved",
  ] as const)
    money(row[key], `${path}.${key}`);
  nullableTimestamp(row.funded_at, `${path}.funded_at`);
  nullableTimestamp(row.completed_at, `${path}.completed_at`);
  bool(row.attention, `${path}.attention`);
  timestamp(row.created_at, `${path}.created_at`);
  return row;
};
export function validateAdsPage(value: unknown) {
  const root = obj(value, "ads_page");
  return {
    items: arr(root.campaigns, "campaigns").map((entry, index) =>
      validateAd(entry, `campaigns[${index}]`),
    ),
    nextCursor: validateCursor(root.next_cursor, "next_cursor"),
    pageSize: int(root.page_size, "page_size"),
  };
}
export async function searchAds(input: {
  query?: string;
  status?: string;
  attention?: boolean;
  cursor?: IntelligenceCursor;
  limit?: number;
}) {
  return validateAdsPage(
    await rpc("search_marketplace_admin_ads", {
      p_query: input.query || null,
      p_status: input.status || null,
      p_attention: input.attention ?? null,
      p_cursor_created_at: input.cursor?.created_at || null,
      p_cursor_id: input.cursor?.id || null,
      p_limit: input.limit ?? 50,
    }),
  );
}
export function validateAdDetail(value: unknown) {
  const root = obj(value, "ad_detail"),
    campaign = obj(root.campaign, "campaign"),
    financial = obj(root.financial, "financial");
  uuid(campaign.id, "campaign.id");
  for (const key of ["seller_id", "store_id", "product_id"] as const)
    uuid(campaign[key], `campaign.${key}`);
  nullableStr(campaign.name, "campaign.name");
  enumValue(campaign.status, adStatuses, "campaign.status");
  timestamp(campaign.starts_at, "campaign.starts_at");
  timestamp(campaign.ends_at, "campaign.ends_at");
  nullableTimestamp(campaign.funded_at, "campaign.funded_at");
  nullableTimestamp(campaign.paused_at, "campaign.paused_at");
  nullableTimestamp(campaign.completed_at, "campaign.completed_at");
  bool(campaign.eligibility_state, "campaign.eligibility_state");
  nullableEnumValue(
    campaign.eligibility_reason,
    adEligibilityReasons,
    "campaign.eligibility_reason",
  );
  int(campaign.eligible_elapsed_seconds, "campaign.eligible_elapsed_seconds");
  nullableTimestamp(
    campaign.eligibility_checkpoint_at,
    "campaign.eligibility_checkpoint_at",
  );
  timestamp(campaign.created_at, "campaign.created_at");
  timestamp(campaign.updated_at, "campaign.updated_at");
  const seller = obj(root.seller, "seller"),
    store = obj(root.store, "store"),
    product = obj(root.product, "product");
  uuid(seller.id, "seller.id");
  nullableStr(seller.username, "seller.username");
  nullableStr(seller.display_name, "seller.display_name");
  uuid(store.id, "store.id");
  str(store.name, "store.name");
  str(store.status, "store.status");
  uuid(product.id, "product.id");
  str(product.title, "product.title");
  str(product.status, "product.status");
  str(product.moderation_status, "product.moderation_status");
  for (const key of [
    "total_budget",
    "spent",
    "released",
    "remaining_reserved",
  ] as const)
    money(financial[key], `financial.${key}`);
  arr(root.financial_events, "financial_events").forEach((entry, index) => {
    const row = obj(entry, `financial_events[${index}]`);
    uuid(row.id, `financial_events[${index}].id`);
    enumValue(
      row.event_type,
      adFinancialEventTypes,
      `financial_events[${index}].event_type`,
    );
    money(row.amount, `financial_events[${index}].amount`);
    uuid(
      row.financial_transaction_id,
      `financial_events[${index}].financial_transaction_id`,
    );
    timestamp(row.created_at, `financial_events[${index}].created_at`);
  });
  if (root.finalization !== null) {
    const final = obj(root.finalization, "finalization");
    uuid(final.campaign_id, "finalization.campaign_id");
    int(final.eligible_elapsed_seconds, "finalization.eligible_elapsed_seconds");
    int(final.delivery_target_seconds, "finalization.delivery_target_seconds");
    for (const key of [
      "final_target_bdag",
      "spent_before_bdag",
      "final_spend_delta_bdag",
      "released_bdag",
    ] as const)
      money(final[key], `finalization.${key}`);
    timestamp(final.finalized_at, "finalization.finalized_at");
  }
  const delivery = obj(root.delivery, "delivery");
  int(delivery.materializations, "delivery.materializations");
  int(delivery.eligible_elapsed_seconds, "delivery.eligible_elapsed_seconds");
  const events = obj(root.events, "events");
  Object.entries(events).forEach(([key, entry]) => {
    enumValue(key, adEventTypes, `events.${key}`);
    int(entry, `events.${key}`);
  });
  const attribution = obj(root.attribution, "attribution");
  int(attribution.orders, "attribution.orders");
  int(attribution.units, "attribution.units");
  money(attribution.gmv, "attribution.gmv");
  return root;
}
export async function getAdDetail(id: string) {
  uuid(id, "campaignId");
  return validateAdDetail(
    await rpc("get_marketplace_admin_ad_detail", { p_campaign_id: id }),
  );
}

const healthGroups = [
  "payments",
  "settlements",
  "creator_commerce",
  "creator_showcase",
  "creator_content_tags",
  "creator_allocations",
  "live_creator_commissions",
  "creator_analytics",
  "reversals",
  "ads_finance",
  "ads_eligibility",
  "ads_finalization",
  "ads_delivery",
  "ads_events",
  "admin_operations",
] as const;
type HealthGroup = (typeof healthGroups)[number];
export const healthCounterKeys = {
  payments: ["escrow_shortfall", "invalid_inventory", "paid_without_payment", "allocation_mismatches", "consumed_without_sale", "unbalanced_transactions", "confirmed_state_breakdown", "confirmed_state_mismatches", "payment_without_transaction", "paid_with_active_reservations", "invalid_confirmed_state_details"],
  settlements: ["escrow_surplus", "escrow_shortage", "escrow_difference", "missing_seller_leg", "duplicate_seller_leg", "missing_platform_leg", "escrow_actual_balance", "duplicate_platform_leg", "escrow_expected_held_total", "settlement_amount_mismatch", "settlement_without_release", "refunded_settlement_breakdown", "delivery_timestamp_mismatch", "released_without_settlement", "seller_beneficiary_mismatch", "settlement_leg_sum_mismatch", "transaction_amount_mismatch", "transaction_status_mismatch", "released_order_not_delivered", "platform_beneficiary_mismatch", "transaction_currency_mismatch", "delivered_with_held_allocation", "transaction_reference_mismatch", "released_shipment_not_delivered", "positive_leg_without_transaction", "settlement_order_identity_mismatch", "transaction_operation_type_mismatch", "transaction_source_account_mismatch", "settlement_payment_identity_mismatch", "settlement_allocation_identity_mismatch", "transaction_destination_account_mismatch"],
  creator_commerce: ["missing_creator", "b7f_bps_mismatch", "b7f_base_mismatch", "orphan_attribution", "orphan_entitlement", "b7f_amount_mismatch", "b7f_creator_mismatch", "missing_b7f_allocation", "invalid_entitlement_bps", "wrong_entitlement_store", "wrong_entitlement_seller", "unexpected_b7f_allocation", "wrong_entitlement_product", "wrong_entitlement_variant", "attribution_store_mismatch", "invalid_entitlement_status", "order_item_source_mismatch", "self_attribution_violation", "attribution_seller_mismatch", "expired_attribution_created", "frozen_attribution_mutation", "order_item_creator_mismatch", "order_item_product_mismatch", "order_item_variant_mismatch", "request_fingerprint_invalid", "attribution_creator_mismatch", "attribution_product_mismatch", "attribution_variant_mismatch", "orphan_order_item_attribution", "attribution_entitlement_mismatch", "live_source_attribution_mismatch", "order_item_commission_bps_mismatch", "revoked_entitlement_new_attribution", "allocation_without_valid_attribution", "settlement_without_creator_authority", "duplicate_order_item_creator_attribution"],
  creator_showcase: ["wrong_showcase_store", "invalid_sort_position", "self_showcase_product", "wrong_showcase_seller", "invalid_showcase_status", "orphan_showcase_creator", "orphan_showcase_product", "showcase_b7f_bps_mismatch", "active_showcase_over_limit", "invalid_request_fingerprint", "selected_entitlement_missing", "showcase_b7f_creator_mismatch", "duplicate_active_sort_position", "duplicate_active_creator_product", "showcase_attribution_source_mismatch", "showcase_settlement_creator_mismatch", "selected_entitlement_product_mismatch", "showcase_attribution_creator_mismatch", "showcase_attribution_product_mismatch", "showcase_attribution_missing_source_item", "showcase_attribution_entitlement_mismatch", "selected_entitlement_creator_scope_mismatch", "showcase_item_attribution_snapshot_mismatch"],
  creator_content_tags: ["wrong_tag_store", "wrong_tag_seller", "invalid_tag_status", "orphan_tag_content", "orphan_tag_creator", "orphan_tag_product", "wrong_content_owner", "invalid_sort_position", "content_b7f_bps_mismatch", "feed_tag_source_mismatch", "invalid_tag_content_type", "reel_tag_source_mismatch", "self_tagged_seller_product", "invalid_request_fingerprint", "content_b7f_creator_mismatch", "selected_entitlement_missing", "active_content_tag_over_limit", "content_item_snapshot_mismatch", "duplicate_active_sort_position", "duplicate_active_content_product", "content_attribution_source_mismatch", "content_settlement_creator_mismatch", "content_attribution_creator_mismatch", "content_attribution_product_mismatch", "attribution_created_after_tag_removal", "selected_entitlement_product_mismatch", "content_attribution_missing_source_tag", "selected_entitlement_creator_scope_mismatch"],
  creator_allocations: ["invalid_bps", "wrong_order", "wrong_store", "wrong_seller", "wrong_payment", "wrong_checkout", "wrong_currency", "missing_creator", "invalid_base_amount", "allocation_after_refund", "wrong_payment_allocation", "invalid_commission_amount", "allocation_after_settlement", "request_fingerprint_invalid", "creator_transaction_mismatch", "parent_creator_total_mismatch", "missing_creator_settlement_leg", "orphan_item_creator_allocation", "duplicate_order_item_allocation", "settlement_creator_total_mismatch", "unexpected_creator_settlement_leg", "creator_ledger_destination_mismatch", "settlement_creator_recipient_mismatch", "duplicate_creator_settlement_recipient", "legacy_multi_creator_identity_mismatch", "seller_platform_creator_gross_mismatch", "legacy_single_creator_identity_mismatch"],
  live_creator_commissions: ["missing_creator_leg", "duplicate_creator_leg", "unexpected_creator_leg", "allocation_split_mismatch", "source_allocation_mismatch", "creator_transaction_mismatch", "affiliate_commission_mismatch", "creator_credit_before_delivery", "own_product_commission_mismatch"],
  creator_analytics: ["creator_surface_invalid", "creator_order_count_orphan", "creator_event_product_mismatch", "creator_item_gmv_basis_mismatch", "creator_reversal_total_mismatch", "creator_settlement_total_mismatch", "creator_allocation_creator_mismatch", "creator_allocation_product_mismatch", "creator_generated_commission_mismatch", "creator_reversal_beneficiary_mismatch", "creator_settlement_beneficiary_mismatch", "creator_allocation_without_item_attribution", "creator_analytics_event_source_unresolvable", "creator_item_attribution_without_allocation", "creator_net_commission_negative_unexplained", "creator_reversal_leg_without_settlement_leg", "creator_settlement_leg_without_creator_allocation", "creator_source_entity_missing_currently_required_identity"],
  reversals: ["wrong_leg_type", "orphan_reversal", "wrong_beneficiary", "orphan_reversal_leg", "buyer_refund_missing", "order_state_mismatch", "wrong_source_account", "dispute_state_mismatch", "duplicate_buyer_refund", "payment_state_mismatch", "reversal_above_original", "wrong_escrow_destination", "allocation_state_mismatch", "creator_reversal_mismatch", "partial_reversal_leg_count", "wrong_original_transaction", "buyer_refund_amount_mismatch", "buyer_refund_account_mismatch", "reversed_total_gross_mismatch", "wrong_reversal_operation_type", "buyer_refund_operation_mismatch", "duplicate_original_leg_reversal", "unexpected_pre_release_reversal", "wrong_original_transaction_amount", "wrong_reversal_transaction_amount", "wrong_reversal_transaction_status", "wrong_original_transaction_currency", "wrong_reversal_transaction_accounts", "resolution_decision_without_reversal", "reversal_without_resolution_decision", "reversal_without_completed_settlement", "wrong_original_transaction_destination"],
  ads_finance: ["orphan_ads_events", "spend_reconciliation", "funding_reconciliation", "release_reconciliation", "unexpected_ads_entries", "orphan_ads_transactions", "release_wrong_recipient", "spend_escrow_difference", "spend_revenue_difference", "spend_unexpected_entries", "funding_escrow_difference", "funding_source_difference", "release_escrow_difference", "funding_unexpected_entries", "release_unexpected_entries", "escrow_liability_difference", "campaign_equation_mismatches", "event_transaction_mismatches", "campaign_accounting_mismatches", "release_destination_difference", "fund_transaction_event_count_difference", "spend_transaction_event_count_difference", "release_transaction_event_count_difference"],
  ads_eligibility: ["paused_eligible", "clock_mismatches", "unfunded_elapsed", "terminal_eligible"],
  ads_finalization: ["expired_unfinalized_liability", "finalization_record_mismatches", "final_spend_above_pacing_target", "completed_campaign_remaining_reserved"],
  ads_delivery: ["overspend", "bucket_duplicates", "target_violations", "orphan_materialization", "materialization_finance_mismatch"],
  ads_events: ["invalid_events", "duplicate_event_keys", "touch_event_mismatch", "purchase_gmv_mismatch", "campaign_product_mismatch", "purchase_event_link_mismatch", "purchase_without_order_attribution"],
  admin_operations: ["audit_orphan_actor", "audit_orphan_seller", "audit_orphan_dispute", "audit_orphan_product", "audit_invalid_fingerprint", "audit_action_target_mismatch", "audit_dispute_actor_mismatch", "audit_dispute_target_mismatch"],
} as const satisfies Record<HealthGroup, readonly string[]>;
const nonnegativeInt = (value: unknown, path: string) => {
  const parsed = int(value, path);
  return parsed >= 0 ? parsed : fail(path);
};
const exactHealthCounters = (value: unknown, group: HealthGroup, path: string) => {
  const counters = obj(value, path), expected = healthCounterKeys[group], actual = Object.keys(counters);
  if (actual.length !== expected.length || expected.some((key) => !(key in counters))) fail(path);
  return counters;
};
const validateIntegerHealthCounters = (value: unknown, group: Exclude<HealthGroup, "payments" | "settlements" | "ads_finance">, path: string) => {
  const counters = exactHealthCounters(value, group, path);
  healthCounterKeys[group].forEach((key) => nonnegativeInt(counters[key], `${path}.${key}`));
  return counters;
};
const validatePaymentsHealthCounters = (value: unknown, path: string) => {
  const counters = exactHealthCounters(value, "payments", path);
  healthCounterKeys.payments.filter((key) => !["escrow_shortfall", "confirmed_state_breakdown", "invalid_confirmed_state_details"].includes(key)).forEach((key) => nonnegativeInt(counters[key], `${path}.${key}`));
  if (num(counters.escrow_shortfall, `${path}.escrow_shortfall`) < 0) fail(`${path}.escrow_shortfall`);
  const breakdown = obj(counters.confirmed_state_breakdown, `${path}.confirmed_state_breakdown`), breakdownKeys = ["confirmed", "processing", "shipped", "delivered", "refunded_fixture", "refunded_dispute", "refunded_return", "invalid"] as const;
  if (Object.keys(breakdown).length !== breakdownKeys.length || breakdownKeys.some((key) => !(key in breakdown))) fail(`${path}.confirmed_state_breakdown`);
  breakdownKeys.forEach((key) => nonnegativeInt(breakdown[key], `${path}.confirmed_state_breakdown.${key}`));
  arr(counters.invalid_confirmed_state_details, `${path}.invalid_confirmed_state_details`).forEach((entry, index) => {
    const detailPath = `${path}.invalid_confirmed_state_details[${index}]`, detail = obj(entry, detailPath), keys = ["order_id", "checkout_status", "order_status", "payment_status", "allocation_status"] as const;
    if (Object.keys(detail).length !== keys.length || keys.some((key) => !(key in detail))) fail(detailPath);
    uuid(detail.order_id, `${detailPath}.order_id`);
    str(detail.checkout_status, `${detailPath}.checkout_status`);
    str(detail.order_status, `${detailPath}.order_status`);
    nullableStr(detail.payment_status, `${detailPath}.payment_status`);
    nullableStr(detail.allocation_status, `${detailPath}.allocation_status`);
  });
  return counters;
};
const validateSettlementsHealthCounters = (value: unknown, path: string) => {
  const counters = exactHealthCounters(value, "settlements", path), moneyKeys = ["escrow_expected_held_total", "escrow_actual_balance", "escrow_difference", "escrow_shortage", "escrow_surplus"] as const;
  healthCounterKeys.settlements.filter((key) => key !== "refunded_settlement_breakdown" && !moneyKeys.includes(key as (typeof moneyKeys)[number])).forEach((key) => nonnegativeInt(counters[key], `${path}.${key}`));
  moneyKeys.forEach((key) => num(counters[key], `${path}.${key}`));
  const breakdown = obj(counters.refunded_settlement_breakdown, `${path}.refunded_settlement_breakdown`), breakdownKeys = ["refunded_after_return", "refunded_after_dispute"] as const;
  if (Object.keys(breakdown).length !== breakdownKeys.length || breakdownKeys.some((key) => !(key in breakdown))) fail(`${path}.refunded_settlement_breakdown`);
  breakdownKeys.forEach((key) => nonnegativeInt(breakdown[key], `${path}.refunded_settlement_breakdown.${key}`));
  return counters;
};
const validateAdsFinanceHealthCounters = (value: unknown, path: string) => {
  const counters = exactHealthCounters(value, "ads_finance", path), decimalKeys = ["spend_reconciliation", "funding_reconciliation", "release_reconciliation", "spend_escrow_difference", "spend_revenue_difference", "funding_escrow_difference", "funding_source_difference", "release_escrow_difference", "release_destination_difference"] as const, signedIntegerKeys = ["fund_transaction_event_count_difference", "spend_transaction_event_count_difference", "release_transaction_event_count_difference"] as const;
  healthCounterKeys.ads_finance.forEach((key) => {
    const fieldPath = `${path}.${key}`;
    if (key === "escrow_liability_difference") {
      if (counters[key] !== null) num(counters[key], fieldPath);
    } else if (decimalKeys.includes(key as (typeof decimalKeys)[number])) num(counters[key], fieldPath);
    else if (signedIntegerKeys.includes(key as (typeof signedIntegerKeys)[number])) int(counters[key], fieldPath);
    else nonnegativeInt(counters[key], fieldPath);
  });
  return counters;
};
const validateHealthCounters = (value: unknown, group: HealthGroup, path: string) => {
  if (group === "payments") return validatePaymentsHealthCounters(value, path);
  if (group === "settlements") return validateSettlementsHealthCounters(value, path);
  if (group === "ads_finance") return validateAdsFinanceHealthCounters(value, path);
  return validateIntegerHealthCounters(value, group, path);
};
export function validateHealth(value: unknown) {
  const root = obj(value, "health");
  timestamp(root.checked_at, "checked_at");
  const overallHealthy = bool(root.healthy, "healthy");
  const groups = arr(root.groups, "groups");
  if (groups.length !== healthGroups.length) fail("groups.complete");
  const seen = new Set<HealthGroup>();
  groups.forEach((entry, index) => {
    const row = obj(entry, `groups[${index}]`);
    const name = enumValue(row.name, healthGroups, `groups[${index}].name`);
    if (seen.has(name)) fail(`groups[${index}].duplicate`);
    seen.add(name);
    const counters = validateHealthCounters(row.counters, name, `groups[${index}].counters`),
      checkCount = nonnegativeInt(row.check_count, `groups[${index}].check_count`),
      failing = nonnegativeInt(
        row.failing_check_count,
        `groups[${index}].failing_check_count`,
      ),
      healthy = bool(row.healthy, `groups[${index}].healthy`);
    if (checkCount !== Object.keys(counters).length || healthy !== (failing === 0))
      fail(`groups[${index}].classification`);
  });
  if (healthGroups.some((name) => !seen.has(name))) fail("groups.complete");
  if (overallHealthy !== groups.every((entry, index) =>
    bool(obj(entry, `groups[${index}]`).healthy, `groups[${index}].healthy`)))
    fail("health.classification");
  arr(root.attention, "attention").forEach((entry, index) => {
    const row = obj(entry, `attention[${index}]`);
    for (const key of [
      "reason_code",
      "entity_type",
      "message",
    ] as const)
      str(row[key], `attention[${index}].${key}`);
    enumValue(
      row.severity,
      ["warning", "critical"] as const,
      `attention[${index}].severity`,
    );
    uuid(row.entity_id, `attention[${index}].entity_id`);
  });
  return root;
}
export async function getHealth() {
  return validateHealth(await rpc("get_marketplace_admin_health"));
}

export function validateActivityPage(value: unknown) {
  const root = obj(value, "activity_page");
  const items = arr(root.activity, "activity").map((entry, index) => {
    const row = obj(entry, `activity[${index}]`);
    for (const key of ["id", "actor_id", "target_id"] as const)
      uuid(row[key], `activity[${index}].${key}`);
    nullableStr(row.actor_username, `activity[${index}].actor_username`);
    nullableStr(
      row.actor_display_name,
      `activity[${index}].actor_display_name`,
    );
    str(row.action, `activity[${index}].action`);
    str(row.target_type, `activity[${index}].target_type`);
    nullableStr(row.reason_code, `activity[${index}].reason_code`);
    metadata(row.metadata, `activity[${index}].metadata`);
    timestamp(row.created_at, `activity[${index}].created_at`);
    return row;
  });
  return {
    items,
    nextCursor: validateCursor(root.next_cursor, "next_cursor"),
    pageSize: int(root.page_size, "page_size"),
  };
}
export async function searchActivity(input: {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  cursor?: IntelligenceCursor;
  limit?: number;
}) {
  return validateActivityPage(
    await rpc("search_marketplace_admin_activity", {
      p_actor_id: input.actorId || null,
      p_action: input.action || null,
      p_target_type: input.targetType || null,
      p_target_id: input.targetId || null,
      p_cursor_created_at: input.cursor?.created_at || null,
      p_cursor_id: input.cursor?.id || null,
      p_limit: input.limit ?? 50,
    }),
  );
}

export const safeText = (value: unknown) =>
  typeof value === "string" ? value : "—";
export const safeNumber = (value: unknown) =>
  typeof value === "number" || typeof value === "string" ? String(value) : "0";
export const optionalMoney = (value: unknown) =>
  value === null ? null : nullableMoney(value, "money");
