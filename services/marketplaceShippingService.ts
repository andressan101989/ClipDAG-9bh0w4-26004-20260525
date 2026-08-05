import { getSupabaseClient } from '@/template';

export interface MarketplaceShippingRegion {
  countryCode: string;
  regionCode: string | null;
  shippingPrice: number;
  freeShippingThreshold: number | null;
  transitDaysMin: number;
  transitDaysMax: number;
  status: 'active' | 'paused';
}
export interface MarketplaceShippingProfile {
  id: string;
  name: string;
  status: 'active' | 'paused';
  processingDaysMin: number;
  processingDaysMax: number;
  shipsFromCountry: string;
  returnPolicySummary: string;
  legacyUnrestricted: boolean;
  regions: MarketplaceShippingRegion[];
}
export interface MarketplaceShippingProfileInput {
  profileId?: string | null;
  storeId: string;
  name: string;
  processingDaysMin: number;
  processingDaysMax: number;
  shipsFromCountry: string;
  returnPolicySummary: string;
  regions: Omit<MarketplaceShippingRegion, 'status'>[];
}

const db = () => getSupabaseClient();
const number = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('marketplace_invalid_shipping_profile');
  return parsed;
};
const parse = (value: unknown): MarketplaceShippingProfile[] => {
  if (!Array.isArray(value)) throw new Error('marketplace_invalid_shipping_profile');
  return value.map(raw => {
    const row = raw as Record<string, unknown>;
    const regions = Array.isArray(row.regions) ? row.regions : [];
    return {
      id: String(row.id), name: String(row.name), status: String(row.status) as MarketplaceShippingProfile['status'],
      processingDaysMin: number(row.processing_days_min), processingDaysMax: number(row.processing_days_max),
      shipsFromCountry: String(row.ships_from_country), returnPolicySummary: String(row.return_policy_summary),
      legacyUnrestricted: row.legacy_unrestricted === true,
      regions: regions.map(rawRegion => {
        const region = rawRegion as Record<string, unknown>;
        return { countryCode: String(region.country_code), regionCode: region.region_code == null ? null : String(region.region_code),
          shippingPrice: number(region.shipping_price), freeShippingThreshold: region.free_shipping_threshold == null ? null : number(region.free_shipping_threshold),
          transitDaysMin: number(region.transit_days_min), transitDaysMax: number(region.transit_days_max), status: String(region.status) as 'active' | 'paused' };
      }),
    };
  });
};

export async function fetchMyMarketplaceShippingProfiles(storeId: string): Promise<MarketplaceShippingProfile[]> {
  const { data, error } = await db().rpc('fetch_my_marketplace_shipping_profiles', { p_store_id: storeId });
  if (error) throw error;
  return parse(data);
}
export async function upsertMyMarketplaceShippingProfile(input: MarketplaceShippingProfileInput): Promise<string> {
  const { data, error } = await db().rpc('upsert_my_marketplace_shipping_profile', {
    p_profile_id: input.profileId ?? null, p_store_id: input.storeId, p_name: input.name,
    p_processing_days_min: input.processingDaysMin, p_processing_days_max: input.processingDaysMax,
    p_ships_from_country: input.shipsFromCountry.toUpperCase(), p_return_policy_summary: input.returnPolicySummary,
    p_regions: input.regions.map(region => ({ country_code: region.countryCode.toUpperCase(), region_code: region.regionCode?.toUpperCase() ?? null,
      shipping_price: region.shippingPrice, free_shipping_threshold: region.freeShippingThreshold,
      transit_days_min: region.transitDaysMin, transit_days_max: region.transitDaysMax })),
  });
  if (error) throw error;
  return String(data);
}
export async function setMyMarketplaceProductShippingProfile(productId: string, profileId: string): Promise<void> {
  const { error } = await db().rpc('set_my_marketplace_product_shipping_profile', { p_product_id: productId, p_profile_id: profileId });
  if (error) throw error;
}
