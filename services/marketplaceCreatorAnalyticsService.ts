import { getSupabaseClient } from "@/template";

export type MarketplaceCreatorAnalyticsRange = "7d" | "30d" | "90d" | "all";
export type MarketplaceCreatorAnalyticsSurface = "creator_showcase" | "feed" | "reel" | "direct_creator_link" | "live";

export interface MarketplaceCreatorAnalyticsSummary {
  product_opens: number;
  add_to_cart: number;
  attributed_orders: number;
  units_sold: number;
  attributed_gmv: number;
  commission_generated: number;
  commission_released: number;
  commission_reversed: number;
  commission_net: number;
}

export interface MarketplaceCreatorAnalyticsSurfaceRow extends Omit<MarketplaceCreatorAnalyticsSummary, "attributed_orders"> {
  source_surface: MarketplaceCreatorAnalyticsSurface;
  orders: number;
}

export interface MarketplaceCreatorAnalyticsProductRow {
  product_id: string;
  title: string;
  image_url: string | null;
  product_opens: number;
  add_to_cart: number;
  orders: number;
  units_sold: number;
  attributed_gmv: number;
  commission_generated: number;
  commission_released: number;
  commission_reversed: number;
  commission_net: number;
}

export interface MarketplaceCreatorAnalyticsTrendRow {
  bucket: string;
  orders: number;
  attributed_gmv: number;
  commission_generated: number;
  commission_released: number;
  commission_reversed: number;
  commission_net: number;
}

export interface MarketplaceCreatorAnalytics {
  range: MarketplaceCreatorAnalyticsRange;
  generated_at: string;
  timezone: "UTC";
  summary: MarketplaceCreatorAnalyticsSummary;
  surface_breakdown: MarketplaceCreatorAnalyticsSurfaceRow[];
  top_products: MarketplaceCreatorAnalyticsProductRow[];
  trend: MarketplaceCreatorAnalyticsTrendRow[];
}

export const marketplaceCreatorAnalyticsSurfaceLabel = (surface: MarketplaceCreatorAnalyticsSurface) => ({
  creator_showcase: "Showcase",
  feed: "Feed",
  reel: "Reels",
  direct_creator_link: "Enlace",
  live: "LIVE",
})[surface];

export async function fetchMyMarketplaceCreatorCommerceAnalytics(range: MarketplaceCreatorAnalyticsRange): Promise<MarketplaceCreatorAnalytics> {
  const { data, error } = await getSupabaseClient().rpc("get_my_marketplace_creator_commerce_analytics", { p_range: range });
  if (error) throw error;
  return data as MarketplaceCreatorAnalytics;
}
