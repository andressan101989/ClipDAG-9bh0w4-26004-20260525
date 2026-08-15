import { randomUUID } from "expo-crypto";
import { getSupabaseClient } from "@/template";
import {
  marketplaceAnalyticsAppliedQuantity,
  marketplaceCheckoutAnalyticsTargets,
  parseMarketplaceAnalyticsSource,
} from "./marketplaceAnalyticsCore.mjs";
import {
  rpcArray,
  rpcEnum,
  rpcFinite,
  rpcNonnegative,
  rpcNonnegativeInteger,
  rpcNullableString,
  rpcObject,
  rpcString,
  rpcTimestamp,
  rpcUuid,
} from "./marketplaceRuntimeValidation";

export type MarketplaceAnalyticsSourceType =
  | "direct"
  | "shop"
  | "search"
  | "feed"
  | "clip"
  | "live"
  | "creator"
  | "affiliate"
  | "unknown";
export interface MarketplaceCommerceSource {
  type: MarketplaceAnalyticsSourceType;
  entityId: string | null;
  creatorId: string | null;
  liveSessionId: string | null;
}
export interface MarketplaceSellerSummary {
  product_views: number;
  unique_viewer_sessions: number;
  add_to_cart_events: number;
  checkout_started: number;
  orders: number;
  purchase_items: number;
  units_sold: number;
  gross_merchandise_bdag: number;
  view_to_cart_event_rate: number;
  view_to_purchase_event_rate: number;
}
export interface MarketplaceProductAnalyticsRow {
  product_id: string;
  title: string | null;
  views: number;
  add_to_cart: number;
  purchase_orders: number;
  purchase_items: number;
  units_sold: number;
  gmv_bdag: number;
  view_to_cart_event_rate: number;
  view_to_purchase_event_rate: number;
}
export interface MarketplaceDailyAnalyticsRow {
  event_day: string;
  views: number;
  add_to_cart: number;
  orders: number;
  purchase_items: number;
  units_sold: number;
  gmv_bdag: number;
}
export interface MarketplaceSourceAnalyticsRow {
  source_type: MarketplaceAnalyticsSourceType;
  views: number;
  add_to_cart: number;
  orders: number;
  purchase_items: number;
  units_sold: number;
  gmv_bdag: number;
}
export interface MarketplaceVariantAnalyticsRow {
  product_id: string;
  variant_id: string;
  product_title: string | null;
  sku: string | null;
  selections: number;
  add_to_cart: number;
  purchase_orders: number;
  purchase_items: number;
  units_sold: number;
  gmv_bdag: number;
}
export interface MarketplaceSellerAnalytics {
  date_from: string;
  date_to: string;
  timezone: "UTC";
  summary: MarketplaceSellerSummary;
  products: MarketplaceProductAnalyticsRow[];
  daily: MarketplaceDailyAnalyticsRow[];
  sources: MarketplaceSourceAnalyticsRow[];
}
type RecordInput = {
  eventName:
    | "product_view"
    | "product_media_view"
    | "variant_selected"
    | "add_to_cart"
    | "checkout_started";
  productId: string;
  variantId?: string | null;
  quantity?: number | null;
  source?: MarketplaceCommerceSource;
  metadata?: Record<string, number | string | boolean>;
  idempotencyKey?: string;
};
const clientSessionId = randomUUID();
const db = () => getSupabaseClient();

export const marketplaceCommerceSessionId = () => clientSessionId;
export const marketplaceCommerceEventKey = (prefix: string) =>
  `${prefix}:${randomUUID()}`;
export const marketplaceSourceFromParams = (params: {
  source?: string;
  sourceId?: string;
  creatorId?: string;
  liveSessionId?: string;
}): MarketplaceCommerceSource =>
  parseMarketplaceAnalyticsSource({
    type: params.source === "reel" ? "clip" : params.source,
    entityId: params.sourceId,
    creatorId: params.creatorId,
    liveSessionId: params.liveSessionId,
  });

async function record(input: RecordInput) {
  const source = input.source ?? {
    type: "unknown" as const,
    entityId: null,
    creatorId: null,
    liveSessionId: null,
  };
  if (__DEV__)
    console.info("[MarketplaceAnalytics]", {
      operation: "event_record_start",
      event: input.eventName,
      productIdPresent: Boolean(input.productId),
      sourceType: source.type,
    });
  try {
    const { error } = await db().rpc("record_marketplace_commerce_event", {
      p_event_name: input.eventName,
      p_product_id: input.productId,
      p_variant_id: input.variantId ?? null,
      p_client_session_id: clientSessionId,
      p_source_type: source.type,
      p_source_entity_id: source.entityId,
      p_source_creator_id: source.creatorId,
      p_source_live_session_id: source.liveSessionId,
      p_quantity: input.quantity ?? null,
      p_metadata: input.metadata ?? {},
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error) throw error;
    if (__DEV__)
      console.info("[MarketplaceAnalytics]", {
        operation: "event_record_success",
        event: input.eventName,
      });
    return true;
  } catch(error) {
    if (__DEV__)
      console.info("[MarketplaceAnalytics]", {
        operation: "event_record_failed",
        event: input.eventName,
        code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "unknown",
      });
    return false;
  }
}

export const recordProductView = (input: Omit<RecordInput, "eventName">) =>
  record({ ...input, eventName: "product_view" });
export const recordProductMediaView = (input: Omit<RecordInput, "eventName">) =>
  record({ ...input, eventName: "product_media_view" });
export const recordVariantSelected = (input: Omit<RecordInput, "eventName">) =>
  record({ ...input, eventName: "variant_selected" });
export const recordAddToCart = (input: Omit<RecordInput, "eventName">) =>
  record({ ...input, eventName: "add_to_cart" });
export const recordCheckoutStarted = (input: Omit<RecordInput, "eventName">) =>
  record({ ...input, eventName: "checkout_started" });

export async function fetchMyMarketplaceCommerceAnalytics(
  dateFrom: string,
  dateTo: string,
): Promise<MarketplaceSellerAnalytics> {
  if (__DEV__)
    console.info("[MarketplaceAnalytics]", {
      operation: "seller_summary_load",
    });
  const { data, error } = await db().rpc(
    "get_my_marketplace_commerce_analytics",
    { p_date_from: dateFrom, p_date_to: dateTo },
  );
  if (error) {
    if (__DEV__)
      console.info("[MarketplaceAnalytics]", {
        operation: "seller_summary_failed",
        code: error.code,
      });
    throw error;
  }
  return parseMarketplaceSellerAnalytics(data);
}
export async function fetchMyMarketplaceVariantAnalytics(
  dateFrom: string,
  dateTo: string,
): Promise<MarketplaceVariantAnalyticsRow[]> {
  const { data, error } = await db().rpc(
    "get_my_marketplace_variant_analytics",
    { p_date_from: dateFrom, p_date_to: dateTo },
  );
  if (error) throw error;
  return parseMarketplaceVariantAnalytics(data);
}

const sources = [
    "direct",
    "shop",
    "search",
    "feed",
    "clip",
    "live",
    "creator",
    "affiliate",
    "unknown",
  ] as const,
  date = (value: unknown, path: string) => {
    const text = rpcString(value, path);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
      throw new Error(`marketplace_payload_invalid:${path}`);
    return text;
  };
const counts = (row: Record<string, unknown>, path: string) => ({
  views: rpcNonnegativeInteger(row.views, `${path}.views`),
  add_to_cart: rpcNonnegativeInteger(row.add_to_cart, `${path}.add_to_cart`),
  orders: rpcNonnegativeInteger(row.orders, `${path}.orders`),
  purchase_items: rpcNonnegativeInteger(
    row.purchase_items,
    `${path}.purchase_items`,
  ),
  units_sold: rpcNonnegativeInteger(row.units_sold, `${path}.units_sold`),
  gmv_bdag: rpcNonnegative(row.gmv_bdag, `${path}.gmv_bdag`),
});
export function parseMarketplaceSellerAnalytics(
  value: unknown,
): MarketplaceSellerAnalytics {
  const root = rpcObject(value, "seller_analytics"),
    summary = rpcObject(root.summary, "seller_analytics.summary"),
    productRows = rpcArray(root.products, "seller_analytics.products"),
    dailyRows = rpcArray(root.daily, "seller_analytics.daily"),
    sourceRows = rpcArray(root.sources, "seller_analytics.sources");
  return {
    date_from: rpcTimestamp(root.date_from, "seller_analytics.date_from"),
    date_to: rpcTimestamp(root.date_to, "seller_analytics.date_to"),
    timezone: rpcEnum(
      root.timezone,
      ["UTC"] as const,
      "seller_analytics.timezone",
    ),
    summary: {
      product_views: rpcNonnegativeInteger(
        summary.product_views,
        "seller_analytics.summary.product_views",
      ),
      unique_viewer_sessions: rpcNonnegativeInteger(
        summary.unique_viewer_sessions,
        "seller_analytics.summary.unique_viewer_sessions",
      ),
      add_to_cart_events: rpcNonnegativeInteger(
        summary.add_to_cart_events,
        "seller_analytics.summary.add_to_cart_events",
      ),
      checkout_started: rpcNonnegativeInteger(
        summary.checkout_started,
        "seller_analytics.summary.checkout_started",
      ),
      orders: rpcNonnegativeInteger(
        summary.orders,
        "seller_analytics.summary.orders",
      ),
      purchase_items: rpcNonnegativeInteger(
        summary.purchase_items,
        "seller_analytics.summary.purchase_items",
      ),
      units_sold: rpcNonnegativeInteger(
        summary.units_sold,
        "seller_analytics.summary.units_sold",
      ),
      gross_merchandise_bdag: rpcNonnegative(
        summary.gross_merchandise_bdag,
        "seller_analytics.summary.gross_merchandise_bdag",
      ),
      view_to_cart_event_rate: rpcFinite(
        summary.view_to_cart_event_rate,
        "seller_analytics.summary.view_to_cart_event_rate",
      ),
      view_to_purchase_event_rate: rpcFinite(
        summary.view_to_purchase_event_rate,
        "seller_analytics.summary.view_to_purchase_event_rate",
      ),
    },
    products: productRows.map((raw, index) => {
      const path = `seller_analytics.products[${index}]`,
        row = rpcObject(raw, path);
      return {
        product_id: rpcUuid(row.product_id, `${path}.product_id`),
        title: rpcNullableString(row.title, `${path}.title`),
        views: rpcNonnegativeInteger(row.views, `${path}.views`),
        add_to_cart: rpcNonnegativeInteger(
          row.add_to_cart,
          `${path}.add_to_cart`,
        ),
        purchase_orders: rpcNonnegativeInteger(
          row.purchase_orders,
          `${path}.purchase_orders`,
        ),
        purchase_items: rpcNonnegativeInteger(
          row.purchase_items,
          `${path}.purchase_items`,
        ),
        units_sold: rpcNonnegativeInteger(row.units_sold, `${path}.units_sold`),
        gmv_bdag: rpcNonnegative(row.gmv_bdag, `${path}.gmv_bdag`),
        view_to_cart_event_rate: rpcFinite(
          row.view_to_cart_event_rate,
          `${path}.view_to_cart_event_rate`,
        ),
        view_to_purchase_event_rate: rpcFinite(
          row.view_to_purchase_event_rate,
          `${path}.view_to_purchase_event_rate`,
        ),
      };
    }),
    daily: dailyRows.map((raw, index) => {
      const path = `seller_analytics.daily[${index}]`,
        row = rpcObject(raw, path);
      return {
        event_day: date(row.event_day, `${path}.event_day`),
        ...counts(row, path),
      };
    }),
    sources: sourceRows.map((raw, index) => {
      const path = `seller_analytics.sources[${index}]`,
        row = rpcObject(raw, path);
      return {
        source_type: rpcEnum(row.source_type, sources, `${path}.source_type`),
        ...counts(row, path),
      };
    }),
  };
}
export function parseMarketplaceVariantAnalytics(
  value: unknown,
): MarketplaceVariantAnalyticsRow[] {
  return rpcArray(value, "variant_analytics").map((raw, index) => {
    const path = `variant_analytics[${index}]`,
      row = rpcObject(raw, path);
    return {
      product_id: rpcUuid(row.product_id, `${path}.product_id`),
      variant_id: rpcUuid(row.variant_id, `${path}.variant_id`),
      product_title: rpcNullableString(
        row.product_title,
        `${path}.product_title`,
      ),
      sku: rpcNullableString(row.sku, `${path}.sku`),
      selections: rpcNonnegativeInteger(row.selections, `${path}.selections`),
      add_to_cart: rpcNonnegativeInteger(
        row.add_to_cart,
        `${path}.add_to_cart`,
      ),
      purchase_orders: rpcNonnegativeInteger(
        row.purchase_orders,
        `${path}.purchase_orders`,
      ),
      purchase_items: rpcNonnegativeInteger(
        row.purchase_items,
        `${path}.purchase_items`,
      ),
      units_sold: rpcNonnegativeInteger(row.units_sold, `${path}.units_sold`),
      gmv_bdag: rpcNonnegative(row.gmv_bdag, `${path}.gmv_bdag`),
    };
  });
}

export {
  marketplaceAnalyticsAppliedQuantity,
  marketplaceCheckoutAnalyticsTargets,
  parseMarketplaceAnalyticsSource,
};
