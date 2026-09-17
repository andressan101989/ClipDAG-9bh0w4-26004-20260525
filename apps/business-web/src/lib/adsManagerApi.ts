import { supabase, type BusinessSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;
export const AD_PLACEMENTS = ["marketplace_home", "marketplace_search", "social_feed"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export type AdsCursor = { createdAt: string; id: string };
export type AdsMetricSummary = {
  activeCampaigns: number;
  totalBudgetBdag: number;
  spentBdag: number;
  impressions: number;
  clicks: number;
  orders: number;
  attributedGmvBdag: number;
};
export type AdCampaignSummary = {
  id: string;
  productId: string;
  productTitle: string;
  productImageUrl: string | null;
  name: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  totalBudgetBdag: number;
  spentBdag: number;
  releasedBdag: number;
  remainingReservedBdag: number;
  eligibleElapsedSeconds: number;
  eligibilityState: boolean;
  eligibilityReason: string | null;
  impressions: number;
  clicks: number;
  productViews: number;
  cartAdds: number;
  orders: number;
  attributedGmvBdag: number;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  placements: AdPlacement[];
};
export type AdCampaignPage = {
  items: AdCampaignSummary[];
  nextCursor: AdsCursor | null;
  summary: AdsMetricSummary;
};
export type EligibleAdProduct = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  price: number;
  currency: string;
  createdAt: string;
};
export type EligibleAdProductPage = { items: EligibleAdProduct[]; nextCursor: AdsCursor | null };
export type AdConfig = {
  minimumBudgetBdag: number;
  maximumBudgetBdag: number;
  minimumDurationSeconds: number;
  maximumDurationSeconds: number;
};
export type AdCampaignDetail = AdCampaignSummary & {
  fundedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  product: { id: string; title: string; imageUrl: string | null; price: number; currency: string };
  deliverySurfaces: Array<{ surface: string; impressions: number; clicks: number; productViews: number; cartAdds: number; purchases: number }>;
  attribution: Array<{ orderNumber: string; attributedGmvBdag: number; attributedAt: string }>;
  finalization: Row | null;
};

function object(value: unknown, code: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}
function array(value: unknown, code: string) {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}
function string(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}
function optionalString(value: unknown) { return typeof value === "string" && value ? value : null; }
function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function placements(value: unknown): AdPlacement[] {
  return array(value, "business_ad_placements_invalid").map((item) => {
    if (typeof item !== "string" || !AD_PLACEMENTS.includes(item as AdPlacement)) {
      throw new Error("business_ad_placements_invalid");
    }
    return item as AdPlacement;
  });
}
function rpcError(error: { message?: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}
function parseCursor(value: unknown): AdsCursor | null {
  if (value == null) return null;
  const parsed = object(value, "business_ads_cursor_invalid");
  return { createdAt: string(parsed.created_at, "business_ads_cursor_invalid"), id: string(parsed.id, "business_ads_cursor_invalid") };
}
function parseSummary(value: unknown): AdsMetricSummary {
  const parsed = object(value, "business_ads_summary_invalid");
  return {
    activeCampaigns: number(parsed.active_campaigns),
    totalBudgetBdag: number(parsed.total_budget_bdag),
    spentBdag: number(parsed.spent_bdag),
    impressions: number(parsed.impressions),
    clicks: number(parsed.clicks),
    orders: number(parsed.orders),
    attributedGmvBdag: number(parsed.attributed_gmv_bdag),
  };
}
function parseCampaign(value: unknown): AdCampaignSummary {
  const parsed = object(value, "business_ad_campaign_invalid");
  return {
    id: string(parsed.id, "business_ad_campaign_invalid"),
    productId: string(parsed.product_id, "business_ad_campaign_invalid"),
    productTitle: string(parsed.product_title, "business_ad_campaign_invalid"),
    productImageUrl: optionalString(parsed.product_image_url),
    name: optionalString(parsed.name),
    status: string(parsed.status, "business_ad_campaign_invalid"),
    startsAt: string(parsed.starts_at, "business_ad_campaign_invalid"),
    endsAt: string(parsed.ends_at, "business_ad_campaign_invalid"),
    totalBudgetBdag: number(parsed.total_budget_bdag),
    spentBdag: number(parsed.spent_bdag),
    releasedBdag: number(parsed.released_bdag),
    remainingReservedBdag: number(parsed.remaining_reserved_bdag),
    eligibleElapsedSeconds: number(parsed.eligible_elapsed_seconds),
    eligibilityState: parsed.eligibility_state === true,
    eligibilityReason: optionalString(parsed.eligibility_reason),
    impressions: number(parsed.impressions),
    clicks: number(parsed.clicks),
    productViews: number(parsed.product_views),
    cartAdds: number(parsed.cart_adds),
    orders: number(parsed.orders),
    attributedGmvBdag: number(parsed.attributed_gmv_bdag),
    finalizedAt: optionalString(parsed.finalized_at),
    createdAt: string(parsed.created_at, "business_ad_campaign_invalid"),
    updatedAt: string(parsed.updated_at, "business_ad_campaign_invalid"),
    placements: placements(parsed.placements),
  };
}

export async function searchAdCampaigns(
  ownerId: string,
  filters: { status?: string; cursor?: AdsCursor; limit?: number } = {},
  client: BusinessSupabaseClient = supabase,
): Promise<AdCampaignPage> {
  const { data, error } = await client.rpc("search_my_business_ad_campaigns", {
    p_business_owner_id: ownerId,
    p_status: filters.status || null,
    p_cursor_created_at: filters.cursor?.createdAt ?? null,
    p_cursor_id: filters.cursor?.id ?? null,
    p_limit: filters.limit ?? 30,
  });
  rpcError(error, "No se pudieron cargar las campañas");
  const payload = object(data, "business_ads_page_invalid");
  return {
    items: array(payload.items, "business_ads_page_invalid").map(parseCampaign),
    nextCursor: parseCursor(payload.next_cursor),
    summary: parseSummary(payload.summary),
  };
}

export async function getAdCampaign(
  ownerId: string,
  campaignId: string,
  client: BusinessSupabaseClient = supabase,
): Promise<AdCampaignDetail> {
  const { data, error } = await client.rpc("get_my_business_ad_campaign", {
    p_business_owner_id: ownerId,
    p_campaign_id: campaignId,
  });
  rpcError(error, "No se pudo cargar la campaña");
  const payload = object(data, "business_ad_detail_invalid");
  const metrics = object(payload.metrics, "business_ad_metrics_invalid");
  const product = object(payload.product, "business_ad_product_invalid");
  const base = parseCampaign({
    ...payload,
    product_id: product.id,
    product_title: product.title,
    product_image_url: product.image_url,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    product_views: metrics.product_views,
    cart_adds: metrics.cart_adds,
    orders: metrics.orders,
    attributed_gmv_bdag: metrics.attributed_gmv_bdag,
    finalized_at: objectOrNull(payload.finalization)?.finalized_at ?? null,
  });
  return {
    ...base,
    fundedAt: optionalString(payload.funded_at),
    pausedAt: optionalString(payload.paused_at),
    completedAt: optionalString(payload.completed_at),
    product: {
      id: string(product.id, "business_ad_product_invalid"),
      title: string(product.title, "business_ad_product_invalid"),
      imageUrl: optionalString(product.image_url),
      price: number(product.price),
      currency: string(product.currency, "business_ad_product_invalid"),
    },
    deliverySurfaces: array(payload.delivery_surfaces, "business_ad_surfaces_invalid").map((value) => {
      const surface = object(value, "business_ad_surface_invalid");
      return {
        surface: string(surface.surface, "business_ad_surface_invalid"),
        impressions: number(surface.impressions), clicks: number(surface.clicks),
        productViews: number(surface.product_views), cartAdds: number(surface.cart_adds), purchases: number(surface.purchases),
      };
    }),
    attribution: array(payload.attribution, "business_ad_attribution_invalid").map((value) => {
      const attribution = object(value, "business_ad_attribution_invalid");
      return {
        orderNumber: string(attribution.order_number, "business_ad_attribution_invalid"),
        attributedGmvBdag: number(attribution.attributed_gmv_bdag),
        attributedAt: string(attribution.attributed_at, "business_ad_attribution_invalid"),
      };
    }),
    finalization: objectOrNull(payload.finalization),
  };
}

function objectOrNull(value: unknown): Row | null {
  return value == null ? null : object(value, "business_ad_finalization_invalid");
}

export async function searchEligibleAdProducts(
  ownerId: string,
  cursor?: AdsCursor,
  client: BusinessSupabaseClient = supabase,
): Promise<EligibleAdProductPage> {
  const { data, error } = await client.rpc("search_my_business_ad_eligible_products", {
    p_business_owner_id: ownerId,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: 30,
  });
  rpcError(error, "No se pudieron cargar los productos elegibles");
  const payload = object(data, "business_ad_products_invalid");
  return {
    items: array(payload.items, "business_ad_products_invalid").map((value) => {
      const product = object(value, "business_ad_product_invalid");
      return {
        id: string(product.id, "business_ad_product_invalid"),
        title: string(product.title, "business_ad_product_invalid"),
        thumbnailUrl: optionalString(product.thumbnail_url),
        price: number(product.price),
        currency: string(product.currency, "business_ad_product_invalid"),
        createdAt: string(product.created_at, "business_ad_product_invalid"),
      };
    }),
    nextCursor: parseCursor(payload.next_cursor),
  };
}

export async function fetchAdConfig(client: BusinessSupabaseClient = supabase): Promise<AdConfig> {
  const { data, error } = await client.rpc("fetch_marketplace_ad_config");
  rpcError(error, "No se pudo cargar la configuración de Ads");
  const config = object(data, "business_ad_config_invalid");
  return {
    minimumBudgetBdag: number(config.minimum_budget_bdag),
    maximumBudgetBdag: number(config.maximum_budget_bdag),
    minimumDurationSeconds: number(config.minimum_duration_seconds),
    maximumDurationSeconds: number(config.maximum_duration_seconds),
  };
}

export async function createAdCampaignDraft(input: {
  productId: string;
  name: string;
  budgetBdag: number;
  startsAt: string;
  endsAt: string;
}, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("create_marketplace_ad_campaign_draft", {
    p_product_id: input.productId,
    p_name: input.name.trim() || null,
    p_budget_bdag: input.budgetBdag,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_idempotency_key: crypto.randomUUID(),
  });
  rpcError(error, "No se pudo crear la campaña");
  return object(data, "business_ad_campaign_result_invalid");
}

export async function setAdCampaignPlacements(
  campaignId: string,
  selectedPlacements: AdPlacement[],
  client: BusinessSupabaseClient = supabase,
) {
  const { data, error } = await client.rpc("set_my_marketplace_ad_campaign_placements", {
    p_campaign_id: campaignId,
    p_surfaces: selectedPlacements,
  });
  rpcError(error, "No se pudieron guardar las ubicaciones");
  return object(data, "business_ad_placements_result_invalid");
}

export async function activateAdCampaign(campaignId: string, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("activate_marketplace_ad_campaign", {
    p_campaign_id: campaignId,
    p_idempotency_key: crypto.randomUUID(),
  });
  rpcError(error, "No se pudo activar y financiar la campaña");
  return object(data, "business_ad_campaign_result_invalid");
}

export async function pauseAdCampaign(campaignId: string, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("pause_marketplace_ad_campaign", { p_campaign_id: campaignId });
  rpcError(error, "No se pudo pausar la campaña");
  return object(data, "business_ad_campaign_result_invalid");
}

export async function resumeAdCampaign(campaignId: string, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("resume_marketplace_ad_campaign", { p_campaign_id: campaignId });
  rpcError(error, "No se pudo reanudar la campaña");
  return object(data, "business_ad_campaign_result_invalid");
}
