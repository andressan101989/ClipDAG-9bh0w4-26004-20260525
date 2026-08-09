import { randomUUID } from "expo-crypto";
import { getSupabaseClient } from "@/template";
import { marketplaceCommerceSessionId } from "./marketplaceAnalyticsService";
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
const rows = <T>(data: unknown): T[] =>
  Array.isArray(data) ? (data as T[]) : [];
export async function fetchSponsoredProducts(
  surface: "marketplace_home" | "marketplace_search",
  categoryId?: string,
) {
  const { data, error } = await db().functions.invoke("marketplace-ads", {
    body: {
      surface,
      categoryId: categoryId ?? null,
      limit: 4,
      session: marketplaceCommerceSessionId(),
    },
  });
  if (error) throw error;
  return rows<SponsoredProduct>((data as { products?: unknown })?.products);
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
  return data as { id: string; touch_id?: string };
}
export async function fetchMyAdCampaigns(status?: string) {
  const { data, error } = await db().rpc("fetch_my_marketplace_ad_campaigns", {
    p_status: status ?? null,
    p_limit: 100,
  });
  if (error) throw error;
  return rows<AdCampaign>(data);
}
export async function fetchMyAdCampaignDetail(id: string) {
  const { data, error } = await db().rpc(
    "fetch_my_marketplace_ad_campaign_detail",
    { p_campaign_id: id },
  );
  if (error) throw error;
  return data as AdCampaign | null;
}
export async function fetchAdConfig() {
  const { data, error } = await db().rpc("fetch_marketplace_ad_config");
  if (error) throw error;
  return data as {
    minimum_budget_bdag: number;
    maximum_budget_bdag: number;
    minimum_duration: string;
    maximum_duration: string;
  };
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
  return data as { id: string };
}
export async function activateAdCampaign(id: string, key: string) {
  const { data, error } = await db().rpc("activate_marketplace_ad_campaign", {
    p_campaign_id: id,
    p_idempotency_key: key,
  });
  if (error) throw error;
  return data as { id: string };
}
export async function pauseAdCampaign(id: string) {
  const { data, error } = await db().rpc("pause_marketplace_ad_campaign", {
    p_campaign_id: id,
  });
  if (error) throw error;
  return data;
}
export async function resumeAdCampaign(id: string) {
  const { data, error } = await db().rpc("resume_marketplace_ad_campaign", {
    p_campaign_id: id,
  });
  if (error) throw error;
  return data;
}
