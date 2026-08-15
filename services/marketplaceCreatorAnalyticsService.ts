import { getSupabaseClient } from "@/template";
import {rpcArray,rpcEnum,rpcFinite,rpcNonnegative,rpcNonnegativeInteger,rpcNullableString,
  rpcObject,rpcString,rpcTimestamp,rpcUuid} from "@/services/marketplaceRuntimeValidation";

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
const ranges=["7d","30d","90d","all"]as const;
const surfaces=["creator_showcase","feed","reel","direct_creator_link","live"]as const;
const summary=(value:unknown,path:string):MarketplaceCreatorAnalyticsSummary=>{
 const row=rpcObject(value,path);return{
  product_opens:rpcNonnegativeInteger(row.product_opens,`${path}.product_opens`),add_to_cart:rpcNonnegativeInteger(row.add_to_cart,`${path}.add_to_cart`),
  attributed_orders:rpcNonnegativeInteger(row.attributed_orders,`${path}.attributed_orders`),units_sold:rpcNonnegativeInteger(row.units_sold,`${path}.units_sold`),
  attributed_gmv:rpcNonnegative(row.attributed_gmv,`${path}.attributed_gmv`),commission_generated:rpcNonnegative(row.commission_generated,`${path}.commission_generated`),
  commission_released:rpcNonnegative(row.commission_released,`${path}.commission_released`),commission_reversed:rpcNonnegative(row.commission_reversed,`${path}.commission_reversed`),
  commission_net:rpcFinite(row.commission_net,`${path}.commission_net`)};
};
export const parseMarketplaceCreatorAnalytics=(value:unknown):MarketplaceCreatorAnalytics=>{
 const root=rpcObject(value,'creator_analytics');
 const metric=(row:Record<string,unknown>,path:string)=>({product_opens:rpcNonnegativeInteger(row.product_opens,`${path}.product_opens`),add_to_cart:rpcNonnegativeInteger(row.add_to_cart,`${path}.add_to_cart`),units_sold:rpcNonnegativeInteger(row.units_sold,`${path}.units_sold`),attributed_gmv:rpcNonnegative(row.attributed_gmv,`${path}.attributed_gmv`),commission_generated:rpcNonnegative(row.commission_generated,`${path}.commission_generated`),commission_released:rpcNonnegative(row.commission_released,`${path}.commission_released`),commission_reversed:rpcNonnegative(row.commission_reversed,`${path}.commission_reversed`),commission_net:rpcFinite(row.commission_net,`${path}.commission_net`)});
 return{range:rpcEnum(root.range,ranges,'creator_analytics.range'),generated_at:rpcTimestamp(root.generated_at,'creator_analytics.generated_at'),timezone:rpcEnum(root.timezone,["UTC"]as const,'creator_analytics.timezone'),summary:summary(root.summary,'creator_analytics.summary'),
  surface_breakdown:rpcArray(root.surface_breakdown,'creator_analytics.surface_breakdown').map((value,index)=>{const path=`creator_analytics.surface_breakdown[${index}]`,row=rpcObject(value,path);return{source_surface:rpcEnum(row.source_surface,surfaces,`${path}.source_surface`),orders:rpcNonnegativeInteger(row.orders,`${path}.orders`),...metric(row,path)}}),
  top_products:rpcArray(root.top_products,'creator_analytics.top_products').map((value,index)=>{const path=`creator_analytics.top_products[${index}]`,row=rpcObject(value,path);return{product_id:rpcUuid(row.product_id,`${path}.product_id`),title:rpcString(row.title,`${path}.title`),image_url:rpcNullableString(row.image_url,`${path}.image_url`),orders:rpcNonnegativeInteger(row.orders,`${path}.orders`),...metric(row,path)}}),
  trend:rpcArray(root.trend,'creator_analytics.trend').map((value,index)=>{const path=`creator_analytics.trend[${index}]`,row=rpcObject(value,path);return{bucket:rpcString(row.bucket,`${path}.bucket`),orders:rpcNonnegativeInteger(row.orders,`${path}.orders`),attributed_gmv:rpcNonnegative(row.attributed_gmv,`${path}.attributed_gmv`),commission_generated:rpcNonnegative(row.commission_generated,`${path}.commission_generated`),commission_released:rpcNonnegative(row.commission_released,`${path}.commission_released`),commission_reversed:rpcNonnegative(row.commission_reversed,`${path}.commission_reversed`),commission_net:rpcFinite(row.commission_net,`${path}.commission_net`)}})};
};

export async function fetchMyMarketplaceCreatorCommerceAnalytics(range: MarketplaceCreatorAnalyticsRange): Promise<MarketplaceCreatorAnalytics> {
  const { data, error } = await getSupabaseClient().rpc("get_my_marketplace_creator_commerce_analytics", { p_range: range });
  if (error) throw error;
  return parseMarketplaceCreatorAnalytics(data);
}
