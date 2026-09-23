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
export class AdvertisingRpcError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AdvertisingRpcError";
    this.code = code;
  }
}

function rpcError(error: { message?: string; code?: string } | null, fallback: string) {
  if (error) throw new AdvertisingRpcError(error.message || fallback, error.code);
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

export type AdvertisingAuthority = "ads_v2" | "marketplace_legacy";
export type AdvertiserAdAccount = {
  id: string; name: string; status: string; billingCurrency: string; isDefault: boolean;
};
export type AdvertiserBusiness = {
  businessAccountId: string;
  displayName: string;
  status: string;
  accessType: "owner" | "member";
  marketplace: { linked: boolean; marketplaceSellerUserId: string | null; sellerStatus: string | null };
  adAccounts: AdvertiserAdAccount[];
};
export type AdvertisingCampaignSummary = {
  id: string; name: string; status: string; objective: string;
  adAccountId: string | null; businessAccountId: string | null;
  authority: AdvertisingAuthority; writeAuthority: AdvertisingAuthority; createdAt: string;
};
export type AdvertisingResumeReference = { id: string; status: string; latestVersionNumber: number | null };
export type AdvertisingAdSet = {
  id: string; name: string; status: string; startsAt: string | null; endsAt: string | null; createdAt: string;
  audience: AdvertisingResumeReference | null; placementSelection: AdvertisingResumeReference | null;
};
export type AdvertisingDestination = {
  id: string; destinationType: string; externalUrl: string | null; targetUserId: string | null;
  targetBusinessAccountId: string | null; targetProductId: string | null; targetStoreId: string | null;
  status: string; createdAt: string;
};
export type AdvertisingCampaign = AdvertisingCampaignSummary & {
  updatedAt: string | null; archivedAt: string | null; adSets: AdvertisingAdSet[]; destinations: AdvertisingDestination[];
};
export type AdvertisingCreativeVersion = {
  id: string; versionNumber: number; format: "image" | "video"; mediaAssetId: string | null; videoAssetId: string | null;
  primaryText: string | null; headline: string | null; description: string | null; callToAction: string; createdAt: string;
};
export type AdvertisingCreative = { id: string; adAccountId: string; name: string; status: string; versions: AdvertisingCreativeVersion[] };
export type AdvertisingAd = {
  id: string; name: string; campaignId: string; adSetId: string; creativeVersionId: string; destinationId: string;
  status: string; reviewStatus: string; submittedAt: string | null; reviewedAt: string | null;
  latestRejectionReasonCode: string | null; latestRejectionMessage: string | null;
};
export type AdvertisingCreativeWorkspace = { creatives: AdvertisingCreative[]; ads: AdvertisingAd[] };
export type AdvertisingPlacementSelection = {
  placementSelectionId: string;
  adSetId: string;
  status: string;
  latestVersion: null | {
    versionNumber: number;
    registryPolicyVersion: string;
    definitionFingerprint: string;
    placements: Array<{
      code: string;
      label: string;
      surfaceFamily: string;
      surfaceVerified: boolean;
      selectionEnabled: boolean;
      v2DeliveryEnabled: boolean;
    }>;
  };
  productionDeliveryEnabled: boolean;
};

function parseAdvertiserBusiness(value: unknown): AdvertiserBusiness {
  const row = object(value, "advertiser_business_invalid");
  const marketplace = object(row.marketplace, "advertiser_business_invalid");
  return {
    businessAccountId: string(row.business_account_id, "advertiser_business_invalid"),
    displayName: string(row.display_name, "advertiser_business_invalid"),
    status: string(row.status, "advertiser_business_invalid"),
    accessType: string(row.access_type, "advertiser_business_invalid") as "owner" | "member",
    marketplace: {
      linked: marketplace.linked === true,
      marketplaceSellerUserId: optionalString(marketplace.marketplace_seller_user_id),
      sellerStatus: optionalString(marketplace.seller_status),
    },
    adAccounts: array(row.ad_accounts, "advertiser_business_invalid").map((value) => {
      const account = object(value, "advertiser_ad_account_invalid");
      return { id: string(account.id, "advertiser_ad_account_invalid"), name: string(account.name, "advertiser_ad_account_invalid"), status: string(account.status, "advertiser_ad_account_invalid"), billingCurrency: string(account.billing_currency, "advertiser_ad_account_invalid"), isDefault: account.is_default === true };
    }),
  };
}

function parseCampaignSummary(value: unknown): AdvertisingCampaignSummary {
  const row = object(value, "advertising_campaign_invalid");
  return {
    id: string(row.id, "advertising_campaign_invalid"),
    name: optionalString(row.name) ?? "Untitled campaign",
    status: string(row.status, "advertising_campaign_invalid"),
    objective: string(row.objective, "advertising_campaign_invalid"),
    adAccountId: optionalString(row.ad_account_id), businessAccountId: optionalString(row.business_account_id),
    authority: string(row.authority ?? "ads_v2", "advertising_campaign_invalid") as AdvertisingAuthority,
    writeAuthority: string(row.write_authority ?? "ads_v2", "advertising_campaign_invalid") as AdvertisingAuthority,
    createdAt: string(row.created_at, "advertising_campaign_invalid"),
  };
}

function parseResumeReference(value: unknown): AdvertisingResumeReference | null {
  if (value == null) return null;
  const row = object(value, "advertising_resume_reference_invalid");
  return { id: string(row.id, "advertising_resume_reference_invalid"), status: string(row.status, "advertising_resume_reference_invalid"), latestVersionNumber: row.latest_version_number == null ? null : number(row.latest_version_number) };
}

function parseAdvertisingCampaign(value: unknown): AdvertisingCampaign {
  const row = object(value, "advertising_campaign_invalid");
  const summary = parseCampaignSummary(row);
  return {
    ...summary,
    updatedAt: optionalString(row.updated_at), archivedAt: optionalString(row.archived_at),
    adSets: array(row.ad_sets ?? [], "advertising_campaign_invalid").map((value) => {
      const adSet = object(value, "advertising_ad_set_invalid");
      return { id: string(adSet.id, "advertising_ad_set_invalid"), name: string(adSet.name, "advertising_ad_set_invalid"), status: string(adSet.status, "advertising_ad_set_invalid"), startsAt: optionalString(adSet.starts_at), endsAt: optionalString(adSet.ends_at), createdAt: string(adSet.created_at, "advertising_ad_set_invalid"), audience: parseResumeReference(adSet.audience), placementSelection: parseResumeReference(adSet.placement_selection) };
    }),
    destinations: array(row.destinations ?? [], "advertising_campaign_invalid").map((value) => {
      const destination = object(value, "advertising_destination_invalid");
      return { id: string(destination.id, "advertising_destination_invalid"), destinationType: string(destination.destination_type, "advertising_destination_invalid"), externalUrl: optionalString(destination.external_url), targetUserId: optionalString(destination.target_user_id), targetBusinessAccountId: optionalString(destination.target_business_account_id), targetProductId: optionalString(destination.target_product_id), targetStoreId: optionalString(destination.target_store_id), status: string(destination.status, "advertising_destination_invalid"), createdAt: string(destination.created_at, "advertising_destination_invalid") };
    }),
  };
}

async function advertisingRpc(name: string, args: Record<string, unknown> | undefined, fallback: string, client: BusinessSupabaseClient) {
  const result = args ? await client.rpc(name, args) : await client.rpc(name);
  rpcError(result.error, fallback);
  return result.data;
}

export async function getAdvertiserAccounts(client: BusinessSupabaseClient = supabase): Promise<AdvertiserBusiness[]> {
  const payload = object(await advertisingRpc("get_my_advertiser_accounts", undefined, "No se pudieron cargar las cuentas publicitarias", client), "advertiser_accounts_invalid");
  return array(payload.businesses, "advertiser_accounts_invalid").map(parseAdvertiserBusiness);
}

export async function createAdvertiserBusinessAccount(displayName: string, client: BusinessSupabaseClient = supabase) {
  return parseAdvertiserBusiness(await advertisingRpc("create_my_business_account", { p_display_name: displayName.trim(), p_idempotency_key: crypto.randomUUID() }, "No se pudo crear la cuenta empresarial", client));
}

export async function getAdvertisingCampaigns(client: BusinessSupabaseClient = supabase): Promise<AdvertisingCampaignSummary[]> {
  const payload = object(await advertisingRpc("get_my_advertising_campaigns", undefined, "No se pudieron cargar las campañas", client), "advertising_campaigns_invalid");
  return array(payload.campaigns, "advertising_campaigns_invalid").map(parseCampaignSummary);
}

export async function getAdvertisingCampaign(id: string, authority: AdvertisingAuthority, client: BusinessSupabaseClient = supabase) {
  return parseAdvertisingCampaign(await advertisingRpc("get_my_advertising_campaign", { p_campaign_id: id, p_authority: authority }, "No se pudo cargar la campaña", client));
}

export async function createAdvertisingCampaignDraft(input: { adAccountId: string; name: string; objective: string }, client: BusinessSupabaseClient = supabase) {
  return parseAdvertisingCampaign(await advertisingRpc("create_my_advertising_campaign_draft", { p_ad_account_id: input.adAccountId, p_name: input.name.trim(), p_objective: input.objective, p_idempotency_key: crypto.randomUUID() }, "No se pudo crear la campaña", client));
}

export const ADVERTISING_OBJECTIVES = ["awareness", "reach", "traffic", "engagement", "video_views", "profile_visits", "messages", "website_conversions", "app_promotion", "marketplace_sales"] as const;
export const ADVERTISING_PLACEMENTS = ["marketplace_home", "marketplace_search", "social_feed", "stories", "clips", "live"] as const;
export const ADVERTISING_CTAS = ["learn_more", "shop_now", "sign_up", "contact_us", "send_message", "download", "visit_profile", "none"] as const;

export type AdvertisingAudienceDefinition = {
  age_scope: "adults_only";
  geographies: Array<{ mode: "include" | "exclude"; type: "country" | "region" | "city" | "radius"; country_code: string; region_code?: string; city_name?: string; latitude?: number; longitude?: number; radius_km?: number }>;
  languages: Array<{ mode: "include" | "exclude"; tag: string }>;
  dayparts: Array<{ timezone: string; weekday: number; start: string; end: string }>;
  frequency: { max_impressions: number; window_hours: number } | null;
};

export async function createAdvertisingAdSetDraft(input: { campaignId: string; name: string; startsAt?: string | null; endsAt?: string | null }, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_ad_set_draft", { p_campaign_id: input.campaignId, p_name: input.name.trim(), p_starts_at: input.startsAt || null, p_ends_at: input.endsAt || null, p_idempotency_key: crypto.randomUUID() }, "No se pudo crear el Ad Set", client), "advertising_ad_set_invalid");
}

export async function createAdvertisingDestinationDraft(input: { campaignId: string; type: string; externalUrl?: string | null; targetUserId?: string | null; targetBusinessAccountId?: string | null; targetProductId?: string | null; targetStoreId?: string | null }, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_destination_draft", { p_campaign_id: input.campaignId, p_destination_type: input.type, p_idempotency_key: crypto.randomUUID(), p_external_url: input.externalUrl || null, p_target_user_id: input.targetUserId || null, p_target_business_account_id: input.targetBusinessAccountId || null, p_target_product_id: input.targetProductId || null, p_target_store_id: input.targetStoreId || null }, "No se pudo crear el destino", client), "advertising_destination_invalid");
}

export async function createAdvertisingAudienceDraft(adSetId: string, definition: AdvertisingAudienceDefinition, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_audience_draft", { p_ad_set_id: adSetId, p_definition: definition, p_idempotency_key: crypto.randomUUID() }, "No se pudo crear la audiencia", client), "advertising_audience_invalid");
}

export async function createAdvertisingAudienceVersion(audienceId: string, definition: AdvertisingAudienceDefinition, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_audience_version", { p_audience_id: audienceId, p_definition: definition, p_idempotency_key: crypto.randomUUID() }, "No se pudo actualizar la audiencia", client), "advertising_audience_invalid");
}

export async function getAdvertisingAudience(audienceId: string, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("get_my_advertising_audience", { p_audience_id: audienceId }, "No se pudo cargar la audiencia", client), "advertising_audience_invalid");
}

export async function createAdvertisingPlacementSelectionDraft(adSetId: string, codes: string[], client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_placement_selection_draft", { p_ad_set_id: adSetId, p_placement_codes: codes, p_idempotency_key: crypto.randomUUID() }, "No se pudieron guardar los placements", client), "advertising_placement_invalid");
}

export async function createAdvertisingPlacementSelectionVersion(selectionId: string, codes: string[], client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_placement_selection_version", { p_placement_selection_id: selectionId, p_placement_codes: codes, p_idempotency_key: crypto.randomUUID() }, "No se pudieron actualizar los placements", client), "advertising_placement_invalid");
}

export async function getAdvertisingPlacementSelection(selectionId: string, client: BusinessSupabaseClient = supabase): Promise<AdvertisingPlacementSelection> {
  const payload = object(await advertisingRpc("get_my_advertising_placement_selection", { p_placement_selection_id: selectionId }, "No se pudieron cargar los placements", client), "advertising_placement_invalid");
  const version = payload.latest_version == null ? null : object(payload.latest_version, "advertising_placement_invalid");
  return {
    placementSelectionId: string(payload.placement_selection_id, "advertising_placement_invalid"),
    adSetId: string(payload.ad_set_id, "advertising_placement_invalid"),
    status: string(payload.status, "advertising_placement_invalid"),
    latestVersion: version ? {
      versionNumber: number(version.version_number),
      registryPolicyVersion: string(version.registry_policy_version, "advertising_placement_invalid"),
      definitionFingerprint: string(version.definition_fingerprint, "advertising_placement_invalid"),
      placements: array(version.placements, "advertising_placement_invalid").map((value) => {
        const placement = object(value, "advertising_placement_invalid");
        return {
          code: string(placement.code, "advertising_placement_invalid"),
          label: string(placement.label, "advertising_placement_invalid"),
          surfaceFamily: string(placement.surface_family, "advertising_placement_invalid"),
          surfaceVerified: placement.surface_verified === true,
          selectionEnabled: placement.selection_enabled === true,
          v2DeliveryEnabled: placement.v2_delivery_enabled === true,
        };
      }),
    } : null,
    productionDeliveryEnabled: payload.production_delivery_enabled === true,
  };
}

function parseCreativeWorkspace(value: unknown): AdvertisingCreativeWorkspace {
  const payload = object(value, "advertising_creative_workspace_invalid");
  return {
    creatives: array(payload.creatives, "advertising_creative_workspace_invalid").map((value) => {
      const creative = object(value, "advertising_creative_invalid");
      return { id: string(creative.id, "advertising_creative_invalid"), adAccountId: string(creative.ad_account_id, "advertising_creative_invalid"), name: string(creative.name, "advertising_creative_invalid"), status: string(creative.status, "advertising_creative_invalid"), versions: array(creative.versions, "advertising_creative_invalid").map((value) => { const version = object(value, "advertising_creative_version_invalid"); return { id: string(version.id, "advertising_creative_version_invalid"), versionNumber: number(version.version_number), format: string(version.format, "advertising_creative_version_invalid") as "image" | "video", mediaAssetId: optionalString(version.media_asset_id), videoAssetId: optionalString(version.video_asset_id), primaryText: optionalString(version.primary_text), headline: optionalString(version.headline), description: optionalString(version.description), callToAction: string(version.call_to_action, "advertising_creative_version_invalid"), createdAt: string(version.created_at, "advertising_creative_version_invalid") }; }) };
    }),
    ads: array(payload.ads, "advertising_creative_workspace_invalid").map((value) => { const ad = object(value, "advertising_ad_invalid"); return { id: string(ad.id, "advertising_ad_invalid"), name: string(ad.name, "advertising_ad_invalid"), campaignId: string(ad.campaign_id, "advertising_ad_invalid"), adSetId: string(ad.ad_set_id, "advertising_ad_invalid"), creativeVersionId: string(ad.creative_version_id, "advertising_ad_invalid"), destinationId: string(ad.destination_id, "advertising_ad_invalid"), status: string(ad.status, "advertising_ad_invalid"), reviewStatus: string(ad.review_status, "advertising_ad_invalid"), submittedAt: optionalString(ad.submitted_at), reviewedAt: optionalString(ad.reviewed_at), latestRejectionReasonCode: optionalString(ad.latest_rejection_reason_code), latestRejectionMessage: optionalString(ad.latest_rejection_message) }; }),
  };
}

export async function getAdvertisingCreativeWorkspace(client: BusinessSupabaseClient = supabase) {
  return parseCreativeWorkspace(await advertisingRpc("get_my_advertising_creative_workspace", undefined, "No se pudo cargar el workspace creativo", client));
}

export async function createAdvertisingCreative(input: { adAccountId: string; name: string; format: "image" | "video"; mediaAssetId?: string | null; videoAssetId?: string | null; primaryText?: string; headline?: string; description?: string; callToAction: string }, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_creative", { p_ad_account_id: input.adAccountId, p_name: input.name.trim(), p_format: input.format, p_media_asset_id: input.mediaAssetId || null, p_video_asset_id: input.videoAssetId || null, p_primary_text: input.primaryText?.trim() || null, p_headline: input.headline?.trim() || null, p_description: input.description?.trim() || null, p_call_to_action: input.callToAction, p_idempotency_key: crypto.randomUUID() }, "No se pudo crear el creative", client), "advertising_creative_invalid");
}

export async function createAdvertisingCreativeVersion(input: { creativeId: string; format: "image" | "video"; mediaAssetId?: string | null; videoAssetId?: string | null; primaryText?: string; headline?: string; description?: string; callToAction: string }, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_creative_version", { p_creative_id: input.creativeId, p_format: input.format, p_media_asset_id: input.mediaAssetId || null, p_video_asset_id: input.videoAssetId || null, p_primary_text: input.primaryText?.trim() || null, p_headline: input.headline?.trim() || null, p_description: input.description?.trim() || null, p_call_to_action: input.callToAction }, "No se pudo crear la versión", client), "advertising_creative_invalid");
}

export async function createAdvertisingAdDraft(input: { adSetId: string; creativeVersionId: string; destinationId: string; name: string }, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("create_my_advertising_ad_draft", { p_ad_set_id: input.adSetId, p_creative_version_id: input.creativeVersionId, p_destination_id: input.destinationId, p_name: input.name.trim(), p_idempotency_key: crypto.randomUUID() }, "No se pudo ensamblar el anuncio", client), "advertising_ad_invalid");
}

export async function submitAdvertisingAdForReview(adId: string, client: BusinessSupabaseClient = supabase) {
  return object(await advertisingRpc("submit_my_advertising_ad_for_review", { p_ad_id: adId, p_idempotency_key: crypto.randomUUID() }, "No se pudo enviar el anuncio a revisión", client), "advertising_ad_invalid");
}

export type AdvertisingFinance = { campaignId: string; currency: string; budgetBdag: number; financeStatus: string; fundedBdag: number; spentBdag: number; releasedBdag: number; reservedBdag: number; fundedAt: string | null; settledAt: string | null; policy: { fundingEnabled: boolean; spendEnabled: boolean; settlementEnabled: boolean } };
function parseAdvertisingFinance(value: unknown): AdvertisingFinance {
  const row = object(value, "advertising_finance_invalid"); const policy = object(row.finance_policy ?? {}, "advertising_finance_invalid");
  return { campaignId: string(row.campaign_id, "advertising_finance_invalid"), currency: string(row.currency, "advertising_finance_invalid"), budgetBdag: number(row.budget_bdag), financeStatus: string(row.finance_status, "advertising_finance_invalid"), fundedBdag: number(row.funded_bdag), spentBdag: number(row.spent_bdag), releasedBdag: number(row.released_bdag), reservedBdag: number(row.reserved_bdag), fundedAt: optionalString(row.funded_at), settledAt: optionalString(row.settled_at), policy: { fundingEnabled: policy.funding_enabled === true, spendEnabled: policy.spend_enabled === true, settlementEnabled: policy.settlement_enabled === true } };
}
export async function createAdvertisingFinanceDraft(campaignId: string, budgetBdag: number, client: BusinessSupabaseClient = supabase) { return parseAdvertisingFinance(await advertisingRpc("create_my_advertising_campaign_finance_draft", { p_campaign_id: campaignId, p_budget_bdag: budgetBdag, p_idempotency_key: crypto.randomUUID() }, "No se pudo definir el presupuesto", client)); }
export async function getAdvertisingFinance(campaignId: string, client: BusinessSupabaseClient = supabase) { return parseAdvertisingFinance(await advertisingRpc("get_my_advertising_campaign_finance", { p_campaign_id: campaignId }, "advertising_campaign_finance_not_found", client)); }
export async function getAdvertisingEventSummary(campaignId: string, client: BusinessSupabaseClient = supabase) { return object(await advertisingRpc("get_my_advertising_event_summary", { p_campaign_id: campaignId }, "No se pudieron cargar las métricas", client), "advertising_summary_invalid"); }

export function isAdvertisingFinanceNotFound(cause: unknown) {
  return cause instanceof AdvertisingRpcError
    ? cause.code === "P0002" || cause.message.includes("advertising_campaign_finance_not_found")
    : cause instanceof Error && cause.message.includes("advertising_campaign_finance_not_found");
}

export function advertisingUserMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (message.includes("advertising_adult_eligibility_required")) return "Advertising creation requires verified adult eligibility.";
  if (message.includes("42501") || message.includes("access_denied")) return "No tienes permiso para completar esta acción.";
  return message || "No se pudo completar la acción.";
}
