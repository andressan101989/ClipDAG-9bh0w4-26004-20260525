import { randomUUID } from "expo-crypto";
import { getSupabaseClient } from "@/template";
import { marketplaceCommerceSessionId } from "./marketplaceAnalyticsService";
import {rpcArray,rpcBoolean,rpcEnum,rpcNonnegative,rpcNonnegativeInteger,
  rpcNullableString,rpcNullableUuid,rpcObject,rpcString,rpcStringArray,
  rpcTimestamp,rpcUuid} from "./marketplaceRuntimeValidation";
const db = () => getSupabaseClient();
export type AdEventType =
  | "impression"
  | "click"
  | "product_view"
  | "add_to_cart";
export interface SponsoredProduct {
  campaign_id: string;
  product_id: string;
  title: string;
  images: string[];
  seller: { username: string; display_name: string | null };
  price: number;
  base_price: number;
  promotion_id: string | null;
  sponsored: true;
  label: "Patrocinado";
}
export interface AdCampaign {
  id: string;
  product_id: string;
  product_title: string;
  images: string[];
  name: string | null;
  status: string;
  budget: number;
  spent: number;
  released: number;
  remaining: number;
  starts_at: string;
  ends_at: string;
  eligible_elapsed_seconds: number;
  impressions: number;
  clicks: number;
  product_views: number;
  cart_adds: number;
  orders: number;
  gmv: number;
}
const campaignStatuses=["draft","scheduled","active","paused","exhausted","completed","cancelled"]as const;
export const parseSponsoredProduct=(value:unknown,path="sponsored"):SponsoredProduct=>{const row=rpcObject(value,path),seller=rpcObject(row.seller,`${path}.seller`);return{campaign_id:rpcUuid(row.campaign_id,`${path}.campaign_id`),product_id:rpcUuid(row.product_id,`${path}.product_id`),title:rpcString(row.title,`${path}.title`),images:rpcStringArray(row.images,`${path}.images`),seller:{username:rpcString(seller.username,`${path}.seller.username`),display_name:rpcNullableString(seller.display_name,`${path}.seller.display_name`)},price:rpcNonnegative(row.price,`${path}.price`),base_price:rpcNonnegative(row.base_price,`${path}.base_price`),promotion_id:rpcNullableUuid(row.promotion_id,`${path}.promotion_id`),sponsored:rpcBoolean(row.sponsored,`${path}.sponsored`)===true?true:(()=>{throw new Error('marketplace_payload_invalid:sponsored')})(),label:rpcEnum(row.label,["Patrocinado"]as const,`${path}.label`)}};
export const parseAdCampaign=(value:unknown,path="campaign"):AdCampaign=>{const row=rpcObject(value,path);return{id:rpcUuid(row.id,`${path}.id`),product_id:rpcUuid(row.product_id,`${path}.product_id`),product_title:rpcString(row.product_title,`${path}.product_title`),images:rpcStringArray(row.images,`${path}.images`),name:rpcNullableString(row.name,`${path}.name`),status:rpcEnum(row.status,campaignStatuses,`${path}.status`),budget:rpcNonnegative(row.budget,`${path}.budget`),spent:rpcNonnegative(row.spent,`${path}.spent`),released:rpcNonnegative(row.released,`${path}.released`),remaining:rpcNonnegative(row.remaining,`${path}.remaining`),starts_at:rpcTimestamp(row.starts_at,`${path}.starts_at`),ends_at:rpcTimestamp(row.ends_at,`${path}.ends_at`),eligible_elapsed_seconds:rpcNonnegativeInteger(row.eligible_elapsed_seconds,`${path}.eligible_elapsed_seconds`),impressions:rpcNonnegativeInteger(row.impressions,`${path}.impressions`),clicks:rpcNonnegativeInteger(row.clicks,`${path}.clicks`),product_views:rpcNonnegativeInteger(row.product_views,`${path}.product_views`),cart_adds:rpcNonnegativeInteger(row.cart_adds,`${path}.cart_adds`),orders:rpcNonnegativeInteger(row.orders,`${path}.orders`),gmv:rpcNonnegative(row.gmv,`${path}.gmv`)}};
const parseIdReceipt=(value:unknown,path:string)=>({id:rpcUuid(rpcObject(value,path).id,`${path}.id`)});
export async function fetchSponsoredProducts(
  surface: "marketplace_home" | "marketplace_search",
  category?: string,
) {
  const { data, error } = await db().functions.invoke("marketplace-ads", {
    body: {
      surface,
      category: category ?? null,
      limit: 4,
      session: marketplaceCommerceSessionId(),
    },
  });
  if (error) throw error;
  const root=rpcObject(data,'marketplace_ads_edge');
  if(root.success!==true)throw new Error('marketplace_payload_invalid:marketplace_ads_edge.success');
  return rpcArray(root.products,'marketplace_ads_edge.products').map((value,index)=>parseSponsoredProduct(value,`marketplace_ads_edge.products[${index}]`));
}
export async function recordAdEvent(input: {
  campaignId: string;
  productId: string;
  eventType: AdEventType;
  surface:
    | "marketplace_home"
    | "marketplace_search"
    | "product_detail"
    | "cart";
  metadata?: Record<string, string | number>;
  eventKey?: string;
}) {
  const { data, error } = await db().rpc("record_marketplace_ad_event", {
    p_campaign_id: input.campaignId,
    p_product_id: input.productId,
    p_event_type: input.eventType,
    p_surface: input.surface,
    p_event_key: input.eventKey ?? randomUUID(),
    p_anonymous_session_id: marketplaceCommerceSessionId(),
    p_metadata: input.metadata ?? {},
  });
  if (error) throw error;
  const row=rpcObject(data,'ad_event');
  return{id:rpcUuid(row.id,'ad_event.id'),touch_id:row.touch_id==null?undefined:rpcUuid(row.touch_id,'ad_event.touch_id')};
}
export async function fetchMyAdCampaigns(status?: string) {
  const { data, error } = await db().rpc("fetch_my_marketplace_ad_campaigns", {
    p_status: status ?? null,
    p_limit: 100,
  });
  if (error) throw error;
  return rpcArray(data,'ad_campaigns').map((value,index)=>parseAdCampaign(value,`ad_campaigns[${index}]`));
}
export async function fetchMyAdCampaignDetail(id: string) {
  const { data, error } = await db().rpc(
    "fetch_my_marketplace_ad_campaign_detail",
    { p_campaign_id: id },
  );
  if (error) throw error;
  return data===null?null:parseAdCampaign(data,'ad_campaign_detail');
}
export async function fetchAdConfig() {
  const { data, error } = await db().rpc("fetch_marketplace_ad_config");
  if (error) throw error;
  const row=rpcObject(data,'ad_config');
  const result: {
    minimum_budget_bdag: number;
    maximum_budget_bdag: number;
    minimum_duration: string;
    maximum_duration: string;
    minimum_duration_seconds: number;
    maximum_duration_seconds: number;
  } = {minimum_budget_bdag:rpcNonnegative(row.minimum_budget_bdag,'ad_config.minimum_budget_bdag'),maximum_budget_bdag:rpcNonnegative(row.maximum_budget_bdag,'ad_config.maximum_budget_bdag'),minimum_duration:rpcString(row.minimum_duration,'ad_config.minimum_duration'),maximum_duration:rpcString(row.maximum_duration,'ad_config.maximum_duration'),minimum_duration_seconds:rpcNonnegativeInteger(row.minimum_duration_seconds,'ad_config.minimum_duration_seconds'),maximum_duration_seconds:rpcNonnegativeInteger(row.maximum_duration_seconds,'ad_config.maximum_duration_seconds')};
  return result;
}
export async function createAdDraft(input: {
  productId: string;
  name?: string;
  budget: number;
  startsAt: string;
  endsAt: string;
  idempotencyKey: string;
}) {
  const { data, error } = await db().rpc(
    "create_marketplace_ad_campaign_draft",
    {
      p_product_id: input.productId,
      p_name: input.name ?? null,
      p_budget_bdag: input.budget,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_idempotency_key: input.idempotencyKey,
    },
  );
  if (error) throw error;
  return parseIdReceipt(data,'ad_draft');
}
export async function activateAdCampaign(id: string, key: string) {
  const { data, error } = await db().rpc("activate_marketplace_ad_campaign", {
    p_campaign_id: id,
    p_idempotency_key: key,
  });
  if (error) throw error;
  return parseIdReceipt(data,'ad_activation');
}
export async function pauseAdCampaign(id: string) {
  const { data, error } = await db().rpc("pause_marketplace_ad_campaign", {
    p_campaign_id: id,
  });
  if (error) throw error;
  return parseIdReceipt(data,'ad_pause');
}
export async function resumeAdCampaign(id: string) {
  const { data, error } = await db().rpc("resume_marketplace_ad_campaign", {
    p_campaign_id: id,
  });
  if (error) throw error;
  return parseIdReceipt(data,'ad_resume');
}
