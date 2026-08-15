import { supabase } from "./supabase";
import type { AdminRange, Money } from "./adminApi";

export type IntelligenceCursor = { created_at: string; id: string };
export type CreatorCursor = { last_sale: string; creator_id: string };
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

const validateCreatorSummary = (value: unknown, path: string) => {
  const row = obj(value, path);
  for (const key of [
    "active_creators",
    "attributed_orders",
    "orders",
    "units",
    "product_opens",
    "add_to_cart",
  ]) {
    if (key in row) int(row[key], `${path}.${key}`);
  }
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
  str(row.source_surface, `${path}.source_surface`);
  for (const key of ["orders", "units"] as const)
    int(row[key], `${path}.${key}`);
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
  validateCreatorSummary(root.summary, "summary");
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
  str(row.top_surface, `${path}.top_surface`);
  timestamp(row.last_sale, `${path}.last_sale`);
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
      last_sale: timestamp(cursor.last_sale, "next_cursor.last_sale"),
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
    await rpc("search_marketplace_admin_creators", {
      p_query: input.query || null,
      p_range: input.range,
      p_cursor_last_sale: input.cursor?.last_sale || null,
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
  validateCreatorSummary(root.summary, "summary");
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
    str(row.source_surface, `item_trace[${index}].source_surface`);
    str(row.product_title, `item_trace[${index}].product_title`);
    int(row.quantity, `item_trace[${index}].quantity`);
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

const validatePromotion = (value: unknown, path: string) => {
  const row = obj(value, path);
  for (const key of ["id", "seller_id", "store_id", "product_id"] as const)
    uuid(row[key], `${path}.${key}`);
  nullableUuid(row.variant_id, `${path}.variant_id`);
  for (const key of [
    "seller_name",
    "store_name",
    "product_title",
    "promotion_type",
    "state",
  ] as const)
    str(row[key], `${path}.${key}`);
  nullableStr(row.variant_title, `${path}.variant_title`);
  money(row.configured_value, `${path}.configured_value`);
  timestamp(row.starts_at, `${path}.starts_at`);
  timestamp(row.ends_at, `${path}.ends_at`);
  timestamp(row.created_at, `${path}.created_at`);
  int(row.historical_orders, `${path}.historical_orders`);
  int(row.historical_units, `${path}.historical_units`);
  if (row.current_price !== null) {
    const price = obj(row.current_price, `${path}.current_price`);
    money(price.base_price, `${path}.current_price.base_price`);
    money(price.effective_price, `${path}.current_price.effective_price`);
    money(price.discount_amount, `${path}.current_price.discount_amount`);
  }
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
  str(promotion.promotion_type, "promotion.promotion_type");
  str(promotion.status, "promotion.status");
  timestamp(promotion.starts_at, "promotion.starts_at");
  timestamp(promotion.ends_at, "promotion.ends_at");
  timestamp(promotion.created_at, "promotion.created_at");
  const seller = obj(root.seller, "seller"),
    store = obj(root.store, "store"),
    product = obj(root.product, "product");
  uuid(seller.id, "seller.id");
  uuid(store.id, "store.id");
  uuid(product.id, "product.id");
  str(store.name, "store.name");
  str(product.title, "product.title");
  if (root.current_price !== null) {
    const price = obj(root.current_price, "current_price");
    money(price.base_price, "current_price.base_price");
    money(price.effective_price, "current_price.effective_price");
  }
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
  for (const key of [
    "seller_name",
    "store_name",
    "product_title",
    "status",
  ] as const)
    str(row[key], `${path}.${key}`);
  bool(row.eligibility_state, `${path}.eligibility_state`);
  nullableStr(row.eligibility_reason, `${path}.eligibility_reason`);
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
  str(campaign.status, "campaign.status");
  timestamp(campaign.starts_at, "campaign.starts_at");
  timestamp(campaign.ends_at, "campaign.ends_at");
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
    str(row.event_type, `financial_events[${index}].event_type`);
    money(row.amount, `financial_events[${index}].amount`);
    uuid(
      row.financial_transaction_id,
      `financial_events[${index}].financial_transaction_id`,
    );
    timestamp(row.created_at, `financial_events[${index}].created_at`);
  });
  if (root.finalization !== null) {
    const final = obj(root.finalization, "finalization");
    for (const key of [
      "final_target_bdag",
      "spent_before_bdag",
      "final_spend_delta_bdag",
      "released_bdag",
    ] as const)
      money(final[key], `finalization.${key}`);
    timestamp(final.finalized_at, "finalization.finalized_at");
  }
  const events = obj(root.events, "events");
  Object.entries(events).forEach(([key, value]) => int(value, `events.${key}`));
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

export function validateHealth(value: unknown) {
  const root = obj(value, "health");
  timestamp(root.checked_at, "checked_at");
  bool(root.healthy, "healthy");
  arr(root.groups, "groups").forEach((entry, index) => {
    const row = obj(entry, `groups[${index}]`);
    str(row.name, `groups[${index}].name`);
    int(row.check_count, `groups[${index}].check_count`);
    int(row.failing_check_count, `groups[${index}].failing_check_count`);
    metadata(row.counters, `groups[${index}].counters`);
    bool(row.healthy, `groups[${index}].healthy`);
  });
  arr(root.attention, "attention").forEach((entry, index) => {
    const row = obj(entry, `attention[${index}]`);
    for (const key of [
      "reason_code",
      "entity_type",
      "severity",
      "message",
    ] as const)
      str(row[key], `attention[${index}].${key}`);
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
