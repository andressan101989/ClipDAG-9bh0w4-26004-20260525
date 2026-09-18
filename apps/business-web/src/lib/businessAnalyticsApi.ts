import { supabase, type BusinessSupabaseClient } from "./supabase";

export const ANALYTICS_RANGES = ["7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const ANALYTICS_SOURCES = ["shop", "search", "feed", "clip", "live", "creator", "affiliate", "direct", "unknown"] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

type Row = Record<string, unknown>;
type MetricSummary = {
  gmvBdag: string;
  orders: number;
  units: number;
  productViews: number;
  cartAdds: number;
  refundedBdag: string;
};
type Comparisons = {
  gmvPercent: string | null;
  ordersPercent: string | null;
  unitsPercent: string | null;
  productViewsPercent: string | null;
};
export type AnalyticsDailyPoint = {
  day: string;
  gmvBdag: string;
  orders: number;
  units: number;
  productViews: number;
};
export type ProductAnalytics = {
  productId: string | null;
  title: string;
  imageUrl: string | null;
  views: number;
  units: number;
  orders: number;
  gmvBdag: string;
};
export type VariantAnalytics = {
  variantId: string | null;
  productId: string | null;
  label: string;
  views: number;
  units: number;
  orders: number;
  gmvBdag: string;
};
export type SourceAnalytics = {
  source: AnalyticsSource;
  views: number;
  cartAdds: number;
  orders: number;
  units: number;
  gmvBdag: string;
};
export type AdsAnalytics = {
  activeCampaigns: number;
  impressions: number;
  clicks: number;
  spentBdag: string;
  attributedOrders: number;
  attributedGmvBdag: string;
  roas: string | null;
};
export type FinanceAnalytics = {
  bdagBalance: string;
  settledOrders: number;
  sellerNetBdag: string;
};
export type PayoutAnalytics = {
  pendingCount: number;
  broadcastingCount: number;
  completedCount: number;
  completedBdag: string;
};
export type AnalyticsSection<T> = { authorized: false; data: null } | { authorized: true; data: T };

export type BusinessAnalytics = {
  businessOwnerId: string;
  range: AnalyticsRange;
  timezone: "UTC";
  generatedAt: string;
  window: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
  commerce: {
    current: MetricSummary;
    previous: MetricSummary;
    comparisons: Comparisons;
    daily: AnalyticsDailyPoint[];
    products: { items: ProductAnalytics[]; totalCount: number };
    variants: { items: VariantAnalytics[]; totalCount: number };
    sources: SourceAnalytics[];
  };
  ads: AnalyticsSection<AdsAnalytics>;
  finance: AnalyticsSection<FinanceAnalytics>;
  payouts: AnalyticsSection<PayoutAnalytics>;
};

function record(value: unknown, code = "business_analytics_response_invalid"): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("business_analytics_response_invalid");
  return value;
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("business_analytics_response_invalid");
  return value;
}
function nullableString(value: unknown): string | null {
  if (value == null) return null;
  return requiredString(value);
}
function money(value: unknown): string {
  const parsed = requiredString(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(parsed)) throw new Error("business_analytics_response_invalid");
  return parsed;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("business_analytics_response_invalid");
  return value;
}
function comparison(value: unknown): string | null {
  return value == null ? null : money(value);
}
function parseSummary(value: unknown): MetricSummary {
  const row = record(value);
  return {
    gmvBdag: money(row.gmv_bdag), orders: count(row.orders), units: count(row.units),
    productViews: count(row.product_views), cartAdds: count(row.cart_adds), refundedBdag: money(row.refunded_bdag),
  };
}
function parseSection<T>(value: unknown, parser: (data: unknown) => T): AnalyticsSection<T> {
  const row = record(value, "business_analytics_section_invalid");
  if (row.authorized === false && row.data === null) return { authorized: false, data: null };
  if (row.authorized === true && row.data != null) return { authorized: true, data: parser(row.data) };
  throw new Error("business_analytics_section_invalid");
}

export function parseBusinessAnalytics(value: unknown): BusinessAnalytics {
  const root = record(value);
  const range = requiredString(root.range);
  if (!ANALYTICS_RANGES.includes(range as AnalyticsRange)) throw new Error("business_analytics_range_invalid");
  if (root.timezone !== "UTC") throw new Error("business_analytics_timezone_invalid");
  const window = record(root.window);
  const commerce = record(root.commerce);
  const comparisons = record(commerce.comparisons);
  const products = record(commerce.products);
  const variants = record(commerce.variants);
  return {
    businessOwnerId: requiredString(root.business_owner_id),
    range: range as AnalyticsRange,
    timezone: "UTC",
    generatedAt: requiredString(root.generated_at),
    window: {
      currentStart: requiredString(window.current_start), currentEnd: requiredString(window.current_end),
      previousStart: requiredString(window.previous_start), previousEnd: requiredString(window.previous_end),
    },
    commerce: {
      current: parseSummary(commerce.current),
      previous: parseSummary(commerce.previous),
      comparisons: {
        gmvPercent: comparison(comparisons.gmv_percent), ordersPercent: comparison(comparisons.orders_percent),
        unitsPercent: comparison(comparisons.units_percent), productViewsPercent: comparison(comparisons.product_views_percent),
      },
      daily: list(commerce.daily).map((value) => {
        const row = record(value);
        return { day: requiredString(row.day), gmvBdag: money(row.gmv_bdag), orders: count(row.orders), units: count(row.units), productViews: count(row.product_views) };
      }),
      products: {
        totalCount: count(products.total_count),
        items: list(products.items).map((value) => {
          const row = record(value);
          return { productId: nullableString(row.product_id), title: requiredString(row.title), imageUrl: nullableString(row.image_url), views: count(row.views), units: count(row.units), orders: count(row.orders), gmvBdag: money(row.gmv_bdag) };
        }),
      },
      variants: {
        totalCount: count(variants.total_count),
        items: list(variants.items).map((value) => {
          const row = record(value);
          return { variantId: nullableString(row.variant_id), productId: nullableString(row.product_id), label: requiredString(row.label), views: count(row.views), units: count(row.units), orders: count(row.orders), gmvBdag: money(row.gmv_bdag) };
        }),
      },
      sources: list(commerce.sources).map((value) => {
        const row = record(value);
        const source = requiredString(row.source);
        if (!ANALYTICS_SOURCES.includes(source as AnalyticsSource)) throw new Error("business_analytics_source_invalid");
        return { source: source as AnalyticsSource, views: count(row.views), cartAdds: count(row.cart_adds), orders: count(row.orders), units: count(row.units), gmvBdag: money(row.gmv_bdag) };
      }),
    },
    ads: parseSection(root.ads, (value) => {
      const row = record(value);
      return { activeCampaigns: count(row.active_campaigns), impressions: count(row.impressions), clicks: count(row.clicks), spentBdag: money(row.spent_bdag), attributedOrders: count(row.attributed_orders), attributedGmvBdag: money(row.attributed_gmv_bdag), roas: comparison(row.roas) };
    }),
    finance: parseSection(root.finance, (value) => {
      const row = record(value);
      return { bdagBalance: money(row.bdag_balance), settledOrders: count(row.settled_orders), sellerNetBdag: money(row.seller_net_bdag) };
    }),
    payouts: parseSection(root.payouts, (value) => {
      const row = record(value);
      return { pendingCount: count(row.pending_count), broadcastingCount: count(row.broadcasting_count), completedCount: count(row.completed_count), completedBdag: money(row.completed_bdag) };
    }),
  };
}

export async function getBusinessAnalytics(
  businessOwnerId: string,
  range: AnalyticsRange,
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessAnalytics> {
  const { data, error } = await client.rpc("get_my_business_analytics", { p_business_owner_id: businessOwnerId, p_range: range });
  if (error) throw new Error(error.message || "No se pudo cargar Analytics");
  return parseBusinessAnalytics(data);
}
